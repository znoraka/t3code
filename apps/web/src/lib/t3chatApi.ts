import { useT3ChatAuthStore } from "../t3chatAuthStore";

export interface T3ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

export interface T3ChatSendParams {
  messages: T3ChatMessage[];
  threadId: string;
  model: string;
  signal?: AbortSignal;
  reasoningEffort?: string;
  includeSearch?: boolean;
}

function buildRequestBody(params: T3ChatSendParams) {
  const { convexSessionId } = useT3ChatAuthStore.getState();
  return {
    messages: params.messages.map((m) => ({
      id: m.id,
      parts: [{ type: "text", text: m.content }],
      role: m.role,
      attachments: [],
    })),
    threadMetadata: { id: params.threadId },
    responseMessageId: crypto.randomUUID(),
    model: params.model,
    convexSessionId,
    modelParams: {
      reasoningEffort: params.reasoningEffort ?? "medium",
      includeSearch: params.includeSearch ?? false,
    },
    preferences: {
      name: "",
      occupation: "",
      selectedTraits: [],
      additionalInfo: "",
    },
    userInfo: {
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      locale: navigator.language,
    },
  };
}

function captureRefreshedSession(response: Response) {
  const refreshed = response.headers.get("x-t3-refreshed-wos-session");
  if (refreshed) {
    useT3ChatAuthStore.getState().updateWosSession(refreshed);
  }
}

export async function* streamChat(params: T3ChatSendParams): AsyncGenerator<string> {
  const { wosSession } = useT3ChatAuthStore.getState();

  const response = await fetch("/t3chat-api/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-t3-wos-session": wosSession ?? "",
    },
    body: JSON.stringify(buildRequestBody(params)),
    signal: params.signal ?? null,
  });

  captureRefreshedSession(response);

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`T3 Chat API error ${response.status}: ${text}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data: ")) continue;
      const data = trimmed.slice(6);
      if (data === "[DONE]") return;

      try {
        const parsed = JSON.parse(data);
        const delta = extractDelta(parsed);
        if (delta) yield delta;
      } catch {
        // skip unparseable lines
      }
    }
  }
}

function extractDelta(value: Record<string, unknown>): string | null {
  if (typeof value.delta === "string") return value.delta;
  if (value.delta && typeof value.delta === "object") {
    const d = value.delta as Record<string, unknown>;
    if (typeof d.text === "string") return d.text;
  }
  if (typeof value.text === "string") return value.text;
  if (Array.isArray(value.content)) {
    return value.content
      .map((item: Record<string, unknown>) => (typeof item.text === "string" ? item.text : ""))
      .join("");
  }
  return null;
}

export interface T3ChatModel {
  id: string;
  label: string;
  provider: string;
}

const PROVIDER_ORDER = ["Claude", "GPT", "Gemini", "DeepSeek", "Grok", "Kimi", "Qwen", "Llama"];

const BRAND_CASING: Record<string, string> = {
  gpt: "GPT",
  glm: "GLM",
  deepseek: "DeepSeek",
  minimax: "MiniMax",
  mimo: "MiMo",
};

function formatModelId(id: string): string {
  return id
    .split("-")
    .map((part) => {
      const lower = part.toLowerCase();
      if (BRAND_CASING[lower]) return BRAND_CASING[lower];
      if (lower === "thinking" || lower === "reasoning")
        return `(${part.charAt(0).toUpperCase() + part.slice(1)})`;
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(" ");
}

function detectProvider(id: string): string {
  const lower = id.toLowerCase();
  if (lower.startsWith("claude")) return "Claude";
  if (lower.startsWith("gpt") || lower.startsWith("o3") || lower.startsWith("o4")) return "GPT";
  if (lower.startsWith("gemini") || lower.startsWith("gemma")) return "Gemini";
  if (lower.startsWith("deepseek")) return "DeepSeek";
  if (lower.startsWith("grok")) return "Grok";
  if (lower.startsWith("kimi")) return "Kimi";
  if (lower.startsWith("qwen")) return "Qwen";
  if (lower.startsWith("llama")) return "Llama";
  if (lower.startsWith("glm")) return "GLM";
  if (lower.startsWith("minimax")) return "MiniMax";
  if (lower.startsWith("mimo")) return "MiMo";
  return "Other";
}

let modelsCache: T3ChatModel[] | null = null;

export async function fetchModels(): Promise<T3ChatModel[]> {
  if (modelsCache) return modelsCache;

  try {
    const { wosSession } = useT3ChatAuthStore.getState();
    const headers: Record<string, string> = {};
    if (wosSession) headers["x-t3-wos-session"] = wosSession;

    const response = await fetch(
      "/t3chat-api/trpc/getAllModelBenchmarks?batch=1&input=%7B%220%22%3A%7B%22json%22%3Anull%7D%7D",
      { headers },
    );
    if (!response.ok) return FALLBACK_MODELS;

    const data = await response.json();
    const benchmarks = data?.[0]?.result?.data?.json;
    if (!benchmarks || typeof benchmarks !== "object") return FALLBACK_MODELS;

    const models: T3ChatModel[] = Object.keys(benchmarks).map((id) => ({
      id,
      label: formatModelId(id),
      provider: detectProvider(id),
    }));

    models.sort((a, b) => {
      const ai = PROVIDER_ORDER.indexOf(a.provider);
      const bi = PROVIDER_ORDER.indexOf(b.provider);
      const ao = ai === -1 ? PROVIDER_ORDER.length : ai;
      const bo = bi === -1 ? PROVIDER_ORDER.length : bi;
      if (ao !== bo) return ao - bo;
      return b.id.localeCompare(a.id);
    });

    modelsCache = models;
    return models;
  } catch {
    return FALLBACK_MODELS;
  }
}

const FALLBACK_MODELS: T3ChatModel[] = [
  { id: "claude-4-sonnet", label: "Claude 4 Sonnet", provider: "Claude" },
  { id: "claude-4-opus", label: "Claude 4 Opus", provider: "Claude" },
  { id: "gpt-4.1", label: "GPT 4.1", provider: "GPT" },
  { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", provider: "Gemini" },
  { id: "deepseek-r1", label: "DeepSeek R1", provider: "DeepSeek" },
  { id: "grok-3", label: "Grok 3", provider: "Grok" },
];

export async function refreshSession(): Promise<boolean> {
  const { wosSession } = useT3ChatAuthStore.getState();
  if (!wosSession) return false;

  const response = await fetch(
    "/t3chat-api/trpc/auth.getActiveSessions?batch=1&input=%7B%220%22%3A%7B%22json%22%3A%7B%22includeLocation%22%3Afalse%7D%7D%7D",
    {
      headers: {
        "Content-Type": "application/json",
        "trpc-accept": "application/jsonl",
        "x-t3-wos-session": wosSession,
      },
    },
  );
  captureRefreshedSession(response);
  return response.ok;
}
