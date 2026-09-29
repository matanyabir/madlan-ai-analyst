/**
 * Profiles the raw CSV and prints everything wrong with it.
 *
 * This script is deliberately standalone and dependency-light: it reads the
 * CSV with no normalization at all, so its output is the evidence behind every
 * decision in docs/DATA_QUALITY.md. Re-run it against a new CSV before
 * trusting the pipeline on that CSV.
 *
 *   npm run profile
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Papa from "papaparse";

const CSV_PATH = resolve(process.argv[2] ?? "data/madlan_deals_sample.csv");

type Row = Record<string, string>;

const parsed = Papa.parse<Row>(readFileSync(CSV_PATH, "utf8").replace(/^﻿/, ""), {
  header: true,
  skipEmptyLines: true,
});
const rows = parsed.data;

/** Parses a raw numeric cell the way a naive reader would: strip commas, coerce. */
function num(raw: string | undefined): number | null {
  const cleaned = (raw ?? "").trim().replace(/,/g, "");
  if (cleaned === "") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function counter(values: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const v of values) m.set(v, (m.get(v) ?? 0) + 1);
  return new Map([...m].sort((a, b) => b[1] - a[1]));
}

const out: string[] = [];
const say = (s = "") => out.push(s);

say(`# CSV profile — ${CSV_PATH.split("/").pop()}`);
say();
say(`Rows: **${rows.length}**  ·  Columns: **${Object.keys(rows[0] ?? {}).length}**`);
if (parsed.errors.length) say(`Parse errors: ${parsed.errors.length}`);
say();

// ---------------------------------------------------------------- per column
say("## Per-column distribution");
say();
for (const col of Object.keys(rows[0] ?? {})) {
  const values = rows.map((r) => r[col] ?? "");
  const counts = counter(values);
  const empty = values.filter((v) => v.trim() === "").length;
  say(`### \`${col}\` — ${counts.size} distinct, ${empty} empty`);
  say();
  const shown = [...counts].slice(0, counts.size <= 32 ? counts.size : 12);
  for (const [v, c] of shown) say(`- \`${JSON.stringify(v)}\` ×${c}`);
  if (counts.size > 32) say(`- …and ${counts.size - 12} more`);
  say();
}

// ------------------------------------------------------------- whitespace
say("## Values that differ only by surrounding whitespace");
say();
for (const col of Object.keys(rows[0] ?? {})) {
  const byTrimmed = new Map<string, Set<string>>();
  for (const r of rows) {
    const raw = r[col] ?? "";
    const key = raw.trim().replace(/\s+/g, " ");
    if (!byTrimmed.has(key)) byTrimmed.set(key, new Set());
    byTrimmed.get(key)!.add(raw);
  }
  const collisions = [...byTrimmed].filter(([, set]) => set.size > 1);
  if (collisions.length) {
    say(`- \`${col}\`: **${collisions.length}** collisions, e.g. ${collisions
      .slice(0, 3)
      .map(([k, s]) => `${[...s].map((x) => JSON.stringify(x)).join(" / ")} → \`${k}\``)
      .join("; ")}`);
  }
}
say();

// --------------------------------------------------------------- duplicates
say("## Duplicate `deal_id`");
say();
const byId = new Map<string, Row[]>();
for (const r of rows) {
  const id = r.deal_id ?? "";
  if (!byId.has(id)) byId.set(id, []);
  byId.get(id)!.push(r);
}
const dupes = [...byId].filter(([, rs]) => rs.length > 1);
let identical = 0;
let conflicting = 0;
say(`${dupes.length} ids appear more than once.`);
say();
for (const [id, rs] of dupes) {
  const [a, b] = rs;
  const diffs = Object.keys(a).filter((k) => a[k] !== b[k]);
  if (diffs.length === 0) {
    identical++;
    say(`- \`${id}\` — byte-identical`);
  } else {
    conflicting++;
    say(
      `- \`${id}\` — **conflicts** on ${diffs
        .map((k) => `\`${k}\` (${JSON.stringify(a[k])} vs ${JSON.stringify(b[k])})`)
        .join(", ")}`,
    );
  }
}
say();
say(`**${identical} identical · ${conflicting} conflicting.**`);
say();

// -------------------------------------------------------------- date shapes
say("## `deal_date` formats");
say();
const datePatterns: [string, RegExp][] = [
  ["ISO yyyy-mm-dd", /^\d{4}-\d{2}-\d{2}$/],
  ["dd/mm/yyyy", /^\d{1,2}\/\d{1,2}\/\d{4}$/],
  ["dd.mm.yyyy", /^\d{1,2}\.\d{1,2}\.\d{4}$/],
  ["Mon yyyy (no day)", /^[A-Za-z]{3,}\s+\d{4}$/],
];
const dateShapes = new Map<string, string[]>();
for (const r of rows) {
  const d = (r.deal_date ?? "").trim();
  const hit = datePatterns.find(([, re]) => re.test(d))?.[0] ?? "UNRECOGNISED";
  if (!dateShapes.has(hit)) dateShapes.set(hit, []);
  dateShapes.get(hit)!.push(d);
}
for (const [shape, ds] of dateShapes) {
  say(`- **${shape}** ×${ds.length} — e.g. ${ds.slice(0, 4).map((d) => `\`${d}\``).join(", ")}`);
}
say();

// ------------------------------------------------------------ numeric sanity
say("## Numeric sanity");
say();
const noPrice = rows.filter((r) => num(r.price_nis) === null);
const zeroPrice = rows.filter((r) => num(r.price_nis) === 0);
const commaPrice = rows.filter((r) => (r.price_nis ?? "").includes(","));
say(`- \`price_nis\` empty: **${noPrice.length}** (${noPrice.map((r) => r.deal_id).join(", ")})`);
say(`- \`price_nis\` zero: **${zeroPrice.length}** (${zeroPrice.map((r) => r.deal_id).join(", ")})`);
say(`- \`price_nis\` with thousands separators: **${commaPrice.length}**`);

