import { buildSystemPrompt, buildUserPrompt } from "./prompts.js";

function extractTextFromAnthropic(responseJson) {
  const blocks = Array.isArray(responseJson?.content) ? responseJson.content : [];
  const text = blocks
    .filter((block) => block && block.type === "text")
    .map((block) => block.text || "")
    .join("\n")
    .trim();

  return text;
}

function buildMockPrompt(prompt, mode) {
  const seed = [
    "Create a polished, modern UI concept.",
    `Mode: ${mode}.`,
    "Preserve the original idea while making the brief more explicit.",
    "Specify layout hierarchy, key sections, component treatment, spacing, and responsive behaviour.",
    "Use realistic product copy and a clean visual system.",
    "",
    `Design brief: ${prompt}`
  ].join(" ");

  return seed.trim();
}

export async function enhancePrompt(env, { prompt, site, mode }) {
  if (String(env.USE_MOCK || "").toLowerCase() === "true" || !env.ANTHROPIC_API_KEY) {
    return buildMockPrompt(prompt, mode);
  }

  const body = {
    model: env.ANTHROPIC_MODEL || "claude-sonnet-4-6",
    max_tokens: 700,
    temperature: 0.4,
    cache_control: { type: "ephemeral" },
    system: buildSystemPrompt({ site, mode }),
    messages: [
      {
        role: "user",
        content: buildUserPrompt(prompt)
      }
    ]
  };

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Anthropic API error: ${response.status} ${text}`);
  }

  const json = await response.json();
  const text = extractTextFromAnthropic(json);
  if (!text) throw new Error("Anthropic returned no text content");

  return text;
}
