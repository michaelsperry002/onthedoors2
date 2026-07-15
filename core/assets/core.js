(() => {
  "use strict";

  // ── Supabase (shared backend with CORE KPI) ─────────────────────
  const SUPABASE_URL = "https://tpzfmnyrqsqewgtkpxie.supabase.co";
  const SUPABASE_ANON_KEY = "sb_publishable_hgsd7UGGL2EjqVM875LzKA_fqjFgwbW";

  // Only this account may ever use CORE. Enforced here AND by the
  // role='admin' check + RLS policies in the database.
  const ADMIN_EMAIL = "michaelsperry002@gmail.com";

  const sb = window.__CORE_MOCK_SB
    ? window.__CORE_MOCK_SB
    : window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { storageKey: "core-admin-auth" },
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
  let dashRange = "30"; // "7" | "30" | "90" | "all"

  const appRoot = () => document.getElementById("app");
  const $ = (sel) => document.querySelector(sel);
  const val = (sel) => ($(sel) ? $(sel).value : "");
  const bind = (sel, ev, fn) => { const el = $(sel); if (el) el.addEventListener(ev, fn); };

  const ROLE_OPTIONS = ["rep", "manager", "regional"];
  const ROLE_LABELS = { rep: "Rep", manager: "Manager", regional: "Regional", admin: "Owner" };
  const RANGES = [["7", "7 days"], ["30", "30 days"], ["90", "90 days"], ["all", "All time"]];

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
  function rangeLabel(range) { return range === "all" ? "all time" : `last ${range} days`; }

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
    const email = (session.user.email || "").toLowerCase();
    if (email !== ADMIN_EMAIL) {
      await sb.auth.signOut();
      session = null;
      authError = "This app is restricted to the organization owner.";
      return;
    }
    const { data: prof } = await sb.from("profiles").select("*").eq("id", session.user.id).single();
    if (!prof || prof.role !== "admin") {
      await sb.auth.signOut();
      session = null;
      authError = "This account does not have admin access.";
      return;
    }
    profile = prof;
    await loadAll();
  }

  async function signIn() {
    authError = "";
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

  // Build a daily (or monthly for "all") time series from a set of log rows.
  function seriesFor(rows, range) {
    const labels = [], doors = [], revenue = [];
    if (range === "all") {
      const now = new Date();
      for (let m = 11; m >= 0; m--) {
        const d = new Date(now.getFullYear(), now.getMonth() - m, 1);
        const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
        labels.push(d.toLocaleString(undefined, { month: "short" }));
        const mr = rows.filter((r) => r.date && r.date.slice(0, 7) === key);
        doors.push(mr.length);
        revenue.push(mr.reduce((s, x) => s + Number(x.contract_value || 0), 0));
      }
    } else {
      const n = Number(range), today = new Date();
      for (let i = n - 1; i >= 0; i--) {
        const d = new Date(today); d.setDate(d.getDate() - i);
        const key = dkey(d);
        labels.push(key);
        const dr = rows.filter((r) => r.date === key);
        doors.push(dr.length);
        revenue.push(dr.reduce((s, x) => s + Number(x.contract_value || 0), 0));
      }
    }
    return { labels, doors, revenue };
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
    return `<div class="chart-wrap"><div class="bars">${values.map((v, i) => `
      <div class="bar-col">
        <div class="bar-fill" style="height:${(v / max * 100).toFixed(1)}%;background:${color}" title="${escapeAttr(labels[i])}: ${escapeAttr(fmt(v))}"></div>
        <span>${(i % step === 0 || i === values.length - 1) ? escapeHtml(shortLabel(labels[i])) : "&nbsp;"}</span>
      </div>`).join("")}</div></div>`;
  }

  // ── Rendering ───────────────────────────────────────────────────
  function render() {
    if (loading) {
      appRoot().innerHTML = `<main class="screen"><section class="auth-card"><div class="brand"><small>CORE</small><h1>Loading...</h1></div></section></main>`;
      return;
    }
    if (!session || !profile) return renderAuth();
    renderApp();
  }

  function renderAuth() {
    appRoot().innerHTML = `
      <main class="screen">
        <section class="auth-card">
          <div class="brand">
            <img class="logo" src="favicon.svg" alt="CORE" />
            <small>CORE</small>
            <h1>Admin Control Hub</h1>
            <p class="muted">Owner access only.</p>
          </div>
          ${authError ? `<p class="auth-error">${escapeHtml(authError)}</p>` : ""}
          <label>Email <input id="email" type="email" autocomplete="username" /></label>
          <label>Password <input id="password" type="password" autocomplete="current-password" /></label>
          <button id="signInBtn" class="primary" type="button">Sign In</button>
        </section>
      </main>`;
    bind("#signInBtn", "click", signIn);
    bind("#password", "keydown", (e) => { if (e.key === "Enter") signIn(); });
  }

  function renderApp() {
    const tabs = [["dashboard", "Dashboard"], ["teams", "Teams"], ["people", "People"]];
    let body = "";
    if (activeTab === "dashboard") body = renderDashboard();
    else if (activeTab === "teams") body = renderTeams();
    else if (activeTab === "people") body = viewPersonId ? renderPersonDetail() : renderPeople();

    appRoot().innerHTML = `
      <header class="topbar">
        <div class="brand-row"><img src="favicon.svg" alt="" /><div><h1>CORE</h1></div></div>
        <div class="row-inline"><small>${escapeHtml(profile.name)}</small><button id="signOut" type="button">Sign Out</button></div>
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
      b.addEventListener("click", () => { activeTab = b.dataset.tab; viewPersonId = null; render(); }));
    bindTabEvents();
  }

  // ── Dashboard ───────────────────────────────────────────────────
  function renderDashboard() {
    const range = dashRange;
    const since = sinceKeyFor(range);
    const rows = since ? logs.filter((l) => l.date >= since) : logs;
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
      <div class="section-title"><h2>Organization</h2><span>${teams.length} team${teams.length === 1 ? "" : "s"} · ${active.length} active</span></div>
      <div class="range-chips" id="rangeChips">
        ${RANGES.map(([v, l]) => `<button data-range="${v}" class="${range === v ? "active" : ""}" type="button">${l}</button>`).join("")}
      </div>

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
        <div class="section-title"><h3>Teams</h3><span>${rangeLabel(range)} · by revenue</span></div>
        ${teamRows.length ? teamRows.map((r) => `
          <div class="progress-row">
            <div class="row-head"><b>${escapeHtml(r.team.name)}</b><span>${money(r.revenue)}</span></div>
            <div class="track"><div class="track-fill" style="width:${(r.revenue / maxTeamRev * 100).toFixed(1)}%"></div></div>
            <div class="meta-row"><span>${r.members} members</span><span>${r.doors} doors</span><span>${r.sales} sales</span><span>${pct(r.closeRate)} close</span></div>
          </div>`).join("") : `<p class="empty">No teams yet.</p>`}
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

  // ── Teams tab ───────────────────────────────────────────────────
  function renderTeams() {
    return `
      <div class="section-title"><h2>Teams</h2><span>${teams.length} total</span></div>
      <section class="card stack">
        <div class="section-title"><h3>Create a Team</h3><span>gets its own join code</span></div>
        <div class="row-inline">
          <input id="newTeamName" placeholder="Team name, e.g. Desert Hawks" />
          <button id="createTeam" class="blue" type="button">Create</button>
        </div>
      </section>
      ${teams.map((t) => {
        const members = people.filter((p) => p.team_id === t.id);
        return `
        <section class="card stack">
          <div class="section-title"><h3>${escapeHtml(t.name)}</h3><span>${members.length} member${members.length === 1 ? "" : "s"}</span></div>
          <div class="meta-row"><span>Join code: <b>${escapeHtml(t.short_code || "—")}</b></span></div>
          <div class="row-inline">
            <input data-rename-input="${t.id}" value="${escapeAttr(t.name)}" />
            <button class="secondary" data-rename-team="${t.id}" type="button">Rename</button>
          </div>
          ${members.length ? "" : `<button class="danger" data-delete-team="${t.id}" type="button">Delete empty team</button>`}
        </section>`;
      }).join("")}`;
  }

  // ── People tab ──────────────────────────────────────────────────
  function recruitOptions(selectedId, excludeId) {
    const opts = people
      .filter((p) => p.id !== excludeId)
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""))
      .map((p) => `<option value="${p.id}" ${selectedId === p.id ? "selected" : ""}>${escapeHtml(p.name)}${p.role === "admin" ? " (you)" : ""}</option>`)
      .join("");
    return `<option value="">— none —</option>${opts}`;
  }

  function renderPeople() {
    const teamName = (id) => (teams.find((t) => t.id === id) || {}).name || "No team";
    const rows = [...people].sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    return `
      <div class="section-title"><h2>People</h2><span>${people.length} org-wide</span></div>
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
            <label>Team <select id="npTeam">${teams.map((t) => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join("")}</select></label>
            <label>Role <select id="npRole">${ROLE_OPTIONS.map((r) => `<option value="${r}">${ROLE_LABELS[r]}</option>`).join("")}</select></label>
            <label>Direct recruit <select id="npRecruit">${recruitOptions(profile.id, null)}</select></label>
          </div>
          <button id="createPerson" class="blue" type="button">Create Account</button>
          <p class="muted" id="createPersonError" style="color:var(--danger)"></p>`}
      </section>
      <section class="card stack">
        <div class="section-title"><h3>Everyone</h3><span>tap a person for details</span></div>
        <div class="row-inline">
          <input id="peopleSearch" placeholder="Search by name..." />
          <select id="peopleTeamFilter">
            <option value="all">All teams</option>
            ${teams.map((t) => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join("")}
          </select>
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
    const all = personStats(p.id, null);
    const week = personStats(p.id, weekAgoKey());
    const ser = seriesFor(logs.filter((l) => l.user_id === p.id), "30");

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
    const isOwner = p.role === "admin";

    return `
      <button class="back-link" id="backToPeople" type="button">&larr; All people</button>
      <div class="section-title"><h2>${escapeHtml(p.name)}</h2><span>${escapeHtml(ROLE_LABELS[p.role] || p.role)}</span></div>
      <div class="stat-grid">
        <div class="stat"><small>Doors (7d)</small><strong>${week.doors}</strong><span>${week.sales} sales</span></div>
        <div class="stat"><small>Doors (total)</small><strong>${all.doors}</strong><span>last ${LOG_FETCH_WINDOW_DAYS} days</span></div>
        <div class="stat"><small>Close rate</small><strong>${pct(all.closeRate)}</strong><span>of answered</span></div>
        <div class="stat"><small>Revenue</small><strong>${money(all.revenue)}</strong><span>logged sales</span></div>
      </div>

      <section class="card stack">
        <div class="section-title"><h3>Doors — last 30 days</h3><span>daily</span></div>
        ${barsHtml(ser.doors, ser.labels, { color: "var(--core-blue)" })}
      </section>

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

      ${isOwner ? `
      <section class="card stack">
        <div class="section-title"><h3>Profile</h3><span>owner account</span></div>
        <div class="meta-row">
          ${p.email ? `<span>${escapeHtml(p.email)}</span>` : ""}
          ${p.phone ? `<span>${escapeHtml(p.phone)}</span>` : ""}
        </div>
      </section>` : `
      <section class="card stack">
        <div class="section-title"><h3>Edit Person</h3><span>details & assignment</span></div>
        <div class="form-2col">
          <label>Full name <input id="pdName" value="${escapeAttr(p.name || "")}" /></label>
          <label>Email <input id="pdEmail" type="email" value="${escapeAttr(p.email || "")}" /></label>
          <label>Phone <input id="pdPhone" value="${escapeAttr(p.phone || "")}" /></label>
          <label>Address <input id="pdAddress" value="${escapeAttr(p.address || "")}" /></label>
          <label>Role <select id="pdRole">${ROLE_OPTIONS.map((r) => `<option value="${r}" ${p.role === r ? "selected" : ""}>${ROLE_LABELS[r]}</option>`).join("")}</select></label>
          <label>Team <select id="pdTeam">${teams.map((t) => `<option value="${t.id}" ${p.team_id === t.id ? "selected" : ""}>${escapeHtml(t.name)}</option>`).join("")}</select></label>
          <label>Direct recruit <select id="pdRecruit">${recruitOptions(p.recruited_by || "", p.id)}</select></label>
        </div>
        <div class="row-inline">
          <button id="pdSave" class="blue" type="button">Save Changes</button>
          ${p.email ? `<button id="pdReset" class="secondary" type="button">Send Password Reset</button>` : ""}
          <button id="pdToggle" class="${p.disabled ? "secondary" : "danger"}" type="button">${p.disabled ? "Reactivate" : "Deactivate"}</button>
        </div>
        <hr class="divider" />
        <button id="pdDelete" class="danger" type="button">Delete Person Permanently</button>
        <small class="muted">Deleting removes their profile from all apps. Their logged history stays in the database.</small>
      </section>`}`;
  }

  // ── Event binding ───────────────────────────────────────────────
  function bindTabEvents() {
    // dashboard
    document.querySelectorAll("[data-range]").forEach((b) =>
      b.addEventListener("click", () => { dashRange = b.dataset.range; render(); }));
    // teams
    bind("#createTeam", "click", createTeam);
    document.querySelectorAll("[data-rename-team]").forEach((b) =>
      b.addEventListener("click", () => renameTeam(b.dataset.renameTeam)));
    document.querySelectorAll("[data-delete-team]").forEach((b) =>
      b.addEventListener("click", () => deleteTeam(b.dataset.deleteTeam)));
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
    const team_id = val("#npTeam");
    const role = val("#npRole");
    const recruitId = val("#npRecruit");
    if (!name || !email) { if (errEl) errEl.textContent = "Name and email are required."; return; }
    if (!team_id) { if (errEl) errEl.textContent = "Create a team first."; return; }

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
      team_id: val("#pdTeam"),
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

  init();
})();
