import { localizedMetadata } from "@/lib/i18n/server";
import type { Metadata } from "next";
import { AnalystProfilePage } from "@/components/analyst-profile-page";
import { getAdminFirestore } from "@/lib/firebase/admin";
import { noIndexRobots } from "@/lib/seo";

async function buildPageMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const db = getAdminFirestore();

  try {
    const snapshot = await db.collection("users").doc(id).get();
    if (!snapshot.exists) {
      return {
        title: "Analyst not found | YouAnalyst",
        robots: noIndexRobots(),
      };
    }

    const user = snapshot.data() as Record<string, unknown>;
    const settings = user.settings && typeof user.settings === "object"
      ? user.settings as Record<string, unknown>
      : null;
    if (settings?.isPublic === false) {
      return {
        title: "Analyst not found | YouAnalyst",
        robots: noIndexRobots(),
      };
    }

    const nickname = typeof user.nickname === "string" ? user.nickname.trim() : "";
    const displayName = typeof user.displayName === "string" ? user.displayName.trim() : "";
    const bio = typeof user.bio === "string" ? user.bio.trim() : "";
    const label = nickname ? `@${nickname}` : displayName || "Analyst";
    const title = `${label} | YouAnalyst`;
    const description = bio || `${label}'s public watchlists, stock predictions, and analyst track record on YouAnalyst.`;

    return {
      title,
      description,
      alternates: {
        canonical: `/analysts/${id}`,
      },
      openGraph: {
        title,
        description,
        url: `/analysts/${id}`,
      },
      twitter: {
        title,
        description,
      },
    };
  } catch {
    return {
      title: "Analyst | YouAnalyst",
      description: "Browse public analyst watchlists and track records on YouAnalyst.",
      alternates: {
        canonical: `/analysts/${id}`,
      },
    };
  }
}

export default async function AnalystRoutePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ onboarding?: string | string[] }>;
}) {
  const { id } = await params;
  const { onboarding } = await searchParams;
  const onboardingValue = Array.isArray(onboarding) ? onboarding[0] : onboarding;

  return <AnalystProfilePage userId={id} promptForNickname={onboardingValue === "nickname"} />;
}

export async function generateMetadata(...args: Parameters<typeof buildPageMetadata>) {
  return localizedMetadata(await buildPageMetadata(...args));
}
