// CORE — admin-only "set a rep's password" endpoint.
//
// Changing another user's password needs service-role powers, which must
// never live in the browser. This Edge Function runs on Supabase's servers:
// it verifies the caller is a signed-in CORE admin, then updates the target
// user's password via the Admin API. SUPABASE_URL / SUPABASE_ANON_KEY /
// SUPABASE_SERVICE_ROLE_KEY are injected automatically — nothing to set.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader) return json({ error: "Missing authorization" }, 401);

    const url = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Who is calling?
    const caller = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: userData, error: userErr } = await caller.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "Invalid session" }, 401);

    // Service-role client for privileged reads/writes.
    const admin = createClient(url, serviceKey);

    // Only a CORE admin may set passwords.
    const { data: prof } = await admin.from("profiles").select("role").eq("id", userData.user.id).single();
    if (!prof || prof.role !== "admin") return json({ error: "Not authorized" }, 403);

    const { userId, password } = await req.json();
    if (!userId || typeof password !== "string" || password.length < 6) {
      return json({ error: "userId and a password of at least 6 characters are required" }, 400);
    }

    const { error } = await admin.auth.admin.updateUserById(userId, { password });
    if (error) return json({ error: error.message }, 400);

    return json({ ok: true });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
