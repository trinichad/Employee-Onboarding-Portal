import type { FormSchemaDoc } from "@/types";

interface Props {
  schema: FormSchemaDoc;
  values: Record<string, any>;
  onChange: (next: Record<string, any>) => void;
  disabled?: boolean;
}

export function FormRenderer({ schema, values, onChange, disabled }: Props) {
  const set = (key: string, v: any) => onChange({ ...values, [key]: v });
  const setNested = (group: string, item: string, v: any) => {
    const groups = { ...(values._groups || {}) };
    groups[group] = { ...(groups[group] || {}), [item]: v };
    onChange({ ...values, _groups: groups });
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

      {schema.fields && schema.fields.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {schema.fields.map((f) => (
            <div key={f.id} className={f.type === "textarea" ? "md:col-span-2" : ""}>
              <label className="label">
                {f.label}
                {f.required && <span className="text-red-500 ml-0.5">*</span>}
              </label>
              {f.type === "textarea" ? (
                <textarea
                  className="input min-h-[80px]"
                  disabled={disabled}
                  value={values[f.id] || ""}
                  onChange={(e) => set(f.id, e.target.value)}
                />
              ) : f.type === "select" ? (
                <select
                  className="input"
                  disabled={disabled}
                  value={values[f.id] || ""}
                  onChange={(e) => set(f.id, e.target.value)}
                >
                  <option value="">—</option>
                  {(f.options || []).map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : (
                <input
                  className="input"
                  type={f.type}
                  disabled={disabled}
                  value={values[f.id] || ""}
                  onChange={(e) => set(f.id, e.target.value)}
                />
              )}
              {f.description && <p className="help">{f.description}</p>}
            </div>
          ))}
        </div>
      )}

      {schema.groups?.filter((g) => g.enabled).map((g) => (
        <div key={g.id} className="card">
          <div className="card-header">
            <h3 className="font-medium text-slate-900">{g.title}</h3>
          </div>
          <div className="card-body grid grid-cols-1 md:grid-cols-2 gap-3">
            {g.items.map((it) => {
              const checked = !!values._groups?.[g.id]?.[it.id];
              return (
                <label key={it.id} className="flex items-start gap-3 rounded-lg border border-slate-200 px-3 py-2 hover:bg-slate-50">
                  <input
                    type="checkbox"
                    className="mt-1"
                    disabled={disabled}
                    checked={checked}
                    onChange={(e) => setNested(g.id, it.id, e.target.checked)}
                  />
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
