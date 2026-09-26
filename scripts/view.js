/**
 * Compendium Library — the browser UI.
 *
 * Modes along the top (Spells, Items, Feats & Features, Classes & Origins, Creatures); each
 * mode brings its own filters. Filters combine with AND, values inside one filter with OR, and
 * every value shows how many results it would give. Every row can be dragged straight onto a
 * character sheet, the canvas, the sidebar or a compendium.
 */
import {
  MODULE_ID, MODES, MODE_ORDER, RARITY_ORDER, userData, saveUserData, getVtEntry, metaLine,
} from "./data.js";
import { render5eEntry } from "./render5e.js";

const PAGE = 200;
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const PLUTONIUM_SUBTYPE = "srd5e.Import";
export const plutoniumActive = () => !!game.modules.get("plutonium")?.active;

const LEVEL_ORDER = ["Cantrip", ...Array.from({ length: 9 }, (_, i) => `Level ${i + 1}`), "Unknown"];
const CR_ORDER = ["CR 0–½", "CR 1–4", "CR 5–10", "CR 11–16", "CR 17 +", "Unknown"];
const SIZE_ORDER = ["Tiny", "Small", "Medium", "Large", "Huge", "Gargantuan", "Varies", "Unknown"];
const PRICE_ORDER = ["Free", "Under 10 gp", "10–99 gp", "100–999 gp", "1,000–9,999 gp", "10,000–49,999 gp", "50,000 gp +", "Unknown"];
const TIME_ORDER = ["Action", "Bonus Action", "Reaction", "1 Minute", "1 Minute +", "Other", "Unknown"];
const EDITION_ORDER = ["5e (2024)", "5e (2014)", "5e", "Unearthed Arcana", "Third-party", "4e", "3e / 3.5e", "AD&D 2e", "AD&D 1e", "OD&D / Basic"];

const F = (id, label, key, opts = {}) => ({ id, label, keys: (r) => { const v = r.f[key]; return v == null || (Array.isArray(v) && !v.length) ? [opts.none ?? "None"] : Array.isArray(v) ? v : [v]; }, ...opts });
const COMMON = [
  { id: "source", label: "Source", kind: "source" },
  { id: "edition", label: "Edition", keys: (r) => [r.edition || "5e"], order: EDITION_ORDER },
];
const FACETS = {
  all: [{ id: "mode", label: "Kind", keys: (r) => [MODES[r.mode].label], order: MODE_ORDER.map((m) => MODES[m].label) }, ...COMMON],
  spell: [...COMMON, F("level", "Level", "level", { order: LEVEL_ORDER }), F("classes", "Class list", "classes", { none: "No class list" }),
    F("school", "School", "school"), F("time", "Casting time", "time", { order: TIME_ORDER }), F("tags", "Components & tags", "tags"),
    F("damage", "Damage type", "damage", { none: "No damage" })],
  item: [...COMMON, F("itype", "Item type", "itype"), F("rarity", "Rarity", "rarity", { order: RARITY_ORDER }),
    F("attune", "Attunement", "attune"), F("magical", "Magical", "magical"), F("price", "Price", "price", { order: PRICE_ORDER })],
  feature: [...COMMON, F("ftype", "Feature type", "ftype"), F("fsub", "Subtype", "fsub", { none: "—" }), F("plevel", "Prerequisite level", "plevel")],
  option: [...COMMON, F("okind", "Kind", "okind"), F("parent", "Parent class", "parent", { none: "—" })],
  creature: [...COMMON, F("ctype", "Creature type", "ctype"), F("cr", "Challenge", "cr", { order: CR_ORDER }),
    F("size", "Size", "size", { order: SIZE_ORDER }), F("env", "Environment", "env", { none: "Any / unlisted" })],
};
const FLAGS = [
  { id: "hideDup", label: "Hide duplicates (same entry in several compendiums or worlds)", icon: "fa-solid fa-clone", test: (r) => !(r.origin === "5etools" && r.inFoundry) && !r.dupOf, default: true },
  { id: "foundryOnly", label: "Only Foundry compendiums", icon: "fa-solid fa-book", test: (r) => r.origin === "foundry" },
  { id: "vtOnly", label: "Only 5e.tools", icon: "fa-solid fa-scroll", test: (r) => r.origin === "5etools" },
];
const SORTS = {
  name: ["Name A–Z", (a, b) => a.name.localeCompare(b.name)],
  level: ["Level / CR", (a, b) => (lvlNum(a) - lvlNum(b)) || a.name.localeCompare(b.name)],
  rarity: ["Rarity", (a, b) => (RARITY_ORDER.indexOf(a.f.rarity) - RARITY_ORDER.indexOf(b.f.rarity)) || a.name.localeCompare(b.name)],
  price: ["Price", (a, b) => ((a.gp ?? 1e12) - (b.gp ?? 1e12)) || a.name.localeCompare(b.name)],
  source: ["Source", (a, b) => a.source.localeCompare(b.source) || a.name.localeCompare(b.name)],
};
function lvlNum(r) {
  if (r.mode === "creature") return r.cr ?? 999;
  if (r.mode === "spell") { const i = LEVEL_ORDER.indexOf(r.f.level); return i < 0 ? 99 : i; }
  return 0;
}
const TYPE_ICON = {
  spell: "fa-solid fa-wand-sparkles", item: "fa-solid fa-shield-halved", feature: "fa-solid fa-star", option: "fa-solid fa-user-plus", creature: "fa-solid fa-dragon",
};

