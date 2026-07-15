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

  const appRoot = () => document.getElementById("app");
  const $ = (sel) => document.querySelector(sel);
  const val = (sel) => ($(sel) ? $(sel).value : "");
  const bind = (sel, ev, fn) => { const el = $(sel); if (el) el.addEventListener(ev, fn); };

  const ROLE_OPTIONS = ["rep", "manager", "regional"];
  const ROLE_LABELS = { rep: "Rep", manager: "Manager", regional: "Regional", admin: "Owner" };

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  const escapeAttr = escapeHtml;
  const money = (n) => "$" + Math.round(Number(n) || 0).toLocaleString();
  const pct = (n) => (Number.isFinite(n) ? Math.round(n) + "%" : "—");

  function dkey(d) {
    const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), dd = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${dd}`;
  }
  function logFetchCutoff() {
    const d = new Date();
    d.setDate(d.getDate() - LOG_FETCH_WINDOW_DAYS);
    return dkey(d);
  }
  function generateShortCode() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let s = "";
    for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return s;
  }
  function generateTempPassword() {
    const words = ["DOOR", "CORE", "TEAM", "BLUE", "NAVY", "PEAK", "GOAL", "PACE"];
    const w = words[Math.floor(Math.random() * words.length)];
    return w + Math.floor(1000 + Math.random() * 9000) + "!";
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
    if (error) {
      authError = error.message || "Sign-in failed.";
      render();
      return;
    }
    session = data.session;
    await afterLogin();
    render();
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
    const tabs = [
      ["dashboard", "Dashboard"],
      ["teams", "Teams"],
      ["people", "People"],
    ];
    let body = "";
    if (activeTab === "dashboard") body = renderDashboard();
    else if (activeTab === "teams") body = renderTeams();
    else if (activeTab === "people") body = viewPersonId ? renderPersonDetail() : renderPeople();

    appRoot().innerHTML = `
      <header class="topbar">
        <div class="brand-row">
          <img src="favicon.svg" alt="" />
          <div><h1>CORE</h1></div>
        </div>
        <div class="row-inline">
          <small>${escapeHtml(profile.name)}</small>
          <button id="signOut" type="button">Sign Out</button>
        </div>
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

  // ── Stats helpers ───────────────────────────────────────────────
  function personStats(id, sinceKey) {
    const mine = logs.filter((l) => l.user_id === id && (!sinceKey || l.date >= sinceKey));
    const doors = mine.length;
    const sales = mine.filter((l) => l.outcome === "sale").length;
    const answered = mine.filter((l) => ["answered", "pitch", "appointment", "sale"].includes(l.outcome)).length;
    const closeRate = answered ? (sales / answered) * 100 : NaN;
    const revenue = mine.reduce((s, l) => s + Number(l.contract_value || 0), 0);
    return { doors, sales, closeRate, revenue };
  }
  function orgStats(sinceKey) {
    const rows = sinceKey ? logs.filter((l) => l.date >= sinceKey) : logs;
    const doors = rows.length;
    const sales = rows.filter((l) => l.outcome === "sale").length;
    const revenue = rows.reduce((s, l) => s + Number(l.contract_value || 0), 0);
    return { doors, sales, revenue };
  }
  function weekAgoKey() { const d = new Date(); d.setDate(d.getDate() - 7); return dkey(d); }

  // ── Dashboard ───────────────────────────────────────────────────
  function renderDashboard() {
    const todayKey = dkey(new Date());
    const today = orgStats(todayKey);
    const week = orgStats(weekAgoKey());
    const all = orgStats(null);
    const active = people.filter((p) => !p.disabled);

    const teamRows = teams.map((t) => {
      const memberIds = new Set(people.filter((p) => p.team_id === t.id).map((p) => p.id));
      const tLogs = logs.filter((l) => memberIds.has(l.user_id) && l.date >= weekAgoKey());
      const doors = tLogs.length;
      const sales = tLogs.filter((l) => l.outcome === "sale").length;
      const revenue = tLogs.reduce((s, l) => s + Number(l.contract_value || 0), 0);
      return { team: t, members: memberIds.size, doors, sales, revenue };
    }).sort((a, b) => b.revenue - a.revenue);

    return `
      <div class="section-title"><h2>Organization</h2><span>${teams.length} team${teams.length === 1 ? "" : "s"} · ${active.length} people</span></div>
      <div class="stat-grid">
        <div class="stat"><small>Doors Today</small><strong>${today.doors}</strong><span>${today.sales} sales</span></div>
        <div class="stat"><small>Revenue Today</small><strong>${money(today.revenue)}</strong><span>org-wide</span></div>
        <div class="stat"><small>Doors (7d)</small><strong>${week.doors}</strong><span>${week.sales} sales</span></div>
        <div class="stat"><small>Revenue (7d)</small><strong>${money(week.revenue)}</strong><span>org-wide</span></div>
        <div class="stat"><small>Doors (all)</small><strong>${all.doors}</strong><span>last ${LOG_FETCH_WINDOW_DAYS} days</span></div>
        <div class="stat"><small>Revenue (all)</small><strong>${money(all.revenue)}</strong><span>last ${LOG_FETCH_WINDOW_DAYS} days</span></div>
      </div>
      <section class="card stack">
        <div class="section-title"><h3>Teams — last 7 days</h3><span>sorted by revenue</span></div>
        ${teamRows.length ? teamRows.map((r) => `
          <div class="progress-row">
            <div class="row-head"><b>${escapeHtml(r.team.name)}</b><span>${money(r.revenue)}</span></div>
            <div class="meta-row"><span>${r.members} members</span><span>${r.doors} doors</span><span>${r.sales} sales</span></div>
          </div>`).join("") : `<p class="empty">No teams yet.</p>`}
      </section>
      <section class="card stack">
        <div class="section-title"><h3>Top People — last 7 days</h3><span>by revenue</span></div>
        ${renderLeaders()}
      </section>`;
  }

  function renderLeaders() {
    const rows = people
      .filter((p) => !p.disabled)
      .map((p) => ({ p, s: personStats(p.id, weekAgoKey()) }))
      .filter((r) => r.s.doors > 0)
      .sort((a, b) => b.s.revenue - a.s.revenue)
      .slice(0, 8);
    if (!rows.length) return `<p class="empty">No activity in the last 7 days.</p>`;
    return rows.map(({ p, s }) => `
      <article class="record">
        <div class="record-top"><strong>${escapeHtml(p.name)}</strong><span class="pill blue">${money(s.revenue)}</span></div>
        <div class="meta-row"><span>${s.doors} doors</span><span>${s.sales} sales</span><span>${pct(s.closeRate)} close</span></div>
      </article>`).join("");
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
            <label>Team <select id="npTeam">${teams.map((t) => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join("")}</select></label>
            <label>Role <select id="npRole">${ROLE_OPTIONS.map((r) => `<option value="${r}">${ROLE_LABELS[r]}</option>`).join("")}</select></label>
          </div>
          <button id="createPerson" class="blue" type="button">Create Account</button>
          <p class="muted" id="createPersonError" style="color:var(--danger)"></p>`}
      </section>
      <section class="card stack">
        <div class="section-title"><h3>Everyone</h3><span>tap a person for details</span></div>
        ${rows.map((p) => {
          const s = personStats(p.id, null);
          return `
          <article class="record ${p.disabled ? "disabled-person" : ""}" data-view-person="${p.id}" style="cursor:pointer">
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

    // per-day breakdown, most recent 14 active days
    const byDay = {};
    logs.filter((l) => l.user_id === p.id).forEach((l) => {
      const d = (byDay[l.date] = byDay[l.date] || { doors: 0, sales: 0, revenue: 0 });
      d.doors++;
      if (l.outcome === "sale") d.sales++;
      d.revenue += Number(l.contract_value || 0);
    });
    const days = Object.entries(byDay).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 14);

    const isOwner = p.role === "admin";
    return `
      <button class="back-link" id="backToPeople" type="button">&larr; All people</button>
      <div class="section-title"><h2>${escapeHtml(p.name)}</h2><span>${escapeHtml(ROLE_LABELS[p.role] || p.role)}</span></div>
      <div class="stat-grid">
        <div class="stat"><small>Doors (7d)</small><strong>${week.doors}</strong><span>${week.sales} sales</span></div>
        <div class="stat"><small>Doors (total)</small><strong>${all.doors}</strong><span>last ${LOG_FETCH_WINDOW_DAYS} days</span></div>
        <div class="stat"><small>Close rate</small><strong>${pct(all.closeRate)}</strong><span>of answered doors</span></div>
        <div class="stat"><small>Revenue</small><strong>${money(all.revenue)}</strong><span>logged sales</span></div>
      </div>
      <section class="card stack">
        <div class="section-title"><h3>Day by Day</h3><span>last 14 active days</span></div>
        ${days.length ? `
        <table class="day-table">
          <thead><tr><th>Date</th><th>Doors</th><th>Sales</th><th>Revenue</th></tr></thead>
          <tbody>${days.map(([d, s]) => `<tr><td>${escapeHtml(d)}</td><td>${s.doors}</td><td>${s.sales}</td><td>${money(s.revenue)}</td></tr>`).join("")}</tbody>
        </table>` : `<p class="empty">No logged activity yet.</p>`}
      </section>
      <section class="card stack">
        <div class="section-title"><h3>Profile</h3><span>contact & details</span></div>
        <div class="meta-row">
          ${p.email ? `<span>${escapeHtml(p.email)}</span>` : ""}
          ${p.phone ? `<span>${escapeHtml(p.phone)}</span>` : ""}
          ${p.address ? `<span>${escapeHtml(p.address)}</span>` : ""}
        </div>
        <small class="muted">Joined ${new Date(p.created_at).toLocaleDateString()}${p.recruited_by_name ? " · Recruited by " + escapeHtml(p.recruited_by_name) : ""}</small>
      </section>
      ${isOwner ? "" : `
      <section class="card stack">
        <div class="section-title"><h3>Manage</h3><span>role, team, access</span></div>
        <div class="form-2col">
          <label>Role
            <select id="pdRole">${ROLE_OPTIONS.map((r) => `<option value="${r}" ${p.role === r ? "selected" : ""}>${ROLE_LABELS[r]}</option>`).join("")}</select>
          </label>
          <label>Team
            <select id="pdTeam">${teams.map((t) => `<option value="${t.id}" ${p.team_id === t.id ? "selected" : ""}>${escapeHtml(t.name)}</option>`).join("")}</select>
          </label>
        </div>
        <div class="row-inline">
          <button id="pdSave" class="blue" type="button">Save Changes</button>
          ${p.email ? `<button id="pdReset" class="secondary" type="button">Send Password Reset</button>` : ""}
          <button id="pdToggle" class="${p.disabled ? "secondary" : "danger"}" type="button">${p.disabled ? "Reactivate" : "Deactivate"}</button>
        </div>
      </section>`}`;
  }

  // ── Event binding per tab ───────────────────────────────────────
  function bindTabEvents() {
    // Teams
    bind("#createTeam", "click", createTeam);
    document.querySelectorAll("[data-rename-team]").forEach((b) =>
      b.addEventListener("click", () => renameTeam(b.dataset.renameTeam)));
    document.querySelectorAll("[data-delete-team]").forEach((b) =>
      b.addEventListener("click", () => deleteTeam(b.dataset.deleteTeam)));

    // People
    bind("#createPerson", "click", createPerson);
    bind("#dismissNewAccount", "click", () => { newAccountResult = null; render(); });
    document.querySelectorAll("[data-view-person]").forEach((el) =>
      el.addEventListener("click", () => { viewPersonId = el.dataset.viewPerson; render(); }));

    // Person detail
    bind("#backToPeople", "click", () => { viewPersonId = null; render(); });
    bind("#pdSave", "click", savePersonChanges);
    bind("#pdReset", "click", sendReset);
    bind("#pdToggle", "click", togglePersonDisabled);
  }

  // ── Team actions ────────────────────────────────────────────────
  async function createTeam() {
    const name = val("#newTeamName").trim();
    if (!name) return;
    const { data, error } = await sb.from("teams").insert({ name, short_code: generateShortCode() }).select().single();
    if (error) { alert("Couldn't create team: " + error.message); return; }
    teams.push(data);
    // every team needs a settings row so the KPI app has goals to read
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
    const t = teams.find((x) => x.id === id);
    if (t) t.name = name;
    flash = "Team renamed.";
    render();
  }

  async function deleteTeam(id) {
    if (people.some((p) => p.team_id === id)) { alert("Team still has members."); return; }
    if (!confirm("Delete this team? This can't be undone.")) return;
    const { error } = await sb.from("teams").delete().eq("id", id);
    if (error) { alert("Couldn't delete: " + error.message); return; }
    teams = teams.filter((t) => t.id !== id);
    render();
  }

  // ── People actions ──────────────────────────────────────────────
  // Creating another user's account from the browser: we use a second,
  // throwaway Supabase client so signing THEM up doesn't replace the
  // admin's own session. The new user's own session then inserts their
  // profile row (RLS allows inserting your own profile), and we sign
  // the throwaway client out.
  async function createPerson() {
    const errEl = $("#createPersonError");
    const name = val("#npName").trim();
    const email = val("#npEmail").trim().toLowerCase();
    const team_id = val("#npTeam");
    const role = val("#npRole");
    if (!name || !email) { if (errEl) errEl.textContent = "Name and email are required."; return; }
    if (!team_id) { if (errEl) errEl.textContent = "Create a team first."; return; }

    const btn = $("#createPerson");
    if (btn) { btn.disabled = true; btn.textContent = "Creating..."; }
    const tempPass = generateTempPassword();

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
      team_id, role, name, email,
      recruited_by_name: profile.name,
      needs_onboarding: true,
    };
    const { error: profErr } = await sb2.from("profiles").insert(newProfile);
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
    const role = val("#pdRole");
    const team_id = val("#pdTeam");
    const { error } = await sb.from("profiles").update({ role, team_id }).eq("id", p.id);
    if (error) { alert("Couldn't save: " + error.message); return; }
    p.role = role; p.team_id = team_id;
    flash = "Saved.";
    render();
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
    p.disabled = next;
    render();
  }

  init();
})();
