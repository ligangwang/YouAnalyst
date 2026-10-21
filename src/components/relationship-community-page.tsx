'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from './providers/auth-provider';
import { useLocale } from './providers/locale-provider';
import { REVIEW_TYPES, reviewVerbs } from '@/lib/relationship-review/model';
import { COMPANY_THEMES, themeName } from '@/lib/company-themes/model';
import type { RelationshipCorrection } from '@/lib/relationship-review/community-model';

type Detail = { relationshipId: string; version: string; origin: string; openDisputes: number; evidence?: { url: string; title: string; quote: string }[]; credits: { name: string; points: number }[]; relationship: RelationshipCorrection };
type History = { points: number; usefulContributions: number; items: { id: string; relationshipId: string; kind: string; status: string; reason: string; resolution: string | null; creditedPoints: number }[] };
export function RelationshipCommunityPage() {
  const { user, loading, getIdToken } = useAuth(), { text, chinese } = useLocale();
  const [detail, setDetail] = useState<Detail | null>(null), [history, setHistory] = useState<History | null>(null);
  const [correction, setCorrection] = useState<RelationshipCorrection | null>(null), [kind, setKind] = useState<'DISPUTE' | 'CORRECTION'>('DISPUTE');
  const [reason, setReason] = useState(''), [evidenceUrl, setUrl] = useState(''), [evidenceQuote, setQuote] = useState(''), [publicCredit, setPublicCredit] = useState(false);
  const [error, setError] = useState(''), [message, setMessage] = useState(''), [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController(), id = new URL(window.location.href).searchParams.get('relationshipId');
    if (!id) return;
    void fetch('/api/relationships/contributions?relationshipId=' + encodeURIComponent(id), { signal: controller.signal }).then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error); return data as Detail; }).then(data => { setDetail(data); setCorrection(data.relationship); }).catch(e => { if (!controller.signal.aborted) setError(String(e.message)); });
    return () => controller.abort();
  }, [revision]);
  useEffect(() => {
    if (!user) return;
    const uid = user.uid; let cancelled = false;
    void (async () => { try { const token = await getIdToken(); if (!token) return; const response = await fetch('/api/relationships/contributions?mine=1', { headers: { authorization: 'Bearer ' + token } }); if (!response.ok) return; const data = await response.json(); if (!cancelled) setHistory({ ...data, owner: uid }); } catch {} })();
    return () => { cancelled = true; };
  }, [user, getIdToken, revision]);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (busy || !detail) return; setBusy(true); setError(''); setMessage('');
    try {
      const token = await getIdToken(); if (!token) throw new Error(text('Sign in to contribute.', '请登录后提交。'));
      const response = await fetch('/api/relationships/contributions', { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: JSON.stringify({ relationshipId: detail.relationshipId, version: detail.version, kind, reason, evidenceUrl, evidenceQuote, publicCredit, ...(kind === 'CORRECTION' ? { correction } : {}) }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      setMessage(data.duplicate ? text('You already submitted a review for this version. See its status below.', '您已对该版本提交过审核，请在下方查看状态。') : text('Contribution submitted. The relationship is flagged for review. Accepted contributions earn 10 credit points.', '已提交，关系已标记为待复核。获采纳的贡献可获得 10 积分。'));
      setRevision(n => n + 1);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }
  const field = 'block w-full rounded-lg border border-white/20 bg-slate-950 p-2';
  const currentHistory = user && (history as (History & { owner?: string }) | null)?.owner === user.uid ? history : null;
  return <main className="mx-auto w-full max-w-3xl px-4 py-8"><h1 className="text-3xl font-semibold">{text('Community relationship review', '社区关系复核')}</h1><p className="my-3 text-slate-400">{text('Help improve the map with source-backed disputes and corrections. Credit rewards useful, accepted contributions.', '通过有来源支持的质疑和更正改进图谱。有效且获采纳的贡献将获得积分。')}</p>
    {error && <p role="alert" className="my-3 text-rose-300">{error}</p>}{message && <p role="status" className="my-3 text-cyan-200">{message}</p>}
    {detail && <section className="my-5 rounded-xl border border-white/15 p-4"><h2 className="font-semibold break-words">{detail.relationship.sourceId} → {detail.relationship.targetId}</h2><p className="mt-2">{detail.relationship.summary}</p><p className="my-2 text-sm text-amber-200">{detail.origin === 'AI' ? text('AI-extracted · Not community verified', 'AI 提取 · 尚未经社区核实') : text('Source-backed relationship', '有来源支持的关系')}{detail.openDisputes > 0 && ` · ${text('Disputed', '存在争议')} (${detail.openDisputes})`}</p><details className="my-3"><summary className="cursor-pointer text-cyan-200">{text('Original relationship evidence', '原关系证据')}</summary>{detail.evidence?.map((e, i) => <div key={i} className="my-3"><a className="break-words text-cyan-200 underline" href={e.url} target="_blank" rel="noopener noreferrer">{e.title} ↗</a><p className="whitespace-pre-line">{e.quote}</p></div>)}</details>{detail.credits.map((credit, i) => <p className="text-sm text-cyan-200" key={i}>{text('Improved by', '改进贡献者')} {credit.name} · {credit.points} {text('points', '积分')}</p>)}</section>}
    {loading ? <p role="status">{text('Checking sign-in…', '正在检查登录…')}</p> : !user ? <Link className="text-cyan-200 underline" href="/auth">{text('Sign in to dispute or correct a relationship', '登录以质疑或更正关系')}</Link> : detail && correction && <form onSubmit={submit} className="space-y-4">
      <label className="block">{text('Contribution', '贡献类型')}<select className={field} value={kind} onChange={e => setKind(e.target.value as typeof kind)}><option value="DISPUTE">{text('Dispute this relationship', '质疑该关系')}</option><option value="CORRECTION">{text('Propose a correction', '建议更正')}</option></select></label>
      <label className="block">{text('What is wrong, and why?', '哪里有误，原因是什么？')}<textarea className={field} required minLength={20} maxLength={1200} value={reason} onChange={e => setReason(e.target.value)} /></label>
      <label className="block">{text('Evidence URL', '证据链接')}<input className={field} type="url" required maxLength={2000} value={evidenceUrl} onChange={e => setUrl(e.target.value)} /></label>
      <label className="block">{text('Supporting quotation', '支持该观点的原文')}<textarea className={field} required minLength={20} maxLength={2000} value={evidenceQuote} onChange={e => setQuote(e.target.value)} /></label>
      {kind === 'CORRECTION' && <fieldset className="space-y-3 rounded-xl border border-white/20 p-4"><legend>{text('Proposed relationship', '建议的关系')}</legend><p className="text-sm text-slate-400">{text('Use the company IDs shown above. Explain any identity change in your reason.', '请使用上方的公司 ID，如需更正公司身份，请说明原因。')}</p>
        <label className="block">{text('From company ID', '起点公司 ID')}<input className={field} required value={correction.sourceId} onChange={e => setCorrection({ ...correction, sourceId: e.target.value })} /></label><label className="block">{text('To company ID', '终点公司 ID')}<input className={field} required value={correction.targetId} onChange={e => setCorrection({ ...correction, targetId: e.target.value })} /></label>
        <button type="button" className="ui-button" onClick={() => setCorrection({ ...correction, sourceId: correction.targetId, targetId: correction.sourceId })}>{text('Swap direction', '交换方向')} ⇄</button>
        <label className="block">{text('Relationship', '关系')}<select className={field} value={correction.type} onChange={e => setCorrection({ ...correction, type: e.target.value as RelationshipCorrection['type'] })}>{REVIEW_TYPES.map(type => <option key={type} value={type}>{reviewVerbs[type][chinese ? 1 : 0]}</option>)}</select></label>
        <label className="block">{text('Evidence state', '证据状态')}<select className={field} value={correction.state} onChange={e => setCorrection({ ...correction, state: e.target.value as RelationshipCorrection['state'] })}><option value="DOCUMENTED">{text('Documented', '已有记录')}</option><option value="ANNOUNCED">{text('Announced / planned', '已宣布／计划中')}</option><option value="TERMINATED">{text('Terminated', '已终止')}</option></select></label>
        <label className="block">{text('Corrected claim', '更正后的表述')}<textarea className={field} required maxLength={1200} value={correction.summary} onChange={e => setCorrection({ ...correction, summary: e.target.value })} /></label><label className="block">{text('Scope and limitations', '适用范围与限制')}<textarea className={field} required maxLength={1200} value={correction.limitation} onChange={e => setCorrection({ ...correction, limitation: e.target.value })} /></label>
        <div>{COMPANY_THEMES.map(theme => <label className="mr-4 inline-flex gap-2" key={theme}><input type="checkbox" checked={correction.themeIds.includes(theme)} onChange={e => setCorrection({ ...correction, themeIds: e.target.checked ? [...correction.themeIds, theme] : correction.themeIds.filter(t => t !== theme) })} />{themeName(theme, chinese)}</label>)}</div>
      </fieldset>}
      <label className="flex gap-2"><input type="checkbox" checked={publicCredit} onChange={e => setPublicCredit(e.target.checked)} />{text('Show my member name on accepted corrections', '更正被采纳后公开显示我的会员名称')}</label><button disabled={busy} className="ui-button" type="submit">{busy ? text('Submitting…', '正在提交…') : text('Submit for review', '提交复核')}</button>
    </form>}
    {currentHistory && <section className="mt-8"><h2 className="text-xl font-semibold">{text('Your contributions', '您的贡献')}</h2><p className="my-2">{currentHistory.points} {text('credit points', '贡献积分')} · {currentHistory.usefulContributions} {text('accepted contributions', '项已采纳贡献')}</p>{currentHistory.items.map(item => <article key={item.id} className="my-3 rounded-xl border border-white/15 p-3"><a className="break-words text-cyan-200" href={'?relationshipId=' + encodeURIComponent(item.relationshipId)}>{item.relationshipId}</a><p>{item.reason}</p><p>{text('Status', '状态')}: {item.status} · +{item.creditedPoints}</p>{item.resolution && <p>{item.resolution}</p>}</article>)}</section>}
  </main>;
}
