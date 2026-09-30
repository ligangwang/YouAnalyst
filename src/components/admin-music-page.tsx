"use client";

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from './providers/auth-provider';
import { useLocale } from './providers/locale-provider';
import { MAX_TRACK_BYTES, MAX_TRACKS, trackUrl, type MusicPlaylist } from '@/lib/music/model';
import styles from './admin-music-page.module.css';

type Result = MusicPlaylist & { error?: string; warning?: string; cleanupPending?: string };
export function AdminMusicPage() {
  const { getIdToken } = useAuth();
  const { locale } = useLocale();
  const text = useCallback((en: string, zh: string) => locale === 'zh-CN' ? zh : en, [locale]);
  const [playlist, setPlaylist] = useState<MusicPlaylist | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState('');
  const [cleanup, setCleanup] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const request = useCallback(async (query = '', init: RequestInit = {}) => {
    const token = await getIdToken();
    if (!token) throw new Error(text('Sign in with an admin account.', '请使用管理员账号登录。'));
    const response = await fetch(`/api/admin/music${query}`, { ...init, cache: 'no-store', headers: { ...init.headers, Authorization: `Bearer ${token}` } });
    const data = await response.json() as Result;
    if (!response.ok) throw new Error(data.error || text('Unable to update music.', '无法更新音乐。'));
    return data;
  }, [getIdToken, text]);
  const load = useCallback(async () => {
    setBusy(true); setError('');
    try { setPlaylist(await request()); }
    catch (e) { setError(e instanceof Error ? e.message : text('Unable to load playlist.', '无法加载播放列表。')); }
    finally { setBusy(false); }
  }, [request, text]);
  useEffect(() => { void load(); }, [load]);

  async function upload(files: File[]) {
    if (!playlist || !files.length) return;
    if (playlist.tracks.length + files.length > MAX_TRACKS) { setError(text('Maximum 100 tracks.', '最多 100 首曲目。')); return; }
    if (files.some(file => !/\.mp3$/i.test(file.name) || !file.size || file.size > MAX_TRACK_BYTES)) {
      setError(text('Choose MP3 files up to 20 MB each.', '请选择每个不超过 20 MB 的 MP3 文件。')); return;
    }
    setBusy(true); setError(''); setMessage('');
    let current = playlist;
    let completed = 0;
    try {
      for (const file of files) {
        setMessage(text(`Uploading ${completed + 1} of ${files.length}: ${file.name}`, `正在上传 ${completed + 1}/${files.length}：${file.name}`));
        current = await request(`?filename=${encodeURIComponent(file.name)}`, { method: 'POST', body: file,
          headers: { 'Content-Type': 'audio/mpeg', 'If-Match': current.revision } });
        completed++;
        setPlaylist(current);
      }
      setMessage(text(`${completed} track(s) added. Changes are live.`, `已添加 ${completed} 首曲目，更改已生效。`));
    } catch (e) { setMessage(text(`${completed} track(s) added.`, `已添加 ${completed} 首曲目。`)); setError(e instanceof Error ? e.message : 'Upload failed'); }
    finally { setBusy(false); if (inputRef.current) inputRef.current.value = ''; }
  }
  async function change(method: 'PATCH' | 'DELETE', id?: string, ids?: string[]) {
    if (!playlist) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const data = await request(id ? `?id=${encodeURIComponent(id)}` : '', { method,
        headers: { 'Content-Type': 'application/json', 'If-Match': playlist.revision }, ...(ids ? { body: JSON.stringify({ ids }) } : {}) });
      setPlaylist(data); setConfirmDelete(''); setCleanup(data.cleanupPending ?? '');
      if (data.warning) setError(data.warning);
      else setMessage(text('Playlist saved. Changes are live.', '播放列表已保存，更改已生效。'));
    } catch (e) { setError(e instanceof Error ? e.message : 'Update failed'); }
    finally { setBusy(false); }
  }
  function move(index: number, offset: number) {
    const ids = playlist!.tracks.map(t => t.id);
    [ids[index], ids[index + offset]] = [ids[index + offset], ids[index]];
    void change('PATCH', undefined, ids);
  }

  return <main className={styles.page}>
    <Link href="/admin">← {text('Admin', '管理')}</Link>
    <h1>{text('Background music', '背景音乐')}</h1>
    <p>{text('Upload MP3s and arrange their play order. The tree and graph repeat the entire playlist. Music is off until a visitor enables it.', '上传 MP3 并调整播放顺序。树状图和关系图循环播放整个列表，访客开启后才会播放。')}</p>
    <p>{text('Changes reach open charts within one minute. No deployment needed.', '更改会在一分钟内同步到已打开的图表，无需部署。')}</p>
    <div className={styles.upload}>
      <label htmlFor="music-files">{text('Add MP3 files', '添加 MP3 文件')}</label>
      <input ref={inputRef} id="music-files" type="file" accept=".mp3,audio/mpeg" multiple disabled={busy || !playlist} onChange={e => void upload(Array.from(e.target.files ?? []))}/>
      <small>{text('Up to 20 MB per file · 100 tracks maximum', '每个文件最多 20 MB · 最多 100 首曲目')}</small>
    </div>
    <div className={styles.heading}><h2>{text('Playlist', '播放列表')} {playlist && `(${playlist.tracks.length})`}</h2>
      <button type="button" disabled={busy} onClick={() => void load()}>{text('Reload', '重新加载')}</button></div>
    {message && <p role="status">{message}</p>}
    {error && <p role="alert" className={styles.error}>{error} {cleanup && <button type="button" disabled={busy} onClick={() => void change('DELETE', cleanup)}>{text('Retry file removal', '重试删除文件')}</button>}</p>}
    {!playlist && busy && <p role="status">{text('Loading playlist…', '正在加载播放列表…')}</p>}
    {playlist?.tracks.length === 0 && <p>{text('The playlist is empty. Music is silent until you add a track.', '播放列表为空，添加曲目后才能播放音乐。')}</p>}
    <ol className={styles.list}>{playlist?.tracks.map((track, index) => <li key={track.id}>
      <div className={styles.track}><span className={styles.number}>{index + 1}</span><div><strong>{track.title}</strong><small>{(track.bytes / 1024 / 1024).toFixed(1)} MB</small></div></div>
      <audio controls preload="none" src={trackUrl(track.id)} aria-label={text(`Preview ${track.title}`, `试听 ${track.title}`)}/>
      <div className={styles.actions}>
        <button type="button" disabled={busy || index === 0} onClick={() => move(index, -1)} aria-label={text(`Move ${track.title} up`, `上移 ${track.title}`)}>↑</button>
        <button type="button" disabled={busy || index === playlist.tracks.length - 1} onClick={() => move(index, 1)} aria-label={text(`Move ${track.title} down`, `下移 ${track.title}`)}>↓</button>
        {confirmDelete === track.id ? <><button type="button" disabled={busy} onClick={() => void change('DELETE', track.id)}>{text('Confirm delete', '确认删除')}</button><button type="button" disabled={busy} onClick={() => setConfirmDelete('')}>{text('Cancel', '取消')}</button></>
          : <button type="button" disabled={busy} onClick={() => setConfirmDelete(track.id)} aria-label={text(`Delete ${track.title}`, `删除 ${track.title}`)}>{text('Delete', '删除')}</button>}
      </div>
    </li>)}</ol>
  </main>;
}
