# Data quality — what is wrong with the CSV, and what this app does about it

Source: `data/madlan_deals_sample.csv` — 530 rows, 19 columns, deals dated
2021-01-05 → 2026-07-26.

Every count below is produced by `npm run profile` (output committed at
[`CSV_PROFILE.md`](./CSV_PROFILE.md)), not by inspection. Re-run it against any
new CSV before trusting the pipeline on that CSV.

The governing rule: **nothing is silently deleted and nothing is silently
merged.** Rows that cannot be analysed are kept, flagged, and excluded from
aggregates with a reason the UI can show.

---

## 1. City names — 29 spellings for 18 cities

| Canonical | Raw spellings found |
|---|---|
| `תל אביב-יפו` | `תל אביב` ×7, `תל אביב-יפו` ×5, `תל אביב יפו` ×4, `Tel Aviv-Yafo` ×4, `ת"א` ×2 |
| `באר שבע` | `באר שבע` ×19, `באר-שבע` ×6, `ב"ש` ×5 |
| `ירושלים` | `ירושלים` ×10, `ירושלים ` ×8, `Jerusalem` ×3 |
| `בית שמש` | `בית שמש` ×21, `בית-שמש` ×7 |
| `מודיעין-מכבים-רעות` | `מודיעין` ×13, `מודיעין מכבים רעות` ×12, `מודיעין-מכבים-רעות` ×11 |

Thirteen further cities appear under a single spelling each; the table lists
them too, so the canonical set is explicit and closed.

**Decision:** a committed alias table maps every raw spelling to one canonical
Hebrew name. Two Latin-script spellings (`Tel Aviv-Yafo`, `Jerusalem`) map to
their Hebrew canonical form, because the product is Hebrew-first and a user
asking about תל אביב must see those 4 deals.

### Why `מודיעין` and `מודיעין-מכבים-רעות` are merged

This is the one merge that is a judgement call rather than a spelling fix —
they could plausibly be different places. They are not, and the data proves it:
five neighborhoods — `כרמים`, `מוריה`, `בוכמן`, `נופים`, `הפרחים` — appear under
all three spellings. A neighborhood cannot be in two cities, so the three
spellings are one municipality (the real one is Modi'in-Maccabim-Re'ut).

## 2. Leading and trailing whitespace

Values that differ *only* by surrounding whitespace:

| Column | Collisions |
|---|---|
| `neighborhood` | 65 — `"מרכז "` vs `"מרכז"`, `"בבלי "` vs `"בבלי"`, … |
| `street` | 8 — `"  מבצע קדש "` vs `"מבצע קדש"` |
| `property_type` | 4 — `"דירה  "`, `"  דירה "` vs `"דירה"` |
| `condition` | 4 — `"  שמור "` vs `"שמור"` |
| `city` | 1 — `"ירושלים "` vs `"ירושלים"` |

**Decision:** trim, then collapse internal whitespace runs to a single space.
Applied before every other rule, including alias lookup.

## 3. Booleans in eight different representations

All four flag columns mix `כן` / `לא` / `yes` / `no` / `TRUE` / `FALSE` / `1` / `0`.

| Column | Distinct forms | Missing |
|---|---|---|
| `has_elevator` | 8 | 0 |
| `has_parking` | 8 | 20 |
| `has_balcony` | 8 | 0 |
| `has_safe_room` | 8 | 0 |

**Decision:** tri-state `true` / `false` / `null`. Missing is *not* `false` —
"we don't know whether this flat has parking" and "this flat has no parking"
are different facts, and conflating them would corrupt any filtered count.

## 4. Room counts as free text

19 distinct representations for 10 actual values: `4` ×101 alongside
`4 חדרים` ×6, `3.5` ×79 alongside `3.5 חדרים` ×2, and so on.

**Decision:** strip the `חדרים` suffix, parse to a number. Range 1–6 in
half-steps. No value failed to parse.

## 5. Four date formats, one of them without a day

| Format | Count | Example |
|---|---|---|
| `yyyy-mm-dd` | 373 | `2025-09-07` |
| `dd/mm/yyyy` | 76 | `15/06/2025` |
| `dd.mm.yyyy` | 55 | `17.07.2026` |
| **`Mon yyyy`** | **26** | `Aug 2025` — **no day at all** |

`dd/mm` vs `mm/dd` is genuinely ambiguous in isolation. It resolves to
day-first: across both the slash and dot formats the first component reaches 28 while
the second never exceeds 12, which is only consistent with day-first.

**Decision:** all four parse. Day-less dates become the first of their month
and carry `datePrecision: "month"`. They are included in monthly aggregates
(where the day is irrelevant) and excluded from anything day-level. Inventing
a day and hiding the fact would be the easy wrong answer.

## 6. Prices: separators, a currency sign, a zero, and one impossibility

| Problem | Count | Detail |
|---|---|---|
| Thousands separators | 56 | `"4,331,000"` — parses to `NaN` unguarded |
| **`₪` inside the field** | **12** | `"₪12,144,000"` — see below |
| Zero `price_nis` | 1 | `D100251` |
| Zero `price_per_sqm` | 2 | |
| Empty `price_per_sqm` | 10 | |
| Empty `size_sqm` | 10 | |
| Implausible price | 1 | `D100317` — ₪18,000 for a 132 m² flat in רחובות, stated `price_per_sqm` of `0` |

