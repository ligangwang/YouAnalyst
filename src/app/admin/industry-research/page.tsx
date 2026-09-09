import { AdminIndustryResearch } from "@/components/admin-industry-research";
import { noIndexRobots } from "@/lib/seo";
export const metadata = { title: "Industry Research | YouAnalyst", robots: noIndexRobots() };
export default function Page() { return <AdminIndustryResearch />; }
