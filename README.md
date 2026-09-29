# אנליסט הנדל״ן — Madlan AI Real Estate Analyst

Ask questions in Hebrew about 530 real Israeli property transactions. The
model understands the question and writes the explanation; **every number is
computed in TypeScript from the data**, and every answer shows what it rests
on.

**Live:** <https://madlan-ai-analyst.vercel.app>
**Stack:** Next.js 16 · TypeScript · Tailwind 4 · Recharts · Claude Haiku 4.5 (configurable)
**Tests:** 269 unit (Vitest) · 48 end-to-end (Playwright)

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

## Cost at 10,000 requests/day — measured, not estimated

Two calls per uncached question on `claude-haiku-4-5` ($1/MTok in, $5/MTok
out, cache reads at $0.10/MTok), averaged over the seven demo questions with
a warm prompt cache:

| | tokens | rate | cost |
|---|---|---|---|
| fresh input | 1,463 | $1.00/M | $0.00146 |
| cached prefix read | 18,613 | $0.10/M | $0.00186 |
| output | 268 | $5.00/M | $0.00134 |
| | | | **$0.0047 / question** |

| response-cache hit rate | LLM calls/day | cost |
|---|---|---|
| 60% (conservative) | 4,000 | **$18.65/day** · ~$560/mo |
| 80% (realistic for demo traffic) | 2,000 | **$9.33/day** · ~$280/mo |

Ingestion is excluded because it is effectively free: uploading the sample
CSV makes **zero** API calls, since all 530 rows resolve deterministically.

### Knowing the cost is not the same as bounding it

`/api/ask` is public — the brief asks for a URL anyone can open — so the table
above describes what the traffic *should* cost, and on its own nothing stops a
loop or a crawler from spending more. Two guards sit in front of it
(`lib/llm/budget.ts`), and they fail differently on purpose:

| Guard | Limit | Over it |
|---|---|---|
| Per-IP token bucket | 12 burst, 20/min | **429**, with `Retry-After` |
| Daily model allowance | 4,000 questions/UTC day | **Not an error** — deterministic router + template narrator |

The second one is the interesting half. Running out of money is
operationally identical to the model being unavailable, and that path already
exists, is already tested, and already tells the user the explanation is
templated. So the ceiling costs nothing to enforce: past it, the site keeps
answering the same questions from the same evidence at ~1ms and $0. The
default of 4,000 is the conservative row above, held as a limit rather than a
projection — about $18.65/day.

`LLM_DAILY_QUESTION_BUDGET=0` is also the kill switch without a redeploy.

**The honest limitation:** this counter is per serverless instance, for the
same reason the response cache is — `globalThis` is not shared across
instances. N instances permit N × the allowance. That makes the bound
approximate rather than exact, which is still categorically different from
absent, and the fix is the same shared-storage step the cache needs. Both
counters are on `/api/health`.

### The thing I got wrong, and what it taught me

An earlier version of this section estimated $9.60/day from a guessed
~2,000-token cached prefix. The first request made with a real API key
reported **37,816**.

The cause is specific to this product: **Hebrew tokenises at roughly two
tokens per character.** The tool definitions are 17,786 characters of mostly
Hebrew — enum values, descriptions — and became 37,816 tokens, not the
~5,500 a character-count estimate suggests. Anyone reasoning about LLM cost
for a Hebrew product from English intuitions will be out by 3–7×.

Dropping the 100-value neighbourhood enum to a plain string cut the prefix
**53%**, from 37,816 to 17,911, for a small and bounded grounding cost: an
invented neighbourhood matches no rows, and the engine already answers "no
matching transactions" rather than inventing any. Cities stay enumerated —
18 values, and it is the filter that actually decides an answer.

### What I would change at 10×

1. **Move routing to Jev** — a closed-set classification at $0.042/MTok in
   with output free. It removes the larger of the two calls.
2. **Redis instead of the in-process LRU.** Each instance currently has its
   own cache, so the real hit rate is divided by the instance count. A shared
   cache is what moves 60% toward 80%, which halves the bill — and the same
   store makes the daily spend ceiling exact instead of per-instance.
3. **Trim the prefix further.** The filter object is repeated across five
   tools. Collapsing the analysis tools into one with an `operation` enum
   would cut the cached prefix by roughly another half.
4. **Semantic cache on the routed tool call**, not the question string.
   "כמה עסקאות ברמת גן" and "מספר העסקאות ברמת גן" route identically and
   currently cost two separate calls.

## Failure handling

### The kill switch

`/admin` has a toggle that turns the model off for that instance at runtime.
It is the operational lever you want when the model misbehaves or burns
budget and you do not want to redeploy to stop it — and it is the fastest way
to show that the fallback is real:

```
AI on    "כמה עולה דירת גן ממוצעת"   4,753 ms   LLM routed, LLM narrated
AI off   same question                   1 ms   regex routed, templated
         both answer ₪5,020,000 over 60 deals
```

Identical number, 4,700× faster, plainer prose. That is the architecture in
one comparison: the model was never computing anything, so removing it
changes the writing and not the answer.

Toggling flushes the response cache, because cached answers carry the prose
that produced them and a `degraded` flag — serving model-written
explanations while the model is off would make the badge lie about the
answer on screen. Like the snapshot, the setting is instance-local and does
not survive a cold start; the panel says so.



| Failure | Behaviour |
|---|---|
| No API key | Deterministic router + template narrator. Everything works. |
| Router times out (6s) | Same, flagged `router_timeout` |
| Router returns invalid arguments | Rejected by Zod, falls to deterministic router |
| Router names a nonexistent tool | Same |
| Narrator fails or truncates | Template narrator, same evidence object |
| Rate limit / 5xx | One retry, then fall back. Schema failures are never retried. |
| Daily budget spent | Deterministic path, flagged `budget_exhausted`. No error. |
| One IP flooding `/api/ask` | 429 with `Retry-After`, before any cost is incurred |
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


All runtime state — the active snapshot and the model kill switch — lives on
`globalThis` rather than in module-level variables, because Next bundles
Server Components and Route Handlers into separate module graphs and a plain
`let` is two variables, not one. That is a real bug this repo shipped and
fixed (`docs/AI_LOG.md` #11).

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
npm test              # 269 unit tests
npm run test:e2e      # 48 end-to-end
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
npx vercel env add LLM_DAILY_QUESTION_BUDGET production   # optional, default 4000
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
