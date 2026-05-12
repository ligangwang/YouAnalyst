"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/components/providers/auth-provider";

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
    <div ref={menuRef} className="relative">
      <button
        type="button"
        aria-label="User menu"
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
            <p className="truncate text-sm font-medium text-cyan-100">{user?.displayName ?? user?.email ?? "Account"}</p>
          </div>
          <Link
            href={profileHref}
            onClick={() => setOpen(false)}
            className="flex w-full items-center px-4 py-2 text-sm text-slate-200 hover:bg-white/5"
          >
            My profile
          </Link>
          <button
            type="button"
            onClick={() => { setOpen(false); onSignOut(); }}
            className="flex w-full items-center px-4 py-2 text-sm text-rose-300 hover:bg-white/5"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

function InstitutionNavLabel({ unreadCount }: { unreadCount: number }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      Institutions
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
    <div ref={menuRef} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((prev) => !prev)}
        className="hover:text-cyan-200"
      >
        Daily
      </button>
      {open ? (
        <div className="absolute left-0 z-50 mt-2 w-56 rounded-xl border border-white/10 bg-slate-950 py-1 shadow-xl">
          {dailyNavItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setOpen(false)}
              className="block px-4 py-2 text-sm text-slate-200 hover:bg-white/5 hover:text-cyan-100"
            >
              {item.label}
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function SiteNav() {
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
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-5">
            <Link href="/" className="inline-flex shrink-0 items-center">
              <Image
                src="/youanalyst-logo-mobile.svg"
                alt="YouAnalyst"
                width={140}
                height={32}
                priority
                className="h-9 w-auto md:hidden"
              />
              <Image
                src="/youanalyst-logo.svg"
                alt="YouAnalyst"
                width={140}
                height={32}
                priority
                className="hidden h-10 w-auto md:block"
              />
            </Link>
            <nav className="hidden items-center gap-4 text-[15px] text-slate-200 md:flex">
              <Link href="/predictions" className="hover:text-cyan-200">Feed</Link>
              <Link href="/watchlists" className="hover:text-cyan-200">Watchlists</Link>
              <Link href="/institutions" className="hover:text-cyan-200"><InstitutionNavLabel unreadCount={unreadDigestCount} /></Link>
              <DailyNavMenu />
              <Link href="/leaderboard" className="hover:text-cyan-200">Leaderboard</Link>
              {showAdminLink ? <Link href="/admin" className="hover:text-cyan-200">Admin</Link> : null}
              <Link href="/how-it-works" className="hover:text-cyan-200">How It Works</Link>
            </nav>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <Link
              href="/predictions/new"
              className="hidden rounded-lg bg-cyan-500 px-3 py-1.5 text-sm font-semibold text-slate-950 hover:bg-cyan-400 md:inline-flex"
            >
              Predict
            </Link>
            {loading ? (
              <span className="h-9 w-9 animate-pulse rounded-full bg-slate-700" />
            ) : user ? (
              <UserMenu profileHref={profileHref} onSignOut={() => void signOut()} />
            ) : (
              <Link
                href="/auth"
                className="rounded-full border border-cyan-400/35 px-3 py-1.5 text-sm text-cyan-100 hover:bg-cyan-500/15"
              >
                Sign in
              </Link>
            )}
          </div>
        </div>

        <nav className="mt-3 flex gap-2 overflow-x-auto pb-1 text-[15px] text-slate-200 md:hidden">
          <Link href="/predictions/new" className="shrink-0 rounded-full bg-cyan-500 px-3 py-1.5 font-semibold text-slate-950 hover:bg-cyan-400">
            Predict
          </Link>
          <Link href="/predictions" className="shrink-0 rounded-full border border-white/10 px-3 py-1.5 hover:border-cyan-300/60 hover:text-cyan-200">
            Feed
          </Link>
          <Link href="/watchlists" className="shrink-0 rounded-full border border-white/10 px-3 py-1.5 hover:border-cyan-300/60 hover:text-cyan-200">
            Watchlists
          </Link>
          <Link href="/institutions" className="shrink-0 rounded-full border border-white/10 px-3 py-1.5 hover:border-cyan-300/60 hover:text-cyan-200">
            <InstitutionNavLabel unreadCount={unreadDigestCount} />
          </Link>
          {dailyNavItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="shrink-0 rounded-full border border-white/10 px-3 py-1.5 hover:border-cyan-300/60 hover:text-cyan-200"
            >
              {item.label}
            </Link>
          ))}
          <Link href="/leaderboard" className="shrink-0 rounded-full border border-white/10 px-3 py-1.5 hover:border-cyan-300/60 hover:text-cyan-200">
            Leaderboard
          </Link>
          {showAdminLink ? (
            <Link href="/admin" className="shrink-0 rounded-full border border-white/10 px-3 py-1.5 hover:border-cyan-300/60 hover:text-cyan-200">
              Admin
            </Link>
          ) : null}
          <Link href="/how-it-works" className="shrink-0 rounded-full border border-white/10 px-3 py-1.5 hover:border-cyan-300/60 hover:text-cyan-200">
            How It Works
          </Link>
        </nav>
      </div>
    </header>
  );
}
