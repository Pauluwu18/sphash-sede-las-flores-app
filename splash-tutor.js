/**
 * SPLASH Sede Las Flores - Sistema de Tutor Interactivo
 * Asistente visual con personaje, spotlight dinámico y menú de ayuda rápida
 */

(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);

  // Vistas del operario: cada paso declara en cuál debe estar la pantalla.
  function showHome() {
    ['service-report-panel', 'checkin-panel', 'history-panel', 'worker-back'].forEach((id) => {
      if ($(id)) $(id).hidden = true;
    });
    if ($('worker-menu')) $('worker-menu').hidden = false;
  }

  function showServicePanel() {
    const panel = $('service-report-panel');
    if (panel && !panel.hidden) return;
    // Reutiliza el flujo real de la app para ocultar los demás paneles y mantener su estado.
    const opener = $('open-service-report');
    if (opener) opener.click();
    if (panel && panel.hidden) {
      showHome();
      panel.hidden = false;
      if ($('worker-menu')) $('worker-menu').hidden = true;
    }
  }

  const STEPS = {
    'step-open-report': {
      selector: '#open-service-report',
      title: 'Reportar servicio',
      text: 'Comencemos por aquí. Pulsa este botón para registrar un nuevo servicio.',
      view: showHome
    },
    'step-operator': {
      selector: '.sr-operator-bar',
      title: 'Operario',
      text: 'Aquí se muestra tu nombre como operario responsable de la sesión. Si realizaron el servicio entre 2 personas, puedes agregar a tu compañero pulsando "+ Agregar otro operario".',
      view: showServicePanel
    },
    'step-service-num': {
      selector: '#sr-service-pills',
      title: 'Número de servicio',
      text: 'Selecciona qué servicio estás registrando. Tienes accesos rápidos desde el 1er servicio hasta el 7mo con un solo toque.',
      view: showServicePanel
    },
    'step-amount': {
      selector: '#sr-amount-pills',
      title: 'Monto del servicio',
      text: 'Aquí indica cuánto se cobró por el servicio. Puedes elegir montos rápidos como S/100, S/120 o S/150, o escribir el monto exacto.',
      view: showServicePanel
    },
    'step-extra': {
      selector: '#sr-extra-group',
      title: 'Extra cobrado',
      text: 'Si el cliente pagó un extra aparte del servicio, escríbelo aquí (por ejemplo 80). Se suma al total y el 50 % es tu comisión; no hace falta escribirlo en la observación.',
      view: showServicePanel
    },
    'step-payment-method': {
      selector: '#sr-payment-methods',
      title: 'Método de pago (obligatorio)',
      text: 'Elige cómo pagó el cliente. Efectivo solo si recibiste el dinero en la mano: es lo único que entra a la caja. Yape, Plin, Tarjeta y Link (pago por enlace) van a la cuenta de la empresa. Si no eliges uno, el reporte no se envía.',
      view: showServicePanel
    },
    'step-photo': {
      selector: '#sr-photo-actions',
      title: 'Foto del comprobante / dinero',
      text: 'Puedes tomar una foto del billete o dinero con "Abrir cámara", o usar "Subir foto" si ya la tienes en el teléfono.',
      view: showServicePanel
    },
    'step-observation': {
      selector: '#sr-observation-input',
      title: 'Observación opcional',
      text: 'Este campo es opcional. Úsalo para aclaraciones, por ejemplo: se dio vuelto en yape. El extra y el método de pago ya tienen su propio campo.',
      view: showServicePanel
    },
    'step-submit': {
      selector: '#sr-submit-whatsapp',
      title: 'Enviar',
      text: 'Cuando hayas terminado, revisa los datos y pulsa "Enviar". El reporte llega a administración y se abre WhatsApp con la foto y el mensaje listos. Si no hay internet, queda guardado y se envía solo al volver la conexión.',
      view: showServicePanel
    },
    'step-checkin': {
      selector: '#open-checkin',
      title: 'Registrar mi asistencia',
      text: 'Pulsa aquí y escanea el QR de la base para marcar tu llegada. Si la cámara no funciona, toma una foto del QR.',
      view: showHome
    },
    'step-history': {
      selector: '#open-history',
      title: 'Mis asistencias',
      text: 'Aquí ves todas tus llegadas con la hora y si fueron temprano o tardanza. Puedes filtrar por mes.',
      view: showHome
    },
    'step-update': {
      selector: '#open-updater',
      title: 'Actualizar la app',
      text: 'Cuando aparezca el aviso amarillo de nueva versión, pulsa "Actualizar ahora". Se descarga y se abre el instalador; si Android lo pide, permite instalar desde esta app.',
      view: showHome
    }
  };

  const FLOWS = {
    full: ['step-open-report', 'step-operator', 'step-service-num', 'step-amount', 'step-extra', 'step-payment-method', 'step-photo', 'step-observation', 'step-submit'],
    payment: ['step-amount', 'step-extra', 'step-payment-method'],
    photo: ['step-photo'],
    observation: ['step-observation'],
    attendance: ['step-checkin', 'step-history'],
    update: ['step-update']
  };

  const COMPACT_WIDTH = 700;

  class SplashTutor {
    constructor() {
      this.flow = [];
      this.flowName = 'full';
      this.currentStepIndex = -1;
      this.isActive = false;
      this.finished = false;
      this.activeElement = null;
      this.dock = null;
      this._frame = 0;
      this._timers = new Set();

      this.initDom();
      this.bindEvents();
      this.syncVisibility();
      this.observeScreenChanges();
    }

    later(fn, ms) {
      const id = setTimeout(() => { this._timers.delete(id); fn(); }, ms);
      this._timers.add(id);
      return id;
    }

    isOperariosPage() {
      const workerHome = $('worker-home');
      const workerLogin = $('worker-login');
      return !!((workerHome && !workerHome.hidden) || (!workerLogin && workerHome));
    }

    syncVisibility() {
      const onPage = this.isOperariosPage();
      if (this.fab) this.fab.style.display = onPage && !this.isActive ? 'flex' : 'none';
      if (!onPage) {
        if (this.isActive) this.closeTutor();
        if (this.welcomeModal) this.welcomeModal.style.display = 'none';
        if (this.menuCard) this.menuCard.style.display = 'none';
        if (this.overlay && !this.isActive) this.overlay.classList.remove('is-active');
        return;
      }
      this.maybeShowWelcome();
    }

    observeScreenChanges() {
      if (typeof MutationObserver === 'undefined') return;
      this._observer = new MutationObserver(() => this.syncVisibility());
      ['worker-home', 'worker-login'].forEach((id) => {
        if ($(id)) this._observer.observe($(id), { attributes: true, attributeFilter: ['hidden', 'style'] });
      });
    }

    initDom() {
      this.fab = document.createElement('button');
      this.fab.type = 'button';
      this.fab.id = 'splash-tutor-fab';
      this.fab.className = 'splash-tutor-fab';
      this.fab.setAttribute('aria-label', 'Abrir tutor y ayuda interactiva');
      this.fab.setAttribute('title', '¿Necesitas ayuda? Toca aquí');
      this.fab.innerHTML = `
        <img class="splash-tutor-fab-img" src="tutor-bubble.png" alt="Ayuda" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
        <span class="splash-tutor-fab-fallback" style="display:none">❓</span>
      `;
      document.body.appendChild(this.fab);

      this.overlay = document.createElement('div');
      this.overlay.id = 'splash-tutor-overlay';
      this.overlay.className = 'splash-tutor-overlay';
      document.body.appendChild(this.overlay);

      this.spotlight = document.createElement('div');
      this.spotlight.id = 'splash-tutor-spotlight';
      this.spotlight.className = 'splash-tutor-spotlight';
      document.body.appendChild(this.spotlight);

      this.stage = document.createElement('div');
      this.stage.id = 'splash-tutor-stage';
      this.stage.className = 'splash-tutor-stage';
      this.stage.style.display = 'none';
      this.stage.innerHTML = `
        <div class="splash-tutor-char-wrap" id="splash-tutor-char-wrap">
          <img class="splash-tutor-char-img" id="splash-tutor-char-img" src="tutor-character.png" alt="Tutor SPLASH">
        </div>
        <div class="splash-tutor-bubble" id="splash-tutor-bubble" role="dialog" aria-live="polite" aria-labelledby="splash-tutor-title">
          <div class="splash-tutor-header">
            <span class="splash-tutor-step-pill" id="splash-tutor-step-pill">Paso 1 de 8</span>
            <button type="button" class="splash-tutor-close-btn" id="splash-tutor-close-btn" aria-label="Cerrar ayuda">&times;</button>
          </div>
          <h3 class="splash-tutor-title" id="splash-tutor-title">Título</h3>
          <p class="splash-tutor-text" id="splash-tutor-text">Texto de explicación...</p>
          <div class="splash-tutor-actions" id="splash-tutor-actions">
            <button type="button" class="splash-tutor-btn-secondary" id="splash-tutor-prev-btn">← Anterior</button>
            <button type="button" class="splash-tutor-btn-primary" id="splash-tutor-next-btn">Siguiente →</button>
          </div>
        </div>
      `;
      document.body.appendChild(this.stage);

      this.menuCard = document.createElement('div');
      this.menuCard.id = 'splash-tutor-quick-menu';
      this.menuCard.className = 'splash-tutor-menu-card';
      this.menuCard.style.display = 'none';
      this.menuCard.innerHTML = `
        <div class="splash-tutor-menu-header">
          <img class="splash-tutor-menu-avatar" src="tutor-bubble.png" alt="Avatar">
          <div>
            <h4 class="splash-tutor-menu-title">¿En qué necesitas ayuda?</h4>
            <p class="splash-tutor-menu-subtitle">Toca un tema para enseñártelo en pantalla:</p>
          </div>
        </div>
        <div class="splash-tutor-menu-list">
          <button type="button" class="splash-tutor-menu-item" data-tutor-flow="full" style="background:#eef7f9;border-color:#008c95;color:#00757d">
            <span class="splash-tutor-menu-item-icon">📚</span>
            <span>Ver tutorial completo</span>
          </button>
          <button type="button" class="splash-tutor-menu-item" data-tutor-flow="payment">
            <span class="splash-tutor-menu-item-icon">💰</span>
            <span>Registrar monto, extra y pago</span>
          </button>
          <button type="button" class="splash-tutor-menu-item" data-tutor-flow="photo">
            <span class="splash-tutor-menu-item-icon">📷</span>
            <span>Subir comprobante o foto</span>
          </button>
          <button type="button" class="splash-tutor-menu-item" data-tutor-flow="observation">
            <span class="splash-tutor-menu-item-icon">📝</span>
            <span>Agregar observación</span>
          </button>
          <button type="button" class="splash-tutor-menu-item" data-tutor-flow="attendance">
            <span class="splash-tutor-menu-item-icon">🕘</span>
            <span>Registrar y ver mi asistencia</span>
          </button>
          <button type="button" class="splash-tutor-menu-item" data-tutor-flow="update">
            <span class="splash-tutor-menu-item-icon">🔄</span>
            <span>Actualizar la app</span>
          </button>
        </div>
        <div class="splash-tutor-menu-footer">
          <small style="color:#627d8d;font-size:0.75rem">SPLASH Sede Las Flores</small>
          <button type="button" class="splash-tutor-btn-secondary" id="splash-tutor-menu-close" style="padding:4px 10px;font-size:0.8rem">Cerrar</button>
        </div>
      `;
      document.body.appendChild(this.menuCard);

      this.welcomeModal = document.createElement('div');
      this.welcomeModal.id = 'splash-tutor-welcome';
      this.welcomeModal.className = 'splash-tutor-welcome-modal';
      this.welcomeModal.style.display = 'none';
      this.welcomeModal.innerHTML = `
        <img class="splash-tutor-welcome-char" src="tutor-character.png" alt="Tutor SPLASH">
        <h3 class="splash-tutor-welcome-title">¡Hola! Soy tu asistente SPLASH 👋</h3>
        <p class="splash-tutor-welcome-desc">Puedo enseñarte paso a paso cómo registrar y reportar tus servicios en la aplicación fácilmente.</p>
        <div class="splash-tutor-welcome-actions">
          <button type="button" class="splash-tutor-btn-secondary" id="splash-tutor-welcome-skip">Ahora no</button>
          <button type="button" class="splash-tutor-btn-primary" id="splash-tutor-welcome-start">¡Comenzar!</button>
        </div>
      `;
      document.body.appendChild(this.welcomeModal);
    }

    isMenuOpen() { return this.menuCard.style.display !== 'none'; }
    isWelcomeOpen() { return this.welcomeModal.style.display !== 'none'; }

    bindEvents() {
      this.fab.addEventListener('click', () => {
        if (this.isActive) { this.closeTutor(); return; }
        if (this.isMenuOpen()) { this.closeMenu(); return; }
        this.closeWelcome();
        this.openMenu();
      });

      this.overlay.addEventListener('click', () => {
        if (this.isWelcomeOpen()) this.closeWelcome();
        else if (this.isMenuOpen()) this.closeMenu();
        else if (this.isActive) this.closeTutor();
      });

      $('splash-tutor-close-btn').addEventListener('click', () => this.closeTutor());
      $('splash-tutor-prev-btn').addEventListener('click', () => this.prevStep());
      $('splash-tutor-next-btn').addEventListener('click', () => {
        if (this.finished) this.completeTutorial();
        else this.nextStep();
      });
      $('splash-tutor-menu-close').addEventListener('click', () => this.closeMenu());

      this.menuCard.addEventListener('click', (e) => {
        const item = e.target.closest('[data-tutor-flow]');
        if (!item) return;
        this.closeMenu();
        this.startTutorial(item.dataset.tutorFlow);
      });

      $('splash-tutor-welcome-start').addEventListener('click', () => {
        this.closeWelcome();
        this.startTutorial('full');
      });
      $('splash-tutor-welcome-skip').addEventListener('click', () => this.closeWelcome());

      this._onKey = (e) => {
        if (e.key !== 'Escape') return;
        if (this.isActive) this.closeTutor();
        else if (this.isMenuOpen()) this.closeMenu();
        else if (this.isWelcomeOpen()) this.closeWelcome();
      };
      this._onScroll = () => {
        if (!this.isActive || this.finished || !this.activeElement || this._frame) return;
        this._frame = requestAnimationFrame(() => { this._frame = 0; this.layout(false); });
        this.later(() => this.layout(false), 220);
      };
      this._onResize = () => {
        if (!this.isActive || this.finished || !this.activeElement) return;
        this.dock = null;
        this.layout(true);
      };
      document.addEventListener('keydown', this._onKey);
      window.addEventListener('resize', this._onResize, { passive: true });
      window.addEventListener('orientationchange', this._onResize, { passive: true });
      window.addEventListener('scroll', this._onScroll, { passive: true });
    }

    maybeShowWelcome() {
      if (this._welcomeTimer) return;
      if (localStorage.getItem('splash_tutor_completed') === 'true' || localStorage.getItem('splash_tutor_welcome_seen') === 'true') return;
      this._welcomeTimer = this.later(() => {
        this._welcomeTimer = 0;
        if (!this.isOperariosPage() || this.isActive || this.isMenuOpen()) return;
        if (localStorage.getItem('splash_tutor_completed') === 'true' || localStorage.getItem('splash_tutor_welcome_seen') === 'true') return;
        localStorage.setItem('splash_tutor_welcome_seen', 'true');
        this.overlay.classList.add('is-active');
        this.welcomeModal.style.display = 'block';
      }, 900);
    }

    closeWelcome() {
      this.welcomeModal.style.display = 'none';
      localStorage.setItem('splash_tutor_welcome_seen', 'true');
      if (!this.isActive && !this.isMenuOpen()) this.overlay.classList.remove('is-active');
    }

    destroy() {
      if (this._observer) this._observer.disconnect();
      this._timers.forEach(clearTimeout);
      this._timers.clear();
      if (this._frame) cancelAnimationFrame(this._frame);
      clearInterval(this._watch);
      document.removeEventListener('keydown', this._onKey);
      window.removeEventListener('resize', this._onResize);
      window.removeEventListener('orientationchange', this._onResize);
      window.removeEventListener('scroll', this._onScroll);
      this.closeTutor();
    }

    openMenu() {
      this.menuCard.style.display = 'block';
      this.overlay.classList.add('is-active');
    }

    closeMenu() {
      this.menuCard.style.display = 'none';
      if (!this.isActive && !this.isWelcomeOpen()) this.overlay.classList.remove('is-active');
    }

    // `flow` acepta el nombre de un tema, una lista de ids o (compatibilidad) un índice del tutorial completo.
    startTutorial(flow = 'full') {
      let ids = FLOWS.full;
      let from = 0;
      this.flowName = 'full';
      if (typeof flow === 'number') {
        from = flow;
      } else if (Array.isArray(flow)) {
        ids = flow;
        this.flowName = 'custom';
      } else if (FLOWS[flow]) {
        ids = FLOWS[flow];
        this.flowName = flow;
      }
      this.flow = ids.filter((id) => STEPS[id]);
      this.closeWelcome();
      this.closeMenu();
      this.isActive = true;
      this.finished = false;
      document.body.classList.add('splash-tutor-running');
      document.body.classList.remove('splash-tutor-finale');
      if (this.fab) this.fab.style.display = 'none';
      this.overlay.classList.add('is-active');
      this.spotlight.classList.add('is-active');
      this.stage.style.display = 'flex';
      this.goToStep(from, 1);
      // Fuentes, imágenes o animaciones pueden mover el elemento después del primer cálculo.
      clearInterval(this._watch);
      this._lastRect = '';
      this._watch = setInterval(() => {
        const el = this.activeElement;
        if (!this.isActive || this.finished || !el) return;
        const r = el.getBoundingClientRect();
        const key = [r.top, r.left, r.width, r.height, window.innerWidth, window.innerHeight].map(Math.round).join(',');
        if (key === this._lastRect) return;
        this._lastRect = key;
        this.layout(false);
      }, 250);
    }

    isUsable(el) {
      if (!el || !el.isConnected || el.closest('[hidden]')) return false;
      const style = getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden';
    }

    // Avanza en la dirección pedida saltando los pasos cuyo elemento no existe o está oculto.
    goToStep(index, direction = 1) {
      for (let i = index; i >= 0 && i < this.flow.length; i += direction) {
        const step = STEPS[this.flow[i]];
        try { step.view(); } catch (_) { /* la vista es un apoyo; el paso se valida con el elemento */ }
        const el = document.querySelector(step.selector);
        if (!this.isUsable(el)) continue;

        this.currentStepIndex = i;
        this.activeElement = el;
        this.dock = null;
        this.stage.classList.remove('is-finale');
        this.stage.style.transform = '';
        this.updateDialogContent(step, i);
        this.layout(true);
        this.later(() => { if (this.isActive && this.activeElement === el) this.layout(false); }, 380);
        const next = $('splash-tutor-next-btn');
        if (next) try { next.focus({ preventScroll: true }); } catch (_) { /* foco opcional */ }
        return;
      }
      if (direction > 0) this.finishTutorial();
    }

    placeSpotlight(rect) {
      const pad = 8;
      this.spotlight.style.top = `${Math.max(0, rect.top - pad)}px`;
      this.spotlight.style.left = `${Math.max(0, rect.left - pad)}px`;
      this.spotlight.style.width = `${rect.width + pad * 2}px`;
      this.spotlight.style.height = `${rect.height + pad * 2}px`;
    }

    // Coloca resaltado y diálogo. En pantallas chicas el diálogo se ancla arriba o abajo,
    // del lado contrario al elemento, y se desplaza la página para que ambos queden a la vista.
    layout(adjustScroll) {
      const el = this.activeElement;
      if (!this.isActive || this.finished || !el) return;
      let rect = el.getBoundingClientRect();
      const vpW = window.innerWidth;
      const vpH = window.innerHeight;
      const compact = vpW <= COMPACT_WIDTH;
      this.stage.classList.toggle('is-compact', compact);
      const stageRect = this.stage.getBoundingClientRect();
      const stageH = stageRect.height || 240;
      const stageW = stageRect.width || Math.min(vpW - 20, 420);
      const margin = 12;
      const pad = 8;

      const anchorDock = (side) => {
        this.dock = side;
        this.stage.classList.toggle('is-docked-top', side === 'top');
        this.stage.classList.toggle('is-docked-bottom', side === 'bottom');
      };

      if (compact || (vpH - rect.bottom - pad - margin < stageH && rect.top - pad - margin < stageH)) {
        if (!this.dock) anchorDock(rect.top + rect.height / 2 > vpH / 2 ? 'top' : 'bottom');
        if (adjustScroll) {
          const freeTop = this.dock === 'top' ? stageH + margin * 2 : margin;
          const freeBottom = this.dock === 'top' ? vpH - margin : vpH - stageH - margin * 2;
          const freeHeight = freeBottom - freeTop;
          let delta = 0;
          if (rect.top < freeTop || rect.bottom > freeBottom) {
            delta = rect.height < freeHeight ? rect.top - (freeTop + (freeHeight - rect.height) / 2) : rect.top - freeTop;
          }
          if (Math.abs(delta) > 1) {
            try { window.scrollBy({ top: delta, behavior: 'smooth' }); } catch (_) { /* sin scroll programático */ }
            rect = { top: rect.top - delta, left: rect.left, width: rect.width, height: rect.height, bottom: rect.bottom - delta, right: rect.right };
          }
        }
        this.placeSpotlight(rect);
        const onRight = rect.left + rect.width / 2 > vpW / 2;
        this.stage.classList.toggle('is-reversed', !onRight);
        const img = $('splash-tutor-char-img');
        if (img) img.classList.toggle('is-flipped', !onRight);
        return;
      }

      this.dock = null;
      this.stage.classList.remove('is-docked-top', 'is-docked-bottom');
      if (adjustScroll && typeof el.scrollIntoView === 'function') {
        try { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (_) { /* opcional */ }
      }
      this.placeSpotlight(rect);

      const below = vpH - rect.bottom - pad - margin >= stageH;
      const top = below ? rect.bottom + pad + margin : rect.top - pad - margin - stageH;
      const onRight = rect.left + rect.width / 2 > vpW / 2;
      const left = onRight ? rect.left - stageW + rect.width : rect.left;
      this.stage.classList.toggle('is-reversed', !onRight);
      const img = $('splash-tutor-char-img');
      if (img) img.classList.toggle('is-flipped', !onRight);
      this.stage.style.top = `${Math.max(margin, Math.min(vpH - stageH - margin, top))}px`;
      this.stage.style.left = `${Math.max(margin, Math.min(vpW - stageW - margin, left))}px`;
    }

    updateDialogContent(step, index) {
      const total = this.flow.length;
      $('splash-tutor-step-pill').textContent = `Paso ${index + 1} de ${total}`;
      $('splash-tutor-title').textContent = step.title;
      $('splash-tutor-text').textContent = step.text;
      $('splash-tutor-prev-btn').style.display = index > 0 ? 'inline-block' : 'none';
      $('splash-tutor-next-btn').textContent = index === total - 1 ? '🎉 Finalizar' : 'Siguiente →';
    }

    nextStep() {
      this.goToStep(this.currentStepIndex + 1, 1);
    }

    prevStep() {
      this.goToStep(this.currentStepIndex - 1, -1);
    }

    finishTutorial() {
      this.finished = true;
      this.activeElement = null;
      this.spotlight.classList.remove('is-active');
      document.body.classList.add('splash-tutor-finale');
      const full = this.flowName === 'full';
      $('splash-tutor-step-pill').textContent = '¡Completado!';
      $('splash-tutor-title').textContent = full ? '¡Perfecto! 🎉' : '¡Listo! 🎉';
      $('splash-tutor-text').textContent = full
        ? 'Ya sabes cómo registrar y reportar un servicio en SPLASH. Cuando tengas dudas, solo pulsa la burbuja ❓.'
        : 'Cuando necesites otra ayuda, pulsa la burbuja ❓ y elige el tema.';
      $('splash-tutor-prev-btn').style.display = 'none';
      $('splash-tutor-next-btn').textContent = 'Entendido';
      this.stage.classList.remove('is-docked-top', 'is-docked-bottom');
      this.stage.classList.add('is-finale');
      this.stage.classList.remove('is-reversed');
    }

    completeTutorial() {
      if (this.flowName === 'full') localStorage.setItem('splash_tutor_completed', 'true');
      this.closeTutor();
    }

    closeTutor() {
      clearInterval(this._watch);
      this.isActive = false;
      this.finished = false;
      this.activeElement = null;
      this.dock = null;
      document.body.classList.remove('splash-tutor-running', 'splash-tutor-finale');
      this.overlay.classList.remove('is-active');
      this.spotlight.classList.remove('is-active');
      this.stage.style.display = 'none';
      this.stage.style.transform = '';
      this.stage.classList.remove('is-finale', 'is-docked-top', 'is-docked-bottom');
      this.closeMenu();
      this.syncVisibility();
    }
  }

  function start() {
    window.splashTutor = new SplashTutor();
  }

  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start);
})();
