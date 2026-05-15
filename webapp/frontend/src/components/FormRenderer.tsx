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

  // ----- Auto-check group items from a resource attribute --------------------
  // When a group item declares `auto_check_from: { source_field_id, attribute }`,
  // reset the checkbox to the resource's attribute value whenever the source
  // field's value changes. We seed `lastSourceRef` on mount so existing draft
  // selections aren't overwritten on first render.
  const lastSourceRef = useRef<Record<string, any> | null>(null);
  const isTruthyAttr = (v: any): boolean => {
    if (v === true) return true;
    if (v === false || v === null || v === undefined) return false;
    const s = String(v).trim().toLowerCase();
    if (!s) return false;
    if (["no", "false", "0", "n", "off", "-"].includes(s)) return false;
    return true; // "yes", "true", "1", "x", or any other non-empty value
  };

  // Evaluate a group's `visible_when` rule against a resource. Returns true
  // when the group/instance should render. A null/undefined resource fails
  // any rule that requires one (the group is hidden).
  const evalGroupVisible = (g: FormGroup, resource?: OrgResource): boolean => {
    const cond = g.visible_when;
    if (!cond) return true;
    if (!resource) {
      // No resource selected yet: hide rather than flash content in/out.
      return !!cond.negate;
    }
    const raw = resource.attributes?.[cond.attribute];
    let pass = true;
    if (cond.truthy === true) {
      pass = pass && isTruthyAttr(raw);
    }
    if (cond.equals !== undefined) {
      const norm = (v: any) => String(v ?? "").trim().toLowerCase();
      const want = Array.isArray(cond.equals) ? cond.equals.map(norm) : [norm(cond.equals)];
      pass = pass && want.includes(norm(raw));
    }
    // If neither truthy nor equals was set, presence/non-empty is the test.
    if (cond.truthy === undefined && cond.equals === undefined) {
      pass = isTruthyAttr(raw);
    }
    return cond.negate ? !pass : pass;
  };
  useEffect(() => {
    if (!schema.groups || schema.groups.length === 0) return;
    // First pass: seed last-seen source values so we don't overwrite the
    // checkbox selections an admin already saved on this request.
    if (lastSourceRef.current === null) {
      const seed: Record<string, any> = {};
      for (const g of schema.groups) {
        if (!g.enabled || g.dynamic) continue;
        for (const it of g.items || []) {
          const acf = it.auto_check_from;
          if (!acf?.source_field_id) continue;
          seed[`${g.id}|${it.id}|${acf.source_field_id}`] = values[acf.source_field_id];
        }
      }
      lastSourceRef.current = seed;
      return;
    }
    // Subsequent passes: detect any source-field changes and reapply defaults.
    let nextGroups: Record<string, any> | null = null;
    const ref = lastSourceRef.current;
    for (const g of schema.groups) {
      if (!g.enabled || g.dynamic) continue;
      for (const it of g.items || []) {
        const acf = it.auto_check_from;
        if (!acf?.source_field_id || !acf?.attribute) continue;
        const sid = acf.source_field_id;
        const cur = values[sid];
        const key = `${g.id}|${it.id}|${sid}`;
        if (ref[key] === cur) continue;
        ref[key] = cur;
        const sourceField = fields.find((x) => x.id === sid);
        let defaultChecked = false;
        if (sourceField?.type === "resource") {
          const r = allResources.find((x) => x.id === Number(cur));
          if (r) defaultChecked = isTruthyAttr(r.attributes?.[acf.attribute]);
        } else if (cur !== undefined && cur !== null && cur !== "") {
          defaultChecked = isTruthyAttr(cur);
        }
        const ng: Record<string, any> = nextGroups ?? { ...(values._groups || {}) };
        ng[g.id] = { ...(ng[g.id] || {}), [it.id]: defaultChecked };
        nextGroups = ng;
      }
    }
    if (nextGroups) {
      onChange({ ...values, _groups: nextGroups });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values, allResources, schema.groups]);

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

  // ----- Prior-access review --------------------------------------------------
  // When the current request type is in `schema.prior_access_request_types`,
  // capture a snapshot of the prior submission's tracked fields/group items
  // on employee lookup. The renderer then surfaces Keep / Remove pills next
  // to each tracked value so reviewers see exactly which previously-granted
  // access to revoke vs retain.
  const isPriorAccessMode = !!rt && Array.isArray(schema.prior_access_request_types)
    && schema.prior_access_request_types.includes(rt);

  function buildPriorSnapshot(payload: Record<string, any>): PriorSnapshot {
    const snap: PriorSnapshot = { fields: {}, groups: {} };
    for (const f of fields) {
      if (!f.prior_access_tracked) continue;
      const v = payload[f.id];
      if (v === undefined || v === null || v === "") continue;
      snap.fields[f.id] = v;
    }
    const gpayload = payload._groups || {};
    for (const g of schema.groups || []) {
      if (!g.prior_access_tracked || !g.enabled) continue;
      const raw = gpayload[g.id];
      if (!raw) continue;
      const ctxs: Record<string, Record<string, true>> = {};
      if (g.dynamic) {
        const dv = normalizeDynamicGroupValue(raw);
        const def: Record<string, true> = {};
        for (const it of g.items) {
          if (dv.default[it.id]) def[it.id] = true;
        }
        if (Object.keys(def).length) ctxs["default"] = def;
        for (const ex of dv.extras) {
          const items: Record<string, true> = {};
          for (const it of g.items) {
            if (ex.items[it.id]) items[it.id] = true;
          }
          if (Object.keys(items).length) ctxs[`extra:${ex.resource_id}`] = items;
        }
      } else {
        const sel = raw as Record<string, boolean>;
        const def: Record<string, true> = {};
        for (const it of g.items) {
          if (sel[it.id]) def[it.id] = true;
        }
        if (Object.keys(def).length) ctxs["default"] = def;
      }
      if (Object.keys(ctxs).length) snap.groups[g.id] = ctxs;
    }
    return snap;
  }

  function applyEmployee(emp: Employee) {
    const payload = { ...(emp.last_payload || {}) };
    payload.request_type = values.request_type;
    payload._employee_id = emp.id;
    if (isPriorAccessMode) {
      const snap = buildPriorSnapshot(payload);
      const hasAny = Object.keys(snap.fields).length > 0 || Object.keys(snap.groups).length > 0;
      if (hasAny) {
        payload._prior_snapshot = snap;
        // Default every tracked item to "keep". The user can flip per-item
        // or use the banner buttons to bulk-set.
        payload._prior_actions = defaultActionsFromSnapshot(snap, "keep");
      } else {
        delete payload._prior_snapshot;
        delete payload._prior_actions;
      }
    } else {
      delete payload._prior_snapshot;
      delete payload._prior_actions;
    }
    onChange(payload);
  }

  // Helpers for reading / mutating _prior_actions.
  const priorSnap: PriorSnapshot | undefined = values._prior_snapshot;
  const priorActions: PriorActions = values._prior_actions || { fields: {}, groups: {} };
  const fieldHadPrior = (fid: string) =>
    !!priorSnap && Object.prototype.hasOwnProperty.call(priorSnap.fields, fid);
  const groupItemHadPrior = (gid: string, ctxKey: string, itemId: string) =>
    !!priorSnap?.groups?.[gid]?.[ctxKey]?.[itemId];
  const fieldAction = (fid: string): PriorAction =>
    (priorActions.fields?.[fid] as PriorAction) || "keep";
  const groupItemAction = (gid: string, ctxKey: string, itemId: string): PriorAction =>
    (priorActions.groups?.[gid]?.[ctxKey]?.[itemId] as PriorAction) || "keep";
  const setFieldAction = (fid: string, action: PriorAction) => {
    const next: PriorActions = {
      fields: { ...(priorActions.fields || {}), [fid]: action },
      groups: priorActions.groups || {},
    };
    onChange({ ...values, _prior_actions: next });
  };
  const setGroupItemAction = (gid: string, ctxKey: string, itemId: string, action: PriorAction) => {
    const groupsA = { ...(priorActions.groups || {}) };
    const gMap = { ...(groupsA[gid] || {}) };
    const ctxMap = { ...(gMap[ctxKey] || {}), [itemId]: action };
    gMap[ctxKey] = ctxMap;
    groupsA[gid] = gMap;
    onChange({ ...values, _prior_actions: { fields: priorActions.fields || {}, groups: groupsA } });
  };
  const setAllPriorActions = (action: PriorAction) => {
    if (!priorSnap) return;
    onChange({ ...values, _prior_actions: defaultActionsFromSnapshot(priorSnap, action) });
  };

  const priorCtx: PriorContext = {
    active: isPriorAccessMode && !!priorSnap,
    fieldHadPrior,
    groupItemHadPrior,
    fieldAction,
    groupItemAction,
    setFieldAction,
    setGroupItemAction,
  };

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

      {priorCtx.active && (
        <PriorAccessBanner
          disabled={disabled}
          onRemoveAll={() => setAllPriorActions("remove")}
          onKeepAll={() => setAllPriorActions("keep")}
        />
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
              priorCtx={priorCtx}
            />
          ))}
        </div>
      )}

      {schema.groups?.filter((g) => {
        if (!g.enabled) return false;
        if (!g.visible_when) return true;
        // Dynamic groups defer the check to per-instance rendering inside
        // DynamicGroupCard so we still render the card (which may show only
        // matching instances). For static groups we need a concrete resource
        // resolved from the named source field.
        if (g.dynamic) return true;
        const sid = g.visible_when.source_field_id;
        const resource = sid ? allResources.find((r) => r.id === Number(values[sid])) : undefined;
        return evalGroupVisible(g, resource);
      }).map((g) => (
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
            instanceVisible={(r) => evalGroupVisible(g, r)}
            priorCtx={priorCtx}
          />
        ) : (
        <div key={g.id} className="card">
          <div className="card-header"><h3 className="font-medium text-slate-900 dark:text-slate-100">{g.title}</h3></div>
          <div className="card-body grid grid-cols-1 md:grid-cols-2 gap-3">
            {g.items.map((it) => {
              const checked = !!values._groups?.[g.id]?.[it.id];
              const hadPrior = !!g.prior_access_tracked && priorCtx.active
                && priorCtx.groupItemHadPrior(g.id, "default", it.id);
              const action = hadPrior ? priorCtx.groupItemAction(g.id, "default", it.id) : undefined;
              return (
                <label key={it.id} className="flex items-start gap-3 rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-700/40">
                  <input type="checkbox" className="mt-1" disabled={disabled} checked={checked}
                    onChange={(e) => setNested(g.id, it.id, e.target.checked)} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <div className="text-sm font-medium text-slate-800 dark:text-slate-100">{it.label}</div>
                      {hadPrior && (
                        <PriorActionPill
                          action={action!}
                          disabled={disabled}
                          onChange={(a) => priorCtx.setGroupItemAction(g.id, "default", it.id, a)}
                        />
                      )}
                    </div>
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

function FieldRow({ field, values, disabled, orgSlug, allResources, set, priorCtx }: {
  field: FormField;
  values: Record<string, any>;
  disabled?: boolean;
  orgSlug?: string;
  allResources: OrgResource[];
  set: (k: string, v: any) => void;
  priorCtx: PriorContext;
}) {
  const f = field;
  const isAutoFilled = !!f.auto_from;
  const showPrior = !!f.prior_access_tracked && priorCtx.active && priorCtx.fieldHadPrior(f.id);
  const priorPill = showPrior ? (
    <PriorActionPill
      action={priorCtx.fieldAction(f.id)}
      disabled={disabled}
      onChange={(a) => priorCtx.setFieldAction(f.id, a)}
    />
  ) : null;

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
        <label className="label flex items-center gap-2">
          <span>{f.label}{f.required && <span className="text-red-500 ml-0.5">*</span>}</span>
          {priorPill}
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
      <label className="label flex items-center gap-2">
        <span>{f.label}{f.required && <span className="text-red-500 ml-0.5">*</span>}</span>
        {isAutoFilled && <span className="text-xs text-slate-400 font-normal">auto-filled</span>}
        {priorPill}
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

function DynamicGroupCard({ group, value, onChange, disabled, sourceResource, sourceFieldLabel, allResources, fallbackKind, instanceVisible, priorCtx }: {
  group: FormGroup;
  value: DynamicGroupValue;
  onChange: (v: DynamicGroupValue) => void;
  disabled?: boolean;
  sourceResource?: OrgResource;
  sourceFieldLabel: string;
  allResources: OrgResource[];
  fallbackKind?: string;
  instanceVisible?: (resource?: OrgResource) => boolean;
  priorCtx: PriorContext;
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
    const placeholderInTitle = group.title
      ? group.title.toLowerCase().includes(placeholder.toLowerCase())
      : false;
    // When the admin didn't bake the placeholder into the title, the outer
    // group header already shows the group title — repeating it on every
    // per-resource card just clutters the UI. Use the resource name as the
    // card heading instead so each card is identified by its resource.
    const titleText = placeholderInTitle
      ? substitutePlaceholder(group.title, placeholder, contextName)
      : (contextName || group.title);
    const priorTracked = !!group.prior_access_tracked && priorCtx.active;
    return (
      <div key={contextKey} className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/40 dark:bg-slate-900/40 p-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-baseline gap-2 min-w-0 flex-wrap">
            <h4 className="font-medium text-slate-800 dark:text-slate-100 truncate">{titleText}</h4>
            {badge && <span className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">{badge}</span>}
          </div>
          {onRemove && (
            <button type="button" className="text-xs text-red-600 hover:text-red-700" disabled={disabled} onClick={onRemove}>
              Remove
            </button>
          )}
        </div>
        {!contextName && contextKey === "default" && sourceFieldLabel && (
          <p className="text-xs text-amber-700 dark:text-amber-300">
            Pick a {sourceFieldLabel.toLowerCase()} above to fill in {placeholder}.
          </p>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {group.items.map((it) => {
            const itemLabel = substitutePlaceholder(it.label, placeholder, contextName);
            const itemDesc = it.description ? substitutePlaceholder(it.description, placeholder, contextName) : "";
            const checked = !!selections[it.id];
            const hadPrior = priorTracked && priorCtx.groupItemHadPrior(group.id, contextKey, it.id);
            const action = hadPrior ? priorCtx.groupItemAction(group.id, contextKey, it.id) : undefined;
            return (
              <label key={it.id} className="flex items-start gap-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-700/40">
                <input type="checkbox" className="mt-1" disabled={disabled} checked={checked}
                  onChange={(e) => onToggle(it.id, e.target.checked)} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="text-sm font-medium text-slate-800 dark:text-slate-100">{itemLabel}</div>
                    {hadPrior && (
                      <PriorActionPill
                        action={action!}
                        disabled={disabled}
                        onChange={(a) => priorCtx.setGroupItemAction(group.id, contextKey, it.id, a)}
                      />
                    )}
                  </div>
                  {itemDesc && <div className="text-xs text-slate-500 dark:text-slate-400">{itemDesc}</div>}
                </div>
              </label>
            );
          })}
        </div>
      </div>
    );
  };

  // Per-instance visibility (e.g. skip Corporate Office in a per-property
  // network-access group). The instance is hidden but its stored selections
  // are kept on the request so the user can recover by clearing the
  // visibility condition or selecting a different property.
  const passes = (r?: OrgResource) => (instanceVisible ? instanceVisible(r) : true);

  // Also exclude resources that would be hidden from the "add another" picker
  // so the user doesn't add an instance that would immediately disappear.
  const visiblePickerOptions = instanceVisible
    ? pickerOptions.filter((r) => passes(r))
    : pickerOptions;

  const defaultVisible = passes(sourceResource);
  const visibleExtras = value.extras.map((ex, idx) => ({ ex, idx, r: allResources.find((x) => x.id === ex.resource_id) }))
    .filter(({ r }) => passes(r));

  // `keep_picker` turns this group into a "picker-only" group used to
  // cover resources that the primary visibility rule excludes. It only
  // appears when the primary source resource FAILS the rule — otherwise
  // the regular (non-picker-only) sibling group already covers them and
  // showing this picker too would be a duplicate.
  const keepPicker = !!group.visible_when?.keep_picker;
  // Kind-only dynamic groups (no source_field_id) have no "default" context
  // — the user just picks resources via the picker.
  const hasSourceField = !!dyn.source_field_id;
  const showDefault = hasSourceField && defaultVisible && !keepPicker;
  const pickerActive = keepPicker ? !defaultVisible : (showDefault || visibleExtras.length > 0 || !hasSourceField);
  const showPicker = !!dyn.allow_additional && !disabled
    && pickerActive
    && visiblePickerOptions.length > 0;

  if (!showDefault && visibleExtras.length === 0 && !showPicker) {
    return null;
  }

  return (
    <div className="card">
      <div className="card-body space-y-3">
        {showDefault && renderContext(
          "default",
          sourceResource?.name,
          value.default,
          setDefault,
          undefined,
          sourceFieldLabel ? `from "${sourceFieldLabel}"` : undefined,
        )}

        {/* When the default block is hidden but the picker stays visible
            (keep_picker), surface a heading so users understand what the
            "+ Add another …" button below is for. */}
        {!showDefault && (
          <div className="flex items-baseline gap-2 min-w-0">
            <h4 className="font-medium text-slate-800 dark:text-slate-100 truncate">
              {substitutePlaceholder(group.title, dyn.placeholder || "{Property}", undefined)}
            </h4>
            <span className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
              {sourceFieldLabel ? `from "${sourceFieldLabel}"` : ""}
            </span>
          </div>
        )}

        {visibleExtras.map(({ ex, idx, r }) => renderContext(
          `extra:${ex.resource_id}`,
          r?.name || `#${ex.resource_id}`,
          ex.items,
          (itemId, checked) => setExtra(idx, itemId, checked),
          () => removeExtra(idx),
          "added",
        ))}

        {showPicker && (
          <DynamicGroupAddPicker
            buttonLabel={buttonLabel}
            options={visiblePickerOptions}
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

// ---------------------------------------------------------------------------
// Prior-access review
// ---------------------------------------------------------------------------

export type PriorAction = "keep" | "remove";

export interface PriorSnapshot {
  /** Map of fieldId -> prior value (whatever the field stored: resource id,
   *  string, etc). Only fields flagged `prior_access_tracked` are captured. */
  fields: Record<string, any>;
  /** Map of groupId -> contextKey -> itemId -> true. contextKey is "default"
   *  for static groups and the dynamic-default block, or "extra:<resource_id>"
   *  for dynamic extras. */
  groups: Record<string, Record<string, Record<string, true>>>;
}

export interface PriorActions {
  fields: Record<string, PriorAction>;
  groups: Record<string, Record<string, Record<string, PriorAction>>>;
}

export interface PriorContext {
  active: boolean;
  fieldHadPrior: (fieldId: string) => boolean;
  groupItemHadPrior: (groupId: string, contextKey: string, itemId: string) => boolean;
  fieldAction: (fieldId: string) => PriorAction;
  groupItemAction: (groupId: string, contextKey: string, itemId: string) => PriorAction;
  setFieldAction: (fieldId: string, action: PriorAction) => void;
  setGroupItemAction: (groupId: string, contextKey: string, itemId: string, action: PriorAction) => void;
}

export function defaultActionsFromSnapshot(snap: PriorSnapshot, action: PriorAction): PriorActions {
  const out: PriorActions = { fields: {}, groups: {} };
  for (const fid of Object.keys(snap.fields || {})) {
    out.fields[fid] = action;
  }
  for (const [gid, ctxs] of Object.entries(snap.groups || {})) {
    out.groups[gid] = {};
    for (const [ctxKey, items] of Object.entries(ctxs)) {
      out.groups[gid][ctxKey] = {};
      for (const itemId of Object.keys(items)) {
        out.groups[gid][ctxKey][itemId] = action;
      }
    }
  }
  return out;
}

function PriorAccessBanner({ disabled, onRemoveAll, onKeepAll }: {
  disabled?: boolean;
  onRemoveAll: () => void;
  onKeepAll: () => void;
}) {
  return (
    <div className="rounded-lg border border-indigo-200 bg-indigo-50/60 dark:border-indigo-900 dark:bg-indigo-950/30 p-3">
      <div className="text-sm font-semibold text-indigo-900 dark:text-indigo-200">
        Previous access on record
      </div>
      <div className="text-xs text-indigo-800/80 dark:text-indigo-300/80 mb-2">
        This employee's prior submission has been loaded. Tag each previously-configured
        item below as <strong>Keep</strong> (carry forward) or <strong>Remove</strong>
        (revoke). Use the buttons below to set a default and then fine-tune per item.
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-secondary text-xs"
          disabled={disabled}
          onClick={onKeepAll}
        >
          Keep all previous access
        </button>
        <button
          type="button"
          className="btn-secondary text-xs"
          disabled={disabled}
          onClick={onRemoveAll}
        >
          Remove all previous access
        </button>
      </div>
    </div>
  );
}

function PriorActionPill({ action, disabled, onChange }: {
  action: PriorAction;
  disabled?: boolean;
  onChange: (a: PriorAction) => void;
}) {
  const isRemove = action === "remove";
  const label = isRemove ? "REMOVE ACCESS" : "KEEP (PREVIOUS)";
  const cls = isRemove
    ? "bg-red-100 text-red-800 border-red-200 hover:bg-red-200 dark:bg-red-950/60 dark:text-red-200 dark:border-red-900"
    : "bg-emerald-100 text-emerald-800 border-emerald-200 hover:bg-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-200 dark:border-emerald-900";
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(isRemove ? "keep" : "remove")}
      title={isRemove
        ? "Previously granted — currently tagged for removal. Click to keep instead."
        : "Previously granted — currently tagged to keep. Click to mark for removal."}
      className={`text-[10px] font-semibold tracking-wide uppercase px-2 py-0.5 rounded-full border ${cls} ${disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}`}
    >
      {label}
    </button>
  );
}
