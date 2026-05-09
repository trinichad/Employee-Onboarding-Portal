import clsx from "clsx";
import type { HTMLAttributes, ReactNode } from "react";

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-6">
      <div className="min-w-0">
        <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-slate-900 dark:text-white truncate">{title}</h1>
        {description && <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={clsx("card", className)} {...props} />;
}

export function StatCard({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="card">
      <div className="card-body">
        <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400 font-semibold">{label}</div>
        <div className="text-3xl font-semibold mt-1 text-slate-900 dark:text-white">{value}</div>
        {hint && <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">{hint}</div>}
      </div>
    </div>
  );
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="card">
      <div className="card-body text-center py-12">
        <h3 className="text-base font-semibold text-slate-900 dark:text-white">{title}</h3>
        {description && <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{description}</p>}
        {action && <div className="mt-4 flex justify-center">{action}</div>}
      </div>
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <div className={clsx("inline-block h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-brand-600", className)} />
  );
}

export function StatusBadge({ status, edited }: { status: string; edited?: boolean }) {
  const map: Record<string, string> = {
    pending_approval: "badge-amber",
    pending_submittal: "badge-blue",
    submitted: "badge-blue",
    in_progress: "badge-amber",
    completed: "badge-green",
    rejected: "badge-red",
    canceled: "badge-gray",
    open: "badge-blue",
    resolved: "badge-green",
    closed: "badge-gray",
  };
  const cls = map[status] || "badge-gray";
  return (
    <span className="inline-flex items-center gap-1">
      <span className={cls}>{status.replace(/_/g, " ")}</span>
      {edited && (
        <span
          className="badge-amber"
          title="Edited after being sent to support; resend to update them."
        >
          edited
        </span>
      )}
    </span>
  );
}
