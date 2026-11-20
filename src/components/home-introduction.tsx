"use client";

import { useEffect, useState } from 'react';
import { LocalizedLink } from './localized-link';
import { useOptionalAuth } from './providers/auth-provider';
import { useLocale } from './providers/locale-provider';
import { localizedPath } from '@/lib/ui/i18n/urls';
import styles from './home-introduction.module.css';

type Company = {id:string; symbol:string; name:string; path:string};
const examples: Company[] = [
  {id:'US:NVDA',symbol:'NVDA',name:'NVIDIA',path:'/company/NVDA'},
  {id:'US:AMD',symbol:'AMD',name:'AMD',path:'/company/AMD'},
  {id:'US:MSFT',symbol:'MSFT',name:'Microsoft',path:'/company/MSFT'},
];
export function HomeIntroduction() {
  const { text, locale } = useLocale();
  const auth = useOptionalAuth();
  const member = !!auth?.user && !auth.user.isAnonymous && !auth.loading;
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<{query:string; items:Company[]}>({query:'',items:[]});
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState(examples[0]);
  useEffect(() => {
    if (!query.trim()) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setFailed(false);
      void fetch('/api/public/companies?' + new URLSearchParams({q:query}), {signal:controller.signal})
        .then(async response => { if (!response.ok) throw Error(); return response.json(); })
        .then(data => { if (!controller.signal.aborted) setResults({query,items:data.items}); })
        .catch(() => { if (!controller.signal.aborted) setFailed(true); });
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query]);
  const signIn = (path:string) => {
    const url = new URL(path, 'https://youanalyst.com');
    const next = localizedPath(url.pathname,locale) + url.search;
    return member ? next : '/auth?' + new URLSearchParams({next,lang:locale});
  };
  return (
    <main className={styles.home} data-testid="home-introduction">
      <header className={styles.intro}>
        <span className={styles.eyebrow}>{text('YOUR RESEARCH WORKSPACE', '你的投资研究工作台')}</span>
        <h1>{text('Start with a company.', '从一家公司开始。')}</h1>
        <p>{text('Find a company. Explore the connections. Compare your ideas.', '搜索公司，探索关联，对比你的投资思路。')}</p>
        <div className={styles.actions}>
          <LocalizedLink href={signIn('/?view=graph')} prefetch={false} className={styles.primary}>{text('Open your workspace', '打开你的工作台')} <span aria-hidden="true">↗</span></LocalizedLink>
          <LocalizedLink href="/how-it-works" prefetch={false}>{text('How it works', '了解使用方法')}</LocalizedLink>
        </div>
      </header>
      <section className={styles.workspace} aria-label={text('Workspace preview', '工作台预览')}>
        <div className={styles.toolbar}><span>{text('Workspace preview', '工作台预览')}</span><span className={styles.badge}>{text('Sample content', '示例内容')}</span></div>
        <div className={styles.panels}>
          <section className={styles.panel}>
            <h2>{text('Find a company', '搜索公司')}</h2>
            <label className={styles.search}>
              <span className={styles.srOnly}>{text('Search company', '搜索公司')}</span>
              <input type="search" value={query} maxLength={100} onChange={e => setQuery(e.target.value)} placeholder={text('Company name or ticker', '公司名称或股票代码')} />
            </label>
            {query.trim() ? <div className={styles.results} aria-live="polite">
              {failed ? <p>{text('Search unavailable. Try again.', '暂时无法搜索，请重试。')}</p> : results.query !== query ? <p>{text('Searching…', '正在搜索…')}</p> : results.items.length ? results.items.map(item => <button key={item.id} onClick={() => {setSelected(item);setQuery('');}}><strong>{item.symbol}</strong><span>{item.name}</span></button>) : <p>{text('No match. Try a ticker such as NVDA.', '没有匹配项，试试 NVDA 等代码。')}</p>}
            </div> : <div className={styles.chips}>{examples.map(item => <button key={item.id} aria-pressed={selected.id === item.id} onClick={() => setSelected(item)}>{item.symbol}</button>)}</div>}
            <div className={styles.company}>
              <span className={styles.eyebrow}>{text('Company preview', '公司预览')}</span>
              <h3>{selected.name}</h3><span>{selected.id}</span>
              <p>{text('Research its business, relationships and source documents in your member workspace.', '在会员工作台中研究公司业务、关联及来源文件。')}</p>
              <LocalizedLink href={signIn(selected.path)} prefetch={false}>{member ? text('Open research', '查看研究') : text('Sign in to research', '登录查看研究')} →</LocalizedLink>
            </div>
          </section>
          <section className={styles.panel}>
            <h2>{text('Compare ideas', '对比投资思路')}</h2>
            <div className={styles.legend}>{examples.map(item => <span key={item.id}>● {item.symbol}</span>)}</div>
            <svg className={styles.chart} viewBox="0 0 420 160" role="img" aria-label={text('Illustrative comparison chart, not market data', '示意对比图，非市场数据')}>
              <path d="M10 30H410M10 80H410M10 130H410" stroke="currentColor" opacity=".12" fill="none"/>
              <path d="M10 130L65 111L120 119L175 78L230 88L285 40L340 51L410 18" stroke="#0891b2" strokeWidth="3" fill="none"/>
              <path d="M10 130L65 123L120 102L175 114L230 95L285 104L340 71L410 62" stroke="#8b5cf6" strokeWidth="3" fill="none"/>
              <path d="M10 130L65 133L120 119L175 122L230 109L285 112L340 97L410 88" stroke="#d97706" strokeWidth="3" fill="none"/>
            </svg>
            <p className={styles.caption}>{text('Illustrative preview · not live prices or historical returns.', '示意预览 · 非实时价格或历史收益。')}</p>
            <p>{text('Choose companies and a time range to explore their performance side by side.', '选择公司与时间范围，并排比较它们的表现。')}</p>
            <LocalizedLink href={signIn('/compare')} prefetch={false}>{member ? text('Open comparison', '开始对比') : text('Sign in to compare', '登录开始对比')} →</LocalizedLink>
          </section>
        </div>
      </section>
      <section className={styles.videoPreview} aria-labelledby="home-video-title">
        <div>
          <h2 id="home-video-title">{text('Turn your market view into a video', '把你的投资观点做成视频')}</h2>
          <p>{text('Compare stocks, export an animated chart, and share it on social media.', '比较股票，导出动态图表，再分享到社交媒体。')}</p>
          <LocalizedLink href={signIn('/compare')} prefetch={false} className={styles.primary}>
            {member ? text('Create a comparison video', '制作对比视频') : text('Sign in to make a video', '登录制作视频')}
            <span aria-hidden="true">↗</span>
          </LocalizedLink>
        </div>
        <figure>
          <video
            aria-label={text('Sample NVIDIA and AMD comparison video', '英伟达与 AMD 对比视频示例')}
            aria-describedby="home-video-caption"
            width={1280}
            height={720}
            controls
            playsInline
            preload="none"
            poster="/previews/stock-comparison-v1.webp"
          >
            <source src="/previews/stock-comparison-v1.mp4" type="video/mp4" />
            <a href="/previews/stock-comparison-v1.mp4">{text('Download the sample video', '下载视频示例')}</a>
          </video>
          <figcaption id="home-video-caption">{text('15-second example · NVIDIA and AMD historical price returns', '15 秒示例 · 英伟达与 AMD 的历史股价回报')}</figcaption>
        </figure>
      </section>
      <section className={styles.samples} aria-label={text('Sample analyses', '分析示例')}>
        <div><h2>{text('A question worth exploring', '值得探索的问题')}</h2><p>{text('Three sample research starting points. Full evidence and current analysis are available to members.', '三个研究思路示例。会员可查看完整依据和最新分析。')}</p></div>
        <div className={styles.sampleGrid}>
          {[
            ['NVDA','Where could growth meet a bottleneck?','增长可能在哪里遇到瓶颈？','Start with demand, manufacturing capacity and dependencies. Then check the source documents.','从需求、制造产能和依赖关系入手，再核查来源文件。'],
            ['AMD','How would you test a competitive advantage?','如何检验竞争优势？','Compare product positioning and customer exposure before forming a view.','形成观点前，先比较产品定位及客户分布。'],
            ['MSFT','What connects investment to future demand?','投资与未来需求有何关联？','Separate spending plans from realized outcomes and look for confirming evidence.','区分支出计划与实际成果，并寻找佐证。'],
          ].map(([ticker,en,zh,body,bodyZh]) => <article key={ticker}><span className={styles.eyebrow}>{ticker} · {text('Sample', '示例')}</span><h3>{text(en,zh)}</h3><p>{text(body,bodyZh)}</p></article>)}
        </div>
      </section>
      <p className={styles.members}>{text('Full company research, live comparisons and the interactive map require a member account.', '完整公司研究、实时对比和交互关系图仅限注册会员查看。')}</p>
      <LocalizedLink href="/about" prefetch={false} className={styles.about}>{text('About YouAnalyst', '关于 YouAnalyst')}</LocalizedLink>
    </main>
  );
}