const recoverable = noPrice.filter((r) => num(r.size_sqm) && num(r.price_per_sqm));
say(
  `- …of the empty prices, **${recoverable.length}** are recoverable as \`size_sqm × price_per_sqm\`, ` +
    `**${noPrice.length - recoverable.length}** are not`,
);

const zeroPps = rows.filter((r) => num(r.price_per_sqm) === 0);
const noPps = rows.filter((r) => num(r.price_per_sqm) === null);
say(`- \`price_per_sqm\` zero: **${zeroPps.length}**, empty: **${noPps.length}**`);

// stated price_per_sqm vs price / size
const DEVIATION_THRESHOLD = 0.02;
const comparable = rows.filter(
  (r) => num(r.price_nis) && num(r.size_sqm) && num(r.price_per_sqm),
);
const conflicts = comparable
  .map((r) => {
    const calc = num(r.price_nis)! / num(r.size_sqm)!;
    return { id: r.deal_id, stated: num(r.price_per_sqm)!, calc, ratio: num(r.price_per_sqm)! / calc };
  })
  .filter((c) => Math.abs(c.ratio - 1) > DEVIATION_THRESHOLD);
say(
  `- \`price_per_sqm\` disagrees with \`price_nis / size_sqm\` by >${DEVIATION_THRESHOLD * 100}%: ` +
    `**${conflicts.length} of ${comparable.length}** ` +
    `(ratio ${Math.min(...conflicts.map((c) => c.ratio)).toFixed(2)}× – ` +
    `${Math.max(...conflicts.map((c) => c.ratio)).toFixed(2)}×)`,
);

for (const col of ["size_sqm", "floor", "total_floors", "year_built"]) {
  const vals = rows.map((r) => num(r[col])).filter((v): v is number => v !== null);
  say(`- \`${col}\`: ${vals.length} parseable, min ${Math.min(...vals)}, max ${Math.max(...vals)}`);
}
const badFloor = rows.filter((r) => {
  const f = num(r.floor);
  const t = num(r.total_floors);
  return f !== null && t !== null && f > t;
});
say(`- \`floor > total_floors\`: **${badFloor.length}**`);

const prices = rows.map((r) => num(r.price_nis)).filter((v): v is number => v !== null && v > 0).sort((a, b) => a - b);
say(`- price range: ₪${prices[0].toLocaleString()} – ₪${prices.at(-1)!.toLocaleString()}`);
say(`  - cheapest five: ${prices.slice(0, 5).map((p) => `₪${p.toLocaleString()}`).join(", ")}`);
say();

// --------------------------------------------------- neighbourhood ambiguity
say("## `neighborhood` is not unique across cities");
say();
const hoodToCities = new Map<string, Set<string>>();
for (const r of rows) {
  const hood = (r.neighborhood ?? "").trim();
  if (!hood) continue;
  if (!hoodToCities.has(hood)) hoodToCities.set(hood, new Set());
  hoodToCities.get(hood)!.add((r.city ?? "").trim());
}
const shared = [...hoodToCities]
  .filter(([, cities]) => cities.size > 1)
  .sort((a, b) => b[1].size - a[1].size);
say(`${shared.length} neighborhood names appear under more than one \`city\` spelling.`);
say();
for (const [hood, cities] of shared.slice(0, 12)) {
  say(`- \`${hood}\` → ${[...cities].map((c) => `\`${c}\``).join(", ")}`);
}
say();
say(
  "Some of those are genuinely generic (`מרכז` really does exist in nine different cities). " +
    "Others are the same city spelled differently, and the shared neighborhood is the evidence: " +
    "`כרמים`, `מוריה`, `בוכמן`, `נופים` and `הפרחים` all appear under both `מודיעין` and " +
    "`מודיעין-מכבים-רעות`, which is why the alias table merges them.",
);
say();

console.log(out.join("\n"));
