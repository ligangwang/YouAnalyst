const X_POST_INTENT_URL = "https://x.com/intent/post";

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
