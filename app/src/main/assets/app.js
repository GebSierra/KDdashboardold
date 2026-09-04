/*
 * app.js — DOM wiring for the morning dashboard. Depends on core.js (window.BooxCore)
 * and, for the Habits section, the native `Android` JavascriptInterface bridge.
 */
(function () {
  "use strict";

  var C = window.BooxCore;
  var today = new Date();

  // ---------- local (non-TickTick) checkbox persistence ----------
  // Every plain checkbox persists per calendar day, so it resets naturally each morning.

  function localStore() {
    try {
      return window.localStorage;
    } catch (e) {
      return null;
    }
  }

  function wireLocalCheckbox(box, store, keyPrefix) {
    var storageKey = keyPrefix + box.id;
    try {
      if (store.getItem(storageKey) === "1") {
        box.checked = true;
      }
    } catch (e) { /* ignore */ }
    box.addEventListener("click", function () {
      try {
        store.setItem(storageKey, box.checked ? "1" : "0");
      } catch (e) { /* ignore */ }
    });
  }

  function wireAllLocalCheckboxes() {
    var store = localStore();
    if (!store) {
      return;
    }
    var keyPrefix = C.dailyKey(today) + "-";
    var boxes = document.querySelectorAll("input.box.local");
    for (var i = 0; i < boxes.length; i++) {
      wireLocalCheckbox(boxes[i], store, keyPrefix);
    }
  }

  // ---------- bridge: JS <-> Kotlin, via callback ids ----------

  var cbSeq = 0;
  var pending = {};

  window.__cb = function (id, jsonString) {
    var entry = pending[id];
    if (!entry) {
      return;
    }
    delete pending[id];
    try {
      entry.resolve(JSON.parse(jsonString));
    } catch (e) {
      entry.reject(e);
    }
  };

  function bridgeAvailable() {
    return !!window.Android;
  }

  function callBridge(method, args) {
    return new Promise(function (resolve, reject) {
      if (!bridgeAvailable() || typeof window.Android[method] !== "function") {
        reject(new Error("Bridge unavailable: " + method));
        return;
      }
      var id = "cb" + (++cbSeq);
      pending[id] = { resolve: resolve, reject: reject };
      var callArgs = args.slice();
      callArgs.push(id);
      window.Android[method].apply(window.Android, callArgs);
    });
  }

  function fetchHabits() {
    return callBridge("fetchHabits", []);
  }
  function fetchCheckins(idsCsv, from, to) {
    // The Kotlin side declares these as String params — the bridge does not
    // reliably coerce JS numbers to Java String, so stringify here.
    return callBridge("fetchCheckins", [idsCsv, String(from), String(to)]);
  }
  function doCheckin(habitId, stamp, value, goal, status) {
    return callBridge("checkin", [habitId, String(stamp), String(value), String(goal), String(status)]);
  }
  function hasToken() {
    return bridgeAvailable() && window.Android.hasToken();
  }
  function saveToken(token) {
    if (bridgeAvailable()) {
      window.Android.saveToken(token);
    }
  }
  function clearToken() {
    if (bridgeAvailable()) {
      window.Android.clearToken();
    }
  }

  // ---------- rendering: date, vision/mission, reading, devotions ----------

  function renderHeader() {
    var el = document.getElementById("today");
    if (el) {
      el.textContent = C.formatDateLine(today);
    }
  }

  function renderVisionMission(principles) {
    var v = document.getElementById("visionLine");
    if (v) {
      v.textContent = principles.vision;
    }
    var m = document.getElementById("mission");
    if (m) {
      var html = "";
      principles.mission.forEach(function (entry) {
        html += "<h3>" + escapeHtml(entry.heading) + "</h3>";
        entry.text.forEach(function (line) {
          html += "<p>" + escapeHtml(line) + "</p>";
        });
      });
      m.innerHTML = html;
    }
  }

  function renderReading(mcheyne) {
    var result = C.lookupReading(mcheyne, today);
    var leapNote = document.getElementById("leapNote");
    if (leapNote) {
      leapNote.hidden = !result.leapNote;
    }
    var rd = document.getElementById("reading");
    if (!rd) {
      return;
    }
    if (!result.passages) {
      rd.innerHTML = "<p class=\"note\">No reading found for today.</p>";
      return;
    }
    var html = "<ul class=\"chk\">";
    result.passages.forEach(function (passage, idx) {
      html += "<li><label><input type=\"checkbox\" class=\"box local\" id=\"r" + (idx + 1) + "\">" + escapeHtml(passage) + "</label></li>";
    });
    html += "</ul>";
    rd.innerHTML = html;
  }

  function renderDevotions() {
    var dv = document.getElementById("devotions");
    if (dv) {
      dv.textContent = "Devotions today: " + C.devotionsFocusFor(today);
    }
  }

  // ---------- today's three ----------

  function renderTodaysThree(principles) {
    var pe = document.getElementById("principles");
    if (!pe) {
      return;
    }
    var three = C.pickTodaysThree(principles, today);
    var html = "";
    three.forEach(function (item) {
      html += "<p class=\"pr\">" + escapeHtml(item) + "</p>";
    });
    pe.innerHTML = html;
  }

  // ---------- all principles (reference section) ----------

  function renderAllPrinciples(principles) {
    var container = document.getElementById("allPrinciples");
    if (!container) {
      return;
    }
    var html = "";

    html += "<ul class=\"epigraph\">";
    principles.header_quotes.forEach(function (q) {
      html += "<li>" + escapeHtml(C.formatItemText(q, today)) + "</li>";
    });
    html += "</ul>";

    principles.sections.forEach(function (section) {
      html += "<h3>" + escapeHtml(section.name) + "</h3><ul class=\"g\">";
      section.items.forEach(function (item) {
        html += "<li>" + escapeHtml(C.formatItemText(item, today)) + "</li>";
      });
      html += "</ul>";
    });

    html += "<h3>Wedding vows</h3><ul class=\"g\">";
    principles.wedding_vows.forEach(function (vow) {
      html += "<li>" + escapeHtml(vow) + "</li>";
    });
    html += "</ul>";

    container.innerHTML = html;

    var footer = document.getElementById("footer");
    if (footer) {
      footer.textContent = principles.footer;
    }
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // ---------- habits (live TickTick section) ----------

  var HABITS_CACHE_KEY = "cache_habits_v1";
  var CHECKINS_CACHE_KEY = "cache_checkins_v1";

  function readCache(key) {
    var store = localStore();
    if (!store) {
      return null;
    }
    try {
      var raw = store.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function writeCache(key, value) {
    var store = localStore();
    if (!store) {
      return;
    }
    try {
      store.setItem(key, JSON.stringify(value));
    } catch (e) { /* ignore */ }
  }

  function checkinStatusFor(checkinsResponse, habitId, stamp) {
    for (var i = 0; i < checkinsResponse.length; i++) {
      var entry = checkinsResponse[i];
      if (entry.habitId !== habitId) {
        continue;
      }
      var checks = entry.checkins || [];
      for (var j = 0; j < checks.length; j++) {
        if (checks[j].stamp === stamp) {
          return checks[j].status;
        }
      }
    }
    return 0;
  }

  function renderHabitsSection(dueHabits, checkinsResponse, stamp, offline) {
    var container = document.getElementById("habits");
    if (!container) {
      return;
    }
    if (offline) {
      container.innerHTML = "<p class=\"habit-msg offline\">Offline &mdash; showing last known</p>";
    } else {
      container.innerHTML = "";
    }

    if (dueHabits.length === 0) {
      container.innerHTML += "<p class=\"note\">No habits due today.</p>";
      return;
    }

    var list = document.createElement("ul");
    list.className = "chk";

    dueHabits.forEach(function (habit) {
      var li = document.createElement("li");
      var label = document.createElement("label");
      var box = document.createElement("input");
      box.type = "checkbox";
      box.className = "box";
      box.disabled = offline;
      box.checked = checkinStatusFor(checkinsResponse, habit.id, stamp) === 2;

      label.appendChild(box);
      label.appendChild(document.createTextNode(habit.name));
      li.appendChild(label);
      list.appendChild(li);

      if (!offline) {
        box.addEventListener("click", function () {
          onHabitToggle(habit, box, stamp);
        });
      }
    });

    container.appendChild(list);
  }

  function onHabitToggle(habit, box, stamp) {
    var completing = box.checked; // already flipped by the browser's default checkbox behavior
    var goal = habit.goal || 1;
    var value = completing ? goal : 0;
    var status = completing ? 2 : 0;

    doCheckin(habit.id, stamp, value, goal, status)
      .then(function (resp) {
        if (resp && resp.error) {
          throw new Error("HTTP " + resp.status);
        }
      })
      .catch(function () {
        box.checked = !completing; // revert
        showHabitMessage(habit.name + " didn't sync. Check your connection and try again.");
      });
  }

  function showHabitMessage(text) {
    var container = document.getElementById("habits");
    if (!container) {
      return;
    }
    var msg = document.createElement("p");
    msg.className = "habit-msg";
    msg.textContent = text;
    container.insertBefore(msg, container.firstChild);
    setTimeout(function () {
      if (msg.parentNode) {
        msg.parentNode.removeChild(msg);
      }
    }, 6000);
  }

  function loadHabits() {
    var container = document.getElementById("habits");
    if (!hasToken()) {
      if (container) {
        container.innerHTML = "<p class=\"note\">Connect TickTick in Settings (gear icon, top right) to see today's habits.</p>";
      }
      return;
    }

    var stamp = C.dateStampYYYYMMDD(today);

    fetchHabits()
      .then(function (habits) {
        if (habits && habits.error) {
          throw new Error("HTTP " + habits.status);
        }
        var due = habits.filter(function (h) {
          return !h.archivedTime && C.isDueToday(h, today);
        });
        var idsCsv = due.map(function (h) { return h.id; }).join(",");

        if (due.length === 0) {
          writeCache(HABITS_CACHE_KEY, due);
          writeCache(CHECKINS_CACHE_KEY, []);
          renderHabitsSection(due, [], stamp, false);
          return;
        }

        return fetchCheckins(idsCsv, stamp, stamp).then(function (checkins) {
          if (checkins && checkins.error) {
            throw new Error("HTTP " + checkins.status);
          }
          writeCache(HABITS_CACHE_KEY, due);
          writeCache(CHECKINS_CACHE_KEY, checkins);
          renderHabitsSection(due, checkins, stamp, false);
        });
      })
      .catch(function () {
        var cachedHabits = readCache(HABITS_CACHE_KEY);
        var cachedCheckins = readCache(CHECKINS_CACHE_KEY);
        if (cachedHabits) {
          renderHabitsSection(cachedHabits, cachedCheckins || [], stamp, true);
        } else if (container) {
          container.innerHTML = "<p class=\"habit-msg offline\">Couldn't reach TickTick, and there's no cached habit list yet.</p>";
        }
      });
  }

  // ---------- settings (behind the gear icon) ----------

  function refreshTokenStatus() {
    var status = document.getElementById("tokenStatus");
    if (status) {
      status.textContent = hasToken() ? "Token saved ✓" : "No token saved";
    }
  }

  function wireSettings() {
    var gearBtn = document.getElementById("gearBtn");
    var overlay = document.getElementById("settingsOverlay");
    var input = document.getElementById("tokenInput");
    var saveBtn = document.getElementById("saveTokenBtn");
    var clearBtn = document.getElementById("clearTokenBtn");
    var closeBtn = document.getElementById("closeSettingsBtn");

    if (!gearBtn || !overlay) {
      return;
    }

    gearBtn.addEventListener("click", function () {
      refreshTokenStatus();
      overlay.hidden = false;
    });
    closeBtn.addEventListener("click", function () {
      overlay.hidden = true;
    });
    saveBtn.addEventListener("click", function () {
      var token = input.value.trim();
      if (token) {
        saveToken(token);
      }
      input.value = "";
      refreshTokenStatus();
      loadHabits();
    });
    clearBtn.addEventListener("click", function () {
      clearToken();
      input.value = "";
      refreshTokenStatus();
      loadHabits();
    });
  }

  // ---------- boot ----------

  function run() {
    renderHeader();
    renderDevotions();
    wireSettings();

    Promise.all([
      fetch("mcheyne.json").then(function (r) { return r.json(); }),
      fetch("principles.json").then(function (r) { return r.json(); })
    ]).then(function (results) {
      var mcheyne = results[0];
      var principles = results[1];
      renderVisionMission(principles);
      renderReading(mcheyne);
      renderTodaysThree(principles);
      renderAllPrinciples(principles);
      // Wire local-checkbox persistence once every checkbox (including the
      // just-rendered reading row) is in the DOM.
      wireAllLocalCheckboxes();
    });

    loadHabits();
  }

  if (window.addEventListener) {
    window.addEventListener("load", run, false);
  } else {
    window.onload = run;
  }
})();
