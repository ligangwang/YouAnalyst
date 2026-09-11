import { AdminCompanyResearch } from "@/components/admin-company-research";
import { noIndexRobots } from "@/lib/seo";
export const metadata = { title: "Company Research | YouAnalyst", robots: noIndexRobots() };
export default function Page() { return <AdminCompanyResearch />; }
