(function () {
  // ── Supabase Config ─────────────────────────────────────────────
  // Replace these two values with your Supabase project credentials.
  // Find them at: Supabase Dashboard → Settings → API
  const SUPABASE_URL = "https://YOUR_PROJECT.supabase.co";
  const SUPABASE_ANON_KEY = "YOUR_ANON_KEY";

  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // ── Constants ───────────────────────────────────────────────────
  const CACHE_KEY = "corekpis.cache.v1";
  const todayKey = () => new Date().toISOString().slice(0, 10);
  const money = (v) =>
    Number(v || 0).toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });

  const defaultSettings = {
    app_name: "CORE Kpi's",
    daily_door_goal: 100,
    daily_sales_goal: 2,
    daily_appointment_goal: 6,
    daily_revenue_goal: 2500,
    target_answer_rate: 35,
    target_pitch_rate: 60,
    target_close_rate: 12,
    timezone: "America/Denver",
  };

  const outcomes = [
    { id: "noAnswer", label: "No answer", icon: "?", kind: "yellow" },
    { id: "answered", label: "Answered", icon: "A", kind: "blue" },
    { id: "pitch", label: "Pitch", icon: "P", kind: "purple" },
    { id: "appointment", label: "Go back", icon: "G", kind: "hot" },
    { id: "notInterested", label: "Not interested", icon: "X", kind: "red" },
    { id: "sale", label: "Sale", icon: "$", kind: "sale" },
  ];

  const navItems = [
    { id: "dashboard", label: "Home" },
    { id: "log", label: "Log" },
    { id: "callbacks", label: "Callbacks" },
    { id: "history", label: "History" },
    { id: "revenue", label: "Revenue" },
    { id: "settings", label: "Settings" },
  ];

  // ── App State ───────────────────────────────────────────────────
  let session = null;
  let profile = null;
  let teamId = null;
  let settings = { ...defaultSettings };
  let teamName = "Field Team";
  let teamMembers = [];
  let logs = [];
  let callbacks = [];
  let sales = [];
  let activeTab = location.hash.replace("#", "") || "dashboard";
  let range = "today";
  let clockTimer = null;
  let loading = true;
  let authMode = "login";
  let authError = "";

  // ── Init ────────────────────────────────────────────────────────
  async function init() {
    window.addEventListener("hashchange", () => {
      activeTab = location.hash.replace("#", "") || "dashboard";
      render();
    });
    clockTimer = setInterval(updateClock, 1000);

    loadCache();
    render();

    const { data } = await sb.auth.getSession();
    session = data.session;
    if (session) {
      await loadFromSupabase();
    }
    loading = false;
    render();

    sb.auth.onAuthStateChange(async (event, newSession) => {
      session = newSession;
      if (session) {
        await loadFromSupabase();
      } else {
        profile = null;
        teamId = null;
        logs = [];
        callbacks = [];
        sales = [];
        teamMembers = [];
      }
      render();
    });
  }

  // ── Cache (localStorage for instant render) ─────────────────────
  function loadCache() {
    try {
      const cached = JSON.parse(localStorage.getItem(CACHE_KEY));
      if (cached) {
        settings = { ...defaultSettings, ...cached.settings };
        teamName = cached.teamName || "Field Team";
        logs = cached.logs || [];
        callbacks = cached.callbacks || [];
        sales = cached.sales || [];
      }
    } catch { /* ignore */ }
  }

  function saveCache() {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ settings, teamName, logs, callbacks, sales }));
    } catch { /* ignore */ }
  }

  // ── Supabase Data Loading ───────────────────────────────────────
  async function loadFromSupabase() {
    try {
      const { data: prof } = await sb.from("profiles").select("*").eq("id", session.user.id).single();
      if (!prof) { profile = null; return; }
      profile = prof;
      teamId = prof.team_id;

      const [teamRes, settingsRes, logsRes, cbRes, salesRes, membersRes] = await Promise.all([
        sb.from("teams").select("name").eq("id", teamId).single(),
        sb.from("team_settings").select("*").eq("team_id", teamId).single(),
        sb.from("logs").select("*").eq("team_id", teamId).order("created_at", { ascending: false }),
        sb.from("callbacks").select("*").eq("team_id", teamId).order("created_at", { ascending: false }),
        sb.from("sales").select("*").eq("team_id", teamId).order("created_at", { ascending: false }),
        sb.from("profiles").select("*").eq("team_id", teamId),
      ]);

      teamName = teamRes.data?.name || "Field Team";
      if (settingsRes.data) {
        const s = settingsRes.data;
        settings = {
          app_name: s.app_name || defaultSettings.app_name,
          daily_door_goal: s.daily_door_goal ?? defaultSettings.daily_door_goal,
          daily_sales_goal: s.daily_sales_goal ?? defaultSettings.daily_sales_goal,
          daily_appointment_goal: s.daily_appointment_goal ?? defaultSettings.daily_appointment_goal,
          daily_revenue_goal: s.daily_revenue_goal ?? defaultSettings.daily_revenue_goal,
          target_answer_rate: Number(s.target_answer_rate ?? defaultSettings.target_answer_rate),
          target_pitch_rate: Number(s.target_pitch_rate ?? defaultSettings.target_pitch_rate),
          target_close_rate: Number(s.target_close_rate ?? defaultSettings.target_close_rate),
          timezone: s.timezone || defaultSettings.timezone,
        };
      }
      logs = logsRes.data || [];
      callbacks = cbRes.data || [];
      sales = salesRes.data || [];
      teamMembers = membersRes.data || [];
      saveCache();
    } catch (err) {
      console.error("Failed to load from Supabase:", err);
    }
  }

  // ── Auth ─────────────────────────────────────────────────────────
  async function handleSignUp(name, email, password, newTeamName) {
    authError = "";
    const { data, error } = await sb.auth.signUp({ email, password });
    if (error) { authError = error.message; render(); return; }
    if (!data.user) { authError = "Check your email to confirm your account."; render(); return; }

    const { data: team, error: teamErr } = await sb.from("teams").insert({ name: newTeamName || "Field Team" }).select().single();
    if (teamErr) { authError = teamErr.message; render(); return; }

    const { error: profErr } = await sb.from("profiles").insert({
      id: data.user.id, team_id: team.id, name, role: "admin",
    });
    if (profErr) { authError = profErr.message; render(); return; }

    await sb.from("team_settings").insert({ team_id: team.id });
    session = data.session;
    await loadFromSupabase();
    activeTab = "dashboard";
    location.hash = "dashboard";
    render();
  }

  async function handleSignIn(email, password) {
    authError = "";
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) { authError = error.message; render(); return; }
    session = data.session;
    await loadFromSupabase();
    activeTab = "dashboard";
    location.hash = "dashboard";
    render();
  }

  async function handleJoinTeam(name, email, password, joinTeamId) {
    authError = "";
    const { data, error } = await sb.auth.signUp({ email, password });
    if (error) { authError = error.message; render(); return; }
    if (!data.user) { authError = "Check your email to confirm your account."; render(); return; }

    const { error: profErr } = await sb.from("profiles").insert({
      id: data.user.id, team_id: joinTeamId, name, role: "rep",
    });
    if (profErr) { authError = "Invalid Team ID or error joining team."; render(); return; }

    session = data.session;
    await loadFromSupabase();
    activeTab = "dashboard";
    location.hash = "dashboard";
    render();
  }

  async function handleSignOut() {
    await sb.auth.signOut();
    session = null;
    profile = null;
    teamId = null;
    logs = [];
    callbacks = [];
    sales = [];
    teamMembers = [];
    localStorage.removeItem(CACHE_KEY);
    activeTab = "dashboard";
    location.hash = "";
    render();
  }

  // ── Render ──────────────────────────────────────────────────────
  function appRoot() { return document.querySelector("#app"); }

  function render() {
    if (loading) {
      appRoot().innerHTML = `<main class="screen"><section class="auth-card"><div class="brand"><small>CORE Kpi's</small><h1>Loading...</h1></div></section></main>`;
      return;
    }
    if (!session || !profile) return renderAuth();
    renderApp();
  }

  function renderAuth() {
    const isLogin = authMode === "login";
    const isSignup = authMode === "signup";
    const isJoin = authMode === "join";

    appRoot().innerHTML = `
      <main class="screen">
        <section class="auth-card">
          <div class="brand">
            <small>CORE Kpi's</small>
            <h1>${isLogin ? "Sign In" : isSignup ? "Create Account" : "Join a Team"}</h1>
            <p class="muted">${isLogin ? "Sign in to your account." : isSignup ? "Start a new team." : "Join an existing team with a Team ID."}</p>
          </div>
          <div class="card stack">
            ${!isLogin ? `<label>Your name <input id="authName" autocomplete="name" placeholder="Michael Sperry" /></label>` : ""}
            <label>Email <input id="authEmail" type="email" autocomplete="email" placeholder="you@example.com" /></label>
            <label>Password <input id="authPassword" type="password" autocomplete="${isLogin ? "current-password" : "new-password"}" placeholder="••••••••" /></label>
            ${isSignup ? `<label>Team name <input id="authTeamName" placeholder="My Sales Team" /></label>` : ""}
            ${isJoin ? `<label>Team ID <input id="authTeamId" placeholder="Paste team ID from your admin" /></label>` : ""}
            <p id="authError" class="error">${escapeHtml(authError)}</p>
            <button id="authSubmit" class="primary" type="button">
              ${isLogin ? "Sign In" : isSignup ? "Create Account" : "Join Team"}
            </button>
            <div class="auth-links">
              ${isLogin ? `
                <button class="ghost" type="button" data-auth-mode="signup">Create new account</button>
                <button class="ghost" type="button" data-auth-mode="join">Join existing team</button>
              ` : `
                <button class="ghost" type="button" data-auth-mode="login">Back to sign in</button>
              `}
            </div>
          </div>
        </section>
      </main>`;

    bind("#authSubmit", "click", async () => {
      const email = val("#authEmail").trim();
      const password = val("#authPassword");
      if (!email || !password) { authError = "Enter email and password."; render(); return; }
      if (isLogin) await handleSignIn(email, password);
      else if (isSignup) await handleSignUp(val("#authName").trim() || "User", email, password, val("#authTeamName").trim());
      else await handleJoinTeam(val("#authName").trim() || "User", email, password, val("#authTeamId").trim());
    });

    document.querySelectorAll("[data-auth-mode]").forEach((btn) => {
      btn.addEventListener("click", () => { authMode = btn.dataset.authMode; authError = ""; render(); });
    });
  }

  function renderApp() {
    appRoot().innerHTML = `
      <main class="app">
        <header class="topbar">
          <div>
            <p class="eyebrow">${dateLabel(new Date())}</p>
            <h1>${escapeHtml(settings.app_name)}</h1>
          </div>
          <div class="top-actions">
            <span class="clock-pill" id="topClock">${clockText()}</span>
            <span class="pill">${escapeHtml(profile.name)}</span>
          </div>
        </header>
        ${renderDashboard()}
        ${renderLog()}
        ${renderCallbacks()}
        ${renderHistory()}
        ${renderRevenue()}
        ${renderSettings()}
      </main>
      <nav class="bottom-nav">
        ${navItems.map((item) => `
          <button class="nav-btn ${activeTab === item.id ? "active" : ""}" data-tab="${item.id}" type="button">
            <span>${item.label}</span>
          </button>`).join("")}
      </nav>`;

    document.querySelectorAll("[data-tab]").forEach((btn) => {
      btn.addEventListener("click", () => go(btn.dataset.tab));
    });
    bindCommonEvents();
  }

  // ── Dashboard ───────────────────────────────────────────────────
  function renderDashboard() {
    const totals = totalsFor(range);
    const callbacksDue = dueCallbacks();
    const answerRate = pct(totals.answered, totals.doors);
    const pitchRate = pct(totals.pitch, totals.answered);
    const closeRate = pct(totals.sale, totals.pitch);
    const revDoor = totals.doors ? totals.revenue / totals.doors : 0;
    const nextSale = closeRate > 0 ? Math.max(1, Math.ceil(100 / closeRate)) : "--";
    const outcomeRows = [
      ["No answer", totals.noAnswer, "linear-gradient(90deg, #737373, #d4d4d4)"],
      ["Answered", totals.answered, "linear-gradient(90deg, #60a5fa, #a78bfa)"],
      ["Pitches", totals.pitch, "linear-gradient(90deg, #8b5cf6, #ec4899)"],
      ["Go backs", totals.appointment, "linear-gradient(90deg, #fb923c, #facc15)"],
      ["Not int.", totals.notInterested, "linear-gradient(90deg, #ef4444, #fb923c)"],
      ["Sales", totals.sale, "linear-gradient(90deg, #22c55e, #86efac)"],
    ];
    const sevenDays = lastSevenDays();
    const bestDay = sevenDays.reduce((best, d) => (d.doors > best.doors ? d : best), sevenDays[0]);
    const insights = [
      totals.doors ? `${totals.doors} doors logged for ${range}.` : "Start logging doors to build your live pace.",
      closeRate ? `Close rate is ${closeRate.toFixed(1)}%, roughly one sale every ${nextSale} pitched doors.` : "Log pitches and sales to calculate close rate.",
      callbacksDue.length ? `${callbacksDue.length} callbacks need attention.` : "No callbacks are due right now.",
      bestDay ? `Best recent door day: ${bestDay.label} with ${bestDay.doors} doors.` : "Your 7-day trend will appear here.",
    ];
    return `
      <section id="dashboard" class="section ${activeTab === "dashboard" ? "active" : ""}">
        <div class="section-title">
          <div><h2>Home Dashboard</h2><span>Live KPIs, goals, graphs, revenue, and follow-ups.</span></div>
        </div>
        <div class="tabs">
          ${["today", "week", "month"].map((i) => `<button class="${range === i ? "active" : ""}" data-range="${i}">${capitalize(i)}</button>`).join("")}
        </div>
        <div class="grid-4">
          ${stat("Doors", totals.doors, "knocked")}
          ${stat("Answered", totals.answered, `${answerRate.toFixed(1)}%`)}
          ${stat("Pitches", totals.pitch, `${pitchRate.toFixed(1)}%`)}
          ${stat("Sales", totals.sale, money(totals.revenue))}
        </div>
        <div class="desktop-grid">
          <section class="card stack">
            <div class="section-title"><h3>Goals</h3><span>${capitalize(range)}</span></div>
            ${progress("Doors", totals.doors, settings.daily_door_goal)}
            ${progress("Sales", totals.sale, settings.daily_sales_goal)}
            ${progress("Go backs", totals.appointment, settings.daily_appointment_goal)}
            ${progress("Revenue", totals.revenue, settings.daily_revenue_goal, true)}
          </section>
          <section class="card stack">
            <div class="section-title"><h3>Conversion</h3><span>Targets</span></div>
            ${metricCompare("Answer Rate", answerRate, settings.target_answer_rate)}
            ${metricCompare("Pitch Rate", pitchRate, settings.target_pitch_rate)}
            ${metricCompare("Close Rate", closeRate, settings.target_close_rate)}
          </section>
        </div>
        <div class="desktop-grid">
          <section class="card stack">
            <div class="section-title"><h3>Outcome Mix</h3><span>${totals.doors} doors</span></div>
            <div class="chart-grid">
              ${outcomeRows.map(([l, v, f]) => chartRow(l, v, Math.max(totals.doors, 1), f)).join("")}
            </div>
          </section>
          <section class="card stack">
            <div class="section-title"><h3>7-Day Door Trend</h3><span>Daily volume</span></div>
            ${miniBars(sevenDays, "doors")}
          </section>
        </div>
        <div class="desktop-grid">
          <section class="card stack">
            <div class="section-title"><h3>Revenue Pace</h3><span>Last 7 days</span></div>
            ${miniBars(sevenDays, "revenue", true)}
          </section>
          <section class="card stack">
            <div class="section-title"><h3>Field Insights</h3><span>Auto notes</span></div>
            <div class="insight-list">${insights.map((i) => `<div class="insight">${escapeHtml(i)}</div>`).join("")}</div>
          </section>
        </div>
        <div class="grid-2">
          ${stat("Revenue / Door", money(revDoor), "efficiency")}
          ${stat("Next Sale", nextSale, "doors away")}
        </div>
        <section class="card stack">
          <div class="section-title"><h3>Hot Callbacks</h3><span>${callbacksDue.length} due</span></div>
          ${callbacksDue.length ? callbacksDue.slice(0, 4).map(callbackRecord).join("") : empty("No due callbacks right now.")}
        </section>
      </section>`;
  }

  // ── Quick Log ───────────────────────────────────────────────────
  function renderLog() {
    return `
      <section id="log" class="section ${activeTab === "log" ? "active" : ""}">
        <div class="section-title">
          <div><h2>Quick Log</h2><span>Tap as you walk. Counts save instantly.</span></div>
        </div>
        <div class="quick-grid">
          ${outcomes.map((o) => `
            <div class="quick-card ${o.kind}">
              <button class="quick-hit" data-outcome="${o.id}" type="button">
                <span class="icon">${o.icon}</span>
                <b>${o.label}</b>
                <span>${todayOutcomeCount(o.id)} today</span>
              </button>
              <button class="quick-minus" data-decrement-outcome="${o.id}" type="button" aria-label="Subtract ${o.label}">-</button>
            </div>`).join("")}
        </div>
        <section class="card stack">
          <div class="section-title"><h3>Details</h3><span>Optional</span></div>
          <div class="form-grid">
            <label>Customer name <input id="customerName" placeholder="Homeowner name" /></label>
            <label>Address <input id="address" placeholder="123 Oak Street" /></label>
            <label>Callback date <input id="callbackDate" type="date" /></label>
            <label>Priority
              <select id="priority"><option value="normal">Normal</option><option value="hot">Hot</option></select>
            </label>
            <label>Notes <textarea id="notes" placeholder="Optional note for this knock"></textarea></label>
          </div>
        </section>
        <section class="card stack">
          <div class="section-title"><h3>Recent Logs</h3><span>${logs.length} total</span></div>
          ${recentLogs().length ? recentLogs().map(logRecord).join("") : empty("No logs yet.")}
        </section>
      </section>`;
  }

  // ── Callbacks ───────────────────────────────────────────────────
  function renderCallbacks() {
    const open = callbacks.filter((c) => c.status !== "done").sort((a, b) => a.date.localeCompare(b.date));
    return `
      <section id="callbacks" class="section ${activeTab === "callbacks" ? "active" : ""}">
        <div class="section-title">
          <div><h2>Callbacks</h2><span>Return visits and hot follow-ups.</span></div>
        </div>
        <section class="card stack">
          <div class="form-grid">
            <label>Name <input id="cbName" placeholder="Homeowner name" /></label>
            <label>Address <input id="cbAddress" placeholder="123 Oak Street" /></label>
            <label>Date <input id="cbDate" type="date" value="${todayKey()}" /></label>
            <label>Priority
              <select id="cbPriority"><option value="normal">Normal</option><option value="hot">Hot</option></select>
            </label>
            <label>Notes <textarea id="cbNotes" placeholder="What should you remember?"></textarea></label>
            <button id="addCallback" class="primary" type="button">Add Callback</button>
          </div>
        </section>
        <section class="card stack">
          <div class="section-title"><h3>Open Queue</h3><span>${open.length} open</span></div>
          ${open.length ? open.map(callbackRecord).join("") : empty("No callbacks open.")}
        </section>
      </section>`;
  }

  // ── History ─────────────────────────────────────────────────────
  function renderHistory() {
    const rows = [...logs].sort((a, b) => b.created_at.localeCompare(a.created_at));
    return `
      <section id="history" class="section ${activeTab === "history" ? "active" : ""}">
        <div class="section-title">
          <div><h2>History</h2><span>All field activity.</span></div>
          <button id="exportCsv" class="secondary" type="button">Export CSV</button>
        </div>
        <section class="card stack">
          ${rows.length ? rows.map(logRecord).join("") : empty("No history yet.")}
        </section>
      </section>`;
  }

  // ── Revenue ─────────────────────────────────────────────────────
  function renderRevenue() {
    const today = totalsFor("today");
    const week = totalsFor("week");
    const month = totalsFor("month");
    const allRevenue = logs.reduce((s, l) => s + Number(l.contract_value || 0), 0);
    const sortedSales = [...sales].sort((a, b) => b.created_at.localeCompare(a.created_at));
    const avgSale = sortedSales.length ? sortedSales.reduce((s, x) => s + Number(x.value || 0), 0) / sortedSales.length : 0;
    const bestSale = sortedSales.length ? Math.max(...sortedSales.map((x) => Number(x.value || 0))) : 0;
    return `
      <section id="revenue" class="section ${activeTab === "revenue" ? "active" : ""}">
        <div class="section-title">
          <div><h2>Revenue</h2><span>Sales performance and contract value.</span></div>
        </div>
        <div class="grid-2">
          ${stat("Today", money(today.revenue), `${today.sale} sales`)}
          ${stat("This Week", money(week.revenue), `${week.sale} sales`)}
          ${stat("This Month", money(month.revenue), `${month.sale} sales`)}
          ${stat("All Time", money(allRevenue), `${sortedSales.length} sales`)}
        </div>
        <section class="card stack">
          <div class="section-title"><h3>Contract Metrics</h3><span>Closed accounts</span></div>
          <div class="grid-2">
            ${stat("Avg Contract", money(avgSale), "per sale")}
            ${stat("Largest Sale", money(bestSale), "best close")}
          </div>
          ${progress("Daily Revenue", today.revenue, settings.daily_revenue_goal, true)}
        </section>
        <section class="card stack">
          <div class="section-title"><h3>Recent Sales</h3><span>${sortedSales.length} total</span></div>
          ${sortedSales.length
            ? sortedSales.slice(0, 12).map((s) => `
              <article class="record">
                <div class="record-top"><strong>${escapeHtml(s.customer_name)}</strong><span>${money(s.value)}</span></div>
                <small>${escapeHtml(s.user_name)} - ${escapeHtml(s.date)}</small>
                ${s.address ? `<p>${escapeHtml(s.address)}</p>` : ""}
              </article>`).join("")
            : empty("No sales recorded yet.")}
        </section>
      </section>`;
  }

  // ── Settings ────────────────────────────────────────────────────
  function renderSettings() {
    const isAdmin = profile.role === "admin";
    return `
      <section id="settings" class="section ${activeTab === "settings" ? "active" : ""}">
        <div class="section-title">
          <div><h2>Settings</h2><span>Signed in as ${escapeHtml(profile.name)}.</span></div>
        </div>
        <section class="card stack">
          <h3>Profile</h3>
          <label>App name <input id="appName" value="${escapeAttr(settings.app_name)}" /></label>
          <label>Team name <input id="teamNameInput" value="${escapeAttr(teamName)}" /></label>
          <label>Clock timezone
            <select id="timezone">
              ${timezoneOptions().map((o) => `<option value="${o.value}" ${settings.timezone === o.value ? "selected" : ""}>${o.label}</option>`).join("")}
            </select>
          </label>
          <div class="split">
            <label>Door goal <input id="dailyDoorGoal" type="number" value="${settings.daily_door_goal}" /></label>
            <label>Sales goal <input id="dailySalesGoal" type="number" value="${settings.daily_sales_goal}" /></label>
            <label>Go back goal <input id="dailyAppointmentGoal" type="number" value="${settings.daily_appointment_goal}" /></label>
            <label>Revenue goal <input id="dailyRevenueGoal" type="number" value="${settings.daily_revenue_goal}" /></label>
          </div>
          <button id="saveSettings" class="primary" type="button">Save Settings</button>
        </section>
        ${isAdmin ? `
          <section class="card stack">
            <div class="section-title"><h3>Team</h3><span>${teamMembers.length} members</span></div>
            <div class="team-id-box">
              <label>Team ID (share with reps to join)</label>
              <div class="copy-row">
                <input id="teamIdDisplay" value="${escapeAttr(teamId)}" readonly />
                <button id="copyTeamId" class="secondary" type="button">Copy</button>
              </div>
            </div>
            ${teamMembers.map(memberRecord).join("")}
          </section>` : ""}
        <section class="card stack">
          <h3>Data</h3>
          <div class="wide-actions">
            <button id="exportJson" class="secondary" type="button">Export Backup</button>
            <button id="signOut" class="ghost" type="button">Sign Out</button>
          </div>
        </section>
      </section>`;
  }

  // ── Event Binding ───────────────────────────────────────────────
  function bindCommonEvents() {
    document.querySelectorAll("[data-range]").forEach((btn) => {
      btn.addEventListener("click", () => { range = btn.dataset.range; render(); });
    });

    document.querySelectorAll("[data-outcome]").forEach((btn) => {
      btn.addEventListener("click", () => addLog(btn.dataset.outcome));
    });

    document.querySelectorAll("[data-decrement-outcome]").forEach((btn) => {
      btn.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); decrementOutcome(btn.dataset.decrementOutcome); });
    });

    document.querySelectorAll("[data-done]").forEach((btn) => {
      btn.addEventListener("click", () => completeCallback(btn.dataset.done));
    });

    document.querySelectorAll("[data-delete-log]").forEach((btn) => {
      btn.addEventListener("click", () => removeLog(btn.dataset.deleteLog));
    });

    bind("#addCallback", "click", addCallbackEntry);
    bind("#exportCsv", "click", exportCsv);
    bind("#exportJson", "click", () => download("corekpis-backup.json", JSON.stringify({ settings, logs, callbacks, sales }, null, 2), "application/json"));
    bind("#signOut", "click", handleSignOut);
    bind("#saveSettings", "click", saveSettings);
    bind("#copyTeamId", "click", () => {
      const input = document.querySelector("#teamIdDisplay");
      if (input) { navigator.clipboard.writeText(input.value).catch(() => {}); }
    });
  }

  // ── Mutations (write to Supabase) ───────────────────────────────
  async function addLog(outcomeId) {
    const outcome = outcomes.find((o) => o.id === outcomeId);
    let contractValue = 0;
    if (outcomeId === "sale") {
      const response = prompt("Contract value for this sale?", "0");
      if (response === null) return;
      contractValue = Number(response.replace(/[^0-9.]/g, "")) || 0;
    }
    const date = todayKey();
    const entry = {
      team_id: teamId,
      user_id: session.user.id,
      user_name: profile.name,
      outcome: outcomeId,
      label: outcome.label,
      contract_value: outcomeId === "sale" ? contractValue : 0,
      customer_name: val("#customerName").trim(),
      address: val("#address").trim(),
      notes: val("#notes").trim(),
      date,
    };

    const { data, error } = await sb.from("logs").insert(entry).select().single();
    if (error) { console.error(error); return; }
    logs.unshift(data);

    const callbackDate = val("#callbackDate");
    if (outcomeId === "appointment" || callbackDate) {
      await addCallbackToSupabase({
        name: entry.customer_name || "Go back",
        address: entry.address,
        date: callbackDate || date,
        priority: val("#priority") || "normal",
        notes: entry.notes,
      });
    }

    if (outcomeId === "sale") {
      const saleEntry = {
        team_id: teamId,
        customer_name: entry.customer_name || "Customer",
        address: entry.address,
        value: contractValue,
        user_name: entry.user_name,
        date,
      };
      const { data: saleData } = await sb.from("sales").insert(saleEntry).select().single();
      if (saleData) sales.unshift(saleData);
    }

    saveCache();
    render();
  }

  async function removeLog(id) {
    const log = logs.find((l) => l.id === id);
    await sb.from("logs").delete().eq("id", id);
    logs = logs.filter((l) => l.id !== id);
    if (log?.outcome === "sale") {
      const sale = sales.find((s) => s.date === log.date && s.customer_name === (log.customer_name || "Customer"));
      if (sale) {
        await sb.from("sales").delete().eq("id", sale.id);
        sales = sales.filter((s) => s.id !== sale.id);
      }
    }
    saveCache();
    render();
  }

  async function decrementOutcome(outcomeId) {
    const log = logs.filter((l) => l.date === todayKey() && l.outcome === outcomeId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    if (!log) return;
    await removeLog(log.id);
  }

  async function addCallbackToSupabase(entry) {
    const row = { team_id: teamId, ...entry, status: "open" };
    const { data } = await sb.from("callbacks").insert(row).select().single();
    if (data) callbacks.unshift(data);
  }

  async function addCallbackEntry() {
    await addCallbackToSupabase({
      name: val("#cbName").trim() || "Callback",
      address: val("#cbAddress").trim(),
      date: val("#cbDate") || todayKey(),
      priority: val("#cbPriority"),
      notes: val("#cbNotes").trim(),
    });
    saveCache();
    render();
  }

  async function completeCallback(id) {
    await sb.from("callbacks").update({ status: "done" }).eq("id", id);
    const cb = callbacks.find((c) => c.id === id);
    if (cb) cb.status = "done";
    saveCache();
    render();
  }

  async function saveSettings() {
    const newSettings = {
      app_name: val("#appName").trim() || defaultSettings.app_name,
      timezone: val("#timezone") || defaultSettings.timezone,
      daily_door_goal: num("#dailyDoorGoal") || defaultSettings.daily_door_goal,
      daily_sales_goal: num("#dailySalesGoal") || defaultSettings.daily_sales_goal,
      daily_appointment_goal: num("#dailyAppointmentGoal") || defaultSettings.daily_appointment_goal,
      daily_revenue_goal: num("#dailyRevenueGoal") || defaultSettings.daily_revenue_goal,
    };
    await sb.from("team_settings").update(newSettings).eq("team_id", teamId);
    Object.assign(settings, newSettings);

    const newTeamName = val("#teamNameInput").trim();
    if (newTeamName && newTeamName !== teamName) {
      await sb.from("teams").update({ name: newTeamName }).eq("id", teamId);
      teamName = newTeamName;
    }
    saveCache();
    render();
  }

  // ── Data Helpers ────────────────────────────────────────────────
  function totalsFor(period) {
    const filtered = logs.filter((l) => inRange(l.date, period));
    return {
      doors: filtered.length,
      noAnswer: count(filtered, "noAnswer"),
      answered: count(filtered, "answered") + count(filtered, "pitch") + count(filtered, "appointment") + count(filtered, "sale"),
      pitch: count(filtered, "pitch") + count(filtered, "appointment") + count(filtered, "sale"),
      appointment: count(filtered, "appointment"),
      notInterested: count(filtered, "notInterested"),
      sale: count(filtered, "sale"),
      revenue: filtered.reduce((s, l) => s + Number(l.contract_value || 0), 0),
    };
  }

  function inRange(dateText, period) {
    const d = parseLocalDate(dateText);
    const now = new Date();
    if (period === "today") return dateText === todayKey();
    if (period === "week") return daysBetween(d, now) <= 6;
    if (period === "month") return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    return true;
  }

  function parseLocalDate(t) { const [y, m, d] = t.split("-").map(Number); return new Date(y, m - 1, d); }
  function daysBetween(a, b) { return Math.floor((startOfDay(b) - startOfDay(a)) / 86400000); }
  function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function count(items, outcome) { return items.filter((i) => i.outcome === outcome).length; }
  function pct(part, total) { return total > 0 ? (part / total) * 100 : 0; }

  function lastSevenDays() {
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      const dayLogs = logs.filter((l) => l.date === key);
      days.push({
        key,
        label: d.toLocaleDateString(undefined, { weekday: "short" }),
        short: d.toLocaleDateString(undefined, { weekday: "short" }).slice(0, 2),
        doors: dayLogs.length,
        revenue: dayLogs.reduce((s, l) => s + Number(l.contract_value || 0), 0),
      });
    }
    return days;
  }

  function recentLogs() { return [...logs].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 8); }
  function dueCallbacks() { return callbacks.filter((c) => c.status !== "done" && c.date <= todayKey()).sort((a, b) => a.date.localeCompare(b.date)); }
  function todayOutcomeCount(id) { return logs.filter((l) => l.date === todayKey() && l.outcome === id).length; }

  // ── UI Helpers ──────────────────────────────────────────────────
  function stat(label, value, sub) {
    return `<div class="stat-card"><span>${label}</span><strong>${value}</strong><em>${sub || ""}</em></div>`;
  }

  function progress(label, current, goal, isMoney) {
    const pctVal = goal > 0 ? Math.min(100, (current / goal) * 100) : 0;
    return `
      <div class="progress-row">
        <div class="row-head"><b>${label}</b><span class="muted">${isMoney ? money(current) : current} / ${isMoney ? money(goal) : goal}</span></div>
        <div class="bar"><span style="width:${pctVal}%"></span></div>
      </div>`;
  }

  function metricCompare(label, actual, target) {
    const good = actual >= target;
    return `
      <div class="progress-row">
        <div class="row-head"><b>${label}</b><span class="${good ? "badge-good" : "badge-danger"}">${actual.toFixed(1)}%</span></div>
        <div class="muted">Goal ${target}%</div>
      </div>`;
  }

  function chartRow(label, value, max, fill) {
    const w = max > 0 ? Math.min(100, (value / max) * 100) : 0;
    return `
      <div class="chart-row">
        <b>${escapeHtml(label)}</b>
        <div class="chart-fill"><i style="width:${w}%; --fill:${fill}"></i></div>
        <span>${value}</span>
      </div>`;
  }

  function miniBars(days, key, isMoney) {
    const max = Math.max(...days.map((d) => Number(d[key] || 0)), 1);
    return `
      <div class="mini-bars">
        ${days.map((d) => {
          const v = Number(d[key] || 0);
          const h = Math.max(v > 0 ? 8 : 3, (v / max) * 104);
          return `<div class="mini-bar"><i style="height:${h}px"></i><span>${escapeHtml(d.short)}</span><span>${isMoney ? money(v) : v}</span></div>`;
        }).join("")}
      </div>`;
  }

  function logRecord(log) {
    const kind = outcomes.find((o) => o.id === log.outcome)?.kind || "plain";
    return `
      <article class="record log-record ${kind}">
        <div class="record-top">
          <strong>${escapeHtml(log.label)}</strong>
          <div class="log-actions">
            <small>${escapeHtml(log.date)}</small>
            <button class="minus-btn" data-delete-log="${log.id}" type="button" aria-label="Remove this log">-</button>
          </div>
        </div>
        <small>${escapeHtml(log.user_name || "")}${log.contract_value ? ` - ${money(log.contract_value)}` : ""}</small>
        ${log.customer_name || log.address ? `<p>${escapeHtml([log.customer_name, log.address].filter(Boolean).join(" - "))}</p>` : ""}
        ${log.notes ? `<p>${escapeHtml(log.notes)}</p>` : ""}
      </article>`;
  }

  function callbackRecord(item) {
    const due = item.date < todayKey() ? "Overdue" : item.date === todayKey() ? "Today" : item.date;
    return `
      <article class="record">
        <div class="record-top">
          <strong>${escapeHtml(item.name)}</strong>
          <span class="${item.priority === "hot" ? "badge-hot" : "muted"}">${due}</span>
        </div>
        ${item.address ? `<small>${escapeHtml(item.address)}</small>` : ""}
        ${item.notes ? `<p>${escapeHtml(item.notes)}</p>` : ""}
        <button class="secondary" data-done="${item.id}" type="button">Complete</button>
      </article>`;
  }

  function memberRecord(member) {
    return `
      <div class="user-row">
        <div class="record-top">
          <strong>${escapeHtml(member.name)}</strong>
          <span class="pill">${escapeHtml(member.role)}</span>
        </div>
        <small>Joined ${new Date(member.created_at).toLocaleDateString()}</small>
      </div>`;
  }

  function exportCsv() {
    const header = ["date", "rep", "outcome", "customer", "address", "contractValue", "notes"];
    const rows = logs.map((l) =>
      [l.date, l.user_name, l.label, l.customer_name, l.address, l.contract_value, l.notes]
        .map((c) => `"${String(c || "").replace(/"/g, '""')}"`)
        .join(",")
    );
    download("corekpis-history.csv", [header.join(","), ...rows].join("\n"), "text/csv");
  }

  function download(filename, content, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function clockText() {
    try {
      return new Intl.DateTimeFormat(undefined, {
        hour: "numeric", minute: "2-digit", second: "2-digit",
        timeZone: settings.timezone,
      }).format(new Date());
    } catch { return new Date().toLocaleTimeString(); }
  }

  function updateClock() {
    const node = document.querySelector("#topClock");
    if (node) node.textContent = clockText();
  }

  function timezoneOptions() {
    return [
      { value: "America/New_York", label: "Eastern" },
      { value: "America/Chicago", label: "Central" },
      { value: "America/Denver", label: "Mountain" },
      { value: "America/Phoenix", label: "Arizona" },
      { value: "America/Los_Angeles", label: "Pacific" },
      { value: "America/Anchorage", label: "Alaska" },
      { value: "Pacific/Honolulu", label: "Hawaii" },
    ];
  }

  function go(tab) { activeTab = tab; location.hash = tab; render(); }
  function bind(sel, ev, fn) { const el = document.querySelector(sel); if (el) el.addEventListener(ev, fn); }
  function val(sel) { return document.querySelector(sel)?.value || ""; }
  function num(sel) { return Number(val(sel) || 0); }
  function empty(msg) { return `<div class="empty">${escapeHtml(msg)}</div>`; }
  function dateLabel(d) { return d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" }); }
  function capitalize(t) { return t.charAt(0).toUpperCase() + t.slice(1); }

  function escapeHtml(t) {
    return String(t || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }
  function escapeAttr(t) { return escapeHtml(t); }

  init();
})();
