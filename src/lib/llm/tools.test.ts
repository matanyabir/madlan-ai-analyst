import { describe, it, expect } from "vitest";
import { getSnapshot } from "@/lib/snapshot";
import { buildToolDefinitions, TOOL_NAMES, TOOL_SCHEMAS, isToolName } from "./tools";
import { executeToolCall } from "./execute";
import { MAX_RESULT_ROWS } from "@/lib/analysis";

const snap = getSnapshot();
const tools = buildToolDefinitions(snap);

describe("tool definitions sent to Claude", () => {
  it("exposes exactly the seven operations with closed shapes", () => {
    expect(tools).toHaveLength(7);
    expect(tools.every((t) => t.input_schema.additionalProperties === false)).toBe(true);
    expect(tools.map((t) => t.name).sort()).toEqual([...TOOL_NAMES].sort());
  });

  it("sends nothing strict-mode forbids, in case it is ever re-enabled", () => {
    // The API rejects minimum/maximum on numbers and minItems above 1 under
    // strict:true. Those bounds belong in the description and in Zod.
    const walk = (node: unknown, path: string): string[] => {
      if (!node || typeof node !== "object") return [];
      const o = node as Record<string, unknown>;
      const bad: string[] = [];
      for (const key of ["minimum", "maximum"]) {
        if (key in o) bad.push(`${path}.${key}`);
      }
      if (typeof o.minItems === "number" && o.minItems > 1) bad.push(`${path}.minItems`);
      for (const [k, v] of Object.entries(o)) bad.push(...walk(v, `${path}.${k}`));
      return bad;
    };
    const offenders = tools.flatMap((t) => walk(t.input_schema, t.name));
    expect(offenders).toEqual([]);
  });

  it("states numeric ranges in prose, where the model can read them", () => {
    const stats = tools.find((t) => t.name === "get_statistics")!;
    const filters = (stats.input_schema.properties as Record<string, {
      properties: Record<string, { description?: string }>;
    }>).filters;
    expect(filters.properties.roomsMin.description).toMatch(/בין 0 ל-20/);
  });

  it("stays under the optional-parameter ceiling strict mode would impose", () => {
    // Documented here because it is the reason strict:true is off: the API
    // allows 24 optional params across all tools and this schema needs ~113.
    // If a future change brings it under 24, strict becomes available again.
    const count = tools.reduce((n, t) => {
      const props = t.input_schema.properties as Record<string, { properties?: object }>;
      const required = (t.input_schema.required as string[]) ?? [];
      let own = Object.keys(props).length - required.length;
      if (props.filters?.properties) own += Object.keys(props.filters.properties).length - 1;
      return n + own;
    }, 0);
    expect(count).toBeGreaterThan(24); // the schema genuinely cannot be strict
  });

  it("enumerates cities from the snapshot so the model cannot invent one", () => {
    const stats = tools.find((t) => t.name === "get_statistics")!;
    const cityEnum = (stats.input_schema.properties as Record<string, { properties: Record<string, { enum: string[] }> }>)
      .filters.properties.city.enum;
    expect(cityEnum).toEqual(snap.vocabulary.cities);
    expect(cityEnum).toContain("תל אביב-יפו");
    expect(cityEnum).not.toContain("תל אביב");
  });

  it("tells the model the result ceiling, and enforces it in Zod", () => {
    // The cap cannot live in the schema (strict mode forbids `maximum`, and
    // without strict it is advisory anyway), so it is stated in the
    // description and guaranteed server-side.
    for (const t of tools) {
      const limit = (t.input_schema.properties as Record<string, { description?: string }>).limit;
      if (limit) expect(limit.description).toContain(String(MAX_RESULT_ROWS));
    }
    // The guarantee: an over-cap limit is rejected, not honoured.
    expect(executeToolCall(snap, { name: "search_transactions", input: { limit: 500 } }))
      .toMatchObject({ ok: false, error: "invalid_arguments" });
  });

  it("does not let the model choose a time resolution", () => {
    // Granularity depends on how many deals fall in each bucket, which is a
    // statistical judgement the engine makes from the data. A model forcing
    // "month" on a thin city produces an answer reporting no trend at all.
    const ts = tools.find((t) => t.name === "get_time_series")!;
    expect(Object.keys(ts.input_schema.properties as object)).not.toContain("granularity");
  });

  it("offers an explicit way to decline, so declining is a first-class choice", () => {
    const decline = tools.find((t) => t.name === "answer_not_supported")!;
    expect(decline.input_schema.required).toEqual(["reason"]);
    expect(decline.description).toContain("תחזיות עתידיות");
  });

  it("rebuilds enums from whatever snapshot it is given", () => {
    const narrowed = { ...snap, vocabulary: { ...snap.vocabulary, cities: ["חיפה"] } };
    const rebuilt = buildToolDefinitions(narrowed);
    const stats = rebuilt.find((t) => t.name === "get_statistics")!;
    expect(
      (stats.input_schema.properties as Record<string, { properties: Record<string, { enum: string[] }> }>)
        .filters.properties.city.enum,
    ).toEqual(["חיפה"]);
  });
});

