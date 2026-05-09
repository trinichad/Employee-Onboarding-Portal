param(
    [string]$AppName = "IT Request Form",
    [string]$Version = "unknown",
    [switch]$Sign,
    [string]$CertThumbprint,
    [string]$CertSubject,
    [string]$PfxPath,
    [string]$PfxPasswordEnvVar = "SIGN_PFX_PASSWORD",
    [string]$TimestampUrl = "http://timestamp.digicert.com"
)

function Get-SignToolPath {
    $candidates = @(
        (Get-Command signtool -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -ErrorAction SilentlyContinue),
        "C:\Program Files (x86)\Windows Kits\10\bin\x64\signtool.exe",
        "C:\Program Files (x86)\Windows Kits\10\bin\10.0.22621.0\x64\signtool.exe",
        "C:\Program Files (x86)\Windows Kits\10\bin\10.0.22000.0\x64\signtool.exe"
    ) | Where-Object { $_ }

    foreach ($candidate in $candidates) {
        if (Test-Path $candidate) {
            return $candidate
        }
    }

    return $null
}

function Sign-File {
    param(
        [Parameter(Mandatory = $true)]
        [string]$FilePath,
        [string]$CertThumbprint,
        [string]$CertSubject,
        [string]$PfxPath,
        [string]$PfxPasswordEnvVar,
        [string]$TimestampUrl
    )

    $signtoolPath = Get-SignToolPath
    if ($signtoolPath) {
        $signArgs = @("sign", "/fd", "SHA256", "/td", "SHA256", "/tr", $TimestampUrl)

        if ($PfxPath) {
            if (-not (Test-Path $PfxPath)) {
                throw "PFX file not found: $PfxPath"
            }

            $pfxPassword = [Environment]::GetEnvironmentVariable($PfxPasswordEnvVar)
            if (-not $pfxPassword) {
                throw "Environment variable '$PfxPasswordEnvVar' is not set. Set it to your PFX password."
            }

            $signArgs += @("/f", $PfxPath, "/p", $pfxPassword)
        } elseif ($CertThumbprint) {
            $signArgs += @("/sha1", $CertThumbprint)
        } elseif ($CertSubject) {
            $signArgs += @("/n", $CertSubject)
        } else {
            throw "Signing requested but no certificate selector provided. Use -CertThumbprint, -CertSubject, or -PfxPath."
        }

        $signArgs += $FilePath

        Write-Host "Signing with signtool: $FilePath"
        & $signtoolPath @signArgs
        if ($LASTEXITCODE -ne 0) {
            throw "signtool failed with exit code $LASTEXITCODE"
        }

        & $signtoolPath verify /pa $FilePath
        if ($LASTEXITCODE -ne 0) {
            throw "signtool verify failed with exit code $LASTEXITCODE"
        }
        return
    }

    Write-Host "signtool.exe not found; falling back to Set-AuthenticodeSignature."

    $certForSigning = $null
    $tempImportedThumbprint = $null
    try {
        if ($PfxPath) {
            if (-not (Test-Path $PfxPath)) {
                throw "PFX file not found: $PfxPath"
            }
            $pfxPassword = [Environment]::GetEnvironmentVariable($PfxPasswordEnvVar)
            if (-not $pfxPassword) {
                throw "Environment variable '$PfxPasswordEnvVar' is not set. Set it to your PFX password."
            }

            $securePassword = ConvertTo-SecureString $pfxPassword -AsPlainText -Force
            $imported = Import-PfxCertificate -FilePath $PfxPath -CertStoreLocation "Cert:\CurrentUser\My" -Password $securePassword -Exportable
            if (-not $imported) {
                throw "Failed to import PFX certificate for signing."
            }
            $certForSigning = $imported
            $tempImportedThumbprint = $imported.Thumbprint
        } elseif ($CertThumbprint) {
            $thumb = $CertThumbprint.Replace(" ", "")
            $certForSigning = Get-Item "Cert:\CurrentUser\My\$thumb" -ErrorAction SilentlyContinue
            if (-not $certForSigning) {
                $certForSigning = Get-Item "Cert:\LocalMachine\My\$thumb" -ErrorAction SilentlyContinue
            }
        } elseif ($CertSubject) {
            $certForSigning = @(Get-ChildItem "Cert:\CurrentUser\My" | Where-Object { $_.Subject -like "*$CertSubject*" } | Select-Object -First 1)
            if (-not $certForSigning) {
                $certForSigning = @(Get-ChildItem "Cert:\LocalMachine\My" | Where-Object { $_.Subject -like "*$CertSubject*" } | Select-Object -First 1)
            }
        } else {
            throw "Signing requested but no certificate selector provided. Use -CertThumbprint, -CertSubject, or -PfxPath."
        }

        if (-not $certForSigning) {
            throw "No signing certificate found for the specified selector."
        }
        if (-not $certForSigning.HasPrivateKey) {
            throw "Selected certificate does not include a private key required for signing."
        }

        $signatureArgs = @{
            FilePath    = $FilePath
            Certificate = $certForSigning
            HashAlgorithm = "SHA256"
        }
        if ($TimestampUrl) {
            $signatureArgs["TimestampServer"] = $TimestampUrl
        }

        Write-Host "Signing with Set-AuthenticodeSignature: $FilePath"
        $signResult = Set-AuthenticodeSignature @signatureArgs
        if (-not $signResult -or $signResult.Status -ne "Valid") {
            throw "Set-AuthenticodeSignature failed with status: $($signResult.Status) $($signResult.StatusMessage)"
        }

        $verifyResult = Get-AuthenticodeSignature -FilePath $FilePath
        if ($verifyResult.Status -ne "Valid") {
            throw "Signature verification failed: $($verifyResult.Status) $($verifyResult.StatusMessage)"
        }
    }
    finally {
        if ($tempImportedThumbprint) {
            Remove-Item "Cert:\CurrentUser\My\$tempImportedThumbprint" -Force -ErrorAction SilentlyContinue
        }
    }
}

