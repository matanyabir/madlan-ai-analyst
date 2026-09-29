/**
 * Builds data/snapshot.json from the source CSV.
 *
 * Runs the same ingestCsv the admin upload endpoint runs, so the committed
 * snapshot and a runtime upload cannot diverge. Deliberately does NOT call
 * the AI canonicalization step: the build must be reproducible offline and
 * must not depend on an API key.
 *
 *   npm run build:snapshot [path/to.csv]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, basename } from "node:path";
import { ingestCsv } from "../src/lib/ingest/pipeline";

const input = resolve(process.argv[2] ?? "data/madlan_deals_sample.csv");
const output = resolve("data/snapshot.json");

async function main() {
const snapshot = await ingestCsv(readFileSync(input, "utf8"), {
  sourceFile: basename(input),
});

writeFileSync(output, JSON.stringify(snapshot));

const c = snapshot.counts;
const pct = (n: number) => `${((n / c.rawRows) * 100).toFixed(1)}%`;

console.log(`
  snapshot ${snapshot.version}
  ${input}

  rows in CSV                 ${c.rawRows}
  identical duplicates merged ${c.identicalDuplicatesCollapsed}
  conflict groups held out    ${c.conflictGroups} (${c.conflictRowsHeldOut} rows)
  quarantined                 ${c.quarantined}
  ---------------------------------------
  analysable                  ${c.analyzable}  (${pct(c.analyzable)})

  issues  ${c.issuesBySeverity.error} error · ${c.issuesBySeverity.warning} warning · ${c.issuesBySeverity.info} info
${Object.entries(c.issuesByType)
  .sort((a, b) => b[1] - a[1])
  .map(([t, n]) => `          ${String(n).padStart(4)}  ${t}`)
  .join("\n")}

  cities        ${snapshot.vocabulary.cities.length}
  date range    ${snapshot.dateRange?.min} → ${snapshot.dateRange?.max}
  written       ${output}
`);
}

main();
