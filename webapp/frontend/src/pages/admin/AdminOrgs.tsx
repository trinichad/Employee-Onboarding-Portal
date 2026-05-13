import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import toast from "react-hot-toast";
import { Plus, ExternalLink, Download, Upload } from "lucide-react";
import { adminApi } from "@/api";
import { apiError } from "@/api/client";
import { Modal } from "@/components/Modal";
import { PageHeader, EmptyState, Spinner } from "@/components/ui";
import { formatDate } from "@/lib/platform";

export default function AdminOrgs() {
  const qc = useQueryClient();
  const orgs = useQuery({ queryKey: ["orgs"], queryFn: adminApi.listOrgs });
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [seed, setSeed] = useState(true);
  const importRef = useRef<HTMLInputElement | null>(null);

  const create = useMutation({
    mutationFn: () => adminApi.createOrg({ name, slug: slug || undefined, seed_default_form: seed }),
    onSuccess: () => {
      toast.success("Organization created");
      qc.invalidateQueries({ queryKey: ["orgs"] });
      setOpen(false); setName(""); setSlug(""); setSeed(true);
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const onImportFile = async (file: File) => {
    const t = toast.loading(`Importing ${file.name}…`);
    try {
      const res = await adminApi.importOrgs(file);
      const names = res.organizations.map((o) => o.name).join(", ");
      toast.success(`Imported ${res.imported} organization${res.imported === 1 ? "" : "s"}: ${names}`, { id: t });
      qc.invalidateQueries({ queryKey: ["orgs"] });
    } catch (e) {
      toast.error(apiError(e), { id: t });
    } finally {
      if (importRef.current) importRef.current.value = "";
    }
  };

  const onExportAll = async () => {
    const t = toast.loading("Building export…");
    try {
      const r = await adminApi.exportAllOrgs();
      const url = URL.createObjectURL(r.data as unknown as Blob);
      const a = document.createElement("a");
      a.href = url;
      const cd = (r.headers as any)["content-disposition"] || "";
      const m = /filename="?([^"]+)"?/.exec(cd);
      a.download = m?.[1] || `organizations-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success("Export downloaded", { id: t });
    } catch (e) {
      toast.error(apiError(e), { id: t });
    }
  };

  return (
    <>
      <PageHeader title="Organizations" description="Each client gets an isolated organization."
        actions={<>
          <input
            ref={importRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void onImportFile(f); }}
          />
          <button className="btn-secondary" onClick={() => importRef.current?.click()} title="Import organizations from a JSON export file">
            <Upload size={16} /> Import
          </button>
          <button className="btn-secondary" onClick={onExportAll} title="Download a JSON export of every organization">
            <Download size={16} /> Export all
          </button>
          <button className="btn-primary" onClick={() => setOpen(true)}><Plus size={16} /> New organization</button>
        </>} />

      {orgs.isLoading ? <Spinner /> :
        (orgs.data?.length === 0 ? (
          <EmptyState title="No organizations yet" description="Create your first client organization to get started."
            action={<button className="btn-primary" onClick={() => setOpen(true)}>Create organization</button>} />
        ) : (
          <div className="table-wrap">
            <table className="dt">
              <thead><tr><th>Name</th><th>Slug</th><th>Status</th><th>Created</th><th></th></tr></thead>
              <tbody>
                {orgs.data?.map((o) => (
                  <tr key={o.id}>
                    <td><Link className="font-medium text-slate-900 dark:text-slate-100 hover:text-brand-700 dark:hover:text-brand-300" to={`/admin/organizations/${o.id}`}>{o.name}</Link></td>
                    <td><code className="text-xs">{o.slug}</code></td>
                    <td>{o.is_active ? <span className="badge-green">active</span> : <span className="badge-gray">inactive</span>}</td>
                    <td className="text-slate-500 dark:text-slate-400">{formatDate(o.created_at)}</td>
                    <td className="text-right">
                      <a className="btn-ghost" href={`/${o.slug}`} target="_blank" rel="noreferrer"><ExternalLink size={14} /> Open portal</a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

      <Modal open={open} onClose={() => setOpen(false)} title="New organization">
        <div className="space-y-4">
          <div><label className="label">Organization name</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Corp" /></div>
          <div><label className="label">URL slug (optional)</label>
            <input className="input" value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="acme" />
            <p className="help">Will appear in the URL: <code>{window.location.origin}/{slug || "auto"}</code></p>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={seed} onChange={(e) => setSeed(e.target.checked)} />
            Seed with default IT Request Form template
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <button className="btn-secondary" onClick={() => setOpen(false)}>Cancel</button>
            <button className="btn-primary" disabled={!name || create.isPending} onClick={() => create.mutate()}>
              {create.isPending ? "Creating…" : "Create"}
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
