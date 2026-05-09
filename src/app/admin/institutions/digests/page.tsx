import type { Metadata } from "next";
import { AdminInstitutionDigestsPage } from "@/components/admin-institution-digests-page";

export const metadata: Metadata = {
  title: "Institution Digests | Admin | YouAnalyst",
  description: "Generate and inspect in-app institution digest runs.",
};

export default function AdminInstitutionDigestsRoutePage() {
  return <AdminInstitutionDigestsPage />;
}