const DEFAULT_STATE = () => ({ mode: "all", view: "all", q: "", sort: "name", layout: "list", sel: {}, flags: { hideDup: true }, open: { source: true, level: true, itype: true, ctype: true, ftype: true, okind: true, mode: true }, expanded: {}, detail: true });

export class LibraryView {
  constructor({ root, app }) {
    this.root = root;
    this.app = app;
    this.state = foundry.utils.mergeObject(DEFAULT_STATE(), this.loadState(), { inplace: false });
    this.sel = (id) => (this.state.sel[id] = this.state.sel[id] instanceof Set ? this.state.sel[id] : new Set(this.state.sel[id] || []));
    this._refresh = foundry.utils.debounce(() => this.refresh(), 140);
  }
  loadState() { try { return game.settings.get(MODULE_ID, "state") || {}; } catch { return {}; } }
  saveState() {
    const s = { ...this.state, sel: {} };
    for (const [k, v] of Object.entries(this.state.sel)) s.sel[k] = [...v];
    game.settings.set(MODULE_ID, "state", s).catch(() => {});
  }
  get facets() { return FACETS[this.state.mode] || FACETS.all; }

  render() {
    this.destroy();
    const r = this.root;
    r.classList.add("cl-root");
    r.innerHTML = `
      <nav class="cl-modes">${["all", ...MODE_ORDER].map((m) => `<a class="cl-mode ${this.state.mode === m ? "active" : ""}" data-mode="${m}"><i class="${m === "all" ? "fa-solid fa-books" : MODES[m].icon}"></i><span>${m === "all" ? "Everything" : MODES[m].label}</span><em></em></a>`).join("")}</nav>
      <div class="cl-body ${this.state.detail ? "with-detail" : ""}">
        <aside class="cl-sidebar"><div class="cl-views"></div><div class="cl-flags"></div><div class="cl-facets"></div></aside>
        <section class="cl-main">
          <div class="cl-toolbar">
            <div class="cl-search"><i class="fa-solid fa-magnifying-glass"></i>
              <input type="text" class="cl-q" autocomplete="off" spellcheck="false" placeholder="Search names, sources, schools, types…  -word excludes, &quot;quotes&quot; for phrases" value="${esc(this.state.q)}">
              <button type="button" class="cl-clear" data-tooltip="Clear search"><i class="fa-solid fa-xmark"></i></button></div>
            <select class="cl-sort">${Object.entries(SORTS).map(([k, [l]]) => `<option value="${k}" ${k === this.state.sort ? "selected" : ""}>${l}</option>`).join("")}</select>
            <button type="button" class="cl-icon-btn cl-detail-toggle ${this.state.detail ? "active" : ""}" data-tooltip="Details pane"><i class="fa-solid fa-table-columns"></i></button>
          </div>
          <div class="cl-chips"></div>
          <div class="cl-status"><span class="cl-count"></span><span class="cl-hint">Drag any row onto a character sheet, the canvas or the sidebar.</span></div>
          <ol class="cl-list"></ol><div class="cl-sentinel"></div>
        </section>
        <aside class="cl-detail"><div class="cl-detail-empty"><i class="fa-regular fa-hand-pointer"></i><p>Select an entry to read it.</p></div></aside>
      </div>
      <div class="cl-menu hidden"></div>`;
    const q = (s) => r.querySelector(s);
    this.el = { views: q(".cl-views"), flags: q(".cl-flags"), facets: q(".cl-facets"), search: q(".cl-q"), list: q(".cl-list"),
      chips: q(".cl-chips"), count: q(".cl-count"), sentinel: q(".cl-sentinel"), main: q(".cl-main"), detail: q(".cl-detail"),
      menu: q(".cl-menu"), modes: q(".cl-modes"), body: q(".cl-body"), sidebar: q(".cl-sidebar") };
    this.bind();
    if (this.items) this.refresh();
  }

