[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$projectRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$examplePath = Join-Path $projectRoot '.env.example'
$targetPath = Join-Path $projectRoot '.env'

if (Test-Path -LiteralPath $targetPath) {
  Write-Host '.env já existe; nenhum valor foi sobrescrito.'
  exit 0
}

function New-RandomHex([int]$byteCount = 32) {
  $bytes = New-Object byte[] $byteCount
  $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $generator.GetBytes($bytes)
  } finally {
    $generator.Dispose()
  }
  return ([System.BitConverter]::ToString($bytes)).Replace('-', '').ToLowerInvariant()
}

$postgresPassword = New-RandomHex
$minioPassword = New-RandomHex
$reviewerPassword = New-RandomHex
$analystPassword = New-RandomHex
$managerPassword = New-RandomHex
$content = [System.IO.File]::ReadAllText($examplePath)
$content = $content.Replace(
  'DATABASE_URL=postgresql://falcon_app:change-me@localhost:5432/falcon_admin',
  "DATABASE_URL=postgresql://falcon_app:$postgresPassword@localhost:5432/falcon_admin"
)
$content = $content.TrimEnd() + "`r`n`r`nPOSTGRES_PASSWORD=$postgresPassword`r`nMINIO_ROOT_USER=falcon-local`r`nMINIO_ROOT_PASSWORD=$minioPassword`r`n"
$content = $content.Replace('DEMO_REVIEWER_PASSWORD=', "DEMO_REVIEWER_PASSWORD=$reviewerPassword")
$content = $content.Replace('DEMO_ANALYST_PASSWORD=', "DEMO_ANALYST_PASSWORD=$analystPassword")
$content = $content.Replace('DEMO_MANAGER_PASSWORD=', "DEMO_MANAGER_PASSWORD=$managerPassword")
[System.IO.File]::WriteAllText($targetPath, $content, [System.Text.UTF8Encoding]::new($false))

Write-Host '.env local criado com credenciais aleatórias, inclusive as contas demonstrativas. Nenhum segredo foi exibido.'