function Write-Checksums {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$FilePaths,
        [Parameter(Mandatory = $true)]
        [string]$OutputPath
    )

    $lines = foreach ($path in $FilePaths) {
        if (Test-Path $path) {
            $hash = Get-FileHash -Path $path -Algorithm SHA256
            "{0} *{1}" -f $hash.Hash.ToLowerInvariant(), (Split-Path $path -Leaf)
        }
    }

    if (@($lines).Count -gt 0) {
        Set-Content -Path $OutputPath -Value $lines -Encoding ascii
        Write-Host "Checksums written: $OutputPath"
    }
}

python -m pip install -r requirements.txt

$args = @(
    "--noconfirm",
    "--onefile",
    "--windowed",
    "--name", $AppName,
    "--icon", "dtm.ico",
    "--add-data", "config;config",
    "--add-data", "dtm.ico;.",
    "app.py"
)

pyinstaller @args

$exePath = Join-Path $PSScriptRoot "dist\$AppName.exe"

if ($Sign) {
    if (-not (Test-Path $exePath)) {
        throw "Application EXE not found at: $exePath"
    }

    Sign-File -FilePath $exePath -CertThumbprint $CertThumbprint -CertSubject $CertSubject -PfxPath $PfxPath -PfxPasswordEnvVar $PfxPasswordEnvVar -TimestampUrl $TimestampUrl
}

$checksumsPath = Join-Path $PSScriptRoot "dist\checksums.txt"
Write-Checksums -FilePaths @($exePath) -OutputPath $checksumsPath

$releaseNoteScriptPath = Join-Path $PSScriptRoot "build_release_note.ps1"
if (Test-Path $releaseNoteScriptPath) {
    & $releaseNoteScriptPath -Version $Version -ChecksumsPath $checksumsPath -OutputPath (Join-Path $PSScriptRoot "dist\release-note.txt")
}

Write-Host "Build complete. EXE created in $exePath"
