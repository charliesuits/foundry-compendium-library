/**
 * Compendium Library — the window and the actions behind its buttons.
 */
import { MODULE_ID, getRecords, invalidate, loadUserData, dropPackCache, buildVtIndexNow, vtRoot } from "./data.js";
import { LibraryView, plutoniumActive } from "./view.js";

const HAM = foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.api.ApplicationV2);

export class CompendiumLibrary extends HAM {
  static DEFAULT_OPTIONS = {
    id: "compendium-library",
    classes: ["cl-app"],
    tag: "div",
    window: { title: "Compendium Library", icon: "fa-solid fa-books", resizable: true },
    position: { width: Math.min(1320, window.innerWidth * 0.85), height: window.innerHeight * 0.85 },
  };
  static PARTS = { content: { template: `modules/${MODULE_ID}/templates/library.hbs` } };

  static open() {
    const existing = foundry.applications.instances.get("compendium-library");
    if (existing) { existing.bringToFront(); if (existing.minimized) existing.maximize(); return existing; }
    return new CompendiumLibrary().render(true);
  }

  _onRender(context, options) {
    super._onRender(context, options);
    const saved = game.settings.get(MODULE_ID, "windowPos") || {};
    if (!this._posRestored && saved.width) { this._posRestored = true; this.setPosition(saved); }
    const host = this.element.querySelector(".cl-host");
    this.view ??= new LibraryView({ root: host, app: this });
    this.view.root = host;
    this.view.render();
    this.addHeaderButtons();
    this.load();
  }

  setPosition(pos) {
    const r = super.setPosition(pos);
    if (this.rendered) {
      this._savePos ??= foundry.utils.debounce(() => { const { left, top, width, height } = this.position; game.settings.set(MODULE_ID, "windowPos", { left, top, width, height }); }, 500);
      this._savePos();
    }
    return r;
  }

