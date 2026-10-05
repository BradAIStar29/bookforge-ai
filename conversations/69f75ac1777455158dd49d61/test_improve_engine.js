const fs=require('fs');
const src=fs.readFileSync('/app/bookforge_jsx.jsx','utf8');
const a=src.indexOf('function cleanRewriteOutput');
const b=src.indexOf('function WritingQualityPanel');
const tests=[];const t=(l,c)=>{tests.push([l,!!c]);console.log((c?'✅':'❌')+' '+l);};
// ── stubs for the eval'd module code ──
const AI_TELLS=["in that moment","couldn't help but"];
var DAILY_LIMIT=1500;
let RET_AI="",PROMPTS=[],CF_FAIL_ONCE=false;
let RET_AI_2="";const callAI=async(p)=>{PROMPTS.push(p);return(PROMPTS.length>1&&RET_AI_2)?RET_AI_2:RET_AI;};
const trackUsage=()=>{};
let quotaBlocked=()=>false;
let USAGE=0;const getUsage=()=>USAGE;
const withVersionSnapshot=(ch,reason)=>({...ch,_snap:reason});
// fake book store
let BOOK=null;
const getBook=()=>BOOK;
const updateBook=(id,updates)=>{BOOK={...BOOK,...updates};return BOOK;};
let REVIEW_RET={overall_score:80},ANALYZE_RET={human_score:50,ai_tells_found:[],rewrite_examples:[]},MS_RET={overall_human_score:80};
const runReviewAgent=async()=>({...REVIEW_RET});
const analyzeChapterHumanness=async()=>({...ANALYZE_RET});
const runManuscriptHumanCheck=async()=>({...MS_RET});
eval(src.slice(a,b));
(async()=>{
  // ── Scene mode: only 2 of 6 paragraphs flagged → those only get rewritten ──
  const L=n=>Array.from({length:n},(_,i)=>"w"+i).join(" ");
  const paras=[L(20),L(20),"In that moment he froze. "+L(20),L(20),L(20),"couldn't help but sigh. "+L(20)];
  const ch={number:1,title:"T",content:paras.join("\n\n")};
  RET_AI="<<<P1>>>\nREWRITTEN ONE "+L(20)+"\n<<<END>>>\n<<<P2>>>\nREWRITTEN TWO "+L(20)+"\n<<<END>>>";
  PROMPTS.length=0;
  const out=await rewriteChapterWithFeedback(ch,{ai_tells_found:['"In that moment he froze."','"couldn\'t help but sigh."']},{title:"B",genre:"G"});
  const outParas=out.split("\n\n");
  t('scene mode: only flagged passages rewritten, rest untouched',outParas[0]===paras[0]&&outParas[2].startsWith("REWRITTEN ONE")&&outParas[5].startsWith("REWRITTEN TWO")&&outParas[1]===paras[1]);
  t('scene mode: single small call with delimited format (no full CHAPTER TEXT)',PROMPTS.length===1&&PROMPTS[0].includes("<<<P1>>>")&&!PROMPTS[0].includes("CHAPTER TEXT:"));
  // ── Full mode: tells everywhere (>60% words flagged) ──
  const allBad=Array.from({length:6},()=> "In that moment he couldn't help but feel the weight. "+L(20)).join("\n\n");
  RET_AI="FULL REWRITE "+("word ".repeat(300));
  PROMPTS.length=0;
  const out2=await rewriteChapterWithFeedback({number:1,title:"T",content:allBad},{ai_tells_found:['"In that moment"']},{title:"B",genre:"G"});
  t('full mode when tells dominate: whole chapter rewritten',out2.startsWith("FULL REWRITE")&&PROMPTS[0].includes("CHAPTER TEXT:"));
  // ── Scene parse failure → falls back to full rewrite ──
  RET_AI="junk without delimiters at all";
  PROMPTS.length=0;
  const ch3={number:1,title:"T",content:paras.join("\n\n")};
  globalThis.L=L;
  let out3=null;
  try{out3=await rewriteChapterWithFeedback(ch3,{ai_tells_found:['"In that moment he froze."']},{title:"B",genre:"G"});}catch(e){}
  t('scene parse failure → falls back to full rewrite (2 calls, no data loss)',PROMPTS.length===2&&PROMPTS[1].includes("CHAPTER TEXT:"));
  // ── scene rewrite rejected when it carries MORE AI tells than the original ──
  RET_AI="<<<P1>>>\nIn that moment the rewritten passage is stuffed with in that moment tells\n<<<END>>>";
  RET_AI_2="FULL REWRITE "+L(400);
  PROMPTS.length=0;
  const out4=await rewriteChapterWithFeedback(ch,{ai_tells_found:['"In that moment he froze."']},{title:"B",genre:"G"});
  t('tell-heavy rewrite rejected → falls back to full rewrite (original preserved)',PROMPTS.length===2&&PROMPTS[1].includes("CHAPTER TEXT:")&&out4.startsWith("FULL REWRITE"));

  // ── runImprovementRounds: review fix + writing fix until gates pass ──
  BOOK={id:"bk",title:"Old",genre:"G",review:{overall_score:60,title_suggestions:["New Title: The Sub"],keyword_suggestions:["k1","k2"],seo_rewrite:"new desc"},manuscript_quality:{overall_human_score:60},writing_quality:{},chapters:paras.map((p,i)=>({number:i+1,title:"C"+i,content:p+" filler ".repeat(30),generated:true}))};
  REVIEW_RET={overall_score:80};ANALYZE_RET={human_score:50,ai_tells_found:[],rewrite_examples:[]};MS_RET={overall_human_score:80};
  USAGE=0;
  const logs=[];
  const res=await runImprovementRounds("bk",m=>logs.push(m));
  t('rounds: review suggestions applied, gates reach 75/78 → passed',res.passed===true&&res.rv===80&&res.wq===80&&BOOK.title==="New Title"&&BOOK.subtitle==="The Sub"&&BOOK.seo_keywords==="k1, k2");
  t('rounds: logs narrate each step',logs.some(l=>l.includes("Applying Review Agent suggestions"))&&logs.some(l=>l.includes("Improvement round 1")));
  // ── Quota: stops immediately, honest result ──
  BOOK={id:"bk2",review:{overall_score:60},manuscript_quality:{overall_human_score:60},chapters:[]};
  quotaBlocked=()=>true; // force quota on for this scenario
  const res2=await runImprovementRounds("bk2",()=>{});
  quotaBlocked=()=>false;
  t('quota reached → rounds stop, passed=false honestly',res2.passed===false&&res2.rv===60&&res2.wq===60);
  let bad=tests.filter(x=>!x[1]).length;console.log(`=== ${tests.length-bad}/${tests.length} passed ===`);if(bad)process.exitCode=1;
})().catch(e=>{console.error('HARNESS FAIL',e);process.exitCode=1;});
