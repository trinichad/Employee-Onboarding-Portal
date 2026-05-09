import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { adminApi } from "@/api";
import { PageHeader, StatCard, Spinner } from "@/components/ui";

export default function AdminDashboard() {
  const stats = useQuery({ queryKey: ["admin.stats"], queryFn: adminApi.stats });
  return (
    <>
      <PageHeader title="Platform Overview" description="Top-level platform metrics and quick actions." />
      {stats.isLoading ? <Spinner /> : (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <Link to="/admin/organizations" className="block transition hover:-translate-y-0.5 hover:shadow-md rounded-xl">
            <StatCard label="Organizations" value={stats.data?.organizations ?? 0} />
          </Link>
          <Link to="/admin/users" className="block transition hover:-translate-y-0.5 hover:shadow-md rounded-xl">
            <StatCard label="Users" value={stats.data?.users ?? 0} />
          </Link>
          <Link to="/admin/requests" className="block transition hover:-translate-y-0.5 hover:shadow-md rounded-xl">
            <StatCard label="Requests" value={stats.data?.requests ?? 0} />
          </Link>
        </div>
      )}
      <div className="mt-8 grid md:grid-cols-2 gap-4">
        <div className="card">
          <div className="card-body">
            <h3 className="font-semibold">Quick actions</h3>
            <div className="mt-3 flex flex-wrap gap-2">
              <Link className="btn-primary" to="/admin/organizations">Manage organizations</Link>
              <Link className="btn-secondary" to="/admin/audit">View audit log</Link>
            </div>
          </div>
        </div>
        <div className="card">
          <div className="card-body">
            <h3 className="font-semibold">About</h3>
            <p className="text-sm text-slate-600 mt-1">
              You are signed in as Global Admin. From here you can create new client organizations,
              manage users platform-wide, and monitor activity.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
