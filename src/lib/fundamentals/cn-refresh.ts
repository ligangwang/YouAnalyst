import type { DocumentData, Firestore } from "firebase-admin/firestore";
import { maintenanceError, type MaintenanceLog } from "../maintenance-log";
import { FUNDAMENTALS_COLLECTION } from "./service";
import { calculateCnMarketCap, combineShareCount, shanghaiDate, shareRefreshDue, sourceFailed, daysBetween, CN_ACTION_CHECK_MAX_AGE_DAYS,
  type CnActionCheck, type CnMarketCap, type CnShareCount } from "./cn-market-cap";
import { CnSourceError, type CnSources } from "./cn-sources";
import { createFxReader, readLatestCnPrices } from "./cn-prices";

// A-share documents share company_fundamentals with US tickers but are keyed by
// full ID (XSHG:600584) and use cn* fields, so the SEC worker never selects them.
export const CN_WORKER_DOC = "_cn_worker";
const HOUR = 3_600_000;
const COMPANY_LEASE_MS = 120_000;
const RETRY_MS = 6 * HOUR;
const PROVIDER_COOLDOWN_MS = 6 * HOUR;
type Stored = DocumentData & { cnShares?: CnShareCount | null; cnActions?: CnActionCheck | null; cnOrgId?: string | null };
export type CnRunOptions = { db: Firestore; log: MaintenanceLog; sources: CnSources; companies: string[]; deadline: number; dryRun?: boolean;
  now?: () => Date; print?: (line: string) => void; blockedHosts?: () => Record<string, string> };

const blockedCode = (error: unknown) => error instanceof CnSourceError && (error.code === 403 || error.code === 429);

// Per-company lease on the company's own document (never on dry runs).
async function acquireCompany(db: Firestore, id: string, owner: string, now: number) {
  const ref = db.collection(FUNDAMENTALS_COLLECTION).doc(id);
  return db.runTransaction(async tx => {
    const data = (await tx.get(ref)).data();
    if (Number(data?.cnLeaseUntil) > now && data?.cnLeaseOwner !== owner) return false;
    tx.set(ref, { market: "CN_A", cnLeaseOwner: owner, cnLeaseUntil: now + COMPANY_LEASE_MS }, { merge: true });
    return true;
  });
}

