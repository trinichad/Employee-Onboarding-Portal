import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import toast from "react-hot-toast";
import { Check, Download, RefreshCw, Send, Trash2, X } from "lucide-react";
import { orgApi } from "@/api";
import { apiError, getAccessToken } from "@/api/client";
import { useAuth } from "@/auth/AuthContext";
import { FormRenderer } from "@/components/FormRenderer";
import { RequestSummary } from "@/components/RequestSummary";
import { PageHeader, Spinner, StatusBadge } from "@/components/ui";
import type { RequestStatus } from "@/types";
import { formatDateTime } from "@/lib/platform";

export default function OrgRequestDetail() {
  const { orgSlug = "", id = "" } = useParams();
  const rid = Number(id);
  const qc = useQueryClient();
  const nav = useNavigate();
  const { user } = useAuth();
  const isAdmin = user?.role === "global_admin" || user?.role === "client_admin";
  const isApprover = isAdmin || !!user?.can_approve_requests;

  const req = useQuery({ queryKey: ["org.request", orgSlug, rid], queryFn: () => orgApi.getRequest(orgSlug, rid) });
  const form = useQuery({ queryKey: ["org.form", orgSlug], queryFn: () => orgApi.getForm(orgSlug) });
  const org = useQuery({ queryKey: ["org", orgSlug], queryFn: () => orgApi.get(orgSlug) });

  const [values, setValues] = useState<Record<string, any>>({});
  const [notes, setNotes] = useState("");
  const [supportMessage, setSupportMessage] = useState("");
  const [status, setStatus] = useState<RequestStatus>("pending_approval");

  useEffect(() => {
    if (req.data) {
      setValues(req.data.payload || {});
      setNotes(req.data.notes || "");
      setSupportMessage(req.data.support_message || "");
      setStatus(req.data.status);
    }
  }, [req.data]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["org.request", orgSlug, rid] });
    qc.invalidateQueries({ queryKey: ["org.requests", orgSlug] });
  };

  const save = useMutation({
    mutationFn: () => {
      const derivedSubject =
        (typeof values.name === "string" && values.name.trim()) ||
        (typeof values.request_type === "string" && values.request_type) ||
        req.data?.subject ||
        "Request";
      const patch: Partial<{ subject: string; payload: any; notes: string; support_message: string; status: RequestStatus }> = {
        subject: derivedSubject,
        payload: values,
        notes,
        support_message: supportMessage,
      };
      // Only admins are allowed to change status; only send it when it actually changed.
      if (isAdmin && req.data && status !== req.data.status) {
        patch.status = status;
      }
      return orgApi.updateRequest(orgSlug, rid, patch);
    },
    onSuccess: () => { toast.success("Saved"); invalidate(); },
    onError: (e) => toast.error(apiError(e)),
  });

  const approve = useMutation({
    mutationFn: () => orgApi.approveRequest(orgSlug, rid),
    onSuccess: () => { toast.success("Approved"); invalidate(); },
    onError: (e) => toast.error(apiError(e)),
  });

  const reject = useMutation({
    mutationFn: () => orgApi.rejectRequest(orgSlug, rid),
    onSuccess: () => { toast.success("Rejected"); invalidate(); },
    onError: (e) => toast.error(apiError(e)),
  });

  const submit = useMutation({
    mutationFn: () => orgApi.submitRequest(orgSlug, rid),
    onSuccess: () => { toast.success("Sent to support"); invalidate(); },
    onError: (e) => toast.error(apiError(e)),
  });

  const resubmit = useMutation({
    mutationFn: () => orgApi.resubmitRequest(orgSlug, rid),
    onSuccess: () => { toast.success("Updated version sent to support"); invalidate(); },
    onError: (e) => toast.error(apiError(e)),
  });

  const del = useMutation({
    mutationFn: () => orgApi.deleteRequest(orgSlug, rid),
    onSuccess: () => {
      toast.success("Request deleted");
      qc.invalidateQueries({ queryKey: ["org.requests", orgSlug] });
      nav(`/${orgSlug}/requests`);
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const exportTxt = async () => {
    const url = orgApi.exportRequestUrl(orgSlug, rid);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${getAccessToken()}` } });
    if (!res.ok) { toast.error("Export failed"); return; }
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `request-${rid}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  if (req.isLoading || form.isLoading) return <Spinner />;
  if (!req.data) return <div>Not found.</div>;

  const isSubmitter = req.data.submitter_id === user?.id;
  const canEditNotes = isAdmin || isSubmitter;
  const canApprove = isApprover && req.data.status === "pending_approval";
  const canReject = isApprover && (req.data.status === "pending_approval" || req.data.status === "pending_submittal");
  const canSubmit = (isApprover || isSubmitter) && req.data.status === "pending_submittal";
  const wasSent = !!req.data.submitted_at;
  const editedAfterSubmit = !!req.data.edited_after_submit;
  const canResubmit = wasSent && (isApprover || isSubmitter);
  const supportEmail = org.data?.support_email || "";

  return (
    <>
      <PageHeader
        title={`Request #${req.data.id}`}
        description={req.data.subject || req.data.request_type}
        actions={<>
          <button className="btn-secondary" onClick={exportTxt}><Download size={14} /> Export</button>
          {canApprove && <button className="btn-primary" disabled={approve.isPending} onClick={() => approve.mutate()}><Check size={14} /> Approve</button>}
          {canReject && <button className="btn-secondary" disabled={reject.isPending} onClick={() => { if (confirm("Reject this request?")) reject.mutate(); }}><X size={14} /> Reject</button>}
          {canSubmit && (
            <button className="btn-primary" disabled={submit.isPending || !supportEmail} title={!supportEmail ? "Support email not configured" : `Send to ${supportEmail}`} onClick={() => submit.mutate()}>
              <Send size={14} /> Send to support
            </button>
          )}
          {canResubmit && editedAfterSubmit && (
            <button
              className="btn-primary"
              disabled={resubmit.isPending || !supportEmail}
              title={!supportEmail ? "Support email not configured" : `Resend updated version to ${supportEmail}`}
              onClick={() => { if (confirm("Resend the edited version to support? They will be told to disregard the previously sent copy.")) resubmit.mutate(); }}
            >
              <RefreshCw size={14} /> Resend edited version
            </button>
          )}
          {(isAdmin || canEditNotes) && <button className="btn-secondary" disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? "Saving…" : "Save"}</button>}
          {isAdmin && (
            <button
              className="btn-ghost text-red-600"
              disabled={del.isPending}
              onClick={() => { if (confirm(`Delete request #${rid}? This cannot be undone.`)) del.mutate(); }}
            >
              <Trash2 size={14} /> Delete
            </button>
          )}
        </>} />
      <div className="card mb-6">
        <div className="card-body flex flex-wrap gap-4 items-center">
          <div><div className="text-xs text-slate-500">Status</div>
            {isAdmin ? (
              <select className="input mt-1 max-w-[200px]" value={status} onChange={(e) => setStatus(e.target.value as RequestStatus)}>
                <option value="pending_approval">pending_approval</option>
                <option value="pending_submittal">pending_submittal</option>
                <option value="submitted">submitted</option>
                <option value="in_progress">in_progress</option>
                <option value="completed">completed</option>
                <option value="rejected">rejected</option>
                <option value="canceled">canceled</option>
              </select>
            ) : <div className="mt-1"><StatusBadge status={req.data.status} edited={editedAfterSubmit} /></div>}
          </div>
          <div><div className="text-xs text-slate-500">Submitted</div><div>{formatDateTime(req.data.created_at)}</div></div>
          <div><div className="text-xs text-slate-500">Type</div><div>{req.data.request_type}</div></div>
          {req.data.approved_at && (
            <div><div className="text-xs text-slate-500">Approved</div><div>{formatDateTime(req.data.approved_at)}</div></div>
          )}
          {req.data.first_submitted_at && (
            <div><div className="text-xs text-slate-500">First sent to support</div><div>{formatDateTime(req.data.first_submitted_at)}</div></div>
          )}
          {req.data.submitted_at && req.data.submission_count && req.data.submission_count > 1 && (
            <div><div className="text-xs text-slate-500">Last resent</div><div>{formatDateTime(req.data.submitted_at)} (rev {req.data.submission_count})</div></div>
          )}
          {req.data.submitted_at && !req.data.first_submitted_at && (
            <div><div className="text-xs text-slate-500">Sent to support</div><div>{formatDateTime(req.data.submitted_at)}{req.data.submission_count && req.data.submission_count > 1 ? ` (rev ${req.data.submission_count})` : ""}</div></div>
          )}
        </div>
      </div>

      {form.data && <RequestSummary schema={form.data.schema} values={values} notes={notes} supportMessage={supportMessage} />}

      {form.data && <FormRenderer schema={form.data.schema} values={values} onChange={setValues} disabled={!canEditNotes} orgSlug={orgSlug} />}

      {canEditNotes && (
        <div className="card mt-6">
          <div className="card-header"><h3 className="font-semibold">Message to support</h3></div>
          <div className="card-body space-y-2">
            <textarea
              className="input min-h-[100px]"
              value={supportMessage}
              onChange={(e) => setSupportMessage(e.target.value)}
              placeholder="Optional. Anything written here is included in the email body sent to support when this request is submitted."
            />
            <p className="help">Included in the support email under “Message to support”. Save before sending.</p>
          </div>
        </div>
      )}

      {canEditNotes && (
        <div className="card mt-6">
          <div className="card-header"><h3 className="font-semibold">Internal notes</h3></div>
          <div className="card-body space-y-2">
            <textarea className="input min-h-[100px]" value={notes} onChange={(e) => setNotes(e.target.value)} />
            <p className="help">Private to your organization. Not included in the email sent to support.</p>
          </div>
        </div>
      )}
    </>
  );
}
