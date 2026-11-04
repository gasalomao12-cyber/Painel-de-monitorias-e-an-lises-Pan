# -*- coding: utf-8 -*-
"""
PX Beedoo · agente de envio
---------------------------
Envia pelo chat do Beedoo as mensagens que você revisou e confirmou na PX Monitorias.

Como funciona:
  1. Na plataforma você clica em "Formalizar no Beedoo", revisa a mensagem e confirma.
  2. A mensagem entra na sua fila. Este agente (no seu computador, dentro da rede) busca a fila,
     abre o Beedoo no Edge com a sua sessão e envia, igual ao disparo do hud.py.
  3. O resultado (enviado ou erro) volta para a plataforma, em "Envios ao Beedoo".

Uso: dois cliques em iniciar_agente.bat UMA VEZ. A partir daí ele abre sozinho, minimizado, toda vez
que você entra no Windows, e fica enviando. O Edge trabalha escondido; ele só aparece quando o Beedoo
pede para você entrar com a conta Microsoft (nenhuma senha é guardada pelo agente).

  python px_beedoo_agente.py --desinstalar   deixa de abrir sozinho com o Windows
"""
import configparser
import json
import logging
import os
import socket
import sys
import time
import urllib.error
import urllib.request

try:  # usa os certificados do Windows (proxy da empresa)
    import truststore
    truststore.inject_into_ssl()
except Exception:
    pass

from playwright.sync_api import sync_playwright, TimeoutError as PwTimeout

BASE = os.path.dirname(os.path.abspath(__file__))
CONFIG = os.path.join(BASE, 'px_beedoo.ini')
PERFIL = os.path.join(BASE, 'perfil_beedoo')
BAT = os.path.join(BASE, 'iniciar_agente.bat')
BEEDOO = os.environ.get('PX_BEEDOO_URL', 'https://paschoalotto.beedoo.io')
BEEDOO_SSO = os.environ.get('PX_BEEDOO_SSO', 'https://paschoalotto-sso.beedoo.io/')
CAIXA = '#message-bar > div.message-bar > textarea'
INTERVALO = 5            # segundos entre consultas à fila
PORTA_UNICA = 47391      # impede dois agentes abertos ao mesmo tempo
JA_ABERTO = 3            # código de saída: já existe um agente rodando (o .bat não reabre)
AUTOSTART = 'PX Beedoo'
VERSAO = '1.1'

handlers = [logging.FileHandler(os.path.join(BASE, 'px_beedoo_agente.log'), encoding='utf-8')]
if sys.stdout:
    handlers.append(logging.StreamHandler(sys.stdout))
logging.basicConfig(level=logging.INFO, format='%(asctime)s  %(message)s', datefmt='%d/%m %H:%M:%S', handlers=handlers)
log = logging.info


class LoginNecessario(Exception):
    pass


def ler_config():
    cfg = configparser.ConfigParser()
    if not os.path.exists(CONFIG):
        print('\nNão encontrei o px_beedoo.ini nesta pasta.')
        print('Na PX Monitorias, abra "Envios ao Beedoo" > "Conectar agente" e baixe o arquivo de configuração.\n')
        api = input('Ou cole aqui o endereço da API: ').strip()
        chave = input('E a chave do agente (pxb_...): ').strip()
        cfg['px'] = {'api': api, 'chave': chave, 'pasta_audios': '', 'navegador': 'msedge'}
        with open(CONFIG, 'w', encoding='utf-8') as f:
            cfg.write(f)
    cfg.read(CONFIG, encoding='utf-8')
    px = cfg['px']
    return {
        'api': px.get('api', '').rstrip('/'),
        'chave': px.get('chave', '').strip(),
        'pasta_audios': px.get('pasta_audios', '').strip(),
        'navegador': px.get('navegador', 'msedge').strip() or 'msedge',
        'nome': px.get('nome', os.environ.get('COMPUTERNAME', 'PX Beedoo')).strip(),
        # escondido (padrão): o Edge só aparece para o login; visivel: a janela fica aberta o tempo todo
        'janela': px.get('janela', 'escondido').strip().lower(),
    }


# ---------------------------------------------------------------- abrir sozinho com o Windows
def comando_autostart():
    return f'"{os.environ.get("ComSpec", "cmd.exe")}" /c start "PX Beedoo" /min "{BAT}"'


