import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import toast from "react-hot-toast";
import { Plus, Trash2, Pencil, X, Upload, Download, Settings2, GripVertical } from "lucide-react";
import { orgApi } from "@/api";
import { apiError } from "@/api/client";
import { PageHeader, Spinner } from "@/components/ui";
import type { OrgResource, ResourceKind } from "@/types";

const DEFAULT_KINDS: KindDef[] = [
  { value: "property", label: "Property", attrs: [
    { key: "address", label: "Address", placeholder: "123 Main St, Springfield" },
    { key: "code", label: "Short code", placeholder: "HRT" },
    { key: "notes", label: "Notes" },
  ] },
  { value: "shared_mailbox", label: "Shared mailbox", attrs: [
    { key: "address", label: "Email address", placeholder: "frontdesk@harth.com" },
    { key: "owner", label: "Owner / contact" },
  ] },
  { value: "network_folder", label: "Network folder", attrs: [
    { key: "path", label: "UNC / path", placeholder: "\\\\server\\share\\folder" },
    { key: "permissions", label: "Default permissions" },
  ] },
  { value: "distribution_group", label: "Distribution group", attrs: [
    { key: "address", label: "Group email", placeholder: "all-staff@harth.com" },
    { key: "owner", label: "Owner" },
  ] },
  { value: "google_drive", label: "Google drive", attrs: [
    { key: "url", label: "Drive URL" },
    { key: "default_role", label: "Default role", placeholder: "Viewer / Editor" },
  ] },
  { value: "license", label: "License / app", attrs: [
    { key: "vendor", label: "Vendor" },
    { key: "tier", label: "Tier / SKU" },
  ] },
  { value: "email", label: "Email alias", attrs: [
    { key: "address", label: "Address" },
  ] },
  { value: "other", label: "Other", attrs: [
    { key: "details", label: "Details" },
  ] },
];

interface KindAttr { key: string; label: string; placeholder?: string }
interface KindDef { value: string; label: string; attrs: KindAttr[] }

