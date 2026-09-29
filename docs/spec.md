# Madlan AI Real Estate Analyst — Claude Code Implementation Spec

## 1. Purpose

Build and deploy a polished Hebrew/RTL web product based on the residential property-deal CSV supplied with this challenge.

The product should feel like an **AI Real Estate Analyst**, not like a generic chatbot over a CSV.

A user should be able to ask natural-language questions in Hebrew about the supplied transaction data. The LLM should understand the user's analytical intent and help turn it into a structured query/analysis, while deterministic application code remains responsible for retrieving, filtering, calculating, validating, and presenting factual data.

The final result must be publicly deployed at a URL.

This is a Senior Full Stack take-home. Optimize for product judgment, clear architecture, correctness, grounding, excellent UX, meaningful LLM usage, robustness, and a realistic design for approximately 10,000 requests/day.

Do not overbuild. The challenge explicitly expects about 5 focused hours of work.

---

## 2. Non-negotiable challenge constraints

The supplied brief requires:

1. Live and public — a URL that can be opened, not localhost or a video.
2. Hebrew and RTL.
3. The LLM must do real work; it cannot merely summarize a static result.
4. Assume approximately 10,000 requests/day on the developer's budget and design accordingly.
5. The system must not state things unsupported by the supplied data.
6. The product must survive the model being slow, wrong, or unavailable.
7. Development must use AI assistance, with a short work log including at least one case where AI produced a bad answer and the developer caught it.

Prefer one polished product over many incomplete features.

---

## 3. Product concept

Working name:

**Madlan AI Real Estate Analyst**

Core experience:

> "Ask questions about the real-estate transaction data and get an analytical answer in the most useful visual format."

The system should dynamically choose an appropriate response presentation.

Examples:

### Trend question

User:
> איך השתנה המחיר למטר ברמת גן?

Response:
- line chart showing the metric over time
- short Hebrew explanation
- methodology/evidence section

### Comparison question

User:
> תשווה בין רמת גן לגבעתיים

Response:
- comparison metrics
- bar chart where appropriate
- concise explanation

### Comparable-deals question

User:
> מצא לי עסקאות דומות לדירה של 4 חדרים, 100 מ״ר, ברמת גן ב-3.9 מיליון

Response:
- summary of the requested property
- list/cards of comparable transactions
- price-per-sqm comparison
- explanation of why those transactions were selected

### Simple factual question

User:
> כמה עסקאות של 4 חדרים יש ברמת גן?

Response:
- prominent metric
- concise explanation
- evidence/methodology

### Anomaly question

User:
> מצא עסקאות חריגות

Response:
- ranked/listed anomalies
- explanation of the comparison population and metric
- never claim that an anomaly means the source data is wrong

---

## 4. Core product principle: LLM is not the source of truth

Use this division:

### LLM responsibilities
- understand natural-language Hebrew
- identify user intent
- extract parameters
- choose an analytical operation/tool
- choose an appropriate presentation type
- formulate a concise natural-language explanation from verified results

### Backend responsibilities
- data normalization
- filtering
- aggregation
- statistics
- comparable-property selection
- anomaly calculations
- date handling
- numerical calculations
- validation
- evidence/provenance

### Frontend responsibilities
- render structured results
- render charts/cards/tables
- clearly communicate methodology and limitations
- remain useful when the LLM is unavailable

Never ask the LLM to calculate important numerical values from raw transaction data.

---

## 5. Response types

Implement a small explicit set of structured response types:

```text
text
statistics
timeSeries
comparison
dealList
propertyComparison
```

The exact implementation is up to Claude Code, but the frontend must render structured data rather than arbitrary LLM-generated HTML.

### timeSeries

Use for:
- price per sqm over time
- number of transactions over time
- other ordered temporal metrics supported by the data

Render:
- polished line chart
- title
- metric/unit
- date/period axis
- short insight

### comparison

Use for:
- city vs city
- neighborhood vs neighborhood
- property characteristic comparisons

Render:
- metrics and/or bar chart
- concise explanation

