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

Primeira vez:
  pip install playwright truststore
  python px_beedoo_agente.py
  -> coloque o arquivo px_beedoo.ini (baixado na plataforma) na mesma pasta deste arquivo;
  -> o Edge abre o Beedoo: entre com a sua conta Microsoft uma vez. A sessão fica salva na pasta
     "perfil_beedoo" (nenhuma senha é guardada pelo agente).
"""
import configparser
import json
import logging
import os
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
BEEDOO = os.environ.get('PX_BEEDOO_URL', 'https://paschoalotto.beedoo.io')
BEEDOO_SSO = 'https://paschoalotto-sso.beedoo.io/'
CAIXA = '#message-bar > div.message-bar > textarea'
INTERVALO = 5          # segundos entre consultas à fila
VERSAO = '1.0'

logging.basicConfig(
    level=logging.INFO, format='%(asctime)s  %(message)s', datefmt='%d/%m %H:%M:%S',
    handlers=[logging.FileHandler(os.path.join(BASE, 'px_beedoo_agente.log'), encoding='utf-8'), logging.StreamHandler(sys.stdout)],
)
log = logging.info


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
    }


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


def garantir_login(page):
    """Abre o Beedoo; se cair no login, entra pelo SSO Microsoft e espera a pessoa concluir (uma vez)."""
    page.goto(f'{BEEDOO}/adm/user', wait_until='domcontentloaded')
    page.wait_for_timeout(3000)
    if 'sso' in page.url or 'login' in page.url or 'microsoftonline' in page.url:
        log('Beedoo pediu login. Entre com a sua conta Microsoft na janela do Edge (só na primeira vez).')
        try:
            if 'paschoalotto-sso' not in page.url and 'microsoftonline' not in page.url:
                page.goto(BEEDOO_SSO)
            botao = page.locator('button[name="provider"]')
            if botao.count():
                botao.first.click()
        except Exception:
            pass
        limite = time.time() + 600
        while time.time() < limite:
            page.wait_for_timeout(2000)
            if page.url.startswith(BEEDOO) and 'sso' not in page.url:
                break
        else:
            raise RuntimeError('Login no Beedoo não concluído em 10 minutos.')
        page.goto(f'{BEEDOO}/adm/user', wait_until='domcontentloaded')
    log('Beedoo conectado.')


def enviar(page, msg, audios):
    login = msg['login']
    page.goto(f'{BEEDOO}/message/{login}', wait_until='domcontentloaded')
    try:
        page.wait_for_selector(CAIXA, timeout=30000)
    except PwTimeout:
        if 'sso' in page.url or 'login' in page.url:
            garantir_login(page)
            page.goto(f'{BEEDOO}/message/{login}', wait_until='domcontentloaded')
            page.wait_for_selector(CAIXA, timeout=30000)
        else:
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
    cfg = ler_config()
    px = Plataforma(cfg)
    try:
        quem = px.ping().get('user')
    except Exception as e:
        log(f'Não consegui falar com a plataforma: {e}')
        input('Enter para sair')
        return
    log(f'PX Beedoo {VERSAO} conectado à plataforma como {quem}. Deixe esta janela aberta para os envios saírem.')
    audios = Audios(cfg['pasta_audios'])
    with sync_playwright() as p:
        nav = cfg['navegador']
        opcoes = {'headless': os.environ.get('PX_HEADLESS') == '1', 'viewport': {'width': 1280, 'height': 860}}
        if os.path.isfile(nav):  # caminho do executável do navegador
            opcoes['executable_path'] = nav
        elif nav != 'chromium':
            opcoes['channel'] = nav  # msedge (padrão) ou chrome
        ctx = p.chromium.launch_persistent_context(PERFIL, **opcoes)
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        garantir_login(page)
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
                    aviso = enviar(page, msg, audios)
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
        ctx.close()


if __name__ == '__main__':
    main()