def registrar_autostart():
    """Grava em HKCU\\...\\Run (só do seu usuário, sem administrador) para o .bat abrir minimizado no login."""
    if os.name != 'nt' or not os.path.exists(BAT):
        return False
    try:
        import winreg
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r'Software\Microsoft\Windows\CurrentVersion\Run', 0, winreg.KEY_READ | winreg.KEY_SET_VALUE) as k:
            try:
                atual = winreg.QueryValueEx(k, AUTOSTART)[0]
            except FileNotFoundError:
                atual = None
            if atual != comando_autostart():
                winreg.SetValueEx(k, AUTOSTART, 0, winreg.REG_SZ, comando_autostart())
                log('Pronto: o agente vai abrir sozinho (minimizado) sempre que você entrar no Windows.')
        return True
    except Exception as e:
        log(f'Não consegui registrar a abertura automática pelo registro ({e}); tentando a pasta Inicializar.')
    try:  # plano B: um atalho .cmd na pasta Inicializar do usuário
        pasta = os.path.join(os.environ['APPDATA'], r'Microsoft\Windows\Start Menu\Programs\Startup')
        with open(os.path.join(pasta, 'PX Beedoo.cmd'), 'w', encoding='mbcs') as f:
            f.write(f'@echo off\r\nstart "PX Beedoo" /min "{BAT}"\r\n')
        log('Pronto: o agente vai abrir sozinho sempre que você entrar no Windows (pasta Inicializar).')
        return True
    except Exception as e:
        log(f'Não consegui fazer o agente abrir sozinho com o Windows: {e}')
        return False


def remover_autostart():
    if os.name != 'nt':
        return
    try:
        import winreg
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r'Software\Microsoft\Windows\CurrentVersion\Run', 0, winreg.KEY_SET_VALUE) as k:
            winreg.DeleteValue(k, AUTOSTART)
    except Exception:
        pass
    try:
        os.remove(os.path.join(os.environ['APPDATA'], r'Microsoft\Windows\Start Menu\Programs\Startup', 'PX Beedoo.cmd'))
    except Exception:
        pass
    print('O agente não abre mais sozinho com o Windows.')


# ---------------------------------------------------------------- plataforma
class Plataforma:
    def __init__(self, cfg):
        self.api, self.chave, self.nome = cfg['api'], cfg['chave'], cfg['nome']

    def chamar(self, metodo, caminho, corpo=None):
        dados = json.dumps(corpo).encode('utf-8') if corpo is not None else None
        req = urllib.request.Request(f'{self.api}{caminho}', data=dados, method=metodo, headers={
            'x-px-agent': self.chave, 'x-px-agent-name': self.nome, 'content-type': 'application/json',
            'user-agent': f'PX-Beedoo-Agente/{VERSAO}',
        })
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read().decode('utf-8') or '{}')
        except urllib.error.HTTPError as e:
            try:
                msg = json.loads(e.read().decode('utf-8')).get('error')
            except Exception:
                msg = None
            raise RuntimeError(msg or f'HTTP {e.code}')

    def ping(self):
        return self.chamar('POST', '/beedoo/agent/ping', {})

    def proxima(self):
        return self.chamar('GET', '/beedoo/agent/next').get('message')

    def resultado(self, mid, ok, erro=None, aviso=None):
        self.chamar('POST', '/beedoo/agent/result', {'id': mid, 'ok': ok, 'error': erro, 'warning': aviso})


class Audios:
    """Acha o áudio da ligação pelo nome na pasta configurada (ex.: a pasta do OneDrive sincronizada)."""
    def __init__(self, pasta):
        self.pasta, self.indice, self.lido = pasta, {}, 0

    def achar(self, nome):
        if not self.pasta or not os.path.isdir(self.pasta):
            return None
        if nome.lower() not in self.indice or time.time() - self.lido > 600:
            self.indice = {}
            for raiz, _, arquivos in os.walk(self.pasta):
                for a in arquivos:
                    self.indice.setdefault(a.lower(), os.path.join(raiz, a))
            self.lido = time.time()
        return self.indice.get(nome.lower())


# ---------------------------------------------------------------- navegador
def pediu_login(url):
    return 'sso' in url or 'login' in url or 'microsoftonline' in url


