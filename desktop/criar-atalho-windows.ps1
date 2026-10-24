# Cria o atalho "PX Monitorias" (ícone PX) na área de trabalho do Windows.
# Uso:  powershell -ExecutionPolicy Bypass -File criar-atalho-windows.ps1 -Url https://seu-servidor
param([string]$Url)
if (-not $Url) { $Url = Read-Host 'Endereco da plataforma (ex.: https://px-monitorias.suaempresa.com.br)' }
$Url = $Url.TrimEnd('/')
$dir = Join-Path $env:LOCALAPPDATA 'PXMonitorias'
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$ico = Join-Path $dir 'px.ico'
Copy-Item -Force (Join-Path $PSScriptRoot 'px.ico') $ico
$candidates = @(
  "$env:ProgramFiles (x86)\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "$env:ProgramFiles (x86)\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
)
$browser = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
$desk = [Environment]::GetFolderPath('Desktop')
$ws = New-Object -ComObject WScript.Shell
$lnk = $ws.CreateShortcut((Join-Path $desk 'PX Monitorias.lnk'))
if ($browser) { $lnk.TargetPath = $browser; $lnk.Arguments = "--app=$Url --start-maximized" } else { $lnk.TargetPath = $Url }
$lnk.IconLocation = "$ico,0"
$lnk.Description = 'PX Monitorias & Feedbacks'
$lnk.WorkingDirectory = $dir
$lnk.Save()
Write-Host 'Atalho "PX Monitorias" criado na area de trabalho!' -ForegroundColor Green
