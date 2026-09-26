/**
 * Compendium Library — the data layer.
 *
 * Two kinds of record live side by side in one list:
 *   • Foundry documents — every Item and Actor compendium this world can see (system packs,
 *     your own modules, older-edition conversions, Plutonium imports) plus world Items/Actors.
 *     Indexed with pack.getIndex({fields}) so nothing heavy is loaded until you look at it.
 *   • 5e.tools entries — from a compact list the GM's browser builds out of the 5e.tools copy
 *     in the Data folder (official, prerelease and homebrew) and saves to
 *     Data/compendium-library-data. Dropping one imports it through Plutonium.
 */
export const MODULE_ID = "compendium-library";
export const SHARED_ID = "shared-homebrew";
/** Folder (inside Foundry's Data folder) that holds the 5e.tools copy. Set in the module settings. */
export const vtRoot = () => String(game.settings.get(MODULE_ID, "vtRoot") || "5etools").replace(/^\/+|\/+$/g, "");
const VT_INDEX_DIR = "compendium-library-data";
const VT_INDEX_FILE = "vetools-index.json";
const DATA_DIR = "compendium-library-data";
const USER_FILE = "library-user.json";

export const MODES = {
  spell: { label: "Spells", icon: "fa-solid fa-wand-sparkles" },
  item: { label: "Items", icon: "fa-solid fa-shield-halved" },
  feature: { label: "Feats & Features", icon: "fa-solid fa-star" },
  option: { label: "Classes & Origins", icon: "fa-solid fa-user-plus" },
  creature: { label: "Creatures", icon: "fa-solid fa-dragon" },
};
export const MODE_ORDER = ["spell", "item", "feature", "option", "creature"];

const L = (obj, k) => {
  const v = obj?.[k];
  if (v == null) return k ? String(k) : null;
  const label = typeof v === "string" ? v : v.label ?? v.name ?? k;
  return game.i18n.localize(label);
};
const title = (s) => (s ? String(s).replace(/\b\w/g, (c) => c.toUpperCase()) : s);

// ───────────────────────────────────────────── editions ──
// Content converted from older editions is recognised by its pack or module name. You can
// also set a pack's edition by right-clicking its row in the Source filter.
const OLD_EDITIONS = [
  ["OD&D / Basic", /\b(od&d|odnd|becmi|b\/x|bx|basic d&d|holmes|rules cyclopedia)\b/i],
  ["AD&D 1e", /\b(ad&d ?1e|1st edition|first edition|1e)\b/i],
  ["AD&D 2e", /\b(ad&d ?2e|ad&d|2nd edition|second edition|2e)\b/i],
  ["3e / 3.5e", /\b(3\.5e?|3e|3rd edition|third edition|d20)\b/i],
  ["4e", /\b(4e|4th edition|fourth edition)\b/i],
];
function editionFromText(txt) {
  for (const [ed, re] of OLD_EDITIONS) if (re.test(txt)) return ed;
  return null;
}

// ───────────────────────────────────────────── user data ──
let _user = null;
const EMPTY = () => ({ v: 1, favorites: [], recent: [], collections: {}, tags: {}, hidden: [], packEdition: {} });
export async function loadUserData() {
  if (_user) return _user;
  _user = EMPTY();
  try {
    const res = await fetch(`${DATA_DIR}/${USER_FILE}?t=${Date.now()}`, { cache: "no-store" });
    if (res.ok) _user = Object.assign(EMPTY(), await res.json());
    else {
      const local = game.settings.get(MODULE_ID, "userDataFallback");
      if (local?.v) _user = Object.assign(EMPTY(), local);
    }
  } catch (e) { console.warn(`${MODULE_ID} | user data`, e); }
  return _user;
}
export const userData = () => _user ?? EMPTY();
const _save = foundry.utils.debounce(async () => {
  const data = JSON.stringify(_user);
  if (game.user.isGM) {
    try {
      const FP = foundry.applications.apps.FilePicker.implementation;
      try { await FP.createDirectory("data", DATA_DIR); } catch { /* exists */ }
      await FP.upload("data", DATA_DIR, new File([data], USER_FILE, { type: "application/json" }), {}, { notify: false });
      return;
    } catch (e) { console.warn(`${MODULE_ID} | falling back to client storage`, e); }
  }
  await game.settings.set(MODULE_ID, "userDataFallback", JSON.parse(data));
}, 800);
export const saveUserData = () => _save();

