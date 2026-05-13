import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Download } from "lucide-react";
import toast from "react-hot-toast";
import { adminApi, orgApi } from "@/api";
import { getAccessToken } from "@/api/client";
import { PageHeader, Spinner, StatusBadge } from "@/components/ui";
import { RequestSummary } from "@/components/RequestSummary";
import { formatDateTime } from "@/lib/platform";

export default function AdminRequestDetail() {
  const { id = "" } = useParams();
  const rid = Number(id);
  const data = useQuery({ queryKey: ["admin.request", rid], queryFn: () => adminApi.getRequest(rid) });
  const orgSlug = data.data?.organization?.slug || "";
  const resources = useQuery({
    queryKey: ["org.resources.all", orgSlug],
    queryFn: () => orgApi.listResources(orgSlug, {}),
    enabled: !!orgSlug,
  });

  const exportPdf = async () => {
    const res = await fetch(adminApi.exportRequestUrl(rid), {
      headers: { Authorization: `Bearer ${getAccessToken()}` },
    });
    if (!res.ok) { toast.error("Export failed"); return; }
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `request-${rid}.pdf`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  if (data.isLoading) return <Spinner />;
  if (!data.data) return <div>Not found.</div>;

  const { request, organization, submitter, schema } = data.data;
  const submitterLabel = submitter ? `${submitter.full_name} <${submitter.email}>` : "Unknown";

  return (
    <>
      <PageHeader
        title={`Request #${request.id}`}
        description={organization?.name || ""}
        actions={
          <>
            <button className="btn-secondary" onClick={exportPdf}><Download size={14} /> Export PDF</button>
            <Link className="btn-secondary" to="/admin/requests"><ArrowLeft size={14} /> Back</Link>
          </>
        }
      />

      <div className="card mb-6">
        <div className="card-body flex flex-wrap gap-6 items-center text-sm">
          <div><div className="text-xs text-slate-500">Status</div><div className="mt-1"><StatusBadge status={request.status} edited={request.edited_after_submit} /></div></div>
          <div><div className="text-xs text-slate-500">Type</div><div>{request.request_type}</div></div>
          <div><div className="text-xs text-slate-500">Organization</div><div>{organization?.name || "—"}</div></div>
          <div><div className="text-xs text-slate-500">Submitted by</div><div>{submitterLabel}</div></div>
          <div><div className="text-xs text-slate-500">Submitted</div><div>{formatDateTime(request.created_at)}</div></div>
          {request.submitted_at && (
            <div><div className="text-xs text-slate-500">Sent to support</div><div>{formatDateTime(request.submitted_at)}</div></div>
          )}
        </div>
      </div>

      <RequestSummary
        schema={schema || { fields: [], groups: [] }}
        values={request.payload || {}}
        notes={request.notes}
        supportMessage={request.support_message}
        resources={resources.data}
      />
    </>
  );
}
