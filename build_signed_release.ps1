param(
    [string]$Version = "1.0.0",
    [string]$PfxPath = ".\dist\signing\ITRequestForm-InternalCodeSign.pfx",
    [string]$PasswordEnvVarName = "SIGN_PFX_PASSWORD",
    [switch]$PromptForPassword,
    [switch]$PersistPassword
)

$ErrorActionPreference = "Stop"

function Get-PlainTextFromSecureString {
    param(
        [Parameter(Mandatory = $true)]
        [Security.SecureString]$SecureString
    )

    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureString)
    try {
        return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    }
    finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    }
}

if (-not (Test-Path $PfxPath)) {
    throw "PFX file not found at: $PfxPath"
}

$currentPassword = [Environment]::GetEnvironmentVariable($PasswordEnvVarName, "Process")
if (-not $currentPassword) {
    $currentPassword = [Environment]::GetEnvironmentVariable($PasswordEnvVarName, "User")
    if ($currentPassword) {
        [Environment]::SetEnvironmentVariable($PasswordEnvVarName, $currentPassword, "Process")
    }
}

if ($PromptForPassword -or -not $currentPassword) {
    $securePassword = Read-Host "Enter PFX password" -AsSecureString
    $plainPassword = Get-PlainTextFromSecureString -SecureString $securePassword
    if (-not $plainPassword) {
        throw "No password entered."
    }

    [Environment]::SetEnvironmentVariable($PasswordEnvVarName, $plainPassword, "Process")
    if ($PersistPassword) {
        [Environment]::SetEnvironmentVariable($PasswordEnvVarName, $plainPassword, "User")
        Write-Host "Saved password in user environment variable '$PasswordEnvVarName'."
    }
}

Write-Host "Starting signed release build..."
& "$PSScriptRoot\build_installer.ps1" -Version $Version -Sign -PfxPath $PfxPath -PfxPasswordEnvVar $PasswordEnvVarName
if ($LASTEXITCODE -ne 0) {
    throw "Signed build failed with exit code $LASTEXITCODE"
}

$exePath = Join-Path $PSScriptRoot "dist\IT Request Form.exe"
$installerPath = Join-Path $PSScriptRoot "dist\IT_Request_Form_Installer.exe"

$exeSig = Get-AuthenticodeSignature -FilePath $exePath
$installerSig = Get-AuthenticodeSignature -FilePath $installerPath

if ($exeSig.Status -ne "Valid") {
    throw "EXE signature is not valid: $($exeSig.Status)"
}
if ($installerSig.Status -ne "Valid") {
    throw "Installer signature is not valid: $($installerSig.Status)"
}

Write-Host "Signed release build complete."
Write-Host "EXE: $exePath"
Write-Host "Installer: $installerPath"
Write-Host "Bundle: $(Join-Path $PSScriptRoot 'dist\IT Request Form.zip')"
Write-Host "Signer: $($installerSig.SignerCertificate.Subject)"
Write-Host "Thumbprint: $($installerSig.SignerCertificate.Thumbprint)"