// ───────────────────────────────────────────── Foundry side ──
const ITEM_FIELDS = [
  "img", "type", "folder",
  "system.level", "system.school", "system.properties", "system.activation.type", "system.source",
  "system.rarity", "system.attunement", "system.type", "system.price", "system.activities",
  "system.prerequisites.level", "system.requirements", "system.classIdentifier", "system.identifier",
  "flags.plutonium.spellClassNames", "flags.plutonium.source",
];
const ACTOR_FIELDS = [
  "img", "type", "system.details.cr", "system.details.type", "system.traits.size", "system.details.environment",
  "system.source", "system.details.source", "flags.plutonium.source",
];

const EQUIP_TYPE = { light: "Armor", medium: "Armor", heavy: "Armor", natural: "Armor", shield: "Shield", clothing: "Clothing",
  trinket: "Trinket", ring: "Ring", rod: "Rod", wand: "Wand", wondrous: "Wondrous Item", vehicle: "Vehicle Equipment" };
const CONSUMABLE_TYPE = { potion: "Potion", scroll: "Scroll", ammo: "Ammunition", poison: "Poison", food: "Food & Drink",
  wand: "Wand", rod: "Rod", trinket: "Trinket" };
const LOOT_TYPE = { gem: "Treasure", art: "Treasure", treasure: "Treasure", material: "Trade Good", resource: "Trade Good", junk: "Other" };

function itemTypeFoundry(e) {
  const tv = e.system?.type?.value;
  switch (e.type) {
    case "weapon": return "Weapon";
    case "equipment": return EQUIP_TYPE[tv] || "Wondrous Item";
    case "consumable": return CONSUMABLE_TYPE[tv] || "Consumable";
    case "tool": return "Tool";
    case "loot": return LOOT_TYPE[tv] || "Treasure";
    case "container": return "Container";
    default: return title(e.type);
  }
}
const RARITY_ORDER = ["Mundane", "Common", "Uncommon", "Rare", "Very Rare", "Legendary", "Artifact", "Varies", "Unknown"];
function rarityLabel(r) {
  if (!r) return "Mundane";
  const cfg = CONFIG.DND5E?.itemRarity?.[r];
  return title(cfg ? game.i18n.localize(cfg) : r.replace(/([a-z])([A-Z])/g, "$1 $2"));
}
function priceBand(gp) {
  if (gp == null || !isFinite(gp)) return "Unknown";
  if (gp <= 0) return "Free";
  if (gp < 10) return "Under 10 gp";
  if (gp < 100) return "10–99 gp";
  if (gp < 1000) return "100–999 gp";
  if (gp < 10000) return "1,000–9,999 gp";
  if (gp < 50000) return "10,000–49,999 gp";
  return "50,000 gp +";
}
function toGp(price) {
  if (!price || price.value == null) return null;
  const rate = { pp: 10, gp: 1, ep: 0.5, sp: 0.1, cp: 0.01 }[price.denomination || "gp"] ?? 1;
  return Number(price.value) * rate;
}
export function spellLevelLabel(l) {
  if (l == null) return "Unknown";
  if (Number(l) === 0) return "Cantrip";
  const n = Number(l);
  return Number.isInteger(n) && n >= 1 && n <= 9 ? `Level ${n}` : "Other";
}
export function crBucket(cr) {
  if (cr == null || cr === "") return "Unknown";
  const v = typeof cr === "number" ? cr : (() => { const m = String(cr).match(/^(\d+)(?:\/(\d+))?$/); return m ? (m[2] ? m[1] / m[2] : Number(m[1])) : NaN; })();
  if (!isFinite(v)) return "Unknown";
  if (v < 1) return "CR 0–½"; if (v <= 4) return "CR 1–4"; if (v <= 10) return "CR 5–10"; if (v <= 16) return "CR 11–16"; return "CR 17 +";
}
function crText(cr) {
  if (cr == null) return null;
  if (cr === 0.125) return "1/8"; if (cr === 0.25) return "1/4"; if (cr === 0.5) return "1/2";
  return String(cr);
}
function modeOfFoundry(docName, type) {
  if (docName === "Actor") return type === "npc" || type === "character" || type === "vehicle" ? "creature" : null;
  if (type === "spell") return "spell";
  if (["weapon", "equipment", "consumable", "tool", "loot", "container"].includes(type)) return "item";
  if (type === "feat") return "feature";
  if (["class", "subclass", "background", "race"].includes(type)) return "option";
  return null;
}
const OPTION_KIND = { class: "Class", subclass: "Subclass", background: "Background", race: "Species" };

