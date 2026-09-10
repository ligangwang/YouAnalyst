import { localizedMetadata } from "@/lib/i18n/server";
import type { Metadata } from "next";
import { FeedbackPage } from "@/components/feedback-page";

const pageMetadata: Metadata = {
  title: "Feedback | YouAnalyst",
  description: "Share feature requests, bug reports, and suggestions for YouAnalyst.",
  alternates: {
    canonical: "/feedback",
  },
};
export async function generateMetadata(): Promise<Metadata> { return localizedMetadata(pageMetadata); }

export default function Page() {
  return <FeedbackPage />;
}
