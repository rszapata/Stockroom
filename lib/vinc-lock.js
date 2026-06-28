// ── Mutex async compartido para el estado de vinculaciones ──────────────
// Serializa las secciones que hacen read-modify-write sobre los JSON de estado
// (vinculaciones-pending.json y vinculaciones-ventas.json). Sin esto, tres
// rutas pueden pisarse entre sí (lost update): el check periódico, los callbacks
// de Telegram (apsync/vc/apvarall/vsrc/dis) y el apply web. El síntoma típico es
// que un tap de Telegram aplique un ajuste mientras el check periódico está a
// mitad de su load→…→save y lo revierta a 'pending' → Telegram re-notifica, o se
// pierde el flag `synced` del ledger de ventas.
//
// Las escrituras ya son atómicas (temp+rename en json-store), así que el riesgo
// no es corrupción sino lost update. Como Node es single-thread, basta con
// encolar las secciones críticas: nada corre en paralelo, cada load→save ve
// datos consistentes.
//
// Es un singleton (require cachea el módulo) → server.js y routes/vinculaciones.js
// comparten la MISMA cola.
function createMutex() {
  let chain = Promise.resolve();
  let active = 0; // tareas encoladas o en ejecución

  // Encola fn y la corre cuando le toque. Devuelve la promesa de fn (el caller
  // maneja su resultado/errores). El error NO rompe la cadena.
  function run(fn) {
    active++;
    const p = chain.then(() => fn());
    chain = p.then(() => { active--; }, () => { active--; });
    return p;
  }

  return {
    run,
    // true si hay algo encolado o corriendo. Lo usa el check periódico para
    // saltarse esta iteración en vez de apilarse (correrá en el próximo intervalo).
    get busy() { return active > 0; },
  };
}

module.exports = createMutex();