  bind() {
    const r = this.root;
    this.el.search.addEventListener("input", () => { this.state.q = this.el.search.value; this._refresh(); });
    this.el.search.addEventListener("keydown", (e) => { if (e.key === "Escape" && this.el.search.value) { e.preventDefault(); e.stopPropagation(); this.el.search.value = ""; this.state.q = ""; this.refresh(); } });
    r.querySelector(".cl-clear").addEventListener("click", () => { this.el.search.value = ""; this.state.q = ""; this.refresh(); });
    r.querySelector(".cl-sort").addEventListener("change", (e) => { this.state.sort = e.target.value; this.refresh(); });
    r.querySelector(".cl-detail-toggle").addEventListener("click", (e) => {
      this.state.detail = !this.state.detail;
      e.currentTarget.classList.toggle("active", this.state.detail);
      this.el.body.classList.toggle("with-detail", this.state.detail);
      this.saveState();
    });
    this.el.modes.addEventListener("click", (e) => {
      const m = e.target.closest("[data-mode]");
      if (!m) return;
      this.state.mode = m.dataset.mode;
      this.el.modes.querySelectorAll(".cl-mode").forEach((x) => x.classList.toggle("active", x.dataset.mode === this.state.mode));
      this.refresh();
    });
    this.el.sidebar.addEventListener("click", (e) => this.onSidebarClick(e));
    this.el.sidebar.addEventListener("contextmenu", (e) => this.onSidebarContext(e));
    this.el.chips.addEventListener("click", (e) => this.onChip(e));
    this._io = new IntersectionObserver((en) => { if (en.some((x) => x.isIntersecting)) this.renderMore(); }, { root: this.el.main, rootMargin: "600px" });
    this._io.observe(this.el.sentinel);
    this.el.list.addEventListener("click", (e) => {
      const li = e.target.closest("li[data-key]");
      if (!li) return;
      if (e.target.closest(".cl-fav")) { e.stopPropagation(); this.toggleFav(li.dataset.key, li); return; }
      this.el.list.querySelectorAll("li.selected").forEach((x) => x.classList.remove("selected"));
      li.classList.add("selected");
      this.showDetail(this.byKey.get(li.dataset.key));
    });
    this.el.list.addEventListener("dblclick", (e) => {
      const li = e.target.closest("li[data-key]");
      if (li) this.app.openOrImport(this.byKey.get(li.dataset.key));
    });
    this.el.list.addEventListener("dragstart", (e) => {
      const li = e.target.closest("li[data-key]");
      if (!li) return;
      const rec = this.byKey.get(li.dataset.key);
      const data = this.dragData(rec);
      if (!data) { e.preventDefault(); return; }
      e.dataTransfer.setData("text/plain", JSON.stringify(data));
      this.pushRecent(rec.key);
    });
    this.el.list.addEventListener("contextmenu", (e) => this.onRowContext(e));
    document.addEventListener("pointerdown", (this._closeMenu = (e) => { if (!e.target.closest(".cl-menu")) this.hideMenu(); }), true);
  }
  destroy() { this._io?.disconnect(); if (this._closeMenu) document.removeEventListener("pointerdown", this._closeMenu, true); }

  setItems(items) {
    this.items = items;
    this.byKey = new Map(items.map((i) => [i.key, i]));
    this.refresh();
  }

  dragData(r) {
    if (!r) return null;
    if (r.origin === "foundry") return { type: r.docName, uuid: r.uuid };
    if (!r.canImport) { ui.notifications.warn(`${r.name}: subclasses are added through their class — drag the class instead.`); return null; }
    if (!plutoniumActive()) { ui.notifications.warn("5e.tools entries are imported through Plutonium, which isn't enabled in this world."); return null; }
    return { type: r.prop === "monster" ? "Actor" : "Item", subType: PLUTONIUM_SUBTYPE, page: r.page, source: r.vtSource, hash: r.hash, isDragDropForcePlutoniumImport: true };
  }

