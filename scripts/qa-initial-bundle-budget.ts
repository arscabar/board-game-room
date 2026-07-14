import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { gzipSync } from "node:zlib";
import path from "node:path";

const distRoot = path.resolve("dist");
const html = readFileSync(path.join(distRoot, "index.html"), "utf8");
const initialAssets = Array.from(
  new Set(Array.from(html.matchAll(/(?:src|href)="\/?(assets\/[^"?#]+)"/g), (match) => match[1]))
);

assert(initialAssets.length > 0, "Production index.html must reference initial assets.");
assert(!initialAssets.some((asset) => /vendor-radix/i.test(asset)), "The full Radix theme must not return to the initial path.");
assert(!initialAssets.some((asset) => /three\.module/i.test(asset)), "Three.js must remain outside the critical HTML path.");

const rows = initialAssets.map((asset) => {
  const filePath = path.join(distRoot, asset);
  const contents = readFileSync(filePath);
  return {
    asset,
    type: path.extname(asset).slice(1),
    rawBytes: statSync(filePath).size,
    gzipBytes: gzipSync(contents).byteLength
  };
});

const totals = rows.reduce(
  (result, row) => {
    result.rawBytes += row.rawBytes;
    result.gzipBytes += row.gzipBytes;
    if (row.type === "css") result.cssBytes += row.rawBytes;
    if (row.type === "js") result.jsBytes += row.rawBytes;
    return result;
  },
  { rawBytes: 0, gzipBytes: 0, cssBytes: 0, jsBytes: 0 }
);

assert(totals.rawBytes <= 850_000, `Initial raw assets exceeded 850KB: ${totals.rawBytes}`);
assert(totals.gzipBytes <= 220_000, `Initial gzip assets exceeded 220KB: ${totals.gzipBytes}`);
assert(totals.cssBytes <= 500_000, `Initial CSS exceeded 500KB: ${totals.cssBytes}`);
assert(totals.jsBytes <= 400_000, `Initial JS exceeded 400KB: ${totals.jsBytes}`);

console.table(rows);
console.table([totals]);
console.log("Initial bundle performance budget passed.");
