import type { Metadata } from "next";
import { AdminInsiderOpsPage } from "@/components/admin-insider-ops-page";
import { noIndexRobots } from "@/lib/seo";

export const metadata: Metadata = {
  title: "Insider Transactions | Admin | YouAnalyst",
  description: "Monitor SEC Form 4 insider transaction ingestion.",
  robots: noIndexRobots(),
};

export default function AdminInsiderOpsRoutePage() {
  return <AdminInsiderOpsPage />;
}