export default function OrgResources() {
  const { orgSlug = "" } = useParams();
  const qc = useQueryClient();
  const [activeKind, setActiveKind] = useState<ResourceKind>("property");
  const [editing, setEditing] = useState<Partial<OrgResource> | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [manageKindsOpen, setManageKindsOpen] = useState(false);

  const org = useQuery({ queryKey: ["org", orgSlug], queryFn: () => orgApi.get(orgSlug) });
  const list = useQuery({
    queryKey: ["org.resources", orgSlug],
    queryFn: () => orgApi.listResources(orgSlug, { include_inactive: true }),
  });

  // Per-org configurable kinds, falling back to the built-in defaults.
  const KINDS: KindDef[] = useMemo(() => {
    const cfg = (org.data?.branding as any)?.resource_kinds;
    if (Array.isArray(cfg) && cfg.length > 0) {
      return cfg.map((k: any) => ({
        value: String(k.value || "").trim(),
        label: String(k.label || k.value || "").trim(),
        attrs: Array.isArray(k.attrs) ? k.attrs.map((a: any) => ({
          key: String(a.key || "").trim(),
          label: String(a.label || a.key || "").trim(),
          placeholder: a.placeholder,
        })).filter((a: KindAttr) => a.key) : [],
      })).filter((k: KindDef) => k.value);
    }
    return DEFAULT_KINDS;
  }, [org.data?.branding]);

  const byKind = useMemo(() => {
    const map: Record<string, OrgResource[]> = {};
    for (const r of list.data || []) (map[r.kind] ||= []).push(r);
    return map;
  }, [list.data]);

  const save = useMutation({
    mutationFn: async (r: Partial<OrgResource>) => {
      if (r.id) {
        return orgApi.updateResource(orgSlug, r.id, {
          name: r.name, attributes: r.attributes, linked_resource_ids: r.linked_resource_ids, is_active: r.is_active,
        });
      }
      return orgApi.createResource(orgSlug, {
        kind: r.kind as ResourceKind, name: r.name || "", attributes: r.attributes,
        linked_resource_ids: r.linked_resource_ids, is_active: r.is_active ?? true,
      });
    },
    onSuccess: () => { toast.success("Saved"); setEditing(null); qc.invalidateQueries({ queryKey: ["org.resources", orgSlug] }); },
    onError: (e) => toast.error(apiError(e)),
  });

  const del = useMutation({
    mutationFn: (id: number) => orgApi.deleteResource(orgSlug, id),
    onSuccess: () => { toast.success("Deleted"); qc.invalidateQueries({ queryKey: ["org.resources", orgSlug] }); },
    onError: (e) => toast.error(apiError(e)),
  });

  // ---- JSON import / export (backup & template) -----------------------------
  const jsonImportRef = useRef<HTMLInputElement | null>(null);
  const onImportJsonFile = async (file: File) => {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const rows: any[] = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.resources)
          ? parsed.resources
          : null;
      if (!rows) throw new Error("File must contain an array of resources (or { resources: [...] })");
      const cleaned = rows
        .map((r: any) => ({
          kind: String(r?.kind || "").trim(),
          name: String(r?.name || "").trim(),
          attributes: (r?.attributes && typeof r.attributes === "object") ? r.attributes : {},
          linked_keys: Array.isArray(r?.linked_keys) ? r.linked_keys : [],
          is_active: r?.is_active !== undefined ? !!r.is_active : true,
        }))
        .filter((r) => r.kind && r.name);
      if (cleaned.length === 0) throw new Error("No resources found in file");
      if (!window.confirm(
        `Import ${cleaned.length} resource(s) from this file? Existing entries with the same category + name will be updated; new ones will be created. Nothing is deleted.`,
      )) return;

      const t = toast.loading(`Importing ${cleaned.length} resource(s)…`);
      try {
        // Pass 1: upsert without links via bulk endpoint.
        await orgApi.bulkResources(
          orgSlug,
          cleaned.map((r) => ({
            action: "upsert" as const,
            kind: r.kind,
            name: r.name,
            attributes: r.attributes,
            is_active: r.is_active,
          })),
        );
        // Pass 2: resolve linked_keys (array of {kind,name}) and patch each row.
        const after = await orgApi.listResources(orgSlug, { include_inactive: true });
        const byKey = new Map<string, OrgResource>();
        for (const r of after) byKey.set(`${r.kind}::${r.name.toLowerCase()}`, r);
        let linked = 0;
        for (const src of cleaned) {
          if (!src.linked_keys.length) continue;
          const target = byKey.get(`${src.kind}::${src.name.toLowerCase()}`);
          if (!target) continue;
          const ids: number[] = src.linked_keys
            .map((k: any): OrgResource | undefined => byKey.get(`${String(k?.kind || "").trim()}::${String(k?.name || "").trim().toLowerCase()}`))
            .filter((x: OrgResource | undefined): x is OrgResource => !!x)
            .map((x: OrgResource) => x.id);
          if (ids.length === 0) continue;
          await orgApi.updateResource(orgSlug, target.id, { linked_resource_ids: ids });
          linked++;
        }
        toast.success(`Imported ${cleaned.length} resource(s)${linked ? ` (relinked ${linked})` : ""}`, { id: t });
        qc.invalidateQueries({ queryKey: ["org.resources", orgSlug] });
      } catch (e) {
        toast.error(apiError(e), { id: t });
      }
    } catch (e: any) {
      toast.error("Invalid resources file: " + (e?.message || String(e)));
    } finally {
      if (jsonImportRef.current) jsonImportRef.current.value = "";
    }
  };

  if (list.isLoading) return <Spinner />;

  const kindMeta = KINDS.find((k) => k.value === activeKind) || KINDS[0];
  const safeActiveKind = kindMeta?.value || "";
  const rows = byKind[safeActiveKind] || [];

  return (
    <>
      <PageHeader
        title="Resources"
        description="Things you can reference in the form: properties, mailboxes, folders, drives. Properties can link to their mailboxes/folders/drives so the form auto-fills."
        actions={
          <div className="flex gap-2">
            <input
              ref={jsonImportRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void onImportJsonFile(f); }}
            />
            <button className="btn-secondary" onClick={() => setManageKindsOpen(true)} title="Add, rename, or remove categories">
              <Settings2 size={16} /> Manage categories
            </button>
            <button className="btn-secondary" onClick={() => setImportOpen(true)} title="Bulk import / edit / delete via CSV">
              <Upload size={16} /> Import CSV
            </button>
            <button className="btn-secondary" onClick={() => downloadCsv(list.data || [], safeActiveKind, KINDS)} title="Download current entries as CSV">
              <Download size={16} /> Export CSV
            </button>
            <button className="btn-secondary" onClick={() => jsonImportRef.current?.click()} title="Import all resources from a JSON backup file">
              <Upload size={16} /> Import JSON
            </button>
            <button className="btn-secondary" onClick={() => exportResourcesJson(list.data || [], orgSlug)} title="Download all resources as JSON (backup / template)">
              <Download size={16} /> Export JSON
            </button>
            <button className="btn-primary" onClick={() => setEditing({ kind: safeActiveKind, name: "", attributes: {}, linked_resource_ids: [], is_active: true })}>
              <Plus size={16} /> Add {(kindMeta?.label || "resource").toLowerCase()}
            </button>
          </div>
        }
      />

      <div className="flex flex-wrap gap-2 border-b border-slate-200 dark:border-slate-700 mb-4">
        {KINDS.map((k) => (
          <button key={k.value} onClick={() => setActiveKind(k.value)}
            className={`px-3 py-2 text-sm font-medium ${activeKind === k.value ? "border-b-2 border-brand-600 text-brand-700" : "text-slate-500 hover:text-slate-800 dark:text-slate-300 dark:hover:text-white"}`}>
            {k.label} <span className="ml-1 text-xs text-slate-400">{(byKind[k.value] || []).length}</span>
          </button>
        ))}
      </div>

      {rows.length === 0 && (
        <div className="card"><div className="card-body text-sm text-slate-500 italic">No {(kindMeta?.label || "").toLowerCase()} entries yet.</div></div>
      )}

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
        {rows.map((r) => (
          <div key={r.id} className={`card ${r.is_active ? "" : "opacity-60"}`}>
            <div className="card-body space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-semibold">{r.name}</div>
                  {!r.is_active && <span className="badge-amber text-xs">inactive</span>}
                </div>
                <div className="flex gap-1">
                  <button className="btn-ghost" title="Edit" onClick={() => setEditing(r)}><Pencil size={14} /></button>
                  <button className="btn-ghost text-red-600" title="Delete" onClick={() => { if (confirm(`Delete "${r.name}"?`)) del.mutate(r.id); }}><Trash2 size={14} /></button>
                </div>
              </div>
              <dl className="text-xs space-y-0.5">
                {Object.entries(r.attributes || {}).filter(([, v]) => v).map(([k, v]) => (
                  <div key={k} className="flex gap-2">
                    <dt className="text-slate-500 capitalize w-24 shrink-0">{k.replace(/_/g, " ")}</dt>
                    <dd className="text-slate-800 dark:text-slate-200 break-all">{String(v)}</dd>
                  </div>
                ))}
              </dl>
              {r.linked_resource_ids?.length > 0 && (
                <div className="text-xs text-slate-500 pt-1 border-t border-slate-100 dark:border-slate-700">
                  Linked: {r.linked_resource_ids.map((id) => (list.data || []).find((x) => x.id === id)?.name || `#${id}`).join(", ")}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {editing && (
        <ResourceModal
          resource={editing}
          all={list.data || []}
          kinds={KINDS}
          onClose={() => setEditing(null)}
          onSave={(r) => save.mutate(r)}
          saving={save.isPending}
        />
      )}

      {importOpen && (
        <BulkImportModal
          orgSlug={orgSlug}
          activeKind={safeActiveKind}
          existing={list.data || []}
          kinds={KINDS}
          onClose={() => setImportOpen(false)}
          onDone={() => { qc.invalidateQueries({ queryKey: ["org.resources", orgSlug] }); }}
        />
      )}

      {manageKindsOpen && (
        <ManageKindsModal
          orgSlug={orgSlug}
          current={KINDS}
          existingResources={list.data || []}
          branding={(org.data?.branding as any) || {}}
          onClose={() => setManageKindsOpen(false)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["org", orgSlug] });
            setManageKindsOpen(false);
          }}
        />
      )}
    </>
  );
}

