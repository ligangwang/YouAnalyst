'use client';

import { useState } from 'react';
import { useLocale } from './providers/locale-provider';
import { LocalizedLink as Link } from './localized-link';
import { hierarchyHref, hierarchyPath, type HierarchyNode } from '@/lib/hierarchy/model';
import styles from './hierarchy-browser.module.css';
import type { BrowseCompany } from '@/lib/hierarchy/companies';

export function HierarchyBrowser({ kind, nodes, selectedId, companies = [], companiesUnavailable = false }: {
  kind: 'industries' | 'investment-themes'; nodes: HierarchyNode[]; selectedId: string;
  companies?: BrowseCompany[]; companiesUnavailable?: boolean;
}) {
  const { locale, text } = useLocale();
  const [search, setSearch] = useState('');
  const selected = nodes.find(node => node.id === selectedId);
  const path = selected ? hierarchyPath(nodes, selected.id) : [];
  const roots = nodes.filter(node => node.parentId === null).sort((a, b) => a.order - b.order);
  const children = nodes.filter(node => node.parentId === (selected?.id ?? null)).sort((a, b) => a.order - b.order);
  const query = search.trim().toLocaleLowerCase();
  const results = query ? nodes.filter(node => `${node.id} ${node.names.en} ${node.names['zh-CN']}`.toLocaleLowerCase().includes(query)) : [];
  const title = kind === 'industries' ? text('Industries', '行业分类') : text('Investment themes', '投资主题');
  const matches = selected ? companies.filter(company => company.nodeIds.includes(selected.id)).sort((a,b) => a.name.localeCompare(b.name, locale)) : [];
  return <main className={styles.page}>
    <nav className={styles.tabs} aria-label={text('Browse classifications', '浏览分类')}>
      <Link href="/investment-themes" aria-current={kind === 'investment-themes' ? 'page' : undefined}>{text('Investment themes', '投资主题')}</Link>
      <Link href="/industries" aria-current={kind === 'industries' ? 'page' : undefined}>{text('Industries', '行业分类')}</Link>
    </nav>
    <header className={styles.header}>
      <p className={styles.eyebrow}><span>YouAnalyst</span> / {text('Discover', '探索')}</p>
      <h1>{title}</h1>
      <p>{kind === 'industries' ? text('Explore SIC and CNI classifications by name or code.', '按名称或代码浏览 SIC 和 CNI 行业分类。') : text('Explore AI, Robotics and Space, from the big picture to the businesses behind them.', '探索人工智能、机器人与航天，从整体主题深入各个产业环节。')}</p>
    </header>
    <div className={styles.layout}>
      <aside className={styles.sidebar}>
        <label htmlFor="hierarchy-search">{text('Find a category', '查找分类')}</label>
        <input id="hierarchy-search" type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder={text('Name or code…', '名称或代码…')} />
        {query ? <>
          <p role="status">{results.length} {text('matches', '个结果')}</p>
          <ul className={styles.results}>{results.map(node => <li key={node.id}>
            <Link href={hierarchyHref(kind, node.id)} aria-current={selected?.id === node.id ? 'page' : undefined} onClick={() => setSearch('')}>
              {node.names[locale]}<small>{node.code ?? node.id}</small>
            </Link>
          </li>)}</ul>
          {!results.length && <p>{text('No matching categories. Try a different name or code.', '没有匹配的分类，请尝试其他名称或代码。')}</p>}
        </> : <nav aria-label={text('Hierarchy', '分类层级')}><ul className={styles.results}>
          {roots.map(root => <li key={root.id}>
            <Link href={hierarchyHref(kind, root.id)} aria-current={selected?.id === root.id ? 'page' : undefined}>{root.names[locale]}</Link>
            {path.some(node => node.id === root.id) && <ul>{nodes.filter(node => node.parentId === root.id).sort((a,b) => a.order-b.order).map(node => <li key={node.id}>
              <Link href={hierarchyHref(kind, node.id)} aria-current={path.some(item => item.id === node.id) ? 'location' : undefined}>{node.names[locale]}</Link>
            </li>)}</ul>}
          </li>)}
        </ul></nav>}
      </aside>
      <section className={styles.detail} aria-labelledby="category-title">
        <nav className={styles.breadcrumbs} aria-label={text('Breadcrumb', '当前位置')}>
          <Link href={`/${kind}`}>{text('All', '全部')}</Link>
          {path.map(node => <span key={node.id}> / <Link href={hierarchyHref(kind, node.id)} aria-current={selected?.id === node.id ? 'page' : undefined}>{node.names[locale]}</Link></span>)}
        </nav>
        <h2 id="category-title">{selected?.names[locale] ?? (selectedId ? text('Category not found', '未找到分类') : text('Choose a category', '选择分类'))}</h2>
        {selected?.code && <p className={styles.code}>{selected.id.split(':')[0]} · {selected.code}</p>}
        {selected?.descriptions && <p>{selected.descriptions[locale]}</p>}
        {selectedId && !selected && <p role="status">{text('This link does not match an available category. Browse below or search by name or code.', '此链接未匹配到可用分类，请浏览下方分类或按名称、代码搜索。')}</p>}
        <div className={styles.cards}>{children.map(node => <Link key={node.id} href={hierarchyHref(kind, node.id)} className={styles.card}>
          <span>{node.names[locale]} <span aria-hidden="true">↗</span></span>
          <small>{node.code ?? text('Explore category', '浏览分类')}</small>
        </Link>)}</div>
        {selected && children.length === 0 && <p>{text('This is the most specific category in this catalog.', '这是当前目录中最细的分类。')}</p>}
        {selected && <section className={styles.companyList} aria-labelledby="category-companies">
          <h3 id="category-companies">{text('Companies tracked by YouAnalyst', 'YouAnalyst 跟踪的公司')}{!companiesUnavailable && ` · ${matches.length}`}</h3>
          <p>{text('Includes companies assigned to this category or its descendants. Coverage is limited to our supported investment themes.', '包含归属于此分类或其下级分类的公司，覆盖范围限于我们支持的投资主题。')}</p>
          {companiesUnavailable ? <p role="status">{text('Company listings are temporarily unavailable.', '公司列表暂时无法加载。')}</p> : matches.length ? <ul>{matches.map(company => <li key={company.id}><Link href={company.href}>{company.name} <span aria-hidden="true">↗</span></Link></li>)}</ul> : <p>{text('No tracked companies are currently assigned here.', '当前没有已跟踪的公司归属于此分类。')}</p>}
        </section>}
        {selected && kind === 'investment-themes' && ['ai', 'robotics', 'space'].includes(path[0]?.id) && <Link className={styles.explore} href={`/?theme=${path[0].id}`}>{text('Explore companies in this theme', '查看此主题的公司')} →</Link>}
        {kind === 'industries' && <p className={styles.note}>{text('SIC covers the SEC issuer codes in our catalog. CNI covers categories present in our company directory. These catalogs are not exhaustive copies of every industry standard.', 'SIC 目录覆盖我们收录的 SEC 发行人代码，CNI 目录覆盖公司名录中已有的分类，并非完整收录所有行业标准。')}</p>}
      </section>
    </div>
  </main>;
}
