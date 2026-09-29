# Madlan AI Real Estate Analyst — Implementation Plan

## Context

Take-home for a Senior Full Stack role at Madlan. The brief (`madlan_tech_challenge.md`) supplies 530 rows of real Israeli property deals, deliberately dirty and deliberately under-specified, and asks for one genuinely useful LLM product, deployed at a public URL, in Hebrew/RTL, on ~5 focused hours. `madlan_ai_real_estate_analyst_spec.md` is the product spec: an **AI Real Estate Analyst** where the LLM understands Hebrew intent and the backend owns every number.

On top of the spec, this build adds a second feature: **two roles (admin / regular user)**, where the admin gets an **upload-data page** that runs the CSV through the normalization pipeline, uses AI to canonicalize messy values, and shows a **log of every problem found and every fix applied**. That turns the "data is dirty" part of the brief from a paragraph in a README into something demoable — which is the strongest part of this submission, because the interview explicitly asks "what did you find wrong with the CSV, and how did you handle duplicate IDs?"

Decisions already made by the user:

| Decision | Choice |
|---|---|
| LLM | **Claude Haiku 4.5** (`claude-haiku-4-5`) for both calls (~$9/day at 10k req/day) |
| Jev AI | Not now. README documents it as the next step behind a provider seam |
| Persistence | **In-memory snapshot**, no database. README documents Postgres as the next step |
| Hosting | Vercel |
| Auth | Minimal — two seeded users from env vars, `role` claim, middleware-guarded `/admin` |
| Scope | Full scope, single sequence, every step committed |

**One concern to state up front, then work around:** dropping Postgres means an admin upload can't survive a Vercel cold start or reach other instances. The plan handles this without a database — the repo ships a committed snapshot built by a CLI script, so the deployed app *always* has good data; a runtime upload produces the full issue log plus a **downloadable `snapshot.json`** the admin commits to make it permanent. That is honest, demos perfectly, and is the thing the README's "next step: real DB" note is actually about.

---

## What I found in the CSV (verified, not assumed)

530 rows, 19 columns, deal dates 2021-01 → 2026-07. Profiled with a throwaway script; these numbers drive the whole pipeline and go into `docs/DATA_QUALITY.md`.

| # | Issue | Evidence | Decision |
|---|---|---|---|
| 1 | **City aliases** — 29 distinct for ~15 real cities | `תל אביב` / `תל אביב-יפו` / `תל אביב יפו` / `ת"א` / `Tel Aviv-Yafo`; `באר שבע` / `באר-שבע` / `ב"ש`; `בית שמש` / `בית-שמש`; `ירושלים` / `Jerusalem` | Committed alias table → canonical Hebrew |
| 2 | **`מודיעין` vs `מודיעין-מכבים-רעות` vs `מודיעין מכבים רעות`** | 5 neighborhoods (`כרמים`,`מוריה`,`בוכמן`,`נופים`,`הפרחים`) appear under all three | Merge to `מודיעין-מכבים-רעות`. Documented with this evidence |
| 3 | **Whitespace variants** | 66 neighborhood collisions (`'מרכז '` vs `'מרכז'`), 8 streets, 6 property types, 5 conditions | Trim + collapse internal runs |
| 4 | **Booleans in 8 forms** | `כן`/`לא`/`yes`/`no`/`TRUE`/`FALSE`/`1`/`0` across all 4 flag columns | Tri-state `true`/`false`/`null` |
| 5 | **Rooms as text** | 19 forms for 10 values — `4` and `4 חדרים` both present | Strip suffix → number |
| 6 | **4 date formats** | ISO ×373, `DD/MM/YYYY` ×76, `DD.MM.YYYY` ×55, **`Mon YYYY` ×26** (no day) | Parse all. Day-less → 1st of month + `datePrecision:'month'`; excluded from day-level analysis, included in monthly buckets |
| 7 | **Prices with thousands separators** | 56 rows: `"4,331,000"` | Strip commas |
| 8 | **Missing / impossible prices** | 13 empty, 1 zero (`D100251`), 1 absurd (`D100317`: ₪18,000 for 132 m², stated pps `0`) | 12 of 13 recoverable as `size × price_per_sqm`. Unrecoverable + zero + absurd → **quarantined**, not deleted |
| 9 | **`price_per_sqm` contradicts `price / size`** | **27 of 506** rows deviate >2% (range 0.74× – 1.24×) | Recompute as the analytic field, keep raw as `pricePerSqmRaw`, log every conflict |
| 10 | **Duplicate deal IDs** | 10 IDs twice. **5 byte-identical**; **5 conflict** — `D100017`, `D100124`, `D100032`, `D100303` differ in `price_nis` *and* `source` | Identical → collapse + log. Conflicting → **keep both rows**, tag `conflictGroup`, **exclude from aggregates by default**, surface in admin log and in the UI's evidence panel. Never auto-merge (spec §7 forbids it) |
| 11 | **Missing values** | size 10, floor 24, `year_built` 35, condition 16, neighborhood 11, `has_parking` 20 | `null`. Every tool reports how many rows it dropped and why |
| 12 | **Neighborhood isn't globally unique** | `מרכז` in 9 cities, `מרכז העיר` in 7 | Composite key `(city, neighborhood)`. `מרכז` vs `מרכז העיר` kept **distinct** — merging them is a guess; logged as an open question |

