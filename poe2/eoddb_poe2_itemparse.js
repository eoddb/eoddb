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
     flags: { corrupted, twiceCorrupted, sanctified, fractured, mirrored, unmodifiable },
     flavour: [],
     unparsed: []                             // anything not recognised — the
   }                                          // UI surfaces these lines

   Unrecognised input never throws: it lands in `unparsed` so a game-patch
   format change degrades the prefill instead of breaking the page.

   Also exported (share-link support):
   - serializeItem(item) -> advanced-format text (round-trips through
     parseItem; the canonical wire format for share links)
   - encodeShare(text) -> Promise<code>  ("1."+deflated base64url, or
     "0."+plain base64url when CompressionStream is unavailable)
   - decodeShare(code) -> Promise<text|null>
   Share URLs put the code in the fragment: /poe2/crafting-wip#i=<code>.
   Node 18+ has all required globals, so offline tooling can decode links
   with this same file. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) { module.exports = factory(); }
  else { root.eoddbItemParse = factory(); }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var FLAG_LINES = {
    "Corrupted": "corrupted",
    "Twice Corrupted": "twiceCorrupted",
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
      corruption: false, qualityBoost: null, unscalable: false,
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
    } else if (head === "Enhancement" || head === "Corruption Enhancement") {
      // "Corruption Enhancement" observed on an unboosted second corruption
      // line (Architect's Orb); it reads plain "Enhancement" once an Orb of
      // Sacrifice boosts it. corruption:true marks the labelled variant.
      mod.kind = "enhancement";
      mod.corruption = head === "Corruption Enhancement";
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
      flags: { corrupted: false, twiceCorrupted: false, sanctified: false, fractured: false, mirrored: false, unmodifiable: false },
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

  /* ── Serialization: state -> advanced-format text (round-trips) ── */

  function modBlockLines(mod) {
    var head;
    if (mod.kind === "enhancement") {
      head = mod.corruption ? "Corruption Enhancement" : "Enhancement";
    } else if (mod.kind === "unknown" && mod.headRaw) {
      head = mod.headRaw;
    } else {
      head = (mod.desecrated ? "Desecrated " : mod.fractured ? "Fractured " : mod.crafted ? "Crafted " : "") +
        mod.kind.charAt(0).toUpperCase() + mod.kind.slice(1) + " Modifier";
      if (mod.name) { head += " \"" + mod.name + "\""; }
      if (mod.tier !== null && mod.tier !== undefined) { head += " (Tier: " + mod.tier + ")"; }
    }
    var parts = [head];
    if (mod.tags && mod.tags.length) { parts.push(mod.tags.join(", ")); }
    if (mod.qualityBoost) { parts.push(mod.qualityBoost + "% Increased"); }
    var lines = ["{ " + parts.join(" — ") + " }"];
    (mod.lines || []).forEach(function (l, i) {
      var suffix = (mod.unscalable && i === mod.lines.length - 1) ? " — Unscalable Value" : "";
      lines.push(l.text + suffix);
    });
    return lines;
  }

  function serializeItem(item) {
    var sections = [];
    var head = [];
    if (item.itemClass) { head.push("Item Class: " + item.itemClass); }
    if (item.rarity) { head.push("Rarity: " + item.rarity); }
    if (item.name) { head.push(item.name); }
    if (item.base) { head.push(item.base); }
    if (head.length) { sections.push(head); }
    var props = [];
    if (item.quality) {
      props.push("Quality" + (item.quality.group ? " (" + item.quality.group + ")" : "") + ": +" + item.quality.value + "% (augmented)");
    }
    (item.properties || []).forEach(function (p) {
      props.push(p.name + ": " + p.value + (p.notes || []).map(function (n) { return " (" + n + ")"; }).join(""));
    });
    if (props.length) { sections.push(props); }
    if (item.requires && (item.requires.level || (item.requires.attributes || []).length)) {
      var toks = [];
      if (item.requires.level) { toks.push("Level " + item.requires.level); }
      (item.requires.attributes || []).forEach(function (a) {
        toks.push(a.value + (a.augmented ? " (augmented)" : "") + " " + a.attr);
      });
      sections.push(["Requires: " + toks.join(", ")]);
    }
    if (item.sockets) { sections.push(["Sockets: " + item.sockets]); }
    if (item.itemLevel !== null && item.itemLevel !== undefined) { sections.push(["Item Level: " + item.itemLevel]); }
    var runes = (item.runes || []).map(function (r) { return r + " (rune)"; });
    if (runes.length) { sections.push(runes); }
    var enchants = (item.enchants || []).map(function (e) { return e + " (enchant)"; });
    if (enchants.length) { sections.push(enchants); }
    if (item.grantsSkill) {
      sections.push(["Grants Skill: " + (item.grantsSkill.level ? "Level " + item.grantsSkill.level + " " : "") + item.grantsSkill.name]);
    }
    [item.enhancements, item.implicits, item.mods].forEach(function (list) {
      var lines = [];
      (list || []).forEach(function (mod) { lines = lines.concat(modBlockLines(mod)); });
      if (lines.length) { sections.push(lines); }
    });
    if ((item.flavour || []).length) { sections.push(item.flavour.slice()); }
    var FLAG_TEXT = { corrupted: "Corrupted", twiceCorrupted: "Twice Corrupted", sanctified: "Sanctified", fractured: "Fractured Item", mirrored: "Mirrored", unmodifiable: "Unmodifiable" };
    Object.keys(FLAG_TEXT).forEach(function (k) {
      if (item.flags && item.flags[k]) { sections.push([FLAG_TEXT[k]]); }
    });
    if ((item.unparsed || []).length) { sections.push(item.unparsed.slice()); }
    return sections.map(function (s) { return s.join("\n"); }).join("\n--------\n");
  }

  /* ── Share codes: text <-> "1."+deflate+base64url (or "0." uncompressed) ── */

  function bytesToB64url(bytes) {
    var bin = "";
    for (var i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function b64urlToBytes(s) {
    s = s.replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4) { s += "="; }
    var bin = atob(s);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) { bytes[i] = bin.charCodeAt(i); }
    return bytes;
  }

  function encodeShare(text) {
    var data = new TextEncoder().encode(text);
    if (typeof CompressionStream === "undefined") {
      return Promise.resolve("0." + bytesToB64url(data));
    }
    var stream = new Blob([data]).stream().pipeThrough(new CompressionStream("deflate-raw"));
    return new Response(stream).arrayBuffer().then(function (buf) {
      return "1." + bytesToB64url(new Uint8Array(buf));
    });
  }

  function decodeShare(code) {
    try {
      var dot = code.indexOf(".");
      if (dot === -1) { return Promise.resolve(null); }
      var bytes = b64urlToBytes(code.slice(dot + 1));
      if (code.slice(0, dot) === "0") {
        return Promise.resolve(new TextDecoder().decode(bytes));
      }
      if (code.slice(0, dot) !== "1" || typeof DecompressionStream === "undefined") {
        return Promise.resolve(null);
      }
      var stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      return new Response(stream).arrayBuffer().then(function (buf) {
        return new TextDecoder().decode(new Uint8Array(buf));
      }).catch(function () { return null; });
    } catch (e) {
      return Promise.resolve(null);
    }
  }

  return { parseItem: parseItem, serializeItem: serializeItem, encodeShare: encodeShare, decodeShare: decodeShare };
});
