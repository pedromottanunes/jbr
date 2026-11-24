#requires -Version 5.1
param([ValidateRange(1,1000)][int]$MaxRequests=150,[ValidateRange(1,90)][int]$Days=7)
$ErrorActionPreference='Stop'
$secure=$null
$resultCode=1
try {
    if (-not $env:UTALK_API_TOKEN) {
        $tokenFile=Join-Path $env:LOCALAPPDATA 'UmblerTalkReader\api_token.dpapi'
        $secure=[System.IO.File]::ReadAllText($tokenFile) | ConvertTo-SecureString
        $env:UTALK_API_TOKEN=[System.Net.NetworkCredential]::new('', $secure).Password
    }
    & python -u (Join-Path $PSScriptRoot 'umbler/sync.py') --sync --max-requests $MaxRequests --days $Days
    $resultCode=$LASTEXITCODE
} catch { Write-Host 'Não foi possível iniciar a coleta com a credencial protegida.' }
finally {
    Remove-Item Env:UTALK_API_TOKEN -ErrorAction SilentlyContinue
    if ($null -ne $secure) { $secure.Dispose() }
}
exit $resultCode
