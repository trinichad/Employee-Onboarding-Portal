import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { Plus } from "lucide-react";
import { orgApi } from "@/api";
import { PageHeader, EmptyState, Spinner, StatusBadge } from "@/components/ui";
import { formatDateTime } from "@/lib/platform";

export default function OrgRequests() {
  const { orgSlug = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<string>(params.get("status") || "");

  useEffect(() => {
    const s = params.get("status") || "";
    setStatus(s);
  }, [params]);

  const data = useQuery({
    queryKey: ["org.requests", orgSlug, q, status],
    queryFn: () => orgApi.listRequests(orgSlug, { q: q || undefined, status: (status || undefined) as any }),
  });

  const onStatusChange = (v: string) => {
    setStatus(v);
    const next = new URLSearchParams(params);
    if (v) next.set("status", v); else next.delete("status");
    setParams(next, { replace: true });
  };

  return (
    <>
      <PageHeader title="Requests"
        actions={<>
          <input className="input max-w-xs" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
          <select className="input max-w-[180px]" value={status} onChange={(e) => onStatusChange(e.target.value)}>
            <option value="">All</option>
            <option value="pending_approval">Pending approval</option>
            <option value="pending_submittal">Pending submittal</option>
            <option value="submitted">Submitted</option>
            <option value="in_progress">In progress</option>
            <option value="completed">Completed</option>
            <option value="rejected">Rejected</option>
            <option value="canceled">Canceled</option>
          </select>
          <Link className="btn-primary" to={`/${orgSlug}/requests/new`}><Plus size={16} /> New</Link>
        </>} />

      {data.isLoading ? <Spinner /> : data.data?.length === 0 ? (
        <EmptyState title="No requests" />
      ) : (
        <div className="table-wrap">
          <table className="dt">
            <thead><tr><th>#</th><th>Employee Name</th><th>Type</th><th>Status</th><th>Submitted</th></tr></thead>
            <tbody>
              {data.data?.map((r) => (
                <tr key={r.id}>
                  <td>#{r.id}</td>
                  <td><Link className="text-brand-700 hover:underline" to={`/${orgSlug}/requests/${r.id}`}>{r.subject || r.request_type}</Link></td>
                  <td>{r.request_type}</td>
                  <td><StatusBadge status={r.status} edited={r.edited_after_submit} /></td>
                  <td className="text-slate-500">{formatDateTime(r.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
