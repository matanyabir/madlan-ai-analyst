# אנליסט הנדל״ן — Madlan AI Real Estate Analyst

Ask questions in Hebrew about 530 real Israeli property transactions. The
model understands the question and writes the explanation; **every number is
computed in TypeScript from the data**, and every answer shows what it rests
on.

**Live:** _(deployed URL)_
**Stack:** Next.js 16 · TypeScript · Tailwind 4 · Recharts · Claude Haiku 4.5 (configurable)
**Tests:** 252 unit (Vitest) · 39 end-to-end (Playwright)

---

## The one-paragraph version

The hard part of this brief is not getting an LLM to talk about a CSV — it is
making sure it never says anything the CSV does not support. So the model is
given exactly two jobs, both of them language jobs: turn a Hebrew question
into one of seven validated tool calls, and turn an already-computed result
into two sentences of Hebrew. It never sees a transaction row, never performs
arithmetic, and cannot name a city that is not in the data because the tool
schema enumerates the cities from the dataset itself. Everything numeric —
filtering, medians, MAD-based anomaly detection, comparable-deal scoring — is
plain deterministic code with unit tests. If the model is slow, wrong or
absent, a deterministic router and a template narrator answer the same
question from the same evidence, and the UI says the explanation is templated.

---

## Request path

```
Hebrew question
      │
      ├─ L1 cache   sha256(normalized question + snapshot version)
      │             hit → 0 LLM calls, ~1ms
      │
      ├─ CALL 1     claude-haiku-4-5 · 7 strict tools · tool_choice:"any" · 6s
      │             picks ONE tool, emits schema-valid arguments
      │             fail/timeout/invalid ──▶ deterministic regex router
      │
      ├─ Zod        re-validates every argument server-side.
      │             Rejects, never clamps.
      │
      ├─ ENGINE     pure TypeScript over the in-memory snapshot.
      │             ALL numbers originate here. → { data, evidence }
      │
      ├─ CALL 2     claude-haiku-4-5 · sees the verified result only · 6s
      │             fail ──▶ template narrator, same evidence object
      │
      └─ typed response → React renderer + evidence panel
```

### Why the line is there

The model is good at Hebrew and bad at being accountable. So it gets the work
where being wrong is recoverable — misreading intent produces a visibly odd
answer the user can rephrase — and none of the work where being wrong is
invisible. A wrong median looks exactly like a right one.

Concretely: for *"מצא עסקאות חריגות"* the model picks the tool and the
MAD arithmetic picks the deals. For *"תשווה בין רמת גן לגבעתיים"* the model
extracts two city names from an enum and the engine computes both medians.

### Why not send the CSV to the model

Three reasons, in order of importance. It would make every number a
generation rather than a computation, which is the whole problem. It would
cost ~40× more per request. And it would stop working the moment the dataset
outgrows a context window, which is a bad property for a product whose admin
page accepts uploads.

---

## Grounding

**Structural, not instructional.** The safeguards are properties of the
system, not requests to the model:

| Risk | Guard |
|---|---|
| Invents a number | Never receives raw rows; receives only computed results |
| Invents a city | Tool schema enumerates cities from the snapshot (`strict: true`) |
| Returns a bad argument | Zod re-validates server-side and rejects |
| Answers an unanswerable question | `answer_not_supported` is a first-class tool, not an error path |
| Overstates a thin result | The engine refuses: see below |

**Every analytical answer carries an evidence panel** — sample size, date
range, active filters, how the metric is defined, and every excluded row with
its reason. It is not collapsible.

