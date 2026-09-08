import { createServer } from "node:http";
import { buildIndustryFixture } from "./html";
import { fixtureGraph } from "./fixtures";

async function main() {
  const port = Number(process.env.INDUSTRY_PREVIEW_PORT ?? 4318);
  const html = await buildIndustryFixture();
  createServer((request, response) => {
    if (request.method !== "GET") { response.writeHead(405).end(); return; }
    if (request.url?.startsWith("/api/industry-graph")) {
      response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(fixtureGraph)); return;
    }
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(html);
  }).listen(port, "127.0.0.1", () => process.stdout.write(`Isolated graph preview: http://127.0.0.1:${port} (synthetic test evidence only)\n`));
}
void main();
