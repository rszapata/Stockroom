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

  // PUT con verificación: si el PUT falla por timeout/red/5xx (NO por 4xx),
  // ML muy probablemente igual aplicó el cambio aunque la respuesta tardó y el
  // socket expiró. Reconsulta el item con un GET y, si el stock total coincide
  // con lo esperado, lo da por aplicado. Evita el "hizo el cambio pero figura
  // como fallido". Devuelve { applied:true, recovered:bool }.
  async function mlPutVerified(acct, itemId, putBody, expectedTotal) {
    try {
      await mlPutAuth(acct, '/items/' + itemId, putBody);
      return { applied: true, recovered: false };
    } catch(e) {
      // 4xx = rechazo real de ML (datos inválidos, permisos) → no es recuperable
      if (e.status && e.status >= 400 && e.status < 500) throw e;
      // timeout / 5xx / error de red → verificar si igual se aplicó
      if (expectedTotal == null) throw e;
      try {
        const data = await mlGetAuth(acct, '/items/' + itemId);
        const vars = data.variations || [];
        const total = vars.length
          ? vars.reduce((s, v) => s + (v.available_quantity || 0), 0)
          : (data.available_quantity || 0);
        if (total === expectedTotal) {
          console.log(`  ↻ [tg] PUT de ${itemId} expiró pero el cambio SÍ se aplicó (verificado: ${total} u.)`);
          return { applied: true, recovered: true };
        }
      } catch(_) { /* la verificación también falló → propagar el error original */ }
      throw e;
    }
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

  return { refreshAccountToken, mlGetAuth, mlPutAuth, mlPutVerified, mlPostAuth };
}

module.exports = { createMlClient };
