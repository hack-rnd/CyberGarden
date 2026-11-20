import { z } from "zod";
import OpenAI from "openai";
import { GoogleGenAI, type Schema } from "@google/genai";

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

interface LlmCallOptions {
  system?: string;
  timeoutMs?: number;
  jsonSchema?: Schema;
}

export class AllProvidersFailedError extends Error {
  readonly attempts: LlmAttempt[];

  constructor(attempts: LlmAttempt[]) {
    super(
      `All LLM providers failed: ${attempts
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
  call: (system: string, prompt: string, signal: AbortSignal, jsonSchema?: Schema) => Promise<string>;
}

const DEFAULT_SYSTEM =
  "You are an MTS incident coordinator assistant. Reply with valid JSON only, no markdown fences.";

function log(message: string, meta?: Record<string, unknown>): void {
  console.log(`[llm] ${message}`, meta ?? "");
}

function extractJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("No JSON object in response");
  }
  return JSON.parse(trimmed.slice(start, end + 1));
}

// --- GEMINI ---

async function callGemini(system: string, prompt: string, signal: AbortSignal, jsonSchema?: Schema): Promise<string> {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const response = await ai.models.generateContent({
    model: process.env.GEMINI_MODEL ?? "gemini-3.8-flash",
    contents: prompt,
    config: {
      systemInstruction: system,
      responseMimeType: "application/json",
      ...(jsonSchema ? { responseSchema: jsonSchema } : {}),
      abortSignal: signal,
    },
  });
  const text = response.text;
  if (!text) throw new Error("Empty Gemini response");
  return text;
}

// --- OPENAI-COMPATIBLE (GROQ / NVIDIA) ---

async function callOpenAiCompatible(
  baseUrl: string,
  apiKey: string,
  model: string,
  system: string,
  prompt: string,
  signal: AbortSignal,
): Promise<string> {
  const client = new OpenAI({ apiKey, baseURL: baseUrl, timeout: LLM_TIMEOUT_MS });
  const completion = await client.chat.completions.create(
    {
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0.2,
    },
    { signal },
  );
  const content = completion.choices[0]?.message?.content;
  if (!content) throw new Error("Empty provider response");
  return content;
}

// --- PROVIDER CHAIN ---

const providers: Provider[] = [
  {
    name: "gemini",
    envKey: "GEMINI_API_KEY",
    call: callGemini,
  },
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

// --- MAIN ENTRY ---

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
      log(`provider ${provider.name} skipped: no ${provider.envKey}`);
      continue;
    }

    const startedAt = Date.now();
    try {
      const signal = AbortSignal.timeout(timeoutMs);
      const raw = await provider.call(system, prompt, signal, options.jsonSchema);
      const parsed = schema.parse(extractJson(raw));
      const latencyMs = Date.now() - startedAt;

      attempts.push({ provider: provider.name, ok: true, latencyMs });
      log(`response from ${provider.name}`, { latencyMs });
      return { data: parsed, provider: provider.name, latencyMs, attempts };
    } catch (error) {
      const latencyMs = Date.now() - startedAt;
      const reason = error instanceof Error ? error.message : String(error);
      attempts.push({ provider: provider.name, ok: false, latencyMs, error: reason });
      log(`provider ${provider.name} failed`, { latencyMs, error: reason });
    }
  }

  throw new AllProvidersFailedError(attempts);
}
