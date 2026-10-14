type ChartIconName = 'research' | 'link' | 'candles' | 'line' | 'averages' | 'events' | 'volume' | 'turnover' | 'macd' | 'kdj' | 'boll' | 'help' | 'reset';

const paths: Record<ChartIconName, string> = {
  research: 'M12 5v15M12 5C9 3 5 3 2 4v15c3-1 7-1 10 1 3-2 7-2 10-1V4c-3-1-7-1-10 1Z',
  link: 'm10 13 4-4M8 16l-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0M16 8l1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0',
  candles: 'M6 3v4m0 8v6M3 7h6v8H3ZM18 3v8m0 7v3m-3-10h6v7h-6Z',
  line: 'M3 3v18h18M5 16l5-6 4 3 7-9',
  averages: 'm12 3 10 5-10 5L2 8ZM2 12l10 5 10-5M2 16l10 5 10-5',
  events: 'm12 2 2.5 6.5L21 11l-6.5 2.5L12 20l-2.5-6.5L3 11l6.5-2.5ZM20 2v4m-2-2h4',
  volume: 'M3 3v18h18M6 20v-6h3v6m3 0V9h3v11m3 0V5h3v15',
  turnover: 'M8 3c-4 0-6 2-6 4s2 4 6 4 6-2 6-4-2-4-6-4ZM2 7v5c0 2 2 4 6 4m-6-4v5c0 2 2 4 6 4m8-12c-4 0-6 2-6 4s2 4 6 4 6-2 6-4-2-4-6-4Zm-6 4v5c0 2 2 4 6 4s6-2 6-4v-5',
  macd: 'M2 12h20M4 12v6m4-6v3m4-8v5m4-10v10m4-6v6M2 9c5-8 8 10 13 0s5-5 7-6',
  kdj: 'M2 7c5-7 6 16 11 7s6-11 9-4M2 15c4 7 8-13 13-6s4 9 7 6M2 12c5 0 6 6 11 0s6-5 9 0',
  boll: 'M2 5c6 0 8 7 12 5s5-6 8-6M2 12c6 0 8 4 12 2s5-3 8-3M2 19c6 0 8 1 12-1s5 0 8 0',
  help: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM9 8a3 3 0 0 1 6 0c0 2-3 2-3 5m0 4h.01',
  reset: 'M3 10a9 9 0 1 1 2 8M3 3v7h7',
};

export function ChartToolbarIcon({name}: {name: ChartIconName}) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d={paths[name]}/></svg>;
}
