exports.handler = async (event) => {
  const json = (statusCode, payload) => ({
    statusCode,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    body: JSON.stringify(payload)
  });

  if (event.httpMethod !== 'GET') return json(405, { message: 'Method not allowed' });

  const secret = process.env.MONO_SECRET_KEY;
  if (!secret) return json(503, { message: 'Mono is not configured. Check MONO_SECRET_KEY in Netlify environment variables.' });

  const ref = event.queryStringParameters?.ref;
  if (!ref) return json(400, { message: 'Missing connection reference.' });

  const headers = { accept: 'application/json', 'mono-sec-key': secret };

  try {
    const listResp = await fetch('https://api.withmono.com/v2/accounts', { headers });
    const list = await listResp.json().catch(() => ({}));

    if (!listResp.ok) {
      console.error('Mono accounts list failed:', listResp.status, list?.message || 'No message');
      return json(502, {
        message: 'Mono could not list linked accounts. Check that MONO_SECRET_KEY belongs to the same Mono Connect app/environment used to link the bank.',
        mono_status: listResp.status,
        mono_message: list?.message || null
      });
    }

    // Mono's response may expose the collection in different wrappers.
    const possibleLists = [
      list?.data,
      list?.data?.accounts,
      list?.data?.data,
      list?.data?.results,
      list?.accounts,
      list?.results
    ];
    const accounts = possibleLists.find(Array.isArray) || [];

    // Only use an account whose Mono reference matches this FINORA connection.
    // Do not silently select the newest account: that can attach the wrong bank account.
    let account = accounts.find(a =>
      a?.meta?.ref === ref ||
      a?.account?.meta?.ref === ref ||
      a?.data?.meta?.ref === ref
    );

    if (!account) {
      for (const candidate of accounts.slice().reverse().slice(0, 15)) {
        const id = candidate?.id || candidate?._id || candidate?.account?.id || candidate?.account?._id;
        if (!id) continue;

        const detailResp = await fetch(`https://api.withmono.com/v2/accounts/${encodeURIComponent(id)}`, { headers });
        const detail = await detailResp.json().catch(() => ({}));
        if (!detailResp.ok) continue;

        const meta = detail?.data?.meta || detail?.data?.account?.meta || candidate?.meta || {};
        if (meta?.ref === ref) {
          account = { ...candidate, ...detail?.data, account: detail?.data?.account || candidate?.account };
          break;
        }
      }
    }

    if (!account) {
      console.error('Mono account lookup did not match FINORA ref:', {
        account_count: accounts.length,
        response_keys: Object.keys(list || {}),
        data_type: Array.isArray(list?.data) ? 'array' : typeof list?.data
      });
      return json(404, {
        message: accounts.length
          ? 'Mono returned linked accounts, but none matched this FINORA connection. Please reconnect the bank once. If it repeats, the Mono webhook/account reference needs checking.'
          : 'Mono returned no linked accounts for this secret key. Check that Netlify MONO_SECRET_KEY matches the Mono app/environment used for the bank connection, then reconnect.',
        accounts_found: accounts.length
      });
    }

    const accountId = account?.id || account?._id || account?.account?.id || account?.account?._id;
    if (!accountId) return json(502, { message: 'Mono returned a linked account without an account ID.' });

    const detailResp = await fetch(`https://api.withmono.com/v2/accounts/${encodeURIComponent(accountId)}`, { headers });
    const detail = await detailResp.json().catch(() => ({}));
    if (!detailResp.ok) {
      console.error('Mono account detail failed:', detailResp.status, detail?.message || 'No message');
      return json(502, { message: 'Mono found the account but could not retrieve its details.', mono_status: detailResp.status, mono_message: detail?.message || null });
    }

    const info = detail?.data?.account || detail?.data || account;
    const meta = detail?.data?.meta || info?.meta || account?.meta || {};
    const dataStatus = String(meta?.data_status || 'AVAILABLE').toUpperCase();
    if (dataStatus === 'PROCESSING' || dataStatus === 'PENDING') {
      return json(202, { status: 'processing', account_id: accountId });
    }
    if (dataStatus !== 'AVAILABLE') {
      return json(409, { message: `Mono account data status is ${dataStatus}. Wait for Mono to finish retrieving data, then try again.`, data_status: dataStatus });
    }

    const balResp = await fetch(`https://api.withmono.com/v2/accounts/${encodeURIComponent(accountId)}/balance`, { headers });
    const bal = await balResp.json().catch(() => ({}));
    if (!balResp.ok) {
      console.error('Mono balance request failed:', balResp.status, bal?.message || 'No message');
      return json(502, { message: 'Mono found the account but could not retrieve its balance.', mono_status: balResp.status, mono_message: bal?.message || null });
    }

    const balance = Number(bal?.data?.balance ?? info?.balance ?? account?.balance ?? 0);
    const txResp = await fetch(`https://api.withmono.com/v2/accounts/${encodeURIComponent(accountId)}/transactions?paginate=false`, { headers });
    const txJson = await txResp.json().catch(() => ({}));
    if (!txResp.ok) {
      console.error('Mono transactions request failed:', txResp.status, txJson?.message || 'No message');
      return json(502, { message: 'Mono found the account but could not retrieve transactions.', mono_status: txResp.status, mono_message: txJson?.message || null });
    }

    let txs = Array.isArray(txJson?.data) ? txJson.data :
      Array.isArray(txJson?.data?.transactions) ? txJson.data.transactions :
      Array.isArray(txJson?.data?.statement) ? txJson.data.statement : [];

    txs = txs.slice(0, 100).map(t => ({
      id: t?.id || t?._id || `${t?.date || ''}-${t?.amount || ''}-${t?.narration || ''}`,
      name: t?.narration || 'Bank transaction',
      amount: (String(t?.type || '').toLowerCase() === 'credit' ? 1 : -1) * (Number(t?.amount) || 0),
      date: t?.date || new Date().toISOString(),
      category: t?.category || 'Other'
    }));

    return json(200, {
      status: 'available',
      account: {
        id: accountId,
        name: info?.name || account?.name || 'Connected account',
        account_number: info?.account_number || info?.accountNumber || account?.account_number || '',
        institution: info?.institution?.name || account?.institution?.name || info?.institution || account?.institution || 'Connected bank',
        currency: info?.currency || account?.currency || 'NGN',
        balance
      },
      transactions: txs
    });
  } catch (e) {
    console.error('Mono sync exception:', e?.message || String(e));
    return json(500, { message: 'FINORA could not contact Mono to retrieve the linked account. Please try again.' });
  }
};
