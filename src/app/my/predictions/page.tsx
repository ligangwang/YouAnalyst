"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/providers/auth-provider";
import { useLocale } from "@/components/providers/locale-provider";
import { localizedPath } from "@/lib/ui/i18n/urls";

// Older bookmarks now open the views embedded in the account profile.
export default function Page() {
  const { user, loading } = useAuth();
  const { locale, text } = useLocale();
  const router = useRouter();
  useEffect(() => {
    if (loading) return;
    router.replace(user
      ? localizedPath(`/analysts/${encodeURIComponent(user.uid)}#profile-views`, locale)
      : `/auth?${new URLSearchParams({ next: localizedPath("/my/predictions", locale) })}`);
  }, [user, loading, locale, router]);
  return <p role="status">{text("Loading profile…", "正在加载个人主页…")}</p>;
}
