/**
 * Compendium Library — get Plutonium's data ready before it's needed.
 *
 * When a 5e.tools entry is clicked (or a drag starts), ask Plutonium to load exactly that entry — the same
 * work the drop would do — so the drop itself is quick. Never preload a whole category: Plutonium runs its
 * data loads one at a time, so a big preload (every creature, every spell) would make everything else in
 * Plutonium wait behind it.
 */
import { MODULE_ID, localBrewUrl } from "./data.js";

const started = new Set();
const ready = () => game.modules.get("plutonium")?.active && typeof globalThis.DataLoader?.pCacheAndGet === "function";

export function warmFor(r) {
  if (!r || r.origin !== "5etools" || !r.page || !r.vtSource || !r.hash || !ready()) return;
  const key = `${r.page}|${r.vtSource}|${r.hash}`;
  if (started.has(key)) return;
  started.add(key);
  (async () => {
    // Homebrew/prerelease: fetch the book from this server first (no Plutonium lock involved).
    if (/^(homebrew|prerelease)\//.test(r.file ?? "")) {
      const url = await localBrewUrl(r.vtSource);
      if (url) await globalThis.DataUtil?.loadJSON?.(url);
    }
    await globalThis.DataLoader.pCacheAndGet(r.page, r.vtSource, r.hash, { isSilent: true });
  })().catch((e) => console.debug(`${MODULE_ID} | prewarm skipped for ${r.name}`, e));
}

/** Kept for compatibility; opening the library no longer preloads anything. */
export function warmOnOpen() {}
