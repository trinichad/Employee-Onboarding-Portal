import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import toast from "react-hot-toast";
import { orgApi } from "@/api";
import { apiError } from "@/api/client";
import { PageHeader, Spinner } from "@/components/ui";
import { FormRenderer } from "@/components/FormRenderer";
import type { FormSchemaDoc } from "@/types";

/**
 * Form Builder: structured editor with JSON fallback. Lets admins:
 * - rename the form, add/remove request types
 * - add/remove fields and groups
 * - preview the form
 */
export default function OrgFormBuilder() {
  const { orgSlug = "" } = useParams();
  const qc = useQueryClient();
  const form = useQuery({ queryKey: ["org.form", orgSlug], queryFn: () => orgApi.getForm(orgSlug) });
  const org = useQuery({ queryKey: ["org", orgSlug], queryFn: () => orgApi.get(orgSlug) });
  const kindLabels = useMemo<Record<string, string>>(() => {
    const cfg = (org.data?.branding as any)?.resource_kinds;
    if (Array.isArray(cfg) && cfg.length > 0) {
      const m: Record<string, string> = {};
      for (const k of cfg) {
        const v = String(k.value || "").trim();
        if (v) m[v] = String(k.label || v).trim();
      }
      return m;
    }
    return DEFAULT_RESOURCE_KIND_LABELS;
  }, [org.data?.branding]);
  const [doc, setDoc] = useState<FormSchemaDoc>({ form_name: "", request_types: [], fields: [], groups: [] });
  const [tab, setTab] = useState<"editor" | "json" | "preview">("editor");
  const [jsonText, setJsonText] = useState("");
  const [preview, setPreview] = useState<Record<string, any>>({});

  useEffect(() => {
    if (form.data) {
      setDoc(form.data.schema || {});
      setJsonText(JSON.stringify(form.data.schema, null, 2));
    }
  }, [form.data]);

  const save = useMutation({
    mutationFn: (next: FormSchemaDoc) => orgApi.saveForm(orgSlug, next),
    onSuccess: () => { toast.success("Form saved (new version)"); qc.invalidateQueries({ queryKey: ["org.form", orgSlug] }); },
    onError: (e) => toast.error(apiError(e)),
  });

  const handleSave = () => {
    if (tab === "json") {
      try { save.mutate(JSON.parse(jsonText)); } catch (e: any) { toast.error("Invalid JSON: " + e.message); }
    } else save.mutate(doc);
  };

  if (form.isLoading) return <Spinner />;

  return (
    <>
      <PageHeader title="Form Builder" description={`Active version: v${form.data?.version}`}
        actions={<button className="btn-primary" disabled={save.isPending} onClick={handleSave}>{save.isPending ? "Saving…" : "Save new version"}</button>} />

      <div className="flex gap-2 border-b border-slate-200 mb-4">
        {(["editor", "json", "preview"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-3 py-2 text-sm font-medium ${tab === t ? "border-b-2 border-brand-600 text-brand-700" : "text-slate-500"}`}>
            {t}
          </button>
        ))}
      </div>

      {tab === "editor" && (
        <div className="space-y-4">
          <div className="rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-100 dark:border-blue-900 p-3 text-sm">
            <div className="font-semibold text-blue-900 dark:text-blue-200">How this page works</div>
            <ol className="list-decimal list-inside text-blue-900/80 dark:text-blue-200/80 text-xs mt-1 space-y-0.5">
              <li>Set the request types (e.g. New Hire, Promotion, Rehire, Termination).</li>
              <li>Add the fields people fill out. Each field can be set to "show only on certain request types".</li>
              <li>Use the <strong>Resources</strong> page to register your properties, mailboxes, network drives, etc. Then add a field of type "Pick from your Resources catalog" to let users select from that list.</li>
              <li>Click <strong>Save new version</strong> at the top right when done. Use the <strong>Preview</strong> tab to test it.</li>
            </ol>
          </div>

          <div className="card"><div className="card-body grid md:grid-cols-2 gap-4">
            <div><label className="label">Form name</label>
              <input className="input" value={doc.form_name || ""} onChange={(e) => setDoc({ ...doc, form_name: e.target.value })} /></div>
            <div><label className="label">Request types (one per line)</label>
              <textarea className="input min-h-[80px]" value={(doc.request_types || []).join("\n")}
                onChange={(e) => setDoc({ ...doc, request_types: e.target.value.split("\n").map(s => s.trim()).filter(Boolean) })} />
              <p className="help">e.g. New Hire, Promotion, Rehire, Termination. Per-field visibility ("show only on…") is set on each field below.</p>
            </div>
          </div></div>

          <FieldsEditor doc={doc} setDoc={setDoc} kindLabels={kindLabels} />
          <GroupsEditor doc={doc} setDoc={setDoc} />
        </div>
      )}

      {tab === "json" && (
        <textarea className="input font-mono text-xs min-h-[480px]" value={jsonText} onChange={(e) => setJsonText(e.target.value)} />
      )}

      {tab === "preview" && (
        <div className="card"><div className="card-body">
          <FormRenderer schema={doc} values={preview} onChange={setPreview} orgSlug={orgSlug} />
        </div></div>
      )}
    </>
  );
}

function FieldsEditor({ doc, setDoc, kindLabels }: { doc: FormSchemaDoc; setDoc: (d: FormSchemaDoc) => void; kindLabels: Record<string, string> }) {
  const fields = doc.fields || [];
  const requestTypes = doc.request_types || [];
  const update = (i: number, patch: Partial<any>) => {
    const next = fields.slice(); next[i] = { ...next[i], ...patch };
    setDoc({ ...doc, fields: next });
  };
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= fields.length) return;
    const next = fields.slice();
    [next[i], next[j]] = [next[j], next[i]];
    setDoc({ ...doc, fields: next });
  };
  const addField = () => {
    const id = `field_${fields.length + 1}`;
    setDoc({ ...doc, fields: [...fields, { id, label: "New field", type: "text", required: false }] });
  };
  return (
    <div className="card">
      <div className="card-header flex items-center justify-between">
        <div>
          <h3 className="font-semibold">Form fields</h3>
          <p className="text-xs text-slate-500">These show up at the top of every request, regardless of request type. Use "Show only on" to limit a field to specific request types (e.g. Termination).</p>
        </div>
        <button className="btn-secondary" onClick={addField}>+ Add field</button>
      </div>
      <div className="card-body space-y-3">
        {fields.map((f, i) => (
          <FieldEditor
            key={i}
            field={f}
            allFields={fields}
            requestTypes={requestTypes}
            kindLabels={kindLabels}
            onChange={(patch) => update(i, patch)}
            onMoveUp={() => move(i, -1)}
            onMoveDown={() => move(i, 1)}
            onRemove={() => setDoc({ ...doc, fields: fields.filter((_, j) => j !== i) })}
            isFirst={i === 0}
            isLast={i === fields.length - 1}
          />
        ))}
        {fields.length === 0 && <p className="text-sm text-slate-500 italic">No fields yet. Click "Add field" to begin.</p>}
      </div>
    </div>
  );
}

const FIELD_TYPE_LABELS: Record<string, string> = {
  text: "Short text",
  textarea: "Long text (paragraph)",
  date: "Date picker",
  email: "Email",
  number: "Number",
  select: "Pick from a list",
  resource: "Pick from your Resources catalog",
};

const DEFAULT_RESOURCE_KIND_LABELS: Record<string, string> = {
  property: "Property",
  shared_mailbox: "Shared mailbox",
  network_folder: "Network folder / drive",
  distribution_group: "Distribution group",
  google_drive: "Google drive",
  license: "License / app",
  email: "Email alias",
  other: "Other",
};

const ROLE_OPTIONS: { value: string; label: string; help: string }[] = [
  { value: "", label: "(no special role)", help: "" },
  { value: "employee_name", label: "Employee's full name", help: "Used to identify this person in the directory for Promotion / Rehire / Termination lookup." },
  { value: "employee_email", label: "Employee's work email", help: "Best lookup key. If set, the directory matches by email." },
  { value: "forward_email_to", label: "Forward email to (Termination)", help: "Marks this field as the 'forward to' target." },
  { value: "grant_full_access_to", label: "Grant full mailbox access to (Termination)", help: "Marks this field as the 'grant access to' target." },
];

function FieldEditor({ field, allFields, requestTypes, kindLabels, onChange, onMoveUp, onMoveDown, onRemove, isFirst, isLast }: {
  field: any;
  allFields: any[];
  requestTypes: string[];
  kindLabels: Record<string, string>;
  onChange: (patch: any) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
  isFirst: boolean;
  isLast: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const f = field;

  const sourceField = f.auto_from ? allFields.find((x) => x.id === f.auto_from!.source_field_id) : null;
  const sourceKind = sourceField?.resource_kind;

  // Suggest reasonable attribute keys based on kind.
  const ATTR_SUGGESTIONS: Record<string, string[]> = {
    property: ["name", "address", "code", "notes"],
    shared_mailbox: ["name", "address", "owner"],
    network_folder: ["name", "path", "permissions"],
    distribution_group: ["name", "address", "owner"],
    google_drive: ["name", "url", "default_role"],
    license: ["name", "vendor", "tier"],
    email: ["name", "address"],
    other: ["name", "details"],
  };
  const attrChoices = sourceKind ? ATTR_SUGGESTIONS[sourceKind] || ["name"] : ["name"];

  // Discriminator: undefined = always visible; array (even empty) = restricted.
  const visibleAlways = f.visible_when_request_type_in === undefined;
  const visibleSet = new Set<string>(f.visible_when_request_type_in || []);
  const toggleVisibility = (rt: string) => {
    const next = new Set(visibleSet);
    if (next.has(rt)) next.delete(rt); else next.add(rt);
    onChange({ visible_when_request_type_in: Array.from(next) });
  };

  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
      {/* Header: label + summary + actions */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-100 dark:border-slate-700">
        <button className="btn-ghost p-1" onClick={() => setOpen(!open)} title={open ? "Collapse" : "Expand"}>
          <span className={`inline-block transition-transform ${open ? "rotate-90" : ""}`}>▸</span>
        </button>
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm truncate">{f.label || <span className="text-slate-400 italic">(no label)</span>}</div>
          <div className="text-xs text-slate-500">
            {FIELD_TYPE_LABELS[f.type] || f.type}
            {f.type === "resource" && f.resource_kind ? ` — ${kindLabels[f.resource_kind] || f.resource_kind}` : ""}
            {f.required ? " · required" : ""}
            {!visibleAlways ? ` · only on: ${(f.visible_when_request_type_in || []).join(", ")}` : ""}
          </div>
        </div>
        <button className="btn-ghost text-xs" onClick={onMoveUp} disabled={isFirst} title="Move up">↑</button>
        <button className="btn-ghost text-xs" onClick={onMoveDown} disabled={isLast} title="Move down">↓</button>
        <button className="btn-ghost text-red-600 text-xs" onClick={onRemove} title="Remove">Remove</button>
      </div>

      {open && (
        <div className="p-4 space-y-4">
          {/* Basics */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="label">Label <span className="text-red-500">*</span></label>
              <input className="input" value={f.label} onChange={(e) => onChange({ label: e.target.value })} placeholder="e.g. Property" />
              <p className="help">What the person filling out the form sees.</p>
            </div>
            <div>
              <label className="label">Field type</label>
              <select className="input" value={f.type} onChange={(e) => onChange({ type: e.target.value })}>
                {Object.entries(FIELD_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="label">Help text (optional)</label>
              <input className="input" value={f.description || ""} onChange={(e) => onChange({ description: e.target.value })} placeholder="A short hint shown under the field." />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={!!f.required} onChange={(e) => onChange({ required: e.target.checked })} />
              Required (must be filled in to submit)
            </label>
          </div>

          {/* Type-specific config */}
          {f.type === "select" && (
            <div className="rounded-md bg-slate-50 dark:bg-slate-900/40 p-3">
              <label className="label">Options (one per line)</label>
              <textarea className="input min-h-[80px]" value={(f.options || []).join("\n")}
                onChange={(e) => onChange({ options: e.target.value.split("\n").map(s => s.trim()).filter(Boolean) })}
                placeholder={"Option A\nOption B\nOption C"} />
            </div>
          )}

          {f.type === "resource" && (
            <div className="rounded-md bg-blue-50 dark:bg-blue-950/30 border border-blue-100 dark:border-blue-900 p-3 space-y-3">
              <div>
                <label className="label">Pick from which Resources catalog?</label>
                <select className="input" value={f.resource_kind || ""}
                  onChange={(e) => onChange({ resource_kind: e.target.value || undefined })}>
                  <option value="">— choose a kind —</option>
                  {Object.entries(kindLabels).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
                <p className="help">Manage these entries on the <strong>Resources</strong> page.</p>
              </div>
              <div>
                <label className="label">Only show options linked to another field? (optional)</label>
                <select className="input" value={f.filter_by?.source_field_id || ""}
                  onChange={(e) => onChange({ filter_by: e.target.value ? { source_field_id: e.target.value } : undefined })}>
                  <option value="">No — show all {f.resource_kind ? (kindLabels[f.resource_kind] || f.resource_kind).toLowerCase() + "s" : "options"}</option>
                  {allFields.filter((x) => x.id !== f.id && x.type === "resource").map((x) => (
                    <option key={x.id} value={x.id}>Yes — only those linked to "{x.label || x.id}"</option>
                  ))}
                </select>
                <p className="help">Example: a Mailbox field that only lists mailboxes linked to the Property selected above. Set up the links on the Resources page.</p>
              </div>
            </div>
          )}

          {/* Visibility */}
          <div className="rounded-md bg-slate-50 dark:bg-slate-900/40 p-3">
            <label className="label">When should this field appear?</label>
            <div className="space-y-1 text-sm">
              <label className="flex items-center gap-2">
                <input type="radio" checked={visibleAlways}
                  onChange={() => onChange({ visible_when_request_type_in: undefined })} />
                Always (every request type)
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" checked={!visibleAlways}
                  onChange={() => onChange({ visible_when_request_type_in: requestTypes.slice() })} />
                Only on certain request types:
              </label>
              {!visibleAlways && (
                <div className="pl-6 pt-1 flex flex-wrap gap-2">
                  {requestTypes.length === 0 && <span className="text-xs text-slate-500 italic">Add request types at the top of this page first.</span>}
                  {requestTypes.map((rt) => (
                    <label key={rt} className={`px-2 py-1 rounded-full border text-xs cursor-pointer ${visibleSet.has(rt) ? "bg-brand-600 text-white border-brand-600" : "bg-white dark:bg-slate-800 border-slate-300"}`}>
                      <input type="checkbox" className="hidden" checked={visibleSet.has(rt)} onChange={() => toggleVisibility(rt)} />
                      {rt}
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Advanced */}
          <button type="button" className="text-xs text-slate-500 hover:text-slate-800" onClick={() => setAdvanced(!advanced)}>
            {advanced ? "▾ Hide advanced (auto-fill, ID, role)" : "▸ Show advanced (auto-fill, ID, role)"}
          </button>

          {advanced && (
            <div className="rounded-md border border-dashed border-slate-300 dark:border-slate-700 p-3 space-y-3">
              <div>
                <label className="label">Auto-fill this field from another field's selection (optional)</label>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <select className="input" value={f.auto_from?.source_field_id || ""}
                    onChange={(e) => onChange({ auto_from: e.target.value ? { source_field_id: e.target.value, attribute: f.auto_from?.attribute || "name" } : undefined })}>
                    <option value="">— don't auto-fill —</option>
                    {allFields.filter((x) => x.id !== f.id).map((x) => (
                      <option key={x.id} value={x.id}>From "{x.label || x.id}"{x.type === "resource" ? " (resource)" : ""}</option>
                    ))}
                  </select>
                  {f.auto_from && (
                    sourceField?.type === "resource" ? (
                      <select className="input" value={f.auto_from.attribute || "name"}
                        onChange={(e) => onChange({ auto_from: { ...f.auto_from!, attribute: e.target.value } })}>
                        {attrChoices.map((a) => <option key={a} value={a}>Use the resource's "{a}"</option>)}
                      </select>
                    ) : (
                      <input className="input" placeholder="(mirrors the source field value)" disabled value="(copy value)" />
                    )
                  )}
                </div>
                <p className="help">
                  Example: a "Property Address" text field can auto-fill from the "Property" resource field using the property's <code>address</code> attribute.
                </p>
              </div>

              <div>
                <label className="label">Special role (optional)</label>
                <select className="input" value={f.role || ""}
                  onChange={(e) => onChange({ role: e.target.value || undefined })}>
                  {ROLE_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
                <p className="help">{ROLE_OPTIONS.find((r) => r.value === (f.role || ""))?.help || "Lets the form treat this field specially (e.g. as the employee's name for directory lookup)."}</p>
              </div>

              <div>
                <label className="label">Field ID (technical name)</label>
                <input className="input font-mono text-xs" value={f.id} onChange={(e) => onChange({ id: e.target.value })} />
                <p className="help">Used in exports and as the storage key. Leave alone unless you know what you're doing.</p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function GroupsEditor({ doc, setDoc }: { doc: FormSchemaDoc; setDoc: (d: FormSchemaDoc) => void }) {
  const groups = doc.groups || [];
  const setGroup = (i: number, patch: any) => {
    const n = groups.slice(); n[i] = { ...n[i], ...patch };
    setDoc({ ...doc, groups: n });
  };
  const addItem = (gi: number) => setGroup(gi, { items: [...groups[gi].items, { id: `item_${groups[gi].items.length + 1}`, label: "New item" }] });
  return (
    <div className="card">
      <div className="card-header flex items-center justify-between">
        <h3 className="font-semibold">Groups (checkboxes)</h3>
        <button className="btn-secondary" onClick={() =>
          setDoc({ ...doc, groups: [...groups, { id: `group_${groups.length + 1}`, title: "New Group", enabled: true, items: [] }] })}>
          Add group
        </button>
      </div>
      <div className="card-body space-y-4">
        {groups.map((g, i) => (
          <div key={i} className="rounded-lg border border-slate-200 p-3 space-y-2">
            <div className="flex gap-2">
              <input className="input" value={g.title} onChange={(e) => setGroup(i, { title: e.target.value })} placeholder="Group title" />
              <input className="input max-w-[160px]" value={g.id} onChange={(e) => setGroup(i, { id: e.target.value })} placeholder="id" />
              <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={g.enabled} onChange={(e) => setGroup(i, { enabled: e.target.checked })} /> enabled</label>
              <button className="btn-ghost text-red-600" onClick={() => setDoc({ ...doc, groups: groups.filter((_, j) => j !== i) })}>Remove</button>
            </div>
            <div className="space-y-1">
              {g.items.map((it, j) => (
                <div key={j} className="grid grid-cols-12 gap-2">
                  <input className="input col-span-3" value={it.id} onChange={(e) => setGroup(i, { items: g.items.map((x, k) => k === j ? { ...x, id: e.target.value } : x) })} />
                  <input className="input col-span-4" value={it.label} onChange={(e) => setGroup(i, { items: g.items.map((x, k) => k === j ? { ...x, label: e.target.value } : x) })} />
                  <input className="input col-span-4" placeholder="description" value={it.description || ""} onChange={(e) => setGroup(i, { items: g.items.map((x, k) => k === j ? { ...x, description: e.target.value } : x) })} />
                  <button className="btn-ghost text-red-600 col-span-1" onClick={() => setGroup(i, { items: g.items.filter((_, k) => k !== j) })}>×</button>
                </div>
              ))}
              <button className="btn-ghost text-sm" onClick={() => addItem(i)}>+ Add item</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function RequestTypeChipPicker({ label, help, options, value, onChange }: {
  label: string;
  help?: string;
  options: string[];
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const set = new Set(value);
  const toggle = (opt: string) => {
    const next = new Set(set);
    if (next.has(opt)) next.delete(opt); else next.add(opt);
    onChange(Array.from(next));
  };
  return (
    <div>
      <label className="label">{label}</label>
      {help && <p className="help mb-1">{help}</p>}
      {options.length === 0 ? (
        <p className="text-xs text-slate-500 italic">Add request types above first.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {options.map((opt) => (
            <label key={opt} className={`px-3 py-1 rounded-full border text-xs cursor-pointer select-none ${set.has(opt) ? "bg-brand-600 text-white border-brand-600" : "bg-white dark:bg-slate-800 border-slate-300 hover:border-slate-400"}`}>
              <input type="checkbox" className="hidden" checked={set.has(opt)} onChange={() => toggle(opt)} />
              {opt}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