### dealList

Use for:
- comparable transactions
- filtered transactions
- interesting transactions

Render:
- transaction cards or compact table
- relevant fields only

### propertyComparison

Use when the user provides two explicit properties/deals or asks to compare two scenarios.

Render:
- side-by-side comparison
- price
- area
- rooms
- price/sqm
- date/location where available

### statistics

Use for:
- counts
- median
- average
- min/max
- percentiles when useful

Render:
- prominent metric cards
- supporting details

---

## 6. UX

The UI should be a polished Hebrew RTL application.

Suggested layout:

### Header
- product name
- short description

### Main area
Large natural-language input:

> שאלו שאלה על עסקאות הנדל״ן...

Include clickable example prompts:
- "איך השתנה המחיר למ״ר ברמת גן?"
- "השווה בין רמת גן לגבעתיים"
- "מצא עסקאות דומות לדירת 4 חדרים, 100 מ״ר ברמת גן"
- "כמה עסקאות של 4 חדרים יש בחיפה?"
- "מצא עסקאות חריגות"

### Answer area
The answer should be visually rich and contextual:
- chart where appropriate
- cards/table where appropriate
- concise natural-language explanation
- evidence/methodology section

### Evidence section

Every analytical answer should make grounding visible.

Show something like:

> מבוסס על 24 עסקאות
> טווח תאריכים: ינואר 2024 – יוני 2026
> סינון: רמת גן, 4 חדרים, 85–115 מ״ר

Do not display methodology claims unless they are actually true for the query.

If there is insufficient data:

> אין מספיק עסקאות דומות במאגר כדי להציג השוואה אמינה.

Do not fabricate an answer.

---

## 7. Data handling and quality

The CSV is intentionally real-world shaped and not clean. The implementation MUST include a deterministic normalization layer.

Known issues to inspect and handle include:
- inconsistent boolean representations such as yes/no, TRUE/FALSE, 1/0 and Hebrew values
- inconsistent room-count representations such as numeric strings and strings containing "חדרים"
- inconsistent date representations
- inconsistent location aliases
- missing values
- suspicious/invalid numeric values such as zero or implausible prices
- duplicate deal IDs with potentially different rows/data

Do not silently pretend the data is perfectly clean.

### Required approach

Create a deterministic normalization/validation pipeline that:
- normalizes column types
- normalizes boolean values
- normalizes room-count representation
- normalizes dates
- normalizes known location aliases
- identifies missing/invalid numeric values
- preserves raw source values where useful for traceability
- identifies duplicate IDs
- documents assumptions

Do NOT automatically merge duplicate deal IDs merely because their IDs match if underlying records conflict. Decide and document how such records are handled.

The normalized dataset is the source for application queries.

---

## 8. Grounding and unsupported claims

Distinguish between:
1. facts directly supported by the dataset
2. calculations derived from the dataset
3. interpretation/explanation

Prefer:

> "בעסקאות שנמצאו במאגר, החציון היה..."

rather than:

> "מחיר השוק ברמת גן הוא..."

Do not claim:
- current market price unless supported by the data's dates
- future price movements
- causation
- property quality beyond available fields
- neighborhood characteristics not present in the dataset
- investment advice

If the dataset does not contain the information needed to answer a question, explicitly say so.

---

## 9. Comparable transactions

For a request such as:

> "מצא לי עסקאות דומות לדירה..."

Use deterministic application logic.

Potential similarity dimensions:
- city
- neighborhood when available
- property type
- room count
- area
- date recency
- floor
- relevant available features

Use a transparent scoring/ranking algorithm.

Do not let the LLM decide which records are "similar" without deterministic support.

Keep the algorithm simple enough to explain in an interview.

The result should include enough information for the user to understand why a transaction was selected.

---

## 10. Time-series analysis

For:

> "איך השתנה המחיר למ״ר ברמת גן?"

The backend should:
1. identify the requested location
2. identify the requested metric
3. select an appropriate date granularity
4. filter valid records
5. calculate the metric deterministically
6. return all required points at the chosen granularity
7. return transaction count/sample size for each period where useful

