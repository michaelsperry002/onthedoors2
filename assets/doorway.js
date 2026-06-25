(function () {
  const STORAGE = "doorway.metrics.codex.v1";
  const todayKey = () => new Date().toISOString().slice(0, 10);
  const money = (value) =>
    Number(value || 0).toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });

  const defaultSettings = {
    appName: "CORE Kpi's",
    teamName: "Field Team",
    theme: "dark",
    dailyDoorGoal: 100,
    dailySalesGoal: 2,
    dailyAppointmentGoal: 6,
    dailyRevenueGoal: 2500,
    targetAnswerRate: 35,
    targetPitchRate: 60,
    targetCloseRate: 12,
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

  const nav = [
    { id: "dashboard", label: "Home" },
    { id: "log", label: "Log" },
    { id: "callbacks", label: "Callbacks" },
    { id: "history", label: "History" },
    { id: "revenue", label: "Revenue" },
    { id: "settings", label: "Settings" },
  ];

  let state = loadState();
  let activeTab = location.hash.replace("#", "") || "dashboard";
  let range = "today";
  let clockTimer = null;

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE));
      if (saved) {
        const settings = { ...defaultSettings, ...saved.settings };
        if (settings.appName === "Doorway Metrics") settings.appName = "CORE Kpi's";
        return { ...saved, settings };
      }
    } catch {
      localStorage.removeItem(STORAGE);
    }
    return {
      settings: { ...defaultSettings },
      users: [],
      currentUserId: null,
      logs: [],
      callbacks: [],
      sales: [],
    };
  }

  function saveState() {
    localStorage.setItem(STORAGE, JSON.stringify(state));
  }

  function uid(prefix) {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  }

  function currentUser() {
    return state.users.find((user) => user.id === state.currentUserId) || null;
  }

  function appRoot() {
    return document.querySelector("#app");
  }

  function init() {
    window.addEventListener("hashchange", () => {
      activeTab = location.hash.replace("#", "") || "dashboard";
      render();
    });
    clockTimer = setInterval(updateClock, 1000);
    render();
  }

  function render() {
    document.body.className = state.settings.theme === "light" ? "light-mode" : "";
    if (!state.users.length) return renderSetup();
    if (!currentUser()) return renderLogin();
    renderApp();
  }

  function renderSetup() {
    appRoot().innerHTML = `
      <main class="screen">
        <section class="auth-card">
          <div class="brand">
            <small>CORE Kpi's</small>
            <h1>Welcome</h1>
            <p class="muted">Create your admin account to start tracking the field.</p>
          </div>
          <div class="card stack">
            <label>Your name <input id="setupName" autocomplete="name" placeholder="Michael Sperry" /></label>
            <label>4-digit PIN <input id="setupPin" inputmode="numeric" maxlength="4" placeholder="1234" /></label>
            <p id="setupError" class="error"></p>
            <button id="createAdmin" class="primary" type="button">Create Admin Account</button>
          </div>
        </section>
      </main>`;

    bind("#createAdmin", "click", () => {
      const name = value("#setupName").trim();
      const pin = value("#setupPin").trim();
      if (!name) return text("#setupError", "Enter your name.");
      if (!/^\d{4}$/.test(pin)) return text("#setupError", "PIN must be exactly 4 digits.");
      const user = { id: uid("user"), name, pin, role: "admin", disabled: false, createdAt: new Date().toISOString() };
      state.users.push(user);
      state.currentUserId = user.id;
      saveState();
      activeTab = "dashboard";
      location.hash = "dashboard";
      render();
    });
  }

  function renderLogin() {
    const users = state.users.filter((user) => !user.disabled);
    appRoot().innerHTML = `
      <main class="screen">
        <section class="auth-card">
          <div class="brand">
            <small>CORE Kpi's</small>
            <h1>Sign In</h1>
            <p class="muted">Select your name and enter your PIN.</p>
          </div>
          <div class="card stack">
            <label>Who are you?
              <select id="loginUser">${users.map((user) => option(user.id, `${user.name} (${user.role})`)).join("")}</select>
            </label>
            <label>PIN <input id="loginPin" inputmode="numeric" maxlength="4" placeholder="1234" /></label>
            <p id="loginError" class="error"></p>
            <button id="signIn" class="primary" type="button">Sign In</button>
          </div>
        </section>
      </main>`;

    bind("#signIn", "click", () => {
      const user = state.users.find((item) => item.id === value("#loginUser"));
      if (!user || user.pin !== value("#loginPin")) return text("#loginError", "Incorrect PIN. Try again.");
      state.currentUserId = user.id;
      saveState();
      activeTab = "dashboard";
      location.hash = "dashboard";
      render();
    });
  }

  function renderApp() {
    const user = currentUser();
    appRoot().innerHTML = `
      <main class="app">
        <header class="topbar">
          <div>
            <p class="eyebrow">${dateLabel(new Date())}</p>
            <h1>${escapeHtml(state.settings.appName)}</h1>
          </div>
          <div class="top-actions">
            <span class="clock-pill" id="topClock">${clockText()}</span>
            <span class="pill">${escapeHtml(user.name)}</span>
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
        ${nav
          .map(
            (item) => `
            <button class="nav-btn ${activeTab === item.id ? "active" : ""}" data-tab="${item.id}" type="button">
              <span>${item.label}</span>
            </button>`
          )
          .join("")}
      </nav>`;

    document.querySelectorAll("[data-tab]").forEach((button) => {
      button.addEventListener("click", () => go(button.dataset.tab));
    });
    bindCommonEvents();
  }

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
    const bestDay = sevenDays.reduce((best, day) => (day.doors > best.doors ? day : best), sevenDays[0]);
    const insights = [
      totals.doors ? `${totals.doors} doors logged for ${range}.` : "Start logging doors to build your live pace.",
      closeRate ? `Close rate is ${closeRate.toFixed(1)}%, roughly one sale every ${nextSale} pitched doors.` : "Log pitches and sales to calculate close rate.",
      callbacksDue.length ? `${callbacksDue.length} callbacks need attention.` : "No callbacks are due right now.",
      bestDay ? `Best recent door day: ${bestDay.label} with ${bestDay.doors} doors.` : "Your 7-day trend will appear here.",
    ];
    return `
      <section id="dashboard" class="section ${activeTab === "dashboard" ? "active" : ""}">
        <div class="section-title">
          <div>
            <h2>Home Dashboard</h2>
            <span>Live KPIs, goals, graphs, revenue, and follow-ups.</span>
          </div>
        </div>
        <div class="tabs">
          ${["today", "week", "month"].map((item) => `<button class="${range === item ? "active" : ""}" data-range="${item}">${capitalize(item)}</button>`).join("")}
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
            ${progress("Doors", totals.doors, state.settings.dailyDoorGoal)}
            ${progress("Sales", totals.sale, state.settings.dailySalesGoal)}
            ${progress("Go backs", totals.appointment, state.settings.dailyAppointmentGoal)}
            ${progress("Revenue", totals.revenue, state.settings.dailyRevenueGoal, true)}
          </section>
          <section class="card stack">
            <div class="section-title"><h3>Conversion</h3><span>Targets</span></div>
            ${metricCompare("Answer Rate", answerRate, state.settings.targetAnswerRate)}
            ${metricCompare("Pitch Rate", pitchRate, state.settings.targetPitchRate)}
            ${metricCompare("Close Rate", closeRate, state.settings.targetCloseRate)}
          </section>
        </div>
        <div class="desktop-grid">
          <section class="card stack">
            <div class="section-title"><h3>Outcome Mix</h3><span>${totals.doors} doors</span></div>
            <div class="chart-grid">
              ${outcomeRows.map(([label, value, fill]) => chartRow(label, value, Math.max(totals.doors, 1), fill)).join("")}
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
            <div class="insight-list">${insights.map((item) => `<div class="insight">${escapeHtml(item)}</div>`).join("")}</div>
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

  function renderLog() {
    return `
      <section id="log" class="section ${activeTab === "log" ? "active" : ""}">
        <div class="section-title">
          <div><h2>Quick Log</h2><span>Tap as you walk. Counts save instantly.</span></div>
        </div>
        <div class="quick-grid">
          ${outcomes
            .map(
              (item) => `
            <div class="quick-card ${item.kind}">
              <button class="quick-hit" data-outcome="${item.id}" type="button">
                <span class="icon">${item.icon}</span>
                <b>${item.label}</b>
                <span>${todayOutcomeCount(item.id)} today</span>
              </button>
              <button class="quick-minus" data-decrement-outcome="${item.id}" type="button" aria-label="Subtract ${item.label}">-</button>
            </div>`
            )
            .join("")}
        </div>
        <section class="card stack">
          <div class="section-title"><h3>Details</h3><span>Optional</span></div>
          <div class="form-grid">
            <label>Customer name <input id="customerName" placeholder="Homeowner name" /></label>
            <label>Address <input id="address" placeholder="123 Oak Street" /></label>
            <label>Callback date <input id="callbackDate" type="date" /></label>
            <label>Priority
              <select id="priority">
                <option value="normal">Normal</option>
                <option value="hot">Hot</option>
              </select>
            </label>
            <label>Notes <textarea id="notes" placeholder="Optional note for this knock"></textarea></label>
          </div>
        </section>
        <section class="card stack">
          <div class="section-title"><h3>Recent Logs</h3><span>${state.logs.length} total</span></div>
          ${recentLogs().length ? recentLogs().map(logRecord).join("") : empty("No logs yet.")}
        </section>
      </section>`;
  }

  function renderCallbacks() {
    const open = state.callbacks.filter((item) => item.status !== "done").sort((a, b) => a.date.localeCompare(b.date));
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

  function renderHistory() {
    const rows = [...state.logs].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
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

  function renderRevenue() {
    const today = totalsFor("today");
    const week = totalsFor("week");
    const month = totalsFor("month");
    const allRevenue = state.logs.reduce((sum, log) => sum + Number(log.contractValue || 0), 0);
    const sales = [...state.sales].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const avgSale = sales.length ? sales.reduce((sum, sale) => sum + Number(sale.value || 0), 0) / sales.length : 0;
    const bestSale = sales.length ? Math.max(...sales.map((sale) => Number(sale.value || 0))) : 0;
    return `
      <section id="revenue" class="section ${activeTab === "revenue" ? "active" : ""}">
        <div class="section-title">
          <div><h2>Revenue</h2><span>Sales performance and contract value.</span></div>
        </div>
        <div class="grid-2">
          ${stat("Today", money(today.revenue), `${today.sale} sales`)}
          ${stat("This Week", money(week.revenue), `${week.sale} sales`)}
          ${stat("This Month", money(month.revenue), `${month.sale} sales`)}
          ${stat("All Time", money(allRevenue), `${sales.length} sales`)}
        </div>
        <section class="card stack">
          <div class="section-title"><h3>Contract Metrics</h3><span>Closed accounts</span></div>
          <div class="grid-2">
            ${stat("Avg Contract", money(avgSale), "per sale")}
            ${stat("Largest Sale", money(bestSale), "best close")}
          </div>
          ${progress("Daily Revenue", today.revenue, state.settings.dailyRevenueGoal, true)}
        </section>
        <section class="card stack">
          <div class="section-title"><h3>Recent Sales</h3><span>${sales.length} total</span></div>
          ${
            sales.length
              ? sales
                  .slice(0, 12)
                  .map(
                    (sale) => `
                    <article class="record">
                      <div class="record-top"><strong>${escapeHtml(sale.customerName)}</strong><span>${money(sale.value)}</span></div>
                      <small>${escapeHtml(sale.userName)} - ${escapeHtml(sale.date)}</small>
                      ${sale.address ? `<p>${escapeHtml(sale.address)}</p>` : ""}
                    </article>`
                  )
                  .join("")
              : empty("No sales recorded yet.")
          }
        </section>
      </section>`;
  }

  function renderSettings() {
    const user = currentUser();
    const isAdmin = user.role === "admin";
    return `
      <section id="settings" class="section ${activeTab === "settings" ? "active" : ""}">
        <div class="section-title">
          <div><h2>Settings</h2><span>Signed in as ${escapeHtml(user.name)}.</span></div>
        </div>
        <section class="card stack">
          <h3>Profile</h3>
          <label>App name <input id="appName" value="${escapeAttr(state.settings.appName)}" /></label>
          <label>Team name <input id="teamName" value="${escapeAttr(state.settings.teamName)}" /></label>
          <label>Clock timezone
            <select id="timezone">
              ${timezoneOptions()
                .map((item) => `<option value="${item.value}" ${state.settings.timezone === item.value ? "selected" : ""}>${item.label}</option>`)
                .join("")}
            </select>
          </label>
          <div class="split">
            <label>Door goal <input id="dailyDoorGoal" type="number" value="${state.settings.dailyDoorGoal}" /></label>
            <label>Sales goal <input id="dailySalesGoal" type="number" value="${state.settings.dailySalesGoal}" /></label>
            <label>Go back goal <input id="dailyAppointmentGoal" type="number" value="${state.settings.dailyAppointmentGoal}" /></label>
            <label>Revenue goal <input id="dailyRevenueGoal" type="number" value="${state.settings.dailyRevenueGoal}" /></label>
          </div>
          <button id="saveSettings" class="primary" type="button">Save Settings</button>
        </section>
        ${
          isAdmin
            ? `<section class="card stack">
                <div class="section-title"><h3>Users</h3><button id="addUser" class="secondary" type="button">Add User</button></div>
                <div class="form-grid" id="newUserForm" hidden>
                  <label>Name <input id="newUserName" placeholder="Rep name" /></label>
                  <label>PIN <input id="newUserPin" inputmode="numeric" maxlength="4" placeholder="1234" /></label>
                  <label>Role <select id="newUserRole"><option value="rep">Sales Rep</option><option value="manager">Manager</option><option value="admin">Admin</option></select></label>
                  <button id="saveUser" class="primary" type="button">Save User</button>
                </div>
                ${state.users.map(userRecord).join("")}
              </section>`
            : ""
        }
        <section class="card stack">
          <h3>Data</h3>
          <div class="wide-actions">
            <button id="exportJson" class="secondary" type="button">Export Backup</button>
            <button id="signOut" class="ghost" type="button">Sign Out</button>
            <button id="resetData" class="danger" type="button">Reset This App</button>
          </div>
        </section>
      </section>`;
  }

  function bindCommonEvents() {
    document.querySelectorAll("[data-range]").forEach((button) => {
      button.addEventListener("click", () => {
        range = button.dataset.range;
        render();
      });
    });

    document.querySelectorAll("[data-outcome]").forEach((button) => {
      button.addEventListener("click", () => addLog(button.dataset.outcome));
    });

    document.querySelectorAll("[data-decrement-outcome]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        decrementOutcome(button.dataset.decrementOutcome);
      });
    });

    document.querySelectorAll("[data-done]").forEach((button) => {
      button.addEventListener("click", () => {
        const callback = state.callbacks.find((item) => item.id === button.dataset.done);
        if (callback) callback.status = "done";
        saveState();
        render();
      });
    });

    document.querySelectorAll("[data-delete-log]").forEach((button) => {
      button.addEventListener("click", () => {
        removeLog(button.dataset.deleteLog);
      });
    });

    bind("#addCallback", "click", () => {
      const name = value("#cbName").trim() || "Callback";
      const address = value("#cbAddress").trim();
      const date = value("#cbDate") || todayKey();
      state.callbacks.push({
        id: uid("cb"),
        name,
        address,
        date,
        priority: value("#cbPriority"),
        notes: value("#cbNotes").trim(),
        status: "open",
        createdAt: new Date().toISOString(),
      });
      saveState();
      render();
    });

    bind("#exportCsv", "click", exportCsv);
    bind("#exportJson", "click", () => download("doorway-metrics-backup.json", JSON.stringify(state, null, 2), "application/json"));
    bind("#signOut", "click", () => {
      state.currentUserId = null;
      saveState();
      render();
    });
    bind("#resetData", "click", () => {
      if (!confirm("Reset all CORE Kpi's data on this device?")) return;
      localStorage.removeItem(STORAGE);
      state = loadState();
      activeTab = "dashboard";
      location.hash = "";
      render();
    });
    bind("#saveSettings", "click", saveSettings);
    bind("#addUser", "click", () => {
      const form = document.querySelector("#newUserForm");
      if (form) form.hidden = !form.hidden;
    });
    bind("#saveUser", "click", saveUser);
  }

  function addLog(outcomeId) {
    const outcome = outcomes.find((item) => item.id === outcomeId);
    let contractValue = 0;
    if (outcomeId === "sale") {
      const response = prompt("Contract value for this sale?", "0");
      if (response === null) return;
      contractValue = Number(response.replace(/[^0-9.]/g, "")) || 0;
    }
    const date = todayKey();
    const entry = {
      id: uid("log"),
      userId: state.currentUserId,
      userName: currentUser().name,
      outcome: outcomeId,
      label: outcome.label,
      contractValue: outcomeId === "sale" ? contractValue : 0,
      customerName: value("#customerName").trim(),
      address: value("#address").trim(),
      notes: value("#notes").trim(),
      date,
      createdAt: new Date().toISOString(),
    };
    state.logs.push(entry);

    const callbackDate = value("#callbackDate");
    if (outcomeId === "appointment" || callbackDate) {
      state.callbacks.push({
        id: uid("cb"),
        name: entry.customerName || "Go back",
        address: entry.address,
        date: callbackDate || date,
        priority: value("#priority") || "normal",
        notes: entry.notes,
        status: "open",
        createdAt: new Date().toISOString(),
      });
    }

    if (outcomeId === "sale") {
      state.sales.push({
        id: uid("sale"),
        customerName: entry.customerName || "Customer",
        address: entry.address,
        value: contractValue,
        userName: entry.userName,
        date,
        createdAt: entry.createdAt,
      });
    }

    saveState();
    render();
  }

  function removeLog(id) {
    const log = state.logs.find((item) => item.id === id);
    state.logs = state.logs.filter((item) => item.id !== id);
    if (log?.outcome === "sale") {
      state.sales = state.sales.filter((sale) => sale.createdAt !== log.createdAt);
    }
    saveState();
    render();
  }

  function decrementOutcome(outcomeId) {
    const log = [...state.logs]
      .filter((item) => item.date === todayKey() && item.outcome === outcomeId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    if (!log) return;
    removeLog(log.id);
  }

  function saveSettings() {
    ["appName", "teamName"].forEach((key) => {
      state.settings[key] = value(`#${key}`).trim() || defaultSettings[key];
    });
    state.settings.timezone = value("#timezone") || defaultSettings.timezone;
    ["dailyDoorGoal", "dailySalesGoal", "dailyAppointmentGoal", "dailyRevenueGoal"].forEach((key) => {
      state.settings[key] = number(`#${key}`) || defaultSettings[key];
    });
    saveState();
    render();
  }

  function saveUser() {
    const name = value("#newUserName").trim();
    const pin = value("#newUserPin").trim();
    if (!name || !/^\d{4}$/.test(pin)) {
      alert("Enter a name and a 4-digit PIN.");
      return;
    }
    state.users.push({
      id: uid("user"),
      name,
      pin,
      role: value("#newUserRole"),
      disabled: false,
      createdAt: new Date().toISOString(),
    });
    saveState();
    render();
  }

  function totalsFor(period) {
    const filtered = state.logs.filter((log) => inRange(log.date, period));
    return {
      doors: filtered.length,
      noAnswer: count(filtered, "noAnswer"),
      answered: count(filtered, "answered") + count(filtered, "pitch") + count(filtered, "appointment") + count(filtered, "sale"),
      pitch: count(filtered, "pitch") + count(filtered, "appointment") + count(filtered, "sale"),
      appointment: count(filtered, "appointment"),
      notInterested: count(filtered, "notInterested"),
      sale: count(filtered, "sale"),
      revenue: filtered.reduce((sum, log) => sum + Number(log.contractValue || 0), 0),
    };
  }

  function inRange(dateText, period) {
    const date = parseLocalDate(dateText);
    const now = new Date();
    if (period === "today") return dateText === todayKey();
    if (period === "week") return daysBetween(date, now) <= 6;
    if (period === "month") return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
    return true;
  }

  function parseLocalDate(text) {
    const [year, month, day] = text.split("-").map(Number);
    return new Date(year, month - 1, day);
  }

  function daysBetween(a, b) {
    return Math.floor((startOfDay(b) - startOfDay(a)) / 86400000);
  }

  function startOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  function count(items, outcome) {
    return items.filter((item) => item.outcome === outcome).length;
  }

  function pct(part, total) {
    return total > 0 ? (part / total) * 100 : 0;
  }

  function stat(label, value, sub) {
    return `<div class="stat-card"><span>${label}</span><strong>${value}</strong><em>${sub || ""}</em></div>`;
  }

  function progress(label, current, goal, isMoney) {
    const percent = goal > 0 ? Math.min(100, (current / goal) * 100) : 0;
    return `
      <div class="progress-row">
        <div class="row-head"><b>${label}</b><span class="muted">${isMoney ? money(current) : current} / ${isMoney ? money(goal) : goal}</span></div>
        <div class="bar"><span style="width:${percent}%"></span></div>
      </div>`;
  }

  function metricCompare(label, actual, target) {
    const good = actual >= target;
    return `
      <div class="progress-row">
        <div class="row-head">
          <b>${label}</b>
          <span class="${good ? "badge-good" : "badge-danger"}">${actual.toFixed(1)}%</span>
        </div>
        <div class="muted">Goal ${target}%</div>
      </div>`;
  }

  function chartRow(label, value, max, fill) {
    const width = max > 0 ? Math.min(100, (value / max) * 100) : 0;
    return `
      <div class="chart-row">
        <b>${escapeHtml(label)}</b>
        <div class="chart-fill"><i style="width:${width}%; --fill:${fill}"></i></div>
        <span>${value}</span>
      </div>`;
  }

  function miniBars(days, key, isMoney) {
    const max = Math.max(...days.map((day) => Number(day[key] || 0)), 1);
    return `
      <div class="mini-bars">
        ${days
          .map((day) => {
            const value = Number(day[key] || 0);
            const height = Math.max(value > 0 ? 8 : 3, (value / max) * 104);
            return `
              <div class="mini-bar">
                <i style="height:${height}px"></i>
                <span>${escapeHtml(day.short)}</span>
                <span>${isMoney ? money(value) : value}</span>
              </div>`;
          })
          .join("")}
      </div>`;
  }

  function lastSevenDays() {
    const days = [];
    for (let index = 6; index >= 0; index -= 1) {
      const date = new Date();
      date.setDate(date.getDate() - index);
      const key = date.toISOString().slice(0, 10);
      const logs = state.logs.filter((log) => log.date === key);
      days.push({
        key,
        label: date.toLocaleDateString(undefined, { weekday: "short" }),
        short: date.toLocaleDateString(undefined, { weekday: "short" }).slice(0, 2),
        doors: logs.length,
        revenue: logs.reduce((sum, log) => sum + Number(log.contractValue || 0), 0),
      });
    }
    return days;
  }

  function logRecord(log) {
    const kind = outcomes.find((item) => item.id === log.outcome)?.kind || "plain";
    return `
      <article class="record log-record ${kind}">
        <div class="record-top">
          <strong>${escapeHtml(log.label)}</strong>
          <div class="log-actions">
            <small>${escapeHtml(log.date)}</small>
            <button class="minus-btn" data-delete-log="${log.id}" type="button" aria-label="Remove this log">-</button>
          </div>
        </div>
        <small>${escapeHtml(log.userName || "")}${log.contractValue ? ` - ${money(log.contractValue)}` : ""}</small>
        ${log.customerName || log.address ? `<p>${escapeHtml([log.customerName, log.address].filter(Boolean).join(" - "))}</p>` : ""}
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

  function userRecord(user) {
    return `
      <div class="user-row">
        <div class="record-top">
          <strong>${escapeHtml(user.name)}</strong>
          <span class="pill">${escapeHtml(user.role)}</span>
        </div>
        <small>PIN: **** - Created ${new Date(user.createdAt).toLocaleDateString()}</small>
      </div>`;
  }

  function recentLogs() {
    return [...state.logs].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 8);
  }

  function dueCallbacks() {
    return state.callbacks
      .filter((item) => item.status !== "done" && item.date <= todayKey())
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  function todayOutcomeCount(outcomeId) {
    return state.logs.filter((log) => log.date === todayKey() && log.outcome === outcomeId).length;
  }

  function exportCsv() {
    const header = ["date", "rep", "outcome", "customer", "address", "contractValue", "notes"];
    const rows = state.logs.map((log) =>
      [log.date, log.userName, log.label, log.customerName, log.address, log.contractValue, log.notes]
        .map((cell) => `"${String(cell || "").replace(/"/g, '""')}"`)
        .join(",")
    );
    download("doorway-metrics-history.csv", [header.join(","), ...rows].join("\n"), "text/csv");
  }

  function download(filename, content, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function clockText() {
    try {
      return new Intl.DateTimeFormat(undefined, {
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
        timeZone: state.settings.timezone,
      }).format(new Date());
    } catch {
      return new Date().toLocaleTimeString();
    }
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

  function go(tab) {
    activeTab = tab;
    location.hash = tab;
    render();
  }

  function bind(selector, event, handler) {
    const node = document.querySelector(selector);
    if (node) node.addEventListener(event, handler);
  }

  function value(selector) {
    return document.querySelector(selector)?.value || "";
  }

  function number(selector) {
    return Number(value(selector) || 0);
  }

  function text(selector, content) {
    const node = document.querySelector(selector);
    if (node) node.textContent = content;
  }

  function option(valueText, label) {
    return `<option value="${escapeAttr(valueText)}">${escapeHtml(label)}</option>`;
  }

  function empty(message) {
    return `<div class="empty">${escapeHtml(message)}</div>`;
  }

  function dateLabel(date) {
    return date.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
  }

  function capitalize(text) {
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  function escapeHtml(text) {
    return String(text || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function escapeAttr(text) {
    return escapeHtml(text);
  }

  init();
})();
