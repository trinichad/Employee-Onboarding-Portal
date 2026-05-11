import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { adminApi } from "@/api";
import { PageHeader, Spinner } from "@/components/ui";
import { formatDateTime } from "@/lib/platform";

const PAGE_SIZE_OPTIONS = [20, 50, 100] as const;

export default function AdminAudit() {
  const [orgId, setOrgId] = useState<string>("");
  const [pageSize, setPageSize] = useState<number>(20);
  const [shown, setShown] = useState<number>(20);
  const [searchInput, setSearchInput] = useState<string>("");
  const [search, setSearch] = useState<string>("");

  // Debounce search input.
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Reset visible window when filters change.
  useEffect(() => {
    setShown(pageSize);
  }, [orgId, search, pageSize]);

  const orgs = useQuery({ queryKey: ["orgs"], queryFn: adminApi.listOrgs });
  const data = useQuery({
    queryKey: ["admin.audit", orgId, search, shown],
    queryFn: () =>
      adminApi.audit({
        organization_id: orgId ? Number(orgId) : undefined,
        limit: shown,
        offset: 0,
        search: search || undefined,
      }),
    placeholderData: keepPreviousData,
  });

  const items = data.data?.items ?? [];
  const total = data.data?.total ?? 0;
  const hasMore = items.length < total;

  const orgsById = useMemo(() => {
    const m = new Map<number, string>();
    for (const o of orgs.data ?? []) m.set(o.id, o.name);
    return m;
  }, [orgs.data]);

  return (
    <>
      <PageHeader
        title="Audit Log"
        description="Most recent platform activity."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="search"
              className="input max-w-xs"
              placeholder="Search action, target, actor, date…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
            <select
              className="input max-w-xs"
              value={orgId}
              onChange={(e) => setOrgId(e.target.value)}
            >
              <option value="">All organizations</option>
              {orgs.data?.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
            <select
              className="input w-auto"
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value))}
              title="Rows per page"
            >
              {PAGE_SIZE_OPTIONS.map((n) => (
                <option key={n} value={n}>{n} / page</option>
              ))}
            </select>
          </div>
        }
      />
      {data.isLoading && !data.data ? (
        <Spinner />
      ) : (
        <>
          <div className="table-wrap">
            <table className="dt">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Action</th>
                  <th>Target</th>
                  <th>Org</th>
                  <th>Actor</th>
                </tr>
              </thead>
              <tbody>
                {items.map((a) => (
                  <tr key={a.id}>
                    <td className="text-slate-500">{formatDateTime(a.created_at)}</td>
                    <td><code className="text-xs">{a.action}</code></td>
                    <td className="text-xs">
                      {a.target_type
                        ? (a.target_label
                            ? <span title={`${a.target_type}#${a.target_id}`}>{a.target_label}</span>
                            : `${a.target_type}#${a.target_id}`)
                        : "—"}
                    </td>
                    <td>
                      {a.organization_id != null
                        ? (orgsById.get(a.organization_id) || a.organization_id)
                        : "—"}
                    </td>
                    <td>
                      {a.actor_email
                        ? <span title={a.actor_name || undefined}>{a.actor_email}</span>
                        : (a.actor_id != null ? `user#${a.actor_id}` : "system")}
                    </td>
                  </tr>
                ))}
                {items.length === 0 && !data.isFetching && (
                  <tr>
                    <td colSpan={5} className="text-center text-slate-500 py-6">
                      No audit entries match.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex items-center justify-between text-sm text-slate-500">
            <div>
              Showing {items.length} of {total}
              {data.isFetching ? " · loading…" : ""}
            </div>
            {hasMore && (
              <button
                className="btn-secondary"
                onClick={() => setShown((n) => n + pageSize)}
                disabled={data.isFetching}
              >
                Load {Math.min(pageSize, total - items.length)} more
              </button>
            )}
          </div>
        </>
      )}
    </>
  );
}

