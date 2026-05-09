import { Link } from "react-router-dom";

export default function Landing() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-brand-50">
      <header className="max-w-6xl mx-auto px-4 sm:px-6 py-5 sm:py-6 flex items-center justify-between">
        <div className="flex items-center gap-2 font-semibold text-slate-900">
          <div className="h-8 w-8 rounded-lg bg-brand-600 text-white grid place-items-center text-sm">EO</div>
          <span className="text-sm sm:text-base">Employee Onboarding Portal</span>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-10 sm:py-20 grid md:grid-cols-2 gap-8 md:gap-12 items-center">
        <div>
          <div className="badge-blue mb-4">Multi-tenant SaaS</div>
          <h1 className="text-3xl sm:text-4xl md:text-5xl font-semibold tracking-tight text-slate-900 leading-tight">
            Streamlined onboarding, offboarding, and rehire requests.
          </h1>
          <p className="mt-4 sm:mt-5 text-base sm:text-lg text-slate-600 max-w-lg">
            A modern, organization-isolated portal for new-hire, termination, rehire, and other
            employee lifecycle requests. Configurable forms, role-based access, and a powerful
            admin console.
          </p>
          <div className="mt-6 sm:mt-8 flex flex-col sm:flex-row gap-3">
            <Link to="/admin/login" className="btn-primary">Open Admin Console</Link>
            <Link to="/login" className="btn-secondary">Organization sign in (user or admin)</Link>
          </div>
        </div>
        <div className="card">
          <div className="card-body">
            <h3 className="font-semibold text-slate-900">Sign in to your organization</h3>
            <p className="text-sm text-slate-500 mt-1">
              Use your work email and password — we'll take you to the right organization automatically.
            </p>
            <div className="mt-4">
              <Link to="/login" className="btn-primary w-full text-center">Sign in</Link>
            </div>
            <p className="text-xs text-slate-500 mt-3 break-all">
              Have a direct organization link? You can also visit{" "}
              <span className="font-mono">{window.location.origin}/your-org-slug</span>.
            </p>
          </div>
        </div>
      </main>

      <footer className="max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-10 text-center text-xs text-slate-500">
        © {new Date().getFullYear()} Employee Onboarding Portal
      </footer>
    </div>
  );
}
