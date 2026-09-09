// A standalone response avoids the tracked application layout altogether.
export function GET(request: Request) {
  const url = new URL(request.url);
  const publicHost = ["youanalyst.com", "www.youanalyst.com"].includes(url.hostname);
  const cookie = "youanalyst_analytics_opt_out=1; Path=/; Max-Age=34560000; SameSite=Lax"
    + (publicHost ? "; Domain=youanalyst.com; Secure" : url.protocol === "https:" ? "; Secure" : "");
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Analytics opt-out | YouAnalyst</title>
    <style>body{font:18px/1.6 system-ui;background:#020617;color:#e2e8f0;max-width:42rem;margin:10vh auto;padding:24px}a{color:#67e8f9}</style>
    </head><body><h1>Exclude this browser from Analytics</h1>
    <p>An opt-out cookie has been sent to this browser. With cookies enabled, your future YouAnalyst visits will be excluded from Google Analytics.</p>
    <p>Reload any other YouAnalyst tabs already open. Open this page in each browser and device you use for development or testing.</p>
    <p>The opt-out lasts up to 400 days. Revisit this page after clearing cookies or using a new private browsing session.</p>
    <p><a href="/">Return to YouAnalyst</a></p></body></html>`, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Set-Cookie": cookie,
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
