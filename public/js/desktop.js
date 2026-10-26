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
if ($browser) { $lnk.TargetPath = $browser; $lnk.Arguments = "--app=$url --start-maximized" } else { $lnk.TargetPath = $url }
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

export function downloadWindowsShortcut(url = location.href.split('#')[0].replace(/\/(index\.html)?$/, '')) {
  const bat = `@echo off\r\ntitle PX Monitorias - criando atalho\r\necho Criando o atalho PX Monitorias na area de trabalho...\r\npowershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${encodeUtf16Base64(psScript(url))}\r\n`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bat], { type: 'application/bat' }));
  a.download = 'Instalar atalho PX Monitorias.bat';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
