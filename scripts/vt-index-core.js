/**
 * Builds a compact, browsable index of a 5e.tools copy: official data, the prerelease
 * (Unearthed Arcana) folder and every homebrew file listed in homebrew/index.json.
 * Shared by the in-Foundry builder (scripts/vt-build.js) and the command-line tool.
 *
 * @param {(relPath:string)=>Promise<object|null>} J  reads a JSON file relative to the 5e.tools root, null if missing
 * @param {(msg:string)=>void} [progress]
 */
async function pmap(list, limit, fn, tick) {
  const out = new Array(list.length); let i = 0, done = 0;
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, async () => {
    while (i < list.length) { const k = i++; out[k] = await fn(list[k]); tick?.(++done); }
  }));
  return out;
}

export async function buildVtIndex(J, progress) {
  // ── source metadata
  const sources = {}; // abbr → {full, date, group, brew}
  for (const [file, prop] of [["data/books.json", "book"], ["data/adventures.json", "adventure"]]) {
    const j = await J(file); if (!j) continue;
    for (const b of j[prop] || []) sources[b.source || b.id] = { full: b.name, date: b.published || "", group: b.group || prop };
  }

  // Spell class lists
  const spellClasses = {}; // `${name}|${source}` → [class names]
  const sj = await J("data/spells/sources.json");
  if (sj) {
    for (const [src, spells] of Object.entries(sj)) {
      for (const [name, info] of Object.entries(spells)) {
        const k = `${name.toLowerCase()}|${src.toLowerCase()}`;
        const cls = new Set();
        for (const c of info.class || []) cls.add(c.name);
        for (const c of info.classVariant || []) cls.add(c.name);
        if (cls.size) spellClasses[k] = [...cls];
      }
    }
  }

  const ROWS = [];
  const dict = {};
  const di = (k, v) => { if (v == null || v === "") return -1; const d = (dict[k] ??= { list: [], map: new Map() }); if (!d.map.has(v)) { d.map.set(v, d.list.length); d.list.push(v); } return d.map.get(v); };

  // ── field helpers
  const SCHOOL = { A: "Abjuration", C: "Conjuration", D: "Divination", E: "Enchantment", V: "Evocation", I: "Illusion", N: "Necromancy", T: "Transmutation", P: "Psionic" };
  const SIZE = { T: "Tiny", S: "Small", M: "Medium", L: "Large", H: "Huge", G: "Gargantuan", V: "Varies" };
  const RARITY = (r) => (!r || r === "none" ? null : r === "unknown" || r === "unknown (magic)" ? "Unknown" : r.replace(/\b\w/g, (c) => c.toUpperCase()));
  const ITEM_TYPE = {
    M: "Weapon", R: "Weapon", A: "Ammunition", AF: "Ammunition", LA: "Armor", MA: "Armor", HA: "Armor", S: "Shield",
    P: "Potion", SC: "Scroll", WD: "Wand", RD: "Rod", RG: "Ring", G: "Adventuring Gear", AT: "Tool", INS: "Tool", GS: "Tool", T: "Tool",
    SCF: "Spellcasting Focus", TG: "Trade Good", "$": "Treasure", "$A": "Treasure", "$C": "Treasure", "$G": "Treasure",
    EXP: "Explosive", FD: "Food & Drink", MNT: "Mount & Vehicle", VEH: "Mount & Vehicle", SHP: "Mount & Vehicle", AIR: "Mount & Vehicle",
    SPC: "Mount & Vehicle", TAH: "Mount & Vehicle", MR: "Weapon", OTH: "Other", IDG: "Illegal Drug", TB: "Trade Good",
  };
  function itemType(it) {
    const t = (it.type || "").split("|")[0];
    if (ITEM_TYPE[t]) return ITEM_TYPE[t];
    if (it.wondrous) return "Wondrous Item";
    if (it.poison) return "Poison";
    if (it.staff) return "Staff";
    if (it.weapon || it.weaponCategory) return "Weapon";
    if (it.armor) return "Armor";
    return it.typeText ? "Other" : "Other";
  }
  function crOf(cr) {
    if (cr == null) return null;
    if (typeof cr === "object") cr = cr.cr;
    return String(cr);
  }
  function crBucket(cr) {
    if (cr == null) return null;
    const m = String(cr).match(/^\s*(\d+)\s*(?:\/\s*(\d+))?/);
    if (!m) return null;
    const v = m[2] ? Number(m[1]) / Number(m[2]) : Number(m[1]);
    if (!isFinite(v)) return null;
    if (v < 1) return "CR 0–½"; if (v <= 4) return "CR 1–4"; if (v <= 10) return "CR 5–10"; if (v <= 16) return "CR 11–16"; return "CR 17 +";
  }
  function monType(t) {
    if (!t) return null;
    const v = typeof t === "string" ? t : typeof t.type === "string" ? t.type : t.type?.choose?.[0];
    return v ? v[0].toUpperCase() + v.slice(1) : null;
  }
  function spellTime(s) {
    const t = s.time?.[0];
    if (!t) return null;
    const u = t.unit;
    if (u === "action") return "Action";
    if (u === "bonus") return "Bonus Action";
    if (u === "reaction") return "Reaction";
    if (u === "minute" || u === "hour") return t.number === 1 && u === "minute" ? "1 Minute" : "1 Minute +";
    return "Other";
  }
  function spellTags(s) {
    const tags = [];
    if (s.duration?.some((d) => d.concentration)) tags.push("Concentration");
    if (s.meta?.ritual) tags.push("Ritual");
    if (s.components?.v) tags.push("Verbal");
    if (s.components?.s) tags.push("Somatic");
    if (s.components?.m) tags.push(typeof s.components.m === "object" && s.components.m.consume ? "Material (consumed)" : "Material");
    return tags;
  }
  const FEAT_CAT = { G: "General feat", O: "Origin feat", FS: "Fighting Style feat", "FS:P": "Fighting Style feat", "FS:R": "Fighting Style feat", EB: "Epic Boon", D: "Dragonmark feat" };
  const OPT_TYPE = { EI: "Eldritch Invocation", MM: "Metamagic", MV: "Maneuver", "MV:B": "Maneuver", FS: "Fighting Style", "FS:F": "Fighting Style", "FS:P": "Fighting Style", "FS:R": "Fighting Style", "FS:B": "Fighting Style", AI: "Artificer Infusion", PB: "Pact Boon", AS: "Arcane Shot", "AS:V1-UA": "Arcane Shot", RN: "Rune Knight Rune", ED: "Elemental Discipline", OR: "Onomancy Resonant", AF: "Alchemical Formula", TT: "Traveler's Trick" };
  function prereqLevel(e) {
    const p = e.prerequisite?.find?.((x) => x.level);
    if (!p) return null;
    const l = typeof p.level === "object" ? p.level.level : p.level;
    return l ? `Level ${l}+` : null;
  }

  // ── row writers. Row = [prop, name, source, file, mode, facets...]
  function push(o) { ROWS.push(o); }

  function addSpell(s, file, brew) {
    const k = `${s.name.toLowerCase()}|${s.source.toLowerCase()}`;
    push({ p: "spell", n: s.name, s: s.source, f: file, b: brew ? 1 : 0,
      lv: s.level, sc: SCHOOL[s.school] || s.school, ct: spellTime(s), tg: spellTags(s),
      cl: spellClasses[k] || (s.classes?.fromClassList || []).map((c) => c.name),
      dm: (s.damageInflict || []).map((d) => d[0].toUpperCase() + d.slice(1)) });
  }
  function addItem(it, file, brew, base = false) {
    if (it._copy && !it.name) return;
    if (it._copy && !base) { PENDING.push(["item", it, file, brew]); return; }
    addItemNow(it, file, brew, base);
  }
  function addItemNow(it, file, brew, base = false) {
    push({ p: base ? "baseitem" : "item", n: it.name, s: it.source, f: file, b: brew ? 1 : 0,
      it: itemType(it), ra: RARITY(it.rarity) || (base ? "Mundane" : null), at: it.reqAttune ? "Requires attunement" : "No attunement",
      mg: !!(it.rarity && it.rarity !== "none") || !!it.wondrous, pr: it.value != null ? it.value / 100 : null });
  }
  // generic magic items that apply to many base items (Flame Tongue, +1 Weapon, Vorpal Sword…)
  function addVariant(v, file, brew) {
    const inh = v.inherits || {};
    if (!v.name || !inh.source) return;
    const req = (v.requires || []).flatMap((r) => Object.keys(r));
    const t = req.includes("armor") || req.includes("type") && (v.requires || []).some((r) => /^(LA|MA|HA|S)(\||$)/.test(r.type || "")) ? "Armor"
      : req.some((k) => ["weapon", "sword", "axe", "bow", "crossbow", "weaponCategory", "dmgType", "net", "polearm", "spear", "dagger", "mace", "hammer", "club", "staff"].includes(k)) || (v.requires || []).some((r) => /^(M|R|A|AF)(\||$)/.test(r.type || "")) ? "Weapon" : "Other";
    push({ p: "magicvariant", n: v.name, s: inh.source, f: file, b: brew ? 1 : 0,
      it: t, ra: RARITY(inh.rarity), at: inh.reqAttune ? "Requires attunement" : "No attunement", mg: true, pr: inh.value != null ? inh.value / 100 : null });
  }
  function addFeat(f, file, brew) {
    push({ p: "feat", n: f.name, s: f.source, f: file, b: brew ? 1 : 0, ft: FEAT_CAT[f.category] || "Feat", pl: prereqLevel(f) });
  }
  function addOpt(f, file, brew) {
    const t = (f.featureType || []).map((x) => OPT_TYPE[x] || "Optional feature");
    push({ p: "optionalfeature", n: f.name, s: f.source, f: file, b: brew ? 1 : 0, ft: t[0] || "Optional feature", pl: prereqLevel(f) });
  }
  function addSimple(prop, e, file, brew, kind) {
    push({ p: prop, n: e.name, s: e.source, f: file, b: brew ? 1 : 0, ko: kind });
  }
  const RAW = { monster: new Map(), item: new Map() };
  const PENDING = [];
  const rkey = (n, src) => `${String(n).toLowerCase()}|${String(src).toLowerCase()}`;
  // fill fields a "_copy" entry inherits from the entry it copies
  function inherit(kind, e, fields) {
    let cur = e, out = { ...e };
    for (let g = 0; g < 6 && cur?._copy; g++) {
      cur = RAW[kind].get(rkey(cur._copy.name, cur._copy.source));
      if (!cur) break;
      for (const f of fields) if (out[f] == null) out[f] = cur[f];
    }
    return out;
  }
  function addMon(m, file, brew) {
    if (m._copy) { PENDING.push(["monster", m, file, brew]); return; }
    addMonNow(m, file, brew);
  }
  function addMonNow(m, file, brew) {
    const cr = crOf(m.cr);
    push({ p: "monster", n: m.name, s: m.source, f: file, b: brew ? 1 : 0,
      ty: monType(m.type), cr, crb: crBucket(cr), sz: (m.size || []).map((x) => SIZE[x] || x)[0] || null,
      env: (m.environment || []).map((e) => e.replace(/\b\w/g, (c) => c.toUpperCase())) });
  }

  function ingest(json, file, brew) {
    for (const m of json.monster || []) if (m.name) RAW.monster.set(rkey(m.name, m.source), m);
    for (const it of [...(json.item || []), ...(json.baseitem || [])]) if (it.name) RAW.item.set(rkey(it.name, it.source), it);
    for (const s of json.spell || []) addSpell(s, file, brew);
    for (const it of json.item || []) addItem(it, file, brew);
    for (const it of json.baseitem || []) addItem(it, file, brew, true);
    for (const v of json.magicvariant || []) addVariant(v, file, brew);
    for (const f of json.feat || []) addFeat(f, file, brew);
    for (const f of json.optionalfeature || []) addOpt(f, file, brew);
    for (const b of json.background || []) addSimple("background", b, file, brew, "Background");
    for (const r of json.race || []) addSimple("race", r, file, brew, "Species");
    for (const c of json.class || []) addSimple("class", c, file, brew, "Class");
    for (const c of json.subclass || []) push({ p: "subclass", n: c.name, s: c.source, f: file, b: brew ? 1 : 0, ko: "Subclass", sub: c.className });
    for (const m of json.monster || []) addMon(m, file, brew);
  }

  // official
  const loadAll = (files) => pmap(files, 6, async (f) => [f, await J(f)], (done) => progress?.(`Reading 5e.tools data… ${done}/${files.length}`));
  const officialFiles = [];
  for (const idxFile of ["data/spells/index.json", "data/bestiary/index.json", "data/class/index.json"]) {
    const idx = await J(idxFile); if (!idx) continue;
    const dir = idxFile.slice(0, idxFile.lastIndexOf("/"));
    for (const f of Object.values(idx)) officialFiles.push(`${dir}/${f}`);
  }
  officialFiles.push("data/magicvariants.json", "data/items.json", "data/items-base.json", "data/feats.json", "data/optionalfeatures.json", "data/backgrounds.json", "data/races.json");
  for (const [f, j] of await loadAll(officialFiles)) if (j) ingest(j, f, false);
  // homebrew and prerelease (Unearthed Arcana) folders, each listing its files in index.json
  for (const [dir, brew] of [["prerelease", false], ["homebrew", true]]) {
    const hi = await J(`${dir}/index.json`);
    const files = (hi?.toImport || []).map((f) => `${dir}/${f}`);
    for (const [p, json] of await loadAll(files)) {
      if (!json) continue;
      for (const s of json._meta?.sources || []) sources[s.json] = { full: s.full || s.json, date: s.dateReleased || "", group: brew ? "homebrew" : "prerelease", brew, author: (s.authors || []).join(", ") };
      ingest(json, p, brew);
    }
  }

  // edition
  function edition(src) {
    const m = sources[src];
    if (m?.brew) return "Third-party";
    if (/^(XPHB|XDMG|XMM)$/.test(src)) return "5e (2024)";
    if (m?.date && m.date >= "2024-09") return "5e (2024)";
    if (/^UA/.test(src) || m?.group === "prerelease") return "Unearthed Arcana";
    return "5e (2014)";
  }

  // compact output: dictionary-encode strings
  const keys = ["p", "n", "s", "f", "b", "lv", "sc", "ct", "tg", "cl", "dm", "it", "ra", "at", "mg", "pr", "ft", "pl", "ko", "sub", "ty", "cr", "crb", "sz", "env"];
  const enc = (k, v) => {
    if (v == null) return null;
    if (Array.isArray(v)) return v.map((x) => di(k, x));
    if (["n", "lv", "pr", "b", "mg"].includes(k)) return v;
    return di(k, v);
  };
  for (const [kind, e, file, brew] of PENDING) {
    if (kind === "monster") addMonNow(inherit("monster", e, ["type", "cr", "size", "environment"]), file, brew);
    else addItemNow(inherit("item", e, ["type", "rarity", "reqAttune", "wondrous", "value", "weapon", "armor", "weaponCategory"]), file, brew);
  }
  const rows = ROWS.map((r) => keys.map((k) => enc(k, r[k])));
  return {
    v: 1, built: new Date().toISOString().slice(0, 10), keys,
    dict: Object.fromEntries(Object.entries(dict).map(([k, d]) => [k, d.list])),
    sources: Object.fromEntries(Object.entries(sources).map(([k, v]) => [k, { ...v, ed: edition(k) }])),
    rows,
  };
}
