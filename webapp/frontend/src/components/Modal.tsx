import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import clsx from "clsx";

export function Modal({
  open, onClose, title, children, size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  const sizes = { sm: "max-w-sm", md: "max-w-md", lg: "max-w-2xl", xl: "max-w-4xl" };
  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/50 overflow-y-auto"
      onClick={onClose}
    >
      <div
        ref={ref}
        className={clsx(
          "w-full bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xl ring-1 ring-slate-200 dark:ring-slate-700",
          "rounded-t-2xl sm:rounded-xl",
          "max-h-[92vh] sm:max-h-[85vh] overflow-y-auto",
          sizes[size]
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between sticky top-0 bg-white dark:bg-slate-800 rounded-t-2xl sm:rounded-t-xl z-10">
            <h2 className="text-base font-semibold">{title}</h2>
            <button onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300 px-2 py-1 -mr-2">✕</button>
          </div>
        )}
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}
