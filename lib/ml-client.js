// ── Cliente ML autenticado: refresh de token + wrappers GET/PUT/POST ──
// Dependen de la cuenta activa (config/fullConfig) y de persistencia de
// config.json, así que se inyectan via factory.
//
// @param {object} deps
// @param {Function} deps.mlGet/mlPut/mlPost/mlOauthToken - de ./ml-api
// @param {Function} deps.atomicWriteFileSync - de ./json-store
// @param {string}   deps.CONFIG_PATH
// @param {() => object} deps.getConfig - devuelve la cuenta activa (config) actual
// @param {() => object} deps.getFullConfig - devuelve fullConfig actual
function createMlClient({ mlGet, mlPut, mlPost, mlOauthToken, atomicWriteFileSync, CONFIG_PATH, getConfig, getFullConfig }) {

  // Evita refrescos concurrentes para la misma cuenta
  const _refreshInFlight = new Map();
  // Caché en memoria de expiración por cuenta (se inicializa con token_expiry del config al arrancar)
  const _acctTokenExpiry = new Map();

  async function refreshAccountToken(acct) {
    if (!acct) return false;
    // Saltar si el token sigue vigente (verificar memoria primero, luego config persistido)
    const knownExpiry = _acctTokenExpiry.get(acct.id) || acct.token_expiry || 0;
    if (Date.now() < knownExpiry) return true;
    if (_refreshInFlight.has(acct.id)) return _refreshInFlight.get(acct.id);
    const config = getConfig();
    const client_id = acct.client_id || config.client_id;
    const client_secret = acct.client_secret || config.client_secret;
    const refresh_token = acct.refresh_token;
    if (!client_id || !client_secret || !refresh_token) return false;
    const p = mlOauthToken({ grant_type: 'refresh_token', client_id, client_secret, refresh_token })
      .then(tok => {
        if (tok.access_token) {
          acct.access_token = tok.access_token;
          if (tok.refresh_token) acct.refresh_token = tok.refresh_token;
          // Guardar expiración en memoria y en config para evitar renovaciones innecesarias
          const expiry = Date.now() + ((tok.expires_in || 21600) - 300) * 1000;
          _acctTokenExpiry.set(acct.id, expiry);
          acct.token_expiry = expiry;
          // Persistir en fullConfig.accounts (si el acct viene de ahi, ya lo mutamos por referencia)
          try { atomicWriteFileSync(CONFIG_PATH, JSON.stringify(getFullConfig(), null, 2)); } catch(e) {}
          console.log(`  ✓ Token renovado para cuenta "${acct.label || acct.id}"`);
          return true;
        } else {
          console.log(`  ✗ No se pudo renovar token de "${acct.label || acct.id}":`, JSON.stringify(tok));
          return false;
        }
      })
      .catch(() => false);
    _refreshInFlight.set(acct.id, p);
    try { return await p; }
    finally { _refreshInFlight.delete(acct.id); }
  }

  // Wrappers que auto-refrescan y reintentan una vez ante 401
  async function mlGetAuth(acct, mlPath) {
    try {
      return await mlGet(mlPath, acct.access_token);
    } catch(e) {
      // ML a veces devuelve 400 con "Oops! Something went wrong" en vez de 401
      // cuando el token está vencido — forzar refresh igual
      const isOops = typeof e.message === 'string' &&
        (e.message.includes('Oops') || e.message.toLowerCase().includes('invalid_token'));
      if (e.status === 401 || e.status === 403 || (e.status === 400 && isOops)) {
        const ok = await refreshAccountToken(acct);
        if (ok) return await mlGet(mlPath, acct.access_token);
      }
      throw e;
    }
  }
  async function mlPutAuth(acct, mlPath, body) {
    try {
      return await mlPut(mlPath, body, acct.access_token);
    } catch(e) {
      if (e.status === 401 || e.status === 403) {
        const ok = await refreshAccountToken(acct);
        if (ok) return await mlPut(mlPath, body, acct.access_token);
      }
      throw e;
    }
  }

  // PUT con verificación read-after-write contra la API.
  //
  // Dos garantías:
  //  1. Camino feliz: un PUT que devuelve 200 NO garantiza que ML haya dejado el
  //     stock como se pidió. Tras el PUT se RE-LEE el item y se confirma que el
  //     total real coincide con `expectedTotal`. Si no coincide, se lanza error
  //     (STOCK_NOT_VERIFIED) en vez de reportar un falso "aplicado". Cierra la
  //     familia de "a veces no aplica" (PUT aceptado pero stock sin cambiar).
  //  2. Recuperación: si el PUT falla por timeout/red/5xx (NO 4xx), ML pudo igual
  //     haber aplicado el cambio; la misma re-lectura lo confirma (recovered:true).
  //
  // El stock de estos items es `countable` (seller-managed) y el available_quantity
  // de la variante refleja el del user_product de inmediato (verificado contra la
  // API), así que la re-lectura es fiable. Se hace 1 reintento corto por si hay
  // demora de propagación. Si entre el PUT y la lectura entra una venta real, el
  // total leído será menor y se reportará como no verificado (fail-safe: preferible
  // a un falso éxito; es raro y el usuario re-chequea).
  //
  // Sin `expectedTotal` (updates que no son de stock) se mantiene el comportamiento
  // previo: si el PUT no tira, se da por aplicado sin re-leer.
  // Devuelve { applied:true, recovered:bool }.
  async function mlPutVerified(acct, itemId, putBody, expectedTotal) {
    const readTotal = async () => {
      const data = await mlGetAuth(acct, '/items/' + itemId);
      const vars = data.variations || [];
      return vars.length
        ? vars.reduce((s, v) => s + (v.available_quantity || 0), 0)
        : (data.available_quantity || 0);
    };

    let putError = null;
    try {
      await mlPutAuth(acct, '/items/' + itemId, putBody);
    } catch(e) {
      // 4xx = rechazo real de ML (datos inválidos, permisos) → no recuperable
      if (e.status && e.status >= 400 && e.status < 500) throw e;
      // timeout / 5xx / red: no sabemos si se aplicó → lo dirá la verificación
      putError = e;
    }

    // Sin expectedTotal no se puede verificar el stock (ej. updates de otros campos).
    if (expectedTotal == null) {
      if (putError) throw putError;
      return { applied: true, recovered: false };
    }

    // Read-after-write con 1 reintento (cubre una eventual demora de propagación).
    let lastTotal = null, lastReadErr = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) await new Promise(r => setTimeout(r, 700));
      try {
        lastTotal = await readTotal();
        if (lastTotal === expectedTotal) {
          if (putError) console.log(`  ↻ PUT de ${itemId} no confirmó pero el cambio SÍ se aplicó (verificado: ${lastTotal} u.)`);
          return { applied: true, recovered: !!putError };
        }
      } catch(e) { lastReadErr = e; }
    }

    // No se pudo confirmar el cambio.
    if (lastTotal != null) {
      const err = new Error(`Stock no verificado en ${itemId}: esperaba ${expectedTotal}, ML quedó en ${lastTotal}`);
      err.code = 'STOCK_NOT_VERIFIED';
      err.expected = expectedTotal; err.actual = lastTotal;
      throw err;
    }
    // Ni siquiera se pudo leer para verificar → propagar el error más relevante.
    throw putError || lastReadErr || new Error('No se pudo verificar el stock de ' + itemId);
  }

  async function mlPostAuth(acct, mlPath, body) {
    try {
      return await mlPost(mlPath, body, acct.access_token);
    } catch(e) {
      if (e.status === 401 || e.status === 403) {
        const ok = await refreshAccountToken(acct);
        if (ok) return await mlPost(mlPath, body, acct.access_token);
      }
      throw e;
    }
  }

  // getTokenExpiry: epoch ms de expiración del access token de una cuenta (0 si
  // todavía no se refrescó). Lo usa lib/system-status.js para el panel /estado.
  const getTokenExpiry = (acctId) => _acctTokenExpiry.get(acctId) || 0;

  return { refreshAccountToken, mlGetAuth, mlPutAuth, mlPutVerified, mlPostAuth, getTokenExpiry };
}

module.exports = { createMlClient };
