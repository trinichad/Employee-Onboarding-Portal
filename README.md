# IT Request Form

Desktop app for IT onboarding/offboarding request intake.

## Documentation

- User guide: `docs/IT_Request_Form_User_Guide.md`

## Features

- Form for New Hire, Termination, Promotion, Rehire
- Calendar picker for `Effective Date` (date click selection)
- Required sections and checkboxes from your request
- Professional two-column layout (Property Network/Mailbox on right)
- Mouse-wheel scrolling support
- Save each request to your configured requests folder as:
  - `Name - RequestType - EffectiveDate.json`
  - `Name - RequestType - EffectiveDate.txt`
- Load previous employee form data by employee name (helpful for Termination access review)
- Edit current form setup (form name, request types, field labels/descriptions, group titles/items)
- Enable/disable access groups from the form (for example Property Network Access and Property Mailbox Access)
- Access groups include System / Web Access, Email Groups, Shared Mailbox, SharePoint Sites, Google Drives, Property Network Access, and Property Mailbox Access
- Access group controls are fully admin-editable in Form Setup (Enabled on form, group title, and item list)
- Add/remove custom fields from the UI (`Customize Extra Fields`)
- Field descriptions shown in an info panel and hover tooltip

## Run locally

```powershell
python app.py
```

## Build EXE (Windows)

```powershell
.\build_exe.ps1
```

The executable will be generated at `dist/IT Request Form.exe`.
SHA256 checksums will be written to `dist/checksums.txt`.
Release note output will be written to `dist/release-note.txt`.

Optional EXE version for release note:

```powershell
.\build_exe.ps1 -Version 1.0.1
```

### Optional: Sign EXE during build

You can sign the EXE with either a certificate in the Windows certificate store or a PFX file.

Certificate store example (by subject):

```powershell
.\build_exe.ps1 -Sign -CertSubject "Your Company Name"
```

PFX example:

```powershell
$env:SIGN_PFX_PASSWORD = "<your-pfx-password>"
.\build_exe.ps1 -Sign -PfxPath "C:\certs\codesign.pfx"
```

## Build Installer (Windows)

1. Install Inno Setup 6: https://jrsoftware.org/isdl.php
2. Build installer:

```powershell
.\build_installer.ps1
```

Optional version override:

```powershell
.\build_installer.ps1 -Version 1.0.1
```

Build and sign both EXE + installer in one command:

```powershell
.\build_installer.ps1 -Version 1.0.1 -Sign -CertSubject "Your Company Name"
```

Or with PFX:

```powershell
$env:SIGN_PFX_PASSWORD = "<your-pfx-password>"
.\build_installer.ps1 -Sign -PfxPath "C:\certs\codesign.pfx"
```

If `signtool.exe` is missing, install Windows SDK Signing Tools.

## Repeatable signed build (recommended)

Use the helper script to keep signing/build steps consistent for every release:

```powershell
.\build_signed_release.ps1
```

Optional version override:

```powershell
.\build_signed_release.ps1 -Version 1.0.1
```

If `SIGN_PFX_PASSWORD` is not set, the script prompts for it securely.
To save it once for future runs, use:

```powershell
.\build_signed_release.ps1 -PromptForPassword -PersistPassword
```

Default PFX path used by the script:

```text
dist\signing\ITRequestForm-InternalCodeSign.pfx
```

Installer output:

- `dist/IT_Request_Form_Installer.exe`
- `dist/checksums.txt` (contains SHA256 for EXE and installer)
- `dist/release-note.txt` (version, build date, and hashes for IT/security)
- `dist/IT Request Form.zip` (deploy bundle containing `IT Request Form/IT_Request_Form_Installer.exe`, `IT Request Form/release-note.txt`, and `IT Request Form/Update Instructions.txt`)
