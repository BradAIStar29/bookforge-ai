const fs=require('fs');
const src=fs.readFileSync('/app/bookforge_jsx.jsx','utf8');
const compiled=fs.readFileSync('/app/bookforge.html','utf8');
const tests=[];const t=(l,c)=>{tests.push([l,!!c]);console.log((c?'✅':'❌')+' '+l);};
// — cleanRewriteOutput unit tests (eval-extracted) —
const a=src.indexOf('function cleanRewriteOutput');
const b=src.indexOf('async function rewriteChapterWithFeedback');
global.callAI=async()=>"";global.trackUsage=()=>{};
eval(src.slice(a,b));
t('strips markdown fences',cleanRewriteOutput('```markdown\nword word word\n```')==='word word word');
t('strips "Here\'s the rewritten chapter:" lead-in',cleanRewriteOutput("Here's the rewritten chapter:\nword word")==='word word');
t('strips "Rewritten Chapter 3:" header',cleanRewriteOutput('Rewritten Chapter 3: word word')==='word word');
t('leaves clean text untouched',cleanRewriteOutput('word word')==='word word');
t('tolerates null/empty',cleanRewriteOutput(null)===''&&cleanRewriteOutput("")==="" );
// — rewriteChapterWithFeedback uses the cleaner —
t('rewriteChapterWithFeedback pipes output through cleanRewriteOutput',src.slice(src.indexOf('async function rewriteChapterWithFeedback'),src.indexOf('function WritingQualityPanel')).includes('cleanRewriteOutput(await callAI'));
// — runFinishToCompletion source wiring —
const fi=src.indexOf('const runFinishToCompletion');
const fe=src.indexOf('const genChapter=async(idx)=>{');
const slice=src.slice(fi,fe);
const ei=src.indexOf('async function runImprovementRounds');
const ee=src.indexOf('function WritingQualityPanel');
const engine=src.slice(ei,ee);
t('finisher exists with finishing state + guards',src.includes('const [finishing,setFinishing]=useState(false);')&&slice.includes('if(quotaHit||isBuilding||finishing)return;')&&slice.includes('finally{setFinishing(false);}'));
t('stage 1 reuses runAutoBuild, stage 2 delegates to shared runImprovementRounds',slice.includes('await runAutoBuild(fb);')&&slice.includes('await runImprovementRounds(bookId,log,()=>setBook(getBook(bookId)))')&&engine.includes('for(let round=1;round<=3;round++)'));
t('gate thresholds 75 Review / 78 Writing enforced (engine + finisher stamps)',engine.includes('rv>=75&&wq>=78')&&slice.includes('(finalB.review?.overall_score||0)>=75&&(finalB.manuscript_quality?.overall_human_score||0)>=78')&&engine.includes('passed=(fb?.review?.overall_score||0)>=75&&(fb?.manuscript_quality?.overall_human_score||0)>=78'));
t('engine targets ≤3 weakest chapters, ≤2 AI rewrites, ≤2 analyses per round',engine.includes('.slice(0,3)')&&engine.includes('let budget=2;')&&engine.includes('analyzed>=2'));
t('finisher quota-guards every round + stamps final state',(engine.match(/quotaBlocked/g)||[]).length>=4&&engine.includes('getUsage()<DAILY_LIMIT-2')&&engine.includes('getUsage()<DAILY_LIMIT-6')&&slice.includes('upd({build_complete:true,gates_passed:passed')&&slice.includes('notifyDone('));
t('engine snapshots every chapter overwrite',(engine.match(/withVersionSnapshot/g)||[]).length>=2);
// — button wiring (3 surfaces) —
const btns=(src.match(/onClick=\{runFinishToCompletion\}/g)||[]).length;
t(`Finish Book button on all 3 surfaces (journey bar, resume banner, complete-not-passed banner)`,btns===3);
t('journey bar shows Finish before Go-to, disabled while running',src.includes('!j.allDone&&<button onClick={runFinishToCompletion}')&&src.includes('{finishing?<><Spin size="h-3 w-3"/>Finishing…</>:"🏁 Finish Book"}'));
t('resume banner guards against concurrent runs',src.includes('disabled={finishing||isBuilding||quotaHit}'));
// — series + queue + cloudflare integrations —
t('queue completes the dual gate: WQ check + improvement rounds after review',src.includes('runManuscriptHumanCheck(fq)')&&src.includes('await runImprovementRounds(id,m=>addLog(m))')&&src.includes('updateBook(id,{gates_passed:res.passed})')&&src.includes('gates_passed:false}); // dual-gate'));
t('queue review stamp no longer overstates gates_passed (review-only)',!src.includes('gates_passed:review.verdict==="PASS"'));
t('finishSeries exists: enqueues unfinished series books in order + autostarts',src.includes('const finishSeries=async(sid)=>')&&src.includes('!bk.build_complete||!bk.gates_passed')&&src.includes('bfai_queue_autostart\",\"1\")')||src.includes("localStorage.setItem(\"bfai_queue_autostart\",\"1\");navigate(\"queue\")"));
t('Finish Series button wired on series cards',src.includes('onClick={()=>finishSeries(series.id)}')&&src.includes('Finish Series'));
t('CF CORS guard: instant CF_CORS throw + session failover + revert',src.includes('code:"CF_CORS"')&&src.includes('CF_SESSION_DEAD=true;const next=nextAvailableBackend("cloudflare")')&&src.includes('if(b==="cloudflare")CF_SESSION_DEAD=false')&&src.includes('&&!CF_SESSION_DEAD'));
t('scene-mode rewrite: delimited passages with full-chapter fallback',src.includes('<<<P1>>>')&&src.includes('sceneMode=flagged.length>=2')&&src.includes('falls to the full rewrite')||src.includes('scene parse failed'));
// — compiled output —
t('compiled carries finisher + cleaner + buttons',(compiled.match(/runFinishToCompletion/g)||[]).length>=4&&compiled.includes('cleanRewriteOutput')&&(compiled.match(/onClick: runFinishToCompletion/g)||[]).length===3);
t('compiled: shared engine wired in 3 places, CF guard + series finisher live',(compiled.match(/runImprovementRounds/g)||[]).length>=3&&compiled.includes('CF_CORS')&&compiled.includes('finishSeries')&&compiled.includes('Finish Series'));
t('compiled journeyCtx injections still intact (11)',(compiled.match(/journeyCtx\(([1-9])/g)||[]).length===11);
let bad=tests.filter(x=>!x[1]).length;console.log(`=== ${tests.length-bad}/${tests.length} passed ===`);if(bad)process.exitCode=1;
