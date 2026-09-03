const fs=require('fs');
const src=fs.readFileSync('/app/bookforge_jsx.jsx','utf8');
const start=src.indexOf('const BACKEND_EXHAUSTED');
const end=src.indexOf('// ── Test Connection');
const block=src.slice(start,end);

// ── app-global stubs ──
var KILO_SESSION_DEAD=false, PUTER_LOW_BALANCE=false, DAILY_LIMIT=1500;
let CONFIG={backend:"groq",groqKey:"gk",cerebrasKey:"ck",cfId:"",cfTok:"",gemKey:"",usage:0};
let FAILMAP={}; // backend → error to throw
const CALLS=[];
const NOTICES=[];global.window={dispatchEvent:e=>NOTICES.push(e.detail?.msg||e.detail?.reason),CustomEvent:function(t,d){this.detail=d?d.detail:null;return this;}};
const getBackend=()=>CONFIG.backend;
const getGroqKey=()=>CONFIG.groqKey, getCerebrasKey=()=>CONFIG.cerebrasKey;
const getCloudflareAccountId=()=>CONFIG.cfId, getCloudflareToken=()=>CONFIG.cfTok;
const getKey=()=>CONFIG.gemKey, getUsage=()=>CONFIG.usage;
const kiloFailureShouldFailover=e=>e?.code==="KILO_ERROR"||e?.code==="TIMEOUT";
const notifyBackendSwitch=()=>{}, notifyPuterLowBalance=()=>{};
const mk=b=>(prompt,temp,opts)=>{CALLS.push(b);if(FAILMAP[b])throw FAILMAP[b];const res=b+"-result";if(opts&&opts.onStream)opts.onStream(res);return res;};
const callGroq=mk("groq"),callCerebras=mk("cerebras"),callCloudflare=mk("cloudflare");
const callGemini=mk("gemini"),callPuter=mk("puter"),callKilo=mk("kilo");

eval(block); // defines BACKEND_EXHAUSTED, callAI, callAIStream, etc.

