// ── Firebase Admin — verificación de ID tokens ────────────────────
//
// Modo HÍBRIDO (ver PLAN.md FASE 9):
//   Firebase = proveedor de identidad de entrada (Google + email/password).
//   PostgreSQL = fuente de verdad del perfil. La sesión sigue siendo `wz_sid`.
//   Este módulo SOLO valida el ID token de Firebase una vez; no maneja sesiones.
//
// Credencial: archivo `Stockroom/firebase-service-account.json` (gitignored,
//   excluido del deploy). Si no está, el módulo queda inerte y verifyIdToken()
//   rechaza con un error claro — no rompe el resto del server.
//
// API modular de firebase-admin v13: require('firebase-admin/app' | '/auth').
//
const path = require('path');
const fs   = require('fs');

const SA_PATH = path.join(__dirname, '..', 'firebase-service-account.json');

let _auth      = null;   // instancia de Auth (lazy)
let _initError = null;   // motivo si no se pudo inicializar
let _initDone  = false;

function _init() {
  if (_initDone) return;
  _initDone = true;
  try {
    if (!fs.existsSync(SA_PATH)) {
      _initError = 'firebase-service-account.json no encontrado';
      console.warn('[firebase] Inactivo:', _initError, '— el login con Firebase no estará disponible');
      return;
    }
    const serviceAccount = JSON.parse(fs.readFileSync(SA_PATH, 'utf8'));
    const { initializeApp, cert, getApps } = require('firebase-admin/app');
    const { getAuth } = require('firebase-admin/auth');

    // Evita "app already exists" si el módulo se recarga
    const app = getApps().length
      ? getApps()[0]
      : initializeApp({ credential: cert(serviceAccount) });

    _auth = getAuth(app);
    console.log(`  ✓ [firebase] Admin inicializado (proyecto: ${serviceAccount.project_id})`);
  } catch (e) {
    _initError = e.message;
    console.error('[firebase] Error al inicializar:', e.message);
  }
}

/** ¿Está Firebase configurado y listo para validar tokens? */
function isConfigured() {
  _init();
  return !!_auth;
}

/**
 * Valida un ID token de Firebase y devuelve el token decodificado.
 * @param {string} idToken  ID token JWT emitido por el SDK cliente de Firebase
 * @returns {Promise<object>} { uid, email, email_verified, name, picture, firebase: { sign_in_provider }, ... }
 * @throws  Error si Firebase no está configurado o el token es inválido/expirado
 */
async function verifyIdToken(idToken) {
  _init();
  if (!_auth) throw new Error('Firebase no configurado: ' + (_initError || 'desconocido'));
  if (!idToken || typeof idToken !== 'string') throw new Error('ID token ausente');
  // checkRevoked=true: rechaza tokens de cuentas deshabilitadas/revocadas
  return _auth.verifyIdToken(idToken, true);
}

/**
 * Elimina un usuario de Firebase Auth por su uid (se usa al borrar la cuenta — FASE A4).
 * No-op si Firebase no está configurado.
 */
async function deleteFirebaseUser(uid) {
  _init();
  if (!_auth || !uid) return;
  await _auth.deleteUser(uid);
}

module.exports = { isConfigured, verifyIdToken, deleteFirebaseUser };