**The engine knows what it is not entitled to say.** This turned out to be the
subtler half of grounding, and it cost a real bug (`docs/AI_LOG.md` #6):

- Answers resting on fewer than 10 transactions are flagged *"מדגם קטן"*.
- Time-series granularity escalates month → quarter → year until periods
  carry enough deals; periods below three are drawn as hollow amber dots and
  cannot anchor a claim.
- The headline "prices rose X%" is computed only between periods that clear
  that threshold, and is `null` otherwise — in which case both the model and
  the template say plainly that no change can be determined.
- Fewer than three comparable deals returns *"אין מספיק עסקאות דומות במאגר"*
  rather than a weak list.
- Anomalies are always *"שונה סטטיסטית מקבוצת ההשוואה"*, never *"wrong"*.
  There are unit **and** e2e tests asserting that wording.

---

## The data

530 rows, 19 columns, 2021-01 → 2026-07. Not clean.
[`docs/DATA_QUALITY.md`](docs/DATA_QUALITY.md) documents all thirteen defects
with counts; [`docs/CSV_PROFILE.md`](docs/CSV_PROFILE.md) is the generated
evidence (`npm run profile`).

The three that mattered:

**`price_per_sqm` contradicts `price ÷ size` on 28 of 518 rows**, by up to
1.27×. The two primaries win; the stated value is kept as `pricePerSqmRaw`
and every conflict is logged. A silent few-percent error in the headline
metric is exactly the kind of defect that never announces itself.

**Ten duplicate `deal_id`s are two different problems.** Six are
byte-identical and collapse. Four report *a different price from a different
source* — the same sale seen by רשות המסים and by an agent, 2–4% apart. There
is no defensible rule for picking a winner, so both rows are kept, tagged
with a shared `conflictGroup`, and **excluded from aggregates** so one sale
cannot be counted twice in a median. Preferring the tax authority is probably
right and is still an assumption this pipeline does not make silently.

**Twelve prices carry a `₪` sign** (`"₪12,144,000"`). A parser that strips
only commas returns `null` for them, which my first profiler reported as
"missing". They were never missing — and reading them revealed a 28th
`price_per_sqm` conflict that had been invisible for as long as one field
could not be parsed.

Nothing is deleted. Unusable rows are quarantined with a reason and stay in
the file. **530 in → 505 analysable (95.3%)**, and the UI shows the real
number.

---

## Choosing the model

`claude-haiku-4-5` for all three call sites by default, overridable by
environment variable with no code change — `/api/health` reports which is
actually live.

| Variable | Call site | Why it might differ |
|---|---|---|
| `LLM_ROUTER_MODEL` | intent + parameters | Classification over 7 tools. A small model is the right instrument, and this is the call that moves to Jev. |
| `LLM_NARRATOR_MODEL` | the Hebrew explanation | Open-ended prose — the only place model tier is visible to a user. |
| `LLM_CANONICALIZER_MODEL` | unknown values on upload | Closed-set choice, once per upload rather than per request. |
| `LLM_MODEL` | all three | Shared default; a per-role variable wins over it. |

The shape worth reaching for at scale is a cheap router with a better
narrator — `LLM_ROUTER_MODEL=claude-haiku-4-5` with
`LLM_NARRATOR_MODEL=claude-sonnet-5` — which spends the money only where it
shows. Nothing validates the string against a list of known models on
purpose: a new model should be usable the day it ships, and a wrong id fails
loudly on the first call rather than silently degrading.

## Cost at 10,000 requests/day

Two calls per uncached question on `claude-haiku-4-5` ($1/MTok in, $5/MTok
out), with the system prompt and tool definitions as a cached prefix.

| | in | out |
|---|---|---|
| Call 1 — router | ~1,300 (≈1,100 cached) | ~120 |
| Call 2 — narrator | ~1,100 (≈900 cached) | ~200 |

Assuming a 60% response-cache hit rate — conservative; demo traffic is mostly
the five example prompts — about 4,000 questions/day reach the model:

```
fresh input    4,000 × 600   = 2.4M   × $1.00 /M  = $2.40
cached input   4,000 × 2,000 = 8.0M   × $0.10 /M  = $0.80
output         4,000 × 320   = 1.28M  × $5.00 /M  = $6.40
                                                    ─────
                                         ≈ $9.60/day   ≈ $290/month
```

Ingestion is not in that figure because it is ~free: uploading the sample CSV
makes **zero** API calls, since all 530 rows resolve deterministically. The
model is consulted only for values no rule recognises, batched into one call
for the whole file regardless of size.

**What I would change at 10×** (100k/day, ~$2,900/month):

1. **Move routing to Jev** (see below) — it is a classification with a closed
   answer set, priced at $0.042/MTok in with output free. Removes call 1's
   cost almost entirely: ~$9.60/day → ~$6/day at current volume.
2. **Redis instead of the in-process LRU.** Today each instance has its own
   cache, so the hit rate is divided by the instance count. One shared cache
   would raise the real hit rate well above 60%.
3. **Precompute the common aggregates at upload time** — per city/month
   medians are a few hundred rows and would serve most traffic with no
   computation at all.
4. **Semantic cache on the routed tool call**, not the question string.
   "כמה עסקאות ברמת גן" and "מספר העסקאות ברמת גן" route identically and
   currently cost two separate calls.

---

## Failure handling

| Failure | Behaviour |
|---|---|
| No API key | Deterministic router + template narrator. Everything works. |
| Router times out (6s) | Same, flagged `router_timeout` |
| Router returns invalid arguments | Rejected by Zod, falls to deterministic router |
| Router names a nonexistent tool | Same |
| Narrator fails or truncates | Template narrator, same evidence object |
| Rate limit / 5xx | One retry, then fall back. Schema failures are never retried. |
| Everything down | `/browse` — server-rendered filters, no client bundle |

Degraded answers are **not cached**, so recovery restores the better prose.
The badge says *"מצב מצומצם — הנתונים מדויקים, ההסבר תבניתי"*: the numbers were
never the model's, so its absence changes the writing, not the reliability.

The e2e suite runs against a server with **no API key at all** — constraint 6
is tested on every CI run, not asserted here.

---

## Next steps (deliberately not built)

### 1. Swap routing to Jev AI

[`src/lib/llm/provider.ts`](src/lib/llm/provider.ts) is the seam.

Jev is TypeSafe AI's *System One* model (`POST https://thejevai.com/v1/systemone`).
It is not an LLM — it returns typed `choice` / `score` / `noul` decisions with
a calibrated confidence and **generates no text**, which is why output tokens
cost $0. For this app's two closed-set decisions — which of seven tools, and
which canonical city an unknown spelling means — it is a better instrument
than a generative model: a `choice` whose `criteria` is the canonical city
list *cannot* return a city outside it. Hallucination becomes impossible by
construction rather than by schema enforcement.

It cannot write the Hebrew narration, so call 2 stays on Claude. That split —
System One for closed decisions, a generative model only where open language
is unavoidable — is the architecture this was built toward.

### 2. Replace the in-memory snapshot with Postgres

**Why there is data before anyone uploads anything.** `data/snapshot.json` is
built from the CSV by `npm run build:snapshot` and **committed**, then
imported by `src/lib/snapshot.ts` at module load. A cold start therefore has
505 analysable deals immediately, with no I/O and no upload.

That is a deliberate departure from the obvious design, where the admin
upload is the gate that fills an empty database. Without a database, making
upload the gate would mean the public URL is dead after every cold start
until someone logs in and uploads again — a bad property for a link someone
else is going to open. So the upload is a *replacement* path rather than the
only path: it runs the identical pipeline, produces the full issue log, and
swaps the active dataset on that instance. The admin header always states
which source is live, *"קובץ מקובע במאגר הקוד"* or *"הועלה בזמן ריצה"*.

With Postgres the distinction disappears: the upload writes, everything
reads, and the seed is just the first write.


`data/snapshot.json` is committed and imported, so a cold start always has
good data with no I/O. At 530 rows this is honest engineering rather than a
shortcut; somewhere around 10⁵ rows it stops being true.

The cost today is real and the admin page says so: **an upload lives only on
the instance that received it.** It does not survive a cold start and does
not reach other instances. The admin downloads the rebuilt snapshot and
commits it to make it permanent. That is the ugly part of this build and it
is deliberate — the brief explicitly lists database infrastructure among the
things not to spend the time on.

`src/lib/snapshot.ts` is the only file that would change.

### 3. Then

Neighbourhood-level analysis once `n` supports it; `מרכז` vs `מרכז העיר`
resolved by a product decision rather than a guess; multi-turn follow-ups;
streaming the narration.

---

## Running it

```bash
npm install
cp .env.example .env.local     # optional: works fully without a key
npm run dev
```

With no `ANTHROPIC_API_KEY` the app runs entirely on the deterministic path —
which is the fastest way to see the fallback behaviour.

```bash
npm test              # 252 unit tests
npm run test:e2e      # 39 end-to-end
npm run typecheck
npm run profile           # regenerate docs/CSV_PROFILE.md
npm run build:snapshot    # rebuild data/snapshot.json from the CSV
npm run hash-password -- "pw"   # for ADMIN_PASSWORD_HASH
```

### Deploying

```bash
npx vercel login
npx vercel link
npx vercel env add AUTH_SECRET production        # openssl rand -base64 32
npx vercel env add ADMIN_EMAIL production
npx vercel env add ADMIN_PASSWORD_HASH production   # npm run hash-password
npx vercel env add USER_EMAIL production
npx vercel env add USER_PASSWORD_HASH production
npx vercel env add ANTHROPIC_API_KEY production     # optional
npx vercel --prod
```

`vercel.json` pins the function to `fra1`, the closest region to Israel.
`ANTHROPIC_API_KEY` is optional even in production — without it the
deployment serves the deterministic path, which is a legitimate way to
demonstrate the fallback.

### Admin

Two accounts seeded from env vars; `/admin` is guarded by `proxy.ts`
(Next 16's renamed middleware) **and** re-checked in the page and the route
handler, because Next's own docs say proxy is an optimistic check and not an
authorization boundary.

---

## Layout

```
src/lib/normalize/   one pure function per data defect
src/lib/ingest/      dedupe policy, issue log, AI canonicalization
src/lib/analysis/    the six operations — all arithmetic lives here
src/lib/llm/         tools, router, narrator, fallback router, Jev seam
src/lib/ask.ts       the whole request path in one function
data/snapshot.json   committed build artifact
docs/                DATA_QUALITY · CSV_PROFILE · AI_LOG · ARCHITECTURE
```

---

## What I cut, and why

**Postgres and Jev** — per the decisions above, both documented as next steps
with the seam already in place.

**Neighbourhood time series.** The data supports city-level trends; at
neighbourhood level most periods have one or two deals. Building it would
have meant shipping a chart that looks authoritative and is not.

**Merging `מרכז` with `מרכז העיר`.** Probably the same place in most cities.
"Probably" is not a merge rule, and merging would quietly move medians.

**Multi-turn conversation, streaming, maps, real user accounts.** Each is a
day of work that would not have improved the answer to any question in the
brief.

**The honest one:** this build spent more time on data quality and on failure
paths than a demo strictly needs, because those are the two places where a
real Madlan feature would be judged and a demo would not.

---

Development log, including four real AI mistakes and how they were caught:
[`docs/AI_LOG.md`](docs/AI_LOG.md).