Clean columns: `source` (3 values), `total_floors` (no gaps), `year_built` range 1950–2024, no `floor > total_floors` violations, no future-dated deals.

Net: ~530 raw → ~512 analyzable. The exact number is computed by the pipeline, never hardcoded, and shown in the UI.

---

## Architecture

```
Hebrew question
      │
      ├─ L1 response cache  (sha256(normalized q + snapshotVersion)) ──── hit ──▶ done, 0 LLM calls
      │
      ├─ CALL 1  claude-haiku-4-5 · 6 strict tools · tool_choice:{type:"any"} · 3s timeout
      │          model picks ONE tool + emits schema-valid args
      │          └─ fails/times out/invalid ──▶ deterministic regex router over canonical vocab
      │
      ├─ Zod re-validates args server-side  (strict:true is the model's promise; Zod is mine)
      │
      ├─ ANALYSIS ENGINE  — pure TypeScript over the in-memory snapshot
      │                     every number computed here. filters, medians, MAD, scoring, dates
      │                     returns { data, evidence }
      │
      ├─ CALL 2  claude-haiku-4-5 · narrates the VERIFIED result only · never sees raw rows
      │          └─ fails ──▶ templated Hebrew sentence from the same evidence object
      │
      └─ typed response → React renderer + evidence panel
```

**Why the line is there:** the model does language (intent, parameters, one short Hebrew paragraph); it never sees more than one page of already-computed results, so it cannot invent a number. `find_anomalies` is the sharpest example — the model picks the tool, MAD arithmetic picks the deals.

**Prompt caching:** system prompt + the 6 tool definitions + canonical city vocabulary form a byte-stable prefix with `cache_control: {type:"ephemeral"}`. The volatile user question goes last. *Verify `usage.cache_read_input_tokens > 0` on the second request* — Haiku 4.5 has a minimum cacheable prefix and short prefixes silently don't cache.

**Haiku 4.5 specifics:** no `thinking` param (adaptive thinking is 4.6+; Haiku takes `budget_tokens`, and these calls are classification + two sentences — thinking only adds latency). `output_config.effort` **errors** on Haiku 4.5 — don't send it. 200K context. `max_tokens`: 512 for call 1, 700 for call 2.

**Cost at 10k/day** (~$9/day, ~$275/mo) goes in the README with the arithmetic shown, plus "at 10×: move the router to Jev at $0.042/M input with output free, push the response cache to Redis, precompute per-city monthly aggregates at upload time."

---

## Stack

Next.js 15 App Router · TypeScript strict · Tailwind (`dir="rtl"`, logical properties only) · Recharts · `@anthropic-ai/sdk` · Zod · Vitest · Playwright · Vercel.

No ORM, no DB client, no state library. `papaparse` for CSV.

