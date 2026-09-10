import { bootstrapPublicEvents } from "../../src/lib/events/bootstrap";

bootstrapPublicEvents().then(result => {
  console.log("Public event bootstrap:", JSON.stringify(result));
  if (!result.alreadyPopulated && result.created === 0) throw new Error("No verified historical filings were available to initialize the feed");
}).catch(error => { console.error("Public event bootstrap failed:", error instanceof Error ? error.message : "Unknown error"); process.exitCode = 1; });
