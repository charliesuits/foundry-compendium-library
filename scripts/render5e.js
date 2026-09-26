/**
 * A small renderer for 5e.tools JSON entries — enough to read a spell, item, feat or
 * creature in the detail pane before importing it. Plutonium does the real conversion.
 */
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// {@tag text|source|display} → display text
function tags(str) {
  let s = esc(str);
  for (let guard = 0; guard < 8 && /\{@/.test(s); guard++) {
    s = s.replace(/\{@(\w+) ([^{}]*?)\}/g, (m, tag, body) => {
      const parts = body.split("|");
      const text = parts.length >= 3 && parts[2] ? parts[2] : parts[0];
      switch (tag) {
        case "b": case "bold": return `<b>${body}</b>`;
        case "i": case "italic": return `<i>${body}</i>`;
        case "damage": case "dice": case "hit": case "d20": case "scaledamage": case "scaledice":
          return `<span class="cl-roll">${tag === "hit" ? (/^[+-]/.test(parts[0]) ? parts[0] : "+" + parts[0]) : (parts[tag.startsWith("scale") ? 2 : 0] || parts[0])}</span>`;
        case "dc": return `DC ${parts[0]}`;
        case "atk": case "atkr": return `<i>${{ mw: "Melee Weapon Attack:", rw: "Ranged Weapon Attack:", "mw,rw": "Melee or Ranged Weapon Attack:", ms: "Melee Spell Attack:", rs: "Ranged Spell Attack:", m: "Melee Attack Roll:", r: "Ranged Attack Roll:" }[parts[0]] || "Attack:"}</i>`;
        case "h": return "<i>Hit:</i> ";
        case "recharge": return `(Recharge ${parts[0] || 6}–6)`;
        case "note": return `<i>${text}</i>`;
        case "filter": return parts[0];
        default: return `<span class="cl-ref">${text}</span>`;
      }
    });
  }
  return s;
}

function renderEntries(entries, depth = 0) {
  if (entries == null) return "";
  if (!Array.isArray(entries)) entries = [entries];
  return entries.map((e) => renderEntry(e, depth)).join("");
}

function renderEntry(e, depth) {
  if (e == null) return "";
  if (typeof e === "string") return `<p>${tags(e)}</p>`;
  if (typeof e === "number") return `<p>${e}</p>`;
  const name = e.name ? tags(e.name) : "";
  switch (e.type) {
    case "list":
      return `<ul>${(e.items || []).map((it) => `<li>${typeof it === "string" ? tags(it) : it.type === "item" || it.type === "itemSpell" ? `<b>${tags(it.name || "")}</b> ${it.entry ? tags(it.entry) : renderEntries(it.entries, depth + 1).replace(/^<p>|<\/p>$/g, "")}` : renderEntry(it, depth + 1)}</li>`).join("")}</ul>`;
    case "table": {
      const head = (e.colLabels || []).map((c) => `<th>${tags(c)}</th>`).join("");
      const rows = (e.rows || []).map((row) => `<tr>${(row.row || row).map((c) => `<td>${typeof c === "object" ? (c.roll ? (c.roll.exact ?? `${c.roll.min}–${c.roll.max}`) : renderEntries(c.entries || c.entry || [], depth + 1).replace(/<\/?p>/g, "")) : tags(c)}</td>`).join("")}</tr>`).join("");
      return `${e.caption ? `<p class="cl-cap">${tags(e.caption)}</p>` : ""}<table>${head ? `<thead><tr>${head}</tr></thead>` : ""}<tbody>${rows}</tbody></table>`;
    }
    case "inset": case "insetReadaloud":
      return `<aside class="cl-inset">${name ? `<h4>${name}</h4>` : ""}${renderEntries(e.entries, depth + 1)}</aside>`;
    case "quote":
      return `<blockquote>${renderEntries(e.entries, depth + 1)}${e.by ? `<p>— ${tags(e.by)}</p>` : ""}</blockquote>`;
    case "abilityDc": return `<p><b>${tags(e.name)} save DC</b> = 8 + proficiency bonus + ${(e.attributes || []).join("/")} modifier</p>`;
    case "abilityAttackMod": return `<p><b>${tags(e.name)} attack modifier</b> = proficiency bonus + ${(e.attributes || []).join("/")} modifier</p>`;
    case "item": return `<p><b>${name}</b> ${e.entry ? tags(e.entry) : renderEntries(e.entries, depth + 1).replace(/<\/?p>/g, "")}</p>`;
    case "entries": case "section": case "inline": case "inlineBlock": default:
      if (e.entries) {
        const inner = renderEntries(e.entries, depth + 1);
        if (!name) return inner;
        if (depth >= 1) return inner.replace(/^<p>/, `<p><b><i>${name}.</i></b> `);
        return `<h4>${name}</h4>${inner}`;
      }
      if (e.entry) return `<p>${name ? `<b>${name}.</b> ` : ""}${tags(e.entry)}</p>`;
      return "";
  }
}

const SCHOOL = { A: "Abjuration", C: "Conjuration", D: "Divination", E: "Enchantment", V: "Evocation", I: "Illusion", N: "Necromancy", T: "Transmutation" };
const ord = (n) => (n === 1 ? "1st" : n === 2 ? "2nd" : n === 3 ? "3rd" : `${n}th`);
function spellHead(s) {
  const lvl = s.level === 0 ? `${SCHOOL[s.school] || s.school} cantrip` : `${ord(s.level)}-level ${(SCHOOL[s.school] || s.school).toLowerCase()}`;
  const time = (s.time || []).map((t) => `${t.number} ${t.unit}${t.number > 1 ? "s" : ""}${t.condition ? `, ${t.condition}` : ""}`).join(" or ");
  const r = s.range || {};
  const range = r.type === "special" ? "Special" : r.distance ? (["self", "touch", "sight", "unlimited"].includes(r.distance.type) ? r.distance.type[0].toUpperCase() + r.distance.type.slice(1) : `${r.distance.amount} ${r.distance.type}`) + (r.type !== "point" && r.type ? ` (${r.type})` : "") : "";
  const c = s.components || {};
  const comp = [c.v && "V", c.s && "S", c.m && `M (${typeof c.m === "object" ? c.m.text : c.m})`].filter(Boolean).join(", ");
  const dur = (s.duration || []).map((d) => d.type === "instant" ? "Instantaneous" : d.type === "permanent" ? "Until dispelled" : d.type === "special" ? "Special" : `${d.concentration ? "Concentration, up to " : ""}${d.duration?.amount ?? ""} ${d.duration?.type ?? ""}${(d.duration?.amount ?? 0) > 1 ? "s" : ""}`).join(" or ");
  return `<p class="cl-subtitle"><i>${lvl}${s.meta?.ritual ? " (ritual)" : ""}</i></p>
    <dl class="cl-stats"><dt>Casting Time</dt><dd>${esc(time)}</dd><dt>Range</dt><dd>${esc(range)}</dd><dt>Components</dt><dd>${tags(comp)}</dd><dt>Duration</dt><dd>${esc(dur)}</dd></dl>`;
}
const mod = (v) => { const m = Math.floor((v - 10) / 2); return `${v} (${m >= 0 ? "+" : ""}${m})`; };
function monsterHead(m) {
  const ac = (m.ac || []).map((a) => (typeof a === "number" ? a : `${a.ac}${a.from ? ` (${a.from.map(tags).join(", ")})` : ""}`)).join(", ");
  const hp = m.hp ? (m.hp.special ?? `${m.hp.average} (${m.hp.formula})`) : "";
  const speed = Object.entries(m.speed || {}).filter(([k]) => k !== "canHover").map(([k, v]) => `${k === "walk" ? "" : k + " "}${typeof v === "object" ? v.number : v} ft.`).join(", ");
  const ab = ["str", "dex", "con", "int", "wis", "cha"];
  return `<dl class="cl-stats"><dt>AC</dt><dd>${ac}</dd><dt>HP</dt><dd>${esc(hp)}</dd><dt>Speed</dt><dd>${esc(speed)}</dd></dl>
    <table class="cl-abil"><tr>${ab.map((a) => `<th>${a.toUpperCase()}</th>`).join("")}</tr><tr>${ab.map((a) => `<td>${m[a] != null ? mod(m[a]) : "—"}</td>`).join("")}</tr></table>`;
}
function monsterBody(m) {
  const sec = (label, arr) => (arr?.length ? `<h4>${label}</h4>${renderEntries(arr.map((a) => ({ ...a, type: "entries" })), 1)}` : "");
  return renderEntries(m.trait?.map((t) => ({ ...t, type: "entries" })), 1) + sec("Actions", m.action) + sec("Bonus Actions", m.bonus) + sec("Reactions", m.reaction) + sec("Legendary Actions", m.legendary);
}

export function render5eEntry(prop, e) {
  if (!e) return `<p class="cl-muted">Could not load this entry.</p>`;
  let head = "";
  let body = "";
  if (prop === "spell") { head = spellHead(e); body = renderEntries(e.entries) + (e.entriesHigherLevel ? renderEntries(e.entriesHigherLevel) : ""); }
  else if (prop === "monster") { head = monsterHead(e); body = monsterBody(e); }
  else if (prop === "class") { body = `<p>Hit die d${e.hd?.faces ?? "?"}.</p>`; }
  else body = renderEntries(e.entries || e.entry);
  return head + body;
}
