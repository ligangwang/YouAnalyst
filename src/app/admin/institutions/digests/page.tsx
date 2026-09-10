import { localizedMetadata } from "@/lib/i18n/server";
import type { Metadata } from "next";
import { AdminInstitutionDigestsPage } from "@/components/admin-institution-digests-page";

const pageMetadata: Metadata = {
  title: "Institution Digests | Admin | YouAnalyst",
  description: "Generate and inspect in-app institution digest runs.",
};
export async function generateMetadata(): Promise<Metadata> { return localizedMetadata(pageMetadata); }

export default function AdminInstitutionDigestsRoutePage() {
  return <AdminInstitutionDigestsPage />;
}
