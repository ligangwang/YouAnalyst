import { localizedMetadata } from "@/lib/i18n/server";
import type { Metadata } from "next";
import { AdminFeedbackPage } from "@/components/admin-feedback-page";
import { noIndexRobots } from "@/lib/seo";

const pageMetadata: Metadata = {
  title: "Feedback | Admin | YouAnalyst",
  description: "Review feedback submissions in the admin dashboard.",
  robots: noIndexRobots(),
};
export async function generateMetadata(): Promise<Metadata> { return localizedMetadata(pageMetadata); }

export default function AdminFeedbackRoutePage() {
  return <AdminFeedbackPage />;
}
