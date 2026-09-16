const jsonHeaders = { "Content-Type": "application/json" };
const encoder = new TextEncoder();

function base64url(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function accessToken(serviceAccount: { client_email: string; private_key: string }): Promise<string> {
  const privateKey = Uint8Array.from(
    atob(serviceAccount.private_key.replace(/-----[^-]+-----/g, "").replace(/\s/g, "")),
    (character) => character.charCodeAt(0),
  );
  const key = await crypto.subtle.importKey(
    "pkcs8", privateKey, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"],
  );
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(encoder.encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const claim = base64url(encoder.encode(JSON.stringify({
    iss: serviceAccount.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  })));
  const unsigned = `${header}.${claim}`;
  const signature = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, encoder.encode(unsigned)));
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${base64url(signature)}` }),
  });
  if (!response.ok) throw new Error(`OAuth token request failed: ${response.status}`);
  const result = await response.json();
  return result.access_token;
}

Deno.serve(async (request) => {
  const expectedSecret = Deno.env.get("SPLASH_PUSH_WEBHOOK_SECRET");
  if (request.method !== "POST" || !expectedSecret ||
      request.headers.get("x-splash-webhook-secret") !== expectedSecret) {
    return new Response("Unauthorized", { status: 401 });
  }
  try {
    const payload = await request.json();
    if (!/^[0-9a-f-]{36}$/i.test(payload.person_id ?? "") ||
        !/^\d{4}-\d{2}-\d{2}$/.test(payload.work_date ?? "")) {
      return new Response("Invalid event", { status: 400 });
    }
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const firebaseProject = Deno.env.get("FIREBASE_PROJECT_ID");
    const accountJson = Deno.env.get("FIREBASE_SERVICE_ACCOUNT_JSON");
    if (!supabaseUrl || !serviceRoleKey || !firebaseProject || !accountJson) {
      throw new Error("Push secrets are not configured");
    }
    const eventResponse = await fetch(`${supabaseUrl}/rest/v1/rpc/splash_push_event`, {
      method: "POST",
      headers: { ...jsonHeaders, apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` },
      body: JSON.stringify({ p_person_id: payload.person_id, p_work_date: payload.work_date }),
    });
    if (!eventResponse.ok) throw new Error(`Event lookup failed: ${eventResponse.status}`);
    const event = await eventResponse.json();
    if (event.error || !Array.isArray(event.tokens)) return new Response("Invalid event", { status: 400 });
    if (event.tokens.length === 0) return Response.json({ sent: 0 });

    const bearer = await accessToken(JSON.parse(accountJson));
    const results = await Promise.all(event.tokens.map(async (token: string) => {
      const response = await fetch(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(firebaseProject)}/messages:send`, {
        method: "POST",
        headers: { ...jsonHeaders, Authorization: `Bearer ${bearer}` },
        body: JSON.stringify({ message: {
          token,
          notification: {
            title: "Nueva asistencia QR",
            body: `Se registró una asistencia a las ${event.time}. Abre administración para verla.`,
          },
          android: { priority: "high", notification: { channel_id: "attendance" } },
        } }),
      });
      return response.ok;
    }));
    if (results.every((sent) => !sent)) throw new Error("All FCM deliveries failed");
    return Response.json({ sent: results.filter(Boolean).length });
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Push delivery failed");
    return new Response("Push delivery failed", { status: 502 });
  }
});
