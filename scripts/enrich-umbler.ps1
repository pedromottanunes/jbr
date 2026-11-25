#requires -Version 5.1
param([ValidateRange(1,1000)][int]$MaxRequests=150,[ValidateRange(1,366)][int]$Days=90)
$ErrorActionPreference='Stop'

$taskConfigPath=Join-Path $PSScriptRoot '../.env'
if ((Test-Path -LiteralPath $taskConfigPath) -and (Get-Content -LiteralPath $taskConfigPath | Select-String -Pattern '^APP_MODE=mongo\s*$' -Quiet)) {
    Write-Host 'Coletor SQLite desativado no modo Atlas. Use npm run sync:google ou npm run sync:attendance.'
    exit 1
}

$taskSecret=$null
try {
    if (-not $env:UTALK_API_TOKEN) {
        $taskSecret=[System.IO.File]::ReadAllText((Join-Path $env:LOCALAPPDATA 'UmblerTalkReader\api_token.dpapi')) | ConvertTo-SecureString
        $env:UTALK_API_TOKEN=[System.Net.NetworkCredential]::new('', $taskSecret).Password
    }
    & python -u (Join-Path $PSScriptRoot 'umbler/enrich.py') --max-requests $MaxRequests --days $Days
    $taskExit=$LASTEXITCODE
} catch { $taskExit=1; Write-Host 'Não foi possível iniciar a coleta de atendimento.' }
finally {
    Remove-Item Env:UTALK_API_TOKEN -ErrorAction SilentlyContinue
    if ($null -ne $taskSecret) { $taskSecret.Dispose() }
}
exit $taskExit
