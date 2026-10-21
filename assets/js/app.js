/* Tabuk Spartans — public dashboard.
   This script performs NO metric calculations. Every number comes precomputed
   from data/public.json, which the publisher generates from the workbook.
   The page only selects, sorts, searches and displays. */
(function () {
  "use strict";
  var CFG = window.TS_CONFIG || {};
  var TZ = CFG.TIME_ZONE || "Asia/Riyadh";
  var CACHE_KEY = "ts_public_cache_v1", FILTER_KEY = "ts_filters_v1";
  var DIMS = ["season", "format", "competition", "match_type"];
  var S = { data: null, filters: { season: "All", format: "All", competition: "All", match_type: "All" },
            lastOk: null, lastFail: null, fromCache: false, timer: null, charts: [], board: "contribution",
            loading: false };
  var $ = function (id) { return document.getElementById(id); };
  var view = $("view");

  // ------------------------------------------------------------------ utils
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function fmt(v, f) {
    if (v === null || v === undefined || v === "") return "—";
    if (f === "dec2") return Number(v).toFixed(2);
    if (f === "pct") return (Number(v) * 100).toFixed(1) + "%";
    return String(v);
  }
  function fmtDate(iso, opts) {
    if (!iso) return "";
    var d = new Date(iso + "T00:00:00Z");
    return d.toLocaleDateString("en-GB", Object.assign({ day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }, opts || {}));
  }
  function fmtStamp(iso) {
    if (!iso) return "—";
    var d = new Date(iso);
    try {
      return d.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: TZ }) + " (KSA)";
    } catch (e) { return d.toLocaleString(); }
  }
  function timeNow() {
    try { return new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: TZ }); }
    catch (e) { return new Date().toLocaleTimeString(); }
  }
  function initials(n) {
    var p = String(n || "?").trim().split(/\s+/);
    return ((p[0] || "?")[0] + (p.length > 1 ? p[p.length - 1][0] : "")).toUpperCase();
  }
  function store(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage unavailable */ } }
  function recall(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }

  // ------------------------------------------------------------------ data access
  function players() {
    var order = ["TS-P010", "TS-P008", "TS-P001", "TS-P002", "TS-P003", "TS-P004", "TS-P005", "TS-P006", "TS-P007", "TS-P009", "TS-P011", "TS-P012", "TS-P013", "TS-P014", "TS-P015", "TS-P016", "TS-P017"];
    return ((S.data && S.data.squad) || []).slice().sort(function (a, b) {
      var ai = order.indexOf(a.player_id), bi = order.indexOf(b.player_id);
      return (ai < 0 ? order.length : ai) - (bi < 0 ? order.length : bi);
    });
  }
  function player(id) { return players().find(function (p) { return p.player_id === id; }); }
  function match(id) { return (S.data.matches || []).find(function (m) { return m.match_id === id; }); }
  function viewKey() { return DIMS.map(function (d) { return S.filters[d]; }).join("||"); }
  function curView() { return S.data && S.data.views ? S.data.views[viewKey()] : null; }
  function filtersActive() { return DIMS.some(function (d) { return S.filters[d] !== "All"; }); }
  function filterLabel() {
    if (!filtersActive()) return "All matches";
    return DIMS.filter(function (d) { return S.filters[d] !== "All"; }).map(function (d) { return S.filters[d]; }).join(" · ");
  }
  var ZERO = { matches: 0, opportunities: 0, innings: 0, not_outs: 0, runs: 0, balls: 0, fours: 0, sixes: 0, hs: null,
    balls_bowled: 0, overs: "0", runs_conceded: 0, wickets: 0, maidens: 0, catches: 0, stumpings: 0, run_outs: 0,
    pts_bat: 0, pts_bowl: 0, pts_field: 0, pts_appear: 0, pts_total: 0, mvps: 0, avg: null, sr: null, econ: null, ppm: null,
    q_avg: false, q_sr: false, q_econ: false, q_ppm: false, ranks: {} };
  function pm(id, v) { v = v || curView(); return (v && v.players && v.players[id]) || ZERO; }
  function boardDef(key) { return S.data.rules.boards.find(function (b) { return b.key === key; }); }
  function qual(key) { var q = (S.data.rules.qualification || []).find(function (x) { return x.key === key; }); return q ? q.value : null; }
  function perfFor(matchId) { return (S.data.performances || []).filter(function (r) { return r.match_id === matchId; }); }

  function avatar(p, cls) {
    cls = cls || "";
    var inner = p && p.photo ? '<img src="' + esc(p.photo) + '" alt="" loading="lazy" onerror="this.parentNode.textContent=\'' + esc(initials(p.display_name)) + '\'">' : esc(initials(p ? p.display_name : "?"));
    return '<span class="av ' + cls + '" aria-hidden="true">' + inner + "</span>";
  }
  function plink(id) { var p = player(id); return p ? '<a href="#/player/' + esc(id) + '">' + esc(p.display_name) + "</a>" : esc(id); }
  function resCode(r) { return { Won: "W", Lost: "L", Tied: "T", "No Result": "N" }[r] || "N"; }
  function resChip(r, title) { return '<span class="res ' + resCode(r) + '" title="' + esc(title || r) + '">' + resCode(r) + "</span>"; }
  function evidenceBadge(s) { return s === "Verified scorecard" || s === "Verified scorecards" ? '<span class="badge ver">' + esc(s) + "</span>" : '<span class="badge pend">' + esc(s) + "</span>"; }

  // ------------------------------------------------------------------ charts
  function killCharts() { S.charts.forEach(function (c) { try { c.destroy(); } catch (e) {} }); S.charts = []; }
  function chart(el, cfg) {
    if (!el) return;
    if (!window.Chart) { el.innerHTML = '<div class="chart-fallback">Chart could not load — the figures are in the tables.</div>'; return; }
    var cv = document.createElement("canvas"); el.innerHTML = ""; el.appendChild(cv);
    Chart.defaults.color = "#a5b5d4"; Chart.defaults.font.family = "Inter, system-ui, sans-serif"; Chart.defaults.borderColor = "rgba(150,180,240,.12)";
    cfg.options = Object.assign({ responsive: true, maintainAspectRatio: false, animation: { duration: 700 },
      plugins: { legend: { labels: { boxWidth: 12, boxHeight: 12, usePointStyle: true } } } }, cfg.options || {});
    S.charts.push(new Chart(cv, cfg));
  }
  var COLORS = { bat: "#5b8cff", bowl: "#c9a227", field: "#3fd08f", appear: "#7487ad" };

  // ------------------------------------------------------------------ loading
  function setBanner(kind, html, retry) {
    var b = $("banner");
    if (!kind) { b.hidden = true; b.innerHTML = ""; return; }
    b.className = "banner " + kind; b.hidden = false;
    b.innerHTML = '<span>' + html + "</span>" + (retry ? '<button type="button" id="bannerRetry">Try again</button>' : "");
    var r = $("bannerRetry"); if (r) r.onclick = function () { load(true); };
  }
  function valid(d) { return d && d.meta && d.rules && d.views && Array.isArray(d.squad) && Array.isArray(d.matches); }

  function load(manual) {
    if (S.loading) return;
    S.loading = true;
    $("refreshBtn").classList.add("spin");
    var url = (CFG.DATA_URL || "data/public.json");
    url += (url.indexOf("?") < 0 ? "?" : "&") + "t=" + Date.now();
    var ctl = window.AbortController ? new AbortController() : null;
    var to = setTimeout(function () { if (ctl) ctl.abort(); }, 15000);
    fetch(url, { cache: "no-store", signal: ctl ? ctl.signal : undefined })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.text(); })
      .then(function (txt) {
        var d = JSON.parse(txt);
        if (!valid(d)) throw new Error("Unexpected data format");
        var changed = !S.data || S.data.meta.data_version !== d.meta.data_version || S.fromCache;
        S.data = d; S.lastOk = new Date(); S.lastFail = null; S.fromCache = false;
        store(CACHE_KEY, txt);
        setBanner(null);
        if (changed) { buildFilters(); route(); }
        updateMeta();
        schedule();
      })
      .catch(function (err) {
        S.lastFail = new Date();
        if (!S.data) {
          var c = recall(CACHE_KEY);
          if (c) { try { var d = JSON.parse(c); if (valid(d)) { S.data = d; S.fromCache = true; buildFilters(); route(); updateMeta(); } } catch (e) {} }
        }
        if (S.data) {
          setBanner("warn", "Couldn't refresh at " + esc(timeNow()) + ". Showing the last successful data, published <b>" + esc(fmtStamp(S.data.meta.published_at)) + "</b>.", true);
          schedule();
        } else {
          renderState("error");
        }
      })
      .then(function () { clearTimeout(to); S.loading = false; $("refreshBtn").classList.remove("spin"); });
  }
  function schedule() {
    clearInterval(S.timer);
    var m = S.data && S.data.meta.refresh_minutes != null ? Number(S.data.meta.refresh_minutes) : Number(CFG.DEFAULT_REFRESH_MINUTES || 5);
    if (m > 0) S.timer = setInterval(function () { if (!document.hidden) load(false); }, m * 60000);
  }
  function updateMeta() {
    $("pubTime").textContent = fmtStamp(S.data.meta.published_at);
    $("dataVersion").textContent = "Data " + S.data.meta.data_version + " · published " + fmtStamp(S.data.meta.published_at);
  }

  // ------------------------------------------------------------------ filters
  function buildFilters() {
    var f = S.data.filters || {};
    var saved = {}; try { saved = JSON.parse(recall(FILTER_KEY) || "{}"); } catch (e) {}
    var map = { season: "fSeason", format: "fFormat", competition: "fComp", match_type: "fType" };
    DIMS.forEach(function (d) {
      var opts = ["All"].concat(f[d] || []);
      var cur = S.filters[d] !== "All" ? S.filters[d] : (saved[d] || "All");
      if (opts.indexOf(cur) < 0) cur = "All";
      S.filters[d] = cur;
      $(map[d]).innerHTML = opts.map(function (o) { return "<option" + (o === cur ? " selected" : "") + ">" + esc(o) + "</option>"; }).join("");
    });
    $("filtersWrap").hidden = !(S.data.matches || []).length;
    $("filters").classList.toggle("active", filtersActive());
  }
  function onFilter() {
    S.filters = { season: $("fSeason").value, format: $("fFormat").value, competition: $("fComp").value, match_type: $("fType").value };
    store(FILTER_KEY, JSON.stringify(S.filters));
    $("filters").classList.toggle("active", filtersActive());
    route();
  }
  function resetFilters() { DIMS.forEach(function (d) { S.filters[d] = "All"; }); store(FILTER_KEY, "{}"); buildFilters(); route(); }

  // ------------------------------------------------------------------ router
  function parseHash() {
    var h = location.hash.replace(/^#\/?/, "") || "overview";
    var q = {}, parts = h.split("?");
    (parts[1] || "").split("&").forEach(function (kv) { if (kv) { var a = kv.split("="); q[decodeURIComponent(a[0])] = decodeURIComponent(a[1] || ""); } });
    var seg = parts[0].split("/");
    return { page: seg[0], id: seg[1] ? decodeURIComponent(seg[1]) : null, q: q };
  }
  function route() {
    if (!S.data) return;
    var r = parseHash();
    killCharts();
    document.querySelectorAll("[data-nav]").forEach(function (a) {
      var on = a.getAttribute("data-nav") === r.page || (r.page === "player" && a.getAttribute("data-nav") === "players") || (r.page === "match" && a.getAttribute("data-nav") === "matches");
      a.classList.toggle("on", on);
      if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
    var pages = { overview: pOverview, leaders: pLeaders, players: pPlayers, player: pPlayer, matches: pMatches, match: pMatch, compare: pCompare, rules: pRules };
    (pages[r.page] || pOverview)(r);
    view.classList.remove("fade"); void view.offsetWidth; view.classList.add("fade");
  }
  function needMatches() {
    if (!(S.data.matches || []).length) {
      view.innerHTML = emptyHTML("No matches recorded yet", "Results, leaderboards and player statistics will appear here after the first match is published.");
      return false;
    }
    if (!curView()) {
      view.innerHTML = emptyHTML("No matches for this selection", "Try a different season, format, competition or match type.", true);
      var b = $("emptyReset"); if (b) b.onclick = resetFilters;
      return false;
    }
    return true;
  }
  function emptyHTML(t, s, reset) {
    return '<div class="card empty"><div class="ico"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M8 12h8M12 8v8" opacity=".0"/><path d="M5.5 6.5c3 2 3 9 0 11M18.5 6.5c-3 2-3 9 0 11"/></svg></div><h2>' + esc(t) + '</h2><p class="muted">' + esc(s) + "</p>" + (reset ? '<button class="btn ghost" id="emptyReset" type="button">Show all matches</button>' : "") + "</div>";
  }
  function renderState(kind) {
    if (kind === "loading") {
      view.innerHTML = '<div class="hero skel" style="height:190px"></div><div class="grid g3"><div class="skel" style="height:220px"></div><div class="skel" style="height:220px"></div><div class="skel" style="height:220px"></div></div>';
    } else {
      view.innerHTML = '<div class="card state"><div class="ico">!</div><h2>Can\'t load the team data</h2><p class="muted">Check your connection and try again. If this keeps happening, the data may not have been published yet.</p><button class="btn" id="retryBtn" type="button">Try again</button></div>';
      $("retryBtn").onclick = function () { renderState("loading"); load(true); };
    }
  }

  // ------------------------------------------------------------------ components
  function boardRows(key, v, limit, withUnq) {
    var b = boardDef(key), list = (v.boards[key] || []);
    var shown = limit ? list.slice(0, limit) : list;
    if (!shown.length && !withUnq) return '<p class="muted small">No qualifying players yet.</p>';
    var max = Math.max.apply(null, list.map(function (e) { return Math.abs(e.value); }).concat([1]));
    var html = shown.map(function (e) {
      var p = player(e.player_id) || { display_name: e.player_id };
      var pct = b.direction === "asc" ? Math.max(8, 100 * (Math.min.apply(null, list.map(function (x) { return x.value; })) || 1) / (e.value || 1)) : Math.max(4, 100 * Math.abs(e.value) / max);
      return '<div class="rowp' + (e.rank === 1 ? " lead" : "") + '"><span class="rk">' + e.rank + "</span>" + avatar(p, "sm") +
        '<div style="min-width:0"><div class="nm">' + plink(e.player_id) + '</div><div class="bar"><i style="width:' + pct.toFixed(1) + '%"></i></div></div><span class="val">' + fmt(e.value, b.format) + "</span></div>";
    }).join("");
    if (!shown.length) html = '<p class="muted small">No qualifying players yet.</p>';
    if (withUnq && b.eligibility.indexOf("q_") === 0) {
      var have = {}; list.forEach(function (e) { have[e.player_id] = 1; });
      var unq = players().filter(function (p) { var m = pm(p.player_id, v); return !have[p.player_id] && m.matches > 0 && m[b.metric] != null; });
      unq.sort(function (a, c) { var x = pm(a.player_id, v)[b.metric], y = pm(c.player_id, v)[b.metric]; return b.direction === "asc" ? x - y : y - x; });
      if (unq.length) {
        html += '<div class="unq-title">Not yet qualified · ' + esc(qualText(b.eligibility)) + "</div>";
        html += unq.map(function (p) {
          var m = pm(p.player_id, v);
          return '<div class="rowp unq"><span class="rk">–</span>' + avatar(p, "sm") + '<div style="min-width:0"><div class="nm">' + plink(p.player_id) + '</div><div class="small dim">' + esc(progressText(b.eligibility, m)) + '</div></div><span class="val">' + fmt(m[b.metric], b.format) + "</span></div>";
        }).join("");
      }
    }
    return html;
  }
  function qualText(e) {
    if (e === "q_avg") return "minimum " + qual("Q_AVG_INNS") + " innings and dismissed at least once";
    if (e === "q_sr") return "minimum " + qual("Q_SR_BALLS") + " balls faced";
    if (e === "q_econ") return "minimum " + overs(qual("Q_EC_BALLS")) + " overs bowled";
    if (e === "q_ppm") return "minimum " + qual("Q_PPM_MATCHES") + " matches";
    return "";
  }
  function overs(b) { b = Number(b || 0); return b % 6 ? Math.floor(b / 6) + "." + (b % 6) : String(b / 6); }
  function progressText(e, m) {
    if (e === "q_avg") return m.innings + " of " + qual("Q_AVG_INNS") + " innings" + (m.innings - m.not_outs === 0 ? ", not yet dismissed" : "");
    if (e === "q_sr") return m.balls + " of " + qual("Q_SR_BALLS") + " balls";
    if (e === "q_econ") return m.overs + " of " + overs(qual("Q_EC_BALLS")) + " overs";
    if (e === "q_ppm") return m.matches + " of " + qual("Q_PPM_MATCHES") + " matches";
    return "";
  }
  function qmark(m, f) { return m[f] ? "" : ' <span class="q" title="Below the qualification minimum">†</span>'; }

  function mountTable(el, cols, rows, sortKey, sortDir) {
    var st = { k: sortKey, d: sortDir || "desc" };
    function val(r, c) { var v = c.sortVal ? c.sortVal(r) : r[c.key]; return v == null ? -Infinity : v; }
    function draw() {
      var c = cols.find(function (x) { return x.key === st.k; });
      var sorted = rows.slice();
      if (c) sorted.sort(function (a, b) {
        var x = val(a, c), y = val(b, c);
        if (typeof x === "string" || typeof y === "string") { x = String(x).toLowerCase(); y = String(y).toLowerCase(); return st.d === "asc" ? (x < y ? -1 : x > y ? 1 : 0) : (x > y ? -1 : x < y ? 1 : 0); }
        if (st.d === "asc") { if (x === -Infinity) return 1; if (y === -Infinity) return -1; return x - y; }
        return y - x;
      });
      el.innerHTML = '<div class="tbl-wrap"><table class="t"><thead><tr>' + cols.map(function (c) {
        var cls = [c.l ? "l" : "", c.nosort ? "" : "sort", st.k === c.key ? st.d : ""].join(" ");
        return '<th scope="col" class="' + cls + '" data-k="' + c.key + '"' + (c.title ? ' title="' + esc(c.title) + '"' : "") + (c.nosort ? "" : ' tabindex="0" aria-sort="' + (st.k === c.key ? (st.d === "asc" ? "ascending" : "descending") : "none") + '"') + ">" + esc(c.label) + "</th>";
      }).join("") + "</tr></thead><tbody>" + (sorted.length ? sorted.map(function (r) {
        return "<tr" + (r._cls ? ' class="' + r._cls + '"' : "") + ">" + cols.map(function (c) {
          return '<td class="' + (c.l ? "l " : "") + (c.strong ? "strong" : "") + '">' + (c.render ? c.render(r) : esc(fmt(r[c.key], c.fmt))) + "</td>";
        }).join("") + "</tr>";
      }).join("") : '<tr><td colspan="' + cols.length + '" class="l muted">Nothing to show.</td></tr>') + "</tbody></table></div>";
      el.querySelectorAll("th.sort").forEach(function (th) {
        var go = function () { var k = th.getAttribute("data-k"); if (st.k === k) st.d = st.d === "asc" ? "desc" : "asc"; else { st.k = k; var cc = cols.find(function (x) { return x.key === k; }); st.d = cc && cc.asc ? "asc" : "desc"; } draw(); };
        th.onclick = go; th.onkeydown = function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } };
      });
    }
    draw();
  }

  // ------------------------------------------------------------------ pages
  function pOverview() {
    var meta = S.data.meta, ms = S.data.matches || [];
    var hero = '<section class="hero"><div class="eyebrow">' + (ms.length ? esc(filterLabel()) : "Season dashboard") + '</div><h1>Tabuk <span>Spartans</span></h1><div class="tag">' + esc(meta.tagline || "") + "</div>";
    if (!ms.length) {
      view.innerHTML = hero + '<div class="record"><div class="stat"><div class="k">Played</div><div class="v">0</div></div></div></section>' +
        emptyHTML("No matches recorded yet", "Results, leaderboards and player statistics will appear here after the first match is published.") +
        squadStrip();
      return;
    }
    var v = curView();
    if (!v) { view.innerHTML = hero + "</section>"; view.innerHTML += emptyHTML("No matches for this selection", "Try a different season, format, competition or match type.", true); $("emptyReset").onclick = resetFilters; return; }
    var t = v.team;
    hero += '<div class="record">' +
      stat("Played", t.played) + stat("Won", t.won, "win") + stat("Lost", t.lost, "loss") + stat("Tied", t.tied, "tie") + stat("No result", t.no_result, "nr") +
      '<div class="stat big"><div class="k">Win %</div><div class="v">' + fmt(t.win_pct, "pct") + '</div><div class="x">(' + t.won + " + ½×" + t.tied + ") ÷ " + t.win_pct_denominator + " decided</div></div></div></section>";

    var ids = v.match_ids, latest = match(ids[ids.length - 1]);
    var recent = ids.slice(-5).map(match);
    var lead = (v.boards.contribution || []).filter(function (e) { return e.rank === 1; });
    var html = hero + '<div class="grid g3">';
    html += '<section class="card span2"><div class="card-head"><h3>Latest match</h3><a href="#/match/' + esc(latest.match_id) + '">Scorecard →</a></div>' + latestBlock(latest) + "</section>";
    html += '<section class="card"><div class="card-head"><h3>Contribution leader</h3><a href="#/leaders">All boards →</a></div>' +
      (lead.length ? lead.map(function (e) { var p = player(e.player_id), m = pm(e.player_id, v);
        return '<div class="profile-head" style="margin-bottom:10px">' + avatar(p, "lg") + '<div><div class="nm" style="font-size:17px">' + plink(e.player_id) + '</div><div class="small muted">' + esc(p.role || "") + '</div></div></div><div class="kv"><div><span>Points</span><b class="gold">' + m.pts_total + "</b></div><div><span>Per match</span><b>" + fmt(m.ppm, "dec2") + qmark(m, "q_ppm") + "</b></div><div><span>MVPs</span><b>" + m.mvps + "</b></div></div>"; }).join('<hr class="sep">') +
        (lead.length > 1 ? '<p class="small muted" style="margin:8px 0 0">Tied for first.</p>' : "")
        : '<p class="muted">No contributions yet.</p>') + "</section>";
    html += "</div>";

    html += '<div class="grid g3" style="margin-top:14px">';
    html += '<section class="card"><div class="card-head"><h3>Recent results</h3><a href="#/matches">All matches →</a></div><div class="recent">' +
      recent.slice().reverse().map(function (m) { return '<a href="#/match/' + esc(m.match_id) + '" title="' + esc(m.result + " vs " + m.opponent + ", " + fmtDate(m.date)) + '" style="text-decoration:none">' + resChip(m.result, m.result + " vs " + m.opponent) + "</a>"; }).join("") +
      '</div><div style="margin-top:12px">' + recent.slice().reverse().map(function (m) {
        return '<div class="rowp" style="display:flex;justify-content:space-between;gap:8px;padding:6px 0;border-bottom:1px solid var(--line)"><span class="small"><b>' + esc(m.opponent) + '</b> <span class="dim">· ' + esc(fmtDate(m.date, { year: undefined })) + '</span></span><span class="small ' + ({ W: "win", L: "loss", T: "tie", N: "nr" })[resCode(m.result)] + '">' + esc(m.result) + "</span></div>"; }).join("") + "</div></section>";
    ["runs", "wickets"].forEach(function (k) {
      html += '<section class="card board"><div class="card-head"><h3>' + esc(boardDef(k).label) + '</h3><a href="#/leaders?b=' + k + '">More →</a></div>' + boardRows(k, v, 5) + "</section>";
    });
    html += "</div>";
    html += '<div class="grid g3" style="margin-top:14px"><section class="card span2"><div class="card-head"><h3>Where the points come from</h3><span class="small dim">Top 8 · contribution points</span></div><div class="chart-box tall" id="chTop"></div></section>' +
      '<section class="card board"><div class="card-head"><h3>Match MVP awards</h3><a href="#/leaders?b=mvps">More →</a></div>' + boardRows("mvps", v, 6) + "</section></div>";
    view.innerHTML = html;

    var top = (v.boards.contribution || []).slice(0, 8);
    chart($("chTop"), { type: "bar", data: { labels: top.map(function (e) { return player(e.player_id).display_name; }),
      datasets: [["Batting", "pts_bat", "bat"], ["Bowling", "pts_bowl", "bowl"], ["Fielding", "pts_field", "field"], ["Appearance", "pts_appear", "appear"]].map(function (d) {
        return { label: d[0], data: top.map(function (e) { return pm(e.player_id, v)[d[1]]; }), backgroundColor: COLORS[d[2]], borderRadius: 4, maxBarThickness: 22 }; }) },
      options: { indexAxis: "y", scales: { x: { stacked: true, grid: { color: "rgba(150,180,240,.08)" } }, y: { stacked: true, grid: { display: false } } } } });
  }
  function stat(k, v, cls) { return '<div class="stat"><div class="k">' + esc(k) + '</div><div class="v ' + (cls || "") + '">' + esc(v) + "</div></div>"; }
  function latestBlock(m, onMatchPage) {
    var mvp = m.mvp && m.mvp.player_ids.length ? m.mvp.player_ids : [];
    return '<div class="vs"><div><div class="team">Tabuk Spartans</div><div class="sc">' + esc(m.ts_score || "—") + '</div></div><div class="mid">VS</div><div><div class="team">' + esc(m.opponent) + '</div><div class="sc">' + esc(m.opp_score || "—") + "</div></div></div>" +
      '<div style="text-align:center;margin-bottom:10px">' + resChip(m.result) + ' <b class="' + ({ W: "win", L: "loss", T: "tie", N: "nr" })[resCode(m.result)] + '">' + esc(m.result) + (m.result_note ? " " + esc(m.result_note) : "") + '</b><div class="small muted">' + esc(fmtDate(m.date, { weekday: "short" })) + " · " + esc(m.competition) + " · " + esc(m.format) + (m.venue ? " · " + esc(m.venue) : "") + "</div></div>" +
      (m.summary ? '<p class="muted" style="margin:0 0 10px">' + esc(m.summary) + "</p>" : "") +
      (mvp.length ? '<div class="mvp-line"><span class="badge mvp">' + (mvp.length > 1 ? "Joint MVPs" : "Match MVP") + "</span>" + mvp.map(function (id) { return '<span class="pcell">' + avatar(player(id), "sm") + plink(id) + "</span>"; }).join("") + '<span class="small dim">' + m.mvp.points + " pts</span></div>" : "") +
      (onMatchPage ? "" : '<div style="margin-top:10px">' + evidenceBadge(m.evidence) + "</div>");
  }
  function squadStrip() {
    if (!players().length) return "";
    return '<section class="card" style="margin-top:14px"><div class="card-head"><h3>The squad</h3><a href="#/players">Players →</a></div><div class="recent">' +
      players().map(function (p) { return '<a class="chip" href="#/player/' + esc(p.player_id) + '">' + esc(p.display_name) + "</a>"; }).join("") + "</div></section>";
  }

  function pLeaders(r) {
    if (!needMatches()) return;
    var v = curView();
    if (r.q.b && boardDef(r.q.b)) S.board = r.q.b;
    var b = boardDef(S.board);
    var html = '<div class="page-head"><div><div class="eyebrow">' + esc(filterLabel()) + '</div><h1>Leaderboards</h1><p class="sub">Ties share a rank and are listed alphabetically.</p></div></div>';
    html += '<div class="tabs" role="tablist">' + S.data.rules.boards.map(function (x) { return '<button type="button" role="tab" aria-selected="' + (x.key === S.board) + '" class="' + (x.key === S.board ? "on" : "") + '" data-b="' + x.key + '">' + esc(x.label) + "</button>"; }).join("") + "</div>";
    html += '<div class="grid g3"><section class="card board span2"><div class="card-head"><h3>' + esc(b.label) + '</h3><span class="small dim">' + esc(boardNote(b)) + "</span></div>" + boardRows(b.key, v, 0, true) + "</section>";
    html += '<section class="card board"><div class="card-head"><h3>Contribution per match</h3></div>' + boardRows("ppm", v, 5, false) + '<p class="small dim" style="margin:10px 0 0">' + esc(qualText("q_ppm")) + "</p></section></div>";
    html += '<section class="card" style="margin-top:14px"><div class="card-head"><h3>All players</h3><input type="search" id="tblSearch" placeholder="Search player…" aria-label="Search players" style="max-width:240px"></div><div id="allTbl"></div><p class="small dim" style="margin:8px 0 0">† below the qualification minimum — shown for reference, not ranked.</p></section>';
    view.innerHTML = html;
    view.querySelectorAll(".tabs button").forEach(function (bt) { bt.onclick = function () { S.board = bt.getAttribute("data-b"); history.replaceState(null, "", "#/leaders?b=" + S.board); route(); }; });
    var rows = players().map(function (p) { var m = pm(p.player_id, v); return Object.assign({ name: p.display_name, id: p.player_id, p: p }, m); });
    var cols = [
      { key: "name", label: "Player", l: true, asc: true, render: function (r) { return '<span class="pcell">' + avatar(r.p, "sm") + plink(r.id) + "</span>"; } },
      { key: "matches", label: "M" }, { key: "pts_total", label: "Pts", strong: true },
      { key: "ppm", label: "Pts/M", render: function (r) { return fmt(r.ppm, "dec2") + qmark(r, "q_ppm"); } },
      { key: "runs", label: "Runs" }, { key: "avg", label: "Avg", render: function (r) { return fmt(r.avg, "dec2") + (r.avg != null ? qmark(r, "q_avg") : ""); } },
      { key: "sr", label: "SR", render: function (r) { return fmt(r.sr, "dec2") + (r.sr != null ? qmark(r, "q_sr") : ""); } },
      { key: "wickets", label: "Wkts" }, { key: "econ", label: "Econ", asc: true, render: function (r) { return fmt(r.econ, "dec2") + (r.econ != null ? qmark(r, "q_econ") : ""); } },
      { key: "pts_field", label: "Field pts" }, { key: "mvps", label: "MVP" }];
    var draw = function () { var q = ($("tblSearch").value || "").toLowerCase(); mountTable($("allTbl"), cols, rows.filter(function (x) { return x.name.toLowerCase().indexOf(q) >= 0; }), "pts_total", "desc"); };
    $("tblSearch").oninput = draw; draw();
  }
  function boardNote(b) {
    var notes = { contribution: "Total contribution points", ppm: "Points ÷ matches played", runs: "Total runs", wickets: "Total wickets",
      avg: "Runs ÷ dismissals", sr: "Runs per 100 balls", econ: "Runs conceded per over · lower is better", fielding: "Catches, stumpings and run outs", mvps: "Matches as top contributor (ties count)" };
    return notes[b.key] || "";
  }

  function pPlayers() {
    var v = curView() || { players: {} };
    var html = '<div class="page-head"><div><div class="eyebrow">' + esc((S.data.matches || []).length ? filterLabel() : "Squad") + '</div><h1>Players</h1><p class="sub">' + players().length + ' players · tap a player for their full profile.</p></div></div>' +
      '<div class="searchbar"><input type="search" id="pSearch" placeholder="Search player…" aria-label="Search players"><select id="pSort" aria-label="Sort players" style="max-width:220px"><option value="name">Sort: team order</option><option value="pts_total">Sort: contribution</option><option value="runs">Sort: runs</option><option value="wickets">Sort: wickets</option><option value="matches">Sort: matches</option></select></div><div class="pcards" id="pGrid"></div>';
    view.innerHTML = html;
    var draw = function () {
      var q = $("pSearch").value.toLowerCase(), s = $("pSort").value;
      var list = players().filter(function (p) { return p.display_name.toLowerCase().indexOf(q) >= 0; });
      if (s !== "name") list.sort(function (a, b) { return pm(b.player_id, v)[s] - pm(a.player_id, v)[s] || a.display_name.localeCompare(b.display_name); });
      $("pGrid").innerHTML = list.length ? list.map(function (p) {
        var m = pm(p.player_id, v);
        return '<a class="card pcard" href="#/player/' + esc(p.player_id) + '"><div class="pc-top">' + avatar(p, "lg") + '<div style="min-width:0"><div class="name">' + esc(p.display_name) + (p.tag ? ' <span class="badge tag">' + esc(p.tag) + "</span>" : "") + '</div><div class="role">' + esc(p.role || "") + (p.shirt_number != null ? " · #" + esc(p.shirt_number) : "") + "</div></div></div>" +
          '<div class="mini"><div><b>' + m.matches + '</b><span>Mat</span></div><div><b>' + m.runs + '</b><span>Runs</span></div><div><b>' + m.wickets + '</b><span>Wkts</span></div><div><b class="gold">' + m.pts_total + "</b><span>Pts</span></div></div></a>";
      }).join("") : '<p class="muted">No players match “' + esc(q) + "”.</p>";
    };
    $("pSearch").oninput = draw; $("pSort").onchange = draw; draw();
  }

  function pPlayer(r) {
    var p = player(r.id);
    if (!p) { view.innerHTML = emptyHTML("Player not found", "This player isn't on the public squad list."); return; }
    var v = curView(), m = pm(p.player_id, v), hasM = (S.data.matches || []).length > 0;
    var ranks = m.ranks || {};
    var rankChips = S.data.rules.boards.filter(function (b) { return ranks[b.key]; }).map(function (b) { return '<span class="chip">#' + ranks[b.key] + " " + esc(b.label) + "</span>"; }).join(" ");
    var html = '<div class="page-head"><div class="profile-head">' + avatar(p, "xl") + '<div><div class="eyebrow">' + esc(hasM ? filterLabel() : "Player profile") + '</div><h1>' + esc(p.display_name) + '</h1><p class="sub">' + esc(p.role || "") + (p.tag ? ' · <span class="badge tag">' + esc(p.tag) + "</span>" : "") + (p.shirt_number != null ? " · #" + esc(p.shirt_number) : "") + '</p><div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">' + evidenceBadge(p.evidence || "No matches recorded") + " " + rankChips + "</div></div></div></div>";
    if (!m.matches) {
      view.innerHTML = html + emptyHTML(hasM ? "No matches in this selection" : "No matches recorded yet", hasM ? "This player has no recorded matches for the current filters." : "Statistics appear after the first published match.");
      return;
    }
    html += '<div class="kv" style="margin-bottom:14px">' + kv("Matches", m.matches) + kv("Opportunities", m.opportunities, "batted or bowled") + kv("Contribution", m.pts_total) + kv("Per match", fmt(m.ppm, "dec2"), m.q_ppm ? "" : "† " + progressText("q_ppm", m)) + kv("MVP awards", m.mvps) + "</div>";
    html += '<div class="grid g3"><section class="card"><div class="card-head"><h3>Batting</h3></div><div class="kv">' + kv("Innings", m.innings) + kv("Not outs", m.not_outs) + kv("Runs", m.runs) + kv("High score", m.hs == null ? "—" : m.hs + (m.hs_not_out ? "*" : "")) +
      kv("Average", fmt(m.avg, "dec2"), m.avg != null && !m.q_avg ? "† " + progressText("q_avg", m) : "") + kv("Strike rate", fmt(m.sr, "dec2"), m.sr != null && !m.q_sr ? "† " + progressText("q_sr", m) : "") + kv("Fours", m.fours) + kv("Sixes", m.sixes) + "</div></section>";
    html += '<section class="card"><div class="card-head"><h3>Bowling</h3></div><div class="kv">' + kv("Overs", m.overs) + kv("Wickets", m.wickets) + kv("Runs conceded", m.runs_conceded) + kv("Economy", fmt(m.econ, "dec2"), m.econ != null && !m.q_econ ? "† " + progressText("q_econ", m) : "") + kv("Maidens", m.maidens) + "</div></section>";
    html += '<section class="card"><div class="card-head"><h3>Fielding</h3></div><div class="kv">' + kv("Catches", m.catches) + kv("Stumpings", m.stumpings) + kv("Run outs", m.run_outs) + kv("Field pts", m.pts_field) + "</div></section></div>";
    html += '<div class="grid g3" style="margin-top:14px"><section class="card"><div class="card-head"><h3>Contribution breakdown</h3></div><div class="chart-box" id="chBreak"></div></section><section class="card span2"><div class="card-head"><h3>Recent form</h3><span class="small dim">Last ' + (S.data.meta.recent_n || 5) + ' matches · points</span></div><div class="chart-box" id="chForm"></div></section></div>';
    html += '<section class="card" style="margin-top:14px"><div class="card-head"><h3>Match by match</h3></div><div id="logTbl"></div></section>';
    view.innerHTML = html;

    chart($("chBreak"), { type: "doughnut", data: { labels: ["Batting", "Bowling", "Fielding", "Appearance"], datasets: [{ data: [m.pts_bat, m.pts_bowl, m.pts_field, m.pts_appear].map(function (x) { return Math.max(0, x); }), backgroundColor: [COLORS.bat, COLORS.bowl, COLORS.field, COLORS.appear], borderColor: "#0c2152", borderWidth: 2 }] }, options: { cutout: "62%", plugins: { legend: { position: "bottom" } } } });
    var mine = (S.data.performances || []).filter(function (x) { return x.player_id === p.player_id && v.match_ids.indexOf(x.match_id) >= 0; });
    mine.sort(function (a, b) { return v.match_ids.indexOf(a.match_id) - v.match_ids.indexOf(b.match_id); });
    var last = mine.slice(-(S.data.meta.recent_n || 5));
    chart($("chForm"), { type: "bar", data: { labels: last.map(function (x) { var mm = match(x.match_id); return "vs " + mm.opponent; }),
      datasets: [{ label: "Points", data: last.map(function (x) { return x.pts.total; }), backgroundColor: last.map(function (x) { return x.mvp ? "#c9a227" : "#5b8cff"; }), borderRadius: 6, maxBarThickness: 46 }] },
      options: { plugins: { legend: { display: false }, tooltip: { callbacks: { afterLabel: function (c) { return last[c.dataIndex].mvp ? "Match MVP" : ""; } } } }, scales: { y: { beginAtZero: true }, x: { grid: { display: false } } } } });
    var rows = mine.map(function (x) { var mm = match(x.match_id); return Object.assign({ date: mm.date, opp: mm.opponent, res: mm.result }, x); });
    mountTable($("logTbl"), [
      { key: "date", label: "Date", l: true, render: function (x) { return '<a href="#/match/' + esc(x.match_id) + '">' + esc(fmtDate(x.date)) + "</a>"; } },
      { key: "opp", label: "Opponent", l: true, render: function (x) { return esc(x.opp); } },
      { key: "res", label: "Res", render: function (x) { return resChip(x.res); } },
      { key: "runs", label: "Bat", render: function (x) { return x.batted ? x.runs + (x.not_out ? "*" : "") + " (" + x.balls + ")" : "—"; } },
      { key: "wickets", label: "Bowl", render: function (x) { return x.balls_bowled ? x.wickets + "-" + x.runs_conceded + " (" + x.overs + ")" : "—"; } },
      { key: "catches", label: "Field", render: function (x) { var f = []; if (x.catches) f.push(x.catches + " ct"); if (x.stumpings) f.push(x.stumpings + " st"); if (x.run_outs) f.push(x.run_outs + " ro"); return f.join(", ") || "—"; } },
      { key: "pts", label: "Pts", strong: true, sortVal: function (x) { return x.pts.total; }, render: function (x) { return x.pts.total + (x.mvp ? ' <span class="badge mvp">MVP</span>' : ""); } }
    ], rows, "date", "desc");
  }
  function kv(k, v, q) { return "<div><span>" + esc(k) + "</span><b>" + esc(v) + "</b>" + (q ? '<div class="q">' + esc(q) + "</div>" : "") + "</div>"; }

  function pMatches() {
    if (!needMatches()) return;
    var v = curView();
    var list = v.match_ids.slice().reverse().map(match);
    view.innerHTML = '<div class="page-head"><div><div class="eyebrow">' + esc(filterLabel()) + '</div><h1>Match centre</h1><p class="sub">' + list.length + " match" + (list.length === 1 ? "" : "es") + '</p></div></div><div class="mlist">' + list.map(function (m) {
      var mv = m.mvp && m.mvp.player_ids.length ? m.mvp.player_ids.map(function (id) { var p = player(id); return p ? p.display_name : ""; }).join(" & ") : "";
      return '<a class="card mrow" href="#/match/' + esc(m.match_id) + '">' + resChip(m.result) + '<div style="min-width:0"><div class="opp">vs ' + esc(m.opponent) + '</div><div class="meta">' + esc(fmtDate(m.date, { weekday: "short" })) + " · " + esc(m.competition) + " · " + esc(m.format) + " · " + esc(m.match_type) + (m.status !== "Verified" ? ' · <span class="tie">Pending verification</span>' : "") + "</div>" + (mv ? '<div class="meta"><span class="gold">★</span> ' + esc(mv) + "</div>" : "") + '</div><div class="score">' + esc(m.ts_score || "") + (m.opp_score ? ' <span class="dim">v</span> ' + esc(m.opp_score) : "") + "<small>" + esc(m.result) + (m.result_note ? " " + esc(m.result_note) : "") + "</small></div></a>";
    }).join("") + "</div>";
  }

  function pMatch(r) {
    var m = match(r.id);
    if (!m) { view.innerHTML = emptyHTML("Match not found", "This match isn't published."); return; }
    var rows = perfFor(m.match_id);
    var html = '<div class="page-head"><div><div class="eyebrow"><a href="#/matches">← Match centre</a></div><h1>vs ' + esc(m.opponent) + '</h1><p class="sub">' + esc(fmtDate(m.date, { weekday: "long" })) + " · " + esc(m.competition) + " · " + esc(m.format) + " · " + esc(m.match_type) + (m.venue ? " · " + esc(m.venue) : "") + "</p></div>" + evidenceBadge(m.evidence) + "</div>";
    html += '<section class="card">' + latestBlock(m, true) + "</section>";
    if (!rows.length) { view.innerHTML = html + emptyHTML("Scorecard not entered yet", "Player figures for this match haven't been published."); return; }
    html += '<div class="grid g2" style="margin-top:14px"><section class="card"><div class="card-head"><h3>Batting</h3></div><div id="batTbl"></div></section><section class="card"><div class="card-head"><h3>Bowling</h3></div><div id="bowlTbl"></div></section></div>';
    html += '<section class="card" style="margin-top:14px"><div class="card-head"><h3>Player contributions</h3><span class="small dim">' + (m.mvp && m.mvp.player_ids.length > 1 ? "Joint MVPs — tied on " + m.mvp.points + " points" : "★ match MVP") + '</span></div><div id="ptsTbl"></div></section>';
    view.innerHTML = html;
    var pc = function (x) { return '<span class="pcell">' + avatar(player(x.player_id), "sm") + plink(x.player_id) + "</span>"; };
    var bat = rows.filter(function (x) { return x.batted; }).map(function (x) { return Object.assign({ _cls: "" }, x); });
    mountTable($("batTbl"), [
      { key: "bat_pos", label: "#", sortVal: function (x) { return x.bat_pos || 99; }, render: function (x) { return x.bat_pos || ""; } },
      { key: "player_id", label: "Batter", l: true, nosort: true, render: function (x) { return pc(x) + (x.dismissal || x.not_out ? '<div class="small dim">' + (x.not_out ? "not out" : esc(x.dismissal)) + "</div>" : ""); } },
      { key: "runs", label: "R", strong: true, render: function (x) { return x.runs + (x.not_out ? "*" : ""); } }, { key: "balls", label: "B" }, { key: "fours", label: "4s" }, { key: "sixes", label: "6s" },
      { key: "sr", label: "SR", render: function (x) { return fmt(x.sr, "dec2"); } }
    ], bat, "bat_pos", "asc");
    var bowl = rows.filter(function (x) { return x.balls_bowled > 0; });
    mountTable($("bowlTbl"), [
      { key: "player_id", label: "Bowler", l: true, nosort: true, render: pc },
      { key: "balls_bowled", label: "O", render: function (x) { return x.overs; } }, { key: "maidens", label: "M" }, { key: "runs_conceded", label: "R" },
      { key: "wickets", label: "W", strong: true }, { key: "econ", label: "Econ", asc: true, render: function (x) { return fmt(x.econ, "dec2"); } }
    ], bowl, "wickets", "desc");
    mountTable($("ptsTbl"), [
      { key: "player_id", label: "Player", l: true, nosort: true, render: pc },
      { key: "bat", label: "Bat", sortVal: function (x) { return x.pts.bat; }, render: function (x) { return x.pts.bat; } },
      { key: "bowl", label: "Bowl", sortVal: function (x) { return x.pts.bowl; }, render: function (x) { return x.pts.bowl; } },
      { key: "field", label: "Field", sortVal: function (x) { return x.pts.field; }, render: function (x) { return x.pts.field + (x.catches || x.stumpings || x.run_outs ? '<div class="small dim">' + [x.catches ? x.catches + " ct" : "", x.stumpings ? x.stumpings + " st" : "", x.run_outs ? x.run_outs + " ro" : ""].filter(Boolean).join(", ") + "</div>" : ""); } },
      { key: "appear", label: "Appear", sortVal: function (x) { return x.pts.appear; }, render: function (x) { return x.pts.appear; } },
      { key: "total", label: "Total", strong: true, sortVal: function (x) { return x.pts.total; }, render: function (x) { return x.pts.total + (x.mvp ? ' <span class="badge mvp">★ MVP</span>' : ""); } }
    ], rows.map(function (x) { return Object.assign({ _cls: x.mvp ? "mvp" : "" }, x); }), "total", "desc");
  }

  function pCompare(r) {
    if (!needMatches()) return;
    var v = curView();
    var ids = (r.q.p || "").split(",").filter(function (x) { return player(x); }).slice(0, 3);
    if (!ids.length) { var b = v.boards.contribution || []; ids = b.slice(0, 2).map(function (e) { return e.player_id; }); }
    while (ids.length < 2) { var nxt = players().find(function (p) { return ids.indexOf(p.player_id) < 0; }); if (!nxt) break; ids.push(nxt.player_id); }
    var sel = function (i) {
      return '<label class="filters" style="padding:8px 10px"><span class="eyebrow" style="font-size:10.5px">Player ' + (i + 1) + (i === 2 ? " (optional)" : "") + '</span><select data-i="' + i + '">' + (i === 2 ? '<option value="">— none —</option>' : "") +
        players().map(function (p) { return '<option value="' + esc(p.player_id) + '"' + (ids[i] === p.player_id ? " selected" : "") + ">" + esc(p.display_name) + "</option>"; }).join("") + "</select></label>";
    };
    var html = '<div class="page-head"><div><div class="eyebrow">' + esc(filterLabel()) + '</div><h1>Compare players</h1><p class="sub">Pick two or three players. Gold marks the better figure among qualified values.</p></div></div><div class="cmp-pick">' + sel(0) + sel(1) + sel(2) + "</div>";
    var M = ids.map(function (id) { return pm(id, v); });
    var metrics = [["Matches", "matches"], ["Opportunities", "opportunities"], ["Contribution points", "pts_total"], ["Points per match", "ppm", "dec2", "q_ppm"], ["MVP awards", "mvps"],
      ["Runs", "runs"], ["Batting average", "avg", "dec2", "q_avg"], ["Strike rate", "sr", "dec2", "q_sr"], ["High score", "hs"], ["Wickets", "wickets"], ["Economy", "econ", "dec2", "q_econ", "asc"],
      ["Overs", "overs", "text"], ["Catches", "catches"], ["Stumpings", "stumpings"], ["Run outs", "run_outs"], ["Batting pts", "pts_bat"], ["Bowling pts", "pts_bowl"], ["Fielding pts", "pts_field"]];
    html += '<section class="card"><div class="tbl-wrap"><table class="t"><thead><tr><th class="l">Metric</th>' + ids.map(function (id) { return '<th><span class="pcell" style="justify-content:flex-end">' + avatar(player(id), "sm") + esc(player(id).display_name) + "</span></th>"; }).join("") + "</tr></thead><tbody>" +
      metrics.map(function (mt) {
        var vals = M.map(function (m) { return m[mt[1]]; });
        var cand = M.map(function (m, i) { return (mt[2] === "text" || vals[i] == null || (mt[3] && !m[mt[3]])) ? null : vals[i]; }).filter(function (x) { return x != null; });
        var best = cand.length > 1 ? (mt[4] === "asc" ? Math.min.apply(null, cand) : Math.max.apply(null, cand)) : null;
        return '<tr><td class="l">' + esc(mt[0]) + "</td>" + M.map(function (m, i) {
          var val = vals[i], ok = !(mt[3] && !m[mt[3]]);
          return '<td class="' + (best != null && ok && val === best ? "best" : "") + '">' + esc(mt[2] === "text" ? val : fmt(val, mt[2])) + (val != null && mt[3] && !m[mt[3]] ? ' <span class="dim" title="Below the qualification minimum">†</span>' : "") + "</td>";
        }).join("") + "</tr>";
      }).join("") + '</tbody></table></div><p class="small dim" style="margin:8px 0 0">† below the qualification minimum — shown but not compared.</p></section>';
    html += '<section class="card" style="margin-top:14px"><div class="card-head"><h3>Contribution mix</h3></div><div class="chart-box tall" id="chCmp"></div></section>';
    view.innerHTML = html;
    view.querySelectorAll(".cmp-pick select").forEach(function (s) {
      s.onchange = function () { var vals = Array.prototype.map.call(view.querySelectorAll(".cmp-pick select"), function (x) { return x.value; }).filter(Boolean);
        var uniq = vals.filter(function (x, i) { return vals.indexOf(x) === i; }); location.hash = "#/compare?p=" + uniq.join(","); };
    });
    chart($("chCmp"), { type: "bar", data: { labels: ["Batting", "Bowling", "Fielding", "Appearance"], datasets: ids.map(function (id, i) {
      var m = M[i]; return { label: player(id).display_name, data: [m.pts_bat, m.pts_bowl, m.pts_field, m.pts_appear], backgroundColor: ["#5b8cff", "#c9a227", "#3fd08f"][i], borderRadius: 5, maxBarThickness: 40 }; }) },
      options: { scales: { y: { beginAtZero: true }, x: { grid: { display: false } } } } });
  }

  function pRules() {
    var R = S.data.rules, groups = {};
    R.scoring.forEach(function (s) { (groups[s.group] = groups[s.group] || []).push(s); });
    var html = '<div class="page-head"><div><div class="eyebrow">Definitions</div><h1>How it works</h1><p class="sub">' + esc(R.contribution) + "</p></div></div>";
    html += '<div class="grid g2 rules"><section class="card"><h3 style="margin-bottom:12px">Definitions</h3><dl>' +
      "<dt>Matches</dt><dd>Matches in the playing XI. " + esc(R.counted) + "</dd>" +
      "<dt>Opportunities</dt><dd>Matches in which the player batted or bowled at least one ball.</dd>" +
      "<dt>Win %</dt><dd>" + esc(R.win_pct) + "</dd>" +
      "<dt>Batting average</dt><dd>Runs ÷ times dismissed. Not shown until the player has been dismissed.</dd>" +
      "<dt>Strike rate</dt><dd>Runs ÷ balls faced × 100.</dd><dt>Economy</dt><dd>Runs conceded ÷ overs bowled. Lower is better.</dd>" +
      "<dt>Contribution per match</dt><dd>Total contribution points ÷ matches.</dd>" +
      "<dt>Match MVP</dt><dd>The player with the most contribution points in a match. Tied players share the award.</dd>" +
      "<dt>Rankings &amp; ties</dt><dd>" + esc(R.ties) + "</dd>" +
      "<dt>Evidence status</dt><dd><b>Verified scorecard</b> — checked against the official scorecard. <b>Pending verification</b> — published provisionally and may still change.</dd>" +
      "<dt>Filters</dt><dd>Season, format, competition and match type filters use exactly the same definitions; every figure is recalculated for the selection by the team's publishing tool.</dd></dl></section>";
    html += '<section class="card"><h3 style="margin-bottom:12px">Qualification minimums</h3><table class="t"><tbody>' + R.qualification.map(function (q) { return '<tr><td class="l">' + esc(q.label) + "</td><td>" + esc(q.value) + (q.key === "Q_EC_BALLS" ? " balls (" + overs(q.value) + " overs)" : "") + "</td></tr>"; }).join("") +
      '</tbody></table><p class="small dim">Players below a minimum are listed under "Not yet qualified" and marked †.</p><hr class="sep"><h3 style="margin-bottom:8px">About this data</h3><p class="small muted" style="margin:0">Published from the team\'s scoring workbook. Only approved performance fields are published. Version <b>' + esc(S.data.meta.data_version) + "</b>, published " + esc(fmtStamp(S.data.meta.published_at)) + ".</p></section></div>";
    html += '<div class="grid g3" style="margin-top:14px">' + Object.keys(groups).map(function (g) {
      return '<section class="card"><h3 style="margin-bottom:10px">' + esc(g) + ' points</h3><table class="t pts-table"><tbody>' + groups[g].map(function (s) { return '<tr><td class="l">' + esc(s.label) + "</td><td>" + esc(s.value) + "</td></tr>"; }).join("") + "</tbody></table></section>";
    }).join("") + "</div>";
    view.innerHTML = html;
  }

  // ------------------------------------------------------------------ boot
  function boot() {
    if (CFG.LOGO_URL) document.querySelector(".crest").innerHTML = '<img src="' + esc(CFG.LOGO_URL) + '" alt="">';
    ["fSeason", "fFormat", "fComp", "fType"].forEach(function (id) { $(id).onchange = onFilter; });
    $("fReset").onclick = resetFilters;
    $("refreshBtn").onclick = function () { load(true); };
    window.addEventListener("hashchange", route);
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden && S.lastOk) {
        var m = S.data && S.data.meta.refresh_minutes ? S.data.meta.refresh_minutes : (CFG.DEFAULT_REFRESH_MINUTES || 5);
        if (Date.now() - S.lastOk.getTime() > m * 60000) load(false);
      }
    });
    renderState("loading");
    load(false);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
