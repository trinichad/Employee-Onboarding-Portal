import json
import os
import re
import shutil
import sys
import urllib.parse
import zipfile
from copy import deepcopy
from datetime import datetime
from pathlib import Path
import tkinter as tk
from tkinter import filedialog, messagebox, simpledialog, ttk

try:
    import ttkbootstrap as tb
except Exception:
    tb = None

try:
    from tkcalendar import DateEntry as TkCalendarDateEntry
except Exception:
    TkCalendarDateEntry = None


APP_HOME_DIR_NAME = "ITRequestForm"

def is_directory_writable(path: Path) -> bool:
    try:
        path.mkdir(parents=True, exist_ok=True)
        probe = path / ".write_test"
        probe.write_text("ok", encoding="utf-8")
        probe.unlink(missing_ok=True)
        return True
    except Exception:
        return False


def resolve_app_home_dir() -> Path:
    if not getattr(sys, "frozen", False):
        return Path(__file__).parent

    appdata_dir = Path(os.environ.get("APPDATA", str(Path.home()))) / APP_HOME_DIR_NAME
    exe_dir = Path(sys.executable).resolve().parent
    install_data_dir = exe_dir / "AppData"

    if is_directory_writable(install_data_dir):
        return install_data_dir

    return appdata_dir


APP_HOME_DIR = resolve_app_home_dir()

BOOTSTRAP_CONFIG_DIR = APP_HOME_DIR / "config"
BOOTSTRAP_SETTINGS_FILE = BOOTSTRAP_CONFIG_DIR / "bootstrap_settings.json"


def load_bootstrap_settings() -> dict:
    try:
        payload = json.loads(BOOTSTRAP_SETTINGS_FILE.read_text(encoding="utf-8"))
        if isinstance(payload, dict):
            return payload
    except Exception:
        pass
    return {}


def save_bootstrap_settings(storage_root_dir: Path) -> None:
    BOOTSTRAP_CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    payload = {
        "storage_root_dir": str(storage_root_dir),
    }
    BOOTSTRAP_SETTINGS_FILE.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def resolve_storage_root_dir() -> Path:
    data = load_bootstrap_settings()
    raw = str(data.get("storage_root_dir", "")).strip()
    if raw:
        return Path(raw)
    return APP_HOME_DIR


def set_storage_paths(storage_root_dir: Path) -> None:
    global STORAGE_ROOT_DIR
    global DATA_DIR
    global CONFIG_DIR
    global CUSTOM_FIELDS_FILE
    global FORM_SCHEMA_FILE
    global SETTINGS_FILE

    STORAGE_ROOT_DIR = storage_root_dir
    DATA_DIR = STORAGE_ROOT_DIR / "data" / "requests"
    CONFIG_DIR = STORAGE_ROOT_DIR / "config"
    CUSTOM_FIELDS_FILE = CONFIG_DIR / "custom_fields.json"
    FORM_SCHEMA_FILE = CONFIG_DIR / "form_schema.json"
    SETTINGS_FILE = CONFIG_DIR / "settings.json"


set_storage_paths(resolve_storage_root_dir())

if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
    RUNTIME_ASSET_DIR = Path(sys._MEIPASS)
else:
    RUNTIME_ASSET_DIR = Path(__file__).parent

DEFAULT_CUSTOM_SECTION_LABEL = "Custom Fields"
APP_DISPLAY_NAME = "IT Request Form"


def default_outlook_email_settings() -> dict:
    return {
        "outlook_to": "",
        "outlook_subject": "",
        "outlook_subject_shared_mailbox": "{request_type}: {address}",
        "outlook_subject_distribution_group": "{request_type}: {address}",
        "outlook_body_template": "{request_form}",
    }


def default_app_settings() -> dict:
    payload = {
        "requests_dir": str(DATA_DIR),
        "auto_open_text_on_save": True,
        "storage_root_dir": str(STORAGE_ROOT_DIR),
    }
    payload.update(default_outlook_email_settings())
    return payload


def default_schema() -> dict:
    return {
        "form_name": APP_DISPLAY_NAME,
        "request_types": [
            "New Hire",
            "Termination",
            "Promotion",
            "Rehire",
            SHARED_MAILBOX_REQUEST_TYPE,
            DISTRIBUTION_GROUP_REQUEST_TYPE,
        ],
        "fields": [
            {"id": "effective_date", "label": "Effective Date", "description": "Date the change becomes active (MM-DD-YYYY).", "type": "date"},
            {"id": "name", "label": "Name", "description": "Employee full legal name.", "type": "text"},
            {"id": "cell_phone", "label": "Cell Phone", "description": "Employee mobile number.", "type": "text"},
            {"id": "address", "label": "Address", "description": "Employee home address.", "type": "text"},
            {"id": "property", "label": "Property", "description": "Property/site assignment.", "type": "text"},
            {"id": "department", "label": "Department", "description": "Business unit or department.", "type": "text"},
            {"id": "sub_department", "label": "Sub-Department", "description": "Team or sub-group inside department.", "type": "text"},
            {"id": "title", "label": "Title", "description": "Job title.", "type": "text"},
            {"id": "manager", "label": "Manager", "description": "Direct manager name.", "type": "text"},
        ],
        "groups": [
            {
                "id": "system_web",
                "title": "System / Web Access",
                "enabled": True,
                "items": [
                    {"id": "yardi_voyager", "label": "Yardi Voyager", "description": "Enable or disable access for Yardi Voyager."},
                    {"id": "adobe_pro", "label": "Adobe Pro", "description": "Enable or disable access for Adobe Pro."},
                    {"id": "vpn_access", "label": "VPN Access", "description": "Enable or disable VPN access."},
                ],
            },
            {
                "id": "email_groups",
                "title": "Email Groups",
                "enabled": True,
                "items": [
                    {
                        "id": "everyone",
                        "label": "everyone@yourdomain.com",
                        "description": "Add/remove this email group.",
                        "default_enabled": True,
                    },
                ],
            },
            {
                "id": "shared_mailbox",
                "title": "Shared Mailbox",
                "enabled": True,
                "items": [
                    {
                        "id": "shared_mailbox_access",
                        "label": "Shared Mailbox Access",
                        "description": "Enable or disable shared mailbox access.",
                    },
                ],
            },
            {
                "id": "sharepoint_sites",
                "title": "SharePoint Sites",
                "enabled": True,
                "items": [
                    {
                        "id": "sharepoint_site_access",
                        "label": "SharePoint Site Access",
                        "description": "Enable or disable SharePoint site access.",
                    },
                ],
            },
            {
                "id": "google_drives",
                "title": "Google Drives",
                "enabled": True,
                "items": [
                    {
                        "id": "google_drive_access",
                        "label": "Google Drive Access",
                        "description": "Enable or disable Google Drive access.",
                    },
                ],
            },
            {
                "id": "printer_access",
                "title": "Printer Access",
                "enabled": True,
                "items": [
                    {
                        "id": "printer_access",
                        "label": "Printer Access",
                        "description": "Enable or disable printer access.",
                    },
                ],
            },
            {
                "id": "property_network",
                "title": "Property Network Access",
                "enabled": True,
                "items": [
                    {"id": "property_security", "label": "Property Security Group", "description": "Enable or disable this security group."},
                    {"id": "property_om_security", "label": "Property OM Security Group", "description": "Enable or disable this security group."},
                    {"id": "property_directors_security", "label": "Property Directors Security Group", "description": "Enable or disable this security group."},
                    {"id": "floating_security", "label": "Floating Security Group", "description": "Enable or disable this security group."},
                ],
            },
            {
                "id": "property_mailbox",
                "title": "Property Mailbox Access",
                "enabled": True,
                "items": [
                    {"id": "general_email", "label": "General Email", "description": "Enable or disable this mailbox."},
                    {"id": "maintenance_email", "label": "Maintenance Email", "description": "Enable or disable this mailbox."},
                    {"id": "concierge_email", "label": "Concierge Email", "description": "Enable or disable this mailbox."},
                ],
            },
        ],
        "known_values": {
            "address": [],
            "property": [],
            "department": [],
            "sub_department": [],
            "title": [],
        },
        "property_address_links": [],
    }


def default_known_values() -> dict:
    return {
        "address": [],
        "property": [],
        "department": [],
        "sub_department": [],
        "title": [],
    }


def normalized_unique(values: list[str]) -> list[str]:
    unique = []
    seen = set()
    for value in values:
        clean = (value or "").strip()
        if not clean:
            continue
        key = clean.lower()
        if key in seen:
            continue
        seen.add(key)
        unique.append(clean)
    return unique


def ensure_dirs() -> None:
    BOOTSTRAP_CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    if not BOOTSTRAP_SETTINGS_FILE.exists():
        save_bootstrap_settings(STORAGE_ROOT_DIR)

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)

    seeded_custom_fields = None
    seeded_schema = None
    if getattr(sys, "frozen", False):
        seed_config_dir = RUNTIME_ASSET_DIR / "config"
        custom_fields_seed = seed_config_dir / "custom_fields.json"
        form_schema_seed = seed_config_dir / "form_schema.json"
        if custom_fields_seed.exists():
            try:
                seeded_custom_fields = custom_fields_seed.read_text(encoding="utf-8")
            except Exception:
                seeded_custom_fields = None
        if form_schema_seed.exists():
            try:
                seeded_schema = form_schema_seed.read_text(encoding="utf-8")
            except Exception:
                seeded_schema = None

    if not CUSTOM_FIELDS_FILE.exists():
        if seeded_custom_fields:
            CUSTOM_FIELDS_FILE.write_text(seeded_custom_fields, encoding="utf-8")
        else:
            CUSTOM_FIELDS_FILE.write_text(
                json.dumps({"section_label": DEFAULT_CUSTOM_SECTION_LABEL, "fields": []}, indent=2),
                encoding="utf-8",
            )
    if not FORM_SCHEMA_FILE.exists():
        if seeded_schema:
            FORM_SCHEMA_FILE.write_text(seeded_schema, encoding="utf-8")
        else:
            FORM_SCHEMA_FILE.write_text(json.dumps(default_schema(), indent=2), encoding="utf-8")
    if not SETTINGS_FILE.exists():
        SETTINGS_FILE.write_text(json.dumps(default_app_settings(), indent=2), encoding="utf-8")


def safe_filename(value: str) -> str:
    value = value.strip()
    value = re.sub(r"[\\/:*?\"<>|]", "-", value)
    return re.sub(r"\s+", " ", value)


def now_iso() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def slugify(text: str) -> str:
    clean = re.sub(r"\W+", "_", text.lower()).strip("_")
    return clean or "item"


SHARED_MAILBOX_REQUEST_TYPE = "New Shared Mailbox"
DISTRIBUTION_GROUP_REQUEST_TYPE = "New Distribution Group"
SPECIAL_REQUEST_TYPES = {SHARED_MAILBOX_REQUEST_TYPE, DISTRIBUTION_GROUP_REQUEST_TYPE}
EMAIL_PATTERN = re.compile(r"^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$")


def is_valid_email(value: str) -> bool:
    return bool(EMAIL_PATTERN.fullmatch((value or "").strip()))

def normalize_effective_date(value: str) -> str:
    raw = (value or "").strip()
    if not raw:
        return ""

    for fmt in ("%m-%d-%Y", "%Y-%m-%d", "%m/%d/%Y", "%Y/%m/%d"):
        try:
            return datetime.strptime(raw, fmt).strftime("%m-%d-%Y")
        except ValueError:
            continue
    return ""


def asset_path(filename: str) -> Path:
    return RUNTIME_ASSET_DIR / filename


class FieldTooltip:
    def __init__(self, widget: tk.Widget, text: str):
        self.widget = widget
        self.text = text
        self.tip_window = None
        widget.bind("<Enter>", self.show)
        widget.bind("<Leave>", self.hide)

    def show(self, _event=None):
        if self.tip_window or not self.text:
            return
        x = self.widget.winfo_rootx() + 20
        y = self.widget.winfo_rooty() + 20
        self.tip_window = tw = tk.Toplevel(self.widget)
        tw.wm_overrideredirect(True)
        tw.wm_geometry(f"+{x}+{y}")
        label = tk.Label(
            tw,
            text=self.text,
            justify="left",
            background="#ffffe0",
            relief="solid",
            borderwidth=1,
            font=("Segoe UI", 9),
            padx=6,
            pady=3,
        )
        label.pack()

    def hide(self, _event=None):
        if self.tip_window:
            self.tip_window.destroy()
            self.tip_window = None


class CustomFieldsDialog(tk.Toplevel):
    def __init__(self, parent: "ITRequestApp", custom_fields: list[dict], section_label: str):
        super().__init__(parent)
        self.title("Customize Fields")
        self.geometry("700x460")
        self.minsize(620, 420)
        self.configure(bg="#f4f7fb")
        self.transient(parent)
        self.grab_set()
        self.parent = parent
        self.custom_fields = deepcopy(custom_fields)
        self.section_label_var = tk.StringVar(value=section_label or DEFAULT_CUSTOM_SECTION_LABEL)
        self.result = None

        self.columnconfigure(0, weight=1)
        self.rowconfigure(1, weight=1)

        header = ttk.Frame(self, style="Card.TFrame", padding=(14, 12))
        header.grid(row=0, column=0, sticky="ew", padx=12, pady=(12, 8))
        header.columnconfigure(1, weight=1)
        ttk.Label(header, text="Section Label:").grid(row=0, column=0, sticky="w")
        ttk.Entry(header, textvariable=self.section_label_var).grid(row=0, column=1, sticky="ew", padx=(8, 0))

        self.listbox = tk.Listbox(
            self,
            exportselection=False,
            relief="flat",
            borderwidth=0,
            highlightthickness=1,
            highlightbackground="#e2e8f0",
            highlightcolor="#93c5fd",
            background="#ffffff",
            selectbackground="#dbeafe",
            selectforeground="#0f172a",
            font=("Segoe UI", 10),
        )
        self.listbox.grid(row=1, column=0, sticky="nsew", padx=12, pady=(0, 8))

        control = ttk.Frame(self, style="Card.TFrame", padding=(14, 12))
        control.grid(row=2, column=0, sticky="ew", padx=12, pady=(0, 12))

        ttk.Button(control, text="Add Field", command=self.add_field, style="Action.TButton").pack(side="left", padx=(0, 8))
        ttk.Button(control, text="Edit Selected", command=self.edit_selected, style="Action.TButton").pack(side="left", padx=(0, 8))
        ttk.Button(control, text="Remove Selected", command=self.remove_selected, style="Action.TButton").pack(side="left", padx=(0, 8))
        ttk.Button(control, text="Save", command=self.save, style="Primary.Header.TButton").pack(side="right")
        ttk.Button(control, text="Cancel", command=self.destroy, style="Secondary.Header.TButton").pack(side="right", padx=(0, 8))

        self.refresh_listbox()

    def refresh_listbox(self):
        self.listbox.delete(0, tk.END)
        for field in self.custom_fields:
            label = field.get("label", "Unnamed")
            field_type = field.get("type", "text")
            self.listbox.insert(tk.END, f"{label} ({field_type})")

    def add_field(self):
        self.open_field_editor()

    def edit_selected(self):
        index = self.listbox.curselection()
        if not index:
            messagebox.showinfo("Select Field", "Select a field to edit.", parent=self)
            return
        self.open_field_editor(index[0])

    def open_field_editor(self, edit_index: int | None = None):
        window = tk.Toplevel(self)
        is_edit = edit_index is not None
        window.title("Edit Custom Field" if is_edit else "Add Custom Field")
        window.geometry("420x240")
        window.configure(bg="#f4f7fb")
        window.transient(self)
        window.grab_set()
        window.columnconfigure(0, weight=1)

        content = ttk.Frame(window, style="Card.TFrame", padding=(14, 12))
        content.grid(row=0, column=0, sticky="nsew", padx=10, pady=10)
        content.columnconfigure(0, weight=1)

        ttk.Label(content, text="Field Label").grid(row=0, column=0, sticky="w", pady=(2, 4))
        existing = self.custom_fields[edit_index] if is_edit else {}

        label_var = tk.StringVar(value=existing.get("label", ""))
        ttk.Entry(content, textvariable=label_var, width=40).grid(row=1, column=0, sticky="ew")

        ttk.Label(content, text="Field Type").grid(row=2, column=0, sticky="w", pady=(10, 4))
        type_var = tk.StringVar(value=existing.get("type", "text"))
        ttk.Combobox(content, textvariable=type_var, values=["text", "checkbox"], state="readonly").grid(
            row=3, column=0, sticky="ew"
        )

        ttk.Label(content, text="Description").grid(row=4, column=0, sticky="w", pady=(10, 4))
        desc_var = tk.StringVar(value=existing.get("description", ""))
        ttk.Entry(content, textvariable=desc_var, width=40).grid(row=5, column=0, sticky="ew")

        def add_and_close():
            label = label_var.get().strip()
            if not label:
                messagebox.showerror("Missing Label", "Field label is required.", parent=window)
                return
            payload = {
                "id": existing.get("id") or re.sub(r"\W+", "_", label.lower()).strip("_"),
                "label": label,
                "type": type_var.get(),
                "description": desc_var.get().strip(),
            }
            if is_edit:
                self.custom_fields[edit_index] = payload
            else:
                self.custom_fields.append(payload)
            self.refresh_listbox()
            window.destroy()

        ttk.Button(content, text="Save" if is_edit else "Add", command=add_and_close, style="Primary.Header.TButton").grid(
            row=6, column=0, sticky="e", pady=(12, 2)
        )

    def remove_selected(self):
        index = self.listbox.curselection()
        if not index:
            return
        self.custom_fields.pop(index[0])
        self.refresh_listbox()

    def save(self):
        section_label = self.section_label_var.get().strip() or DEFAULT_CUSTOM_SECTION_LABEL
        self.result = {
            "section_label": section_label,
            "fields": self.custom_fields,
        }
        self.destroy()


