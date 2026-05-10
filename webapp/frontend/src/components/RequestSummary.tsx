import type { FormSchemaDoc } from "@/types";
import { normalizeDynamicGroupValue, substitutePlaceholder } from "@/components/FormRenderer";

interface Props {
  schema: FormSchemaDoc;
  values: Record<string, any>;
  notes?: string | null;
  supportMessage?: string | null;
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

export function RequestSummary({ schema, values, notes, supportMessage }: Props) {
  const rows: { label: string; value: string }[] = [];

  if (values.request_type) {
    rows.push({ label: "Request Type", value: String(values.request_type) });
  }

  for (const f of schema.fields || []) {
    const v = values[f.id];
    if (!isFilled(v)) continue;
    const value = f.type === "date" ? formatDateMDY(String(v)) : String(v);
    rows.push({ label: f.label, value });
  }

  for (const g of schema.groups || []) {
    if (!g.enabled) continue;
    if (g.dynamic) {
      const dv = normalizeDynamicGroupValue(values._groups?.[g.id]);
      const placeholder = g.dynamic.placeholder || "{Property}";
      const sourceField = schema.fields?.find((x) => x.id === g.dynamic!.source_field_id);
      const sourceVal = sourceField ? values[sourceField.id] : undefined;
      // The selected resource's name lives elsewhere in payload (we don't
      // have the resource catalog here). Fall back to the raw value when it
      // looks like a name; for ids we surface them so reviewers can still
      // see context.
      const defaultName = typeof sourceVal === "string" && sourceVal.trim() !== "" ? sourceVal : undefined;
      const renderItems = (sel: Record<string, boolean>, name: string | undefined) =>
        g.items.filter((it) => sel[it.id]).map((it) => substitutePlaceholder(it.label, placeholder, name));
      const titleFor = (name: string | undefined) => substitutePlaceholder(g.title, placeholder, name);
      const defaultItems = renderItems(dv.default, defaultName);
      if (defaultItems.length) rows.push({ label: titleFor(defaultName), value: defaultItems.join(", ") });
      for (const ex of dv.extras) {
        // Without the resource catalog we can't translate the id to a name.
        const items = renderItems(ex.items, undefined);
        if (items.length) rows.push({ label: titleFor(undefined) + ` (resource #${ex.resource_id})`, value: items.join(", ") });
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

  if (notes && notes.trim() !== "") {
    rows.push({ label: "Notes", value: notes });
  }

  if (rows.length === 0) return null;

  return (
    <div className="card mb-6">
      <div className="card-header"><h3 className="font-semibold">Summary</h3></div>
      <div className="card-body">
        <dl className="grid grid-cols-1 sm:grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
          {rows.map((r, i) => (
            <div key={i} className="contents">
              <dt className="font-medium text-slate-600">{r.label}:</dt>
              <dd className="text-slate-900 whitespace-pre-wrap break-words">{r.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
