// ============================================================
// WZMALLAS — Cookie Consent Manager
// Ley 25.326 Argentina / mejores prácticas GDPR
// Categorías: essential · functional · analytics · marketing
// ============================================================

window.CookieConsent = (function () {

  const KEY     = 'wz_cookie_consent';
  const VERSION = '1';

  /* ── Categorías ─────────────────────────────────────────── */
  const CATS = {
    essential: {
      label:    'Esenciales',
      desc:     'Necesarias para el funcionamiento del sitio: carrito de compras, sesión e inicio de usuario. No pueden desactivarse.',
      required: true,
    },
    functional: {
      label:    'Funcionales',
      desc:     'Guardan preferencias entre sesiones: cupones guardados, zona de envío, últimos productos visitados.',
      required: false,
    },
    analytics: {
      label:    'Analíticas',
      desc:     'Miden visitas y navegación para ayudarnos a mejorar el sitio. Los datos son anónimos y agregados.',
      required: false,
    },
    marketing: {
      label:    'Publicidad',
      desc:     'Permiten mostrarte anuncios personalizados en otras plataformas como Meta o Google.',
      required: false,
    },
  };

  /* ── Storage ─────────────────────────────────────────────── */
  function _load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      const p = JSON.parse(raw);
      return p.v === VERSION ? p : null;
    } catch { return null; }
  }

  function _persist(cats) {
    try {
      localStorage.setItem(KEY, JSON.stringify({
        v: VERSION, cats, ts: Date.now(),
      }));
    } catch {}
  }

  function _dispatch(cats) {
    window.dispatchEvent(new CustomEvent('wz:consent', { detail: cats }));
  }

  /* ── API pública ─────────────────────────────────────────── */
  /** ¿El usuario aceptó esta categoría? */
  function hasConsent(cat) {
    if (cat === 'essential') return true;
    const p = _load();
    return p ? !!p.cats?.[cat] : false;
  }

  /** ¿Ya tomó alguna decisión? */
  function hasDecided() {
    return !!_load();
  }

  function acceptAll() {
    const cats = {};
    Object.keys(CATS).forEach(k => cats[k] = true);
    _persist(cats);
    _dispatch(cats);
    _hideBanner();
    _closeModal();
    _onFunctionalChange(cats.functional);
  }

  function rejectAll() {
    const cats = {};
    Object.keys(CATS).forEach(k => cats[k] = k === 'essential');
    _persist(cats);
    _dispatch(cats);
    _hideBanner();
    _closeModal();
    _onFunctionalChange(false);
  }

  function openModal() {
    if (document.getElementById('wz-cmodal')) return;
    const p       = _load();
    const current = p?.cats || {};

    const rows = Object.entries(CATS).map(([id, cat]) => {
      const on = cat.required
        ? true
        : (current[id] !== undefined ? current[id] : false);
      return `
        <div class="wzc-row">
          <div class="wzc-info">
            <strong>${cat.label}${cat.required ? '<span class="wzc-req"> — siempre activas</span>' : ''}</strong>
            <span>${cat.desc}</span>
          </div>
          <label class="wzc-toggle" title="${cat.required ? 'Siempre activas' : (on ? 'Activa' : 'Inactiva')}">
            <input type="checkbox" id="wzc-${id}"
              ${on ? 'checked' : ''}
              ${cat.required ? 'disabled' : ''}>
            <span class="wzc-slider"></span>
          </label>
        </div>`;
    }).join('');

    document.body.insertAdjacentHTML('beforeend', `
      <div id="wz-coverlay" onclick="CookieConsent.closeModal()"></div>
      <div id="wz-cmodal" role="dialog" aria-modal="true" aria-label="Configurar cookies">
        <div class="wzc-head">
          <h2>Configurar cookies</h2>
          <button class="wzc-x" onclick="CookieConsent.closeModal()" aria-label="Cerrar">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="3" y1="3" x2="13" y2="13"/><line x1="13" y1="3" x2="3" y2="13"/>
            </svg>
          </button>
        </div>
        <p class="wzc-intro">
          Podés activar o desactivar cada categoría. Las cookies esenciales siempre están activas porque el sitio no puede funcionar sin ellas.
          Tu elección se guarda y podés cambiarla cuando quieras desde el pie de la página.
        </p>
        <div class="wzc-rows">${rows}</div>
        <div class="wzc-foot">
          <button class="wzc-btn-save" onclick="CookieConsent._saveModal()">Guardar preferencias</button>
          <button class="wzc-btn-all"  onclick="CookieConsent.acceptAll()">Aceptar todo</button>
        </div>
        <p class="wzc-legal">
          Cumplimos con la <strong>Ley 25.326</strong> de Protección de Datos Personales (Argentina) y la Disposición 5/2020 de la AAIP.
        </p>
      </div>`);
  }

  function closeModal() { _closeModal(); }

  function _saveModal() {
    const cats = {};
    Object.keys(CATS).forEach(k => {
      const el = document.getElementById('wzc-' + k);
      cats[k]  = el ? el.checked : CATS[k].required;
    });
    cats.essential = true;
    _persist(cats);
    _dispatch(cats);
    _closeModal();
    _hideBanner();
    _onFunctionalChange(cats.functional);
  }

  /* ── Efecto funcional: limpiar storage si se rechaza ────── */
  function _onFunctionalChange(allowed) {
    if (!allowed) {
      // Si revocan funcional → eliminar cupón persistido
      try { localStorage.removeItem('wz_promo'); } catch {}
    }
  }

  /* ── UI helpers ──────────────────────────────────────────── */
  function _hideBanner() {
    document.getElementById('wz-cbanner')?.remove();
  }

  function _closeModal() {
    document.getElementById('wz-cmodal')?.remove();
    document.getElementById('wz-coverlay')?.remove();
  }

  /* ── Banner ──────────────────────────────────────────────── */
  function init() {
    if (_load()) return;   // Ya decidió
    _injectStyles();

    // Pequeño delay para que no flashee con el render inicial
    setTimeout(() => {
      if (document.getElementById('wz-cbanner')) return;
      document.body.insertAdjacentHTML('beforeend', `
        <div id="wz-cbanner" role="dialog" aria-live="polite" aria-label="Aviso de cookies">
          <p class="wzb-title">🍪 Usamos cookies</p>
          <p class="wzb-desc">
            Usamos cookies propias y de terceros para mejorar tu experiencia.
            Podés aceptar todas, rechazar las no esenciales o personalizar tu elección.
            <a href="./politica-cookies.html" class="wzb-link" target="_blank">Ver política</a>
          </p>
          <div class="wzb-btns">
            <div class="wzb-row-top">
              <button class="wzb-accept" onclick="CookieConsent.acceptAll()">Aceptar todo</button>
              <button class="wzb-reject" onclick="CookieConsent.rejectAll()">Solo esenciales</button>
            </div>
            <button class="wzb-custom" onclick="CookieConsent.openModal()">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/></svg>
              Personalizar opciones
            </button>
          </div>
        </div>`);
    }, 900);
  }

  /* ── Estilos ─────────────────────────────────────────────── */
  function _injectStyles() {
    if (document.getElementById('wz-css-cookies')) return;
    document.head.insertAdjacentHTML('beforeend', `<style id="wz-css-cookies">

      /* ═══════════════════════════════
         BANNER — abajo a la derecha
         ═══════════════════════════════ */
      #wz-cbanner {
        position: fixed;
        bottom: 20px; right: 20px;
        width: 320px;
        background: #fff;
        border: 1px solid #E5E7EB;
        border-radius: 14px;
        padding: 20px;
        box-shadow: 0 10px 48px rgba(0,0,0,0.15);
        z-index: 9990;
        font-family: system-ui, -apple-system, 'Inter', sans-serif;
        animation: wzb-slide .35s cubic-bezier(.16,1,.3,1);
      }
      @keyframes wzb-slide {
        from { opacity:0; transform:translateY(20px); }
        to   { opacity:1; transform:translateY(0); }
      }
      @media (max-width: 380px) {
        #wz-cbanner { left:12px; right:12px; width:auto; bottom:10px; }
      }
      .wzb-title {
        font-size: 15px; font-weight: 700; color: #111;
        margin: 0 0 8px;
      }
      .wzb-desc {
        font-size: 12px; color: #6B7280; line-height: 1.55;
        margin: 0 0 16px;
      }
      .wzb-link { color: #3483FA; text-decoration: none; }
      .wzb-link:hover { text-decoration: underline; }

      .wzb-btns { display: flex; flex-direction: column; gap: 7px; }
      .wzb-row-top { display: flex; gap: 7px; }

      /* Igual protagonismo: ambos misma altura y peso visual */
      .wzb-accept {
        flex: 1; padding: 10px 8px;
        background: #3483FA; color: #fff; border: none;
        border-radius: 8px; font-size: 13px; font-weight: 700;
        cursor: pointer; transition: background .15s;
      }
      .wzb-accept:hover { background: #2968c8; }
      .wzb-reject {
        flex: 1; padding: 10px 8px;
        background: #F3F4F6; color: #374151;
        border: 1px solid #E5E7EB; border-radius: 8px;
        font-size: 13px; font-weight: 600;
        cursor: pointer; transition: border-color .15s, color .15s;
      }
      .wzb-reject:hover { border-color: #374151; color: #111; }
      .wzb-custom {
        width: 100%; padding: 8px;
        background: none; color: #9CA3AF;
        border: none; border-radius: 8px;
        font-size: 12px; font-weight: 500;
        cursor: pointer; display: flex; align-items: center;
        justify-content: center; gap: 5px;
        transition: color .15s;
      }
      .wzb-custom:hover { color: #3483FA; }

      /* ═══════════════════════════════
         OVERLAY + MODAL personalizar
         ═══════════════════════════════ */
      #wz-coverlay {
        position: fixed; inset: 0;
        background: rgba(0,0,0,0.5);
        z-index: 9995;
        animation: wz-fade .2s ease;
      }
      @keyframes wz-fade { from{opacity:0} to{opacity:1} }

      #wz-cmodal {
        position: fixed;
        top: 50%; left: 50%;
        transform: translate(-50%, -50%);
        z-index: 9996;
        background: #fff;
        border-radius: 16px;
        padding: 28px 28px 24px;
        width: min(500px, calc(100vw - 24px));
        max-height: 88vh;
        overflow-y: auto;
        box-shadow: 0 24px 64px rgba(0,0,0,0.22);
        font-family: system-ui, -apple-system, 'Inter', sans-serif;
        animation: wzm-in .25s cubic-bezier(.16,1,.3,1);
      }
      @keyframes wzm-in {
        from { opacity:0; transform:translate(-50%,-48%); }
        to   { opacity:1; transform:translate(-50%,-50%); }
      }
      .wzc-head {
        display: flex; justify-content: space-between;
        align-items: center; margin-bottom: 14px;
      }
      .wzc-head h2 { font-size: 17px; font-weight: 700; color: #111; margin: 0; }
      .wzc-x {
        background: none; border: none; cursor: pointer;
        color: #9CA3AF; padding: 6px;
        border-radius: 8px; display: flex; align-items: center;
        transition: color .15s, background .15s;
      }
      .wzc-x:hover { color: #111; background: #F3F4F6; }

      .wzc-intro {
        font-size: 13px; color: #6B7280; line-height: 1.6;
        margin: 0 0 20px; padding-bottom: 18px;
        border-bottom: 1px solid #F3F4F6;
      }
      .wzc-rows { display: flex; flex-direction: column; }
      .wzc-row {
        display: flex; align-items: flex-start; gap: 16px;
        padding: 16px 0; border-bottom: 1px solid #F3F4F6;
      }
      .wzc-row:last-child { border-bottom: none; }
      .wzc-info { flex: 1; display: flex; flex-direction: column; gap: 4px; }
      .wzc-info strong { font-size: 13px; font-weight: 600; color: #111; }
      .wzc-req { font-weight: 400; color: #9CA3AF; font-size: 11px; }
      .wzc-info span { font-size: 12px; color: #6B7280; line-height: 1.55; }

      /* Toggle switch */
      .wzc-toggle {
        flex-shrink: 0; margin-top: 3px;
        position: relative; display: inline-block;
        width: 42px; height: 24px;
        cursor: pointer;
      }
      .wzc-toggle input { opacity:0; width:0; height:0; position:absolute; }
      .wzc-slider {
        position: absolute; inset: 0;
        background: #D1D5DB; border-radius: 24px;
        transition: background .2s;
      }
      .wzc-slider::before {
        content: ''; position: absolute;
        width: 18px; height: 18px; border-radius: 50%;
        background: #fff; top: 3px; left: 3px;
        transition: transform .2s;
        box-shadow: 0 1px 4px rgba(0,0,0,0.2);
      }
      .wzc-toggle input:checked + .wzc-slider { background: #3483FA; }
      .wzc-toggle input:checked + .wzc-slider::before { transform: translateX(18px); }
      .wzc-toggle input:disabled + .wzc-slider { background: #93C5FD; cursor: not-allowed; }
      .wzc-toggle input:disabled ~ * { cursor: not-allowed; }

      .wzc-foot {
        display: flex; gap: 8px; margin-top: 20px; flex-wrap: wrap;
      }
      .wzc-btn-save {
        flex: 1; padding: 10px 16px;
        background: #3483FA; color: #fff; border: none;
        border-radius: 8px; font-size: 13px; font-weight: 700;
        cursor: pointer; transition: background .15s;
      }
      .wzc-btn-save:hover { background: #2968c8; }
      .wzc-btn-all {
        flex: 1; padding: 10px 16px;
        background: #F9FAFB; color: #374151;
        border: 1px solid #E5E7EB; border-radius: 8px;
        font-size: 13px; font-weight: 600;
        cursor: pointer; transition: border-color .15s, color .15s;
      }
      .wzc-btn-all:hover { border-color: #3483FA; color: #3483FA; }

      .wzc-legal {
        font-size: 11px; color: #9CA3AF; line-height: 1.5;
        margin: 14px 0 0; text-align: center;
      }
    </style>`);
  }

  return {
    init, hasConsent, hasDecided,
    acceptAll, rejectAll,
    openModal, closeModal,
    // privadas expuestas para onclick inline
    _saveModal,
  };

})();
