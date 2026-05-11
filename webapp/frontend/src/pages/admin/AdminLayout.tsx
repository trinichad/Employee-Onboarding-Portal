import { NavLink, Outlet, useNavigate, useLocation } from "react-router-dom";
import { Building2, Users, FileText, Activity, LogOut, LayoutDashboard, Settings, Menu, X, UserCog } from "lucide-react";
import clsx from "clsx";
import { useEffect, useState } from "react";
import { useAuth } from "@/auth/AuthContext";
import { useApplyTheme } from "@/auth/ThemeContext";
import { usePlatformConfig } from "@/lib/platform";

const items = [
  { to: "/admin", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/admin/organizations", label: "Organizations", icon: Building2 },
  { to: "/admin/users", label: "Users", icon: Users },
  { to: "/admin/requests", label: "Requests", icon: FileText },
  { to: "/admin/audit", label: "Audit Log", icon: Activity },
  { to: "/admin/settings", label: "Settings", icon: Settings },
  { to: "/admin/profile", label: "My Profile", icon: UserCog },
];

export default function AdminLayout() {
  useApplyTheme();
  const { user, logout } = useAuth();
  const platform = usePlatformConfig();
  const nav = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);

  // Close drawer on route change
  useEffect(() => { setOpen(false); }, [location.pathname]);
  // Lock body scroll when drawer open
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  const SidebarContent = (
    <>
      <div className="px-5 py-5 border-b border-slate-100 dark:border-slate-700 flex items-center gap-2">
        {platform.logo_url ? (
          <img src={platform.logo_url} alt="" className="h-8 w-8 rounded-lg object-contain bg-white" />
        ) : (
          <div className="h-8 w-8 rounded-lg bg-brand-600 text-white grid place-items-center text-sm font-semibold">IT</div>
        )}
        <div className="min-w-0">
          <div className="text-sm font-semibold">Admin Console</div>
          <div className="text-xs text-slate-500 dark:text-slate-400 truncate">{platform.platform_name}</div>
        </div>
      </div>
      <nav className="p-3 space-y-1 flex-1 overflow-y-auto">
        {items.map((it) => (
          <NavLink key={it.to} to={it.to} end={it.end}
            className={({ isActive }) => clsx("nav-link", isActive && "nav-link-active")}>
            <it.icon size={16} /> {it.label}
          </NavLink>
        ))}
      </nav>
      <div className="p-3 border-t border-slate-100 dark:border-slate-700">
        <div className="px-3 py-2 text-xs">
          <div className="font-medium text-slate-800 dark:text-slate-100 truncate">{user?.full_name}</div>
          <div className="text-slate-500 dark:text-slate-400 truncate">{user?.email}</div>
        </div>
        <button className="nav-link w-full" onClick={() => { logout(); nav("/admin/login"); }}>
          <LogOut size={16} /> Sign out
        </button>
      </div>
    </>
  );

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
      {/* Mobile top bar */}
      <header className="md:hidden sticky top-0 z-30 bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 px-4 h-14 flex items-center justify-between"
        style={{ paddingTop: "env(safe-area-inset-top)" }}>
        <button onClick={() => setOpen(true)} aria-label="Open menu" className="p-2 -ml-2 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white">
          <Menu size={22} />
        </button>
        <div className="flex items-center gap-2 font-semibold text-sm">
          {platform.logo_url ? (
            <img src={platform.logo_url} alt="" className="h-7 w-7 rounded-md object-contain bg-white" />
          ) : (
            <div className="h-7 w-7 rounded-md bg-brand-600 text-white grid place-items-center text-xs">IT</div>
          )}
          Admin Console
        </div>
        <div className="w-9" />
      </header>

      <div className="flex">
        {/* Desktop sidebar */}
        <aside className="hidden md:flex w-64 flex-col border-r border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 min-h-screen sticky top-0 self-start">
          {SidebarContent}
        </aside>

        {/* Mobile drawer */}
        {open && (
          <div className="md:hidden fixed inset-0 z-40">
            <div className="absolute inset-0 bg-slate-900/50" onClick={() => setOpen(false)} />
            <aside className="absolute left-0 top-0 bottom-0 w-72 max-w-[85vw] bg-white dark:bg-slate-800 shadow-xl flex flex-col"
              style={{ paddingTop: "env(safe-area-inset-top)" }}>
              <div className="flex justify-end p-2">
                <button onClick={() => setOpen(false)} aria-label="Close menu" className="p-2 text-slate-500 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white">
                  <X size={20} />
                </button>
              </div>
              {SidebarContent}
            </aside>
          </div>
        )}

        <main className="flex-1 px-4 sm:px-6 py-6 sm:py-8 max-w-6xl mx-auto w-full">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
