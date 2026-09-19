const headers = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow",
  "X-Content-Type-Options": "nosniff",
};

// Firebase validates and consumes the code. This route never logs it or runs analytics.
export function emailActionResponse(request: Request, projectId?: string, apiKey?: string) {
  const incoming = new URL(request.url);
  const mode = incoming.searchParams.get("mode");
  const code = incoming.searchParams.get("oobCode");
  if (!mode || !code) {
    return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Email action | YouAnalyst</title><body><main><h1>Open the full link from your email</h1><p>This address handles email verification and password resets. Use the complete link in your latest YouAnalyst email.</p><p lang="zh-CN">此页面用于邮箱验证和密码重置。请打开最新一封 YouAnalyst 邮件中的完整链接。</p><a href="/auth">Sign in / 登录</a></main></body></html>`, {
      status: 400, headers: { ...headers, "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": "default-src 'none'; base-uri 'none'; frame-ancestors 'none'" },
    });
  }
  if (!projectId || !/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(projectId) || !apiKey) {
    return new Response("Email actions are temporarily unavailable. 邮件验证服务暂时不可用。", { status: 503, headers });
  }
  // Derive the destination from deployment config, never from an incoming URL/key.
  const destination = new URL(`https://${projectId}.firebaseapp.com/__/auth/action`);
  destination.searchParams.set("apiKey", apiKey);
  destination.searchParams.set("mode", mode);
  destination.searchParams.set("oobCode", code);
  for (const key of ["lang", "tenantId"]) {
    const value = incoming.searchParams.get(key);
    if (value) destination.searchParams.set(key, value);
  }
  const continuation = incoming.searchParams.get("continueUrl");
  if (continuation) {
    try {
      const url = new URL(continuation);
      if (url.protocol === "https:" && url.hostname === "youanalyst.com" && !url.port && !url.username && !url.password) {
        destination.searchParams.set("continueUrl", url.href);
      }
    } catch { /* Invalid continuation must not prevent code validation. */ }
  }
  return new Response(null, { status: 307, headers: { ...headers, Location: destination.href } });
}
