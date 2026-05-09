import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { orgApi } from "@/api";
import type { Employee, FormField, FormSchemaDoc, OrgResource } from "@/types";

interface Props {
  schema: FormSchemaDoc;
  values: Record<string, any>;
  onChange: (next: Record<string, any>) => void;
  disabled?: boolean;
  /** Org slug enables live resource selectors and employee typeahead. */
  orgSlug?: string;
}

const DEFAULT_LOOKUP = ["Promotion", "Termination", "Rehire"];
const DEFAULT_TERMINATION = ["Termination"];

export function FormRenderer({ schema, values, onChange, disabled, orgSlug }: Props) {
  const fields: FormField[] = schema.fields || [];

  // Live resource catalog (only if orgSlug provided).
  const resources = useQuery({
    queryKey: ["org.resources.all", orgSlug],
    queryFn: () => orgApi.listResources(orgSlug as string, {}),
    enabled: !!orgSlug,
  });
  const allResources: OrgResource[] = resources.data || [];

  const lookupTypes = schema.lookup_request_types ?? DEFAULT_LOOKUP;
  const terminationTypes = schema.termination_request_types ?? DEFAULT_TERMINATION;
  const isLookup = !!values.request_type && lookupTypes.includes(values.request_type);
  const isTermination = !!values.request_type && terminationTypes.includes(values.request_type);

  // Apply auto_from chain when a source field changes.
  function setWithAutoFill(key: string, v: any) {
    const next: Record<string, any> = { ...values, [key]: v };
    for (const target of fields) {
      const af = target.auto_from;
      if (!af || af.source_field_id !== key) continue;
      const sourceField = fields.find((x) => x.id === key);
      const attribute = af.attribute || "name";
      let derived: any = "";
      if (sourceField?.type === "resource") {
        const r = allResources.find((x) => x.id === Number(v));
        if (r) derived = attribute === "name" ? r.name : (r.attributes?.[attribute] ?? "");
      } else {
        derived = typeof v === "object" && v ? (v[attribute] ?? "") : v;
      }
      next[target.id] = derived;
    }
    onChange(next);
  }

  function set(key: string, v: any) { setWithAutoFill(key, v); }

  function setNested(group: string, item: string, v: any) {
    const groups = { ...(values._groups || {}) };
    groups[group] = { ...(groups[group] || {}), [item]: v };
    onChange({ ...values, _groups: groups });
  }

  function applyEmployee(emp: Employee) {
    const payload = { ...(emp.last_payload || {}) };
    payload.request_type = values.request_type;
    payload._employee_id = emp.id;
    onChange(payload);
  }

  return (
    <div className="space-y-6">
      {schema.request_types && schema.request_types.length > 0 && (
        <div>
          <label className="label">Request Type</label>
          <select
            className="input"
            disabled={disabled}
            value={values.request_type || ""}
            onChange={(e) => set("request_type", e.target.value)}
          >
            <option value="" disabled>Select…</option>
            {schema.request_types.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
      )}

      {orgSlug && isLookup && !disabled && (
        <EmployeeLookup orgSlug={orgSlug} onPick={applyEmployee} requestType={values.request_type} />
      )}

      {orgSlug && isTermination && (
        <TerminationSummary values={values} schema={schema} resources={allResources} />
      )}

      {fields.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {fields.map((f) => (
            <FieldRow
              key={f.id}
              field={f}
              values={values}
              disabled={disabled}
              orgSlug={orgSlug}
              allResources={allResources}
              set={set}
            />
          ))}
        </div>
      )}

      {schema.groups?.filter((g) => g.enabled).map((g) => (
        <div key={g.id} className="card">
          <div className="card-header"><h3 className="font-medium text-slate-900">{g.title}</h3></div>
          <div className="card-body grid grid-cols-1 md:grid-cols-2 gap-3">
            {g.items.map((it) => {
              const checked = !!values._groups?.[g.id]?.[it.id];
              return (
                <label key={it.id} className="flex items-start gap-3 rounded-lg border border-slate-200 px-3 py-2 hover:bg-slate-50">
                  <input type="checkbox" className="mt-1" disabled={disabled} checked={checked}
                    onChange={(e) => setNested(g.id, it.id, e.target.checked)} />
                  <div>
                    <div className="text-sm font-medium text-slate-800">{it.label}</div>
                    {it.description && <div className="text-xs text-slate-500">{it.description}</div>}
                  </div>
                </label>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function FieldRow({ field, values, disabled, orgSlug, allResources, set }: {
  field: FormField;
  values: Record<string, any>;
  disabled?: boolean;
  orgSlug?: string;
  allResources: OrgResource[];
  set: (k: string, v: any) => void;
}) {
  const f = field;
  const isAutoFilled = !!f.auto_from;

  if (f.type === "resource" && f.resource_kind) {
    let pool = allResources.filter((r) => r.kind === f.resource_kind && r.is_active);
    if (f.filter_by?.source_field_id) {
      const parentId = Number(values[f.filter_by.source_field_id]);
      const parent = allResources.find((r) => r.id === parentId);
      if (parent) {
        const allowed = new Set(parent.linked_resource_ids || []);
        pool = pool.filter((r) => allowed.has(r.id));
      } else {
        pool = [];
      }
    }
    return (
      <div>
        <label className="label">
          {f.label}{f.required && <span className="text-red-500 ml-0.5">*</span>}
        </label>
        {orgSlug ? (
          <select className="input" disabled={disabled} value={values[f.id] ?? ""} onChange={(e) => set(f.id, e.target.value ? Number(e.target.value) : "")}>
            <option value="">—</option>
            {pool.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        ) : (
          <input className="input" disabled value={values[f.id] ?? ""} placeholder="(resource selector — preview only)" />
        )}
        {f.description && <p className="help">{f.description}</p>}
      </div>
    );
  }

  return (
    <div className={f.type === "textarea" ? "md:col-span-2" : ""}>
      <label className="label">
        {f.label}{f.required && <span className="text-red-500 ml-0.5">*</span>}
        {isAutoFilled && <span className="ml-2 text-xs text-slate-400 font-normal">auto-filled</span>}
      </label>
      {f.type === "textarea" ? (
        <textarea className="input min-h-[80px]" disabled={disabled} value={values[f.id] || ""} onChange={(e) => set(f.id, e.target.value)} />
      ) : f.type === "select" ? (
        <select className="input" disabled={disabled} value={values[f.id] || ""} onChange={(e) => set(f.id, e.target.value)}>
          <option value="">—</option>
          {(f.options || []).map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : (
        <input className="input" type={f.type as any} disabled={disabled} value={values[f.id] || ""} onChange={(e) => set(f.id, e.target.value)} />
      )}
      {f.description && <p className="help">{f.description}</p>}
    </div>
  );
}

function EmployeeLookup({ orgSlug, onPick, requestType }: { orgSlug: string; onPick: (e: Employee) => void; requestType: string }) {
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [open, setOpen] = useState(false);
  const tRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (tRef.current) window.clearTimeout(tRef.current);
    tRef.current = window.setTimeout(() => setDebounced(q), 200);
    return () => { if (tRef.current) window.clearTimeout(tRef.current); };
  }, [q]);

  const isTermination = /termin|offboard|departure/i.test(requestType || "");
  const search = useQuery({
    queryKey: ["org.employees.search", orgSlug, debounced, isTermination],
    queryFn: () => orgApi.searchEmployees(orgSlug, { q: debounced || undefined, status: isTermination ? "active" : undefined, limit: 10 }),
    enabled: open,
  });

  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50/60 dark:border-blue-900 dark:bg-blue-950/30 p-3">
      <div className="text-sm font-semibold text-blue-900 dark:text-blue-200">Look up existing employee</div>
      <div className="text-xs text-blue-800/80 dark:text-blue-300/80 mb-2">
        {requestType} typically references someone already in your directory. Pick them to prefill what we previously submitted.
      </div>
      <div className="relative">
        <input
          className="input"
          placeholder="Search by name or email…"
          value={q}
          onFocus={() => setOpen(true)}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
        />
        {open && (search.data || []).length > 0 && (
          <div className="absolute z-10 mt-1 w-full max-h-64 overflow-y-auto rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-lg">
            {(search.data || []).map((emp) => (
              <button key={emp.id} type="button" className="w-full text-left px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-700"
                onMouseDown={(e) => { e.preventDefault(); onPick(emp); setOpen(false); setQ(emp.full_name); }}>
                <div className="text-sm font-medium">{emp.full_name}</div>
                <div className="text-xs text-slate-500">
                  {emp.email || "—"} · {emp.status}
                  {emp.last_request_type ? ` · last: ${emp.last_request_type}` : ""}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TerminationSummary({ values, schema, resources }: { values: Record<string, any>; schema: FormSchemaDoc; resources: OrgResource[] }) {
  const groups = values._groups || {};
  const checkedSummary = useMemo(() => {
    const out: { group: string; items: string[] }[] = [];
    for (const g of schema.groups || []) {
      const sel = groups[g.id] || {};
      const picked = g.items.filter((it) => sel[it.id]).map((it) => it.label);
      if (picked.length) out.push({ group: g.title, items: picked });
    }
    return out;
  }, [groups, schema]);

  const resourceSummary = useMemo(() => {
    const out: string[] = [];
    for (const f of schema.fields || []) {
      if (f.type === "resource" && values[f.id]) {
        const r = resources.find((x) => x.id === Number(values[f.id]));
        if (r) out.push(`${f.label}: ${r.name}`);
      }
    }
    return out;
  }, [schema, values, resources]);

  if (!checkedSummary.length && !resourceSummary.length) return null;

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/60 dark:border-amber-900 dark:bg-amber-950/30 p-3">
      <div className="text-sm font-semibold text-amber-900 dark:text-amber-200">Currently assigned (from last submission)</div>
      <div className="text-xs text-amber-800/80 dark:text-amber-300/80 mb-2">
        These are the access items previously requested for this employee. Confirm what should be removed/transferred.
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
        {resourceSummary.length > 0 && (
          <ul className="list-disc list-inside text-slate-700 dark:text-slate-200">
            {resourceSummary.map((s, i) => <li key={i}>{s}</li>)}
          </ul>
        )}
        {checkedSummary.map((g) => (
          <div key={g.group}>
            <div className="text-xs uppercase tracking-wide text-slate-500">{g.group}</div>
            <ul className="list-disc list-inside text-slate-700 dark:text-slate-200">
              {g.items.map((it) => <li key={it}>{it}</li>)}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