Prefer median price/sqm for noisy real-estate data when appropriate, and explain the chosen metric.

The frontend should render a line chart.

Do not invent missing periods. If there are no transactions in a period, either omit it or represent it explicitly as unavailable, depending on the chosen UX.

---

## 11. Anomaly analysis

If implementing anomaly detection, define it mathematically and document it.

For example:
- compare a transaction against a relevant peer population
- calculate a robust metric such as median and deviation/percentile
- flag transactions that meet a deterministic threshold

The UI must say what "חריגה" means.

Never imply:

> "This transaction is wrong."

Instead:

> "This transaction is statistically unusual compared with the selected comparison group."

---

## 12. LLM architecture

Prefer a tool/function-calling architecture.

Conceptually:

```text
User Hebrew question
        |
        v
      LLM
        |
        | structured intent/tool call
        v
  Backend analysis tools
        |
        v
Verified structured result
        |
        v
      LLM
        |
        | concise explanation / presentation metadata
        v
     Frontend
```

Possible tools:

```text
search_transactions
get_statistics
get_time_series
compare_locations
find_comparable_deals
find_anomalies
```

Tool schemas should be strict.

Do not give the model unrestricted SQL access unless there is a compelling reason.

Validate tool arguments server-side.

---

## 13. Structured output

Use structured output/schema validation.

The LLM should return something conceptually like:

```json
{
  "intent": "time_series",
  "parameters": {
    "location": "רמת גן",
    "metric": "price_per_sqm"
  }
}
```

The backend then executes the operation.

After calculation, the final result can look like:

```json
{
  "type": "timeSeries",
  "title": "...",
  "data": [...],
  "summary": "...",
  "evidence": {
    "transactionCount": 24,
    "filters": [...]
  }
}
```

Do not allow the model to invent numeric `data`.

---

## 14. Failure handling

The system must remain useful when the LLM:
- times out
- returns invalid structured output
- produces an unsupported intent
- returns malformed arguments
- is temporarily unavailable

Implement:
- request timeout
- schema validation
- retry only when appropriate
- clear fallback error
- deterministic/basic query path where feasible

The UI should never show an unverified LLM answer as factual.

If the model is unavailable, show a useful message and, if practical, offer predefined/example queries or a basic filter/search mode.

---

## 15. Performance and 10,000 requests/day

Do not send the entire CSV to the LLM.

Recommended approach:
- load/normalize the CSV once during build/deployment/startup
- keep prompts small
- send only the user's intent and relevant structured results to the model
- cache repeated analytical queries
- precompute common aggregates where useful
- impose maximum result sizes
- impose LLM timeout and token limits

Document:
- approximate LLM calls per request
- expected token usage
- cache strategy
- local computation
- rough cost assumptions

At 10x traffic, explain what you would change.

---

## 16. Security

- LLM API keys remain server-side.
- Validate all user inputs.
- Do not execute arbitrary SQL/code generated by the model.
- Do not expose system prompts or secrets.
- Keep tool schemas constrained.

---

## 17. Suggested technical direction

Use a pragmatic modern stack. Exact choices are up to Claude Code.

Preferred:
- React / Next.js or equivalent
- TypeScript
- lightweight API/server layer
- in-memory or embedded normalized dataset if sufficient
- chart library
- LLM provider supporting structured output/tool calling

Avoid infrastructure that is unnecessary for the take-home.

---

## 18. Visual quality

This is a product demo.

Requirements:
- proper RTL
- responsive desktop/mobile layout
- clean typography
- clear hierarchy
- loading states
- empty states
- error states
- chart tooltips
- no raw JSON visible to normal users
- no generic wall of AI text
- concise answers
- visually distinct evidence/methodology section

The product should feel like a small, polished Madlan feature.

---

## 19. Demo scenarios

Optimize around these flows.

### Demo 1 — Time series

Question:

> איך השתנה המחיר למ״ר ברמת גן?

Expected:
- line chart
- metric
- transaction count
- concise insight
- evidence

