'use client';
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from './providers/auth-provider';
import { useLocale } from './providers/locale-provider';
import type { RelationshipContribution } from '@/lib/relationship-review/community-model';
import { AdminRelationshipReview } from './admin-relationship-review';

type Item = RelationshipContribution & { reviewVersion: string };
export function AdminRelationshipQueues() {
  const { text } = useLocale(), [queue, setQueue] = useState('community');
  return <><div className="mx-auto flex max-w-7xl gap-3 px-4 pt-6" role="group" aria-label={text('Relationship queues', '关系审核队列')}><button className="ui-button" aria-pressed={queue === 'community'} onClick={() => setQueue('community')}>{text('Community disputes & corrections', '社区质疑与更正')}</button><button className="ui-button" aria-pressed={queue === 'validation'} onClick={() => setQueue('validation')}>{text('Extraction validation holds', '提取验证待处理')}</button></div>{queue === 'community' ? <CommunityQueue /> : <AdminRelationshipReview />}</>;
}
function CommunityQueue() {
  const { user, getIdToken } = useAuth(), { text } = useLocale();
  const [items, setItems] = useState<Item[]>([]), [selected, setSelected] = useState<Item | null>(null), [status, setStatus] = useState('OPEN');
  const [after, setAfter] = useState(''), [next, setNext] = useState<string | null>(null), [revision, setRevision] = useState(0);
  const [note, setNote] = useState(''), [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const api = useCallback(async (body?: unknown) => {
    const token = await getIdToken(); if (!token) throw new Error('Sign in with an administrator account');
    const response = await fetch('/api/admin/relationship-contributions?' + new URLSearchParams({ status, after }), { method: body ? 'POST' : 'GET', headers: { authorization: 'Bearer ' + token, ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await response.json(); if (!response.ok) throw new Error(data.error); return data;
  }, [getIdToken, status, after]);
  useEffect(() => {
    if (!user) return; let cancelled = false;
    void (async () => { setBusy(true); setError(''); try { const data = await api(); if (!cancelled) { setItems(data.items); setNext(data.nextCursor); } } catch (e) { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); } finally { if (!cancelled) setBusy(false); } })();
    return () => { cancelled = true; };
  }, [user, api, revision]);
  async function resolve(outcome: 'ACCEPTED' | 'DISMISSED') {
    if (!selected || busy) return; setBusy(true); setError('');
    try { const data = await api({ id: selected.id, version: selected.reviewVersion, outcome, note, evidenceConfirmed: confirmed }); setMessage(`${text('Review saved. Contribution credit', '复核已保存，贡献积分')}: ${data.creditedPoints}`); setSelected(null); setNote(''); setConfirmed(false); setRevision(n => n + 1); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }
  const original = selected?.relationshipSnapshot;
  return <main className="mx-auto max-w-7xl px-4 py-6"><h1 className="text-3xl font-semibold">{text('Community relationship review', '社区关系复核')}</h1><p className="my-3 text-slate-400">{text('Accepted disputes withdraw relationships. Accepted corrections publish the proposed replacement. Useful contributions earn 10 points after independent review.', '采纳质疑将撤下关系，采纳更正将发布建议的新关系。经独立复核采纳的有效贡献获得 10 积分。')}</p>
    <div className="my-4 flex gap-3"><label>{text('Status', '状态')} <select className="ui-input" value={status} onChange={e => { setStatus(e.target.value); setAfter(''); setSelected(null); }}>{['OPEN', 'ACCEPTED', 'DISMISSED'].map(s => <option key={s}>{s}</option>)}</select></label><button className="ui-button" disabled={busy} onClick={() => setRevision(n => n + 1)}>{text('Refresh', '刷新')}</button></div>
    {error && <p role="alert" className="my-3 text-rose-300">{error}</p>}{message && <p role="status" className="my-3 text-cyan-200">{message}</p>}{busy && <p role="status">{text('Loading review…', '正在读取…')}</p>}
    <div className="grid gap-6 lg:grid-cols-[320px_1fr]"><aside aria-label={text('Community review queue', '社区审核队列')} className="space-y-3">{!busy && !items.length && <p>{text('No community reports in this batch.', '当前批次没有社区报告。')}</p>}{items.map(item => <button key={item.id} className="block w-full rounded-xl border border-white/20 p-3 text-left" aria-pressed={selected?.id === item.id} onClick={() => { setSelected(item); setNote(''); setConfirmed(false); }}><strong className="break-words">{item.relationshipId}</strong><p>{item.kind} · {item.creditName}</p><small>{item.reason}</small></button>)}{after && <button className="ui-button" disabled={busy} onClick={() => setAfter('')}>{text('First batch', '第一批')}</button>}{next && <button className="ui-button" disabled={busy} onClick={() => { setAfter(next); setSelected(null); }}>{text('Next batch', '下一批')} →</button>}</aside>
    {selected && <section aria-label={text('Contribution review', '贡献复核')} className="min-w-0 space-y-4 rounded-xl border border-white/15 p-4"><h2 className="text-xl font-semibold">{selected.kind} · {selected.creditName}</h2><p>{selected.reason}</p><h3>{text('Published claim at submission', '提交时的已发布表述')}</h3><p>{String(original?.summary ?? '')}</p><p className="break-words">{String(original?.source)} → {String(original?.target)} · {String(original?.type)}</p>
      <a href={selected.evidenceUrl} className="break-words text-cyan-200 underline" target="_blank" rel="noopener noreferrer">{text('Open contribution evidence', '打开贡献证据')} ↗</a><blockquote className="border-l-2 border-cyan-500 pl-3">{selected.evidenceQuote}</blockquote>
      {Array.isArray(original?.evidence) && <details><summary>{text('Original relationship evidence', '原关系证据')}</summary>{(original.evidence as { url: string; title: string; summary?: string }[]).filter(e => e.url?.startsWith('https://')).map((e, i) => <p key={i}><a href={e.url} target="_blank" rel="noopener noreferrer" className="text-cyan-200 underline">{e.title} ↗</a>{e.summary && <span> · {e.summary}</span>}</p>)}</details>}
      {selected.correction && <div className="rounded-lg border border-cyan-500/40 p-3"><h3>{text('Proposed correction', '建议的更正')}</h3><p className="break-words">{selected.correction.sourceId} → {selected.correction.targetId} · {selected.correction.type} · {selected.correction.state}</p><p>{selected.correction.summary}</p><p>{selected.correction.limitation}</p><p>{selected.correction.themeIds.join(', ')}</p></div>}
      {selected.status === 'OPEN' ? <><label className="block">{text('Review decision and reasoning', '复核决定与理由')}<textarea className="block w-full rounded-lg border border-white/20 bg-slate-950 p-2" minLength={10} maxLength={1200} value={note} onChange={e => setNote(e.target.value)} /></label><label className="flex gap-2"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />{text('I checked the original source, identities, direction, scope and proposed change.', '我已检查原始来源、公司身份、方向、范围与建议的更改。')}</label><div className="flex flex-wrap gap-3"><button className="ui-button" disabled={busy || !confirmed || note.trim().length < 10 || selected.userId === user?.uid} onClick={() => void resolve('ACCEPTED')}>{selected.kind === 'DISPUTE' ? text('Accept dispute & withdraw relationship', '采纳质疑并撤下关系') : text('Accept correction & publish', '采纳更正并发布')}</button><button className="ui-button" disabled={busy || !confirmed || note.trim().length < 10 || selected.userId === user?.uid} onClick={() => void resolve('DISMISSED')}>{text('Dismiss report', '不采纳报告')}</button></div>{selected.userId === user?.uid && <p>{text('Another administrator must review your contribution.', '您的贡献需要由另一位管理员复核。')}</p>}</> : <p>{selected.resolution} · +{selected.creditedPoints ?? 0}</p>}
    </section>}</div>
  </main>;
}
