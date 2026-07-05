(function () {
  // ── Supabase Config ─────────────────────────────────────────────
  // Replace these two values with your Supabase project credentials.
  // Find them at: Supabase Dashboard → Settings → API
  const SUPABASE_URL = "https://tpzfmnyrqsqewgtkpxie.supabase.co";
  const SUPABASE_ANON_KEY = "sb_publishable_hgsd7UGGL2EjqVM875LzKA_fqjFgwbW";

  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // ── Constants ───────────────────────────────────────────────────
  const CACHE_KEY = "corekpis.cache.v1";
  const todayKey = () => dkeyFromDate(new Date());
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
    { id: "doorsKnocked", label: "Doors Knocked", icon: "🚪", kind: "yellow" },
    { id: "answered", label: "Answered", icon: "🗣️", kind: "blue" },
    { id: "pitch", label: "Pitch", icon: "📋", kind: "purple" },
    { id: "appointment", label: "Go back", icon: "🔁", kind: "hot" },
    { id: "notInterested", label: "Not interested", icon: "❌", kind: "red" },
    { id: "sale", label: "Sale", icon: "✅", kind: "sale" },
  ];

  const repNav = [
    { id: "dashboard", label: "Dashboard" },
    { id: "log", label: "Log" },
    { id: "callbacks", label: "Callbacks" },
    { id: "calendar", label: "Calendar" },
    { id: "accounts", label: "Accounts" },
    { id: "revenue", label: "Revenue" },
    { id: "settings", label: "Settings" },
  ];

  const managerNav = [
    { id: "dashboard", label: "Dashboard" },
    { id: "leaderboard", label: "Leaderboard" },
    { id: "recruits", label: "Recruits" },
    { id: "reports", label: "Reports" },
    { id: "settings", label: "Settings" },
  ];

  const regionalNav = [
    { id: "dashboard", label: "Dashboard" },
    { id: "leaderboard", label: "Teams" },
    { id: "reports", label: "Reports" },
    { id: "settings", label: "Settings" },
  ];

  // ── App State ───────────────────────────────────────────────────
  let session = null;
  let profile = null;
  let teamId = null;
  let regionId = null;
  let settings = { ...defaultSettings };
  let teamName = "Field Team";
  let teamShortCode = "";
  let teamMembers = [];
  let logs = [];
  let callbacks = [];
  let sales = [];
  let accounts = [];
  let allTeams = [];
  let orgTeams = [];
  let orgProfiles = [];
  let activeTab = location.hash.replace("#", "") || "dashboard";
  let range = "today";
  let customFrom = "";
  let customTo = "";
  let personalGoals = null;
  let clockTimer = null;
  let loading = true;
  let authMode = "login";
  let authError = "";
  let onboardingStep = 0;
  // Preserves what the user typed on the auth screen across re-renders
  // (e.g. after a validation error) - only password fields get wiped.
  let authDraft = { teamId: "", recruiter: "", name: "", birthday: "", phone: "", address: "", email: "" };

  // ── Commission Side State ───────────────────────────────────────
  let appMode = "field"; // "field" or "commission"
  let commAccounts = [];
  let commTab = "comm-dashboard";
  let commRange = "month";
  let commCustomFrom = "";
  let commCustomTo = "";
  let commEditId = null;
  const FRONTEND_PER_ACCOUNT = 125;
  const BACKEND_PCT = 0.30;
  const COMM_CACHE_KEY = "corekpis.comm.v1";

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
        accounts = [];
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
        accounts = cached.accounts || [];
        personalGoals = cached.personalGoals || null;
      }
    } catch { /* ignore */ }
    try {
      const cc = JSON.parse(localStorage.getItem(COMM_CACHE_KEY));
      if (cc) commAccounts = cc.commAccounts || [];
    } catch { /* ignore */ }
  }

  function saveCache() {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ settings, teamName, logs, callbacks, sales, accounts, personalGoals }));
      localStorage.setItem(COMM_CACHE_KEY, JSON.stringify({ commAccounts }));
    } catch { /* ignore */ }
  }

  // ── Supabase Data Loading ───────────────────────────────────────
  function applySettings(s) {
    if (!s) return;
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

  async function loadFromSupabase() {
    try {
      const { data: prof } = await sb.from("profiles").select("*").eq("id", session.user.id).single();
      if (!prof) { profile = null; return; }
      profile = prof;
      teamId = prof.team_id;
      regionId = prof.region_id;

      if (profile.role === "regional") {
        // Regional: aggregate across every team in the region.
        const { data: regionProfiles } = await sb.from("profiles").select("team_id").eq("region_id", regionId);
        const teamIds = [...new Set((regionProfiles || []).map((p) => p.team_id).filter(Boolean))];

        const [teamsRes, settingsRes, logsRes, accountsRes] = await Promise.all([
          sb.from("teams").select("*").in("id", teamIds),
          sb.from("team_settings").select("*").eq("team_id", teamId).single(),
          sb.from("logs").select("*").in("team_id", teamIds).order("created_at", { ascending: false }),
          sb.from("accounts").select("*").in("team_id", teamIds).order("created_at", { ascending: false }),
        ]);

        allTeams = teamsRes.data || [];
        applySettings(settingsRes.data);
        logs = logsRes.data || [];
        accounts = accountsRes.data || [];
        callbacks = [];
        sales = [];
        teamMembers = [];
      } else {
        // Rep / Manager / Admin: everything scoped to their own team.
        const [teamRes, settingsRes, logsRes, cbRes, salesRes, membersRes, accountsRes] = await Promise.all([
          sb.from("teams").select("name, short_code").eq("id", teamId).single(),
          sb.from("team_settings").select("*").eq("team_id", teamId).single(),
          sb.from("logs").select("*").eq("team_id", teamId).order("created_at", { ascending: false }),
          sb.from("callbacks").select("*").eq("team_id", teamId).order("created_at", { ascending: false }),
          sb.from("sales").select("*").eq("team_id", teamId).order("created_at", { ascending: false }),
          sb.from("profiles").select("*").eq("team_id", teamId),
          sb.from("accounts").select("*").eq("team_id", teamId).order("created_at", { ascending: false }),
        ]);

        teamName = teamRes.data?.name || "Field Team";
        teamShortCode = teamRes.data?.short_code || "";
        // Older teams created before Team Codes existed won't have one yet -
        // generate and save one automatically instead of leaving it blank.
        if (!teamShortCode && profile.role === "admin") {
          const newCode = generateShortCode();
          const { error: codeErr } = await sb.from("teams").update({ short_code: newCode }).eq("id", teamId);
          if (!codeErr) teamShortCode = newCode;
        }
        applySettings(settingsRes.data);
        logs = logsRes.data || [];
        callbacks = cbRes.data || [];
        sales = salesRes.data || [];
        teamMembers = membersRes.data || [];
        accounts = accountsRes.data || [];

        if (profile.role === "admin") {
          const [orgTeamsRes, orgProfilesRes] = await Promise.all([
            sb.from("teams").select("*").order("created_at", { ascending: true }),
            sb.from("profiles").select("*"),
          ]);
          orgTeams = orgTeamsRes.data || [];
          orgProfiles = orgProfilesRes.data || [];

          const codelessTeams = orgTeams.filter((t) => !t.short_code);
          for (const t of codelessTeams) {
            const newCode = generateShortCode();
            const { error: codeErr } = await sb.from("teams").update({ short_code: newCode }).eq("id", t.id);
            if (!codeErr) t.short_code = newCode;
          }
        }
      }
      saveCache();
    } catch (err) {
      console.error("Failed to load from Supabase:", err);
    }
  }

  // ── Auth ─────────────────────────────────────────────────────────
  // Short, easy-to-say/type team code (no ambiguous chars like O/0/I/1).
  function generateShortCode() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = "";
    for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
    return code;
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

  async function handleJoinTeam({ name, email, password, joinCode, recruiterName, birthday, phone, address }) {
    authError = "";
    const code = joinCode.trim().toUpperCase();
    const { data: team, error: teamErr } = await sb.from("teams").select("id").eq("short_code", code).single();
    if (teamErr || !team) { authError = "Team code not found. Double-check with your recruiter."; render(); return; }

    const { data, error } = await sb.auth.signUp({ email, password });
    if (error) { authError = error.message; render(); return; }
    if (!data.user) { authError = "Check your email to confirm your account."; render(); return; }

    const { error: profErr } = await sb.from("profiles").insert({
      id: data.user.id, team_id: team.id, name, role: "rep",
      recruited_by_name: recruiterName || "", email,
      birthday: birthday || null, phone: phone || "", address: address || "",
      needs_onboarding: true,
    });
    if (profErr) { authError = "Error joining team."; render(); return; }

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
    document.body.classList.toggle("comm-mode", appMode === "commission");
    if (loading) {
      appRoot().innerHTML = `<main class="screen"><section class="auth-card"><div class="brand"><small>CORE Kpi's</small><h1>Loading...</h1></div></section></main>`;
      return;
    }
    if (!session || !profile) return renderAuth();
    if (appMode === "commission") renderCommApp(); else renderApp();
    animateBars();
  }

  // Bars render at width:0 then animate to their real percentage on the
  // next frame, giving progress bars a sliding fill-in feel each render.
  function animateBars() {
    const bars = document.querySelectorAll(".bar > span[data-pct], .chart-fill i[data-pct]");
    requestAnimationFrame(() => {
      bars.forEach((el) => { el.style.width = el.dataset.pct + "%"; });
    });
  }

  function toggleAppMode() {
    appMode = appMode === "field" ? "commission" : "field";
    if (appMode === "commission" && !commTab) commTab = "comm-dashboard";
    render();
  }

  // A password input with a click-to-reveal eye button.
  function passwordFieldHtml(id, label, autocomplete) {
    return `<label>${label}
      <div class="pw-wrap">
        <input id="${id}" type="password" autocomplete="${autocomplete}" placeholder="••••••••" />
        <button type="button" class="pw-eye" data-toggle-pw="${id}" aria-label="Show password">👁</button>
      </div>
    </label>`;
  }

  function renderAuth() {
    const isLogin = authMode === "login";
    const isJoin = authMode === "join";

    appRoot().innerHTML = `
      <main class="screen">
        <section class="auth-card">
          <div class="brand">
            <small>CORE Kpi's</small>
            <h1>${isLogin ? "Sign In" : "Join a Team"}</h1>
            <p class="muted">${isLogin ? "Sign in to your account." : "Enter the Team Code your recruiter gave you."}</p>
          </div>
          <div class="card stack">
            ${isJoin ? `<label>Team Code <input id="authTeamId" placeholder="e.g. BLU492" style="text-transform:uppercase" value="${escapeAttr(authDraft.teamId)}" /></label>` : ""}
            ${isJoin ? `<label>Who recruited you? <input id="authRecruiter" placeholder="Their name" value="${escapeAttr(authDraft.recruiter)}" /></label>` : ""}
            ${isJoin ? `<label>Your name <input id="authName" autocomplete="name" placeholder="Michael Sperry" value="${escapeAttr(authDraft.name)}" /></label>` : ""}
            ${isJoin ? `<label>Birthday <input id="authBirthday" type="date" value="${escapeAttr(authDraft.birthday)}" /></label>` : ""}
            ${isJoin ? `<label>Cell number <input id="authPhone" type="tel" autocomplete="tel" placeholder="(555) 123-4567" value="${escapeAttr(authDraft.phone)}" /></label>` : ""}
            ${isJoin ? `<label>Address <input id="authAddress" autocomplete="street-address" placeholder="123 Oak Street" value="${escapeAttr(authDraft.address)}" /></label>` : ""}
            <label>Email <input id="authEmail" type="email" autocomplete="email" placeholder="you@example.com" value="${escapeAttr(authDraft.email)}" /></label>
            ${passwordFieldHtml("authPassword", "Password", isLogin ? "current-password" : "new-password")}
            ${isJoin ? passwordFieldHtml("authPasswordConfirm", "Confirm Password", "new-password") : ""}
            <p id="authError" class="error">${escapeHtml(authError)}</p>
            <button id="authSubmit" class="primary" type="button">
              ${isLogin ? "Sign In" : "Join Team"}
            </button>
            <div class="auth-links">
              ${isLogin ? `
                <button class="ghost" type="button" data-auth-mode="join">Join existing team</button>
                <button class="ghost" type="button" id="forgotPassword">Forgot password?</button>
              ` : `
                <button class="ghost" type="button" data-auth-mode="login">Back to sign in</button>
              `}
            </div>
          </div>
        </section>
      </main>`;

    document.querySelectorAll("[data-toggle-pw]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const input = document.querySelector("#" + btn.dataset.togglePw);
        if (!input) return;
        const show = input.type === "password";
        input.type = show ? "text" : "password";
        btn.classList.toggle("on", show);
      });
    });

    bind("#authSubmit", "click", async () => {
      const email = val("#authEmail").trim();
      const password = val("#authPassword");

      if (isLogin) {
        authDraft.email = email;
        if (!email || !password) { authError = "Enter email and password."; render(); return; }
        await handleSignIn(email, password);
        return;
      }

      // Snapshot every non-password field so a validation error below
      // doesn't wipe what the user already typed.
      authDraft = {
        teamId: val("#authTeamId").trim(),
        recruiter: val("#authRecruiter").trim(),
        name: val("#authName").trim(),
        birthday: val("#authBirthday"),
        phone: val("#authPhone").trim(),
        address: val("#authAddress").trim(),
        email,
      };

      // Join Team: validate password strength + confirmation before hitting the network.
      const confirmPassword = val("#authPasswordConfirm");
      if (password.length < 6) {
        authError = "Password must be at least 6 characters.";
        render();
        return;
      }
      if (password !== confirmPassword) {
        authError = "Passwords don't match.";
        render();
        return;
      }
      if (!email) { authError = "Enter your email."; render(); return; }
      if (!authDraft.teamId) { authError = "Enter your Team Code."; render(); return; }

      await handleJoinTeam({
        name: authDraft.name || "User",
        email,
        password,
        joinCode: authDraft.teamId,
        recruiterName: authDraft.recruiter,
        birthday: authDraft.birthday,
        phone: authDraft.phone,
        address: authDraft.address,
      });
    });

    document.querySelectorAll("[data-auth-mode]").forEach((btn) => {
      btn.addEventListener("click", () => { authMode = btn.dataset.authMode; authError = ""; render(); });
    });

    bind("#forgotPassword", "click", async () => {
      const email = val("#authEmail").trim();
      if (!email) { authError = "Enter your email above first, then tap Forgot password."; render(); return; }
      await sb.auth.resetPasswordForEmail(email);
      authError = "If that email has an account, a reset link is on its way.";
      render();
    });
  }

  function renderApp() {
    const isAdmin = profile.role === "admin";
    const isRep = profile.role === "rep" || isAdmin;
    const isManager = profile.role === "manager";
    const isRegional = profile.role === "regional";
    const nav = isAdmin ? [...repNav, { id: "recruits", label: "Recruits" }]
      : isRep ? repNav
      : isManager || isRegional ? managerNav
      : repNav;

    let sections = "";
    if (isRep) {
      sections = `${renderDashboard()}${renderLog()}${renderCallbacks()}${renderCalendar()}${renderAccounts()}${renderRevenue()}${renderSettings()}`;
      if (isAdmin) sections += renderRecruits();
    } else if (isManager) {
      sections = `${renderManagerDashboard()}${renderLeaderboard()}${renderRecruits()}${renderReports()}${renderSettings()}`;
    } else if (isRegional) {
      sections = `${renderRegionalDashboard()}${renderRegionalLeaderboard()}${renderReports()}${renderSettings()}`;
    }

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
        ${sections}
      </main>
      <button class="mode-toggle" id="modeToggle" type="button" aria-label="Switch to Commission view">${switchIconSvg()}</button>
      <nav class="bottom-nav">
        ${nav.map((item) => `
          <button class="nav-btn ${activeTab === item.id ? "active" : ""}" data-tab="${item.id}" type="button">
            <span>${item.label}</span>
          </button>`).join("")}
      </nav>
      ${profile.needs_onboarding ? renderOnboarding() : ""}`;

    bind("#modeToggle", "click", toggleAppMode);
    document.querySelectorAll("[data-tab]").forEach((btn) => {
      btn.addEventListener("click", () => go(btn.dataset.tab));
    });
    bindCommonEvents();
    scrollActiveNavIntoView();
    bindOnboardingEvents();
  }

  // Re-rendering rebuilds the nav bar from scratch, which would otherwise
  // reset its scroll position and hide the tab the user just tapped.
  function scrollActiveNavIntoView() {
    const activeBtn = document.querySelector(".nav-btn.active");
    if (activeBtn) activeBtn.scrollIntoView({ behavior: "auto", inline: "nearest", block: "nearest" });
  }

  // ── First-login Onboarding ────────────────────────────────────────
  const ONBOARDING_STEPS = [
    { title: "Welcome to CORE Kpi's!", body: "This is where you'll track every door you knock, every day." },
    { title: "Log as you walk", body: "Tap Log and hit a button every time something happens - a door, an answer, a pitch, a sale." },
    { title: "Never miss a callback", body: "Set a callback timer and it'll alert you when it's time to go back. Check Calendar to see them by day." },
    { title: "Watch your goals", body: "Dashboard shows your progress against today's goals, live, as you knock." },
  ];

  function renderOnboarding() {
    const step = ONBOARDING_STEPS[onboardingStep];
    const isLast = onboardingStep === ONBOARDING_STEPS.length - 1;
    return `
      <div class="onboarding-overlay">
        <div class="onboarding-card">
          <div class="onboarding-dots">
            ${ONBOARDING_STEPS.map((_, i) => `<span class="${i === onboardingStep ? "on" : ""}"></span>`).join("")}
          </div>
          <h2>${escapeHtml(step.title)}</h2>
          <p>${escapeHtml(step.body)}</p>
          <button id="onboardingNext" class="primary" type="button">${isLast ? "Let's go!" : "Next"}</button>
          ${!isLast ? `<button id="onboardingSkip" class="ghost" type="button">Skip</button>` : ""}
        </div>
      </div>`;
  }

  function bindOnboardingEvents() {
    bind("#onboardingNext", "click", () => {
      if (onboardingStep < ONBOARDING_STEPS.length - 1) { onboardingStep++; render(); }
      else finishOnboarding();
    });
    bind("#onboardingSkip", "click", finishOnboarding);
  }

  async function finishOnboarding() {
    profile.needs_onboarding = false;
    onboardingStep = 0;
    try { await sb.from("profiles").update({ needs_onboarding: false }).eq("id", profile.id); } catch { /* ignore */ }
    render();
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
      ["Doors Knocked", totals.doorsKnocked, "linear-gradient(90deg, #737373, #d4d4d4)"],
      ["Answered", totals.answered, "linear-gradient(90deg, #60a5fa, #a78bfa)"],
      ["Pitches", totals.pitch, "linear-gradient(90deg, #8b5cf6, #ec4899)"],
      ["Go backs", totals.appointment, "linear-gradient(90deg, #fb923c, #facc15)"],
      ["Not int.", totals.notInterested, "linear-gradient(90deg, #ef4444, #fb923c)"],
      ["Sales", totals.sale, "linear-gradient(90deg, #22c55e, #86efac)"],
    ];
    const sevenDays = lastSevenDays();
    const bestDay = sevenDays.reduce((best, d) => (d.doors > best.doors ? d : best), sevenDays[0]);

    const pg = computePersonalGoals();
    const monthlyTrend = lastNMonths(6);
    const weekday = byWeekday();
    const sevenDaySales = sevenDays.map((d) => {
      const dayLogs = logs.filter((l) => l.date === d.key && l.outcome === "sale");
      return { ...d, sales: dayLogs.length };
    });

    // Extra headline stats
    const activeDays = new Set(logs.map((l) => l.date)).size || 1;
    const avgDoorsPerDay = Math.round(logs.length / activeDays);
    const totalSalesAll = logs.filter((l) => l.outcome === "sale").length;
    const pitchesPerSale = totalSalesAll > 0 ? (logs.filter((l) => ["pitch", "appointment", "sale"].includes(l.outcome)).length / totalSalesAll).toFixed(1) : "--";
    const streak = currentStreak();

    const schedule = getSchedule();

    const insights = [
      totals.doors ? `${totals.doors} doors logged for ${range}.` : "Start logging doors to build your live pace.",
      closeRate ? `Close rate is ${closeRate.toFixed(1)}%, roughly one sale every ${nextSale} pitched doors.` : "Log pitches and sales to calculate close rate.",
      callbacksDue.length ? `${callbacksDue.length} callbacks need attention.` : "No callbacks are due right now.",
      bestDay ? `Best recent door day: ${bestDay.label} with ${bestDay.doors} doors.` : "Your 7-day trend will appear here.",
      pg ? `Your adaptive close rate goal is ${pg.closeRate.toFixed(1)}% based on ${pg.daysTracked}-day avg.` : "Set personal goals to see adaptive targets.",
    ];
    return `
      <section id="dashboard" class="section ${activeTab === "dashboard" ? "active" : ""}">
        <div class="section-title">
          <div><h2>Home Dashboard</h2><span>Live KPIs, goals, graphs, revenue, and follow-ups.</span></div>
        </div>
        <div class="tabs range-tabs">
          ${["today", "week", "month", "year"].map((i) => `<button class="${range === i ? "active" : ""}" data-range="${i}">${capitalize(i)}</button>`).join("")}
          <button class="${range === "custom" ? "active" : ""}" data-range="custom">Custom</button>
        </div>
        ${range === "custom" ? `
          <div class="custom-range-row">
            <label>From <input type="date" id="customFrom" value="${customFrom}" /></label>
            <label>To <input type="date" id="customTo" value="${customTo}" /></label>
            <button class="primary" id="applyCustomRange" type="button">Apply</button>
          </div>` : ""}
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
        ${renderPaceCard()}
        ${pg ? `
        <section class="card stack personal-goals-card">
          <div class="section-title"><h3>Personal Goals</h3><span>Auto-adjusted from your data</span></div>
          ${metricCompare("Your Close Rate", closeRate, pg.closeRate)}
          ${metricCompare("Your Answer Rate", answerRate, pg.answerRate)}
          ${progress("Your Daily Sales Target", totals.sale, pg.dailySales)}
          ${progress("Your Daily Revenue Target", totals.revenue, pg.dailyRevenue, true)}
          <div class="muted" style="font-size:11px">Based on ${pg.daysTracked}-day rolling average. Goals auto-adjust as you log more data.</div>
        </section>` : `
        <section class="card stack">
          <div class="section-title"><h3>Personal Goals</h3><span>Set your targets</span></div>
          <div class="form-grid">
            <div class="split">
              <label>Daily sales goal <input id="pgSales" type="number" value="3" /></label>
              <label>Daily revenue goal <input id="pgRevenue" type="number" value="3000" /></label>
            </div>
            <div class="split">
              <label>Close rate % goal <input id="pgClose" type="number" value="15" /></label>
              <label>Answer rate % goal <input id="pgAnswer" type="number" value="40" /></label>
            </div>
            <button id="savePersonalGoals" class="primary" type="button">Save Personal Goals</button>
          </div>
        </section>`}
        <div class="desktop-grid">
          <section class="card stack">
            <div class="section-title"><h3>Outcome Mix</h3><span>${totals.doors} doors</span></div>
            <div class="chart-grid">
              ${outcomeRows.map(([l, v, f]) => chartRow(l, v, Math.max(totals.doors, 1), f)).join("")}
            </div>
          </section>
          <section class="card stack">
            <div class="section-title"><h3>Conversion Funnel</h3><span>Drop-off rates</span></div>
            ${renderFunnel(totals)}
          </section>
        </div>
        <div class="desktop-grid">
          <section class="card stack">
            <div class="section-title"><h3>7-Day Door Trend</h3><span>Daily volume</span></div>
            ${miniBars(sevenDays, "doors")}
          </section>
          <section class="card stack">
            <div class="section-title"><h3>7-Day Sales</h3><span>Daily closes</span></div>
            ${miniBars(sevenDaySales, "sales")}
          </section>
        </div>
        <div class="desktop-grid">
          <section class="card stack">
            <div class="section-title"><h3>Revenue Pace</h3><span>Last 7 days</span></div>
            ${miniBars(sevenDays, "revenue", true)}
          </section>
          <section class="card stack">
            <div class="section-title"><h3>Monthly Trends</h3><span>Last 6 months</span></div>
            ${miniBars(monthlyTrend, "doors")}
          </section>
        </div>
        <div class="desktop-grid">
          <section class="card stack">
            <div class="section-title"><h3>Monthly Revenue</h3><span>Last 6 months</span></div>
            ${miniBars(monthlyTrend, "revenue", true)}
          </section>
          <section class="card stack">
            <div class="section-title"><h3>Field Insights</h3><span>Auto notes</span></div>
            <div class="insight-list">${insights.map((i) => `<div class="insight">${escapeHtml(i)}</div>`).join("")}</div>
          </section>
        </div>
        <div class="grid-4">
          ${stat("Revenue / Door", money(revDoor), "efficiency")}
          ${stat("Next Sale", nextSale, "doors away")}
          ${stat("Avg Doors/Day", avgDoorsPerDay, "all-time")}
          ${stat("Day Streak", streak, "active days")}
        </div>
        <div class="grid-2">
          ${stat("Pitches / Sale", pitchesPerSale, "efficiency")}
          ${stat("Total Sales", totalSalesAll, "all-time")}
        </div>
        <div class="desktop-grid">
          <section class="card stack">
            <div class="section-title"><h3>Best Days of Week</h3><span>Avg doors/weekday</span></div>
            ${miniBars(weekday, "doors")}
          </section>
          <section class="card stack">
            <div class="section-title"><h3>Sales by Month</h3><span>Last 6 months</span></div>
            ${miniBars(monthlyTrend, "sales")}
          </section>
        </div>
        <section class="card stack">
          <div class="section-title"><h3>Today's Schedule</h3><span>${schedule.length} events</span></div>
          ${schedule.length ? schedule.map(scheduleRecord).join("") : empty("No events scheduled for today.")}
        </section>
        <section class="card stack">
          <div class="section-title"><h3>Hot Callbacks</h3><span>${callbacksDue.length} due</span></div>
          ${callbacksDue.length ? callbacksDue.slice(0, 4).map(callbackRecord).join("") : empty("No due callbacks right now.")}
        </section>
        ${renderBestTimesCard()}
      </section>`;
  }

  // Uses this rep's own last-30-day conversion history to tell them how
  // many more doors they need today to hit their sales goal / next sale.
  function computePaceProjection() {
    const last30 = logs.filter((l) => daysBetween(parseLocalDate(l.date), new Date()) <= 30);
    const doorsAll = last30.length;
    const salesAll = last30.filter((l) => l.outcome === "sale").length;
    if (!doorsAll || !salesAll) return null;
    const doorsPerSale = doorsAll / salesAll;

    const today = totalsFor("today");
    const remainingSales = Math.max(0, settings.daily_sales_goal - today.sale);
    const doorsNeededForGoal = Math.ceil(remainingSales * doorsPerSale);
    const doorsSinceLastSale = today.doors - today.sale * doorsPerSale;
    const doorsUntilNextSale = Math.max(0, Math.ceil(doorsPerSale - doorsSinceLastSale));

    return { doorsPerSale, remainingSales, doorsNeededForGoal, doorsUntilNextSale, doorsSoFar: today.doors };
  }

  // Finds which hour of the day this rep knocks the most doors, gets the
  // most answers, and closes the most sales - so they know when to go out.
  function computeBestTimes() {
    if (!logs.length) return null;
    const doorHours = new Array(24).fill(0);
    const answerHours = new Array(24).fill(0);
    const saleHours = new Array(24).fill(0);
    logs.forEach((l) => {
      if (!l.created_at) return;
      const hour = new Date(l.created_at).getHours();
      doorHours[hour]++;
      if (["answered", "pitch", "appointment", "sale"].includes(l.outcome)) answerHours[hour]++;
      if (l.outcome === "sale") saleHours[hour]++;
    });
    const peak = (arr) => {
      const max = Math.max(...arr);
      return max > 0 ? arr.indexOf(max) : null;
    };
    return { doorPeak: peak(doorHours), answerPeak: peak(answerHours), salePeak: peak(saleHours) };
  }

  function formatHour(h) {
    if (h === null || h === undefined) return "—";
    const period = h < 12 ? "AM" : "PM";
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12} ${period}`;
  }

  function renderBestTimesCard() {
    const bt = computeBestTimes();
    if (!bt) return "";
    return `
      <section class="card stack">
        <div class="section-title"><h3>Best Times</h3><span>All-time, by hour</span></div>
        <div class="grid-3">
          ${stat("Most Doors", formatHour(bt.doorPeak), "knock hour")}
          ${stat("Most Answers", formatHour(bt.answerPeak), "answer hour")}
          ${stat("Most Sales", formatHour(bt.salePeak), "close hour")}
        </div>
      </section>`;
  }

  function renderPaceCard() {
    const pace = computePaceProjection();
    if (!pace) {
      return `<section class="card stack">
        <div class="section-title"><h3>Pace to Goal</h3><span>Needs history</span></div>
        <p class="muted">Log a few days of doors and sales and this will tell you exactly how many more doors you need today to hit your goal.</p>
      </section>`;
    }
    return `
      <section class="card stack">
        <div class="section-title"><h3>Pace to Goal</h3><span>~${pace.doorsPerSale.toFixed(1)} doors/sale (30-day avg)</span></div>
        ${pace.remainingSales > 0
          ? `<p>You need about <strong>${pace.doorsNeededForGoal} more doors</strong> today to hit your sales goal.</p>`
          : `<p>You've already hit today's sales goal. 🎉</p>`}
        <p class="muted">About <strong>${pace.doorsUntilNextSale} more doors</strong> until your next projected sale, based on how you've been closing lately.</p>
      </section>`;
  }
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
              <select id="priority">${priorityOptionsHtml("low")}</select>
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

  // ── Accounts (Customer Account Tracking) ────────────────────────
  function renderAccounts() {
    const active = accounts.filter((a) => a.status !== "cancelled").sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return `
      <section id="accounts" class="section ${activeTab === "accounts" ? "active" : ""}">
        <div class="section-title">
          <div><h2>Active Accounts</h2><span>Customer accounts and follow-ups.</span></div>
        </div>
        <section class="card stack">
          <div class="form-grid">
            <label>Customer name <input id="acctName" placeholder="Account name" /></label>
            <label>Address <input id="acctAddress" placeholder="123 Oak Street" /></label>
            <label>Status
              <select id="acctStatus"><option value="pending">Pending</option><option value="active">Active</option><option value="installed">Installed</option><option value="paused">Paused</option></select>
            </label>
            <label>Contract value <input id="acctValue" type="number" placeholder="0" /></label>
            <label>Install date <input id="acctInstallDate" type="date" /></label>
            <label>Notes <textarea id="acctNotes" placeholder="Account notes"></textarea></label>
            <button id="addAccount" class="primary" type="button">Add Account</button>
          </div>
        </section>
        <section class="card stack">
          <div class="section-title"><h3>Accounts</h3><span>${active.length} active</span></div>
          ${active.length ? active.map(accountRecord).join("") : empty("No active accounts yet.")}
        </section>
      </section>`;
  }

  // ── Callbacks ───────────────────────────────────────────────────
  function renderCallbacks() {
    const open = callbacks.filter((c) => c.status !== "done").sort((a, b) => cbWhen(a) - cbWhen(b));
    const presets = [["30 min", 0, 30], ["1 hr", 1, 0], ["2 hr", 2, 0], ["4 hr", 4, 0], ["Tomorrow", 24, 0]];
    const schedule = getSchedule();
    const endOfToday = startOfDay(new Date()).getTime() + 86400000;
    const upcoming = callbacks.filter((c) => c.status !== "done" && cbWhen(c) >= endOfToday)
      .sort((a, b) => cbWhen(a) - cbWhen(b))
      .slice(0, 10);
    return `
      <section id="callbacks" class="section ${activeTab === "callbacks" ? "active" : ""}">
        <div class="section-title">
          <div><h2>Callbacks</h2><span>Schedule & timers</span></div>
        </div>
        <section class="card stack">
          <div class="section-title"><h3>Today</h3><span>${schedule.length} events</span></div>
          ${schedule.length ? schedule.map(scheduleRecord).join("") : empty("Nothing scheduled for today.")}
        </section>
        <section class="card stack">
          <div class="section-title"><h3>Upcoming</h3><span>Next callbacks</span></div>
          ${upcoming.length ? upcoming.map((c) => {
            const when = cbWhen(c);
            const atStr = new Date(when).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
            const cd = countdownLabel(when);
            return `<article class="record">
              <div class="record-top">
                <strong>${escapeHtml(c.name)}</strong>
                <span class="countdown ${priorityInfo(c.priority).badge}" data-remind-at="${when}">${cd.text}</span>
              </div>
              <small>Come back ${escapeHtml(atStr)}</small>
              ${c.address ? `<small>${escapeHtml(c.address)}</small>` : ""}
              ${c.notes ? `<p>${escapeHtml(c.notes)}</p>` : ""}
            </article>`;
          }).join("") : empty("No upcoming callbacks.")}
        </section>
        <section class="card stack">
          <div class="section-title"><h3>New Callback</h3><span>Set a timer</span></div>
          <div class="form-grid">
            <label>Name <input id="cbName" placeholder="Homeowner name" /></label>
            <label>Address <input id="cbAddress" placeholder="123 Oak Street" /></label>
            <label>Come back in</label>
            <div class="duration-presets">
              ${presets.map(([lbl, h, m]) => `<button class="dur-chip" type="button" data-dur-h="${h}" data-dur-m="${m}">${lbl}</button>`).join("")}
            </div>
            <div class="split">
              <label>Hours <input id="cbHours" type="number" min="0" value="1" /></label>
              <label>Minutes <input id="cbMins" type="number" min="0" max="59" value="0" /></label>
            </div>
            <label>Not an exact time? Give a window (minutes)
              <input id="cbWindowMins" type="number" min="0" value="0" placeholder="e.g. 30 for 6:30-7:00" />
            </label>
            <label>Priority
              <select id="cbPriority">${priorityOptionsHtml("low")}</select>
            </label>
            <label>Notes <textarea id="cbNotes" placeholder="What should you remember?"></textarea></label>
            <button id="addCallback" class="primary" type="button">Set Callback Timer</button>
          </div>
        </section>
        <section class="card stack">
          <div class="section-title"><h3>Open Queue</h3><span>${open.length} open</span></div>
          ${open.length ? open.map(callbackRecord).join("") : empty("No callbacks open.")}
        </section>
      </section>`;
  }

  // Returns a comparable timestamp (ms) for ordering/comparing callbacks.
  function cbWhen(c) {
    if (c.remind_at) return new Date(c.remind_at).getTime();
    if (c.date) return parseLocalDate(c.date).getTime() + (c.time ? toMinutes(c.time) * 60000 : 0);
    return 0;
  }
  function toMinutes(t) { const [h, m] = String(t).split(":").map(Number); return (h || 0) * 60 + (m || 0); }

  // ── Calendar ────────────────────────────────────────────────────
  let calendarMonth = new Date().getFullYear() * 12 + new Date().getMonth();
  let calendarSelectedDay = todayKey();

  const PRIORITY_RANK = { hot: 3, medium: 2, low: 1, dmnh: 0 };

  function itemStartMs(c) { return c.remind_at ? new Date(c.remind_at).getTime() : null; }
  function itemEndMs(c) {
    if (c.window_end) return new Date(c.window_end).getTime();
    const start = itemStartMs(c);
    return start ? start + 30 * 60000 : null; // assume a 30-min slot when no window is given
  }

  // Hot priority goes first; a callback with a flexible time window is
  // treated as easier to move, so it sorts after fixed-time ones at the
  // same priority level.
  function sortCalendarItems(items) {
    return items.slice().sort((a, b) => {
      const rankDiff = (PRIORITY_RANK[b.priority] ?? 1) - (PRIORITY_RANK[a.priority] ?? 1);
      if (rankDiff !== 0) return rankDiff;
      const flexDiff = (a.window_end ? 1 : 0) - (b.window_end ? 1 : 0);
      if (flexDiff !== 0) return flexDiff;
      return (itemStartMs(a) || 0) - (itemStartMs(b) || 0);
    });
  }

  // Marks any callback whose time window overlaps another one that day.
  function flagConflicts(items) {
    for (let i = 0; i < items.length; i++) {
      items[i]._conflict = false;
      for (let j = 0; j < items.length; j++) {
        if (i === j) continue;
        const aStart = itemStartMs(items[i]), aEnd = itemEndMs(items[i]);
        const bStart = itemStartMs(items[j]), bEnd = itemEndMs(items[j]);
        if (aStart == null || bStart == null) continue;
        if (aStart < bEnd && bStart < aEnd) { items[i]._conflict = true; break; }
      }
    }
  }

  function timeRangeLabel(c) {
    if (!c.remind_at) return "";
    const start = new Date(c.remind_at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    if (!c.window_end) return start;
    const end = new Date(c.window_end).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    return `${start} - ${end}`;
  }

  const CAL_HOUR_PX = 60;
  const CAL_MIN_HOUR = 6;   // 6 AM
  const CAL_MAX_HOUR = 21;  // 9 PM

  const PRIORITY_BLOCK_COLOR = {
    hot: "#dc2626", medium: "#ca8a04", low: "#2563eb", dmnh: "#6b7280",
  };

  // A Google-Calendar-style day timeline: hour gridlines down the side,
  // each callback positioned and sized by its actual time.
  function renderDayTimeline(items) {
    const timed = items.filter((c) => c.remind_at);
    const allDay = items.filter((c) => !c.remind_at);

    let startHour = CAL_MIN_HOUR, endHour = CAL_MAX_HOUR;
    timed.forEach((c) => {
      const s = new Date(c.remind_at);
      const startFrac = s.getHours() + s.getMinutes() / 60;
      const e = c.window_end ? new Date(c.window_end) : new Date(s.getTime() + 30 * 60000);
      const endFrac = e.getHours() + e.getMinutes() / 60;
      startHour = Math.min(startHour, Math.floor(startFrac));
      endHour = Math.max(endHour, Math.ceil(endFrac));
    });

    const totalHours = endHour - startHour;
    const hourLines = [];
    for (let h = startHour; h <= endHour; h++) {
      hourLines.push(`
        <div class="cal-tl-hour" style="top:${(h - startHour) * CAL_HOUR_PX}px">
          <span class="cal-tl-hour-label">${formatHour(h % 24)}</span>
          <div class="cal-tl-hour-line"></div>
        </div>`);
    }

    const blocks = timed.map((c) => {
      const s = new Date(c.remind_at);
      const startFrac = s.getHours() + s.getMinutes() / 60;
      const e = c.window_end ? new Date(c.window_end) : new Date(s.getTime() + 30 * 60000);
      const endFrac = Math.max(startFrac + 0.4, e.getHours() + e.getMinutes() / 60);
      const top = (startFrac - startHour) * CAL_HOUR_PX;
      const height = Math.max(28, (endFrac - startFrac) * CAL_HOUR_PX - 2);
      const color = c.isInstall ? "#16a34a" : (PRIORITY_BLOCK_COLOR[c.priority] || PRIORITY_BLOCK_COLOR.low);
      return `
        <div class="cal-tl-block ${c._conflict ? "conflict" : ""}" style="top:${top}px; height:${height}px; border-left-color:${color}">
          <strong>${escapeHtml(c.name)}</strong>
          <span>${escapeHtml(timeRangeLabel(c))}${c.address ? " · " + escapeHtml(c.address) : ""}</span>
          ${c._conflict ? `<span class="badge-danger">⚠ overlaps</span>` : ""}
        </div>`;
    }).join("");

    return `
      ${allDay.length ? `
        <div class="cal-allday">
          <div class="cal-hour-label">All day</div>
          ${allDay.map((c) => `
            <article class="record">
              <div class="record-top">
                <strong>${escapeHtml(c.name)}</strong>
                ${c.isInstall ? `<span class="badge-good">Install</span>` : priorityBadge(c.priority)}
              </div>
              ${c.address ? `<small>${escapeHtml(c.address)}</small>` : ""}
            </article>`).join("")}
        </div>` : ""}
      <div class="cal-timeline" style="height:${totalHours * CAL_HOUR_PX}px">
        ${hourLines.join("")}
        <div class="cal-tl-blocks">${blocks}</div>
      </div>`;
  }

  function renderCalendar() {
    const year = Math.floor(calendarMonth / 12);
    const month = calendarMonth % 12;
    const firstOfMonth = new Date(year, month, 1);
    const startWeekday = firstOfMonth.getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const monthLabel = firstOfMonth.toLocaleDateString(undefined, { month: "long", year: "numeric" });

    const byDay = {};
    callbacks.filter((c) => c.status !== "done").forEach((c) => {
      const key = c.date || dkeyFromDate(new Date(cbWhen(c)));
      (byDay[key] = byDay[key] || []).push(c);
    });
    accounts.filter((a) => a.install_date && a.status !== "cancelled").forEach((a) => {
      (byDay[a.install_date] = byDay[a.install_date] || []).push({ name: a.customer_name, isInstall: true });
    });

    let cells = "";
    for (let i = 0; i < startWeekday; i++) cells += `<div class="cal-cell empty"></div>`;
    for (let d = 1; d <= daysInMonth; d++) {
      const key = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const items = byDay[key] || [];
      const isToday = key === todayKey();
      const isSelected = key === calendarSelectedDay;
      cells += `
        <button class="cal-cell ${isToday ? "today" : ""} ${isSelected ? "selected" : ""} ${items.length ? "has-events" : ""}" data-cal-day="${key}" type="button">
          <span>${d}</span>
          ${items.length ? `<i class="cal-dot"></i>` : ""}
        </button>`;
    }

    const selectedItems = sortCalendarItems(byDay[calendarSelectedDay] || []);
    flagConflicts(selectedItems);

    return `
      <section id="calendar" class="section ${activeTab === "calendar" ? "active" : ""}">
        <div class="section-title">
          <div><h2>Calendar</h2><span>Callbacks & installs.</span></div>
        </div>
        <section class="card stack">
          <div class="cal-header">
            <button class="secondary" id="calPrev" type="button">‹</button>
            <strong>${monthLabel}</strong>
            <button class="secondary" id="calNext" type="button">›</button>
          </div>
          <div class="cal-grid cal-weekdays">
            <div>S</div><div>M</div><div>T</div><div>W</div><div>T</div><div>F</div><div>S</div>
          </div>
          <div class="cal-grid">${cells}</div>
        </section>
        <section class="card stack">
          <div class="section-title"><h3>${escapeHtml(new Date(calendarSelectedDay + "T00:00:00").toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" }))}</h3><span>${selectedItems.length} item${selectedItems.length === 1 ? "" : "s"}</span></div>
          ${renderDayTimeline(selectedItems)}
        </section>
      </section>`;
  }

  // ── Recruits (admin/manager team roster) ─────────────────────────
  function statsForMember(m) {
    const memberLogs = logs.filter((l) => l.user_id === m.id);
    const doors = memberLogs.length;
    const sales = memberLogs.filter((l) => l.outcome === "sale").length;
    const answered = memberLogs.filter((l) => ["answered", "pitch", "appointment", "sale"].includes(l.outcome)).length;
    const closeRate = answered ? Math.round((sales / answered) * 100) : 0;
    const revenue = memberLogs.reduce((s, l) => s + Number(l.contract_value || 0), 0);
    return { ...m, doors, sales, closeRate, revenue };
  }

  function renderRecruits() {
    const isAdmin = profile.role === "admin";
    const rows = teamMembers.map(statsForMember).sort((a, b) => b.revenue - a.revenue);

    return `
      <section id="recruits" class="section ${activeTab === "recruits" ? "active" : ""}">
        <div class="section-title">
          <div><h2>Recruits</h2><span>${rows.length} on your team</span></div>
        </div>
        <section class="card stack">
          <div class="section-title"><h3>Invite a Recruit</h3><span>Share your Team Code</span></div>
          <div class="team-id-box">
            <div class="team-code-big">${escapeHtml(teamShortCode || "—")}</div>
            <div class="copy-row">
              <input id="recruitTeamIdDisplay" value="${escapeAttr(teamShortCode)}" readonly />
              <button id="recruitCopyTeamId" class="secondary" type="button">Copy</button>
              <button id="recruitShareTeamId" class="primary" type="button">Share</button>
            </div>
          </div>
          <p class="muted">Have them tap "Join existing team" on the sign-in screen and paste this ID.</p>
        </section>
        <section class="card stack">
          <div class="section-title"><h3>Roster</h3><span>Sorted by revenue</span></div>
          ${rows.length ? rows.map((r) => `
            <article class="record">
              <div class="record-top">
                <strong>${escapeHtml(r.name)}</strong>
                <span class="pill">${escapeHtml(r.role)}</span>
              </div>
              <div class="comm-account-meta">
                <span>${r.doors} doors</span>
                <span>${r.sales} sales</span>
                <span>${r.closeRate}% close</span>
                <span>${money(r.revenue)}</span>
              </div>
              <small>Joined ${new Date(r.created_at).toLocaleDateString()}${r.recruited_by_name ? " · Recruited by " + escapeHtml(r.recruited_by_name) : ""}</small>
            </article>`).join("") : empty("No recruits yet. Share your Team Code to get started.")}
        </section>
        ${isAdmin ? renderOrgTeamManagement() : ""}
      </section>`;
  }

  // Org-wide team management: only the owner (admin) sees this. Lets them
  // spin up new teams and move any recruit into a different one.
  function renderOrgTeamManagement() {
    const teamsById = Object.fromEntries(orgTeams.map((t) => [t.id, t]));
    return `
      <section class="card stack">
        <div class="section-title"><h3>Your Teams</h3><span>${orgTeams.length} total</span></div>
        ${orgTeams.map((t) => {
          const count = orgProfiles.filter((p) => p.team_id === t.id).length;
          return `<div class="progress-row">
            <div class="row-head"><b>${escapeHtml(t.name)}</b><span>${count} member${count === 1 ? "" : "s"}</span></div>
            <small>Code: ${escapeHtml(t.short_code || "—")}</small>
          </div>`;
        }).join("")}
        <div class="form-grid">
          <label>New team name <input id="newTeamName" placeholder="Desert Hawks" /></label>
          <button id="createTeam" class="primary" type="button">Create Team</button>
        </div>
      </section>
      <section class="card stack">
        <div class="section-title"><h3>Move Recruits Between Teams</h3><span>${orgProfiles.length} people org-wide</span></div>
        ${orgProfiles.filter((p) => p.role !== "admin").map((p) => `
          <div class="user-row">
            <div class="record-top">
              <strong>${escapeHtml(p.name)}</strong>
              <select class="role-select" data-set-role="${p.id}">${ROLE_OPTIONS.map((r) => `<option value="${r}" ${p.role === r ? "selected" : ""}>${ROLE_LABELS[r]}</option>`).join("")}</select>
            </div>
            <select class="role-select" data-set-team="${p.id}">
              ${orgTeams.map((t) => `<option value="${t.id}" ${p.team_id === t.id ? "selected" : ""}>${escapeHtml(t.name)}</option>`).join("")}
            </select>
          </div>`).join("")}
      </section>`;
  }

  // ── Schedule ────────────────────────────────────────────────────
  function renderSchedule() {
    const schedule = getSchedule();
    const endOfToday = startOfDay(new Date()).getTime() + 86400000;
    const upcoming = callbacks.filter((c) => c.status !== "done" && cbWhen(c) >= endOfToday)
      .sort((a, b) => cbWhen(a) - cbWhen(b))
      .slice(0, 10);
    return `
      <section id="schedule" class="section ${activeTab === "schedule" ? "active" : ""}">
        <div class="section-title">
          <div><h2>Today's Schedule</h2><span>${dateLabel(new Date())}</span></div>
        </div>
        <section class="card stack">
          <div class="section-title"><h3>Today</h3><span>${schedule.length} events</span></div>
          ${schedule.length ? schedule.map(scheduleRecord).join("") : empty("Nothing scheduled for today.")}
        </section>
        <section class="card stack">
          <div class="section-title"><h3>Upcoming</h3><span>Next callbacks</span></div>
          ${upcoming.length ? upcoming.map((c) => {
            const when = cbWhen(c);
            const atStr = new Date(when).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
            const cd = countdownLabel(when);
            return `<article class="record">
              <div class="record-top">
                <strong>${escapeHtml(c.name)}</strong>
                <span class="countdown ${priorityInfo(c.priority).badge}" data-remind-at="${when}">${cd.text}</span>
              </div>
              <small>Come back ${escapeHtml(atStr)}</small>
              ${c.address ? `<small>${escapeHtml(c.address)}</small>` : ""}
              ${c.notes ? `<p>${escapeHtml(c.notes)}</p>` : ""}
            </article>`;
          }).join("") : empty("No upcoming callbacks.")}
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
          <div class="section-title"><h3>My Info</h3><span>Visible to your team</span></div>
          <label>Name <input id="infoName" value="${escapeAttr(profile.name)}" /></label>
          <label>Birthday <input id="infoBirthday" type="date" value="${escapeAttr(profile.birthday || "")}" /></label>
          <label>Cell number <input id="infoPhone" type="tel" value="${escapeAttr(profile.phone || "")}" /></label>
          <label>Address <input id="infoAddress" value="${escapeAttr(profile.address || "")}" /></label>
          <button id="saveMyInfo" class="secondary" type="button">Save My Info</button>
        </section>
        <section class="card stack">
          <h3>Profile</h3>
          ${isAdmin ? `
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
          ` : `
          <div class="grid-2">
            ${stat("Door goal", settings.daily_door_goal, "daily")}
            ${stat("Sales goal", settings.daily_sales_goal, "daily")}
            ${stat("Go back goal", settings.daily_appointment_goal, "daily")}
            ${stat("Revenue goal", money(settings.daily_revenue_goal), "daily")}
          </div>
          <p class="muted">Goals are locked to keep everyone's stats honest. Ask your admin to make changes.</p>
          `}
        </section>
        ${isAdmin ? `
          <section class="card stack">
            <div class="section-title"><h3>Team</h3><span>${teamMembers.length} members</span></div>
            <div class="team-id-box">
              <label>Team Code (share with reps to join)</label>
              <div class="team-code-big">${escapeHtml(teamShortCode || "—")}</div>
              <div class="copy-row">
                <input id="teamIdDisplay" value="${escapeAttr(teamShortCode)}" readonly />
                <button id="copyTeamId" class="secondary" type="button">Copy</button>
                <button id="shareTeamId" class="primary" type="button">Share</button>
              </div>
            </div>
            ${teamMembers.map(memberRecord).join("")}
          </section>` : ""}
        ${isAdmin ? `
          <section class="card stack">
            <div class="section-title"><h3>Add Past Data</h3><span>Backfill KPIs</span></div>
            <p class="muted">Already have numbers from a few weeks ago? Enter the totals for that day and they'll be added to your history.</p>
            <div class="form-grid">
              <label>Date <input id="bfDate" type="date" value="${todayKey()}" /></label>
              <div class="split">
                <label>Doors knocked <input id="bfDoors" type="number" min="0" value="0" /></label>
                <label>Answered <input id="bfAnswered" type="number" min="0" value="0" /></label>
                <label>Pitched <input id="bfPitch" type="number" min="0" value="0" /></label>
                <label>Go backs <input id="bfAppointment" type="number" min="0" value="0" /></label>
                <label>Not interested <input id="bfNotInterested" type="number" min="0" value="0" /></label>
                <label>Sales <input id="bfSales" type="number" min="0" value="0" /></label>
              </div>
              <label>Total revenue from those sales <input id="bfRevenue" type="number" min="0" value="0" /></label>
              <button id="addBackfill" class="primary" type="button">Add to History</button>
            </div>
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

  // ── Manager Dashboard ──────────────────────────────────────────
  function renderManagerDashboard() {
    const stats = teamStatsFor(range);
    const weekTrends = lastSevenDays();
    const monthlyTrend = lastNMonths(6);
    const reps = teamMembers.filter((m) => m.role === "rep").length;
    const multiplier = range === "today" ? 1 : range === "week" ? 7 : range === "month" ? 30 : range === "year" ? 365 : 30;

    return `
      <section id="dashboard" class="section ${activeTab === "dashboard" ? "active" : ""}">
        <div class="section-title">
          <div><h2>${teamName} Dashboard</h2><span>${reps} reps in team</span></div>
          <div class="range-buttons">
            ${["today", "week", "month", "year"].map((r) => `<button data-range="${r}" class="pill ${range === r ? "active" : ""}" type="button">${capitalize(r)}</button>`).join("")}
          </div>
        </div>

        <div class="grid-4">
          ${stat("Doors", stats.doors, "knocked")}
          ${stat("Sales", stats.sale, "closed")}
          ${stat("Revenue", money(stats.revenue), capitalize(range))}
          ${stat("Close %", pct(stats.sale, stats.pitch).toFixed(1) + "%", "conversion")}
        </div>

        <section class="card stack">
          <div class="section-title"><h3>Performance vs Goals</h3><span>${capitalize(range)}</span></div>
          ${progress("Doors knocked", stats.doors, settings.daily_door_goal * multiplier * reps)}
          ${progress("Sales", stats.sale, settings.daily_sales_goal * multiplier * reps)}
          ${progress("Appointments", stats.appointment, settings.daily_appointment_goal * multiplier * reps)}
          ${progress("Revenue", stats.revenue, settings.daily_revenue_goal * multiplier * reps, true)}
        </section>

        <section class="card stack">
          <div class="section-title"><h3>Conversion Funnel</h3><span>Team-wide</span></div>
          ${renderFunnel(stats)}
        </section>

        <div class="desktop-grid">
          <section class="card stack">
            <div class="section-title"><h3>7-Day Door Trend</h3><span>Daily volume</span></div>
            ${miniBars(weekTrends, "doors", false)}
          </section>
          <section class="card stack">
            <div class="section-title"><h3>7-Day Revenue</h3><span>Daily revenue</span></div>
            ${miniBars(weekTrends, "revenue", true)}
          </section>
        </div>

        <div class="desktop-grid">
          <section class="card stack">
            <div class="section-title"><h3>Monthly Doors</h3><span>Last 6 months</span></div>
            ${miniBars(monthlyTrend, "doors")}
          </section>
          <section class="card stack">
            <div class="section-title"><h3>Monthly Revenue</h3><span>Last 6 months</span></div>
            ${miniBars(monthlyTrend, "revenue", true)}
          </section>
        </div>

        <section class="card stack">
          <div class="section-title"><h3>Conversion Rates</h3><span>vs targets</span></div>
          ${chartRow("Answer rate", pct(stats.answered, stats.doors), settings.target_answer_rate, "var(--blue)")}
          ${chartRow("Pitch rate", pct(stats.pitch, stats.answered), settings.target_pitch_rate, "var(--purple)")}
          ${chartRow("Close rate", pct(stats.sale, stats.pitch), settings.target_close_rate, "var(--sale)")}
        </section>
      </section>`;
  }

  function renderLeaderboard() {
    const rankings = teamRankings();
    const reps = teamMembers.filter((m) => m.role === "rep");

    const leaderboardTab = (title, data, metric) => {
      return data.map((r, i) => {
        const stat = r.stats[metric];
        const value = metric === "revenue" ? money(stat) : stat;
        return `
          <div class="leaderboard-row">
            <span class="rank">#${i + 1}</span>
            <span class="name">${escapeHtml(r.name)}</span>
            <span class="value">${value}</span>
          </div>`;
      }).join("");
    };

    return `
      <section id="leaderboard" class="section ${activeTab === "leaderboard" ? "active" : ""}">
        <div class="section-title"><h2>Team Leaderboard</h2><span>${reps.length} reps this month</span></div>

        <section class="card stack">
          <div class="section-title"><h3>Most Doors</h3><span>Doors knocked</span></div>
          <div class="leaderboard">
            ${leaderboardTab("Doors", rankings.byDoors, "doors")}
          </div>
        </section>

        <section class="card stack">
          <div class="section-title"><h3>Top Sellers</h3><span>Sales closed</span></div>
          <div class="leaderboard">
            ${leaderboardTab("Sales", rankings.bySales, "sale")}
          </div>
        </section>

        <section class="card stack">
          <div class="section-title"><h3>Revenue Leaders</h3><span>Total contract value</span></div>
          <div class="leaderboard">
            ${leaderboardTab("Revenue", rankings.byRevenue, "revenue")}
          </div>
        </section>

        <section class="card stack">
          <div class="section-title"><h3>Best Close Rate</h3><span>Pitches to sales ratio</span></div>
          <div class="leaderboard">
            ${rankings.byCloseRate.map((r, i) => {
              const closeRate = pct(r.stats.sale, r.stats.answered || r.stats.doors);
              return `
                <div class="leaderboard-row">
                  <span class="rank">#${i + 1}</span>
                  <span class="name">${escapeHtml(r.name)}</span>
                  <span class="value">${closeRate.toFixed(1)}%</span>
                </div>`;
            }).join("")}
          </div>
        </section>
      </section>`;
  }

  function renderReports() {
    const thisMonth = teamStatsFor("month");
    const lastMonth = logs.filter((l) => {
      const d = parseLocalDate(l.date);
      const now = new Date();
      const lastMonthStart = now.getMonth() === 0 ? 11 : now.getMonth() - 1;
      const lastMonthYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
      return d.getFullYear() === lastMonthYear && d.getMonth() === lastMonthStart;
    }).reduce((acc, l) => ({
      doors: acc.doors + 1,
      sale: acc.sale + (l.outcome === "sale" ? 1 : 0),
      revenue: acc.revenue + Number(l.contract_value || 0),
    }), { doors: 0, sale: 0, revenue: 0 });

    const doorTrend = lastMonth.doors ? ((thisMonth.doors - lastMonth.doors) / lastMonth.doors * 100).toFixed(1) : "N/A";
    const saleTrend = lastMonth.sale ? ((thisMonth.sale - lastMonth.sale) / lastMonth.sale * 100).toFixed(1) : "N/A";
    const revTrend = lastMonth.revenue ? ((thisMonth.revenue - lastMonth.revenue) / lastMonth.revenue * 100).toFixed(1) : "N/A";

    return `
      <section id="reports" class="section ${activeTab === "reports" ? "active" : ""}">
        <div class="section-title"><h2>Reports & Analytics</h2><span>Performance analysis and exports</span></div>

        <section class="card stack">
          <div class="section-title"><h3>This Month vs Last Month</h3><span>Trend comparison</span></div>
          <div class="progress-row">
            <div class="row-head"><b>Total Doors</b><span class="${doorTrend >= 0 ? "badge-good" : "badge-danger"}">${doorTrend}%</span></div>
            <div class="muted">${thisMonth.doors} this month vs ${lastMonth.doors} last month</div>
          </div>
          <div class="progress-row">
            <div class="row-head"><b>Sales</b><span class="${saleTrend >= 0 ? "badge-good" : "badge-danger"}">${saleTrend}%</span></div>
            <div class="muted">${thisMonth.sale} this month vs ${lastMonth.sale} last month</div>
          </div>
          <div class="progress-row">
            <div class="row-head"><b>Revenue</b><span class="${revTrend >= 0 ? "badge-good" : "badge-danger"}">${revTrend}%</span></div>
            <div class="muted">${money(thisMonth.revenue)} vs ${money(lastMonth.revenue)}</div>
          </div>
        </section>

        <section class="card stack">
          <div class="section-title"><h3>Team Metrics Summary</h3><span>All time totals</span></div>
          <div class="progress-row">
            <div class="row-head"><b>Total Doors</b><span>${logs.length}</span></div>
          </div>
          <div class="progress-row">
            <div class="row-head"><b>Total Sales</b><span>${logs.filter((l) => l.outcome === "sale").length}</span></div>
          </div>
          <div class="progress-row">
            <div class="row-head"><b>Total Revenue</b><span>${money(logs.reduce((s, l) => s + Number(l.contract_value || 0), 0))}</span></div>
          </div>
          <div class="progress-row">
            <div class="row-head"><b>Active Accounts</b><span>${accounts.filter((a) => a.status !== "cancelled").length}</span></div>
          </div>
        </section>

        <section class="card stack">
          <div class="section-title"><h3>Export Data</h3><span>Backup and analysis</span></div>
          <div class="wide-actions">
            <button id="exportCsv" class="secondary" type="button">Export as CSV</button>
            <button id="exportJson" class="secondary" type="button">Export as JSON</button>
          </div>
        </section>
      </section>`;
  }

  // ── Regional Dashboard ────────────────────────────────────────────
  function renderRegionalDashboard() {
    const stats = teamStatsFor(range);
    const weekTrends = lastSevenDays();
    const monthlyTrend = lastNMonths(6);
    const numTeams = allTeams.length;
    const multiplier = range === "today" ? 1 : range === "week" ? 7 : range === "month" ? 30 : range === "year" ? 365 : 30;
    const repsPerTeam = 10;

    return `
      <section id="dashboard" class="section ${activeTab === "dashboard" ? "active" : ""}">
        <div class="section-title">
          <div><h2>Regional Overview</h2><span>${numTeams} teams in region</span></div>
          <div class="range-buttons">
            ${["today", "week", "month", "year"].map((r) => `<button data-range="${r}" class="pill ${range === r ? "active" : ""}" type="button">${capitalize(r)}</button>`).join("")}
          </div>
        </div>

        <div class="grid-4">
          ${stat("Doors", stats.doors, "knocked")}
          ${stat("Sales", stats.sale, "closed")}
          ${stat("Revenue", money(stats.revenue), capitalize(range))}
          ${stat("Close %", pct(stats.sale, stats.pitch).toFixed(1) + "%", "conversion")}
        </div>

        <section class="card stack">
          <div class="section-title"><h3>Regional Performance</h3><span>vs goals</span></div>
          ${progress("Total Doors", stats.doors, settings.daily_door_goal * multiplier * repsPerTeam * numTeams)}
          ${progress("Sales", stats.sale, settings.daily_sales_goal * multiplier * repsPerTeam * numTeams)}
          ${progress("Revenue", stats.revenue, settings.daily_revenue_goal * multiplier * repsPerTeam * numTeams, true)}
        </section>

        <section class="card stack">
          <div class="section-title"><h3>Conversion Funnel</h3><span>All teams</span></div>
          ${renderFunnel(stats)}
        </section>

        <div class="desktop-grid">
          <section class="card stack">
            <div class="section-title"><h3>7-Day Doors</h3><span>Across region</span></div>
            ${miniBars(weekTrends, "doors", false)}
          </section>
          <section class="card stack">
            <div class="section-title"><h3>7-Day Revenue</h3><span>Across region</span></div>
            ${miniBars(weekTrends, "revenue", true)}
          </section>
        </div>

        <div class="desktop-grid">
          <section class="card stack">
            <div class="section-title"><h3>Monthly Doors</h3><span>Last 6 months</span></div>
            ${miniBars(monthlyTrend, "doors")}
          </section>
          <section class="card stack">
            <div class="section-title"><h3>Monthly Revenue</h3><span>Last 6 months</span></div>
            ${miniBars(monthlyTrend, "revenue", true)}
          </section>
        </div>

        <section class="card stack">
          <div class="section-title"><h3>Conversion Rates</h3><span>vs targets</span></div>
          ${chartRow("Answer Rate", pct(stats.answered, stats.doors), settings.target_answer_rate, "var(--blue)")}
          ${chartRow("Pitch Rate", pct(stats.pitch, stats.answered), settings.target_pitch_rate, "var(--purple)")}
          ${chartRow("Close Rate", pct(stats.sale, stats.pitch), settings.target_close_rate, "var(--sale)")}
        </section>
      </section>`;
  }

  function renderRegionalLeaderboard() {
    const teamStats = allTeams.map((team) => ({
      ...team,
      logs: logs.filter((l) => l.team_id === team.id),
    })).map((team) => ({
      ...team,
      doors: team.logs.length,
      sales: team.logs.filter((l) => l.outcome === "sale").length,
      revenue: team.logs.reduce((s, l) => s + Number(l.contract_value || 0), 0),
    })).filter((t) => t.doors > 0 || t.sales > 0 || t.revenue > 0);

    const byDoors = [...teamStats].sort((a, b) => b.doors - a.doors);
    const bySales = [...teamStats].sort((a, b) => b.sales - a.sales);
    const byRevenue = [...teamStats].sort((a, b) => b.revenue - a.revenue);

    const leaderboardTeams = (data, metric) => {
      return data.map((t, i) => {
        const value = metric === "revenue" ? money(t.revenue) : metric === "sales" ? t.sales : t.doors;
        return `
          <div class="leaderboard-row">
            <span class="rank">#${i + 1}</span>
            <span class="name">${escapeHtml(t.name || "Team")}</span>
            <span class="value">${value}</span>
          </div>`;
      }).join("");
    };

    return `
      <section id="leaderboard" class="section ${activeTab === "leaderboard" ? "active" : ""}">
        <div class="section-title"><h2>Team Rankings</h2><span>${allTeams.length} teams</span></div>

        <section class="card stack">
          <div class="section-title"><h3>Most Doors</h3><span>Team activity</span></div>
          <div class="leaderboard">
            ${leaderboardTeams(byDoors, "doors")}
          </div>
        </section>

        <section class="card stack">
          <div class="section-title"><h3>Top Sales</h3><span>Deals closed</span></div>
          <div class="leaderboard">
            ${leaderboardTeams(bySales, "sales")}
          </div>
        </section>

        <section class="card stack">
          <div class="section-title"><h3>Revenue Leaders</h3><span>Total contract value</span></div>
          <div class="leaderboard">
            ${leaderboardTeams(byRevenue, "revenue")}
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

    document.querySelectorAll("[data-remove-account]").forEach((btn) => {
      btn.addEventListener("click", () => removeAccount(btn.dataset.removeAccount));
    });

    bind("#applyCustomRange", "click", () => {
      customFrom = val("#customFrom");
      customTo = val("#customTo");
      render();
    });
    bind("#savePersonalGoals", "click", () => {
      personalGoals = {
        dailySales: num("#pgSales") || 3,
        dailyRevenue: num("#pgRevenue") || 3000,
        closeRate: num("#pgClose") || 15,
        answerRate: num("#pgAnswer") || 40,
      };
      saveCache();
      render();
    });
    document.querySelectorAll(".dur-chip").forEach((btn) => {
      btn.addEventListener("click", () => {
        const h = document.querySelector("#cbHours");
        const m = document.querySelector("#cbMins");
        if (h) h.value = btn.dataset.durH;
        if (m) m.value = btn.dataset.durM;
        document.querySelectorAll(".dur-chip").forEach((b) => b.classList.remove("on"));
        btn.classList.add("on");
      });
    });
    bind("#addCallback", "click", addCallbackEntry);
    bind("#addAccount", "click", addAccountEntry);
    bind("#exportCsv", "click", exportCsv);
    bind("#exportJson", "click", () => download("corekpis-backup.json", JSON.stringify({ settings, logs, callbacks, sales }, null, 2), "application/json"));
    bind("#signOut", "click", handleSignOut);
    bind("#saveSettings", "click", saveSettings);
    bind("#addBackfill", "click", addBackfillEntry);
    bind("#saveMyInfo", "click", saveMyInfo);
    bind("#copyTeamId", "click", () => {
      const input = document.querySelector("#teamIdDisplay");
      if (input) { navigator.clipboard.writeText(input.value).catch(() => {}); }
    });
    bind("#shareTeamId", "click", () => shareTeamCode());

    document.querySelectorAll("[data-set-role]").forEach((sel) => {
      sel.addEventListener("change", () => setMemberRole(sel.dataset.setRole, sel.value));
    });
    document.querySelectorAll("[data-set-team]").forEach((sel) => {
      sel.addEventListener("change", () => setMemberTeam(sel.dataset.setTeam, sel.value));
    });
    bind("#createTeam", "click", createNewTeam);
    document.querySelectorAll("[data-reset-password]").forEach((btn) => {
      btn.addEventListener("click", () => sendPasswordReset(btn.dataset.resetPassword, btn));
    });

    bind("#calPrev", "click", () => { calendarMonth--; render(); });
    bind("#calNext", "click", () => { calendarMonth++; render(); });
    document.querySelectorAll("[data-cal-day]").forEach((btn) => {
      btn.addEventListener("click", () => { calendarSelectedDay = btn.dataset.calDay; render(); });
    });
    bind("#recruitCopyTeamId", "click", () => {
      const input = document.querySelector("#recruitTeamIdDisplay");
      if (input) { navigator.clipboard.writeText(input.value).catch(() => {}); }
    });
    bind("#recruitShareTeamId", "click", () => shareTeamCode());
  }

  function shareTeamCode() {
    const text = `Join my team on CORE Kpi's! Open the app and tap "Join existing team", then enter this code: ${teamShortCode}`;
    if (navigator.share) {
      navigator.share({ title: "Join my CORE Kpi's team", text }).catch(() => {});
    } else {
      navigator.clipboard.writeText(text).catch(() => {});
    }
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
      // Default a "go back" reminder to 2 hours out, or noon on a chosen date.
      const remindAt = callbackDate
        ? new Date(callbackDate + "T12:00:00").toISOString()
        : new Date(Date.now() + 2 * 60 * 60000).toISOString();
      await addCallbackToSupabase({
        name: entry.customer_name || "Go back",
        address: entry.address,
        remind_at: remindAt,
        priority: val("#priority") || "low",
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

  async function addBackfillEntry() {
    const date = val("#bfDate") || todayKey();
    const counts = {
      doorsKnocked: num("#bfDoors"),
      answered: num("#bfAnswered"),
      pitch: num("#bfPitch"),
      appointment: num("#bfAppointment"),
      notInterested: num("#bfNotInterested"),
      sale: num("#bfSales"),
    };
    const totalRevenue = num("#bfRevenue");
    const revenuePerSale = counts.sale > 0 ? totalRevenue / counts.sale : 0;

    const rows = [];
    for (const outcomeId of Object.keys(counts)) {
      const outcome = outcomes.find((o) => o.id === outcomeId);
      for (let i = 0; i < counts[outcomeId]; i++) {
        rows.push({
          team_id: teamId,
          user_id: session.user.id,
          user_name: profile.name,
          outcome: outcomeId,
          label: outcome.label,
          contract_value: outcomeId === "sale" ? revenuePerSale : 0,
          customer_name: "",
          address: "",
          notes: "Backfilled",
          date,
        });
      }
    }
    if (!rows.length) return;

    const { data, error } = await sb.from("logs").insert(rows).select();
    if (error) { console.error(error); return; }
    logs.unshift(...(data || []));
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
    // Derive the calendar date from remind_at so schedule grouping still works.
    const e = { ...entry };
    if (e.remind_at && !e.date) e.date = dkeyFromDate(new Date(e.remind_at));
    const row = { team_id: teamId, ...e, status: "open" };
    const { data, error } = await sb.from("callbacks").insert(row).select().single();
    if (error) { console.error("Failed to save callback:", error); alert("Couldn't save that callback: " + error.message); return; }
    if (data) callbacks.unshift(data);
  }

  async function addCallbackEntry() {
    const hours = num("#cbHours") || 0;
    const mins = num("#cbMins") || 0;
    const totalMin = hours * 60 + mins || 60;
    const remindAtMs = Date.now() + totalMin * 60000;
    const remindAt = new Date(remindAtMs).toISOString();
    const windowMins = num("#cbWindowMins") || 0;
    await addCallbackToSupabase({
      name: val("#cbName").trim() || "Callback",
      address: val("#cbAddress").trim(),
      remind_at: remindAt,
      window_end: windowMins > 0 ? new Date(remindAtMs + windowMins * 60000).toISOString() : null,
      priority: val("#cbPriority"),
      notes: val("#cbNotes").trim(),
    });
    notifyCallbackSet(totalMin);
    saveCache();
    render();
  }

  function dkeyFromDate(d) {
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  function notifyCallbackSet(totalMin) {
    if (!("Notification" in window)) return;
    if (Notification.permission === "default") Notification.requestPermission();
    // Schedule an in-page reminder while the app stays open.
    setTimeout(() => {
      try {
        if (Notification.permission === "granted") new Notification("Callback time!", { body: "Time to head back to your callback." });
      } catch { /* ignore */ }
    }, totalMin * 60000);
  }

  async function completeCallback(id) {
    await sb.from("callbacks").update({ status: "done" }).eq("id", id);
    const cb = callbacks.find((c) => c.id === id);
    if (cb) cb.status = "done";
    saveCache();
    render();
  }

  async function addAccountEntry() {
    await addAccountToSupabase({
      customer_name: val("#acctName").trim() || "Account",
      address: val("#acctAddress").trim(),
      status: val("#acctStatus") || "pending",
      contract_value: num("#acctValue") || 0,
      install_date: val("#acctInstallDate"),
      notes: val("#acctNotes").trim(),
    });
    document.getElementById("acctName").value = "";
    document.getElementById("acctAddress").value = "";
    document.getElementById("acctStatus").value = "pending";
    document.getElementById("acctValue").value = "";
    document.getElementById("acctInstallDate").value = "";
    document.getElementById("acctNotes").value = "";
    saveCache();
    render();
  }

  async function addAccountToSupabase(entry) {
    const row = { team_id: teamId, user_id: session.user.id, ...entry };
    const { data, error } = await sb.from("accounts").insert(row).select().single();
    if (error) { console.error("Failed to save account:", error); alert("Couldn't save that account: " + error.message); return; }
    if (data) accounts.unshift(data);
  }

  async function removeAccount(id) {
    await sb.from("accounts").update({ status: "cancelled" }).eq("id", id);
    const acc = accounts.find((a) => a.id === id);
    if (acc) acc.status = "cancelled";
    saveCache();
    render();
  }

  // Only an admin can change a member's role; this persists to Supabase.
  async function setMemberRole(memberId, newRole) {
    const member = teamMembers.find((m) => m.id === memberId);
    if (member) member.role = newRole;
    const orgMember = orgProfiles.find((m) => m.id === memberId);
    if (orgMember) orgMember.role = newRole;
    try { await sb.from("profiles").update({ role: newRole }).eq("id", memberId); } catch (e) { console.error(e); }
    saveCache();
    render();
  }

  // Admin-only: move a recruit into a different team.
  async function setMemberTeam(memberId, newTeamId) {
    const orgMember = orgProfiles.find((m) => m.id === memberId);
    if (orgMember) orgMember.team_id = newTeamId;
    try { await sb.from("profiles").update({ team_id: newTeamId }).eq("id", memberId); } catch (e) { console.error(e); }
    render();
  }

  // Admin-only: spin up a new team with its own shareable code.
  async function createNewTeam() {
    const name = val("#newTeamName").trim();
    if (!name) return;
    const { data, error } = await sb.from("teams").insert({ name, short_code: generateShortCode() }).select().single();
    if (error) { console.error(error); return; }
    orgTeams.push(data);
    render();
  }

  // We can't change another user's password directly without a service-role
  // backend, but we can safely trigger Supabase's official reset email.
  async function sendPasswordReset(email, btn) {
    const { error } = await sb.auth.resetPasswordForEmail(email);
    if (btn) btn.textContent = error ? "Couldn't send - try again" : "Reset email sent!";
  }

  async function saveMyInfo() {
    const updates = {
      name: val("#infoName").trim() || profile.name,
      birthday: val("#infoBirthday") || null,
      phone: val("#infoPhone").trim(),
      address: val("#infoAddress").trim(),
    };
    await sb.from("profiles").update(updates).eq("id", profile.id);
    Object.assign(profile, updates);
    const member = teamMembers.find((m) => m.id === profile.id);
    if (member) Object.assign(member, updates);
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
      doorsKnocked: count(filtered, "doorsKnocked"),
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
    if (period === "year") return d.getFullYear() === now.getFullYear();
    if (period === "custom" && customFrom && customTo) return dateText >= customFrom && dateText <= customTo;
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
  function dueCallbacks() {
    const endOfToday = startOfDay(new Date()).getTime() + 86400000;
    return callbacks.filter((c) => c.status !== "done" && cbWhen(c) <= endOfToday).sort((a, b) => cbWhen(a) - cbWhen(b));
  }
  function todayOutcomeCount(id) { return logs.filter((l) => l.date === todayKey() && l.outcome === id).length; }

  function teamStatsFor(period) {
    const filtered = logs.filter((l) => inRange(l.date, period));
    return {
      doors: filtered.length,
      doorsKnocked: count(filtered, "doorsKnocked"),
      answered: count(filtered, "answered") + count(filtered, "pitch") + count(filtered, "appointment") + count(filtered, "sale"),
      pitch: count(filtered, "pitch") + count(filtered, "appointment") + count(filtered, "sale"),
      appointment: count(filtered, "appointment"),
      notInterested: count(filtered, "notInterested"),
      sale: count(filtered, "sale"),
      revenue: filtered.reduce((s, l) => s + Number(l.contract_value || 0), 0),
    };
  }

  function repStatsFor(userId, period) {
    const filtered = logs.filter((l) => l.user_id === userId && inRange(l.date, period));
    return {
      doors: filtered.length,
      sale: count(filtered, "sale"),
      revenue: filtered.reduce((s, l) => s + Number(l.contract_value || 0), 0),
      answered: count(filtered, "answered") + count(filtered, "pitch") + count(filtered, "appointment") + count(filtered, "sale"),
    };
  }

  function teamRankings() {
    const reps = teamMembers.filter((m) => m.role === "rep");
    const stats = reps.map((r) => ({
      ...r,
      stats: repStatsFor(r.id, "month"),
    }));
    return {
      byDoors: [...stats].sort((a, b) => b.stats.doors - a.stats.doors),
      bySales: [...stats].sort((a, b) => b.stats.sale - a.stats.sale),
      byRevenue: [...stats].sort((a, b) => b.stats.revenue - a.stats.revenue),
      byCloseRate: [...stats].sort((a, b) => {
        const aRate = pct(b.stats.sale, b.stats.doors);
        const bRate = pct(a.stats.sale, a.stats.doors);
        return aRate - bRate;
      }),
    };
  }

  // ── New Data Helpers ─────────────────────────────────────────────
  function lastNMonths(n) {
    const months = [];
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      const y = d.getFullYear();
      const m = d.getMonth();
      const monthLogs = logs.filter((l) => {
        const ld = parseLocalDate(l.date);
        return ld.getFullYear() === y && ld.getMonth() === m;
      });
      months.push({
        label: d.toLocaleDateString(undefined, { month: "short" }),
        short: d.toLocaleDateString(undefined, { month: "short" }).slice(0, 3),
        doors: monthLogs.length,
        revenue: monthLogs.reduce((s, l) => s + Number(l.contract_value || 0), 0),
        sales: monthLogs.filter((l) => l.outcome === "sale").length,
      });
    }
    return months;
  }

  function renderFunnel(totals) {
    const steps = [
      { label: "Doors", value: totals.doors, color: "#d4d4d4" },
      { label: "Answered", value: totals.answered, color: "#60a5fa" },
      { label: "Pitched", value: totals.pitch, color: "#a78bfa" },
      { label: "Sales", value: totals.sale, color: "#22c55e" },
    ];
    const max = Math.max(totals.doors, 1);
    return `<div class="funnel">${steps.map((s, i) => {
      const w = Math.max(20, (s.value / max) * 100);
      const dropPct = i > 0 && steps[i - 1].value > 0 ? ((1 - s.value / steps[i - 1].value) * 100).toFixed(0) : null;
      return `<div class="funnel-step">
        <div class="funnel-bar" style="width:${w}%;background:${s.color}">${s.value}</div>
        <span>${s.label}${dropPct !== null ? ` <small class="muted">(-${dropPct}%)</small>` : ""}</span>
      </div>`;
    }).join("")}</div>`;
  }

  function computePersonalGoals() {
    if (!personalGoals) return null;
    const last30 = logs.filter((l) => {
      const d = parseLocalDate(l.date);
      return daysBetween(d, new Date()) <= 30;
    });
    const uniqueDays = new Set(last30.map((l) => l.date)).size || 1;
    const totalSales = last30.filter((l) => l.outcome === "sale").length;
    const totalRevenue = last30.reduce((s, l) => s + Number(l.contract_value || 0), 0);
    const totalAnswered = last30.filter((l) => ["answered", "pitch", "appointment", "sale"].includes(l.outcome)).length;
    const totalPitch = last30.filter((l) => ["pitch", "appointment", "sale"].includes(l.outcome)).length;
    const totalDoors = last30.length;

    const actualClose = totalPitch > 0 ? (totalSales / totalPitch) * 100 : 0;
    const actualAnswer = totalDoors > 0 ? (totalAnswered / totalDoors) * 100 : 0;
    const actualDailySales = totalSales / uniqueDays;
    const actualDailyRevenue = totalRevenue / uniqueDays;

    const blend = 0.7;
    return {
      closeRate: personalGoals.closeRate * (1 - blend) + actualClose * blend,
      answerRate: personalGoals.answerRate * (1 - blend) + actualAnswer * blend,
      dailySales: Math.round(personalGoals.dailySales * (1 - blend) + actualDailySales * blend * 1.15),
      dailyRevenue: Math.round(personalGoals.dailyRevenue * (1 - blend) + actualDailyRevenue * blend * 1.15),
      daysTracked: uniqueDays,
    };
  }

  function getSchedule() {
    const today = todayKey();
    const items = [];
    callbacks.filter((c) => c.status !== "done" && (c.date === today || dueToday(c))).forEach((c) => {
      items.push({ type: "callback", when: cbWhen(c), name: c.name, address: c.address, priority: c.priority, id: c.id, notes: c.notes });
    });
    accounts.filter((a) => a.install_date === today && a.status !== "cancelled").forEach((a) => {
      items.push({ type: "install", when: 0, name: a.customer_name, address: a.address, priority: "normal", id: a.id, notes: "Service/install scheduled" });
    });
    items.sort((a, b) => (a.when || Infinity) - (b.when || Infinity));
    return items;
  }

  function dueToday(c) {
    const w = cbWhen(c);
    if (!w) return false;
    const start = startOfDay(new Date()).getTime();
    return w >= start && w < start + 86400000;
  }

  function scheduleRecord(item) {
    const cd = item.when ? countdownLabel(item.when) : { text: "No time set", overdue: false };
    const atStr = item.when ? new Date(item.when).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : "";
    const typeLabel = item.type === "callback" ? "Callback" : "Install";
    return `
      <article class="record">
        <div class="record-top">
          <strong>${escapeHtml(item.name)}</strong>
          <span class="countdown ${cd.overdue ? "badge-danger" : priorityInfo(item.priority).badge}" data-remind-at="${item.when || 0}">${typeLabel} · ${cd.text}</span>
        </div>
        ${atStr ? `<small>${escapeHtml(atStr)}</small>` : ""}
        ${item.address ? `<small>${escapeHtml(item.address)}</small>` : ""}
        ${item.notes ? `<p>${escapeHtml(item.notes)}</p>` : ""}
      </article>`;
  }

  // Live "in 1h 34m" / "Overdue 12m" label for a target timestamp (ms).
  function countdownLabel(when) {
    if (!when) return { text: "—", overdue: false };
    const diff = when - Date.now();
    const overdue = diff < 0;
    const mins = Math.round(Math.abs(diff) / 60000);
    const d = Math.floor(mins / 1440);
    const h = Math.floor((mins % 1440) / 60);
    const m = mins % 60;
    let parts;
    if (d > 0) parts = `${d}d ${h}h`;
    else if (h > 0) parts = `${h}h ${m}m`;
    else parts = `${m}m`;
    return { text: overdue ? `Overdue ${parts}` : `in ${parts}`, overdue };
  }

  function updateCountdowns() {
    document.querySelectorAll("[data-remind-at]").forEach((el) => {
      const when = Number(el.dataset.remindAt);
      if (!when) return;
      const cd = countdownLabel(when);
      const prefix = el.textContent.includes("·") ? el.textContent.split("·")[0] + "· " : "";
      el.textContent = prefix + cd.text;
      el.classList.toggle("badge-danger", cd.overdue);
    });
  }

  function formatTime12(t) {
    if (!t) return "";
    const [h, m] = t.split(":").map(Number);
    const ampm = h >= 12 ? "PM" : "AM";
    const h12 = h % 12 || 12;
    return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
  }

  // Average door volume by weekday (Sun–Sat) for an extra dashboard chart.
  function byWeekday() {
    const buckets = [0, 1, 2, 3, 4, 5, 6].map((i) => ({ idx: i, short: ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"][i], doors: 0, days: new Set() }));
    logs.forEach((l) => {
      const d = parseLocalDate(l.date);
      const b = buckets[d.getDay()];
      b.doors += 1;
      b.days.add(l.date);
    });
    return buckets.map((b) => ({ short: b.short, doors: b.days.size ? Math.round(b.doors / b.days.size) : 0 }));
  }

  // Consecutive days (ending today or yesterday) with at least one log.
  function currentStreak() {
    const dates = new Set(logs.map((l) => l.date));
    let streak = 0;
    const d = new Date();
    if (!dates.has(dkeyFromDate(d))) d.setDate(d.getDate() - 1); // allow streak to count through yesterday
    while (dates.has(dkeyFromDate(d))) {
      streak++;
      d.setDate(d.getDate() - 1);
    }
    return streak;
  }

  // ── UI Helpers ──────────────────────────────────────────────────
  function stat(label, value, sub) {
    return `<div class="stat-card"><span>${label}</span><strong>${value}</strong><em>${sub || ""}</em></div>`;
  }

  function progress(label, current, goal, isMoney) {
    const pctVal = goal > 0 ? Math.min(100, (current / goal) * 100) : 0;
    return `
      <div class="progress-row">
        <div class="row-head"><b>${label}</b><span class="muted">${isMoney ? money(current) : current} / ${isMoney ? money(goal) : goal}</span></div>
        <div class="bar"><span data-pct="${pctVal}" style="width:0%"></span></div>
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
        <div class="chart-fill"><i data-pct="${w}" style="width:0%; --fill:${fill}"></i></div>
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
    const when = cbWhen(item);
    const cd = countdownLabel(when);
    const dueAt = when ? new Date(when) : null;
    const atStr = dueAt ? dueAt.toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" }) : "";
    return `
      <article class="record">
        <div class="record-top">
          <strong>${escapeHtml(item.name)}</strong>
          <span class="countdown ${cd.overdue ? "badge-danger" : priorityInfo(item.priority).badge}" data-remind-at="${when}">${cd.text}</span>
        </div>
        ${atStr ? `<small>Come back ${escapeHtml(atStr)}</small>` : ""}
        ${item.address ? `<small>${escapeHtml(item.address)}</small>` : ""}
        ${item.notes ? `<p>${escapeHtml(item.notes)}</p>` : ""}
        <button class="secondary" data-done="${item.id}" type="button">Complete</button>
      </article>`;
  }

  function accountRecord(acc) {
    return `
      <article class="record">
        <div class="record-top">
          <strong>${escapeHtml(acc.customer_name)}</strong>
          <span class="pill">${escapeHtml(acc.status)}</span>
        </div>
        ${acc.address ? `<small>${escapeHtml(acc.address)}</small>` : ""}
        ${acc.contract_value ? `<p>${money(acc.contract_value)}</p>` : ""}
        ${acc.install_date ? `<p>Installed: ${escapeHtml(acc.install_date)}</p>` : ""}
        ${acc.notes ? `<p>${escapeHtml(acc.notes)}</p>` : ""}
        <button class="secondary" data-remove-account="${acc.id}" type="button">Remove</button>
      </article>`;
  }

  // Admin is the sole owner role and can never be reassigned to anyone else.
  const ROLE_OPTIONS = ["rep", "manager", "regional"];
  const ROLE_LABELS = { rep: "Rep", manager: "Manager", regional: "Regional", admin: "Owner" };

  function memberRecord(member) {
    const isAdmin = profile.role === "admin";
    const canManage = ["admin", "manager", "regional"].includes(profile.role);
    const isSelf = member.id === profile.id;
    return `
      <div class="user-row">
        <div class="record-top">
          <strong>${escapeHtml(member.name)}${isSelf ? " (you)" : ""}</strong>
          ${isAdmin && !isSelf && member.role !== "admin"
            ? `<select class="role-select" data-set-role="${member.id}">${ROLE_OPTIONS.map((r) => `<option value="${r}" ${member.role === r ? "selected" : ""}>${ROLE_LABELS[r]}</option>`).join("")}</select>`
            : `<span class="pill">${escapeHtml(ROLE_LABELS[member.role] || member.role)}</span>`}
        </div>
        <small>Joined ${new Date(member.created_at).toLocaleDateString()}${member.recruited_by_name ? " · Recruited by " + escapeHtml(member.recruited_by_name) : ""}</small>
        ${member.phone || member.address ? `<small>${[member.phone, member.address].filter(Boolean).map(escapeHtml).join(" · ")}</small>` : ""}
        ${canManage && !isSelf && member.email ? `<button class="secondary" data-reset-password="${escapeAttr(member.email)}" type="button">Send Password Reset</button>` : ""}
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
    updateCountdowns();
    checkCallbackAlarms();
  }

  // ── Callback Alarms ──────────────────────────────────────────────
  const firedAlarms = new Set();
  // A window this wide (not just 60s) tolerates mobile browsers throttling
  // background timers, so a late check still catches a recently-due callback.
  const ALARM_CATCH_WINDOW_MS = 5 * 60 * 1000;

  function checkCallbackAlarms() {
    const now = Date.now();
    callbacks.forEach((c) => {
      if (c.status === "done" || !c.remind_at) return;
      const when = new Date(c.remind_at).getTime();
      if (when <= now && when > now - ALARM_CATCH_WINDOW_MS && !firedAlarms.has(c.id)) {
        firedAlarms.add(c.id);
        fireCallbackAlarm(c);
      }
    });
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") checkCallbackAlarms();
  });

  function fireCallbackAlarm(c) {
    playAlarmBeep();
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      try { new Notification("Callback time!", { body: `${c.name || "Callback"} - ${c.address || ""}`.trim() }); } catch { /* ignore */ }
    }
    showAlarmBanner(c);
  }

  // Always show something on-screen, since audio/notifications can be
  // silently blocked by the browser and would otherwise leave no trace.
  function showAlarmBanner(c) {
    const banner = document.createElement("div");
    banner.className = "alarm-banner";
    banner.innerHTML = `<strong>⏰ Callback time!</strong><span>${escapeHtml(c.name || "Callback")}${c.address ? " - " + escapeHtml(c.address) : ""}</span><button type="button">Dismiss</button>`;
    banner.querySelector("button").addEventListener("click", () => banner.remove());
    document.body.appendChild(banner);
    setTimeout(() => banner.remove(), 20000);
  }

  let sharedAudioCtx = null;
  function playAlarmBeep() {
    try {
      if (!sharedAudioCtx) sharedAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const ctx = sharedAudioCtx;
      if (ctx.state === "suspended") ctx.resume().catch(() => {});
      [0, 0.3, 0.6].forEach((delay) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = 880;
        gain.gain.setValueAtTime(0.001, ctx.currentTime + delay);
        gain.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + delay + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + 0.25);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime + delay);
        osc.stop(ctx.currentTime + delay + 0.3);
      });
    } catch { /* ignore */ }
  }

  function requestNotificationPermission() {
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
  }

  // Browsers often silently ignore permission prompts and audio playback
  // triggered automatically on page load - both need a real user gesture
  // to reliably work, so we wait for the first tap anywhere on the page.
  function handleFirstInteraction() {
    if (!sharedAudioCtx) {
      try { sharedAudioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch { /* ignore */ }
    }
    requestNotificationPermission();
    document.removeEventListener("click", handleFirstInteraction);
  }
  document.addEventListener("click", handleFirstInteraction);

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

  function switchIconSvg() {
    return `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="12" r="10.5" stroke="currentColor" stroke-width="1.6"/>
      <path d="M7 9.5h8.5M15.5 9.5L12.5 6.5M15.5 9.5L12.5 12.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M17 14.5H8.5M8.5 14.5L11.5 11.5M8.5 14.5L11.5 17.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
  }

  function go(tab) { activeTab = tab; location.hash = tab; render(); }
  function bind(sel, ev, fn) { const el = document.querySelector(sel); if (el) el.addEventListener(ev, fn); }
  function val(sel) { return document.querySelector(sel)?.value || ""; }
  function num(sel) { return Number(val(sel) || 0); }
  function empty(msg) { return `<div class="empty">${escapeHtml(msg)}</div>`; }
  function dateLabel(d) { return d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" }); }
  function capitalize(t) { return t.charAt(0).toUpperCase() + t.slice(1); }

  // ── Callback Priority Levels ─────────────────────────────────────
  const priorityLevels = [
    { id: "dmnh", label: "DMNH", badge: "badge-dmnh" },
    { id: "low", label: "Low", badge: "badge-low" },
    { id: "medium", label: "Medium", badge: "badge-medium" },
    { id: "hot", label: "Hot", badge: "badge-hot" },
  ];
  function priorityInfo(p) {
    return priorityLevels.find((x) => x.id === p) || priorityLevels[1];
  }
  function priorityOptionsHtml(selected) {
    return priorityLevels.map((p) => `<option value="${p.id}" ${selected === p.id ? "selected" : ""}>${p.label}</option>`).join("");
  }
  function priorityBadge(p) {
    const info = priorityInfo(p);
    return `<span class="${info.badge}">${info.label}</span>`;
  }

  function escapeHtml(t) {
    return String(t || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }
  function escapeAttr(t) { return escapeHtml(t); }

  // ════════════════════════════════════════════════════════════════
  //  COMMISSION SIDE
  // ════════════════════════════════════════════════════════════════

  const commNav = [
    { id: "comm-dashboard", label: "Overview" },
    { id: "comm-accounts", label: "Accounts" },
    { id: "comm-payouts", label: "Payouts" },
    { id: "comm-settings", label: "Settings" },
  ];

  const COMM_STATUSES = ["sold", "pending", "active", "serviced", "cancelled"];
  const COMM_STATUS_LABELS = { sold: "Sold", pending: "Pending", active: "Active", serviced: "Serviced", cancelled: "Cancelled" };

  function renderCommApp() {
    const commSections = `${renderCommDashboard()}${renderCommAccounts()}${renderCommPayouts()}${renderCommSettings()}`;
    appRoot().innerHTML = `
      <main class="app">
        <header class="topbar">
          <div>
            <p class="eyebrow">Commission Tracker</p>
            <h1>Accounts & Pay</h1>
          </div>
          <div class="top-actions">
            <span class="clock-pill" id="topClock">${clockText()}</span>
            <span class="pill">${escapeHtml(profile?.name || "User")}</span>
          </div>
        </header>
        ${commSections}
      </main>
      <button class="mode-toggle mode-toggle-comm" id="modeToggle" type="button" aria-label="Switch to Field view">${switchIconSvg()}</button>
      <nav class="bottom-nav">
        ${commNav.map((item) => `
          <button class="nav-btn ${commTab === item.id ? "active" : ""}" data-comm-tab="${item.id}" type="button">
            <span>${item.label}</span>
          </button>`).join("")}
      </nav>`;

    bind("#modeToggle", "click", toggleAppMode);
    document.querySelectorAll("[data-comm-tab]").forEach((btn) => {
      btn.addEventListener("click", () => { commTab = btn.dataset.commTab; render(); });
    });
    bindCommEvents();
    scrollActiveNavIntoView();
  }

  function commStats() {
    const live = commAccounts.filter((a) => a.status !== "cancelled");
    const serviced = live.filter((a) => a.status === "serviced");
    const active = live.filter((a) => a.status === "active");
    const totalContract = live.reduce((s, a) => s + Number(a.contract_value || 0), 0);
    const servicedContract = serviced.reduce((s, a) => s + Number(a.contract_value || 0), 0);
    const activeContract = active.reduce((s, a) => s + Number(a.contract_value || 0), 0);
    // Frontend ($125) is earned once an account is serviced.
    const frontendEarned = serviced.length * FRONTEND_PER_ACCOUNT;
    // Backend: 30% of contract value on all non-cancelled accounts, minus the $125 already taken per serviced account, paid in Dec.
    const backendGross = totalContract * BACKEND_PCT;
    const backendProjected = backendGross - frontendEarned;
    const cancelled = commAccounts.filter((a) => a.status === "cancelled");
    const chargebackRisk = live.filter((a) => a.status !== "serviced").reduce((s, a) => s + Number(a.contract_value || 0), 0) * BACKEND_PCT;
    const cancelledValue = cancelled.reduce((s, a) => s + Number(a.contract_value || 0), 0);
    const lostFrontend = cancelled.length * FRONTEND_PER_ACCOUNT;
    const lostBackend = cancelledValue * BACKEND_PCT;
    return { live, serviced, active, installed: serviced, totalContract, servicedContract, activeContract, installedContract: servicedContract, frontendEarned, backendGross, backendProjected, cancelled, chargebackRisk, cancelledValue, lostFrontend, lostBackend, total: commAccounts.length };
  }

  function renderCommDashboard() {
    const s = commStats();
    const decDate = new Date(new Date().getFullYear(), 11, 1);
    const daysUntilBackend = Math.max(0, Math.round((decDate - new Date()) / 86400000));
    const monthlyAccounts = commMonthlyTrend();
    const bestDays = commBestDays();
    const rangeAccts = commAccountsInRange();
    const rangeValue = rangeAccts.reduce((sum, a) => sum + Number(a.contract_value || 0), 0);
    const activeList = [...s.active, ...s.serviced].sort((a, b) => Number(b.contract_value || 0) - Number(a.contract_value || 0));

    return `
      <section id="comm-dashboard" class="section ${commTab === "comm-dashboard" ? "active" : ""}">
        <div class="section-title">
          <div><h2>Commission Overview</h2><span>${s.total} total accounts</span></div>
        </div>

        <div class="tabs range-tabs">
          ${["month", "year"].map((i) => `<button class="${commRange === i ? "active" : ""}" data-comm-range="${i}">${capitalize(i)}</button>`).join("")}
          <button class="${commRange === "all" ? "active" : ""}" data-comm-range="all">All</button>
          <button class="${commRange === "custom" ? "active" : ""}" data-comm-range="custom">Custom</button>
        </div>
        ${commRange === "custom" ? `
          <div class="custom-range-row">
            <label>From <input type="date" id="commFrom" value="${commCustomFrom}" /></label>
            <label>To <input type="date" id="commTo" value="${commCustomTo}" /></label>
            <button class="primary" id="applyCommRange" type="button">Apply</button>
          </div>` : ""}
        <div class="grid-2">
          ${commStat(capitalize(commRange) + " Accounts", rangeAccts.length, "sold")}
          ${commStat(capitalize(commRange) + " Contract", money(rangeValue), "value")}
        </div>

        <div class="grid-2">
          ${commStat("Active Accounts", s.active.length, money(s.activeContract))}
          ${commStat("Serviced", s.serviced.length, money(s.servicedContract))}
          ${commStat("Frontend Earned", money(s.frontendEarned), `$${FRONTEND_PER_ACCOUNT}/serviced`)}
          ${commStat("Backend (Dec)", money(s.backendProjected), "net projected")}
        </div>

        <section class="card stack comm-total-card">
          <div class="section-title"><h3>Total Contract Value</h3><span>All live accounts combined</span></div>
          <div class="comm-countdown">
            <strong>${money(s.totalContract)}</strong>
            <span>${s.live.length} active + serviced accounts</span>
          </div>
          <div class="grid-2">
            ${commStat("Total Commission", money(s.frontendEarned + s.backendProjected), "front + back")}
            ${commStat("Avg / Account", money(s.live.length ? s.totalContract / s.live.length : 0), "contract")}
          </div>
        </section>

        <section class="card stack">
          <div class="section-title"><h3>Earnings Breakdown</h3><span>${new Date().getFullYear()}</span></div>
          ${commProgress("Frontend ($125/serviced)", s.frontendEarned, Math.max(s.frontendEarned + s.active.length * FRONTEND_PER_ACCOUNT, FRONTEND_PER_ACCOUNT))}
          ${commProgress("Backend (net, in Dec)", Math.max(0, s.backendProjected), Math.max(s.backendGross, 1))}
          ${commProgress("Total Projected", s.frontendEarned + Math.max(0, s.backendProjected), Math.max((s.frontendEarned + s.backendProjected) * 1.2, 1))}
        </section>

        <section class="card stack">
          <div class="section-title"><h3>Backend Countdown</h3><span>December payout</span></div>
          <div class="comm-countdown">
            <strong>${daysUntilBackend}</strong>
            <span>days until backend payout</span>
          </div>
          <div class="grid-2">
            ${commStat("Projected", money(Math.max(0, s.backendProjected)), "if no cancels")}
            ${commStat("At Risk", money(s.chargebackRisk), "not yet serviced")}
          </div>
        </section>

        <section class="card stack">
          <div class="section-title"><h3>Active Accounts</h3><span>${activeList.length} live</span></div>
          ${activeList.length ? activeList.slice(0, 8).map((a) => `
            <div class="progress-row">
              <div class="row-head"><b>${escapeHtml(a.customer_name)}</b><span class="pill comm-status-${a.status}">${COMM_STATUS_LABELS[a.status]}</span></div>
              <div class="muted">${money(a.contract_value)} contract · ${money(Number(a.contract_value || 0) * BACKEND_PCT)} backend</div>
            </div>`).join("") : empty("No active accounts.")}
        </section>

        <div class="desktop-grid">
          <section class="card stack">
            <div class="section-title"><h3>Monthly Sales</h3><span>Accounts sold</span></div>
            ${miniBars(monthlyAccounts, "count")}
          </section>
          <section class="card stack">
            <div class="section-title"><h3>Monthly Revenue</h3><span>Contract value</span></div>
            ${miniBars(monthlyAccounts, "value", true)}
          </section>
        </div>

        <section class="card stack">
          <div class="section-title"><h3>Best Selling Days</h3><span>By weekday</span></div>
          ${miniBars(bestDays, "count")}
        </section>

        ${s.cancelled.length ? `
        <section class="card stack">
          <div class="section-title"><h3>Chargebacks</h3><span>${s.cancelled.length} cancelled</span></div>
          <div class="grid-2">
            ${commStat("Lost Frontend", money(s.lostFrontend), `${s.cancelled.length} × $${FRONTEND_PER_ACCOUNT}`)}
            ${commStat("Lost Backend", money(s.lostBackend), "30% clawed back")}
          </div>
        </section>` : ""}

        <section class="card stack">
          <div class="section-title"><h3>Account Pipeline</h3><span>Status breakdown</span></div>
          <div class="chart-grid">
            ${["sold", "pending", "active", "serviced"].map((st) => {
              const cnt = commAccounts.filter((a) => a.status === st).length;
              return chartRow(COMM_STATUS_LABELS[st], cnt, Math.max(s.total, 1), st === "serviced" ? "var(--sale)" : st === "active" ? "var(--blue)" : st === "pending" ? "var(--yellow)" : "var(--purple)");
            }).join("")}
          </div>
        </section>
      </section>`;
  }

  function renderCommAccounts() {
    const sorted = [...commAccounts].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
    const statusFilter = "";
    return `
      <section id="comm-accounts" class="section ${commTab === "comm-accounts" ? "active" : ""}">
        <div class="section-title">
          <div><h2>Accounts</h2><span>${commAccounts.length} total</span></div>
        </div>
        <section class="card stack">
          <div class="section-title"><h3>Add Account</h3><span>Manual entry</span></div>
          <div class="form-grid">
            <label>Customer name <input id="commCustName" placeholder="Customer name" /></label>
            <label>Address <input id="commAddress" placeholder="123 Oak Street" /></label>
            <div class="split">
              <label>Contract value <input id="commValue" type="number" placeholder="0" /></label>
              <label>Status
                <select id="commStatus">${COMM_STATUSES.filter((s) => s !== "cancelled").map((s) => `<option value="${s}" ${s === "sold" ? "selected" : ""}>${COMM_STATUS_LABELS[s]}</option>`).join("")}</select>
              </label>
            </div>
            <div class="split">
              <label>Sale date <input id="commSaleDate" type="date" value="${todayKey()}" /></label>
              <label>Install date <input id="commInstallDate" type="date" /></label>
            </div>
            <label>Notes <textarea id="commNotes" placeholder="Account notes"></textarea></label>
            <button id="addCommAccount" class="primary" type="button">Add Account</button>
          </div>
        </section>
        <section class="card stack">
          <div class="section-title"><h3>All Accounts</h3><span>${sorted.length} entries</span></div>
          ${sorted.length ? sorted.map(commAccountRecord).join("") : empty("No accounts yet. Add one above or connect Sequifi.")}
        </section>
      </section>`;
  }

  function renderCommPayouts() {
    const s = commStats();
    const now = new Date();
    const biweeklyStart = new Date(now.getFullYear(), 0, 6); // First Monday-ish of Jan
    const msSinceCycleStart = now - biweeklyStart;
    const cycleNum = Math.floor(msSinceCycleStart / (14 * 86400000));
    const nextPayout = new Date(biweeklyStart.getTime() + (cycleNum + 1) * 14 * 86400000);
    const daysUntilPayout = Math.max(0, Math.round((nextPayout - now) / 86400000));

    const recentInstalls = commAccounts.filter((a) => {
      if (a.status !== "serviced") return false;
      const d = new Date(a.install_date || a.sale_date || a.created_at);
      return (now - d) / 86400000 <= 14;
    });
    const nextFrontend = recentInstalls.length * FRONTEND_PER_ACCOUNT;

    const payoutHistory = commPayoutHistory();

    return `
      <section id="comm-payouts" class="section ${commTab === "comm-payouts" ? "active" : ""}">
        <div class="section-title">
          <div><h2>Payouts</h2><span>Frontend bi-weekly · Backend in December</span></div>
        </div>
        <div class="grid-2">
          ${commStat("Next Payout", daysUntilPayout + " days", nextPayout.toLocaleDateString(undefined, { month: "short", day: "numeric" }))}
          ${commStat("Est. Amount", money(nextFrontend), `${recentInstalls.length} installs × $${FRONTEND_PER_ACCOUNT}`)}
        </div>

        <section class="card stack">
          <div class="section-title"><h3>Frontend Payouts</h3><span>Bi-weekly ($${FRONTEND_PER_ACCOUNT}/install)</span></div>
          ${commProgress("Total Frontend Earned", s.frontendEarned, s.frontendEarned + nextFrontend)}
          <div class="grid-2">
            ${commStat("Total Paid", money(s.frontendEarned), `${s.installed.length} installs`)}
            ${commStat("Upcoming", money(nextFrontend), `${recentInstalls.length} this cycle`)}
          </div>
        </section>

        <section class="card stack">
          <div class="section-title"><h3>Backend Payout</h3><span>December ${now.getFullYear()}</span></div>
          <div class="comm-countdown">
            <strong>${money(s.backendProjected)}</strong>
            <span>projected backend (30% of contract value)</span>
          </div>
          ${commProgress("Backend Earned vs Potential", s.backendProjected, s.totalContract * BACKEND_PCT)}
          ${s.cancelled.length ? `<div class="muted" style="padding:8px 0">⚠ ${s.cancelled.length} cancellation(s) reduced backend by ${money(s.lostBackend)}</div>` : ""}
        </section>

        <section class="card stack">
          <div class="section-title"><h3>Payout History</h3><span>Monthly totals</span></div>
          ${miniBars(payoutHistory, "frontend", true)}
        </section>

        <section class="card stack">
          <div class="section-title"><h3>Chargeback Risk</h3><span>Accounts that could cancel before Dec</span></div>
          ${s.live.length ? s.live.filter((a) => a.status !== "serviced").map((a) => `
            <div class="progress-row">
              <div class="row-head"><b>${escapeHtml(a.customer_name)}</b><span class="badge-hot">${money(Number(a.contract_value || 0) * BACKEND_PCT)} at risk</span></div>
              <div class="muted">Status: ${COMM_STATUS_LABELS[a.status] || a.status} · ${money(a.contract_value)}</div>
            </div>`).join("") : empty("All accounts installed — low chargeback risk.")}
        </section>
      </section>`;
  }

  function renderCommSettings() {
    return `
      <section id="comm-settings" class="section ${commTab === "comm-settings" ? "active" : ""}">
        <div class="section-title">
          <div><h2>Commission Settings</h2><span>Pay structure and integrations</span></div>
        </div>
        <section class="card stack">
          <h3>Pay Structure</h3>
          <div class="split">
            <label>Frontend per install <input id="commFrontendRate" type="number" value="${FRONTEND_PER_ACCOUNT}" disabled /></label>
            <label>Backend % <input id="commBackendPct" type="number" value="${BACKEND_PCT * 100}" disabled /></label>
          </div>
          <div class="muted">Pay rates are set by your company. Contact your manager to update.</div>
        </section>
        <section class="card stack">
          <h3>Sequifi Integration</h3>
          <div class="muted">Use the Sequifi Sync tool to pull your real sales. It creates an <b>accounts.json</b> file — load it here and your accounts appear instantly.</div>
          <label class="primary" for="commImportFile" style="display:block;text-align:center;cursor:pointer">Import from Sequifi (accounts.json)</label>
          <input id="commImportFile" type="file" accept=".json,application/json" style="display:none" />
          <div id="commImportMsg" class="muted"></div>
        </section>
        <section class="card stack">
          <h3>Data</h3>
          <div class="wide-actions">
            <button id="exportCommJson" class="secondary" type="button">Export Commission Data</button>
            <button id="clearCommData" class="ghost" type="button">Clear All Commission Data</button>
          </div>
        </section>
      </section>`;
  }

  function commAccountRecord(acc) {
    if (commEditId === acc.id) return commAccountEditForm(acc);
    const cv = Number(acc.contract_value || 0);
    const frontend = (acc.status === "serviced") ? FRONTEND_PER_ACCOUNT : 0;
    const backend = (acc.status !== "cancelled") ? cv * BACKEND_PCT : 0;
    const isCancelled = acc.status === "cancelled";
    const srcBadge = acc.source === "sequifi" ? `<span class="src-badge${acc.edited ? " edited" : ""}">Sequifi${acc.edited ? " · edited" : ""}</span>` : `<span class="src-badge manual">Manual</span>`;
    return `
      <article class="record ${isCancelled ? "comm-cancelled" : ""}">
        <div class="record-top">
          <strong>${escapeHtml(acc.customer_name)}</strong>
          <span class="pill comm-status-${acc.status}">${COMM_STATUS_LABELS[acc.status] || acc.status}</span>
        </div>
        ${acc.address ? `<small>${escapeHtml(acc.address)}</small>` : ""}
        <div class="comm-account-meta">
          <span>Contract: ${money(cv)}</span>
          <span>Frontend: ${money(frontend)}</span>
          <span>Backend: ${money(backend)}</span>
        </div>
        <div class="comm-account-meta">
          ${acc.sale_date ? `<span>Sold: ${escapeHtml(acc.sale_date)}</span>` : ""}
          ${acc.install_date ? `<span>Serviced: ${escapeHtml(acc.install_date)}</span>` : ""}
          ${srcBadge}
        </div>
        ${acc.notes ? `<p>${escapeHtml(acc.notes)}</p>` : ""}
        <div class="form-actions">
          <select data-comm-status="${acc.id}" class="comm-status-select">
            ${COMM_STATUSES.map((s) => `<option value="${s}" ${acc.status === s ? "selected" : ""}>${COMM_STATUS_LABELS[s]}</option>`).join("")}
          </select>
          <button class="secondary" data-edit-comm="${acc.id}" type="button">Edit</button>
          <button class="danger" data-remove-comm="${acc.id}" type="button">Remove</button>
        </div>
      </article>`;
  }

  // Inline editor — works for any account, including ones synced from Sequifi.
  function commAccountEditForm(acc) {
    return `
      <article class="record comm-editing">
        <div class="section-title"><h3>Edit Account</h3><span>${acc.source === "sequifi" ? "Sequifi override" : "Manual"}</span></div>
        <div class="form-grid">
          <label>Customer name <input id="editName" value="${escapeAttr(acc.customer_name)}" /></label>
          <label>Address <input id="editAddress" value="${escapeAttr(acc.address || "")}" /></label>
          <div class="split">
            <label>Contract value <input id="editValue" type="number" value="${Number(acc.contract_value || 0)}" /></label>
            <label>Status
              <select id="editStatus">${COMM_STATUSES.map((s) => `<option value="${s}" ${acc.status === s ? "selected" : ""}>${COMM_STATUS_LABELS[s]}</option>`).join("")}</select>
            </label>
          </div>
          <div class="split">
            <label>Sale date <input id="editSaleDate" type="date" value="${escapeAttr(acc.sale_date || "")}" /></label>
            <label>Serviced date <input id="editInstallDate" type="date" value="${escapeAttr(acc.install_date || "")}" /></label>
          </div>
          <label>Notes <textarea id="editNotes">${escapeHtml(acc.notes || "")}</textarea></label>
          <div class="form-actions">
            <button class="primary" data-save-comm="${acc.id}" type="button">Save</button>
            <button class="ghost" data-cancel-edit="1" type="button">Cancel</button>
          </div>
        </div>
      </article>`;
  }

  function commStat(label, value, sub) {
    return `<div class="stat-card"><span>${label}</span><strong>${value}</strong><em>${sub || ""}</em></div>`;
  }

  function commProgress(label, current, max) {
    const p = max > 0 ? Math.min(100, (current / max) * 100) : 0;
    return `
      <div class="progress-row">
        <div class="row-head"><b>${label}</b><span class="muted">${money(current)} / ${money(max)}</span></div>
        <div class="bar"><span data-pct="${p}" style="width:0%"></span></div>
      </div>`;
  }

  function commAccountsInRange() {
    const now = new Date();
    return commAccounts.filter((a) => {
      if (a.status === "cancelled") return false;
      const d = new Date(a.sale_date || a.created_at);
      if (commRange === "month") return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
      if (commRange === "year") return d.getFullYear() === now.getFullYear();
      if (commRange === "custom" && commCustomFrom && commCustomTo) {
        const key = dkeyFromDate(d);
        return key >= commCustomFrom && key <= commCustomTo;
      }
      return true; // "all"
    });
  }

  function commBestDays() {
    const buckets = [0, 1, 2, 3, 4, 5, 6].map((i) => ({ short: ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"][i], count: 0, value: 0 }));
    commAccounts.forEach((a) => {
      if (a.status === "cancelled") return;
      const d = new Date(a.sale_date || a.created_at);
      const b = buckets[d.getDay()];
      if (b) { b.count += 1; b.value += Number(a.contract_value || 0); }
    });
    return buckets;
  }

  function commMonthlyTrend() {
    const months = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(); d.setMonth(d.getMonth() - i);
      const y = d.getFullYear(), m = d.getMonth();
      const inMonth = commAccounts.filter((a) => {
        const sd = new Date(a.sale_date || a.created_at);
        return sd.getFullYear() === y && sd.getMonth() === m;
      });
      months.push({
        short: d.toLocaleDateString(undefined, { month: "short" }).slice(0, 3),
        count: inMonth.length,
        value: inMonth.reduce((s, a) => s + Number(a.contract_value || 0), 0),
      });
    }
    return months;
  }

  function commPayoutHistory() {
    const months = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(); d.setMonth(d.getMonth() - i);
      const y = d.getFullYear(), m = d.getMonth();
      const installed = commAccounts.filter((a) => {
        if (a.status !== "serviced") return false;
        const id = new Date(a.install_date || a.sale_date || a.created_at);
        return id.getFullYear() === y && id.getMonth() === m;
      });
      months.push({
        short: d.toLocaleDateString(undefined, { month: "short" }).slice(0, 3),
        frontend: installed.length * FRONTEND_PER_ACCOUNT,
      });
    }
    return months;
  }

  function bindCommEvents() {
    bind("#addCommAccount", "click", addCommAccount);
    bind("#exportCommJson", "click", () => download("commission-backup.json", JSON.stringify(commAccounts, null, 2), "application/json"));
    bind("#commImportFile", "change", importCommFile);
    bind("#clearCommData", "click", () => { if (confirm("Delete all commission data?")) { commAccounts = []; saveCache(); render(); } });

    document.querySelectorAll("[data-comm-range]").forEach((btn) => {
      btn.addEventListener("click", () => { commRange = btn.dataset.commRange; render(); });
    });
    bind("#applyCommRange", "click", () => {
      commCustomFrom = val("#commFrom");
      commCustomTo = val("#commTo");
      render();
    });

    document.querySelectorAll("[data-comm-status]").forEach((sel) => {
      sel.addEventListener("change", () => {
        const acc = commAccounts.find((a) => a.id === sel.dataset.commStatus);
        if (acc) { acc.status = sel.value; if (acc.source === "sequifi") acc.edited = true; saveCache(); render(); }
      });
    });

    document.querySelectorAll("[data-edit-comm]").forEach((btn) => {
      btn.addEventListener("click", () => { commEditId = btn.dataset.editComm; render(); });
    });
    document.querySelectorAll("[data-cancel-edit]").forEach((btn) => {
      btn.addEventListener("click", () => { commEditId = null; render(); });
    });
    document.querySelectorAll("[data-save-comm]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const acc = commAccounts.find((a) => a.id === btn.dataset.saveComm);
        if (acc) {
          acc.customer_name = val("#editName").trim() || acc.customer_name;
          acc.address = val("#editAddress").trim();
          acc.contract_value = num("#editValue") || 0;
          acc.status = val("#editStatus");
          acc.sale_date = val("#editSaleDate");
          acc.install_date = val("#editInstallDate");
          acc.notes = val("#editNotes").trim();
          if (acc.source === "sequifi") acc.edited = true;
        }
        commEditId = null;
        saveCache();
        render();
      });
    });

    document.querySelectorAll("[data-remove-comm]").forEach((btn) => {
      btn.addEventListener("click", () => {
        commAccounts = commAccounts.filter((a) => a.id !== btn.dataset.removeComm);
        saveCache();
        render();
      });
    });
  }

  // Load accounts.json produced by the Sequifi Sync tool. Merges by id so
  // re-importing updates existing accounts instead of duplicating them.
  function importCommFile(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        const incoming = Array.isArray(parsed) ? parsed : parsed.commAccounts || [];
        if (!incoming.length) throw new Error("No accounts found in that file.");
        const byId = {};
        commAccounts.forEach((a) => { byId[a.id] = a; });
        incoming.forEach((a) => {
          // Keep any manual edits the user made on top of a Sequifi account.
          const existing = byId[a.id];
          byId[a.id] = existing && existing.edited ? { ...a, ...existing } : { ...existing, ...a };
        });
        commAccounts = Object.values(byId);
        saveCache();
        const msg = document.querySelector("#commImportMsg");
        if (msg) { msg.textContent = `✅ Imported ${incoming.length} accounts from Sequifi.`; msg.style.color = "#16a34a"; }
        render();
      } catch (err) {
        const msg = document.querySelector("#commImportMsg");
        if (msg) { msg.textContent = "⚠ Couldn't read that file: " + err.message; msg.style.color = "#dc2626"; }
      }
    };
    reader.readAsText(file);
  }

  function addCommAccount() {
    const name = val("#commCustName").trim();
    if (!name) return;
    const acc = {
      id: "comm_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7),
      customer_name: name,
      address: val("#commAddress").trim(),
      contract_value: num("#commValue") || 0,
      status: val("#commStatus") || "sold",
      sale_date: val("#commSaleDate") || todayKey(),
      install_date: val("#commInstallDate") || "",
      notes: val("#commNotes").trim(),
      created_at: new Date().toISOString(),
      source: "manual",
    };
    commAccounts.unshift(acc);
    saveCache();
    render();
  }

  init();
})();
