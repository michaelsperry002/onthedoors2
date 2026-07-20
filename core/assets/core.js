(() => {
  "use strict";

  // ── Supabase (shared backend with CORE KPI) ─────────────────────
  const SUPABASE_URL = "https://tpzfmnyrqsqewgtkpxie.supabase.co";
  const SUPABASE_ANON_KEY = "sb_publishable_hgsd7UGGL2EjqVM875LzKA_fqjFgwbW";

  // Shared session across CORE KPI / CORE / Recruiting (same origin), with
  // a "Remember me" flag (default on) choosing localStorage vs sessionStorage.
  const REMEMBER_KEY = "core.remember";
  const remembered = () => localStorage.getItem(REMEMBER_KEY) !== "0";
  const authStorage = {
    getItem(k) { return (remembered() ? localStorage : sessionStorage).getItem(k) || localStorage.getItem(k) || sessionStorage.getItem(k); },
    setItem(k, v) { (remembered() ? localStorage : sessionStorage).setItem(k, v); },
    removeItem(k) { localStorage.removeItem(k); sessionStorage.removeItem(k); },
  };
  const sb = window.__CORE_MOCK_SB
    ? window.__CORE_MOCK_SB
    : window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { storage: authStorage, storageKey: "core-auth", persistSession: true, autoRefreshToken: true },
      });

  // Keep bandwidth bounded as history grows: only fetch logs from a
  // rolling window (matches the KPI app's cap).
  const LOG_FETCH_WINDOW_DAYS = 400;

  // ── State ───────────────────────────────────────────────────────
  let session = null;
  let profile = null;
  let loading = true;
  let authError = "";
  let activeTab = "dashboard";
  let teams = [];
  let people = [];
  let logs = [];
  let viewPersonId = null; // person drill-down
  let newAccountResult = null; // { name, email, tempPass }
  let flash = ""; // one-shot success message
  let dashRange = "30"; // "7" | "30" | "90" | "all" | "custom"
  let dashFrom = "";     // custom range start (yyyy-mm-dd)
  let dashTo = "";       // custom range end (yyyy-mm-dd)
  // KPIs tab (view-only analytics) has its own independent filters.
  let kpiPersonId = null;
  let kpiRange = "30";
  let kpiFrom = "";
  let kpiTo = "";
  let kpiSort = "revenue"; // revenue | doors | closeRate | answerRate | perDay
  // Time-of-day / weekday filters for a person's KPI profile.
  let kpiHourStart = 0;
  let kpiHourEnd = 23;
  let kpiDow = "all"; // all | weekdays | weekends | 0..6

  const appRoot = () => document.getElementById("app");
  const $ = (sel) => document.querySelector(sel);
  const val = (sel) => ($(sel) ? $(sel).value : "");
  const bind = (sel, ev, fn) => { const el = $(sel); if (el) el.addEventListener(ev, fn); };

  const ROLE_OPTIONS = ["rep", "manager", "regional"];
  const ROLE_LABELS = { rep: "Rep", manager: "Manager", regional: "Regional", admin: "Owner" };
  const RANGES = [["7", "7 days"], ["30", "30 days"], ["90", "90 days"], ["all", "All time"], ["custom", "Custom"]];

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  const escapeAttr = escapeHtml;
  const money = (n) => "$" + Math.round(Number(n) || 0).toLocaleString();
  const pct = (n) => (Number.isFinite(n) ? Math.round(n) + "%" : "—");
  const pad = (n) => String(n).padStart(2, "0");

  function dkey(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
  function logFetchCutoff() { const d = new Date(); d.setDate(d.getDate() - LOG_FETCH_WINDOW_DAYS); return dkey(d); }
  function sinceKeyFor(range) { if (range === "all") return null; const d = new Date(); d.setDate(d.getDate() - Number(range)); return dkey(d); }
  function weekAgoKey() { const d = new Date(); d.setDate(d.getDate() - 7); return dkey(d); }
  function daysBetween(a, b) { return Math.round((new Date(b) - new Date(a)) / 86400000); }

  // Generic range helpers — shared by the Dashboard and KPIs tabs.
  function rangeLabelG(range, from, to) {
    if (range === "all") return "all time";
    if (range === "custom") return (from && to) ? `${from} → ${to}` : "pick dates";
    return `last ${range} days`;
  }
  function rowsInRange(all, range, from, to) {
    if (range === "custom") { if (!from || !to) return []; return all.filter((l) => l.date >= from && l.date <= to); }
    const since = sinceKeyFor(range);
    return since ? all.filter((l) => l.date >= since) : all;
  }
  // Backwards-compatible wrappers for the Dashboard's own state.
  function rangeLabel(range) { return rangeLabelG(range, dashFrom, dashTo); }
  function rangeRows() { return rowsInRange(logs, dashRange, dashFrom, dashTo); }

  function generateShortCode() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let s = ""; for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return s;
  }
  function generateTempPassword() {
    const words = ["DOOR", "CORE", "TEAM", "BLUE", "NAVY", "PEAK", "GOAL", "PACE"];
    return words[Math.floor(Math.random() * words.length)] + Math.floor(1000 + Math.random() * 9000) + "!";
  }

  // ── Data loading ────────────────────────────────────────────────
  async function loadAll() {
    const [teamsRes, peopleRes, logsRes] = await Promise.all([
      sb.from("teams").select("*"),
      sb.from("profiles").select("*"),
      sb.from("logs").select("*").gte("date", logFetchCutoff()),
    ]);
    teams = teamsRes.data || [];
    people = peopleRes.data || [];
    logs = logsRes.data || [];
  }

  async function init() {
    render(); // show the branded splash immediately, before data loads
    const { data } = await sb.auth.getSession();
    session = data ? data.session : null;
    if (session) await afterLogin();
    loading = false;
    render();
    sb.auth.onAuthStateChange((_event, s) => {
      const had = !!session;
      session = s;
      if (!s && had) { profile = null; render(); }
    });
  }

  async function afterLogin() {
    const { data: prof } = await sb.from("profiles").select("*").eq("id", session.user.id).single();
    if (!prof) {
      await sb.auth.signOut();
      session = null;
      authError = "No CORE profile found for this account.";
      return;
    }
    if (prof.disabled) {
      await sb.auth.signOut();
      session = null;
      authError = "Your account has been deactivated.";
      return;
    }
    profile = prof;
    computePerms();
    await loadAll();
  }

  // Capability model. Everyone can view; editing is gated by role, and
  // the database's RLS policies enforce the same rules server-side.
  let perms = {};
  function computePerms() {
    const r = profile.role;
    const isAdmin = r === "admin";
    const isLeader = r === "manager" || r === "regional";
    perms = {
      isAdmin,
      isLeader,
      canEdit: isAdmin || isLeader,   // can edit *some* people (their downline)
      canAdd: isAdmin || isLeader,    // add people (land under them in the tree)
      canDelete: isAdmin,             // permanently delete people — admin only
      canSetPassword: isAdmin,        // overwrite passwords — admin only
      role: r,
    };
  }
  // Everyone in the current user's downline (people they recruited, and those
  // people's recruits, all the way down). Used to scope edit/add rights.
  function inMyDownline(id) {
    const set = new Set();
    const walk = (pid) => {
      const name = (people.find((p) => p.id === pid) || {}).name;
      childrenOfC(pid, name).forEach((c) => { if (!set.has(c.id)) { set.add(c.id); walk(c.id); } });
    };
    walk(profile.id);
    return set.has(id);
  }
  // Can the current user edit THIS person? Admin: anyone. Manager/Regional:
  // anyone in their downline. Reps: no one (view only).
  function canEditPerson(p) {
    if (perms.isAdmin) return true;
    if (p.role === "admin") return false;
    if (perms.isLeader) return inMyDownline(p.id);
    return false;
  }

  async function signIn() {
    authError = "";
    const rememberEl = $("#remember");
    localStorage.setItem(REMEMBER_KEY, (rememberEl ? rememberEl.checked : true) ? "1" : "0");
    const email = val("#email").trim();
    const password = val("#password");
    const btn = $("#signInBtn");
    if (btn) { btn.disabled = true; btn.textContent = "Signing in..."; }
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) { authError = error.message || "Sign-in failed."; render(); return; }
    session = data.session;
    await afterLogin();
    render();
  }

  // ── Stats helpers ───────────────────────────────────────────────
  function aggregate(rows) {
    const doors = rows.length;
    const sales = rows.filter((r) => r.outcome === "sale").length;
    const answered = rows.filter((r) => ["answered", "pitch", "appointment", "sale"].includes(r.outcome)).length;
    const appts = rows.filter((r) => r.outcome === "appointment").length;
    const revenue = rows.reduce((s, r) => s + Number(r.contract_value || 0), 0);
    return { doors, sales, answered, appts, revenue, closeRate: answered ? (sales / answered) * 100 : NaN };
  }
  function personStats(id, sinceKey) {
    return aggregate(logs.filter((l) => l.user_id === id && (!sinceKey || l.date >= sinceKey)));
  }
  function recruitsOf(p) {
    return people.filter((x) => x.id !== p.id && (x.recruited_by === p.id ||
      (!x.recruited_by && x.recruited_by_name && x.recruited_by_name === p.name)));
  }
  const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  function hourLabel(h) {
    const ampm = h < 12 ? "a" : "p";
    let hr = h % 12; if (hr === 0) hr = 12;
    return hr + ampm;
  }
  // Full "10 AM" / "2 PM" form for the filter dropdowns.
  function hourLabelAmPm(h) {
    const ampm = h < 12 ? "AM" : "PM";
    let hr = h % 12; if (hr === 0) hr = 12;
    return hr + " " + ampm;
  }
  function logHour(l) { return new Date(l.created_at || (l.date + "T12:00:00")).getHours(); }
  function logDow(l) { return new Date(l.created_at || (l.date + "T12:00:00")).getDay(); }

  // Deep analytics for one person over a set of rows: hour-of-day and
  // weekday buckets, plus best/worst callouts.
  function personAnalytics(rows) {
    const hours = Array.from({ length: 24 }, () => ({ doors: 0, answered: 0, sales: 0, revenue: 0 }));
    const dows = Array.from({ length: 7 }, () => ({ doors: 0, answered: 0, sales: 0, revenue: 0 }));
    const dayset = {};
    rows.forEach((l) => {
      const answered = ["answered", "pitch", "appointment", "sale"].includes(l.outcome);
      const sale = l.outcome === "sale";
      const rev = Number(l.contract_value || 0);
      const h = logHour(l), w = logDow(l);
      hours[h].doors++; if (answered) hours[h].answered++; if (sale) hours[h].sales++; hours[h].revenue += rev;
      dows[w].doors++; if (answered) dows[w].answered++; if (sale) dows[w].sales++; dows[w].revenue += rev;
      dayset[l.date] = true;
    });
    const agg = aggregate(rows);
    const activeDays = Object.keys(dayset).length;
    // best/worst answering hours need a minimum sample to be meaningful
    const MIN = 3;
    let bestAns = null, worstAns = null, bestSales = null, busiest = null;
    hours.forEach((b, h) => {
      if (b.doors >= MIN) {
        const r = b.answered / b.doors;
        if (!bestAns || r > bestAns.rate) bestAns = { h, rate: r };
        if (!worstAns || r < worstAns.rate) worstAns = { h, rate: r };
      }
      if (!bestSales || b.sales > bestSales.sales) bestSales = { h, sales: b.sales };
      if (!busiest || b.doors > busiest.doors) busiest = { h, doors: b.doors };
    });
    let bestDow = null;
    dows.forEach((b, w) => { if (!bestDow || b.sales > bestDow.sales) bestDow = { w, sales: b.sales, revenue: b.revenue }; });
    const answerRate = agg.doors ? (agg.answered / agg.doors) * 100 : NaN;
    return { ...agg, hours, dows, activeDays, perDay: activeDays ? agg.doors / activeDays : 0,
      answerRate, bestAns, worstAns, bestSales, busiest, bestDow };
  }

  // Build a daily (or monthly for large spans) time series from log rows.
  // from/to default to the Dashboard's custom-range state.
  function seriesFor(rows, range, from, to) {
    if (from === undefined) from = dashFrom;
    if (to === undefined) to = dashTo;
    const labels = [], doors = [], sales = [], revenue = [];
    const pushDay = (key) => {
      const dr = rows.filter((r) => r.date === key);
      labels.push(key);
      doors.push(dr.length);
      sales.push(dr.filter((x) => x.outcome === "sale").length);
      revenue.push(dr.reduce((s, x) => s + Number(x.contract_value || 0), 0));
    };
    if (range === "all") {
      const now = new Date();
      for (let m = 11; m >= 0; m--) {
        const d = new Date(now.getFullYear(), now.getMonth() - m, 1);
        const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
        labels.push(d.toLocaleString(undefined, { month: "short" }));
        const mr = rows.filter((r) => r.date && r.date.slice(0, 7) === key);
        doors.push(mr.length);
        sales.push(mr.filter((x) => x.outcome === "sale").length);
        revenue.push(mr.reduce((s, x) => s + Number(x.contract_value || 0), 0));
      }
    } else if (range === "custom") {
      if (from && to) {
        const span = Math.max(0, daysBetween(from, to));
        // Long custom spans bucket by month to stay readable.
        if (span > 92) {
          const start = new Date(from);
          const end = new Date(to);
          let d = new Date(start.getFullYear(), start.getMonth(), 1);
          while (d <= end) {
            const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
            labels.push(d.toLocaleString(undefined, { month: "short", year: "2-digit" }));
            const mr = rows.filter((r) => r.date && r.date.slice(0, 7) === key);
            doors.push(mr.length);
            sales.push(mr.filter((x) => x.outcome === "sale").length);
            revenue.push(mr.reduce((s, x) => s + Number(x.contract_value || 0), 0));
            d = new Date(d.getFullYear(), d.getMonth() + 1, 1);
          }
        } else {
          const start = new Date(from);
          for (let i = 0; i <= span; i++) {
            const d = new Date(start); d.setDate(d.getDate() + i);
            pushDay(dkey(d));
          }
        }
      }
    } else {
      const n = Number(range), today = new Date();
      for (let i = n - 1; i >= 0; i--) {
        const d = new Date(today); d.setDate(d.getDate() - i);
        pushDay(dkey(d));
      }
    }
    return { labels, doors, sales, revenue };
  }
  function shortLabel(l) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(l)) { const p = l.split("-"); return Number(p[1]) + "/" + Number(p[2]); }
    return l;
  }
  function barsHtml(values, labels, opts) {
    const o = opts || {};
    const color = o.color || "var(--core-blue)";
    const fmt = o.fmt || ((v) => String(v));
    const max = Math.max(1, ...values);
    const step = Math.max(1, Math.ceil(values.length / 8));
    // Show a number above each bar only when there's room.
    const showVals = o.showValues !== false && values.length <= 16;
    // Horizontal gridlines with value labels so magnitudes are readable.
    const grid = [1, 0.75, 0.5, 0.25, 0].map((f) =>
      `<div class="grid-line"><span>${escapeHtml(fmt(Math.round(max * f)))}</span></div>`).join("");
    return `<div class="chart-wrap"><div class="chart">
      <div class="plot">
        <div class="grid">${grid}</div>
        <div class="bars">${values.map((v, i) => `
          <div class="bar-col">
            ${showVals ? `<b class="bar-val">${v ? escapeHtml(fmt(v)) : ""}</b>` : ""}
            <div class="bar-fill" style="height:${(v / max * 100).toFixed(1)}%;background:${color}" title="${escapeAttr(labels[i])}: ${escapeAttr(fmt(v))}"></div>
          </div>`).join("")}</div>
      </div>
      <div class="xaxis">${values.map((v, i) =>
        `<span title="${escapeAttr(labels[i])}">${(i % step === 0 || i === values.length - 1) ? escapeHtml(shortLabel(labels[i])) : "&nbsp;"}</span>`).join("")}</div>
    </div></div>`;
  }

  // ── Rendering ───────────────────────────────────────────────────
  let firstAppPaint = true;
  function render() {
    if (loading) {
      appRoot().innerHTML = `<main class="screen"><div class="splash"><img src="favicon.svg" alt="CORE" /></div></main>`;
      return;
    }
    if (!session || !profile) return renderAuth();
    renderApp();
    // Fade the whole app in once, on first paint (opacity only, so sticky
    // headers keep working). Later re-renders are instant.
    if (firstAppPaint) { firstAppPaint = false; appRoot().classList.add("app-enter"); }
  }

  function renderAuth() {
    appRoot().innerHTML = `
      <main class="screen">
        <section class="auth-card">
          <div class="brand">
            <img class="logo" src="favicon.svg" alt="CORE" />
            <small>CORE</small>
            <h1>Control Hub</h1>
            <p class="muted">Sign in with your CORE KPI login.</p>
          </div>
          ${authError ? `<p class="auth-error">${escapeHtml(authError)}</p>` : ""}
          <label>Email <input id="email" type="email" autocomplete="username" /></label>
          <label>Password <input id="password" type="password" autocomplete="current-password" /></label>
          <label class="remember-row"><input type="checkbox" id="remember" ${remembered() ? "checked" : ""} /> <span>Remember me on this device</span></label>
          <button id="signInBtn" class="primary" type="button">Sign In</button>
        </section>
      </main>`;
    bind("#signInBtn", "click", signIn);
    bind("#password", "keydown", (e) => { if (e.key === "Enter") signIn(); });
  }

  function renderApp() {
    const tabs = [["dashboard", "Dashboard"], ["kpis", "KPIs"], ["downline", "Downline"], ["people", "People"]];
    let body = "";
    if (activeTab === "dashboard") body = renderDashboard();
    else if (activeTab === "kpis") body = kpiPersonId ? renderKpiPerson() : renderKpiList();
    else if (activeTab === "downline") body = renderDownline();
    else if (activeTab === "people") body = viewPersonId ? renderPersonDetail() : renderPeople();

    appRoot().innerHTML = `
      <header class="topbar">
        <div class="brand-row"><img src="favicon.svg" alt="" /><div><h1>CORE</h1></div></div>
        <div class="row-inline"><small>${escapeHtml(profile.name)} · ${escapeHtml(ROLE_LABELS[profile.role] || profile.role)}${perms.isAdmin ? "" : perms.canEdit ? "" : " · view only"}</small><button id="signOut" type="button">Sign Out</button></div>
      </header>
      <nav class="tabs">
        ${tabs.map(([id, label]) => `<button data-tab="${id}" class="${activeTab === id ? "active" : ""}" type="button">${label}</button>`).join("")}
      </nav>
      <main class="wrap">
        ${flash ? `<section class="card"><p style="color:var(--good);font-weight:700;">${escapeHtml(flash)}</p></section>` : ""}
        ${body}
      </main>`;
    flash = "";

    bind("#signOut", "click", async () => { await sb.auth.signOut(); session = null; profile = null; render(); });
    document.querySelectorAll("[data-tab]").forEach((b) =>
      b.addEventListener("click", () => { activeTab = b.dataset.tab; viewPersonId = null; kpiPersonId = null; render(); }));
    bindTabEvents();
  }

  // ── Dashboard ───────────────────────────────────────────────────
  function renderDashboard() {
    const range = dashRange;
    const since = range === "custom" ? (dashFrom || null) : sinceKeyFor(range);
    const rows = rangeRows();
    const st = aggregate(rows);
    const active = people.filter((p) => !p.disabled);
    const ser = seriesFor(rows, range);
    const today = aggregate(logs.filter((l) => l.date === dkey(new Date())));

    const teamRows = teams.map((t) => {
      const ids = new Set(people.filter((p) => p.team_id === t.id).map((p) => p.id));
      const s = aggregate(rows.filter((l) => ids.has(l.user_id)));
      return { team: t, members: ids.size, ...s };
    }).sort((a, b) => b.revenue - a.revenue);
    const maxTeamRev = Math.max(1, ...teamRows.map((r) => r.revenue));

    const leaders = active
      .map((p) => ({ p, s: aggregate(rows.filter((l) => l.user_id === p.id)) }))
      .filter((r) => r.s.doors > 0)
      .sort((a, b) => b.s.revenue - a.s.revenue)
      .slice(0, 10);

    // recruiting summary
    const counts = {};
    people.forEach((p) => {
      const rec = p.recruited_by
        ? (people.find((x) => x.id === p.recruited_by) || {}).name
        : p.recruited_by_name;
      if (rec) counts[rec] = (counts[rec] || 0) + 1;
    });
    const topRecruiters = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 6);

    const mine = personStats(profile.id, since);
    const myRecruits = recruitsOf(profile).length;

    return `
      <div class="section-title"><h2>Momentum</h2>${perms.isAdmin ? `<button class="secondary" id="exportLogs" type="button" style="padding:6px 12px;font-size:13px">Export logs</button>` : `<span>${active.length} active</span>`}</div>
      <div class="range-chips" id="rangeChips">
        ${RANGES.map(([v, l]) => `<button data-range="${v}" class="${range === v ? "active" : ""}" type="button">${l}</button>`).join("")}
      </div>
      ${range === "custom" ? `
      <div class="custom-range">
        <label>From <input id="dashFrom" type="date" value="${escapeAttr(dashFrom)}" /></label>
        <label>To <input id="dashTo" type="date" value="${escapeAttr(dashTo)}" /></label>
        <button id="applyCustom" class="blue" type="button">Apply</button>
      </div>` : ""}

      <div class="stat-grid">
        <div class="stat"><small>Doors</small><strong>${st.doors.toLocaleString()}</strong><span>${rangeLabel(range)}</span></div>
        <div class="stat"><small>Sales</small><strong>${st.sales.toLocaleString()}</strong><span>${today.sales} today</span></div>
        <div class="stat"><small>Revenue</small><strong>${money(st.revenue)}</strong><span>${money(today.revenue)} today</span></div>
        <div class="stat"><small>Close rate</small><strong>${pct(st.closeRate)}</strong><span>of answered</span></div>
        <div class="stat"><small>Appointments</small><strong>${st.appts.toLocaleString()}</strong><span>${rangeLabel(range)}</span></div>
        <div class="stat"><small>Active reps</small><strong>${active.length}</strong><span>${people.length} total</span></div>
      </div>

      <section class="card stack">
        <div class="section-title"><h3>Doors over time</h3><span>${rangeLabel(range)}</span></div>
        ${barsHtml(ser.doors, ser.labels, { color: "var(--core-blue)" })}
      </section>
      <section class="card stack">
        <div class="section-title"><h3>Revenue over time</h3><span>${rangeLabel(range)}</span></div>
        ${barsHtml(ser.revenue, ser.labels, { color: "var(--good)", fmt: (v) => money(v) })}
      </section>
      <section class="card stack">
        <div class="section-title"><h3>Sales over time</h3><span>${rangeLabel(range)}</span></div>
        ${barsHtml(ser.sales, ser.labels, { color: "var(--slate)" })}
      </section>

      <section class="card stack">
        <div class="section-title"><h3>My Numbers</h3><span>you · ${rangeLabel(range)}</span></div>
        <div class="meta-row">
          <span><b>${mine.doors}</b> doors</span>
          <span><b>${mine.sales}</b> sales</span>
          <span><b>${money(mine.revenue)}</b> revenue</span>
          <span><b>${pct(mine.closeRate)}</b> close</span>
          <span><b>${myRecruits}</b> recruits</span>
        </div>
      </section>

      <section class="card stack">
        <div class="section-title"><h3>Top People</h3><span>${rangeLabel(range)} · by revenue</span></div>
        ${leaders.length ? leaders.map(({ p, s }, i) => `
          <article class="record" data-view-person="${p.id}" style="cursor:pointer">
            <div class="record-top"><strong>${i + 1}. ${escapeHtml(p.name)}</strong><span class="pill blue">${money(s.revenue)}</span></div>
            <div class="meta-row"><span>${s.doors} doors</span><span>${s.sales} sales</span><span>${pct(s.closeRate)} close</span></div>
          </article>`).join("") : `<p class="empty">No activity in this range.</p>`}
      </section>

      <section class="card stack">
        <div class="section-title"><h3>Top Recruiters</h3><span>accounts brought in</span></div>
        ${topRecruiters.length ? topRecruiters.map(([name, n]) => `
          <div class="progress-row"><div class="row-head"><b>${escapeHtml(name)}</b><span>${n} recruit${n === 1 ? "" : "s"}</span></div></div>`).join("")
          : `<p class="empty">No recruit links yet.</p>`}
      </section>`;
  }

  // ── KPIs tab (view-only analytics) ──────────────────────────────
  function kpiRangeUI() {
    return `
      <div class="range-chips">
        ${RANGES.map(([v, l]) => `<button data-kpi-range="${v}" class="${kpiRange === v ? "active" : ""}" type="button">${l}</button>`).join("")}
      </div>
      ${kpiRange === "custom" ? `
      <div class="custom-range">
        <label>From <input id="kpiFrom" type="date" value="${escapeAttr(kpiFrom)}" /></label>
        <label>To <input id="kpiTo" type="date" value="${escapeAttr(kpiTo)}" /></label>
        <button id="kpiApplyCustom" class="blue" type="button">Apply</button>
      </div>` : ""}`;
  }

  function renderKpiList() {
    const rows = rowsInRange(logs, kpiRange, kpiFrom, kpiTo);
    const teamName = (id) => (teams.find((t) => t.id === id) || {}).name || "No team";
    const stats = people.filter((p) => !p.disabled).map((p) => ({ p, a: personAnalytics(rows.filter((r) => r.user_id === p.id)) }));
    const sorters = {
      revenue: (x) => x.a.revenue, doors: (x) => x.a.doors,
      closeRate: (x) => (Number.isFinite(x.a.closeRate) ? x.a.closeRate : -1),
      answerRate: (x) => (Number.isFinite(x.a.answerRate) ? x.a.answerRate : -1),
      perDay: (x) => x.a.perDay,
    };
    stats.sort((x, y) => sorters[kpiSort](y) - sorters[kpiSort](x));
    const SORTS = [["revenue", "Revenue"], ["doors", "Doors"], ["closeRate", "Close %"], ["answerRate", "Answer %"], ["perDay", "Doors/day"]];

    return `
      <div class="section-title"><h2>KPIs</h2><span>${rangeLabelG(kpiRange, kpiFrom, kpiTo)}</span></div>
      ${kpiRangeUI()}
      <section class="card stack">
        <div class="row-inline">
          <input id="kpiSearch" placeholder="Search by name..." />
          <select id="kpiSortSel">
            ${SORTS.map(([v, l]) => `<option value="${v}" ${kpiSort === v ? "selected" : ""}>Sort: ${l}</option>`).join("")}
          </select>
        </div>
        <div class="section-title"><h3>Everyone</h3><span>tap for full analytics</span></div>
        ${stats.map(({ p, a }) => `
          <article class="record" data-kpi-person="${p.id}" data-name="${escapeAttr((p.name || "").toLowerCase())}" data-team="${escapeAttr(p.team_id || "")}" style="cursor:pointer">
            <div class="record-top"><strong>${escapeHtml(p.name)}</strong><span class="pill blue">${money(a.revenue)}</span></div>
            <div class="meta-row">
              <span>${escapeHtml(ROLE_LABELS[p.role] || p.role)}</span>
              <span>${a.doors} doors</span>
              <span>${a.perDay.toFixed(1)}/day</span>
              <span>${pct(a.closeRate)} close</span>
              <span>${pct(a.answerRate)} answer</span>
              <span>${a.sales} sales</span>
            </div>
          </article>`).join("") || `<p class="empty">No people yet.</p>`}
      </section>`;
  }

  function bestTimeCard(label, hourInfo, extra) {
    if (!hourInfo) return `<div class="stat"><small>${label}</small><strong>—</strong><span>not enough data</span></div>`;
    return `<div class="stat"><small>${label}</small><strong>${hourLabel(hourInfo.h)}</strong><span>${extra}</span></div>`;
  }

  // Apply the hour-window + weekday filters to a person's rows.
  function applyTimeFilters(rows) {
    return rows.filter((l) => {
      const h = logHour(l), w = logDow(l);
      if (h < kpiHourStart || h > kpiHourEnd) return false;
      if (kpiDow === "weekdays" && (w === 0 || w === 6)) return false;
      if (kpiDow === "weekends" && !(w === 0 || w === 6)) return false;
      if (/^[0-6]$/.test(kpiDow) && w !== Number(kpiDow)) return false;
      return true;
    });
  }
  const timeFiltersActive = () => kpiHourStart !== 0 || kpiHourEnd !== 23 || kpiDow !== "all";

  function kpiFilterUI() {
    const hourOpts = (sel) => Array.from({ length: 24 }, (_, h) =>
      `<option value="${h}" ${sel === h ? "selected" : ""}>${hourLabelAmPm(h)}</option>`).join("");
    const dowOpts = [["all", "All days"], ["weekdays", "Weekdays"], ["weekends", "Weekends"],
      ["1", "Mondays"], ["2", "Tuesdays"], ["3", "Wednesdays"], ["4", "Thursdays"], ["5", "Fridays"], ["6", "Saturdays"], ["0", "Sundays"]];
    return `
      <section class="card stack">
        <div class="section-title"><h3>Filters</h3><span>focus the analysis</span></div>
        <div class="form-2col">
          <label>From hour <select id="kpiHourStart">${hourOpts(kpiHourStart)}</select></label>
          <label>To hour <select id="kpiHourEnd">${hourOpts(kpiHourEnd)}</select></label>
          <label>Days <select id="kpiDow">${dowOpts.map(([v, l]) => `<option value="${v}" ${kpiDow === v ? "selected" : ""}>${l}</option>`).join("")}</select></label>
          <label>&nbsp;<button id="kpiResetFilters" class="secondary" type="button">Reset filters</button></label>
        </div>
      </section>`;
  }

  // Full analytics body for one person over the current KPI filters. Shared by
  // the KPIs tab and the People-tab person detail so both show identical depth.
  function personKpiBody(p) {
    const rows = applyTimeFilters(rowsInRange(logs, kpiRange, kpiFrom, kpiTo).filter((r) => r.user_id === p.id));
    const a = personAnalytics(rows);
    const ser = seriesFor(rows, kpiRange, kpiFrom, kpiTo);
    // Only chart the hours inside the selected window.
    const hStart = Math.min(kpiHourStart, kpiHourEnd), hEnd = Math.max(kpiHourStart, kpiHourEnd);
    const hourIdx = a.hours.map((_, h) => h).filter((h) => h >= hStart && h <= hEnd);
    const hourLabels = hourIdx.map((h) => hourLabel(h));
    const doorsByHour = hourIdx.map((h) => a.hours[h].doors);
    const salesByHour = hourIdx.map((h) => a.hours[h].sales);
    const answerByHour = hourIdx.map((h) => (a.hours[h].doors ? Math.round((a.hours[h].answered / a.hours[h].doors) * 100) : 0));
    const avgSale = a.sales ? a.revenue / a.sales : 0;

    return `
      ${timeFiltersActive() ? `<p class="muted" style="text-align:center">Showing ${hourLabelAmPm(hStart)}–${hourLabelAmPm(hEnd)}${kpiDow !== "all" ? " · " + (["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"][kpiDow] || kpiDow) : ""} only</p>` : ""}

      <div class="stat-grid">
        <div class="stat"><small>Doors</small><strong>${a.doors}</strong><span>${rangeLabelG(kpiRange, kpiFrom, kpiTo)}</span></div>
        <div class="stat"><small>Doors / day</small><strong>${a.perDay.toFixed(1)}</strong><span>${a.activeDays} active days</span></div>
        <div class="stat"><small>Sales</small><strong>${a.sales}</strong><span>${a.appts} appts</span></div>
        <div class="stat"><small>Revenue</small><strong>${money(a.revenue)}</strong><span>${money(avgSale)}/sale</span></div>
        <div class="stat"><small>Close rate</small><strong>${pct(a.closeRate)}</strong><span>of answered</span></div>
        <div class="stat"><small>Answer rate</small><strong>${pct(a.answerRate)}</strong><span>of doors</span></div>
      </div>

      <section class="card stack">
        <div class="section-title"><h3>Best & Worst Times</h3><span>when they perform</span></div>
        <div class="stat-grid">
          ${bestTimeCard("Best answering hour", a.bestAns, a.bestAns ? Math.round(a.bestAns.rate * 100) + "% answer" : "")}
          ${bestTimeCard("Worst answering hour", a.worstAns, a.worstAns ? Math.round(a.worstAns.rate * 100) + "% answer" : "")}
          ${bestTimeCard("Best selling hour", a.bestSales && a.bestSales.sales ? a.bestSales : null, a.bestSales ? a.bestSales.sales + " sales" : "")}
          ${bestTimeCard("Busiest hour", a.busiest && a.busiest.doors ? a.busiest : null, a.busiest ? a.busiest.doors + " doors" : "")}
          <div class="stat"><small>Best day</small><strong>${a.bestDow && a.bestDow.sales ? DOW[a.bestDow.w] : "—"}</strong><span>${a.bestDow && a.bestDow.sales ? a.bestDow.sales + " sales" : "not enough data"}</span></div>
        </div>
      </section>

      <section class="card stack">
        <div class="section-title"><h3>Doors over time</h3><span>${rangeLabelG(kpiRange, kpiFrom, kpiTo)}</span></div>
        ${barsHtml(ser.doors, ser.labels, { color: "var(--core-blue)" })}
      </section>
      <section class="card stack">
        <div class="section-title"><h3>Sales over time</h3><span>${rangeLabelG(kpiRange, kpiFrom, kpiTo)}</span></div>
        ${barsHtml(ser.sales, ser.labels, { color: "var(--slate)" })}
      </section>
      <section class="card stack">
        <div class="section-title"><h3>Revenue over time</h3><span>${rangeLabelG(kpiRange, kpiFrom, kpiTo)}</span></div>
        ${barsHtml(ser.revenue, ser.labels, { color: "var(--good)", fmt: (v) => money(v) })}
      </section>

      <section class="card stack">
        <div class="section-title"><h3>Doors by hour of day</h3><span>when they knock</span></div>
        ${barsHtml(doorsByHour, hourLabels, { color: "var(--core-blue)" })}
      </section>
      <section class="card stack">
        <div class="section-title"><h3>Answer rate by hour</h3><span>% of doors answered</span></div>
        ${barsHtml(answerByHour, hourLabels, { color: "var(--good)", fmt: (v) => v + "%" })}
      </section>
      <section class="card stack">
        <div class="section-title"><h3>Sales by hour</h3><span>when they close</span></div>
        ${barsHtml(salesByHour, hourLabels, { color: "var(--slate)" })}
      </section>
      <section class="card stack">
        <div class="section-title"><h3>Doors by weekday</h3><span>weekly pattern</span></div>
        ${barsHtml(a.dows.map((b) => b.doors), DOW, { color: "var(--core-blue)" })}
      </section>
      <section class="card stack">
        <div class="section-title"><h3>Sales by weekday</h3><span>weekly pattern</span></div>
        ${barsHtml(a.dows.map((b) => b.sales), DOW, { color: "var(--slate)" })}
      </section>`;
  }

  function renderKpiPerson() {
    const p = people.find((x) => x.id === kpiPersonId);
    if (!p) { kpiPersonId = null; return renderKpiList(); }
    return `
      <button class="back-link" id="backToKpis" type="button">&larr; All people</button>
      <div class="section-title"><h2>${escapeHtml(p.name)}</h2><span>${escapeHtml(ROLE_LABELS[p.role] || p.role)}</span></div>
      ${kpiRangeUI()}
      ${kpiFilterUI()}
      ${personKpiBody(p)}
      <p class="muted" style="text-align:center">To edit this person's numbers or info, use the <b>People</b> tab.</p>`;
  }

  // ── Downline tab (recruit family tree) ──────────────────────────
  // Everyone is one org (Momentum). The tree is built purely from who
  // recruited whom, rooted at the owner. Click a person to expand their
  // downline; it animates open/closed without a full re-render.
  let treeExpanded = null; // Set of expanded ids; null until first build

  function orgRoot() {
    return people.find((p) => p.role === "admin") || profile;
  }
  function downlineCountC(id, seen) {
    seen = seen || new Set();
    const name = (people.find((p) => p.id === id) || {}).name;
    let n = 0;
    childrenOfC(id, name).forEach((k) => { if (!seen.has(k.id)) { seen.add(k.id); n += 1 + downlineCountC(k.id, seen); } });
    return n;
  }
  function childrenOfC(id, name) {
    return people
      .filter((p) => p.id !== id && (p.recruited_by === id || (!p.recruited_by && p.recruited_by_name && name && p.recruited_by_name === name)))
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  }
  function treeNodeC(p, depth, seen) {
    if (seen.has(p.id)) return "";
    seen.add(p.id);
    const kids = childrenOfC(p.id, p.name);
    const isRoot = depth === 0;
    // Default state: root open, everyone else collapsed.
    const open = treeExpanded ? treeExpanded.has(p.id) : isRoot;
    const total = downlineCountC(p.id);
    const s = personStats(p.id, null);
    return `
      <div class="tree-node">
        <div class="tree-row ${isRoot ? "me" : ""} ${kids.length ? "has-kids" : ""}" ${kids.length ? `data-tree-toggle="${p.id}"` : ""}>
          <span class="tree-caret ${kids.length ? (open ? "open" : "") : "leaf"}" ${kids.length ? `data-caret="${p.id}"` : ""}>${kids.length ? "▸" : "•"}</span>
          <div class="tree-card">
            <div class="tree-top">
              <span class="tree-name">${escapeHtml(p.name)}${isRoot ? " (you)" : ""}</span>
              <button class="tree-open" data-view-person="${p.id}" type="button" title="Open profile">↗</button>
            </div>
            <div class="tree-meta">
              <span class="pill">${escapeHtml(ROLE_LABELS[p.role] || p.role)}</span>
              ${kids.length ? `<span>${kids.length} direct</span>` : ""}
              ${total ? `<span>${total} total</span>` : ""}
              <span>${s.doors} doors</span>
              <span>${money(s.revenue)}</span>
            </div>
          </div>
        </div>
        ${kids.length ? `
          <div class="tree-children ${open ? "open" : ""}" data-children="${p.id}">
            <div class="tree-children-inner">${kids.map((k) => treeNodeC(k, depth + 1, seen)).join("")}</div>
          </div>` : ""}
      </div>`;
  }
  function renderDownline() {
    const root = orgRoot();
    const total = downlineCountC(root.id);
    return `
      <div class="section-title"><h2>Downline</h2><span>${total} in the org</span></div>
      <div class="range-chips" style="margin-bottom:10px">
        <button id="treeExpandAll" type="button">Expand all</button>
        <button id="treeCollapseAll" type="button">Collapse all</button>
      </div>
      <section class="card tree-wrap">
        ${treeNodeC(root, 0, new Set())}
      </section>
      <p class="muted" style="text-align:center;margin-top:8px">Built from who recruited whom. Set a person's recruiter in <b>People</b>.</p>`;
  }
  function bindDownlineEvents() {
    if (activeTab !== "downline") return;
    if (!treeExpanded) { treeExpanded = new Set([orgRoot().id]); }
    // Toggle a node open/closed in place so the height animates smoothly.
    document.querySelectorAll("[data-tree-toggle]").forEach((el) =>
      el.addEventListener("click", (e) => {
        if (e.target.closest("[data-view-person]")) return; // let the ↗ button through
        const id = el.dataset.treeToggle;
        const box = document.querySelector(`.tree-children[data-children="${id}"]`);
        if (!box) return;
        const nowOpen = box.classList.toggle("open");
        const caret = document.querySelector(`.tree-caret[data-caret="${id}"]`);
        if (caret) caret.classList.toggle("open", nowOpen);
        if (nowOpen) treeExpanded.add(id); else treeExpanded.delete(id);
      }));
    bind("#treeExpandAll", "click", () => { treeExpanded = new Set(people.map((p) => p.id)); render(); });
    bind("#treeCollapseAll", "click", () => { treeExpanded = new Set([orgRoot().id]); render(); });
  }

  // ── People tab ──────────────────────────────────────────────────
  function recruitOptions(selectedId, excludeId) {
    // Admins can assign anyone as recruiter; leaders are limited to themselves
    // plus their own downline (so new/edited people stay within their reach).
    const allowed = (p) => perms.isAdmin || p.id === profile.id || inMyDownline(p.id);
    const opts = people
      .filter((p) => p.id !== excludeId && allowed(p))
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""))
      .map((p) => `<option value="${p.id}" ${selectedId === p.id ? "selected" : ""}>${escapeHtml(p.name)}${p.id === profile.id ? " (you)" : ""}</option>`)
      .join("");
    return `<option value="">— none —</option>${opts}`;
  }

  function renderPeople() {
    const teamName = (id) => (teams.find((t) => t.id === id) || {}).name || "No team";
    const rows = [...people].sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    return `
      <div class="section-title"><h2>People</h2>${perms.isAdmin ? `<button class="secondary" id="exportPeople" type="button" style="padding:6px 12px;font-size:13px">Export CSV</button>` : `<span>${people.length} org-wide</span>`}</div>
      ${perms.canAdd ? `
      <section class="card stack">
        <div class="section-title"><h3>Add a Person</h3><span>creates their account instantly</span></div>
        ${newAccountResult ? `
          <div class="temp-pass-box">
            <b>${escapeHtml(newAccountResult.name)}'s account is ready</b>
            <span>Email: <b>${escapeHtml(newAccountResult.email)}</b></span>
            <span>Temporary password:</span>
            <code>${escapeHtml(newAccountResult.tempPass)}</code>
            <small class="muted">Send them these credentials. They sign in to the KPI app and can change their password in Settings.</small>
            <button id="dismissNewAccount" class="secondary" type="button">Done</button>
          </div>` : `
          <div class="form-2col">
            <label>Full name <input id="npName" placeholder="Jane Doe" /></label>
            <label>Email <input id="npEmail" type="email" placeholder="jane@email.com" /></label>
            <label>Phone <input id="npPhone" placeholder="(555) 123-4567" /></label>
            <label>Role <select id="npRole">${ROLE_OPTIONS.map((r) => `<option value="${r}">${ROLE_LABELS[r]}</option>`).join("")}</select></label>
            <label>Recruited by <select id="npRecruit">${recruitOptions(profile.id, null)}</select></label>
          </div>
          <button id="createPerson" class="blue" type="button">Create Account</button>
          <p class="muted" id="createPersonError" style="color:var(--danger)"></p>`}
      </section>` : ""}
      <section class="card stack">
        <div class="section-title"><h3>Everyone</h3><span>tap a person for details</span></div>
        <div class="row-inline">
          <input id="peopleSearch" placeholder="Search by name..." />
        </div>
        ${rows.map((p) => {
          const s = personStats(p.id, null);
          return `
          <article class="record ${p.disabled ? "disabled-person" : ""}" data-person-row data-name="${escapeAttr((p.name || "").toLowerCase())}" data-team="${escapeAttr(p.team_id || "")}" data-view-person="${p.id}" style="cursor:pointer">
            <div class="record-top">
              <strong>${escapeHtml(p.name)}</strong>
              <span class="pill ${p.disabled ? "danger" : ""}">${p.disabled ? "Deactivated" : escapeHtml(ROLE_LABELS[p.role] || p.role)}</span>
            </div>
            <div class="meta-row">
              <span>${escapeHtml(teamName(p.team_id))}</span>
              <span>${s.doors} doors</span>
              <span>${s.sales} sales</span>
              <span>${money(s.revenue)}</span>
            </div>
          </article>`;
        }).join("") || `<p class="empty">No people yet.</p>`}
      </section>`;
  }

  // ── Person detail ───────────────────────────────────────────────
  function renderPersonDetail() {
    const p = people.find((x) => x.id === viewPersonId);
    if (!p) { viewPersonId = null; return renderPeople(); }

    const byDay = {};
    logs.filter((l) => l.user_id === p.id).forEach((l) => {
      const d = (byDay[l.date] = byDay[l.date] || { doors: 0, sales: 0, revenue: 0 });
      d.doors++; if (l.outcome === "sale") d.sales++; d.revenue += Number(l.contract_value || 0);
    });
    const days = Object.entries(byDay).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 14);
    const myRecruits = recruitsOf(p);
    const recruiterName = p.recruited_by
      ? (people.find((x) => x.id === p.recruited_by) || {}).name
      : p.recruited_by_name;

    return `
      <button class="back-link" id="backToPeople" type="button">&larr; All people</button>
      <div class="section-title"><h2>${escapeHtml(p.name)}</h2><span>${escapeHtml(ROLE_LABELS[p.role] || p.role)}</span></div>
      ${kpiRangeUI()}
      ${kpiFilterUI()}
      ${personKpiBody(p)}

      <section class="card stack">
        <div class="section-title"><h3>Day by Day</h3><span>last 14 active days</span></div>
        ${days.length ? `
        <table class="day-table">
          <thead><tr><th>Date</th><th>Doors</th><th>Sales</th><th>Revenue</th></tr></thead>
          <tbody>${days.map(([d, s]) => `<tr><td>${escapeHtml(d)}</td><td>${s.doors}</td><td>${s.sales}</td><td>${money(s.revenue)}</td></tr>`).join("")}</tbody>
        </table>` : `<p class="empty">No logged activity yet.</p>`}
      </section>

      <section class="card stack">
        <div class="section-title"><h3>Recruiting</h3><span>${myRecruits.length} direct recruit${myRecruits.length === 1 ? "" : "s"}</span></div>
        ${recruiterName ? `<small class="muted">Recruited by ${escapeHtml(recruiterName)}</small>` : ""}
        ${myRecruits.length ? myRecruits.map((r) => `
          <article class="record" data-view-person="${r.id}" style="cursor:pointer">
            <div class="record-top"><strong>${escapeHtml(r.name)}</strong><span class="pill">${escapeHtml(ROLE_LABELS[r.role] || r.role)}</span></div>
            <div class="meta-row"><span>${personStats(r.id, null).doors} doors</span><span>${money(personStats(r.id, null).revenue)}</span></div>
          </article>`).join("") : `<p class="empty">No recruits under this person yet.</p>`}
      </section>

      ${canEditPerson(p) ? `
      <section class="card stack">
        <div class="section-title"><h3>Edit Person</h3><span>details & assignment</span></div>
        <div class="form-2col">
          <label>Full name <input id="pdName" value="${escapeAttr(p.name || "")}" /></label>
          <label>Email <input id="pdEmail" type="email" value="${escapeAttr(p.email || "")}" /></label>
          <label>Phone <input id="pdPhone" value="${escapeAttr(p.phone || "")}" /></label>
          <label>Address <input id="pdAddress" value="${escapeAttr(p.address || "")}" /></label>
          <label>Role <select id="pdRole">${ROLE_OPTIONS.map((r) => `<option value="${r}" ${p.role === r ? "selected" : ""}>${ROLE_LABELS[r]}</option>`).join("")}</select></label>
          <label>Recruited by <select id="pdRecruit">${recruitOptions(p.recruited_by || "", p.id)}</select></label>
        </div>
        <div class="row-inline">
          <button id="pdSave" class="blue" type="button">Save Changes</button>
          ${p.email ? `<button id="pdReset" class="secondary" type="button">Send Password Reset</button>` : ""}
          <button id="pdToggle" class="${p.disabled ? "secondary" : "danger"}" type="button">${p.disabled ? "Reactivate" : "Deactivate"}</button>
        </div>
        ${perms.isAdmin ? `
        <hr class="divider" />
        <div class="section-title"><h3>Set Password</h3><span>overwrite &amp; hand off</span></div>
        <div class="row-inline">
          <input id="pdNewPw" type="text" placeholder="New password (min 6 characters)" autocomplete="off" />
          <button id="pdSetPw" class="blue" type="button">Set Password</button>
        </div>
        <small class="muted">Sets ${escapeHtml(p.name)}'s password immediately, then tell them the new one. Existing passwords can't be shown — only replaced.</small>` : ""}
        ${perms.canDelete ? `
        <hr class="divider" />
        <button id="pdDelete" class="danger" type="button">Delete Person Permanently</button>
        <small class="muted">Deleting removes their profile from all apps. Their logged history stays in the database.</small>` : ""}
      </section>` : `
      <section class="card stack">
        <div class="section-title"><h3>Profile</h3><span>view only</span></div>
        <div class="meta-row">
          ${p.email ? `<span>${escapeHtml(p.email)}</span>` : ""}
          ${p.phone ? `<span>${escapeHtml(p.phone)}</span>` : ""}
          ${p.address ? `<span>${escapeHtml(p.address)}</span>` : ""}
        </div>
        ${perms.isAdmin ? "" : `<small class="muted">You don't have permission to edit this person.</small>`}
      </section>`}`;
  }

  // ── Event binding ───────────────────────────────────────────────
  function bindTabEvents() {
    // dashboard
    document.querySelectorAll("[data-range]").forEach((b) =>
      b.addEventListener("click", () => {
        dashRange = b.dataset.range;
        if (dashRange === "custom" && !dashTo) {
          dashTo = dkey(new Date());
          const f = new Date(); f.setDate(f.getDate() - 30); dashFrom = dkey(f);
        }
        render();
      }));
    bind("#applyCustom", "click", () => {
      dashFrom = val("#dashFrom");
      dashTo = val("#dashTo");
      render();
    });
    // KPIs tab
    document.querySelectorAll("[data-kpi-range]").forEach((b) =>
      b.addEventListener("click", () => {
        kpiRange = b.dataset.kpiRange;
        if (kpiRange === "custom" && !kpiTo) {
          kpiTo = dkey(new Date());
          const f = new Date(); f.setDate(f.getDate() - 30); kpiFrom = dkey(f);
        }
        render();
      }));
    bind("#kpiApplyCustom", "click", () => { kpiFrom = val("#kpiFrom"); kpiTo = val("#kpiTo"); render(); });
    bind("#kpiSortSel", "change", (e) => { kpiSort = e.target.value; render(); });
    bind("#kpiSearch", "input", filterKpiList);
    bind("#kpiTeamFilter", "change", filterKpiList);
    document.querySelectorAll("[data-kpi-person]").forEach((el) =>
      el.addEventListener("click", () => { kpiPersonId = el.dataset.kpiPerson; render(); }));
    bind("#backToKpis", "click", () => { kpiPersonId = null; render(); });
    bind("#kpiHourStart", "change", (e) => { kpiHourStart = Number(e.target.value); render(); });
    bind("#kpiHourEnd", "change", (e) => { kpiHourEnd = Number(e.target.value); render(); });
    bind("#kpiDow", "change", (e) => { kpiDow = e.target.value; render(); });
    bind("#kpiResetFilters", "click", () => { kpiHourStart = 0; kpiHourEnd = 23; kpiDow = "all"; render(); });
    // exports
    bind("#exportLogs", "click", exportLogsCsv);
    bind("#exportPeople", "click", exportPeopleCsv);
    // downline
    bindDownlineEvents();
    // people
    bind("#createPerson", "click", createPerson);
    bind("#dismissNewAccount", "click", () => { newAccountResult = null; render(); });
    bind("#peopleSearch", "input", filterPeople);
    bind("#peopleTeamFilter", "change", filterPeople);
    document.querySelectorAll("[data-view-person]").forEach((el) =>
      el.addEventListener("click", () => { viewPersonId = el.dataset.viewPerson; activeTab = "people"; render(); }));
    // person detail
    bind("#backToPeople", "click", () => { viewPersonId = null; render(); });
    bind("#pdSave", "click", savePersonChanges);
    bind("#pdReset", "click", sendReset);
    bind("#pdToggle", "click", togglePersonDisabled);
    bind("#pdDelete", "click", deletePerson);
    bind("#pdSetPw", "click", setPersonPassword);
  }

  function filterPeople() {
    const q = (val("#peopleSearch") || "").toLowerCase();
    const t = val("#peopleTeamFilter");
    document.querySelectorAll("[data-person-row]").forEach((el) => {
      const name = el.getAttribute("data-name") || "";
      const team = el.getAttribute("data-team") || "";
      const show = name.includes(q) && (!t || t === "all" || team === t);
      el.style.display = show ? "" : "none";
    });
  }

  function filterKpiList() {
    const q = (val("#kpiSearch") || "").toLowerCase();
    const t = val("#kpiTeamFilter");
    document.querySelectorAll("[data-kpi-person]").forEach((el) => {
      const name = el.getAttribute("data-name") || "";
      const team = el.getAttribute("data-team") || "";
      const show = name.includes(q) && (!t || t === "all" || team === t);
      el.style.display = show ? "" : "none";
    });
  }

  // ── Team actions ────────────────────────────────────────────────
  async function createTeam() {
    const name = val("#newTeamName").trim();
    if (!name) return;
    const { data, error } = await sb.from("teams").insert({ name, short_code: generateShortCode() }).select().single();
    if (error) { alert("Couldn't create team: " + error.message); return; }
    teams.push(data);
    await sb.from("team_settings").insert({ team_id: data.id, app_name: "CORE KPI" });
    flash = `Team "${name}" created. Join code: ${data.short_code}`;
    render();
  }
  async function renameTeam(id) {
    const input = document.querySelector(`[data-rename-input="${id}"]`);
    const name = input ? input.value.trim() : "";
    if (!name) return;
    const { error } = await sb.from("teams").update({ name }).eq("id", id);
    if (error) { alert("Couldn't rename: " + error.message); return; }
    const t = teams.find((x) => x.id === id); if (t) t.name = name;
    flash = "Team renamed."; render();
  }
  async function deleteTeam(id) {
    if (people.some((p) => p.team_id === id)) { alert("Team still has members."); return; }
    if (!confirm("Delete this team? This can't be undone.")) return;
    const { error } = await sb.from("teams").delete().eq("id", id);
    if (error) { alert("Couldn't delete: " + error.message); return; }
    teams = teams.filter((t) => t.id !== id); render();
  }

  // ── People actions ──────────────────────────────────────────────
  // Some columns (recruited_by) may not exist until the migration runs;
  // retry the write without them so we never fail hard on an old schema.
  async function writeProfile(client, method, row, matchId) {
    let q = method === "insert" ? client.from("profiles").insert(row) : client.from("profiles").update(row).eq("id", matchId);
    let { error } = await q;
    if (error && /recruited_by\b/.test(error.message || "")) {
      const { recruited_by, ...rest } = row;
      q = method === "insert" ? client.from("profiles").insert(rest) : client.from("profiles").update(rest).eq("id", matchId);
      ({ error } = await q);
    }
    return error;
  }

  async function createPerson() {
    const errEl = $("#createPersonError");
    const name = val("#npName").trim();
    const email = val("#npEmail").trim().toLowerCase();
    const phone = val("#npPhone").trim();
    // One org (Momentum): everyone shares the owner's team behind the scenes.
    const team_id = profile.team_id || (teams[0] && teams[0].id) || null;
    const role = val("#npRole");
    const recruitId = val("#npRecruit");
    if (!name || !email) { if (errEl) errEl.textContent = "Name and email are required."; return; }

    const btn = $("#createPerson");
    if (btn) { btn.disabled = true; btn.textContent = "Creating..."; }
    const tempPass = generateTempPassword();
    const recruiter = recruitId ? people.find((x) => x.id === recruitId) : null;

    const sb2 = window.__CORE_MOCK_SB
      ? window.__CORE_MOCK_SB
      : window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
          auth: { storageKey: "core-invite-tmp", persistSession: false },
        });

    const { data: signUpData, error: signUpErr } = await sb2.auth.signUp({ email, password: tempPass });
    if (signUpErr || !signUpData || !signUpData.user) {
      if (btn) { btn.disabled = false; btn.textContent = "Create Account"; }
      if (errEl) errEl.textContent = "Couldn't create account: " + (signUpErr ? signUpErr.message : "unknown error");
      return;
    }

    const newProfile = {
      id: signUpData.user.id,
      team_id, role, name, email, phone,
      recruited_by: recruiter ? recruiter.id : null,
      recruited_by_name: recruiter ? recruiter.name : "",
      needs_onboarding: true,
    };
    const profErr = await writeProfile(sb2, "insert", newProfile);
    await sb2.auth.signOut();
    if (profErr) {
      if (btn) { btn.disabled = false; btn.textContent = "Create Account"; }
      if (errEl) errEl.textContent = "Account created but profile failed: " + profErr.message;
      return;
    }

    people.push({ ...newProfile, disabled: false, created_at: new Date().toISOString() });
    newAccountResult = { name, email, tempPass };
    render();
  }

  async function savePersonChanges() {
    const p = people.find((x) => x.id === viewPersonId);
    if (!p) return;
    const recruitId = val("#pdRecruit");
    const recruiter = recruitId ? people.find((x) => x.id === recruitId) : null;
    const updates = {
      name: val("#pdName").trim() || p.name,
      email: val("#pdEmail").trim(),
      phone: val("#pdPhone").trim(),
      address: val("#pdAddress").trim(),
      role: val("#pdRole"),
      recruited_by: recruiter ? recruiter.id : null,
      recruited_by_name: recruiter ? recruiter.name : "",
    };
    const error = await writeProfile(sb, "update", updates, p.id);
    if (error) { alert("Couldn't save: " + error.message); return; }
    Object.assign(p, updates);
    flash = "Saved."; render();
  }

  async function sendReset() {
    const p = people.find((x) => x.id === viewPersonId);
    if (!p || !p.email) return;
    const { error } = await sb.auth.resetPasswordForEmail(p.email);
    const btn = $("#pdReset");
    if (btn) btn.textContent = error ? "Couldn't send — try again" : "Reset email sent!";
  }

  // Set a rep's password via the admin-only Edge Function (service role
  // stays server-side). Existing passwords can't be read — only replaced.
  async function setPersonPassword() {
    const p = people.find((x) => x.id === viewPersonId);
    if (!p) return;
    const pw = val("#pdNewPw");
    if (!pw || pw.length < 6) { alert("Password must be at least 6 characters."); return; }
    const btn = $("#pdSetPw");
    if (btn) { btn.disabled = true; btn.textContent = "Setting..."; }
    if (window.__CORE_MOCK_SB) { flash = `Password updated for ${p.name} (demo).`; render(); return; }
    try {
      const { data } = await sb.auth.getSession();
      const token = data && data.session ? data.session.access_token : "";
      const res = await fetch(`${SUPABASE_URL}/functions/v1/set-password`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ userId: p.id, password: pw }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error || `Failed (${res.status})`);
      flash = `Password updated for ${p.name}.`;
      render();
    } catch (e) {
      if (btn) { btn.disabled = false; btn.textContent = "Set Password"; }
      alert("Couldn't set password: " + e.message + "\n\nMake sure the set-password Edge Function is deployed.");
    }
  }

  async function togglePersonDisabled() {
    const p = people.find((x) => x.id === viewPersonId);
    if (!p) return;
    const next = !p.disabled;
    if (next && !confirm(`Deactivate ${p.name}? They won't be able to use the apps.`)) return;
    const { error } = await sb.from("profiles").update({ disabled: next }).eq("id", p.id);
    if (error) { alert("Couldn't update: " + error.message); return; }
    p.disabled = next; render();
  }

  async function deletePerson() {
    const p = people.find((x) => x.id === viewPersonId);
    if (!p) return;
    if (!confirm(`Permanently delete ${p.name}? This removes their profile from all apps. This can't be undone.`)) return;
    const { error } = await sb.from("profiles").delete().eq("id", p.id);
    if (error) { alert("Couldn't delete: " + error.message); return; }
    // clear recruit links that pointed at them
    people.forEach((x) => { if (x.recruited_by === p.id) x.recruited_by = null; });
    people = people.filter((x) => x.id !== p.id);
    viewPersonId = null;
    flash = `${p.name} deleted.`;
    render();
  }

  // ── CSV export ──────────────────────────────────────────────────
  function downloadCsv(filename, header, rows) {
    const q = (v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
    const csv = [header.map(q).join(","), ...rows.map((r) => r.map(q).join(","))].join("\r\n");
    const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function exportPeopleCsv() {
    const teamName = (id) => (teams.find((t) => t.id === id) || {}).name || "";
    const rows = people.map((p) => {
      const s = personStats(p.id, null);
      return [p.name, ROLE_LABELS[p.role] || p.role, teamName(p.team_id), p.email || "", p.phone || "",
        p.disabled ? "deactivated" : "active", s.doors, s.sales, Number.isFinite(s.closeRate) ? Math.round(s.closeRate) + "%" : "",
        Math.round(s.revenue), p.recruited_by_name || "", p.created_at ? new Date(p.created_at).toLocaleDateString() : ""];
    });
    downloadCsv("core-people-" + dkey(new Date()) + ".csv",
      ["Name", "Role", "Team", "Email", "Phone", "Status", "Doors", "Sales", "Close %", "Revenue", "Recruited by", "Joined"], rows);
  }
  function exportLogsCsv() {
    const nameOf = (id) => (people.find((p) => p.id === id) || {}).name || "";
    const teamName = (id) => (teams.find((t) => t.id === id) || {}).name || "";
    const rows = [...logs].sort((a, b) => (a.date < b.date ? 1 : -1)).map((l) =>
      [l.date, nameOf(l.user_id), teamName(l.team_id), l.outcome, Math.round(Number(l.contract_value || 0)),
        l.created_at ? new Date(l.created_at).toLocaleTimeString() : ""]);
    downloadCsv("core-logs-" + dkey(new Date()) + ".csv",
      ["Date", "Rep", "Team", "Outcome", "Contract $", "Time"], rows);
  }

  init();
})();
