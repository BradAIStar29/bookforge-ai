const fs=require('fs');
const src=fs.readFileSync('/app/bookforge_jsx.jsx','utf8');

// ── extract callAIEdit + freeEditBackend block ──
const a=src.indexOf('const EDIT_FREE_ORDER=');
const b=src.indexOf('async function callAIStream');
if(a<0||b<0||b<a)throw new Error('routing block not found');

// ── extract move fns block ──
const c=src.indexOf('const chaptersWordCount=');
const d=src.indexOf('// 🔍 OVERUSED WORDS ANALYZER');
if(c<0||d<0||d<c)throw new Error('move block not found');

let tcall=0,pass=0,fail=0;
const t=(l,cond)=>{cond?pass++:fail++;console.log((cond?'✅ ':'❌ ')+l);};

// ── Part 1: quota-saver routing ──
{
  const AI_CALLS=[];
  let BACKEND='gemini', AVAILABLE={};
  const env=`
    const getBackend=()=>${JSON.stringify('PLACEHOLDER')};
    const backendAvailable=b=>(${JSON.stringify('AVAIL')})[b]||false;
    const callAI=async(prompt,temp,opts)=>{AI_CALLS.push({prompt,temp,opts});return 'AI-RESULT';};
    ${src.slice(a,b)}
    return {callAIEdit,freeEditBackend};
  `;
  const mk=(backend,avail)=>new Function('AI_CALLS',env.replace('\"PLACEHOLDER\"',JSON.stringify(backend)).replace('\"AVAIL\"',JSON.stringify(avail)))(AI_CALLS);
  let r=mk('gemini',{groq:true});
  r.callAIEdit('fix this',0.7,{task:'creative'});
  t('gemini configured + groq key → edits forced to groq',AI_CALLS[0].opts.__forceBackend==='groq');
  t('edit call passes prompt+temperature through',AI_CALLS[0].prompt==='fix this'&&AI_CALLS[0].temp===0.7);

  AI_CALLS.length=0;
  r=mk('gemini',{openrouter:true,cloudflare:true});
  r.callAIEdit('x');
  t('groq missing → prefers openrouter next',AI_CALLS[0].opts.__forceBackend==='openrouter');

  AI_CALLS.length=0;
  r=mk('gemini',{});
  r.callAIEdit('x');
  t('no free keys → falls back to configured backend (no force)',AI_CALLS[0].opts.__forceBackend===undefined);

  AI_CALLS.length=0;
  r=mk('groq',{openrouter:true});
  r.callAIEdit('x');
  t('already-free backend configured → no rerouting',AI_CALLS[0].opts.__forceBackend===undefined);

  AI_CALLS.length=0;
  r=mk('puter',{groq:true,cloudflare:true});
  t('puter (user-pays) + free key → edit rerouted',r.freeEditBackend()==='groq');

  AI_CALLS.length=0;
  r=mk('gemini',{huggingface:true});
  t('huggingface honored in order after groq/openrouter',r.freeEditBackend()==='huggingface');
  t('cerebras excluded from edit routing (paid trial)',src.includes('const EDIT_FREE_ORDER=["groq","openrouter","huggingface","cloudflare"]'));
}

// ── Part 2: zero-API chapter/book moves ──
{
  const BOOKS={
    b1:{id:'b1',title:'Book One',chapters:[
      {number:1,title:'Intro',content:'one two three four five',generated:true,versions:[{content:'old'}]},
      {number:2,title:'Second',content:'six seven eight',generated:true},
      {number:3,title:'Third',content:'nine ten',generated:true}]},
    b2:{id:'b2',title:'Book Two',chapters:[
      {number:1,title:'B2 Ch1',content:'alpha beta',generated:true}]},
  };
  const SERIES=[{id:'s1',name:'My Series'},{id:'s2',name:'Other Series'}];
  const upd={};
  const getBook=id=>BOOKS[id]||null;
  const updateBook=(id,o)=>{BOOKS[id]={...BOOKS[id],...o};upd[id]=o;return BOOKS[id];};
  const getSeries=()=>SERIES;
  const fn=new Function('getBook','updateBook','getSeries','AI_CALLS',`
    ${src.slice(c,d)}
    return {moveChapterToBook,moveBookToSeries,chaptersWordCount};
  `)(getBook,updateBook,getSeries,[]);
  const {moveChapterToBook,moveBookToSeries,chaptersWordCount}=fn;

  // move b1 ch2 (idx 1) to b2
  const r=moveChapterToBook('b1',1,'b2',false);
  t('move: ok',r.ok===true&&r.copy===false);
  t('move: removed from source + renumbered (1,2 remain)',BOOKS.b1.chapters.length===2&&BOOKS.b1.chapters[0].title==='Intro'&&BOOKS.b1.chapters[1].number===2);
  t('move: appended to target with fresh number',BOOKS.b2.chapters.length===2&&BOOKS.b2.chapters[1].number===2&&BOOKS.b2.chapters[1].title==='Second');
  t('move: version history NOT carried over',BOOKS.b2.chapters[1].versions===undefined);
  t('move: word_count stamped both sides',upd.b1.word_count===7&&upd.b2.word_count===5);

  // copy b2 ch1 (idx 0) to b1
  const r2=moveChapterToBook('b2',0,'b1',true);
  t('copy: ok + copy flag',r2.ok===true&&r2.copy===true);
  t('copy: source untouched',BOOKS.b2.chapters.length===2);
  t('copy: destination appended',BOOKS.b1.chapters.length===3&&BOOKS.b1.chapters[2].number===3);

  // guards
  t('same-book move rejected',moveChapterToBook('b1',0,'b1',false).ok===false);
  t('bad index rejected',moveChapterToBook('b1',99,'b2',false).ok===false);
  t('missing book rejected',moveChapterToBook('nope',0,'b2',false).ok===false);
  t('generated flag set on moved chapter',BOOKS.b2.chapters[1].generated===true);

  // series move
  const mb=moveBookToSeries('b1','s1');
  t('moveBookToSeries: stamps id + name',mb.series_id==='s1'&&mb.series_name==='My Series');
  const mb2=moveBookToSeries('b1',null);
  t('moveBookToSeries: null clears',mb2.series_id===null&&mb2.series_name==='');
  t('chaptersWordCount: empty/blank safe',chaptersWordCount([{content:'   '},{}, {content:'a b c'}])===3);
}

console.log(`=== ${pass} passed, ${fail} failed ===`);
process.exit(fail?1:0);
