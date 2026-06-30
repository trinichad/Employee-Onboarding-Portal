import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import toast from "react-hot-toast";
import { orgApi } from "@/api";
import { apiError } from "@/api/client";
import { PageHeader, Spinner } from "@/components/ui";
import { FormRenderer } from "@/components/FormRenderer";
import type { FormField, FormGroup, FormSchemaDoc } from "@/types";

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
  // Attribute keys defined per resource category ("Manage resource categories").
  // Empty array = no schema configured for that kind, so the editor falls back
  // to a built-in suggestion list.
  const kindAttrs = useMemo<Record<string, string[]>>(() => {
    const cfg = (org.data?.branding as any)?.resource_kinds;
    if (!Array.isArray(cfg)) return {};
    const m: Record<string, string[]> = {};
    for (const k of cfg) {
      const v = String(k?.value || "").trim();
      if (!v) continue;
      const attrs = Array.isArray(k?.attrs) ? k.attrs : [];
      m[v] = attrs
        .map((a: any) => String(a?.key || "").trim())
        .filter((s: string) => !!s);
    }
    return m;
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

  const importRef = useRef<HTMLInputElement | null>(null);
  const onExport = () => {
    const slug = orgSlug || "form";
    const stamp = new Date().toISOString().slice(0, 10);
    const json = tab === "json" ? jsonText : JSON.stringify(doc, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `form-${slug}-v${form.data?.version ?? 0}-${stamp}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };
  const onImportPick = () => importRef.current?.click();
  const onImportFile = async (file: File) => {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== "object") throw new Error("File must contain a JSON object");
      // Accept either the raw schema doc or a wrapped { schema: ... } export.
      const next: FormSchemaDoc = (parsed.schema && typeof parsed.schema === "object") ? parsed.schema : parsed;
      if (!Array.isArray(next.fields) && !Array.isArray(next.groups)) {
        throw new Error("File does not look like a form schema (missing fields/groups)");
      }
      if (!window.confirm("Replace the current form draft with the contents of this file? You'll still need to click \"Save new version\" to publish.")) {
        return;
      }
      setDoc(next);
      setJsonText(JSON.stringify(next, null, 2));
      toast.success("Form loaded — review and click \"Save new version\" to publish.");
    } catch (e: any) {
      toast.error("Invalid form file: " + (e?.message || String(e)));
    } finally {
      if (importRef.current) importRef.current.value = "";
    }
  };

  if (form.isLoading) return <Spinner />;

  return (
    <>
      <PageHeader title="Form Builder" description={`Active version: v${form.data?.version}`}
        actions={
          <div className="flex gap-2">
            <input
              ref={importRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void onImportFile(f); }}
            />
            <button className="btn-secondary" onClick={onImportPick} title="Replace the current draft with a previously exported form file">Import…</button>
            <button className="btn-secondary" onClick={onExport} title="Download the current form as JSON">Export</button>
            <button className="btn-primary" disabled={save.isPending} onClick={handleSave}>{save.isPending ? "Saving…" : "Save new version"}</button>
          </div>
        } />

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
            <div><label className="label" htmlFor="fb-form-name">Form name</label>
              <input id="fb-form-name" className="input" value={doc.form_name || ""} onChange={(e) => setDoc({ ...doc, form_name: e.target.value })} /></div>
            <div><label className="label" htmlFor="fb-request-types">Request types (one per line)</label>
              <LinesTextarea
                id="fb-request-types"
                value={doc.request_types || []}
                onCommit={(lines) => setDoc({ ...doc, request_types: lines })}
                className="input min-h-[80px]"
              />
              <p className="help">e.g. New Hire, Promotion, Rehire, Termination. Per-field visibility ("show only on…") is set on each field below.</p>
            </div>
            <div className="md:col-span-2 grid md:grid-cols-2 gap-4 pt-2 border-t border-slate-100 dark:border-slate-700">
              <RequestTypeChipPicker
                label="Show employee lookup on these request types"
                help="When the user picks one of these, an 'existing employee' typeahead appears so they can prefill from the employee's last submission. Leave empty to disable lookup."
                options={doc.request_types || []}
                value={doc.lookup_request_types || []}
                onChange={(v) => setDoc({ ...doc, lookup_request_types: v })}
              />
              <RequestTypeChipPicker
                label="Treat these as termination requests"
                help="Marks the employee as terminated on submit and surfaces the 'currently assigned' summary using the forward_email_to / grant_full_access_to fields."
                options={doc.request_types || []}
                value={doc.termination_request_types || []}
                onChange={(v) => setDoc({ ...doc, termination_request_types: v })}
              />
              <RequestTypeChipPicker
                label="Show previous-access review on these request types"
                help="For requests like Promotion or Property Transfer: after picking the employee, every field and group flagged 'Include in previous-access review' shows a Keep / Remove pill next to each previously-granted item so reviewers know what to revoke vs carry forward."
                options={doc.request_types || []}
                value={doc.prior_access_request_types || []}
                onChange={(v) => setDoc({ ...doc, prior_access_request_types: v })}
              />
            </div>
          </div></div>

          <FieldsEditor doc={doc} setDoc={setDoc} kindLabels={kindLabels} kindAttrs={kindAttrs} />
          <GroupsEditor doc={doc} setDoc={setDoc} kindLabels={kindLabels} />
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

function FieldsEditor({ doc, setDoc, kindLabels, kindAttrs }: { doc: FormSchemaDoc; setDoc: (d: FormSchemaDoc) => void; kindLabels: Record<string, string>; kindAttrs: Record<string, string[]> }) {
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
            kindAttrs={kindAttrs}
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

function FieldEditor({ field, allFields, requestTypes, kindLabels, kindAttrs, onChange, onMoveUp, onMoveDown, onRemove, isFirst, isLast }: {
  field: any;
  allFields: any[];
  requestTypes: string[];
  kindLabels: Record<string, string>;
  kindAttrs: Record<string, string[]>;
  onChange: (patch: any) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
  isFirst: boolean;
  isLast: boolean;
}) {
  const uid = useId();
  const [open, setOpen] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const f = field;

  const sourceField = f.auto_from ? allFields.find((x) => x.id === f.auto_from!.source_field_id) : null;
  const sourceKind = sourceField?.resource_kind;

  // Suggest reasonable attribute keys based on kind. Used only as a fallback
  // when the org hasn't configured attributes for this category yet.
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
  // Prefer the attribute keys the admin actually configured under
  // "Manage resource categories"; fall back to the built-in suggestions if
  // the category has no configured attributes yet. "name" is always offered.
  const attrChoices = useMemo<string[]>(() => {
    if (!sourceKind) return ["name"];
    const configured = kindAttrs[sourceKind] || [];
    const fallback = ATTR_SUGGESTIONS[sourceKind] || [];
    const merged: string[] = ["name"];
    for (const k of [...configured, ...fallback]) {
      if (k && !merged.includes(k)) merged.push(k);
    }
    return merged;
  }, [sourceKind, kindAttrs]);

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
              <label className="label" htmlFor={`${uid}-label`}>Label <span className="text-red-500">*</span></label>
              <input id={`${uid}-label`} className="input" value={f.label} onChange={(e) => onChange({ label: e.target.value })} placeholder="e.g. Property" />
              <p className="help">What the person filling out the form sees.</p>
            </div>
            <div>
              <label className="label" htmlFor={`${uid}-type`}>Field type</label>
              <select id={`${uid}-type`} className="input" value={f.type} onChange={(e) => onChange({ type: e.target.value })}>
                {Object.entries(FIELD_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="label" htmlFor={`${uid}-help`}>Help text (optional)</label>
              <input id={`${uid}-help`} className="input" value={f.description || ""} onChange={(e) => onChange({ description: e.target.value })} placeholder="A short hint shown under the field." />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={!!f.required} onChange={(e) => onChange({ required: e.target.checked })} />
              Required (must be filled in to submit)
            </label>
          </div>

          {/* Type-specific config */}
          {f.type === "select" && (
            <div className="rounded-md bg-slate-50 dark:bg-slate-900/40 p-3">
              <label className="label" htmlFor={`${uid}-options`}>Options (one per line)</label>
              <LinesTextarea
                id={`${uid}-options`}
                value={f.options || []}
                onCommit={(lines) => onChange({ options: lines })}
                className="input min-h-[80px]"
                placeholder={"Option A\nOption B\nOption C"}
              />
            </div>
          )}

          {f.type === "resource" && (
            <div className="rounded-md bg-blue-50 dark:bg-blue-950/30 border border-blue-100 dark:border-blue-900 p-3 space-y-3">
              <div>
                <label className="label" htmlFor={`${uid}-rkind`}>Pick from which Resources catalog?</label>
                <select id={`${uid}-rkind`} className="input" value={f.resource_kind || ""}
                  onChange={(e) => onChange({ resource_kind: e.target.value || undefined })}>
                  <option value="">— choose a kind —</option>
                  {Object.entries(kindLabels).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
                <p className="help">Manage these entries on the <strong>Resources</strong> page.</p>
              </div>
              <div>
                <label className="label" htmlFor={`${uid}-filter`}>Only show options linked to another field? (optional)</label>
                <select id={`${uid}-filter`} className="input" value={f.filter_by?.source_field_id || ""}
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
                <label className="label" htmlFor={`${uid}-autofrom`}>Auto-fill this field from another field's selection (optional)</label>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <select id={`${uid}-autofrom`} className="input" value={f.auto_from?.source_field_id || ""}
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
                <label className="label" htmlFor={`${uid}-role`}>Special role (optional)</label>
                <select id={`${uid}-role`} className="input" value={f.role || ""}
                  onChange={(e) => onChange({ role: e.target.value || undefined })}>
                  {ROLE_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
                <p className="help">{ROLE_OPTIONS.find((r) => r.value === (f.role || ""))?.help || "Lets the form treat this field specially (e.g. as the employee's name for directory lookup)."}</p>
              </div>

              <div>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={!!f.prior_access_tracked}
                    onChange={(e) => onChange({ prior_access_tracked: e.target.checked || undefined })}
                  />
                  Include in previous-access review
                </label>
                <p className="help">When the request type is in <em>"Show previous-access review on these request types"</em>, the value loaded from the employee's prior submission gets a <strong>Keep</strong> / <strong>Remove</strong> pill next to this field. Use this for items like Property where the reviewer needs to know whether prior access is being revoked.</p>
              </div>

              <div>
                <label className="label" htmlFor={`${uid}-fieldid`}>Field ID (technical name)</label>
                <input id={`${uid}-fieldid`} className="input font-mono text-xs" value={f.id} onChange={(e) => onChange({ id: e.target.value })} />
                <p className="help">Used in exports and as the storage key. Leave alone unless you know what you're doing.</p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function GroupsEditor({ doc, setDoc, kindLabels }: { doc: FormSchemaDoc; setDoc: (d: FormSchemaDoc) => void; kindLabels: Record<string, string> }) {
  const groups = doc.groups || [];
  const resourceFields = (doc.fields || []).filter((f) => f.type === "resource");
  const setGroup = (i: number, patch: any) => {
    const n = groups.slice(); n[i] = { ...n[i], ...patch };
    setDoc({ ...doc, groups: n });
  };
  const moveGroup = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= groups.length) return;
    const next = groups.slice();
    [next[i], next[j]] = [next[j], next[i]];
    setDoc({ ...doc, groups: next });
  };
  const moveItem = (gi: number, ii: number, dir: -1 | 1) => {
    const g = groups[gi];
    const j = ii + dir;
    if (j < 0 || j >= g.items.length) return;
    const items = g.items.slice();
    [items[ii], items[j]] = [items[j], items[ii]];
    setGroup(gi, { items });
  };
  const addItem = (gi: number) => setGroup(gi, { items: [...groups[gi].items, { id: `item_${groups[gi].items.length + 1}`, label: "New item" }] });
  return (
    <div className="card">
      <div className="card-header flex items-center justify-between">
        <div>
          <h3 className="font-semibold">Groups (checkboxes)</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">A group is a set of related checkboxes (e.g. Email Groups, Shared Mailboxes). Optionally tie a group to a resource field — for example, render one "Network Drives" group per Property the user is assigned to, with extra properties added on the fly.</p>
        </div>
        <button className="btn-secondary" onClick={() =>
          setDoc({ ...doc, groups: [...groups, { id: `group_${groups.length + 1}`, title: "New Group", enabled: true, items: [] }] })}>
          Add group
        </button>
      </div>
      <div className="card-body space-y-4">
        {groups.map((g, i) => (
          <div key={i} className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 space-y-2">
            <div className="flex gap-2 items-center flex-wrap">
              <input className="input" value={g.title} onChange={(e) => setGroup(i, { title: e.target.value })} placeholder="Group title" />
              <input className="input max-w-[160px]" value={g.id} onChange={(e) => setGroup(i, { id: e.target.value })} placeholder="id" />
              <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={g.enabled} onChange={(e) => setGroup(i, { enabled: e.target.checked })} /> enabled</label>
              <label className="flex items-center gap-1 text-xs" title="When the request type is in 'Show previous-access review on these request types', items checked in the employee's prior submission render a Keep / Remove pill.">
                <input type="checkbox" checked={!!g.prior_access_tracked} onChange={(e) => setGroup(i, { prior_access_tracked: e.target.checked || undefined })} />
                previous-access review
              </label>
              <button className="btn-ghost text-xs" onClick={() => moveGroup(i, -1)} disabled={i === 0} title="Move group up">↑</button>
              <button className="btn-ghost text-xs" onClick={() => moveGroup(i, 1)} disabled={i === groups.length - 1} title="Move group down">↓</button>
              <button className="btn-ghost text-red-600" onClick={() => setDoc({ ...doc, groups: groups.filter((_, j) => j !== i) })}>Remove</button>
            </div>

            <DynamicGroupConfig
              group={g}
              resourceFields={resourceFields}
              kindLabels={kindLabels}
              onChange={(patch) => setGroup(i, patch)}
            />

            <VisibleWhenConfig
              group={g}
              resourceFields={resourceFields}
              onChange={(patch) => setGroup(i, patch)}
            />

            <div className="space-y-3">
              {g.items.map((it, j) => (
                <div key={j} className="space-y-2 rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/40 p-2">
                  <div className="grid grid-cols-12 gap-2 items-center">
                    <input className="input col-span-3" value={it.id} onChange={(e) => setGroup(i, { items: g.items.map((x, k) => k === j ? { ...x, id: e.target.value } : x) })} />
                    <input className="input col-span-4" value={it.label} onChange={(e) => setGroup(i, { items: g.items.map((x, k) => k === j ? { ...x, label: e.target.value } : x) })} />
                    <input className="input col-span-3" placeholder="description" value={it.description || ""} onChange={(e) => setGroup(i, { items: g.items.map((x, k) => k === j ? { ...x, description: e.target.value } : x) })} />
                    <div className="col-span-2 flex justify-end gap-1">
                      <button className="btn-ghost text-xs" onClick={() => moveItem(i, j, -1)} disabled={j === 0} title="Move item up">↑</button>
                      <button className="btn-ghost text-xs" onClick={() => moveItem(i, j, 1)} disabled={j === g.items.length - 1} title="Move item down">↓</button>
                      <button className="btn-ghost text-red-600 text-xs" onClick={() => setGroup(i, { items: g.items.filter((_, k) => k !== j) })} title="Remove">×</button>
                    </div>
                  </div>
                  {!g.dynamic && resourceFields.length > 0 && (
                    <div className="grid grid-cols-12 gap-2 items-center pt-1 border-t border-dashed border-slate-200 dark:border-slate-700 text-xs text-slate-500">
                      <span className="col-span-3 whitespace-nowrap">Auto-check based on:</span>
                      <select
                        className="input text-xs py-1 col-span-4"
                        value={it.auto_check_from?.source_field_id || ""}
                        onChange={(e) => {
                          const sid = e.target.value;
                          setGroup(i, {
                            items: g.items.map((x, k) => k === j ? {
                              ...x,
                              auto_check_from: sid
                                ? { source_field_id: sid, attribute: x.auto_check_from?.attribute || "" }
                                : undefined,
                            } : x),
                          });
                        }}
                      >
                        <option value="">(none — manual only)</option>
                        {resourceFields.map((rf) => (
                          <option key={rf.id} value={rf.id}>{rf.label || rf.id}</option>
                        ))}
                      </select>
                      {it.auto_check_from?.source_field_id ? (
                        <>
                          <span className="col-span-2 text-right whitespace-nowrap">attribute</span>
                          <input
                            className="input text-xs py-1 font-mono col-span-3"
                            placeholder="e.g. adobe_acrobat"
                            value={it.auto_check_from.attribute || ""}
                            onChange={(e) => setGroup(i, {
                              items: g.items.map((x, k) => k === j ? {
                                ...x,
                                auto_check_from: { source_field_id: it.auto_check_from!.source_field_id, attribute: e.target.value },
                              } : x),
                            })}
                          />
                        </>
                      ) : (
                        <span className="col-span-5" />
                      )}
                    </div>
                  )}
                  {g.dynamic && (
                    <div className="grid grid-cols-12 gap-2 items-center pt-1 border-t border-dashed border-slate-200 dark:border-slate-700 text-xs text-slate-500">
                      <span className="col-span-3 whitespace-nowrap">Auto-check based on:</span>
                      <select
                        className="input text-xs py-1 col-span-4"
                        value={it.auto_check_from?.source_field_id || ""}
                        onChange={(e) => {
                          const sid = e.target.value;
                          setGroup(i, {
                            items: g.items.map((x, k) => k === j ? {
                              ...x,
                              auto_check_from: sid
                                ? { source_field_id: sid, attribute: x.auto_check_from?.attribute || "" }
                                : undefined,
                            } : x),
                          });
                        }}
                      >
                        <option value="">(none — manual only)</option>
                        <option value="__self__">(this card's resource)</option>
                        {resourceFields.map((rf) => (
                          <option key={rf.id} value={rf.id}>{rf.label || rf.id}</option>
                        ))}
                      </select>
                      {it.auto_check_from?.source_field_id ? (
                        <>
                          <span className="col-span-2 text-right whitespace-nowrap">attribute</span>
                          <input
                            className="input text-xs py-1 font-mono col-span-3"
                            placeholder="e.g. network_access"
                            value={it.auto_check_from.attribute || ""}
                            onChange={(e) => setGroup(i, {
                              items: g.items.map((x, k) => k === j ? {
                                ...x,
                                auto_check_from: { source_field_id: it.auto_check_from!.source_field_id, attribute: e.target.value },
                              } : x),
                            })}
                          />
                        </>
                      ) : (
                        <span className="col-span-5" />
                      )}
                    </div>
                  )}
                </div>
              ))}
              <button className="btn-ghost text-sm" onClick={() => addItem(i)}>+ Add item</button>
              {!g.dynamic && resourceFields.length > 0 && (
                <p className="help mt-1">
                  <strong>Auto-check tip:</strong> pick a resource field (e.g. <em>Title</em>) and an attribute key (e.g. <code>adobe_acrobat</code>). Set that attribute to <code>yes</code> / <code>true</code> / <code>x</code> on each resource (e.g. each Job Title) under <strong>Resources → Manage categories</strong>. The checkbox will tick automatically when a matching resource is selected.
                </p>
              )}
              {g.dynamic && (
                <p className="help mt-1">
                  <strong>Auto-check tip:</strong> choose <em>(this card's resource)</em> to read the attribute from whichever resource the card represents (e.g. each Property), or pick a different resource field to use that field's resource for every card. Then enter the attribute key (e.g. <code>network_access</code>). The checkbox ticks automatically the moment the card's resource is populated. Manage per-resource attributes under <strong>Resources → Manage categories</strong>.
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DynamicGroupConfig({ group, resourceFields, kindLabels, onChange }: {
  group: FormGroup;
  resourceFields: FormField[];
  kindLabels: Record<string, string>;
  onChange: (patch: Partial<FormGroup>) => void;
}) {
  const dyn = group.dynamic;
  const enabled = !!dyn;
  const kindEntries = Object.entries(kindLabels);
  return (
    <div className="rounded-md bg-blue-50/60 dark:bg-blue-950/30 border border-blue-100 dark:border-blue-900 p-3 space-y-2">
      <label className="flex items-center gap-2 text-sm font-medium text-blue-900 dark:text-blue-200">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => {
            if (e.target.checked) {
              const firstField = resourceFields[0];
              onChange({
                dynamic: {
                  source_field_id: firstField?.id || "",
                  resource_kind: firstField ? undefined : (kindEntries[0]?.[0] || undefined),
                  placeholder: "{Property}",
                  allow_additional: true,
                },
              });
            } else {
              onChange({ dynamic: undefined });
            }
          }}
        />
        Render this group per resource (dynamic group)
      </label>
      <p className="text-xs text-blue-900/80 dark:text-blue-200/80">
        Use this when the same set of checkboxes repeats for each resource (e.g. one set of network-drive options per Property the employee belongs to). The placeholder text below — anywhere in the group title or item labels — gets replaced with the resource's name. Users can optionally add more resources on the form.
      </p>
      {enabled && dyn && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2 pt-1">
          <div>
            <label className="label text-xs">Default resource comes from</label>
            <select
              className="input"
              value={dyn.source_field_id || ""}
              onChange={(e) => {
                const sid = e.target.value;
                const sf = resourceFields.find((rf) => rf.id === sid);
                // When a resource field drives the group, its kind takes
                // precedence; clear the standalone kind override so the
                // renderer follows the field.
                onChange({
                  dynamic: {
                    ...dyn,
                    source_field_id: sid,
                    resource_kind: sid ? undefined : (dyn.resource_kind || sf?.resource_kind),
                  },
                });
              }}
            >
              <option value="">
                {resourceFields.length === 0
                  ? "— none (use Resource category below) —"
                  : "— none (use Resource category below) —"}
              </option>
              {resourceFields.map((rf) => (
                <option key={rf.id} value={rf.id}>{rf.label || rf.id}{rf.resource_kind ? ` (${kindLabels[rf.resource_kind] || rf.resource_kind})` : ""}</option>
              ))}
            </select>
            <p className="help">
              Pick a resource field on this form to use its selected resource as the default. Or leave it as "none" and choose a Resource category — users will pick resources directly via the "+ Add another" button.
            </p>
          </div>
          {!dyn.source_field_id && (
            <div>
              <label className="label text-xs">Resource category</label>
              <select
                className="input"
                value={dyn.resource_kind || ""}
                onChange={(e) => onChange({ dynamic: { ...dyn, resource_kind: e.target.value || undefined } })}
              >
                <option value="">— choose a category —</option>
                {kindEntries.map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
              <p className="help">The catalog this group pulls resources from. Manage categories under <strong>Resources</strong>.</p>
            </div>
          )}
          <div>
            <label className="label text-xs">Placeholder token</label>
            <input
              className="input font-mono"
              value={dyn.placeholder || "{Property}"}
              onChange={(e) => onChange({ dynamic: { ...dyn, placeholder: e.target.value } })}
              placeholder="{Property}"
            />
            <p className="help">Wherever this exact text appears in the title/items, it's replaced with the resource's name.</p>
          </div>
          <div className="space-y-1">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={!!dyn.allow_additional}
                onChange={(e) => onChange({ dynamic: { ...dyn, allow_additional: e.target.checked } })}
              />
              Allow users to add more resources
            </label>
            {dyn.allow_additional && (
              <input
                className="input"
                value={dyn.additional_button_label || ""}
                onChange={(e) => onChange({ dynamic: { ...dyn, additional_button_label: e.target.value || undefined } })}
                placeholder="+ Add another property (optional)"
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Per-group "Show only when …" rule editor. Drives `group.visible_when`,
 * which the form renderer (and backend summary builder) consult to skip
 * groups or — for dynamic groups — individual per-resource instances when
 * a selected resource's attribute does/does not satisfy the condition.
 *
 * Typical use: "only show this Network Drives block for Properties whose
 * `is_corporate` attribute is true", or its inverse via the Negate toggle.
 */
function VisibleWhenConfig({ group, resourceFields, onChange }: {
  group: FormGroup;
  resourceFields: FormField[];
  onChange: (patch: Partial<FormGroup>) => void;
}) {
  const vw = group.visible_when;
  const enabled = !!vw;
  // Dynamic groups always check the per-instance resource so the source
  // field is implicit. Static groups must pick which resource field to read.
  const isDynamic = !!group.dynamic;
  const mode: "truthy" | "equals" = vw?.equals !== undefined ? "equals" : "truthy";
  const equalsCsv = Array.isArray(vw?.equals)
    ? (vw?.equals as string[]).join(", ")
    : (vw?.equals as string | undefined) || "";

  const update = (patch: Partial<NonNullable<FormGroup["visible_when"]>>) => {
    onChange({ visible_when: { ...(vw as any), ...patch } });
  };

  return (
    <div className="rounded-md bg-amber-50/60 dark:bg-amber-950/30 border border-amber-100 dark:border-amber-900 p-3 space-y-2">
      <label className="flex items-center gap-2 text-sm font-medium text-amber-900 dark:text-amber-200">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => {
            if (e.target.checked) {
              onChange({
                visible_when: {
                  source_field_id: isDynamic ? undefined : (resourceFields[0]?.id || ""),
                  attribute: "",
                  truthy: true,
                },
              });
            } else {
              onChange({ visible_when: undefined });
            }
          }}
        />
        Only show this group when a resource attribute matches
      </label>
      <p className="text-xs text-amber-900/80 dark:text-amber-200/80">
        {isDynamic
          ? "Each per-resource instance of this dynamic group is shown only when that resource's attribute matches the rule below. Combine with Negate to hide matching resources instead (e.g. hide Corporate Office properties)."
          : "This group renders only when the resource selected in the chosen field has an attribute that matches the rule below."}
      </p>
      {enabled && vw && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2 pt-1">
          {!isDynamic && (
            <div>
              <label className="label text-xs">Source field</label>
              <select
                className="input"
                value={vw.source_field_id || ""}
                onChange={(e) => update({ source_field_id: e.target.value })}
              >
                <option value="">— pick a resource field —</option>
                {resourceFields.map((rf) => (
                  <option key={rf.id} value={rf.id}>{rf.label || rf.id}{rf.resource_kind ? ` (${rf.resource_kind})` : ""}</option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label className="label text-xs">Attribute key</label>
            <input
              className="input font-mono"
              value={vw.attribute}
              onChange={(e) => update({ attribute: e.target.value })}
              placeholder="is_corporate"
            />
            <p className="help">Must match an attribute key configured on the resource.</p>
          </div>
          <div>
            <label className="label text-xs">Match mode</label>
            <select
              className="input"
              value={mode}
              onChange={(e) => {
                if (e.target.value === "truthy") {
                  update({ equals: undefined, truthy: true });
                } else {
                  update({ truthy: undefined, equals: "" });
                }
              }}
            >
              <option value="truthy">Truthy (yes / true / 1 / x / non-empty)</option>
              <option value="equals">Equals one of …</option>
            </select>
          </div>
          {mode === "equals" && (
            <div>
              <label className="label text-xs">Value(s)</label>
              <input
                className="input"
                value={equalsCsv}
                onChange={(e) => {
                  const raw = e.target.value;
                  const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
                  update({ equals: parts.length <= 1 ? raw : parts });
                }}
                placeholder="corporate, hq"
              />
              <p className="help">Comma-separate to match any of several values. Case-insensitive.</p>
            </div>
          )}
          <div className="md:col-span-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={!!vw.negate}
                onChange={(e) => update({ negate: e.target.checked })}
              />
              Negate — hide when the rule matches (instead of showing)
            </label>
          </div>
          {isDynamic && (
            <div className="md:col-span-4">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={!!vw.keep_picker}
                  onChange={(e) => update({ keep_picker: e.target.checked })}
                />
                Picker-only — hide the default block, just show "+ Add another …"
              </label>
              <p className="help">
                Makes this group purely a picker (no items for the primary resource). Useful when the primary resource has its own dedicated group elsewhere, but should also be able to add access for other resources. Example: a Corporate Office user adding access to specific property shared mailboxes — without duplicating the regular per-property mailbox group for non-corporate users.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Textarea bound to an array of lines. Stores raw text locally while the
 * user is typing so newlines aren't lost (the previous version trimmed and
 * filtered empties on every keystroke, which prevented Enter from creating
 * a new blank line). Commits the cleaned list on blur, and resyncs from
 * props when the parent value changes externally.
 */
function LinesTextarea({ value, onCommit, className, placeholder, id }: {
  value: string[];
  onCommit: (lines: string[]) => void;
  className?: string;
  placeholder?: string;
  id?: string;
}) {
  const joined = (value || []).join("\n");
  const [text, setText] = useState(joined);
  const lastJoined = useRef(joined);
  useEffect(() => {
    // Only resync if the parent's array changed (e.g. external load), not
    // because we just committed the same text.
    if (joined !== lastJoined.current) {
      setText(joined);
      lastJoined.current = joined;
    }
  }, [joined]);
  return (
    <textarea
      id={id}
      className={className}
      placeholder={placeholder}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        const lines = text.split("\n").map((s) => s.trim()).filter(Boolean);
        lastJoined.current = lines.join("\n");
        onCommit(lines);
      }}
    />
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
