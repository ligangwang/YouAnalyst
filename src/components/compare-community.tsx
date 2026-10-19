"use client";

import { useEffect, useRef, useState } from "react";
import { comparePath } from "@/lib/compare";
import type { CommunityComparison, ComparisonComment, SharedComparison } from "@/lib/compare-community";
import { compareEmbedPath, comparisonEmbedHeight } from "@/lib/compare-embed";
import { localizedPath } from "@/lib/ui/i18n/urls";
import { useOptionalAuth } from "@/components/providers/auth-provider";
import { useLocale } from "./providers/locale-provider";
import { LocalizedLink as Link } from "./localized-link";
import { RelativeTime } from "./relative-time";
import styles from "./compare-community.module.css";

async function payload(response: Response) {
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Please retry.");
  return result;
}
function signIn(next: string) { return `/auth?${new URLSearchParams({ next })}`; }
function newRequestId() { return Array.from(crypto.getRandomValues(new Uint8Array(24)), byte => byte.toString(16).padStart(2, "0")).join(""); }

export function ComparisonCredit({ post }: { post: CommunityComparison }) {
  const { text } = useLocale();
  return <aside className={styles.credit}>
    <span>{text("Community favorite", "社区精选")} · {text("Net likes", "净赞数")}: {post.netLikes}</span>
    <strong>{post.title}</strong>
    <p>{text("Submitted by", "由以下用户分享")} <Link href={`/analysts/${post.userId}`}>{post.authorName}</Link> · <Link href={`/compare/community/${post.id}`}>{text("Replay & discussion", "回放与讨论")}</Link></p>
  </aside>;
}

function VoteButtons({ post, onChange }: { post: CommunityComparison; onChange: (post: CommunityComparison) => void }) {
  const auth = useOptionalAuth(), { text, locale } = useLocale();
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const locked = useRef(false);
  async function vote(value: -1 | 1) {
    if (locked.current || auth?.loading) return;
    if (!auth?.user) { window.location.assign(signIn(localizedPath(`/compare/community/${post.id}`, locale))); return; }
    locked.current = true; setBusy(true); setError("");
    try {
      const token = await auth.getIdToken();
      if (!token) throw new Error(text("Sign in to vote.", "登录后投票。"));
      const result = await fetch(`/api/compare/community/${post.id}/vote`, { method: "POST", headers: { authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ value: post.viewerVote === value ? 0 : value }), signal: AbortSignal.timeout(12000) }).then(payload);
      onChange({ ...post, ...result });
    } catch (err) { setError(err instanceof Error ? err.message : text("Could not save vote. Please retry.", "投票保存失败，请重试。")); }
    finally { locked.current = false; setBusy(false); }
  }
  return <div><div className={styles.votes} role="group" aria-label={text("Rate this comparison", "评价此对比")}>
    <button type="button" disabled={busy || auth?.loading} aria-pressed={post.viewerVote === 1} onClick={() => void vote(1)}>{text("Like", "赞")} {post.likes}</button>
    <button type="button" disabled={busy || auth?.loading} aria-pressed={post.viewerVote === -1} onClick={() => void vote(-1)}>{text("Dislike", "踩")} {post.dislikes}</button>
    <span>{text("Net likes", "净赞数")}: {post.netLikes}</span>
  </div>{error && <p role="alert">{error}</p>}</div>;
}