function foundryRecord(e, { docName, uuid, sourceGroup, source, collection, packId, packEdition }) {
  const mode = modeOfFoundry(docName, e.type);
  if (!mode) return null;
  const sys = e.system ?? {};
  const book = sys.source?.book || sys.details?.source?.book || e.flags?.plutonium?.source || null;
  const rules = sys.source?.rules;
  const edition = packEdition || (rules === "2024" ? "5e (2024)" : rules === "2014" ? "5e (2014)" : null) || "5e";
  const r = {
    key: uuid, uuid, origin: "foundry", docName, type: e.type, mode, name: e.name, img: e.img,
    sourceGroup, source, collection, packId, edition, book, f: {},
  };
  const f = r.f;
  if (mode === "spell") {
    f.level = spellLevelLabel(sys.level);
    f.school = L(CONFIG.DND5E?.spellSchools, sys.school) ?? "Unknown";
    const props = new Set(sys.properties ?? []);
    f.tags = [];
    if (props.has("concentration")) f.tags.push("Concentration");
    if (props.has("ritual")) f.tags.push("Ritual");
    if (props.has("vocal")) f.tags.push("Verbal");
    if (props.has("somatic")) f.tags.push("Somatic");
    if (props.has("material")) f.tags.push("Material");
    const act = sys.activation?.type;
    f.time = act ? ({ action: "Action", bonus: "Bonus Action", reaction: "Reaction", minute: "1 Minute +", hour: "1 Minute +" }[act] || "Other") : "Unknown";
    const dmg = new Set();
    for (const a of Object.values(sys.activities ?? {})) for (const p of a?.damage?.parts ?? []) for (const t of p.types ?? []) dmg.add(t);
    f.damage = [...dmg].map((t) => L(CONFIG.DND5E?.damageTypes, t));
    const lists = [];
    try { for (const l of globalThis.dnd5e?.registry?.spellLists?.forSpell?.(uuid) ?? []) if (l.type === "class") lists.push(l.name); } catch { /* registry not ready */ }
    f.classes = lists.length ? lists : (e.flags?.plutonium?.spellClassNames ?? []);
  } else if (mode === "item") {
    f.itype = itemTypeFoundry(e);
    f.rarity = rarityLabel(sys.rarity);
    f.attune = sys.attunement === "required" ? "Requires attunement" : sys.attunement === "optional" ? "Optional attunement" : "No attunement";
    const props = new Set(sys.properties ?? []);
    f.magical = props.has("mgc") || (sys.rarity && sys.rarity !== "") ? "Magical" : "Mundane";
    f.price = priceBand(toGp(sys.price));
    r.gp = toGp(sys.price);
  } else if (mode === "feature") {
    const tv = sys.type?.value;
    const cfg = CONFIG.DND5E?.featureTypes?.[tv];
    f.ftype = cfg ? game.i18n.localize(cfg.label) : title(tv || "Feature");
    const st = sys.type?.subtype;
    if (st && cfg?.subtypes?.[st]) f.fsub = game.i18n.localize(cfg.subtypes[st]);
    f.plevel = sys.prerequisites?.level ? `Level ${sys.prerequisites.level}+` : "None";
  } else if (mode === "option") {
    f.okind = OPTION_KIND[e.type] || title(e.type);
    if (e.type === "subclass") f.parent = title(sys.classIdentifier || "");
  } else if (mode === "creature") {
    if (e.type === "character") f.ctype = "Player Character";
    else if (e.type === "vehicle") f.ctype = "Vehicle";
    else f.ctype = L(CONFIG.DND5E?.creatureTypes, sys.details?.type?.value) ?? "Unknown";
    const cr = sys.details?.cr;
    f.cr = crBucket(cr);
    r.cr = typeof cr === "number" ? cr : null;
    r.crText = crText(cr);
    f.size = L(CONFIG.DND5E?.actorSizes, sys.traits?.size) ?? "Unknown";
    f.env = (sys.details?.environment || "").split(/[,;]/).map((s) => title(s.trim())).filter(Boolean);
  }
  return r;
}

