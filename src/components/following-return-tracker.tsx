"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { trackFollowingVisit } from "@/lib/analytics";
export function FollowingReturnTracker() {
  const path = usePathname();
  useEffect(() => { trackFollowingVisit(); }, [path]);
  return null;
}