```
src/
  lib/normalize/        rules.ts  aliases.ts  dates.ts  booleans.ts  numbers.ts  index.ts
  lib/ingest/           pipeline.ts  dedupe.ts  issues.ts  aiCanonicalize.ts
  lib/analysis/         filters.ts  stats.ts  timeSeries.ts  comparables.ts  anomalies.ts  compare.ts
  lib/llm/              client.ts  tools.ts  router.ts  narrator.ts  fallbackRouter.ts  provider.ts
  lib/cache/            responseCache.ts
  lib/snapshot.ts       loads data/snapshot.json into module memory, versioned
  app/                  page.tsx  browse/  admin/  api/ask/  api/admin/upload/  api/auth/
  components/           renderers/{Statistics,TimeSeries,Comparison,DealList,PropertyComparison,Text}.tsx
                        EvidencePanel.tsx  QueryBox.tsx  ExamplePrompts.tsx
scripts/profile-csv.ts  scripts/build-snapshot.ts
data/snapshot.json      committed build artifact
docs/DATA_QUALITY.md  docs/ARCHITECTURE.md  docs/AI_LOG.md
```

`lib/llm/provider.ts` is the seam Jev slots into later: `classify(input, options[]) → {choice, confidence}`. Claude implements it now via strict tools; Jev implements it with one `choice` question. The README names this file.

---

## Key algorithms (must be explainable in the interview)

**Comparable deals** — weighted score, `city` a hard filter:

```
neighborhood match   0.15
rooms                0.25 × (1 − min(1, |Δrooms| / 2))
area                 0.30 × (1 − min(1, |Δsqm| / (subject × 0.5)))
recency              0.15 × 0.5^(monthsAgo / 12)
property type match  0.15
```

Every returned deal carries its per-factor breakdown so the UI explains *why* it was chosen. Fewer than 5 matches → "אין מספיק עסקאות דומות במאגר כדי להציג השוואה אמינה."

**Anomalies** — modified z-score (Iglewicz–Hoaglin) on `pricePerSqm` within a peer group of same city + rooms ±0.5, requiring n ≥ 8:

```
Mz = 0.6745 × (x − median) / MAD      flag |Mz| ≥ 3.5
```

Median/MAD not mean/σ, because 530 rows with a ₪44M penthouse will not tolerate a mean. UI copy: *"חריגה = שונה סטטיסטית מ-N עסקאות דומות"* — never "שגוי".

**Time series** — median `pricePerSqm` per month (quarterly when a month has < 3 deals), with `n` per point. Empty periods are gaps in the line, never interpolated.

---

## Steps

Each step ends in a commit. Steps 1–9 are testable without a browser; the app is deployable from step 12 onward.

**1 — Repo + scaffold.** `~/dev/madlan`, `gh repo create madlan-ai-analyst --private`. Next.js + TS strict + Tailwind RTL + Vitest + Playwright + a GitHub Action running `typecheck && test && build`. Write the repo's own `PLAN.md` from this file. → *commit: scaffold*

**2 — Profile the CSV.** `scripts/profile-csv.ts` reproduces the table above as committed output, plus `docs/DATA_QUALITY.md` with all 12 issues, counts, and the reasoning behind each decision. This document is the interview answer to "what did you find wrong?" → *commit: data profiling*

**3 — Normalization layer.** `lib/normalize/` — one small pure function per rule (booleans, rooms, dates+precision, numbers, aliases, trim). Every row keeps `raw` alongside normalized fields. Table-driven Vitest cases using **real values pulled from the CSV**, not invented ones. → *commit: normalization + unit tests*

**4 — Dedupe, quarantine, issue log.** `lib/ingest/` — collapse identical dupes, tag conflict groups, quarantine unusable prices, derive the 12 recoverable prices, recompute `pricePerSqm` and log the 27 conflicts. Emits `IngestIssue[]` (`row, dealId, field, type, rawValue, action, resolvedValue, resolver: 'deterministic'|'ai'|'none', confidence?`) and sets `isAnalyzable` per row. Unit tests assert exact expected counts (10 dupes → 5 collapsed / 5 conflict groups, 27 pps conflicts, etc.), so a regression in the pipeline fails CI. → *commit: dedupe + quarantine policy*

**5 — Snapshot builder.** `scripts/build-snapshot.ts` → `data/snapshot.json` (`{version, builtAt, deals, issues, vocabulary, counts}`). `lib/snapshot.ts` loads it into module memory once per instance. Commit the built snapshot. → *commit: snapshot builder + baked snapshot*