class ITRequestApp(tb.Window if tb else tk.Tk):
    def __init__(self):
        if tb:
            super().__init__(themename="flatly")
        else:
            super().__init__()
        self.title("IT Request Form")
        self.geometry("1280x820")
        self.minsize(1120, 720)
        try:
            self.tk.call("tk", "scaling", 1.2)
        except Exception:
            pass
        self.apply_window_icon()

        ensure_dirs()

        self.settings = self.load_settings()
        self.requests_dir = self.resolve_requests_dir(self.settings.get("requests_dir", ""))
        self.requests_dir.mkdir(parents=True, exist_ok=True)

        self.schema = self.load_schema()
        self.custom_section_label, self.custom_fields = self.load_custom_fields()
        self.known_values = default_known_values()
        self.property_to_address = {}
        self.address_to_property = {}
        self.tooltips = []
        self.text_vars = {}
        self.smart_field_vars = {}
        self.smart_field_widgets = {}
        self.checkbox_vars = {}
        self.custom_vars = {}
        self.termination_vars = {
            "forward_email_to": tk.StringVar(),
            "grant_full_access_to": tk.StringVar(),
        }
        self.shared_mailbox_vars = {
            "display_name": tk.StringVar(),
            "email_address": tk.StringVar(),
        }
        self.distribution_group_vars = {
            "display_name": tk.StringVar(),
            "email_address": tk.StringVar(),
        }
        self.shared_mailbox_members = []
        self.distribution_group_members = []
        self.special_members_frame = None
        self.special_members_type = ""
        self.special_add_member_button = None
        self.termination_section = None

        self.info_text = tk.StringVar(value="Select a field to see its description.")
        default_request = self.schema.get("request_types", ["New Hire"])
        self.request_type = tk.StringVar(value=(default_request[0] if default_request else "New Hire"))

        self.field_meta = {}
        self.group_meta = {}
        self.info_panel_visible = True
        self.info_panel_toggle_text = tk.StringVar(value="Hide Info & Actions")
        self.body_left_frame = None
        self.body_right_frame = None
        self.responsive_mode = None
        self.form_container_window = None
        self._suppress_link_autofill = False
        self.additional_property_access_sections = []
        self.primary_property_network_frame = None
        self.primary_property_mailbox_frame = None
        self.property_field_var = None
        self._last_created_checkbox_group_frame = None
        self.add_property_sections_button = None
        self._app_icon_img = None
        self.info_label = None
        self.card_bg_color = "#ffffff"
        self.field_label_color = "#64748b"

        self.refresh_known_value_cache()

        self.build_ui()

    def apply_window_icon(self):
        icon_file = asset_path("dtm.ico")
        if icon_file.exists():
            try:
                self.iconbitmap(str(icon_file))
            except Exception:
                pass

    def load_schema(self) -> dict:
        try:
            data = json.loads(FORM_SCHEMA_FILE.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                default = default_schema()
                merged = {
                    "form_name": data.get("form_name") or default["form_name"],
                    "request_types": data.get("request_types") or default["request_types"],
                    "fields": data.get("fields") or default["fields"],
                    "groups": data.get("groups") or default["groups"],
                    "known_values": self.normalize_known_values(data.get("known_values", default.get("known_values", {}))),
                    "property_address_links": self.normalize_property_address_links(
                        data.get("property_address_links", default.get("property_address_links", []))
                    ),
                }
                self.sanitize_schema(merged)
                self.apply_schema_defaults(merged)
                return merged
            return default_schema()
        except Exception:
            return default_schema()

    def sanitize_schema(self, schema: dict):
        form_name = str(schema.get("form_name", "")).strip()
        if form_name.lower() == "rho it request form":
            schema["form_name"] = APP_DISPLAY_NAME

        legacy_domain = "@rhoresidential.com"
        for group in schema.get("groups", []):
            if group.get("id") != "email_groups":
                continue

            items = group.get("items", [])
            if not isinstance(items, list):
                items = []

            cleaned_items = []
            for item in items:
                if not isinstance(item, dict):
                    continue
                label = str(item.get("label", "")).strip().lower()
                if legacy_domain in label:
                    continue
                cleaned_items.append(item)

            if not cleaned_items:
                cleaned_items = [
                    {
                        "id": "everyone",
                        "label": "everyone@yourdomain.com",
                        "description": "Add/remove this email group.",
                        "default_enabled": True,
                    }
                ]

            group["items"] = cleaned_items

    def apply_schema_defaults(self, schema: dict):
        request_types = schema.get("request_types", [])
        if not isinstance(request_types, list):
            request_types = []
        for required in [SHARED_MAILBOX_REQUEST_TYPE, DISTRIBUTION_GROUP_REQUEST_TYPE]:
            if required not in request_types:
                request_types.append(required)
        schema["request_types"] = request_types

        groups = schema.get("groups", [])
        if not isinstance(groups, list):
            groups = []

        required_groups = {group["id"]: deepcopy(group) for group in default_schema().get("groups", [])}
        existing_ids = {str(group.get("id", "")) for group in groups if isinstance(group, dict)}
        for group in default_schema().get("groups", []):
            group_id = group.get("id")
            if group_id not in existing_ids and group_id in required_groups:
                groups.append(required_groups[group_id])

        schema["groups"] = groups

        for group in groups:
            if "enabled" not in group:
                group["enabled"] = True

            if group.get("id") != "email_groups":
                continue
            first_item = True
            for item in group.get("items", []):
                if "default_enabled" not in item:
                    item["default_enabled"] = first_item
                first_item = False

    def normalize_known_values(self, payload: dict) -> dict:
        defaults = default_known_values()
        if not isinstance(payload, dict):
            return defaults

        normalized = {}
        for field_id in defaults:
            raw_values = payload.get(field_id, [])
            if not isinstance(raw_values, list):
                raw_values = []
            normalized[field_id] = normalized_unique([str(item) for item in raw_values])
        return normalized

    def normalize_property_address_links(self, payload: list) -> list[dict]:
        if not isinstance(payload, list):
            return []
        links = []
        seen = set()
        for item in payload:
            if not isinstance(item, dict):
                continue
            property_name = str(item.get("property", "")).strip()
            address = str(item.get("address", "")).strip()
            if not property_name or not address:
                continue
            key = (property_name.lower(), address.lower())
            if key in seen:
                continue
            seen.add(key)
            links.append({"property": property_name, "address": address})
        return links

    def refresh_known_value_cache(self):
        self.known_values = self.normalize_known_values(self.schema.get("known_values", {}))
        self.schema["known_values"] = self.known_values

        links = self.normalize_property_address_links(self.schema.get("property_address_links", []))
        self.schema["property_address_links"] = links

        self.property_to_address = {}
        self.address_to_property = {}
        for item in links:
            property_name = item["property"]
            address = item["address"]
            self.property_to_address[property_name.lower()] = address
            self.address_to_property[address.lower()] = property_name

    def save_schema(self):
        FORM_SCHEMA_FILE.write_text(json.dumps(self.schema, indent=2), encoding="utf-8")

    def load_settings(self) -> dict:
        try:
            data = json.loads(SETTINGS_FILE.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                merged = default_app_settings()
                merged.update(data)
                return merged
            return default_app_settings()
        except Exception:
            return default_app_settings()

    def save_settings(self):
        self.settings["storage_root_dir"] = str(STORAGE_ROOT_DIR)
        merged = default_app_settings()
        merged.update(self.settings)
        self.settings = merged
        SETTINGS_FILE.write_text(json.dumps(self.settings, indent=2), encoding="utf-8")

    def merge_copy_tree(self, source: Path, destination: Path):
        if not source.exists() or not source.is_dir():
            return
        destination.mkdir(parents=True, exist_ok=True)

        for item in source.rglob("*"):
            if not item.is_file():
                continue
            relative = item.relative_to(source)
            target = destination / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            if target.exists():
                continue
            shutil.copy2(item, target)

    def migrate_storage_root(self, new_storage_root: Path):
        old_storage_root = STORAGE_ROOT_DIR
        old_config_dir = CONFIG_DIR
        old_requests_dir = self.requests_dir

        try:
            if old_storage_root.resolve() == new_storage_root.resolve():
                return
        except Exception:
            if str(old_storage_root).strip().lower() == str(new_storage_root).strip().lower():
                return

        set_storage_paths(new_storage_root)
        save_bootstrap_settings(new_storage_root)
        ensure_dirs()

        self.merge_copy_tree(old_config_dir, CONFIG_DIR)

        default_new_requests = DATA_DIR
        self.merge_copy_tree(old_requests_dir, default_new_requests)

        self.requests_dir = default_new_requests
        self.settings = self.load_settings()
        self.settings["requests_dir"] = str(self.requests_dir)
        self.save_settings()

        self.schema = self.load_schema()
        self.custom_section_label, self.custom_fields = self.load_custom_fields()
        self.refresh_known_value_cache()
        self.render_form()

    def resolve_requests_dir(self, configured_path: str) -> Path:
        raw = (configured_path or "").strip()
        if raw:
            return Path(raw)
        return DATA_DIR

    def load_custom_fields(self) -> tuple[str, list[dict]]:
        try:
            data = json.loads(CUSTOM_FIELDS_FILE.read_text(encoding="utf-8"))
            if isinstance(data, list):
                return DEFAULT_CUSTOM_SECTION_LABEL, data
            if isinstance(data, dict):
                section_label = data.get("section_label", DEFAULT_CUSTOM_SECTION_LABEL)
                fields = data.get("fields", [])
                if isinstance(fields, list):
                    return section_label, fields
            return DEFAULT_CUSTOM_SECTION_LABEL, []
        except Exception:
            return DEFAULT_CUSTOM_SECTION_LABEL, []

    def save_custom_fields(self) -> None:
        payload = {
            "section_label": self.custom_section_label,
            "fields": self.custom_fields,
        }
        CUSTOM_FIELDS_FILE.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    def build_ui(self):
        style = ttk.Style(self)
        if not tb and "clam" in style.theme_names():
            style.theme_use("clam")

        bg_main = "#f4f7fb"
        bg_card = "#ffffff"
        bg_card_alt = "#f8fafc"
        text_primary = "#0f172a"
        text_muted = "#64748b"
        border_soft = "#e2e8f0"
        border_focus = "#93c5fd"
        accent = "#2563eb"
        accent_hover = "#1d4ed8"

        self.card_bg_color = bg_card
        self.field_label_color = text_muted

        self.configure(bg=bg_main)
        style.configure("TFrame", background=bg_main)
        style.configure("TLabel", background=bg_main, foreground=text_primary, font=("Segoe UI", 10))
        style.configure("TLabelframe", background=bg_main, borderwidth=0, relief="flat")
        style.configure("TLabelframe.Label", foreground=text_primary, font=("Segoe UI", 10, "bold"))
        style.configure("TopBar.TFrame", background=bg_card, borderwidth=0, relief="flat")

        style.configure("Header.TLabel", foreground=text_primary, font=("Segoe UI Semibold", 17))
        style.configure(
            "Primary.Header.TButton",
            font=("Segoe UI Semibold", 10),
            padding=(16, 9),
            background=accent,
            foreground="#ffffff",
            borderwidth=0,
            relief="flat",
        )
        style.map(
            "Primary.Header.TButton",
            background=[("active", accent_hover)],
            foreground=[("disabled", "#cbd5e1")],
        )
        style.configure(
            "Secondary.Header.TButton",
            font=("Segoe UI", 10),
            padding=(14, 9),
            background="#ffffff",
            foreground=text_primary,
            borderwidth=0,
            relief="flat",
            bordercolor=border_soft,
        )
        style.map("Secondary.Header.TButton", background=[("active", bg_card_alt)])

        style.configure(
            "Action.TButton",
            font=("Segoe UI", 10),
            padding=(12, 8),
            relief="flat",
            borderwidth=0,
            bordercolor=border_soft,
            background="#ffffff",
            foreground=text_primary,
        )
        style.map("Action.TButton", background=[("active", bg_card_alt)])

        style.configure("Card.TLabelframe", background=bg_card, borderwidth=0, relief="flat")
        style.configure("Card.TLabelframe.Label", foreground=text_primary, font=("Segoe UI", 11, "bold"))
        style.configure("Card.TFrame", background=bg_card)
        style.configure("Card.TLabel", background=bg_card, foreground=text_primary, font=("Segoe UI", 10))
        style.configure("CardMuted.TLabel", background=bg_card, foreground=text_muted, font=("Segoe UI", 9))
        style.configure("FieldLabel.TLabel", background=bg_card, foreground=text_muted, font=("Segoe UI", 9))
        style.configure("Card.TCheckbutton", background=bg_card, foreground=text_primary, font=("Segoe UI", 10))
        style.map("Card.TCheckbutton", background=[("active", bg_card)])

        style.configure("TEntry", padding=8, fieldbackground="#ffffff", bordercolor=border_soft, relief="flat")
        style.map("TEntry", bordercolor=[("focus", border_focus)])
        style.configure("TCombobox", padding=7, fieldbackground="#ffffff", bordercolor=border_soft, relief="flat")
        style.map("TCombobox", bordercolor=[("focus", border_focus)])
        style.configure("Vertical.TScrollbar", background=bg_main, troughcolor=bg_main)

        self.columnconfigure(0, weight=4)
        self.columnconfigure(1, weight=2)
        self.rowconfigure(0, weight=0)
        self.rowconfigure(1, weight=1)

        top_bar = ttk.Frame(self, style="TopBar.TFrame", padding=(10, 8))
        top_bar.grid(row=0, column=0, columnspan=2, sticky="ew", padx=10, pady=(10, 6))
        title_col = 0
        try:
            icon_file = asset_path("app_icon_24.png")
            if icon_file.exists():
                self._app_icon_img = tk.PhotoImage(file=str(icon_file))
                ttk.Label(top_bar, image=self._app_icon_img, style="Header.TLabel").grid(
                    row=0, column=0, sticky="w", padx=(6, 0), pady=6
                )
                title_col = 1
        except Exception:
            self._app_icon_img = None

        top_bar.columnconfigure(title_col, weight=1)
        tk.Label(
            top_bar,
            text=self.schema.get("form_name", "IT Request Form"),
            bg=bg_card,
            fg=text_primary,
            font=("Segoe UI Semibold", 17),
            bd=0,
            relief="flat",
            highlightthickness=0,
        ).grid(row=0, column=title_col, sticky="w", padx=8, pady=6)
        action_col = title_col + 1
        ttk.Button(top_bar, text="Save Request", command=self.save_request, style="Primary.Header.TButton").grid(
            row=0, column=action_col, sticky="e", padx=(0, 8), pady=6
        )
        ttk.Button(top_bar, text="Send to Outlook", command=self.send_to_outlook, style="Secondary.Header.TButton").grid(
            row=0, column=action_col + 1, sticky="e", padx=(0, 8), pady=6
        )
        ttk.Button(top_bar, text="Clear Form", command=self.clear_form, style="Secondary.Header.TButton").grid(
            row=0, column=action_col + 2, sticky="e", padx=(0, 8), pady=6
        )
        ttk.Button(
            top_bar,
            textvariable=self.info_panel_toggle_text,
            command=self.toggle_info_panel,
            style="Secondary.Header.TButton",
        ).grid(
            row=0, column=action_col + 3, sticky="e", padx=8, pady=6
        )
        ttk.Separator(self).grid(row=0, column=0, columnspan=2, sticky="sew", padx=14, pady=(0, 0))

        canvas_frame = ttk.Frame(self)
        canvas_frame.grid(row=1, column=0, sticky="nsew", padx=(6, 3), pady=(2, 6))
        canvas_frame.columnconfigure(0, weight=1)
        canvas_frame.rowconfigure(0, weight=1)
        canvas_frame.bind("<Configure>", self.on_content_area_resize)

        canvas = tk.Canvas(canvas_frame, highlightthickness=0, bg=bg_main)
        self.form_canvas = canvas
        scrollbar = ttk.Scrollbar(canvas_frame, orient="vertical", command=canvas.yview)
        self.form_container = ttk.Frame(canvas)
        self.form_container.columnconfigure(0, weight=1)
        self.form_container.columnconfigure(1, weight=1)

        self.form_container.bind(
            "<Configure>",
            lambda _e: canvas.configure(scrollregion=canvas.bbox("all")),
        )

        self.form_container_window = canvas.create_window((0, 0), window=self.form_container, anchor="nw")
        canvas.configure(yscrollcommand=scrollbar.set)
        canvas.bind("<Configure>", self.on_canvas_resize)
        self.bind_mousewheel(canvas)

        canvas.grid(row=0, column=0, sticky="nsew")
        scrollbar.grid(row=0, column=1, sticky="ns")

        self.right_panel = ttk.LabelFrame(self, text="Info & Actions", style="Card.TLabelframe", padding=(14, 12))
        self.right_panel_grid_opts = {"row": 1, "column": 1, "sticky": "nsew", "padx": (3, 6), "pady": (2, 6)}
        self.right_panel.grid(**self.right_panel_grid_opts)
        self.right_panel.columnconfigure(0, weight=1)

        info_label = ttk.Label(
            self.right_panel,
            textvariable=self.info_text,
            style="CardMuted.TLabel",
            wraplength=290,
            justify="left",
        )
        self.info_label = info_label
        info_label.grid(row=0, column=0, sticky="nw", padx=4, pady=(2, 10))
        self.right_panel.bind("<Configure>", self.update_info_wraplength)

        ttk.Separator(self.right_panel).grid(row=1, column=0, sticky="ew", padx=4, pady=(0, 10))

        ttk.Button(self.right_panel, text="Load previous employee form data", command=self.load_previous_for_name, style="Action.TButton").grid(
            row=2, column=0, sticky="ew", padx=4, pady=(0, 8)
        )
        ttk.Button(self.right_panel, text="Settings", command=self.open_settings, style="Action.TButton").grid(
            row=3, column=0, sticky="ew", padx=4, pady=(0, 8)
        )
        ttk.Button(self.right_panel, text="Open saved forms folder", command=self.open_requests_folder, style="Action.TButton").grid(
            row=4, column=0, sticky="ew", padx=4, pady=(0, 8)
        )
        ttk.Button(self.right_panel, text="Open App Data Folder", command=self.open_app_data_folder, style="Action.TButton").grid(
            row=5, column=0, sticky="ew", padx=4, pady=(0, 8)
        )
        self.add_property_sections_button = ttk.Button(
            self.right_panel,
            text="Add Property Access Sections",
            command=self.prompt_add_property_access_sections,
            style="Action.TButton",
        )
        self.add_property_sections_button.grid(row=6, column=0, sticky="ew", padx=4, pady=(0, 8))

        self.after(0, self.update_info_wraplength)
        self.update_property_actions_state()
        self.render_form()

    def bind_mousewheel(self, target: tk.Widget):
        def on_mousewheel(event):
            target.yview_scroll(int(-1 * (event.delta / 120)), "units")

        def bind_on_hover(_event=None):
            target.bind_all("<MouseWheel>", on_mousewheel)

        def unbind_on_leave(_event=None):
            target.unbind_all("<MouseWheel>")

        target.bind("<Enter>", bind_on_hover)
        target.bind("<Leave>", unbind_on_leave)

    def update_info_wraplength(self, _event=None):
        if not self.info_label or not self.right_panel:
            return
        self.info_label.configure(wraplength=max(240, self.right_panel.winfo_width() - 40))

    def format_field_label(self, label: str) -> str:
        return str(label or "").strip().upper()

    def add_field_label(self, parent: tk.Widget, row: int, label: str, pady: int = 7):
        title = tk.Label(
            parent,
            text=self.format_field_label(label),
            bg=self.card_bg_color,
            fg=self.field_label_color,
            font=("Segoe UI", 9),
            bd=0,
            relief="flat",
            highlightthickness=0,
        )
        title.grid(row=row, column=0, sticky="w", padx=4, pady=pady)
        return title

    def register_help(self, widget: tk.Widget, description: str):
        def on_focus(_event=None):
            self.info_text.set(description)

        widget.bind("<FocusIn>", on_focus)
        widget.bind("<Enter>", on_focus)
        self.tooltips.append(FieldTooltip(widget, description))

    def toggle_info_panel(self):
        self.sync_additional_property_access_states()
        self.info_panel_visible = not self.info_panel_visible
        if self.info_panel_visible:
            self.right_panel.grid(**self.right_panel_grid_opts)
            self.columnconfigure(0, weight=4)
            self.columnconfigure(1, weight=2)
            self.info_panel_toggle_text.set("Hide Info & Actions")
        else:
            self.right_panel.grid_remove()
            self.columnconfigure(0, weight=1)
            self.columnconfigure(1, weight=0)
            self.info_panel_toggle_text.set("Show Info & Actions")
        self.after(0, self.rebuild_form_preserve_data)
        self.apply_responsive_layout()

    def on_content_area_resize(self, _event=None):
        self.apply_responsive_layout()

    def on_canvas_resize(self, event):
        if self.form_container_window is not None:
            self.form_canvas.itemconfigure(self.form_container_window, width=event.width)
        self.apply_responsive_layout()

    def apply_responsive_layout(self):
        if not self.body_left_frame or not self.body_right_frame:
            return

        available_width = self.form_canvas.winfo_width()
        if available_width <= 1:
            available_width = self.winfo_width()

        target_mode = "two-column" if available_width >= 860 else "single-column"
        if target_mode == self.responsive_mode:
            return

        self.responsive_mode = target_mode
        self.form_container.rowconfigure(0, weight=1)
        if target_mode == "two-column":
            self.form_container.columnconfigure(0, weight=1)
            self.form_container.columnconfigure(1, weight=1)
            self.form_container.rowconfigure(1, weight=0)
            self.body_left_frame.grid(row=0, column=0, sticky="nsew", padx=(6, 3), pady=(4, 6))
            self.body_right_frame.grid(row=0, column=1, sticky="nsew", padx=(3, 6), pady=(4, 6))
        else:
            self.form_container.columnconfigure(0, weight=1)
            self.form_container.columnconfigure(1, weight=0)
            self.form_container.rowconfigure(1, weight=1)
            self.body_left_frame.grid(row=0, column=0, sticky="nsew", padx=(6, 6), pady=(4, 6))
            self.body_right_frame.grid(row=1, column=0, sticky="nsew", padx=(6, 6), pady=(0, 6))

    def format_property_access_title(self, property_name: str, suffix: str) -> str:
        name = (property_name or "").strip()
        return f"{name} {suffix}" if name else f"Property {suffix}"

    def refresh_primary_property_titles(self):
        property_name = ""
        if self.property_field_var is not None:
            property_name = self.property_field_var.get().strip()
        if self.primary_property_network_frame:
            self.primary_property_network_frame.configure(text=self.format_property_access_title(property_name, "Network Access"))
        if self.primary_property_mailbox_frame:
            self.primary_property_mailbox_frame.configure(text=self.format_property_access_title(property_name, "Mailbox Access"))

    def sync_additional_property_access_states(self):
        for entry in self.additional_property_access_sections:
            network_vars = entry.get("_network_vars", {})
            mailbox_vars = entry.get("_mailbox_vars", {})
            if network_vars:
                entry["network_items"] = {item_id: bool(var.get()) for item_id, var in network_vars.items()}
            if mailbox_vars:
                entry["mailbox_items"] = {item_id: bool(var.get()) for item_id, var in mailbox_vars.items()}

    def rebuild_form_preserve_data(self):
        snapshot = self.collect_data()
        self.render_form()
        self.populate_from_payload(snapshot)

    def prompt_add_property_access_sections(self):
        if not self.property_access_groups_available():
            messagebox.showinfo(
                "Property Access Disabled",
                "Enable Property Network Access and/or Property Mailbox Access in Edit Form Setup to add property sections.",
            )
            return

        property_hint = ""
        if "property" in self.text_vars:
            property_hint = self.text_vars["property"].get().strip()

        property_name = simpledialog.askstring(
            "Additional Property",
            "Which property should the additional Network/Mailbox sections belong to?",
            initialvalue=property_hint,
            parent=self,
        )
        if property_name is None:
            return
        property_name = property_name.strip()
        if not property_name:
            messagebox.showerror("Missing Property", "Enter a property name for the additional sections.")
            return

        self.sync_additional_property_access_states()
        self.additional_property_access_sections.append(
            {
                "property_name": property_name,
                "network_items": {},
                "mailbox_items": {},
            }
        )
        self.rebuild_form_preserve_data()

    def add_property_access_group_instance(
        self,
        parent: ttk.Frame,
        row: int,
        title: str,
        items: list[dict],
        item_state: dict,
    ) -> tuple[int, ttk.LabelFrame, dict]:
        frame = ttk.LabelFrame(parent, text=title, style="Card.TLabelframe", padding=(14, 12))
        frame.grid(row=row, column=0, sticky="nsew", padx=6, pady=10)
        parent.rowconfigure(row, weight=1)
        cols = 2 if len(items) >= 8 else 1
        for col in range(cols):
            frame.columnconfigure(col, weight=1)

        vars_by_item = {}
        for idx, item in enumerate(items):
            item_id = item.get("id", slugify(item.get("label", "item")))
            var = tk.BooleanVar(value=bool(item_state.get(item_id, False)))
            vars_by_item[item_id] = var
            chk = ttk.Checkbutton(frame, text=item.get("label", item_id), variable=var, style="Card.TCheckbutton")
            chk.grid(row=idx // cols, column=idx % cols, sticky="w", padx=4, pady=4)
            self.register_help(chk, item.get("description", f"Enable or disable access for: {item.get('label', item_id)}"))

        return row + 1, frame, vars_by_item

    def render_form(self):
        self.sync_additional_property_access_states()
        for child in self.form_container.winfo_children():
            child.destroy()
        self.tooltips.clear()
        self.text_vars.clear()
        self.smart_field_vars.clear()
        self.smart_field_widgets.clear()
        self.checkbox_vars.clear()
        self.custom_vars.clear()
        self.field_meta.clear()
        self.group_meta.clear()
        self.primary_property_network_frame = None
        self.primary_property_mailbox_frame = None
        self.special_members_frame = None
        self.special_members_type = ""
        self.special_add_member_button = None
        self.property_field_var = None
        self.update_property_actions_state()

        body_left = ttk.Frame(self.form_container)
        body_right = ttk.Frame(self.form_container)
        self.body_left_frame = body_left
        self.body_right_frame = body_right
        body_left.columnconfigure(0, weight=1)
        body_right.columnconfigure(0, weight=1)
        self.responsive_mode = None
        self.apply_responsive_layout()

        left_row = 0
        request_info = ttk.LabelFrame(body_left, text="Request Information", style="Card.TLabelframe", padding=(14, 12))
        request_info.grid(row=left_row, column=0, sticky="nsew", padx=6, pady=10)
        body_left.rowconfigure(left_row, weight=1)
        request_info.columnconfigure(1, weight=1)
        request_row = 0

        request_types = self.schema.get("request_types", ["New Hire"])
        if self.request_type.get() not in request_types:
            self.request_type.set(request_types[0] if request_types else "New Hire")
        request_row = self.add_dropdown_field(
            request_info,
            request_row,
            "Request Type",
            request_types,
            self.request_type,
            "Select the HR event type for this request.",
        )

        if self.is_special_request_type():
            request_row = self.add_special_request_section(request_info, request_row)
            left_row += 1
            return

        for field in self.schema.get("fields", []):
            request_row = self.add_input_field(request_info, request_row, field)

        request_row = self.add_termination_section(request_info, request_row)
        left_row += 1

        system_web_group = self.get_group_by_id("system_web")
        if self.is_group_enabled(system_web_group):
            left_row = self.add_checkbox_group(body_left, left_row, system_web_group)

        property_name = self.text_vars.get("property", tk.StringVar()).get().strip()
        property_network_group = self.get_group_by_id("property_network")
        property_mailbox_group = self.get_group_by_id("property_mailbox")
        network_enabled = self.is_group_enabled(property_network_group)
        mailbox_enabled = self.is_group_enabled(property_mailbox_group)
        secondary_groups = [
            group
            for group in self.schema.get("groups", [])
            if group.get("id") not in {"system_web", "property_network", "property_mailbox"} and self.is_group_enabled(group)
        ]

        right_row = 0
        if self.info_panel_visible:
            for group in secondary_groups:
                left_row = self.add_checkbox_group(body_left, left_row, group)
            if network_enabled:
                right_row = self.add_checkbox_group(
                    body_right,
                    right_row,
                    property_network_group,
                    title_override=self.format_property_access_title(property_name, "Network Access"),
                )
                self.primary_property_network_frame = self._last_created_checkbox_group_frame
            if mailbox_enabled:
                right_row = self.add_checkbox_group(
                    body_right,
                    right_row,
                    property_mailbox_group,
                    title_override=self.format_property_access_title(property_name, "Mailbox Access"),
                )
                self.primary_property_mailbox_frame = self._last_created_checkbox_group_frame
        else:
            if network_enabled:
                right_row = self.add_checkbox_group(
                    body_right,
                    right_row,
                    property_network_group,
                    title_override=self.format_property_access_title(property_name, "Network Access"),
                )
                self.primary_property_network_frame = self._last_created_checkbox_group_frame
            for group in secondary_groups:
                right_row = self.add_checkbox_group(body_right, right_row, group)
            if mailbox_enabled:
                left_row = self.add_checkbox_group(
                    body_left,
                    left_row,
                    property_mailbox_group,
                    title_override=self.format_property_access_title(property_name, "Mailbox Access"),
                )
                self.primary_property_mailbox_frame = self._last_created_checkbox_group_frame

        for entry in self.additional_property_access_sections:
            extra_property_name = str(entry.get("property_name", "")).strip()
            if not extra_property_name:
                continue
            network_vars = {}
            mailbox_vars = {}
            if network_enabled:
                right_row, _, network_vars = self.add_property_access_group_instance(
                    body_right,
                    right_row,
                    self.format_property_access_title(extra_property_name, "Network Access"),
                    property_network_group.get("items", []),
                    entry.get("network_items", {}),
                )
            if mailbox_enabled:
                right_row, _, mailbox_vars = self.add_property_access_group_instance(
                    body_right,
                    right_row,
                    self.format_property_access_title(extra_property_name, "Mailbox Access"),
                    property_mailbox_group.get("items", []),
                    entry.get("mailbox_items", {}),
                )
            entry["_network_vars"] = network_vars
            entry["_mailbox_vars"] = mailbox_vars

        if self.custom_fields:
            section = ttk.LabelFrame(body_right, text=self.custom_section_label, style="Card.TLabelframe", padding=(14, 12))
            section.grid(row=right_row, column=0, sticky="nsew", padx=6, pady=10)
            body_right.rowconfigure(right_row, weight=1)
            section.columnconfigure(1, weight=1)
            custom_row = 0
            for field in self.custom_fields:
                field_id = field.get("id", "custom")
                label = field.get("label", "Custom")
                description = field.get("description", "Custom field")
                field_type = field.get("type", "text")
                if field_type == "checkbox":
                    var = tk.BooleanVar(value=False)
                    self.custom_vars[field_id] = var
                    chk = ttk.Checkbutton(section, text=label, variable=var, style="Card.TCheckbutton")
                    chk.grid(row=custom_row, column=0, columnspan=2, sticky="w", padx=4, pady=5)
                    self.register_help(chk, description)
                else:
                    self.add_field_label(section, custom_row, label, pady=5)
                    var = tk.StringVar()
                    self.custom_vars[field_id] = var
                    entry = ttk.Entry(section, textvariable=var)
                    entry.grid(row=custom_row, column=1, sticky="ew", padx=4, pady=5)
                    self.register_help(entry, description)
                custom_row += 1

    def get_group_by_id(self, group_id: str) -> dict:
        for group in self.schema.get("groups", []):
            if group.get("id") == group_id:
                return group
        return {"id": group_id, "title": group_id, "enabled": True, "items": []}

    def is_group_enabled(self, group: dict) -> bool:
        return bool(group.get("enabled", True))

    def property_access_groups_available(self) -> bool:
        return self.is_group_enabled(self.get_group_by_id("property_network")) or self.is_group_enabled(
            self.get_group_by_id("property_mailbox")
        )

    def update_property_actions_state(self):
        if self.add_property_sections_button is None:
            return
        if self.property_access_groups_available():
            self.add_property_sections_button.state(["!disabled"])
        else:
            self.add_property_sections_button.state(["disabled"])

    def add_dropdown_field(
        self,
        parent: ttk.Frame,
        row: int,
        label: str,
        values: list[str],
        variable: tk.StringVar,
        description: str,
    ) -> int:
        self.add_field_label(parent, row, label, pady=7)
        combo = ttk.Combobox(parent, values=values, textvariable=variable, state="readonly")
        combo.grid(row=row, column=1, sticky="ew", padx=4, pady=7)
        self.register_help(combo, description)
        if label == "Request Type":
            combo.bind("<<ComboboxSelected>>", self.on_request_type_changed)
        return row + 1

    def add_input_field(self, parent: ttk.Frame, row: int, field: dict) -> int:
        field_id = field.get("id", slugify(field.get("label", "field")))
        label = field.get("label", "Field")
        description = field.get("description", f"Enter value for {label}.")
        field_type = field.get("type", "text")

        self.add_field_label(parent, row, label, pady=7)
        var = tk.StringVar()
        self.text_vars[field_id] = var
        self.field_meta[field_id] = field

        if field_type == "date":
            if not var.get():
                var.set(datetime.now().strftime("%m-%d-%Y"))

            widget = None
            if tb and hasattr(tb, "DateEntry"):
                try:
                    widget = tb.DateEntry(parent, dateformat="%m-%d-%Y", bootstyle="primary", width=18)
                    widget.entry.configure(textvariable=var, font=("Segoe UI", 10))
                except Exception:
                    widget = None

            if widget is None:
                widget = ttk.Entry(parent, textvariable=var)
        elif field_id in {"address", "property", "department", "sub_department", "title"}:
            widget = ttk.Combobox(parent, textvariable=var, values=self.known_values.get(field_id, []), state="normal")
            self.smart_field_vars[field_id] = var
            self.smart_field_widgets[field_id] = widget
            widget.bind("<<ComboboxSelected>>", lambda _e, fid=field_id: self.on_smart_field_commit(fid))
            widget.bind("<FocusOut>", lambda _e, fid=field_id: self.on_smart_field_commit(fid))
            if field_id == "property":
                self.property_field_var = var
                var.trace_add("write", lambda *_: self.refresh_primary_property_titles())
        else:
            widget = ttk.Entry(parent, textvariable=var)

        widget.grid(row=row, column=1, sticky="ew", padx=4, pady=7)
        self.register_help(widget, description)
        return row + 1

    def on_smart_field_commit(self, field_id: str):
        if self._suppress_link_autofill:
            return
        if field_id not in {"address", "property"}:
            return

        property_var = self.smart_field_vars.get("property")
        address_var = self.smart_field_vars.get("address")
        if not property_var or not address_var:
            return

        property_value = property_var.get().strip()
        address_value = address_var.get().strip()
        self._suppress_link_autofill = True
        try:
            if field_id == "property" and property_value and not address_value:
                linked_address = self.property_to_address.get(property_value.lower())
                if linked_address:
                    address_var.set(linked_address)
            elif field_id == "address" and address_value and not property_value:
                linked_property = self.address_to_property.get(address_value.lower())
                if linked_property:
                    property_var.set(linked_property)
        finally:
            self._suppress_link_autofill = False

        if field_id == "property":
            self.refresh_primary_property_titles()

    def maybe_save_new_known_values(self):
        tracked_fields = ["address", "property", "department", "sub_department", "title"]
        changed = False

        for field_id in tracked_fields:
            var = self.smart_field_vars.get(field_id)
            if not var:
                continue
            value = var.get().strip()
            if not value:
                continue

            existing = self.known_values.get(field_id, [])
            existing_lower = {item.lower() for item in existing}
            if value.lower() in existing_lower:
                continue

            label = field_id.replace("_", " ").title()
            if messagebox.askyesno("Save New Value", f"Save '{value}' to {label} autofill values?"):
                self.known_values[field_id] = existing + [value]
                self.schema["known_values"] = self.known_values
                changed = True

        property_var = self.smart_field_vars.get("property")
        address_var = self.smart_field_vars.get("address")
        if property_var and address_var:
            property_value = property_var.get().strip()
            address_value = address_var.get().strip()
            if property_value and address_value:
                existing_link = self.property_to_address.get(property_value.lower())
                if existing_link is None:
                    if messagebox.askyesno(
                        "Save Property-Address Link",
                        f"Link property '{property_value}' with address '{address_value}' for future autofill?",
                    ):
                        links = self.schema.get("property_address_links", [])
                        links.append({"property": property_value, "address": address_value})
                        self.schema["property_address_links"] = self.normalize_property_address_links(links)
                        changed = True

        if changed:
            self.refresh_known_value_cache()
            self.save_schema()
            for field_id, widget in self.smart_field_widgets.items():
                widget.configure(values=self.known_values.get(field_id, []))

    def add_checkbox_group(self, parent: ttk.Frame, row: int, group: dict, title_override: str | None = None) -> int:
        group_id = group.get("id", slugify(group.get("title", "group")))
        title = title_override or group.get("title", group_id)
        items = group.get("items", [])

        frame = ttk.LabelFrame(parent, text=title, style="Card.TLabelframe", padding=(14, 12))
        self._last_created_checkbox_group_frame = frame
        frame.grid(row=row, column=0, sticky="nsew", padx=6, pady=10)
        parent.rowconfigure(row, weight=1)
        cols = 2 if len(items) >= 8 else 1
        for col in range(cols):
            frame.columnconfigure(col, weight=1)

        for idx, item in enumerate(items):
            item_id = item.get("id", slugify(item.get("label", "item")))
            key = f"{group_id}.{item_id}"
            var = tk.BooleanVar(value=bool(item.get("default_enabled", False)))
            self.checkbox_vars[key] = var
            chk = ttk.Checkbutton(frame, text=item.get("label", item_id), variable=var, style="Card.TCheckbutton")
            chk.grid(row=idx // cols, column=idx % cols, sticky="w", padx=4, pady=4)
            self.group_meta[key] = {"group_id": group_id, "item": item}
            self.register_help(chk, item.get("description", f"Enable or disable access for: {item.get('label', item_id)}"))

        return row + 1

    def add_termination_section(self, parent: ttk.Frame, row: int) -> int:
        frame = ttk.LabelFrame(parent, text="Termination Actions", style="Card.TLabelframe", padding=(14, 12))
        frame.grid(row=row, column=0, sticky="nsew", padx=6, pady=10)
        parent.rowconfigure(row, weight=1)
        frame.columnconfigure(1, weight=1)

        self.add_field_label(frame, 0, "Forward Email To User", pady=7)
        forward_entry = ttk.Entry(frame, textvariable=self.termination_vars["forward_email_to"])
        forward_entry.grid(row=0, column=1, sticky="ew", padx=4, pady=7)
        self.register_help(forward_entry, "For terminations, optionally forward the mailbox to this user.")

        self.add_field_label(frame, 1, "Grant Full Access Rights To User", pady=7)
        grant_entry = ttk.Entry(frame, textvariable=self.termination_vars["grant_full_access_to"])
        grant_entry.grid(row=1, column=1, sticky="ew", padx=4, pady=7)
        self.register_help(grant_entry, "For terminations, optionally grant full access rights to this user.")

        self.termination_section = frame
        self.toggle_termination_section()
        return row + 1

    def is_special_request_type(self, value: str | None = None) -> bool:
        request_type = self.request_type.get() if value is None else value
        return request_type in SPECIAL_REQUEST_TYPES

    def add_special_request_section(self, parent: ttk.Frame, row: int) -> int:
        current_type = self.request_type.get()
        if current_type == SHARED_MAILBOX_REQUEST_TYPE:
            description = (
                "A shared mailbox is a mailbox that users do not sign into directly. "
                "Emails are delivered to the mailbox, and users with assigned permissions can access it. "
                "Permissions may include Read (Full Access), Send on Behalf, and Send As."
            )
            vars_map = self.shared_mailbox_vars
        else:
            description = (
                "A distribution group does not store email in a mailbox. "
                "Instead, messages sent to the group address are automatically forwarded to each member's inbox."
            )
            vars_map = self.distribution_group_vars

        desc = ttk.Label(parent, text=description, style="CardMuted.TLabel", wraplength=650, justify="left")
        desc.grid(row=row, column=0, columnspan=2, sticky="w", padx=4, pady=(2, 10))
        row += 1

        self.add_field_label(parent, row, "Display Name", pady=7)
        display_name_entry = ttk.Entry(parent, textvariable=vars_map["display_name"])
        display_name_entry.grid(row=row, column=1, sticky="ew", padx=4, pady=7)
        self.register_help(display_name_entry, "Enter the display name for the selected mailbox or group.")
        row += 1

        email_label = "Shared Mailbox Email Address" if current_type == SHARED_MAILBOX_REQUEST_TYPE else "Distribution Group Email Address"
        self.add_field_label(parent, row, email_label, pady=7)
        email_entry = ttk.Entry(parent, textvariable=vars_map["email_address"])
        email_entry.grid(row=row, column=1, sticky="ew", padx=4, pady=7)
        self.register_help(email_entry, "Enter a valid email address.")
        row += 1

        members_frame = ttk.LabelFrame(parent, text="Members", style="Card.TLabelframe", padding=(10, 8))
        members_frame.grid(row=row, column=0, columnspan=2, sticky="ew", padx=4, pady=(8, 6))
        members_frame.columnconfigure(0, weight=1)
        self.special_members_frame = members_frame
        self.special_members_type = current_type
        self.refresh_special_members_rows()

        return row + 1

    def refresh_special_members_rows(self):
        frame = self.special_members_frame
        if not frame:
            return

        for child in frame.winfo_children():
            child.destroy()
        self.special_add_member_button = None

        if self.special_members_type == SHARED_MAILBOX_REQUEST_TYPE:
            if not self.shared_mailbox_members:
                self.shared_mailbox_members.append(self.new_shared_mailbox_member())
            for index, member in enumerate(self.shared_mailbox_members):
                self.add_shared_mailbox_member_row(frame, index, member)
            self.special_add_member_button = ttk.Button(
                frame,
                text="+ Add Member",
                command=self.add_shared_mailbox_member,
                style="Action.TButton",
            )
            self.special_add_member_button.grid(row=len(self.shared_mailbox_members) + 1, column=0, sticky="w", padx=4, pady=(8, 2))
            return

        if self.special_members_type == DISTRIBUTION_GROUP_REQUEST_TYPE:
            if not self.distribution_group_members:
                self.distribution_group_members.append(self.new_distribution_group_member())
            for index, member in enumerate(self.distribution_group_members):
                self.add_distribution_group_member_row(frame, index, member)
            self.special_add_member_button = ttk.Button(
                frame,
                text="+ Add Member",
                command=self.add_distribution_group_member,
                style="Action.TButton",
            )
            self.special_add_member_button.grid(row=len(self.distribution_group_members) + 1, column=0, sticky="w", padx=4, pady=(8, 2))

    def new_shared_mailbox_member(self, payload: dict | None = None) -> dict:
        payload = payload if isinstance(payload, dict) else {}
        return {
            "email": tk.StringVar(value=str(payload.get("email", "")).strip()),
            "full_access": tk.BooleanVar(value=bool(payload.get("full_access", False))),
            "send_on_behalf": tk.BooleanVar(value=bool(payload.get("send_on_behalf", False))),
            "send_as": tk.BooleanVar(value=bool(payload.get("send_as", False))),
        }

    def new_distribution_group_member(self, payload: dict | None = None) -> dict:
        payload = payload if isinstance(payload, dict) else {}
        return {
            "email": tk.StringVar(value=str(payload.get("email", "")).strip()),
        }

    def add_shared_mailbox_member_row(self, parent: ttk.LabelFrame, row: int, member: dict):
        row_frame = ttk.Frame(parent, style="Card.TFrame")
        row_frame.grid(row=row, column=0, sticky="ew", padx=4, pady=4)
        row_frame.columnconfigure(0, weight=1)

        ttk.Entry(row_frame, textvariable=member["email"]).grid(row=0, column=0, sticky="ew", padx=(0, 8), pady=2)
        permissions_frame = ttk.Frame(row_frame, style="Card.TFrame")
        permissions_frame.grid(row=1, column=0, sticky="w", pady=2)
        ttk.Checkbutton(
            permissions_frame,
            text="Read (Full Access)",
            variable=member["full_access"],
            style="Card.TCheckbutton",
        ).pack(side="left")

        ttk.Checkbutton(
            permissions_frame,
            text="Send on Behalf",
            variable=member["send_on_behalf"],
            style="Card.TCheckbutton",
        ).pack(side="left", padx=(12, 0))

        ttk.Checkbutton(
            permissions_frame,
            text="Send As",
            variable=member["send_as"],
            style="Card.TCheckbutton",
        ).pack(side="left", padx=(12, 0))

        ttk.Button(
            row_frame,
            text="Remove",
            command=lambda idx=row: self.remove_shared_mailbox_member(idx),
            style="Action.TButton",
        ).grid(row=0, column=3, rowspan=2, sticky="e", padx=(12, 0), pady=2)

    def add_distribution_group_member_row(self, parent: ttk.LabelFrame, row: int, member: dict):
        row_frame = ttk.Frame(parent, style="Card.TFrame")
        row_frame.grid(row=row, column=0, sticky="ew", padx=4, pady=4)
        row_frame.columnconfigure(0, weight=1)

        ttk.Entry(row_frame, textvariable=member["email"]).grid(row=0, column=0, sticky="ew", padx=(0, 8), pady=2)
        ttk.Button(
            row_frame,
            text="Remove",
            command=lambda idx=row: self.remove_distribution_group_member(idx),
            style="Action.TButton",
        ).grid(row=0, column=1, sticky="e", padx=(8, 0), pady=2)

    def shared_mailbox_members_payload(self) -> list[dict]:
        payload = []
        for member in self.shared_mailbox_members:
            payload.append(
                {
                    "email": member["email"].get().strip(),
                    "full_access": bool(member["full_access"].get()),
                    "send_on_behalf": bool(member["send_on_behalf"].get()),
                    "send_as": bool(member["send_as"].get()),
                }
            )
        return payload

    def sync_shared_mailbox_members_from_ui(self):
        frame = self.special_members_frame
        if not frame or not frame.winfo_exists() or self.special_members_type != SHARED_MAILBOX_REQUEST_TYPE:
            return

        row_widgets = sorted(
            [child for child in frame.winfo_children() if isinstance(child, ttk.Frame)],
            key=lambda widget: int(widget.grid_info().get("row", 0)),
        )

        payload = []
        for row_widget in row_widgets:
            entries = [child for child in row_widget.winfo_children() if isinstance(child, ttk.Entry)]
            if not entries:
                continue

            email = entries[0].get().strip()
            permissions = {
                "full_access": False,
                "send_on_behalf": False,
                "send_as": False,
            }

            permission_frame = next(
                (child for child in row_widget.winfo_children() if isinstance(child, ttk.Frame)),
                None,
            )
            if permission_frame is not None:
                for checkbox in [child for child in permission_frame.winfo_children() if isinstance(child, ttk.Checkbutton)]:
                    text = str(checkbox.cget("text") or "").strip()
                    checked = checkbox.instate(["selected"])
                    if text == "Read (Full Access)":
                        permissions["full_access"] = checked
                    elif text == "Send on Behalf":
                        permissions["send_on_behalf"] = checked
                    elif text == "Send As":
                        permissions["send_as"] = checked

            payload.append(
                {
                    "email": email,
                    "full_access": permissions["full_access"],
                    "send_on_behalf": permissions["send_on_behalf"],
                    "send_as": permissions["send_as"],
                }
            )

        if not payload:
            return

        for index, item in enumerate(payload):
            if index < len(self.shared_mailbox_members):
                self.shared_mailbox_members[index]["email"].set(item.get("email", ""))
                self.shared_mailbox_members[index]["full_access"].set(bool(item.get("full_access", False)))
                self.shared_mailbox_members[index]["send_on_behalf"].set(bool(item.get("send_on_behalf", False)))
                self.shared_mailbox_members[index]["send_as"].set(bool(item.get("send_as", False)))
            else:
                self.shared_mailbox_members.append(self.new_shared_mailbox_member(item))

        if len(self.shared_mailbox_members) > len(payload):
            self.shared_mailbox_members = self.shared_mailbox_members[: len(payload)]

    def sync_distribution_group_members_from_ui(self):
        frame = self.special_members_frame
        if not frame or not frame.winfo_exists() or self.special_members_type != DISTRIBUTION_GROUP_REQUEST_TYPE:
            return

        row_widgets = sorted(
            [child for child in frame.winfo_children() if isinstance(child, ttk.Frame)],
            key=lambda widget: int(widget.grid_info().get("row", 0)),
        )

        payload = []
        for row_widget in row_widgets:
            entries = [child for child in row_widget.winfo_children() if isinstance(child, ttk.Entry)]
            if not entries:
                continue
            payload.append({"email": entries[0].get().strip()})

        if not payload:
            return

        for index, item in enumerate(payload):
            if index < len(self.distribution_group_members):
                self.distribution_group_members[index]["email"].set(item.get("email", ""))
            else:
                self.distribution_group_members.append(self.new_distribution_group_member(item))

        if len(self.distribution_group_members) > len(payload):
            self.distribution_group_members = self.distribution_group_members[: len(payload)]

    def distribution_group_members_payload(self) -> list[dict]:
        payload = []
        for member in self.distribution_group_members:
            payload.append({"email": member["email"].get().strip()})
        return payload

    def add_shared_mailbox_member(self):
        self.sync_shared_mailbox_members_from_ui()
        self.shared_mailbox_members.append(self.new_shared_mailbox_member())
        frame_ready = bool(
            self.special_members_frame
            and self.special_members_frame.winfo_exists()
            and self.special_members_type == SHARED_MAILBOX_REQUEST_TYPE
        )
        if frame_ready and self.special_add_member_button is not None:
            new_index = len(self.shared_mailbox_members) - 1
            self.add_shared_mailbox_member_row(self.special_members_frame, new_index, self.shared_mailbox_members[new_index])
            self.special_add_member_button.grid(row=len(self.shared_mailbox_members) + 1, column=0, sticky="w", padx=4, pady=(8, 2))
            return
        self.refresh_special_members_rows()

    def remove_shared_mailbox_member(self, index: int):
        self.sync_shared_mailbox_members_from_ui()
        if 0 <= index < len(self.shared_mailbox_members):
            self.shared_mailbox_members.pop(index)
        self.refresh_special_members_rows()

    def add_distribution_group_member(self):
        self.sync_distribution_group_members_from_ui()
        self.distribution_group_members.append(self.new_distribution_group_member())
        frame_ready = bool(
            self.special_members_frame
            and self.special_members_frame.winfo_exists()
            and self.special_members_type == DISTRIBUTION_GROUP_REQUEST_TYPE
        )
        if frame_ready and self.special_add_member_button is not None:
            new_index = len(self.distribution_group_members) - 1
            self.add_distribution_group_member_row(
                self.special_members_frame,
                new_index,
                self.distribution_group_members[new_index],
            )
            self.special_add_member_button.grid(row=len(self.distribution_group_members) + 1, column=0, sticky="w", padx=4, pady=(8, 2))
            return
        self.refresh_special_members_rows()

    def remove_distribution_group_member(self, index: int):
        self.sync_distribution_group_members_from_ui()
        if 0 <= index < len(self.distribution_group_members):
            self.distribution_group_members.pop(index)
        self.refresh_special_members_rows()

    def on_request_type_changed(self, _event=None):
        self.rebuild_form_preserve_data()

    def toggle_termination_section(self):
        if not self.termination_section:
            return
        if self.request_type.get() == "Termination" and not self.is_special_request_type():
            self.termination_section.grid()
        else:
            self.termination_section.grid_remove()

    def collect_data(self) -> dict:
        self.sync_additional_property_access_states()
        request_type = self.request_type.get()
        is_special = self.is_special_request_type(request_type)
        request_fields = {field_id: var.get().strip() for field_id, var in self.text_vars.items()} if not is_special else {}
        primary_property_name = request_fields.get("property", "")

        access = {}
        additional_property_access = []
        if not is_special:
            for group in self.schema.get("groups", []):
                if not self.is_group_enabled(group):
                    continue
                group_id = group.get("id")
                group_title = group.get("title", group_id)
                if group_id == "property_network":
                    group_title = self.format_property_access_title(primary_property_name, "Network Access")
                elif group_id == "property_mailbox":
                    group_title = self.format_property_access_title(primary_property_name, "Mailbox Access")
                access[group_id] = {
                    "title": group_title,
                    "items": {},
                }
                for item in group.get("items", []):
                    item_id = item.get("id", slugify(item.get("label", "item")))
                    key = f"{group_id}.{item_id}"
                    access[group_id]["items"][item_id] = {
                        "label": item.get("label", item_id),
                        "enabled": bool(self.checkbox_vars.get(key, tk.BooleanVar(value=False)).get()),
                    }

            network_enabled = self.is_group_enabled(self.get_group_by_id("property_network"))
            mailbox_enabled = self.is_group_enabled(self.get_group_by_id("property_mailbox"))
            for entry in self.additional_property_access_sections:
                property_name = str(entry.get("property_name", "")).strip()
                if not property_name:
                    continue
                network_items = {}
                mailbox_items = {}
                if network_enabled:
                    network_items = {item_id: bool(enabled) for item_id, enabled in entry.get("network_items", {}).items()}
                if mailbox_enabled:
                    mailbox_items = {item_id: bool(enabled) for item_id, enabled in entry.get("mailbox_items", {}).items()}
                if not network_items and not mailbox_items:
                    continue
                additional_property_access.append(
                    {
                        "property": property_name,
                        "network": network_items,
                        "mailbox": mailbox_items,
                    }
                )

        request_payload = {
            "type": request_type,
        }
        if is_special:
            if request_type == SHARED_MAILBOX_REQUEST_TYPE:
                members = []
                for member in self.shared_mailbox_members:
                    email = member["email"].get().strip()
                    members.append(
                        {
                            "email": email,
                            "permissions": {
                                "read_full_access": bool(member["full_access"].get()),
                                "send_on_behalf": bool(member["send_on_behalf"].get()),
                                "send_as": bool(member["send_as"].get()),
                            },
                        }
                    )
                request_payload["shared_mailbox"] = {
                    "display_name": self.shared_mailbox_vars["display_name"].get().strip(),
                    "email_address": self.shared_mailbox_vars["email_address"].get().strip(),
                    "members": members,
                }
            elif request_type == DISTRIBUTION_GROUP_REQUEST_TYPE:
                members = []
                for member in self.distribution_group_members:
                    email = member["email"].get().strip()
                    members.append({"email": email})
                request_payload["distribution_group"] = {
                    "display_name": self.distribution_group_vars["display_name"].get().strip(),
                    "email_address": self.distribution_group_vars["email_address"].get().strip(),
                    "members": members,
                }
        else:
            request_payload["fields"] = request_fields
            request_payload["termination"] = {
                "forward_email_to": self.termination_vars["forward_email_to"].get().strip(),
                "grant_full_access_to": self.termination_vars["grant_full_access_to"].get().strip(),
            }

        custom_payload = {}
        if not is_special:
            custom_payload = {
                field.get("id", f"custom_{index}"): self.get_variable_value(field, index)
                for index, field in enumerate(self.custom_fields)
            }

        return {
            "metadata": {
                "saved_at": now_iso(),
                "saved_by": os.environ.get("USERNAME") or os.environ.get("USER") or "UnknownUser",
            },
            "request": request_payload,
            "access": access,
            "custom_fields": custom_payload,
            "additional_property_access": additional_property_access,
            "schema_snapshot": self.schema,
        }

    def validate_special_request(self, request_type: str, request: dict) -> bool:
        if request_type == SHARED_MAILBOX_REQUEST_TYPE:
            payload = request.get("shared_mailbox", {}) if isinstance(request, dict) else {}
            display_name = str(payload.get("display_name", "")).strip()
            email_address = str(payload.get("email_address", "")).strip()
            members = payload.get("members", []) if isinstance(payload, dict) else []
            if not display_name:
                messagebox.showerror("Missing Display Name", "Display Name is required for New Shared Mailbox.")
                return False
            if not email_address:
                messagebox.showerror("Missing Email Address", "Shared Mailbox Email Address is required.")
                return False
            if not is_valid_email(email_address):
                messagebox.showerror("Invalid Email", "Shared Mailbox Email Address must be a valid email format.")
                return False
            if not isinstance(members, list):
                members = []
            valid_member_count = 0
            for member in members:
                member_email = str(member.get("email", "")).strip()
                if not member_email:
                    continue
                if not is_valid_email(member_email):
                    messagebox.showerror("Invalid Member Email", "Each shared mailbox member must have a valid email address.")
                    return False
                valid_member_count += 1
            if valid_member_count == 0:
                messagebox.showerror("Missing Members", "At least one member is required for New Shared Mailbox.")
                return False
            return True

        if request_type == DISTRIBUTION_GROUP_REQUEST_TYPE:
            payload = request.get("distribution_group", {}) if isinstance(request, dict) else {}
            display_name = str(payload.get("display_name", "")).strip()
            email_address = str(payload.get("email_address", "")).strip()
            members = payload.get("members", []) if isinstance(payload, dict) else []
            if not display_name:
                messagebox.showerror("Missing Display Name", "Display Name is required for New Distribution Group.")
                return False
            if not email_address:
                messagebox.showerror("Missing Email Address", "Distribution Group Email Address is required.")
                return False
            if not is_valid_email(email_address):
                messagebox.showerror("Invalid Email", "Distribution Group Email Address must be a valid email format.")
                return False
            if not isinstance(members, list):
                members = []
            valid_member_count = 0
            for member in members:
                member_email = str(member.get("email", "")).strip()
                if not member_email:
                    continue
                if not is_valid_email(member_email):
                    messagebox.showerror("Invalid Member Email", "Each distribution group member must have a valid email address.")
                    return False
                valid_member_count += 1
            if valid_member_count == 0:
                messagebox.showerror("Missing Members", "At least one member is required for New Distribution Group.")
                return False
            return True

        return True

    def get_variable_value(self, field: dict, index: int):
        field_id = field.get("id", f"custom_{index}")
        value = self.custom_vars.get(field_id)
        if value is None:
            return ""
        return value.get()

    def save_request_files(self, open_text_file: bool | None = None, show_saved_message: bool = True) -> tuple[dict, Path, Path] | None:
        self.maybe_save_new_known_values()
        data = self.collect_data()
        request_payload = data.get("request", {})
        request_type = request_payload.get("type", "")

        if self.is_special_request_type(request_type):
            if not self.validate_special_request(request_type, request_payload):
                return None

        name_field_id = self.get_name_field_id()
        request_fields = request_payload.get("fields", {}) if isinstance(request_payload, dict) else {}
        name = request_fields.get(name_field_id, "") if name_field_id and isinstance(request_fields, dict) else ""
        if not name and request_type == SHARED_MAILBOX_REQUEST_TYPE:
            name = str(request_payload.get("shared_mailbox", {}).get("display_name", "")).strip()
        if not name and request_type == DISTRIBUTION_GROUP_REQUEST_TYPE:
            name = str(request_payload.get("distribution_group", {}).get("display_name", "")).strip()
        req_type = data["request"]["type"]
        entered_effective_date = request_fields.get("effective_date", "") if isinstance(request_fields, dict) else ""
        normalized_effective_date = normalize_effective_date(entered_effective_date)
        if entered_effective_date and not normalized_effective_date:
            messagebox.showerror("Invalid Effective Date", "Use MM-DD-YYYY for Effective Date.")
            return None
        if normalized_effective_date:
            data["request"]["fields"]["effective_date"] = normalized_effective_date
        effective_date = request_fields.get("effective_date", "") or "NoDate"
        if not name:
            name = "Unknown Name"

        if self.is_special_request_type(request_type):
            basename = safe_filename(f"{name} - {req_type}")
        else:
            basename = safe_filename(f"{name} - {req_type} - {effective_date}")
        json_path = self.requests_dir / f"{basename}.json"
        txt_path = self.requests_dir / f"{basename}.txt"

        suffix = 1
        while json_path.exists() or txt_path.exists():
            json_path = self.requests_dir / f"{basename} ({suffix}).json"
            txt_path = self.requests_dir / f"{basename} ({suffix}).txt"
            suffix += 1

        json_path.write_text(json.dumps(data, indent=2), encoding="utf-8")
        txt_path.write_text(self.to_pretty_text(data), encoding="utf-8")

        should_open_text = self.settings.get("auto_open_text_on_save", True) if open_text_file is None else open_text_file
        if should_open_text:
            try:
                if hasattr(os, "startfile"):
                    os.startfile(str(txt_path))
            except Exception:
                pass

        if show_saved_message:
            messagebox.showinfo("Saved", f"Request saved to:\n{json_path}\n{txt_path}")

        return data, json_path, txt_path

    def save_request(self):
        self.save_request_files()

    def send_to_outlook(self):
        saved = self.save_request_files(open_text_file=False, show_saved_message=False)
        if not saved:
            return

        data, json_path, txt_path = saved
        request = data.get("request", {})
        request_fields = request.get("fields", {}) if isinstance(request, dict) else {}
        request_type = str(request.get("type", "") or "").strip()

        special_address = ""
        if request_type == SHARED_MAILBOX_REQUEST_TYPE:
            special_address = str(request.get("shared_mailbox", {}).get("email_address", "") or "").strip()
        elif request_type == DISTRIBUTION_GROUP_REQUEST_TYPE:
            special_address = str(request.get("distribution_group", {}).get("email_address", "") or "").strip()

        def token_value(*keys: str) -> str:
            for key in keys:
                value = str(request_fields.get(key, "") or "").strip()
                if value:
                    return value
            return ""

        placeholders = {
            "request_form": self.to_pretty_text(data),
            "name": token_value("name"),
            "title": token_value("title"),
            "address": special_address or token_value("address"),
            "property": token_value("property"),
            "effective_day": token_value("effective_day", "effective_date"),
            "request_type": request_type,
        }

        def apply_placeholders(template: str) -> str:
            output = template
            for key, value in placeholders.items():
                output = output.replace(f"{{{key}}}", value)
            return output

        email_to = str(self.settings.get("outlook_to", "") or "").strip()
        subject_template = str(self.settings.get("outlook_subject", "") or "").strip()
        if request_type == SHARED_MAILBOX_REQUEST_TYPE:
            subject_template = str(
                self.settings.get("outlook_subject_shared_mailbox", "{request_type}: {address}") or "{request_type}: {address}"
            ).strip()
        elif request_type == DISTRIBUTION_GROUP_REQUEST_TYPE:
            subject_template = str(
                self.settings.get("outlook_subject_distribution_group", "{request_type}: {address}") or "{request_type}: {address}"
            ).strip()
        body_template = str(self.settings.get("outlook_body_template", "{request_form}") or "{request_form}")
        subject = apply_placeholders(subject_template)
        body = apply_placeholders(body_template)

        mailto = f"mailto:{email_to}?subject={urllib.parse.quote(subject)}&body={urllib.parse.quote(body)}"
        try:
            if hasattr(os, "startfile"):
                os.startfile(mailto)
            else:
                raise RuntimeError("Opening Outlook email is only supported on Windows in this app build.")
            messagebox.showinfo("Outlook", f"Request saved to:\n{json_path}\n{txt_path}\n\nA new email draft was opened.")
        except Exception as ex:
            messagebox.showerror("Outlook", f"Request was saved, but Outlook draft could not be opened:\n{ex}")

    def to_pretty_text(self, data: dict) -> str:
        request = data["request"]
        fields = request.get("fields", {})
        field_labels = {item.get("id"): item.get("label", item.get("id")) for item in self.schema.get("fields", [])}
        lines = [
            f"{request['type']}",
        ]

        request_type = request.get("type")
        if request_type == SHARED_MAILBOX_REQUEST_TYPE:
            shared_mailbox = request.get("shared_mailbox", {})
            lines.append(f"Display Name: {str(shared_mailbox.get('display_name', '') or '').strip()}")
            lines.append(f"Shared Mailbox Email Address: {str(shared_mailbox.get('email_address', '') or '').strip()}")
            lines.append("")
            lines.append("Members:")
            for member in shared_mailbox.get("members", []):
                member_email = str(member.get("email", "") or "").strip()
                if not member_email:
                    continue
                permissions = member.get("permissions", {})
                permission_labels = []
                if bool(permissions.get("read_full_access", False)):
                    permission_labels.append("Read (Full Access)")
                if bool(permissions.get("send_on_behalf", False)):
                    permission_labels.append("Send on Behalf")
                if bool(permissions.get("send_as", False)):
                    permission_labels.append("Send As")
                suffix = f" [{', '.join(permission_labels)}]" if permission_labels else ""
                lines.append(f"  - {member_email}{suffix}")
        elif request_type == DISTRIBUTION_GROUP_REQUEST_TYPE:
            distribution_group = request.get("distribution_group", {})
            lines.append(f"Display Name: {str(distribution_group.get('display_name', '') or '').strip()}")
            lines.append(f"Distribution Group Email Address: {str(distribution_group.get('email_address', '') or '').strip()}")
            lines.append("")
            lines.append("Members:")
            for member in distribution_group.get("members", []):
                member_email = str(member.get("email", "") or "").strip()
                if member_email:
                    lines.append(f"  - {member_email}")
        else:
            for field in self.schema.get("fields", []):
                field_id = field.get("id")
                value = str(fields.get(field_id, "") or "").strip()
                if value:
                    lines.append(f"{field_labels.get(field_id, field_id)}: {value}")

            termination = request.get("termination", {})
            if request_type == "Termination":
                termination_lines = []
                forward_to = str(termination.get("forward_email_to", "") or "").strip()
                grant_access_to = str(termination.get("grant_full_access_to", "") or "").strip()
                if forward_to:
                    termination_lines.append(f"Forward Email To User: {forward_to}")
                if grant_access_to:
                    termination_lines.append(f"Grant Full Access Rights To User: {grant_access_to}")
                if termination_lines:
                    lines.append("")
                    lines.append("Termination Actions:")
                    lines.extend(termination_lines)

            lines.append("")
            for group in self.schema.get("groups", []):
                if not self.is_group_enabled(group):
                    continue
                group_id = group.get("id")
                group_data = data.get("access", {}).get(group_id, {"items": {}})
                enabled_lines = []
                for item in group.get("items", []):
                    item_id = item.get("id")
                    item_data = group_data.get("items", {}).get(item_id, {})
                    enabled = bool(item_data.get("enabled", False))
                    if enabled:
                        enabled_lines.append(f"  [X] {item.get('label', item_id)}")
                if enabled_lines:
                    lines.append(f"{group_data.get('title', group.get('title', group_id))}:")
                    lines.extend(enabled_lines)
                    lines.append("")

            for section in data.get("additional_property_access", []):
                property_name = str(section.get("property", "")).strip()
                if not property_name:
                    continue

                network_enabled_labels = [
                    item.get("label", item.get("id"))
                    for item in self.get_group_by_id("property_network").get("items", [])
                    if bool(section.get("network", {}).get(item.get("id"), False))
                ] if self.is_group_enabled(self.get_group_by_id("property_network")) else []
                mailbox_enabled_labels = [
                    item.get("label", item.get("id"))
                    for item in self.get_group_by_id("property_mailbox").get("items", [])
                    if bool(section.get("mailbox", {}).get(item.get("id"), False))
                ] if self.is_group_enabled(self.get_group_by_id("property_mailbox")) else []

                if network_enabled_labels:
                    lines.append(f"{self.format_property_access_title(property_name, 'Network Access')}:")
                    lines.extend([f"  [X] {label}" for label in network_enabled_labels])
                    lines.append("")

                if mailbox_enabled_labels:
                    lines.append(f"{self.format_property_access_title(property_name, 'Mailbox Access')}:")
                    lines.extend([f"  [X] {label}" for label in mailbox_enabled_labels])
                    lines.append("")

            if data.get("custom_fields"):
                custom_lines = []
                for field in self.custom_fields:
                    field_id = field.get("id", "")
                    label = field.get("label", field_id)
                    value = data["custom_fields"].get(field_id, "")
                    if isinstance(value, bool):
                        if value:
                            custom_lines.append(f"  [X] {label}")
                    else:
                        clean_value = str(value or "").strip()
                        if clean_value:
                            custom_lines.append(f"  {label}: {clean_value}")
                if custom_lines:
                    lines.append("")
                    lines.append(f"{self.custom_section_label}:")
                    lines.extend(custom_lines)

        lines.append("")
        lines.append(f"Saved By: {data['metadata']['saved_by']}")
        lines.append(f"Saved At: {data['metadata']['saved_at']}")
        while len(lines) > 1 and lines[-1] == "":
            lines.pop()
        return "\n".join(lines)

    def clear_form(self):
        request_types = self.schema.get("request_types", ["New Hire"])
        self.request_type.set(request_types[0] if request_types else "New Hire")
        for var in self.text_vars.values():
            var.set("")
        for key, var in self.checkbox_vars.items():
            item = self.group_meta.get(key, {}).get("item", {})
            var.set(bool(item.get("default_enabled", False)))
        for var in self.custom_vars.values():
            if isinstance(var, tk.BooleanVar):
                var.set(False)
            else:
                var.set("")
        for var in self.termination_vars.values():
            var.set("")
        for var in self.shared_mailbox_vars.values():
            var.set("")
        for var in self.distribution_group_vars.values():
            var.set("")
        self.shared_mailbox_members = []
        self.distribution_group_members = []
        self.additional_property_access_sections = []
        self.toggle_termination_section()
        self.rebuild_form_preserve_data()

    def load_previous_for_name(self):
        name_field_id = self.get_name_field_id()
        if not name_field_id:
            messagebox.showerror(
                "Name Field Missing",
                "No name field exists in the form. Add a name field in Edit Form Setup to use history lookup.",
            )
            return

        name = self.text_vars.get(name_field_id, tk.StringVar()).get().strip()
        if not name:
            messagebox.showerror("Missing Name", "Enter Name first, then click Load previous employee form data.")
            return

        files = sorted(self.requests_dir.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True)
        match = None
        for file in files:
            try:
                payload = json.loads(file.read_text(encoding="utf-8"))
            except Exception:
                continue
            candidate_name = self.extract_name(payload)
            if candidate_name.strip().lower() == name.lower():
                if self.request_type.get() == "Termination":
                    if payload.get("request", {}).get("type") in {"New Hire", "Rehire", "Promotion"}:
                        match = payload
                        break
                else:
                    match = payload
                    break

        if not match:
            messagebox.showinfo("Not Found", f"No previous request found for '{name}'.")
            return

        self.populate_from_payload(match)

        custom_data = match.get("custom_fields", {})
        for field in self.custom_fields:
            field_id = field.get("id", "")
            if field_id in self.custom_vars:
                self.custom_vars[field_id].set(custom_data.get(field_id, False if field.get("type") == "checkbox" else ""))

        messagebox.showinfo("Loaded", "Previous request data loaded for this employee.")

    def open_customizer(self):
        dialog = CustomFieldsDialog(self, self.custom_fields, self.custom_section_label)
        self.wait_window(dialog)
        if dialog.result is not None:
            self.custom_section_label = dialog.result.get("section_label", DEFAULT_CUSTOM_SECTION_LABEL)
            self.custom_fields = dialog.result.get("fields", [])
            self.save_custom_fields()
            self.render_form()

    def extract_name(self, payload: dict) -> str:
        request = payload.get("request", {})
        request_type = str(request.get("type", "") or "").strip()
        if request_type == SHARED_MAILBOX_REQUEST_TYPE:
            shared_mailbox = request.get("shared_mailbox", {})
            if isinstance(shared_mailbox, dict):
                return str(shared_mailbox.get("display_name", "") or "")
        if request_type == DISTRIBUTION_GROUP_REQUEST_TYPE:
            distribution_group = request.get("distribution_group", {})
            if isinstance(distribution_group, dict):
                return str(distribution_group.get("display_name", "") or "")
        if isinstance(request.get("fields"), dict):
            fields = request["fields"]
            if "name" in fields:
                return fields.get("name", "")
            for field_id, value in fields.items():
                if "name" in field_id.lower():
                    return value
            return ""
        return request.get("name", "")

    def get_name_field_id(self) -> str | None:
        field_ids = [field.get("id", "") for field in self.schema.get("fields", [])]
        if "name" in field_ids:
            return "name"
        for field_id in field_ids:
            if "name" in field_id.lower():
                return field_id
        return None

    def normalize_additional_property_access(self, payload: list) -> list[dict]:
        if not isinstance(payload, list):
            return []
        normalized = []
        for item in payload:
            if not isinstance(item, dict):
                continue
            property_name = str(item.get("property", "")).strip()
            if not property_name:
                continue
            network = item.get("network", {})
            mailbox = item.get("mailbox", {})
            normalized.append(
                {
                    "property_name": property_name,
                    "network_items": {str(k): bool(v) for k, v in network.items()} if isinstance(network, dict) else {},
                    "mailbox_items": {str(k): bool(v) for k, v in mailbox.items()} if isinstance(mailbox, dict) else {},
                }
            )
        return normalized

    def populate_from_payload(self, payload: dict):
        incoming_additional = self.normalize_additional_property_access(payload.get("additional_property_access", []))
        current_signature = [entry.get("property_name", "") for entry in self.additional_property_access_sections]
        incoming_signature = [entry.get("property_name", "") for entry in incoming_additional]
        if current_signature != incoming_signature:
            self.additional_property_access_sections = incoming_additional
            self.render_form()

        request = payload.get("request", {})
        incoming_request_type = str(request.get("type", "") or "").strip()
        if incoming_request_type and self.request_type.get() != incoming_request_type:
            self.request_type.set(incoming_request_type)
            self.render_form()

        request_fields = request.get("fields")

        if isinstance(request_fields, dict):
            for field_id, value in request_fields.items():
                if field_id in self.text_vars:
                    if field_id == "effective_date":
                        normalized = normalize_effective_date(str(value))
                        self.text_vars[field_id].set(normalized or str(value))
                    else:
                        self.text_vars[field_id].set(value)
        else:
            legacy_map = {
                "effective_date": request.get("effective_date", ""),
                "name": request.get("name", ""),
                "cell_phone": request.get("cell_phone", ""),
                "address": request.get("address", ""),
                "property": request.get("property", ""),
                "department": request.get("department", ""),
                "sub_department": request.get("sub_department", ""),
                "title": request.get("title", ""),
                "manager": request.get("manager", ""),
            }
            for field_id, value in legacy_map.items():
                if field_id in self.text_vars:
                    if field_id == "effective_date":
                        normalized = normalize_effective_date(str(value))
                        self.text_vars[field_id].set(normalized or str(value))
                    else:
                        self.text_vars[field_id].set(value)

        termination = request.get("termination", {}) if isinstance(request, dict) else {}
        self.termination_vars["forward_email_to"].set(termination.get("forward_email_to", ""))
        self.termination_vars["grant_full_access_to"].set(termination.get("grant_full_access_to", ""))

        shared_mailbox = request.get("shared_mailbox", {}) if isinstance(request, dict) else {}
        if isinstance(shared_mailbox, dict):
            self.shared_mailbox_vars["display_name"].set(str(shared_mailbox.get("display_name", "") or ""))
            self.shared_mailbox_vars["email_address"].set(str(shared_mailbox.get("email_address", "") or ""))
            loaded_members = []
            for member in shared_mailbox.get("members", []):
                if not isinstance(member, dict):
                    continue
                permissions = member.get("permissions", {}) if isinstance(member.get("permissions", {}), dict) else {}
                loaded_members.append(
                    self.new_shared_mailbox_member(
                        {
                            "email": member.get("email", ""),
                            "full_access": bool(permissions.get("read_full_access", False)),
                            "send_on_behalf": bool(permissions.get("send_on_behalf", False)),
                            "send_as": bool(permissions.get("send_as", False)),
                        }
                    )
                )
            self.shared_mailbox_members = loaded_members
        else:
            self.shared_mailbox_vars["display_name"].set("")
            self.shared_mailbox_vars["email_address"].set("")
            self.shared_mailbox_members = []

        distribution_group = request.get("distribution_group", {}) if isinstance(request, dict) else {}
        if isinstance(distribution_group, dict):
            self.distribution_group_vars["display_name"].set(str(distribution_group.get("display_name", "") or ""))
            self.distribution_group_vars["email_address"].set(str(distribution_group.get("email_address", "") or ""))
            loaded_members = []
            for member in distribution_group.get("members", []):
                if not isinstance(member, dict):
                    continue
                loaded_members.append(self.new_distribution_group_member({"email": member.get("email", "")}))
            self.distribution_group_members = loaded_members
        else:
            self.distribution_group_vars["display_name"].set("")
            self.distribution_group_vars["email_address"].set("")
            self.distribution_group_members = []

        access = payload.get("access", {})
        if self.is_legacy_access_structure(access):
            legacy_group_map = {
                "system_web": "system_web",
                "email_groups": "email_groups",
                "property_network": "property_network",
                "property_mailbox": "property_mailbox",
            }
            for group in self.schema.get("groups", []):
                if not self.is_group_enabled(group):
                    continue
                gid = group.get("id")
                legacy_section = access.get(legacy_group_map.get(gid, gid), {})
                for item in group.get("items", []):
                    item_id = item.get("id")
                    label = item.get("label")
                    key = f"{gid}.{item_id}"
                    if key in self.checkbox_vars:
                        self.checkbox_vars[key].set(bool(legacy_section.get(label, False)))
        else:
            for group in self.schema.get("groups", []):
                if not self.is_group_enabled(group):
                    continue
                gid = group.get("id")
                section = access.get(gid, {})
                items = section.get("items", {})
                for item in group.get("items", []):
                    item_id = item.get("id")
                    key = f"{gid}.{item_id}"
                    if key in self.checkbox_vars:
                        self.checkbox_vars[key].set(bool(items.get(item_id, {}).get("enabled", False)))

        for idx, section in enumerate(incoming_additional):
            if idx >= len(self.additional_property_access_sections):
                break
            target = self.additional_property_access_sections[idx]
            for item_id, enabled in section.get("network_items", {}).items():
                var = target.get("_network_vars", {}).get(item_id)
                if var is not None:
                    var.set(bool(enabled))
            for item_id, enabled in section.get("mailbox_items", {}).items():
                var = target.get("_mailbox_vars", {}).get(item_id)
                if var is not None:
                    var.set(bool(enabled))

        self.toggle_termination_section()

    def open_requests_folder(self):
        self.requests_dir.mkdir(parents=True, exist_ok=True)
        try:
            if hasattr(os, "startfile"):
                os.startfile(str(self.requests_dir))
            else:
                messagebox.showinfo("Folder Path", str(self.requests_dir))
        except Exception as ex:
            messagebox.showerror("Open Folder Failed", f"Could not open folder:\n{ex}")

    def open_app_data_folder(self):
        APP_HOME_DIR.mkdir(parents=True, exist_ok=True)
        try:
            if hasattr(os, "startfile"):
                os.startfile(str(APP_HOME_DIR))
            else:
                messagebox.showinfo("Folder Path", str(APP_HOME_DIR))
        except Exception as ex:
            messagebox.showerror("Open Folder Failed", f"Could not open folder:\n{ex}")

    def backup_data(self):
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        default_name = f"IT_Request_Form_Backup_{timestamp}.zip"
        output_path = filedialog.asksaveasfilename(
            title="Save Backup",
            defaultextension=".zip",
            initialfile=default_name,
            filetypes=[("ZIP files", "*.zip")],
        )
        if not output_path:
            return

        try:
            self.requests_dir.mkdir(parents=True, exist_ok=True)
            APP_HOME_DIR.mkdir(parents=True, exist_ok=True)

            manifest = {
                "created_at": now_iso(),
                "app_home_dir": str(APP_HOME_DIR),
                "requests_dir": str(self.requests_dir),
            }

            with zipfile.ZipFile(output_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
                config_targets = {
                    "config/settings.json": SETTINGS_FILE,
                    "config/form_schema.json": FORM_SCHEMA_FILE,
                    "config/custom_fields.json": CUSTOM_FIELDS_FILE,
                }
                for arc_name, source_path in config_targets.items():
                    if source_path.exists():
                        archive.write(source_path, arcname=arc_name)

                for file_path in self.requests_dir.rglob("*"):
                    if not file_path.is_file():
                        continue
                    rel_path = file_path.relative_to(self.requests_dir).as_posix()
                    archive.write(file_path, arcname=f"requests/{rel_path}")

                archive.writestr("backup_manifest.json", json.dumps(manifest, indent=2))

            messagebox.showinfo("Backup Complete", f"Backup created:\n{output_path}")
        except Exception as ex:
            messagebox.showerror("Backup Failed", f"Could not create backup:\n{ex}")

    def restore_data(self):
        input_path = filedialog.askopenfilename(
            title="Restore Backup",
            filetypes=[("ZIP files", "*.zip")],
        )
        if not input_path:
            return

        if not messagebox.askyesno(
            "Confirm Restore",
            "Restore config and requests from this backup? Existing config will be replaced.",
        ):
            return

        try:
            self.requests_dir.mkdir(parents=True, exist_ok=True)
            CONFIG_DIR.mkdir(parents=True, exist_ok=True)

            with zipfile.ZipFile(input_path, "r") as archive:
                config_targets = {
                    "config/settings.json": SETTINGS_FILE,
                    "config/form_schema.json": FORM_SCHEMA_FILE,
                    "config/custom_fields.json": CUSTOM_FIELDS_FILE,
                }

                for arc_name, target_path in config_targets.items():
                    try:
                        payload = archive.read(arc_name)
                    except KeyError:
                        continue
                    target_path.parent.mkdir(parents=True, exist_ok=True)
                    target_path.write_bytes(payload)

                for member in archive.infolist():
                    name = member.filename.replace("\\", "/")
                    if member.is_dir() or not name.startswith("requests/"):
                        continue

                    relative_name = name[len("requests/"):]
                    if not relative_name:
                        continue

                    rel_parts = Path(relative_name).parts
                    if any(part in ("", ".", "..") for part in rel_parts):
                        continue

                    destination = self.requests_dir.joinpath(*rel_parts)
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    with archive.open(member, "r") as src:
                        destination.write_bytes(src.read())

            self.settings = self.load_settings()
            self.settings["requests_dir"] = str(self.requests_dir)
            self.save_settings()

            self.schema = self.load_schema()
            self.custom_section_label, self.custom_fields = self.load_custom_fields()
            self.refresh_known_value_cache()
            self.render_form()

            messagebox.showinfo("Restore Complete", "Backup restored successfully.")
        except Exception as ex:
            messagebox.showerror("Restore Failed", f"Could not restore backup:\n{ex}")

    def is_legacy_access_structure(self, access: dict) -> bool:
        if not isinstance(access, dict):
            return True
        first_value = next(iter(access.values()), None)
        return isinstance(first_value, dict) and "items" not in first_value

    def open_form_setup(self):
        dialog = FormSetupDialog(self, self.schema)
        self.wait_window(dialog)
        if dialog.result is not None:
            self.schema = dialog.result
            self.refresh_known_value_cache()
            self.save_schema()
            self.render_form()

    def open_settings(self):
        dialog = tk.Toplevel(self)
        dialog.title("Settings")
        dialog.geometry("780x620")
        dialog.configure(bg="#f4f7fb")
        dialog.transient(self)
        dialog.grab_set()
        dialog.columnconfigure(1, weight=1)

        ttk.Label(dialog, text="Storage Root Folder (config + data):").grid(row=0, column=0, sticky="w", padx=12, pady=(14, 8))
        storage_root_var = tk.StringVar(value=str(STORAGE_ROOT_DIR))
        storage_entry = ttk.Entry(dialog, textvariable=storage_root_var)
        storage_entry.grid(row=0, column=1, sticky="ew", padx=(0, 8), pady=(14, 8))

        def browse_storage_root():
            selected = filedialog.askdirectory(initialdir=storage_root_var.get() or str(STORAGE_ROOT_DIR))
            if selected:
                storage_root_var.set(selected)

        def test_storage_root_access():
            chosen_root = storage_root_var.get().strip()
            if not chosen_root:
                messagebox.showerror("Missing Storage Root", "Select a storage root folder first.", parent=dialog)
                return

            target_dir = Path(chosen_root)
            test_file = target_dir / ".storage_access_test"
            sample = f"test:{now_iso()}"

            try:
                target_dir.mkdir(parents=True, exist_ok=True)
                test_file.write_text(sample, encoding="utf-8")
                read_back = test_file.read_text(encoding="utf-8")
                if read_back != sample:
                    raise ValueError("Read/write verification failed.")
                test_file.unlink(missing_ok=True)
                messagebox.showinfo("Storage Access", "Success: folder is readable and writable.", parent=dialog)
            except Exception as ex:
                messagebox.showerror("Storage Access", f"Access test failed:\n{ex}", parent=dialog)

        ttk.Button(dialog, text="Browse", command=browse_storage_root, style="Action.TButton").grid(row=0, column=2, padx=(0, 12), pady=(14, 8))

        ttk.Label(dialog, text="Config is saved to <Storage Root>\\config and data to <Storage Root>\\data\\requests.").grid(
            row=1, column=0, columnspan=2, sticky="w", padx=12, pady=(0, 10)
        )
        ttk.Button(dialog, text="Test Access", command=test_storage_root_access, style="Action.TButton").grid(row=1, column=2, padx=(0, 12), pady=(0, 10))

        ttk.Label(dialog, text="Request Save Folder:").grid(row=2, column=0, sticky="w", padx=12, pady=(0, 8))
        path_var = tk.StringVar(value=str(self.requests_dir))
        entry = ttk.Entry(dialog, textvariable=path_var)
        entry.grid(row=2, column=1, sticky="ew", padx=(0, 8), pady=(0, 8))

        def browse():
            selected = filedialog.askdirectory(initialdir=path_var.get() or str(APP_HOME_DIR))
            if selected:
                path_var.set(selected)

        ttk.Button(dialog, text="Browse", command=browse, style="Action.TButton").grid(row=2, column=2, padx=(0, 12), pady=(0, 8))

        ttk.Label(dialog, text="This path persists after the app is closed.").grid(
            row=3, column=0, columnspan=3, sticky="w", padx=12, pady=(0, 10)
        )

        auto_open_var = tk.BooleanVar(value=bool(self.settings.get("auto_open_text_on_save", True)))
        auto_open_check = ttk.Checkbutton(
            dialog,
            text="Auto-open saved text file after Save Request",
            variable=auto_open_var,
        )
        auto_open_check.grid(row=4, column=0, columnspan=3, sticky="w", padx=12, pady=(0, 10))

        self.register_help(auto_open_check, "When enabled, each saved request text file opens automatically.")

        ttk.Separator(dialog).grid(row=5, column=0, columnspan=3, sticky="ew", padx=12, pady=(4, 10))

        ttk.Label(dialog, text="Outlook Email Settings:").grid(row=6, column=0, columnspan=3, sticky="w", padx=12, pady=(0, 6))

        outlook_to_var = tk.StringVar(value=str(self.settings.get("outlook_to", "")))
        ttk.Label(dialog, text="To:").grid(row=7, column=0, sticky="w", padx=12, pady=(0, 6))
        ttk.Entry(dialog, textvariable=outlook_to_var).grid(row=7, column=1, columnspan=2, sticky="ew", padx=(0, 12), pady=(0, 6))

        outlook_subject_var = tk.StringVar(value=str(self.settings.get("outlook_subject", "")))
        ttk.Label(dialog, text="Subject:").grid(row=8, column=0, sticky="w", padx=12, pady=(0, 6))
        ttk.Entry(dialog, textvariable=outlook_subject_var).grid(row=8, column=1, columnspan=2, sticky="ew", padx=(0, 12), pady=(0, 6))

        outlook_subject_shared_var = tk.StringVar(
            value=str(self.settings.get("outlook_subject_shared_mailbox", "{request_type}: {address}"))
        )
        ttk.Label(dialog, text="Subject (New Shared Mailbox):").grid(row=9, column=0, sticky="w", padx=12, pady=(0, 6))
        ttk.Entry(dialog, textvariable=outlook_subject_shared_var).grid(
            row=9, column=1, columnspan=2, sticky="ew", padx=(0, 12), pady=(0, 6)
        )

        outlook_subject_distro_var = tk.StringVar(
            value=str(self.settings.get("outlook_subject_distribution_group", "{request_type}: {address}"))
        )
        ttk.Label(dialog, text="Subject (New Distribution Group):").grid(row=10, column=0, sticky="w", padx=12, pady=(0, 6))
        ttk.Entry(dialog, textvariable=outlook_subject_distro_var).grid(
            row=10, column=1, columnspan=2, sticky="ew", padx=(0, 12), pady=(0, 6)
        )

        ttk.Label(
            dialog,
            text="Subject placeholders: {name}, {title}, {address}, {property}, {effective_day}, {request_type} (special request types use the dedicated subject fields above)",
        ).grid(row=11, column=0, columnspan=3, sticky="w", padx=12, pady=(0, 6))

        ttk.Label(dialog, text="Body Template ({request_form} inserts form output):").grid(
            row=12, column=0, columnspan=3, sticky="w", padx=12, pady=(0, 4)
        )
        outlook_body_text = tk.Text(
            dialog,
            height=8,
            relief="flat",
            borderwidth=0,
            highlightthickness=1,
            highlightbackground="#e2e8f0",
            highlightcolor="#93c5fd",
            background="#ffffff",
            font=("Segoe UI", 10),
        )
        outlook_body_text.grid(row=13, column=0, columnspan=3, sticky="nsew", padx=12, pady=(0, 10))
        outlook_body_text.insert("1.0", str(self.settings.get("outlook_body_template", "{request_form}")))

        ttk.Separator(dialog).grid(row=14, column=0, columnspan=3, sticky="ew", padx=12, pady=(4, 10))
        ttk.Label(dialog, text="Data & Form Actions:").grid(row=15, column=0, columnspan=3, sticky="w", padx=12, pady=(0, 6))

        action_frame = ttk.Frame(dialog)
        action_frame.grid(row=16, column=0, columnspan=3, sticky="ew", padx=12, pady=(0, 10))
        action_frame.columnconfigure(0, weight=1)
        action_frame.columnconfigure(1, weight=1)

        def launch_action(callback):
            dialog.destroy()
            callback()

        ttk.Button(action_frame, text="Edit Form Setup", command=lambda: launch_action(self.open_form_setup)).grid(
            row=0, column=0, sticky="ew", padx=(0, 6), pady=(0, 6)
        )
        ttk.Button(action_frame, text="Customize Extra Fields", command=lambda: launch_action(self.open_customizer)).grid(
            row=0, column=1, sticky="ew", padx=(6, 0), pady=(0, 6)
        )
        ttk.Button(action_frame, text="Backup Data", command=lambda: launch_action(self.backup_data)).grid(
            row=1, column=0, sticky="ew", padx=(0, 6)
        )
        ttk.Button(action_frame, text="Restore Data", command=lambda: launch_action(self.restore_data)).grid(
            row=1, column=1, sticky="ew", padx=(6, 0)
        )

        footer = ttk.Frame(dialog)
        footer.grid(row=17, column=0, columnspan=3, sticky="ew", padx=12, pady=(0, 12))

        def save_and_close():
            chosen_root = storage_root_var.get().strip()
            if not chosen_root:
                messagebox.showerror("Missing Storage Root", "Select a storage root folder.", parent=dialog)
                return

            try:
                new_storage_root = Path(chosen_root)
                new_storage_root.mkdir(parents=True, exist_ok=True)
            except Exception as ex:
                messagebox.showerror("Invalid Storage Root", f"Cannot use storage root:\n{ex}", parent=dialog)
                return

            chosen = path_var.get().strip()
            if not chosen:
                chosen = str(new_storage_root / "data" / "requests")

            try:
                new_path = Path(chosen)
                new_path.mkdir(parents=True, exist_ok=True)
            except Exception as ex:
                messagebox.showerror("Invalid Folder", f"Cannot use folder:\n{ex}", parent=dialog)
                return

            self.migrate_storage_root(new_storage_root)

            self.requests_dir = new_path
            self.settings["requests_dir"] = str(new_path)
            self.settings["auto_open_text_on_save"] = bool(auto_open_var.get())
            self.settings["outlook_to"] = outlook_to_var.get().strip()
            self.settings["outlook_subject"] = outlook_subject_var.get().strip()
            self.settings["outlook_subject_shared_mailbox"] = outlook_subject_shared_var.get().strip() or "{request_type}: {address}"
            self.settings["outlook_subject_distribution_group"] = outlook_subject_distro_var.get().strip() or "{request_type}: {address}"
            body_template = outlook_body_text.get("1.0", tk.END).strip()
            self.settings["outlook_body_template"] = body_template or "{request_form}"
            self.save_settings()
            messagebox.showinfo("Saved", "Settings saved.", parent=dialog)
            dialog.destroy()

        ttk.Button(footer, text="Cancel", command=dialog.destroy, style="Secondary.Header.TButton").pack(side="right")
        ttk.Button(footer, text="Save Settings", command=save_and_close, style="Primary.Header.TButton").pack(side="right", padx=(0, 8))


class FormSetupDialog(tk.Toplevel):
    def __init__(self, parent: ITRequestApp, schema: dict):
        super().__init__(parent)
        self.title("Edit Form Setup")
        self.geometry("980x740")
        self.minsize(860, 620)
        self.configure(bg="#f4f7fb")
        self.transient(parent)
        self.grab_set()

        style = ttk.Style(self)
        style.configure("Dialog.TNotebook", background="#f4f7fb", borderwidth=0)
        style.configure("Dialog.TNotebook.Tab", padding=(14, 8), font=("Segoe UI", 10))
        style.map("Dialog.TNotebook.Tab", background=[("selected", "#ffffff"), ("active", "#f8fafc")])

        self.schema = deepcopy(schema)
        self.working_fields = deepcopy(self.schema.get("fields", []))
        self.result = None

        self.columnconfigure(0, weight=1)
        self.rowconfigure(0, weight=1)

        notebook = ttk.Notebook(self, style="Dialog.TNotebook")
        notebook.grid(row=0, column=0, sticky="nsew", padx=12, pady=12)

        self.general_tab = ttk.Frame(notebook)
        self.fields_tab = ttk.Frame(notebook)
        self.access_tab = ttk.Frame(notebook)
        self.autofill_tab = ttk.Frame(notebook)
        notebook.add(self.general_tab, text="General")
        notebook.add(self.fields_tab, text="Main Fields")
        notebook.add(self.access_tab, text="Access Groups")
        notebook.add(self.autofill_tab, text="AutoFill")

        self.build_general_tab()
        self.build_fields_tab()
        self.build_access_tab()
        self.build_autofill_tab()

        footer = ttk.Frame(self)
        footer.grid(row=1, column=0, sticky="ew", padx=12, pady=(0, 12))
        ttk.Button(footer, text="Cancel", command=self.destroy, style="Secondary.Header.TButton").pack(side="right")
        ttk.Button(footer, text="Save Setup", command=self.save, style="Primary.Header.TButton").pack(side="right", padx=(0, 8))

    def build_general_tab(self):
        self.general_tab.columnconfigure(1, weight=1)

        ttk.Label(self.general_tab, text="Form Name:").grid(row=0, column=0, sticky="w", padx=10, pady=(10, 5))
        self.form_name_var = tk.StringVar(value=self.schema.get("form_name", "IT Request Form"))
        ttk.Entry(self.general_tab, textvariable=self.form_name_var).grid(row=0, column=1, sticky="ew", padx=10, pady=(10, 5))

        ttk.Label(self.general_tab, text="Request Types (one per line):").grid(
            row=1, column=0, sticky="nw", padx=10, pady=(8, 5)
        )
        self.request_types_text = tk.Text(
            self.general_tab,
            height=8,
            relief="flat",
            borderwidth=0,
            highlightthickness=1,
            highlightbackground="#e2e8f0",
            highlightcolor="#93c5fd",
            background="#ffffff",
            font=("Segoe UI", 10),
        )
        self.request_types_text.grid(row=1, column=1, sticky="nsew", padx=10, pady=(8, 5))
        self.general_tab.rowconfigure(1, weight=1)

        self.request_types_text.insert("1.0", "\n".join(self.schema.get("request_types", [])))

    def build_fields_tab(self):
        self.fields_tab.columnconfigure(0, weight=1)
        self.fields_tab.rowconfigure(0, weight=1)

        self.fields_listbox = tk.Listbox(
            self.fields_tab,
            exportselection=False,
            relief="flat",
            borderwidth=0,
            highlightthickness=1,
            highlightbackground="#e2e8f0",
            highlightcolor="#93c5fd",
            background="#ffffff",
            selectbackground="#dbeafe",
            selectforeground="#0f172a",
            font=("Segoe UI", 10),
        )
        self.fields_listbox.grid(row=0, column=0, sticky="nsew", padx=10, pady=(10, 8))

        control = ttk.Frame(self.fields_tab)
        control.grid(row=1, column=0, sticky="ew", padx=10, pady=(0, 10))
        ttk.Button(control, text="Add Field", command=self.add_main_field, style="Action.TButton").pack(side="left", padx=(0, 8))
        ttk.Button(control, text="Edit Selected", command=self.edit_main_field, style="Action.TButton").pack(side="left", padx=(0, 8))
        ttk.Button(control, text="Remove Selected", command=self.remove_main_field, style="Action.TButton").pack(side="left")

        help_label = ttk.Label(
            self.fields_tab,
            text="Tip: keep a field with id 'name' to support history lookup and filename naming.",
        )
        help_label.grid(row=2, column=0, sticky="w", padx=10, pady=(0, 8))

        self.refresh_fields_listbox()

    def refresh_fields_listbox(self):
        self.fields_listbox.delete(0, tk.END)
        for field in self.working_fields:
            self.fields_listbox.insert(
                tk.END,
                f"{field.get('label', 'Field')} [{field.get('id', 'id')}] ({field.get('type', 'text')})",
            )

    def add_main_field(self):
        self.open_main_field_editor()

    def edit_main_field(self):
        index = self.fields_listbox.curselection()
        if not index:
            messagebox.showinfo("Select Field", "Select a field to edit.", parent=self)
            return
        self.open_main_field_editor(index[0])

    def remove_main_field(self):
        index = self.fields_listbox.curselection()
        if not index:
            return
        self.working_fields.pop(index[0])
        self.refresh_fields_listbox()

    def open_main_field_editor(self, edit_index: int | None = None):
        is_edit = edit_index is not None
        existing = self.working_fields[edit_index] if is_edit else {}

        window = tk.Toplevel(self)
        window.title("Edit Main Field" if is_edit else "Add Main Field")
        window.geometry("460x300")
        window.configure(bg="#f4f7fb")
        window.transient(self)
        window.grab_set()
        window.columnconfigure(0, weight=1)

        content = ttk.Frame(window, style="Card.TFrame", padding=(14, 12))
        content.grid(row=0, column=0, sticky="nsew", padx=10, pady=10)
        content.columnconfigure(0, weight=1)

        ttk.Label(content, text="Field Label").grid(row=0, column=0, sticky="w", pady=(2, 4))
        label_var = tk.StringVar(value=existing.get("label", ""))
        ttk.Entry(content, textvariable=label_var).grid(row=1, column=0, sticky="ew")

        ttk.Label(content, text="Field Key (id)").grid(row=2, column=0, sticky="w", pady=(10, 4))
        default_id = existing.get("id", slugify(existing.get("label", "") or "field"))
        id_var = tk.StringVar(value=default_id)
        ttk.Entry(content, textvariable=id_var).grid(row=3, column=0, sticky="ew")

        ttk.Label(content, text="Field Type").grid(row=4, column=0, sticky="w", pady=(10, 4))
        type_var = tk.StringVar(value=existing.get("type", "text"))
        ttk.Combobox(content, textvariable=type_var, values=["text", "date"], state="readonly").grid(
            row=5, column=0, sticky="ew"
        )

        ttk.Label(content, text="Description").grid(row=6, column=0, sticky="w", pady=(10, 4))
        desc_var = tk.StringVar(value=existing.get("description", ""))
        ttk.Entry(content, textvariable=desc_var).grid(row=7, column=0, sticky="ew")

        def save_and_close():
            label = label_var.get().strip()
            field_id = slugify(id_var.get().strip() or label)
            if not label:
                messagebox.showerror("Missing Label", "Field label is required.", parent=window)
                return
            if not field_id:
                messagebox.showerror("Missing Key", "Field key is required.", parent=window)
                return

            for idx, field in enumerate(self.working_fields):
                if idx != (edit_index if is_edit else -1) and field.get("id") == field_id:
                    messagebox.showerror("Duplicate Key", "Another main field already uses this key.", parent=window)
                    return

            payload = {
                "id": field_id,
                "label": label,
                "description": desc_var.get().strip() or f"Enter value for {label}.",
                "type": type_var.get(),
            }

            if is_edit:
                self.working_fields[edit_index] = payload
            else:
                self.working_fields.append(payload)

            self.refresh_fields_listbox()
            window.destroy()

        ttk.Button(content, text="Save", command=save_and_close, style="Primary.Header.TButton").grid(row=8, column=0, sticky="e", pady=(12, 2))

    def build_access_tab(self):
        self.access_tab.columnconfigure(0, weight=1)
        self.access_tab.rowconfigure(0, weight=1)

        canvas = tk.Canvas(self.access_tab, highlightthickness=0, bg="#f4f7fb")
        scrollbar = ttk.Scrollbar(self.access_tab, orient="vertical", command=canvas.yview)
        wrapper = ttk.Frame(canvas)

        wrapper.bind("<Configure>", lambda _e: canvas.configure(scrollregion=canvas.bbox("all")))
        canvas.create_window((0, 0), window=wrapper, anchor="nw")
        canvas.configure(yscrollcommand=scrollbar.set)

        canvas.grid(row=0, column=0, sticky="nsew")
        scrollbar.grid(row=0, column=1, sticky="ns")

        self.group_title_vars = {}
        self.group_items_text = {}
        self.group_enabled_vars = {}
        self.group_order_ids = [str(group.get("id", "group")) for group in self.schema.get("groups", [])]
        self.group_order_drag_index = None

        order_frame = ttk.LabelFrame(wrapper, text="Group Display Order")
        order_frame.grid(row=0, column=0, sticky="ew", padx=10, pady=(10, 6))
        order_frame.columnconfigure(0, weight=1)

        ttk.Label(order_frame, text="Drag groups to reorder how they appear on the form:").grid(
            row=0, column=0, sticky="w", padx=8, pady=(8, 4)
        )

        self.group_order_listbox = tk.Listbox(
            order_frame,
            exportselection=False,
            height=min(max(len(self.group_order_ids), 4), 12),
            relief="flat",
            borderwidth=0,
            highlightthickness=1,
            highlightbackground="#e2e8f0",
            highlightcolor="#93c5fd",
            background="#ffffff",
            selectbackground="#dbeafe",
            selectforeground="#0f172a",
            activestyle="none",
            font=("Segoe UI", 10),
        )
        self.group_order_listbox.grid(row=1, column=0, sticky="ew", padx=8, pady=(0, 8))
        self.group_order_listbox.bind("<Button-1>", self.on_group_order_drag_start)
        self.group_order_listbox.bind("<B1-Motion>", self.on_group_order_drag_motion)
        self.group_order_listbox.bind("<ButtonRelease-1>", self.on_group_order_drag_end)

        self.refresh_group_order_listbox()

        row = 1
        for group in self.schema.get("groups", []):
            frame = ttk.LabelFrame(wrapper, text=group.get("id", "group"))
            frame.grid(row=row, column=0, sticky="ew", padx=10, pady=8)
            frame.columnconfigure(1, weight=1)

            gid = group.get("id", "group")
            enabled_var = tk.BooleanVar(value=bool(group.get("enabled", True)))
            self.group_enabled_vars[gid] = enabled_var
            ttk.Checkbutton(frame, text="Enabled on form", variable=enabled_var).grid(
                row=0, column=0, columnspan=2, sticky="w", padx=8, pady=(8, 4)
            )

            title_var = tk.StringVar(value=group.get("title", gid))
            self.group_title_vars[gid] = title_var
            ttk.Label(frame, text="Group Title:").grid(row=1, column=0, sticky="w", padx=8, pady=(4, 4))
            ttk.Entry(frame, textvariable=title_var).grid(row=1, column=1, sticky="ew", padx=8, pady=(4, 4))

            ttk.Label(frame, text="Items (one label per line):").grid(row=2, column=0, sticky="nw", padx=8, pady=(4, 8))
            text = tk.Text(
                frame,
                height=6,
                relief="flat",
                borderwidth=0,
                highlightthickness=1,
                highlightbackground="#e2e8f0",
                highlightcolor="#93c5fd",
                background="#ffffff",
                font=("Segoe UI", 10),
            )
            text.grid(row=2, column=1, sticky="ew", padx=8, pady=(4, 8))
            lines = []
            for item in group.get("items", []):
                label = item.get("label", "")
                if item.get("default_enabled", False):
                    lines.append(f"{label} {{default}}")
                else:
                    lines.append(label)
            text.insert("1.0", "\n".join(lines))
            self.group_items_text[gid] = text
            row += 1

        ttk.Label(
            self.access_tab,
            text="Tip: add {default} at the end of an item to have it checked by default and preserved on Clear Form.",
        ).grid(row=1, column=0, sticky="w", padx=10, pady=(0, 10))

    def refresh_group_order_listbox(self):
        if not hasattr(self, "group_order_listbox"):
            return

        self.group_order_listbox.delete(0, tk.END)
        groups_by_id = {str(group.get("id", "group")): group for group in self.schema.get("groups", [])}
        for group_id in self.group_order_ids:
            group = groups_by_id.get(group_id, {})
            title = str(group.get("title", group_id)).strip() or group_id
            self.group_order_listbox.insert(tk.END, f"{title} ({group_id})")

    def on_group_order_drag_start(self, event):
        index = self.group_order_listbox.nearest(event.y)
        if 0 <= index < len(self.group_order_ids):
            self.group_order_drag_index = index
            self.group_order_listbox.selection_clear(0, tk.END)
            self.group_order_listbox.selection_set(index)

    def on_group_order_drag_motion(self, event):
        if self.group_order_drag_index is None:
            return

        target_index = self.group_order_listbox.nearest(event.y)
        if not (0 <= target_index < len(self.group_order_ids)):
            return
        if target_index == self.group_order_drag_index:
            return

        moving_group_id = self.group_order_ids.pop(self.group_order_drag_index)
        self.group_order_ids.insert(target_index, moving_group_id)
        self.group_order_drag_index = target_index
        self.refresh_group_order_listbox()
        self.group_order_listbox.selection_set(target_index)

    def on_group_order_drag_end(self, _event):
        self.group_order_drag_index = None

    def build_autofill_tab(self):
        self.autofill_tab.columnconfigure(1, weight=1)
        self.autofill_tab.rowconfigure(9, weight=1)

        self.known_values_text = {}
        known_values = self.schema.get("known_values", default_known_values())
        fields = [
            ("address", "Address values"),
            ("property", "Property values"),
            ("department", "Department values"),
            ("sub_department", "Sub-Department values"),
            ("title", "Title values"),
        ]

        row = 0
        for field_id, label in fields:
            ttk.Label(self.autofill_tab, text=f"{label} (one per line):").grid(
                row=row, column=0, sticky="nw", padx=10, pady=(10 if row == 0 else 8, 4)
            )
            text = tk.Text(
                self.autofill_tab,
                height=4,
                relief="flat",
                borderwidth=0,
                highlightthickness=1,
                highlightbackground="#e2e8f0",
                highlightcolor="#93c5fd",
                background="#ffffff",
                font=("Segoe UI", 10),
            )
            text.grid(row=row, column=1, sticky="ew", padx=10, pady=(10 if row == 0 else 8, 4))
            text.insert("1.0", "\n".join(known_values.get(field_id, [])))
            self.known_values_text[field_id] = text
            row += 1

        ttk.Separator(self.autofill_tab).grid(row=row, column=0, columnspan=2, sticky="ew", padx=10, pady=(10, 8))
        row += 1

        ttk.Label(self.autofill_tab, text="Property-Address links (Property | Address):").grid(
            row=row, column=0, sticky="nw", padx=10, pady=(0, 4)
        )
        self.property_address_links_text = tk.Text(
            self.autofill_tab,
            height=8,
            relief="flat",
            borderwidth=0,
            highlightthickness=1,
            highlightbackground="#e2e8f0",
            highlightcolor="#93c5fd",
            background="#ffffff",
            font=("Segoe UI", 10),
        )
        self.property_address_links_text.grid(row=row, column=1, sticky="nsew", padx=10, pady=(0, 8))
        link_lines = []
        for item in self.schema.get("property_address_links", []):
            property_name = str(item.get("property", "")).strip()
            address = str(item.get("address", "")).strip()
            if property_name and address:
                link_lines.append(f"{property_name} | {address}")
        self.property_address_links_text.insert("1.0", "\n".join(link_lines))

    def save(self):
        name = self.form_name_var.get().strip()
        if not name:
            messagebox.showerror("Missing Form Name", "Form Name is required.", parent=self)
            return

        request_types = [line.strip() for line in self.request_types_text.get("1.0", tk.END).splitlines() if line.strip()]
        if not request_types:
            messagebox.showerror("Missing Request Types", "At least one request type is required.", parent=self)
            return

        self.schema["form_name"] = name
        self.schema["request_types"] = request_types
        self.schema["fields"] = self.working_fields

        groups = self.schema.get("groups", [])
        groups_by_id = {str(group.get("id", "group")): group for group in groups}
        ordered_groups = [groups_by_id[group_id] for group_id in self.group_order_ids if group_id in groups_by_id]
        for group in groups:
            group_id = str(group.get("id", "group"))
            if group_id not in self.group_order_ids:
                ordered_groups.append(group)
        self.schema["groups"] = ordered_groups

        for group in self.schema.get("groups", []):
            gid = group.get("id")
            group["enabled"] = bool(self.group_enabled_vars[gid].get())
            group["title"] = self.group_title_vars[gid].get().strip() or gid

            lines = [line.strip() for line in self.group_items_text[gid].get("1.0", tk.END).splitlines() if line.strip()]
            old_items = group.get("items", [])
            new_items = []
            for idx, label in enumerate(lines):
                default_enabled = "{default}" in label.lower()
                cleaned_label = re.sub(r"\{default\}", "", label, flags=re.IGNORECASE).strip()
                if not cleaned_label:
                    continue
                if idx < len(old_items):
                    item = old_items[idx]
                    item["label"] = cleaned_label
                    item["default_enabled"] = default_enabled
                    if not item.get("description"):
                        item["description"] = f"Enable or disable access for: {cleaned_label}"
                    new_items.append(item)
                else:
                    new_items.append(
                        {
                            "id": slugify(cleaned_label),
                            "label": cleaned_label,
                            "description": f"Enable or disable access for: {cleaned_label}",
                            "default_enabled": default_enabled,
                        }
                    )
            group["items"] = new_items

        known_values = default_known_values()
        for field_id, text_widget in self.known_values_text.items():
            lines = [line.strip() for line in text_widget.get("1.0", tk.END).splitlines() if line.strip()]
            known_values[field_id] = normalized_unique(lines)
        self.schema["known_values"] = known_values

        links = []
        for line in self.property_address_links_text.get("1.0", tk.END).splitlines():
            raw = line.strip()
            if not raw:
                continue
            if "|" not in raw:
                continue
            property_name, address = [part.strip() for part in raw.split("|", 1)]
            if property_name and address:
                links.append({"property": property_name, "address": address})
        self.schema["property_address_links"] = links

        self.result = self.schema
        self.destroy()


if __name__ == "__main__":
    app = ITRequestApp()
    app.mainloop()
