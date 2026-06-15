// ── Polling de pagos pendientes de MercadoPago ──────────────────────
// Recorre las órdenes 'pendiente_pago', consulta MP por external_reference
// y actualiza el estado (pagado/rechazado/reembolsado), notificando por
// Telegram y email. Depende de db, MP, notificaciones y templates de email,
// así que se inyectan via factory.
function createPaymentPoller({ db, getMpTokenFresh, mpSearchPaymentByExternalRef, tgSend, sendVentaTiendaNotification, sendEmail, emailPagoConfirmado }) {

  let _pollingInProgress = false;

  async function pollPendingPayments() {
    if (_pollingInProgress) return { skipped: 'already_running' };
    _pollingInProgress = true;

    try {
      const accessToken = await getMpTokenFresh();
      if (!accessToken) return { error: 'no_mp_token' };

      const pending = await db.getOrdenesPendientesPago();

      if (pending.length === 0) {
        return { ok: true, checked: 0, updated: 0 };
      }

      let updated = 0;

      for (const orden of pending) {
        try {
          const pago = await mpSearchPaymentByExternalRef(orden.id, accessToken);
          if (!pago) continue; // El usuario todavía no inició el pago

          // Mapear estado de MP a estado de la orden (en español)
          let newStatus = orden.status; // 'pendiente_pago'
          if (pago.status === 'approved' || pago.status === 'authorized') newStatus = 'pagado';
          else if (pago.status === 'rejected' || pago.status === 'cancelled') newStatus = 'rechazado';
          else if (pago.status === 'refunded' || pago.status === 'charged_back') newStatus = 'reembolsado';
          // 'in_process'/'pending' → no cambia (sigue 'pendiente_pago')

          if (newStatus !== orden.status) {
            await db.updateOrdenStatus(orden.id, newStatus, {
              mp_payment_id:     pago.id,
              mp_payment_status: pago.status,
              mp_payment_amount: pago.transaction_amount,
              mp_payment_method: pago.payment_method_id,
            });
            updated++;

            const total   = orden.total ? `$${Number(orden.total).toLocaleString('es-AR')}` : '—';
            const cliente = orden.datos?.nombre || orden.datos?.email || 'Cliente';
            if (newStatus === 'pagado') {
              tgSend(`💰 <b>Pago aprobado</b> — ${total}\nOrden: <code>${orden.id}</code>\nCliente: ${cliente}\nMP payment: <code>${pago.id}</code>`).catch(()=>{});
              console.log(`  ✓ [polling] Orden ${orden.id}: pendiente_pago → pagado ($${pago.transaction_amount})`);
              // Notificación de stock por Telegram
              sendVentaTiendaNotification(orden).catch(() => {});
              // Email de pago confirmado al comprador (async)
              const emailPago = orden.datos?.email || orden.cliente?.email;
              if (emailPago) {
                sendEmail({
                  to: emailPago,
                  subject: `💳 Pago recibido · Orden #${String(orden.id).slice(-8).toUpperCase()} · WZMALLAS`,
                  html: emailPagoConfirmado({ ...orden, total: pago.transaction_amount || orden.total }),
                }).then(r => {
                  if (r.ok) console.log(`  ✓ [email] Pago confirmado enviado a ${emailPago}`);
                  else if (!r.skipped) console.warn(`  ⚠ [email] Error enviando pago confirmado:`, r.error);
                });
              }
            } else if (newStatus === 'rechazado') {
              tgSend(`❌ <b>Pago rechazado</b>\nOrden: <code>${orden.id}</code>\nCliente: ${cliente}\nMotivo: ${pago.status_detail || '—'}`).catch(()=>{});
              console.log(`  ✗ [polling] Orden ${orden.id}: pendiente_pago → rechazado (${pago.status_detail})`);
            } else if (newStatus === 'reembolsado') {
              tgSend(`↩️ <b>Pago reembolsado</b>\nOrden: <code>${orden.id}</code>`).catch(()=>{});
            }
          } else {
            // Status sin cambio, pero guardar el mp_payment_id si es la primera vez
            if (!orden.mp_payment_id) {
              await db.updateOrdenStatus(orden.id, orden.status, {
                mp_payment_id:     pago.id,
                mp_payment_status: pago.status,
              });
            }
          }
        } catch(e) {
          // 401 = token inválido para TODAS las órdenes — cortar el loop y dejar
          // que el circuit breaker de afuera lo maneje (antes se logueaba una vez
          // por orden cada 30s sin abrir nunca el circuito).
          if (e.message && (e.message.includes('401') || e.message.toLowerCase().includes('invalid access token'))) throw e;
          console.warn(`  ⚠ [polling] Error orden ${orden.id}: ${e.message}`);
        }
      }

      return { ok: true, checked: pending.length, updated };

    } finally {
      _pollingInProgress = false;
    }
  }

  return { pollPendingPayments };
}

module.exports = { createPaymentPoller };
