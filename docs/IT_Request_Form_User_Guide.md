# IT Request Form — User Guide

This guide covers daily use and admin customization for the IT Request Form desktop app.

## 1) What this app does

Use this app to create and save IT onboarding/offboarding request records.

Each save creates:
- A JSON file (structured data)
- A TXT file (human-readable summary)

Files are saved to your configured request folder.

---

## 2) Main screen overview

- **Request Information**: core employee/request fields (Effective Date, Name, Department, etc.)
- **Access sections**: checkboxes for System / Web Access, Email Groups, Shared Mailbox, SharePoint Sites, Google Drives, Property Network Access, Property Mailbox Access, and any added property sections
- **Custom fields section**: optional extra fields you define
- **Info & Actions panel**: quick actions like Load Previous, Settings, folder shortcuts

Top buttons:
- **Save Request**
- **Clear Form**
- **Show/Hide Info & Actions**

---

## 3) How to create and save a request

1. Select **Request Type**.
2. Fill out request fields.
3. Check required access items.
4. Click **Save Request**.

### Save output naming

Saved files are named like:

`Name - RequestType - EffectiveDate.json`

`Name - RequestType - EffectiveDate.txt`

If the name already exists, the app adds ` (1)`, ` (2)`, etc.

### Effective Date format

Use `MM-DD-YYYY` (for example `02-25-2026`).

---

## 4) Clear the form

Click **Clear Form** to reset entries for a new request.

Notes:
- Request type resets to the first configured request type.
- Checkboxes reset to each item’s default checked/unchecked setting.
- Custom fields and termination fields are cleared.

---

## 5) Load previous user info

Use this when you want to pull prior data for the same employee.

1. Enter the employee in the **Name** field.
2. Click **Load previous employee form data** (Info & Actions panel).

Behavior:
- The app searches saved JSON files (newest first).
- Matching is case-insensitive on name.
- For **Termination** requests, it prefers prior New Hire/Rehire/Promotion records when available.

If no name field exists in your schema, add one in **Edit Form Setup**.

---

## 6) Use the Info & Actions panel

Open/close with **Show/Hide Info & Actions**.

Actions available:
- **Load previous employee form data**
- **Settings**
- **Open saved forms folder** (request save folder)
- **Open App Data Folder**
- **Add Property Access Sections**

The form layout automatically reflows when this panel is opened or closed.

---

## 7) Add additional property access sections

Use **Add Property Access Sections** to add extra property-specific Network/Mailbox groups in the form.

1. Click **Add Property Access Sections**.
2. Enter a property name.
3. New access groups appear for that property.

These added sections are saved with the request and restored when loading that request.

---

## 8) Customize extra fields (Custom Fields)

Go to **Settings → Customize Extra Fields**.

You can:
- Set the custom section label
- Add a custom field
- Edit/remove a custom field

Field types:
- `text`
- `checkbox`

After saving, the main form updates immediately.

---

## 9) Settings (storage, save folder, behaviors)

Open **Settings** from Info & Actions.

### Storage Root Folder

Controls where app config/data live:
- Config: `<Storage Root>\config`
- Requests data base: `<Storage Root>\data\requests`

Use **Test Access** to verify read/write access.

### Request Save Folder

Set the current request output folder.

### Auto-open saved text file

When enabled, the saved `.txt` opens automatically after each save.

---

## 10) Data tools: backup and restore

In **Settings**, use:

- **Backup Data**: creates a ZIP containing config and saved requests.
- **Restore Data**: restores config and requests from a backup ZIP.

Restore replaces config files and repopulates the app schema/custom fields.

---

## 11) Edit Form Setup (admin)

Go to **Settings → Edit Form Setup**.

Tabs:

### General
- Form Name
- Request Types (one per line)

### Main Fields
- Add/Edit/Remove fields
- Define:
  - Label
  - Key (`id`)
  - Type (`text` or `date`)
  - Description

### Access Groups
- Enable/disable each group on the form using **Enabled on form**
- Rename group titles
- Edit item labels
- Add `{default}` to an item to make it checked by default after clear/reset

Default groups include:
- `system_web`
- `email_groups`
- `shared_mailbox`
- `sharepoint_sites`
- `google_drives`
- `property_network`
- `property_mailbox`

The new `shared_mailbox`, `sharepoint_sites`, and `google_drives` groups support the same controls as the others: **Enabled on form**, editable **Group Title**, and editable item list.

When a group is disabled, it is hidden from the main form. If both property groups are disabled, the **Add Property Access Sections** action is also disabled.

### AutoFill
- Manage known values lists (Address, Property, Department, Sub-Department, Title)
- Manage Property↔Address link pairs using `Property | Address`

Important:
- Keep a name-like field (`name` recommended) so **Load previous employee form data** works.

---

## 12) Autofill behavior during normal use

For smart fields (Address/Property/Department/Sub-Department/Title), when you enter a new value and save, the app can ask to store it for future autofill.

It can also prompt to save a property-address link for future automatic matching.

---

## 13) Files and locations

Typical important files/folders:

- App settings: `config/settings.json`
- Form schema: `config/form_schema.json`
- Custom fields: `config/custom_fields.json`
- Saved requests: your configured request save folder (JSON/TXT files)

---

## 14) Manual updates on deployed machines

Recommended process:

1. Close IT Request Form.
2. Run the latest `IT_Request_Form_Installer.exe`.
3. Install to the same location.

Usually no uninstall is required for normal upgrades.

---

## 15) Troubleshooting quick checks

- **Cannot save**: verify save folder permissions in Settings.
- **Date error**: use `MM-DD-YYYY`.
- **Load Previous not working**: confirm name entered and a name field exists in schema.
- **Missing expected fields**: check Form Setup and Custom Fields config.
- **Path issues**: use Settings → Test Access and folder open buttons.

---

## 16) Tips for IT/Admin teams

- Use backup before major schema changes.
- Keep request types and field keys stable to preserve reporting consistency.
- Include `release-note.txt` with deployment packages for audit/change tracking.
