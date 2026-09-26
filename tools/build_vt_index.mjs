/**
 * Command-line version of the in-Foundry "Build 5e.tools index" button.
 *   node tools/build_vt_index.mjs <path to 5etools root> <out.json>
 */
import fs from "fs";
import path from "path";
import { buildVtIndex } from "../scripts/vt-index-core.js";

const [ROOT, OUT] = process.argv.slice(2);
if (!ROOT || !OUT) { console.error("usage: node tools/build_vt_index.mjs <5etools root> <out.json>"); process.exit(1); }
const J = async (p) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8")); } catch { return null; } };
const out = await buildVtIndex(J);
fs.writeFileSync(OUT, JSON.stringify(out));
console.log(`${out.rows.length} entries, ${(fs.statSync(OUT).size / 1e6).toFixed(1)} MB`);