function ResourceModal({ resource, all, kinds, onClose, onSave, saving }: {
  resource: Partial<OrgResource>;
  all: OrgResource[];
  kinds: KindDef[];
  onClose: () => void;
  onSave: (r: Partial<OrgResource>) => void;
  saving: boolean;
}) {
  const kind = (resource.kind || kinds[0]?.value || "other") as ResourceKind;
  const meta = kinds.find((k) => k.value === kind) || kinds[0] || { value: kind, label: kind, attrs: [] };
  const [name, setName] = useState(resource.name || "");
  const [attrs, setAttrs] = useState<Record<string, any>>(resource.attributes || {});
  const [linked, setLinked] = useState<number[]>(resource.linked_resource_ids || []);
  const [isActive, setIsActive] = useState(resource.is_active ?? true);

  // Properties typically link to other resource kinds. Other kinds usually
  // don't need links (but allow it).
  const linkable = all.filter((r) => r.id !== resource.id && r.kind !== kind);

  return (
    <div className="fixed inset-0 z-40 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 px-4 py-3">
          <h3 className="font-semibold">{resource.id ? "Edit" : "New"} {meta.label.toLowerCase()}</h3>
          <button className="btn-ghost" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="p-4 space-y-3">
          <div>
            <label className="label">Name <span className="text-red-500">*</span></label>
            <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="The Harth" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {meta.attrs.map((a) => (
              <div key={a.key} className={a.key === "notes" || a.key === "details" ? "md:col-span-2" : ""}>
                <label className="label">{a.label}</label>
                {a.key === "notes" || a.key === "details" ? (
                  <textarea className="input min-h-[60px]" value={attrs[a.key] || ""} onChange={(e) => setAttrs({ ...attrs, [a.key]: e.target.value })} placeholder={a.placeholder} />
                ) : (
                  <input className="input" value={attrs[a.key] || ""} onChange={(e) => setAttrs({ ...attrs, [a.key]: e.target.value })} placeholder={a.placeholder} />
                )}
              </div>
            ))}
          </div>

          {linkable.length > 0 && (
            <div>
              <label className="label">Linked resources</label>
              <p className="help mb-1">Pick what belongs to this {meta.label.toLowerCase()} (e.g. mailboxes/folders/drives for a property). The form can auto-fill these for the requestor.</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 max-h-60 overflow-y-auto rounded border border-slate-200 dark:border-slate-700 p-2">
                {linkable.map((r) => (
                  <label key={r.id} className="flex items-center gap-2 text-sm py-0.5">
                    <input type="checkbox" checked={linked.includes(r.id)}
                      onChange={(e) => setLinked(e.target.checked ? [...linked, r.id] : linked.filter((x) => x !== r.id))} />
                    <span className="text-slate-500 text-xs uppercase tracking-wide w-20">{r.kind.replace(/_/g, " ")}</span>
                    <span>{r.name}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            Active (uncheck to hide from form selectors without deleting)
          </label>
        </div>
        <div className="border-t border-slate-200 dark:border-slate-700 px-4 py-3 flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button
            className="btn-primary"
            disabled={!name.trim() || saving}
            onClick={() => onSave({ ...resource, kind, name: name.trim(), attributes: attrs, linked_resource_ids: linked, is_active: isActive })}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- CSV helpers ----------

function csvEscape(v: any): string {
  const s = v === null || v === undefined ? "" : String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function buildCsv(headers: string[], rows: string[][]): string {
  return [headers, ...rows].map((r) => r.map(csvEscape).join(",")).join("\n");
}

/** Tiny RFC-4180-ish CSV parser. Handles quoted fields with embedded commas/newlines/escaped quotes. */
function parseCsv(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let inQuotes = false;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { cur += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      cur += c; i++; continue;
    }
    if (c === '"') { inQuotes = true; i++; continue; }
    if (c === ",") { row.push(cur); cur = ""; i++; continue; }
    if (c === "\r") { i++; continue; }
    if (c === "\n") { row.push(cur); out.push(row); row = []; cur = ""; i++; continue; }
    cur += c; i++;
  }
  if (cur.length > 0 || row.length > 0) { row.push(cur); out.push(row); }
  return out.filter((r) => r.some((cell) => cell !== ""));
}

function attrKeysFor(kind: ResourceKind, kinds: KindDef[]): string[] {
  return (kinds.find((k) => k.value === kind)?.attrs || []).map((a) => a.key);
}

function downloadCsv(all: OrgResource[], kind: ResourceKind, kinds: KindDef[]) {
  const rows = all.filter((r) => r.kind === kind);
  const attrKeys = attrKeysFor(kind, kinds);
  // Also include any extra attribute keys actually present.
  const extras = new Set<string>();
  rows.forEach((r) => Object.keys(r.attributes || {}).forEach((k) => { if (!attrKeys.includes(k)) extras.add(k); }));
  const allAttrs = [...attrKeys, ...Array.from(extras)];
  const headers = ["action", "kind", "name", ...allAttrs, "is_active"];
  const data = rows.map((r) => [
    "upsert",
    r.kind,
    r.name,
    ...allAttrs.map((k) => (r.attributes?.[k] ?? "")),
    r.is_active ? "true" : "false",
  ]);
  if (data.length === 0) {
    // Provide a header-only template so the user knows what to fill.
    data.push(["upsert", kind, "Example Name", ...allAttrs.map(() => ""), "true"]);
  }
  const csv = buildCsv(headers, data.map((r) => r.map(String)));
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `resources-${kind}.csv`; a.click();
  URL.revokeObjectURL(url);
}

function exportResourcesJson(all: OrgResource[], orgSlug: string) {
  // Build a (kind,name) lookup so we can serialize cross-resource links by
  // stable key instead of by numeric id (which isn't portable between orgs).
  const byId = new Map<number, OrgResource>();
  for (const r of all) byId.set(r.id, r);
  const payload = {
    version: 1,
    exported_at: new Date().toISOString(),
    org_slug: orgSlug,
    resources: all.map((r) => ({
      kind: r.kind,
      name: r.name,
      attributes: r.attributes || {},
      is_active: r.is_active,
      linked_keys: (r.linked_resource_ids || [])
        .map((id) => byId.get(id))
        .filter((x): x is OrgResource => !!x)
        .map((x) => ({ kind: x.kind, name: x.name })),
    })),
  };
  const stamp = new Date().toISOString().slice(0, 10);
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `resources-${orgSlug || "org"}-${stamp}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

interface ParsedRow {
  row: number;
  action: "upsert" | "add" | "update" | "delete";
  kind: string;
  name: string;
  attributes: Record<string, string>;
  is_active?: boolean;
  error?: string;
}

function parseRows(text: string, defaultKind: ResourceKind): { rows: ParsedRow[]; headers: string[] } {
  const grid = parseCsv(text);
  if (grid.length === 0) return { rows: [], headers: [] };
  const rawHeaders = grid[0].map((h) => h.trim());
  const headers = rawHeaders.map((h) => h.toLowerCase());
  const idx = (name: string) => headers.indexOf(name);
  const iAction = idx("action");
  const iKind = idx("kind");
  const iName = idx("name");
  const iActive = idx("is_active");
  const reservedSet = new Set(["action", "kind", "name", "is_active"]);
  const attrCols = headers.map((h, i) => ({ h, i })).filter((c) => !reservedSet.has(c.h));

  const rows: ParsedRow[] = [];
  for (let r = 1; r < grid.length; r++) {
    const cells = grid[r];
    if (cells.every((c) => c.trim() === "")) continue;
    const action = ((iAction >= 0 ? cells[iAction] : "") || "upsert").trim().toLowerCase() as ParsedRow["action"];
    const kind = ((iKind >= 0 ? cells[iKind] : "") || defaultKind).trim();
    const name = ((iName >= 0 ? cells[iName] : "") || "").trim();
    const attributes: Record<string, string> = {};
    for (const c of attrCols) {
      const v = (cells[c.i] || "").trim();
      // include even empty strings on update so we can clear keys; on creates the
      // backend will skip empties via merge logic
      if (v !== "" || action === "update" || action === "upsert") attributes[c.h] = v;
    }
    let is_active: boolean | undefined;
    if (iActive >= 0) {
      const v = (cells[iActive] || "").trim().toLowerCase();
      if (v === "true" || v === "1" || v === "yes") is_active = true;
      else if (v === "false" || v === "0" || v === "no") is_active = false;
    }
    let error: string | undefined;
    if (!name) error = "missing name";
    if (!["upsert", "add", "update", "delete"].includes(action)) error = `bad action "${action}"`;
    rows.push({ row: r + 1, action, kind, name, attributes, is_active, error });
  }
  return { rows, headers: rawHeaders };
}

function BulkImportModal({ orgSlug, activeKind, existing, kinds, onClose, onDone }: {
  orgSlug: string;
  activeKind: ResourceKind;
  existing: OrgResource[];
  kinds: KindDef[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [text, setText] = useState("");
  const [parsed, setParsed] = useState<ParsedRow[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [result, setResult] = useState<Awaited<ReturnType<typeof orgApi.bulkResources>> | null>(null);

  const meta = kinds.find((k) => k.value === activeKind) || kinds[0] || { value: activeKind, label: activeKind, attrs: [] };
  const sampleHeaders = ["action", "kind", "name", ...meta.attrs.map((a) => a.key), "is_active"];
  const sample = `${sampleHeaders.join(",")}\nupsert,${activeKind},Example Name,${meta.attrs.map(() => "").join(",")},true`;

  const onFile = async (f: File) => {
    const t = await f.text();
    setText(t);
    const p = parseRows(t, activeKind);
    setParsed(p.rows); setHeaders(p.headers);
  };

  const onTextChange = (v: string) => {
    setText(v);
    const p = parseRows(v, activeKind);
    setParsed(p.rows); setHeaders(p.headers);
  };

  const submit = useMutation({
    mutationFn: async () => {
      const rows = parsed.filter((r) => !r.error).map((r) => ({
        action: r.action, kind: r.kind, name: r.name,
        attributes: r.attributes, is_active: r.is_active,
      }));
      return orgApi.bulkResources(orgSlug, rows);
    },
    onSuccess: (res) => {
      setResult(res);
      const summary = `${res.created} created, ${res.updated} updated, ${res.deleted} deleted, ${res.skipped} skipped, ${res.errors} errors`;
      if (res.errors > 0) toast.error(summary); else toast.success(summary);
      onDone();
    },
    onError: (e) => toast.error(apiError(e)),
  });

  // Cross-check parsed rows vs existing for a quick preview.
  const existingKey = new Set(existing.map((r) => `${r.kind}::${r.name.toLowerCase()}`));
  const previewSummary = parsed.reduce((acc, r) => {
    if (r.error) acc.errors++;
    else if (r.action === "delete") acc.delete++;
    else if (r.action === "add" || (r.action === "upsert" && !existingKey.has(`${r.kind}::${r.name.toLowerCase()}`))) acc.create++;
    else acc.update++;
    return acc;
  }, { create: 0, update: 0, delete: 0, errors: 0 });

  return (
    <div className="fixed inset-0 z-40 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl max-w-4xl w-full max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 px-4 py-3">
          <h3 className="font-semibold">Import resources from CSV</h3>
          <button className="btn-ghost" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="p-4 space-y-3">
          <div className="text-sm text-slate-600 dark:text-slate-300 space-y-1">
            <p><strong>How it works.</strong> Upload (or paste) a CSV. Required columns: <code>kind</code>, <code>name</code>. Optional: <code>action</code> (upsert / add / update / delete — default <em>upsert</em>), <code>is_active</code>, plus one column per attribute (e.g. <code>address</code>, <code>code</code>).</p>
            <p>Match key for update/delete is <code>(kind, name)</code>. For <em>upsert</em>, attributes are <em>merged</em> into existing rows. Set an attribute cell to empty in an <em>update</em> row to clear it.</p>
            <p>Tip: hit <strong>Export CSV</strong> first to grab a template with the right columns for the active tab.</p>
          </div>

          <div className="grid md:grid-cols-2 gap-3">
            <div>
              <label className="label">Upload CSV file</label>
              <input type="file" accept=".csv,text/csv" className="input" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
              <button className="btn-ghost text-xs mt-1" onClick={() => onTextChange(sample)}>Insert sample for "{meta.label}"</button>
            </div>
            <div>
              <label className="label">Detected ({parsed.length} rows)</label>
              <div className="text-xs grid grid-cols-2 gap-1">
                <span>Will create:</span><span className="font-mono">{previewSummary.create}</span>
                <span>Will update:</span><span className="font-mono">{previewSummary.update}</span>
                <span>Will delete:</span><span className="font-mono">{previewSummary.delete}</span>
                <span>Row errors:</span><span className={`font-mono ${previewSummary.errors > 0 ? "text-red-600" : ""}`}>{previewSummary.errors}</span>
              </div>
            </div>
          </div>

          <div>
            <label className="label">CSV content</label>
            <textarea
              className="input min-h-[180px] font-mono text-xs"
              value={text}
              onChange={(e) => onTextChange(e.target.value)}
              placeholder={sample}
            />
          </div>

          {parsed.length > 0 && (
            <div className="rounded border border-slate-200 dark:border-slate-700 overflow-hidden">
              <div className="px-3 py-2 bg-slate-50 dark:bg-slate-900/40 text-xs font-semibold">Preview</div>
              <div className="max-h-60 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="bg-slate-100 dark:bg-slate-900 text-left">
                    <tr>
                      <th className="px-2 py-1">#</th>
                      <th className="px-2 py-1">action</th>
                      <th className="px-2 py-1">kind</th>
                      <th className="px-2 py-1">name</th>
                      <th className="px-2 py-1">attributes</th>
                      <th className="px-2 py-1">status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.slice(0, 200).map((r) => {
                      const matched = existingKey.has(`${r.kind}::${r.name.toLowerCase()}`);
                      const status = r.error
                        ? <span className="text-red-600">error: {r.error}</span>
                        : r.action === "delete"
                          ? (matched ? <span className="text-red-600">delete</span> : <span className="text-slate-400">delete (skip — not found)</span>)
                          : r.action === "add"
                            ? (matched ? <span className="text-amber-600">error: exists</span> : <span className="text-emerald-600">create</span>)
                            : r.action === "update"
                              ? (matched ? <span className="text-blue-600">update</span> : <span className="text-amber-600">error: not found</span>)
                              : (matched ? <span className="text-blue-600">update (upsert)</span> : <span className="text-emerald-600">create (upsert)</span>);
                      return (
                        <tr key={r.row} className="border-t border-slate-100 dark:border-slate-800">
                          <td className="px-2 py-1">{r.row}</td>
                          <td className="px-2 py-1">{r.action}</td>
                          <td className="px-2 py-1">{r.kind}</td>
                          <td className="px-2 py-1 font-medium">{r.name}</td>
                          <td className="px-2 py-1 text-slate-500">{Object.entries(r.attributes).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join("; ")}</td>
                          <td className="px-2 py-1">{status}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {parsed.length > 200 && <div className="px-2 py-1 text-xs text-slate-500">+ {parsed.length - 200} more rows…</div>}
              </div>
            </div>
          )}

          {result && (
            <div className="rounded border border-slate-200 dark:border-slate-700 p-3 text-xs space-y-1">
              <div className="font-semibold">Done</div>
              <div>Created: {result.created} · Updated: {result.updated} · Deleted: {result.deleted} · Skipped: {result.skipped} · Errors: {result.errors}</div>
              {result.errors > 0 && (
                <details>
                  <summary className="cursor-pointer text-red-600">Show errors</summary>
                  <ul className="list-disc list-inside">
                    {result.rows.filter((r) => r.result === "error").slice(0, 50).map((r, i) => (
                      <li key={i}>Row {r.row} ({r.kind} / {r.name}): {r.detail}</li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}
        </div>
        <div className="border-t border-slate-200 dark:border-slate-700 px-4 py-3 flex justify-between gap-2">
          <span className="text-xs text-slate-500 self-center">{headers.length > 0 ? `Columns: ${headers.join(", ")}` : ""}</span>
          <div className="flex gap-2">
            <button className="btn-secondary" onClick={onClose}>Close</button>
            <button
              className="btn-primary"
              disabled={submit.isPending || parsed.length === 0 || parsed.every((r) => r.error)}
              onClick={() => submit.mutate()}
            >
              {submit.isPending ? "Importing…" : `Import ${parsed.filter((r) => !r.error).length} rows`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function slugifyKind(s: string): string {
  return s.toLowerCase().trim()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40) || "kind";
}

function ManageKindsModal({ orgSlug, current, existingResources, branding, onClose, onSaved }: {
  orgSlug: string;
  current: KindDef[];
  existingResources: OrgResource[];
  branding: Record<string, any>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<KindDef[]>(() => current.map((k) => ({
    value: k.value,
    label: k.label,
    attrs: k.attrs.map((a) => ({ ...a })),
  })));

  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of existingResources) m[r.kind] = (m[r.kind] || 0) + 1;
    return m;
  }, [existingResources]);

  const update = (idx: number, patch: Partial<KindDef>) => {
    setDraft((d) => d.map((k, i) => (i === idx ? { ...k, ...patch } : k)));
  };
  const move = (idx: number, dir: -1 | 1) => {
    setDraft((d) => {
      const j = idx + dir;
      if (j < 0 || j >= d.length) return d;
      const next = d.slice();
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });
  };
  const remove = (idx: number) => {
    const k = draft[idx];
    const used = counts[k.value] || 0;
    if (used > 0) {
      toast.error(`Can't delete "${k.label}" — ${used} resource(s) still use it. Move or delete them first.`);
      return;
    }
    if (!confirm(`Delete category "${k.label}"?`)) return;
    setDraft((d) => d.filter((_, i) => i !== idx));
  };
  const addKind = () => {
    const base = "new_category";
    let v = base;
    let i = 2;
    const taken = new Set(draft.map((k) => k.value));
    while (taken.has(v)) { v = `${base}_${i++}`; }
    setDraft((d) => [...d, { value: v, label: "New category", attrs: [{ key: "details", label: "Details" }] }]);
  };
  const addAttr = (idx: number) => {
    update(idx, { attrs: [...draft[idx].attrs, { key: "field", label: "Field" }] });
  };
  const updateAttr = (idx: number, ai: number, patch: Partial<KindAttr>) => {
    update(idx, { attrs: draft[idx].attrs.map((a, j) => (j === ai ? { ...a, ...patch } : a)) });
  };
  const removeAttr = (idx: number, ai: number) => {
    update(idx, { attrs: draft[idx].attrs.filter((_, j) => j !== ai) });
  };

  const validate = (): string | null => {
    const seenVals = new Set<string>();
    for (const k of draft) {
      if (!k.value) return "Each category needs an internal value.";
      if (!/^[a-z0-9][a-z0-9_-]{0,39}$/.test(k.value)) return `"${k.value}" must be a slug (a-z, 0-9, _, -; max 40).`;
      if (seenVals.has(k.value)) return `Duplicate value "${k.value}".`;
      seenVals.add(k.value);
      if (!k.label.trim()) return `Category "${k.value}" needs a display name.`;
      const seenAttrs = new Set<string>();
      for (const a of k.attrs) {
        if (!a.key) return `Category "${k.label}" has an attribute with no key.`;
        if (!/^[a-z0-9][a-z0-9_-]*$/i.test(a.key)) return `Attribute "${a.key}" must be alphanumeric.`;
        if (seenAttrs.has(a.key)) return `Category "${k.label}" has duplicate attribute "${a.key}".`;
        seenAttrs.add(a.key);
      }
    }
    // Don't allow removing a kind that still has resources
    const newVals = new Set(draft.map((k) => k.value));
    for (const v of Object.keys(counts)) {
      if (counts[v] > 0 && !newVals.has(v)) {
        return `Cannot remove category "${v}" — ${counts[v]} resource(s) still use it.`;
      }
    }
    return null;
  };

  const save = useMutation({
    mutationFn: async () => {
      const err = validate();
      if (err) throw new Error(err);

      // Detect attribute key renames by matching old vs new categories by
      // their internal value (slug), then comparing attrs position-by-position.
      // When the slug is unchanged but the key at the same position changed,
      // and the old key isn't being reintroduced elsewhere in the same
      // category, treat it as a rename and migrate existing resources so
      // their data moves to the new key instead of being orphaned.
      const renames: { kind: string; renames: { from: string; to: string }[] }[] = [];
      const byValue = new Map(current.map((k) => [k.value, k]));
      for (const k of draft) {
        const old = byValue.get(k.value);
        if (!old) continue;
        const newKeys = new Set(k.attrs.map((a) => a.key));
        const oldKeys = new Set(old.attrs.map((a) => a.key));
        const pairs: { from: string; to: string }[] = [];
        const len = Math.min(old.attrs.length, k.attrs.length);
        for (let i = 0; i < len; i++) {
          const from = old.attrs[i].key;
          const to = k.attrs[i].key;
          if (from === to) continue;
          // Only treat as a rename if the old key no longer exists in the
          // new schema and the new key didn't already exist in the old one.
          if (!newKeys.has(from) && !oldKeys.has(to)) {
            pairs.push({ from, to });
          }
        }
        if (pairs.length > 0) renames.push({ kind: k.value, renames: pairs });
      }

      if (renames.length > 0) {
        const summary = renames
          .map((r) => `• ${r.kind}: ${r.renames.map((p) => `${p.from} → ${p.to}`).join(", ")}`)
          .join("\n");
        const ok = window.confirm(
          `You renamed attribute keys:\n\n${summary}\n\nMove existing resource values from the old keys to the new ones?\n\nCancel to keep both keys (existing data stays under the old name).`,
        );
        if (ok) {
          // Migrate each affected resource. Doing this client-side keeps the
          // backend untouched and the change atomic from the user's view.
          for (const group of renames) {
            const affected = existingResources.filter((r) => r.kind === group.kind);
            for (const r of affected) {
              const attrs = { ...(r.attributes || {}) };
              let touched = false;
              for (const { from, to } of group.renames) {
                if (Object.prototype.hasOwnProperty.call(attrs, from)) {
                  // Don't clobber an existing value at the destination key.
                  if (attrs[to] === undefined || attrs[to] === "" || attrs[to] === null) {
                    attrs[to] = attrs[from];
                  }
                  delete attrs[from];
                  touched = true;
                }
              }
              if (touched) {
                await orgApi.updateResource(orgSlug, r.id, { attributes: attrs });
              }
            }
          }
        }
      }

      const next = { ...branding, resource_kinds: draft };
      return orgApi.updateSettings(orgSlug, { branding: next });
    },
    onSuccess: () => { toast.success("Categories saved"); onSaved(); },
    onError: (e: any) => toast.error(e?.message || apiError(e)),
  });

  return (
    <div className="fixed inset-0 z-40 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl max-w-3xl w-full max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 px-4 py-3">
          <div>
            <h3 className="font-semibold">Manage resource categories</h3>
            <p className="text-xs text-slate-500">Add, rename, or remove the tabs (Property, Shared mailbox, etc.). The internal value is the identifier saved on each resource — change it carefully.</p>
          </div>
          <button className="btn-ghost" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="p-4 space-y-3 overflow-y-auto">
          {draft.map((k, idx) => (
            <div key={idx} className="rounded border border-slate-200 dark:border-slate-700 p-3 space-y-2">
              <div className="flex items-start gap-2">
                <div className="flex flex-col pt-1">
                  <button className="btn-ghost px-1" title="Move up" onClick={() => move(idx, -1)} disabled={idx === 0}><GripVertical size={14} /></button>
                </div>
                <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-2">
                  <div>
                    <label className="label">Display name</label>
                    <input className="input" value={k.label}
                      onChange={(e) => {
                        const nextLabel = e.target.value;
                        // auto-suggest slug if value looks default and no resources
                        const auto = (counts[k.value] || 0) === 0 && (!k.value || k.value === slugifyKind(k.label));
                        update(idx, auto ? { label: nextLabel, value: slugifyKind(nextLabel) } : { label: nextLabel });
                      }} />
                  </div>
                  <div>
                    <label className="label">Internal value <span className="text-xs text-slate-400">(slug)</span></label>
                    <input className="input font-mono text-sm" value={k.value}
                      disabled={(counts[k.value] || 0) > 0}
                      title={(counts[k.value] || 0) > 0 ? "Locked — resources are using this value" : ""}
                      onChange={(e) => update(idx, { value: slugifyKind(e.target.value) })} />
                    <div className="text-xs text-slate-500 mt-0.5">
                      {counts[k.value] || 0} resource(s)
                    </div>
                  </div>
                </div>
                <button className="btn-ghost text-red-600" title="Delete category" onClick={() => remove(idx)}>
                  <Trash2 size={14} />
                </button>
              </div>
              <div className="pl-7">
                <div className="text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Attributes</div>
                <div className="space-y-1">
                  {k.attrs.map((a, ai) => (
                    <div key={ai} className="flex gap-2 items-center">
                      <input className="input flex-1 font-mono text-xs" placeholder="key" value={a.key}
                        onChange={(e) => updateAttr(idx, ai, { key: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, "") })} />
                      <input className="input flex-1 text-sm" placeholder="Label" value={a.label}
                        onChange={(e) => updateAttr(idx, ai, { label: e.target.value })} />
                      <input className="input flex-1 text-sm" placeholder="Placeholder (optional)" value={a.placeholder || ""}
                        onChange={(e) => updateAttr(idx, ai, { placeholder: e.target.value })} />
                      <button className="btn-ghost text-red-600" onClick={() => removeAttr(idx, ai)} title="Remove attribute">
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                </div>
                <button className="btn-ghost mt-1 text-sm" onClick={() => addAttr(idx)}>
                  <Plus size={14} /> Add attribute
                </button>
              </div>
            </div>
          ))}
          <button className="btn-secondary" onClick={addKind}>
            <Plus size={16} /> Add category
          </button>
        </div>
        <div className="border-t border-slate-200 dark:border-slate-700 px-4 py-3 flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose} disabled={save.isPending}>Cancel</button>
          <button className="btn-primary" onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save categories"}
          </button>
        </div>
      </div>
    </div>
  );
}
