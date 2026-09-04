/*
 * core.js — pure logic for the morning dashboard. No DOM access here.
 * Loaded as a plain <script> in the WebView (attaches window.BooxCore) and
 * required directly from Node for testing (module.exports).
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.BooxCore = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var MONTHS = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];
  var DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  var DAY_ABBR = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

  function pad(n) {
    return n < 10 ? "0" + n : "" + n;
  }

  function formatDateLine(d) {
    return DAYS[d.getDay()] + ", " + MONTHS[d.getMonth()] + " " + d.getDate() + ", " + d.getFullYear();
  }

  function dateStampYYYYMMDD(d) {
    return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  }

  function dailyKey(d) {
    return "m" + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate());
  }

  // Mon/Wed -> memorization and prayer list. Sat -> reading plan, add music. Else -> reading plan.
  function devotionsFocusFor(d) {
    var wd = d.getDay();
    if (wd === 1 || wd === 3) {
      return "Memorization and prayer list";
    }
    if (wd === 6) {
      return "Bible reading plan, and add music";
    }
    return "Bible reading plan";
  }

  // The M'Cheyne plan has no Feb 29 entry. Fall back to Feb 28 and flag it.
  function readingKeyFor(d) {
    var month = d.getMonth();
    var day = d.getDate();
    if (month === 1 && day === 29) {
      return { key: "2-28", leapNote: true };
    }
    return { key: (month + 1) + "-" + day, leapNote: false };
  }

  function lookupReading(plan, d) {
    var info = readingKeyFor(d);
    var passages = plan[info.key] || null;
    return { passages: passages, leapNote: info.leapNote, key: info.key };
  }

  // Replace the literal "[today's date]" placeholder wherever it appears, at render time.
  function formatItemText(text, d) {
    if (text.indexOf("[today's date]") === -1) {
      return text;
    }
    return text.split("[today's date]").join(formatDateLine(d));
  }

  // --- "Today's three" weighted rotation (Section 3.2) ---

  // mulberry32 PRNG, seeded by an integer.
  function rng(seed) {
    return function () {
      seed |= 0;
      seed = (seed + 0x6D2B79F5) | 0;
      var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // core = vision + every mission text line (prefixed "Heading: line") + every Daily Drivers item.
  // rest = every item from every other section. Wedding vows and header quotes are excluded from
  // the rotation entirely (reference-only material).
  function buildPools(principles) {
    var core = [];
    core.push(principles.vision);
    principles.mission.forEach(function (m) {
      m.text.forEach(function (line) {
        core.push(m.heading + ": " + line);
      });
    });

    var rest = [];
    principles.sections.forEach(function (section) {
      if (section.name === "Daily Drivers") {
        core = core.concat(section.items);
      } else {
        rest = rest.concat(section.items);
      }
    });

    return { core: core, rest: rest };
  }

  function weightedPickWithoutReplacement(items, weights, r) {
    var total = 0;
    var i;
    for (i = 0; i < weights.length; i++) {
      total += weights[i];
    }
    var draw = r() * total;
    for (i = 0; i < items.length; i++) {
      draw -= weights[i];
      if (draw <= 0) {
        break;
      }
    }
    if (i >= items.length) {
      i = items.length - 1;
    }
    var picked = items[i];
    items.splice(i, 1);
    weights.splice(i, 1);
    return picked;
  }

  // Deterministic per-day pick: same date always yields the same three, in slot order.
  function pickTodaysThree(principles, d) {
    var pools = buildPools(principles);
    var seed = dateStampYYYYMMDD(d);
    var r = rng(seed);

    var core = pools.core.slice();
    var rest = pools.rest.slice();

    // Slot 1: uniform pick from core only.
    var slot1Index = Math.floor(r() * core.length);
    if (slot1Index >= core.length) {
      slot1Index = core.length - 1;
    }
    var slot1 = core[slot1Index];
    core.splice(slot1Index, 1);

    // Slots 2 and 3: weighted pick without replacement from (remaining core, weight 3) + (rest, weight 1).
    var items = core.concat(rest);
    var weights = core.map(function () { return 3; }).concat(rest.map(function () { return 1; }));

    var slot2 = weightedPickWithoutReplacement(items, weights, r);
    var slot3 = weightedPickWithoutReplacement(items, weights, r);

    return [
      formatItemText(slot1, d),
      formatItemText(slot2, d),
      formatItemText(slot3, d)
    ];
  }

  // --- TickTick habit due-today logic ---
  // TickTick repeatRule looks like "RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR,SA" or
  // "RRULE:FREQ=DAILY;INTERVAL=1". We honor BYDAY when present and exDates; INTERVAL beyond 1
  // is not evaluated (documented simplification — flag habits that need it to Geb on sight).
  function isDueToday(habit, d) {
    var stamp = dateStampYYYYMMDD(d);
    var exDates = habit.exDates || [];
    if (exDates.indexOf(stamp) !== -1 || exDates.indexOf(String(stamp)) !== -1) {
      return false;
    }
    var rule = habit.repeatRule;
    if (!rule) {
      return true;
    }
    var byDayMatch = /BYDAY=([A-Z,]+)/.exec(rule);
    if (byDayMatch) {
      var days = byDayMatch[1].split(",");
      return days.indexOf(DAY_ABBR[d.getDay()]) !== -1;
    }
    return true;
  }

  return {
    MONTHS: MONTHS,
    DAYS: DAYS,
    pad: pad,
    formatDateLine: formatDateLine,
    dateStampYYYYMMDD: dateStampYYYYMMDD,
    dailyKey: dailyKey,
    devotionsFocusFor: devotionsFocusFor,
    readingKeyFor: readingKeyFor,
    lookupReading: lookupReading,
    formatItemText: formatItemText,
    rng: rng,
    buildPools: buildPools,
    pickTodaysThree: pickTodaysThree,
    isDueToday: isDueToday
  };
});
