import * as dotenv from "dotenv";
dotenv.config();

const ENDPOINTS: Record<string, string> = {
  mistral: "https://api.mistral.ai/v1/chat/completions",
  groq: "https://api.groq.com/openai/v1/chat/completions",
};

export async function chat(messages: any[], provider: string, model: string, jsonMode = false) {
  const keyName = provider === "mistral" ? "MISTRAL_API_KEY" : "GROQ_API_KEY";
  const apiKey = process.env[keyName];
  if (!apiKey) {
    return { ok: false, error: `Falta ${keyName}` };
  }
  const url = ENDPOINTS[provider];
  const body: any = { model, messages };
  if (jsonMode) {
    body.response_format = { type: "json_object" };
  }
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 500)}` };
    }
    const data = await res.json();
    return { ok: true, content: data.choices[0].message.content };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}
