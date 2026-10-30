# Cria o atalho "PX Monitorias" (ícone PX) que abre a plataforma em janela própria no Edge/Chrome.
#
# Para uma pessoa (sem administrador):
#   powershell -ExecutionPolicy Bypass -File criar-atalho-windows.ps1 -Url https://px.EMPRESA.com.br
#
# Para todos os usuários do computador (T.I., como administrador; serve para GPO de inicialização ou Intune):
#   powershell -ExecutionPolicy Bypass -File criar-atalho-windows.ps1 -Url https://px.EMPRESA.com.br -TodosUsuarios
#   Cria o atalho na Área de Trabalho Pública e no Menu Iniciar de todos.
param([string]$Url, [switch]$TodosUsuarios)
if (-not $Url) { $Url = Read-Host 'Endereco da plataforma (ex.: https://px.suaempresa.com.br)' }
$Url = $Url.TrimEnd('/')

if ($TodosUsuarios) {
  $dir = Join-Path $env:ProgramData 'PXMonitorias'
  $desk = [Environment]::GetFolderPath('CommonDesktopDirectory')
  $menu = Join-Path ([Environment]::GetFolderPath('CommonPrograms')) 'PX Monitorias.lnk'
} else {
  $dir = Join-Path $env:LOCALAPPDATA 'PXMonitorias'
  $desk = [Environment]::GetFolderPath('Desktop')
  $menu = Join-Path ([Environment]::GetFolderPath('Programs')) 'PX Monitorias.lnk'
}
New-Item -ItemType Directory -Force -Path $dir | Out-Null

# Ícone: o que vem junto deste script; sem ele, o do próprio servidor
$ico = Join-Path $dir 'px.ico'
$local = Join-Path $PSScriptRoot 'px.ico'
if (Test-Path $local) { Copy-Item -Force $local $ico }
else { try { Invoke-WebRequest -UseBasicParsing "$Url/icons/favicon.ico" -OutFile $ico } catch { Write-Host 'Icone nao encontrado; usando o do navegador.' } }

$candidates = @(
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
)
$browser = $candidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1

$ws = New-Object -ComObject WScript.Shell
foreach ($path in @((Join-Path $desk 'PX Monitorias.lnk'), $menu)) {
  $lnk = $ws.CreateShortcut($path)
  # ?atalho=1: a plataforma sabe que foi aberta pelo atalho e não oferece criá-lo de novo
  if ($browser) { $lnk.TargetPath = $browser; $lnk.Arguments = "--app=$Url/?atalho=1 --start-maximized" } else { $lnk.TargetPath = "$Url/?atalho=1" }
  if (Test-Path $ico) { $lnk.IconLocation = "$ico,0" }
  $lnk.Description = 'PX Monitorias & Feedbacks'
  $lnk.WorkingDirectory = $dir
  $lnk.Save()
}
Write-Host 'Atalho "PX Monitorias" criado na area de trabalho e no Menu Iniciar!' -ForegroundColor Green
