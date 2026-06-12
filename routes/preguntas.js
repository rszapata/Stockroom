'use strict';
const { json } = require('../lib/http');

module.exports = function(ctx) {
  const { mlGetAuth, mlPostAuth, refreshAccountToken, fullConfig } = ctx;

  return function handlePreguntas(req, res, pathname) {

    // GET /preguntas-all
    if (pathname === '/preguntas-all' && req.method === 'GET') {
      (async () => {
        try {
          const allAccounts = (fullConfig().accounts || []).filter(a => a.access_token && a.user_id);
          if (!allAccounts.length) { json(res, 400, { error: 'Sin cuentas configuradas' }); return; }

          const results = await Promise.all(allAccounts.map(async acct => {
            try {
              await refreshAccountToken(acct);
              const data = await mlGetAuth(acct,
                `/questions/search?seller_id=${acct.user_id}&status=UNANSWERED&limit=50&sort_fields=date_created&sort_types=DESC`);
              const questions = data.questions || [];

              const itemIds = [...new Set(questions.map(q => q.item_id).filter(Boolean))];
              const itemCache = {};
              await Promise.all(itemIds.map(async id => {
                try {
                  const item = await mlGetAuth(acct, `/items/${id}?attributes=id,title,thumbnail`);
                  itemCache[id] = { title: item.title || id, thumb: item.thumbnail || null };
                } catch(e) { itemCache[id] = { title: id, thumb: null }; }
              }));

              const enriched = questions.map(q => ({
                id:           q.id,
                text:         q.text,
                date_created: q.date_created,
                item_id:      q.item_id,
                item_title:   itemCache[q.item_id]?.title || q.item_id || '—',
                item_thumb:   itemCache[q.item_id]?.thumb || null,
                buyer_id:     q.from?.id || null,
              }));

              return { accountId: acct.id, label: acct.label || acct.id, ok: true, questions: enriched };
            } catch(e) {
              return { accountId: acct.id, label: acct.label || acct.id, ok: false, error: e.message, questions: [] };
            }
          }));

          const total = results.reduce((s, r) => s + r.questions.length, 0);
          json(res, 200, { ok: true, accounts: results, total });
        } catch(e) { json(res, 500, { error: e.message }); }
      })();
      return true;
    }

    // POST /preguntas-responder
    if (pathname === '/preguntas-responder' && req.method === 'POST') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', async () => {
        try {
          const { accountId, question_id, text } = JSON.parse(body);
          if (!accountId || !question_id || !text?.trim())
            { json(res, 400, { error: 'Faltan parámetros: accountId, question_id, text' }); return; }

          const acct = (fullConfig().accounts || []).find(a => a.id === accountId);
          if (!acct) { json(res, 404, { error: 'Cuenta no encontrada' }); return; }

          await refreshAccountToken(acct);
          const result = await mlPostAuth(acct, '/answers', { question_id, text: text.trim() });
          json(res, 200, { ok: true, answer: result });
        } catch(e) {
          json(res, e.status || 500, { ok: false, error: e.message });
        }
      });
      return true;
    }

    return false;
  };
};
