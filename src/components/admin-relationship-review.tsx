'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/components/providers/auth-provider';
import { useLocale } from './providers/locale-provider';
import { COMPANY_THEMES, themeName, type CompanyThemeId } from '@/lib/company-themes/model';
import { REVIEW_TYPES, reviewVerbs, type PublicationInput, type ReviewCandidate, type ReviewCompany, type ReviewDecision, type ReviewDetail, type ReviewPreview, type ReviewState, type ReviewStatus, type ReviewType } from '@/lib/relationship-review/model';
import type { IdentityCandidate } from '@/lib/market-companies/name-resolution';
import styles from './admin-relationship-review.module.css';

type Api = <T>(query?: string, body?: unknown) => Promise<T>;
function CompanyPicker({ label, observedName, value, busy, api, onChange }: {
  label: string; observedName: string; value: ReviewCompany | null; busy: boolean; api: Api; onChange: (company: ReviewCompany) => void;
}) {
  const { text } = useLocale();
  const [query, setQuery] = useState(''), [items, setItems] = useState<IdentityCandidate[]>([]);
  const [loading, setLoading] = useState(false), [searched, setSearched] = useState(false), [error, setError] = useState('');
  const sequence = useRef(0);
  async function search() {
    const n = ++sequence.current; setLoading(true); setError('');
    try { const result = await api<{ items: IdentityCandidate[] }>('?company=' + encodeURIComponent(query || observedName));
      if (n === sequence.current) { setItems(result.items); setSearched(true); }
    } catch (e) { if (n === sequence.current) setError(e instanceof Error ? e.message : String(e)); }
    finally { if (n === sequence.current) setLoading(false); }
  }
  async function choose(id: string) {
    setLoading(true); setError('');
    try { onChange(await api<ReviewCompany>('?companyId=' + encodeURIComponent(id))); setItems([]); setSearched(false); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }
  return <section className={styles.company} aria-label={label}>
    <h3>{label}</h3>
    {value ? <p><strong>{value.name}</strong><br /><small>{value.id} · {value.legalName}</small></p> : <p>{text('Select a verified company identity.', '请选择已核实的公司身份。')}</p>}
    <small>{text('Extracted name: ', '提取名称：')}{observedName || '—'}</small>
    <div className={styles.search}>
      <label>{text('Name or ticker', '名称或代码')}<input aria-label={label + ' ' + text('name or ticker', '名称或代码')} value={query} placeholder={observedName} maxLength={120} disabled={busy || loading} onChange={e => { setQuery(e.target.value); setItems([]); setSearched(false); }} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void search(); } }} /></label>
      <button type="button" disabled={busy || loading || !(query || observedName).trim()} onClick={() => void search()}>{text('Search', '搜索')}</button>
    </div>
    {searched && !items.length && <p>{text('No matches. Try a shorter name or ticker.', '没有匹配结果，请尝试简称或股票代码。')}</p>}
    {items.map(item => <button className={styles.match} type="button" key={item.id} disabled={busy || loading} onClick={() => void choose(item.id)}><strong>{item.legalName || item.name}</strong><small>{item.id} · {item.exchange} · {item.country}</small></button>)}
    {loading && <p role="status">{text('Looking up companies…', '正在查询公司…')}</p>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
  </section>;
}

