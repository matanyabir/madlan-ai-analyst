import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { isAiEnabled, setAiEnabled, llmAvailable, llmKeyConfigured, getClient } from "./client";

beforeEach(() => {
  vi.unstubAllEnvs();
  setAiEnabled(true);
});
afterEach(() => {
  vi.unstubAllEnvs();
  setAiEnabled(true);
});

describe("the AI kill switch", () => {
  it("is on by default", () => {
    expect(isAiEnabled()).toBe(true);
  });

  it("makes the model unavailable when off, even with a key present", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-fake");
    expect(llmAvailable()).toBe(true);

    setAiEnabled(false);
    expect(llmAvailable()).toBe(false);
    expect(getClient()).toBeNull();
  });

  it("distinguishes 'no key' from 'turned off'", () => {
    // The admin UI needs to tell these apart: one is a deployment gap, the
    // other is a deliberate choice someone made and can undo.
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    expect(llmKeyConfigured()).toBe(false);
    expect(isAiEnabled()).toBe(true);

    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-fake");
    setAiEnabled(false);
    expect(llmKeyConfigured()).toBe(true);
    expect(isAiEnabled()).toBe(false);
  });

  it("cannot be turned on into a working state without a key", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    setAiEnabled(true);
    expect(llmAvailable()).toBe(false);
  });

  it("restores availability when switched back on", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-fake");
    setAiEnabled(false);
    expect(llmAvailable()).toBe(false);
    setAiEnabled(true);
    expect(llmAvailable()).toBe(true);
  });
});