**6 — Analysis engine.** The six operations over the snapshot, as pure functions returning `{data, evidence}`. Statistics, time series, comparison, comparables (scoring above), anomalies (MAD above), search. Every one declares dropped rows and reasons in its evidence. Unit tests for the math against hand-computed fixtures; integration tests asserting golden results against the real snapshot. → *commit: analysis engine + tests*

**7 — Tool schemas + validation.** Six Anthropic tool definitions with `strict: true`, `additionalProperties: false`, `required`, enums drawn from the snapshot's actual vocabulary (so the model cannot name a city that isn't in the data), `limit` capped at 50. A parallel Zod schema per tool re-validates server-side. Tests prove out-of-range and unknown-city args are rejected. → *commit: tool schemas + server-side validation*

**8 — Claude router + narrator.** `router.ts`: one `messages.create` with the six tools, `tool_choice: {type: "any"}`, cached system prefix, 3s `AbortController`, one retry only on 429/5xx (never on a schema failure). `narrator.ts`: second call receiving the verified result JSON and a system prompt that forbids new numbers, forbids market/future/causal/investment claims, and requires the *"בעסקאות שנמצאו במאגר…"* framing. Typed exceptions (`Anthropic.RateLimitError` etc.), never string matching. → *commit: Claude router + narrator*

**9 — Degradation paths.** `fallbackRouter.ts`: regex/keyword matching against the snapshot's own canonical vocabulary + number patterns (`4 חדרים`, `100 מ"ר`, `3.9 מיליון`) → a valid tool call without any LLM. Templated Hebrew sentences from the evidence object when call 2 fails. A `/browse` page with plain filters that never touches Claude. Every response carries `degraded: boolean` and the UI says so. Unit tests for the fallback router; a test that the whole `/api/ask` path works with the Anthropic client stubbed to throw. → *commit: fallback + degraded mode*

**10 — Cache + API route.** L1 LRU keyed on `sha256(normalizedQuestion + snapshotVersion)`, capped, with hit/miss counters exposed at `/api/health`. `POST /api/ask` wires cache → router → validate → analyze → narrate → typed response. Zod-validated request body, length cap on the question. → *commit: cache + ask endpoint*

**11 — Hebrew RTL UI.** `dir="rtl"` at the root, logical CSS properties throughout (no `left`/`right`). Header, large query box with the 5 example prompts from the spec, and the six renderers. Recharts with RTL axes and Hebrew tooltips; `ILS` via `Intl.NumberFormat('he-IL')`. A visually distinct evidence panel on every analytical answer: transaction count, date range, active filters, metric definition, excluded-row counts, and a note when a conflicting-duplicate group was excluded. Loading skeletons, empty state, error state, degraded badge. No raw JSON anywhere. → *commit: Hebrew RTL UI + renderers*

**12 — Auth, two roles.** Two users seeded from `ADMIN_EMAIL`/`ADMIN_PASSWORD_HASH`/`USER_EMAIL`/`USER_PASSWORD_HASH`. Signed `httpOnly` JWT cookie carrying `role`. `middleware.ts` guards `/admin` and `/api/admin/*`; a regular user gets 403, not a redirect loop. No signup. → *commit: auth + role guard*

**13 — Deploy.** Vercel from the repo, `ANTHROPIC_API_KEY` server-side only, Israel-adjacent region. Verify on the live URL before continuing — deploying at step 13 rather than step 17 means the rest of the build is validated against production. → *commit: deployment config*

**14 — Admin upload + issue log.** `/admin/upload`: drag a CSV → `POST /api/admin/upload` runs the same step-4 pipeline → returns `{counts, issues, snapshot}`. UI shows summary cards (rows in / analyzable / quarantined / conflicts / AI-resolved), a filterable issue table grouped by type, AI decisions visually marked with their confidence, and **download `snapshot.json`**. The new snapshot becomes this instance's active dataset immediately, with a clear banner that it is instance-local until committed. → *commit: admin upload + issue log*

