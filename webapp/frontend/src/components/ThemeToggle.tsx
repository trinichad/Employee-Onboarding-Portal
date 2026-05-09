import { Sun, Moon, Monitor } from "lucide-react";
import { useTheme } from "@/auth/ThemeContext";
import type { ThemePref } from "@/auth/ThemeContext";

const OPTIONS: { value: ThemePref; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const { theme, setTheme } = useTheme();
  return (
    <div className={`inline-flex rounded-lg ring-1 ring-slate-200 dark:ring-slate-700 bg-white dark:bg-slate-800 p-0.5 ${compact ? "" : ""}`}>
      {OPTIONS.map((o) => {
        const Icon = o.icon;
        const active = theme === o.value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => void setTheme(o.value)}
            title={o.label}
            aria-pressed={active}
            className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition ${
              active
                ? "bg-brand-600 text-white"
                : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700"
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {!compact && <span>{o.label}</span>}
          </button>
        );
      })}
    </div>
  );
}
