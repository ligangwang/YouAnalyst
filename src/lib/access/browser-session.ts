// Serialize refresh/sign-out so a late refresh cannot restore a signed-out cookie.
let pending: Promise<void> = Promise.resolve();
export function syncMemberSession(token: string | null): Promise<void> {
  pending = pending.catch(() => {}).then(async () => {
    const response = await fetch('/api/auth/session', {method:token ? 'POST' : 'DELETE', credentials:'same-origin', headers:token ? {Authorization:`Bearer ${token}`} : undefined});
    if (!response.ok) throw new Error('Unable to sync sign-in. Please try again.');
  });
  return pending;
}
