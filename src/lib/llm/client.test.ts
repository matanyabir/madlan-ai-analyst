import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Model selection must be reconfigurable without a deploy, and the per-role
 * override must beat the shared one.
 */
beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllEnvs());

async function load() {
  return import("./client");
}

describe("model selection", () => {
  it("defaults all three roles to Haiku 4.5", async () => {
    vi.stubEnv("LLM_MODEL", "");
    vi.stubEnv("LLM_ROUTER_MODEL", "");
    vi.stubEnv("LLM_NARRATOR_MODEL", "");
    vi.stubEnv("LLM_CANONICALIZER_MODEL", "");
    const m = await load();
    expect(m.ROUTER_MODEL).toBe("claude-haiku-4-5");
    expect(m.NARRATOR_MODEL).toBe("claude-haiku-4-5");
    expect(m.CANONICALIZER_MODEL).toBe("claude-haiku-4-5");
  });

  it("LLM_MODEL overrides every role at once", async () => {
    vi.stubEnv("LLM_MODEL", "claude-sonnet-5");
    vi.stubEnv("LLM_ROUTER_MODEL", "");
    vi.stubEnv("LLM_NARRATOR_MODEL", "");
    vi.stubEnv("LLM_CANONICALIZER_MODEL", "");
    const m = await load();
    expect(m.ROUTER_MODEL).toBe("claude-sonnet-5");
    expect(m.NARRATOR_MODEL).toBe("claude-sonnet-5");
  });

  it("a per-role override beats the shared one", async () => {
    // The intended production shape: a cheap router, a better narrator.
    vi.stubEnv("LLM_MODEL", "claude-haiku-4-5");
    vi.stubEnv("LLM_ROUTER_MODEL", "");
    vi.stubEnv("LLM_NARRATOR_MODEL", "claude-sonnet-5");
    vi.stubEnv("LLM_CANONICALIZER_MODEL", "");
    const m = await load();
    expect(m.ROUTER_MODEL).toBe("claude-haiku-4-5");
    expect(m.NARRATOR_MODEL).toBe("claude-sonnet-5");
  });

  it("treats a whitespace-only value as unset rather than sending it", async () => {
    vi.stubEnv("LLM_MODEL", "   ");
    vi.stubEnv("LLM_ROUTER_MODEL", "");
    vi.stubEnv("LLM_NARRATOR_MODEL", "");
    vi.stubEnv("LLM_CANONICALIZER_MODEL", "");
    const m = await load();
    expect(m.ROUTER_MODEL).toBe("claude-haiku-4-5");
  });
});
