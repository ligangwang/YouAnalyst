/** Load shared SDK code before Next announces readiness, not during a visitor's
 * first page render. This imports definitions only: no Firebase app/client,
 * credentials, queries, listeners, snapshots, or company data are initialized.
 * Keep route entry preloading disabled; unrelated pages remain demand-loaded. */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.NODE_ENV === 'production') {
    await import('firebase-admin/firestore');
  }
}
