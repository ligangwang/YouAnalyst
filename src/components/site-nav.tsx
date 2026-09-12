"use client";

import { UiText, useUiText } from "@/components/ui-text";

import { LanguageSwitch, useLocale } from "@/components/providers/locale-provider";
import Image from "next/image";
import { MarketSwitch, PreferenceError } from "./display-preferences";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/components/providers/auth-provider";

const navigationChinese: Record<string, string> = {"Feed":"动态","Explore":"探索","Calls":"投资观点","Watchlists":"自选股","Institutions":"机构","Daily":"每日精选","Admin":"管理","Search companies":"搜索公司","Sign in":"登录","My profile":"我的主页","Sign out":"退出登录","More":"更多","Top Calls":"热门观点","Institutional Moves":"机构动向","Insider Transactions":"内部人交易","Search":"搜索","Explore company map":"公司关系图","Make a prediction":"发布观点","How it works":"使用指南","AI supply chain":"AI 产业链"};
function useNavText() { const { chinese } = useLocale(); return (value: string) => chinese ? navigationChinese[value] ?? value : value; }

function initials(name: string | null | undefined, email: string | null | undefined): string {
  const source = (name || email || "U").trim();
  if (!source) return "U";
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
}

function AvatarButton({ photoURL, displayName, email }: { photoURL: string | null; displayName: string | null; email: string | null }) {
  if (photoURL) {
    return (
      <Image
        src={photoURL}
        alt={displayName ?? email ?? "User avatar"}
        width={36}
        height={36}
        className="h-9 w-9 rounded-full object-cover ring-1 ring-cyan-400/40"
        referrerPolicy="no-referrer"
      />
    );
  }
  return (
    <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-cyan-600/25 text-sm font-semibold text-cyan-100 ring-1 ring-cyan-400/40">
      {initials(displayName, email)}
    </span>
  );
}

function UserMenu({ profileHref, onSignOut }: { profileHref: string; onSignOut: () => void }) {
  const ui = useUiText();
  const t = useNavText();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const { user } = useAuth();

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div ref={menuRef} className="relative" onKeyDown={event => { if (event.key === "Escape") { setOpen(false); menuRef.current?.querySelector("button")?.focus(); } }}>
      <button
        type="button"
        aria-label={ui("User menu")}
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        className="shrink-0 rounded-full focus:outline-none focus:ring-2 focus:ring-cyan-400/60"
      >
        <AvatarButton
          photoURL={user?.photoURL ?? null}
          displayName={user?.displayName ?? null}
          email={user?.email ?? null}
        />
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-48 rounded-2xl border border-white/10 bg-slate-900 py-1 shadow-xl">
          <div className="border-b border-white/10 px-4 py-2">
            <p className="truncate text-sm font-medium text-cyan-100">{user?.displayName ?? user?.email ?? <UiText text={"Account"} />}</p>
          </div>
          <Link
            href={profileHref}
            onClick={() => setOpen(false)}
            className="flex w-full items-center px-4 py-2 text-sm text-slate-200 hover:bg-white/5"
          >{t("My profile")}</Link>
          <button
            type="button"
            onClick={() => { setOpen(false); onSignOut(); }}
            className="flex w-full items-center px-4 py-2 text-sm text-rose-300 hover:bg-white/5"
          >{t("Sign out")}</button>
        </div>
      )}
    </div>
  );
}

function InstitutionNavLabel({ unreadCount }: { unreadCount: number }) {
  const t = useNavText();
  return (
    <span className="inline-flex items-center gap-1.5">
      {t("Institutions")}
      {unreadCount > 0 ? (
        <span className="rounded-full bg-cyan-400 px-1.5 py-0.5 text-[10px] font-bold leading-none text-slate-950">
          {unreadCount > 9 ? "9+" : unreadCount}
        </span>
      ) : null}
    </span>
  );
}

const dailyNavItems = [
  { href: "/daily/calls", label: "Top Calls" },
  { href: "/daily/institutional", label: "Institutional Moves" },
  { href: "/daily/insiders", label: "Insider Transactions" },
];

