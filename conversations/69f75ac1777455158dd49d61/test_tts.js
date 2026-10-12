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
  // ── Gemini native TTS ──
  const b64=Buffer.from('PCM-DATA-HERE-123456').toString('base64');
  t('GEMINI_TTS_MODELS: 3.8 flash + lite',GEMINI_TTS_MODELS.map(m=>m.id).join()==='gemini-3.8-flash-tts,gemini-3.8-flash-lite-tts');
  setGeminiTTSModel('gemini-3.8-flash-lite-tts');setGeminiTTSVoice('Puck');
  t('persisted gemini tts model+voice',getGeminiTTSModel()==='gemini-3.8-flash-lite-tts'&&getGeminiTTSVoice()==='Puck');
  setGeminiTTSVoice('NotARealVoice');
  t('invalid voice rejected, stays Puck',getGeminiTTSVoice()==='Puck');
  // pcmToWavUrl: header correctness
  const url=pcmToWavUrl(b64,24000);
  t('pcmToWavUrl: data:audio/wav prefix',url.startsWith('data:audio/wav;base64,'));
  const hdr=Buffer.from(url.split(',')[1],'base64');
  t('pcmToWavUrl: RIFF/WAVE magic',hdr.slice(0,4).toString()==='RIFF'&&hdr.slice(8,12).toString()==='WAVE');
  t('pcmToWavUrl: 24kHz mono 16-bit header',hdr.readUInt32LE(24)===24000&&hdr.readUInt16LE(22)===1&&hdr.readUInt16LE(34)===16);
  t('pcmToWavUrl: payload intact',hdr.slice(44).toString()==='PCM-DATA-HERE-123456'&&hdr.readUInt32LE(40)===hdr.length-44);
  // geminiTTS success path
  FETCHES.push({ok:true,json:async()=>({candidates:[{content:{parts:[{inlineData:{data:b64,mimeType:'audio/L16;codec=pcm;rate=24000'}}]}}]})});
  const u0=USED;
  const wav=await geminiTTS('Hello narration');
  t('geminiTTS: returns WAV url + tracks usage',wav.startsWith('data:audio/wav;base64,')&&USED===u0+1);
  t('geminiTTS: sent AUDIO modality + voice+model url',LASTBODY.generationConfig.responseModalities[0]==='AUDIO'&&LASTBODY.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName==='Puck'&&/gemini-3\.8-flash-lite-tts/.test(LASTURL));
  // no-audio response → clear error
  FETCHES.push({ok:true,json:async()=>({candidates:[{content:{parts:[{text:'no audio'}]}}]})});
  let ea=null;try{await geminiTTS('x');}catch(e){ea=e;}
  t('geminiTTS: no-audio response → GEMINI_TTS_FAIL',ea?.code==='GEMINI_TTS_FAIL');
  // api error propagates message
  FETCHES.push({ok:false,status:429,json:async()=>({error:{message:'rate limited'}})});
  let eb=null;try{await geminiTTS('x');}catch(e){eb=e;}
  t('geminiTTS: api error message surfaces',eb?.code==='GEMINI_TTS_FAIL'&&/rate limited/.test(eb.msg));
  // no key
  KEY='';
  let ec=null;try{await geminiTTS('x');}catch(e){ec=e;}
  t('geminiTTS: NO_KEY without key',ec?.code==='NO_KEY');
  KEY='test-key';
  // quota
  USAGE=1500;
  let ed=null;try{await geminiTTS('x');}catch(e){ed=e;}
  t('geminiTTS: QUOTA at daily limit',ed?.code==='QUOTA');
  USAGE=0;
  console.log('=== '+pass+' passed, '+fail+' failed ===');
  process.exit(fail?1:0);
})();
`;
// safeLS used by setters must exist in scope
const pre="const safeLS=(k,v)=>localStorage.setItem(k,v);\n"+
  "let USED=0,USAGE=0,KEY='test-key';\n"+
  "const getKey=()=>KEY;const DAILY_LIMIT=1500;const getUsage=()=>USAGE;const trackUsage=()=>{USED++;USAGE++;};\n"+
  "const errMsg=e=>e?.msg||e?.message||'err';\n"+
  "const atob=b=>Buffer.from(b,'base64').toString('binary');const btoa2=s=>Buffer.from(s,'binary').toString('base64');\n"+
  "global.atob=atob;global.btoa=btoa2;\n"+
  "let FETCHES=[];let LASTURL=null,LASTBODY=null;global.fetch=async(u,o)=>{LASTURL=u;LASTBODY=o?JSON.parse(o.body):null;const r=FETCHES.shift();if(!r)throw new Error('unexpected fetch');return r;};\n";
eval(pre+block+'\n'+test);