describe("server-side validation", () => {
  it("accepts a well-formed call", () => {
    const out = executeToolCall(snap, {
      name: "get_statistics",
      input: { filters: { city: "רמת גן", roomsMin: 4, roomsMax: 4 }, metric: "count" },
    });
    expect(out.ok).toBe(true);
  });

  it("rejects an unknown tool name", () => {
    const out = executeToolCall(snap, { name: "drop_table", input: {} });
    expect(out).toMatchObject({ ok: false, error: "unknown_tool" });
  });

  it("rejects an unknown argument rather than ignoring it", () => {
    // .strict() matters: a hallucinated field is a signal the call is wrong.
    const out = executeToolCall(snap, {
      name: "get_statistics",
      input: { filters: { city: "רמת גן" }, sqlQuery: "SELECT * FROM deals" },
    });
    expect(out).toMatchObject({ ok: false, error: "invalid_arguments" });
  });

  it("rejects an out-of-range number instead of clamping it", () => {
    const out = executeToolCall(snap, {
      name: "search_transactions", input: { limit: 5000 },
    });
    expect(out).toMatchObject({ ok: false, error: "invalid_arguments" });
    if (out.ok) return;
    expect(out.detail).toContain("limit");
  });

  it("rejects a malformed date", () => {
    const out = executeToolCall(snap, {
      name: "get_statistics", input: { filters: { dateFrom: "מרץ 2024" } },
    });
    expect(out).toMatchObject({ ok: false, error: "invalid_arguments" });
  });

  it("rejects a comparison of fewer than two cities", () => {
    const out = executeToolCall(snap, { name: "compare_locations", input: { cities: ["רמת גן"] } });
    expect(out).toMatchObject({ ok: false, error: "invalid_arguments" });
  });

  it("rejects a wrongly typed argument", () => {
    const out = executeToolCall(snap, {
      name: "get_statistics", input: { filters: { roomsMin: "ארבע" } },
    });
    expect(out).toMatchObject({ ok: false, error: "invalid_arguments" });
  });

  it("returns an insufficient result for a city absent from the data", () => {
    // Zod allows any string; the engine is what knows the city has no rows.
    const out = executeToolCall(snap, {
      name: "get_statistics", input: { filters: { city: "עיר מומצאת" } },
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.result.type).toBe("insufficient");
  });

  it("turns a declined question into a grounded text answer", () => {
    const out = executeToolCall(snap, {
      name: "answer_not_supported",
      input: { reason: "המאגר אינו מכיל מידע על בתי ספר" },
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.result.type).toBe("text");
    expect(out.result.evidence.transactionCount).toBe(0);
    expect(out.result.evidence.notes[0]).toContain("עסקאות נדל");
  });

  it("every declared tool has a matching Zod schema", () => {
    for (const t of tools) {
      expect(isToolName(t.name)).toBe(true);
      expect(TOOL_SCHEMAS[t.name as keyof typeof TOOL_SCHEMAS]).toBeDefined();
    }
  });
});
