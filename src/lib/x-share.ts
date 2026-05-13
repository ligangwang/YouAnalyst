const X_POST_INTENT_URL = "https://x.com/intent/post";
const DEFAULT_SHARE_ORIGIN = "https://youanalyst.com";

function shareOrigin(): string {
  if (typeof window !== "undefined") {
    return window.location.origin;
  }

  return process.env.NEXT_PUBLIC_SITE_URL ?? DEFAULT_SHARE_ORIGIN;
}

export function xTrackedShareUrl({
  campaign,
  share,
  url,
}: {
  campaign: string;
  share?: string;
  url: string;
}): string {
  const trackedUrl = new URL(url, shareOrigin());
  trackedUrl.searchParams.set("utm_source", "x");
  trackedUrl.searchParams.set("utm_medium", "social");
  trackedUrl.searchParams.set("utm_campaign", campaign);

  if (share) {
    trackedUrl.searchParams.set("share", share);
  }

  return trackedUrl.toString();
}

export function xPostIntentUrl({
  text,
  url,
}: {
  text: string;
  url: string;
}): string {
  const params = new URLSearchParams({
    text: text.trim(),
    url,
  });

  return `${X_POST_INTENT_URL}?${params.toString()}`;
}
