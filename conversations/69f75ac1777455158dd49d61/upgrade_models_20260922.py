from pathlib import Path
p=Path('/app/bookforge_jsx.jsx')
s=p.read_text()
def change(a,b,n=1):
 global s
 assert s.count(a)==n,(a[:80],s.count(a))
 s=s.replace(a,b,n)
change('const GEMINI_URL="https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";', '''// Only verified free-tier text models; project-specific quotas are shown in AI Studio.
const GEMINI_MODELS=[
  {id:"gemini-2.5-flash",label:"Gemini 2.5 Flash",desc:"Existing default, keeps current books on a familiar model"},
  {id:"gemini-3.8-flash",label:"Gemini 3.8 Flash",desc:"Newest Flash, free-tier eligible; actual project limits vary"},
  {id:"gemini-3.1-flash-lite",label:"Gemini 3.1 Flash-Lite",desc:"Lightweight, free-tier eligible"}
];
const getGeminiModel=()=>{const saved=localStorage.getItem("bfai_gemini_model");return GEMINI_MODELS.some(m=>m.id===saved)?saved:"gemini-2.5-flash";};
const setGeminiModel=m=>{if(GEMINI_MODELS.some(x=>x.id===m))safeLS("bfai_gemini_model",m);};
const geminiUrl=()=>`https://generativelanguage.googleapis.com/v1beta/models/${getGeminiModel()}:generateContent`;''')
change('  {id:"kilo",label:"Kilo Code (No Key! 200/hr)",desc:"Zero config — no API key, no account. Auto-routes to Nemotron 550B, Tencent Hy3, and more. 200 req/hr free."},\n','')
change('const getBackend=()=>localStorage.getItem("bfai_backend")||"puter"; // kilo default removed 2026-09-02: gateway dropped browser CORS', '''// Kilo's browser API lacks CORS. Keep old user data, but never route calls there.
const getBackend=()=>{const saved=localStorage.getItem("bfai_backend");return saved==="kilo"?"puter":saved||"puter";};''')
change('''  gemini:{
    creative:"gemini-2.5-flash",        // Only model available
    structured:"gemini-2.5-flash",
    short:"gemini-2.5-flash",
    reasoning:"gemini-2.5-flash",
    multilingual:"gemini-2.5-flash",
  },''','''  gemini:{
    creative:"gemini-2.5-flash", // The direct Gemini API follows the explicit user selection below.
    structured:"gemini-2.5-flash",
    short:"gemini-2.5-flash",
    reasoning:"gemini-2.5-flash",
    multilingual:"gemini-2.5-flash",
  },''')
change('const FAILOVER_ORDER=["groq","cloudflare","openrouter","huggingface","gemini","kilo","puter","cerebras"]; // cerebras demoted (free tier ended), OR+HF added 2026-09-17','const FAILOVER_ORDER=["groq","cloudflare","openrouter","huggingface","gemini","puter","cerebras"]; // Kilo is not browser-accessible; Cerebras is a paid trial, only available with a configured key')
change('  if(b==="kilo")return!KILO_SESSION_DEAD;','  if(b==="kilo")return false; // browser preflight lacks CORS; never select as fallback')
change('  if(b==="kilo")return true; // no key needed!','  if(b==="kilo")return false; // unreachable from browsers')
change('`${GEMINI_URL}?key=${key}`','`${geminiUrl()}?key=${key}`')
change('`${GEMINI_URL}?key=${draft.trim()}`','`${geminiUrl()}?key=${draft.trim()}`')
change('''                  <div className="flex gap-2">
                    <button onClick={testKey}''','''                  <label htmlFor="bfai-gemini-model" className="text-white/60 text-sm font-medium block mb-2">Direct Gemini text model</label>
                  <select id="bfai-gemini-model" value={getGeminiModel()} onChange={e=>{setGeminiModel(e.target.value);setBackendChanged(true);}} className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white text-sm mb-2 focus:outline-none focus:border-purple-500">
                    {GEMINI_MODELS.map(m=><option key={m.id} value={m.id} className="bg-gray-800">{m.label} — {m.desc}</option>)}
                  </select>
                  <p className="text-white/40 text-xs mb-4">All listed models have free-tier text access. Your project's actual RPM and daily limits may be lower than BookForge's 1,500/day safety cap. Check Google AI Studio for your limits.</p>
                  <div className="flex gap-2">
                    <button onClick={testKey}''')
change('''                  const badge=b.id==="kilo"||b.id==="puter"?''','''                  const badge=b.id==="puter"?''')
change('''                  const badgeColor=b.id==="kilo"||b.id==="puter"?''','''                  const badgeColor=b.id==="puter"?''')
change('No AI backend configured — open Settings to pick one (Kilo Code needs no key!).','No AI backend configured — open Settings to choose Puter.js or add a free API key.')
change('Settings: 8 AI backends (Puter.js no-key default, Groq, Gemini, Cloudflare, OpenRouter, HuggingFace, Kilo, Cerebras).','Settings: 7 AI backends (Puter.js no-key default, Groq, Gemini, Cloudflare, OpenRouter, HuggingFace, Cerebras).',3)
# Clear remaining misleading hardcoded references in visible settings and first-run.
change('if(getBackend()==="puter"||getBackend()==="kilo")setShowWelcome(true);','if(getBackend()==="puter")setShowWelcome(true);')
change('  {getBackend()==="kilo"&&<span className="text-xs text-green-400 font-medium px-2 py-1 bg-green-500/10 rounded-lg border border-green-500/20">🎁 Kilo Free</span>}', '',0) if False else None
p.write_text(s)
print('Updated Gemini chooser and disabled Kilo UI/failover')
