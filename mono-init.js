exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: JSON.stringify({message:'Method not allowed'}) };
  const secret = process.env.MONO_SECRET_KEY;
  if (!secret) return { statusCode: 503, headers:{'content-type':'application/json'}, body: JSON.stringify({message:'FINORA bank connection is not activated yet. Add MONO_SECRET_KEY in Netlify environment variables.'}) };
  try {
    const body = JSON.parse(event.body || '{}');
    if (!body.name || !body.email) return {statusCode:400, headers:{'content-type':'application/json'}, body:JSON.stringify({message:'Name and email are required.'})};
    const origin = 'https://finorafinanceapp.netlify.app';
    const ref = `finora-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
    const resp = await fetch('https://api.withmono.com/v2/accounts/initiate', {
      method:'POST',
      headers:{'accept':'application/json','content-type':'application/json','mono-sec-key':secret},
      body:JSON.stringify({customer:{name:body.name,email:body.email},meta:{ref},scope:'auth',redirect_url:`${origin}/?mono=complete&ref=${encodeURIComponent(ref)}`})
    });
    const data = await resp.json();
    if (!resp.ok || !data?.data?.mono_url) return {statusCode:502,headers:{'content-type':'application/json'},body:JSON.stringify({message:data?.message||'Mono could not create a connection session.'})};
    return {statusCode:200,headers:{'content-type':'application/json'},body:JSON.stringify({mono_url:data.data.mono_url,ref})};
  } catch (e) {
    return {statusCode:500,headers:{'content-type':'application/json'},body:JSON.stringify({message:'Unable to start the bank connection.'})};
  }
};
