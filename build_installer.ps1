param(
    [string]$Version = "1.0.0",
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

function New-DeployBundle {
    param(
        [Parameter(Mandatory = $true)]
        [string]$InstallerPath,
        [Parameter(Mandatory = $true)]
        [string]$ReleaseNotePath,
        [Parameter(Mandatory = $true)]
        [string]$DistDir
    )

    if (-not (Test-Path $InstallerPath)) {
        throw "Installer not found for deploy bundle: $InstallerPath"
    }
    if (-not (Test-Path $ReleaseNotePath)) {
        throw "Release note not found for deploy bundle: $ReleaseNotePath"
    }

    $bundleFolderPath = Join-Path $DistDir "IT Request Form"
    $bundleZipPath = Join-Path $DistDir "IT Request Form.zip"
    $instructionsPath = Join-Path $bundleFolderPath "Update Instructions.txt"

    if (Test-Path $bundleFolderPath) {
        Remove-Item -Path $bundleFolderPath -Recurse -Force
    }
    if (Test-Path $bundleZipPath) {
        Remove-Item -Path $bundleZipPath -Force
    }

    New-Item -Path $bundleFolderPath -ItemType Directory -Force | Out-Null
    Copy-Item -Path $InstallerPath -Destination (Join-Path $bundleFolderPath (Split-Path $InstallerPath -Leaf)) -Force
    Copy-Item -Path $ReleaseNotePath -Destination (Join-Path $bundleFolderPath (Split-Path $ReleaseNotePath -Leaf)) -Force

    $instructions = @(
        "IT Request Form - Manual Update Instructions",
        "",
        "Files in this package:",
        "- IT_Request_Form_Installer.exe",
        "- release-note.txt",
        "",
        "Update steps:",
        "1) Close IT Request Form on the target machine.",
        "2) Run IT_Request_Form_Installer.exe as needed by your IT policy.",
        "3) Install to the same existing install location.",
        "4) Launch IT Request Form and validate expected version/behavior.",
        "",
        "Notes:",
        "- Uninstall is typically not required for normal updates.",
        "- User data/settings should remain in place.",
        "- If an update fails, uninstall then install again as a recovery option.",
        "",
        "Generated: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
    )
    Set-Content -Path $instructionsPath -Value $instructions -Encoding UTF8

    Compress-Archive -Path $bundleFolderPath -DestinationPath $bundleZipPath -Force
    Write-Host "Deploy bundle created: $bundleZipPath"
}

Write-Host "Building application EXE..."
$exeBuildArgs = @{}
if ($Sign) {
    $exeBuildArgs["Sign"] = $true
    if ($CertThumbprint) { $exeBuildArgs["CertThumbprint"] = $CertThumbprint }
    if ($CertSubject) { $exeBuildArgs["CertSubject"] = $CertSubject }
    if ($PfxPath) { $exeBuildArgs["PfxPath"] = $PfxPath }
    if ($PfxPasswordEnvVar) { $exeBuildArgs["PfxPasswordEnvVar"] = $PfxPasswordEnvVar }
    if ($TimestampUrl) { $exeBuildArgs["TimestampUrl"] = $TimestampUrl }
}

./build_exe.ps1 @exeBuildArgs

$exePath = Join-Path $PSScriptRoot "dist\IT Request Form.exe"
if (-not (Test-Path $exePath)) {
    throw "Application EXE not found at: $exePath"
}

$isccCandidates = @(
    (Get-Command iscc -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -ErrorAction SilentlyContinue),
    "C:\Program Files (x86)\Inno Setup 6\ISCC.exe",
    "C:\Program Files\Inno Setup 6\ISCC.exe",
    (Join-Path $env:LOCALAPPDATA "Programs\Inno Setup 6\ISCC.exe")
) | Where-Object { $_ }

$isccPath = $null
foreach ($candidate in $isccCandidates) {
    if (Test-Path $candidate) {
        $isccPath = $candidate
        break
    }
}

if (-not $isccPath) {
    throw "Inno Setup compiler (ISCC.exe) not found. Install Inno Setup 6 first: https://jrsoftware.org/isdl.php"
}

$issPath = Join-Path $PSScriptRoot "installer\IT Request Form.iss"
if (-not (Test-Path $issPath)) {
    throw "Installer script not found at: $issPath"
}

Write-Host "Building installer with Inno Setup..."
& $isccPath "/DMyAppVersion=$Version" $issPath

$installerPath = Join-Path $PSScriptRoot "dist\IT_Request_Form_Installer.exe"
if (Test-Path $installerPath) {
    if ($Sign) {
        Sign-File -FilePath $installerPath -CertThumbprint $CertThumbprint -CertSubject $CertSubject -PfxPath $PfxPath -PfxPasswordEnvVar $PfxPasswordEnvVar -TimestampUrl $TimestampUrl
    }

    $checksumsPath = Join-Path $PSScriptRoot "dist\checksums.txt"
    Write-Checksums -FilePaths @($exePath, $installerPath) -OutputPath $checksumsPath

    $releaseNotePath = Join-Path $PSScriptRoot "dist\release-note.txt"
    $releaseNoteScriptPath = Join-Path $PSScriptRoot "build_release_note.ps1"
    if (Test-Path $releaseNoteScriptPath) {
        & $releaseNoteScriptPath -Version $Version -ChecksumsPath $checksumsPath -OutputPath $releaseNotePath
    }

    $distDir = Join-Path $PSScriptRoot "dist"
    New-DeployBundle -InstallerPath $installerPath -ReleaseNotePath $releaseNotePath -DistDir $distDir

    Write-Host "Installer created: $installerPath"
} else {
    Write-Warning "Build completed, but installer output was not found at expected path: $installerPath"
}
