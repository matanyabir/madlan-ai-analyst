import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { aiCanonicalize, CONFIDENCE_AUTO, CONFIDENCE_REVIEW } from "./aiCanonicalize";
import { normalizeRow } from "@/lib/normalize";
import * as client from "@/lib/llm/client";
import type { Deal } from "@/lib/types";

const BASE: Record<string, string> = {
  deal_id: "D1", city: "רמת גן", neighborhood: "מרכז", street: "ביאליק",
  property_type: "דירה", rooms: "4", size_sqm: "100", floor: "2",
  total_floors: "8", year_built: "2000", condition: "שמור",
  has_elevator: "כן", has_parking: "כן", has_balcony: "כן", has_safe_room: "כן",
  deal_date: "2025-01-01", price_nis: "3000000", price_per_sqm: "30000",
  source: "רשות המסים",
};

function dealWithCity(rawCity: string): Deal {
  return normalizeRow({ ...BASE, city: rawCity }, 2).deal;
}

/** Fakes one Claude tool-use response. */
function stubClaude(mappings: unknown) {
  vi.spyOn(client, "getClient").mockReturnValue({
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: "tool_use", name: "submit_city_mappings", input: { mappings } }],
        usage: { input_tokens: 400, output_tokens: 90 },
      }),
    },
  } as never);
}

beforeEach(() => vi.restoreAllMocks());
afterEach(() => vi.restoreAllMocks());

describe("aiCanonicalize", () => {
  it("does nothing, and costs nothing, when everything already resolved", async () => {
    const spy = vi.spyOn(client, "getClient");
    const deals = [dealWithCity("רמת גן"), dealWithCity('ת"א')];

    const out = await aiCanonicalize(deals, []);
    expect(out.stats).toBeNull();
    expect(out.issues).toHaveLength(0);
    // The sample CSV resolves entirely deterministically, so no upload of it
    // should ever reach the API.
    expect(spy).not.toHaveBeenCalled();
  });

  it("applies a high-confidence mapping and un-quarantines the row", async () => {
    stubClaude([
      { rawValue: "רמת-גן", canonical: "רמת גן", confidence: 0.97, reasoning: "מקף במקום רווח" },
    ]);
    const deal = dealWithCity("רמת-גן");
    expect(deal.isAnalyzable).toBe(false);

    const out = await aiCanonicalize([deal], []);
    expect(out.deals[0].city).toBe("רמת גן");
    expect(out.deals[0].isAnalyzable).toBe(true);
    expect(out.deals[0].quarantineReasons).not.toContain("unresolved_city");
    expect(out.stats).toMatchObject({ applied: 1, flaggedForReview: 0, refused: 0, llmCalls: 1 });

    const issue = out.issues.find((i) => i.type === "ai_canonicalized")!;
    expect(issue.resolver).toBe("ai");
    expect(issue.confidence).toBe(0.97);
    expect(issue.severity).toBe("info");
  });

  it("applies a medium-confidence mapping but flags it for review", async () => {
    stubClaude([
      { rawValue: "ראשל״צ", canonical: "ראשון לציון", confidence: 0.72, reasoning: "ראשי תיבות" },
    ]);
    const out = await aiCanonicalize([dealWithCity("ראשל״צ")], []);

    expect(out.deals[0].city).toBe("ראשון לציון");
    expect(out.stats).toMatchObject({ applied: 0, flaggedForReview: 1 });
    const issue = out.issues.find((i) => i.type === "ai_canonicalized")!;
    expect(issue.severity).toBe("warning");
    expect(issue.note).toContain("מומלץ לאמת");
  });

  it("refuses a low-confidence mapping and leaves the row quarantined", async () => {
    stubClaude([
      { rawValue: "בלה בלה", canonical: "חיפה", confidence: 0.2, reasoning: "ניחוש" },
    ]);
    const out = await aiCanonicalize([dealWithCity("בלה בלה")], []);

    expect(out.deals[0].city).toBeNull();
    expect(out.deals[0].isAnalyzable).toBe(false);
    expect(out.stats).toMatchObject({ refused: 1, applied: 0 });
    expect(out.issues.find((i) => i.type === "ai_rejected")!.severity).toBe("error");
  });

  it("rejects a city the model invented, even at high confidence", async () => {
    // strict:true should make this impossible; the whitelist re-check is the
    // guarantee that does not depend on the provider honouring its schema.
    stubClaude([
      { rawValue: "עיר חדשה", canonical: "מטרופולין אטלנטיס", confidence: 0.99, reasoning: "" },
    ]);
    const out = await aiCanonicalize([dealWithCity("עיר חדשה")], []);

    expect(out.deals[0].city).toBeNull();
    expect(out.stats).toMatchObject({ refused: 1 });
    expect(out.issues.find((i) => i.type === "ai_rejected")!.note)
      .toContain("שאינו ברשימת הערים המותרות");
  });

  it("refuses a value the model simply omitted from its answer", async () => {
    stubClaude([]);
    const out = await aiCanonicalize([dealWithCity("עיר חסרה")], []);
    expect(out.stats).toMatchObject({ refused: 1 });
    expect(out.deals[0].isAnalyzable).toBe(false);
  });

  it("resolves many unknown values in a single call", async () => {
    const create = vi.fn().mockResolvedValue({
      content: [{
        type: "tool_use", name: "submit_city_mappings",
        input: {
          mappings: [
            { rawValue: "רמת-גן", canonical: "רמת גן", confidence: 0.95, reasoning: "" },
            { rawValue: "חיפא", canonical: "חיפה", confidence: 0.91, reasoning: "" },
            { rawValue: "נתניא", canonical: "נתניה", confidence: 0.93, reasoning: "" },
          ],
        },
      }],
      usage: { input_tokens: 500, output_tokens: 120 },
    });
    vi.spyOn(client, "getClient").mockReturnValue({ messages: { create } } as never);

    const out = await aiCanonicalize(
      [dealWithCity("רמת-גן"), dealWithCity("חיפא"), dealWithCity("נתניא")],
      [],
    );
    // Cost is per upload, not per row.
    expect(create).toHaveBeenCalledTimes(1);
    expect(out.stats).toMatchObject({ unresolvedValues: 3, applied: 3, llmCalls: 1 });
  });

  it("degrades to leaving rows quarantined when the model is unavailable", async () => {
    vi.spyOn(client, "getClient").mockReturnValue(null);
    const out = await aiCanonicalize([dealWithCity("עיר לא ידועה")], []);

    expect(out.deals[0].isAnalyzable).toBe(false);
    expect(out.stats).toBeNull();
    expect(out.issues[0].type).toBe("ai_rejected");
    expect(out.issues[0].note).toContain("לא ניתן היה לפנות");
  });

  it("degrades the same way when the call throws", async () => {
    vi.spyOn(client, "getClient").mockReturnValue({
      messages: { create: vi.fn().mockRejectedValue(new Error("network down")) },
    } as never);

    const out = await aiCanonicalize([dealWithCity("עיר לא ידועה")], []);
    expect(out.deals[0].isAnalyzable).toBe(false);
    expect(out.issues[0].type).toBe("ai_rejected");
  });

  it("uses thresholds that leave no silent gap", () => {
    expect(CONFIDENCE_REVIEW).toBeLessThan(CONFIDENCE_AUTO);
    expect(CONFIDENCE_REVIEW).toBeGreaterThan(0);
    expect(CONFIDENCE_AUTO).toBeLessThan(1);
  });
});
