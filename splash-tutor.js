/**
 * SPLASH Sede Las Flores - Sistema de Tutor Interactivo
 * Asistente visual con personaje, spotlight dinámico y menú de ayuda rápida
 */

(function () {
  'use strict';

  // Configuración de los pasos del tutorial según requerimientos
  const TUTOR_STEPS = [
    {
      id: 'step-open-report',
      selector: '#open-service-report',
      title: 'Reportar servicio',
      text: 'Comencemos por aquí. Pulsa este botón para registrar un nuevo servicio.',
      onBefore: () => {
        const menu = document.getElementById('worker-menu');
        const panel = document.getElementById('service-report-panel');
        if (menu) menu.hidden = false;
        if (panel) panel.hidden = true;
      }
    },
    {
      id: 'step-operator',
      selector: '#sr-operator-input',
      title: 'Operario',
      text: 'Aquí podrás comprobar qué operario está realizando el reporte. Si necesitas cambiarlo, puedes editar el nombre directamente.',
      onBefore: () => {
        const menu = document.getElementById('worker-menu');
        const panel = document.getElementById('service-report-panel');
        if (menu) menu.hidden = true;
        if (panel) panel.hidden = false;
      }
    },
    {
      id: 'step-service-num',
      selector: '#sr-service-pills',
      title: 'Número de servicio',
      text: 'Selecciona qué servicio estás registrando. Tienes accesos rápidos desde el 1er servicio hasta el 7mo con un solo toque.',
      onBefore: () => {
        const panel = document.getElementById('service-report-panel');
        if (panel) panel.hidden = false;
      }
    },
    {
      id: 'step-amount',
      selector: '#sr-amount-pills',
      title: 'Monto del servicio',
      text: 'Aquí indica cuánto se cobró por el servicio. Puedes elegir montos rápidos como S/100, S/120 o S/150, o escribir el monto exacto.',
      onBefore: () => {
        const panel = document.getElementById('service-report-panel');
        if (panel) panel.hidden = false;
      }
    },
    {
      id: 'step-payment-method',
      selector: '#sr-payment-methods',
      title: 'Método de pago',
      text: 'Selecciona cómo se realizó el pago: Yape, Plin, Tarjeta o Efectivo.',
      onBefore: () => {
        const panel = document.getElementById('service-report-panel');
        if (panel) panel.hidden = false;
      }
    },
    {
      id: 'step-photo',
      selector: '#sr-photo-actions',
      title: 'Foto del comprobante / dinero',
      text: 'Puedes tomar una foto del billete o dinero con "Abrir cámara", o usar "Subir foto" si ya la tienes en el teléfono.',
      onBefore: () => {
        const panel = document.getElementById('service-report-panel');
        if (panel) panel.hidden = false;
      }
    },
    {
      id: 'step-observation',
      selector: '#sr-observation-input',
      title: 'Observación opcional',
      text: 'Este campo es opcional. Puedes escribir información adicional sobre el servicio, por ejemplo: (se dio vuelto en yape).',
      onBefore: () => {
        const panel = document.getElementById('service-report-panel');
        if (panel) panel.hidden = false;
      }
    },
    {
      id: 'step-submit',
      selector: '#sr-submit-whatsapp',
      title: 'Mandar al grupo SPHASH SEDE LAS FLORES',
      text: 'Cuando hayas terminado, revisa los datos y pulsa aquí. Se guardará en la caja de administración y se enviará con foto y formato listo a WhatsApp.',
      onBefore: () => {
        const panel = document.getElementById('service-report-panel');
        if (panel) panel.hidden = false;
      }
    }
  ];

  class SplashTutor {
    constructor() {
      this.currentStepIndex = -1;
      this.isActive = false;
      this.activeElement = null;
      this.rafId = null;

      this.initDom();
      this.bindEvents();
      this.checkFirstTimeVisit();
    }

    initDom() {
      // 1. Burbuja de ayuda flotante fija
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

      // 2. Overlay oscuro
      this.overlay = document.createElement('div');
      this.overlay.id = 'splash-tutor-overlay';
      this.overlay.className = 'splash-tutor-overlay';
      document.body.appendChild(this.overlay);

      // 3. Spotlight dinámico
      this.spotlight = document.createElement('div');
      this.spotlight.id = 'splash-tutor-spotlight';
      this.spotlight.className = 'splash-tutor-spotlight';
      document.body.appendChild(this.spotlight);

      // 4. Escenario del personaje y diálogo
      this.stage = document.createElement('div');
      this.stage.id = 'splash-tutor-stage';
      this.stage.className = 'splash-tutor-stage';
      this.stage.style.display = 'none';
      this.stage.innerHTML = `
        <div class="splash-tutor-char-wrap" id="splash-tutor-char-wrap">
          <img class="splash-tutor-char-img" id="splash-tutor-char-img" src="tutor-character.png" alt="Tutor SPLASH">
        </div>
        <div class="splash-tutor-bubble" id="splash-tutor-bubble">
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

      // 5. Menú de ayuda rápida
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
          <button type="button" class="splash-tutor-menu-item" data-tutor-jump="0">
            <span class="splash-tutor-menu-item-icon">📋</span>
            <span>Reportar un servicio</span>
          </button>
          <button type="button" class="splash-tutor-menu-item" data-tutor-jump="3">
            <span class="splash-tutor-menu-item-icon">💰</span>
            <span>Registrar monto y pago</span>
          </button>
          <button type="button" class="splash-tutor-menu-item" data-tutor-jump="5">
            <span class="splash-tutor-menu-item-icon">📷</span>
            <span>Subir comprobante o foto</span>
          </button>
          <button type="button" class="splash-tutor-menu-item" data-tutor-jump="6">
            <span class="splash-tutor-menu-item-icon">📝</span>
            <span>Agregar observación</span>
          </button>
          <button type="button" class="splash-tutor-menu-item" data-tutor-jump="0" style="background:#eef7f9;border-color:#008c95;color:#00757d">
            <span class="splash-tutor-menu-item-icon">📚</span>
            <span>Ver tutorial completo</span>
          </button>
        </div>
        <div class="splash-tutor-menu-footer">
          <small style="color:#627d8d;font-size:0.75rem">SPLASH Sede Las Flores</small>
          <button type="button" class="splash-tutor-btn-secondary" id="splash-tutor-menu-close" style="padding:4px 10px;font-size:0.8rem">Cerrar</button>
        </div>
      `;
      document.body.appendChild(this.menuCard);

      // 6. Modal de bienvenida (primera visita)
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

    bindEvents() {
      // Clic en la burbuja ❓
      this.fab.addEventListener('click', () => {
        if (this.isActive) {
          this.closeTutor();
          return;
        }
        if (this.menuCard.style.display !== 'none') {
          this.closeMenu();
          return;
        }
        // Si ya completó el tutorial antes, abre el menú de opciones rápidas
        if (localStorage.getItem('splash_tutor_completed') === 'true') {
          this.openMenu();
        } else {
          this.startTutorial(0);
        }
      });

      // Overlay clic: cierra menú o diálogo
      this.overlay.addEventListener('click', () => {
        if (this.menuCard.style.display !== 'none') {
          this.closeMenu();
        } else if (this.isActive) {
          this.closeTutor();
        }
      });

      // Botón cerrar en diálogo
      const closeBtn = document.getElementById('splash-tutor-close-btn');
      if (closeBtn) closeBtn.addEventListener('click', () => this.closeTutor());

      // Botón Siguiente
      const nextBtn = document.getElementById('splash-tutor-next-btn');
      if (nextBtn) nextBtn.addEventListener('click', () => this.nextStep());

      // Botón Anterior
      const prevBtn = document.getElementById('splash-tutor-prev-btn');
      if (prevBtn) prevBtn.addEventListener('click', () => this.prevStep());

      // Cerrar menú rápido
      const menuClose = document.getElementById('splash-tutor-menu-close');
      if (menuClose) menuClose.addEventListener('click', () => this.closeMenu());

      // Opciones del menú rápido
      this.menuCard.addEventListener('click', (e) => {
        const item = e.target.closest('[data-tutor-jump]');
        if (!item) return;
        const jumpIdx = parseInt(item.dataset.tutorJump, 10);
        this.closeMenu();
        this.startTutorial(jumpIdx);
      });

      // Botones modal de bienvenida
      const welcomeStart = document.getElementById('splash-tutor-welcome-start');
      if (welcomeStart) {
        welcomeStart.addEventListener('click', () => {
          this.welcomeModal.style.display = 'none';
          this.overlay.classList.remove('is-active');
          this.startTutorial(0);
        });
      }

      const welcomeSkip = document.getElementById('splash-tutor-welcome-skip');
      if (welcomeSkip) {
        welcomeSkip.addEventListener('click', () => {
          this.welcomeModal.style.display = 'none';
          this.overlay.classList.remove('is-active');
          localStorage.setItem('splash_tutor_welcome_seen', 'true');
        });
      }

      // Reposicionamiento dinámico en scroll y resize
      const updatePosition = () => {
        if (this.isActive && this.activeElement) {
          this.positionSpotlightAndStage(this.activeElement);
        }
      };

      window.addEventListener('resize', updatePosition, { passive: true });
      window.addEventListener('scroll', updatePosition, { passive: true });
    }

    checkFirstTimeVisit() {
      // Si el usuario entra por primera vez y está en la vista de operarios logueado
      const completed = localStorage.getItem('splash_tutor_completed');
      const seen = localStorage.getItem('splash_tutor_welcome_seen');

      // Esperar 1.2 segundos para no invadir de golpe
      this._welcomeTimer = setTimeout(() => {
        const workerHome = document.getElementById('worker-home');
        const isLoggedIn = workerHome && !workerHome.hidden;

        if (!completed && !seen && isLoggedIn) {
          this.overlay.classList.add('is-active');
          this.welcomeModal.style.display = 'block';
        }
      }, 1200);
    }

    destroy() {
      if (this._welcomeTimer) clearTimeout(this._welcomeTimer);
      this.closeTutor();
    }

    openMenu() {
      this.menuCard.style.display = 'block';
      this.overlay.classList.add('is-active');
    }

    closeMenu() {
      this.menuCard.style.display = 'none';
      if (!this.isActive) {
        this.overlay.classList.remove('is-active');
      }
    }

    startTutorial(fromIndex = 0) {
      this.isActive = true;
      this.overlay.classList.add('is-active');
      this.spotlight.classList.add('is-active');
      this.stage.style.display = 'flex';
      this.goToStep(fromIndex);
    }

    goToStep(index) {
      if (index < 0 || index >= TUTOR_STEPS.length) {
        this.finishTutorial();
        return;
      }

      this.currentStepIndex = index;
      const step = TUTOR_STEPS[index];

      // Ejecutar preparación de la vista (ej. abrir panel de servicios si está oculto)
      if (typeof step.onBefore === 'function') {
        step.onBefore();
      }

      // Buscar el elemento objetivo
      const el = document.querySelector(step.selector);
      if (!el) {
        console.warn(`Elemento no encontrado para el tutor: ${step.selector}`);
        // Si no existe, avanzar al siguiente
        this.goToStep(index + 1);
        return;
      }

      this.activeElement = el;
      this.updateDialogContent(step, index);
      this.positionSpotlightAndStage(el);

      // 1. Scroll suave centrado hacia el elemento
      if (typeof el.scrollIntoView === 'function') {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }

      // Reajustar tras el scroll para máxima precisión
      setTimeout(() => {
        if (this.isActive && this.activeElement === el) {
          this.positionSpotlightAndStage(el);
        }
      }, 260);
    }

    positionSpotlightAndStage(el) {
      const rect = el.getBoundingClientRect();
      const pad = 8;

      // Coordenadas del spotlight alrededor del botón/elemento
      const top = Math.max(0, rect.top - pad);
      const left = Math.max(0, rect.left - pad);
      const width = rect.width + pad * 2;
      const height = rect.height + pad * 2;

      this.spotlight.style.top = `${top}px`;
      this.spotlight.style.left = `${left}px`;
      this.spotlight.style.width = `${width}px`;
      this.spotlight.style.height = `${height}px`;

      // Posicionamiento inteligente del personaje y la burbuja de diálogo
      const vpWidth = window.innerWidth;
      const vpHeight = window.innerHeight;
      const charImg = document.getElementById('splash-tutor-char-img');

      // Determinar si colocar arriba o abajo del elemento
      const spaceBelow = vpHeight - (rect.bottom + pad);
      const spaceAbove = rect.top - pad;
      const placeBelow = spaceBelow > 230 || spaceBelow > spaceAbove;

      // Determinar si colocar hacia la izquierda o hacia la derecha
      const isElementOnRight = rect.left + rect.width / 2 > vpWidth / 2;

      let stageTop = 0;
      let stageLeft = 16;

      if (placeBelow) {
        stageTop = Math.min(vpHeight - 220, rect.bottom + pad + 16);
      } else {
        stageTop = Math.max(16, rect.top - pad - 230);
      }

      if (isElementOnRight) {
        // Elemento a la derecha -> personaje se ubica a la izquierda y señala hacia la derecha
        stageLeft = Math.max(12, Math.min(vpWidth - 380, rect.left - 240));
        this.stage.classList.remove('is-reversed');
        if (charImg) charImg.classList.remove('is-flipped');
      } else {
        // Elemento a la izquierda -> personaje se ubica a la derecha y señala hacia la izquierda
        stageLeft = Math.max(12, Math.min(vpWidth - 380, rect.right + 10));
        this.stage.classList.add('is-reversed');
        if (charImg) charImg.classList.add('is-flipped');
      }

      this.stage.style.top = `${stageTop}px`;
      this.stage.style.left = `${stageLeft}px`;
    }

    updateDialogContent(step, index) {
      const pill = document.getElementById('splash-tutor-step-pill');
      const title = document.getElementById('splash-tutor-title');
      const text = document.getElementById('splash-tutor-text');
      const prevBtn = document.getElementById('splash-tutor-prev-btn');
      const nextBtn = document.getElementById('splash-tutor-next-btn');

      if (pill) pill.textContent = `Paso ${index + 1} de ${TUTOR_STEPS.length}`;
      if (title) title.textContent = step.title;
      if (text) text.textContent = step.text;

      if (prevBtn) {
        prevBtn.style.display = index > 0 ? 'inline-block' : 'none';
      }

      if (nextBtn) {
        if (index === TUTOR_STEPS.length - 1) {
          nextBtn.textContent = '🎉 Finalizar';
        } else {
          nextBtn.textContent = 'Siguiente →';
        }
      }
    }

    nextStep() {
      this.goToStep(this.currentStepIndex + 1);
    }

    prevStep() {
      this.goToStep(this.currentStepIndex - 1);
    }

    finishTutorial() {
      // Quitar spotlight y oscurecimiento
      this.spotlight.classList.remove('is-active');

      const pill = document.getElementById('splash-tutor-step-pill');
      const title = document.getElementById('splash-tutor-title');
      const text = document.getElementById('splash-tutor-text');
      const prevBtn = document.getElementById('splash-tutor-prev-btn');
      const nextBtn = document.getElementById('splash-tutor-next-btn');

      if (pill) pill.textContent = '¡Completado!';
      if (title) title.textContent = '¡Perfecto! 🎉';
      if (text) text.textContent = 'Ya sabes cómo registrar y reportar un servicio en SPLASH. Cuando tengas dudas, solo pulsa la burbuja ❓.';

      if (prevBtn) prevBtn.style.display = 'none';
      if (nextBtn) {
        nextBtn.textContent = 'Entendido';
        nextBtn.onclick = () => {
          this.closeTutor();
          localStorage.setItem('splash_tutor_completed', 'true');
        };
      }

      // Centrar el personaje en la pantalla para la celebración final
      this.stage.style.top = '40%';
      this.stage.style.left = '50%';
      this.stage.style.transform = 'translate(-50%, -50%)';
      this.stage.classList.remove('is-reversed');
    }

    closeTutor() {
      this.isActive = false;
      this.activeElement = null;
      this.overlay.classList.remove('is-active');
      this.spotlight.classList.remove('is-active');
      this.stage.style.display = 'none';
      this.stage.style.transform = '';
      this.closeMenu();
    }
  }

  // Inicializar cuando el DOM esté listo
  if (document.body) {
    window.splashTutor = new SplashTutor();
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      window.splashTutor = new SplashTutor();
    });
  }
})();
