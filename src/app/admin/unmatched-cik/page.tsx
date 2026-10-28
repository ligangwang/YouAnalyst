import { AdminUnmatchedCik } from '@/components/admin-unmatched-cik';
import { noIndexRobots } from '@/lib/seo';

export const metadata = { title: 'Unmatched CIK | YouAnalyst', robots: noIndexRobots() };
export default function Page() { return <AdminUnmatchedCik />; }