**15 — AI canonicalization in the pipeline.** `aiCanonicalize.ts` — deterministic rules run first; only *unresolved* tokens (an unknown city, neighborhood, property type, or condition) reach Claude, batched into **one** call whose output is constrained to the canonical whitelist plus a confidence. ≥0.85 auto-applies, 0.60–0.85 applies but flags for admin review, <0.60 leaves the value null and quarantines the row. Resolved mappings are appended to the alias table so the next upload costs nothing. Cost per upload: 1–2 calls, not 530. Tests use a stubbed provider; one test feeds a deliberately invented city and asserts it is rejected rather than guessed. → *commit: AI canonicalization*

**16 — E2E tests.** Playwright: the 5 demo scenarios from spec §19 in Hebrew; `dir="rtl"` asserted; an unsupported question producing an explicit limitation and no numbers; Claude stubbed to 503 → degraded path renders and is labelled; admin login → upload → issue log shows 10 duplicates and 27 pps conflicts; regular user gets 403 on `/admin`. → *commit: e2e tests*

**17 — Docs.** `README.md` (architecture diagram, the LLM/backend boundary and why, cost arithmetic at 10k/day and at 10×, grounding strategy, failure matrix, what was cut and why, **"next step: swap the router to Jev AI behind `lib/llm/provider.ts`"**, **"next step: replace the in-memory snapshot with Postgres"**), `docs/ARCHITECTURE.md`, `docs/AI_LOG.md` — a real log kept *during* the build, including at least one genuine bad AI answer and how it was caught. → *commit: docs*

---

## The AI log — record these as they happen

Not fabricated. Two candidates already exist from this planning session, both real:

1. **"jev ai" was assumed to be an LLM.** It is not — Jev is TypeSafe AI's *System One* model (`POST https://thejevai.com/v1/systemone`, three question types, no text generation, output tokens billed at $0). Caught by reading the actual docs instead of trusting the name. The consequence was architectural: Jev can canonicalize and route but structurally cannot write the Hebrew narration, which is why `lib/llm/provider.ts` exists as a seam rather than the whole LLM layer.
2. **Model-parameter drift.** `output_config.effort` and adaptive thinking are 4.6+ features; both would have failed against Haiku 4.5. Caught against current API docs, not recall.

Keep logging through the build. The likeliest third is a generated statistics function using mean where the data demands median — check every aggregation by hand against a small fixture.

---

## Verification

Per step: `npm run typecheck && npm test`. CI enforces both plus `build`.

**Data layer (step 5).** `npx tsx scripts/build-snapshot.ts` then assert against the profiled numbers: 29 raw cities → ~15 canonical, 10 duplicate IDs → 5 collapsed + 5 conflict groups, 27 `price_per_sqm` conflicts logged, `D100317` and `D100251` quarantined, 26 rows carrying `datePrecision:'month'`, ~512 analyzable.

**LLM layer (steps 8–10).** Run the 5 demo questions through `/api/ask` and diff the numbers against the same operations called directly — they must be identical, because the model isn't allowed to produce them. Confirm `usage.cache_read_input_tokens > 0` on a repeat request. Force a timeout (`ANTHROPIC_BASE_URL` at a dead port) and confirm a useful Hebrew answer still renders, flagged `degraded`.

**Grounding.** Ask something the CSV cannot answer — *"מה מחיר השוק בהרצליה ב-2027?"*, *"איזו שכונה הכי שקטה?"* — and confirm an explicit limitation with zero invented figures.

**Admin flow (step 14).** Log in as admin, upload the original CSV, confirm the issue log surfaces all 10 duplicate IDs with the 5 conflicts distinguished from the 5 identical, and that the AI-resolved rows show a confidence. Log in as the regular user, confirm 403 on `/admin`.

**Live.** All of the above against the deployed URL, on a phone as well as a desktop, before sending it.

---

## Deliberately cut — say so in the README

Postgres (in-memory snapshot instead, per instruction), Jev AI (provider seam only, per instruction), maps, neighborhood-level time series where `n` is too small to mean anything, multi-turn conversation, streaming responses, user accounts beyond the two seeded ones, `מרכז`/`מרכז העיר` merging (a guess I declined to make), and Hebrew morphological search beyond alias matching.
