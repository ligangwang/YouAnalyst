"use client";

import { useEffect, useState } from "react";
import { useOptionalAuth } from "./providers/auth-provider";
import { useLocale } from "./providers/locale-provider";
import type { GraphNode } from "@/lib/knowledge-graph/model";

export function CompanyNameEditor({ company, onSaved }: { company: GraphNode; onSaved: (company: Pick<GraphNode, "id" | "names" | "aliases">) => void }) {
  const auth = useOptionalAuth();
  const uid = auth?.user?.uid;
  const getIdToken = auth?.getIdToken;
  const { locale, text } = useLocale();
  const language = locale === "zh-CN" ? "zh-CN" : "en";
  const [adminId, setAdminId] = useState("");
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(company.names?.[language] ?? company.name ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (!uid || !getIdToken) return;
    let active = true;
    void getIdToken().then(async token => {
      if (!token) return;
      const response = await fetch("/api/admin/me", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      if (response.ok && (await response.json()).isAdmin === true && active) setAdminId(uid);
    }).catch(() => {});
    return () => { active = false; };
  }, [uid, getIdToken]);
  if (!uid || adminId !== uid) return null;
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true); setMessage("");
    try {
      const token = await getIdToken?.();
      if (!token) throw new Error();
      const response = await fetch("/api/admin/company-names", {
        method: "PATCH", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ companyId: company.id, locale: language, name, expectedName: company.names?.[language] ?? "" }),
      });
      if (response.status === 409) { setMessage(text("This name changed. Reload the page before editing.", "名称已被修改，请刷新页面后再编辑。")); return; }
      if (!response.ok) throw new Error();
      const updated = await response.json();
      onSaved({ id: company.id, names: updated.names, aliases: updated.aliases });
      setEditing(false); setMessage(text("Display name saved.", "显示名已保存。"));
    } catch { setMessage(text("Could not save. Check your connection and admin access.", "保存失败，请检查网络和管理员权限。")); }
    finally { setBusy(false); }
  }
  return <div className="my-3 text-sm">
    {editing ? <form onSubmit={save} className="flex flex-col gap-2">
      <label>{text("English display name", "中文显示名")}<input className="mt-1 w-full rounded border border-slate-600 bg-slate-900 p-2 text-white" value={name} maxLength={120} required disabled={busy} onChange={event => setName(event.target.value)} /></label>
      <div className="flex gap-3"><button type="submit" className="text-cyan-300" disabled={busy || !name.trim()}>{busy ? text("Saving…", "保存中…") : text("Save", "保存")}</button><button type="button" disabled={busy} onClick={() => setEditing(false)}>{text("Cancel", "取消")}</button></div>
    </form> : <button className="text-cyan-300" type="button" onClick={() => { setName(company.names?.[language] ?? company.name ?? ""); setMessage(""); setEditing(true); }}>{text("Edit display name", "修改显示名")}</button>}
    {message && <p role="status">{message}</p>}
  </div>;
}
