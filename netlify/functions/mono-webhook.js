exports.handler = async (event) => {
  const json = (statusCode, payload) => ({
    statusCode,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    body: JSON.stringify(payload)
  });
  const method = event.httpMethod || event.requestContext?.http?.method;
  if (method !== 'POST') return json(405, { message: 'Method not allowed. Mono must POST webhook events.' });

  const expected = process.env.MONO_WEBHOOK_SECRET || process.env.MONO_WEBHOOK_SEC;
  const headers = event.headers || {};
  const supplied = headers['mono-webhook-secret'] || headers['Mono-Webhook-Secret'] || headers['MONO-WEBHOOK-SECRET'];
  if (!expected || !supplied || supplied !== expected) {
    console.error('Mono webhook rejected: secret missing or did not match configured secret.');
    return json(401, { message: 'Unauthorized request. Check Mono webhook secret against Netlify MONO_WEBHOOK_SECRET.' });
  }

  let payload;
  try { payload = JSON.parse(event.body || '{}'); } catch (_) { return json(400, { message: 'Invalid JSON.' }); }

  const eventName = payload.event || 'unknown';
  const eventId = payload.event_id || null;
  const data = payload.data || {};
  const account = data.account || data.data?.account || {};
  const meta = data.meta || account.meta || data.data?.meta || {};
  const accountId = data.id || data._id || account.id || account._id || data.account_id || null;
  const ref = meta.ref || data.ref || null;
  const dataStatus = meta.data_status || null;
  const store = require('@netlify/blobs').getStore('finora-mono-connections');

  try {
    // Record every authenticated event so the sync endpoint can distinguish
    // "webhook never arrived" from "webhook arrived with an unexpected payload".
    await store.setJSON('diagnostics:last-event', {
      event: eventName,
      eventId,
      receivedAt: new Date().toISOString(),
      hasAccountId: Boolean(accountId),
      hasRef: Boolean(ref),
      dataStatus
    });

    if (accountId && ref) {
      await store.setJSON('ref:' + ref, {
        accountId: String(accountId),
        ref: String(ref),
        event: eventName,
        eventId,
        dataStatus,
        updatedAt: new Date().toISOString()
      });
    }
  } catch (error) {
    console.error('Mono webhook persistence failed:', error?.message || String(error));
    return json(500, { message: 'Unable to save Mono connection event; retry delivery.' });
  }

  console.log(JSON.stringify({
    source: 'mono',
    event: eventName,
    event_id: eventId,
    account_id: accountId,
    ref,
    data_status: dataStatus,
    saved: Boolean(accountId && ref)
  }));

  return json(200, { received: true, event: eventName, event_id: eventId, saved: Boolean(accountId && ref), has_account_id: Boolean(accountId), has_ref: Boolean(ref) });
};
