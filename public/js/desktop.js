import { html, icon, modal, $, toast } from './ui.js';

// Gera o instalador do atalho "PX Monitorias" para a área de trabalho do Windows.
// O .bat executa um PowerShell (codificado em base64) que baixa o ícone PX do servidor
// e cria um atalho que abre a plataforma em janela própria no Edge/Chrome.
function psScript(url) {
  return `$ErrorActionPreference = 'Stop'
$url = '${url.replace(/'/g, "''")}'
$dir = Join-Path $env:LOCALAPPDATA 'PXMonitorias'
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$ico = Join-Path $dir 'px.ico'
try { Invoke-WebRequest -UseBasicParsing "$url/icons/favicon.ico" -OutFile $ico } catch { Write-Host 'Nao foi possivel baixar o icone; usando o padrao do navegador.' }
$candidates = @("$env:ProgramFiles (x86)\\Microsoft\\Edge\\Application\\msedge.exe", "$env:ProgramFiles\\Microsoft\\Edge\\Application\\msedge.exe", "$env:ProgramFiles\\Google\\Chrome\\Application\\chrome.exe", "$env:ProgramFiles (x86)\\Google\\Chrome\\Application\\chrome.exe", "$env:LOCALAPPDATA\\Google\\Chrome\\Application\\chrome.exe")
$browser = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
$desk = [Environment]::GetFolderPath('Desktop')
$ws = New-Object -ComObject WScript.Shell
$lnk = $ws.CreateShortcut((Join-Path $desk 'PX Monitorias.lnk'))
if ($browser) { $lnk.TargetPath = $browser; $lnk.Arguments = "--app=$url/?atalho=1 --start-maximized" } else { $lnk.TargetPath = "$url/?atalho=1" }
if (Test-Path $ico) { $lnk.IconLocation = "$ico,0" }
$lnk.Description = 'PX Monitorias & Feedbacks'
$lnk.WorkingDirectory = $dir
$lnk.Save()
Write-Host ''
Write-Host 'Atalho "PX Monitorias" criado na area de trabalho!' -ForegroundColor Green
Start-Sleep -Seconds 3`;
}

function encodeUtf16Base64(str) {
  const bytes = new Uint8Array(str.length * 2);
  for (let i = 0; i < str.length; i++) { const c = str.charCodeAt(i); bytes[i * 2] = c & 255; bytes[i * 2 + 1] = c >> 8; }
  let bin = ''; bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin);
}

export function downloadWindowsShortcut(url = (location.origin + location.pathname).replace(/\/(index\.html)?$/, '')) {
  const bat = `@echo off\r\ntitle PX Monitorias - criando atalho\r\necho Criando o atalho PX Monitorias na area de trabalho...\r\npowershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${encodeUtf16Base64(psScript(url))}\r\n`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bat], { type: 'application/bat' }));
  a.download = 'Instalar atalho PX Monitorias.bat';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// Quem abre pelo atalho chega com ?atalho=1: a plataforma não oferece o atalho de novo
const KEY = 'px_shortcut';
const remember = (v) => { try { localStorage.setItem(KEY, v); } catch { /* sem storage */ } };
const seen = () => { try { return localStorage.getItem(KEY); } catch { return 'erro'; } };
export function markShortcutLaunch() {
  if (new URLSearchParams(location.search).has('atalho')) remember('instalado');
}
const isWindows = () => /Windows/i.test(navigator.userAgent);
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || new URLSearchParams(location.search).has('atalho');

// Janela com as duas formas de ter o ícone PX: atalho do Windows ou aplicativo do navegador
export function openShortcut(store) {
  const { close } = modal({
    title: 'Atalho na área de trabalho', cls: 'shortcut-modal',
    body: html`<div class="row" style="align-items:flex-start;gap:16px">
        <img src="icons/px-128.png" alt="Ícone PX" width="64" height="64" style="border-radius:16px;box-shadow:0 12px 30px -10px rgba(124,108,255,.7)">
        <div style="flex:1;min-width:0"><p style="margin:0 0 8px">Abra a PX Monitorias com um clique, em janela própria e com o ícone <b>PX</b>.</p>
          <ol class="small t2" style="margin:0;padding-left:18px">
            <li>Clique em <b>Baixar atalho</b>.</li>
            <li>Abra o arquivo <b>Instalar atalho PX Monitorias.bat</b> que foi baixado.</li>
            <li>O ícone <b>PX Monitorias</b> aparece na área de trabalho.</li>
          </ol>
          <p class="tiny muted" style="margin:10px 0 0">Se o Windows avisar sobre o arquivo, clique em “Mais informações” › “Executar assim mesmo”. Em Mac ou Linux, use “Como aplicativo”.</p></div></div>`,
    foot: html`<button class="btn ghost" data-close>Agora não</button><button class="btn" id="sc-pwa">${icon('plus')}Como aplicativo</button><button class="btn primary" id="sc-win">${icon('download')}Baixar atalho</button>`,
    onClose: () => { if (!seen()) remember('oferecido'); },
  });
  $('#sc-win').onclick = () => { downloadWindowsShortcut(); remember('baixado'); toast('Abra o arquivo baixado para criar o atalho.'); close(); };
  $('#sc-pwa').onclick = async () => {
    const pr = store?.installPrompt;
    if (pr) { pr.prompt(); const r = await pr.userChoice; if (r.outcome === 'accepted') { remember('instalado'); toast('Aplicativo instalado!'); close(); } store.installPrompt = null; }
    else toast('Use o menu do navegador › “Instalar PX Monitorias” (ou “Apps › Instalar este site”).', 'ok', 6000);
  };
}

// Convite único, no computador, para quem ainda não tem o atalho
export function offerShortcut(store) {
  if (seen() || isStandalone() || !isWindows() || matchMedia('(max-width: 900px)').matches) return;
  setTimeout(() => { if (!document.querySelector('.overlay')) openShortcut(store); }, 1500);
}
