#!/usr/bin/env node
// Write the first-paint snapshot and the background half next to data.json.
//
//   node scripts/split-data.js [--data data.json] [--out-dir dir]
//
// The two files are a pure re-partition of data.json: same rows, same meta,
// nothing added or dropped. The priority file also carries the national map
// counts for the dashboard's default window, derived from every row. data.json
// itself is left as the full snapshot for the next build and for ask.js.
import { readFileSync, writeFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { splitRows, mapPreset, PRIORITY_FILE, REST_FILE } from "../snapshot.js";

export function writeSplitFiles(data, dir = ".") {
  if (!data?.meta?.today) throw new Error("snapshot meta.today is required to build the national map preset");
  if (!Array.isArray(data.rows) || !data.meta.dicts) throw new Error("snapshot is missing rows or dicts");
  const { first, rest } = splitRows(data.rows, data.meta.dicts);
  const map = mapPreset(data.rows, data.meta.today);
  writeFileSync(join(dir, PRIORITY_FILE), JSON.stringify({ meta: data.meta, map, rows: first }));
  writeFileSync(join(dir, REST_FILE), JSON.stringify({ built_at: data.meta.built_at, rows: rest }));
  return { first: first.length, rest: rest.length, total: data.rows.length };
}

function main() {
  const { values: args } = parseArgs({ options: {
    data: { type: "string", default: "data.json" },
    "out-dir": { type: "string" },
  } });
  const data = JSON.parse(readFileSync(args.data, "utf8"));
  const dir = args["out-dir"] || dirname(args.data);
  const n = writeSplitFiles(data, dir);
  if (n.first + n.rest !== n.total) throw new Error("split lost or duplicated rows");
  console.log(`Split ${n.total.toLocaleString()} rows → ${n.first.toLocaleString()} in ${join(dir, PRIORITY_FILE)}, ${n.rest.toLocaleString()} in ${join(dir, REST_FILE)}.`);
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
if (invoked) main();
