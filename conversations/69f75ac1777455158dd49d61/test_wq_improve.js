const fs=require('fs');
const src=fs.readFileSync('/app/bookforge_jsx.jsx','utf8');
const compiled=fs.readFileSync('/app/bookforge.html','utf8');
const tests=[];const t=(l,c)=>{tests.push([l,!!c]);console.log((c?'✅':'❌')+' '+l);};
// — extract rewriteChapterWithFeedback and eval it with stubs —
const a=src.indexOf('function cleanRewriteOutput');
const b=src.indexOf('function WritingQualityPanel');
let CALLS=[];
global.callAI=async(prompt,temp,opts)=>{CALLS.push(prompt);if(THROW_AI)throw THROW_AI;return RET_AI;};
global.AI_TELLS=["in that moment"];
let RET_AI="",THROW_AI=null,usage=0;
global.trackUsage=()=>{usage++;if(usage>=DAILY_LIMIT_U)throw{code:"QUOTA"};};
let DAILY_LIMIT_U=Infinity;global.quotaBlocked=()=>false;global.getUsage=()=>usage;
eval(src.slice(a,b));
(async()=>{
  RET_AI="word ".repeat(400);
  let out=await rewriteChapterWithFeedback({number:2,title:"Test",content:"word ".repeat(400)},{ai_tells_found:['"In that moment"'],overall_advice:"vary rhythm"},{title:"B",genre:"G"});
  t('returns rewrite + prompt carries tells, advice, rules, chapter text',out.startsWith("word")&&CALLS[0].includes('"In that moment"')&&CALLS[0].includes("EDITOR NOTE: vary rhythm")&&CALLS[0].includes("human-voice gate")&&CALLS[0].includes("word word"));
  RET_AI="short";
  let err=null;try{await rewriteChapterWithFeedback({number:2,title:"T",content:"word ".repeat(400)},null,{title:"B",genre:"G"});}catch(e){err=e;}
  t('too-short rewrite rejected with SHORT_REWRITE (original kept)',err?.code==="SHORT_REWRITE");
  THROW_AI={code:"QUOTA"};
  err=null;try{await rewriteChapterWithFeedback({number:2,title:"T",content:"word ".repeat(400)},null,{title:"B",genre:"G"});}catch(e){err=e;}
  t('QUOTA propagates from AI rewrite',err?.code==="QUOTA");
  THROW_AI=null;
  // — source/compiled wiring checks —
  t('improveWriting: 4 phases present with quota guards at each',(()=>{const slice=src.slice(src.indexOf('const improveWriting'),src.indexOf('const fixChapter'));return ['Analyzing chapter','Applying rewrite suggestions','Rewriting chapter','Re-checking the manuscript'].every(m=>slice.includes(m))&&(slice.match(/quotaBlocked\(\)/g)||[]).length>=3;})());
  t('improveWriting + fixChapter snapshot every overwrite',src.slice(src.indexOf('const improveWriting'),src.indexOf('const scoreChapter')).split('withVersionSnapshot').length>=3);
  t('improve button visible on failed verdict without rewrites (canImprove)',src.includes('const canImprove = writtenCount>0 && (hasRewrites || !msPassed || scoredCount===0)')&&src.includes('Improve My Writing — Analyze & Fix'));
  t('improve button also on Chapter-by-Chapter tab',src.slice(src.indexOf('CHAPTER-BY-CHAPTER TAB')).includes('improveWriting'));
  t('per-chapter Fix button wired to fixChapter',src.includes('onClick={()=>fixChapter(idx)}'));
  t('panel syncs with results written elsewhere (auto-build/queue)',src.includes('if(book.writing_quality)setChScores(book.writing_quality)')&&src.includes('if(book.manuscript_quality)setManuscript(book.manuscript_quality)'));
  t('compiled output carries the rewriter + fix wiring',compiled.includes('rewriteChapterWithFeedback')&&compiled.includes('fixChapter')&&(compiled.match(/withVersionSnapshot/g)||[]).length>=(src.match(/withVersionSnapshot/g)||[]).length-1);
  let bad=tests.filter(x=>!x[1]).length;console.log(`=== ${tests.length-bad}/${tests.length} passed ===`);if(bad)process.exitCode=1;
})().catch(e=>{console.error('HARNESS FAIL',e);process.exitCode=1;});
