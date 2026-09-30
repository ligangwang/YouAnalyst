import type { Metadata } from 'next';
import { localizedMetadata } from '@/lib/i18n/server';
import { noIndexRobots } from '@/lib/seo';
import { AdminMusicPage } from '@/components/admin-music-page';
export async function generateMetadata(): Promise<Metadata> {
  return localizedMetadata({ title: 'Music | Admin | YouAnalyst', robots: noIndexRobots() });
}
export default function Page() { return <AdminMusicPage/>; }
