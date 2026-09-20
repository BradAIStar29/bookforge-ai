const fs=require('fs');
const compiled=fs.readFileSync('/app/bookforge.html','utf-8');
function grab(name){
  const re=new RegExp('(?:const|function|async function) '+name+'[ =(]');
  const m=re.exec(compiled);
  if(!m)throw new Error('missing '+name);
  // end = next top-level declaration (column-0) after this one
  const nxt=compiled.slice(m.index+10).search(/\n(?:const|function|async function|var|let|\/\*) /);
  const end=nxt<0?m.index+40000:m.index+10+nxt;
  return compiled.slice(m.index,end).trim();
}
const region=['getPuterImageModel','pollinationsCoverUrl','puterImageToUrl','puterTxt2ImgGuarded','genCoverImage'].map(grab).join('\n');
for(const n of ['getPuterImageModel','pollinationsCoverUrl','puterImageToUrl','genCoverImage']){
  new Function('x',grab(n)); // syntax sanity
}

function makeEnv(opts){
  const store=opts.store;
  const localStorage={getItem:k=>k in store?store[k]:null,setItem:(k,v)=>{store[k]=String(v)}};
  const safeLS=(k,v)=>localStorage.setItem(k,v);
  const Image=class{constructor(){this.onload=null;this.onerror=null;} set src(v){const I=this;setTimeout(()=>{opts.imgFail?I.onerror&&I.onerror():I.onload&&I.onload();},5);}};
  const btoa=s=>Buffer.from(s).toString('base64');
  const puterWithTimeout=async fn=>fn();
  // envs IS opts (live object) so puterAvail/imgFail flips apply mid-run
  const envs=opts;
  Object.assign(envs,{localStorage,safeLS,Image,btoa,setTimeout,clearTimeout,puterWithTimeout,PUTER_PENDING_REJECTS:new Set()});
  const api=new Function('envs',`
    const {localStorage,safeLS,Image,btoa,setTimeout,clearTimeout,puterWithTimeout}=envs;
    let PUTER_LOW_BALANCE=envs.PUTER_LOW_BALANCE;
    const PUTER_PENDING_REJECTS=envs.PUTER_PENDING_REJECTS;
    Object.defineProperty(globalThis,'puter',{get:()=>envs.puterAvail?envs.puterObj:null,configurable:true});
    ${region}
    return {getPuterImageModel,genCoverImage};
  `);
  return api(envs);
}

(async()=>{
  const store={};
  const opts={store,puterAvail:true,imgFail:false,calls:[],PUTER_LOW_BALANCE:false,puterObj:{ai:{txt2img:async(prompt,o)=>{opts.calls.push(o.model);return{src:"data:image/jpeg;base64,AAAA"}}}}};
  const api=makeEnv(opts);
  const T=[];const t=(n,c)=>T.push([n,c]);

  const r1=await api.genCoverImage('a cozy mystery cover',{});
  t('fresh default -> FLUX.2 Pro via Puter',opts.calls[0]==='black-forest-labs/flux-2-pro'&&r1.url==='data:image/jpeg;base64,AAAA'&&r1.method==='puter');

  opts.puterAvail=false;
  const r2=await api.genCoverImage('test prompt',{width:1400,height:2100});
  t('puter unavailable -> Pollinations URL fallback',r2.method==='url'&&r2.url.startsWith('https://image.pollinations.ai/prompt/')&&r2.url.includes('width=1400')&&r2.url.includes('height=2100'));
  opts.puterAvail=true;

  store['bfai_puter_image_model']='pollinations';store['bfai_cover_model_migrated']='1';
  opts.calls=[];opts.imgFail=true;
  const r3=await api.genCoverImage('test2');
  t('Pollinations chosen+down -> Puter FLUX.2 Pro fallback',opts.calls[0]==='black-forest-labs/flux-2-pro'&&r3.method==='puter');

  opts.puterAvail=false;
  const r4=await api.genCoverImage('test3');
  t('all services down -> placeholder SVG (no crash)',r4.method==='fallback'&&r4.url.startsWith('data:image/svg+xml;base64,'));
  opts.puterAvail=true;opts.imgFail=false;

  delete store['bfai_cover_model_migrated'];
  opts.calls=[];
  const r5=await api.genCoverImage('migrate test');
  t('legacy pollinations migrated -> FLUX.2 Pro',opts.calls[0]==='black-forest-labs/flux-2-pro'&&store['bfai_puter_image_model']==='black-forest-labs/flux-2-pro'&&store['bfai_cover_model_migrated']==='1');

  store['bfai_puter_image_model']='pollinations';
  const r6=await api.genCoverImage('stick test');
  t('explicit Pollinations re-selection sticks',r6.method==='url');

  // 7. session low-balance + flux chosen + puter alive → skips Puter, straight to Pollinations, no txt2img call
  opts.PUTER_LOW_BALANCE=true;opts.puterAvail=true;
  opts.calls=[];opts.imgFail=false;
  const r7=await api.genCoverImage('low balance cover');
  t('session low-balance → straight to Pollinations (no Puter call)',r7.method==='url'&&opts.calls.length===0);
  opts.PUTER_LOW_BALANCE=false;

  // 8. txt2img HANGS, watcher-style registry rejection fires mid-call → instant Pollinations fallback
  opts.puterAvail=true;opts.calls=[];
  const hangObj={ai:{txt2img:async()=>new Promise(()=>{})}}; // never settles, like a real low-balance hang
  opts.puterObj=hangObj;
  const r8p=api.genCoverImage('hang test');
  await new Promise(r=>setTimeout(r,10));
  // the guarded call registered its reject — fire it exactly like the DOM watcher does
  for(const rej of opts.PUTER_PENDING_REJECTS){rej({code:'PUTER_LOW_BALANCE',msg:'balance exhausted'});}
  const r8=await r8p;
  t('hung txt2img + registry rejection → instant Pollinations fallback',r8.method==='url');
  opts.puterObj={ai:{txt2img:async(prompt,o)=>{opts.calls.push(o.model);return{src:'data:image/jpeg;base64,AAAA'}}}};

  let pass=0,fail=0;
  for(const[name,ok]of T){console.log((ok?'✅ ':'❌ ')+name);ok?pass++:fail++;}
  console.log(`=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail?1:0);
})().catch(e=>{console.error('TEST CRASH:',e.message);process.exit(1);});
