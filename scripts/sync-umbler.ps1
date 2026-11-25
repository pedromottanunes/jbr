#requires -Version 5.1
param([ValidateRange(1,1000)][int]$MaxRequests=150,[ValidateRange(1,90)][int]$Days=7)
$ErrorActionPreference='Stop'

$taskConfigPath=Join-Path $PSScriptRoot '../.env'
if ((Test-Path -LiteralPath $taskConfigPath) -and (Get-Content -LiteralPath $taskConfigPath | Select-String -Pattern '^APP_MODE=mongo\s*$' -Quiet)) {
    Write-Host 'Coletor SQLite desativado no modo Atlas. Use npm run sync:google ou npm run sync:attendance.'
    exit 1
}

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
