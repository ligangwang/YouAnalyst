import { build } from "esbuild";
import path from "node:path";
export async function buildIndustryFixture() {
  const result = await build({
    entryPoints: ["tests/industry/app.tsx"], bundle: true, write: false, outfile: "industry-fixture.js",
    platform: "browser", define: { "process.env": "{}" }, alias: { "next/link": path.resolve("tests/industry/link.tsx") },
  });
  const js = result.outputFiles.find((file) => file.path.endsWith(".js"))!.text;
  const css = result.outputFiles.find((file) => file.path.endsWith(".css"))!.text;
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="youanalyst-analytics" content="enabled"><style>*{box-sizing:border-box}body{margin:0;background:#07111d;color:#f8fafc;font-family:Arial,sans-serif}button,input,select{font:inherit}button{cursor:pointer;color:inherit;border:0;background:none}a{color:inherit;text-decoration:none}p,h1,h2,h3{margin:0}button:disabled{cursor:not-allowed}${css}</style></head><body><div style="padding:8px 24px;color:#fcd34d;background:#282417;font-size:12px">LOCAL PREVIEW · Synthetic test evidence, not live filing data</div><div id="root"></div><script>${js.replaceAll("</script", "<\\/script")}</script></body></html>`;
}
