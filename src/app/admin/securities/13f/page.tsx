import type { Metadata } from "next";
import { AdminThirteenFOpsPage } from "@/components/admin-thirteen-f-ops-page";

export const metadata: Metadata = {
  title: "13F Operations | Admin | YouAnalyst",
  description: "Monitor SEC 13F discovery, queue processing, and backfills.",
};

export default function AdminThirteenFOpsRoutePage() {
  return <AdminThirteenFOpsPage />;
}
