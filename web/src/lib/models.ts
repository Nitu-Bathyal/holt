// Models offered for AI reports. Web config for now: ids, copy and tiers are
// placeholders until pricing (strategy v2) settles; credits are TBD.
// No imports, so it runs under `node --test`.

export type ModelTier = "free" | "pro";

export interface ModelOption {
  /** Stable web id, sent to POST /api/analyses as `model`. */
  id: string;
  label: string;
  vendor: string;
  /** One line, plain English. */
  goodAt: string;
  tier: ModelTier;
  /** Credit cost per report; null until pricing is decided. */
  credits: number | null;
  /** The model's id on OpenRouter, which serves every AI report. */
  openrouter: string;
}

export const MODELS: ModelOption[] = [
  {
    id: "gpt-5-mini",
    label: "GPT-5 mini",
    vendor: "OpenAI",
    goodAt: "Quick, clear summaries. Holt's default.",
    tier: "free",
    credits: null,
    openrouter: "openai/gpt-5-mini",
  },
  {
    id: "gemini-2.5-flash",
    label: "Gemini 2.5 Flash",
    vendor: "Google",
    goodAt: "Fast, and comfortable with long pull-request threads.",
    tier: "free",
    credits: null,
    openrouter: "google/gemini-2.5-flash",
  },
  {
    id: "claude-haiku-4-5",
    label: "Claude Haiku 4.5",
    vendor: "Anthropic",
    goodAt: "Short, plain-English explanations.",
    tier: "free",
    credits: null,
    openrouter: "anthropic/claude-haiku-4.5",
  },
  {
    id: "claude-sonnet-5",
    label: "Claude Sonnet 5",
    vendor: "Anthropic",
    goodAt: "Careful reading of messy threads. The best all-rounder.",
    tier: "pro",
    credits: null,
    openrouter: "anthropic/claude-sonnet-5",
  },
  {
    id: "gpt-5",
    label: "GPT-5",
    vendor: "OpenAI",
    goodAt: "Thorough, well-structured reports.",
    tier: "pro",
    credits: null,
    openrouter: "openai/gpt-5",
  },
  {
    id: "claude-opus-5-5",
    label: "Claude Opus 5.5",
    vendor: "Anthropic",
    goodAt: "The deepest reading, for big and busy repositories.",
    tier: "pro",
    credits: null,
    openrouter: "anthropic/claude-opus-5.5",
  },
];

export const DEFAULT_MODEL = "gpt-5-mini";

/** Who is asking decides which models they can use. */
export type ModelAccess = { kind: "free" } | { kind: "plan" };

export type Availability = { ok: true } | { ok: false; reason: "upgrade" };

export function availability(m: ModelOption, access: ModelAccess): Availability {
  if (access.kind === "plan") return { ok: true };
  return m.tier === "free" ? { ok: true } : { ok: false, reason: "upgrade" };
}

/** The model to preselect: a requested one if usable, else the default. */
export function initialModel(access: ModelAccess, requested?: string | null): string {
  const usable = (id?: string | null) => {
    const m = MODELS.find((x) => x.id === id);
    return m && availability(m, access).ok ? m.id : null;
  };
  if (usable(requested)) return requested!;
  return usable(DEFAULT_MODEL) ?? MODELS.find((m) => availability(m, access).ok)?.id ?? DEFAULT_MODEL;
}

export function isKnownModel(id: unknown): id is string {
  return typeof id === "string" && MODELS.some((m) => m.id === id);
}
