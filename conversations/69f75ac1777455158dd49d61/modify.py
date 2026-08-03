import sys

with open('/app/bookforge_jsx.jsx', 'r') as f:
    content = f.read()

# 1. Add saveBook and duplicateBook after updateBook definition
old_update_book = 'const updateBook=(id,upd)=>{const books=getBooks();const i=books.findIndex(b=>b.id===id);if(i===-1)return null;books[i]={...books[i],...upd};setBooks(books);return books[i];};'

new_helper_funcs = '''const updateBook=(id,upd)=>{const books=getBooks();const i=books.findIndex(b=>b.id===id);if(i===-1)return null;books[i]={...books[i],...upd};setBooks(books);return books[i];};

const saveBook=(book)=>{
  if(!book||!book.id)return null;
  const books=getBooks();
  const idx=books.findIndex(b=>b.id===book.id);
  if(idx>=0){books[idx]=book;}else{books.unshift(book);}
  setBooks(books);
  return book;
};
if(typeof window!=="undefined"){window.saveBook=saveBook;}

const duplicateBook=(bookId)=>{
  const src=getBook(bookId);
  if(!src)return null;
  const copy=JSON.parse(JSON.stringify(src));
  copy.id="book_"+Date.now()+"_"+Math.random().toString(36).slice(2);
  copy.title=(copy.title?copy.title.trim():"Untitled")+" (Copy)";
  copy.created_date=new Date().toISOString();
  copy.status='idea';
  copy.build_complete=false;
  copy.gates_passed=false;
  copy.auto_build=false;
  saveBook(copy);
  return copy;
};
if(typeof window!=="undefined"){window.duplicateBook=duplicateBook;}'''

assert old_update_book in content, 'Could not find updateBook in content'
content = content.replace(old_update_book, new_helper_funcs, 1)

# 2. Add StatsBar component above HomePage
stats_bar_code = '''// ══════════════════════════════════════════════════════════════════════════════
// WRITING STATS DASHBOARD
// ══════════════════════════════════════════════════════════════════════════════
function StatsBar({ books }) {
  const allBooks = books || getBooks();
  if (!allBooks || allBooks.length === 0) return null;

  const totalBooks = allBooks.length;
  const completedBooks = allBooks.filter(b => !!b.build_complete).length;

  const totalWords = allBooks.reduce((acc, b) => {
    let bw = 0;
    if (b.chapters && Array.isArray(b.chapters) && b.chapters.length > 0) {
      bw = b.chapters.reduce((sum, c) => {
        if (typeof c.word_count === 'number' && c.word_count > 0) return sum + c.word_count;
        if (c.content) return sum + c.content.trim().split(/\\s+/).filter(Boolean).length;
        return sum;
      }, 0);
    }
    if (bw === 0 && typeof b.word_count === 'number') {
      bw = b.word_count;
    }
    return acc + bw;
  }, 0);

  const readyToPublish = allBooks.filter(b => !!b.gates_passed).length;

  const bookScores = [];
  for (const b of allBooks) {
    const scores = [];
    if (typeof b.review?.overall_score === 'number' && !isNaN(b.review.overall_score)) {
      scores.push(b.review.overall_score);
    }
    if (typeof b.manuscript_quality?.overall_human_score === 'number' && !isNaN(b.manuscript_quality.overall_human_score)) {
      scores.push(b.manuscript_quality.overall_human_score);
    }
    if (scores.length > 0) {
      bookScores.push(scores.reduce((a, s) => a + s, 0) / scores.length);
    }
  }
  const avgQuality = bookScores.length > 0 ? Math.round(bookScores.reduce((a, s) => a + s, 0) / bookScores.length) : null;

  const formattedWords = totalWords >= 1000000 
    ? (totalWords / 1000000).toFixed(1) + "M"
    : totalWords >= 1000 
    ? Math.round(totalWords / 1000) + "K" 
    : totalWords.toLocaleString();

  const stats = [
    { label: "Total Books", value: totalBooks, icon: "📚" },
    { label: "Completed", value: completedBooks, icon: "✅" },
    { label: "Words Written", value: formattedWords, icon: "✍️" },
    { label: "Ready to Publish", value: readyToPublish, icon: "🚀" },
    { label: "Avg Quality Score", value: avgQuality !== null ? `${avgQuality}/100` : "N/A", icon: "⭐" },
  ];

  return (
    <div className="bg-white/5 border border-white/10 rounded-2xl p-4 mb-6">
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
        {stats.map((s) => (
          <div key={s.label} className="bg-white/5 border border-white/5 rounded-xl p-3 flex items-center gap-3">
            <div className="text-2xl">{s.icon}</div>
            <div>
              <div className="text-white text-xl font-bold leading-tight">{s.value}</div>
              <div className="text-white/40 text-xs font-medium">{s.label}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// HOME PAGE
// ══════════════════════════════════════════════════════════════════════════════'''

home_page_marker = '''// ══════════════════════════════════════════════════════════════════════════════
// HOME PAGE
// ══════════════════════════════════════════════════════════════════════════════'''

