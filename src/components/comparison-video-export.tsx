"use client";

import { useEffect, useRef, useState } from 'react';
import type { CompareData, CompareStyle } from '@/lib/compare';
import { useLocale } from './providers/locale-provider';
import styles from './stock-compare.module.css';

export function ComparisonVideoExport({ data, style, colors, onStart }: { data: CompareData; style: CompareStyle; colors?: string[]; onStart: () => void }) {
  const { text, locale } = useLocale();
  const [seconds, setSeconds] = useState(15), [progress, setProgress] = useState<number | null>(null), [message, setMessage] = useState('');
  const [download, setDownload] = useState<{ url: string; filename: string } | null>(null);
  const active = useRef<AbortController | null>(null);
  const downloadUrl = useRef<string | null>(null);
  useEffect(() => () => { const controller = active.current; active.current = null; controller?.abort(); if (downloadUrl.current) URL.revokeObjectURL(downloadUrl.current); }, []);

  async function exportVideo() {
    if (active.current) return;
    const controller = new AbortController(); active.current = controller;
    if (downloadUrl.current) { URL.revokeObjectURL(downloadUrl.current); downloadUrl.current = null; }
    setDownload(null);
    setProgress(0); setMessage(''); onStart();
    try {
      const { recordComparisonVideo } = await import('@/lib/ui/compare-video');
      const blob = await recordComparisonVideo({ data, style, colors, seconds, light: document.documentElement.dataset.theme === 'light', chinese: locale === 'zh-CN', signal: controller.signal, onProgress: value => { if (active.current === controller) setProgress(Math.floor(value * 100)); } });
      if (active.current !== controller || controller.signal.aborted) return;
      const url = URL.createObjectURL(blob), link = document.createElement('a');
      link.href = url; link.download = `YouAnalyst-${style}-${data.dates[0]}-${data.dates.at(-1)}.${blob.type.includes('mp4') ? 'mp4' : 'webm'}`;
      downloadUrl.current = url; setDownload({ url, filename: link.download });
      document.body.append(link); link.click(); link.remove();
      setMessage(text('Video ready. Your download has started.', '视频已就绪，下载已开始。'));
    } catch (error) {
      if (active.current !== controller) return;
      setMessage(error instanceof Error && error.name === 'AbortError' ? text('Video export cancelled.', '已取消视频导出。')
        : error instanceof Error && error.message === 'unsupported' ? text('Video export is unavailable in this browser. Try a current desktop browser.', '此浏览器不支持视频导出，请尝试使用最新版桌面浏览器。')
        : error instanceof Error && error.message === 'hidden' ? text('Export stopped because the tab was hidden. Keep this tab visible and try again.', '标签页被隐藏，导出已停止。请保持此标签页可见并重试。')
        : text('Unable to export the video. Please try again.', '无法导出视频，请重试。'));
    } finally {
      if (active.current === controller) { active.current = null; setProgress(null); }
    }
  }

  return <section className={styles.videoExport} aria-label={text('Export comparison video', '导出对比视频')}>
    <div><label>{text('Video duration', '视频时长')} <select value={seconds} disabled={progress !== null} onChange={event => setSeconds(Number(event.target.value))}>{[10, 15, 30].map(value => <option key={value} value={value}>{value}{text(' seconds', ' 秒')}</option>)}</select></label>
      <button type="button" title={text('MP4 where supported, otherwise WebM.', '支持时导出 MP4，否则导出 WebM。')} onClick={() => void exportVideo()} disabled={progress !== null}>{text('Export video', '导出视频')}</button>
      {progress !== null && <button type="button" onClick={() => active.current?.abort()}>{text('Cancel export', '取消导出')}</button>}
      {download && <a href={download.url} download={download.filename}>{text('Download video', '下载视频')}</a>}
    </div>
    <p>{text('720p · 30 fps · YouAnalyst watermark. Keep this tab visible.', '720p · 30 帧/秒 · YouAnalyst 水印。导出时保持标签页可见。')}</p>
    {progress !== null && <progress aria-label={text('Video export progress', '视频导出进度')} value={progress} max={100}/>}
    <p role="status">{progress !== null ? text(`Exporting video… ${progress}%`, `正在导出视频… ${progress}%`) : message}</p>
  </section>;
}
