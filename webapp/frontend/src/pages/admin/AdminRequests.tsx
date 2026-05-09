import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { adminApi } from "@/api";
import { PageHeader, Spinner, StatusBadge } from "@/components/ui";
import { formatDateTime } from "@/lib/platform";

export default function AdminRequests() {
  const [orgId, setOrgId] = useState<string>("");
  const orgs = useQuery({ queryKey: ["orgs"], queryFn: adminApi.listOrgs });
  const data = useQuery({
    queryKey: ["admin.requests", orgId],
    queryFn: () => adminApi.listAllRequests({ organization_id: orgId ? Number(orgId) : undefined }),
  });

  return (
    <>
      <PageHeader title="All Requests" description="Employee requests across organizations." actions={
        <select className="input max-w-xs" value={orgId} onChange={(e) => setOrgId(e.target.value)}>
          <option value="">All organizations</option>
          {orgs.data?.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
      } />
      {data.isLoading ? <Spinner /> : (
        <div className="table-wrap">
          <table className="dt">
            <thead><tr><th>#</th><th>Employee Name</th><th>Type</th><th>Status</th><th>Org</th><th>Submitted</th></tr></thead>
            <tbody>
              {data.data?.map((r) => (
                <tr key={r.id}>
                  <td>#{r.id}</td>
                  <td>
                    <Link className="text-brand-700 hover:underline" to={`/admin/requests/${r.id}`}>
                      {r.subject || <span className="text-slate-400">—</span>}
                    </Link>
                  </td>
                  <td>{r.request_type}</td>
                  <td><StatusBadge status={r.status} edited={r.edited_after_submit} /></td>
                  <td>{orgs.data?.find((o) => o.id === r.organization_id)?.name || r.organization_id}</td>
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