function ReviewEditor({ detail, api, onSaved }: { detail: ReviewDetail; api: Api; onSaved: (decision: ReviewDecision) => void }) {
  const { text, locale } = useLocale(), c = detail.candidate;
  const reverse = c.direction === 'target_to_source';
  const [source, setSource] = useState<ReviewCompany | null>(detail.companies.find(v => v.id === (reverse ? c.targetId : c.sourceId)) ?? null);
  const [target, setTarget] = useState<ReviewCompany | null>(detail.companies.find(v => v.id === (reverse ? c.sourceId : c.targetId)) ?? null);
  const [type, setType] = useState<ReviewType>(REVIEW_TYPES.includes(c.type as ReviewType) ? c.type as ReviewType : 'PARTNER_OF');
  const [state, setState] = useState<ReviewState>(c.state), [themes, setThemes] = useState<CompanyThemeId[]>([]);
  const [eventDate, setEventDate] = useState(c.eventDate ?? '');
  const [summary, setSummary] = useState(c.summary.slice(0, 1200)), [limitation, setLimitation] = useState(''), [note, setNote] = useState('');
  const [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [preview, setPreview] = useState<ReviewPreview | null>(null), [rejecting, setRejecting] = useState(false);
  const saving = useRef(false);
  const input = (): PublicationInput => ({ candidateId: c.id, version: c.version, sourceId: source?.id ?? '', targetId: target?.id ?? '', type, state, themeIds: themes, summary, limitation, note, evidenceConfirmed: true, eventDate: eventDate || null });
  const changed = () => { setPreview(null); setError(''); };
  async function act(action: 'preview' | 'approve' | 'reject') {
    if (saving.current) return; saving.current = true; setBusy(true); setError('');
    try {
      if (action === 'preview') { setRejecting(false); setPreview(await api<ReviewPreview>('', { action, input: input() })); }
      else onSaved(await api<ReviewDecision>('', { action,
        input: action === 'reject' ? { candidateId: c.id, version: c.version, note } : input(),
        ...(action === 'approve' ? { previewToken: preview?.token } : {}),
      }));
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); if (action === 'approve') setPreview(null); }
    finally { saving.current = false; setBusy(false); }
  }
  const ready = Boolean(source && target && source.id !== target.id && themes.length && summary.trim() && limitation.trim() && note.trim() && confirmed && !c.category);
  const chinese = locale === 'zh-CN';
  return <section className={styles.detail} aria-label={text('Candidate review', '候选关系审核')}>
    <div className={styles.detailHeading}><span className={styles.eyebrow}>{c.kind === 'NEWS_OBSERVATION' ? text('NEWS EVIDENCE', '新闻证据') : text('FILING EVIDENCE', '披露证据')}</span><h2>{c.sourceName} → {c.targetName}</h2><p>{text('Collected', '收集于')} {c.createdAt ? new Date(c.createdAt).toLocaleString(locale) : '—'} · {c.type}</p></div>
    <section className={styles.evidence} aria-label={text('Source evidence', '来源证据')}>
      <h3>{text('Original evidence', '原始证据')}</h3>
      {c.evidence.map((e, i) => <article key={i}><div className={styles.sourceTitle}>{e.url ? <a href={e.url} target="_blank" rel="noopener noreferrer">{e.title || text('Open source', '打开来源')} ↗</a> : <span>{e.title}</span>}<small>{e.sourceDate ?? text('Undated source', '来源日期未知')}</small></div><blockquote>{e.quote}</blockquote></article>)}
      {!c.evidence.length && <p>{text('No source evidence is attached. This candidate cannot be published.', '没有附带来源证据，无法发布此候选关系。')}</p>}
      {detail.sourceWarning && <p className={styles.warning}>{detail.sourceWarning}</p>}
      {detail.sourceText && <details><summary>{text('Read saved article text', '阅读已保存的文章全文')}</summary><pre>{detail.sourceText}</pre></details>}
    </section>
    {c.decision ? <section className={styles.receipt}><h3>{c.decision.decision === 'APPROVED' ? text('Approved and published', '已批准并发布') : text('Rejected', '已拒绝')}</h3><p>{c.decision.note}</p><small>{c.decision.reviewedBy} · {new Date(c.decision.reviewedAt).toLocaleString(locale)}</small>{c.decision.themeIds.map(t => <a key={t} href={'/?' + new URLSearchParams({ theme: t, relationship: c.decision!.relationshipId ?? '' })}>{themeName(t, chinese)} ↗</a>)}</section> : <>
      {c.category && <p className={styles.warning}>{text('This extraction names an industry category rather than a company. It can be rejected, but cannot be published as a company relationship.', '此提取结果是行业类别而非公司，可以拒绝，但不能发布为公司关系。')}</p>}
      <fieldset disabled={busy} className={styles.form}>
        <legend>{text('Review the relationship', '审核关系')}</legend>
        <p>{text('Confirm the same legal entities and the direction supported by the quotation.', '请核对法律实体，并确认引文支持的关系方向。')}</p>
        <div className={styles.endpoints}>
          <CompanyPicker label={text('From company', '起点公司')} observedName={reverse ? c.targetName : c.sourceName} value={source} busy={busy} api={api} onChange={v => { setSource(v); setThemes([]); changed(); }} />
          <CompanyPicker label={text('To company', '终点公司')} observedName={reverse ? c.sourceName : c.targetName} value={target} busy={busy} api={api} onChange={v => { setTarget(v); setThemes([]); changed(); }} />
        </div>
        <button type="button" onClick={() => { setSource(target); setTarget(source); changed(); }}>{text('Swap direction', '交换方向')} ⇄</button>
        <div className={styles.fields}>
          <label>{text('Relationship', '关系类型')}<select value={type} onChange={e => { setType(e.target.value as ReviewType); changed(); }}>{REVIEW_TYPES.map(t => <option key={t} value={t}>{reviewVerbs[t][chinese ? 1 : 0]}</option>)}</select></label>
          <label>{text('Evidence state', '证据状态')}<select value={state} onChange={e => { setState(e.target.value as ReviewState); changed(); }}><option value="DOCUMENTED">{text('Documented', '已有事实依据')}</option><option value="ANNOUNCED">{text('Announced / planned', '已宣布 / 计划中')}</option><option value="TERMINATED">{text('Terminated', '已终止')}</option></select></label>
        </div>
        <p className={styles.statement}>{source?.name || '…'} <strong>{reviewVerbs[type][chinese ? 1 : 0]}</strong> {target?.name || '…'}</p>
        <label>{text('Event date (only if specified by the source)', '事件日期（仅在来源明确说明时填写）')}<input type="date" value={eventDate} onChange={e => { setEventDate(e.target.value); changed(); }} /></label>
        <label>{text('Supported claim', '证据支持的表述')}<textarea value={summary} maxLength={1200} rows={3} onChange={e => { setSummary(e.target.value); changed(); }} /></label>
        <label>{text('Scope and limitations', '范围与限制')}<textarea value={limitation} maxLength={1200} rows={2} placeholder={text('Product, geography, timing, or what the source does not establish.', '产品、地区、时间，或来源未能证实的内容。')} onChange={e => { setLimitation(e.target.value); changed(); }} /></label>
        <fieldset className={styles.themes}><legend>{text('Publish to themes', '发布到主题')}</legend><p>{text('Both companies must already belong to a selected theme. Existing relationship themes are retained.', '两家公司都须已加入所选主题。关系已有的主题归属将保留。')}</p>
          {COMPANY_THEMES.map(t => { const eligible = Boolean(source?.themes.includes(t) && target?.themes.includes(t)); return <label key={t} className={styles.check}><input type="checkbox" checked={themes.includes(t)} disabled={!eligible || busy} onChange={e => { setThemes(e.target.checked ? [...themes, t] : themes.filter(v => v !== t)); changed(); }} />{themeName(t, chinese)}{!eligible && <small>{text('Membership needed', '需要主题成员资格')}</small>}</label>; })}
        </fieldset>
        <label>{text('Review note / rejection reason', '审核备注 / 拒绝原因')}<textarea value={note} maxLength={1200} rows={2} onChange={e => { setNote(e.target.value); changed(); }} /></label>
        <label className={styles.check}><input type="checkbox" checked={confirmed} onChange={e => { setConfirmed(e.target.checked); changed(); }} />{text('I checked the source, company identities, direction, scope and evidence state.', '我已核对来源、公司身份、方向、范围与证据状态。')}</label>
        <div className={styles.actions}><button className={styles.primary} type="button" disabled={!ready || busy} onClick={() => void act('preview')}>{text('Preview publication', '预览发布')}</button><button type="button" className={styles.reject} disabled={busy} onClick={() => { setRejecting(!rejecting); setPreview(null); }}>{text('Reject candidate', '拒绝候选关系')}</button></div>
      </fieldset>
      {rejecting && <section className={styles.receipt}><h3>{text('Reject this candidate?', '拒绝此候选关系？')}</h3><p>{text('The evidence and your reason will remain in review history. Published relationships are unchanged.', '证据和拒绝原因会保留在审核历史中，已发布关系不受影响。')}</p><p>{note || text('Enter a rejection reason above.', '请在上方填写拒绝原因。')}</p><div className={styles.actions}><button type="button" disabled={busy || !note.trim()} onClick={() => void act('reject')}>{text('Confirm rejection', '确认拒绝')}</button><button type="button" disabled={busy} onClick={() => setRejecting(false)}>{text('Cancel', '取消')}</button></div></section>}
      {preview && <section className={styles.preview} aria-label={text('Publication preview', '发布预览')}><h3>{preview.existing ? text('Merge evidence into existing relationship', '将证据合并到已有关系') : text('Publish a new relationship', '发布新关系')}</h3><p className={styles.statement}>{preview.source.name} <strong>{reviewVerbs[preview.type as ReviewType]?.[chinese ? 1 : 0] ?? preview.type}</strong> {preview.target.name}</p><p>{preview.summary}</p><p>{text('Limitations: ', '限制：')}{preview.limitation}</p><p>{text('State: ', '状态：')}{preview.state}</p>{preview.eventDate && <p>{text('Event date: ', '事件日期：')}{preview.eventDate}</p>}<p>{text('Themes: ', '主题：')}{preview.themeIds.map(t => themeName(t, chinese)).join(' · ')}</p><small>{preview.evidenceCount} {text('sources', '个来源')} · {preview.factCount} {text('reviewed facts after publication', '条发布后的已审核事实')}</small><div className={styles.actions}><button type="button" className={styles.primary} disabled={busy || !confirmed} onClick={() => void act('approve')}>{text('Approve and publish', '批准并发布')}</button><button type="button" disabled={busy} onClick={() => setPreview(null)}>{text('Back to editing', '返回编辑')}</button></div></section>}
      {busy && <p role="status">{text('Saving review…', '正在处理审核…')}</p>}
      {error && <p role="alert" className={styles.error}>{error}</p>}
    </>}
  </section>;
}

