"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { Post } from "@/lib/posts/model";
import { useAuth } from "@/components/providers/auth-provider";
import { useLocale } from "./providers/locale-provider";
import { localizedPath } from "@/lib/i18n/urls";

type Props = { ticker?: string; predictionId?: string; postId?: string; userId?: string };
export function CompanyPosts(props: Props) {
  const { user } = useAuth();
  return <PostHistory key={[user?.uid, props.ticker, props.predictionId, props.postId, props.userId].join("|")} {...props} />;
}
function PostHistory({ ticker, predictionId, postId, userId }: Props) {
  const { getIdToken, user, loading } = useAuth();
  const { text, locale } = useLocale();
  const [posts, setPosts] = useState<Array<Post & { id: string }>>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [pending, setPending] = useState(true);
  useEffect(() => {
    if (loading) return;
    let canceled = false;
    setPending(true); setError(false);
    void (async () => {
      try {
        const token = await getIdToken();
        const query = new URLSearchParams(predictionId ? { predictionId } : ticker ? { ticker } : { userId: userId ?? "" });
        if (cursor) query.set("cursor", cursor);
        const response = await fetch(postId ? `/api/posts/${postId}` : `/api/posts?${query}`, { headers: token ? { authorization: `Bearer ${token}` } : undefined });
        if (!response.ok) throw new Error();
        const result = await response.json();
        if (!canceled) {
          const rows = postId ? [result] : result.items.filter((post: Post) => !predictionId || !post.initial);
          setPosts(current => cursor ? [...current, ...rows].filter((post, index, all) => all.findIndex(p => p.id === post.id) === index) : rows);
          setNextCursor(result.nextCursor ?? null);
        }
      } catch { if (!canceled) setError(true); }
      finally { if (!canceled) setPending(false); }
    })();
    return () => { canceled = true; };
  }, [ticker, predictionId, postId, userId, user?.uid, loading, getIdToken, cursor]);
  return <section className="my-6 rounded-xl border border-white/10 p-5">
    <div className="flex flex-wrap justify-between gap-3"><h2 className="text-xl font-semibold">{text(predictionId ? "Research updates" : "Company articles", predictionId ? "研究更新" : "公司文章")}</h2>
      {ticker && <Link className="text-cyan-300" href={localizedPath(`/predictions/new?ticker=${encodeURIComponent(ticker)}`, locale)}>{text("Publish an idea", "发布观点")}</Link>}
    </div>
    {pending && !posts.length ? <p>{text("Loading…", "加载中…")}</p> : error ? <p role="alert">{text("Articles could not be loaded.", "文章暂时无法加载。")}</p> : !posts.length ? <p className="mt-3 text-slate-400">{text(nextCursor ? "No visible articles on this page." : "No articles yet.", nextCursor ? "本页暂无可见文章。" : "暂无文章。")}</p> : posts.map(post => <article key={post.id} className="mt-5 border-t border-white/10 pt-4">
      <h3 className="text-lg font-semibold"><Link href={localizedPath(`/posts/${post.id}`, locale)}>{post.title}</Link></h3>
      <p className="my-2 text-sm text-slate-400"><time dateTime={post.createdAt}>{new Date(post.createdAt).toLocaleString(locale)}</time> · {post.ticker} · <Link href={localizedPath(`/analysts/${post.userId}`, locale)}>{text("Author", "作者")}</Link></p>
      <p className="whitespace-pre-wrap break-words">{post.body}</p>
      <div className="mt-3 flex gap-4 text-cyan-300"><Link href={localizedPath(`/ticker/${encodeURIComponent(post.ticker)}`, locale)}>{text("Open company", "查看公司")}</Link>{post.predictionId && <Link href={localizedPath(`/predictions/${post.predictionId}`, locale)}>{text("View track record", "查看历史表现")}</Link>}</div>
    </article>)}
    {nextCursor && <button disabled={pending} onClick={() => setCursor(nextCursor)} className="mt-4 rounded border border-cyan-400/40 px-3 py-2 text-cyan-200">{pending ? text("Loading…", "加载中…") : text("Load more", "加载更多")}</button>}
  </section>;
}
