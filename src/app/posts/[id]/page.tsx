import { CompanyPosts } from "@/components/company-posts";
export default async function PostPage({ params }: { params: Promise<{ id: string }> }) {
  return <main className="mx-auto max-w-3xl p-6"><CompanyPosts postId={(await params).id} /></main>;
}