export function ComparisonPostCard({ post, onChange, full = false }: { post: CommunityComparison; onChange: (post: CommunityComparison) => void; full?: boolean }) {
  const { text, locale } = useLocale();
  const { config, theme } = post.comparison;
  return <article className={styles.card}>
    <h3><Link href={`/compare/community/${post.id}`}>{post.title}</Link></h3>
    <p className={styles.meta}>{text("By", "作者")} <Link href={`/analysts/${post.userId}`}>{post.authorName}</Link> · <RelativeTime value={post.createdAt}/></p>
    <p>{config.symbols.join(" · ")}</p><p className={styles.meta}>{config.start} → {config.end} · {config.style === "bar" ? text("Bar", "条形") : text("Line", "折线")} · {theme === "light" ? text("Light", "浅色") : text("Dark", "深色")}</p>
    {post.body && <p className={styles.message}>{post.body}</p>}
    {full && <iframe className={styles.replay} src={localizedPath(compareEmbedPath(config, theme), locale)} title={text(`Replay ${post.title}`, `回放：${post.title}`)} height={comparisonEmbedHeight(config.symbols.length)} loading="lazy"/>}
    <VoteButtons post={post} onChange={onChange}/>
    <div className={styles.links}><Link href={`/compare/community/${post.id}`}>{text("Replay & comments", "回放与评论")} ({post.commentCount})</Link><Link href={comparePath(config)}>{text("Make your own version", "创建你的版本")}</Link></div>
  </article>;
}

