import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { orgApi } from "@/api";
import type { Employee, FormField, FormGroup, FormSchemaDoc, OrgResource } from "@/types";

interface Props {
  schema: FormSchemaDoc;
  values: Record<string, any>;
  onChange: (next: Record<string, any>) => void;
  disabled?: boolean;
  /** Org slug enables live resource selectors and employee typeahead. */
  orgSlug?: string;
}

const TERMINATION_ROLES = new Set(["forward_email_to", "grant_full_access_to"]);

export function FormRenderer({ schema, values, onChange, disabled, orgSlug }: Props) {
  const fields: FormField[] = schema.fields || [];

  // Live resource catalog (only if orgSlug provided).
  const resources = useQuery({
    queryKey: ["org.resources.all", orgSlug],
    queryFn: () => orgApi.listResources(orgSlug as string, {}),
    enabled: !!orgSlug,
  });
  const allResources: OrgResource[] = resources.data || [];

  // Derive termination behavior from field roles + their per-field visibility.
  // Any field marked with role forward_email_to or grant_full_access_to whose
  // visibility constraint matches the current request type triggers termination
  // mode (currently-assigned summary). If a field has no visibility constraint
  // and any of those roles, it counts for any selected request type.
  const rt: string | undefined = values.request_type;
  const isFieldVisible = (f: FormField) => {
    const allow = f.visible_when_request_type_in;
    if (allow === undefined) return true;
    return !!rt && allow.includes(rt);
  };
  const isTermination = !!rt && (
    Array.isArray(schema.termination_request_types)
      ? schema.termination_request_types.includes(rt)
      : fields.some((f) => f.role && TERMINATION_ROLES.has(f.role) && isFieldVisible(f))
  );
  // Show employee lookup based on the schema's lookup_request_types list.
  // If the admin has not configured one (legacy schemas), fall back to the
  // request types that have termination-role fields visible. Status
  // filtering is still tightened to active employees for termination-style
  // requests.
  const lookupTypes = schema.lookup_request_types;
  const isLookup = !!rt && (
    Array.isArray(lookupTypes) ? lookupTypes.includes(rt) : isTermination
  );

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

  function setDynamicGroup(groupId: string, next: DynamicGroupValue) {
    const groups = { ...(values._groups || {}) };
    groups[groupId] = next;
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
          {fields.filter(isFieldVisible).map((f) => (
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
        g.dynamic ? (
          <DynamicGroupCard
            key={g.id}
            group={g}
            value={normalizeDynamicGroupValue(values._groups?.[g.id])}
            onChange={(v) => setDynamicGroup(g.id, v)}
            disabled={disabled}
            sourceResource={(() => {
              const sid = g.dynamic.source_field_id;
              const v = values[sid];
              return v ? allResources.find((r) => r.id === Number(v)) : undefined;
            })()}
            sourceFieldLabel={fields.find((x) => x.id === g.dynamic!.source_field_id)?.label || g.dynamic.source_field_id}
            allResources={allResources}
            fallbackKind={fields.find((x) => x.id === g.dynamic!.source_field_id)?.resource_kind}
          />
        ) : (
        <div key={g.id} className="card">
          <div className="card-header"><h3 className="font-medium text-slate-900 dark:text-slate-100">{g.title}</h3></div>
          <div className="card-body grid grid-cols-1 md:grid-cols-2 gap-3">
            {g.items.map((it) => {
              const checked = !!values._groups?.[g.id]?.[it.id];
              return (
                <label key={it.id} className="flex items-start gap-3 rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-700/40">
                  <input type="checkbox" className="mt-1" disabled={disabled} checked={checked}
                    onChange={(e) => setNested(g.id, it.id, e.target.checked)} />
                  <div>
                    <div className="text-sm font-medium text-slate-800 dark:text-slate-100">{it.label}</div>
                    {it.description && <div className="text-xs text-slate-500 dark:text-slate-400">{it.description}</div>}
                  </div>
                </label>
              );
            })}
          </div>
        </div>
        )
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
        // Links are stored on whichever resource the admin edited; check both
        // directions so a Job Title that links to a Department works the same
        // as a Department that lists its Job Titles.
        const parentLinks = new Set(parent.linked_resource_ids || []);
        pool = pool.filter((r) =>
          parentLinks.has(r.id) || (r.linked_resource_ids || []).includes(parent.id)
        );
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

  const helper = isTermination
    ? `${requestType} typically references someone already in your directory. Pick them to prefill what we previously submitted.`
    : `Optional: pick an existing employee to prefill this ${requestType || "request"} from their last submission.`;

  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50/60 dark:border-blue-900 dark:bg-blue-950/30 p-3">
      <div className="text-sm font-semibold text-blue-900 dark:text-blue-200">Look up existing employee</div>
      <div className="text-xs text-blue-800/80 dark:text-blue-300/80 mb-2">
        {helper}
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
      const raw = groups[g.id];
      if (!raw) continue;
      if (g.dynamic) {
        const dv = normalizeDynamicGroupValue(raw);
        const sourceField = schema.fields?.find((x) => x.id === g.dynamic!.source_field_id);
        const sourceResource = sourceField && values[sourceField.id]
          ? resources.find((r) => r.id === Number(values[sourceField.id]))
          : undefined;
        const placeholder = g.dynamic.placeholder || "{Property}";
        const renderTitle = (resName: string | undefined) =>
          substitutePlaceholder(g.title, placeholder, resName);
        const renderItems = (sel: Record<string, boolean>, resName: string | undefined) =>
          g.items
            .filter((it) => sel[it.id])
            .map((it) => substitutePlaceholder(it.label, placeholder, resName));
        const defaultItems = renderItems(dv.default, sourceResource?.name);
        if (defaultItems.length) {
          out.push({ group: renderTitle(sourceResource?.name), items: defaultItems });
        }
        for (const ex of dv.extras) {
          const r = resources.find((x) => x.id === ex.resource_id);
          const items = renderItems(ex.items, r?.name);
          if (items.length) out.push({ group: renderTitle(r?.name), items });
        }
      } else {
        const sel = raw as Record<string, boolean>;
        const picked = g.items.filter((it) => sel[it.id]).map((it) => it.label);
        if (picked.length) out.push({ group: g.title, items: picked });
      }
    }
    return out;
  }, [groups, schema, values, resources]);

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

// ---------------------------------------------------------------------------
// Dynamic per-resource groups
// ---------------------------------------------------------------------------

export interface DynamicGroupExtra {
  resource_id: number;
  items: Record<string, boolean>;
}
export interface DynamicGroupValue {
  default: Record<string, boolean>;
  extras: DynamicGroupExtra[];
}

/**
 * Replace every occurrence of `placeholder` in `text` with `name`. When
 * `name` is falsy the placeholder is left in place so the user can see the
 * pending substitution and the saved request payload still tells reviewers
 * the source field had not been filled in.
 */
export function substitutePlaceholder(text: string, placeholder: string, name?: string): string {
  if (!text) return text;
  if (!name) return text;
  // Case-insensitive replace, escape regex metas in the placeholder.
  const escaped = placeholder.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(new RegExp(escaped, "gi"), name);
}

export function normalizeDynamicGroupValue(raw: any): DynamicGroupValue {
  if (!raw || typeof raw !== "object") return { default: {}, extras: [] };
  // Already in dynamic shape.
  if (Array.isArray(raw.extras) || raw.default) {
    return {
      default: (raw.default && typeof raw.default === "object") ? raw.default : {},
      extras: Array.isArray(raw.extras)
        ? raw.extras.map((e: any) => ({
            resource_id: Number(e?.resource_id),
            items: (e?.items && typeof e.items === "object") ? e.items : {},
          })).filter((e: DynamicGroupExtra) => Number.isFinite(e.resource_id))
        : [],
    };
  }
  // Legacy flat shape from non-dynamic group converted to dynamic later: keep
  // those as the default context.
  return { default: raw as Record<string, boolean>, extras: [] };
}

function DynamicGroupCard({ group, value, onChange, disabled, sourceResource, sourceFieldLabel, allResources, fallbackKind }: {
  group: FormGroup;
  value: DynamicGroupValue;
  onChange: (v: DynamicGroupValue) => void;
  disabled?: boolean;
  sourceResource?: OrgResource;
  sourceFieldLabel: string;
  allResources: OrgResource[];
  fallbackKind?: string;
}) {
  const dyn = group.dynamic!;
  const placeholder = dyn.placeholder || "{Property}";
  const kind = dyn.resource_kind || fallbackKind;
  const kindLabel = kind ? kind.replace(/_/g, " ") : "resource";
  const buttonLabel = dyn.additional_button_label || `+ Add another ${kindLabel}`;

  const usedIds = new Set<number>([
    ...(sourceResource ? [sourceResource.id] : []),
    ...value.extras.map((e) => e.resource_id),
  ]);
  const pickerOptions = allResources
    .filter((r) => r.is_active && (!kind || r.kind === kind) && !usedIds.has(r.id));

  const setDefault = (itemId: string, checked: boolean) => {
    onChange({ ...value, default: { ...value.default, [itemId]: checked } });
  };
  const setExtra = (idx: number, itemId: string, checked: boolean) => {
    const extras = value.extras.slice();
    extras[idx] = { ...extras[idx], items: { ...extras[idx].items, [itemId]: checked } };
    onChange({ ...value, extras });
  };
  const removeExtra = (idx: number) => {
    onChange({ ...value, extras: value.extras.filter((_, j) => j !== idx) });
  };
  const addExtra = (rid: number) => {
    if (!Number.isFinite(rid)) return;
    onChange({ ...value, extras: [...value.extras, { resource_id: rid, items: {} }] });
  };

  const renderContext = (
    contextKey: string,
    contextName: string | undefined,
    selections: Record<string, boolean>,
    onToggle: (itemId: string, checked: boolean) => void,
    onRemove?: () => void,
    badge?: string,
  ) => {
    const titleText = substitutePlaceholder(group.title, placeholder, contextName);
    return (
      <div key={contextKey} className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/40 dark:bg-slate-900/40 p-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-baseline gap-2 min-w-0">
            <h4 className="font-medium text-slate-800 dark:text-slate-100 truncate">{titleText}</h4>
            {badge && <span className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">{badge}</span>}
          </div>
          {onRemove && (
            <button type="button" className="text-xs text-red-600 hover:text-red-700" disabled={disabled} onClick={onRemove}>
              Remove
            </button>
          )}
        </div>
        {!contextName && contextKey === "default" && (
          <p className="text-xs text-amber-700 dark:text-amber-300">
            Pick a {sourceFieldLabel.toLowerCase()} above to fill in {placeholder}.
          </p>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {group.items.map((it) => {
            const itemLabel = substitutePlaceholder(it.label, placeholder, contextName);
            const itemDesc = it.description ? substitutePlaceholder(it.description, placeholder, contextName) : "";
            const checked = !!selections[it.id];
            return (
              <label key={it.id} className="flex items-start gap-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-700/40">
                <input type="checkbox" className="mt-1" disabled={disabled} checked={checked}
                  onChange={(e) => onToggle(it.id, e.target.checked)} />
                <div>
                  <div className="text-sm font-medium text-slate-800 dark:text-slate-100">{itemLabel}</div>
                  {itemDesc && <div className="text-xs text-slate-500 dark:text-slate-400">{itemDesc}</div>}
                </div>
              </label>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="card">
      <div className="card-body space-y-3">
        {renderContext(
          "default",
          sourceResource?.name,
          value.default,
          setDefault,
          undefined,
          sourceFieldLabel ? `from "${sourceFieldLabel}"` : undefined,
        )}

        {value.extras.map((ex, idx) => {
          const r = allResources.find((x) => x.id === ex.resource_id);
          return renderContext(
            `extra-${idx}-${ex.resource_id}`,
            r?.name || `#${ex.resource_id}`,
            ex.items,
            (itemId, checked) => setExtra(idx, itemId, checked),
            () => removeExtra(idx),
            "added",
          );
        })}

        {dyn.allow_additional && !disabled && (
          <DynamicGroupAddPicker
            buttonLabel={buttonLabel}
            options={pickerOptions}
            kindLabel={kindLabel}
            onPick={addExtra}
          />
        )}
      </div>
    </div>
  );
}

function DynamicGroupAddPicker({ buttonLabel, options, kindLabel, onPick }: {
  buttonLabel: string;
  options: OrgResource[];
  kindLabel: string;
  onPick: (id: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState("");
  if (!open) {
    return (
      <button type="button" className="btn-secondary text-sm" onClick={() => setOpen(true)} disabled={options.length === 0}>
        {options.length === 0 ? `No more ${kindLabel}s available` : buttonLabel}
      </button>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <select className="input flex-1" value={val} onChange={(e) => setVal(e.target.value)} autoFocus>
        <option value="">— pick a {kindLabel} —</option>
        {options.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
      </select>
      <button type="button" className="btn-primary text-sm" disabled={!val}
        onClick={() => { onPick(Number(val)); setVal(""); setOpen(false); }}>
        Add
      </button>
      <button type="button" className="btn-ghost text-sm" onClick={() => { setVal(""); setOpen(false); }}>
        Cancel
      </button>
    </div>
  );
}
