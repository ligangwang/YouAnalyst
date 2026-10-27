/** Extract a complete section only when both unambiguous boundaries exist.
 * Do not silently treat a bounded prefix or a table of contents as complete. */
export function completeAnnualSection(text:string,market:'US'|'CN_A'):string|null {
  if(typeof text!=='string'||text.length>1_000_000)return null;
  const start=market==='US'?/^\s*item\s+1\s*[.\-:]?\s*business\s*$/gim:/^\s*第[三四]节\s*管理层讨论与分析\s*$/gm;
  const end=market==='US'?/^\s*item\s+1a\s*[.\-:]?\s*risk\s+factors\s*$/gim:/^\s*第[四五]节\s*(?:公司治理|环境与社会责任)\s*$/gm;
  const starts=[...text.matchAll(start)], ends=[...text.matchAll(end)], candidates:string[]=[];
  for(const a of starts){
    const first=ends.find(b=>b.index!>a.index!);
    if(!first)continue;
    const section=text.slice(a.index,first.index).trim();
    // Reject tables of contents and ambiguous repeated headings.
    if(section.length>=1000 && !starts.some(b=>b.index!>a.index! && b.index!<first.index!))candidates.push(section);
  }
  return candidates.length===1?candidates[0]:null;
}
