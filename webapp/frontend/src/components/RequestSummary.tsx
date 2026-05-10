import type { FormSchemaDoc, OrgResource } from "@/types";
import { normalizeDynamicGroupValue, substitutePlaceholder } from "@/components/FormRenderer";

interface Props {
  schema: FormSchemaDoc;
  values: Record<string, any>;
  notes?: string | null;
  supportMessage?: string | null;
  /** Optional resource catalog so resource fields and dynamic-group
   *  placeholders can be resolved to human-readable names instead of ids. */
  resources?: OrgResource[];
}

function isFilled(v: any): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === "string") return v.trim() !== "";
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v).length > 0;
  return true;
}

function formatDateMDY(s: string): string {
  // Expecting "YYYY-MM-DD" from <input type="date">; render as MM/DD/YYYY
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[2]}/${m[3]}/${m[1]}`;
  return s;
}

export function RequestSummary({ schema, values, notes, supportMessage, resources }: Props) {
  const rows: { label: string; value: string }[] = [];
  const resourceById = new Map<number, OrgResource>();
  for (const r of resources || []) resourceById.set(r.id, r);

  if (values.request_type) {
    rows.push({ label: "Request Type", value: String(values.request_type) });
  }

  for (const f of schema.fields || []) {
    const v = values[f.id];
    if (!isFilled(v)) continue;
    let value: string;
    if (f.type === "date") {
      value = formatDateMDY(String(v));
    } else if (f.type === "resource") {
      const r = resourceById.get(Number(v));
      value = r ? r.name : String(v);
    } else {
      value = String(v);
    }
    rows.push({ label: f.label, value });
  }

  for (const g of schema.groups || []) {
    if (!g.enabled) continue;
    if (g.dynamic) {
      const dv = normalizeDynamicGroupValue(values._groups?.[g.id]);
      const placeholder = g.dynamic.placeholder || "{Property}";
      const sourceField = schema.fields?.find((x) => x.id === g.dynamic!.source_field_id);
      const sourceVal = sourceField ? values[sourceField.id] : undefined;
      // Resolve the source field's resource name when we have the catalog;
      // fall back to the raw value if it's already a string (legacy text
      // fields), otherwise undefined so the placeholder is left visible.
      let defaultName: string | undefined;
      if (typeof sourceVal === "number" || (typeof sourceVal === "string" && /^\d+$/.test(sourceVal))) {
        defaultName = resourceById.get(Number(sourceVal))?.name;
      } else if (typeof sourceVal === "string" && sourceVal.trim() !== "") {
        defaultName = sourceVal;
      }
      const renderItems = (sel: Record<string, boolean>, name: string | undefined) =>
        g.items.filter((it) => sel[it.id]).map((it) => substitutePlaceholder(it.label, placeholder, name));
      const titleFor = (name: string | undefined) => substitutePlaceholder(g.title, placeholder, name);
      const defaultItems = renderItems(dv.default, defaultName);
      if (defaultItems.length) rows.push({ label: titleFor(defaultName), value: defaultItems.join(", ") });
      for (const ex of dv.extras) {
        const extraName = resourceById.get(ex.resource_id)?.name;
        const items = renderItems(ex.items, extraName);
        if (items.length) {
          const label = extraName ? titleFor(extraName) : `${titleFor(undefined)} (resource #${ex.resource_id})`;
          rows.push({ label, value: items.join(", ") });
        }
      }
      continue;
    }
    const checked = (g.items || [])
      .filter((it) => !!values._groups?.[g.id]?.[it.id])
      .map((it) => it.label);
    if (checked.length > 0) rows.push({ label: g.title, value: checked.join(", ") });
  }

  if (supportMessage && supportMessage.trim() !== "") {
    rows.push({ label: "Message to support", value: supportMessage });
  }

  // Notes are internal-only and intentionally not shown in the Summary card;
  // they're rendered separately on the request detail page.
  void notes;

  if (rows.length === 0) return null;

  return (
    <div className="card mb-6">
      <div className="card-header"><h3 className="font-semibold">Summary</h3></div>
      <div className="card-body">
        <dl className="grid grid-cols-1 sm:grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
          {rows.map((r, i) => (
            <div key={i} className="contents">
              <dt className="font-medium text-slate-600 dark:text-slate-300">{r.label}:</dt>
              <dd className="text-slate-900 dark:text-slate-100 whitespace-pre-wrap break-words">{r.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