  // ───────────────────────────────── filtering
  parseQuery(q) {
    const inc = [], exc = [];
    const re = /(-?)"([^"]+)"|(-?)(\S+)/g;
    let m;
    while ((m = re.exec(q.toLowerCase()))) {
      const neg = m[1] || m[3];
      const t = (m[2] || m[4] || "").trim();
      if (t && t !== "-") (neg ? exc : inc).push(t);
    }
    return { inc, exc };
  }
  pass(f, r) {
    if (f.kind === "source") {
      const s = this.sel("source"), c = this.sel("coll"), g = this.sel("sgroup");
      if (!s.size && !c.size && !g.size) return true;
      return g.has(r.sourceGroup) || s.has(`${r.sourceGroup}::${r.source}`) || c.has(`${r.sourceGroup}::${r.source}::${r.collection}`);
    }
    const s = this.sel(f.id);
    if (!s.size) return true;
    return f.keys(r).some((k) => s.has(k));
  }

  refresh() {
    if (!this.items) return;
    const t0 = performance.now();
    const { inc, exc } = this.parseQuery(this.state.q || "");
    const u = userData();
    const hidden = new Set(u.hidden);
    const showHidden = this.state.view === "hidden";
    const vset = this.viewSet();
    const flags = FLAGS.filter((f) => this.state.flags[f.id] ?? f.default);
    const mode = this.state.mode;
    const facets = this.facets;
    const nF = facets.length, ALL = (1 << nF) - 1;
    const counts = Object.fromEntries(facets.map((f) => [f.id, new Map()]));
    const src = { group: new Map(), source: new Map(), coll: new Map() };
    const modeCounts = new Map();
    const res = [];
    for (const r of this.items) {
      if (hidden.has(r.key) !== showHidden) continue;
      if (vset && !vset.has(r.key)) continue;
      if (inc.length || exc.length) {
        const hay = u.tags[r.key] ? `${r.search} ${u.tags[r.key].join(" ")}` : r.search;
        if (inc.some((t) => !hay.includes(t)) || exc.some((t) => hay.includes(t))) continue;
      }
      if (flags.length && !flags.every((f) => f.test(r))) continue;
      modeCounts.set(r.mode, (modeCounts.get(r.mode) || 0) + 1);
      if (mode !== "all" && r.mode !== mode) continue;
      let mask = 0;
      for (let i = 0; i < nF; i++) if (this.pass(facets[i], r)) mask |= 1 << i;
      if (mask === ALL) res.push(r);
      for (let i = 0; i < nF; i++) {
        if ((mask | (1 << i)) !== ALL) continue;
        const f = facets[i];
        if (f.kind === "source") {
          const a = r.sourceGroup, b = `${a}::${r.source}`, c = `${b}::${r.collection}`;
          src.group.set(a, (src.group.get(a) || 0) + 1);
          src.source.set(b, (src.source.get(b) || 0) + 1);
          src.coll.set(c, (src.coll.get(c) || 0) + 1);
        } else for (const k of f.keys(r)) counts[f.id].set(k, (counts[f.id].get(k) || 0) + 1);
      }
    }
    res.sort((SORTS[this.state.sort] || SORTS.name)[1]);
    if (this.state.view === "recent") { const o = new Map(u.recent.map((k, i) => [k, i])); res.sort((a, b) => o.get(a.key) - o.get(b.key)); }
    this.results = res;
    this.counts = { counts, src };
    this.el.modes.querySelectorAll(".cl-mode").forEach((x) => {
      const m = x.dataset.mode;
      x.querySelector("em").textContent = (m === "all" ? [...modeCounts.values()].reduce((a, b) => a + b, 0) : modeCounts.get(m) || 0).toLocaleString();
    });
    this.renderSidebar();
    this.renderChips();
    this.el.list.innerHTML = "";
    this.shown = 0;
    this.el.main.scrollTop = 0;
    this.renderMore();
    this.el.count.textContent = `${res.length.toLocaleString()} result${res.length === 1 ? "" : "s"}`;
    this.app?.setCount?.(res.length);
    this.saveState();
    this._ms = Math.round(performance.now() - t0);
  }

  viewSet() {
    const u = userData(), v = this.state.view;
    if (v === "fav") return new Set(u.favorites);
    if (v === "recent") return new Set(u.recent);
    if (v === "hidden") return new Set(u.hidden);
    if (v.startsWith("coll:")) return new Set(u.collections[v.slice(5)] || []);
    return null;
  }

  // ───────────────────────────────── list
  renderMore() {
    if (!this.results || this.shown >= this.results.length) return;
    const fav = new Set(userData().favorites);
    const html = this.results.slice(this.shown, this.shown + PAGE).map((r) => this.rowHTML(r, fav.has(r.key))).join("");
    this.el.list.insertAdjacentHTML("beforeend", html);
    this.el.list.querySelectorAll("img:not([data-w])").forEach((img) => { img.dataset.w = 1; img.addEventListener("error", () => img.replaceWith(Object.assign(document.createElement("i"), { className: `cl-ico ${TYPE_ICON[this.byKey.get(img.closest("li").dataset.key)?.mode] || "fa-solid fa-book"}` })), { once: true }); });
    this.shown += PAGE;
  }
  rowHTML(r, isFav) {
    const icon = r.img && !/mystery-man|icons\/svg\/item-bag/.test(r.img) ? `<img src="${esc(r.img)}" alt="" loading="lazy">` : `<i class="cl-ico ${TYPE_ICON[r.mode]}"></i>`;
    const badge = r.origin === "5etools" ? `<span class="cl-badge vt" data-tooltip="From your 5e.tools copy">5e.tools</span>` : "";
    return `<li draggable="true" data-key="${esc(r.key)}" class="${r.origin}">
      ${icon}
      <div class="cl-row-text"><span class="cl-name">${esc(r.name)}</span><span class="cl-meta">${esc(r.meta)}</span></div>
      <span class="cl-src" data-tooltip="${esc(r.source)}${r.collection && r.collection !== r.source ? " › " + esc(r.collection) : ""}">${esc(shortSrc(r))}</span>${badge}
      <a class="cl-fav ${isFav ? "on" : ""}"><i class="fa-${isFav ? "solid" : "regular"} fa-star"></i></a></li>`;
  }
  toggleFav(key, li) {
    const u = userData();
    const i = u.favorites.indexOf(key);
    if (i >= 0) u.favorites.splice(i, 1); else u.favorites.unshift(key);
    saveUserData();
    const on = i < 0, a = li?.querySelector(".cl-fav");
    if (a) { a.classList.toggle("on", on); a.innerHTML = `<i class="fa-${on ? "solid" : "regular"} fa-star"></i>`; }
    if (this.state.view === "fav") this.refresh(); else this.renderViews();
  }
  pushRecent(key) {
    const u = userData();
    u.recent = [key, ...u.recent.filter((k) => k !== key)].slice(0, 100);
    saveUserData();
  }

  // ───────────────────────────────── detail
  async showDetail(r) {
    if (!r) return;
    this._detailKey = r.key;
    const d = this.el.detail;
    const facts = [];
    facts.push(["Source", `${esc(r.source)}${r.collection && r.collection !== r.source ? ` › ${esc(r.collection)}` : ""}`]);
    if (r.book && r.origin === "foundry") facts.push(["Book", esc(r.book)]);
    facts.push(["Edition", esc(r.edition || "5e")]);
    if (r.mode === "spell" && r.f.classes?.length) facts.push(["Classes", esc(r.f.classes.join(", "))]);
    if (r.mode === "item" && r.gp != null) facts.push(["Price", `${r.gp.toLocaleString()} gp`]);
    const actions = [];
    if (r.mode !== "creature") actions.push(`<button type="button" data-act="add"><i class="fa-solid fa-user-plus"></i> Add to ${esc(this.app.targetActorName() || "character")}</button>`);
    if (r.origin === "foundry") actions.push(`<button type="button" data-act="open"><i class="fa-solid fa-up-right-from-square"></i> Open</button>`);
    else if (game.user.isGM) actions.push(`<button type="button" data-act="import"><i class="fa-solid fa-file-import"></i> Import to world</button>`);
    d.innerHTML = `<header>${r.img ? `<img src="${esc(r.img)}" alt="">` : `<i class="cl-ico big ${TYPE_ICON[r.mode]}"></i>`}<div><h2>${esc(r.name)}</h2><p class="cl-meta">${esc(r.meta)}</p></div></header>
      <div class="cl-actions" draggable="true" data-key="${esc(r.key)}">${actions.join("")}<span class="cl-drag-handle" data-tooltip="Drag me onto a sheet"><i class="fa-solid fa-grip-vertical"></i></span></div>
      <dl class="cl-facts">${facts.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>
      <div class="cl-desc"><p class="cl-muted"><i class="fa-solid fa-spinner fa-spin"></i></p></div>`;
    const actEl = d.querySelector(".cl-actions");
    actEl.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-act]");
      if (!b) return;
      if (b.dataset.act === "add") this.app.addToActor(r);
      if (b.dataset.act === "open") this.app.openOrImport(r);
      if (b.dataset.act === "import") this.app.importToWorld(r);
    });
    actEl.addEventListener("dragstart", (e) => { const data = this.dragData(r); if (!data) return e.preventDefault(); e.dataTransfer.setData("text/plain", JSON.stringify(data)); });
    let html;
    try {
      if (r.origin === "foundry") {
        const doc = await fromUuid(r.uuid);
        html = await describeDoc(doc);
      } else html = render5eEntry(r.prop, await getVtEntry(r));
    } catch (e) { console.error(e); html = `<p class="cl-muted">Could not load the description.</p>`; }
    if (this._detailKey !== r.key) return;
    d.querySelector(".cl-desc").innerHTML = html;
  }

  // ───────────────────────────────── context menus
  onRowContext(e) {
    const li = e.target.closest("li[data-key]");
    if (!li) return;
    e.preventDefault();
    const r = this.byKey.get(li.dataset.key);
    const u = userData();
    const isFav = u.favorites.includes(r.key), isHidden = u.hidden.includes(r.key);
    const colls = Object.keys(u.collections).sort();
    const viewColl = this.state.view.startsWith("coll:") ? this.state.view.slice(5) : null;
    const items = [
      { icon: `fa-${isFav ? "solid" : "regular"} fa-star`, label: isFav ? "Remove from favourites" : "Add to favourites", act: () => this.toggleFav(r.key, li) },
      { icon: "fa-solid fa-folder-plus", label: "Add to collection", sub: [
        ...colls.map((c) => ({ label: c, act: () => { (u.collections[c] ??= []).includes(r.key) || u.collections[c].push(r.key); saveUserData(); this.renderViews(); } })),
        { icon: "fa-solid fa-plus", label: "New collection…", act: async () => { const n = await promptText("New collection", "Name", ""); if (!n) return; (u.collections[n] ??= []).push(r.key); saveUserData(); this.renderViews(); } },
      ] },
      viewColl && { icon: "fa-solid fa-folder-minus", label: `Remove from “${viewColl}”`, act: () => { u.collections[viewColl] = u.collections[viewColl].filter((k) => k !== r.key); saveUserData(); this.refresh(); } },
      { sep: true },
      { icon: "fa-solid fa-user-plus", label: `Add to ${this.app.targetActorName() || "character"}`, act: () => this.app.addToActor(r) },
      r.origin === "foundry" ? { icon: "fa-solid fa-up-right-from-square", label: "Open", act: () => this.app.openOrImport(r) }
        : game.user.isGM && { icon: "fa-solid fa-file-import", label: "Import to world", act: () => this.app.importToWorld(r) },
      game.user.isGM && game.modules.get("shared-homebrew")?.active && r.origin === "foundry" && !r.packId?.startsWith("shared-homebrew.homebrew") && { icon: "fa-solid fa-share-nodes", label: "Copy to Shared Library (all worlds)", act: () => this.app.shareRecords([r]) },
      r.origin === "foundry" && { icon: "fa-solid fa-link", label: "Copy @UUID link", act: () => { game.clipboard.copyPlainText(`@UUID[${r.uuid}]{${r.name}}`); ui.notifications.info("Link copied."); } },
      { sep: true },
      { icon: "fa-solid fa-tags", label: "Tags…", act: async () => { const v = await promptText("Tags", "Comma-separated — searchable", (u.tags[r.key] || []).join(", ")); if (v == null) return; const t = v.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean); if (t.length) u.tags[r.key] = t; else delete u.tags[r.key]; saveUserData(); this.refresh(); } },
      { icon: `fa-solid ${isHidden ? "fa-eye" : "fa-eye-slash"}`, label: isHidden ? "Unhide" : "Hide from library", act: () => { if (isHidden) u.hidden = u.hidden.filter((k) => k !== r.key); else u.hidden.push(r.key); saveUserData(); this.refresh(); } },
      { icon: "fa-solid fa-layer-group", label: `Show everything from ${shortSrc(r)}`, act: () => { this.clearFilters(false); this.sel("source").add(`${r.sourceGroup}::${r.source}`); this.state.expanded[`g:${r.sourceGroup}`] = true; this.refresh(); } },
    ].filter(Boolean);
    this.showMenu(items, e.clientX, e.clientY);
  }
  onSidebarContext(e) {
    const c = e.target.closest("[data-coll]");
    const p = e.target.closest("[data-pack]");
    if (!c && !p) return;
    e.preventDefault();
    if (p && game.user.isGM) {
      const packId = p.dataset.pack;
      const eds = ["5e (2024)", "5e (2014)", "4e", "3e / 3.5e", "AD&D 2e", "AD&D 1e", "OD&D / Basic", "Third-party"];
      return this.showMenu([{ icon: "fa-solid fa-clock-rotate-left", label: "Set edition for this compendium", sub: [
        ...eds.map((ed) => ({ label: ed, act: () => { userData().packEdition[packId] = ed; saveUserData(); this.app.reload(); } })),
        { icon: "fa-solid fa-rotate-left", label: "Automatic", act: () => { delete userData().packEdition[packId]; saveUserData(); this.app.reload(); } },
      ] },
      game.modules.get("shared-homebrew")?.active && !packId.startsWith("shared-homebrew.") && { icon: "fa-solid fa-share-nodes", label: "Copy this whole compendium to the Shared Library", act: () => this.app.shareRecords((this.items || []).filter((x) => x.packId === packId), { bulk: true }) },
      ].filter(Boolean), e.clientX, e.clientY);
    }
    if (!c) return;
    const name = c.dataset.coll;
    this.showMenu([
      { icon: "fa-solid fa-pen", label: "Rename…", act: async () => { const n = await promptText("Rename collection", "Name", name); if (!n || n === name) return; const u = userData(); u.collections[n] = u.collections[name]; delete u.collections[name]; saveUserData(); if (this.state.view === `coll:${name}`) this.state.view = `coll:${n}`; this.refresh(); } },
      { icon: "fa-solid fa-trash", label: "Delete collection", act: () => { delete userData().collections[name]; saveUserData(); if (this.state.view === `coll:${name}`) this.state.view = "all"; this.refresh(); } },
    ], e.clientX, e.clientY);
  }
  showMenu(items, x, y) {
    const m = this.el.menu;
    const html = (list, attr) => list.map((i, idx) => (i.sep ? "<hr>" : `<div class="cl-mi ${i.sub ? "has-sub" : ""}" ${attr}="${idx}"><i class="${i.icon || ""}"></i><span>${esc(i.label)}</span>${i.sub ? `<i class="fa-solid fa-caret-right"></i><div class="cl-sub">${html(i.sub, "data-s")}</div>` : ""}</div>`)).join("");
    m.innerHTML = html(items, "data-i");
    m.onclick = (e) => {
      const s = e.target.closest("[data-s]"), t = e.target.closest("[data-i]");
      if (s) { items[Number(s.parentElement.closest("[data-i]").dataset.i)].sub[Number(s.dataset.s)].act(); this.hideMenu(); }
      else if (t && !items[Number(t.dataset.i)].sub) { items[Number(t.dataset.i)].act(); this.hideMenu(); }
    };
    const host = this.root.getBoundingClientRect();
    m.classList.remove("hidden");
    m.style.left = `${Math.min(x - host.left, host.width - m.offsetWidth - 4)}px`;
    m.style.top = `${Math.min(y - host.top, host.height - m.offsetHeight - 4)}px`;
    m.classList.toggle("flip-sub", x - host.left + m.offsetWidth * 2 > host.width);
  }
  hideMenu() { this.el?.menu?.classList.add("hidden"); }

  // ───────────────────────────────── sidebar
  renderSidebar() { this.renderViews(); this.renderFlags(); const st = this.el.facets.scrollTop; this.el.facets.innerHTML = this.facets.map((f) => this.facetHTML(f)).join(""); this.el.facets.scrollTop = st; }
  renderViews() {
    const u = userData(), v = this.state.view;
    const n = (keys) => keys.filter((k) => this.byKey?.has(k)).length;
    const row = (id, icon, label, c, extra = "") => `<div class="cl-view ${v === id ? "active" : ""}" data-view="${esc(id)}" ${extra}><i class="${icon}"></i><span>${esc(label)}</span><em>${c}</em></div>`;
    const colls = Object.entries(u.collections).sort(([a], [b]) => a.localeCompare(b));
    this.el.views.innerHTML = row("all", "fa-solid fa-books", "Everything", (this.items?.length || 0).toLocaleString())
      + row("fav", "fa-solid fa-star", "Favourites", n(u.favorites)) + row("recent", "fa-solid fa-clock-rotate-left", "Recently used", n(u.recent))
      + `<div class="cl-subhead">My collections <a class="cl-new-coll" data-tooltip="New collection"><i class="fa-solid fa-plus"></i></a></div>`
      + (colls.length ? colls.map(([name, ks]) => row(`coll:${name}`, "fa-solid fa-folder", name, n(ks), `data-coll="${esc(name)}"`)).join("") : `<div class="cl-empty">Right-click any entry → Add to collection</div>`)
      + (u.hidden.length ? row("hidden", "fa-solid fa-eye-slash", "Hidden", n(u.hidden)) : "");
  }
  renderFlags() {
    this.el.flags.innerHTML = `<div class="cl-subhead">Quick filters</div>` + FLAGS.map((f) => `<label class="cl-flag"><input type="checkbox" data-flag="${f.id}" ${(this.state.flags[f.id] ?? f.default) ? "checked" : ""}><i class="${f.icon}"></i><span>${esc(f.label)}</span></label>`).join("");
  }
  facetHTML(f) {
    const open = this.state.open[f.id] ?? false;
    const nSel = f.kind === "source" ? this.sel("source").size + this.sel("coll").size + this.sel("sgroup").size : this.sel(f.id).size;
    let body = "";
    if (open) {
      if (f.kind === "source") body = this.sourceHTML();
      else {
        const m = this.counts.counts[f.id];
        let keys = [...m.keys()];
        for (const k of this.sel(f.id)) if (!m.has(k)) keys.push(k);
        if (f.order) keys = f.order.filter((k) => keys.includes(k)).concat(keys.filter((k) => !f.order.includes(k)).sort());
        else keys.sort((a, b) => (m.get(b) || 0) - (m.get(a) || 0) || a.localeCompare(b));
        body = keys.map((k) => this.optHTML(f.id, k, k, m.get(k) || 0, this.sel(f.id).has(k))).join("") || `<div class="cl-empty">Nothing here</div>`;
      }
    }
    return `<div class="cl-facet ${open ? "open" : ""}"><div class="cl-facet-head" data-toggle="${f.id}"><i class="fa-solid fa-caret-${open ? "down" : "right"}"></i><span>${esc(f.label)}</span>${nSel ? `<a class="cl-facet-clear" data-clear="${f.id}">${nSel} <i class="fa-solid fa-xmark"></i></a>` : ""}</div><div class="cl-facet-body">${body}</div></div>`;
  }
  optHTML(facet, key, label, n, on, cls = "", pre = "", attrs = "") {
    return `<div class="cl-opt ${on ? "checked" : ""} ${n ? "" : "zero"} ${cls}" data-facet="${facet}" data-key="${esc(key)}" ${attrs}>${pre}<i class="fa-${on ? "solid fa-square-check" : "regular fa-square"}"></i><span>${esc(label)}</span><em>${n.toLocaleString()}</em></div>`;
  }
  sourceHTML() {
    const tree = new Map();
    for (const r of this.items) {
      if (this.state.mode !== "all" && r.mode !== this.state.mode) continue;
      const g = tree.get(r.sourceGroup) ?? tree.set(r.sourceGroup, new Map()).get(r.sourceGroup);
      const s = g.get(r.source) ?? g.set(r.source, new Map()).get(r.source);
      if (!s.has(r.collection)) s.set(r.collection, r.packId);
    }
    const { group, source, coll } = this.counts.src;
    const order = ["Shared Library", "Foundry: this world", "Foundry: modules", "Foundry: system", "5e.tools: official", "5e.tools: homebrew"];
    return [...tree.entries()].sort(([a], [b]) => (order.indexOf(a) + 1 || 9) - (order.indexOf(b) + 1 || 9)).map(([g, sources]) => {
      const ge = this.state.expanded[`g:${g}`];
      const exp = (k, on) => `<a class="cl-exp" data-exp="${esc(k)}"><i class="fa-solid fa-caret-${on ? "down" : "right"}"></i></a>`;
      let out = this.optHTML("sgroup", g, g, group.get(g) || 0, this.sel("sgroup").has(g), "cl-group", exp(`g:${g}`, ge));
      if (ge) {
        out += `<div class="cl-children">` + [...sources.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([s, colls]) => {
          const sk = `${g}::${s}`;
          const se = this.state.expanded[`s:${sk}`];
          const many = colls.size > 1;
          let o = this.optHTML("source", sk, s, source.get(sk) || 0, this.sel("source").has(sk), "", many ? exp(`s:${sk}`, se) : `<span class="cl-exp-pad"></span>`,
            !many && [...colls.values()][0] ? `data-pack="${esc([...colls.values()][0])}"` : "");
          if (many && se) o += `<div class="cl-children">` + [...colls.entries()].sort(([a], [b]) => String(a).localeCompare(String(b))).map(([c, packId]) => {
            const ck = `${sk}::${c}`;
            return this.optHTML("coll", ck, c, coll.get(ck) || 0, this.sel("coll").has(ck), "", "", packId ? `data-pack="${esc(packId)}"` : "");
          }).join("") + `</div>`;
          return o;
        }).join("") + `</div>`;
      }
      return out;
    }).join("");
  }
  onSidebarClick(e) {
    const t = e.target;
    const exp = t.closest("[data-exp]");
    if (exp) { e.stopPropagation(); const k = exp.dataset.exp; this.state.expanded[k] = !this.state.expanded[k]; this.renderSidebar(); this.saveState(); return; }
    const clr = t.closest("[data-clear]");
    if (clr) { e.stopPropagation(); if (clr.dataset.clear === "source") ["source", "coll", "sgroup"].forEach((k) => this.sel(k).clear()); else this.sel(clr.dataset.clear).clear(); this.refresh(); return; }
    const tog = t.closest("[data-toggle]");
    if (tog) { const id = tog.dataset.toggle; this.state.open[id] = !this.state.open[id]; this.renderSidebar(); this.saveState(); return; }
    const opt = t.closest(".cl-opt");
    if (opt) {
      const facet = opt.dataset.facet, key = opt.dataset.key, set = this.sel(facet);
      const additive = e.ctrlKey || e.metaKey || e.shiftKey || t.closest(".fa-square, .fa-square-check");
      if (set.has(key)) set.delete(key);
      else {
        if (!additive) { if (["source", "coll", "sgroup"].includes(facet)) ["source", "coll", "sgroup"].forEach((k) => this.sel(k).clear()); else set.clear(); }
        set.add(key);
      }
      return this.refresh();
    }
    const flag = t.closest("[data-flag]");
    if (flag && t.tagName === "INPUT") { this.state.flags[flag.dataset.flag] = t.checked; return this.refresh(); }
    if (t.closest(".cl-new-coll")) return promptText("New collection", "Name", "").then((n) => { if (!n) return; userData().collections[n] ??= []; saveUserData(); this.state.view = `coll:${n}`; this.refresh(); });
    const view = t.closest("[data-view]");
    if (view) { this.state.view = view.dataset.view; this.refresh(); }
  }
  clearFilters(refresh = true) {
    for (const k of Object.keys(this.state.sel)) this.sel(k).clear();
    this.state.view = "all";
    this.state.q = "";
    if (this.el?.search) this.el.search.value = "";
    if (refresh) this.refresh();
  }
  renderChips() {
    const chips = [];
    const v = this.state.view;
    if (v !== "all") chips.push({ k: "view", v, t: v === "fav" ? "Favourites" : v === "recent" ? "Recently used" : v === "hidden" ? "Hidden" : `Collection: ${v.slice(5)}` });
    for (const [k, set] of Object.entries(this.state.sel)) for (const x of set) {
      const label = this.facets.find((f) => f.id === k)?.label;
      chips.push({ k, v: x, t: ["source", "coll", "sgroup"].includes(k) ? x.split("::").slice(-1)[0] : `${label ? label + ": " : ""}${x}` });
    }
    this.el.chips.innerHTML = chips.map((c) => `<span class="cl-chip" data-k="${esc(c.k)}" data-v="${esc(c.v)}">${esc(c.t)} <i class="fa-solid fa-xmark"></i></span>`).join("") + (chips.length > 1 ? `<a class="cl-chip cl-clear-all" data-k="all">Clear all</a>` : "");
    this.el.chips.classList.toggle("empty", !chips.length);
  }
  onChip(e) {
    const c = e.target.closest(".cl-chip");
    if (!c) return;
    if (c.dataset.k === "all") return this.clearFilters();
    if (c.dataset.k === "view") this.state.view = "all"; else this.sel(c.dataset.k).delete(c.dataset.v);
    this.refresh();
  }
}

