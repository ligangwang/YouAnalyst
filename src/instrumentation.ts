export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.NODE_ENV === 'production' && process.env.K_REVISION) {
    try {
      const {startStartupProfile}=await import('./lib/ui/startup-profile');
      await startStartupProfile();
    } catch { /* Diagnostics must not prevent server readiness. */ }
  }
}
