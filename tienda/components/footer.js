function renderFooter() {
  return `
    <style>
      .footer {
        background: var(--text);
        color: rgba(255,255,255,0.75);
        padding: 48px 0 0;
        margin-top: 64px;
      }

      .footer-grid {
        display: grid;
        grid-template-columns: 2fr 1fr 1fr 1fr;
        gap: 40px;
        padding-bottom: 40px;
      }

      .footer-brand-name {
        font-family: var(--font-accent);
        font-size: 16px;
        font-weight: 700;
        color: #fff;
        letter-spacing: 0.04em;
        margin-bottom: 8px;
        display: block;
        text-decoration: none;
      }

      .footer-brand-desc {
        font-size: 13px;
        line-height: 1.6;
        color: rgba(255,255,255,0.55);
        margin-bottom: 20px;
        max-width: 240px;
      }

      .footer-social {
        display: flex;
        gap: 8px;
      }

      .footer-social-btn {
        width: 38px;
        height: 38px;
        display: flex;
        align-items: center;
        justify-content: center;
        border: 1px solid rgba(255,255,255,0.15);
        border-radius: var(--radius);
        color: rgba(255,255,255,0.65);
        text-decoration: none;
        transition: border-color 0.15s, color 0.15s, background 0.15s;
      }
      .footer-social-btn svg { display: block; }
      .footer-social-btn.ig:hover {
        border-color: #E1306C;
        color: #E1306C;
        background: rgba(225,48,108,0.08);
      }
      .footer-social-btn.wa:hover {
        border-color: #25D366;
        color: #25D366;
        background: rgba(37,211,102,0.08);
      }

      .footer-col-title {
        font-family: var(--font-accent);
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: #fff;
        margin-bottom: 16px;
      }

      .footer-links {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }

      .footer-links a {
        font-size: 13px;
        color: rgba(255,255,255,0.55);
        text-decoration: none;
        transition: color 0.15s;
      }
      .footer-links a:hover { color: rgba(255,255,255,0.9); }

      .footer-bottom {
        border-top: 1px solid rgba(255,255,255,0.08);
        padding: 20px 0;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        flex-wrap: wrap;
      }

      .footer-copy {
        font-size: 12px;
        color: rgba(255,255,255,0.4);
      }

      .footer-payments {
        display: flex;
        align-items: center;
        gap: 6px;
        flex-wrap: wrap;
      }

      .footer-pay-label {
        font-size: 11px;
        color: rgba(255,255,255,0.35);
        margin-right: 4px;
      }

      .footer-pay-badge {
        font-family: var(--font-accent);
        font-size: 10px;
        font-weight: 600;
        color: rgba(255,255,255,0.45);
        border: 1px solid rgba(255,255,255,0.12);
        border-radius: var(--radius-sm);
        padding: 3px 8px;
        white-space: nowrap;
      }

      /* ── Newsletter ── */
      .footer-news {
        border-top: 1px solid rgba(255,255,255,0.08);
        padding: 24px 0;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 24px;
        flex-wrap: wrap;
      }
      .footer-news-title {
        font-family: var(--font-accent);
        font-size: 15px;
        font-weight: 700;
        color: #fff;
        margin: 0 0 4px;
      }
      .footer-news-sub {
        font-size: 12px;
        color: rgba(255,255,255,0.45);
        margin: 0;
      }
      .footer-news-form {
        display: flex;
        gap: 8px;
        position: relative;
        flex: 1;
        max-width: 380px;
        min-width: 260px;
      }
      .footer-news-form input[type="email"] {
        flex: 1;
        min-width: 0;
        background: rgba(255,255,255,0.06);
        border: 1px solid rgba(255,255,255,0.15);
        border-radius: var(--radius);
        color: #fff;
        font-size: 13px;
        font-family: var(--font-body);
        padding: 10px 14px;
        transition: border-color 0.15s, background 0.15s;
      }
      .footer-news-form input[type="email"]::placeholder { color: rgba(255,255,255,0.35); }
      .footer-news-form input[type="email"]:focus {
        outline: none;
        border-color: var(--blue);
        background: rgba(255,255,255,0.1);
      }
      .footer-news-form button {
        background: var(--blue);
        color: #fff;
        border: none;
        border-radius: var(--radius);
        font-size: 13px;
        font-weight: 600;
        font-family: var(--font-accent);
        padding: 10px 18px;
        cursor: pointer;
        white-space: nowrap;
        transition: background 0.15s, opacity 0.15s;
      }
      .footer-news-form button:hover { background: var(--blue-dark); }
      .footer-news-form button:disabled { opacity: 0.6; cursor: default; }
      .footer-news-msg {
        flex-basis: 100%;
        font-size: 12px;
        margin: 8px 0 0;
        min-height: 0;
      }
      .footer-news-msg.ok  { color: #4ade80; }
      .footer-news-msg.err { color: #f87171; }

      @media (max-width: 768px) {
        .footer-grid {
          grid-template-columns: 1fr 1fr;
          gap: 32px;
        }
        .footer-news { flex-direction: column; align-items: flex-start; gap: 14px; }
        .footer-news-form { max-width: 100%; width: 100%; }
        .footer-brand { grid-column: 1 / -1; }
        .footer-bottom { flex-direction: column; align-items: flex-start; gap: 12px; }
      }

      @media (max-width: 480px) {
        .footer-grid { grid-template-columns: 1fr; }
      }

      /* ── Footer móvil compacto ── */
      @media (max-width: 600px) {
        .footer { margin-top: 40px; padding: 24px 0 0; }

        /* Brand: nombre + redes sociales en una sola línea */
        .footer-brand {
          display: flex;
          flex-direction: row;
          align-items: center;
          justify-content: space-between;
        }
        .footer-brand-desc { display: none; }
        .footer-brand-name { margin-bottom: 0; font-size: 14px; }
        .footer-social-btn { width: 32px; height: 32px; }

        /* Grid: 3 columnas para links (sobreescribe el 1fr de 480px) */
        .footer-grid {
          grid-template-columns: repeat(3, 1fr) !important;
          gap: 20px 8px !important;
          padding-bottom: 16px !important;
        }

        /* Títulos y links más compactos */
        .footer-col-title { font-size: 9px; letter-spacing: 0.05em; margin-bottom: 10px; }
        .footer-links { gap: 8px; }
        .footer-links a { font-size: 11px; line-height: 1.3; }

        /* Legal/AFIP row */
        .footer-legal-row {
          flex-direction: column !important;
          align-items: flex-start !important;
          gap: 10px !important;
          padding: 14px 0 !important;
        }
        .footer-legal-row p { font-size: 10px !important; line-height: 1.5 !important; }
        .footer-legal-row img { height: 28px !important; }

        /* Footer bottom */
        .footer-copy { font-size: 11px; }
        .footer-pay-label { display: none; }
        .footer-pay-badge { font-size: 9px; padding: 2px 5px; }
        .footer-payments { gap: 4px; }
      }
    </style>

    <footer class="footer">
      <div class="container">
        <div class="footer-grid">

          <div class="footer-brand">
            <a href="./index.html" class="footer-brand-name">WZMALLAS</a>
            <p class="footer-brand-desc">
              Accesorios premium para iPhone y Apple Watch.
              Cuero genuino y acero inoxidable. Buenos Aires, Argentina.
            </p>
            <div class="footer-social">
              <a href="https://www.instagram.com/wz_mallas/" target="_blank" rel="noopener" class="footer-social-btn ig" aria-label="Instagram @wz_mallas" title="@wz_mallas">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                  <rect x="2" y="2" width="20" height="20" rx="5"/>
                  <circle cx="12" cy="12" r="4"/>
                  <circle cx="17.5" cy="6.5" r="0.6" fill="currentColor"/>
                </svg>
              </a>
              <a href="https://wa.me/5492304216009?text=Hola%2C%20te%20escribo%20desde%20la%20web%20de%20WZMALLAS" target="_blank" rel="noopener" class="footer-social-btn wa" aria-label="WhatsApp +54 9 2304 21-6009" title="+54 9 2304 21-6009">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448L.057 24zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413z"/>
                </svg>
              </a>
            </div>
          </div>

          <div>
            <p class="footer-col-title">Productos</p>
            <div class="footer-links">
              <a href="./catalogo.html?cat=apple-watch">Apple Watch</a>
              <a href="./catalogo.html?cat=samsung-watch">Samsung Watch</a>
              <a href="./catalogo.html?cat=xiaomi">Xiaomi</a>
              <a href="./catalogo.html?cat=protectores">Protectores</a>
              <a href="./catalogo.html?cat=mallas">Mallas</a>
              <a href="./catalogo.html?cat=fundas">Fundas</a>
            </div>
          </div>

          <div>
            <p class="footer-col-title">Ayuda</p>
            <div class="footer-links">
              <a href="./seguimiento.html">Seguimiento de pedido</a>
              <a href="./preguntas-frecuentes.html">Preguntas frecuentes</a>
              <a href="./envios-y-plazos.html">Envíos y plazos</a>
              <a href="./cambios-y-devoluciones.html">Cambios y devoluciones</a>
              <a href="./contacto.html">Contacto</a>
            </div>
          </div>

          <div>
            <p class="footer-col-title">Legal</p>
            <div class="footer-links">
              <a href="./quienes-somos.html">Quiénes somos</a>
              <a href="./terminos-condiciones.html">Términos y condiciones</a>
              <a href="./politica-privacidad.html">Política de privacidad</a>
              <a href="./politica-cookies.html">Política de cookies</a>
              <a href="https://www.argentina.gob.ar/produccion/defensadelconsumidor" target="_blank" rel="noopener"
                 style="display:flex;align-items:center;gap:5px;">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                Defensa del consumidor
              </a>
              <a href="#" onclick="if(window.CookieConsent){CookieConsent.openModal();}return false;"
                 style="display:flex;align-items:center;gap:5px;">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/></svg>
                Gestionar cookies
              </a>
            </div>
          </div>

        </div>

        <!-- ── Newsletter ── -->
        <div class="footer-news">
          <div class="footer-news-copy">
            <p class="footer-news-title">Enterate de novedades y ofertas</p>
            <p class="footer-news-sub">Nuevos colores, reposiciones y descuentos exclusivos. Sin spam.</p>
          </div>
          <form class="footer-news-form" id="footer-news-form" novalidate>
            <input type="email" id="footer-news-email" name="email" required
                   autocomplete="email" placeholder="tu@email.com" aria-label="Tu email">
            <input type="text" name="website" tabindex="-1" autocomplete="off"
                   aria-hidden="true" style="position:absolute;left:-9999px;width:1px;height:1px;opacity:0">
            <button type="submit" id="footer-news-btn">Suscribirme</button>
          </form>
          <p class="footer-news-msg" id="footer-news-msg" role="status" aria-live="polite"></p>
        </div>

        <!-- ── Botón de Arrepentimiento (Art. 34 Ley 24.240) ── -->
        <div class="footer-legal-row" style="border-top:1px solid rgba(255,255,255,0.08); padding: 20px 0; display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:16px;">
          <p style="font-size:12px; color:rgba(255,255,255,0.35); max-width:480px; line-height:1.5; margin:0;">
            <strong style="color:rgba(255,255,255,0.55)">Rodrigo Nicolás Zapata</strong> · CUIT 20-44298613-5 · Iparraguirre 169, Presidente Derqui, Pilar, Bs. As. ·
            <a href="mailto:contacto@wzmallas.com" style="color:rgba(255,255,255,0.4);">contacto@wzmallas.com</a>
          </p>
          <a href="https://qr.afip.gob.ar/?qr=3x8Jcm7kwdOqhwMHFbgA1g,," target="_F960AFIPInfo"
             style="display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:600;
                    color:rgba(255,255,255,0.45);border:1px solid rgba(255,255,255,0.15);
                    border-radius:6px;padding:5px 10px;text-decoration:none;white-space:nowrap;
                    transition:color .15s,border-color .15s;"
             onmouseover="this.style.color='rgba(255,255,255,0.8)';this.style.borderColor='rgba(255,255,255,0.35)'"
             onmouseout="this.style.color='rgba(255,255,255,0.45)';this.style.borderColor='rgba(255,255,255,0.15)'"
             title="Verificar datos fiscales en ARCA/AFIP">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
            </svg>
            Datos Fiscales ARCA
          </a>
        </div>

        <div class="footer-bottom">
          <div style="display:flex; align-items:center; gap:16px; flex-wrap:wrap;">
            <p class="footer-copy">© 2026 WZMALLAS — Buenos Aires, Argentina</p>
            <a href="./arrepentimiento.html"
               style="display:inline-flex; align-items:center; gap:6px; font-size:11px; font-weight:600;
                      color:#fff; background:rgba(220,38,38,0.85); border-radius:6px;
                      padding:5px 12px; text-decoration:none; letter-spacing:.02em;
                      border:1px solid rgba(220,38,38,0.5); transition:background .15s;"
               onmouseover="this.style.background='rgba(220,38,38,1)'"
               onmouseout="this.style.background='rgba(220,38,38,0.85)'">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 102.13-9.36L1 10"/></svg>
              BOTÓN DE ARREPENTIMIENTO
            </a>
          </div>
          <div class="footer-payments">
            <span class="footer-pay-label">Pagás con</span>
            <span class="pay-chip"><img src="./img/pay/mercadopago.svg?v=2" alt="MercadoPago" loading="lazy"></span>
            <span class="pay-chip"><img src="./img/pay/visa.svg" alt="Visa" loading="lazy"></span>
            <span class="pay-chip"><img src="./img/pay/mastercard.svg" alt="Mastercard" loading="lazy"></span>
            <span class="pay-chip"><img src="./img/pay/americanexpress.svg" alt="American Express" loading="lazy"></span>
            <span class="pay-chip is-text">Transferencia</span>
          </div>
        </div>
      </div>
    </footer>
  `;
  // Nota: el botón flotante de WhatsApp lo inyecta cart.js (#wz-wa-btn),
  // que aparece contextualmente (scroll/tiempo) y se excluye en carrito/checkout.
  // Antes había además un FAB acá → causaba 2 WhatsApp superpuestos.
}