export async function refreshCnFundamentals(options: CnRunOptions) {
  const { db, log, sources, companies, dryRun = false } = options;
  const clock = options.now ?? (() => new Date());
  const print = options.print ?? console.log;
  const collection = db.collection(FUNDAMENTALS_COLLECTION);
  const worker = collection.doc(CN_WORKER_DOC);
  const cooldowns: Record<string, number> = { ...(await worker.get()).data()?.providerRetryAfter };
  const result = {
    companies: companies.length,
    actions: { checked: 0, events: 0, failed: 0, skipped: 0 },
    shares: { refreshed: 0, fresh: 0, unavailable: 0, failed: 0, deferred: 0, skipped: 0 },
    marketCaps: { processed: 0, estimated: 0, unavailable: 0, failed: 0, lastClose: 0, missingUsd: 0 },
    failed: 0, sourcesIncomplete: false, blockedHosts: {} as Record<string, string>,
  };
  const docs = new Map<string, Stored>();
  for (let i = 0; i < companies.length; i += 100) {
    const page = await db.getAll(...companies.slice(i, i + 100).map(id => collection.doc(id)));
    page.forEach(doc => docs.set(doc.id, doc.data() ?? {}));
  }
  const cooling = (host: string) => Number(cooldowns[host.replaceAll(".", "_")] ?? 0) > clock().getTime();
  const coolDown = async (host: string) => {
    cooldowns[host.replaceAll(".", "_")] = clock().getTime() + PROVIDER_COOLDOWN_MS;
    log.emit("WARNING", "provider_cooldown", { host, retryAfter: new Date(clock().getTime() + PROVIDER_COOLDOWN_MS).toISOString() });
    if (!dryRun) await worker.set({ providerRetryAfter: cooldowns }, { merge: true });
  };

  log.stage("sources", { companies: companies.length, dryRun });
  for (const id of companies) {
    // Leave time for valuations; remaining companies keep their stored data.
    if (Date.now() >= options.deadline - 60_000) { result.sourcesIncomplete = true; log.emit("WARNING", "deadline_reached", { company: id }); break; }
    const now = clock();
    const today = shanghaiDate(now);
    const stored = docs.get(id) ?? {};
    if (!dryRun && !await acquireCompany(db, id, log.runId, now.getTime())) {
      log.emit("WARNING", "company_leased", { company: id });
      result.shares.skipped++; result.actions.skipped++;
      continue;
    }
    const update: Record<string, unknown> = { market: "CN_A" };
    const next: Stored = { ...stored };
    try {
      // 1. Corporate actions: every run, so a new announcement blocks the next valuation.
      if (cooling("www.cninfo.com.cn")) result.actions.skipped++;
      else try {
        let orgId = stored.cnOrgId ?? null;
        if (!orgId) { orgId = await sources.orgId(id); update.cnOrgId = orgId; }
        if (!orgId) throw Object.assign(new Error("cninfo organisation ID not found"), { code: "MISSING_ORG_ID" });
        const check = await sources.actions(id, orgId, today, now);
        if (sourceFailed(check)) throw Object.assign(new Error(check.reason), { code: check.reason });
        next.cnActions = update.cnActions = check;
        update.cnActionStatus = { outcome: "ready", lastError: null, checkedAt: now.toISOString() };
        result.actions.checked++; result.actions.events += check.events.length;
        log.emit("INFO", "corporate_actions_checked", { company: id, events: check.events });
      } catch (error) {
        result.actions.failed++;
        const details = maintenanceError(error);
        // Keep the last successful check; the market-cap guard expires it after three days.
        update.cnActionStatus = { outcome: "retry", lastError: { code: details.code, message: details.message }, attemptedAt: now.toISOString() };
        log.emit("ERROR", "corporate_actions_failed", { company: id, error: details });
        if (blockedCode(error)) await coolDown((error as CnSourceError).host);
      }

      // 2. Share counts: only when missing, older than seven days, or re-verification is due.
      const due = shareRefreshDue(stored.cnShares ?? null, next.cnActions ?? null, today);
      const retryAfter = Number(stored.cnShareStatus?.retryAfter ?? 0);
      if (!due) result.shares.fresh++;
      else if (retryAfter > now.getTime()) { result.shares.deferred++; log.emit("INFO", "share_refresh_deferred", { company: id, retryAfter: new Date(retryAfter).toISOString() }); }
      else if (cooling("www.cninfo.com.cn")) result.shares.skipped++;
      else try {
        const structure = await sources.structure(id, today);
        const listing = sourceFailed(structure) ? null : await sources.listing(id, now.toISOString());
        const exchangeHost = id.startsWith("XSHG:") ? "query.sse.com.cn" : "www.szse.cn";
        let exchange = null, exchangeStatus = "not_checked";
        if (!sourceFailed(structure) && !cooling(exchangeHost)) {
          try {
            const value = await sources.exchange(id, today);
            if (sourceFailed(value)) exchangeStatus = value.reason; else { exchange = value; exchangeStatus = "matched"; }
          } catch (error) {
            // The exchange page is a cross-check; an unreachable exchange does not discard the issuer structure.
            exchangeStatus = error instanceof CnSourceError && error.code === "HOST_SKIPPED" ? "unreachable" : `unreachable: ${maintenanceError(error).message}`;
            if (blockedCode(error)) await coolDown(exchangeHost);
          }
        } else if (cooling(exchangeHost)) exchangeStatus = "provider_cooldown";
        // A published SSE page that fails our checks is a disagreement, not an outage.
        if (id.startsWith("XSHG:") && !exchange && !/^unreachable|provider_cooldown/.test(exchangeStatus)) {
          throw Object.assign(new Error(`SSE cross-check failed: ${exchangeStatus}`), { code: exchangeStatus, unavailable: true });
        }
        const count = sourceFailed(structure) ? structure : combineShareCount({ structure, listing: listing && !sourceFailed(listing) ? listing : null,
          exchange, exchangeStatus, fetchedAt: now.toISOString(), today });
        if (sourceFailed(count)) throw Object.assign(new Error(count.reason), { code: count.reason, unavailable: true });
        next.cnShares = update.cnShares = count;
        update.cnShareStatus = { outcome: "ready", reason: null, refreshReason: due, lastError: null, retryAfter: null, attemptedAt: now.toISOString() };
        result.shares.refreshed++;
        log.emit("INFO", "share_count_refreshed", { company: id, refreshReason: due, count });
      } catch (error) {
        const details = maintenanceError(error);
        const unavailable = (error as { unavailable?: boolean }).unavailable === true;
        // Keep the previous count; mark why the refresh failed and retry after a cooldown.
        update.cnShareStatus = { outcome: unavailable ? "unavailable" : "retry", reason: unavailable ? String(details.code) : null, refreshReason: due,
          lastError: { code: details.code, message: details.message }, retryAfter: now.getTime() + RETRY_MS, attemptedAt: now.toISOString() };
        next.cnShareStatus = update.cnShareStatus;
        if (unavailable) { result.shares.unavailable++; log.emit("WARNING", "share_count_unavailable", { company: id, reason: details.code }); }
        else { result.shares.failed++; log.emit("ERROR", "share_count_failed", { company: id, error: details }); }
        if (blockedCode(error)) await coolDown((error as CnSourceError).host);
      }
      if (dryRun) docs.set(id, { ...next, ...update });
      else { update.cnLeaseUntil = 0; await collection.doc(id).set(update, { merge: true }); docs.set(id, { ...stored, ...update }); }
    } catch (error) {
      result.failed++;
      log.emit("ERROR", "company_failed", { company: id, error: maintenanceError(error) });
    }
  }
  result.blockedHosts = options.blockedHosts?.() ?? {};

  // 3. Market caps: every run, from stored data only (no provider calls).
  log.stage("market_caps");
  const { prices, latestSession } = await readLatestCnPrices(db, companies);
  const readFx = createFxReader(db);
  for (const id of companies) {
    try {
      const stored = docs.get(id) ?? {};
      const price = prices.get(id);
      const fx = price ? await readFx(price.tradingDate) : null;
      const shareStatus = stored.cnShareStatus as { outcome?: string; reason?: string } | undefined;
      const marketCap: CnMarketCap = calculateCnMarketCap({ id, count: stored.cnShares ?? null,
        countReason: shareStatus?.outcome === "unavailable" ? shareStatus.reason ?? "share_count_unavailable" : null,
        check: stored.cnActions ?? null, price, latestSession, fx, now: clock() });
      result.marketCaps.processed++; result.marketCaps[marketCap.status]++;
      if (marketCap.lastClose) result.marketCaps.lastClose++;
      if (marketCap.status === "estimated" && !marketCap.usd) result.marketCaps.missingUsd++;
      if (dryRun) print(dryRunLine(id, marketCap, stored, price, fx));
      else await db.collection(FUNDAMENTALS_COLLECTION).doc(id).set({ market: "CN_A", marketCap }, { merge: true });
      log.emit("INFO", "market_cap_calculated", { company: id, dryRun, ...marketCap, shares: marketCap.shares ? { totalShares: marketCap.shares.totalShares, date: marketCap.shares.date } : null });
    } catch (error) {
      result.marketCaps.failed++;
      log.emit("ERROR", "market_cap_failed", { company: id, error: maintenanceError(error) });
    }
  }
  return result;
}

