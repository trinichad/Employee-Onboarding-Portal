import { useEffect, useState } from "react";
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
          <div className="card"><div className="card-body grid md:grid-cols-2 gap-4">
            <div><label className="label">Form name</label>
              <input className="input" value={doc.form_name || ""} onChange={(e) => setDoc({ ...doc, form_name: e.target.value })} /></div>
            <div><label className="label">Request types (one per line)</label>
              <textarea className="input min-h-[80px]" value={(doc.request_types || []).join("\n")}
                onChange={(e) => setDoc({ ...doc, request_types: e.target.value.split("\n").map(s => s.trim()).filter(Boolean) })} /></div>
            <div><label className="label">Lookup request types</label>
              <p className="help mb-1">When the requestor picks one of these, the form shows an employee typeahead and prefills from their last submission.</p>
              <textarea className="input min-h-[60px]" value={(doc.lookup_request_types || ["Promotion","Termination","Rehire"]).join("\n")}
                onChange={(e) => setDoc({ ...doc, lookup_request_types: e.target.value.split("\n").map(s => s.trim()).filter(Boolean) })} /></div>
            <div><label className="label">Termination request types</label>
              <p className="help mb-1">Marks the employee as terminated and shows a current-access summary.</p>
              <textarea className="input min-h-[60px]" value={(doc.termination_request_types || ["Termination"]).join("\n")}
                onChange={(e) => setDoc({ ...doc, termination_request_types: e.target.value.split("\n").map(s => s.trim()).filter(Boolean) })} /></div>
          </div></div>

          <FieldsEditor doc={doc} setDoc={setDoc} />
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

function FieldsEditor({ doc, setDoc }: { doc: FormSchemaDoc; setDoc: (d: FormSchemaDoc) => void }) {
  const fields = doc.fields || [];
  const update = (i: number, patch: Partial<any>) => {
    const next = fields.slice(); next[i] = { ...next[i], ...patch };
    setDoc({ ...doc, fields: next });
  };
  return (
    <div className="card">
      <div className="card-header flex items-center justify-between">
        <h3 className="font-semibold">Fields</h3>
        <button className="btn-secondary" onClick={() =>
          setDoc({ ...doc, fields: [...fields, { id: `field_${fields.length + 1}`, label: "New field", type: "text", required: false }] })}>
          Add field
        </button>
      </div>
      <div className="card-body space-y-3">
        {fields.map((f, i) => (
          <div key={i} className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 space-y-2">
            <div className="grid grid-cols-1 md:grid-cols-12 gap-2 items-start">
              <input className="input md:col-span-3" placeholder="id" value={f.id} onChange={(e) => update(i, { id: e.target.value })} />
              <input className="input md:col-span-3" placeholder="Label" value={f.label} onChange={(e) => update(i, { label: e.target.value })} />
              <select className="input md:col-span-2" value={f.type} onChange={(e) => update(i, { type: e.target.value })}>
                {["text", "date", "email", "number", "textarea", "select", "resource"].map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <input className="input md:col-span-3" placeholder="Description" value={f.description || ""} onChange={(e) => update(i, { description: e.target.value })} />
              <label className="flex items-center gap-1 text-xs md:col-span-1">
                <input type="checkbox" checked={!!f.required} onChange={(e) => update(i, { required: e.target.checked })} /> req
              </label>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-12 gap-2 items-start">
              {f.type === "resource" && (
                <select className="input md:col-span-3" value={f.resource_kind || ""}
                  onChange={(e) => update(i, { resource_kind: e.target.value || undefined })}>
                  <option value="">resource kind…</option>
                  {["property","shared_mailbox","network_folder","distribution_group","google_drive","license","email","other"].map((k) => <option key={k} value={k}>{k}</option>)}
                </select>
              )}
              {f.type === "resource" && (
                <select className="input md:col-span-3" value={f.filter_by?.source_field_id || ""}
                  onChange={(e) => update(i, { filter_by: e.target.value ? { source_field_id: e.target.value } : undefined })}>
                  <option value="">filter by… (none)</option>
                  {fields.filter((x) => x.id !== f.id && x.type === "resource").map((x) => <option key={x.id} value={x.id}>{x.label || x.id}</option>)}
                </select>
              )}
              {f.type === "select" && (
                <input className="input md:col-span-6" placeholder="options (comma-separated)" value={(f.options || []).join(", ")}
                  onChange={(e) => update(i, { options: e.target.value.split(",").map(s => s.trim()).filter(Boolean) })} />
              )}
              <select className="input md:col-span-3" value={f.auto_from?.source_field_id || ""}
                onChange={(e) => update(i, { auto_from: e.target.value ? { source_field_id: e.target.value, attribute: f.auto_from?.attribute || "name" } : undefined })}>
                <option value="">auto-fill from… (none)</option>
                {fields.filter((x) => x.id !== f.id).map((x) => <option key={x.id} value={x.id}>{x.label || x.id}</option>)}
              </select>
              {f.auto_from && (
                <input className="input md:col-span-2" placeholder="attribute (e.g. address)" value={f.auto_from.attribute || ""}
                  onChange={(e) => update(i, { auto_from: { ...f.auto_from!, attribute: e.target.value } })} />
              )}
              <select className="input md:col-span-3" value={f.role || ""}
                onChange={(e) => update(i, { role: e.target.value || undefined })}>
                <option value="">role… (none)</option>
                <option value="employee_name">employee_name</option>
                <option value="employee_email">employee_email</option>
                <option value="forward_email_to">forward_email_to</option>
                <option value="grant_full_access_to">grant_full_access_to</option>
              </select>
            </div>

            <button className="btn-ghost text-red-600" onClick={() => setDoc({ ...doc, fields: fields.filter((_, j) => j !== i) })}>
              Remove field
            </button>
          </div>
        ))}
        {fields.length === 0 && <p className="text-sm text-slate-500">No fields defined.</p>}
      </div>
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
