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

  /* Where a roll landed inside its own printed range: 0 = the floor of the
     range, 1 = a max roll. Deliberately NOT value/max — that would score a
     21(21-25) floor roll as 0.84 and call a worst-case roll good. Normalising
     to the range is also what makes out-of-range values meaningful: a
     sanctified roll above the range exceeds 1.0, and one below it goes
     negative (20.3 in a 21-25 range = -0.17). */
  function rollPct(v) {
    if (v.max === v.min) { return null; }
    return (v.value - v.min) / (v.max - v.min);
  }

  /* One score per modifier, each weighted equally regardless of how many
     values it carries, so a two-value line does not count double. */
  function modRollScore(mod) {
    var ps = [];
    (mod.lines || []).forEach(function (line) {
      (line.values || []).forEach(function (v) {
        var p = rollPct(v);
        if (p !== null) { ps.push(p); }
      });
    });
    if (!ps.length) { return null; }
    var sum = ps.reduce(function (a, b) { return a + b; }, 0);
    return sum / ps.length;
  }

  function modLabel(mod) {
    var first = (mod.lines || [])[0];
    var txt = first ? first.text : (mod.name || mod.kind || "line");
    return txt.replace(/\s+/g, " ").trim();
  }

  function pctLabel(p) { return Math.round(p * 100) + "%"; }

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
    /* Adjectival form, for sentences that name the blocker ("Because it is
       twice corrupted…"). Mirrored and unmodifiable are included alongside
       corrupted/sanctified because they block a Divine Orb just as hard —
       telling someone to divine a mirrored item would be plain wrong. */
    var divineBlockReason =
      f.twiceCorrupted ? "twice corrupted" :
      f.corrupted ? "corrupted" :
      f.sanctified ? "sanctified" :
      f.mirrored ? "mirrored" :
      f.unmodifiable ? "unmodifiable" : null;

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

    /* ── Roll quality ──
       One equal-weighted score per modifier, averaged into a single bar.
       Every statement here is arithmetic on the item's own printed ranges,
       so it cannot go stale with a patch the way a rule of thumb would. */
    var scored = [];
    var outside = 0;
    allMods.forEach(function (mod) {
      var s = modRollScore(mod);
      if (s === null) { return; }
      scored.push({ label: modLabel(mod), pct: s });
      (mod.lines || []).forEach(function (line) {
        (line.values || []).forEach(function (v) {
          var p = rollPct(v);
          if (p !== null && (p < 0 || p > 1)) { outside++; }
        });
      });
    });

    if (scored.length) {
      var sum = scored.reduce(function (a, m) { return a + m.pct; }, 0);
      var avg = sum / scored.length;
      var quartile = avg >= 0.75 ? "high" : (avg <= 0.25 ? "low" : "mid");
      var byPct = scored.slice().sort(function (a, b) { return a.pct - b.pct; });

      /* Call out the lines that actually drive the average either way. */
      var lows = byPct.filter(function (m) { return m.pct <= 0.25; });
      var maxes = byPct.filter(function (m) { return m.pct >= 1; });
      var highs = byPct.filter(function (m) { return m.pct >= 0.75 && m.pct < 1; });
      var notes = [];
      if (maxes.length) {
        notes.push("Max roll" + (maxes.length > 1 ? "s" : "") + ": " +
          maxes.map(function (m) { return m.label + " (" + pctLabel(m.pct) + ")"; }).join("; ") + ".");
      }
      if (lows.length) {
        notes.push("Lowest: " +
          lows.slice(0, 3).map(function (m) { return m.label + " (" + pctLabel(m.pct) + ")"; }).join("; ") + ".");
      }

      var verdict;
      if (finished) {
        /* Locked items get the measurement and nothing else — no currency
           advice can apply, so none is offered. */
        verdict = "Because it is " + divineBlockReason + ", these ranges can't be rerolled with a Divine Orb.";
      } else if (quartile === "low") {
        verdict = "Bottom quartile — a strong Divine Orb candidate, as the average rolls sit in the bottom quartile. Check if the key lines are not outliers.";
      } else if (quartile === "high") {
        verdict = "Top quartile — already sitting at the upper quartile of outcomes, there is little reason to use a Divine Orb unless a key line's roll is not what you wanted.";
      } else {
        verdict = "Mid-range — On average, a Divine Orb use will get you to a similar position. Its use here strongly depends on which lines you want to correct.";
      }

      rows.push({
        label: "Rolls",
        tone: finished ? "info" : (quartile === "high" ? "good" : (quartile === "low" ? "warn" : "info")),
        text: "Average roll quality " + pctLabel(avg) + " across " + scored.length +
              " modifier" + (scored.length > 1 ? "s" : "") + ". " +
              (notes.length ? notes.join(" ") + " " : "") + verdict,
        bar: {
          pct: avg,
          quartile: quartile,
          locked: finished,
          count: scored.length,
          lowest: byPct[0] || null,
          highest: byPct[byPct.length - 1] || null,
          highCount: highs.length + maxes.length,
          lowCount: lows.length
        }
      });
    }
    if (outside > 0) {
      rows.push({ label: "Sanctified rolls", tone: "info", text: outside + " value(s) outside the normal tier range — the sanctification signature. Values above the range score over 100%, below it score negative." });
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

  /* modRollScore is exported so the per-modifier bars on the item page score
     a line with the exact same arithmetic as the summary bar — two
     implementations of this could drift and contradict each other. */
  return { computeTriage: computeTriage, modRollScore: modRollScore, rollPct: rollPct };
});