**No price is actually missing.** That is worth stating plainly, because the
first version of the profiler reported twelve as empty. They are not empty —
they carry a shekel sign, and a parser that strips only commas returns `null`
for them. Stripping `₪` as well recovers all twelve exactly, which is better
than reconstructing them from `size × price_per_sqm`: the real figure beats a
derived one. It also surfaced a 28th `price_per_sqm` conflict (§7) that was
invisible while the price itself could not be read.

**Decisions:** strip separators, whitespace and `₪` before parsing, and log
the currency strip so it is visible in the admin log rather than silently
absorbed. Quarantine the zero and the implausible row — `D100317` is not a
real ₪18,000 sale, but this app has no authority to say what the real number
was, so it is excluded from statistics and kept in the record.

Price range after cleaning: ₪492,000 – ₪44,000,000.

## 7. `price_per_sqm` contradicts `price_nis / size_sqm` — 27 rows

**28 of the 518 rows** that have all three fields disagree by more than 2%.
The disagreement is large: ratios run from **0.72× to 1.27×**. Examples:

| Deal | `price_nis` | `size_sqm` | stated `price_per_sqm` | computed | ratio |
|---|---|---|---|---|---|
| `D100178` | 3,586,000 | 65 | 68,592 | 55,169 | 1.24× |
| `D100328` | 13,549,000 | 246 | 40,950 | 55,077 | 0.74× |
| `D100444` | 5,406,000 | 120 | 35,385 | 45,050 | 0.79× |
| `D100417` | ₪1,884,000 | 109 | 19,528 | 17,284 | 1.13× |

**Decision:** `price_nis` and `size_sqm` are the primary observations;
`price_per_sqm` is derived from them and should be redundant. Where they
disagree, **recompute** — the analytic field is always `price_nis / size_sqm`.
The stated value is preserved as `pricePerSqmRaw` and every conflict is logged.
`D100417` is in that table deliberately: it is the row that only became
visible once the `₪` sign was handled (§6), and it is a reminder that defects
hide behind each other.

A 28-row silent discrepancy in the headline metric is exactly the sort of thing
that makes a median wrong by a few percent with no visible symptom.

## 8. Duplicate deal IDs — 10 ids, and they are not all the same kind

`deal_id` is not unique: 520 distinct ids across 530 rows.

**Six are byte-identical** — `D100311`, `D100025`, `D100196`, `D100099`,
`D100416`, `D100215`. Same row twice. Safe to collapse.

**Four genuinely conflict**, and all four conflict the same way — a different
price reported by a different source:

| Deal | `price_nis` | `source` |
|---|---|---|
| `D100017` | 1,919,000 vs 1,851,548 | רשות המסים vs מתווך |
| `D100124` | 5,429,440 vs 5,727,000 | מתווך vs רשות המסים |
| `D100032` | 5,141,000 vs 5,343,137 | בעל נכס vs מתווך |
| `D100303` | 6,064,000 vs 6,195,332 | בעל נכס vs מתווך |

That is a recognisable real-world pattern: the same transaction reported once
by the tax authority and once by an agent or owner, with the informal figure
differing by 2–4%.

**Decision:** collapse the six identical pairs. **Do not merge the four
conflicting ones** — the spec forbids it, and there is no defensible rule for
picking a winner. Preferring `רשות המסים` as the authoritative source is
tempting and is probably right, but it is an assumption this app has no
grounds to make silently. Both rows are kept, tagged with a shared
`conflictGroup`, and **excluded from aggregates by default** so a single
transaction cannot be double-counted in a median. The admin log lists them and
the evidence panel says when a query excluded one.

## 9. Missing values

| Column | Missing | Consequence |
|---|---|---|
| `year_built` | 35 | no age filter on those rows |
| `floor` | 24 | `0` is a real value (קומת קרקע), not a gap |
| `has_parking` | 20 | tri-state, see §3 |
| `condition` | 16 | |
| `neighborhood` | 11 | city-level analysis only |
| `size_sqm` | 10 | no price-per-m² |
| `price_per_sqm` | 10 | recomputed from price ÷ size |

**Decision:** `null`, never a zero or an empty string standing in for one.
Every analysis tool reports how many rows it dropped and why, and that count
reaches the evidence panel.

## 10. `neighborhood` is not unique across cities

29 neighborhood names appear under more than one city. Most are genuinely
generic: `מרכז` exists in nine different cities, `מרכז העיר` in seven.

**Decision:** the key is the pair `(city, neighborhood)`, never the
neighborhood alone.

**`מרכז` and `מרכז העיר` are kept distinct.** They are probably the same place
in most of those cities, but "probably" is not a merge rule, and merging them
would quietly change medians. Logged as an open question rather than guessed.

---

## Net effect

| | Rows |
|---|---|
| Raw CSV | 530 |
| − identical duplicates collapsed | −6 |
| − conflicting duplicate rows held out of aggregates | −8 (4 pairs) |
| − quarantined for unusable price or size | −12 |
| **Analysable** | **504** |

The pipeline computes these figures; they are not hardcoded, and the UI shows
the real number for every query.

## Assumptions worth challenging

1. `dd/mm/yyyy` over `mm/dd/yyyy` — argued from days >12 in §5, but a
   US-formatted export would break it.
2. `price_nis / size_sqm` beats the stated `price_per_sqm` (§7).
3. `מודיעין` and `מודיעין-מכבים-רעות` are one city (§1) — argued from shared
   neighborhoods.
4. Conflicting duplicates are excluded rather than resolved in favour of
   `רשות המסים` (§8). A product owner could reasonably overrule this.
5. `מרכז` ≠ `מרכז העיר` (§10).
