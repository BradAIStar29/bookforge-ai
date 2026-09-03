// Behavioral test of the 5 repaired functions — real execution in Node with browser stubs
const fs=require('fs');
const src=fs.readFileSync('/app/bookforge_jsx.jsx','utf8');
function extract(name){
  const start=src.indexOf(`function ${name}`);
  if(start===-1)throw new Error('not found: '+name);
  // brace-match from first { after signature
  let i=src.indexOf('{',start),depth=0,end=-1;
  for(let j=i;j<src.length;j++){
    if(src[j]==='{')depth++;
    else if(src[j]==='}'){depth--;if(depth===0){end=j+1;break;}}
  }
  return src.slice(start,end);
}
// ── stubs ──
const alerts=[],printed=[],saved=[],downloads=[],removed=[];
const fakeElem=()=>({style:{cssText:'',set:()=>{}},setAttribute(){},remove(){removed.push(1)},click(){},appendChild(){},innerHTML:'',appendChildChild:null});
const sandbox={};
global.window={print:()=>printed.push('print'),setTimeout};
global.document={createElement:()=>fakeElem(),body:{appendChild:el=>{sandbox.printArea=el}},};
global.alert=m=>alerts.push(m);
global.URL={createObjectURL:()=>"blob:fake-"+Math.random(),revokeObjectURL:()=>{}};
global.Blob=class{constructor(parts,opts){this.parts=parts;this.type=opts&&opts.type;}};
global.localStorage={_:{},getItem(k){return this._[k]??null},setItem(k,v){this._[k]=v},removeItem(k){delete this._[k]}};
// app helper stubs
const books=[];
const getBook=id=>books.find(b=>b.id===id);
const getBooks=()=>books;
const setBooks=v=>{saved.push(v.length||0);if(v!==books){books.length=0;books.push(...v);}};
const getAuthorProfile=()=>({name:'Test Author'});
const updateBook=(id,data)=>{const b=getBook(id);if(!b)throw new Error('no book '+id);Object.assign(b,data);return b};
const makeId=()=>'bk_'+Date.now();

const testBook={id:'bk_1',title:'Test Book',subtitle:'A Sub',chapters:[
  {number:1,title:'Alpha',generated:true,content:'The quick fox jumped quickly. The fox was very sly, and the fox ran. The fox was very very sneaky indeed, and she said the words she always said.'},
  {number:2,title:'Beta',generated:true,content:('The shadow moved through the trees. '.repeat(16)+'Suddenly he turned. '.repeat(9)+'A shadow is just light denied. ').repeat(1)},
  {number:3,title:'Gamma',generated:false,content:''}
]};
books.push(testBook);

// eval the five functions in this scope
const fns=['downloadPDF','downloadMarkdown','duplicateBook','reorderChapters','analyzeOverusedWords']
  .map(extract).join('\n');
eval(fns.replace(/document\.body\.appendChild\(printArea\)/,'document.body.appendChild(printArea)'));

let pass=0,fail=0;
const t=(label,cond)=>{cond?pass++:fail++;console.log((cond?'✅':'❌')+' '+label)};

// 1. downloadPDF — should append print area + call window.print (has 2 generated chapters)
downloadPDF(testBook);
t('downloadPDF: invoked window.print',printed.length===1);
t('downloadPDF: built print area with title',sandbox.printArea&&sandbox.printArea.innerHTML.includes('Test Book'));
t('downloadPDF: skipped ungenerated ch3',sandbox.printArea&&!sandbox.printArea.innerHTML.includes('Gamma'));

// 2. downloadMarkdown — markdown content with 2 chapters + TOC
let mdCapture='';
global.Blob=class{constructor(parts,opts){mdCapture=parts.join('');this.type=opts&&opts.type}};
downloadMarkdown(testBook);
t('downloadMarkdown: has title header',mdCapture.includes('# Test Book'));
t('downloadMarkdown: has both chapters',mdCapture.includes('## Chapter 1: Alpha')&&mdCapture.includes('## Chapter 2: Beta'));
t('downloadMarkdown: has TOC links',mdCapture.includes('[Chapter 1: Alpha](#chapter-1)'));

// 3. duplicateBook — copy created, flags reset, added to list
const newId=duplicateBook('bk_1');
t('duplicateBook: returned new id',newId&&newId!=='bk_1');
t('duplicateBook: copy in library with (Copy) title',books.some(b=>b.id===newId&&b.title==='Test Book (Copy)'));
t('duplicateBook: flags reset (needs_outline, gates_passed)',books.find(b=>b.id===newId).needs_outline===true&&books.find(b=>b.id===newId).gates_passed===false);
t('duplicateBook: chapters deep-copied (not same ref)',books.find(b=>b.id===newId).chapters!==testBook.chapters);

// 4. reorderChapters — move ch1 to position 2, renumber
const moved=reorderChapters(books[0],0,1);
t('reorderChapters: order swapped',moved.chapters[0].title==='Beta'&&moved.chapters[1].title==='Alpha');
t('reorderChapters: renumbered 1..n',moved.chapters.map(c=>c.number).join(',')==='1,2,3');
t('reorderChapters: out-of-range no-op',reorderChapters(books[0],0,5).chapters[0].title==='Alpha');

// 5. analyzeOverusedWords — word/repetition stats over generated chapters only
const a=analyzeOverusedWords(testBook);
t('analyzeOverusedWords: counted words (excl. ungenerated ch3)',a.totalWords>60&&a.totalWords<400);
t('analyzeOverusedWords: flagged overused (shadow 16x)',a.overused.some(e=>e[0]==='shadow'&&e[1]>=16));
t('analyzeOverusedWords: adverb flagged (suddenly 9x)',a.adverbs.some(e=>e[0]==='suddenly'));

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail?1:0);
