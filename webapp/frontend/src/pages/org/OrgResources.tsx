import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import toast from "react-hot-toast";
import { Plus, Trash2, Pencil, X } from "lucide-react";
import { orgApi } from "@/api";
import { apiError } from "@/api/client";
import { PageHeader, Spinner } from "@/components/ui";
import type { OrgResource, ResourceKind } from "@/types";

const KINDS: { value: ResourceKind; label: string; attrs: { key: string; label: string; placeholder?: string }[] }[] = [
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

export default function OrgResources() {
  const { orgSlug = "" } = useParams();
  const qc = useQueryClient();
  const [activeKind, setActiveKind] = useState<ResourceKind>("property");
  const [editing, setEditing] = useState<Partial<OrgResource> | null>(null);

  const list = useQuery({
    queryKey: ["org.resources", orgSlug],
    queryFn: () => orgApi.listResources(orgSlug, { include_inactive: true }),
  });

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

  if (list.isLoading) return <Spinner />;

  const kindMeta = KINDS.find((k) => k.value === activeKind)!;
  const rows = byKind[activeKind] || [];

  return (
    <>
      <PageHeader
        title="Resources"
        description="Things you can reference in the form: properties, mailboxes, folders, drives. Properties can link to their mailboxes/folders/drives so the form auto-fills."
        actions={
          <button className="btn-primary" onClick={() => setEditing({ kind: activeKind, name: "", attributes: {}, linked_resource_ids: [], is_active: true })}>
            <Plus size={16} /> Add {kindMeta.label.toLowerCase()}
          </button>
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
        <div className="card"><div className="card-body text-sm text-slate-500 italic">No {kindMeta.label.toLowerCase()} entries yet.</div></div>
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
          onClose={() => setEditing(null)}
          onSave={(r) => save.mutate(r)}
          saving={save.isPending}
        />
      )}
    </>
  );
}

function ResourceModal({ resource, all, onClose, onSave, saving }: {
  resource: Partial<OrgResource>;
  all: OrgResource[];
  onClose: () => void;
  onSave: (r: Partial<OrgResource>) => void;
  saving: boolean;
}) {
  const kind = (resource.kind || "property") as ResourceKind;
  const meta = KINDS.find((k) => k.value === kind)!;
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
