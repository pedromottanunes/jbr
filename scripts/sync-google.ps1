#requires -Version 5.1
param([string]$Start,[string]$End)
$ErrorActionPreference='Stop'
$mutex=New-Object System.Threading.Mutex($false,'Local\CRMJBR-GoogleAdsSync')
$locked=$false
$secure=$null
try {
  try { $locked=$mutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $locked=$true }
  if (-not $locked) { Write-Host 'Já existe uma sincronização Google em andamento.'; exit 1 }
  $tokenFile=Join-Path $PSScriptRoot '../local-data/google-refresh-token.dpapi'
  $secure=[System.IO.File]::ReadAllText($tokenFile) | ConvertTo-SecureString
  $env:JBR_GOOGLE_REFRESH_TOKEN=[System.Net.NetworkCredential]::new('', $secure).Password
  $ErrorActionPreference='Continue'
  $syncArgs=@()
  if ($Start -and $End) { $syncArgs=@('--start',$Start,'--end',$End) }
  & node (Join-Path $PSScriptRoot '../node_modules/tsx/dist/cli.mjs') (Join-Path $PSScriptRoot 'sync-google.ts') @syncArgs
  exit $LASTEXITCODE
} catch { Write-Host ('Falha ao iniciar coleta: ' + $_.FullyQualifiedErrorId + ' em ' + $_.ScriptStackTrace); exit 1 }
finally {
  Remove-Item Env:JBR_GOOGLE_REFRESH_TOKEN -ErrorAction SilentlyContinue
  if ($secure) { $secure.Dispose() }
  if ($locked) { $mutex.ReleaseMutex() }
  $mutex.Dispose()
}
