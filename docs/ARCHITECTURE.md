# Architecture

A companion to the README for the 15-minute architecture segment. The README
has the reasoning; this has the diagram and the file-level map.

## System

```
                    ┌──────────────────────────────────────────┐
  Hebrew question   │  Next.js 16 · App Router · Vercel        │
        │           │                                          │
        ▼           │   ┌────────────────────────────────┐     │
  ┌──────────┐      │   │  /api/ask   (lib/ask.ts)       │     │
  │  React   │─────►│   │                                │     │
  │  client  │      │   │  0. per-IP bucket ──over──▶ 429│     │
  └──────────┘      │   │         │                      │     │
        ▲           │   │         ▼                      │     │
        │           │   │  1. response cache  ──hit──────┼─────┼──▶ answer
        │           │   │         │ miss                 │     │     0 calls
        │           │   │         ▼                      │     │
        │           │   │  1b. daily budget              │     │
        │           │   │         │ spent ──▶ skip 2 & 5 │     │
        │           │   │         ▼         (no LLM cost)│     │
        │           │   │  2. router ────────────────────┼─────┼──▶ Claude
        │           │   │         │                      │     │    Haiku 4.5
        │           │   │         │  fail ──▶ regex      │     │    7 tools
        │           │   │         ▼          fallback    │     │    6s timeout
        │           │   │  3. Zod validation             │     │
        │           │   │         │                      │     │
        │           │   │         ▼                      │     │
        │           │   │  4. ANALYSIS ENGINE            │     │
        │           │   │     in-memory snapshot         │     │
        │           │   │     ALL arithmetic here        │     │
        │           │   │         │ { data, evidence }   │     │
        │           │   │         ▼                      │     │
        │           │   │  5. narrator ──────────────────┼─────┼──▶ Claude
        │           │   │         │  fail ──▶ template   │     │    verified
        └───────────┼───┤         ▼                      │     │    result only
     typed result   │   │  6. cache (if not degraded)    │     │
     + evidence     │   └────────────────────────────────┘     │
                    │                                          │
                    │   ┌────────────────────────────────┐     │
                    │   │  /admin  (admin only)          │     │
                    │   │    CSV ─▶ ingest ─▶ snapshot   │     │
                    │   │            │                   │     │
                    │   │            └─ unresolved ──────┼─────┼──▶ Claude
                    │   │               values only,     │     │    1 batched
                    │   │               closed enum      │     │    call
                    │   └────────────────────────────────┘     │
                    └──────────────────────────────────────────┘
```

## The boundary, stated once

**The model may:** read Hebrew, choose one of seven operations, extract
parameters from a closed vocabulary, write two sentences about a finished
result, decline.

**The model may not:** see a transaction row, compute anything, name a value
outside the schema enums, choose which deals are similar, decide what counts
as an anomaly, emit markup, or be reached at all once the day's allowance is
spent — at which point step 2 and step 5 are simply skipped and the
deterministic path answers the same question from the same evidence.

## Data flow at build time

```
madlan_deals_sample.csv
        │
        ▼  scripts/build-snapshot.ts   (same ingestCsv as the upload route)
   normalize        one pure fn per defect · lib/normalize/
        │           every transformation emits an IngestIssue
        ▼
   canonicalize     (upload only) unresolved values → 1 batched Claude call
        │
        ▼
   dedupe           6 identical collapsed · 4 conflict groups held out
        │
        ▼
   data/snapshot.json    530 rows in → 505 analysable · 645 issues
        │                version = sha256(csv)[:12]
        ▼
   lib/snapshot.ts       imported, held in module memory
```

## Module map

| Path | Responsibility |
|---|---|
| `lib/normalize/` | One pure function per defect class. No I/O. |
| `lib/ingest/pipeline.ts` | CSV → Snapshot. Shared by build script and upload. |
| `lib/ingest/dedupe.ts` | The identical-vs-conflicting duplicate policy. |
| `lib/ingest/aiCanonicalize.ts` | The only place the model touches data. |
| `lib/analysis/` | Six operations. Every number in the product. |
| `lib/analysis/stats.ts` | median, percentile, MAD, modified z-score. |
| `lib/llm/tools.ts` | JSON Schema (for Claude) + Zod (for us). |
| `lib/llm/router.ts` | Call 1. |
| `lib/llm/narrator.ts` | Call 2 + the template fallback. |
| `lib/llm/fallbackRouter.ts` | The no-model router. |
| `lib/llm/provider.ts` | The Jev seam. |
| `lib/llm/budget.ts` | Per-IP rate limit + the daily spend ceiling. |
| `lib/ask.ts` | The request path, end to end. |
| `proxy.ts` | Optimistic redirect only. Not the auth boundary. |
| `lib/auth/guard.ts` | The actual auth boundary. |

## What I would rebuild first as a real Madlan feature

1. **Postgres**, with the analysis operations as parameterized SQL and the
   statistics still in TypeScript so they stay unit-testable.
2. **Jev for routing**, per `lib/llm/provider.ts`.
3. **An eval set.** Right now correctness is proven by unit tests over the
   engine and by reading answers. A real feature needs ~100 labelled Hebrew
   questions with expected tool + parameters, run on every prompt change.
   Routing quality is currently unmeasured, and that is the biggest gap.
4. **Observability**: per-request tool choice, latency, degraded reason, cache
   hit, tokens. `/api/health` reports a slice of this; it should be a
   dashboard with alerts on degraded-rate and on p95 latency.
