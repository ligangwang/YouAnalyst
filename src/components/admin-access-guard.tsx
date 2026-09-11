"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useAuth } from "@/components/providers/auth-provider";
import { useLocale } from "@/components/providers/locale-provider";

export function AdminAccessGuard({ children }: { children: ReactNode }) {
  const { user, loading, getIdToken } = useAuth();
  const { text } = useLocale();
  const [access, setAccess] = useState<{ user: typeof user; allowed: boolean } | null>(null);

  useEffect(() => {
    if (loading || !user) return;
    const controller = new AbortController();
    async function check() {
      let allowed = false;
      try {
        const token = await getIdToken();
        if (token) {
          const response = await fetch("/api/admin/me", {
            headers: { Authorization: `Bearer ${token}` },
            cache: "no-store",
            signal: controller.signal,
          });
          allowed = response.ok && (await response.json()).isAdmin === true;
        }
      } catch { /* Access stays closed if verification fails. */ }
      if (!controller.signal.aborted) setAccess({ user, allowed });
    }
    void check();
    return () => controller.abort();
  }, [user, loading, getIdToken]);

  if (loading || (user && access?.user !== user)) {
    return <p role="status" className="p-6 text-slate-400">{text("Checking admin access…", "正在验证管理员权限…")}</p>;
  }
  if (!user || !access?.allowed) {
    return <p role="alert" className="p-6 text-slate-400">{text("This page is available to administrators only.", "此页面仅限管理员访问。")}</p>;
  }
  return children;
}
