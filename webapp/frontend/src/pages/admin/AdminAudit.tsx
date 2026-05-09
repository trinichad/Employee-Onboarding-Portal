import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { adminApi } from "@/api";
import { PageHeader, Spinner } from "@/components/ui";
import { formatDateTime } from "@/lib/platform";

export default function AdminAudit() {
  const [orgId, setOrgId] = useState<string>("");
  const orgs = useQuery({ queryKey: ["orgs"], queryFn: adminApi.listOrgs });
  const data = useQuery({
    queryKey: ["admin.audit", orgId],
    queryFn: () => adminApi.audit({ organization_id: orgId ? Number(orgId) : undefined }),
  });
  return (
    <>
      <PageHeader title="Audit Log" description="Most recent platform activity." actions={
        <select className="input max-w-xs" value={orgId} onChange={(e) => setOrgId(e.target.value)}>
          <option value="">All organizations</option>
          {orgs.data?.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
      } />
      {data.isLoading ? <Spinner /> : (
        <div className="table-wrap">
          <table className="dt">
            <thead><tr><th>When</th><th>Action</th><th>Target</th><th>Org</th><th>Actor</th></tr></thead>
            <tbody>
              {data.data?.map((a) => (
                <tr key={a.id}>
                  <td className="text-slate-500">{formatDateTime(a.created_at)}</td>
                  <td><code className="text-xs">{a.action}</code></td>
                  <td className="text-xs">{a.target_type ? `${a.target_type}#${a.target_id}` : "—"}</td>
                  <td>{orgs.data?.find((o) => o.id === a.organization_id)?.name || (a.organization_id ?? "—")}</td>
                  <td>{a.actor_email ? (
                    <span title={a.actor_name || undefined}>{a.actor_email}</span>
                  ) : (a.actor_id != null ? `user#${a.actor_id}` : "system")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
