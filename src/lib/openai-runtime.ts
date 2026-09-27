export function getOpenAiApiKey(): string {
  const apiKey = process.env.OPENAI_API_KEY?.trim();

  if (!apiKey) {
    throw new Error("Missing OPENAI_API_KEY");
  }

  return apiKey;
}

export function getOpenAiModel(): string {
  return process.env.OPENAI_MODEL?.trim() || "gpt-5.4";
}

