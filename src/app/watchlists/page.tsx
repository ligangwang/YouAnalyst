import { redirect } from "next/navigation";
export default async function Page({ searchParams }: { searchParams: Promise<{ tab?: string }> }) { redirect((await searchParams).tab === "mine" ? "/my/predictions" : "/compare"); }
