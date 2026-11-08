/* Corre dentro de la página (world MAIN). Detecta cuando la agenda genera o descarga un Excel
   y envía una copia del archivo al script de la extensión; no modifica la descarga. */
(function () {
  'use strict';
  if (window.__splashAgendaHook) return;
  window.__splashAgendaHook = true;
  const XLSX_TYPE = /spreadsheetml|ms-excel|octet-stream|zip/i;
  const XLSX_NAME = /\.xlsx(\?|#|$)/i;

  function send(buffer, origin) {
    try { window.postMessage({ source: 'splash-agenda-hook', origin, buffer }, window.location.origin); } catch (_) { /* nada */ }
  }

  // 1) Excel armado en el navegador y descargado con un enlace blob:
  const createObjectURL = URL.createObjectURL;
  URL.createObjectURL = function (object) {
    try {
      if (object instanceof Blob && object.size > 0 && XLSX_TYPE.test(object.type || 'octet-stream')) {
        object.arrayBuffer().then((buffer) => send(buffer, 'blob')).catch(() => {});
      }
    } catch (_) { /* nunca romper la descarga */ }
    return createObjectURL.apply(this, arguments);
  };

  // 2) Excel que baja del servidor con fetch
  const originalFetch = window.fetch;
  window.fetch = async function () {
    const response = await originalFetch.apply(this, arguments);
    try {
      const type = response.headers.get('content-type') || '';
      const disposition = response.headers.get('content-disposition') || '';
      if (/spreadsheetml|ms-excel/i.test(type) || XLSX_NAME.test(disposition) || XLSX_NAME.test(response.url || '')) {
        response.clone().arrayBuffer().then((buffer) => send(buffer, 'fetch')).catch(() => {});
      }
    } catch (_) { /* nunca romper la petición */ }
    return response;
  };

  // 3) Excel que baja del servidor con XMLHttpRequest
  const open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__splashUrl = String(url || '');
    return open.apply(this, arguments);
  };
  const xhrSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function () {
    this.addEventListener('load', () => {
      try {
        const type = this.getResponseHeader('content-type') || '';
        const disposition = this.getResponseHeader('content-disposition') || '';
        if (!(/spreadsheetml|ms-excel/i.test(type) || XLSX_NAME.test(disposition) || XLSX_NAME.test(this.__splashUrl))) return;
        if (this.response instanceof ArrayBuffer) send(this.response.slice(0), 'xhr');
        else if (this.response instanceof Blob) this.response.arrayBuffer().then((buffer) => send(buffer, 'xhr')).catch(() => {});
      } catch (_) { /* nunca romper la petición */ }
    });
    return xhrSend.apply(this, arguments);
  };
})();
