/*
 * Plain-Node verification script (no dependencies). Run with:
 *   node scripts/test-core.js
 * Checks the acceptance criteria from BOOX_DASHBOARD_PLAN.md Section 9 that
 * can be verified without an Android device: reading-plan spot checks and
 * the 365-day "today's three" rotation simulation.
 */
var fs = require("fs");
var path = require("path");
var assert = require("assert");

var core = require(path.join(__dirname, "..", "app", "src", "main", "assets", "core.js"));
var mcheyne = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "app", "src", "main", "assets", "mcheyne.json"), "utf8"));
var principles = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "app", "src", "main", "assets", "principles.json"), "utf8"));

var failures = 0;
function check(name, cond) {
  if (cond) {
    console.log("PASS  " + name);
  } else {
    console.log("FAIL  " + name);
    failures++;
  }
}

// --- Reading plan spot checks (Section 9) ---
function readingOn(y, m, day) {
  var d = new Date(y, m - 1, day);
  return core.lookupReading(mcheyne, d).passages;
}

check("Jan 1 reading", JSON.stringify(readingOn(2026, 1, 1)) === JSON.stringify(["Gen 1", "Matt 1", "Ezra 1", "Acts 1"]));
check("Aug 11 reading", JSON.stringify(readingOn(2026, 8, 11)) === JSON.stringify(["1 Sam 1", "Rom 1", "Jer 39", "Ps 13-14"]));
check("Dec 8 reading (typo fixed to Lk 22)", JSON.stringify(readingOn(2026, 12, 8)) === JSON.stringify(["2 Chr 8", "3 Jn 1", "Hab 3", "Lk 22"]));
check("Dec 31 reading", JSON.stringify(readingOn(2026, 12, 31)) === JSON.stringify(["2 Chr 36", "Rev 22", "Mal 4", "Jn 21"]));

// Feb 29 falls back to Feb 28 with a note (2028 is a leap year)
var feb29 = core.lookupReading(mcheyne, new Date(2028, 1, 29));
check("Feb 29 falls back to Feb 28 reading", feb29.leapNote === true && JSON.stringify(feb29.passages) === JSON.stringify(readingOn(2026, 2, 28)));

// --- Devotions-by-weekday ---
check("Monday -> memorization", core.devotionsFocusFor(new Date(2026, 8, 7)) === "Memorization and prayer list"); // Sep 7 2026 is a Monday
check("Wednesday -> memorization", core.devotionsFocusFor(new Date(2026, 8, 9)) === "Memorization and prayer list"); // Sep 9 2026 is a Wednesday
check("Saturday -> add music", core.devotionsFocusFor(new Date(2026, 8, 5)) === "Bible reading plan, and add music"); // Sep 5 2026 is a Saturday
check("Tuesday -> plain reading plan", core.devotionsFocusFor(new Date(2026, 8, 8)) === "Bible reading plan"); // Sep 8 2026 is a Tuesday

// --- Today's three: 365-day simulation ---
var pools = core.buildPools(principles);
var coreSet = {};
pools.core.forEach(function (item) { coreSet[item] = true; });

var seenPerDay = [];
var coreSlots = 0;
var totalSlots = 0;
var slot1AlwaysCore = true;
var zeroInDayRepeats = true;
var appearanceCounts = {};
var allItems = pools.core.concat(pools.rest);
allItems.forEach(function (item) { appearanceCounts[item] = 0; });

for (var dayOfYear = 0; dayOfYear < 365; dayOfYear++) {
  var d = new Date(2026, 0, 1 + dayOfYear);
  var three = core.pickTodaysThree(principles, d);

  if (new Set(three).size !== 3) {
    zeroInDayRepeats = false;
  }

  // slot 1 should be a core item (compare against un-formatted text is tricky because of the
  // [today's date] substitution, so check membership loosely by stripping the substitution back out
  // isn't needed here since none of the core items contain the placeholder)
  if (!coreSet[three[0]]) {
    slot1AlwaysCore = false;
  }

  three.forEach(function (item, idx) {
    totalSlots++;
    // an item counts as "core" for share purposes if its (unsubstituted) text is in the core pool
    if (coreSet[item]) {
      coreSlots++;
    }
    if (appearanceCounts.hasOwnProperty(item)) {
      appearanceCounts[item]++;
    } else {
      // this is the one Inbox item with the date placeholder substituted in
      appearanceCounts[item] = (appearanceCounts[item] || 0) + 1;
    }
  });
}

check("365/365 days: zero in-day repeats", zeroInDayRepeats);
check("365/365 days: slot 1 is always a core item", slot1AlwaysCore);
var coreShare = coreSlots / totalSlots;
console.log("  core share = " + (coreShare * 100).toFixed(1) + "%");
check("core share between 45% and 55%", coreShare >= 0.45 && coreShare <= 0.55);

var surfaced = Object.keys(appearanceCounts).filter(function (k) { return appearanceCounts[k] > 0; }).length;
console.log("  " + surfaced + " / " + allItems.length + " eligible items surfaced in 365 days");
check("at least ~226 of 243 eligible items surface in a year", surfaced >= 220);

// --- Principle counts (used by the Android-side "All principles" render assertion) ---
var totalPrincipleItems = principles.sections.reduce(function (sum, s) { return sum + s.items.length; }, 0);
check("232 total principle items across sections", totalPrincipleItems === 232);
check("10 wedding vow paragraphs", principles.wedding_vows.length === 10);

console.log("");
if (failures > 0) {
  console.log(failures + " check(s) FAILED");
  process.exit(1);
} else {
  console.log("All checks passed.");
}