function packMeta(pack) {
  const pkgId = pack.metadata.packageName;
  const type = pack.metadata.packageType;
  let group, source;
  if (type === "system") { group = "Foundry: system"; source = `${game.system.title}`; }
  else if (type === "world") { group = "Foundry: this world"; source = game.world.title; }
  else { group = "Foundry: modules"; source = game.modules.get(pkgId)?.title || pkgId; }
  if (pkgId === "plutonium" || /plutonium|srd5e/i.test(pack.metadata.name)) group = "Foundry: this world";
  if (pkgId === SHARED_ID) { group = "Shared Library"; source = pack.metadata.name.startsWith("homebrew") ? "Your homebrew" : "Imported (all worlds)"; }
  return { group, source };
}

// ── persistent per-pack cache (IndexedDB): a pack is only re-read when its content changes
const IDB_NAME = "compendium-library-cache";
let _db = null;
function idb() {
  if (_db) return _db;
  _db = new Promise((res) => {
    try {
      const rq = indexedDB.open(IDB_NAME, 1);
      rq.onupgradeneeded = () => rq.result.createObjectStore("packs");
      rq.onsuccess = () => res(rq.result);
      rq.onerror = () => res(null);
    } catch { res(null); }
  });
  return _db;
}
async function idbGet(key) {
  const db = await idb(); if (!db) return null;
  return new Promise((res) => { try { const rq = db.transaction("packs").objectStore("packs").get(key); rq.onsuccess = () => res(rq.result ?? null); rq.onerror = () => res(null); } catch { res(null); } });
}
async function idbSet(key, val) {
  const db = await idb(); if (!db) return;
  try { db.transaction("packs", "readwrite").objectStore("packs").put(val, key); } catch { /* quota or private mode */ }
}
export async function dropPackCache(collection) {
  const db = await idb(); if (!db) return;
  try { const st = db.transaction("packs", "readwrite").objectStore("packs"); collection ? st.delete(collection) : st.clear(); } catch { /* ignore */ }
}
const CACHE_VERSION = 2;
function packSignature(pack, packEdition) {
  const pkg = pack.metadata.packageType === "system" ? game.system : pack.metadata.packageType === "world" ? game.world : game.modules.get(pack.metadata.packageName);
  return [CACHE_VERSION, game.system.version, pkg?.version ?? "", pack.index?.size ?? 0, packEdition ?? "", game.i18n.lang].join("|");
}

async function indexPack(pack, u) {
  const { group, source } = packMeta(pack);
  const packEdition = u.packEdition[pack.collection]
    || editionFromText(`${pack.metadata.label} ${source} ${pack.metadata.packageName}`);
  const sig = packSignature(pack, packEdition);
  const cached = await idbGet(pack.collection);
  if (cached?.sig === sig) return cached.records;
  let fields = pack.documentName === "Item" ? ITEM_FIELDS : ACTOR_FIELDS;
  // activities are heavy; only spell packs need them (for the damage-type filter)
  if (pack.documentName === "Item" && ![...(pack.index?.values?.() ?? [])].some((e) => e.type === "spell")) fields = fields.filter((f) => f !== "system.activities");
  const index = await pack.getIndex({ fields });
  const records = [];
  for (const e of index) {
    const r = foundryRecord(e, {
      docName: pack.documentName, uuid: e.uuid ?? `Compendium.${pack.collection}.${pack.documentName}.${e._id}`,
      sourceGroup: group, source, collection: pack.metadata.label, packId: pack.collection, packEdition,
    });
    if (r) records.push(r);
  }
  idbSet(pack.collection, { sig, records });
  return records;
}

