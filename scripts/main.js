/**
 * Compendium Library — entry point.
 *
 * One searchable, filterable library of every spell, item, feat, class option and creature
 * in this world's compendiums (system, modules — including your older-edition conversions —
 * and world documents), plus your local 5e.tools copy through Plutonium. Drag anything onto
 * a character sheet, the canvas, the sidebar or a compendium.
 */
import { MODULE_ID, getRecords, invalidate, dropPackCache, forgetVtIndex, vtRoot, localBrewUrl } from "./data.js";
import { CompendiumLibrary, configurePlutonium, plutoniumConfigured } from "./app.js";

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "show5etools", {
    name: "Include the local 5e.tools copy",
    hint: "List 5e.tools entries (official and homebrew) next to your compendiums. They are imported through Plutonium when dropped.",
    scope: "client", config: true, type: Boolean, default: true, onChange: () => invalidate(),
  });
  game.settings.register(MODULE_ID, "vtRoot", {
    name: "5e.tools folder",
    hint: "Folder inside your Foundry Data folder that holds a copy of 5e.tools (the one with data/, img/ and homebrew/ in it). Leave as is if you don't have one.",
    scope: "world", config: true, type: String, default: "5etools", onChange: () => { forgetVtIndex(); invalidate(); },
  });
  for (const k of ["state", "windowPos", "userDataFallback"]) game.settings.register(MODULE_ID, k, { scope: "client", config: false, type: Object, default: {} });
  game.settings.register(MODULE_ID, "plutoniumDone", { scope: "world", config: false, type: Boolean, default: false });
  game.keybindings.register(MODULE_ID, "open", {
    name: "Open the Compendium Library", editable: [{ key: "KeyL", modifiers: ["Shift"] }],
    onDown: () => { CompendiumLibrary.open(); return true; },
  });
});

// A "Library" button at the top of the Compendium, Items and Actors sidebar tabs
function addButton(app, html) {
  const el = html instanceof HTMLElement ? html : html?.[0];
  if (!el || el.querySelector(".cl-open")) return;
  const target = el.querySelector(".header-actions") || el.querySelector(".directory-header") || el.querySelector("header");
  if (!target) return;
  const b = document.createElement("button");
  b.type = "button";
  b.className = "cl-open";
  b.innerHTML = `<i class="fa-solid fa-books"></i> Compendium Library`;
  b.addEventListener("click", (e) => { e.preventDefault(); CompendiumLibrary.open(); });
  target.append(b);
}
for (const hook of ["renderCompendiumDirectory", "renderItemDirectory", "renderActorDirectory"]) Hooks.on(hook, addButton);

// Keep the index fresh when compendium content changes
const stale = foundry.utils.debounce(() => { invalidate(); foundry.applications.instances.get("compendium-library")?.reload(); }, 2000);
for (const hook of ["createItem", "deleteItem", "createActor", "deleteActor", "updateItem", "updateActor"]) Hooks.on(hook, (doc) => {
  if (doc.parent) return; // items on a character sheet don't matter here
  if (doc.pack) dropPackCache(doc.pack);
  if (hook.startsWith("update") && !doc.pack) return; // world docs are read live on the next open
  stale();
});

/**
 * When a homebrew or prerelease entry is dropped, Plutonium loads its whole book first. If the book isn't
 * loaded in that browser yet, it downloads it from GitHub — which fails for some players. Point that lookup
 * at the book in this server's own 5e.tools copy instead, and only fall back to GitHub if it isn't there.
 */
function useLocalBrewForPlutonium() {
  if (!game.modules.get("plutonium")?.active) return;
  for (const util of [globalThis.BrewUtil2, globalThis.PrereleaseUtil]) {
    if (!util || util.__compendiumLibraryLocal || typeof util.pGetSourceUrl !== "function") continue;
    const original = util.pGetSourceUrl.bind(util);
    util.pGetSourceUrl = async (source, ...rest) => {
      try {
        const url = await localBrewUrl(source);
        if (url) return url;
      } catch (e) { console.warn(`${MODULE_ID} | local homebrew lookup failed for ${source}`, e); }
      return original(source, ...rest);
    };
    util.__compendiumLibraryLocal = true;
  }
}

Hooks.once("ready", async () => {
  game.modules.get(MODULE_ID).api = { open: () => CompendiumLibrary.open(), getRecords, reload: () => { invalidate(); } };
  useLocalBrewForPlutonium();
  // first run with Plutonium: offer to point it at the local 5e.tools copy
  if (game.user.isGM && game.modules.get("plutonium")?.active && !game.settings.get(MODULE_ID, "plutoniumDone") && !plutoniumConfigured()) {
    try {
      const res = await fetch(foundry.utils.getRoute(`${vtRoot()}/data/changelog.json`), { method: "HEAD" });
      if (res.ok) setTimeout(() => configurePlutonium(true), 3000);
    } catch { /* no local copy */ }
  }
});
