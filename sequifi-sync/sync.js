// ────────────────────────────────────────────────────────────────
//  SEQUIFI SYNC  (direct API — no browser needed)
//
//  Talks to Sequifi the same clean way their own website does:
//    1. Logs in        → POST /public/api/login           → gets a token
//    2. Pulls sales     → POST /public/api/v2/sales/my-sales-list
//    3. Saves them      → accounts.json  (+ Supabase if configured)
//
//  Your app then shows those accounts. Run it whenever you want fresh
//  numbers — double-click "3-SYNC-NOW".
// ────────────────────────────────────────────────────────────────
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Credentials can come from (in order): the SYNC window asking you,
// or a config.json file if you'd rather save them. No file editing needed.
let config = { sequifi: {}, supabase: {} };
try { config = JSON.parse(fs.readFileSync(path.join(__dirname, "config.json"), "utf8")); } catch {}
if (process.env.SEQUIFI_EMAIL) config.sequifi.email = process.env.SEQUIFI_EMAIL;
if (process.env.SEQUIFI_PASSWORD) config.sequifi.password = process.env.SEQUIFI_PASSWORD;

const API = "https://momentum.api.sequifi.com/public/api";

// Turn Sequifi's status words into the ones our app uses.
function mapStatus(row) {
  const s = `${row.job_status || ""} ${row.external_job_status || ""}`.toLowerCase();
  if (row.date_cancelled || s.includes("cancel")) return "cancelled";
  if (s.includes("complete") || s.includes("serviced") || s.includes("installed")) return "serviced";
  if (s.includes("active")) return "active";
  if (s.includes("pending") || s.includes("inactive")) return "pending";
  return "sold";
}

// Pull a dollar figure for the account's value, falling back sensibly.
function contractValue(row) {
  return Number(row.gross_account_value || row.initial_service_cost || 0) || 0;
}

async function login() {
  const res = await fetch(`${API}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify({ email: config.sequifi.email, password: config.sequifi.password }),
  });
  const json = await res.json();
  if (!json.token) throw new Error("Login failed: " + (json.message || "no token returned"));
  console.log(`→ Logged in as ${json.data?.first_name || "user"}.`);
  return json.token;
}

async function fetchAllSales(token) {
  const headers = {
    "Authorization": `Bearer ${token}`,
    "Content-Type": "application/json",
    "Accept": "application/json",
  };
  const all = [];
  let page = 1;
  let lastPage = 1;
  do {
    // Ask for a page of sales. Sequifi paginates; we loop until done.
    const res = await fetch(`${API}/v2/sales/my-sales-list`, {
      method: "POST",
      headers,
      body: JSON.stringify({ page, per_page: 100, filter: "last_12_months" }),
    });
    const json = await res.json();
    const block = json.data || {};
    const rows = Array.isArray(block.data) ? block.data : Array.isArray(json.data) ? json.data : [];
    all.push(...rows);
    lastPage = Number(block.last_page || 1);
    console.log(`→ Got page ${page} of ${lastPage} (${rows.length} accounts).`);
    page++;
  } while (page <= lastPage);
  return all;
}

function toAccount(row) {
  return {
    id: "sq_" + (row.pid || row.id),
    customer_name: row.customer_name || "Account",
    address: [row.state].filter(Boolean).join(", "),
    contract_value: contractValue(row),
    status: mapStatus(row),
    sale_date: row.sale_date || "",
    install_date: row.install_date || "",
    // Keep Sequifi's own commission numbers so we can show/verify them.
    sequifi_commission: Number(row.total_commission || 0),
    sequifi_projected: Number(row.projected_commission || 0),
    product: row.product || "",
    closer: row.closer || "",
    notes: "Synced from Sequifi",
    source: "sequifi",
  };
}

(async () => {
  try {
    console.log("\n→ Connecting to Sequifi...");
    const token = await login();
    const rows = await fetchAllSales(token);
    const accounts = rows.map(toAccount);
    console.log(`\n✅ Pulled ${accounts.length} accounts from Sequifi.`);

    // Always save a local copy your app can import.
    const outFile = path.join(__dirname, "accounts.json");
    fs.writeFileSync(outFile, JSON.stringify({ commAccounts: accounts }, null, 2));
    console.log(`→ Saved to ${outFile}`);

    // Optionally push straight to your Supabase database (remembers forever).
    if (config.supabase?.url && config.supabase?.serviceKey) {
      const { createClient } = await import("@supabase/supabase-js");
      const sb = createClient(config.supabase.url, config.supabase.serviceKey);
      let ok = 0;
      for (const a of accounts) {
        const { error } = await sb.from("commission_accounts").upsert(a, { onConflict: "id" });
        if (error) console.log("  ⚠", error.message); else ok++;
      }
      console.log(`→ Pushed ${ok}/${accounts.length} to your cloud database.`);
    } else {
      console.log("→ (Cloud database not set up yet — accounts.json is ready to import.)");
    }

    console.log("\n✅ Done! Your Sequifi sales are synced.\n");
  } catch (err) {
    console.error("\n⚠ Sync failed:", err.message);
    console.error("  Send this message to Claude and we'll fix it.\n");
    process.exit(1);
  }
})();
