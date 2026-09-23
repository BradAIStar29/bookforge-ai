const fs=require('fs');
const s=fs.readFileSync('/app/bookforge_jsx.jsx','utf8');
const tests=[];const check=(n,v)=>tests.push([n,!!v]);
const models=['gemini-2.5-flash','gemini-3.8-flash','gemini-3.1-flash-lite'];
const code=s.slice(s.indexOf('const GEMINI_MODELS='),s.indexOf('const DAILY_LIMIT='));
const ls={};
const localStorage={getItem:k=>ls[k]||null,setItem:(k,v)=>ls[k]=v};
const safeLS=(k,v)=>localStorage.setItem(k,v);
const x=new Function('localStorage','safeLS',code+';return {getGeminiModel,setGeminiModel,geminiUrl,GEMINI_MODELS};')(localStorage,safeLS);
check('Default preserves Gemini 2.5 Flash',x.getGeminiModel()===models[0]);
for(const m of models){x.setGeminiModel(m);check(`Model ${m} selected in actual URL`,x.getGeminiModel()===m&&x.geminiUrl().endsWith(`/models/${m}:generateContent`));}
x.setGeminiModel('not-a-real-model');check('Invalid model rejected',x.getGeminiModel()===models[2]);
check('Key test and generation share selected model URL',(s.match(/\$\{geminiUrl\(\)\}\?key=/g)||[]).length===2);
check('Kilo removed from backend picker and auto-failover',!s.slice(s.indexOf('const BACKENDS=['),s.indexOf('const KILO_URL')).includes('id:"kilo"')&&!s.match(/const FAILOVER_ORDER=\[[^\]]*"kilo"/));
check('Existing Kilo preference resolves to Puter',/saved==="kilo"\?"puter"/.test(s));
check('Key test respects usage cap and accounts for call',/const testKey=async\(\)=>\{[\s\S]{0,250}getUsage\(\)>=DAILY_LIMIT[\s\S]{0,250}trackUsage\(\)/.test(s));
let bad=0;for(const[n,v]of tests){console.log(`${v?'✅':'❌'} ${n}`);if(!v)bad++;}
console.log(`${tests.length-bad}/${tests.length} passed`);if(bad)process.exitCode=1;