function DailyNavMenu() {
  const t = useNavText();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div ref={menuRef} className="relative" onKeyDown={event => { if (event.key === "Escape") { setOpen(false); menuRef.current?.querySelector("button")?.focus(); } }}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls="daily-navigation-links"
        onClick={() => setOpen((prev) => !prev)}
        className="hover:text-cyan-200"
      >{t("Daily")}</button>
      {open ? (
        <div id="daily-navigation-links" className="absolute left-0 z-50 mt-2 w-56 rounded-xl border border-white/10 bg-slate-950 py-1 shadow-xl">
          {dailyNavItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setOpen(false)}
              className="block px-4 py-2 text-sm text-slate-200 hover:bg-white/5 hover:text-cyan-100"
            >
              {t(item.label)}
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function SiteNav() {
  const ui = useUiText();
  const t = useNavText();
  const pathname = usePathname();
  const { user, loading, signOut, getIdToken } = useAuth();
  const [adminStatus, setAdminStatus] = useState<{ userId: string; isAdmin: boolean } | null>(null);
  const [institutionDigestStatus, setInstitutionDigestStatus] = useState<{ userId: string; unread: number } | null>(null);
  const profileHref = useMemo(() => (user ? `/analysts/${user.uid}` : "/auth"), [user]);
  const showAdminLink = Boolean(user && adminStatus?.userId === user.uid && adminStatus.isAdmin);
  const unreadDigestCount = user && institutionDigestStatus?.userId === user.uid ? institutionDigestStatus.unread : 0;

  useEffect(() => {
    if (loading || !user) {
      return;
    }

    let cancelled = false;
    const userId = user.uid;

    async function loadAdminStatus() {
      try {
        const token = await getIdToken(true);

        if (!token) {
          if (!cancelled) {
            setAdminStatus({ userId, isAdmin: false });
          }
          return;
        }

        const response = await fetch("/api/admin/me", {
          headers: {
            authorization: `Bearer ${token}`,
          },
        });
        const payload = (await response.json().catch(() => ({}))) as { isAdmin?: boolean };
        const isAdmin = response.ok && payload.isAdmin === true;

        if (!cancelled) {
          setAdminStatus({ userId, isAdmin });
        }
      } catch {
        if (!cancelled) {
          setAdminStatus({ userId, isAdmin: false });
        }
      }
    }

    void loadAdminStatus();

    return () => {
      cancelled = true;
    };
  }, [getIdToken, loading, user]);

  useEffect(() => {
    if (loading || !user) {
      return;
    }

    let cancelled = false;
    const userId = user.uid;

    async function loadDigestStatus() {
      try {
        const token = await getIdToken();

        if (!token) {
          if (!cancelled) {
            setInstitutionDigestStatus({ userId, unread: 0 });
          }
          return;
        }

        const response = await fetch("/api/institutions/follows/digest/runs?limit=10", {
          headers: {
            authorization: `Bearer ${token}`,
          },
        });
        const payload = (await response.json().catch(() => ({}))) as {
          items?: Array<{ dryRun?: boolean; readAt?: string | null }>;
          unreadCount?: number;
        };
        const unread = response.ok
          ? Number(payload.unreadCount ?? 0)
          : 0;

        if (!cancelled) {
          setInstitutionDigestStatus({ userId, unread });
        }
      } catch {
        if (!cancelled) {
          setInstitutionDigestStatus({ userId, unread: 0 });
        }
      }
    }

    void loadDigestStatus();

    return () => {
      cancelled = true;
    };
  }, [getIdToken, loading, user]);

  return (
    <header className="sticky top-0 z-30 border-b border-white/10 bg-slate-950/85 backdrop-blur">
      <div className="mx-auto w-full max-w-6xl px-4 py-3">
        <div className="flex items-center justify-between gap-1 sm:gap-3">
          <div className="flex items-center gap-5">
            <Link href="/" className="inline-flex shrink-0 items-center">
              <Image
                src="/youanalyst-logo-mobile.svg"
                alt="YouAnalyst"
                width={200}
                height={44}
                priority
                className="h-7 w-auto max-w-[80px] min-[375px]:max-w-[110px] sm:max-w-[150px] lg:hidden"
              />
              <Image
                src="/youanalyst-logo.svg"
                alt="YouAnalyst"
                width={156}
                height={40}
                priority
                className="hidden h-10 w-auto lg:block"
              />
            </Link>
            <nav className="hidden items-center gap-4 text-[15px] text-slate-200 lg:flex">
              <Link href="/" aria-current={pathname === "/" || pathname === "/map" ? "page" : undefined} className="hover:text-cyan-200">{t("Explore")}</Link>
              <Link href="/feed" aria-current={pathname === "/feed" ? "page" : undefined} className="hover:text-cyan-200">{t("Feed")}</Link>
              <Link href="/predictions" aria-current={pathname.startsWith("/predictions") ? "page" : undefined} className="hover:text-cyan-200">{t("Calls")}</Link>
              <Link href="/watchlists" className="hover:text-cyan-200">{t("Watchlists")}</Link>
              <Link href="/institutions" className="hover:text-cyan-200"><InstitutionNavLabel unreadCount={unreadDigestCount} /></Link>
              <DailyNavMenu />
              {showAdminLink ? <Link href="/admin" className="hover:text-cyan-200">{t("Admin")}</Link> : null}
            </nav>
          </div>

          <div className="flex items-center gap-1 sm:gap-3">
            <MarketSwitch />
            <LanguageSwitch />
            <Link
              href="/companies"
              className="hidden rounded-lg bg-cyan-500 px-3 py-1.5 text-sm font-semibold text-slate-950 hover:bg-cyan-400 lg:inline-flex"
            >{t("Search companies")}</Link>
            {loading ? (
              <span className="h-9 w-9 animate-pulse rounded-full bg-slate-700" />
            ) : user ? (
              <UserMenu profileHref={profileHref} onSignOut={() => void signOut()} />
            ) : (
              <Link
                href="/auth"
                className="shrink-0 whitespace-nowrap rounded-full border border-cyan-400/35 px-2 sm:px-3 py-1.5 text-xs sm:text-sm text-cyan-100 hover:bg-cyan-500/15"
              >{t("Sign in")}</Link>
            )}
          </div>
        </div>

        <nav aria-label={ui("Mobile navigation")} className="mt-2 flex items-center gap-1 text-sm text-slate-200 lg:hidden">
          {[{ href: "/", label: "Explore" }, { href: "/feed", label: "Feed" }, { href: "/companies", label: "Search" }, { href: "/watchlists", label: "Watchlists" }].map(item =>
            <Link key={item.href} href={item.href} aria-current={pathname === item.href ? "page" : undefined} className="rounded-lg px-3 py-3">{t(item.label)}</Link>)}
          <details className="relative ml-auto" onKeyDown={event => { if (event.key === "Escape") { event.currentTarget.open = false; event.currentTarget.querySelector("summary")?.focus(); } }}>
            <summary className="cursor-pointer rounded-lg px-3 py-3">{t("More")}</summary>
            <div className="absolute right-0 z-50 mt-2 grid w-56 rounded-xl border border-white/15 bg-slate-950 p-2 shadow-xl"
              onClick={event => { if ((event.target as HTMLElement).closest("a")) event.currentTarget.closest("details")?.removeAttribute("open"); }}>
              {[{ href: "/map", label: "Explore company map" }, { href: "/map?market=CN_A", label: "AI supply chain" }, { href: "/predictions", label: "Calls" }, { href: "/predictions/new", label: "Make a prediction" },
                { href: "/institutions", label: "Institutions" }, ...dailyNavItems, { href: "/how-it-works", label: "How it works" },
                ...(showAdminLink ? [{ href: "/admin", label: "Admin" }] : [])].map(item =>
                <Link key={item.href} href={item.href} aria-current={pathname === item.href ? "page" : undefined} className="rounded-lg px-3 py-3 hover:bg-white/10">{t(item.label)}</Link>)}
            </div>
          </details>
        </nav>
      </div>
      <PreferenceError />
    </header>
  );
}
