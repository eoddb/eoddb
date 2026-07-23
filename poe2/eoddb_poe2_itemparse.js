/* eoddb_poe2_itemparse.js
   Parses a PoE2 Ctrl+C item copy (advanced mod descriptions) into a plain
   state object. Pure function, no DOM, no network — usable from the item
   triage page (parse-to-prefill) and from Node tooling
   (poe2/localfiles/eoddb_poe2_parser_test.js runs it against the fixture
   corpus in localfiles).

   Contract: parseItem(text) -> {
     ok, itemClass, rarity, name, base,
     quality: null | { value, group },        // group = catalyst family, if any
     itemLevel, sockets,
     requires: null | { level, attributes: [{ attr, value, augmented }] },
     properties: [{ name, value, notes: [] }],// weapon/armour stat block lines
     runes: [], enchants: [],
     grantsSkill: null | { level, name },
     implicits: [], enhancements: [], mods: [],  // mod = see parseModHead
     flags: { corrupted, sanctified, fractured, mirrored, unmodifiable },
     flavour: [],
     unparsed: []                             // anything not recognised — the
   }                                          // UI surfaces these lines

   Unrecognised input never throws: it lands in `unparsed` so a game-patch
   format change degrades the prefill instead of breaking the page. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) { module.exports = factory(); }
  else { root.eoddbItemParse = factory(); }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var FLAG_LINES = {
    "Corrupted": "corrupted",
    "Sanctified": "sanctified",
    "Fractured Item": "fractured",
    "Mirrored": "mirrored",
    "Unmodifiable": "unmodifiable"
  };

  /* "18(12-19)" -> { value: 18, min: 12, max: 19 }; collects every
     occurrence in a mod text line. Plain numbers without a range are not
     collected — the raw text keeps them. */
  function parseValues(text) {
    var vals = [];
    var re = /([+-]?\d+(?:\.\d+)?)\((-?\d+(?:\.\d+)?)\s*-\s*(-?\d+(?:\.\d+)?)\)/g;
    var m;
    while ((m = re.exec(text)) !== null) {
      vals.push({ value: parseFloat(m[1]), min: parseFloat(m[2]), max: parseFloat(m[3]) });
    }
    return vals;
  }

  /* Metadata block: { Desecrated Suffix Modifier "of the Yeti" (Tier: 5) — Elemental, Cold, Resistance }
     Segments after " — " are tags, a catalyst boost ("20% Increased"), or
     "Unscalable Value". */
  function parseModHead(inner) {
    var parts = inner.split(" — ");
    var head = parts[0].trim();
    var mod = {
      kind: null, name: null, tier: null, tags: [],
      desecrated: false, fractured: false, crafted: false,
      qualityBoost: null, unscalable: false,
      lines: []
    };
    var hm = head.match(/^(?:(Desecrated|Fractured|Crafted)\s+)?(Prefix|Suffix|Implicit|Unique|Enchant|Rune)(?:\s+Modifier)?(?:\s+"([^"]+)")?(?:\s+\(Tier:\s*(\d+)\))?$/);
    if (hm) {
      if (hm[1] === "Desecrated") { mod.desecrated = true; }
      if (hm[1] === "Fractured") { mod.fractured = true; }
      if (hm[1] === "Crafted") { mod.crafted = true; }
      mod.kind = hm[2].toLowerCase();
      mod.name = hm[3] || null;
      mod.tier = hm[4] ? parseInt(hm[4], 10) : null;
    } else if (head === "Enhancement") {
      mod.kind = "enhancement";
    } else {
      mod.kind = "unknown";
      mod.headRaw = head;
    }
    for (var i = 1; i < parts.length; i++) {
      var p = parts[i].trim();
      var qb = p.match(/^(\d+(?:\.\d+)?)% Increased$/i);
      if (qb) { mod.qualityBoost = parseFloat(qb[1]); continue; }
      if (/^Unscalable Value$/i.test(p)) { mod.unscalable = true; continue; }
      mod.tags = mod.tags.concat(p.split(/,\s*/));
    }
    return mod;
  }

  /* "Level 62, 92 (augmented) Dex, 34 Int" */
  function parseRequires(text) {
    var req = { level: null, attributes: [] };
    text.split(/,\s*/).forEach(function (tok) {
      var lm = tok.match(/^Level\s+(\d+)$/);
      if (lm) { req.level = parseInt(lm[1], 10); return; }
      var am = tok.match(/^(\d+)\s*(\(augmented\))?\s*(Str|Dex|Int)$/i);
      if (am) {
        req.attributes.push({ attr: am[3], value: parseInt(am[1], 10), augmented: !!am[2] });
      }
    });
    return req;
  }

  function parseItem(text) {
    var item = {
      ok: false,
      itemClass: null, rarity: null, name: null, base: null,
      quality: null, itemLevel: null, sockets: null,
      requires: null, properties: [],
      runes: [], enchants: [], grantsSkill: null,
      implicits: [], enhancements: [], mods: [],
      flags: { corrupted: false, sanctified: false, fractured: false, mirrored: false, unmodifiable: false },
      flavour: [],
      unparsed: []
    };
    if (typeof text !== "string" || text.trim() === "") { return item; }

    var lines = text.replace(/\r/g, "").split("\n").map(function (l) { return l.trim(); });

    // Split into sections on ---- separator lines.
    var sections = [];
    var cur = [];
    lines.forEach(function (line) {
      if (/^-{4,}$/.test(line)) {
        if (cur.length) { sections.push(cur); }
        cur = [];
      } else if (line !== "") {
        cur.push(line);
      }
    });
    if (cur.length) { sections.push(cur); }
    if (!sections.length) { return item; }

    // Header section: Item Class / Rarity / name line(s).
    var nameLines = [];
    sections[0].forEach(function (line) {
      var m = line.match(/^Item Class:\s*(.+)$/);
      if (m) { item.itemClass = m[1]; return; }
      m = line.match(/^Rarity:\s*(.+)$/);
      if (m) { item.rarity = m[1]; return; }
      nameLines.push(line);
    });
    if (nameLines.length >= 2) { item.name = nameLines[0]; item.base = nameLines[1]; }
    else if (nameLines.length === 1) { item.name = nameLines[0]; }
    if (!item.itemClass && !item.rarity) {
      // Not a recognisable item copy at all; keep everything for the UI.
      item.name = null;
      item.base = null;
      item.unparsed = lines.filter(function (l) { return l !== "" && !/^-{4,}$/.test(l); });
      return item;
    }
    item.ok = true;

    var currentMod = null;

    function handlePlainLine(line) {
      if (Object.prototype.hasOwnProperty.call(FLAG_LINES, line)) {
        item.flags[FLAG_LINES[line]] = true; return;
      }
      var m = line.match(/^Item Level:\s*(\d+)$/);
      if (m) { item.itemLevel = parseInt(m[1], 10); return; }
      m = line.match(/^Requires:\s*(.+)$/);
      if (m) { item.requires = parseRequires(m[1]); return; }
      m = line.match(/^Sockets:\s*(.+)$/);
      if (m) { item.sockets = m[1]; return; }
      m = line.match(/^Quality(?:\s*\(([^)]+)\))?:\s*\+(\d+)%/);
      if (m) { item.quality = { value: parseInt(m[2], 10), group: m[1] || null }; return; }
      m = line.match(/^Grants Skill:\s*(?:Level\s+(\d+)\s+)?(.+)$/);
      if (m) { item.grantsSkill = { level: m[1] ? parseInt(m[1], 10) : null, name: m[2] }; return; }
      m = line.match(/^(.+?)\s*\(rune\)$/);
      if (m) { item.runes.push(m[1]); return; }
      m = line.match(/^(.+?)\s*\(enchant\)$/);
      if (m) { item.enchants.push(m[1]); return; }
      // Weapon/armour stat block: "Physical Damage: 106-165 (augmented)"
      m = line.match(/^([A-Za-z][A-Za-z ]*?):\s*(.+)$/);
      if (m) {
        var notes = [];
        var value = m[2].replace(/\(([a-z]+)\)/g, function (_, note) { notes.push(note); return ""; }).trim();
        item.properties.push({ name: m[1], value: value, notes: notes });
        return;
      }
      // Flavour text heuristic: prose with no digits (unique/desecrated lore).
      if (!/\d/.test(line) && /[a-z]/.test(line) && line.indexOf(" ") !== -1) {
        item.flavour.push(line); return;
      }
      item.unparsed.push(line);
    }

    for (var s = 1; s < sections.length; s++) {
      var section = sections[s];
      var isModSection = section.some(function (l) { return l.charAt(0) === "{"; });
      currentMod = null;
      for (var i = 0; i < section.length; i++) {
        var line = section[i];
        var head = line.match(/^\{\s*(.+?)\s*\}$/);
        if (head) {
          currentMod = parseModHead(head[1]);
          if (currentMod.kind === "implicit") { item.implicits.push(currentMod); }
          else if (currentMod.kind === "enhancement") { item.enhancements.push(currentMod); }
          else { item.mods.push(currentMod); }
        } else if (isModSection && currentMod) {
          var textLine = line;
          if (/\s+—\s+Unscalable Value$/.test(textLine)) {
            currentMod.unscalable = true;
            textLine = textLine.replace(/\s+—\s+Unscalable Value$/, "");
          }
          currentMod.lines.push({ text: textLine, values: parseValues(textLine) });
        } else {
          handlePlainLine(line);
        }
      }
    }
    return item;
  }

  return { parseItem: parseItem };
});