async function indexFoundry(progress) {
  const out = [];
  const u = userData();
  const packs = game.packs.filter((p) => ["Item", "Actor"].includes(p.documentName)
    && (!p.metadata.system || p.metadata.system === game.system.id) && p.visible);
  let done = 0;
  const queue = [...packs];
  const worker = async () => {
    while (queue.length) {
      const pack = queue.shift();
      try { out.push(...await indexPack(pack, u)); }
      catch (e) { console.warn(`${MODULE_ID} | could not index ${pack.collection}`, e); }
      progress?.(`Reading compendiums… ${++done}/${packs.length}`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(8, packs.length) }, worker));
  // world documents (read the stored data directly — no deep copies of embedded items)
  for (const [coll, docName] of [[game.items, "Item"], [game.actors, "Actor"]]) {
    for (const d of coll ?? []) {
      if (!d.testUserPermission(game.user, "OBSERVER")) continue;
      const r = foundryRecord(d._source, { docName, uuid: d.uuid, sourceGroup: "Foundry: this world",
        source: `World ${docName === "Item" ? "items" : "actors"}`, collection: d.folder?.name || "(no folder)", packId: null,
        packEdition: u.packEdition[`world.${docName}`] || null });
      if (r) out.push(r);
    }
  }
  return out;
}

// ───────────────────────────────────────────── 5e.tools side ──
const VT_MODE = { spell: "spell", item: "item", baseitem: "item", magicvariant: "item", feat: "feature", optionalfeature: "feature",
  class: "option", subclass: "option", background: "option", race: "option", monster: "creature" };
export const VT_PAGE = { spell: "spells.html", item: "items.html", baseitem: "items.html", magicvariant: "items.html", feat: "feats.html",
  optionalfeature: "optionalfeatures.html", class: "classes.html", background: "backgrounds.html", race: "races.html",
  monster: "bestiary.html" };
const enc = (s) => encodeURIComponent(String(s).toLowerCase()).toLowerCase();
export const vtHash = (name, source) => `${enc(name)}_${enc(source)}`;

// ── the 5e.tools list is built in the browser from the copy in the Data folder (GM only),
// saved next to the user data, and read by everyone. It is rebuilt when the copy changes.
let _vtIndex = null;
async function fetchJson(url) {
  try { const r = await fetch(foundry.utils.getRoute(url), { cache: "no-cache" }); return r.ok ? await r.json() : null; } catch { return null; }
}
/** A short fingerprint of the 5e.tools copy: its version plus the homebrew/prerelease file lists. */
async function vtSignature() {
  const root = vtRoot();
  const ch = await fetchJson(`${root}/data/changelog.json`);
  if (!ch) return null;
  const last = Array.isArray(ch) ? ch[ch.length - 1]?.ver ?? ch.length : "?";
  const lists = await Promise.all(["homebrew", "prerelease"].map(async (d) => (await fetchJson(`${root}/${d}/index.json`))?.toImport ?? []));
  return `${root}|${last}|${lists.map((l) => `${l.length}:${l.join(",").length}`).join("|")}`;
}
export async function buildVtIndexNow(progress) {
  const { buildVtIndex } = await import("./vt-index-core.js");
  const root = vtRoot();
  const sig = await vtSignature();
  if (!sig) throw new Error(`No 5e.tools copy found at Data/${root}`);
  const idx = await buildVtIndex((p) => fetchJson(`${root}/${p}`), progress);
  idx.sig = sig;
  if (game.user.isGM) {
    const FP = foundry.applications.apps.FilePicker.implementation;
    try { await FP.createDirectory("data", VT_INDEX_DIR); } catch { /* exists */ }
    await FP.upload("data", VT_INDEX_DIR, new File([JSON.stringify(idx)], VT_INDEX_FILE, { type: "application/json" }), {}, { notify: false });
  }
  _vtIndex = idx;
  return idx;
}
async function loadVtIndex(progress) {
  if (_vtIndex) return _vtIndex;
  const saved = await fetchJson(`${VT_INDEX_DIR}/${VT_INDEX_FILE}`);
  if (!game.user.isGM) return (_vtIndex = saved);
  const sig = await vtSignature();
  if (!sig) return (_vtIndex = saved);          // no copy in the Data folder: use what was built before, if anything
  if (saved?.sig === sig) return (_vtIndex = saved);
  try {
    progress?.("Building the 5e.tools list (first time only)…");
    return await buildVtIndexNow(progress);
  } catch (e) {
    console.warn(`${MODULE_ID} | could not build the 5e.tools list`, e);
    return (_vtIndex = saved);
  }
}
export function forgetVtIndex() { _vtIndex = null; }

