import { RetiredCompanyResearch } from "@/components/retired-company-research";
import { noIndexRobots } from "@/lib/seo";
export const metadata = { title: "Retired Research | YouAnalyst", robots: noIndexRobots() };
export default function Page() { return <RetiredCompanyResearch />; }