function shortSrc(r) {
  if (r.origin === "5etools") return r.vtSource;
  return r.book || r.collection || r.source;
}

async function describeDoc(doc) {
  if (!doc) return `<p class="cl-muted">Not found.</p>`;
  const TE = foundry.applications.ux.TextEditor.implementation;
  if (doc.documentName === "Actor") {
    const sys = doc.system;
    const feats = doc.items.filter((i) => ["feat", "weapon", "spell"].includes(i.type)).map((i) => i.name);
    const bio = sys.details?.biography?.value ? await TE.enrichHTML(sys.details.biography.value, { relativeTo: doc }) : "";
    return `<dl class="cl-stats"><dt>AC</dt><dd>${sys.attributes?.ac?.value ?? "—"}</dd><dt>HP</dt><dd>${sys.attributes?.hp?.max ?? "—"}</dd></dl>
      ${feats.length ? `<h4>Features & attacks</h4><p>${feats.map(esc).join(", ")}</p>` : ""}${bio}`;
  }
  const desc = doc.system?.description?.value || "";
  return desc ? await TE.enrichHTML(desc, { relativeTo: doc, secrets: doc.isOwner }) : `<p class="cl-muted">No description.</p>`;
}

export async function promptText(title, label, value) {
  let out = null;
  try {
    await foundry.applications.api.DialogV2.prompt({
      window: { title },
      content: `<div class="form-group"><label>${esc(label)}</label><div class="form-fields"><input type="text" name="v" value="${esc(value)}" autofocus></div></div>`,
      ok: { callback: (event, button) => { out = button.form.elements.v.value.trim(); } },
      rejectClose: false,
    });
  } catch { return null; }
  return out;
}
export { metaLine };
