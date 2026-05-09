import { NavLink, Outlet, useNavigate, useParams, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { useEffect, useState } from "react";
import { FileText, Home, LogOut, Menu, Settings, Settings2, User, Users, X } from "lucide-react";
import { orgApi } from "@/api";
import { useAuth } from "@/auth/AuthContext";
import { useApplyTheme } from "@/auth/ThemeContext";
import { Spinner } from "@/components/ui";

export default function OrgLayout() {
  useApplyTheme();
  const { orgSlug = "" } = useParams();
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const org = useQuery({ queryKey: ["org", orgSlug], queryFn: () => orgApi.get(orgSlug) });

  useEffect(() => { setOpen(false); }, [location.pathname]);
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  if (org.isLoading) return <div className="min-h-screen grid place-items-center"><Spinner /></div>;
  if (org.isError) return <div className="min-h-screen grid place-items-center text-slate-600">Organization not available.</div>;

  const isAdmin = user?.role === "client_admin" || user?.role === "global_admin";

  const items = [
    { to: `/${orgSlug}`, label: "Dashboard", icon: Home, end: true },
    { to: `/${orgSlug}/requests`, label: "Requests", icon: FileText },
    ...(isAdmin ? [
      { to: `/${orgSlug}/users`, label: "Users", icon: Users },
      { to: `/${orgSlug}/form`, label: "Form Builder", icon: Settings2 },
      { to: `/${orgSlug}/settings`, label: "Settings", icon: Settings },
    ] : []),
    { to: `/${orgSlug}/profile`, label: "Profile", icon: User },
  ];

  const SidebarContent = (
    <>
      <div className="px-5 py-5 border-b border-slate-100 dark:border-slate-700">
        <div className="text-xs uppercase font-semibold tracking-wider text-slate-500 dark:text-slate-400">Organization</div>
        <div className="text-sm font-semibold mt-0.5 truncate">{org.data?.name}</div>
        <div className="text-xs text-slate-500 dark:text-slate-400 truncate">{org.data?.slug}</div>
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
          <div className="text-slate-500 dark:text-slate-400 truncate">{user?.role}</div>
        </div>
        <button className="nav-link w-full" onClick={() => { logout(); nav(`/${orgSlug}/login`); }}>
          <LogOut size={16} /> Sign out
        </button>
      </div>
    </>
  );

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
      <header className="md:hidden sticky top-0 z-30 bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 px-4 h-14 flex items-center justify-between"
        style={{ paddingTop: "env(safe-area-inset-top)" }}>
        <button onClick={() => setOpen(true)} aria-label="Open menu" className="p-2 -ml-2 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white">
          <Menu size={22} />
        </button>
        <div className="font-semibold text-sm truncate max-w-[60%]">{org.data?.name}</div>
        <div className="w-9" />
      </header>

      <div className="flex">
        <aside className="hidden md:flex w-64 flex-col border-r border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 min-h-screen sticky top-0 self-start">
          {SidebarContent}
        </aside>

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
