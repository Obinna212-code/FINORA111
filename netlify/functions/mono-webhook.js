exports.handler = async (event) => {
  const json = (statusCode, payload) => ({
    statusCode,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    body: JSON.stringify(payload)
  });

  const method = event.httpMethod || event.requestContext?.http?.method;
  if (method !== 'POST') {
    return json(405, { message: 'Method not allowed. Mono must POST webhook events.' });
  }

  // Verify Mono's webhook secret before trusting or storing the payload.
  const expected = process.env.MONO_WEBHOOK_SECRET || process.env.MONO_WEBHOOK_SEC;
  const headers = event.headers || {};
  const supplied = headers['mono-webhook-secret'] ||
    headers['Mono-Webhook-Secret'] ||
    headers['MONO-WEBHOOK-SECRET'];

  if (!expected || !supplied || supplied !== expected) {
    console.error('Mono webhook rejected: secret missing or did not match configured secret.');
    return json(401, { message: 'Unauthorized request. Check the Mono webhook secret configured in Netlify.' });
  }

  let payload;
  try {
    const rawBody = event.isBase64Encoded
      ? Buffer.from(event.body || '', 'base64').toString('utf8')
      : (event.body || '{}');
    payload = JSON.parse(rawBody);
  } catch (_) {
    return json(400, { message: 'Invalid JSON webhook payload.' });
  }

  const data = payload.data || {};
  const nestedData = data.data || {};
  const account = data.account || nestedData.account || {};
  const meta = data.meta || account.meta || nestedData.meta || {};
  const nestedMetaData = meta.data || {};
  const accountId =
    data.id ||
    data._id ||
    data.account_id ||
    account.id ||
    account._id ||
    nestedData.id ||
    nestedData._id ||
    nestedMetaData.id ||
    nestedMetaData._id ||
    null;
  const ref = meta.ref || account.meta?.ref || nestedMetaData.ref || data.ref || null;
  const eventName = payload.event || 'unknown';
  const eventId = payload.event_id || payload.id || null;
  const dataStatus = meta.data_status || account.meta?.data_status || null;
  const receivedAt = new Date().toISOString();

  try {
    // Keep the store name consistent with mono-sync.js, which reads these records.
    const { getStore } = require('@netlify/blobs');
    const store = getStore('finora-mono-connections');

    await store.setJSON('diagnostics:last-event', {
      event: eventName,
      eventId,
      receivedAt,
      hasAccountId: Boolean(accountId),
      hasRef: Boolean(ref),
      dataStatus
    });

    // Save the exact mapping used by FINORA's sync endpoint.
    if (accountId && ref) {
      await store.setJSON('ref:' + String(ref), {
        accountId: String(accountId),
        ref: String(ref),
        event: eventName,
        eventId,
        dataStatus,
        updatedAt: receivedAt
      });
    }

    console.log(JSON.stringify({
      source: 'mono',
      event: eventName,
      event_id: eventId,
      has_account_id: Boolean(accountId),
      has_ref: Boolean(ref),
      saved: Boolean(accountId && ref)
    }));

    return json(200, {
      received: true,
      event: eventName,
      event_id: eventId,
      saved: Boolean(accountId && ref),
      has_account_id: Boolean(accountId),
      has_ref: Boolean(ref)
    });
  } catch (error) {
    console.error('Mono webhook persistence failed:', error?.message || String(error));
    return json(500, { message: 'Unable to save Mono connection event; check Netlify Blobs configuration and retry delivery.' });
  }
};
