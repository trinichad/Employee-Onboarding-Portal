import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import toast from "react-hot-toast";
import { orgApi } from "@/api";
import { apiError } from "@/api/client";
import { PageHeader, Spinner } from "@/components/ui";
import { FormRenderer } from "@/components/FormRenderer";

export default function OrgRequestNew() {
  const { orgSlug = "" } = useParams();
  const nav = useNavigate();
  const form = useQuery({ queryKey: ["org.form", orgSlug], queryFn: () => orgApi.getForm(orgSlug) });
  const [values, setValues] = useState<Record<string, any>>({});

  const create = useMutation({
    mutationFn: () => orgApi.createRequest(orgSlug, {
      request_type: values.request_type || "General",
      subject: values.name || values.request_type || "Request",
      payload: values,
    }),
    onSuccess: (r) => { toast.success("Request created — awaiting approval"); nav(`/${orgSlug}/requests/${r.id}`); },
    onError: (e) => toast.error(apiError(e)),
  });

  return (
    <>
      <PageHeader title="New Request" description="Fill in the form to submit a new employee request." />
      {form.isLoading ? <Spinner /> : form.isError ? (
        <div className="card"><div className="card-body text-sm text-slate-600">No form configured for this organization yet.</div></div>
      ) : (
        <div className="space-y-6">
          <FormRenderer schema={form.data!.schema} values={values} onChange={setValues} orgSlug={orgSlug} />

          <div className="flex justify-end gap-2">
            <button className="btn-secondary" onClick={() => nav(-1)}>Cancel</button>
            <button className="btn-primary" disabled={create.isPending} onClick={() => create.mutate()}>
              {create.isPending ? "Submitting…" : "Submit request"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
