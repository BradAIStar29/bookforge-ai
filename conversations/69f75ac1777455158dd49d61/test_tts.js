const fs=require('fs');
const src=fs.readFileSync('/app/bookforge_jsx.jsx','utf8');
const start=src.indexOf('const PUTER_TTS_PROVIDERS');
const end=src.indexOf('const PUTER_IMAGE_MODELS');
const block=src.slice(start,end);
global.localStorage={_:{},getItem(k){return this._[k]??null},setItem(k,v){this._[k]=v}};
const calls=[];
global.puter={ai:{txt2speech:async(text,opts)=>{calls.push({text,opts});if(typeof opts==='object')return{play:()=>{}};throw new Error('legacy-only');}}};
const test=`
let pass=0,fail=0;const t=(l,c)=>{c?pass++:fail++;console.log((c?'✅':'❌')+' '+l)};
t('PUTER_TTS_PROVIDERS: 3 providers with voices',PUTER_TTS_PROVIDERS.length===3&&PUTER_TTS_PROVIDERS.every(p=>p.voices.length>0));
t('default provider+voice',getPuterTTSProvider()==='openai'&&getPuterTTSVoice()==='alloy');
setPuterTTSProvider('elevenlabs');setPuterTTSVoice('Rachel');
t('persisted provider+voice',getPuterTTSProvider()==='elevenlabs'&&getPuterTTSVoice()==='Rachel');
(async()=>{
  const audio=await puterTTS('Hello world');
  t('puterTTS: engine+voice passed through',calls[0].opts.engine==='elevenlabs'&&calls[0].opts.voice==='Rachel');
  t('puterTTS: returns playable object',typeof audio.play==='function');
  calls.length=0;
  puter.ai.txt2speech=async(text,opts)=>{if(typeof opts==='object')throw new Error('400 unsupported param');calls.push({text,opts});return{play:()=>{},legacy:true};};
  const a2=await puterTTS('Test');
  t('puterTTS: legacy positional fallback on 400',a2.legacy===true&&calls[0].opts==='Rachel');
  console.log('=== '+pass+' passed, '+fail+' failed ===');
  process.exit(fail?1:0);
})();
`;
// safeLS used by setters must exist in scope
const pre="const safeLS=(k,v)=>localStorage.setItem(k,v);\n";
eval(pre+block+'\n'+test);
