import { z } from "zod";
import { GoogleGenAI } from "@google/genai";

export const LLM_TIMEOUT_MS = 6000;

export interface LlmAttempt {
  provider: string;
  ok: boolean;
  latencyMs: number;
  error?: string;
}

export interface LlmResult<T> {
  data: T;
  provider: string;
  latencyMs: number;
  attempts: LlmAttempt[];
}

export interface LlmCallOptions {
  system?: string;
  timeoutMs?: number;
}

export class AllProvidersFailedError extends Error {
  readonly attempts: LlmAttempt[];

  constructor(attempts: LlmAttempt[]) {
    super(
      `Все LLM-провайдеры недоступны: ${attempts
        .map((a) => `${a.provider} (${a.error ?? "unknown"})`)
        .join("; ")}`,
    );
    this.name = "AllProvidersFailedError";
    this.attempts = attempts;
  }
}

interface Provider {
  name: string;
  envKey: string;
  call: (system: string, prompt: string, signal: AbortSignal) => Promise<string>;
}

const DEFAULT_SYSTEM =
  "Ты — ассистент координатора инцидентов МТС. Отвечай только валидным JSON без пояснений и без markdown-разметки.";

function log(message: string, meta?: Record<string, unknown>): void {
  console.log(`[llm] ${message}`, meta ?? "");
}

function extractJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("В ответе нет JSON-объекта");
  }
  return JSON.parse(trimmed.slice(start, end + 1));
}

async function callGemini(system: string, prompt: string, signal: AbortSignal): Promise<string> {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const response = await ai.models.generateContent({
    model: process.env.GEMINI_MODEL ?? "gemini-3.8-flash",
    contents: prompt,
    config: {
      systemInstruction: system,
      responseMimeType: "application/json",
      abortSignal: signal,
    },
  });
  const text = response.text;
  if (!text) throw new Error("Пустой ответ Gemini");
  return text;
}

interface OpenAiCompatibleMessage {
  role: "system" | "user";
  content: string;
}

async function callOpenAiCompatible(
  baseUrl: string,
  apiKey: string,
  model: string,
  system: string,
  prompt: string,
  signal: AbortSignal,
): Promise<string> {
  const messages: OpenAiCompatibleMessage[] = [
    { role: "system", content: system },
    { role: "user", content: prompt },
  ];

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      response_format: { type: "json_object" },
      temperature: 0.2,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`HTTP ${response.status}: ${body.slice(0, 200)}`);
  }

  const payload = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error("Пустой ответ провайдера");
  return content;
}

const providers: Provider[] = [
  {
    name: "groq",
    envKey: "GROQ_API_KEY",
    call: (system, prompt, signal) =>
      callOpenAiCompatible(
        "https://api.groq.com/openai/v1",
        process.env.GROQ_API_KEY ?? "",
        process.env.GROQ_MODEL ?? "openai/gpt-oss-120b",
        system,
        prompt,
        signal,
      ),
  },
  {
    name: "gemini",
    envKey: "GEMINI_API_KEY",
    call: callGemini,
  },
  {
    name: "nvidia",
    envKey: "NVIDIA_API_KEY",
    call: (system, prompt, signal) =>
      callOpenAiCompatible(
        "https://integrate.api.nvidia.com/v1",
        process.env.NVIDIA_API_KEY ?? "",
        process.env.NVIDIA_MODEL ?? "meta/llama-3.3-70b-instruct",
        system,
        prompt,
        signal,
      ),
  },
];

export async function callLlmWithFallback<S extends z.ZodTypeAny>(
  prompt: string,
  schema: S,
  options: LlmCallOptions = {},
): Promise<LlmResult<z.infer<S>>> {
  const system = options.system ?? DEFAULT_SYSTEM;
  const timeoutMs = options.timeoutMs ?? LLM_TIMEOUT_MS;
  const attempts: LlmAttempt[] = [];

  for (const provider of providers) {
    if (!process.env[provider.envKey]) {
      log(`провайдер ${provider.name} пропущен: нет ${provider.envKey}`);
      continue;
    }

    const startedAt = Date.now();
    try {
      const signal = AbortSignal.timeout(timeoutMs);
      const raw = await provider.call(system, prompt, signal);
      const parsed = schema.parse(extractJson(raw));
      const latencyMs = Date.now() - startedAt;

      attempts.push({ provider: provider.name, ok: true, latencyMs });
      log(`ответ получен от ${provider.name}`, { latencyMs });
      return { data: parsed, provider: provider.name, latencyMs, attempts };
    } catch (error) {
      const latencyMs = Date.now() - startedAt;
      const reason = error instanceof Error ? error.message : String(error);
      attempts.push({ provider: provider.name, ok: false, latencyMs, error: reason });
      log(`провайдер ${provider.name} не ответил`, { latencyMs, error: reason });
    }
  }

  throw new AllProvidersFailedError(attempts);
}
