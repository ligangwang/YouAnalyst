import {AsyncLocalStorage} from 'node:async_hooks';

const scopes = new AsyncLocalStorage<Map<string, Promise<unknown>>>();

/** Share completed setup across pages of one delivery, never across jobs.
 * A retry starts fresh, so failed persistence and corrections remain recoverable.
 */
export function withEodWorkScope<T>(work: () => Promise<T>): Promise<T> {
  return scopes.getStore() ? work() : scopes.run(new Map(), work);
}

export async function eodWorkOnce<T>(key: string, work: () => Promise<T>, complete: (value: T) => boolean = () => true): Promise<T> {
  const scope = scopes.getStore();
  if (!scope) return work();
  const existing = scope.get(key);
  if (existing) return existing as Promise<T>;
  const pending = Promise.resolve().then(work);
  scope.set(key, pending);
  try {
    const value = await pending;
    if (!complete(value)) scope.delete(key);
    return value;
  } catch (error) {
    scope.delete(key);
    throw error;
  }
}

/** Local writes can make an earlier input snapshot obsolete within this delivery. */
export function forgetEodWork(prefix:string) {
  const scope=scopes.getStore();
  if(scope)for(const key of scope.keys())if(key.startsWith(prefix))scope.delete(key);
}
