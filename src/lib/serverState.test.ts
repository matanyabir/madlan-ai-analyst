import { describe, it, expect, beforeEach } from "vitest";
import { serverState } from "./serverState";
import { getSnapshot, setSnapshot, resetSnapshot, snapshotOrigin } from "./snapshot";
import { isAiEnabled, setAiEnabled } from "./llm/client";

beforeEach(() => {
  resetSnapshot();
  setAiEnabled(true);
});

/**
 * Regression guard for a bug that made the switch work while the panel
 * showed the opposite, and the upload work while the home page kept
 * advertising the old row count.
 *
 * Next puts Server Components and Route Handlers in separate module graphs,
 * so a module-level `let` is not one variable. Everything mutable at runtime
 * has to live on globalThis.
 */
describe("shared server state", () => {
  it("is reachable through a registered symbol, not a module variable", () => {
    const viaModule = serverState();
    const viaGlobal = (globalThis as Record<symbol, unknown>)[Symbol.for("madlan.serverState")];
    // A second module graph resolves the same symbol and gets this object.
    expect(viaGlobal).toBe(viaModule);
  });

  it("routes the AI toggle through it", () => {
    setAiEnabled(false);
    expect(serverState().aiEnabled).toBe(false);
    expect(isAiEnabled()).toBe(false);

    // A reader that only has the shared object sees the same answer.
    serverState().aiEnabled = true;
    expect(isAiEnabled()).toBe(true);
  });

  it("routes the snapshot through it", () => {
    const baked = getSnapshot();
    expect(snapshotOrigin().origin).toBe("baked");

    const uploaded = { ...baked, version: "uploaded1234", counts: { ...baked.counts, analyzable: 42 } };
    setSnapshot(uploaded);

    expect(getSnapshot().version).toBe("uploaded1234");
    expect(getSnapshot().counts.analyzable).toBe(42);
    expect(serverState().snapshot?.version).toBe("uploaded1234");
    expect(snapshotOrigin().origin).toBe("uploaded");
  });

  it("falls back to the committed snapshot when nothing was uploaded", () => {
    resetSnapshot();
    expect(serverState().snapshot).toBeNull();
    expect(getSnapshot().counts.rawRows).toBe(530);
    expect(snapshotOrigin()).toEqual({ origin: "baked", at: null });
  });
});