export function ComparisonCommunity({ comparison, ready }: { comparison: SharedComparison; ready: boolean }) {
  const auth = useOptionalAuth();
  return <CommunityBoard key={auth?.user?.uid ?? "guest"} comparison={comparison} ready={ready}/>;
}
function CommunityBoard({ comparison, ready }: { comparison: SharedComparison; ready: boolean }) {
  const auth = useOptionalAuth(), { text, locale } = useLocale();
  const [posts, setPosts] = useState<CommunityComparison[]>([]), [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false), [publishError, setPublishError] = useState(""), [published, setPublished] = useState("");
  const submission = useRef<{ fingerprint: string; requestId: string } | null>(null), publishing = useRef(false), paging = useRef(false);
  const getIdToken = auth?.getIdToken;
  useEffect(() => {
    if (auth?.loading) return;
    const controller = new AbortController();
    void (async () => {
      setLoading(true); setError("");
      try {
        const token = await getIdToken?.();
        const result = await fetch("/api/compare/community", { headers: token ? { authorization: `Bearer ${token}` } : {}, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]), cache: "no-store" }).then(payload);
        if (!controller.signal.aborted) { setPosts(result.items); setNextCursor(result.nextCursor); }
      } catch { if (!controller.signal.aborted) setError(text("Community comparisons could not be loaded. Please retry.", "社区对比加载失败，请重试。")); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => controller.abort();
    // Locale changes remount the localized page; loading depends on the account.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth?.loading, getIdToken, attempt]);
  async function more() {
    if (!nextCursor || paging.current) return;
    paging.current = true; setLoading(true); setError("");
    try {
      const token = await getIdToken?.();
      const result = await fetch(`/api/compare/community?${new URLSearchParams({ cursor: nextCursor })}`, { headers: token ? { authorization: `Bearer ${token}` } : {}, signal: AbortSignal.timeout(12000), cache: "no-store" }).then(payload);
      setPosts(current => [...current, ...result.items].filter((post, index, all) => all.findIndex(row => row.id === post.id) === index)); setNextCursor(result.nextCursor);
    } catch { setError(text("Could not load more comparisons. Please retry.", "无法加载更多对比，请重试。")); }
    finally { paging.current = false; setLoading(false); }
  }
  async function publish(form: HTMLFormElement) {
    if (publishing.current || !auth?.user || !ready) return;
    publishing.current = true; setBusy(true); setPublishError("");
    const fields = new FormData(form);
    const input = { title: String(fields.get("title")), body: String(fields.get("body")), comparison };
    const fingerprint = JSON.stringify(input);
    try {
      if (submission.current?.fingerprint !== fingerprint) submission.current = { fingerprint, requestId: newRequestId() };
      const token = await auth.getIdToken();
      if (!token) throw new Error(text("Sign in to publish.", "登录后发布。"));
      const result = await fetch("/api/compare/community", { method: "POST", headers: { authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ ...input, requestId: submission.current.requestId }), signal: AbortSignal.timeout(20000) }).then(payload);
      setPublished(result.id); setAttempt(value => value + 1);
    } catch (err) { setPublishError(err instanceof Error ? err.message : text("Could not publish. Please retry.", "发布失败，请重试。")); }
    finally { publishing.current = false; setBusy(false); }
  }
  return <section id="comparison-community" className={styles.community} aria-label={text("Comparison community", "对比社区")}>
    <h2>{text("Community comparisons", "社区对比")}</h2>
    <p>{text("Share a replay, discover a different period, and discuss it together. Ranked by likes minus dislikes; the highest score becomes the default Compare chart. Equal scores favor the newest post. Rankings may take 30 seconds to refresh.", "分享回放，发现不同时期的表现，一起交流。按赞数减踩数排名，得分最高的作品成为对比页默认图表。同分优先展示最新分享，排名最多延迟 30 秒刷新。")}</p>
    <details className={styles.composer}><summary>{text("Post this comparison", "分享此对比")}</summary>
      {!auth?.user ? <p><Link href={signIn(localizedPath(comparePath(comparison.config), locale) + "#comparison-community")}>{text("Sign in or create an account to post", "登录或注册以发布")}</Link></p> : published ? <p role="status">{text("Published to the community.", "已发布到社区。")} <Link href={`/compare/community/${published}`}>{text("View your post", "查看你的分享")}</Link></p> : <form onSubmit={event => { event.preventDefault(); void publish(event.currentTarget); }}>
        <fieldset disabled={busy || !ready}>
          <p>{comparison.config.symbols.join(" · ")} · {comparison.config.start} → {comparison.config.end}</p>
          <label>{text("Title", "标题")}<input name="title" required maxLength={120} defaultValue={comparison.config.symbols.join(" vs ")}/></label>
          <label>{text("Message (optional)", "留言（可选）")}<textarea name="body" maxLength={2000} rows={3}/></label>
          <p>{text("Your post, author credit, stocks, dates, colors and chart style will be public. A public profile is required.", "你的分享、作者信息、股票、日期、颜色和图表样式将公开展示，需要使用公开个人资料。")}</p>
          <button type="submit">{busy ? text("Publishing…", "发布中…") : text("Publish comparison", "发布对比")}</button>
        </fieldset>
        {publishError && <p role="alert">{publishError}</p>}
      </form>}
    </details>
    {loading && !posts.length && <p role="status">{text("Loading community comparisons…", "正在加载社区对比…")}</p>}
    {error && <p role="alert">{error} <button type="button" disabled={loading} onClick={() => setAttempt(value => value + 1)}>{text("Retry", "重试")}</button></p>}
    {!loading && !error && !posts.length && <p>{text("No public comparisons on this page yet. Share yours to get the conversation started.", "本页暂无公开对比，欢迎分享你的作品，开启交流。")}</p>}
    <div className={styles.grid}>{posts.map(post => <ComparisonPostCard key={post.id} post={post} onChange={updated => setPosts(current => current.map(row => row.id === updated.id ? updated : row).sort((a, b) => b.netLikes - a.netLikes || b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)))}/>)}</div>
    {nextCursor && <button type="button" disabled={loading} onClick={() => void more()}>{text("Load more comparisons", "加载更多对比")}</button>}
  </section>;
}

export function CommunityComparisonDetail({ id }: { id: string }) {
  const auth = useOptionalAuth();
  return <ComparisonDiscussion key={`${id}:${auth?.user?.uid ?? "guest"}`} id={id}/>;
}
function ComparisonDiscussion({ id }: { id: string }) {
  const auth = useOptionalAuth(), { text, locale } = useLocale();
  const [post, setPost] = useState<CommunityComparison | null>(null), [comments, setComments] = useState<ComparisonComment[]>([]);
  const [cursor, setCursor] = useState<string | null>(null), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0), [content, setContent] = useState("");
  const request = useRef<{ content: string; requestId: string } | null>(null), locked = useRef(false);
  const getIdToken = auth?.getIdToken;
  useEffect(() => {
    if (auth?.loading) return;
    const controller = new AbortController();
    void (async () => {
      setLoading(true); setError("");
      try {
        const token = await getIdToken?.();
        const options: RequestInit = { headers: token ? { authorization: `Bearer ${token}` } : undefined, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]), cache: "no-store" };
        const [post, discussion] = await Promise.all([fetch(`/api/compare/community/${id}`, options).then(payload), fetch(`/api/compare/community/${id}/comments`, options).then(payload)]);
        if (!controller.signal.aborted) { setPost(post); setComments(discussion.items); setCursor(discussion.nextCursor); }
      } catch (err) { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : text("Could not load discussion.", "讨论加载失败。")); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, auth?.loading, getIdToken, attempt]);
  async function comment() {
    if (locked.current || !auth?.user || !content.trim()) return;
    locked.current = true; setBusy(true); setError("");
    try {
      if (request.current?.content !== content) request.current = { content, requestId: newRequestId() };
      const token = await auth.getIdToken();
      if (!token) throw new Error(text("Sign in to comment.", "登录后评论。"));
      const result = await fetch(`/api/compare/community/${id}/comments`, { method: "POST", headers: { authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(request.current), signal: AbortSignal.timeout(12000) }).then(payload) as ComparisonComment;
      setComments(current => [result, ...current.filter(row => row.id !== result.id)]); setContent(""); request.current = null;
      setPost(current => current ? { ...current, commentCount: current.commentCount + Number(!comments.some(row => row.id === result.id)) } : current);
    } catch (err) { setError(err instanceof Error ? err.message : text("Could not save comment.", "评论保存失败。")); }
    finally { locked.current = false; setBusy(false); }
  }
  async function moreComments() {
    if (!cursor || locked.current) return;
    locked.current = true; setBusy(true); setError("");
    try {
      const result = await fetch(`/api/compare/community/${id}/comments?${new URLSearchParams({ cursor })}`, { signal: AbortSignal.timeout(12000), cache: "no-store" }).then(payload);
      setComments(current => [...current, ...result.items].filter((row, i, all) => all.findIndex(comment => comment.id === row.id) === i)); setCursor(result.nextCursor);
    } catch { setError(text("Could not load more comments. Please retry.", "无法加载更多评论，请重试。")); }
    finally { locked.current = false; setBusy(false); }
  }
  return <main className={styles.detail}>
    <Link href="/compare#comparison-community">← {text("Community comparisons", "社区对比")}</Link><h1>{text("Community replay & discussion", "社区回放与讨论")}</h1>
    {loading && <p role="status">{text("Loading…", "加载中…")}</p>}
    {error && <p role="alert">{error} <button type="button" onClick={() => setAttempt(value => value + 1)}>{text("Retry", "重试")}</button></p>}
    {post && <><ComparisonPostCard full post={post} onChange={setPost}/><section className={styles.discussion} aria-label={text("Comments", "评论")}>
      <h2>{text("Comments", "评论")} ({post.commentCount})</h2>
      {auth?.user ? <form onSubmit={event => { event.preventDefault(); void comment(); }}><label>{text("Add a public comment", "添加公开评论")}<textarea required maxLength={2000} value={content} disabled={busy} onChange={event => setContent(event.target.value)}/></label><button type="submit" disabled={busy || !content.trim()}>{text("Post comment", "发表评论")}</button></form> : <p><Link href={signIn(localizedPath(`/compare/community/${id}`, locale))}>{text("Sign in or create an account to comment", "登录或注册以评论")}</Link></p>}
      {!comments.length && <p>{text("No comments yet. Start the discussion.", "暂无评论，欢迎开启讨论。")}</p>}
      {comments.map(comment => <article className={styles.comment} key={comment.id}><p><Link href={`/analysts/${comment.userId}`}>{comment.authorName}</Link> · <RelativeTime value={comment.createdAt}/></p><p className={styles.message}>{comment.content}</p></article>)}
      {cursor && <button type="button" disabled={busy} onClick={() => void moreComments()}>{text("Load more comments", "加载更多评论")}</button>}
    </section></>}
  </main>;
}
