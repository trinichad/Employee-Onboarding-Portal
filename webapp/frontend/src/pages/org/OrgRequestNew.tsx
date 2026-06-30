import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import toast from "react-hot-toast";
import { orgApi } from "@/api";
import { apiError } from "@/api/client";
import { PageHeader, Spinner } from "@/components/ui";
import { FormRenderer } from "@/components/FormRenderer";
import type { FormField } from "@/types";

export default function OrgRequestNew() {
  const { orgSlug = "" } = useParams();
  const nav = useNavigate();
  const form = useQuery({ queryKey: ["org.form", orgSlug], queryFn: () => orgApi.getForm(orgSlug) });
  const [values, setValues] = useState<Record<string, any>>({});
  const [supportMessage, setSupportMessage] = useState("");
  const [notes, setNotes] = useState("");

  const validate = (): string | null => {
    const schema = form.data?.schema;
    if (!schema) return "Form is still loading.";
    const rt: string | undefined = values.request_type;
    const isVisible = (f: FormField) => {
      const allow = f.visible_when_request_type_in;
      if (allow === undefined) return true;
      return !!rt && allow.includes(rt);
    };
    const isEmpty = (v: any) =>
      v === undefined || v === null || (typeof v === "string" && v.trim() === "") || (Array.isArray(v) && v.length === 0);
    for (const f of schema.fields || []) {
      if (!f.required) continue;
      if (!isVisible(f)) continue;
      if (isEmpty(values[f.id])) return `"${f.label}" is required.`;
    }
    return null;
  };

  const create = useMutation({
    mutationFn: () => orgApi.createRequest(orgSlug, {
      request_type: values.request_type || "General",
      subject: values.name || values.request_type || "Request",
      payload: values,
      support_message: supportMessage || undefined,
      notes: notes || undefined,
    }),
    onSuccess: (r) => {
      toast.success(
        r.status === "pending_approval"
          ? "Request created — awaiting approval"
          : "Request created — ready to send to support",
      );
      nav(`/${orgSlug}/requests/${r.id}`);
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const onSubmit = () => {
    const err = validate();
    if (err) { toast.error(err); return; }
    create.mutate();
  };

  return (
    <>
      <PageHeader title="New Request" description="Fill in the form to submit a new employee request." />
      {form.isLoading ? <Spinner /> : form.isError ? (
        <div className="card"><div className="card-body text-sm text-slate-600">No form configured for this organization yet.</div></div>
      ) : (
        <div className="space-y-6">
          <FormRenderer schema={form.data!.schema} values={values} onChange={setValues} orgSlug={orgSlug} />

          <div className="card">
            <div className="card-header"><h3 className="font-semibold">Message to support</h3></div>
            <div className="card-body space-y-2">
              <textarea
                className="input min-h-[100px]"
                value={supportMessage}
                onChange={(e) => setSupportMessage(e.target.value)}
                placeholder="Optional. Anything written here is included in the email body sent to support when this request is submitted."
              />
              <p className="help">Included in the support email under “Message to support”. Editable later from the request page.</p>
            </div>
          </div>

          <div className="card">
            <div className="card-header"><h3 className="font-semibold">Internal notes</h3></div>
            <div className="card-body space-y-2">
              <textarea
                className="input min-h-[100px]"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional. Visible only to your organization."
              />
              <p className="help">Private to your organization. Not included in the email sent to support.</p>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <button className="btn-secondary" onClick={() => nav(-1)}>Cancel</button>
            <button className="btn-primary" disabled={create.isPending} onClick={onSubmit}>
              {create.isPending ? "Submitting…" : "Submit request"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
