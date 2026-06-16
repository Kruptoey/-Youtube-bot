/**
 * Centralized AI cost accounting for the video pipeline.
 *
 * One place defines what every model costs and how a job's spend is summed, so the
 * worker can persist an accurate `ai_cost_usd` + breakdown and the History UI can
 * show it. Everything here is intentionally pure and DEFENSIVE — recording a cost
 * must NEVER throw, because the thumbnail pipeline is non-fatal and a cost-math
 * mistake must not be able to fail a real job.
 *
 * Prices below are verified public list prices as of 2026-06 for the exact models
 * this project runs (see the per-row source notes). Token prices are exact; per-image
 * prices are for a 1024x1024 reference image and scale with the requested size/quality,
 * so treat the image rows as close estimates. Update these when provider pricing
 * changes. Face-swap (fal.ai) cost is intentionally not tracked: optional and small.
 */

/** USD per 1,000,000 tokens, matched by substring against the model id (see priceFor). */
const TOKEN_PRICING: Array<{ match: string; inPerM: number; outPerM: number }> = [
  // Anthropic — platform.claude.com pricing (Sonnet 4.6 $3/$15, Haiku 4.5 $1/$5,
  // Opus 4.8 $5/$25). These are the project's primary brain models.
  { match: "haiku", inPerM: 1.0, outPerM: 5.0 },
  { match: "sonnet", inPerM: 3.0, outPerM: 15.0 },
  { match: "opus", inPerM: 5.0, outPerM: 25.0 },
  // OpenAI fallback brain — gpt-4o $2.50/$10, gpt-4o-mini $0.15/$0.60.
  // Order matters: the more specific "gpt-4o-mini" must precede "gpt-4o".
  { match: "gpt-4o-mini", inPerM: 0.15, outPerM: 0.6 },
  { match: "gpt-4o", inPerM: 2.5, outPerM: 10.0 },
  // Google Gemini (text) — 2.5 Flash $0.30/$2.50 (transcription/brief/QC);
  // 1.5 Pro $1.25/$5 (legacy persona default). Image model priced per-image below.
  { match: "gemini-2.5-flash", inPerM: 0.3, outPerM: 2.5 },
  { match: "gemini-1.5-pro", inPerM: 1.25, outPerM: 5.0 },
  { match: "gemini", inPerM: 0.3, outPerM: 2.5 },
];

/** USD per generated image (1024x1024 reference), matched by substring against the model id. */
const IMAGE_PRICING: Array<{ match: string; perImage: number }> = [
  // gemini-2.5-flash-image: 1290 tokens/image ≈ $0.039 (the project's default image model).
  { match: "gemini", perImage: 0.039 },
  // gpt-image-1 fallback: ~$0.04 at medium quality (1024x1024); the project renders
  // 1536x1024, so the real cost can run higher — treated as an estimate.
  { match: "gpt-image", perImage: 0.04 },
];

function tokenPriceFor(model: string): { inPerM: number; outPerM: number } {
  const id = (model || "").toLowerCase();
  return TOKEN_PRICING.find((p) => id.includes(p.match)) ?? { inPerM: 0, outPerM: 0 };
}

function imagePriceFor(model: string): number {
  const id = (model || "").toLowerCase();
  return IMAGE_PRICING.find((p) => id.includes(p.match))?.perImage ?? 0;
}

const round4 = (n: number): number => Math.round((n + Number.EPSILON) * 1e4) / 1e4;

export interface AiCostEntry {
  step: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  images: number;
  costUsd: number;
}

export interface AiCostSummary {
  entries: AiCostEntry[];
  byModel: Record<string, number>;
  totalUsd: number;
}

/**
 * Accumulates cost entries. Designed to be created fresh INSIDE a single Inngest
 * step and have its `.entries` returned as that step's value — never shared across
 * steps via closure, because Inngest replays memoize step results without re-running
 * their bodies, so closure mutations would be lost on retry. Merge the returned
 * entry arrays afterwards with `AiCost.fromEntries(...)`.
 */
export class AiCost {
  private _entries: AiCostEntry[] = [];

  /** Record a token-billed call (chat/structured generation). Never throws. */
  addTokens(
    step: string,
    model: string,
    usage: { inputTokens?: number | null; outputTokens?: number | null } | null | undefined
  ): void {
    try {
      const inputTokens = Math.max(0, Math.round(usage?.inputTokens ?? 0));
      const outputTokens = Math.max(0, Math.round(usage?.outputTokens ?? 0));
      if (inputTokens === 0 && outputTokens === 0) return;
      const { inPerM, outPerM } = tokenPriceFor(model);
      const costUsd = round4((inputTokens / 1e6) * inPerM + (outputTokens / 1e6) * outPerM);
      this._entries.push({ step, model, inputTokens, outputTokens, images: 0, costUsd });
    } catch {
      /* cost accounting must never break the pipeline */
    }
  }

  /** Record one or more generated images. Never throws. */
  addImage(step: string, model: string, count = 1): void {
    try {
      const images = Math.max(0, Math.round(count));
      if (images === 0) return;
      const costUsd = round4(imagePriceFor(model) * images);
      this._entries.push({ step, model, inputTokens: 0, outputTokens: 0, images, costUsd });
    } catch {
      /* cost accounting must never break the pipeline */
    }
  }

  get entries(): AiCostEntry[] {
    return this._entries;
  }

  static fromEntries(entries: AiCostEntry[]): AiCost {
    const c = new AiCost();
    c._entries = Array.isArray(entries) ? entries.filter(Boolean) : [];
    return c;
  }

  get totalUsd(): number {
    return round4(this._entries.reduce((sum, e) => sum + (e.costUsd || 0), 0));
  }

  /** The single most expensive model used — what the History badge shows. */
  get primaryModel(): string | null {
    let best: { model: string; cost: number } | null = null;
    const byModel = this.byModel;
    for (const [model, cost] of Object.entries(byModel)) {
      if (!best || cost > best.cost) best = { model, cost };
    }
    return best?.model ?? null;
  }

  get byModel(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const e of this._entries) {
      out[e.model] = round4((out[e.model] ?? 0) + (e.costUsd || 0));
    }
    return out;
  }

  summary(): AiCostSummary {
    return { entries: this._entries, byModel: this.byModel, totalUsd: this.totalUsd };
  }
}

/**
 * Human-friendly model label for the UI badge. Keeps the raw id in the DB (for
 * auditing) while the History row shows e.g. "Sonnet 4.6" instead of
 * "claude-sonnet-4-6". Falls back to the raw id when nothing matches.
 */
export function prettyModel(model: string | null | undefined): string {
  if (!model) return "—";
  const id = model.toLowerCase();
  if (id.includes("sonnet")) return "Sonnet 4.6";
  if (id.includes("haiku")) return "Haiku 4.5";
  if (id.includes("opus")) return "Opus";
  if (id.includes("gpt-4o-mini")) return "GPT-4o mini";
  if (id.includes("gpt-4o")) return "GPT-4o";
  if (id.includes("gpt-image")) return "GPT Image";
  if (id.includes("gemini") && id.includes("image")) return "Gemini Image";
  if (id.includes("gemini")) return "Gemini Flash";
  return model;
}
