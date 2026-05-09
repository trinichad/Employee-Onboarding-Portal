param(
    [string]$Version = "unknown",
    [string]$ChecksumsPath = ".\dist\checksums.txt",
    [string]$OutputPath = ".\dist\release-note.txt"
)

if (-not (Test-Path $ChecksumsPath)) {
    throw "Checksums file not found: $ChecksumsPath"
}

$checksums = Get-Content -Path $ChecksumsPath | Where-Object { $_ -and $_.Trim() }
if (@($checksums).Count -eq 0) {
    throw "Checksums file is empty: $ChecksumsPath"
}

$buildDateUtc = (Get-Date).ToUniversalTime().ToString("yyyy-MM-dd HH:mm:ss 'UTC'")
$hostName = $env:COMPUTERNAME

$lines = @(
    "IT Request Form - Security Release Note",
    "",
    "Version: $Version",
    "Build Date (UTC): $buildDateUtc",
    "Build Host: $hostName",
    "",
    "SHA256 Artifacts"
)

foreach ($line in $checksums) {
    if ($line -match '^(?<hash>[a-fA-F0-9]{64})\s+\*(?<file>.+)$') {
        $lines += "- $($Matches.file): $($Matches.hash.ToLowerInvariant())"
    } else {
        $lines += "- $line"
    }
}

Set-Content -Path $OutputPath -Value $lines -Encoding utf8
Write-Host "Release note written: $OutputPath"