// One human-readable record per company for spot checks before the first real run.
function dryRunLine(id: string, cap: CnMarketCap, stored: Stored, price: { tradingDate: string; close: number } | undefined,
  fx: { rate: number; date: string; source: string } | null) {
  const s = cap.shares;
  const actions = stored.cnActions;
  return JSON.stringify({ company: id, status: cap.status, reason: cap.reason,
    shares: s ? { total: s.totalShares, a: s.aShares, aTradable: s.aTradableShares, h: s.hShares, b: s.bShares, date: s.date, asOf: s.asOf,
      source: s.sourceUrl, sourceType: s.sourceType, exchangeCheck: s.exchangeCheck.status, hCode: s.listing.hCode } : null,
    shareStatus: stored.cnShareStatus ?? null,
    price: price ? { close: price.close, date: price.tradingDate, lastClose: cap.lastClose } : null,
    fx: fx ? { usdCny: fx.rate, date: fx.date, source: fx.source } : null,
    marketCapCny: cap.value, marketCapUsd: cap.usd?.value ?? null, method: cap.method,
    corporateActions: actions ? { checkedAt: actions.checkedAt, stale: daysBetween(actions.checkedAt.slice(0, 10), shanghaiDate()) > CN_ACTION_CHECK_MAX_AGE_DAYS,
      events: actions.events.map(e => `${e.date} ${e.kind} (settles ${e.settleBy}): ${e.title}`) } : null });
}
