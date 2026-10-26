[CmdletBinding()]
param(
  [switch]$Apply,
  [int]$MinimumFreeGB = 35,
  [int]$WslMemoryGB = 3,
  [int]$WslDiskMaxGB = 30,
  [string]$DockerDataRoot = ''
)

$ErrorActionPreference = 'Stop'
$systemDrive = [System.IO.DriveInfo]::new($env:SystemDrive)
Add-Type -AssemblyName Microsoft.VisualBasic
$computer = [Microsoft.VisualBasic.Devices.ComputerInfo]::new()
$freeGB = [math]::Round($systemDrive.AvailableFreeSpace / 1GB, 1)
$ramGB = [math]::Round($computer.TotalPhysicalMemory / 1GB, 1)
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

Write-Host "RAM: $ramGB GB | Livre em $($env:SystemDrive) $freeGB GB | Modo: $(if($Apply){'APLICAR'}else{'SIMULAÇÃO'})"

if ($ramGB -lt 7.5) { throw 'Docker Desktop requer pelo menos 8 GB de RAM.' }
if ($freeGB -lt $MinimumFreeGB) { throw "Instalação interrompida: libere ao menos $MinimumFreeGB GB no C:. Há somente $freeGB GB." }
if (-not $Apply) {
  Write-Host 'Pré-requisitos básicos aprovados. Nenhuma alteração realizada; execute novamente com -Apply. O script solicitará o UAC automaticamente.'
  exit 0
}
if (-not $isAdmin) {
  $elevatedArguments = "-NoExit -NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" -Apply -MinimumFreeGB $MinimumFreeGB -WslMemoryGB $WslMemoryGB -WslDiskMaxGB $WslDiskMaxGB"
  if ($DockerDataRoot) {
    $safeDataRoot = $DockerDataRoot.Replace('"', '')
    $elevatedArguments += " -DockerDataRoot `"$safeDataRoot`""
  }
  Write-Host 'Solicitando privilégios de Administrador. Confirme a janela do Controle de Conta de Usuário (UAC).'
  Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList $elevatedArguments
  exit 0
}

$wslInstalled = $false
try {
  $wslProbe = Start-Process -FilePath 'wsl.exe' -ArgumentList @('--version') -Wait -PassThru -WindowStyle Hidden
  $wslInstalled = ($wslProbe.ExitCode -eq 0)
} catch {
  $wslInstalled = $false
}
if (-not $wslInstalled) {
  Write-Host 'Instalando somente a plataforma WSL, sem uma distribuição Ubuntu adicional...'
  $wslInstall = Start-Process -FilePath 'wsl.exe' -ArgumentList @('--install','--no-distribution') -Wait -PassThru -NoNewWindow
  if ($wslInstall.ExitCode -notin @(0, 1641, 3010)) { throw "A instalação do WSL falhou com o código $($wslInstall.ExitCode)." }
  Write-Host 'Reinicie o Windows e execute este mesmo script novamente com -Apply.'
  exit 3010
}

$wslUpdate = Start-Process -FilePath 'wsl.exe' -ArgumentList @('--update','--web-download') -Wait -PassThru -NoNewWindow
if ($wslUpdate.ExitCode -ne 0) { throw "Não foi possível atualizar o WSL (código $($wslUpdate.ExitCode))." }
$wslDefault = Start-Process -FilePath 'wsl.exe' -ArgumentList @('--set-default-version','2') -Wait -PassThru -NoNewWindow
if ($wslDefault.ExitCode -ne 0) { throw "Não foi possível definir o WSL 2 como padrão (código $($wslDefault.ExitCode))." }

$wslConfigPath = Join-Path $env:USERPROFILE '.wslconfig'
$wslConfig = @"
[wsl2]
memory=${WslMemoryGB}GB
processors=2
swap=1GB
defaultVhdSize=${WslDiskMaxGB}GB

[experimental]
autoMemoryReclaim=gradual
sparseVhd=true
"@
Set-Content -LiteralPath $wslConfigPath -Value $wslConfig -Encoding ascii
& wsl.exe --shutdown

$installer = Join-Path $env:TEMP 'DockerDesktopInstaller.exe'
$downloadUrl = 'https://desktop.docker.com/win/main/amd64/Docker%20Desktop%20Installer.exe'
Write-Host 'Baixando o instalador oficial do Docker Desktop...'
Invoke-WebRequest -Uri $downloadUrl -OutFile $installer -UseBasicParsing
$signature = Get-AuthenticodeSignature -LiteralPath $installer
if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'Docker') {
  throw "Assinatura digital inválida ou inesperada: $($signature.Status) / $($signature.SignerCertificate.Subject)"
}

$arguments = @('install','--user','--backend=wsl-2','--no-windows-containers')
if ($DockerDataRoot) {
  $resolvedParent = Split-Path -Parent $DockerDataRoot
  if (-not (Test-Path -LiteralPath $resolvedParent)) { throw "A unidade/pasta pai de DockerDataRoot não existe: $resolvedParent" }
  $arguments += "--wsl-default-data-root=$DockerDataRoot"
}
Write-Host 'Executando instalação por usuário com backend WSL 2...'
$process = Start-Process -FilePath $installer -ArgumentList $arguments -Wait -PassThru
if ($process.ExitCode -ne 0) { throw "O instalador do Docker terminou com código $($process.ExitCode)." }
Remove-Item -LiteralPath $installer -Force

Write-Host 'Instalação concluída. Abra o Docker Desktop, aceite os termos aplicáveis e mantenha Linux containers + Resource Saver habilitados.'
Write-Host 'Em Settings > Docker Engine, configure: { "log-driver": "local", "log-opts": { "max-size": "10m", "max-file": "3" } }'