const test=`let pass=0,fail=0;const t=(l,c)=>{c?pass++:fail++;console.log((c?'✅':'❌')+' '+l)};
(async()=>{
  // 1. Groq 429 → Cerebras takes over
  FAILMAP={groq:{code:"QUOTA",msg:"rate limit"}};
  CALLS.length=0;
  const r1=await callAI("hi");
  t('groq QUOTA → routed to cerebras',r1==="cerebras-result"&&CALLS.join(",")==="groq,cerebras");
  t('groq marked exhausted',backendExhausted("groq")===true);

  // 2. groq still exhausted — next call skips it entirely (no wasted 429)
  CALLS.length=0;
  const r2=await callAI("hi again");
  t('exhausted backend skipped on next call',CALLS[0]==="cerebras"&&CALLS.length===1);

  // 3. Chain: cerebras also QUOTA → cloudflare (creds configured)
  CONFIG={backend:"groq",groqKey:"gk",cerebrasKey:"ck",cfId:"cfid",cfTok:"cftok",gemKey:"",usage:0};
  BACKEND_EXHAUSTED.clear();
  FAILMAP={groq:{code:"QUOTA"},cerebras:{code:"QUOTA"}};
  CALLS.length=0;
  const r3=await callAI("hi");
  t('2-hop chain groq→cerebras→cloudflare',r3==="cloudflare-result"&&CALLS.join(",")==="groq,cerebras,cloudflare");

  // 4. No backend with capacity → QUOTA surfaces (no hang, no loop)
  BACKEND_EXHAUSTED.clear();
  CONFIG={backend:"groq",groqKey:"gk",cerebrasKey:"",cfId:"",cfTok:"",gemKey:"",usage:0};
  FAILMAP={groq:{code:"QUOTA"},puter:{code:"PUTER_LOW_BALANCE"},kilo:{code:"KILO_ERROR"}};
  let r4=null;try{r4=await callAI("x");}catch(e){r4=e;}
  t('all limits hit → terminates with a clear error (no loop/hang)',r4?.code==="QUOTA"||r4?.code==="PUTER_LOW_BALANCE");

  // 5. Streaming path failover with onStream
  BACKEND_EXHAUSTED.clear();
  CONFIG={backend:"groq",groqKey:"gk",cerebrasKey:"ck",cfId:"",cfTok:"",gemKey:"",usage:0};
  FAILMAP={groq:{code:"QUOTA"}};
  CALLS.length=0;
  let streamed=[];
  const r5=await callAIStream("hi",0.8,{onStream:txt=>streamed.push(txt)});
  t('stream: groq QUOTA → cerebras delivers stream',r5==="cerebras-result"&&streamed[0]==="cerebras-result"&&CALLS[0]==="groq"&&CALLS[1]==="cerebras");

  // 6. Gemini daily limit mid-chain → puter
  BACKEND_EXHAUSTED.clear();
  CONFIG={backend:"gemini",groqKey:"",cerebrasKey:"",cfId:"",cfTok:"",gemKey:"gk2",usage:1500};
  FAILMAP={};
  CALLS.length=0;
  const r6=await callAI("hi");
  t('gemini usage at limit → skipped upfront, routed to puter',r6==="puter-result"&&CALLS[0]==="puter"&&CALLS.length===1);

  // 7. Exhaustion mark expiry — capacity returns after 10 min
  BACKEND_EXHAUSTED.clear();
  markBackendExhausted("groq",5); // 5ms
  await new Promise(res=>setTimeout(res,20));
  t('expired marks are cleared',backendExhausted("groq")===false&&BACKEND_EXHAUSTED.size===0);

  // 8. AUTO-REVERT — mark expires, next call returns to original + notice
  BACKEND_EXHAUSTED.clear();LAST_FAILOVER_FROM.clear();
  CONFIG={backend:"groq",groqKey:"gk",cerebrasKey:"ck",cfId:"",cfTok:"",gemKey:"",usage:0};
  FAILMAP={groq:{code:"QUOTA"}};
  NOTICES.length=0;
  await callAI("first");
  const wasRouted=CALLS[CALLS.length-1]==="cerebras"&&NOTICES.some(m=>/auto-switching to cerebras/.test(m));
  markBackendExhausted("groq",5);
  await new Promise(res=>setTimeout(res,20));
  FAILMAP={};CALLS.length=0;
  const r8=await callAI("second");
  t('auto-revert: back on original after limit reset',r8==="groq-result"&&CALLS[0]==="groq"&&CALLS.length===1);
  t('auto-revert: routing-restored notice fired',NOTICES.some(m=>/routing restored to groq/.test(m)));
  t('auto-revert: happened after a real switch',wasRouted===true);

  // 9. MANUAL revert
  BACKEND_EXHAUSTED.clear();LAST_FAILOVER_FROM.clear();
  FAILMAP={groq:{code:"QUOTA"}};
  await callAI("third");
  clearBackendFailover("groq");
  FAILMAP={};CALLS.length=0;
  const r9=await callAI("fourth");
  t('manual revert: immediate switch back',r9==="groq-result"&&CALLS[0]==="groq"&&CALLS.length===1);

  // 10. failoverStatus
  BACKEND_EXHAUSTED.clear();LAST_FAILOVER_FROM.clear();
  FAILMAP={groq:{code:"QUOTA"}};
  await callAI("fifth");
  const st=failoverStatus();
  t('failoverStatus: routed while exhausted',st.original==="groq"&&st.routedTo==="cerebras"&&st.exhaustedFor>0);
  clearBackendFailover("groq");
  const st2=failoverStatus();
  t('failoverStatus: back to original after revert',st2.original==="groq"&&st2.routedTo==="groq");

  // 11. Puter low-balance revert clears session flag
  BACKEND_EXHAUSTED.clear();LAST_FAILOVER_FROM.clear();
  CONFIG={backend:"puter",groqKey:"gk",cerebrasKey:"ck",cfId:"",cfTok:"",gemKey:"",usage:0};
  FAILMAP={puter:{code:"PUTER_LOW_BALANCE"}};
  await callAI("puter-call");
  PUTER_LOW_BALANCE=true; // the DOM watcher sets this in the real app
  t('puter low balance → flagged unavailable',backendAvailable("puter")===false);
  clearBackendFailover("puter");
  t('revert clears PUTER_LOW_BALANCE flag',backendAvailable("puter")===true);
  t('gemini still key-guarded after reverts',backendAvailable("gemini")===false);

  console.log(\`\n=== \${pass} passed, \${fail} failed ===\`);
  process.exit(fail?1:0);
})();
`;
eval(block+"\n"+test);
