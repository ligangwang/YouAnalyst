import { createServer } from "node:http";
import { buildIndustryFixture } from "./html";
import { fixtureGraph } from "./fixtures";

async function main() {
  const html = await buildIndustryFixture();
  createServer((request, response) => {
    if (request.method !== "GET") { response.writeHead(405).end(); return; }
    if (request.url?.startsWith("/api/industry-graph")) {
      response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(fixtureGraph)); return;
    }
    response.writeHead(200, { "Content-Type": "text/html" }).end(html);
  }).listen(4318, "127.0.0.1", () => process.stdout.write("Isolated graph preview: http://127.0.0.1:4318 (synthetic test evidence only)\n"));
}
void main();
