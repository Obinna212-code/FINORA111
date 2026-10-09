exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: 'Method not allowed' }) };
  }

  // Support the name used by FINORA and Mono's documentation.
  const expected = process.env.MONO_WEBHOOK_SECRET || process.env.MONO_WEBHOOK_SEC;
  const supplied = event.headers?.['mono-webhook-secret'] || event.headers?.['Mono-Webhook-Secret'];
  if (!expected || !supplied || supplied !== expected) {
    return { statusCode: 401, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: 'Unauthorized request.' }) };
  }

  let payload = {};
  try { payload = JSON.parse(event.body || '{}'); } catch (_) {
    return { statusCode: 400, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: 'Invalid JSON.' }) };
  }

  const eventName = payload.event || 'unknown';
  const eventId = payload.event_id || null;
  const data = payload.data || {};

  // Netlify functions are stateless. The durable account/user association must
  // eventually be stored in FINORA's database. For now, acknowledge valid
  // Mono events so Mono does not retry them, and expose only safe metadata in
  // the function log (never secrets or full account payloads).
  console.log(JSON.stringify({
    source: 'mono',
    event: eventName,
    event_id: eventId,
    account_id: data.id || data.account?._id || null,
    ref: data.meta?.ref || data.account?.meta?.ref || null,
    data_status: data.meta?.data_status || data.account?.meta?.data_status || null
  }));

  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ received: true, event: eventName, event_id: eventId })
  };
};