export function AdminRelationshipReview() {
  const { user, loading, getIdToken } = useAuth(), { text } = useLocale();
  const [status, setStatus] = useState<ReviewStatus>('NEEDS_REVIEW'), [after, setAfter] = useState(''), [revision, setRevision] = useState(0);
  const [page, setPage] = useState<{ items: ReviewCandidate[]; nextCursor: string | null; owner: string } | null>(null);
  const [selected, setSelected] = useState(''), [detail, setDetail] = useState<(ReviewDetail & { owner: string }) | null>(null);
  const [listBusy, setListBusy] = useState(true), [detailBusy, setDetailBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const [filter, setFilter] = useState(''), [kind, setKind] = useState('all');
  const api = useCallback<Api>(async (query = '', body) => {
    const token = await getIdToken(); if (!token) throw new Error('Sign in with an administrator account.');
    const response = await fetch('/api/admin/relationships' + query, { method: body ? 'POST' : 'GET', headers: { authorization: 'Bearer ' + token, ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Unable to load relationship review.'); return result;
  }, [getIdToken]);
  useEffect(() => {
    if (!user) return; let canceled = false;
    void (async () => { setListBusy(true); setError('');
      try { const result = await api<{ items: ReviewCandidate[]; nextCursor: string | null }>('?' + new URLSearchParams({ status, after })); if (!canceled) setPage({ ...result, owner: user.uid }); }
      catch (e) { if (!canceled) setError(e instanceof Error ? e.message : String(e)); }
      finally { if (!canceled) setListBusy(false); }
    })(); return () => { canceled = true; };
  }, [user, api, status, after, revision]);
  useEffect(() => {
    if (!selected || !user) return; let canceled = false;
    void (async () => { setDetailBusy(true); setError('');
      try { const result = await api<ReviewDetail>('?id=' + encodeURIComponent(selected)); if (!canceled) setDetail({ ...result, owner: user.uid }); }
      catch (e) { if (!canceled) setError(e instanceof Error ? e.message : String(e)); }
      finally { if (!canceled) setDetailBusy(false); }
    })(); return () => { canceled = true; };
  }, [user, api, selected, revision]);
  const current = page?.owner === user?.uid ? page : null;
  const active = detail && detail.owner === user?.uid && detail.candidate.id === selected ? detail : null;
  const visible = (current?.items ?? []).filter(c => (kind === 'all' || c.kind === kind) && (c.sourceName + ' ' + c.targetName + ' ' + c.summary).toLowerCase().includes(filter.toLowerCase().trim()));
  function saved(decision: ReviewDecision) {
    setMessage(decision.decision === 'APPROVED' ? text('Relationship published. It will appear in the selected themes after their caches refresh.', '关系已发布，主题缓存刷新后即可查看。') : text('Candidate rejected. The evidence and decision are retained.', '已拒绝候选关系，证据和审核决定已保留。'));
    setSelected(''); setDetail(null); setRevision(n => n + 1);
  }
  return <main className={styles.page}>
    <header className={styles.header}><div><Link href="/admin">← {text('Admin', '管理')}</Link><p className={styles.eyebrow}>{text('EVIDENCE TO RELATIONSHIPS', '从证据到关系')}</p><h1>{text('Relationship review', '公司关系审核')}</h1><p>{text('Review extracted claims, check original evidence, and publish to the right themes.', '审核提取的表述，核查原始证据，并发布到相应主题。')}</p></div><Link href="/admin/company-identities">{text('Company identity review', '公司身份审核')} ↗</Link></header>
    {loading ? <p role="status">{text('Checking access…', '正在检查权限…')}</p> : !user ? <p>{text('Sign in with an administrator account to review relationships.', '请使用管理员账号登录以审核关系。')}</p> : <>
      <div className={styles.toolbar}><div className={styles.tabs} role="group" aria-label={text('Review status', '审核状态')}>{(['NEEDS_REVIEW', 'APPROVED', 'REJECTED'] as const).map((s, i) => <button type="button" key={s} aria-pressed={status === s} onClick={() => { setStatus(s); setAfter(''); setSelected(''); setDetail(null); setPage(null); }}>{[text('Pending', '待审核'), text('Published', '已发布'), text('Rejected', '已拒绝')][i]}</button>)}</div><button type="button" disabled={listBusy || detailBusy} onClick={() => { setAfter(''); setRevision(n => n + 1); }}>{text('Refresh', '刷新')}</button></div>
      {message && <p role="status" className={styles.success}>{message}</p>}{error && <p role="alert" className={styles.error}>{error}</p>}
      <div className={styles.layout}><aside className={styles.queue} aria-label={text('Review queue', '审核队列')}>
        <label>{text('Search this batch', '搜索当前批次')}<input value={filter} onChange={e => setFilter(e.target.value)} placeholder={text('Company or claim', '公司或表述')} /></label>
        <label>{text('Source type', '来源类型')}<select value={kind} onChange={e => setKind(e.target.value)}><option value="all">{text('All sources', '全部来源')}</option><option value="NEWS_OBSERVATION">{text('News', '新闻')}</option><option value="FILING_OBSERVATION">{text('SEC filings', 'SEC 披露')}</option></select></label>
        {listBusy ? <p role="status">{text('Loading candidates…', '正在加载候选关系…')}</p> : <>
          <small>{visible.length} {text('candidates in this batch', '条当前批次候选关系')}</small>
          {!visible.length && <p>{current?.nextCursor ? text('No matches in this batch. Continue to the next batch.', '当前批次没有匹配项，请查看下一批。') : text('No matching candidates. Refresh to check for new extractions.', '没有匹配的候选关系，可刷新查看新的提取结果。')}</p>}
          {visible.map(c => <button type="button" key={c.id} className={styles.queueItem} aria-pressed={selected === c.id} onClick={() => setSelected(c.id)}><small>{c.kind === 'NEWS_OBSERVATION' ? text('NEWS', '新闻') : text('FILING', '披露')}</small><strong>{c.sourceName} → {c.targetName}</strong><span>{c.evidence[0]?.title || c.type}</span></button>)}
        </>}
        <div className={styles.actions}>{after && <button type="button" disabled={listBusy} onClick={() => setAfter('')}>{text('First batch', '第一批')}</button>}{current?.nextCursor && <button type="button" disabled={listBusy} onClick={() => { setAfter(current.nextCursor!); setSelected(''); setDetail(null); }}>{text('Next batch', '下一批')} →</button>}</div>
      </aside><div>{detailBusy ? <p role="status">{text('Loading original evidence…', '正在加载原始证据…')}</p> : active ? <ReviewEditor key={active.candidate.id + active.candidate.version} detail={active} api={api} onSaved={saved} /> : <section className={styles.empty}><span>↗</span><h2>{text('Start with the evidence', '从证据开始')}</h2><p>{text('Choose a candidate to inspect its source, confirm the companies, and review its theme placement.', '选择候选关系以检查来源、确认公司并审核主题归属。')}</p></section>}</div></div>
    </>}
  </main>;
}
