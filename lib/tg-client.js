// ── Cliente Telegram de bajo nivel: primitivas de envío/edición ──────
// Wrappers finos sobre tgRequest (lib/telegram) que leen el bot_token/chat_id
// de la config activa. Dependen de fullConfig (mutable) y del flag global de
// desactivación (staging), así que se inyectan via factory.
//
// @param {() => object} getFullConfig - devuelve fullConfig actual (lee .telegram)
// @param {boolean} telegramDisabled - true en staging para no robarle updates a prod
const { tgRequest } = require('./telegram');

function createTgClient({ getFullConfig, telegramDisabled }) {

  function tgSend(text, keyboard) {
    if (telegramDisabled) return Promise.resolve();
    const tg = getFullConfig().telegram;
    if (!tg?.bot_token || !tg?.chat_id) return Promise.resolve();
    const params = { chat_id: tg.chat_id, text, parse_mode: 'HTML' };
    if (keyboard) params.reply_markup = { inline_keyboard: keyboard };
    return tgRequest(tg.bot_token, 'sendMessage', params);
  }

  // Envía una foto (por URL de ML) con caption + botones. Si falla el envío de
  // la foto (URL caída, etc.), cae a un sendMessage de texto para no perder el
  // aviso. El caption de Telegram admite hasta 1024 caracteres (suficiente acá).
  async function tgSendPhoto(photoUrl, caption, keyboard) {
    if (telegramDisabled) return Promise.resolve();
    const tg = getFullConfig().telegram;
    if (!tg?.bot_token || !tg?.chat_id) return Promise.resolve();
    const params = { chat_id: tg.chat_id, photo: photoUrl, caption, parse_mode: 'HTML' };
    if (keyboard) params.reply_markup = { inline_keyboard: keyboard };
    const r = await tgRequest(tg.bot_token, 'sendPhoto', params);
    if (r && r.ok) return r;
    // Fallback a texto si la foto falló
    return tgSend(caption, keyboard);
  }

  // Edita el caption de un mensaje-foto in-place (equivalente a tgEdit pero para
  // mensajes enviados con sendPhoto, que no se pueden editar con editMessageText).
  function tgEditCaption(chatId, messageId, caption, keyboard) {
    const tg = getFullConfig().telegram;
    if (!tg?.bot_token || !chatId || !messageId) return Promise.resolve();
    const params = {
      chat_id: chatId, message_id: messageId, caption, parse_mode: 'HTML',
      reply_markup: { inline_keyboard: keyboard || [] },
    };
    return tgRequest(tg.bot_token, 'editMessageCaption', params).catch(() => {});
  }

  // Alerta operativa con throttle: envía `text` por Telegram pero no repite la
  // misma `key` antes de `minutes` minutos. Evita inundar el chat cuando un
  // error se dispara en cada request (ej: MP mal configurado, webhooks inválidos).
  const _tgAlertLast = new Map();
  function tgAlert(key, text, minutes = 30) {
    const now = Date.now();
    const last = _tgAlertLast.get(key) || 0;
    if (now - last < minutes * 60 * 1000) return Promise.resolve();
    _tgAlertLast.set(key, now);
    return tgSend(text).catch(() => {});
  }

  // Edita un mensaje existente (in-place). Se usa al tocar un botón para
  // reemplazar la notificación por su resultado, sin generar mensajes nuevos
  // ni dejar botones tocables (evita doble-tap sobre ajustes ya aplicados).
  // keyboard omitido o [] → quita los botones.
  function tgEdit(chatId, messageId, text, keyboard) {
    const tg = getFullConfig().telegram;
    if (!tg?.bot_token || !chatId || !messageId) return Promise.resolve();
    const params = {
      chat_id: chatId, message_id: messageId, text, parse_mode: 'HTML',
      reply_markup: { inline_keyboard: keyboard || [] },
    };
    return tgRequest(tg.bot_token, 'editMessageText', params).catch(() => {});
  }

  return { tgSend, tgSendPhoto, tgEditCaption, tgAlert, tgEdit };
}

module.exports = { createTgClient };
