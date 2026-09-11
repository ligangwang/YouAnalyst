import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { chromium } from "@playwright/test";

test("Firebase email signup, refresh, restoration and login use only the website origin", async () => {
  const bundle = await build({
    stdin: {
      contents: `import { getFirebaseServices } from './src/lib/firebase/client';
        import { createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut } from 'firebase/auth';
        const { auth } = getFirebaseServices();
        window.authTest = { auth, signup: () => createUserWithEmailAndPassword(auth, 'test@example.com', 'test-password'),
          login: () => signInWithEmailAndPassword(auth, 'test@example.com', 'test-password'), logout: () => signOut(auth) };`,
      resolveDir: process.cwd(),
    }, bundle: true, write: false, platform: "browser",
    define: {
      "process.env.NEXT_PUBLIC_FIREBASE_API_KEY": '"test-key"',
      "process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN": '"test.firebaseapp.com"',
      "process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID": '"test-project"',
      "process.env.NEXT_PUBLIC_FIREBASE_APP_ID": '"test-app"',
      "process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET": '""',
      "process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID": '""',
    },
  });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const requests: string[] = [];
    const token = `e30.${Buffer.from(JSON.stringify({ sub: "test-user", iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url")}.test`;
    await page.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      requests.push(url.href);
      if (url.origin !== "http://youanalyst.test") return route.abort();
      if (url.pathname === "/") return route.fulfill({ contentType: "text/html", body: "<html><body></body></html>" });
      let body: object;
      if (url.pathname.endsWith("accounts:lookup")) {
        body = { users: [{ localId: "test-user", email: "test@example.com", emailVerified: false, providerUserInfo: [{ providerId: "password", email: "test@example.com" }] }] };
      } else if (url.pathname.endsWith("/token")) {
        body = { access_token: token, id_token: token, refresh_token: "test-refresh", expires_in: "3600", user_id: "test-user" };
      } else {
        body = { localId: "test-user", email: "test@example.com", idToken: token, refreshToken: "test-refresh", expiresIn: "3600" };
      }
      return route.fulfill({ json: body });
    });
    await page.goto("http://youanalyst.test/");
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.evaluate("window.authTest.signup()");
    await page.evaluate("window.authTest.auth.currentUser.getIdToken(true)");
    await page.reload();
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    assert.equal(await page.evaluate("window.authTest.auth.authStateReady().then(() => window.authTest.auth.currentUser?.uid)"), "test-user");
    await page.evaluate("window.authTest.logout()");
    await page.evaluate("window.authTest.login()");
    assert.ok(requests.every((url) => new URL(url).origin === "http://youanalyst.test"), requests.join("\n"));
    for (const endpoint of ["identity/v1/accounts:signUp", "identity/v1/accounts:signInWithPassword", "identity/v1/accounts:lookup", "token/v1/token"]) {
      assert.ok(requests.some((url) => url.includes(`/api/firebase-auth/${endpoint}?`)), endpoint);
    }
  } finally {
    await browser.close();
  }
});
