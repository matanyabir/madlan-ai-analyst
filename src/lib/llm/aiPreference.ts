import { cookies } from "next/headers";

/**
 * The model on/off switch, carried by the request.
 *
 * The obvious implementation — a flag on the server — cannot work here.
 * Vercel runs many lambda instances and `globalThis` is per-instance, so
 * writing the flag in one request and reading it in the next is a coin flip:
 * routing would change while the pages that display the state showed the
 * opposite, which is exactly the bug this replaces.
 *
 * A cookie is carried by every request from the browser that set it, so the
 * behaviour is deterministic on any number of instances and survives cold
 * starts. The trade is honest and stated in the UI: it switches the model off
 * **for that browser**, not for every visitor. Genuinely environment-wide
 * state needs shared storage — the same Postgres/KV step the snapshot needs,
 * and the same reason.
 *
 * No signing: the worst a forged value can do is make your own answers
 * templated. It grants nothing and reveals nothing.
 */
export const AI_COOKIE = "madlan_ai";

export type AiPreference = "on" | "off";

/** Reads the caller's preference. Defaults to on. */
export async function readAiPreference(): Promise<AiPreference> {
  const store = await cookies();
  return store.get(AI_COOKIE)?.value === "off" ? "off" : "on";
}

export function isOff(value: string | undefined): boolean {
  return value === "off";
}
