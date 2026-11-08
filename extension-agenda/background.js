/* Inicia sesión como administrador (guarda solo el token, nunca la contraseña) y sube la agenda. */
importScripts('config.js');

const { url: BASE, key: KEY } = self.SPLASH_CONFIG;
const HEADERS = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

async function getSession() {
  const { session } = await chrome.storage.local.get('session');
  if (!session || !session.token) return null;
  if (session.expiresAt && Date.now() > session.expiresAt) { await chrome.storage.local.remove('session'); return null; }
  return session;
}

async function login(username, password) {
  const response = await fetch(`${BASE}/rest/v1/rpc/splash_api`, {
    method: 'POST', headers: HEADERS,
    body: JSON.stringify({ action: 'admin_login', payload: { username, password, remember_session: true }, token: '' })
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data || data.error || !data.token) return { ok: false, error: (data && data.error) || 'No se pudo iniciar sesión.' };
  // La sesión "recordada" dura 30 días; se renueva iniciando sesión otra vez.
  const session = { token: data.token, username, expiresAt: Date.now() + 29 * 24 * 3600 * 1000 };
  await chrome.storage.local.set({ session });
  return { ok: true, username };
}

async function upload(payload) {
  const session = await getSession();
  if (!session) return { ok: false, code: 'NO_SESSION', error: 'Inicia sesión en la extensión.' };
  const response = await fetch(`${BASE}/rest/v1/rpc/splash_agenda_upload`, {
    method: 'POST', headers: HEADERS, body: JSON.stringify({ session_token: session.token, payload })
  });
  const data = await response.json().catch(() => null);
  if (response.ok && data && data.ok) {
    await chrome.storage.local.set({ last: { date: data.date, count: data.count, at: Date.now(), unlinked: data.unlinked || [] } });
    return data;
  }
  if (data && data.code === 'SESSION') await chrome.storage.local.remove('session');
  if (data && data.code === 'PGRST202') return { ok: false, error: 'Falta aplicar la migración de agenda en Supabase.' };
  return { ok: false, code: data && data.code, error: (data && data.error) || 'No se pudo enviar la agenda.' };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (message.type === 'upload') return upload(message.payload);
    if (message.type === 'login') return login(String(message.username || '').trim(), String(message.password || ''));
    if (message.type === 'logout') { await chrome.storage.local.remove('session'); return { ok: true }; }
    if (message.type === 'status') {
      const session = await getSession();
      const { last } = await chrome.storage.local.get('last');
      return { ok: true, loggedIn: !!session, username: session && session.username, expiresAt: session && session.expiresAt, last: last || null };
    }
    return { ok: false, error: 'Mensaje desconocido.' };
  })().then(sendResponse).catch((error) => sendResponse({ ok: false, error: String(error && error.message || error) }));
  return true; // respuesta asíncrona
});
