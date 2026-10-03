/**
 * Compendium Library — get Plutonium's data ready before it's needed.
 *
 * The first 5e.tools import in a session is slow: Plutonium downloads and processes the whole data set for
 * that kind of entry (every item and magic variant, for example) and, for homebrew, the whole book. It keeps
 * it all in memory afterwards, so only the first one hurts. Start that work in the background while the
 * player is still browsing, so the drop itself is quick.
 */
import { MODULE_ID, localBrewUrl } from "./data.js";

const started = new Map();
const plutonium = () => game.modules.get("plutonium")?.active && globalThis.DataLoader?.pCacheAndGetAllSite;
const idle = (fn) => new Promise((resolve) => (globalThis.requestIdleCallback ?? ((f) => setTimeout(f, 200)))(() => resolve(fn())));

function once(key, fn) {
  if (!started.has(key)) started.set(key, Promise.resolve().then(fn).catch((e) => console.debug(`${MODULE_ID} | prewarm ${key} skipped`, e)));
  return started.get(key);
}

/** Warm one 5e.tools page (items.html, spells.html, …). */
export function warmPage(page) {
  if (!page || !plutonium()) return null;
  return once(`page:${page}`, () => idle(() => globalThis.DataLoader.pCacheAndGetAllSite(page, { isSilent: true })));
}

/** Warm whatever this entry's import will need: its kind of data, and its homebrew/prerelease book. */
export function warmFor(r) {
  if (!r || r.origin !== "5etools" || !plutonium()) return;
  warmPage(r.page);
  if (r.page !== "items.html" && r.prop !== "monster") warmPage("items.html");   // most imports touch item data
  if (/^(homebrew|prerelease)\//.test(r.file ?? "")) {
    once(`book:${r.vtSource}`, async () => {
      const url = await localBrewUrl(r.vtSource);
      if (url) await globalThis.DataUtil?.loadJSON?.(url);
    });
  }
}

/** Called when the library opens: items are what players drag most. */
export function warmOnOpen() {
  if (!plutonium() || !game.settings.get(MODULE_ID, "show5etools")) return;
  setTimeout(() => warmPage("items.html"), 1500);
}
