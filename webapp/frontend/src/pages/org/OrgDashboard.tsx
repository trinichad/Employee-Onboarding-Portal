import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import clsx from "clsx";
import { Plus } from "lucide-react";
import { orgApi } from "@/api";
import { PageHeader, EmptyState, Spinner, StatusBadge } from "@/components/ui";
import type { EmployeeRequest, RequestStatus } from "@/types";
import { formatDateTime } from "@/lib/platform";

const ALL_COLUMNS: { key: string; label: string; render: (r: EmployeeRequest) => React.ReactNode }[] = [
  { key: "id", label: "#", render: (r) => `#${r.id}` },
  { key: "subject", label: "Subject", render: (r) => r.subject || r.request_type },
  { key: "type", label: "Type", render: (r) => r.request_type },
  { key: "status", label: "Status", render: (r) => <StatusBadge status={r.status} edited={r.edited_after_submit} /> },
  { key: "created_at", label: "When", render: (r) => formatDateTime(r.created_at) },
  { key: "approved_at", label: "Approved", render: (r) => r.approved_at ? formatDateTime(r.approved_at) : "—" },
  { key: "submitted_at", label: "Submitted", render: (r) => r.submitted_at ? formatDateTime(r.submitted_at) : "—" },
];

const DEFAULT_COLUMNS = ["id", "subject", "type", "status", "created_at"];

type FilterKey = "all" | "pending_approval" | "pending_submittal" | "submitted";

const FILTERS: { key: FilterKey; label: string; statuses: RequestStatus[] | null }[] = [
  { key: "all", label: "Total Requests", statuses: null },
  { key: "pending_approval", label: "Pending approval", statuses: ["pending_approval"] },
  { key: "pending_submittal", label: "Pending submittal", statuses: ["pending_submittal"] },
  { key: "submitted", label: "Submitted", statuses: ["submitted", "in_progress", "completed"] },
];

export default function OrgDashboard() {
  const { orgSlug = "" } = useParams();
  const reqs = useQuery({ queryKey: ["org.requests", orgSlug], queryFn: () => orgApi.listRequests(orgSlug) });
  const org = useQuery({ queryKey: ["org", orgSlug], queryFn: () => orgApi.get(orgSlug) });

  const [filter, setFilter] = useState<FilterKey>("all");

  const counts = useMemo(() => {
    const data = reqs.data ?? [];
    const result: Record<FilterKey, number> = {
      all: data.length,
      pending_approval: 0,
      pending_submittal: 0,
      submitted: 0,
    };
    for (const r of data) {
      if (r.status === "pending_approval") result.pending_approval++;
      else if (r.status === "pending_submittal") result.pending_submittal++;
      else if (r.status === "submitted" || r.status === "in_progress" || r.status === "completed") result.submitted++;
    }
    return result;
  }, [reqs.data]);

  const visible = useMemo(() => {
    const data = reqs.data ?? [];
    const f = FILTERS.find((x) => x.key === filter)!;
    if (!f.statuses) return data;
    return data.filter((r) => f.statuses!.includes(r.status));
  }, [reqs.data, filter]);

  // Hide the "Pending approval" stat when this org doesn't require approval —
  // requests skip that stage, so the count is always 0 and just adds noise.
  const requireApproval = org.data?.require_approval ?? true;
  const visibleFilters = requireApproval
    ? FILTERS
    : FILTERS.filter((f) => f.key !== "pending_approval");

  const colKeys = (org.data?.dashboard_columns?.length ? org.data.dashboard_columns : DEFAULT_COLUMNS);
  const cols = colKeys
    .map((k) => ALL_COLUMNS.find((c) => c.key === k))
    .filter(Boolean) as typeof ALL_COLUMNS;

  return (
    <>
      <PageHeader
        title="Dashboard"
        actions={<Link className="btn-primary" to={`/${orgSlug}/requests/new`}><Plus size={16} /> New request</Link>}
      />
      <div className={clsx("grid grid-cols-2 gap-4", requireApproval ? "md:grid-cols-4" : "md:grid-cols-3")}>
        {visibleFilters.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className={clsx(
              "card text-left transition focus:outline-none",
              filter === f.key ? "ring-2 ring-brand-500" : "hover:ring-1 hover:ring-slate-300",
            )}
          >
            <div className="card-body">
              <div className="text-xs uppercase tracking-wide text-slate-500 font-semibold">{f.label}</div>
              <div className="text-3xl font-semibold mt-1 text-slate-900 dark:text-slate-100">{counts[f.key]}</div>
            </div>
          </button>
        ))}
      </div>

      <div className="mt-8">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-slate-700">Recent activity</h3>
          <Link to={`/${orgSlug}/requests`} className="text-sm text-brand-700 hover:underline">View all →</Link>
        </div>
        {reqs.isLoading ? <Spinner /> : visible.length === 0 ? (
          <EmptyState
            title={filter === "all" ? "No requests yet" : "Nothing here"}
            action={<Link className="btn-primary" to={`/${orgSlug}/requests/new`}>Submit a request</Link>}
          />
        ) : (
          <div className="table-wrap">
            <table className="dt">
              <thead><tr>{cols.map((c) => <th key={c.key}>{c.label}</th>)}</tr></thead>
              <tbody>
                {visible.slice(0, 10).map((r) => (
                  <tr key={r.id} className="cursor-pointer">
                    {cols.map((c) => (
                      <td key={c.key}>
                        {c.key === "subject" ? (
                          <Link className="text-brand-700 hover:underline" to={`/${orgSlug}/requests/${r.id}`}>
                            {c.render(r)}
                          </Link>
                        ) : (
                          c.render(r)
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

export { ALL_COLUMNS, DEFAULT_COLUMNS };
