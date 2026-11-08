/* Al abrir el QR de asistencia en el navegador del celular (sin la app), ofrece instalar la app. */
(function () {
  'use strict';
  const APK_URL = 'https://raw.githubusercontent.com/Pauluwu18/sphash-sede-las-flores-app/main/SPLASH-Operarios.apk';
  const PACKAGE = 'pe.splash.lasflores';
  const insideApp = !!(window.SplashAndroid || window.SplashAdminNative);
  const isAndroid = /Android/i.test(navigator.userAgent || '');
  const fromQr = /(^|[#&])base=[a-f0-9]{64}/.test(location.hash || '');
  if (insideApp || !isAndroid || !fromQr) return;

  const box = document.createElement('div');
  box.id = 'install-app-gate';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-labelledby', 'install-app-title');
  box.style.cssText = 'position:fixed;inset:0;z-index:99999;display:grid;place-items:center;padding:20px;background:#102f49f2;color:#102f49;font-family:inherit';
  box.innerHTML = `
    <div style="width:min(420px,100%);background:#fff;border-radius:24px;padding:26px;box-shadow:0 24px 80px #0006">
      <h2 id="install-app-title" style="margin:0 0 8px;font-size:1.35rem">Instala la app SPLASH</h2>
      <p style="margin:0 0 14px;line-height:1.5;color:#456">Para registrar tu asistencia y reportar tus servicios necesitas la app de operarios.</p>
      <ol style="margin:0 0 16px;padding-left:20px;line-height:1.6;font-size:.92rem">
        <li>Toca <strong>Descargar e instalar</strong>.</li>
        <li>Si Android lo pide, permite instalar desde este navegador.</li>
        <li>Abre la app, inicia sesión y <strong>escanea otra vez el QR</strong> de la base.</li>
      </ol>
      <a id="install-app-download" href="${APK_URL}" download style="display:block;text-align:center;padding:14px;border-radius:12px;background:#008c95;color:#fff;font-weight:700;text-decoration:none">⬇ Descargar e instalar la app</a>
      <a id="install-app-open" href="intent:#Intent;package=${PACKAGE};end" style="display:block;text-align:center;margin-top:10px;padding:12px;border-radius:12px;border:2px solid #008c95;color:#006b73;font-weight:700;text-decoration:none">Ya la tengo: abrir la app</a>
      <button id="install-app-skip" type="button" style="display:block;margin:14px auto 0;background:none;border:0;color:#627d8d;text-decoration:underline;font-size:.85rem;cursor:pointer">Continuar en el navegador</button>
    </div>`;
  const mount = () => document.body.appendChild(box);
  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);
  box.addEventListener('click', (event) => { if (event.target.id === 'install-app-skip') box.remove(); });
})();