async function index5etools(progress) {
  const idx = await loadVtIndex(progress);
  if (!idx) return [];
  const K = Object.fromEntries(idx.keys.map((k, i) => [k, i]));
  const d = idx.dict;
  const g = (row, k) => { const v = row[K[k]]; if (v == null) return null; if (Array.isArray(v)) return v.map((x) => d[k]?.[x] ?? x); return d[k] && typeof v === "number" && !["lv", "pr", "b", "mg"].includes(k) ? d[k][v] : v; };
  const out = [];
  for (const row of idx.rows) {
    const prop = g(row, "p");
    const mode = VT_MODE[prop];
    if (!mode) continue;
    const name = row[K.n];
    const src = g(row, "s");
    const sm = idx.sources[src] || {};
    const brew = !!row[K.b];
    const r = {
      key: `vt:${prop}:${src}:${name}`, origin: "5etools", prop, mode, name, img: null,
      sourceGroup: brew ? "5e.tools: homebrew" : "5e.tools: official",
      source: sm.full ? (brew ? sm.full : `${sm.full}`) : src, collection: brew ? (sm.author || "Homebrew") : src,
      vtSource: src, file: g(row, "f"), edition: sm.ed || (brew ? "Third-party" : "5e (2014)"), book: src, f: {},
      page: VT_PAGE[prop], hash: vtHash(name, src),
    };
    const f = r.f;
    if (mode === "spell") {
      f.level = spellLevelLabel(row[K.lv]);
      f.school = g(row, "sc") || "Unknown";
      f.tags = g(row, "tg") || [];
      f.time = g(row, "ct") || "Unknown";
      f.damage = g(row, "dm") || [];
      f.classes = g(row, "cl") || [];
    } else if (mode === "item") {
      f.itype = g(row, "it") || "Other";
      f.rarity = g(row, "ra") || "Mundane";
      f.attune = g(row, "at") || "No attunement";
      f.magical = row[K.mg] ? "Magical" : "Mundane";
      r.gp = row[K.pr];
      f.price = priceBand(row[K.pr]);
    } else if (mode === "feature") {
      f.ftype = g(row, "ft") || "Feature";
      f.plevel = g(row, "pl") || "None";
    } else if (mode === "option") {
      f.okind = g(row, "ko") || "Option";
      if (prop === "subclass") f.parent = g(row, "sub");
    } else if (mode === "creature") {
      f.ctype = g(row, "ty") || "Unknown";
      f.cr = g(row, "crb") || "Unknown";
      r.crText = g(row, "cr");
      r.cr = (() => { const m = String(r.crText ?? "").match(/^(\d+)(?:\/(\d+))?$/); return m ? (m[2] ? m[1] / m[2] : Number(m[1])) : null; })();
      f.size = g(row, "sz") || "Unknown";
      f.env = g(row, "env") || [];
    }
    r.canImport = prop !== "subclass";
    out.push(r);
  }
  return out;
}

