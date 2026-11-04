import { html, icon, modal, $, toast } from './ui.js';

// Atalho "PX Monitorias" na área de trabalho, sem baixar nem executar nada (o proxy e as políticas da empresa
// barram .bat e PowerShell):
// 1. Aplicativo do navegador (Edge/Chrome): a própria janela de instalação do navegador cria o ícone PX na área de
//    trabalho e no menu Iniciar, e a plataforma abre em janela própria.
// 2. Sem essa opção (navegador antigo ou instalação bloqueada): um atalho de internet (.url) salvo direto na área de
//    trabalho pela janela "Salvar como" do navegador.

let deferred = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; });
window.addEventListener('appinstalled', () => { deferred = null; remember('instalado'); toast('Pronto! O ícone PX Monitorias está na área de trabalho e no menu Iniciar.', 'ok', 7000); });

const KEY = 'px_shortcut';
const remember = (v) => { try { localStorage.setItem(KEY, v); } catch { /* sem storage */ } };
const seen = () => { try { return localStorage.getItem(KEY); } catch { return 'erro'; } };
const appUrl = () => (location.origin + location.pathname).replace(/index\.html$/, '').replace(/\/?$/, '/');
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: window-controls-overlay)').matches || new URLSearchParams(location.search).has('atalho');
const isEdge = () => /Edg\//.test(navigator.userAgent);
export const canInstallApp = () => !!deferred;

// Quem abre pelo atalho chega com ?atalho=1 (ou na janela do aplicativo): a plataforma não oferece o atalho de novo
export function markShortcutLaunch() {
  if (isStandalone()) remember('instalado');
}

// Instala como aplicativo pela janela do próprio navegador
export async function installApp() {
  if (!deferred) return false;
  const pr = deferred; deferred = null;
  pr.prompt();
  const r = await pr.userChoice.catch(() => ({ outcome: 'dismissed' }));
  if (r.outcome === 'accepted') remember('instalado');
  return r.outcome === 'accepted';
}

// Atalho de internet (.url): abre a plataforma no navegador padrão, com o ícone PX
function urlShortcut() {
  const u = appUrl();
  return `[InternetShortcut]\r\nURL=${u}?atalho=1\r\nIconFile=${u}icons/favicon.ico\r\nIconIndex=0\r\n`;
}
export async function saveUrlShortcut() {
  const blob = new Blob([urlShortcut()], { type: 'application/internet-shortcut' });
  // Edge e Chrome: "Salvar como" já aberto na área de trabalho
  if (window.showSaveFilePicker) {
    try {
      const h = await window.showSaveFilePicker({ suggestedName: 'PX Monitorias.url', startIn: 'desktop', types: [{ description: 'Atalho da internet', accept: { 'application/internet-shortcut': ['.url'] } }] });
      const w = await h.createWritable(); await w.write(blob); await w.close();
      remember('instalado');
      toast('Atalho PX Monitorias salvo na área de trabalho.', 'ok', 6000);
      return true;
    } catch (e) {
      if (e?.name === 'AbortError') return false;
      // Extensão bloqueada pelo navegador ou página sem permissão: segue para o download comum
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'PX Monitorias.url'; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  remember('baixado');
  toast('Atalho baixado: arraste o arquivo "PX Monitorias" da pasta Downloads para a área de trabalho.', 'ok', 8000);
  return true;
}

// Janela do atalho: instala como aplicativo quando o navegador permite; senão, passo a passo e o atalho .url
export function openShortcut() {
  if (matchMedia('(display-mode: standalone)').matches) { toast('Você já está usando o aplicativo PX Monitorias.'); return; }
  const app = canInstallApp();
  const steps = app
    ? html`<ol class="small t2" style="margin:0;padding-left:18px">
        <li>Clique em <b>Instalar na área de trabalho</b>.</li>
        <li>Na janela do navegador, clique em <b>Instalar</b>.</li>
        <li>${isEdge() ? html`Na tela seguinte, marque <b>Criar atalho na área de trabalho</b> e clique em <b>Permitir</b>.` : 'O ícone PX Monitorias aparece na área de trabalho e no menu Iniciar.'}</li>
      </ol>`
    : html`<ol class="small t2" style="margin:0;padding-left:18px">
        <li>No canto de cima do navegador, clique em <b>⋯</b> (Edge) ou <b>⋮</b> (Chrome).</li>
        <li>${isEdge() ? html`Vá em <b>Aplicativos</b> › <b>Instalar este site como aplicativo</b>.` : html`Vá em <b>Transmitir, salvar e compartilhar</b> › <b>Instalar página como app</b>.`}</li>
        <li>Clique em <b>Instalar</b>${isEdge() ? html` e marque <b>Criar atalho na área de trabalho</b>` : ''}.</li>
      </ol>
      <p class="tiny muted" style="margin:10px 0 0">Se essa opção não aparecer, use <b>Salvar atalho</b>: o navegador abre a janela “Salvar como” já na área de trabalho.</p>`;
  const { close } = modal({
    title: 'Atalho na área de trabalho', cls: 'shortcut-modal',
    body: html`<div class="row" style="align-items:flex-start;gap:16px">
        <img src="icons/px-128.png" alt="Ícone PX" width="64" height="64" style="border-radius:16px;box-shadow:0 12px 30px -10px color-mix(in srgb, var(--brand) 70%, transparent)">
        <div style="flex:1;min-width:0"><p style="margin:0 0 8px">Abra a PX Monitorias com um clique, em janela própria e com o ícone <b>PX</b>. Nada é baixado nem executado no computador.</p>${steps}</div></div>`,
    foot: html`<button class="btn ghost" data-close>Agora não</button>
      <button class="btn ${app ? '' : 'primary'}" id="sc-url">${icon('download')}Salvar atalho</button>
      ${app ? html`<button class="btn primary" id="sc-app">${icon('plus')}Instalar na área de trabalho</button>` : ''}`,
    onClose: () => { if (!seen()) remember('oferecido'); },
  });
  $('#sc-url').onclick = async () => { if (await saveUrlShortcut()) close(); };
  const b = $('#sc-app');
  if (b) b.onclick = async () => { if (await installApp()) close(); else toast('Instalação cancelada. Você pode tentar de novo pelo ícone de atalho no topo.'); };
}

// Convite único, no computador, logo depois do login, para quem ainda não tem o atalho
export function offerShortcut() {
  if (seen() || isStandalone() || matchMedia('(max-width: 900px)').matches) return;
  setTimeout(() => { if (!document.querySelector('.overlay')) openShortcut(); }, 1500);
}