### Demo 2 — Comparison

Question:

> תשווה בין רמת גן לגבעתיים

Expected:
- comparison metrics
- chart
- explanation
- evidence

### Demo 3 — Comparable properties

Question:

> מצא לי עסקאות דומות לדירת 4 חדרים, 100 מ״ר ברמת גן

Expected:
- comparable transaction cards/table
- similarity explanation
- price/sqm comparison

### Demo 4 — Unsupported question

Ask for information absent from the CSV.

Expected:
- explicit limitation
- no hallucination
- optionally suggest what the dataset can answer instead

### Demo 5 — Simple factual query

Question:

> כמה עסקאות של 4 חדרים יש ברמת גן?

Expected:
- large metric
- concise explanation
- evidence

---

## 20. AI development log

Create a short markdown file documenting AI-assisted development.

Include:
- AI tools used
- tasks they helped with
- important decisions made by the developer
- at least one real incorrect AI suggestion/output
- how it was detected
- how it was corrected
- important assumptions

Do not fabricate an AI failure. During development, deliberately review AI-generated work and record a real example.

---

## 21. Interview readiness

The implementation should make these questions easy to answer.

### Architecture
- What does the LLM receive?
- What does the backend compute?
- Why is that boundary where it is?
- Why not send the CSV to the LLM?

### Grounding
- How do you prevent hallucinations?
- How does the user know what data supports the answer?
- What happens when there is insufficient data?

### Cost
- How many LLM calls happen per request?
- What is cached?
- What happens at 10x traffic?

### Reliability
- What happens when the model is slow?
- What happens when structured output is invalid?
- What happens when the LLM is unavailable?

### Data quality
- What did you find wrong with the CSV?
- How did you normalize it?
- How did you handle duplicate IDs?
- What assumptions did you make?

### Product
- Why did you choose this product?
- Why are some answers charts and others cards/text?
- What would you build next if this became a Madlan feature?

### Senior engineering
- Which decisions are deliberately simple because of the 5-hour constraint?
- What would you replace first at production scale?
- What would you monitor?

---

## 22. Scope control

Prioritize:

1. Correct data normalization
2. One excellent end-to-end LLM flow
3. 3–5 structured response types
4. Strong Hebrew/RTL UX
5. Grounding/evidence
6. Failure handling
7. Deployment
8. Cost/cache considerations
9. Additional polish

Do NOT spend most of the time on:
- authentication
- complex database infrastructure
- user accounts
- sophisticated maps
- elaborate animations
- mobile-native applications
- large-scale distributed architecture

The goal is to demonstrate judgment, not infrastructure volume.

---

## 23. Definition of done

- [ ] Public URL works
- [ ] Hebrew/RTL is polished
- [ ] CSV is normalized deterministically
- [ ] Data-quality issues are documented
- [ ] Natural-language Hebrew query works
- [ ] LLM performs real intent extraction/tool selection
- [ ] Backend performs deterministic analysis
- [ ] At least one time-series chart works
- [ ] At least one comparison visualization works
- [ ] Comparable transactions work
- [ ] Evidence is visible
- [ ] Unsupported questions do not hallucinate
- [ ] LLM failure/timeout is handled
- [ ] API secrets are server-side
- [ ] Basic caching/cost strategy exists
- [ ] Product works at reasonable demo latency
- [ ] AI development log exists
- [ ] Demo scenarios are tested
- [ ] README explains architecture and tradeoffs

---

## 24. Implementation workflow for Claude Code

Before writing substantial code:

1. Inspect the repository and existing files.
2. Inspect the complete CSV schema and data quality.
3. Decide the architecture and document it.
4. Identify assumptions and unresolved ambiguities.
5. Then implement.

Work in small, testable increments.

After each major component:
- run tests/type checking
- verify the behavior against the actual CSV
- inspect the UI
- do not assume an AI-generated implementation is correct

Keep the implementation simple, explainable, and production-minded.

The final application should feel like a small, polished Madlan feature rather than a hackathon chatbot.
