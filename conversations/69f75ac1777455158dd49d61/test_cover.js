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
const region=['getPuterImageModel','pollinationsCoverUrl','puterImageToUrl','genCoverImage'].map(grab).join('\n');
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
  Object.assign(envs,{localStorage,safeLS,Image,btoa,setTimeout,clearTimeout,puterWithTimeout});
  const api=new Function('envs',`
    const {localStorage,safeLS,Image,btoa,setTimeout,clearTimeout,puterWithTimeout}=envs;
    Object.defineProperty(globalThis,'puter',{get:()=>envs.puterAvail?envs.puterObj:null,configurable:true});
    ${region}
    return {getPuterImageModel,genCoverImage};
  `);
  return api(envs);
}

(async()=>{
  const store={};
  const opts={store,puterAvail:true,imgFail:false,calls:[],puterObj:{ai:{txt2img:async(prompt,o)=>{opts.calls.push(o.model);return{src:"data:image/jpeg;base64,AAAA"}}}}};
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

  let pass=0,fail=0;
  for(const[name,ok]of T){console.log((ok?'✅ ':'❌ ')+name);ok?pass++:fail++;}
  console.log(`=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail?1:0);
})().catch(e=>{console.error('TEST CRASH:',e.message);process.exit(1);});
