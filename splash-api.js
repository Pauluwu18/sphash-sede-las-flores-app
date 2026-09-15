/* La clave pública se configura al final de este archivo; nunca usar service_role. */
window.Splash = {
  async call(action, payload = {}, role = 'admin') {
    const response = await fetch(`${this.url}/rest/v1/rpc/splash_api`, {
      method: 'POST',
      headers: { apikey: this.key, Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, payload, token: sessionStorage.getItem(`splash-${role}-session`) || '' })
    });
    const data = await response.json();
    if (!response.ok || data?.error) {
      const error = new Error(data?.error || (data?.code === 'PGRST202' ? 'Falta activar la migración QR en Supabase.' : 'No se pudo completar la operación.'));
      error.code = data?.code;
      if (error.code === 'SESSION') {
        sessionStorage.removeItem(`splash-${role}-session`);
        window.dispatchEvent(new CustomEvent('splash-session-expired', { detail: role }));
      }
      throw error;
    }
    return data;
  },
  async available() {
    try { return !!(await this.call('status')).ready; }
    catch (error) { if (error.code === 'PGRST202') return false; throw error; }
  },
  watchAttendance(onChange) {
    if (!window.supabase) return () => {};
    const client = window.supabase.createClient(this.url, this.key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    let timer;
    const channel = client.channel('splash-attendance').on('broadcast', { event: 'attendance_changed' }, () => {
      clearTimeout(timer);
      timer = setTimeout(onChange, 150);
    }).subscribe();
    return () => { clearTimeout(timer); client.removeChannel(channel); };
  },
  escape(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  },
  readQR(value) {
    try {
      const url = new URL(value);
      const expected = new URL('operarios.html', location.href);
      if (url.origin !== expected.origin || url.pathname !== expected.pathname) return '';
      const token = new URLSearchParams(url.hash.slice(1)).get('base') || '';
      return /^[a-f0-9]{64}$/.test(token) ? token : '';
    } catch { return ''; }
  }
};

Splash.url = "https://yyhvpbgvmnhonyqzevfr.supabase.co";
Splash.key = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl5aHZwYmd2bW5ob255cXpldmZyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk0MTMwNTEsImV4cCI6MjEwNDk4OTA1MX0.V4bE69TXc7FuxogGhCszhN0O-9XF4jfoXGgYrYGY-i0";