  addHeaderButtons() {
    const header = this.element.querySelector(".window-header");
    if (!header || header.querySelector(".cl-hdr")) return;
    const close = header.querySelector('[data-action="close"]');
    const mk = (icon, tip, fn) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = `header-control icon cl-hdr ${icon}`; b.dataset.tooltip = tip;
      b.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); fn(); });
      header.insertBefore(b, close);
    };
    mk("fa-solid fa-rotate", "Re-read every compendium", async () => { await dropPackCache(); this.reload(); });
    if (game.user.isGM) mk("fa-solid fa-scroll", "Rebuild the 5e.tools list", async () => {
      const list = this.element.querySelector(".cl-list");
      try {
        await buildVtIndexNow((m) => { if (list) list.innerHTML = `<div class="cl-loading"><i class="fa-solid fa-spinner fa-spin"></i> ${m}</div>`; });
        invalidate(); this.view.items = null; await this.load();
        ui.notifications.info("5e.tools list rebuilt.");
      } catch (e) { ui.notifications.warn(`${e.message}. Check the “5e.tools folder” module setting.`); this.load(); }
    });
    if (game.user.isGM && plutoniumActive()) mk("fa-solid fa-plug", "Point Plutonium at your local 5e.tools copy", () => configurePlutonium(true));
  }

  async load() {
    const list = this.element.querySelector(".cl-list");
    if (this.view.items) return this.view.setItems(this.view.items);
    if (list) list.innerHTML = `<div class="cl-loading"><i class="fa-solid fa-spinner fa-spin"></i> Loading…</div>`;
    await loadUserData();
    const items = await getRecords({ progress: (m) => { const l = this.element?.querySelector(".cl-loading"); if (l) l.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> ${m}`; } });
    this.view.setItems(items);
  }

  async reload() {
    invalidate();
    this.view.items = null;
    await this.load();
  }

  setCount(n) {
    const t = this.element?.querySelector(".window-title");
    if (t) t.textContent = `Compendium Library — ${n.toLocaleString()}`;
  }

  // ───────────────────────────── actions
  targetActor() {
    const tok = canvas?.tokens?.controlled?.[0]?.actor;
    if (tok?.isOwner) return tok;
    return game.user.character ?? null;
  }
  targetActorName() { return this.targetActor()?.name ?? null; }

  async openOrImport(r) {
    if (r.origin === "foundry") return (await fromUuid(r.uuid))?.sheet?.render(true);
    if (game.user.isGM) return this.importToWorld(r);
  }

  async addToActor(r) {
    const actor = this.targetActor();
    if (!actor) return ui.notifications.warn("Select a token you own, or assign yourself a character, then try again — or drag the entry onto a sheet.");
    if (r.mode === "creature") return ui.notifications.warn("Creatures go onto the canvas or into the sidebar — drag them there.");
    if (r.mode === "option") {
      // classes, subclasses, species and backgrounds run the sheet's advancement flow, which only a real drop triggers
      actor.sheet.render(true);
      return ui.notifications.info(`Drag ${r.name} onto ${actor.name}'s sheet to run its level-up choices.`);
    }
    try {
      let data;
      if (r.origin === "foundry") data = (await fromUuid(r.uuid)).toObject();
      else {
        const tmp = await Item.implementation.fromDropData(this.view.dragData(r));
        if (!tmp) throw new Error("Plutonium returned nothing");
        data = tmp.toObject();
        foundry.utils.setProperty(data, "flags.plutonium.isStandardDragDrop", true);
      }
      delete data._id;
      await actor.createEmbeddedDocuments("Item", [data]);
      this.view.pushRecent(r.key);
      ui.notifications.info(`Added ${r.name} to ${actor.name}.`);
    } catch (e) {
      console.error(e);
      ui.notifications.error(`Could not add ${r.name}: ${e.message}`);
    }
  }

  async importToWorld(r) {
    if (r.origin !== "5etools") return;
    const dd = this.view.dragData(r);
    if (!dd) return;
    try {
      let doc;
      if (dd.type === "Actor") doc = await Actor.implementation.fromDropData(dd);
      else {
        const tmp = await Item.implementation.fromDropData(dd);
        const data = tmp.toObject();
        foundry.utils.setProperty(data, "flags.plutonium.isStandardDragDrop", true);
        doc = await Item.implementation.create(data);
      }
      if (!doc) throw new Error("Plutonium returned nothing");
      ui.notifications.info(`Imported ${doc.name}.`);
      doc.sheet?.render(true);
    } catch (e) {
      console.error(e);
      ui.notifications.error(`Could not import ${r.name}: ${e.message}`);
    }
  }

  // ───────────────────────────── shared library (the shared-homebrew module, enabled in every world)
  async shareRecords(records, { bulk = false } = {}) {
    records = records.filter((r) => r.origin === "foundry" && ["Item", "Actor"].includes(r.docName));
    if (!records.length) return;
    const packs = { Item: game.packs.get("shared-homebrew.homebrew-items"), Actor: game.packs.get("shared-homebrew.homebrew-actors") };
    if (!packs.Item || !packs.Actor) return ui.notifications.warn("Enable the “Shared Library (All Worlds)” module in this world first.");
    if (bulk && !(await foundry.applications.api.DialogV2.confirm({ window: { title: "Copy to the Shared Library" },
      content: `<p>Copy ${records.length} entries to the Shared Library? Entries already there (same name and type) are skipped.</p>` }))) return;
    const idx = {};
    for (const [k, p] of Object.entries(packs)) idx[k] = await p.getIndex({ fields: ["type"] });
    const relock = [];
    let added = 0, replaced = 0, skipped = 0;
    try {
      for (const r of records) {
        const pack = packs[r.docName];
        const doc = await fromUuid(r.uuid);
        if (!doc) continue;
        const existing = idx[r.docName].find((e) => e.name === doc.name && e.type === doc.type);
        let choice = "new";
        if (existing) {
          if (bulk) { skipped++; continue; }
          choice = await foundry.applications.api.DialogV2.wait({
            window: { title: "Already in the Shared Library" },
            content: `<p><b>${foundry.utils.escapeHTML(doc.name)}</b> is already in the Shared Library.</p>`,
            buttons: [{ action: "replace", label: "Replace it", default: true }, { action: "both", label: "Keep both" }, { action: "cancel", label: "Cancel" }],
          }).catch(() => "cancel");
          if (!choice || choice === "cancel") continue;
        }
        if (pack.locked && !relock.includes(pack)) { await pack.configure({ locked: false }); relock.push(pack); }
        const data = doc.toObject();
        data.folder = null; delete data.sort; delete data.ownership;
        foundry.utils.setProperty(data, "_stats.compendiumSource", doc.uuid);
        if (choice === "replace") {
          data._id = existing._id;
          await (await pack.getDocument(existing._id))?.delete();
          await doc.constructor.create(data, { pack: pack.collection, keepId: true });
          replaced++;
        } else {
          delete data._id;
          await doc.constructor.create(data, { pack: pack.collection });
          added++;
        }
      }
    } catch (e) {
      console.error(e);
      ui.notifications.error(`Copy to the Shared Library stopped: ${e.message}`);
    } finally {
      for (const p of relock) await p.configure({ locked: true });
    }
    const parts = [added && `${added} added`, replaced && `${replaced} replaced`, skipped && `${skipped} already there`].filter(Boolean);
    if (parts.length) ui.notifications.info(`Shared Library: ${parts.join(", ")}. Every world with the module enabled can use them now.`);
    this.reload();
  }

  async close(options) {
    this.view?.destroy();
    return super.close(options);
  }
}

// ───────────────────────────── Plutonium configuration
/** Settings that make Plutonium read the local 5e.tools copy in Data/5etools. */
export function plutoniumSettings() {
  const root = vtRoot();
  const base = `${window.location.origin}${foundry.utils.getRoute(`${root}/`)}`;
  return [
    ["dataSources", "baseSiteUrl", base],
    ["dataSources", "isNoLocalData", true],
    ["dataSources", "isLoadLocalHomebrewIndex", true],
    ["dataSources", "localHomebrewDirectoryPath", `${root}/homebrew`],
    ["dataSources", "isUseLocalHomebrewIndexJson", true],
    ["import", "isUseLocalImages", true],
    ["import", "localImageDirectoryPath", root],
  ];
}
export function plutoniumConfigured() {
  const api = game.modules.get("plutonium")?.api;
  if (!api?.config) return false;
  try { return plutoniumSettings().every(([g, k, v]) => api.config.getValue(g, k) === v); } catch { return false; }
}
export async function configurePlutonium(ask = true) {
  const api = game.modules.get("plutonium")?.api;
  if (!game.user.isGM || !api?.config) return false;
  if (ask) {
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Use your local 5e.tools copy" },
      content: `<p>Point Plutonium at the 5e.tools copy in your Foundry Data folder (<code>${vtRoot()}/</code>): the newer data, your homebrew packs and the offline art.</p><p>A reload is needed afterwards.</p>`,
    });
    if (!ok) return false;
  }
  const failed = [];
  for (const [g, k, v] of plutoniumSettings()) {
    try { if (api.config.setValue(g, k, v) === false) failed.push(`${g}.${k}`); } catch { failed.push(`${g}.${k}`); }
  }
  if (failed.length) ui.notifications.warn(`Plutonium refused: ${failed.join(", ")}. Set them in Plutonium's config instead.`);
  else {
    await game.settings.set(MODULE_ID, "plutoniumDone", true);
    const reload = await foundry.applications.api.DialogV2.confirm({ window: { title: "Reload now?" }, content: "<p>Plutonium now reads your local 5e.tools copy. Reload to load the homebrew?</p>" });
    if (reload) window.location.reload();
  }
  return !failed.length;
}
