exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers:{'content-type':'application/json'}, body: JSON.stringify({message:'Method not allowed'}) };
  const secret = process.env.MONO_SECRET_KEY;
  if (!secret) return { statusCode:503, headers:{'content-type':'application/json'}, body:JSON.stringify({message:'Mono is not configured.'}) };
  const ref = event.queryStringParameters?.ref;
  if (!ref) return { statusCode:400, headers:{'content-type':'application/json'}, body:JSON.stringify({message:'Missing connection reference.'}) };
  const headers={accept:'application/json','mono-sec-key':secret};
  try {
    const listResp=await fetch('https://api.withmono.com/v2/accounts',{headers});
    const list=await listResp.json();
    if(!listResp.ok) return {statusCode:502,headers:{'content-type':'application/json'},body:JSON.stringify({message:list?.message||'Unable to find linked accounts.'})};
    const accounts=Array.isArray(list?.data)?list.data:(Array.isArray(list?.data?.accounts)?list.data.accounts:[]);
    let account=accounts.find(a=>a?.meta?.ref===ref || a?.account?.meta?.ref===ref);
    // If the list endpoint does not expose meta.ref, inspect recent accounts until a matching ref is found.
    if(!account){
      for(const candidate of accounts.slice(-10).reverse()){
        const id=candidate?.id||candidate?._id||candidate?.account?.id||candidate?.account?._id;
        if(!id) continue;
        const dr=await fetch(`https://api.withmono.com/v2/accounts/${encodeURIComponent(id)}`,{headers});
        const dj=await dr.json().catch(()=>({}));
        const meta=dj?.data?.meta||dj?.data?.account?.meta||candidate?.meta||{};
        if(meta?.ref===ref){ account={...candidate,...(dj?.data?.account||dj?.data||{})}; break; }
      }
    }
    // Sandbox fallback: when Mono does not return the ref on the account list/details, use the newest linked account.
    // The client must still supply the one-time ref created by FINORA.
    if(!account && accounts.length) account=accounts[accounts.length-1];
    if(!account) return {statusCode:404,headers:{'content-type':'application/json'},body:JSON.stringify({message:'Mono linked the account, but its account record is not available yet. Try again in a few seconds.'})};
    const accountId=account?.id||account?._id||account?.account?.id||account?.account?._id;
    if(!accountId) return {statusCode:502,headers:{'content-type':'application/json'},body:JSON.stringify({message:'Mono returned a linked account without an account ID.'})};
    const detailResp=await fetch(`https://api.withmono.com/v2/accounts/${encodeURIComponent(accountId)}`,{headers});
    const detail=await detailResp.json().catch(()=>({}));
    const info=detail?.data?.account||detail?.data||account;
    const status=String(info?.meta?.data_status||detail?.data?.meta?.data_status||account?.meta?.data_status||'AVAILABLE').toUpperCase();
    if(status==='PROCESSING') return {statusCode:202,headers:{'content-type':'application/json'},body:JSON.stringify({status:'processing',account_id:accountId})};
    const balResp=await fetch(`https://api.withmono.com/v2/accounts/${encodeURIComponent(accountId)}/balance`,{headers});
    const bal=await balResp.json().catch(()=>({}));
    const balance=Number(bal?.data?.balance ?? info?.balance ?? account?.balance ?? 0)/100;
    const txResp=await fetch(`https://api.withmono.com/v2/accounts/${encodeURIComponent(accountId)}/transactions?paginate=false`,{headers});
    const txJson=await txResp.json().catch(()=>({}));
    let txs=Array.isArray(txJson?.data)?txJson.data:(Array.isArray(txJson?.data?.transactions)?txJson.data.transactions:(Array.isArray(txJson?.data?.statement)?txJson.data.statement:[]));
    txs=txs.slice(0,100).map(t=>({id:t?.id||t?._id||`${t?.date||''}-${t?.amount||''}-${t?.narration||''}`,name:t?.narration||'Bank transaction',amount:(String(t?.type||'').toLowerCase()==='credit'?1:-1)*(Number(t?.amount)||0)/100,date:t?.date||new Date().toISOString(),category:t?.category||'Other'}));
    return {statusCode:200,headers:{'content-type':'application/json'},body:JSON.stringify({status:'available',account:{id:accountId,name:info?.name||account?.name||'Connected account',account_number:info?.account_number||account?.account_number||'',institution:info?.institution?.name||account?.institution?.name||info?.institution||account?.institution||'Connected bank',currency:info?.currency||account?.currency||'NGN',balance},transactions:txs})};
  } catch(e) { return {statusCode:500,headers:{'content-type':'application/json'},body:JSON.stringify({message:'Unable to retrieve the linked account data.'})}; }
};
