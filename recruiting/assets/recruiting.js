(() => {
  "use strict";

  // ── Supabase (shared backend with CORE + CORE KPI) ──────────────
  const SUPABASE_URL = "https://tpzfmnyrqsqewgtkpxie.supabase.co";
  const SUPABASE_ANON_KEY = "sb_publishable_hgsd7UGGL2EjqVM875LzKA_fqjFgwbW";
  const CORE_URL = "/core/";

  // Shared session across CORE KPI / CORE / Recruiting, with a "Remember me"
  // flag (default on) selecting localStorage vs sessionStorage.
  const REMEMBER_KEY = "core.remember";
  const remembered = () => localStorage.getItem(REMEMBER_KEY) !== "0";
  const authStorage = {
    getItem(k) { return (remembered() ? localStorage : sessionStorage).getItem(k) || localStorage.getItem(k) || sessionStorage.getItem(k); },
    setItem(k, v) { (remembered() ? localStorage : sessionStorage).setItem(k, v); },
    removeItem(k) { localStorage.removeItem(k); sessionStorage.removeItem(k); },
  };
  const sb = window.__REC_MOCK_SB
    ? window.__REC_MOCK_SB
    : window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { storage: authStorage, storageKey: "core-auth", persistSession: true, autoRefreshToken: true },
      });

  const DEFAULT_STAGES = ["Interested", "Contacted", "1st Meeting Set", "1st Meeting Sat", "2nd Meeting Set", "2nd Meeting Sat", "Docs Sent", "Docs Signed", "Ready to Sell/Train"];
  const DEFAULT_FLAGS = ["Needs More Info", "Needs Another Meeting", "Thinking It Over", "Stagnant"];

  // ── State ───────────────────────────────────────────────────────
  let session = null, profile = null, loading = true, authError = "";
  let activeTab = "board";
  let stages = [], flags = [], candidates = [], people = [], teams = [];
  let perms = {};
  let modal = null; // {type, ...}
  let filterText = "", filterStage = "all", filterFlag = "all", filterRecruiter = "all";
  let treeCollapsed = new Set(); // node ids collapsed in the tree view

  const ROLE_LABEL = { admin: "Owner", regional: "Regional", manager: "Manager", rep: "Rep" };

  const appRoot = () => document.getElementById("app");
  const $ = (s) => document.querySelector(s);
  const val = (s) => ($(s) ? $(s).value : "");
  const bind = (s, ev, fn) => { const el = $(s); if (el) el.addEventListener(ev, fn); };
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const nameOf = (id) => (people.find((p) => p.id === id) || {}).name || "—";
  const teamName = (id) => (teams.find((t) => t.id === id) || {}).name || "—";
  const todayKey = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  const pad2 = (n) => String(n).padStart(2, "0");
  // datetime-local <-> ISO
  function toLocalInput(iso) { if (!iso) return ""; const d = new Date(iso); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`; }
  function fromLocalInput(v) { return v ? new Date(v).toISOString() : null; }
  function fmtWhen(iso) { const d = new Date(iso); return d.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); }
  function fmtTime(iso) { return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }); }
  const isMeetingStage = (st) => st && /meeting set/i.test(st.name);
  const stageOf = (c) => stages.find((s) => s.id === c.stage_id);
  const stageNamed = (re) => stages.find((s) => re.test(s.name));
  const flagNamed = (re) => flags.find((f) => re.test(f.name));

  // ── Init / auth ─────────────────────────────────────────────────
  async function init() {
    const { data } = await sb.auth.getSession();
    session = data ? data.session : null;
    if (session) await afterLogin();
    loading = false;
    render();
    sb.auth.onAuthStateChange((_e, s) => { const had = !!session; session = s; if (!s && had) { profile = null; render(); } });
  }

  async function afterLogin() {
    const { data: prof } = await sb.from("profiles").select("*").eq("id", session.user.id).single();
    if (!prof) { await sb.auth.signOut(); session = null; authError = "No profile found for this account."; return; }
    if (prof.disabled) { await sb.auth.signOut(); session = null; authError = "Your account has been deactivated."; return; }
    profile = prof;
    const r = prof.role;
    perms = { isAdmin: r === "admin", canManageStages: r === "admin", role: r };
    await loadAll();
  }

  async function loadAll() {
    const [stageRes, candRes, pplRes, teamRes] = await Promise.all([
      sb.from("pipeline_stages").select("*").order("position", { ascending: true }),
      sb.from("candidates").select("*").order("created_at", { ascending: false }),
      sb.from("profiles").select("id,name,role,team_id,region_id,email,phone,recruited_by,recruited_by_name"),
      sb.from("teams").select("*"),
    ]);
    const allStages = stageRes.data || [];
    stages = allStages.filter((s) => s.kind === "stage").sort((a, b) => a.position - b.position);
    flags = allStages.filter((s) => s.kind === "flag").sort((a, b) => a.position - b.position);
    candidates = candRes.data || [];
    people = pplRes.data || [];
    teams = teamRes.data || [];
    if (!stages.length && perms.isAdmin) await seedDefaults();
    if (NOTIF_OK() && Notification.permission === "granted") startReminderLoop();
  }

  async function seedDefaults() {
    const rows = DEFAULT_STAGES.map((name, i) => ({ name, kind: "stage", position: i + 1, is_final: i === DEFAULT_STAGES.length - 1 }))
      .concat(DEFAULT_FLAGS.map((name, i) => ({ name, kind: "flag", position: i + 1 })));
    const { error } = await sb.from("pipeline_stages").insert(rows);
    if (!error) await loadAll();
  }

  async function signIn() {
    authError = "";
    const rememberEl = $("#remember");
    localStorage.setItem(REMEMBER_KEY, (rememberEl ? rememberEl.checked : true) ? "1" : "0");
    const btn = $("#signInBtn");
    if (btn) { btn.disabled = true; btn.textContent = "Signing in..."; }
    const { data, error } = await sb.auth.signInWithPassword({ email: val("#email").trim(), password: val("#password") });
    if (error) { authError = error.message || "Sign-in failed."; render(); return; }
    session = data.session;
    await afterLogin();
    render();
  }

  // ── Permissions ─────────────────────────────────────────────────
  function canEditCandidate(c) {
    if (perms.isAdmin) return true;
    if (c.owner_id === profile.id || c.recruiter_id === profile.id) return true;
    if ((profile.role === "manager" || profile.role === "regional") && c.team_id === profile.team_id) return true;
    return false;
  }

  // ── Render ──────────────────────────────────────────────────────
  function render() {
    if (loading) { appRoot().innerHTML = `<main class="screen"><section class="auth-card"><div class="brand"><small>CORE RECRUITING</small><h1>Loading...</h1></div></section></main>`; return; }
    if (!session || !profile) return renderAuth();
    renderApp();
    if (modal) renderModal();
  }

  function renderAuth() {
    appRoot().innerHTML = `
      <main class="screen"><section class="auth-card">
        <div class="brand"><img class="logo" src="favicon.svg" alt="" /><small>CORE RECRUITING</small><h1>Hiring Pipeline</h1><p class="muted">Sign in with your CORE KPI login.</p></div>
        ${authError ? `<p class="auth-error">${esc(authError)}</p>` : ""}
        <label>Email <input id="email" type="email" autocomplete="username" /></label>
        <label>Password <input id="password" type="password" autocomplete="current-password" /></label>
        <label class="remember-row"><input type="checkbox" id="remember" ${remembered() ? "checked" : ""} /> <span>Remember me on this device</span></label>
        <button id="signInBtn" class="primary" type="button">Sign In</button>
      </section></main>`;
    bind("#signInBtn", "click", signIn);
    bind("#password", "keydown", (e) => { if (e.key === "Enter") signIn(); });
  }

  function visibleCandidates() {
    // RLS already scopes on the server; this mirrors it for the demo mock
    // and drives client-side filtering.
    let list = candidates.filter((c) => {
      if (perms.isAdmin) return true;
      if (c.owner_id === profile.id || c.recruiter_id === profile.id) return true;
      if ((profile.role === "manager" || profile.role === "regional") && c.team_id === profile.team_id) return true;
      return false;
    });
    if (filterText) { const q = filterText.toLowerCase(); list = list.filter((c) => (c.name || "").toLowerCase().includes(q)); }
    if (filterFlag !== "all") list = list.filter((c) => c.flag_id === (filterFlag === "none" ? null : filterFlag));
    if (filterRecruiter !== "all") list = list.filter((c) => c.recruiter_id === filterRecruiter);
    return list;
  }

  function renderApp() {
    const tabs = [["board", "Board"], ["list", "List"], ["tree", "Tree"], ["calendar", "Calendar"]];
    if (perms.canManageStages) tabs.push(["settings", "Settings"]);
    let body = "";
    if (activeTab === "board") body = renderBoard();
    else if (activeTab === "list") body = renderList();
    else if (activeTab === "tree") body = renderTree();
    else if (activeTab === "calendar") body = renderCalendar();
    else if (activeTab === "settings") body = renderSettings();

    appRoot().innerHTML = `
      <header class="topbar">
        <div class="brand-row"><img src="favicon.svg" alt="" /><h1>RECRUITING</h1></div>
        <div class="row-inline"><small>${esc(profile.name)} · ${esc(profile.role)}</small><button id="signOut" type="button">Sign Out</button></div>
      </header>
      <nav class="tabs">${tabs.map(([id, l]) => `<button data-tab="${id}" class="${activeTab === id ? "active" : ""}" type="button">${l}</button>`).join("")}</nav>
      <main class="wrap">${body}</main>
      ${["board", "list"].includes(activeTab) ? `<button class="fab" id="addCandidate" type="button" aria-label="Add candidate"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></button>` : ""}`;

    bind("#signOut", "click", async () => { await sb.auth.signOut(); session = null; profile = null; render(); });
    document.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => { activeTab = b.dataset.tab; render(); }));
    bind("#addCandidate", "click", () => openCandidateModal(null));
    bindBoardEvents();
    bindListEvents();
    bindTreeEvents();
    bindCalendarEvents();
    bindSettingsEvents();
  }

  // ── Board (Kanban) ──────────────────────────────────────────────
  function renderBoard() {
    const list = visibleCandidates();
    const flagName = (id) => (flags.find((f) => f.id === id) || {}).name || "";
    const overdue = (c) => c.follow_up_date && c.follow_up_date < todayKey() && !c.hired;
    const stageOpts = (sel) => stages.map((s) => `<option value="${s.id}" ${sel === s.id ? "selected" : ""}>${esc(s.name)}</option>`).join("");

    const cols = stages.map((st) => {
      const cards = list.filter((c) => c.stage_id === st.id);
      return `
      <div class="column" data-stage="${st.id}">
        <div class="column-head"><b>${esc(st.name)}${st.is_final ? " ✓" : ""}</b><span class="count">${cards.length}</span></div>
        <div class="column-body" data-drop="${st.id}">
          ${cards.map((c) => `
            <div class="cand-card" draggable="true" data-card="${c.id}">
              <div class="top"><strong>${esc(c.name)}</strong>${c.flag_id ? `<span class="tag flag">${esc(flagName(c.flag_id))}</span>` : ""}</div>
              <div class="meta">
                <span>${esc(nameOf(c.recruiter_id))}</span>
                ${c.phone ? `<span>${esc(c.phone)}</span>` : ""}
                ${c.appt_at ? `<span class="tag appt">📅 ${esc(fmtWhen(c.appt_at))}</span>` : ""}
                ${overdue(c) ? `<span class="tag due">Due ${esc(c.follow_up_date)}</span>` : c.follow_up_date ? `<span>↺ ${esc(c.follow_up_date)}</span>` : ""}
              </div>
              <select class="move" data-move="${c.id}">${stageOpts(c.stage_id)}</select>
            </div>`).join("") || `<p class="muted" style="padding:4px">No candidates</p>`}
        </div>
      </div>`;
    }).join("");

    return `
      <div class="toolbar">
        <input id="search" placeholder="Search name..." value="${esc(filterText)}" />
        <select id="fRecruiter"><option value="all">All recruiters</option>${people.map((p) => `<option value="${p.id}" ${filterRecruiter === p.id ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select>
        <select id="fFlag"><option value="all">All tags</option><option value="none">No tag</option>${flags.map((f) => `<option value="${f.id}" ${filterFlag === f.id ? "selected" : ""}>${esc(f.name)}</option>`).join("")}</select>
      </div>
      <div class="stat-row">
        <div class="chip"><small>Candidates</small><strong>${list.length}</strong></div>
        <div class="chip"><small>Ready/Hired</small><strong>${list.filter((c) => c.hired).length}</strong></div>
        <div class="chip"><small>Overdue follow-ups</small><strong>${list.filter(overdue).length}</strong></div>
      </div>
      ${stages.length ? `<div class="board">${cols}</div>` : `<p class="empty">No pipeline stages yet.${perms.isAdmin ? " They'll be created automatically — reload." : ""}</p>`}`;
  }

  function bindBoardEvents() {
    bind("#search", "input", (e) => { filterText = e.target.value; rerenderBoardOnly(); });
    bind("#fRecruiter", "change", (e) => { filterRecruiter = e.target.value; render(); });
    bind("#fFlag", "change", (e) => { filterFlag = e.target.value; render(); });
    document.querySelectorAll("[data-card]").forEach((el) => {
      el.addEventListener("click", (ev) => { if (ev.target.closest("[data-move]")) return; openCandidateModal(el.dataset.card); });
      el.addEventListener("dragstart", (ev) => { ev.dataTransfer.setData("text/plain", el.dataset.card); });
    });
    document.querySelectorAll("[data-move]").forEach((sel) =>
      sel.addEventListener("change", (e) => moveCandidate(sel.dataset.move, e.target.value)));
    document.querySelectorAll("[data-drop]").forEach((col) => {
      col.addEventListener("dragover", (ev) => { ev.preventDefault(); col.parentElement.classList.add("dragover"); });
      col.addEventListener("dragleave", () => col.parentElement.classList.remove("dragover"));
      col.addEventListener("drop", (ev) => {
        ev.preventDefault(); col.parentElement.classList.remove("dragover");
        const id = ev.dataTransfer.getData("text/plain");
        if (id) moveCandidate(id, col.dataset.drop);
      });
    });
  }
  // Light refresh for search typing without losing focus is overkill; just re-render.
  function rerenderBoardOnly() { const active = document.activeElement; render(); const el = document.querySelector("#search"); if (el && active && active.id === "search") { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }

  async function moveCandidate(id, stageId) {
    const c = candidates.find((x) => x.id === id);
    if (!c || !canEditCandidate(c)) { alert("You can't move this candidate."); render(); return; }
    const stage = stages.find((s) => s.id === stageId);
    const hired = !!(stage && stage.is_final);
    c.stage_id = stageId; c.hired = hired; c.updated_at = new Date().toISOString();
    const { error } = await sb.from("candidates").update({ stage_id: stageId, hired, updated_at: c.updated_at }).eq("id", id);
    if (error) alert("Couldn't move: " + error.message);
    // Moving into a "Meeting Set" stage without a time? Open the card to set one.
    if (isMeetingStage(stage) && !c.appt_at) { openCandidateModal(id); return; }
    render();
  }

  // ── List view ───────────────────────────────────────────────────
  function renderList() {
    let list = visibleCandidates();
    if (filterStage !== "all") list = list.filter((c) => c.stage_id === filterStage);
    const stageName = (id) => (stages.find((s) => s.id === id) || {}).name || "—";
    const flagName = (id) => (flags.find((f) => f.id === id) || {}).name || "";
    return `
      <div class="toolbar">
        <input id="search" placeholder="Search name..." value="${esc(filterText)}" />
        <select id="fStage"><option value="all">All stages</option>${stages.map((s) => `<option value="${s.id}" ${filterStage === s.id ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</select>
        <select id="fFlag"><option value="all">All tags</option><option value="none">No tag</option>${flags.map((f) => `<option value="${f.id}" ${filterFlag === f.id ? "selected" : ""}>${esc(f.name)}</option>`).join("")}</select>
        <select id="fRecruiter"><option value="all">All recruiters</option>${people.map((p) => `<option value="${p.id}" ${filterRecruiter === p.id ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select>
      </div>
      <section class="card">
        <div class="section-title"><h2>Candidates</h2><span>${list.length}</span></div>
        ${list.map((c) => `
          <div class="list-row" data-open="${c.id}">
            <div class="top"><strong>${esc(c.name)}</strong><span class="pill ${c.hired ? "" : ""}">${esc(stageName(c.stage_id))}</span></div>
            <div class="meta muted">
              ${esc(nameOf(c.recruiter_id))}${c.phone ? " · " + esc(c.phone) : ""}${c.flag_id ? " · " + esc(flagName(c.flag_id)) : ""}${c.follow_up_date ? " · follow-up " + esc(c.follow_up_date) : ""}
            </div>
          </div>`).join("") || `<p class="empty">No candidates match.</p>`}
      </section>`;
  }
  function bindListEvents() {
    if (activeTab !== "list") return;
    bind("#search", "input", (e) => { filterText = e.target.value; const a = document.activeElement === e.target; render(); if (a) { const el = $("#search"); el.focus(); el.setSelectionRange(el.value.length, el.value.length); } });
    bind("#fStage", "change", (e) => { filterStage = e.target.value; render(); });
    bind("#fFlag", "change", (e) => { filterFlag = e.target.value; render(); });
    bind("#fRecruiter", "change", (e) => { filterRecruiter = e.target.value; render(); });
    document.querySelectorAll("[data-open]").forEach((el) => el.addEventListener("click", () => openCandidateModal(el.dataset.open)));
  }

  // ── Candidate modal (add / edit) ────────────────────────────────
  function openCandidateModal(id) {
    const c = id ? candidates.find((x) => x.id === id) : null;
    modal = { type: "candidate", c };
    render();
  }

  function renderModal() {
    if (modal.type === "candidate") return renderCandidateModal();
  }

  function renderCandidateModal() {
    const c = modal.c || {};
    const isNew = !modal.c;
    const editable = isNew || canEditCandidate(c);
    const dis = editable ? "" : "disabled";
    const stageOpts = stages.map((s) => `<option value="${s.id}" ${c.stage_id === s.id ? "selected" : ""}>${esc(s.name)}</option>`).join("");
    const flagOpts = `<option value="">— none —</option>` + flags.map((f) => `<option value="${f.id}" ${c.flag_id === f.id ? "selected" : ""}>${esc(f.name)}</option>`).join("");
    const recOpts = people.map((p) => `<option value="${p.id}" ${(c.recruiter_id || profile.id) === p.id ? "selected" : ""}>${esc(p.name)}</option>`).join("");
    const teamOpts = teams.map((t) => `<option value="${t.id}" ${(c.team_id || profile.team_id) === t.id ? "selected" : ""}>${esc(t.name)}</option>`).join("");
    const stage = stages.find((s) => s.id === c.stage_id);

    const overlay = document.createElement("div");
    overlay.className = "modal-back";
    overlay.innerHTML = `
      <div class="modal">
        <div class="section-title"><h3>${isNew ? "Add Candidate" : esc(c.name)}</h3><button class="secondary tiny" id="mClose" type="button">Close</button></div>
        <div class="form-2col">
          <label>Name <input id="mName" value="${esc(c.name || "")}" ${dis} /></label>
          <label>Phone <input id="mPhone" value="${esc(c.phone || "")}" ${dis} /></label>
          <label>Email <input id="mEmail" type="email" value="${esc(c.email || "")}" ${dis} /></label>
          <label>Source <input id="mSource" placeholder="referral, event..." value="${esc(c.source || "")}" ${dis} /></label>
          <label>Stage <select id="mStage" ${dis}>${stageOpts}</select></label>
          <label>Tag <select id="mFlag" ${dis}>${flagOpts}</select></label>
          <label>Recruiter <select id="mRecruiter" ${dis}>${recOpts}</select></label>
          <label>Team <select id="mTeam" ${dis}>${teamOpts}</select></label>
          <label>Follow-up date <input id="mFollow" type="date" value="${esc(c.follow_up_date || "")}" ${dis} /></label>
          <label>Appointment <input id="mAppt" type="datetime-local" value="${esc(toLocalInput(c.appt_at))}" ${dis} /></label>
        </div>
        <label>Notes <textarea id="mNotes" ${dis}>${esc(c.notes || "")}</textarea></label>
        ${!editable ? `<p class="muted">View only — you don't have permission to edit this candidate.</p>` : ""}
        <div class="modal-actions">
          ${editable ? `<button class="blue" id="mSave" type="button">${isNew ? "Add Candidate" : "Save"}</button>` : ""}
          ${!isNew && stage && stage.is_final && perms.isAdmin ? `<button class="secondary" id="mToCore" type="button">Open CORE to add account</button>` : ""}
          ${!isNew && editable ? `<button class="danger" id="mDelete" type="button">Delete</button>` : ""}
        </div>
      </div>`;
    // replace any existing overlay
    document.querySelectorAll(".modal-back").forEach((n) => n.remove());
    document.body.appendChild(overlay);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) closeModal(); });
    bind("#mClose", "click", closeModal);
    bind("#mSave", "click", () => saveCandidate(isNew));
    bind("#mDelete", "click", () => deleteCandidate(c.id));
    bind("#mToCore", "click", () => {
      const q = new URLSearchParams({ name: c.name || "", email: c.email || "", phone: c.phone || "", team: c.team_id || "" });
      window.open(CORE_URL + "?" + q.toString(), "_blank");
    });
  }

  function closeModal() { modal = null; document.querySelectorAll(".modal-back").forEach((n) => n.remove()); }

  async function saveCandidate(isNew) {
    const stageId = val("#mStage");
    const stage = stages.find((s) => s.id === stageId);
    const row = {
      name: val("#mName").trim(),
      phone: val("#mPhone").trim(),
      email: val("#mEmail").trim(),
      source: val("#mSource").trim(),
      stage_id: stageId || (stages[0] && stages[0].id),
      flag_id: val("#mFlag") || null,
      recruiter_id: val("#mRecruiter") || profile.id,
      team_id: val("#mTeam") || profile.team_id,
      follow_up_date: val("#mFollow") || null,
      appt_at: fromLocalInput(val("#mAppt")),
      notes: val("#mNotes").trim(),
      hired: !!(stage && stage.is_final),
      updated_at: new Date().toISOString(),
    };
    if (!row.name) { alert("Name is required."); return; }
    if (isNew) {
      row.owner_id = profile.id;
      const { data, error } = await sb.from("candidates").insert(row).select().single();
      if (error) { alert("Couldn't add: " + error.message); return; }
      candidates.unshift(data);
    } else {
      const { error } = await sb.from("candidates").update(row).eq("id", modal.c.id);
      if (error) { alert("Couldn't save: " + error.message); return; }
      Object.assign(modal.c, row);
    }
    closeModal();
    render();
  }

  async function deleteCandidate(id) {
    if (!confirm("Delete this candidate?")) return;
    const { error } = await sb.from("candidates").delete().eq("id", id);
    if (error) { alert("Couldn't delete: " + error.message); return; }
    candidates = candidates.filter((c) => c.id !== id);
    closeModal();
    render();
  }

  // ── Recruiting lineage tree ─────────────────────────────────────
  // Children = people this person directly recruited (by id link, or by
  // name as a fallback for accounts created before the id link existed).
  function childrenOf(id, name) {
    return people
      .filter((p) => p.id !== id && (p.recruited_by === id || (!p.recruited_by && p.recruited_by_name && name && p.recruited_by_name === name)))
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  }
  function downlineCount(id, seen) {
    seen = seen || new Set();
    const name = (people.find((p) => p.id === id) || {}).name;
    let n = 0;
    childrenOf(id, name).forEach((k) => { if (!seen.has(k.id)) { seen.add(k.id); n += 1 + downlineCount(k.id, seen); } });
    return n;
  }
  function treeNode(p, seen) {
    if (seen.has(p.id)) return "";
    seen.add(p.id);
    const kids = childrenOf(p.id, p.name);
    const collapsed = treeCollapsed.has(p.id);
    const total = downlineCount(p.id);
    const isMe = p.id === profile.id;
    return `
      <div class="tree-node">
        <div class="tree-row ${isMe ? "me" : ""}" ${kids.length ? `data-tree-toggle="${p.id}"` : ""}>
          <span class="tree-caret ${kids.length ? (collapsed ? "" : "open") : "leaf"}">${kids.length ? "▸" : "•"}</span>
          <div class="tree-card">
            <div class="tree-name">${esc(p.name)}${isMe ? " (you)" : ""}</div>
            <div class="tree-meta">
              <span class="pill">${esc(ROLE_LABEL[p.role] || p.role)}</span>
              ${kids.length ? `<span>${kids.length} direct</span>` : ""}
              ${total ? `<span>${total} total</span>` : ""}
            </div>
          </div>
        </div>
        ${kids.length && !collapsed ? `<div class="tree-children">${kids.map((k) => treeNode(k, seen)).join("")}</div>` : ""}
      </div>`;
  }
  function renderTree() {
    const total = downlineCount(profile.id);
    return `
      <div class="section-title"><h2>Recruiting Tree</h2><span>${total} in your downline</span></div>
      <div class="toolbar">
        <button class="secondary tiny" id="treeExpand" type="button">Expand all</button>
        <button class="secondary tiny" id="treeCollapse" type="button">Collapse all</button>
      </div>
      <section class="card tree-wrap">
        ${treeNode(profile, new Set())}
      </section>
      <p class="muted" style="text-align:center;margin-top:4px">Built from who recruited whom. Set a person's recruiter in CORE (People) or when adding a candidate.</p>`;
  }
  function bindTreeEvents() {
    if (activeTab !== "tree") return;
    document.querySelectorAll("[data-tree-toggle]").forEach((el) => el.addEventListener("click", () => {
      const id = el.dataset.treeToggle;
      if (treeCollapsed.has(id)) treeCollapsed.delete(id); else treeCollapsed.add(id);
      render();
    }));
    bind("#treeExpand", "click", () => { treeCollapsed = new Set(); render(); });
    bind("#treeCollapse", "click", () => {
      // collapse everyone who has children, except the root
      treeCollapsed = new Set(people.filter((p) => p.id !== profile.id && childrenOf(p.id, p.name).length).map((p) => p.id));
      render();
    });
  }

  // ── Calendar + reminders ────────────────────────────────────────
  const NOTIF_OK = () => typeof Notification !== "undefined";
  function notifState() { return NOTIF_OK() ? Notification.permission : "unsupported"; }
  async function requestNotif() {
    if (!NOTIF_OK()) { alert("Notifications aren't supported on this browser."); return; }
    await Notification.requestPermission();
    startReminderLoop();
    render();
  }
  function fireNotif(title, body) {
    if (!NOTIF_OK() || Notification.permission !== "granted") return;
    try { new Notification(title, { body, icon: "icon-192.png" }); } catch (e) { /* ignore */ }
  }
  const firedKey = "rec.fired.v1";
  function firedSet() { try { return new Set(JSON.parse(localStorage.getItem(firedKey) || "[]")); } catch { return new Set(); } }
  function markFired(k) { const s = firedSet(); s.add(k); localStorage.setItem(firedKey, JSON.stringify([...s].slice(-500))); }

  // The reach-out buckets: Interested-stage candidates + anything tagged Stagnant.
  function reachOutList() {
    const interested = stageNamed(/interested/i);
    const stagnant = flagNamed(/stagnant/i);
    const seen = new Set();
    return visibleCandidates().filter((c) => {
      if (c.hired) return false;
      const hit = (interested && c.stage_id === interested.id) || (stagnant && c.flag_id === stagnant.id);
      if (hit && !seen.has(c.id)) { seen.add(c.id); return true; }
      return false;
    });
  }
  function upcomingAppts() {
    const now = Date.now();
    return visibleCandidates().filter((c) => c.appt_at && new Date(c.appt_at).getTime() > now - 3600000)
      .sort((a, b) => new Date(a.appt_at) - new Date(b.appt_at));
  }

  let notifTimer = null;
  function startReminderLoop() { if (notifTimer) return; tick(); notifTimer = setInterval(tick, 60000); }
  function tick() {
    if (!profile) return;
    const now = Date.now();
    const fired = firedSet();
    const win = 30 * 60000; // fire within 30 min of the target moment
    upcomingAppts().forEach((c) => {
      const t = new Date(c.appt_at).getTime();
      [["d", 86400000, "tomorrow"], ["h", 3600000, "in 1 hour"], ["t", 0, "now"]].forEach(([k, off, word]) => {
        const target = t - off;
        const key = `${c.id}:${k}:${t}`;
        if (now >= target && now <= t + win && !fired.has(key)) {
          fireNotif(`Appointment ${word}: ${c.name}`, `${fmtWhen(c.appt_at)}${c.phone ? " · " + c.phone : ""}`);
          markFired(key);
        }
      });
    });
    // Daily reach-out nudge
    const ro = reachOutList();
    const dayKey = `reachout:${todayKey()}`;
    if (ro.length && !fired.has(dayKey) && new Date().getHours() >= 9) {
      fireNotif(`${ro.length} contact${ro.length === 1 ? "" : "s"} to reach out to`, "Text or call your Interested & Stagnant leads today.");
      markFired(dayKey);
    }
  }

  function renderCalendar() {
    const perm = notifState();
    const appts = upcomingAppts();
    const byDay = {};
    appts.forEach((c) => { const d = new Date(c.appt_at); const k = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; (byDay[k] = byDay[k] || []).push(c); });
    const dayLabel = (k) => { const d = new Date(k + "T12:00:00"); const t = todayKey(); if (k === t) return "Today"; return d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" }); };
    const ro = reachOutList();

    return `
      ${perm !== "granted" ? `
        <section class="card">
          <div class="section-title"><h2>Reminders</h2></div>
          <p class="muted" style="margin:6px 0 10px">Turn on notifications to get reminded <b>1 day</b>, <b>1 hour</b>, and <b>at the time</b> of each appointment, plus a daily nudge to reach out to your Interested & Stagnant leads.</p>
          <button class="blue" id="enableNotif" type="button">${perm === "unsupported" ? "Notifications unavailable" : "Enable reminders"}</button>
        </section>` : `<section class="card"><div class="row-inline"><span class="tag final">🔔 Reminders on</span><span class="muted">1 day · 1 hour · at time of each appointment</span></div></section>`}

      <section class="card">
        <div class="section-title"><h2>Upcoming Appointments</h2><span>${appts.length}</span></div>
        ${Object.keys(byDay).length ? Object.entries(byDay).map(([k, list]) => `
          <div style="margin-top:8px"><b style="font-size:13px">${esc(dayLabel(k))}</b></div>
          ${list.map((c) => `
            <div class="list-row" data-open="${c.id}">
              <div class="top"><strong>${esc(c.name)}</strong><span class="tag appt">${esc(fmtTime(c.appt_at))}</span></div>
              <div class="meta muted">${esc((stageOf(c) || {}).name || "")}${c.phone ? " · " + esc(c.phone) : ""} · ${esc(nameOf(c.recruiter_id))}</div>
            </div>`).join("")}
        `).join("") : `<p class="empty">No appointments scheduled. Move a candidate to a "Meeting Set" stage to add one.</p>`}
      </section>

      <section class="card">
        <div class="section-title"><h2>Reach Out</h2><span>${ro.length}</span></div>
        <p class="muted" style="margin:2px 0 8px">Interested & Stagnant leads to text or call.</p>
        ${ro.length ? ro.map((c) => `
          <div class="list-row">
            <div class="top"><strong>${esc(c.name)}</strong><span class="pill">${esc((stageOf(c) || {}).name || "")}${c.flag_id ? " · " + esc((flags.find((f) => f.id === c.flag_id) || {}).name || "") : ""}</span></div>
            <div class="row-inline" style="margin-top:4px">
              ${c.phone ? `<a class="tiny secondary" style="text-decoration:none;padding:5px 10px;border-radius:8px" href="tel:${esc(c.phone)}">Call</a><a class="tiny secondary" style="text-decoration:none;padding:5px 10px;border-radius:8px" href="sms:${esc(c.phone)}">Text</a>` : `<span class="muted">No phone on file</span>`}
              <button class="tiny secondary" data-open="${c.id}" type="button">Open</button>
            </div>
          </div>`).join("") : `<p class="empty">No one to reach out to right now.</p>`}
      </section>`;
  }
  function bindCalendarEvents() {
    if (activeTab !== "calendar") return;
    bind("#enableNotif", "click", requestNotif);
    document.querySelectorAll("[data-open]").forEach((el) => el.addEventListener("click", () => openCandidateModal(el.dataset.open)));
  }

  // ── Settings: manage stages & flags (admin) ─────────────────────
  function renderSettings() {
    const row = (s) => `
      <div class="stage-item">
        <input data-stage-name="${s.id}" value="${esc(s.name)}" />
        <div class="ord"><button class="secondary" data-up="${s.id}" type="button">▲</button><button class="secondary" data-down="${s.id}" type="button">▼</button></div>
        <button class="secondary tiny" data-rename="${s.id}" type="button">Save</button>
        <button class="danger tiny" data-del-stage="${s.id}" type="button">✕</button>
      </div>`;
    return `
      <section class="card">
        <div class="section-title"><h2>Pipeline Stages</h2><span>board columns</span></div>
        ${stages.map(row).join("") || `<p class="muted">No stages.</p>`}
        <div class="row-inline" style="margin-top:10px"><input id="newStage" placeholder="New stage name" /><button class="blue" id="addStage" type="button">Add stage</button></div>
      </section>
      <section class="card">
        <div class="section-title"><h2>Tags</h2><span>extenuating circumstances</span></div>
        ${flags.map(row).join("") || `<p class="muted">No tags.</p>`}
        <div class="row-inline" style="margin-top:10px"><input id="newFlag" placeholder="New tag name" /><button class="blue" id="addFlag" type="button">Add tag</button></div>
      </section>`;
  }

  function bindSettingsEvents() {
    if (activeTab !== "settings") return;
    bind("#addStage", "click", () => addStageOrFlag("stage", val("#newStage")));
    bind("#addFlag", "click", () => addStageOrFlag("flag", val("#newFlag")));
    document.querySelectorAll("[data-rename]").forEach((b) => b.addEventListener("click", () => {
      const id = b.dataset.rename; const name = document.querySelector(`[data-stage-name="${id}"]`).value.trim(); renameStage(id, name);
    }));
    document.querySelectorAll("[data-del-stage]").forEach((b) => b.addEventListener("click", () => delStage(b.dataset.delStage)));
    document.querySelectorAll("[data-up]").forEach((b) => b.addEventListener("click", () => reorder(b.dataset.up, -1)));
    document.querySelectorAll("[data-down]").forEach((b) => b.addEventListener("click", () => reorder(b.dataset.down, 1)));
  }

  async function addStageOrFlag(kind, name) {
    name = (name || "").trim(); if (!name) return;
    const list = kind === "stage" ? stages : flags;
    const pos = (list.reduce((m, s) => Math.max(m, s.position), 0)) + 1;
    const { data, error } = await sb.from("pipeline_stages").insert({ name, kind, position: pos }).select().single();
    if (error) { alert("Couldn't add: " + error.message); return; }
    (kind === "stage" ? stages : flags).push(data);
    render();
  }
  async function renameStage(id, name) {
    if (!name) return;
    const { error } = await sb.from("pipeline_stages").update({ name }).eq("id", id);
    if (error) { alert("Couldn't rename: " + error.message); return; }
    const s = stages.concat(flags).find((x) => x.id === id); if (s) s.name = name;
    render();
  }
  async function delStage(id) {
    const used = candidates.some((c) => c.stage_id === id || c.flag_id === id);
    if (used) { alert("In use by candidates — move them first."); return; }
    if (!confirm("Delete this?")) return;
    const { error } = await sb.from("pipeline_stages").delete().eq("id", id);
    if (error) { alert("Couldn't delete: " + error.message); return; }
    stages = stages.filter((s) => s.id !== id); flags = flags.filter((f) => f.id !== id);
    render();
  }
  async function reorder(id, dir) {
    const list = stages.find((s) => s.id === id) ? stages : flags;
    const i = list.findIndex((s) => s.id === id);
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    const a = list[i], b = list[j];
    const pa = a.position, pb = b.position;
    a.position = pb; b.position = pa;
    list.sort((x, y) => x.position - y.position);
    await Promise.all([
      sb.from("pipeline_stages").update({ position: a.position }).eq("id", a.id),
      sb.from("pipeline_stages").update({ position: b.position }).eq("id", b.id),
    ]);
    render();
  }

  init();
})();
