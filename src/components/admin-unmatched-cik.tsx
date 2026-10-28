'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/components/providers/auth-provider';
import { useLocale } from './providers/locale-provider';

type Result = { items: { id: string; name: string; symbol: string; active: boolean }[]; scanned: number; nextCursor: string | null };

export function AdminUnmatchedCik() {
  const { user, getIdToken } = useAuth();
  const { text, chinese } = useLocale();
  const [after, setAfter] = useState('');
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setResult(null); setError('');
    if (!user) return () => controller.abort();
    void (async () => {
      try {
        const token = await getIdToken();
        if (!token) throw new Error(chinese ? '请登录后继续。' : 'Sign in to continue.');
        const response = await fetch('/api/admin/unmatched-cik?' + new URLSearchParams({ after }), {
          headers: { authorization: `Bearer ${token}` }, signal: controller.signal,
        });
        if (!response.ok) throw new Error(chinese ? '无法加载公司，请重试。' : 'Unable to load companies. Try again.');
        const data: Result = await response.json();
        if (!controller.signal.aborted) setResult(data);
      } catch (failure) {
        if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : String(failure));
      }
    })();
    return () => controller.abort();
  }, [user, getIdToken, after, revision, chinese]);
  return <main className="mx-auto max-w-5xl px-4 py-10">
    <h1 className="text-3xl font-semibold">{text('Companies without a matched CIK', '尚未匹配 CIK 的公司')}</h1>
    <p className="mt-3 text-slate-400">{text('Review US company records without a saved SEC issuer match. Each batch checks up to 100 records, including inactive and unsupported listings.', '查看尚无已保存 SEC 发行人匹配的美国公司。每批检查最多 100 条记录，包括非活跃和暂不支持的股票。')}</p>
    {error ? <p role="alert" className="mt-6">{error}</p> : !result ? <p role="status" className="mt-6">{text('Loading…', '加载中…')}</p> : <>
      <p role="status" className="my-6">{text(`${result.items.length} unmatched · ${result.scanned} records checked in this batch`, `本批次检查 ${result.scanned} 条记录，${result.items.length} 家尚未匹配`)}</p>
      <ul className="space-y-3">{result.items.map(item => <li key={item.id} className="rounded-xl border border-cyan-500/20 bg-slate-900/60 p-4">
        <strong>{item.name}</strong><p className="mt-1 text-sm text-slate-400">{item.id} · {item.active ? text('Active', '活跃') : text('Inactive / unverified', '非活跃／待核实')}</p>
      </li>)}</ul>
      {!result.items.length && <p>{text('No unmatched companies in this batch.', '本批次没有尚未匹配的公司。')}</p>}
    </>}
    <div className="mt-6 flex gap-4">
      <button type="button" className="rounded-lg border border-cyan-500/30 px-4 py-2" onClick={() => { setAfter(''); setRevision(value => value + 1); }}>{text('Refresh from beginning', '从头刷新')}</button>
      {result?.nextCursor && <button type="button" className="rounded-lg border border-cyan-500/30 px-4 py-2" onClick={() => setAfter(result.nextCursor!)}>{text('Next batch', '下一批')}</button>}
    </div>
  </main>;
}