/** Fetch the full 5e.tools entry for a record (for descriptions). */
const _fileCache = new Map();
export async function getVtEntry(r) {
  if (!_fileCache.has(r.file)) _fileCache.set(r.file, foundry.utils.fetchJsonWithTimeout(foundry.utils.getRoute(`${vtRoot()}/${r.file}`)).catch(() => null));
  const json = await _fileCache.get(r.file);
  const list = json?.[r.prop] || [];
  const found = list.find((e) => e.name === r.name && (e.source ?? e.inherits?.source) === r.vtSource);
  if (found?.inherits) return { ...found.inherits, ...found, entries: found.entries || found.inherits.entries };
  if (!found?._copy) return found;
  const base = list.find((e) => e.name === found._copy.name && e.source === found._copy.source);
  return base ? { ...base, ...found, _copy: undefined } : found;
}

// ───────────────────────────────────────────── combined ──
let _cache = null;
let _loading = null;
export function invalidate() { _cache = null; }

export async function getRecords({ progress } = {}) {
  if (_cache) return _cache;
  if (_loading) return _loading;
  _loading = (async () => {
    const t0 = performance.now();
    await loadUserData();
    const [fo, vt] = await Promise.all([indexFoundry(progress), game.settings.get(MODULE_ID, "show5etools") ? index5etools(progress) : []]);
    // mark 5e.tools entries that already exist in Foundry (same mode + name)
    const have = new Set(fo.map((r) => `${r.mode}|${r.name.toLowerCase()}`));
    for (const r of vt) r.inFoundry = have.has(`${r.mode}|${r.name.toLowerCase()}`);
    markFoundryDuplicates(fo);
    const all = [...fo, ...vt];
    for (const r of all) finish(r);
    const coll = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });
    all.sort((a, b) => coll.compare(a.name, b.name));
    console.log(`${MODULE_ID} | ${fo.length} Foundry + ${vt.length} 5e.tools records in ${Math.round(performance.now() - t0)} ms`);
    _cache = all;
    _loading = null;
    return all;
  })();
  return _loading;
}

// The same entry often lives in several places (a world pack, the shared library, a module).
// Keep the best copy visible and mark the rest so the duplicate filter can hide them.
function dupRank(r) {
  if (r.packId?.startsWith(`${SHARED_ID}.homebrew`)) return 0;
  if (!r.packId) return 1;
  if (r.sourceGroup === "Foundry: this world") return 2;
  if (r.packId.startsWith(`${SHARED_ID}.`)) return 3;
  if (r.sourceGroup === "Foundry: modules") return 4;
  return 5;
}
function markFoundryDuplicates(fo) {
  const best = new Map();
  for (const r of fo) {
    const k = `${r.mode}|${r.name.toLowerCase()}|${(r.book || "").toLowerCase()}|${r.edition}`;
    r._dk = k;
    const cur = best.get(k);
    if (!cur || dupRank(r) < dupRank(cur)) best.set(k, r);
  }
  for (const r of fo) { r.dupOf = best.get(r._dk) !== r ? best.get(r._dk).key : null; delete r._dk; }
}

function finish(r) {
  const f = r.f;
  const facetText = Object.values(f).flat().filter(Boolean).join(" ");
  r.search = `${r.name} ${r.source} ${r.collection ?? ""} ${r.book ?? ""} ${facetText}`.toLowerCase();
  r.meta = metaLine(r);
}

export function metaLine(r) {
  const f = r.f;
  switch (r.mode) {
    case "spell": return [f.level, f.school, f.tags?.includes("Concentration") ? "C" : null, f.tags?.includes("Ritual") ? "R" : null].filter(Boolean).join(" · ");
    case "item": return [f.itype, f.rarity !== "Mundane" ? f.rarity : null, f.attune === "Requires attunement" ? "Attunement" : null].filter(Boolean).join(" · ");
    case "feature": return [f.ftype, f.fsub, f.plevel !== "None" ? f.plevel : null].filter(Boolean).join(" · ");
    case "option": return [f.okind, f.parent].filter(Boolean).join(" · ");
    case "creature": return [r.crText != null ? `CR ${r.crText}` : null, f.size !== "Unknown" ? f.size : null, f.ctype].filter(Boolean).join(" · ");
  }
  return "";
}

export { RARITY_ORDER, editionFromText };
