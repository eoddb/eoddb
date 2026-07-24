/* eoddb_poe2_triage_rules.js
   Mechanical triage: deterministic rules applied to a parsed item state
   (the output of eoddb_poe2_itemparse.js). Facts and legal moves only —
   no judgment or valuation; that layer comes from the curated dataset.
   Pure function, no DOM, no network — usable from the triage page and
   from Node tooling (poe2/localfiles/eoddb_poe2_triage_test.js).

   computeTriage(state) -> null | {
     headline: { tone: "finished"|"craftable"|"blank"|"unique", text },
     rows: [{ label, text, tone: "info"|"warn"|"good" }]
   }

   Every rule here is public game knowledge confirmed in
   poe2/localfiles/eoddb_poe2_glossary.md — patch-currency rule applies,
   re-verify after each league. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) { module.exports = factory(); }
  else { root.eoddbTriageRules = factory(); }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var MARTIAL_WEAPONS = ["Bows", "Crossbows", "One Hand Maces", "Two Hand Maces", "Quarterstaves", "Spears"];
  var JEWELRY = ["Rings", "Amulets"];
  var AFFIX_CAPS = { "Rare": 3, "Magic": 1, "Normal": 0 };

  function rollPct(v) {
    if (v.max === v.min) { return null; }
    return (v.value - v.min) / (v.max - v.min);
  }

  function computeTriage(state) {
    if (!state || !state.ok) { return null; }

    var f = state.flags || {};
    /* sanctified/mirrored/unmodifiable: nothing can EVER change.
       corrupted/twice corrupted: NORMAL crafting is closed, but the
       corruption paths stay open (Orb of Sacrifice boosts a corruption
       Enhancement line by consuming a random modifier — one boost per
       line; Architect's Orb gambles a second corruption or destroys).
       `finished` below means "normal crafting closed". */
    var lockedReason =
      f.sanctified ? "sanctified" :
      f.mirrored ? "mirrored" :
      f.unmodifiable ? "unmodifiable" : null;
    var corrupted = !!(f.corrupted || f.twiceCorrupted);
    var finished = lockedReason !== null || corrupted;
    var finishedReason = lockedReason || (f.twiceCorrupted ? "twice corruption" : "corruption");

    var explicit = state.mods || [];
    var prefixes = explicit.filter(function (m) { return m.kind === "prefix"; });
    var suffixes = explicit.filter(function (m) { return m.kind === "suffix"; });
    var allMods = explicit.concat(state.implicits || [], state.enhancements || []);
    var isUnique = state.rarity === "Unique";
    var rows = [];

    /* ── Headline ── */
    var headline;
    if (isUnique) {
      headline = { tone: "unique", text: "Unique — fixed identity, rolls are what vary" };
    } else if (lockedReason) {
      headline = { tone: "finished", text: "Finished — " + lockedReason + ", nothing can change. Value it as-is." };
    } else if (f.twiceCorrupted) {
      headline = { tone: "finished", text: "Twice corrupted — normal crafting closed; only sacrifices remain." };
    } else if (corrupted) {
      headline = { tone: "finished", text: "Corrupted — normal crafting closed, but corruption gambles remain." };
    } else if (state.rarity === "Normal" && !explicit.length) {
      headline = { tone: "blank", text: "Blank base — every crafting door open" };
    } else {
      headline = { tone: "craftable", text: "Craftable" };
    }

    /* ── Affix slots (rare/magic only; caps shift with slot-reducing implicits) ── */
    var capTotal = null;
    if (!isUnique && Object.prototype.hasOwnProperty.call(AFFIX_CAPS, state.rarity) && state.rarity !== "Normal") {
      var capP = AFFIX_CAPS[state.rarity];
      var capS = AFFIX_CAPS[state.rarity];
      (state.implicits || []).forEach(function (mod) {
        (mod.lines || []).forEach(function (line) {
          var m = line.text.match(/^([+-]\d+)\s+(Prefix|Suffix)\s+Modifier/);
          if (m) {
            if (m[2] === "Prefix") { capP += parseInt(m[1], 10); }
            else { capS += parseInt(m[1], 10); }
          }
        });
      });
      capTotal = capP + capS;
      var openP = Math.max(0, capP - prefixes.length);
      var openS = Math.max(0, capS - suffixes.length);
      var slotTxt = prefixes.length + "/" + capP + " prefixes, " + suffixes.length + "/" + capS + " suffixes.";
      if (openP + openS > 0) {
        if (finished) {
          rows.push({ label: "Affixes", tone: "warn", text: slotTxt + " Open slot(s) wasted — closed by " + finishedReason + "." });
        } else {
          rows.push({ label: "Affixes", tone: "good", text: slotTxt + " Open slot(s) = an Exalted Orb can add a line." });
        }
      } else if (finished) {
        rows.push({ label: "Affixes", tone: "info", text: slotTxt + " Full — and locked." });
      } else if (state.rarity === "Magic") {
        rows.push({ label: "Affixes", tone: "info", text: slotTxt + " Full for a magic item — more lines means upgrading its rarity." });
      } else {
        rows.push({ label: "Affixes", tone: "info", text: slotTxt + " Full — adding anything needs removal first (Chaos Orb swaps a line, Annulment removes one)." });
      }
      if (state.rarity === "Magic" && !finished) {
        rows.push({ label: "Magic item", tone: "info", text: "Capped at 1 prefix + 1 suffix while magic." });
      }
    }

    /* ── Corruption paths (still open on corrupted items) ── */
    if (corrupted && !lockedReason) {
      var enh = state.enhancements || [];
      var unboosted = enh.filter(function (m) { return m.corruption; }).length;
      if (unboosted > 0) {
        rows.push({ label: "Sacrifice", tone: "good", text: unboosted + " unboosted corruption line — an Orb of Sacrifice can push it beyond natural values by consuming a random modifier (one boost per line, ever)." });
      } else if (enh.length) {
        rows.push({ label: "Sacrifice", tone: "info", text: enh.length + " corruption line(s). If one is still unboosted, an Orb of Sacrifice can boost it (consumes a random modifier; one boost per line). Spotting an already-boosted line needs natural-range data — judgment layer, later." });
      }
      if (capTotal !== null && enh.length && explicit.length < capTotal) {
        rows.push({ label: "Sacrificed?", tone: "info", text: explicit.length + " of " + capTotal + " affixes on a corrupted item — " + (capTotal - explicit.length) + " missing line(s) may already have been consumed by Orb(s) of Sacrifice." });
      }
      if (!f.twiceCorrupted) {
        rows.push({ label: "Architect's", tone: "warn", text: "Architect's Orb can attempt a second corruption — unpredictable modification OR the item is destroyed. Success adds a second corruption line (boostable by its own sacrifice)." });
      }
    }

    /* ── Locked / special lines ── */
    var fracturedLines = allMods.filter(function (m) { return m.fractured; });
    if (fracturedLines.length) {
      rows.push({ label: "Fractured", tone: "info", text: fracturedLines.length + " line(s) permanently locked — they survive all further crafting." });
    }
    var desecratedLines = allMods.filter(function (m) { return m.desecrated; });
    if (desecratedLines.length) {
      rows.push({
        label: "Desecrated", tone: "info",
        text: desecratedLines.length + " desecrated line(s). " + (finished
          ? "Locked in now."
          : "Controlled removal = Omen of Light + Annulment (expensive); a plain Annulment risks removing a good line instead.")
      });
    }
    if (!finished && !isUnique && state.rarity === "Rare" && explicit.length >= 4 && !fracturedLines.length && !f.fractured) {
      rows.push({ label: "Fracture", tone: "info", text: explicit.length + " lines = Fracturing Orb eligible (locks one random line; pairs with chaos spam to secure keepers)." });
    }

    /* ── Tier spread ── */
    var tiered = explicit.filter(function (m) { return m.tier !== null && m.tier !== undefined; });
    if (tiered.length) {
      var top = tiered.filter(function (m) { return m.tier <= 2; }).length;
      var low = tiered.filter(function (m) { return m.tier >= 6; }).length;
      var spread = top + " top-tier line(s) (T1–T2), " + low + " low-tier (T6+).";
      if (!finished && low >= 2 && top === 0) {
        rows.push({ label: "Tiers", tone: "warn", text: spread + " Chaos spam territory — nothing here worth protecting yet." });
      } else if (!finished && top >= 1 && low >= 1) {
        rows.push({ label: "Tiers", tone: "info", text: spread + " Omen of Whittling makes a Chaos Orb remove the lowest-LEVEL line (tier is only a proxy for level — check before trusting it)." });
      } else {
        rows.push({ label: "Tiers", tone: "info", text: spread });
      }
    }

    /* ── Roll quality ── */
    var pcts = [];
    var outside = 0;
    allMods.forEach(function (mod) {
      (mod.lines || []).forEach(function (line) {
        (line.values || []).forEach(function (v) {
          var p = rollPct(v);
          if (p === null) { return; }
          if (p < 0 || p > 1) { outside++; } else { pcts.push(p); }
        });
      });
    });
    if (pcts.length) {
      var hi = pcts.filter(function (p) { return p >= 0.75; }).length;
      var lo = pcts.filter(function (p) { return p <= 0.25; }).length;
      var rollTxt = hi + " of " + pcts.length + " rolled values at 75%+ of range";
      if (finished) {
        rows.push({ label: "Rolls", tone: "info", text: rollTxt + " — locked." });
      } else if (lo > 0) {
        rows.push({ label: "Rolls", tone: "info", text: rollTxt + "; " + lo + " low. A Divine Orb rerolls ALL values at once — upside only if the low rolls sit on lines you're keeping." });
      } else {
        rows.push({ label: "Rolls", tone: "good", text: rollTxt + ". Little left for a Divine Orb to fix." });
      }
    }
    if (outside > 0) {
      rows.push({ label: "Sanctified rolls", tone: "info", text: outside + " value(s) outside the normal tier range — the sanctification signature." });
    }

    /* ── Quality / catalysts ── */
    var isJewelry = JEWELRY.indexOf(state.itemClass) !== -1;
    var isMartial = MARTIAL_WEAPONS.indexOf(state.itemClass) !== -1;
    if (isJewelry) {
      if (state.quality && state.quality.group) {
        var groupRoot = state.quality.group.replace(/\s*Modifiers?$/i, "");
        var boosted = allMods.filter(function (m) {
          return m.qualityBoost || (m.tags || []).indexOf(groupRoot) !== -1;
        }).length;
        var catTxt = state.quality.group + " +" + state.quality.value + "% boosts " + boosted + " of " + allMods.length + " lines.";
        if (boosted === 0) {
          rows.push({ label: "Catalyst", tone: "warn", text: catTxt + " Mismatched catalyst — it does nothing for this item" + (finished ? ", and it can't be changed now." : ".") });
        } else {
          rows.push({ label: "Catalyst", tone: "info", text: catTxt + (finished ? " Locked in." : "") });
        }
      } else if (!finished && !isUnique) {
        rows.push({ label: "Catalyst", tone: "info", text: "No catalyst quality yet — the matching group multiplies its mods' values (base cap +20%)." });
      }
    } else if (state.quality && !isJewelry) {
      var q = state.quality.value;
      if (!finished && q < 20) {
        rows.push({ label: "Quality", tone: "good", text: "Quality " + q + "/20 — cheap win, top it up before bigger currency." });
      } else if (!finished && q >= 20 && isMartial) {
        rows.push({ label: "Quality", tone: "info", text: "Quality " + q + "% — at base cap. A Blacksmith Infuser can push past it (chance of corrupting)." });
      } else {
        rows.push({ label: "Quality", tone: "info", text: "Quality " + q + "%." });
      }
    }

    return { headline: headline, rows: rows };
  }

  return { computeTriage: computeTriage };
});
