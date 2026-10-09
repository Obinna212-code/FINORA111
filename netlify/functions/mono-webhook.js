exports.handler = async (event) => {
  const json = (statusCode, payload) => ({
    statusCode,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    body: JSON.stringify(payload)
  });
  if (event.httpMethod !== 'POST') return json(405, { message: 'Method not allowed' });

  const expected = process.env.MONO_WEBHOOK_SECRET || process.env.MONO_WEBHOOK_SEC;
  const headers = event.headers || {};
  const supplied = headers['mono-webhook-secret'] || headers['Mono-Webhook-Secret'];
  if (!expected || !supplied || supplied !== expected) return json(401, { message: 'Unauthorized request.' });

  let payload;
  try { payload = JSON.parse(event.body || '{}'); } catch (_) { return json(400, { message: 'Invalid JSON.' }); }

  const eventName = payload.event || 'unknown';
  const eventId = payload.event_id || null;
  const data = payload.data || {};
  const account = data.account || data.data?.account || {};
  const accountId = data.id || data._id || account.id || account._id || data.account_id || null;
  const ref = data.meta?.ref || account.meta?.ref || data.ref || null;
  const dataStatus = data.meta?.data_status || account.meta?.data_status || null;

  console.log(JSON.stringify({ source: 'mono', event: eventName, event_id: eventId, account_id: accountId, ref, data_status: dataStatus, has_account_id: Boolean(accountId), has_ref: Boolean(ref) }));

  if (accountId && ref) {
    try {
      const { getStore } = require('@netlify/blobs');
      const store = getStore('finora-mono-connections');
      await store.setJSON('ref:' + ref, { accountId: String(accountId), ref: String(ref), event: eventName, eventId, dataStatus, updatedAt: new Date().toISOString() });
    } catch (error) {
      console.error('Mono webhook persistence failed:', error?.message || String(error));
      return json(500, { message: 'Unable to save Mono connection event; retry delivery.' });
    }
  }

  return json(200, { received: true, event: eventName, event_id: eventId, saved: Boolean(accountId && ref) });
};
