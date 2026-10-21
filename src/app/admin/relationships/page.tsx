import { AdminRelationshipQueues } from '@/components/admin-relationship-contributions';
import { noIndexRobots } from '@/lib/seo';

export const metadata = { title: 'Relationship Review | Admin | YouAnalyst', robots: noIndexRobots() };
export default function Page() { return <AdminRelationshipQueues />; }