class Navegador:
    """Edge com o perfil salvo do Beedoo. Escondido no dia a dia; visível só quando precisa do seu login."""
    def __init__(self, pw, cfg):
        self.pw, self.cfg, self.ctx, self.page, self.visivel = pw, cfg, None, None, None

    def abrir(self, visivel):
        if self.ctx and self.visivel == visivel:
            return
        self.fechar()
        nav = self.cfg['navegador']
        opcoes = {'headless': not visivel, 'viewport': {'width': 1280, 'height': 860}}
        if os.path.isfile(nav):  # caminho do executável do navegador
            opcoes['executable_path'] = nav
        elif nav != 'chromium':
            opcoes['channel'] = nav  # msedge (padrão) ou chrome
        self.ctx = self.pw.chromium.launch_persistent_context(PERFIL, **opcoes)
        self.page = self.ctx.pages[0] if self.ctx.pages else self.ctx.new_page()
        self.visivel = visivel

    def fechar(self):
        try:
            if self.ctx:
                self.ctx.close()
        except Exception:
            pass
        self.ctx = self.page = self.visivel = None

    def preparar(self):
        """Garante a sessão do Beedoo. Se pedir login, tenta o SSO sozinho; se não der, mostra o Edge para você entrar."""
        escondido = self.cfg['janela'] != 'visivel' and os.environ.get('PX_HEADLESS') != '0'
        self.abrir(visivel=not escondido)
        if self._logado():
            return
        if escondido:  # o SSO da Microsoft costuma entrar sozinho com a conta do Windows
            self._clicar_sso()
            if self._esperar_login(25):
                return
            log('O Beedoo pede o seu login: abrindo o Edge. Entre com a sua conta Microsoft (os envios esperam).')
            self.abrir(visivel=True)
            if self._logado():
                self.abrir(visivel=False)
                return
        self._clicar_sso()
        if not self._esperar_login(600):
            raise RuntimeError('Login no Beedoo não concluído em 10 minutos.')
        log('Beedoo conectado.')
        if escondido:
            self.abrir(visivel=False)  # a sessão fica salva no perfil; volta a trabalhar escondido
            self._logado()

    def _logado(self):
        self.page.goto(f'{BEEDOO}/adm/user', wait_until='domcontentloaded')
        self.page.wait_for_timeout(3000)
        return not pediu_login(self.page.url)

    def _clicar_sso(self):
        try:
            if 'paschoalotto-sso' not in self.page.url and 'microsoftonline' not in self.page.url:
                self.page.goto(BEEDOO_SSO)
            botao = self.page.locator('button[name="provider"]')
            if botao.count():
                botao.first.click()
        except Exception:
            pass

    def _esperar_login(self, segundos):
        limite = time.time() + segundos
        while time.time() < limite:
            self.page.wait_for_timeout(2000)
            if self.page.url.startswith(BEEDOO) and not pediu_login(self.page.url):
                return True
        return False


def enviar(page, msg, audios):
    login = msg['login']
    page.goto(f'{BEEDOO}/message/{login}', wait_until='domcontentloaded')
    try:
        page.wait_for_selector(CAIXA, timeout=30000)
    except PwTimeout:
        if pediu_login(page.url):
            raise LoginNecessario()
        raise RuntimeError(f'Não abriu o chat do login "{login}" no Beedoo (confira o login do operador).')
    page.wait_for_timeout(1500)
    page.fill(CAIXA, msg['message'])
    page.press(CAIXA, 'Enter')
    page.wait_for_timeout(2500)
    aviso = None
    for anexo in msg.get('attachments') or []:
        caminho = audios.achar(anexo.get('file', ''))
        if not caminho:
            aviso = f'Mensagem enviada; o áudio {anexo.get("file")} não foi achado na pasta de áudios, anexe à mão se precisar.'
            log(aviso)
            continue
        page.click('#attachment-floating-button')
        page.click('#file-floating-button')
        page.locator('input[name="-file-inputchat"]').set_input_files(caminho)
        page.wait_for_timeout(4000)
        page.locator("text='Enviar'").click()
        page.wait_for_timeout(4000)
        log(f'  anexo enviado: {os.path.basename(caminho)}')
    return aviso


def main():
    if '--desinstalar' in sys.argv:
        remover_autostart()
        return 0
    trava = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        trava.bind(('127.0.0.1', PORTA_UNICA))
    except OSError:
        log('O agente PX Beedoo já está aberto neste computador.')
        return JA_ABERTO
    cfg = ler_config()
    px = Plataforma(cfg)
    try:
        quem = px.ping().get('user')
    except Exception as e:
        log(f'Não consegui falar com a plataforma: {e}')
        return 1
    registrar_autostart()
    log(f'PX Beedoo {VERSAO} conectado como {quem}. Pode minimizar esta janela: os envios saem sozinhos.')
    audios = Audios(cfg['pasta_audios'])
    with sync_playwright() as pw:
        nav = Navegador(pw, cfg)
        nav.preparar()
        ultimo_ping = 0
        while True:
            try:
                if time.time() - ultimo_ping > 30:
                    px.ping(); ultimo_ping = time.time()
                msg = px.proxima()
                if not msg:
                    time.sleep(INTERVALO)
                    continue
                log(f'Enviando para {msg.get("operator_name") or msg["login"]} ({msg["login"]})…')
                try:
                    try:
                        aviso = enviar(nav.page, msg, audios)
                    except LoginNecessario:
                        nav.preparar()  # a sessão do Beedoo expirou: entra de novo e tenta outra vez
                        aviso = enviar(nav.page, msg, audios)
                    except Exception as e:
                        if 'closed' not in str(e).lower():
                            raise
                        log('O Edge do agente fechou; abrindo de novo.')
                        nav.fechar(); nav.preparar()
                        aviso = enviar(nav.page, msg, audios)
                    px.resultado(msg['id'], True, aviso=aviso)
                    log('  enviado.')
                except Exception as e:
                    px.resultado(msg['id'], False, erro=str(e)[:400])
                    log(f'  erro: {e}')
                time.sleep(2)
            except KeyboardInterrupt:
                break
            except Exception as e:
                log(f'Falha ao consultar a fila: {e}. Tentando de novo em 30 s.')
                time.sleep(30)
        nav.fechar()
    return 0


if __name__ == '__main__':
    sys.exit(main())
