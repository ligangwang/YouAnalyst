/** Load shared SDK code before Next announces readiness, not during a visitor's
 * first page render, and seed background cache context before any request. No Firebase app/client,
 * credentials, queries, listeners, snapshots, or company data are initialized.
 * Keep route entry preloading disabled; unrelated pages remain demand-loaded. */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const {startCacheMemoryTelemetry}=await import('./lib/local-cache/background-scope');
    if (process.env.NODE_ENV === 'production') {
      startCacheMemoryTelemetry();
      await import('firebase-admin/firestore');
    }
  }
}
