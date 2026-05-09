import type { Metadata } from "next";
import { AdminCusipGapsPage } from "@/components/admin-cusip-gaps-page";

export const metadata: Metadata = {
  title: "CUSIP Mapping Gaps | Admin | YouAnalyst",
  description: "Review unmapped CUSIP holdings from institutional 13F data.",
};

export default function AdminCusipGapsRoutePage() {
  return <AdminCusipGapsPage />;
}
