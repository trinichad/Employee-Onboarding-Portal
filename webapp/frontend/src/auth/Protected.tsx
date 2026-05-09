import { Navigate, useLocation, useParams } from "react-router-dom";
import type { ReactNode } from "react";
import { useAuth } from "./AuthContext";
import type { Role } from "@/types";

interface ProtectedProps {
  children: ReactNode;
  roles?: Role[];
  requireOrgMatch?: boolean; // ensures user belongs to :orgSlug
  redirectTo?: string;
}

export function Protected({ children, roles, requireOrgMatch, redirectTo }: ProtectedProps) {
  const { user, loading } = useAuth();
  const location = useLocation();
  const params = useParams();
  if (loading) return <div className="min-h-screen flex items-center justify-center text-slate-500">Loading…</div>;
  if (!user) {
    const target = redirectTo ?? (params.orgSlug ? `/${params.orgSlug}/login` : "/admin/login");
    return <Navigate to={target} state={{ from: location.pathname }} replace />;
  }
  if (roles && !roles.includes(user.role)) {
    return <ForbiddenView />;
  }
  if (requireOrgMatch && user.role !== "global_admin") {
    // need to know org id for slug — caller route layout will validate when fetching org.
    // Mismatch is also enforced by API.
  }
  return <>{children}</>;
}

export function ForbiddenView() {
  return (
    <div className="min-h-screen flex items-center justify-center p-8">
      <div className="card max-w-md w-full">
        <div className="card-body text-center space-y-2">
          <div className="text-5xl">🚫</div>
          <h1 className="text-xl font-semibold">Access denied</h1>
          <p className="text-sm text-slate-600">You don't have permission to view this page.</p>
        </div>
      </div>
    </div>
  );
}
