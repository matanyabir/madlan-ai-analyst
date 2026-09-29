/**
 * The closed-set decision seam.
 *
 * Some of this product's AI work has a *closed* answer set: which of six
 * tools to run, which canonical city an unrecognised spelling means. For
 * those, a generative model is the wrong instrument — it can return anything
 * and must be constrained after the fact.
 *
 * ── Next step: Jev AI ────────────────────────────────────────────────────
 * Jev (TypeSafe AI's System One model, POST https://thejevai.com/v1/systemone)
 * answers exactly this shape of question. A `choice` question whose `criteria`
 * is a whitelist of canonical city names *cannot* return a city outside the
 * list — hallucination is impossible by construction rather than by prompt
 * discipline — and it returns a calibrated confidence, which is precisely
 * what the canonicalization step thresholds on. It costs $0.042 per million
 * input tokens with output billed at zero, so the routing half of this app
 * would drop from ~$9/day to ~$5/day at 10k requests.
 *
 * It cannot write the Hebrew narration: it generates no text at all. That is
 * why this interface covers only classification, and why the narrator does
 * not go through it.
 *
 * Implementing JevProvider means one class with one fetch. Nothing else in
 * the app changes.
 */

export interface ClassifyOption {
  /** Stable key returned as the choice. */
  id: string;
  /** What this option means, in the language of the input. */
  description: string;
}

export interface ClassifyRequest {
  /** The state to judge: free text, or a JSON-serialisable object. */
  state: string | Record<string, unknown>;
  question: string;
  options: ClassifyOption[];
}

export interface ClassifyResult {
  /** Always one of the supplied option ids, or null when below threshold. */
  choice: string | null;
  confidence: number;
  provider: string;
}

export interface DecisionProvider {
  readonly name: string;
  available(): boolean;
  classify(request: ClassifyRequest): Promise<ClassifyResult>;
}
