import { GoogleAuth } from "google-auth-library";

const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/pubsub"] });
export async function publishJobMessage<T extends { type: string; batchId: string }>(topic: string, message: T) {
  const project = process.env.GCP_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  if (!project || !/^[A-Za-z][A-Za-z0-9._~+%-]{2,254}$/.test(topic)) throw new Error("Pub/Sub project/topic missing or invalid");
  const client = await auth.getClient();
  const result = await client.request<{ messageIds: string[] }>({
    url: `https://pubsub.googleapis.com/v1/projects/${project}/topics/${topic}:publish`, method: "POST",
    data: { messages: [{ data: Buffer.from(JSON.stringify(message)).toString("base64"),
      attributes: { type: message.type, batchId: message.batchId } }] }, timeout: 20_000, retry: false,
  });
  if (!result.data.messageIds?.length) throw new Error("Pub/Sub publish was not confirmed");
  return result.data.messageIds[0];
}