assert home_page_marker in content, 'Could not find HOME PAGE marker'
content = content.replace(home_page_marker, stats_bar_code, 1)

# 3. Modify HomePage state & del handler & card buttons
old_del_line = '  const del=(id,e)=>{e.stopPropagation();if(!confirm("Delete this book?"))return;const b=getBooks().filter(x=>x.id!==id);setBooks(b);setBooksList(b);};'
new_del_and_dup = '''  const [toastMsg,setToastMsg]=useState("");
  const flash=(msg)=>{setToastMsg(msg);setTimeout(()=>setToastMsg(""),3500);};
  const del=(id,e)=>{e.stopPropagation();if(!confirm("Delete this book?"))return;const b=getBooks().filter(x=>x.id!==id);setBooks(b);setBooksList(b);};
  const handleDuplicate=(bookId,e)=>{e.stopPropagation();const copy=duplicateBook(bookId);if(copy){setBooksList(getBooks());flash(`Duplicated "${copy.title}" successfully!`);}};'''

assert old_del_line in content, 'Could not find old del line'
content = content.replace(old_del_line, new_del_and_dup, 1)

# 4. Insert toast notice and StatsBar component call inside HomePage return
old_stats_grid = '''      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
        {(()=>{
          const totalWords=allBooks.reduce((a,b)=>a+(b.word_count||0),0);
          const publishReady=allBooks.filter(b=>b.review?.verdict==="PASS"&&b.manuscript_quality?.manuscript_verdict==="PASS").length;
          const wLabel=totalWords>=1000?Math.round(totalWords/1000)+"K":totalWords;
          return [{label:"Total Books",value:allBooks.length,icon:"📚",sub:null},{label:"Words Written",value:wLabel,icon:"✍️",sub:totalWords>0?Math.round(totalWords/250)+"pg est.":null},{label:"Publish Ready",value:publishReady,icon:"🚀",sub:publishReady>0?"Dual-gate passed":null},{label:"Published",value:allBooks.filter(b=>b.status==="published").length,icon:"🌟",sub:null}].map(s=>(
            <div key={s.label} className="bg-white/5 border border-white/10 rounded-2xl p-4"><div className="text-2xl mb-1">{s.icon}</div><div className="text-white text-2xl font-bold">{s.value}</div><div className="text-white/40 text-xs">{s.label}</div>{s.sub&&<div className="text-white/20 text-xs mt-0.5">{s.sub}</div>}</div>
          ));
        })()}
      </div>'''

new_stats_and_toast = '''      {toastMsg&&(
        <div className="bg-green-500/20 border border-green-500/30 text-green-300 rounded-xl p-3 mb-4 text-sm font-medium flex items-center justify-between">
          <span>✨ {toastMsg}</span>
          <button onClick={()=>setToastMsg("")} className="text-green-300/60 hover:text-green-200 text-xs">✕</button>
        </div>
      )}
      <StatsBar books={allBooks}/>'''

assert old_stats_grid in content, 'Could not find old stats grid'
content = content.replace(old_stats_grid, new_stats_and_toast, 1)

# 5. Update book card buttons
old_card_buttons = '''              <button onClick={e=>del(book.id,e)} aria-label="Delete book" className="absolute top-2 left-2 w-7 h-7 bg-red-500/80 hover:bg-red-600 rounded-full text-white text-xs opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center shadow">✕</button>
              <button onClick={e=>{e.stopPropagation();const src=getBook(book.id);if(!src)return;const dup={...src,id:Date.now().toString(36)+Math.random().toString(36).slice(2),title:src.title+" (Copy)",status:"draft",auto_build:false,build_complete:false,gates_passed:false,seo_done:false,cover_done:false,review_done:false,wq_done:false,competitor_done:false,hooks_done:false,review:null,manuscript_quality:null,build_complete_date:null};const books=getBooks();books.push(dup);setBooks(books);setBooksList(getBooks());}} className="absolute top-2 right-2 w-7 h-7 bg-blue-500/80 hover:bg-blue-600 rounded-full text-white text-xs opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center shadow" title="Duplicate book">⧉</button>'''

new_card_buttons = '''              <div className="absolute top-2 left-2 flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                <button onClick={e=>del(book.id,e)} aria-label="Delete book" title="Delete book" className="w-7 h-7 bg-red-500/80 hover:bg-red-600 rounded-full text-white text-xs flex items-center justify-center shadow">✕</button>
                <button onClick={e=>handleDuplicate(book.id,e)} aria-label="Duplicate book" title="Duplicate book" className="px-2.5 py-1 bg-purple-600/90 hover:bg-purple-700 text-white text-xs rounded-full font-medium flex items-center gap-1 shadow">📋 Duplicate</button>
              </div>'''

assert old_card_buttons in content, 'Could not find old card buttons'
content = content.replace(old_card_buttons, new_card_buttons, 1)

with open('/app/bookforge_jsx.jsx', 'w') as f:
    f.write(content)

print('Successfully modified /app/bookforge_jsx.jsx')
