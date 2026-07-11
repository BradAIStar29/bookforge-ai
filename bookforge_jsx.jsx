
const {useState,useEffect,useRef}=React;

// ── Constants ─────────────────────────────────────────────────────────────────
const GEMINI_URL="https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";
const DAILY_LIMIT=1500;
const GENRES=["Fiction - Romance","Fiction - Gay Romance","Fiction - LGBT+","Fiction - Thriller","Fiction - Fantasy","Fiction - Sci-Fi","Fiction - Mystery","Fiction - Horror","Self-Help","Business & Finance","Health & Wellness","Personal Development","Biography & Memoir","History","True Crime","Cookbook","Travel","Spirituality","Science","Technology","Parenting","Education"];
const AUDIENCES=["General Adults","Young Adults (18-25)","LGBT+ Readers","Women","Men","Professionals & Entrepreneurs","Parents","Students","Seniors","Beginners","Advanced Readers"];
const STATUS_COLORS={idea:"bg-gray-500/20 text-gray-300",outlining:"bg-blue-500/20 text-blue-300",writing:"bg-yellow-500/20 text-yellow-300",ready:"bg-green-500/20 text-green-300",published:"bg-purple-500/20 text-purple-300",queued:"bg-cyan-500/20 text-cyan-300"};
const STATUS_ICONS={idea:"💡",outlining:"📋",writing:"✍️",ready:"✅",published:"🚀",queued:"⏳"};

// ── Storage ───────────────────────────────────────────────────────────────────
const ls={get:(k,d)=>{try{const v=localStorage.getItem(k);return v===null?d:JSON.parse(v)}catch{return d}},set:(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v))}catch(e){if(e.name==="QuotaExceededError"){alert("⚠️ Storage full! Export your books to free space.");}}}};
const getKey=()=>localStorage.getItem("gemini_api_key")||"";
const setKey=k=>localStorage.setItem("gemini_api_key",k.trim());
const getBooks=()=>ls.get("bfai_books",[]);
const setBooks=b=>ls.set("bfai_books",b);
const getBook=id=>getBooks().find(b=>b.id===id)||null;
function getSeriesById(id){return getSeries().find(s=>s.id===id)||null;}
const getSeries=()=>ls.get("bfai_series",[]);
const setSeries=s=>ls.set("bfai_series",s);
const getQueue=()=>ls.get("bfai_queue",[]);
const setQueue=q=>ls.set("bfai_queue",q);
const getNavState=()=>ls.get("bfai_nav",null);
const setNavState=n=>ls.set("bfai_nav",n);
const updateBook=(id,upd)=>{const books=getBooks();const i=books.findIndex(b=>b.id===id);if(i===-1)return null;books[i]={...books[i],...upd};setBooks(books);return books[i];};
const getUsage=()=>{const today=new Date().toISOString().split("T")[0];const d=ls.get("bfai_usage",{});return d.date===today?(d.count||0):0;};
const trackUsage=()=>{const today=new Date().toISOString().split("T")[0];const d=ls.get("bfai_usage",{});const c=(d.date===today?d.count:0)+1;ls.set("bfai_usage",{date:today,count:c});return c;};
// ── Languages ─────────────────────────────────────────────────────────────────
const LANGUAGES=["English","Spanish","French","German","Italian","Portuguese","Dutch","Russian","Japanese","Korean","Chinese (Simplified)","Arabic","Hindi","Turkish","Polish","Swedish","Norwegian","Danish","Finnish","Greek","Hebrew","Indonesian","Malay","Thai","Vietnamese","Ukrainian","Czech","Hungarian","Romanian","Bulgarian","Croatian","Slovak"];

// ── Gemini API ────────────────────────────────────────────────────────────────
const RETRY_DELAYS_MS=[2000,5000]; // backoff for transient failures
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

function playRetryChime(){
  try{
    const Ctx=window.AudioContext||window.webkitAudioContext;
    if(!Ctx)return;
    const ctx=new Ctx();
    const o=ctx.createOscillator();const g=ctx.createGain();
    o.type="sine";o.frequency.value=660;
    g.gain.setValueAtTime(0.0001,ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.09,ctx.currentTime+0.015);
    g.gain.exponentialRampToValueAtTime(0.0001,ctx.currentTime+0.28);
    o.connect(g);g.connect(ctx.destination);
    o.start();o.stop(ctx.currentTime+0.3);
    setTimeout(()=>{try{ctx.close();}catch(e){}},400);
  }catch(e){/* audio not available — silent no-op */}
}

// ── Cover text compositor: bakes Title + Author onto the AI art via canvas ──
function loadImageCORS(url){
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error("Cover image load timed out after 15s")),15000);
    const img=new Image();
    img.crossOrigin="anonymous";
    img.onload=()=>{clearTimeout(timer);resolve(img);};
    img.onerror=()=>{clearTimeout(timer);reject(new Error("Failed to load cover art image"));};
    img.src=url;
  });
}

function wrapCoverText(ctx,text,maxWidth){
  const words=(text||"").split(/\s+/).filter(Boolean);
  const lines=[];let line="";
  for(const w of words){
    const test=line?line+" "+w:w;
    if(ctx.measureText(test).width>maxWidth&&line){lines.push(line);line=w;}
    else line=test;
  }
  if(line)lines.push(line);
  return lines;
}

// Draws the raw AI cover art + Title/Subtitle/Author text on a canvas and returns a JPEG data URL.
// Falls back gracefully (throws) if the image can't be loaded/tainted — callers should catch and
// fall back to the raw (text-free) art URL so cover generation never hard-fails.
async function composeCoverWithText(imageUrl,title,authorName,subtitle){
  const img=await loadImageCORS(imageUrl);
  const W=832,H=1216;
  const canvas=document.createElement("canvas");
  canvas.width=W;canvas.height=H;
  const ctx=canvas.getContext("2d");

  // Cover-fit draw (crop to fill, keep full art visible in the frame)
  const scale=Math.max(W/img.width,H/img.height);
  const dw=img.width*scale,dh=img.height*scale;
  ctx.drawImage(img,(W-dw)/2,(H-dh)/2,dw,dh);

  // Soft scrims top+bottom so text stays legible without hiding most of the art
  const topGrad=ctx.createLinearGradient(0,0,0,H*0.30);
  topGrad.addColorStop(0,"rgba(0,0,0,0.62)");topGrad.addColorStop(1,"rgba(0,0,0,0)");
  ctx.fillStyle=topGrad;ctx.fillRect(0,0,W,H*0.30);

  const botGrad=ctx.createLinearGradient(0,H*0.85,0,H);
  botGrad.addColorStop(0,"rgba(0,0,0,0)");botGrad.addColorStop(1,"rgba(0,0,0,0.68)");
  ctx.fillStyle=botGrad;ctx.fillRect(0,H*0.85,W,H*0.15);

  const padX=64,maxWidth=W-padX*2;
  ctx.textAlign="center";ctx.textBaseline="alphabetic";

  // Title — auto-shrinks to fit within 3 lines
  let fontSize=76,titleLines=[];
  const titleText=(title||"Untitled").toUpperCase();
  while(fontSize>34){
    ctx.font=`800 ${fontSize}px Arial, Helvetica, sans-serif`;
    titleLines=wrapCoverText(ctx,titleText,maxWidth);
    if(titleLines.length<=3)break;
    fontSize-=4;
  }
  ctx.fillStyle="#fff";ctx.shadowColor="rgba(0,0,0,0.8)";ctx.shadowBlur=12;ctx.shadowOffsetY=3;
  const lineHeight=fontSize*1.14;
  const ty=88+fontSize*0.78;
  titleLines.forEach((line,i)=>ctx.fillText(line,W/2,ty+i*lineHeight));

  // Optional subtitle just under the title
  if(subtitle&&subtitle.trim()){
    ctx.shadowBlur=6;
    ctx.font=`500 ${Math.round(fontSize*0.36)}px Arial, Helvetica, sans-serif`;
    const subLines=wrapCoverText(ctx,subtitle,maxWidth).slice(0,2);
    let sy=ty+titleLines.length*lineHeight+fontSize*0.5;
    subLines.forEach((line,i)=>ctx.fillText(line,W/2,sy+i*(fontSize*0.46)));
  }

  // Author name near the bottom
  ctx.shadowColor="rgba(0,0,0,0.85)";ctx.shadowBlur=10;ctx.shadowOffsetY=2;
  ctx.font="600 34px Arial, Helvetica, sans-serif";
  ctx.fillStyle="#f2f2f2";
  ctx.fillText((authorName||"Author").toUpperCase(),W/2,H-62);

  ctx.shadowBlur=0;ctx.shadowOffsetY=0;
  return canvas.toDataURL("image/jpeg",0.87);
}

// Wrapper used at all cover-generation call sites — never throws; falls back to raw art on failure.
async function finalizeCoverImage(rawArtUrl,title,authorName,subtitle){
  try{
    return await composeCoverWithText(rawArtUrl,title,authorName,subtitle);
  }catch(e){
    console.warn("Cover text overlay failed, using raw art:",e);
    return rawArtUrl;
  }
}

function notifyRetry(attempt,totalAttempts,reason){
  try{window.dispatchEvent(new CustomEvent("bfai:retry",{detail:{attempt,totalAttempts,reason}}));}catch(e){}
  playRetryChime();
}

async function callGemini(prompt,temperature=0.85,opts={}){
  if(getUsage()>=DAILY_LIMIT)throw{code:"QUOTA"};
  const key=getKey();
  if(!key)throw{code:"NO_KEY"};
  const maxRetries=opts.maxRetries??2;
  const timeoutMs=opts.timeoutMs??90000; // 90s ceiling — long chapters take time, then fail fast
  let lastTransient=null;
  for(let attempt=0;attempt<=maxRetries;attempt++){
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),timeoutMs);
    try{
      const res=await fetch(`${GEMINI_URL}?key=${key}`,{method:"POST",headers:{"Content-Type":"application/json"},signal:controller.signal,
        body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{temperature,maxOutputTokens:8192}})});
      clearTimeout(timer);
      const data=await res.json().catch(()=>({}));
      if(!res.ok){
        if(res.status===401||res.status===403)throw{code:"BAD_KEY"};
        if(res.status===429||data?.error?.status==="RESOURCE_EXHAUSTED")throw{code:"QUOTA"};
        if(res.status>=500&&attempt<maxRetries){
          lastTransient={code:"ERROR",msg:data?.error?.message||`HTTP ${res.status}`};
          notifyRetry(attempt+2,maxRetries+1,"server");
          await sleep(RETRY_DELAYS_MS[attempt]||5000);
          continue;
        }
        throw{code:"ERROR",msg:data?.error?.message||`HTTP ${res.status}`};
      }
      const text=data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if(!text){
        if(data?.candidates?.[0]?.finishReason==="SAFETY")throw{code:"SAFETY"};
        throw{code:"EMPTY"};
      }
      return text;
    }catch(err){
      clearTimeout(timer);
      if(err?.code)throw err; // our own explicit throws (BAD_KEY/QUOTA/SAFETY/EMPTY/ERROR) — no retry
      const isAbort=err?.name==="AbortError";
      const isNetwork=err instanceof TypeError;
      if((isAbort||isNetwork)&&attempt<maxRetries){
        lastTransient=isAbort?{code:"TIMEOUT",msg:"Request timed out — retrying…"}:{code:"NETWORK",msg:"Network error — retrying…"};
        notifyRetry(attempt+2,maxRetries+1,isAbort?"timeout":"network");
        await sleep(RETRY_DELAYS_MS[attempt]||5000);
        continue;
      }
      if(isAbort)throw{code:"TIMEOUT",msg:`Request timed out after ${timeoutMs/1000}s. Click Retry to try again — nothing is lost.`};
      if(isNetwork)throw{code:"NETWORK",msg:"Network error — check your connection and click Retry."};
      throw err;
    }
  }
  throw lastTransient||{code:"ERROR",msg:"Failed after retries."};
}

const errMsg=e=>{
  const c=e?.code||"ERROR";
  if(c==="NO_KEY"||c==="BAD_KEY")return"🔑 API key missing or invalid — check Settings.";
  if(c==="QUOTA")return"⏳ Daily Gemini limit reached. Resets at midnight Pacific Time. Progress saved!";
  if(c==="SAFETY")return"Content blocked by safety filter. Try rephrasing.";
  if(c==="PARSE")return(e?.msg||"AI returned unexpected format — please retry.");
  if(c==="EMPTY")return"AI returned empty response — please retry.";
  if(c==="TIMEOUT")return(e?.msg||"⏱️ Request timed out — nothing is lost, click Retry to continue.");
  if(c==="NETWORK")return(e?.msg||"📡 Network error — check your connection and click Retry.");
  return e?.msg||e?.message||"Something went wrong. Please try again.";
};


// ── Voice Profile ─────────────────────────────────────────────────────────────
const getVoiceProfile=()=>ls.get("bfai_voice",null);
const setVoiceProfile=v=>ls.set("bfai_voice",v);
const getAuthorProfile=()=>ls.get("bfai_author",{name:"",bio:"",website:"",photo_url:""});
const setAuthorProfile=p=>ls.set("bfai_author",p);
const getAutoCorrect=()=>ls.get("bfai_autocorrect",true);
const setAutoCorrect=v=>ls.set("bfai_autocorrect",v);
const getCharacters=bookId=>ls.get("bfai_chars_"+bookId,[]);
const setCharacters=(bookId,chars)=>ls.set("bfai_chars_"+bookId,chars);

// ── EPUB builder (client-side, no deps needed) ────────────────────────────────

// ── RTF/DOCX Export (KDP-ready, opens in Word/LibreOffice) ───────────────────
function buildRTF(book){
  const chaps=(book.chapters||[]).filter(c=>c.content);
  const rtfEscape=s=>(s||"").replace(/\\/g,"\\\\").replace(/\{/g,"\\{").replace(/\}/g,"\\}").replace(/[^\x00-\x7F]/g,c=>{const code=c.charCodeAt(0);return code<256?`\\'${code.toString(16).padStart(2,"0")}`:code<32768?`\\u${code}?`:`\\u${code-65536}?`;});
  const para=text=>`{\\pard\\sa180\\sb0\\sl360\\slmult1\\f0\\fs24 ${rtfEscape(text)}\\par}\n`;
  const h1=text=>`{\\pard\\qc\\sa360\\sb720\\b\\fs40\\f0 ${rtfEscape(text)}\\b0\\par}\n`;
  const h2=text=>`{\\pard\\sa240\\sb360\\b\\fs28\\f0 ${rtfEscape(text)}\\b0\\par}\n`;
  let body=`{\\rtf1\\ansi\\deff0\n{\\fonttbl{\\f0\\froman\\fcharset0 Times New Roman;}}\n{\\colortbl;\\red0\\green0\\blue0;}\n\\paperw12240\\paperh15840\\margl1800\\margr1800\\margt1440\\margb1440\n\\widowctrl\\hyphauto\n`;
  body+=`{\\pard\\qc\\sa720\\sb1440\\b\\fs72\\f0 ${rtfEscape(book.title)}\\b0\\par}\n`;
  if(book.subtitle)body+=`{\\pard\\qc\\sa360\\i\\fs36\\f0 ${rtfEscape(book.subtitle)}\\i0\\par}\n`;
  body+=`{\\pard\\qc\\sa360\\fs28\\f0 ${rtfEscape(book.author_name||"Author")}\\par}\n`;
  body+=`{\\pard\\qc\\fs22\\f0 ${rtfEscape(book.genre||"")}\\par}\n\\page\n`;
  if(book.description){body+=h2("About This Book");body+=para(book.description);body+=`\\page\n`;}
  chaps.forEach(ch=>{
    body+=h1(`Chapter ${ch.number}: ${ch.title}`);
    ch.content.split(/\n+/).filter(p=>p.trim()).forEach(p=>{body+=para(p);});
    body+=`\\page\n`;
  });
  body+=`}`;
  return body;
}

function buildEPUB(book){
  // RETURNS A PROMISE → resolves to a .epub Blob (real EPUB3 ZIP format)
  // Uses JSZip (MIT, loaded on demand). Zero cost, works in all browsers.
  const title = book.title || "Book";
  const safe = s => (s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  const slug = title.replace(/[^a-z0-9]/gi,"_").toLowerCase();
  const chapters = (book.chapters||[]).filter(c=>c.content);
  const author = book.author_name || "Author";
  const uid = "bookforge-" + (book.id || Date.now());

  return new Promise((resolve, reject) => {
    // Lazy-load JSZip from CDN (MIT license, ~100KB)
    const loadJSZip = () => {
      if(window.JSZip) return Promise.resolve(window.JSZip);
      return new Promise((res, rej) => {
        const s = document.createElement("script");
        s.src = "https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js";
        s.onload = () => res(window.JSZip);
        s.onerror = rej;
        document.head.appendChild(s);
      });
    };

    loadJSZip().then(JSZip => {
      const zip = new JSZip();

      // ── mimetype (must be first, uncompressed) ──
      zip.file("mimetype", "application/epub+zip", {compression:"STORE"});

      // ── META-INF/container.xml ──
      zip.folder("META-INF").file("container.xml",
        `<?xml version="1.0" encoding="UTF-8"?>\n`+
        `<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">\n`+
        `  <rootfiles>\n`+
        `    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>\n`+
        `  </rootfiles>\n`+
        `</container>`
      );

      const oebps = zip.folder("OEBPS");
      const text  = oebps.folder("Text");
      const styles = oebps.folder("Styles");

      // ── Stylesheet ──
      const css =
        `body{font-family:Georgia,"Times New Roman",serif;font-size:1.05em;line-height:1.75;`+
        `margin:0;padding:0;color:#1a1a1a;background:#fff}\n`+
        `h1{font-size:1.8em;text-align:left;margin:2em 0 0.4em;padding-bottom:0.3em;`+
        `border-bottom:1px solid #ccc;page-break-before:always}\n`+
        `h1.first-chapter{page-break-before:auto}\n`+
        `h2{font-size:1.3em;margin:1.5em 0 0.5em;color:#333}\n`+
        `p{margin:0;text-indent:1.6em;orphans:2;widows:2}\n`+
        `p.no-indent{text-indent:0;margin-top:0.8em}\n`+
        `p.first-para{text-indent:0}\n`+
        `hr{border:none;border-top:1px solid #ddd;margin:2em 0}\n`+
        `.title-page{text-align:center;padding:4em 2em}\n`+
        `.title-page h1{font-size:2.4em;border:none;page-break-before:auto;margin-bottom:0.2em}\n`+
        `.title-page .subtitle{font-size:1.3em;color:#555;font-style:italic;margin:.4em 0 2em}\n`+
        `.title-page .author{font-size:1.1em;margin:1em 0}\n`+
        `.title-page .genre{font-size:.9em;color:#888;margin:.5em 0}\n`+
        `.description{font-style:italic;color:#444;border-left:3px solid #ddd;padding-left:1.2em;`+
        `margin:1.5em 0;page-break-before:always}\n`+
        `figure{text-align:center;margin:1.5em 0}\n`+
        `figure img{max-width:90%}\n`;
      styles.file("main.css", css);

      // ── Title page ──
      const titlePageXhtml =
        `<?xml version="1.0" encoding="UTF-8"?>\n`+
        `<!DOCTYPE html>\n`+
        `<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="en">\n`+
        `<head><title>${safe(title)}</title>`+
        `<link rel="stylesheet" type="text/css" href="../Styles/main.css"/></head>\n`+
        `<body><div class="title-page">\n`+
        `  <h1>${safe(title)}</h1>\n`+
        (book.subtitle ? `  <p class="subtitle">${safe(book.subtitle)}</p>\n` : "")+
        `  <p class="author">${safe(author)}</p>\n`+
        `  <p class="genre">${safe(book.genre||"")}</p>\n`+
        `</div></body></html>`;
      text.file("title_page.xhtml", titlePageXhtml);

      // ── Description page ──
      let descPageXhtml = "";
      if(book.description){
        descPageXhtml =
          `<?xml version="1.0" encoding="UTF-8"?>\n`+
          `<!DOCTYPE html>\n`+
          `<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="en">\n`+
          `<head><title>About This Book</title>`+
          `<link rel="stylesheet" type="text/css" href="../Styles/main.css"/></head>\n`+
          `<body><div class="description">\n`+
          `<h2>About This Book</h2>\n`+
          `<p class="no-indent">${safe(book.description)}</p>\n`+
          `</div></body></html>`;
        text.file("description.xhtml", descPageXhtml);
      }

      // ── Chapter XHTML files ──
      const chapterFiles = chapters.map((ch, i) => {
        const chSlug = `ch_${i+1}`;
        const isFirst = i === 0;
        const illustrationHtml = ch.illustration_url
          ? `<figure><img src="${ch.illustration_url}" alt="Chapter ${ch.number}"/></figure>\n`
          : "";
        const paras = ch.content
          .split(/\n+/).filter(p=>p.trim())
          .map((p, pi) => `<p class="${pi===0?"first-para":""}">${safe(p)}</p>`)
          .join("\n");
        const xhtml =
          `<?xml version="1.0" encoding="UTF-8"?>\n`+
          `<!DOCTYPE html>\n`+
          `<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="en">\n`+
          `<head><title>Chapter ${ch.number}: ${safe(ch.title)}</title>`+
          `<link rel="stylesheet" type="text/css" href="../Styles/main.css"/></head>\n`+
          `<body>\n`+
          `<h1 class="${isFirst?"first-chapter":""}">`+
          `Chapter ${ch.number}: ${safe(ch.title)}</h1>\n`+
          illustrationHtml + paras +
          `</body></html>`;
        text.file(`${chSlug}.xhtml`, xhtml);
        return { id: `ch${i+1}`, href: `Text/${chSlug}.xhtml`, title: `Chapter ${ch.number}: ${ch.title}` };
      });

      // ── TOC: toc.xhtml (EPUB3 nav) ──
      const navXhtml =
        `<?xml version="1.0" encoding="UTF-8"?>\n`+
        `<!DOCTYPE html>\n`+
        `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="en">\n`+
        `<head><title>Table of Contents</title>`+
        `<link rel="stylesheet" type="text/css" href="Styles/main.css"/></head>\n`+
        `<body>\n<nav epub:type="toc" id="toc">\n`+
        `<h2>Table of Contents</h2>\n<ol>\n`+
        `  <li><a href="Text/title_page.xhtml">Title Page</a></li>\n`+
        (book.description ? `  <li><a href="Text/description.xhtml">About This Book</a></li>\n` : "")+
        chapterFiles.map(cf => `  <li><a href="${cf.href}">${safe(cf.title)}</a></li>`).join("\n")+
        `\n</ol>\n</nav>\n</body></html>`;
      oebps.file("toc.xhtml", navXhtml);

      // ── toc.ncx (EPUB2 fallback for older Kindles) ──
      const ncx =
        `<?xml version="1.0" encoding="UTF-8"?>\n`+
        `<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">\n`+
        `<head><meta name="dtb:uid" content="${uid}"/></head>\n`+
        `<docTitle><text>${safe(title)}</text></docTitle>\n`+
        `<navMap>\n`+
        chapterFiles.map((cf, i) =>
          `<navPoint id="nav${i+1}" playOrder="${i+1}">`+
          `<navLabel><text>${safe(cf.title)}</text></navLabel>`+
          `<content src="${cf.href}"/></navPoint>`
        ).join("\n")+
        `\n</navMap></ncx>`;
      oebps.file("toc.ncx", ncx);

      // ── content.opf (Package Document) ──
      const now = new Date().toISOString().split("T")[0];
      const manifestItems = [
        `<item id="nav" href="toc.xhtml" media-type="application/xhtml+xml" properties="nav"/>`,
        `<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>`,
        `<item id="css" href="Styles/main.css" media-type="text/css"/>`,
        `<item id="title_page" href="Text/title_page.xhtml" media-type="application/xhtml+xml"/>`,
        ...(book.description ? [`<item id="desc_page" href="Text/description.xhtml" media-type="application/xhtml+xml"/>`] : []),
        ...chapterFiles.map(cf => `<item id="${cf.id}" href="${cf.href}" media-type="application/xhtml+xml"/>`)
      ].join("\n    ");
      const spineItems = [
        `<itemref idref="title_page"/>`,
        ...(book.description ? [`<itemref idref="desc_page"/>`] : []),
        ...chapterFiles.map(cf => `<itemref idref="${cf.id}"/>`)
      ].join("\n    ");
      const keywords = (book.seo_keywords||[]).join(", ");
      const opf =
        `<?xml version="1.0" encoding="UTF-8"?>\n`+
        `<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid" xml:lang="en">\n`+
        `  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">\n`+
        `    <dc:identifier id="uid">${uid}</dc:identifier>\n`+
        `    <dc:title>${safe(title)}</dc:title>\n`+
        (book.subtitle ? `    <meta property="dcterms:alternative">${safe(book.subtitle)}</meta>\n` : "")+
        `    <dc:creator id="creator">${safe(author)}</dc:creator>\n`+
        `    <meta refines="#creator" property="role" scheme="marc:relators">aut</meta>\n`+
        `    <dc:language>${safe((book.writing_language||"English").slice(0,2).toLowerCase())}</dc:language>\n`+
        `    <dc:subject>${safe(book.genre||"")}</dc:subject>\n`+
        (keywords ? `    <dc:subject>${safe(keywords)}</dc:subject>\n` : "")+
        `    <dc:description>${safe(book.description||"")}</dc:description>\n`+
        `    <meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d+Z/,"Z")}</meta>\n`+
        `    <meta name="cover" content="cover-image"/>\n`+
        `  </metadata>\n`+
        `  <manifest>\n    ${manifestItems}\n  </manifest>\n`+
        `  <spine toc="ncx">\n    ${spineItems}\n  </spine>\n`+
        `</package>`;
      oebps.file("content.opf", opf);

      // ── Generate the ZIP blob ──
      zip.generateAsync({
        type: "blob",
        mimeType: "application/epub+zip",
        compression: "DEFLATE",
        compressionOptions: { level: 6 }
      }).then(resolve).catch(reject);

    }).catch(err => reject(new Error("Failed to load JSZip: " + err.message)));
  });
}

function buildSeriesContext(series){
  if(!series)return"";
  const p=series.plan||{};
  // Gather completed books for richer context
  const allBooks=getBooks();
  const seriesBooks=allBooks.filter(b=>b.series_id===series.id&&b.chapters?.some(c=>c.content)).sort((a,b)=>(a.series_number||0)-(b.series_number||0));
  let ctx=`=== SERIES BIBLE: "${series.name}" ===\n`;
  ctx+=`Genre: ${series.genre} | Audience: ${series.audience}\nConcept: ${series.concept}\n`;
  if(p.series_themes?.length)ctx+=`Core Themes: ${p.series_themes.join(", ")}\n`;
  ctx+=`\n`;
  if(p.world_setting)ctx+=`WORLD & SETTING:\n${p.world_setting}\n\n`;
  if(p.world_rules?.length)ctx+=`WORLD RULES & LORE:\n${p.world_rules.map(r=>`• ${r}`).join("\n")}\n\n`;
  if(p.tone_style)ctx+=`TONE & STYLE: ${p.tone_style}\n\n`;
  if(p.series_arc)ctx+=`OVERARCHING SERIES ARC: ${p.series_arc}\n\n`;
  if(series.character_roster?.length){
    ctx+=`ESTABLISHED CHARACTERS (maintain consistency exactly):\n`;
    series.character_roster.forEach(c=>{
      ctx+=`• ${c.name}`;
      if(c.role)ctx+=` [${c.role}]`;
      if(c.description)ctx+=`: ${c.description}`;
      if(c.arc)ctx+=` | Character arc: ${c.arc}`;
      ctx+=`\n`;
    });ctx+="\n";
  }
  if(series.world_locations?.length){
    ctx+=`ESTABLISHED LOCATIONS:\n`;
    series.world_locations.forEach(l=>{ctx+=`• ${l.name}: ${l.description||""}\n`;});ctx+="\n";
  }
  // Include actual content from written books as story context
  if(seriesBooks.length>0){
    ctx+=`PREVIOUSLY WRITTEN BOOKS (maintain full continuity):\n`;
    seriesBooks.forEach(b=>{
      const lastChapter=b.chapters.filter(c=>c.content).slice(-1)[0];
      ctx+=`• Book ${b.series_number||"?"}: "${b.title}" — ${(b.word_count||0).toLocaleString()}w written`;
      if(b.status==="published")ctx+=` [PUBLISHED]`;
      if(lastChapter)ctx+=`. Ends: ${lastChapter.content.slice(-300).replace(/\n/g," ")}…`;
      ctx+=`\n`;
    });ctx+="\n";
  }
  if(series.plot_events?.length>0){
    ctx+=`KEY SERIES EVENTS — DO NOT CONTRADICT:\n`;
    series.plot_events.slice(-20).forEach(e=>{ctx+=`• [${e.book}] ${e.event}\n`;});ctx+="\n";
  }
  ctx+=`=== END SERIES BIBLE ===\n`;
  return ctx;
}

// ── Shared UI ─────────────────────────────────────────────────────────────────
function Spin({size="h-5 w-5"}){return<svg className={`spin ${size}`} fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>;}
function ScoreBadge({score}){const color=score>=80?"text-green-400 border-green-500/40 bg-green-500/10":score>=60?"text-amber-400 border-amber-500/40 bg-amber-500/10":"text-red-400 border-red-500/40 bg-red-500/10";return<span className={`text-sm font-bold px-3 py-1 rounded-full border ${color}`}>{score}/100</span>;}
function Card({children,className=""}){return<div className={`bg-white/5 border border-white/10 rounded-2xl p-6 ${className}`}>{children}</div>;}

// ── Settings Modal ────────────────────────────────────────────────────────────
function SettingsModal({onClose}){
  const [draft,setDraft]=useState(getKey());
  const [saved,setSaved]=useState(false);
  const [sTab,setSTab]=useState("api"); // api | voice | author
  const [author,setAuthor]=useState(getAuthorProfile());
  const [authorSaved,setAuthorSaved]=useState(false);
  const [autoCorrect,setAutoCorrect]=useState(getAutoCorrect());

  const save=()=>{if(!draft.trim())return;setKey(draft);setSaved(true);setTimeout(()=>setSaved(false),2000);};
  const saveAuthor=()=>{setAuthorProfile(author);setAuthorSaved(true);setTimeout(()=>setAuthorSaved(false),2000);};
  const setAutoCorrectSetting=v=>{setAutoCorrect(v);};
  const [testStatus,setTestStatus]=useState(null); // null | "testing" | "ok" | "fail"
  const testKey=async()=>{
    if(!draft.trim())return;
    setTestStatus("testing");
    try{
      const r=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${draft.trim()}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({contents:[{parts:[{text:"Reply with just the word OK"}]}],generationConfig:{maxOutputTokens:5}})});
      if(r.ok)setTestStatus("ok");
      else{const err=await r.json();setTestStatus("fail");}
    }catch(e){setTestStatus("fail");}
    setTimeout(()=>setTestStatus(null),4000);
  };

  return(
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-slate-800 border border-white/10 rounded-2xl max-w-lg w-full shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-slate-800 border-b border-white/10 px-6 py-4 flex items-center justify-between">
          <h2 className="text-white text-xl font-bold">⚙️ Settings</h2>
          <button onClick={onClose} className="text-white/30 hover:text-white text-xl">✕</button>
        </div>
        {/* Settings tabs */}
        <div className="px-6 pt-4">
          <div className="bg-white/5 border border-white/10 rounded-xl p-1 flex gap-1 mb-5">
            {[["api","🔑 API Key"],["voice","🎙️ Voice"],["author","👤 Author"],["build","🔧 Build"]].map(([id,label])=>(
              <button key={id} onClick={()=>setSTab(id)} className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all ${sTab===id?"bg-purple-500 text-white":"text-white/40 hover:text-white"}`}>{label}</button>
            ))}
          </div>
        </div>
        <div className="px-6 pb-6">
          {sTab==="api"&&(
            <div>
              <label className="text-white/60 text-sm font-medium block mb-2">Gemini API Key</label>
              <p className="text-white/35 text-xs mb-3">Stored only in your browser. Never sent anywhere except Google's API.</p>
              <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" className="inline-block text-purple-400 text-xs underline mb-4 hover:text-purple-300">Get a free key at Google AI Studio →</a>
              <input type="password" placeholder="AIza..." value={draft} onChange={e=>setDraft(e.target.value)} onKeyDown={e=>e.key==="Enter"&&save()} className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white placeholder-white/30 focus:outline-none focus:border-purple-500 mb-4 font-mono text-sm"/>
              <div className="flex gap-2">
                <button onClick={testKey} disabled={!draft.trim()||testStatus==="testing"} className={`flex-1 py-3 rounded-xl font-semibold text-sm transition-all border ${testStatus==="ok"?"bg-green-500/20 border-green-500 text-green-400":testStatus==="fail"?"bg-red-500/20 border-red-500 text-red-400":testStatus==="testing"?"border-white/20 text-white/40":"border-white/20 text-white/60 hover:border-purple-400 hover:text-white"}`}>{testStatus==="testing"?"⏳ Testing…":testStatus==="ok"?"✅ Key works!":testStatus==="fail"?"❌ Invalid key":"🔬 Test Key"}</button>
                <button onClick={save} disabled={!draft.trim()} className={`flex-1 py-3 rounded-xl font-semibold transition-all ${saved?"bg-green-500 text-white":"bg-gradient-to-r from-purple-500 to-pink-500 text-white hover:opacity-90 disabled:opacity-50"}`}>{saved?"✅ Saved!":"Save Key"}</button>
              </div>
            </div>
          )}
          {sTab==="voice"&&<VoiceTrainingPanel onClose={onClose}/>}
          {sTab==="author"&&(
            <div className="space-y-4">
              <div><h3 className="text-white font-bold text-lg mb-1">👤 Author Profile</h3><p className="text-white/40 text-sm">Used for back-cover bio and author page.</p></div>
              <div><label className="text-white/60 text-sm font-medium block mb-2">Author Name</label><input value={author.name||""} onChange={e=>setAuthor({...author,name:e.target.value})} placeholder="Your pen name or real name" className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white placeholder-white/20 focus:outline-none focus:border-purple-500 text-sm"/></div>
              <div><label className="text-white/60 text-sm font-medium block mb-2">Bio</label><textarea rows={4} value={author.bio||""} onChange={e=>setAuthor({...author,bio:e.target.value})} placeholder="Your author bio — 100-200 words works best" className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white placeholder-white/20 focus:outline-none focus:border-purple-500 resize-none text-sm"/></div>
              <div><label className="text-white/60 text-sm font-medium block mb-2">Website / Newsletter Link</label><input value={author.website||""} onChange={e=>setAuthor({...author,website:e.target.value})} placeholder="https://yourwebsite.com" className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white placeholder-white/20 focus:outline-none focus:border-purple-500 text-sm"/></div>
              <button onClick={saveAuthor} className={`w-full py-3 rounded-xl font-semibold transition-all ${authorSaved?"bg-green-500 text-white":"bg-gradient-to-r from-purple-500 to-pink-500 text-white hover:opacity-90"}`}>{authorSaved?"✅ Saved!":"Save Author Profile"}</button>
            </div>
          )}
          {sTab==="build"&&(
            <div className="space-y-5">
              <div><h3 className="text-white font-bold text-lg mb-1">🔧 Build Settings</h3><p className="text-white/40 text-sm">Control how auto-build handles quality gates.</p></div>
              <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-white font-medium text-sm">Auto-Correct on Gate Failure</p>
                    <p className="text-white/40 text-xs mt-1">When a quality gate fails at the end of auto-build, automatically apply AI suggestions and re-score. Disable if you prefer to review suggestions manually before applying.</p>
                  </div>
                  <button onClick={()=>{const v=!autoCorrect;setAutoCorrect(v);setAutoCorrectSetting(v);}} className={`relative shrink-0 w-12 h-6 rounded-full transition-colors ${autoCorrect?"bg-green-500":"bg-white/20"}`}>
                    <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full transition-transform ${autoCorrect?"translate-x-6":"translate-x-0.5"}`}/>
                  </button>
                </div>
              </div>
              <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                <p className="text-white/50 text-xs">When enabled, auto-build will:</p>
                <ul className="text-white/40 text-xs mt-2 space-y-1.5">
                  <li className="flex gap-2"><span className="text-purple-400">📖</span>Apply Review Agent title, subtitle, keyword & SEO suggestions if review score &lt; 70</li>
                  <li className="flex gap-2"><span className="text-purple-400">✍️</span>Analyze chapters for AI-tell rewrites and apply them if writing quality score &lt; 78</li>
                  <li className="flex gap-2"><span className="text-purple-400">🔄</span>Re-run both quality checks and report the improved scores</li>
                </ul>
                <p className="text-white/30 text-xs mt-3 italic">Each step is quota-guarded — won't run if you're low on daily API requests.</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Header ────────────────────────────────────────────────────────────────────
function Header({onBack,title,subtitle,onSettings,onTour,activeTab,setActiveTab}){
  const [usage,setUsage]=useState(getUsage());
  useEffect(()=>{const t=setInterval(()=>setUsage(getUsage()),3000);return()=>clearInterval(t);},[]);
  const pct=Math.min(Math.round((usage/DAILY_LIMIT)*100),100);
  const qLen=getQueue().length;
  return(
    <div className="border-b border-white/10 bg-black/30 backdrop-blur-sm sticky top-0 z-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          {onBack&&<button onClick={onBack} className="text-white/40 hover:text-white text-sm shrink-0">← Back</button>}
          <div className="w-9 h-9 bg-gradient-to-br from-purple-500 to-pink-500 rounded-xl flex items-center justify-center text-lg shrink-0">📚</div>
          <div className="min-w-0"><h1 className="text-white font-bold text-base leading-tight truncate">{title||"BookForge AI"}</h1>{subtitle&&<p className="text-white/30 text-xs truncate">{subtitle}</p>}</div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 flex items-center gap-2">
            <span className={`text-xs font-bold ${pct>=90?"text-red-400":pct>=70?"text-amber-400":"text-green-400"}`}>{usage}/{DAILY_LIMIT}</span>
            <div className="w-10 h-1 bg-white/10 rounded-full overflow-hidden"><div className={`h-full rounded-full ${pct>=90?"bg-red-500":pct>=70?"bg-amber-500":"bg-green-500"}`} style={{width:`${pct}%`}}/></div>
          </div>
          {qLen>0&&<div className="bg-cyan-500/20 border border-cyan-500/30 text-cyan-300 text-xs px-2.5 py-1.5 rounded-lg">⏳ Queue: {qLen}</div>}
          <button onClick={onSettings} className={`text-xs px-3 py-1.5 rounded-lg border transition-all ${getKey()?"border-white/20 text-white/50 hover:border-white/40":"border-red-500/50 text-red-400 bg-red-500/10 pulse-a"}`}>{getKey()?"⚙️ Settings":"⚠️ Set API Key"}</button>
          {onTour&&<button onClick={onTour} title="Page tour — learn how to use this page" className="text-xs px-3 py-1.5 rounded-lg border border-purple-500/40 text-purple-300/70 hover:bg-purple-500/20 transition-all" id="tour-btn">❓ Tour</button>}
        </div>
      </div>
      {setActiveTab&&(
        <div id="bf-home-tabs" className="max-w-7xl mx-auto px-4 sm:px-6 flex gap-1">
          {[["📚 Library","library"],["📗 Series","series"],["⏳ Queue","queue"],["🎌 Manga","manga"]].map(([label,id])=>(
            <button key={id} onClick={()=>setActiveTab(id)} className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap rounded-t-lg transition-all ${activeTab===id?"bg-white/10 text-white border-b-2 border-purple-500":"text-white/35 hover:text-white/70"}`}>{label}</button>
          ))}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// REVIEW AGENT
// ══════════════════════════════════════════════════════════════════════════════
async function runReviewAgent(book){
  const outline=(()=>{try{return JSON.parse(book.outline||"{}");}catch{return {};}})();
  const raw=await callGemini(
    `You are a professional book publishing strategist and Amazon KDP expert with deep knowledge of what makes books bestsellers.\n\n`+
    `Review this book for market-readiness and discoverability. Be critical, specific, and commercially minded.\n\n`+
    `Book Details:\nTitle: ${book.title}\nSubtitle: ${book.subtitle||"(none)"}\nGenre: ${book.genre}\n`+
    `Target Audience: ${book.target_audience}\nSEO Title: ${book.seo_title||"(not set)"}\n`+
    `SEO Description: ${book.seo_description||"(not set)"}\nKeywords: ${book.seo_keywords||"(not set)"}\n`+
    `Description: ${outline.description||book.description}\n\n`+
    `Evaluate:\n1. Title appeal & marketability\n2. Keyword strength & searchability\n3. SEO description quality\n4. Subtitle effectiveness\n5. Market differentiation\n\n`+
    `Respond ONLY with valid JSON:\n`+
    `{"overall_score":85,"title_score":80,"keyword_score":75,"seo_score":85,"differentiation_score":80,`+
    `"verdict":"PASS","verdict_reason":"One sentence summary.",`+
    `"strengths":["strength 1","strength 2","strength 3"],`+
    `"issues":["issue 1","issue 2"],`+
    `"title_suggestions":["Better Title: Subtitle","Alternative Title 2"],`+
    `"keyword_suggestions":["keyword 1","keyword 2","keyword 3","keyword 4","keyword 5"],`+
    `"seo_rewrite":"A rewritten stronger SEO description.",`+
    `"subtitle_suggestion":"A stronger subtitle.",`+
    `"hook_strength_score":75,`+
    `"hook_analysis":"Why the current hook does or does not grab readers in 2 seconds — be specific",`+
    `"top_3_fixes":["Single most impactful change to make right now","Second fix","Third fix"],`+
    `"amazon_search_prediction":"The exact search query most likely to surface this book on Amazon",`+
    `"estimated_page_count":${Math.round(((book.chapters||[]).filter(c=>c.content).reduce((a,c)=>a+(c.content||"").split(/\\s+/).length,0))/250)||100}}`+
    `\nVerdict must be "PASS" if overall_score>=70, otherwise "FAIL".`,0.5
  );
  trackUsage();
  const match=raw.match(/\{[\s\S]*\}/);
  if(!match)throw{code:"PARSE",msg:"Could not parse review."};
  try{return JSON.parse(match[0]);}catch(pe){throw{code:"PARSE",msg:"AI returned malformed JSON — please retry."};}
}

function ReviewPanel({book,onApply,onSettings}){
  const [review,setReview]=useState(book.review||null);
  const [loading,setLoading]=useState(false);
  const [improving,setImproving]=useState(false);
  const [error,setError]=useState("");
  const [applied,setApplied]=useState({});
  const run=async()=>{if(!getKey()){onSettings();return;}setLoading(true);setError("");try{const r=await runReviewAgent(book);setReview(r);updateBook(book.id,{review:r,review_done:true});}catch(e){setError(errMsg(e));}finally{setLoading(false);}};
  const applyTitle=t=>{const parts=t.split(":");const title=parts[0].trim();const subtitle=parts.slice(1).join(":").trim();onApply({title,subtitle:subtitle||book.subtitle});setApplied(a=>({...a,title:true}));};
  const applyKeywords=kws=>{onApply({seo_keywords:kws.join(", ")});setApplied(a=>({...a,kws:true}));};
  const applySEO=d=>{onApply({seo_description:d});setApplied(a=>({...a,seo:true}));};
  const applySubtitle=s=>{onApply({subtitle:s});setApplied(a=>({...a,sub:true}));};
  const hasImprovements=!!(review&&(review.title_suggestions?.length||review.subtitle_suggestion||review.keyword_suggestions?.length||review.seo_rewrite));
  const improveBook=async()=>{
    if(!review||!hasImprovements||improving)return;
    if(!getKey()){onSettings();return;}
    setImproving(true);setError("");
    const oldScore=review.overall_score;
    try{
      const updates={};
      if(review.title_suggestions?.[0]){
        const parts=review.title_suggestions[0].split(":");
        updates.title=parts[0].trim();
        const subFromTitle=parts.slice(1).join(":").trim();
        if(subFromTitle)updates.subtitle=subFromTitle;
      }
      if(review.subtitle_suggestion)updates.subtitle=review.subtitle_suggestion;
      if(review.keyword_suggestions?.length)updates.seo_keywords=review.keyword_suggestions.join(", ");
      if(review.seo_rewrite)updates.seo_description=review.seo_rewrite;
      const updatedBook=onApply(updates)||{...book,...updates};
      setApplied({title:!!updates.title,sub:!!updates.subtitle,kws:!!updates.seo_keywords,seo:!!updates.seo_description});
      const r=await runReviewAgent(updatedBook);
      setReview(r);
      updateBook(book.id,{review:r,review_done:true});
      const delta=r.overall_score-oldScore;
      flash_review(delta>=0?`Improved! Score: ${oldScore} → ${r.overall_score} (+${delta}) 🚀`:`Re-scored: ${oldScore} → ${r.overall_score}`);
    }catch(e){setError(errMsg(e));}
    finally{setImproving(false);}
  };
  const [reviewFlash,setReviewFlash]=useState("");
  function flash_review(msg){setReviewFlash(msg);setTimeout(()=>setReviewFlash(""),5000);}
  return(
    <div className="max-w-3xl mx-auto space-y-5">
      <Card>
        <div className="flex items-start justify-between gap-4 mb-4">
          <div><h2 className="text-white text-xl font-bold">🤖 AI Review Agent</h2><p className="text-white/40 text-sm mt-1">Scores title, keywords & SEO. Must pass 70+ to unlock publishing.</p></div>
          {review&&<ScoreBadge score={review.overall_score}/>}
        </div>
        {error&&<div className="bg-red-500/20 border border-red-500/30 text-red-300 rounded-xl p-4 mb-4 text-sm">{error}</div>}
        <button onClick={run} disabled={loading} className="w-full bg-gradient-to-r from-purple-500 to-pink-500 text-white py-3.5 rounded-xl font-semibold hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2">
          {loading?<><Spin/>Reviewing…</>:review?"🔄 Re-run Review":"🤖 Run Review Agent"}
        </button>
      </Card>
      {review&&(<>
        <div className={`rounded-2xl p-5 border ${review.verdict==="PASS"?"bg-green-500/10 border-green-500/30":"bg-red-500/10 border-red-500/30"}`}>
          <div className="flex items-center gap-3 mb-1"><span className="text-2xl">{review.verdict==="PASS"?"✅":"❌"}</span>
            <div><p className={`font-bold text-lg ${review.verdict==="PASS"?"text-green-300":"text-red-300"}`}>{review.verdict==="PASS"?"Approved for Publishing":"Not Ready — Action Required"}</p>
              <p className="text-white/50 text-sm">{review.verdict_reason}</p></div></div>
        </div>
        {reviewFlash&&<div className="bg-purple-500/15 border border-purple-500/40 text-purple-200 rounded-xl p-3 text-sm text-center font-medium">{reviewFlash}</div>}
        {hasImprovements&&<button onClick={improveBook} disabled={improving} className="w-full bg-gradient-to-r from-amber-500 to-orange-500 text-white py-4 rounded-xl font-bold text-lg hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2 shadow-lg shadow-amber-900/30">
          {improving?<><Spin/>Improving & re-scoring…</>:"🚀 Improve My Odds — Apply All Suggestions"}
        </button>}
        <Card>
          <h3 className="text-white font-semibold mb-4">Score Breakdown</h3>
          {[["📖 Title","title_score"],["🔑 Keywords","keyword_score"],["🔍 SEO Description","seo_score"],["⭐ Differentiation","differentiation_score"]].map(([label,key])=>(
            <div key={key} className="mb-3">
              <div className="flex justify-between text-sm mb-1"><span className="text-white/60">{label}</span><span className={`font-bold ${review[key]>=80?"text-green-400":review[key]>=60?"text-amber-400":"text-red-400"}`}>{review[key]}/100</span></div>
              <div className="h-1.5 bg-white/10 rounded-full overflow-hidden"><div className={`h-full rounded-full ${review[key]>=80?"bg-green-500":review[key]>=60?"bg-amber-500":"bg-red-500"}`} style={{width:`${review[key]}%`}}/></div>
            </div>
          ))}
        </Card>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="bg-green-500/10 border border-green-500/20 rounded-2xl p-5"><h3 className="text-green-300 font-semibold mb-3">✅ Strengths</h3><ul className="space-y-2">{review.strengths?.map((s,i)=><li key={i} className="text-white/70 text-sm flex gap-2"><span className="text-green-400 shrink-0">•</span>{s}</li>)}</ul></div>
          <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-5"><h3 className="text-red-300 font-semibold mb-3">⚠️ Issues</h3>{review.issues?.length>0?<ul className="space-y-2">{review.issues.map((s,i)=><li key={i} className="text-white/70 text-sm flex gap-2"><span className="text-red-400 shrink-0">•</span>{s}</li>)}</ul>:<p className="text-white/40 text-sm italic">No major issues.</p>}</div>
        </div>
        {review.title_suggestions?.length>0&&<Card><h3 className="text-white font-semibold mb-3">📖 Stronger Titles</h3><div className="space-y-2">{review.title_suggestions.map((t,i)=><div key={i} className="flex items-center justify-between gap-3 bg-white/5 rounded-xl px-4 py-3"><p className="text-white/80 text-sm flex-1">{t}</p><button onClick={()=>applyTitle(t)} className={`text-xs px-3 py-1.5 rounded-lg border shrink-0 ${applied.title?"border-green-500/40 text-green-400":"border-purple-500/40 text-purple-300 hover:bg-purple-500/20"}`}>{applied.title?"Applied ✓":"Apply"}</button></div>)}</div></Card>}
        {review.subtitle_suggestion&&<Card><h3 className="text-white font-semibold mb-2">📝 Subtitle Suggestion</h3><div className="flex items-center justify-between gap-3 bg-white/5 rounded-xl px-4 py-3"><p className="text-white/80 text-sm flex-1 italic">"{review.subtitle_suggestion}"</p><button onClick={()=>applySubtitle(review.subtitle_suggestion)} className={`text-xs px-3 py-1.5 rounded-lg border shrink-0 ${applied.sub?"border-green-500/40 text-green-400":"border-purple-500/40 text-purple-300 hover:bg-purple-500/20"}`}>{applied.sub?"Applied ✓":"Apply"}</button></div></Card>}
        {review.keyword_suggestions?.length>0&&<Card><h3 className="text-white font-semibold mb-3">🔑 Keyword Suggestions</h3><div className="flex flex-wrap gap-2 mb-3">{review.keyword_suggestions.map((k,i)=><span key={i} className="bg-purple-500/20 text-purple-300 text-xs px-3 py-1.5 rounded-full border border-purple-500/30">{k}</span>)}</div><button onClick={()=>applyKeywords(review.keyword_suggestions)} className={`text-sm px-4 py-2 rounded-lg border ${applied.kws?"border-green-500/40 text-green-400":"border-purple-500/40 text-purple-300 hover:bg-purple-500/20"}`}>{applied.kws?"Applied ✓":"Apply Keywords"}</button></Card>}
        {review.seo_rewrite&&<Card><h3 className="text-white font-semibold mb-2">🔍 Rewritten SEO Description</h3><p className="text-white/70 text-sm leading-relaxed mb-3 bg-white/5 rounded-xl p-4">{review.seo_rewrite}</p><button onClick={()=>applySEO(review.seo_rewrite)} className={`text-sm px-4 py-2 rounded-lg border ${applied.seo?"border-green-500/40 text-green-400":"border-purple-500/40 text-purple-300 hover:bg-purple-500/20"}`}>{applied.seo?"Applied ✓":"Apply Description"}</button></Card>}
        {review.top_3_fixes?.length>0&&<Card><h3 className="text-white font-semibold mb-3">🎯 Top 3 Fixes (Act on These First)</h3><div className="space-y-2">{review.top_3_fixes.map((f,i)=><div key={i} className="flex gap-3 bg-amber-500/10 border border-amber-500/20 rounded-xl px-4 py-3"><span className="text-amber-400 font-bold text-sm shrink-0">#{i+1}</span><p className="text-white/80 text-sm">{f}</p></div>)}</div></Card>}
        {(review.hook_strength_score||review.hook_analysis)&&<Card><div className="flex items-center justify-between mb-3"><h3 className="text-white font-semibold">🪝 Hook Strength</h3><ScoreBadge score={review.hook_strength_score||0}/></div>{review.hook_analysis&&<p className="text-white/60 text-sm leading-relaxed bg-white/5 rounded-xl p-4">{review.hook_analysis}</p>}</Card>}
        {review.amazon_search_prediction&&<Card><h3 className="text-white font-semibold mb-2">🔎 Most Likely Amazon Search Query</h3><div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-4"><p className="text-blue-200 text-sm font-mono">"{review.amazon_search_prediction}"</p></div><p className="text-white/30 text-xs mt-2">This is the search phrase most likely to surface your book. Make sure your title and keywords cover it.</p></Card>}
      </>)}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// BESTSELLER TOOLS
// ══════════════════════════════════════════════════════════════════════════════

// ── Competitor Analysis Panel ─────────────────────────────────────────────────
function CompetitorPanel({book,onSettings}){
  const [data,setData]=useState(book.competitor_analysis||null);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState("");
  const run=async()=>{
    if(!getKey()){onSettings();return;}
    setLoading(true);setLoadStep("Building your series world bible…");setError("");
    try{
      const raw=await callGemini(
        `You are an Amazon KDP market research expert. Analyze the competitive landscape for this book.\n\n`+
        `Title: ${book.title}\nGenre: ${book.genre}\nAudience: ${book.target_audience}\nDescription: ${book.description}\n\n`+
        `Provide a detailed competitive analysis to help this book become a bestseller.\n\n`+
        `Respond ONLY with valid JSON:\n`+
        `{"market_summary":"2-3 sentence overview of this genre's market right now",`+
        `"top_competitors":[{"title":"","author":"","what_works":"why this book sells well","weakness":"what readers complain about in reviews"}],`+
        `"market_gaps":["gap or opportunity this book can fill"],`+
        `"positioning_statement":"One powerful sentence that positions this book uniquely",`+
        `"competitive_advantages":["specific advantage this book has"],`+
        `"reader_pain_points":["what readers in this genre crave but rarely get"],`+
        `"pricing_recommendation":{"launch_price":"","rationale":""},`+
        `"ku_recommendation":{"enroll_in_ku":true,"rationale":""},`+
        `"launch_strategy":["step 1","step 2","step 3","step 4"],`+
        `"categories":{"primary":"exact Amazon category path","secondary":"exact Amazon category path","why":"reason these categories give best chance of bestseller flag"}}`,0.4
      );
      trackUsage();
      const match=raw.match(/\{[\s\S]*\}/);
      if(!match)throw{code:"PARSE"};
      let result;try{result=JSON.parse(match[0]);}catch(pe){throw{code:"PARSE",msg:"AI returned malformed JSON — please retry."};}
      setData(result);
      updateBook(book.id,{competitor_analysis:result,competitor_done:true});
    }catch(e){setError(errMsg(e));}
    finally{setLoading(false);}
  };
  return(
    <div className="space-y-5">
      <Card>
        <div className="flex items-start justify-between gap-4 mb-4">
          <div><h2 className="text-white text-xl font-bold">🔎 Competitor Analysis</h2><p className="text-white/40 text-sm mt-1">AI researches your genre's market and shows you exactly how to position your book to stand out and hit bestseller.</p></div>
        </div>
        {error&&<div className="bg-red-500/20 border border-red-500/30 text-red-300 rounded-xl p-4 mb-4 text-sm">{error}</div>}
        <button onClick={run} disabled={loading} className="w-full bg-gradient-to-r from-purple-500 to-pink-500 text-white py-3.5 rounded-xl font-semibold hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2">
          {loading?<><Spin/>Analyzing market…</>:data?"🔄 Re-analyze":"🔎 Analyze Market"}
        </button>
      </Card>
      {data&&(<>
        <Card><h3 className="text-white font-semibold mb-2">📊 Market Overview</h3><p className="text-white/70 text-sm leading-relaxed">{data.market_summary}</p></Card>
        {data.positioning_statement&&<div className="bg-gradient-to-r from-purple-900/60 to-pink-900/40 border border-purple-500/30 rounded-2xl p-5"><p className="text-white/40 text-xs uppercase tracking-wider mb-2">Your Positioning Statement</p><p className="text-white font-semibold text-lg leading-snug">"{data.positioning_statement}"</p></div>}
        {data.top_competitors?.length>0&&<Card><h3 className="text-white font-semibold mb-3">📚 Top Competitors</h3><div className="space-y-3">{data.top_competitors.map((c,i)=><div key={i} className="bg-white/5 rounded-xl p-4"><p className="text-white font-medium text-sm">{c.title}<span className="text-white/30 font-normal"> by {c.author}</span></p><p className="text-green-400/70 text-xs mt-1">✓ {c.what_works}</p><p className="text-red-400/70 text-xs mt-0.5">✗ {c.weakness}</p></div>)}</div></Card>}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {data.market_gaps?.length>0&&<Card><h3 className="text-white font-semibold mb-3">💡 Market Gaps You Can Fill</h3><ul className="space-y-2">{data.market_gaps.map((g,i)=><li key={i} className="text-white/70 text-sm flex gap-2"><span className="text-purple-400 shrink-0">→</span>{g}</li>)}</ul></Card>}
          {data.reader_pain_points?.length>0&&<Card><h3 className="text-white font-semibold mb-3">❤️ What Readers Crave</h3><ul className="space-y-2">{data.reader_pain_points.map((p,i)=><li key={i} className="text-white/70 text-sm flex gap-2"><span className="text-pink-400 shrink-0">•</span>{p}</li>)}</ul></Card>}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {data.pricing_recommendation&&<Card><h3 className="text-white font-semibold mb-2">💰 Price Strategy</h3><p className="text-3xl font-bold text-green-400 mb-1">{data.pricing_recommendation.launch_price}</p><p className="text-white/50 text-sm">{data.pricing_recommendation.rationale}</p></Card>}
          {data.ku_recommendation&&<Card><h3 className="text-white font-semibold mb-2">📖 KU vs Wide</h3><p className={`text-lg font-bold mb-1 ${data.ku_recommendation.enroll_in_ku?"text-cyan-400":"text-amber-400"}`}>{data.ku_recommendation.enroll_in_ku?"✅ Enroll in KU":"❌ Go Wide"}</p><p className="text-white/50 text-sm">{data.ku_recommendation.rationale}</p></Card>}
        </div>
        {data.categories&&<Card><h3 className="text-white font-semibold mb-3">🏆 Amazon Categories for Bestseller Badge</h3><div className="space-y-2"><div className="bg-white/5 rounded-xl p-3"><p className="text-white/30 text-xs mb-1">Primary</p><p className="text-white text-sm font-medium">{data.categories.primary}</p></div><div className="bg-white/5 rounded-xl p-3"><p className="text-white/30 text-xs mb-1">Secondary</p><p className="text-white text-sm font-medium">{data.categories.secondary}</p></div><p className="text-white/40 text-xs mt-2">{data.categories.why}</p></div></Card>}
        {data.launch_strategy?.length>0&&<Card><h3 className="text-white font-semibold mb-3">🚀 Launch Strategy</h3><div className="space-y-2">{data.launch_strategy.map((s,i)=><div key={i} className="flex gap-3 items-start"><span className="w-6 h-6 bg-purple-500/30 text-purple-300 rounded-full flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">{i+1}</span><p className="text-white/70 text-sm">{s}</p></div>)}</div></Card>}
      </>)}
    </div>
  );
}

// ── Hook Generator Panel ──────────────────────────────────────────────────────
function HookPanel({book,onSettings}){
  const [data,setData]=useState(book.hooks||null);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState("");
  const run=async()=>{
    if(!getKey()){onSettings();return;}
    setLoading(true);setError("");
    try{
      const outline=(()=>{try{return JSON.parse(book.outline||"{}");}catch{return {};}})();
      const raw=await callGemini(
        `You are a bestselling author and master of book marketing copy. Generate high-converting hooks for this book.\n\n`+
        `Title: ${book.title}\nSubtitle: ${book.subtitle||""}\nGenre: ${book.genre}\nAudience: ${book.target_audience}\n`+
        `Description: ${outline.description||book.description}\nSEO Keywords: ${book.seo_keywords||""}\n\n`+
        `Respond ONLY with valid JSON:\n`+
        `{"opening_lines":[`+
        `{"style":"In Medias Res","line":"drop us into action already in progress — no setup"},`+
        `{"style":"Thriller/Suspense","line":"immediate dread, ticking clock, or threat"},`+
        `{"style":"Literary","line":"atmospheric, voice-driven, literary register"},`+
        `{"style":"Commercial/Hook","line":"relatable problem or desire that speaks directly to the audience"},`+
        `{"style":"Question/Intrigue","line":"unanswerable question that forces reader to keep going"}],`+
        `"back_cover_blurbs":["compelling 100-word blurb version 1","version 2"],`+
        `"amazon_a_plus_headline":"Short punchy headline for Amazon A+ content",`+
        `"series_read_order_page":"Full text of a 'Also by the Author / Books in this Series' page to embed at the end of the book",`+
        `"social_media_hooks":["Instagram/TikTok hook 1","hook 2","hook 3"],`+
        `"email_subject_lines":["launch email subject 1","subject 2"],`+
        `"tagline":"One punchy tagline under 10 words"}`,0.9
      );
      trackUsage();
      const match=raw.match(/\{[\s\S]*\}/);
      if(!match)throw{code:"PARSE"};
      let result;try{result=JSON.parse(match[0]);}catch(pe){throw{code:"PARSE",msg:"AI returned malformed JSON — please retry."};}
      setData(result);
      updateBook(book.id,{hooks:result,hooks_done:true});
    }catch(e){setError(errMsg(e));}
    finally{setLoading(false);}
  };
  const copy=text=>{navigator.clipboard.writeText(text).catch(()=>{});};
  return(
    <div className="space-y-5">
      <Card>
        <div className="flex items-start justify-between gap-4 mb-4">
          <div><h2 className="text-white text-xl font-bold">🪝 Hook Generator</h2><p className="text-white/40 text-sm mt-1">Generates your opening line, back-cover blurb, tagline, social hooks, and a series read-order page — the stuff that converts browsers into buyers.</p></div>
        </div>
        {error&&<div className="bg-red-500/20 border border-red-500/30 text-red-300 rounded-xl p-4 mb-4 text-sm">{error}</div>}
        <button onClick={run} disabled={loading} className="w-full bg-gradient-to-r from-purple-500 to-pink-500 text-white py-3.5 rounded-xl font-semibold hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2">
          {loading?<><Spin/>Generating hooks…</>:data?"🔄 Regenerate":"🪝 Generate Hooks"}
        </button>
      </Card>
      {data&&(<>
        {data.tagline&&<div className="bg-gradient-to-r from-purple-900/60 to-pink-900/40 border border-purple-500/30 rounded-2xl p-5 text-center"><p className="text-white/40 text-xs uppercase tracking-wider mb-2">Tagline</p><p className="text-white font-bold text-2xl">"{data.tagline}"</p></div>}
        {data.opening_lines?.length>0&&<Card><h3 className="text-white font-semibold mb-3">✍️ Opening Line Options <span className="text-white/30 font-normal text-sm">(5 styles — pick your favorite)</span></h3><div className="space-y-3">{data.opening_lines.map((l,i)=>{const lineText=typeof l==="object"?l.line:l;const style=typeof l==="object"?l.style:null;return(<div key={i} className="bg-white/5 rounded-xl p-4 flex justify-between gap-3 items-start"><div className="flex-1">{style&&<span className="text-xs font-bold text-purple-400 uppercase tracking-wider mb-1 block">{style}</span>}<p className="text-white/80 text-sm leading-relaxed italic">"{lineText}"</p></div><button onClick={()=>copy(lineText)} className="text-xs border border-white/20 text-white/30 px-2 py-1 rounded-lg hover:text-white shrink-0">Copy</button></div>);})}</div></Card>}
        {data.back_cover_blurbs?.length>0&&<Card><h3 className="text-white font-semibold mb-3">📖 Back Cover Blurbs</h3><div className="space-y-4">{data.back_cover_blurbs.map((b,i)=><div key={i} className="bg-white/5 rounded-xl p-4"><div className="flex justify-between items-center mb-2"><p className="text-white/30 text-xs">Version {i+1}</p><button onClick={()=>copy(b)} className="text-xs border border-white/20 text-white/30 px-2 py-1 rounded-lg hover:text-white">Copy</button></div><p className="text-white/75 text-sm leading-relaxed">{b}</p></div>)}</div></Card>}
        {data.social_media_hooks?.length>0&&<Card><h3 className="text-white font-semibold mb-3">📱 Social Media Hooks</h3><div className="space-y-2">{data.social_media_hooks.map((h,i)=><div key={i} className="bg-white/5 rounded-xl px-4 py-3 flex justify-between gap-3 items-center"><p className="text-white/75 text-sm flex-1">{h}</p><button onClick={()=>copy(h)} className="text-xs border border-white/20 text-white/30 px-2 py-1 rounded-lg hover:text-white shrink-0">Copy</button></div>)}</div></Card>}
        {data.email_subject_lines?.length>0&&<Card><h3 className="text-white font-semibold mb-3">📧 Launch Email Subject Lines</h3><div className="space-y-2">{data.email_subject_lines.map((s,i)=><div key={i} className="bg-white/5 rounded-xl px-4 py-3 flex justify-between gap-3 items-center"><p className="text-white/75 text-sm flex-1">{s}</p><button onClick={()=>copy(s)} className="text-xs border border-white/20 text-white/30 px-2 py-1 rounded-lg hover:text-white shrink-0">Copy</button></div>)}</div></Card>}
        {data.series_read_order_page&&<Card><h3 className="text-white font-semibold mb-2">📗 Series Read-Order Page <span className="text-white/30 font-normal text-sm">(embed at end of book)</span></h3><div className="bg-white/5 rounded-xl p-4 mb-3 max-h-48 overflow-y-auto"><p className="text-white/70 text-sm leading-relaxed whitespace-pre-wrap">{data.series_read_order_page}</p></div><button onClick={()=>copy(data.series_read_order_page)} className="text-sm border border-white/20 text-white/50 px-4 py-2 rounded-lg hover:bg-white/5">Copy Full Page</button></Card>}
        {data.amazon_a_plus_headline&&<Card><h3 className="text-white font-semibold mb-2">🏆 Amazon A+ Headline</h3><p className="text-white/80 text-sm bg-white/5 rounded-xl p-4 italic">"{data.amazon_a_plus_headline}"</p></Card>}
      </>)}
    </div>
  );
}


// ══════════════════════════════════════════════════════════════════════════════
// WRITING QUALITY AGENT — AI-Detection & Human-Level Polish
// ══════════════════════════════════════════════════════════════════════════════
const AI_TELLS=[
  // Hollow openers
  "It was a moment","In that moment","In this moment","At that moment",
  "He couldn't help but","She couldn't help but","They couldn't help but",
  "She found herself","He found himself","They found themselves",
  "He realized that","She realized that","It dawned on him","It dawned on her",
  "There was something about","Something about the way",
  // Stated emotions (show don't tell)
  "Warmth spread through","A wave of","A rush of","A surge of","A flood of",
  "His heart raced","Her heart raced","His heart pounded","Her heart pounded",
  "She felt a pang","He felt a pang","A pang of",
  "His chest tightened","Her chest tightened","A knot formed in",
  "Emotions welled","Tears pricked","His throat tightened","Her throat tightened",
  // Filler beats
  "He let out a breath","She let out a breath","He exhaled slowly","She exhaled slowly",
  "He swallowed hard","She swallowed hard","He swallowed the lump",
  "He bit his lip","She bit her lip","He bit back a smile","She bit back",
  "A beat of silence","A moment of silence","Silence stretched between",
  "He opened his mouth","She opened her mouth","Words failed him","Words escaped her",
  // Hollow observations
  "It was clear that","It was obvious that","It was evident that","It seemed that",
  "A mixture of","A blend of","A combination of","A tangle of emotions",
  "Something shifted","Something changed","Something broke inside",
  "The weight of","The enormity of","The reality of","The gravity of",
  // Unnatural hedging
  "He wasn't sure why","She wasn't sure why","He didn't know why","She didn't know why",
  "He couldn't explain","She couldn't explain","He didn't understand why",
  "Despite himself","Despite herself","Against his better judgment",
  // Cliche physical responses
  "A small smile played","A smile tugged","A ghost of a smile",
  "He searched her face","She searched his face","He studied her expression",
  "As if on cue","As if on instinct","Almost instinctively",
  "It hit him like","It struck him like","Like a punch to the gut",
  // AI structural patterns
  "Not just X, but Y","Not only X, but also Y","More than X, it was Y",
  "He was X, but he was also Y","She was X, but also Y",
  "First X, then Y, and finally Z",
  "Little did he know","Little did she know",
  "What he didn't know","What she didn't realize",
  // Over-explained interiority
  "He thought to himself","She thought to herself",
  "He mused","She mused","He pondered","She pondered",
  "He reflected on","She reflected on",
  // More em-dash/qualifier abuse
  "—but","—yet","—though","—still","—however",
  // Overwrought nature
  "The sun dipped","The moon hung","Stars scattered","The sky painted",
  // Faux profound endings
  "Everything had changed","Nothing would ever be","The world felt different",
  "Nothing was the same","He would never forget","She would always remember",
  // Announce-the-theme sentences
  "This was the moment","This changed everything","This was why","This is why",
  // Safe vagueness
  "somehow","inexplicably","indescribably","overwhelmingly","inexplicably",
  "an emotion he couldn't name","a feeling she couldn't describe",
  // AI closure tells
  "a new chapter","a fresh start","moving forward","one step at a time"
];

async function analyzeChapterHumanness(chapterText, bookTitle, genre, chapterTitle){
  // Sample 4000 chars from different parts for better coverage
  const sample = chapterText.length > 4000
    ? chapterText.slice(0,1400) + "\n...\n" + chapterText.slice(Math.floor(chapterText.length/2)-700, Math.floor(chapterText.length/2)+700) + "\n...\n" + chapterText.slice(-900)
    : chapterText;

  // Local AI-tell scan
  const localTells = AI_TELLS.filter(t => chapterText.toLowerCase().includes(t.toLowerCase()));

  const raw = await callGemini(
    `You are a senior literary editor at a major publishing house with 20 years of experience spotting AI-generated fiction. You have read thousands of manuscripts and know exactly what separates authentic human prose from machine-generated text. You are RUTHLESS and STRICT — your job is to catch every AI tell before this book goes to market. A false PASS is a career-ending mistake.\n\n` +
    `Book: "${bookTitle}" (${genre})\nChapter: "${chapterTitle}"\n\n` +
    `CHAPTER SAMPLE:\n${sample}\n\n` +
    `MANDATORY CHECKS — flag every instance you find:\n` +
    `1. HOLLOW OPENERS: "In that moment", "He couldn't help but", "She found herself", "It dawned on", "Something about the way" — these are AI fingerprints\n` +
    `2. STATED EMOTIONS: AI tells feelings instead of showing them. "His chest tightened" = told. "He pressed his fist to the wall until his knuckles ached" = shown. Flag every told emotion.\n` +
    `3. BALANCED SENTENCE PAIRS: AI loves "He was X, but he was also Y" / "Not just X, but Y" / "More than X, it was Y". These feel mechanical. Flag them all.\n` +
    `4. INTERNAL MONOLOGUE DUMPS: Paragraphs of pure thinking with no action/dialogue/sensation grounding them. Real authors anchor interiority.\n` +
    `5. RHYTHM MONOTONY: Measure sentence length variation. AI defaults to medium-length declarative sentences. Real prose has short punchy sentences. Fragments. Then longer, winding ones that breathe and slow the reader down.\n` +
    `6. GENERIC SENSORY DETAILS: "The air smelled of coffee and rain" — could be any book. Real authors name specific things: the brand, the exact shade, the texture under fingernails.\n` +
    `7. RESOLUTION TOO CLEAN: AI resolves conflict neatly. Real fiction leaves residue — characters don't fully recover, misunderstandings linger.\n` +
    `8. CLICHE PHYSICAL BEATS: "Heart raced", "breath caught", "throat tightened", "swallowed hard", "searched his face", "bit her lip" — automatic red flags.\n` +
    `9. DIALOGUE STAGINESS: AI dialogue explains too much, ends on perfect note. Real dialogue is messier, talks past each other, leaves things unsaid.\n` +
    `10. EM-DASH OVERUSE: AI uses em-dashes constantly for dramatic effect. Flag if more than 2 per page equivalent.\n` +
    `11. HEDGED UNCERTAINTY: "He wasn't sure why", "She didn't know what made her", "Despite himself" — AI uses these to avoid committing to character psychology.\n` +
    `12. PURPLE PROSE: Over-description that slows everything down and feels performative.\n\n` +
    `Score HARSHLY. A chapter with even 3-4 significant AI tells should score below 70.\n` +
    `A human score of 85+ means this chapter could genuinely fool a publisher.\n\n` +
    `Respond ONLY with valid JSON:\n` +
    `{"human_score":65,"verdict":"NEEDS_WORK","verdict_label":"Reads 65% human — AI patterns present",` +
    `"ai_tells_found":["EXACT quote from the text — do not paraphrase, quote the actual words"],` +
    `"structural_issues":["specific structural problem with page/location reference if possible"],` +
    `"voice_issues":["specific voice problem — quote the offending passage"],` +
    `"rhythm_analysis":"Specific assessment of sentence rhythm — is it varied or monotonous?",` +
    `"dialogue_assessment":"Specific assessment of dialogue naturalness",` +
    `"rewrite_examples":[{"original":"EXACT quote from chapter (copy-paste quality)","rewrite":"your human rewrite — grittier, more specific, less tidy","why":"one-line reason"}],` +
    `"overall_advice":"3 specific actionable things this writer must change to pass. Be direct.",` +
    `"strengths":["specific thing that reads authentically human — quote if possible"]}` +
    `\nVerdict: "PASS" if human_score>=78, "NEEDS_WORK" if 55-77, "AI_HEAVY" if below 55.` +
    `\nBe strict. Default to NEEDS_WORK when uncertain. Only PASS chapters that genuinely read like a skilled human author.`, 0.15
  );
  trackUsage();
  const match = raw.match(/\{[\s\S]*\}/);
  if(!match) throw{code:"PARSE"};
  let result;try{result=JSON.parse(match[0]);}catch(pe){throw{code:"PARSE",msg:"AI returned malformed JSON — please retry."};}
  // Merge local scan tells
  if(localTells.length > 0){
    result.ai_tells_found = [...new Set([...(result.ai_tells_found||[]), ...localTells.map(t=>`Pattern detected: "${t}..."`)])];
  }
  return result;
}

async function runManuscriptHumanCheck(book){
  // Sample up to 5 chapters evenly spread
  const written = (book.chapters||[]).filter(c=>c.content);
  if(written.length === 0) throw{code:"ERROR",msg:"No written chapters to analyze."};
  const sample = written.length <= 3 ? written : [written[0], written[Math.floor(written.length/2)], written[written.length-1]];
  const samples = sample.map(c=>c.content.slice(0,800)).join("\n\n---CHAPTER BREAK---\n\n");

  const raw = await callGemini(
    `You are a senior literary editor at a major publishing house. You have 20 years of experience and you are STRICT about AI-generated writing. You know every pattern. Your reputation depends on catching AI prose before it reaches readers.\n\n` +
    `Book: "${book.title}" (${book.genre})\n\n` +
    `MANUSCRIPT SAMPLES (${sample.length} chapters sampled):\n${samples}\n\n` +
    `Assess the OVERALL manuscript for human authenticity. Look for:\n` +
    `- Consistency of voice — does it feel like one human wrote this, or like a language model averaging across styles?\n` +
    `- Emotional truth — do characters feel psychologically real, or do they react in expected/convenient ways?\n` +
    `- Prose fingerprint — does the writing have idiosyncrasies, unexpected word choices, a point of view that feels lived-in?\n` +
    `- Dialogue authenticity — do characters talk past each other, leave things unsaid, interrupt? Or does every exchange resolve perfectly?\n` +
    `- Sentence rhythm — is there genuine variety (fragments, run-ons, short punches, long sweeps) or medium-length monotony?\n` +
    `- Specificity — does the world feel observed (real brands, textures, smells) or generic?\n` +
    `- Structural crutches — does the book lean on "in that moment", "he couldn't help but", balanced sentence pairs?\n\n` +
    `Score STRICTLY. Average AI chapter rewriting gets 60-70. Genuinely human-sounding prose scores 80+.\n` +
    `A manuscript needs 75+ to pass — not 72.\n\n` +
    `Respond ONLY with valid JSON:\n` +
    `{"overall_human_score":68,"manuscript_verdict":"FAIL","verdict_summary":"One blunt sentence on whether this reads human.",` +
    `"top_ai_patterns":["most pervasive AI pattern found — be specific with examples"],` +
    `"voice_consistency":"Detailed assessment — does it feel like one human voice?",` +
    `"dialogue_quality":"Detailed assessment — quote a line that feels staged vs one that feels real if possible",` +
    `"prose_variety":"Detailed assessment — describe the actual sentence rhythm you found",` +
    `"emotional_authenticity":"Detailed assessment — are emotions shown or told? Quote evidence.",` +
    `"specificity_score":"Are details generic or observed? Give examples.",` +
    `"priority_fixes":["most critical fix #1 — be prescriptive","fix #2","fix #3","fix #4"]}` +
    `\nManuscript verdict: "PASS" only if overall_human_score>=75. Otherwise "FAIL". Be strict — err on the side of FAIL.`, 0.15
  );
  trackUsage();
  const match = raw.match(/\{[\s\S]*\}/);
  if(!match) throw{code:"PARSE"};
  try{return JSON.parse(match[0]);}catch(pe){throw{code:"PARSE",msg:"AI returned malformed JSON — please retry."};}
}

function WritingQualityPanel({book,onSettings,onApply}){
  const [chScores, setChScores] = useState(book.writing_quality||{});
  const [manuscript, setManuscript] = useState(book.manuscript_quality||null);
  const [loadingCh, setLoadingCh] = useState(null);
  const [loadingMs, setLoadingMs] = useState(false);
  const [improving, setImproving] = useState(false);
  const [wqFlash, setWqFlash] = useState("");
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState("manuscript");

  function flashWQ(msg){setWqFlash(msg);setTimeout(()=>setWqFlash(""),5000);}

  // Count available rewrite improvements across all scored chapters
  const hasRewrites = Object.values(chScores).some(s=>s.rewrite_examples?.length>0);
  const totalRewrites = Object.values(chScores).reduce((a,s)=>a+(s.rewrite_examples?.length||0),0);

  // Apply all rewrite_examples across all scored chapters, then re-run manuscript check
  const improveWriting = async()=>{
    if(!hasRewrites||improving)return;
    if(!getKey()){onSettings();return;}
    setImproving(true);setError("");
    const oldScore=manuscript?.overall_human_score||avgHuman||0;
    try{
      const chapters=(book.chapters||[]).map((ch,idx)=>{
        const s=chScores[idx];
        if(!s?.rewrite_examples?.length||!ch.content)return ch;
        let content=ch.content;
        for(const ex of s.rewrite_examples){
          if(ex.original&&ex.rewrite&&content.includes(ex.original)){
            content=content.replace(ex.original,ex.rewrite);
          }
        }
        return {...ch,content};
      });
      const updatedBook=onApply?.({chapters})||{...book,chapters};
      // Re-run manuscript check against the improved text
      const result=await runManuscriptHumanCheck(updatedBook);
      setManuscript(result);
      updateBook(book.id,{manuscript_quality:result,chapters,wq_done:true});
      const delta=result.overall_human_score-oldScore;
      flashWQ(delta>=0?`Improved! Score: ${oldScore} → ${result.overall_human_score} (+${delta}) 🚀`:`Re-scored: ${oldScore} → ${result.overall_human_score}`);
    }catch(e){setError(errMsg(e));}
    finally{setImproving(false);}
  };

  const scoreChapter = async(idx) => {
    if(!getKey()){onSettings();return;}
    const ch = book.chapters?.[idx];
    if(!ch?.content){setError("Write this chapter first.");return;}
    setLoadingCh(idx);setError("");
    try{
      const result = await analyzeChapterHumanness(ch.content, book.title, book.genre, ch.title);
      const updated = {...chScores,[idx]:result};
      setChScores(updated);
      updateBook(book.id,{writing_quality:updated});
      // Refresh local chapter list in case parent hasn't re-rendered
      const fresh=getBook(book.id);
      if(fresh?.writing_quality) setChScores(fresh.writing_quality);
    }catch(e){setError(errMsg(e));}
    finally{setLoadingCh(null);}
  };

  const scoreAll = async() => {
    if(!getKey()){onSettings();return;}
    setError("");
    const unscored=(book.chapters||[]).map((ch,idx)=>({ch,idx})).filter(({ch,idx})=>ch.content&&!chScores[idx]);
    const toScore=unscored.length>0?unscored:(book.chapters||[]).map((ch,idx)=>({ch,idx})).filter(({ch})=>ch.content);
    for(const {ch,idx} of toScore){
      if(getUsage()>=DAILY_LIMIT){setError("Quota reached — scored what we could.");break;}
      setLoadingCh(idx);
      try{
        const result = await analyzeChapterHumanness(ch.content, book.title, book.genre, ch.title);
        const fresh=getBook(book.id);
        const updated = {...(fresh?.writing_quality||chScores),[idx]:result};
        setChScores({...updated});
        updateBook(book.id,{writing_quality:updated});
      }catch(e){if(e?.code==="QUOTA"){setError("Quota reached.");break;} /* skip chapter on other errors */}
    }
    setLoadingCh(null);
  };

  const runMsCheck = async() => {
    if(!getKey()){onSettings();return;}
    setLoadingMs(true);setError("");
    try{
      const result = await runManuscriptHumanCheck(book);
      setManuscript(result);
      updateBook(book.id,{manuscript_quality:result,wq_done:true});
    }catch(e){setError(errMsg(e));}
    finally{setLoadingMs(false);}
  };

  const hc = s => s>=80?"text-green-400":s>=65?"text-amber-400":"text-red-400";
  const hcBg = s => s>=80?"bg-green-500/10 border-green-500/20":s>=65?"bg-amber-500/10 border-amber-500/20":"bg-red-500/10 border-red-500/20";
  const writtenCount = (book.chapters||[]).filter(c=>c.content).length;
  const scoredCount = Object.keys(chScores).length;
  const avgHuman = scoredCount > 0 ? Math.round(Object.values(chScores).reduce((a,s)=>a+(s.human_score||0),0)/scoredCount) : null;
  const msPassed = manuscript?.manuscript_verdict === "PASS";

  return(
    <div className="max-w-3xl mx-auto space-y-5">
      {/* Header */}
      <Card>
        <div className="flex items-start justify-between gap-4 mb-2">
          <div>
            <h2 className="text-white text-xl font-bold">✍️ Writing Quality Agent</h2>
            <p className="text-white/40 text-sm mt-1">Detects AI writing patterns and flags anything that doesn't read like a real human author. Must pass before publishing.</p>
          </div>
          {avgHuman!==null&&<div className="text-center shrink-0"><div className={`text-3xl font-bold ${hc(avgHuman)}`}>{avgHuman}</div><div className="text-white/30 text-xs">avg human score</div></div>}
        </div>
        {manuscript&&(
          <div className={`rounded-xl border p-4 mt-3 ${msPassed?"bg-green-500/10 border-green-500/30":"bg-red-500/10 border-red-500/30"}`}>
            <div className="flex items-center gap-3">
              <span className="text-2xl">{msPassed?"✅":"❌"}</span>
              <div><p className={`font-bold ${msPassed?"text-green-300":"text-red-300"}`}>{msPassed?"Manuscript Approved — Reads Human":"Manuscript Needs Work"}</p><p className="text-white/50 text-sm">{manuscript.verdict_summary}</p></div>
              <span className={`ml-auto text-2xl font-bold shrink-0 ${hc(manuscript.overall_human_score)}`}>{manuscript.overall_human_score}/100</span>
            </div>
          </div>
        )}
        {error&&<div className="bg-red-500/20 border border-red-500/30 text-red-300 rounded-xl p-3 mt-3 text-sm">{error}</div>}
      </Card>

      {/* Sub-tabs */}
      <div className="bg-white/5 border border-white/10 rounded-xl p-1 flex gap-1">
        {[["manuscript","📄 Manuscript Check"],["chapters","📑 Chapter-by-Chapter"]].map(([id,label])=>(
          <button key={id} onClick={()=>setActiveTab(id)} className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-all ${activeTab===id?"bg-purple-500 text-white":"text-white/40 hover:text-white"}`}>{label}</button>
        ))}
      </div>

      {/* MANUSCRIPT TAB */}
      {activeTab==="manuscript"&&(
        <div className="space-y-5">
          <button onClick={runMsCheck} disabled={loadingMs||writtenCount===0} className="w-full bg-gradient-to-r from-purple-500 to-pink-500 text-white py-3.5 rounded-xl font-semibold hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2">
            {loadingMs?<><Spin/>Analyzing manuscript…</>:manuscript?"🔄 Re-analyze Manuscript":"🔍 Analyze Full Manuscript"}
          </button>
          {writtenCount===0&&<p className="text-white/25 text-sm text-center">Write at least one chapter first.</p>}
          {manuscript&&(<>
            {wqFlash&&<div className="bg-purple-500/15 border border-purple-500/40 text-purple-200 rounded-xl p-3 text-sm text-center font-medium">{wqFlash}</div>}
            {hasRewrites&&<button onClick={improveWriting} disabled={improving||loadingMs} className="w-full bg-gradient-to-r from-amber-500 to-orange-500 text-white py-4 rounded-xl font-bold text-lg hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2 shadow-lg shadow-amber-900/30">
              {improving?<><Spin/>Applying {totalRewrites} rewrites & re-scoring…</>:"🚀 Improve My Writing — Apply All Rewrites"}
            </button>}
            {!hasRewrites&&manuscript?.manuscript_verdict!=="PASS"&&<p className="text-white/30 text-xs text-center bg-white/5 rounded-xl p-3">💡 Run Chapter-by-Chapter analysis to get specific rewrite suggestions you can auto-apply here.</p>}
            {/* Dimension breakdown */}
            <Card>
              <h3 className="text-white font-semibold mb-4">Manuscript Assessment</h3>
              <div className="space-y-4">
                {[
                  {label:"Voice Consistency",val:manuscript.voice_consistency},
                  {label:"Dialogue Quality",val:manuscript.dialogue_quality},
                  {label:"Prose Variety & Rhythm",val:manuscript.prose_variety},
                  {label:"Emotional Authenticity",val:manuscript.emotional_authenticity}
                ].map((d,i)=><div key={i}><p className="text-white/50 text-xs uppercase tracking-wider mb-1">{d.label}</p><p className="text-white/75 text-sm leading-relaxed">{d.val}</p></div>)}
              </div>
            </Card>
            {manuscript.top_ai_patterns?.length>0&&(
              <Card>
                <h3 className="text-white font-semibold mb-3">🤖 Top AI Patterns Found</h3>
                <ul className="space-y-2">{manuscript.top_ai_patterns.map((p,i)=><li key={i} className="text-red-300/80 text-sm flex gap-2"><span className="text-red-400 shrink-0">⚠</span>{p}</li>)}</ul>
              </Card>
            )}
            {manuscript.priority_fixes?.length>0&&(
              <Card>
                <h3 className="text-white font-semibold mb-3">🔧 Priority Fixes</h3>
                <div className="space-y-2">{manuscript.priority_fixes.map((f,i)=><div key={i} className="flex gap-3 items-start"><span className="w-6 h-6 bg-purple-500/30 text-purple-300 rounded-full flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">{i+1}</span><p className="text-white/70 text-sm">{f}</p></div>)}</div>
              </Card>
            )}
          </>)}
        </div>
      )}

      {/* CHAPTER-BY-CHAPTER TAB */}
      {activeTab==="chapters"&&(
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-white/40 text-sm">{scoredCount}/{writtenCount} chapters analyzed</p>
            <button onClick={scoreAll} disabled={loadingCh!==null||writtenCount===0} className="text-xs bg-purple-500/20 text-purple-300 border border-purple-500/30 px-4 py-2 rounded-lg hover:bg-purple-500/30 disabled:opacity-40 flex items-center gap-1.5">{loadingCh!==null?<><Spin size="h-3 w-3"/>Analyzing…</>:"Analyze All Chapters"}</button>
          </div>
          {(book.chapters||[]).map((ch,idx)=>{
            const s = chScores[idx];
            const isLoading = loadingCh===idx;
            return(
              <div key={idx} className={`bg-white/5 border rounded-2xl p-5 ${s?hcBg(s.human_score):"border-white/10"}`}>
                <div className="flex items-start justify-between gap-4 mb-3">
                  <div>
                    <p className="text-white font-semibold text-sm">Ch. {ch.number}: {ch.title}</p>
                    {s&&<p className={`text-xs font-medium mt-0.5 ${hc(s.human_score)}`}>{s.verdict_label||s.verdict} · {s.human_score}/100</p>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {s&&<span className={`text-xl font-bold ${hc(s.human_score)}`}>{s.human_score}</span>}
                    <button onClick={()=>scoreChapter(idx)} disabled={isLoading||!ch.content} className="text-xs bg-purple-500/20 text-purple-300 border border-purple-500/30 px-3 py-1.5 rounded-lg hover:bg-purple-500/30 disabled:opacity-40 flex items-center gap-1.5">{isLoading?<><Spin size="h-3 w-3"/>…</>:s?"Re-check":"Check"}</button>
                  </div>
                </div>
                {s&&(<>
                  {s.ai_tells_found?.length>0&&(
                    <div className="mb-3">
                      <p className="text-red-300/60 text-xs uppercase tracking-wider mb-2">AI Tells Detected</p>
                      <div className="space-y-1">{s.ai_tells_found.slice(0,4).map((t,i)=><p key={i} className="text-red-300/70 text-xs flex gap-2"><span>⚠</span><span className="italic">"{t}"</span></p>)}</div>
                    </div>
                  )}
                  {s.rewrite_examples?.length>0&&(
                    <div className="mb-3 space-y-3">
                      <p className="text-white/40 text-xs uppercase tracking-wider">Rewrite Examples</p>
                      {s.rewrite_examples.slice(0,2).map((ex,i)=>(
                        <div key={i} className="bg-black/30 rounded-xl p-3">
                          <div className="flex gap-2 mb-2"><span className="text-red-400 text-xs shrink-0 mt-0.5">AI:</span><p className="text-red-300/70 text-xs italic">"{ex.original}"</p></div>
                          <div className="flex gap-2 mb-1"><span className="text-green-400 text-xs shrink-0 mt-0.5">Human:</span><p className="text-green-300/80 text-xs italic">"{ex.rewrite}"</p></div>
                          {ex.why&&<p className="text-white/25 text-xs ml-12">{ex.why}</p>}
                        </div>
                      ))}
                    </div>
                  )}
                  {s.overall_advice&&<p className="text-white/40 text-xs italic bg-white/5 rounded-lg p-3">💡 {s.overall_advice}</p>}
                  {s.strengths?.length>0&&<div className="mt-2 space-y-1">{s.strengths.map((st,i)=><p key={i} className="text-green-400/60 text-xs flex gap-1"><span>✓</span>{st}</p>)}</div>}
                </>)}
                {!ch.content&&<p className="text-white/20 text-xs">Write this chapter first</p>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Chapter Quality Scorer ────────────────────────────────────────────────────
function ChapterQualityPanel({book,onSettings}){
  const [scores,setScores]=useState(book.chapter_scores||{});
  const [loading,setLoading]=useState(null);
  const [error,setError]=useState("");
  const scoreChapter=async(idx)=>{
    if(!getKey()){onSettings();return;}
    const ch=book.chapters?.[idx];
    if(!ch?.content){setError("Write the chapter first before scoring.");return;}
    setLoading(idx);setError("");
    try{
      const raw=await callGemini(
        `You are a professional developmental editor. Score this chapter ruthlessly — commercial fiction standards.\n\n`+
        `Book: "${book.title}" (${book.genre})\nChapter ${ch.number}: "${ch.title}"\n\n`+
        `CHAPTER TEXT (first 3000 chars):\n${ch.content.slice(0,3000)}\n\n`+
        `Respond ONLY with valid JSON:\n`+
        `{"pacing_score":80,"tension_score":75,"character_voice_score":85,"prose_quality_score":80,"hook_score":70,`+
        `"overall_score":78,"verdict":"STRONG","one_line_verdict":"One sentence assessment.",`+
        `"strengths":["strength 1","strength 2"],`+
        `"weaknesses":["specific weakness 1","specific weakness 2"],`+
        `"rewrite_suggestion":"One specific actionable improvement for the opening paragraph."}`,0.3
      );
      trackUsage();
      const match=raw.match(/\{[\s\S]*\}/);
      if(!match)throw{code:"PARSE"};
      let result;try{result=JSON.parse(match[0]);}catch(pe){throw{code:"PARSE",msg:"AI returned malformed JSON — please retry."};}
      const newScores={...scores,[idx]:result};
      setScores(newScores);
      updateBook(book.id,{chapter_scores:newScores});
    }catch(e){setError(errMsg(e));}
    finally{setLoading(null);}
  };
  const scoreColor=s=>s>=80?"text-green-400":s>=65?"text-amber-400":"text-red-400";
  const weakChapters=(book.chapters||[]).filter((_,i)=>scores[i]&&scores[i].overall_score<70);
  return(
    <div className="space-y-5">
      <Card>
        <h2 className="text-white text-xl font-bold mb-1">📊 Chapter Quality Scorer</h2>
        <p className="text-white/40 text-sm mb-4">Scores each chapter for pacing, tension, prose, and hook strength. Flags weak chapters before publishing.</p>
        {weakChapters.length>0&&<div className="bg-amber-500/15 border border-amber-500/30 rounded-xl p-3 mb-4"><p className="text-amber-300 text-sm font-semibold">⚠️ {weakChapters.length} chapter{weakChapters.length>1?"s":""} below 70 — consider rewriting before publishing.</p></div>}
        {error&&<div className="bg-red-500/20 border border-red-500/30 text-red-300 rounded-xl p-3 text-sm">{error}</div>}
      </Card>
      <div className="space-y-3">
        {(book.chapters||[]).map((ch,idx)=>{
          const s=scores[idx];
          return(
            <div key={idx} className={`bg-white/5 border rounded-2xl p-5 ${s&&s.overall_score<70?"border-amber-500/30":s?"border-green-500/20":"border-white/10"}`}>
              <div className="flex items-start justify-between gap-4 mb-3">
                <div><p className="text-white font-semibold text-sm">Ch. {ch.number}: {ch.title}</p>{s&&<p className="text-white/40 text-xs mt-0.5 italic">{s.one_line_verdict}</p>}</div>
                <div className="flex items-center gap-2 shrink-0">
                  {s&&<span className={`text-lg font-bold ${scoreColor(s.overall_score)}`}>{s.overall_score}</span>}
                  <button onClick={()=>scoreChapter(idx)} disabled={loading===idx||!ch.content} className="text-xs bg-purple-500/20 text-purple-300 border border-purple-500/30 px-3 py-1.5 rounded-lg hover:bg-purple-500/30 disabled:opacity-40 flex items-center gap-1.5">
                    {loading===idx?<><Spin size="h-3 w-3"/>Scoring…</>:s?"Re-score":"Score"}
                  </button>
                </div>
              </div>
              {s&&<>
                <div className="grid grid-cols-5 gap-2 mb-3">
                  {[["Pacing","pacing_score"],["Tension","tension_score"],["Voice","character_voice_score"],["Prose","prose_quality_score"],["Hook","hook_score"]].map(([label,key])=>(
                    <div key={key} className="text-center"><div className={`text-sm font-bold ${scoreColor(s[key])}`}>{s[key]}</div><div className="text-white/25 text-xs">{label}</div></div>
                  ))}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-2">
                  {s.strengths?.map((st,i)=><p key={i} className="text-green-400/70 text-xs flex gap-1"><span>✓</span>{st}</p>)}
                  {s.weaknesses?.map((w,i)=><p key={i} className="text-red-400/70 text-xs flex gap-1"><span>✗</span>{w}</p>)}
                </div>
                {s.rewrite_suggestion&&<p className="text-white/30 text-xs italic bg-white/5 rounded-lg p-3 mt-1">💡 {s.rewrite_suggestion}</p>}
              </>}
              {!ch.content&&<p className="text-white/20 text-xs">Write this chapter first</p>}
            </div>
          );
        })}
      </div>
    </div>
  );
}


// ══════════════════════════════════════════════════════════════════════════════
// CHARACTER MANAGER
// ══════════════════════════════════════════════════════════════════════════════
function CharactersPanel({book,onSettings}){
  const [chars,setCharsState]=useState(()=>getCharacters(book.id));
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState("");
  const [editing,setEditing]=useState(null);
  const [form,setForm]=useState({name:"",role:"",age:"",appearance:"",personality:"",arc:"",notes:""});

  const reload=()=>setCharsState(getCharacters(book.id));

  const autoExtract=async()=>{
    if(!getKey()){onSettings();return;}
    const written=(book.chapters||[]).filter(c=>c.content);
    if(!written.length){setError("Write at least one chapter first.");return;}
    setLoading(true);setError("");
    try{
      const sample=written.slice(0,3).map(c=>c.content.slice(0,800)).join("\n---\n");
      const raw=await callGemini(
        `You are a literary analyst. Extract all named characters from these chapters.\n\nBook: "${book.title}" (${book.genre})\n\nCHAPTER SAMPLES:\n${sample}\n\nRespond ONLY with valid JSON:\n{"characters":[{"name":"","role":"protagonist/antagonist/supporting","age":"","appearance":"physical description","personality":"key traits","arc":"their story role","notes":""}]}`,0.3
      );
      trackUsage();
      const match=raw.match(/\{[\s\S]*\}/);
      if(!match)throw{code:"PARSE"};
      let extracted;try{extracted=JSON.parse(match[0]).characters||[];}catch(pe){extracted=[];}
      const existing=getCharacters(book.id);
      const merged=[...existing];
      extracted.forEach(ec=>{
        if(!merged.find(c=>c.name.toLowerCase()===ec.name.toLowerCase()))
          merged.push({...ec,id:"char_"+Date.now()+"_"+Math.random().toString(36).slice(2,5)});
      });
      setCharacters(book.id,merged);reload();
    }catch(e){setError(errMsg(e));}
    finally{setLoading(false);}
  };

  const save=()=>{
    if(!form.name.trim())return;
    const existing=getCharacters(book.id);
    if(editing){
      const updated=existing.map(c=>c.id===editing?{...c,...form}:c);
      setCharacters(book.id,updated);
    } else {
      setCharacters(book.id,[...existing,{...form,id:"char_"+Date.now()+"_"+Math.random().toString(36).slice(2,5)}]);
    }
    reload();setEditing(null);setForm({name:"",role:"",age:"",appearance:"",personality:"",arc:"",notes:""});
  };

  const del=(id)=>{setCharacters(book.id,getCharacters(book.id).filter(c=>c.id!==id));reload();};
  const edit=(c)=>{setEditing(c.id);setForm({name:c.name,role:c.role||"",age:c.age||"",appearance:c.appearance||"",personality:c.personality||"",arc:c.arc||"",notes:c.notes||""});};

  const ROLES=["protagonist","antagonist","love interest","supporting","minor"];

  return(
    <div className="max-w-3xl mx-auto space-y-5">
      <Card>
        <div className="flex items-start justify-between gap-4 mb-2">
          <div><h2 className="text-white text-xl font-bold">👥 Character Manager</h2><p className="text-white/40 text-sm mt-1">Track character profiles for consistency. AI can auto-extract from your written chapters.</p></div>
          <button onClick={autoExtract} disabled={loading} className="bg-gradient-to-r from-purple-500 to-pink-500 text-white px-4 py-2 rounded-xl text-sm font-semibold hover:opacity-90 disabled:opacity-50 flex items-center gap-2 shrink-0">{loading?<><Spin size="h-4 w-4"/>Extracting…</>:"✨ Auto-Extract"}</button>
        </div>
        {error&&<div className="bg-red-500/20 border border-red-500/30 text-red-300 rounded-xl p-3 text-sm mt-3">{error}</div>}
      </Card>

      {/* Add/Edit form */}
      <Card>
        <h3 className="text-white font-semibold mb-4">{editing?"✏️ Edit Character":"➕ Add Character"}</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
          <div><label className="text-white/50 text-xs block mb-1">Name *</label><input value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="Character name" className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white placeholder-white/20 focus:outline-none focus:border-purple-500 text-sm"/></div>
          <div><label className="text-white/50 text-xs block mb-1">Role</label><select value={form.role} onChange={e=>setForm({...form,role:e.target.value})} className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-purple-500 text-sm"><option value="">Select…</option>{ROLES.map(r=><option key={r} value={r}>{r}</option>)}</select></div>
          <div><label className="text-white/50 text-xs block mb-1">Age</label><input value={form.age} onChange={e=>setForm({...form,age:e.target.value})} placeholder="e.g. 28" className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white placeholder-white/20 focus:outline-none focus:border-purple-500 text-sm"/></div>
          <div><label className="text-white/50 text-xs block mb-1">Arc</label><input value={form.arc} onChange={e=>setForm({...form,arc:e.target.value})} placeholder="Their journey in this book" className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white placeholder-white/20 focus:outline-none focus:border-purple-500 text-sm"/></div>
        </div>
        <div className="space-y-3 mb-4">
          <div><label className="text-white/50 text-xs block mb-1">Appearance</label><textarea rows={2} value={form.appearance} onChange={e=>setForm({...form,appearance:e.target.value})} placeholder="Physical description — be specific for consistency" className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white placeholder-white/20 focus:outline-none focus:border-purple-500 text-sm resize-none"/></div>
          <div><label className="text-white/50 text-xs block mb-1">Personality</label><textarea rows={2} value={form.personality} onChange={e=>setForm({...form,personality:e.target.value})} placeholder="Key personality traits, flaws, quirks" className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white placeholder-white/20 focus:outline-none focus:border-purple-500 text-sm resize-none"/></div>
        </div>
        <div className="flex gap-2">
          {editing&&<button onClick={()=>{setEditing(null);setForm({name:"",role:"",age:"",appearance:"",personality:"",arc:"",notes:""});}} className="border border-white/20 text-white/50 px-4 py-2 rounded-lg text-sm hover:bg-white/5">Cancel</button>}
          <button onClick={save} disabled={!form.name.trim()} className="bg-purple-500 text-white px-5 py-2 rounded-lg text-sm font-semibold hover:opacity-90 disabled:opacity-40">{editing?"Save Changes":"Add Character"}</button>
        </div>
      </Card>

      {/* Character list */}
      {chars.length===0
        ?<div className="text-center py-10 text-white/20"><p>No characters yet. Add manually or auto-extract from chapters.</p></div>
        :<div className="space-y-3">
          {chars.map((c,i)=>(
            <div key={c.id||i} className="bg-white/5 border border-white/10 rounded-2xl p-5">
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-white font-bold">{c.name}</span>
                  {c.role&&<span className="bg-purple-500/20 text-purple-300 text-xs px-2 py-0.5 rounded-full border border-purple-500/20">{c.role}</span>}
                  {c.age&&<span className="text-white/30 text-xs">age {c.age}</span>}
                </div>
                <div className="flex gap-1 shrink-0">
                  <button onClick={()=>edit(c)} className="text-xs text-white/30 hover:text-white px-2 py-1">✏️</button>
                  <button onClick={()=>del(c.id)} className="text-xs text-red-400/40 hover:text-red-400 px-2 py-1">✕</button>
                </div>
              </div>
              {c.appearance&&<p className="text-white/50 text-xs mb-1"><span className="text-white/25">Appearance: </span>{c.appearance}</p>}
              {c.personality&&<p className="text-white/50 text-xs mb-1"><span className="text-white/25">Personality: </span>{c.personality}</p>}
              {c.arc&&<p className="text-cyan-300/50 text-xs italic">{c.arc}</p>}
            </div>
          ))}
        </div>}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// VOICE TRAINING PANEL (in Settings)
// ══════════════════════════════════════════════════════════════════════════════
function VoiceTrainingPanel({onClose}){
  const [sample,setSample]=useState(getVoiceProfile()?.sample||"");
  const [profile,setProfile]=useState(getVoiceProfile());
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState("");
  const [saved,setSaved]=useState(false);

  const analyze=async()=>{
    if(!getKey()){setError("Set your API key first.");return;}
    if(!sample.trim()||sample.length<200){setError("Paste at least 200 characters of your writing.");return;}
    setLoading(true);setError("");
    try{
      const raw=await callGemini(
        `You are a literary style analyst. Analyze this writing sample and extract the author's unique voice fingerprint.\n\nSAMPLE:\n${sample.slice(0,4000)}\n\nRespond ONLY with valid JSON:\n{"sentence_rhythm":"description of average sentence length, variation, fragments vs long","vocabulary_level":"simple/moderate/literary — with examples from text","pov_style":"first/third person, close/distant","emotional_tone":"how emotions are conveyed — direct/understated/theatrical","dialogue_style":"how dialogue sounds, tags used, realistic/stylized","genre_conventions":"genre-specific conventions this author uses","distinctive_patterns":["unique pattern 1","unique pattern 2"],"sample_analysis":"2-3 sentence summary of this author voice that AI should replicate"}`,0.2
      );
      trackUsage();
      const match=raw.match(/\{[\s\S]*\}/);
      if(!match)throw{code:"PARSE"};
      let result;try{result=JSON.parse(match[0]);}catch(pe){throw{code:"PARSE",msg:"AI returned malformed JSON — please retry."};}
      const vp={...result,sample:sample.slice(0,2000),analyzed_at:new Date().toISOString()};
      setVoiceProfile(vp);setProfile(vp);setSaved(true);
    }catch(e){setError(errMsg(e));}
    finally{setLoading(false);}
  };

  return(
    <div className="space-y-5">
      <div>
        <h3 className="text-white font-bold text-lg mb-1">🎙️ Voice Training</h3>
        <p className="text-white/40 text-sm">Paste a sample of your previous writing — a chapter, blog post, anything. AI analyzes your style so every generated chapter sounds like YOU.</p>
      </div>
      {profile&&(
        <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-4">
          <p className="text-green-300 font-semibold text-sm mb-2">✅ Voice Profile Active</p>
          <p className="text-white/60 text-sm">{profile.sample_analysis}</p>
          <div className="grid grid-cols-2 gap-2 mt-3">
            {profile.distinctive_patterns?.slice(0,2).map((p,i)=><p key={i} className="text-white/40 text-xs">• {p}</p>)}
          </div>
        </div>
      )}
      {error&&<div className="bg-red-500/20 border border-red-500/30 text-red-300 rounded-xl p-3 text-sm">{error}</div>}
      <div>
        <label className="text-white/60 text-sm font-medium block mb-2">Your Writing Sample</label>
        <textarea rows={8} value={sample} onChange={e=>setSample(e.target.value)} placeholder="Paste at least 200 characters of your writing — a chapter excerpt, a few paragraphs from a previous book, a blog post..." className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white placeholder-white/20 focus:outline-none focus:border-purple-500 resize-none text-sm"/>
        <p className="text-white/20 text-xs mt-1">{sample.length} chars</p>
      </div>
      <div className="flex gap-3">
        <button onClick={onClose} className="flex-1 border border-white/20 text-white/50 py-2.5 rounded-xl hover:bg-white/5 text-sm">Done</button>
        <button onClick={analyze} disabled={loading||sample.length<200} className="flex-[2] bg-gradient-to-r from-purple-500 to-pink-500 text-white py-2.5 rounded-xl font-semibold hover:opacity-90 disabled:opacity-40 flex items-center justify-center gap-2">{loading?<><Spin/>Analyzing voice…</>:saved?"🔄 Re-analyze":"🎙️ Analyze My Voice"}</button>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// BUILD QUEUE
// ══════════════════════════════════════════════════════════════════════════════
function QueuePage({navigate,onSettings}){
  const [queue,setQueueState]=useState(getQueue());
  const [qBooks,setQBooks]=useState(getBooks());
  const [running,setRunning]=useState(false);
  const [currentId,setCurrentId]=useState(null);
  const [log,setLog]=useState([]);
  const runRef=useRef(false);

  const reload=()=>{setQueueState(getQueue());setQBooks(getBooks());};
  const addToQueue=id=>{const q=getQueue();if(q.includes(id))return;setQueue([...q,id]);reload();};
  const removeFromQueue=id=>{setQueue(getQueue().filter(x=>x!==id));reload();};
  const moveUp=(id)=>{const q=[...getQueue()];const i=q.indexOf(id);if(i>0){[q[i-1],q[i]]=[q[i],q[i-1]];setQueue(q);reload();}};
  const moveDown=(id)=>{const q=[...getQueue()];const i=q.indexOf(id);if(i<q.length-1){[q[i],q[i+1]]=[q[i+1],q[i]];setQueue(q);reload();}};

  const runQueue=async()=>{
    if(runRef.current)return;
    runRef.current=true;setRunning(true);setLog([]);
    const addLog=msg=>setLog(prev=>[...prev,{msg,time:new Date().toLocaleTimeString()}]);
    try{
    while(true){
      const q=getQueue();
      if(q.length===0){addLog("✅ Queue complete!");break;}
      if(getUsage()>=DAILY_LIMIT){addLog("⏳ Daily quota reached. Queue paused — will continue tomorrow.");break;}
      const id=q[0];
      const book=getBook(id);
      if(!book){removeFromQueue(id);continue;}
      setCurrentId(id);
      addLog(`📚 Starting: "${book.title}"…`);
      updateBook(id,{status:"writing",auto_build:true,build_step:"Queue building…"});
      reload();
      // Simulate the auto-build by navigating — instead we inline a mini pipeline
      try{
        const outline=book.outline?JSON.parse(book.outline):{};
        const chapters=[...(book.chapters||[])];
        // Write un-generated chapters
        for(let i=0;i<chapters.length;i++){
          if(getUsage()>=DAILY_LIMIT)break;
          if(chapters[i].generated)continue;
          addLog(`  ✍️ Ch.${i+1}/${chapters.length}: "${chapters[i].title}"`);
          const series=book.series_id?getSeriesById(book.series_id):null;
          const seriesCtx=series?`\n\n${buildSeriesContext(series)}\nMaintain full consistency.`:"";
          const qVP=getVoiceProfile();
          const qVoiceCtx=qVP?.sample_analysis?`\n\nVOICE STYLE TO MATCH: ${qVP.sample_analysis}\nSentence rhythm: ${qVP.sentence_rhythm||''}\nDistinctive patterns: ${(qVP.distinctive_patterns||[]).join(', ')}\nWrite EXACTLY in this style.`:'';
          const qChars=getCharacters(id);
          const qCharCtx=qChars.length?`\n\nESTABLISHED CHARACTERS (maintain exact consistency):\n${qChars.map(c=>`${c.name} [${c.role||''}]: ${c.appearance||''} — ${c.personality||''}`).join('\n')}`:'';
          const qLangNote=book.writing_language&&book.writing_language!=="English"?`\n\nWRITE IN: ${book.writing_language}`:'';
          const qNfNote=book.nonfiction_mode?"\n\nNONFICTION MODE: End the chapter with a clearly marked Exercise, Reflection question, and Action Step.":"";
          const prevChaps=chapters.slice(0,i).filter(c=>c.generated);
          const prev=prevChaps.length===0?"None":
            prevChaps.length<=2?prevChaps.map(c=>c.title).join(", "):
            prevChaps.slice(-3).map(c=>`Ch.${c.number} "${c.title}": ${(c.content||"").slice(0,200).replace(/\n/g," ")}…`).join("\n");
          const content=await callGemini(
            `Write Chapter ${chapters[i].number}: "${chapters[i].title}" for a ${book.genre} book titled "${outline.title||book.title}".${seriesCtx}${qVoiceCtx}${qCharCtx}${qLangNote}${qNfNote}\n`+
            `Chapter description: ${chapters[i].description}\nPrevious: ${prev}\nAudience: ${book.target_audience}\n\n`+
            `2,500–3,500 words. Match genre tone. Aim for the full word count.\n\nSTRUCTURE:\n• 3-5 distinct scenes per chapter, separated by: ⁂\n• Each scene has a clear goal → obstacle → outcome\n• Chapter must END on a hook, unresolved tension, or revelation that forces reading on\n• DO NOT wrap up cleanly — the best chapters end mid-breath\n\nWRITING RULES — violating these will get this chapter rejected:\n• NEVER start a sentence with 'He/She/They couldn't help but', 'In that moment', 'It dawned on', 'Something about the way', 'A wave of', 'A surge of'\n• NEVER state emotions directly ('he felt sad', 'warmth spread through her') — express through physical action, dialogue, or specific sensory detail\n• NEVER use em-dashes for dramatic effect more than once per page\n• VARY sentence length violently: one-word sentences. Fragments. Then a long, breathing sentence that winds through a scene and refuses to end neatly.\n• Dialogue must be messy and human: people talk past each other, leave things half-said, interrupt, change subject\n• Use SPECIFIC details: not 'the coffee shop smelled like coffee' but the burnt-sugar smell of the espresso machine at 6am, the sticky ring on the table from someone's iced latte\n• No clean emotional resolutions — conflict leaves residue\n• Character psychology must be specific, not convenient\n• Every scene must have a sensory anchor: a smell, a texture, a specific sound\n• Read like a published novel — no chapter summaries, no scene headers, no markdown`
          );
          trackUsage();
          chapters[i]={...chapters[i],content,generated:true};
          const wc=chapters.reduce((a,c)=>a+(c.content?c.content.split(/\s+/).length:0),0);
          updateBook(id,{chapters:[...chapters],word_count:wc});
          reload();
        }
        if(getUsage()<DAILY_LIMIT){
          // SEO
          addLog(`  🔍 Generating SEO…`);
          const seoRaw=await callGemini(`Amazon KDP SEO. Title: ${book.title}\nGenre: ${book.genre}\nDesc: ${book.description}\nRespond ONLY JSON: {"seo_title":"","seo_description":"","primary_keywords":[""]}`);
          trackUsage();
          const sm=seoRaw.match(/\{[\s\S]*\}/);
          if(sm){try{const seo=JSON.parse(sm[0]);updateBook(id,{seo_title:seo.seo_title||"",seo_description:seo.seo_description||"",seo_keywords:(seo.primary_keywords||[]).join(", "),seo_done:true});}catch(pe){addLog("⚠️ SEO parse failed — skipping SEO update");}}
        }
        if(getUsage()<DAILY_LIMIT){
          // Cover
          addLog(`  🎨 Generating cover…`);
          const cp=await callGemini(`Professional book cover image prompt for "${book.title}" (${book.genre}). Describe characters, setting, mood, lighting, art style. NO text. Return only the prompt.`);
          trackUsage();
          const artUrl=`https://image.pollinations.ai/prompt/${encodeURIComponent(cp.trim()+". No text.")}?width=832&height=1216&model=flux&nologo=true&enhance=true&seed=${Date.now()}`;
          const finalUrl=await finalizeCoverImage(artUrl,outline.title||book.title,getAuthorProfile().name,book.subtitle);
          updateBook(id,{cover_art_url:artUrl,cover_image_url:finalUrl,cover_done:true});
        }
        if(getUsage()<DAILY_LIMIT){
          // Review
          addLog(`  🤖 Running review agent…`);
          const freshBook=getBook(id);
          const review=await runReviewAgent(freshBook);
          updateBook(id,{review,status:review.verdict==="PASS"?"ready":"writing",auto_build:false,build_step:"",review_done:true,build_complete:true,build_complete_date:new Date().toISOString(),gates_passed:review.verdict==="PASS"});
          addLog(`  ${review.verdict==="PASS"?"✅":"⚠️"} Review: ${review.overall_score}/100 — ${review.verdict}`);
        }
        // Done — remove from queue
        removeFromQueue(id);
        addLog(`✅ "${book.title}" complete!`);
        reload();
      }catch(e){
        const msg=errMsg(e);
        addLog(`❌ Error on "${book.title}": ${msg}`);
        if(e?.code==="QUOTA"){addLog("⏳ Quota hit — queue paused.");break;}
        removeFromQueue(id);// skip broken book
      }finally{
        // ensure current ID resets even on unexpected throw
        setCurrentId(prev=>prev===id?null:prev);
      }
    }
    setCurrentId(null);
    }catch(e){console.error("Queue outer error:",e);}
    finally{setRunning(false);runRef.current=false;setCurrentId(null);reload();}
  };

  const eligibleBooks=qBooks.filter(b=>!["published"].includes(b.status)&&!b.chapters?.every(c=>c.generated));
  const queuedIds=getQueue();

  return(
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
      <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div><h2 className="text-white text-xl font-bold">⏳ Build Queue</h2><p className="text-white/40 text-sm mt-1">Line up multiple books — they build one by one automatically, respecting your daily quota.</p></div>
        {queuedIds.length>0&&<button onClick={runQueue} disabled={running} className="bg-gradient-to-r from-purple-500 to-pink-500 text-white px-5 py-2.5 rounded-xl font-semibold hover:opacity-90 disabled:opacity-50 flex items-center gap-2">{running?<><Spin/>Running queue…</>:"▶ Start Queue"}</button>}
      </div>

      {/* Live log */}
      {log.length>0&&(
        <div className="bg-black/40 border border-white/10 rounded-2xl p-4 mb-6 max-h-48 overflow-y-auto">
          <p className="text-white/30 text-xs uppercase tracking-wider mb-2">Build Log</p>
          {log.map((l,i)=><p key={i} className="text-white/60 text-xs font-mono">[{l.time}] {l.msg}</p>)}
        </div>
      )}

      {/* Current queue */}
      {queuedIds.length>0&&(
        <div className="mb-6">
          <p className="text-white/40 text-xs uppercase tracking-wider mb-3">Queue ({queuedIds.length})</p>
          <div className="space-y-2">
            {queuedIds.map((id,i)=>{
              const b=getBook(id);if(!b)return null;
              const isCurrent=id===currentId;
              return(
                <div key={id} className={`flex items-center gap-3 bg-white/5 border rounded-xl px-4 py-3 ${isCurrent?"border-purple-500/50 bg-purple-500/10":"border-white/10"}`}>
                  <span className="text-white/30 text-sm w-5 text-center">{i+1}</span>
                  {isCurrent&&<Spin size="h-4 w-4"/>}
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-sm font-medium truncate">{b.title}</p>
                    <p className="text-white/30 text-xs">{b.genre} · {b.chapters?.filter(c=>c.generated).length||0}/{b.chapters?.length||0} chapters</p>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <button onClick={()=>moveUp(id)} disabled={i===0||running} className="w-7 h-7 text-white/30 hover:text-white disabled:opacity-20">↑</button>
                    <button onClick={()=>moveDown(id)} disabled={i===queuedIds.length-1||running} className="w-7 h-7 text-white/30 hover:text-white disabled:opacity-20">↓</button>
                    <button onClick={()=>removeFromQueue(id)} disabled={running} className="w-7 h-7 text-red-400/40 hover:text-red-400 disabled:opacity-20">✕</button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Add to queue */}
      <div>
        <p className="text-white/40 text-xs uppercase tracking-wider mb-3">Add Books to Queue</p>
        {eligibleBooks.length===0
          ?<div className="text-center py-10 text-white/20"><p>All books are complete or published.</p><button onClick={()=>setQueueState(getQueue())} className="mt-2 text-purple-400 text-sm hover:text-purple-300">Refresh</button></div>
          :<div className="space-y-2">
            {eligibleBooks.map(b=>{
              const inQueue=queuedIds.includes(b.id);
              return(
                <div key={b.id} className="flex items-center gap-3 bg-white/5 border border-white/10 rounded-xl px-4 py-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-sm font-medium truncate">{b.title}</p>
                    <p className="text-white/30 text-xs">{b.genre} · {b.chapters?.filter(c=>c.generated).length||0}/{b.chapters?.length||"?"} chapters written</p>
                  </div>
                  <button onClick={()=>inQueue?removeFromQueue(b.id):addToQueue(b.id)} disabled={running}
                    className={`text-xs px-3 py-1.5 rounded-lg border transition-all disabled:opacity-40 ${inQueue?"border-red-500/40 text-red-400 hover:bg-red-500/10":"border-purple-500/40 text-purple-300 hover:bg-purple-500/10"}`}>
                    {inQueue?"Remove":"+ Add"}
                  </button>
                </div>
              );
            })}
          </div>}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// SERIES PAGE
// ══════════════════════════════════════════════════════════════════════════════
function SeriesPage({navigate,onSettings}){
  const [seriesList,setSeriesList]=useState(getSeries());
  const [showCreate,setShowCreate]=useState(false);
  const [viewBible,setViewBible]=useState(null);
  const [form,setForm]=useState({name:"",concept:"",genre:"",audience:"",book_count:3,tone:""});
  const [loading,setLoading]=useState(false);
  const [loadStep,setLoadStep]=useState("");
  const [error,setError]=useState("");

  const reload=()=>{const s=getSeries();setSeriesList(s);};

  const createSeries=async()=>{
    if(!getKey()){onSettings();return;}
    if(!form.name||!form.concept||!form.genre||!form.audience){setError("Fill in all fields.");return;}
    setLoading(true);setError("");
    try{
      const raw=await callGemini(
        `You are a master series author and world-builder. Create a comprehensive ${form.book_count}-book series plan.\n`+
        `Series Name: "${form.name}"\nConcept: ${form.concept}\nGenre: ${form.genre}\nAudience: ${form.audience}\n`+
        (form.tone?`Tone/Style: ${form.tone}\n`:"")+
        `\nCreate a rich, cohesive series with a detailed world bible.\n\n`+
        `Respond ONLY with valid JSON (no markdown):\n`+
        `{"series_description":"","world_setting":"","world_rules":[""],"tone_style":"","series_themes":[""],"series_arc":"",`+
        `"recurring_characters":[{"name":"","role":"","description":"","arc":""}],`+
        `"recurring_locations":[{"name":"","description":""}],`+
        `"books":[{"number":1,"title":"","subtitle":"","description":"","hook":"","main_conflict":"","character_focus":"","how_it_connects":"","ends_with":""}]}`
      );
      trackUsage();
      const match=raw.match(/\{[\s\S]*\}/);
      if(!match)throw{code:"PARSE",msg:"Couldn't parse series plan."};
      setLoadStep("Structuring characters, world & book arcs…");
      let plan;try{plan=JSON.parse(match[0]);}catch(pe){throw{code:"PARSE",msg:"AI returned malformed JSON — please retry."};}
      const character_roster=(plan.recurring_characters||[]).map(c=>({...c,first_appears:"Series Bible"}));
      const world_locations=(plan.recurring_locations||[]).map(l=>({...l,first_appears:"Series Bible"}));
      const series={
        id:"series_"+Date.now()+"_"+Math.random().toString(36).slice(2,7),
        name:form.name,concept:form.concept,genre:form.genre,audience:form.audience,
        book_count:form.book_count,plan,character_roster,world_locations,plot_events:[],book_ids:[],
        created_date:new Date().toISOString()
      };
      const all=[series,...getSeries()];setSeries(all);setSeriesList(all);
      setShowCreate(false);setForm({name:"",concept:"",genre:"",audience:"",book_count:3,tone:""});
    }catch(e){setError(errMsg(e));}
    finally{setLoading(false);setLoadStep("");}
  };

  const deleteSeries=(id,e)=>{e.stopPropagation();if(!confirm("Delete this series?"))return;const s=getSeries().filter(x=>x.id!==id);setSeries(s);setSeriesList(s);};

  const buildBook=(series,bookPlan)=>{
    const books=getBooks();
    const book={
      id:"book_"+Date.now()+"_"+Math.random().toString(36).slice(2,7),
      title:bookPlan.title,subtitle:bookPlan.subtitle||"",
      genre:series.genre,target_audience:series.audience,
      description:bookPlan.description,
      series_id:series.id,series_name:series.name,series_number:bookPlan.number,
      chapters:[],outline:"",status:"outlining",word_count:0,
      cover_image_url:"",seo_title:"",seo_description:"",seo_keywords:"",notes:"",review:null,
      needs_outline:true,book_plan:bookPlan,
      auto_build:true,build_step:"Starting…",
      created_date:new Date().toISOString()
    };
    books.unshift(book);setBooks(books);
    const seriesAll=getSeries();const si=seriesAll.findIndex(s=>s.id===series.id);
    if(si>-1){seriesAll[si].book_ids=[...(seriesAll[si].book_ids||[]),book.id];setSeries(seriesAll);setSeriesList(seriesAll);}
    navigate("editor",book.id);
  };

  const bibleSeries=viewBible?seriesList.find(s=>s.id===viewBible):null;

  return(
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
      {/* World Bible Modal */}
      {bibleSeries&&(
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-800 border border-cyan-500/30 rounded-2xl max-w-3xl w-full max-h-[85vh] overflow-y-auto shadow-2xl">
            <div className="sticky top-0 bg-slate-800 border-b border-white/10 px-6 py-4 flex items-center justify-between">
              <div><h2 className="text-white font-bold text-lg">📖 Series Bible</h2><p className="text-cyan-300 text-sm">{bibleSeries.name}</p></div>
              <button onClick={()=>setViewBible(null)} className="text-white/30 hover:text-white text-2xl">✕</button>
            </div>
            <div className="p-6 space-y-5">
              {bibleSeries.plan?.series_description&&<div><h3 className="text-cyan-300 text-xs uppercase tracking-wider font-semibold mb-2">Overview</h3><p className="text-white/70 text-sm leading-relaxed">{bibleSeries.plan.series_description}</p></div>}
              {bibleSeries.plan?.series_arc&&<div><h3 className="text-cyan-300 text-xs uppercase tracking-wider font-semibold mb-2">Series Arc</h3><p className="text-white/70 text-sm leading-relaxed">{bibleSeries.plan.series_arc}</p></div>}
              {bibleSeries.plan?.world_setting&&<div><h3 className="text-cyan-300 text-xs uppercase tracking-wider font-semibold mb-2">World & Setting</h3><p className="text-white/70 text-sm leading-relaxed">{bibleSeries.plan.world_setting}</p></div>}
              {bibleSeries.plan?.world_rules?.length>0&&<div><h3 className="text-cyan-300 text-xs uppercase tracking-wider font-semibold mb-2">World Rules & Lore</h3><ul className="space-y-1">{bibleSeries.plan.world_rules.map((r,i)=><li key={i} className="text-white/60 text-sm flex gap-2"><span className="text-cyan-400">•</span>{r}</li>)}</ul></div>}
              {bibleSeries.plan?.tone_style&&<div><h3 className="text-cyan-300 text-xs uppercase tracking-wider font-semibold mb-2">Tone & Style</h3><p className="text-white/70 text-sm">{bibleSeries.plan.tone_style}</p></div>}
              {bibleSeries.character_roster?.length>0&&<div><h3 className="text-cyan-300 text-xs uppercase tracking-wider font-semibold mb-3">Character Roster ({bibleSeries.character_roster.length})</h3><div className="space-y-3">{bibleSeries.character_roster.map((c,i)=><div key={i} className="bg-white/5 border border-white/10 rounded-xl p-4"><div className="flex items-center gap-2 mb-1"><span className="text-white font-semibold text-sm">{c.name}</span>{c.role&&<span className="text-xs bg-purple-500/20 text-purple-300 px-2 py-0.5 rounded-full border border-purple-500/30">{c.role}</span>}<span className="text-xs text-white/25">· {c.first_appears}</span></div>{c.description&&<p className="text-white/55 text-xs leading-relaxed mb-1">{c.description}</p>}{c.arc&&<p className="text-cyan-300/50 text-xs italic">{c.arc}</p>}</div>)}</div></div>}
              {bibleSeries.world_locations?.length>0&&<div><h3 className="text-cyan-300 text-xs uppercase tracking-wider font-semibold mb-3">Locations</h3><div className="space-y-2">{bibleSeries.world_locations.map((l,i)=><div key={i} className="bg-white/5 border border-white/10 rounded-xl p-4"><p className="text-white font-semibold text-sm mb-1">{l.name}<span className="text-white/25 text-xs font-normal ml-2">· {l.first_appears}</span></p>{l.description&&<p className="text-white/55 text-xs leading-relaxed">{l.description}</p>}</div>)}</div></div>}
              {bibleSeries.plot_events?.length>0&&<div><h3 className="text-cyan-300 text-xs uppercase tracking-wider font-semibold mb-3">Series Timeline</h3><div className="space-y-2">{bibleSeries.plot_events.map((e,i)=><div key={i} className="flex gap-3"><span className="text-cyan-400/50 text-xs shrink-0 pt-0.5">[{e.book}]</span><p className="text-white/55 text-xs">{e.event}</p></div>)}</div></div>}
            </div>
          </div>
        </div>
      )}

      <div className="flex justify-between items-center mb-6">
        <h2 className="text-white text-xl font-bold">📗 Series Manager</h2>
        <button onClick={()=>setShowCreate(!showCreate)} className="bg-gradient-to-r from-cyan-500 to-blue-500 text-white px-5 py-2.5 rounded-xl font-semibold hover:opacity-90">+ New Series</button>
      </div>

      {showCreate&&(
        <div className="bg-white/5 border border-cyan-500/30 rounded-2xl p-6 mb-8">
          <h3 className="text-white font-bold text-lg mb-1">Plan Your Series</h3>
          <p className="text-white/40 text-sm mb-5">Generates a full world bible — setting, lore, character roster, locations, and individual book plans.</p>
          {error&&<div className="bg-red-500/20 border border-red-500/30 text-red-300 rounded-xl p-4 mb-4 text-sm">{error}</div>}
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div><label className="text-white/60 text-sm font-medium block mb-2">Series Name *</label><input value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder='E.g. "The Rival Hearts Series"' className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white placeholder-white/25 focus:outline-none focus:border-cyan-500 text-sm"/></div>
              <div><label className="text-white/60 text-sm font-medium block mb-2">Number of Books *</label><select value={form.book_count} onChange={e=>setForm({...form,book_count:Number(e.target.value)})} className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-cyan-500 text-sm">{[2,3,4,5,6,7,8,9,10].map(n=><option key={n} value={n}>{n} Books</option>)}</select></div>
            </div>
            <div><label className="text-white/60 text-sm font-medium block mb-2">Series Concept *</label><textarea rows={3} value={form.concept} onChange={e=>setForm({...form,concept:e.target.value})} placeholder='E.g. "Standalone gay romance novels set in a competitive sports world, each book a different couple"' className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white placeholder-white/25 focus:outline-none focus:border-cyan-500 resize-none text-sm"/></div>
            <div><label className="text-white/60 text-sm font-medium block mb-2">Tone & Style <span className="text-white/25">(optional)</span></label><input value={form.tone} onChange={e=>setForm({...form,tone:e.target.value})} placeholder='E.g. "Steamy, emotionally intense, HEA guaranteed, slow burn"' className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white placeholder-white/25 focus:outline-none focus:border-cyan-500 text-sm"/></div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div><label className="text-white/60 text-sm font-medium block mb-2">Genre *</label><select value={form.genre} onChange={e=>setForm({...form,genre:e.target.value})} className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-cyan-500 text-sm"><option value="">Select…</option>{GENRES.map(g=><option key={g} value={g}>{g}</option>)}</select></div>
              <div><label className="text-white/60 text-sm font-medium block mb-2">Target Audience *</label><select value={form.audience} onChange={e=>setForm({...form,audience:e.target.value})} className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-cyan-500 text-sm"><option value="">Select…</option>{AUDIENCES.map(a=><option key={a} value={a}>{a}</option>)}</select></div>
            </div>
            <div className="flex gap-3">
              <button onClick={()=>{setShowCreate(false);setError("");}} className="flex-1 border border-white/20 text-white/50 py-3 rounded-xl hover:bg-white/5 text-sm">Cancel</button>
              <button onClick={createSeries} disabled={loading||!form.name||!form.concept||!form.genre||!form.audience} className="flex-[2] bg-gradient-to-r from-cyan-500 to-blue-500 text-white py-3 rounded-xl font-semibold hover:opacity-90 disabled:opacity-40 flex items-center justify-center gap-2">{loading?<><Spin/>{loadStep||"Generating series bible…"}</>:"✨ Generate Series Plan"}</button>
            </div>
          </div>
        </div>
      )}

      {seriesList.length>0&&!showCreate&&(()=>{const allBooks=getBooks();const seriesBooks=allBooks.filter(b=>b.series_id);const totalWords=seriesBooks.reduce((a,b)=>a+(b.word_count||0),0);const donePct=seriesList.length?Math.round(seriesBooks.filter(b=>b.status==="published"||b.status==="ready").length/Math.max(1,seriesList.reduce((a,s)=>a+(s.book_count||0),0))*100):0;return <div className="grid grid-cols-3 gap-3 mb-6"><div className="bg-cyan-500/10 border border-cyan-500/20 rounded-xl p-3 text-center"><p className="text-white text-xl font-bold">{seriesList.length}</p><p className="text-cyan-300/60 text-xs">Series</p></div><div className="bg-purple-500/10 border border-purple-500/20 rounded-xl p-3 text-center"><p className="text-white text-xl font-bold">{(totalWords/1000).toFixed(0)}k</p><p className="text-purple-300/60 text-xs">Total Words</p></div><div className="bg-green-500/10 border border-green-500/20 rounded-xl p-3 text-center"><p className="text-white text-xl font-bold">{donePct}%</p><p className="text-green-300/60 text-xs">Published</p></div></div>;})()}{seriesList.length===0&&!showCreate?(
        <div className="text-center py-20"><div className="text-7xl mb-4">📗</div><h2 className="text-white text-xl font-bold mb-2">No series yet</h2><p className="text-white/40 mb-6">Build a multi-book world with shared characters, locations, and lore</p><button onClick={()=>setShowCreate(true)} className="bg-gradient-to-r from-cyan-500 to-blue-500 text-white px-8 py-3.5 rounded-xl font-semibold text-lg hover:opacity-90">+ Create Your First Series</button></div>
      ):(
        <div className="space-y-6">
          {seriesList.map(series=>(
            <div key={series.id} className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden">
              <div className="p-6 border-b border-white/10">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <span className="bg-cyan-500/20 text-cyan-300 text-xs px-2.5 py-1 rounded-full border border-cyan-500/30">{series.book_count} Books</span>
                      <span className="bg-white/10 text-white/40 text-xs px-2.5 py-1 rounded-full">{series.genre}</span>
                      {series.character_roster?.length>0&&<span className="bg-purple-500/20 text-purple-300 text-xs px-2.5 py-1 rounded-full border border-purple-500/20">👥 {series.character_roster.length} chars</span>}
                      {series.world_locations?.length>0&&<span className="bg-blue-500/20 text-blue-300 text-xs px-2.5 py-1 rounded-full border border-blue-500/20">📍 {series.world_locations.length} locations</span>}
                    </div>
                    <h3 className="text-white text-xl font-bold">{series.name}</h3>
                    <p className="text-white/50 text-sm mt-1 line-clamp-2">{series.plan?.series_description}</p>
                    {series.plan?.tone_style&&<p className="text-cyan-300/50 text-xs mt-1 italic">{series.plan.tone_style}</p>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button onClick={()=>setViewBible(series.id)} className="text-xs border border-cyan-500/40 text-cyan-300 px-3 py-2 rounded-lg hover:bg-cyan-500/10">📖 View Bible</button>
                    <button onClick={e=>deleteSeries(series.id,e)} className="text-white/20 hover:text-red-400 text-sm px-2">🗑</button>
                  </div>
                </div>
                {series.plan?.series_arc&&<div className="mt-4 bg-white/5 rounded-xl p-3"><p className="text-white/25 text-xs uppercase tracking-wider mb-1">Series Arc</p><p className="text-white/55 text-xs leading-relaxed">{series.plan.series_arc}</p></div>}
              </div>
              <div className="p-4">
                <p className="text-white/30 text-xs uppercase tracking-wider mb-3 px-2">Books in This Series</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {series.plan?.books?.map((bp,i)=>{
                    const existingBook=series.book_ids?.map(id=>getBook(id)).find(b=>b&&b.series_number===bp.number);
                    return(
                      <div key={i} className="bg-white/5 border border-white/10 rounded-xl p-4 hover:border-white/20 transition-all">
                        <div className="flex items-center gap-2 mb-2"><span className="w-6 h-6 bg-gradient-to-br from-purple-500 to-pink-500 rounded-full flex items-center justify-center text-xs font-bold text-white">{bp.number}</span>{existingBook&&<span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[existingBook.status]||""}`}>{STATUS_ICONS[existingBook.status]} {existingBook.status}</span>}</div>
                        <h4 className="text-white font-semibold text-sm leading-tight mb-0.5">{bp.title}</h4>
                        {bp.subtitle&&<p className="text-purple-300/70 text-xs mb-1">{bp.subtitle}</p>}
                        {bp.character_focus&&<p className="text-cyan-300/50 text-xs mb-1">👥 {bp.character_focus}</p>}
                        <p className="text-white/35 text-xs leading-relaxed mb-3 line-clamp-3">{bp.description}</p>
                        {existingBook?(<div className="space-y-2"><div className="flex items-center gap-2 flex-wrap"><span className={`text-xs px-2 py-0.5 rounded-full border ${existingBook.status==="published"?"bg-green-500/20 text-green-300 border-green-500/30":existingBook.status==="ready"?"bg-blue-500/20 text-blue-300 border-blue-500/30":"bg-purple-500/20 text-purple-300 border-purple-500/30"}`}>{existingBook.status}</span>{existingBook.word_count>0&&<span className="text-white/30 text-xs">{(existingBook.word_count||0).toLocaleString()}w</span>}{existingBook.review?.overall_score>=70&&<span className="text-xs text-amber-300/70">⭐ {existingBook.review.overall_score}</span>}</div><button onClick={()=>navigate("editor",existingBook.id)} className="w-full text-xs border border-white/20 text-white/50 py-2 rounded-lg hover:bg-white/5">Open Editor →</button></div>):<button onClick={()=>buildBook(series,bp)} className="w-full text-xs bg-gradient-to-r from-purple-500 to-pink-500 text-white py-2 rounded-lg hover:opacity-90">✨ Build This Book</button>}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// HOME PAGE
// ══════════════════════════════════════════════════════════════════════════════
function HomePage({navigate,onSettings}){
  const [allBooks,setBooksList]=useState([]);
  const [search,setSearch]=useState("");
  useEffect(()=>setBooksList(getBooks()),[]);
  const sortedBooks=[...allBooks].sort((a,b)=>{ if(a.auto_build&&!b.auto_build)return -1; if(!a.auto_build&&b.auto_build)return 1; return new Date(b.created_date||0)-new Date(a.created_date||0); });
  const books=search.trim()?sortedBooks.filter(b=>(b.title||"").toLowerCase().includes(search.toLowerCase())||(b.genre||"").toLowerCase().includes(search.toLowerCase())||(b.status||"").toLowerCase().includes(search.toLowerCase())):sortedBooks;
  const del=(id,e)=>{e.stopPropagation();if(!confirm("Delete this book?"))return;const b=getBooks().filter(x=>x.id!==id);setBooks(b);setBooksList(b);};
  const pct=b=>b.chapters?.length>0?(b.chapters.filter(c=>c.generated).length/b.chapters.length)*100:0;
  return(
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
      {!getKey()&&<div className="bg-amber-500/15 border border-amber-500/40 rounded-xl p-4 mb-6 flex items-center gap-3"><span className="text-2xl">🔑</span><div className="flex-1"><p className="text-amber-300 font-semibold text-sm">Gemini API key not set</p><p className="text-amber-200/50 text-xs">Required to generate books. Free from Google AI Studio.</p></div><button onClick={onSettings} className="bg-amber-500 text-black text-xs font-bold px-4 py-2 rounded-lg hover:bg-amber-400">Set Key</button></div>}
      {(()=>{
        const stalled=allBooks.filter(b=>!b.build_complete&&!b.auto_build&&!["published","ready"].includes(b.status)&&(b.needs_outline||(b.chapters?.length>0&&b.chapters.some(c=>!c.generated))));
        if(stalled.length===0)return null;
        return(
          <div className="bg-cyan-500/10 border border-cyan-500/30 rounded-xl p-4 mb-6">
            <p className="text-cyan-200 text-sm font-semibold mb-2">⏸️ {stalled.length} book{stalled.length!==1?"s":""} paused mid-build — nothing is lost, pick up where you left off:</p>
            <div className="flex flex-wrap gap-2">
              {stalled.map(b=>(
                <button key={b.id} onClick={()=>{updateBook(b.id,{auto_build:true});navigate("editor",b.id);}} className="bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 text-xs font-bold px-3 py-2 rounded-lg hover:bg-cyan-500/30">▶ Resume "{b.title}"</button>
              ))}
            </div>
          </div>
        );
      })()}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
        {(()=>{
          const totalWords=allBooks.reduce((a,b)=>a+(b.word_count||0),0);
          const publishReady=allBooks.filter(b=>b.review?.verdict==="PASS"&&b.manuscript_quality?.manuscript_verdict==="PASS").length;
          const wLabel=totalWords>=1000?Math.round(totalWords/1000)+"K":totalWords;
          return [{label:"Total Books",value:allBooks.length,icon:"📚",sub:null},{label:"Words Written",value:wLabel,icon:"✍️",sub:totalWords>0?Math.round(totalWords/250)+"pg est.":null},{label:"Publish Ready",value:publishReady,icon:"🚀",sub:publishReady>0?"Dual-gate passed":null},{label:"Published",value:allBooks.filter(b=>b.status==="published").length,icon:"🌟",sub:null}].map(s=>(
            <div key={s.label} className="bg-white/5 border border-white/10 rounded-2xl p-4"><div className="text-2xl mb-1">{s.icon}</div><div className="text-white text-2xl font-bold">{s.value}</div><div className="text-white/40 text-xs">{s.label}</div>{s.sub&&<div className="text-white/20 text-xs mt-0.5">{s.sub}</div>}</div>
          ));
        })()}
      </div>
      <div className="flex justify-between items-center mb-5">
        <h2 className="text-white text-xl font-bold">Your Library</h2>
        <button onClick={()=>navigate("create")} className="bg-gradient-to-r from-purple-500 to-pink-500 text-white px-5 py-2.5 rounded-xl font-semibold hover:opacity-90">+ New Book</button>
      </div>
            <input type="text" placeholder="🔍 Search by title, genre, or status…" value={search} onChange={e=>setSearch(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm placeholder-white/30 focus:outline-none focus:border-purple-500/50 mb-4"/>
      {books.length===0?(
        <div className="text-center py-24"><div className="text-7xl mb-4">📖</div><h2 className="text-white text-2xl font-bold mb-2">No books yet</h2><p className="text-white/40 mb-8">Generate your first AI-powered book in minutes</p><button onClick={()=>navigate("create")} className="bg-gradient-to-r from-purple-500 to-pink-500 text-white px-10 py-4 rounded-xl font-semibold text-lg hover:opacity-90">✨ Create Your First Book</button></div>
      ):(
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {books.map(book=>(
            <div key={book.id} onClick={()=>navigate("editor",book.id)} className="group relative cursor-pointer">
              <div className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden hover:border-purple-500/50 transition-all hover:shadow-lg hover:shadow-purple-900/20">
                <div className="aspect-[3/2] bg-gradient-to-br from-purple-800/50 to-pink-800/50 relative overflow-hidden">
                  {book.cover_image_url?<img src={book.cover_image_url} alt={book.title} className="w-full h-full object-cover"/>:<div className="w-full h-full flex items-center justify-center text-5xl opacity-20">📚</div>}
                  <div className="absolute top-3 right-3 flex flex-col items-end gap-1">
                    <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${STATUS_COLORS[book.status]||"bg-gray-500/20 text-gray-300"}`}>{STATUS_ICONS[book.status]} {book.status}</span>
                    {book.series_name&&<span className="text-xs px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">📗 {book.series_name}</span>}
                  </div>
                  {book.review&&<div className={`absolute top-3 left-3 text-xs px-2 py-1 rounded-full font-bold border ${book.review.verdict==="PASS"?"bg-green-500/20 text-green-300 border-green-500/30":"bg-red-500/20 text-red-300 border-red-500/30"}`}>{book.review.verdict==="PASS"?"✅":"❌"} {book.review.overall_score}</div>}
                </div>
                <div className="p-5">
                  <h3 className="text-white font-bold text-base leading-tight mb-1 line-clamp-2">{book.title||"Untitled"}</h3>
                  {book.subtitle&&<p className="text-white/40 text-sm mb-2 line-clamp-1">{book.subtitle}</p>}
                  <div className="flex items-center justify-between mt-2"><span className="text-white/25 text-xs">{book.genre}</span><span className="text-white/25 text-xs">{book.word_count?`${Number(book.word_count).toLocaleString()} words`:"0 words"}</span></div>
                  {book.auto_build&&!book.build_complete&&<p className="text-cyan-400 text-xs mt-2 truncate animate-pulse">🔄 {book.build_step||"Building…"}</p>}
                  {book.build_complete&&<p className={`text-xs mt-2 ${book.gates_passed?"text-green-400":"text-amber-400"}`}>{book.gates_passed?"✅ Ready to publish":"⚠️ Review needed"}</p>}
                  {book.chapters?.length>0&&<div className="mt-3"><div className="h-1 bg-white/10 rounded-full overflow-hidden"><div className="h-full bg-gradient-to-r from-purple-500 to-pink-500 rounded-full" style={{width:`${pct(book)}%`}}/></div><p className="text-white/20 text-xs mt-1">{book.chapters.filter(c=>c.generated).length}/{book.chapters.length} chapters</p></div>}
                </div>
              </div>
              <button onClick={e=>del(book.id,e)} className="absolute top-2 left-2 w-7 h-7 bg-red-500/80 hover:bg-red-600 rounded-full text-white text-xs opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center shadow">✕</button>
              <button onClick={e=>{e.stopPropagation();const src=getBook(book.id);if(!src)return;const dup={...src,id:Date.now().toString(36)+Math.random().toString(36).slice(2),title:src.title+" (Copy)",status:"draft",auto_build:false,build_complete:false,gates_passed:false,seo_done:false,cover_done:false,review_done:false,wq_done:false,competitor_done:false,hooks_done:false,review:null,manuscript_quality:null,build_complete_date:null};const books=getBooks();books.push(dup);setBooks(books);setBooksList(getBooks());}} className="absolute top-2 right-2 w-7 h-7 bg-blue-500/80 hover:bg-blue-600 rounded-full text-white text-xs opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center shadow" title="Duplicate book">⧉</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// CREATE PAGE
// ══════════════════════════════════════════════════════════════════════════════
function CreatePage({navigate,onSettings}){
  const [step,setStep]=useState(1);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState("");
  const [outline,setOutline]=useState(null);
  const [mode,setMode]=useState("idea"); // "idea" | "import"
  const [importText,setImportText]=useState("");
  const [form,setForm]=useState({topic:"",genre:"",audience:"",language:"English",style:"",nonfiction_mode:false});

  const voiceProfile=getVoiceProfile();

  const buildStyleCtx=()=>{
    let ctx="";
    if(voiceProfile?.sample_analysis)ctx+=`\nVoice/Style to match: ${voiceProfile.sample_analysis}`;
    if(form.style)ctx+=`\nAdditional style notes: ${form.style}`;
    return ctx;
  };

  const generate=async()=>{
    if(!getKey()){onSettings();return;}
    if(mode==="idea"&&(!form.topic||!form.genre||!form.audience)){setError("Fill in topic, genre and audience.");return;}
    if(mode==="import"&&!importText.trim()){setError("Paste your draft or notes first.");return;}
    setLoading(true);setError("");
    try{
      const styleCtx=buildStyleCtx();
      const langNote=form.language!=="English"?`\nWrite in: ${form.language}`:"";
      let prompt;
      if(mode==="import"){
        prompt=`You are a professional book editor. Analyze this draft/notes and build a polished book outline from it.\n\nDRAFT/NOTES:\n${importText.slice(0,6000)}\n\nGenre: ${form.genre||"Fiction"}\nAudience: ${form.audience||"General Adults"}${styleCtx}${langNote}\n\n${form.nonfiction_mode?"Include exercises/reflections/action-steps fields per chapter.":""}\n\nRespond ONLY with valid JSON:\n{"title":"","subtitle":"","description":"","themes":[""],"tone_notes":"describe the intended emotional register and prose style","estimated_word_count":50000,"writing_language":"${form.language}","chapters":[{"number":1,"title":"","description":"","opening_hook":"how this chapter should open — first line or image","${form.nonfiction_mode?"exercise":"notes"}":""}]}`;
      } else {
        prompt=`You are a bestselling author. Create a detailed, commercially compelling book outline.\nTopic: ${form.topic}\nGenre: ${form.genre}\nAudience: ${form.audience}${styleCtx}${langNote}\n${form.nonfiction_mode?"Nonfiction mode: include exercises, reflections, and action steps per chapter.":""}\n\nRULES:\n• Generate EXACTLY 12-15 chapters (never fewer than 10)\n• Chapter titles must be SPECIFIC and evocative — never generic (e.g. not "Chapter 1: The Beginning")\n• Each chapter description must be 2-3 sentences with clear conflict or stakes\n• Subtitle must be sharp, benefit-driven, or intriguing\n• Target ~${Math.round(50000/13)} words per chapter\n• No filler chapters — every chapter must earn its place\n\nRespond ONLY with valid JSON:\n{"title":"","subtitle":"","description":"","themes":[""],"tone_notes":"describe the intended emotional register and prose style","estimated_word_count":50000,"writing_language":"${form.language}","chapters":[{"number":1,"title":"","description":"","opening_hook":"how this chapter should open — first line or image","target_words":3800,"${form.nonfiction_mode?"exercise":"notes"}":""}]}`;
      }
      const raw=await callGemini(prompt);
      trackUsage();
      const match=raw.match(/\{[\s\S]*\}/);if(!match)throw{code:"PARSE"};
      let _ol;try{_ol=JSON.parse(match[0]);}catch(pe){throw{code:"PARSE",msg:"AI returned malformed JSON — please retry."};}
setOutline(_ol);setStep(2);
    }catch(e){setError(errMsg(e));}finally{setLoading(false);}
  };

  const approve=()=>{
    const books=getBooks();
    const book={
      id:"book_"+Date.now()+"_"+Math.random().toString(36).slice(2,7),
      title:outline.title,subtitle:outline.subtitle||"",
      genre:form.genre||"Fiction",target_audience:form.audience||"General Adults",
      description:outline.description,themes:outline.themes||[],
      estimated_word_count:outline.estimated_word_count||50000,
      writing_language:form.language||"English",
      nonfiction_mode:form.nonfiction_mode,
      style_notes:form.style||"",
      imported_draft:mode==="import"?importText.slice(0,3000):"",
      chapters:(outline.chapters||[]).map(c=>({...c,content:"",generated:false})),
      outline:JSON.stringify(outline),status:"writing",word_count:0,
      cover_image_url:"",seo_title:"",seo_description:"",seo_keywords:"",notes:"",review:null,
      auto_build:true,build_step:"Starting…",created_date:new Date().toISOString()
    };
    books.unshift(book);setBooks(books);navigate("editor",book.id);
  };
  return(
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
      <div className="flex items-center gap-3 mb-8">{["Book Concept","Review & Approve"].map((label,i)=>(<div key={i} className="flex items-center gap-2"><div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${step>i+1?"bg-green-500 text-white":step===i+1?"bg-purple-500 text-white":"bg-white/10 text-white/30"}`}>{step>i+1?"✓":i+1}</div><span className={`text-sm ${step===i+1?"text-white":"text-white/30"}`}>{label}</span>{i<1&&<div className="w-10 h-px bg-white/20 mx-1"/>}</div>))}</div>
      {error&&<div className="bg-red-500/20 border border-red-500/30 text-red-300 rounded-xl p-4 mb-5 text-sm">{error}</div>}
      {step===1&&(
        <Card>
          <h2 className="text-white text-xl font-bold mb-1">Start Your Book</h2>
          <p className="text-white/40 mb-5 text-sm">From idea to KDP-ready in one pipeline. Import a draft or start from scratch.</p>
          {voiceProfile&&<div className="bg-green-500/10 border border-green-500/20 rounded-xl p-3 mb-4 flex gap-2 items-center"><span className="text-green-400 text-sm">🎙️</span><p className="text-green-300 text-xs">Your voice profile is active — chapters will match your writing style.</p></div>}
          {/* Mode toggle */}
          <div className="bg-white/5 border border-white/10 rounded-xl p-1 flex gap-1 mb-6">
            {[["idea","💡 New Idea"],["import","📄 Import Draft"]].map(([m,label])=>(
              <button key={m} onClick={()=>setMode(m)} className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-all ${mode===m?"bg-purple-500 text-white":"text-white/40 hover:text-white"}`}>{label}</button>
            ))}
          </div>
          <div className="space-y-5">
            {mode==="idea"?(
              <div><label className="text-white/70 text-sm font-medium block mb-2">Topic / Story Idea *</label><textarea rows={4} placeholder='E.g. "Two gay college athletes fall in love across rival teams during championship season"' value={form.topic} onChange={e=>setForm({...form,topic:e.target.value})} className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white placeholder-white/25 focus:outline-none focus:border-purple-500 resize-none text-sm"/></div>
            ):(
              <div>
                <label className="text-white/70 text-sm font-medium block mb-2">Paste Your Draft / Notes *</label>
                <p className="text-white/30 text-xs mb-2">Paste any existing writing — partial manuscript, notes, outline, chapter drafts. AI builds a polished outline from it.</p>
                <textarea rows={8} placeholder="Paste your draft, notes, partial chapters, or outline here..." value={importText} onChange={e=>setImportText(e.target.value)} className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white placeholder-white/20 focus:outline-none focus:border-purple-500 resize-none text-sm font-mono"/>
                <p className="text-white/20 text-xs mt-1">{importText.length.toLocaleString()} chars pasted</p>
              </div>
            )}
            <div><label className="text-white/70 text-sm font-medium block mb-3">Genre *</label><div className="grid grid-cols-2 sm:grid-cols-3 gap-2">{GENRES.map(g=><button key={g} onClick={()=>setForm({...form,genre:g})} className={`text-xs px-3 py-2 rounded-lg border text-left transition-all ${form.genre===g?"border-purple-500 bg-purple-500/25 text-white":"border-white/15 text-white/40 hover:border-white/30 hover:text-white/70"}`}>{g}</button>)}</div></div>
            <div><label className="text-white/70 text-sm font-medium block mb-3">Target Audience *</label><div className="grid grid-cols-2 sm:grid-cols-3 gap-2">{AUDIENCES.map(a=><button key={a} onClick={()=>setForm({...form,audience:a})} className={`text-xs px-3 py-2 rounded-lg border text-left transition-all ${form.audience===a?"border-purple-500 bg-purple-500/25 text-white":"border-white/15 text-white/40 hover:border-white/30 hover:text-white/70"}`}>{a}</button>)}</div></div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-white/70 text-sm font-medium block mb-2">Language</label>
                <select value={form.language} onChange={e=>setForm({...form,language:e.target.value})} className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-purple-500 text-sm">
                  {LANGUAGES.map(l=><option key={l} value={l}>{l}</option>)}
                </select>
              </div>
              <div>
                <label className="text-white/70 text-sm font-medium block mb-2">Style Notes <span className="text-white/25">(optional)</span></label>
                <input value={form.style} onChange={e=>setForm({...form,style:e.target.value})} placeholder='E.g. "gritty, dark humor, Cormac McCarthy-esque"' className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white placeholder-white/20 focus:outline-none focus:border-purple-500 text-sm"/>
              </div>
            </div>
            <div className="flex items-center gap-3 bg-white/5 border border-white/10 rounded-xl px-4 py-3 cursor-pointer" onClick={()=>setForm({...form,nonfiction_mode:!form.nonfiction_mode})}>
              <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-all ${form.nonfiction_mode?"bg-purple-500 border-purple-500":"border-white/30"}`}>{form.nonfiction_mode&&<span className="text-white text-xs">✓</span>}</div>
              <div><p className="text-white text-sm font-medium">Nonfiction Mode</p><p className="text-white/40 text-xs">Adds exercises, reflections &amp; action steps to each chapter</p></div>
            </div>
            <button onClick={generate} disabled={loading||(mode==="idea"&&(!form.topic.trim()||!form.genre||!form.audience))||(mode==="import"&&!importText.trim())} className="w-full bg-gradient-to-r from-purple-500 to-pink-500 text-white py-4 rounded-xl font-semibold text-lg hover:opacity-90 disabled:opacity-40 flex items-center justify-center gap-2">{loading?<><Spin/>{mode==="import"?"Analyzing draft…":"Generating outline…"}</>:mode==="import"?"📄 Build Outline From Draft":"✨ Generate Book Outline"}</button>
          </div>
        </Card>
      )}
      {step===2&&outline&&(
        <div className="space-y-5">
          <Card>
            <div className="flex items-start justify-between mb-5 gap-4"><div><h2 className="text-white text-xl font-bold">{outline.title}</h2>{outline.subtitle&&<p className="text-purple-300 mt-1 text-sm">{outline.subtitle}</p>}</div><span className="bg-green-500/20 text-green-400 text-xs px-3 py-1 rounded-full border border-green-500/30">AI Generated</span></div>
            <div className="bg-white/5 rounded-xl p-4 mb-5"><p className="text-white/40 text-xs uppercase tracking-wider mb-2">Description</p><p className="text-white/80 text-sm leading-relaxed">{outline.description}</p></div>
            <p className="text-white/40 text-xs uppercase tracking-wider mb-3">Chapters ({outline.chapters?.length})</p>
            <div className="space-y-2 max-h-72 overflow-y-auto pr-1">{outline.chapters?.map((ch,i)=><div key={i} className="bg-white/5 rounded-lg px-4 py-3 flex gap-3"><span className="text-purple-400 font-bold text-sm min-w-[24px]">{ch.number}.</span><div><p className="text-white text-sm font-medium">{ch.title}</p>{ch.description&&<p className="text-white/35 text-xs mt-0.5">{ch.description}</p>}</div></div>)}</div>
            {outline.estimated_word_count&&<p className="text-white/30 text-sm mt-4">📊 ~{outline.estimated_word_count.toLocaleString()} words</p>}
          </Card>
          <div className="bg-gradient-to-br from-purple-900/60 to-pink-900/40 border border-purple-500/30 rounded-2xl p-6">
            <h3 className="text-white font-bold text-lg mb-1">🚀 Approve & Auto-Build</h3>
            <p className="text-white/50 text-sm mb-5">Writes all chapters → SEO → cover → Review Agent → competitor analysis → hooks. Fully hands-free.</p>
            <div className="flex gap-3">
              <button onClick={()=>{setStep(1);setOutline(null);setError("");}} className="flex-1 border border-white/20 text-white/50 py-3 rounded-xl hover:bg-white/5 text-sm">← Regenerate</button>
              <button onClick={approve} className="flex-[2] bg-gradient-to-r from-purple-500 to-pink-500 text-white py-3 px-6 rounded-xl font-bold text-lg hover:opacity-90">✅ Approve & Build</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// EDITOR PAGE
// ══════════════════════════════════════════════════════════════════════════════



// ── Series Bible Inline (shown in editor outline tab for series books) ────────
function SeriesBibleInline({bookId}){
  const book=getBook(bookId);
  if(!book?.series_id)return null;
  const series=getSeriesById(book.series_id);
  if(!series)return null;
  const [open,setOpen]=useState(false);
  const p=series.plan||{};
  return(
    <div className="bg-cyan-500/10 border border-cyan-500/30 rounded-xl overflow-hidden">
      <button onClick={()=>setOpen(!open)} className="w-full flex items-center justify-between p-3 hover:bg-cyan-500/10 transition-all">
        <div className="flex items-center gap-2">
          <span className="bg-cyan-500/20 text-cyan-300 text-xs px-2.5 py-0.5 rounded-full border border-cyan-500/30">📗 {series.name} — Book {book.series_number}</span>
          {series.character_roster?.length>0&&<span className="text-cyan-300/50 text-xs">👥 {series.character_roster.length} chars</span>}
          {(series.plot_events||[]).length>0&&<span className="text-cyan-300/50 text-xs">📌 {series.plot_events.length} events</span>}
        </div>
        <span className="text-cyan-300/50 text-xs">{open?"▲ Hide":"▼ Series Bible"}</span>
      </button>
      {open&&(
        <div className="px-4 pb-4 space-y-3 border-t border-cyan-500/20">
          {p.world_setting&&<div><p className="text-cyan-300/60 text-xs font-semibold uppercase tracking-wider mb-1">World</p><p className="text-white/60 text-xs leading-relaxed">{p.world_setting.slice(0,300)}{p.world_setting.length>300?"…":""}</p></div>}
          {series.character_roster?.length>0&&<div><p className="text-cyan-300/60 text-xs font-semibold uppercase tracking-wider mb-1">Key Characters</p><div className="space-y-1">{series.character_roster.slice(0,4).map((c,i)=><p key={i} className="text-white/60 text-xs"><span className="text-white/80 font-medium">{c.name}</span>{c.role?` [${c.role}]`:""}: {(c.description||"").slice(0,80)}</p>)}</div></div>}
          {(series.plot_events||[]).length>0&&<div><p className="text-cyan-300/60 text-xs font-semibold uppercase tracking-wider mb-1">Series Events (tracked)</p><div className="space-y-1">{series.plot_events.slice(-5).map((e,i)=><p key={i} className="text-white/60 text-xs"><span className="text-cyan-400/60">[{e.book}]</span> {e.event}</p>)}</div></div>}
        </div>
      )}
    </div>
  );
}

// ── Book Stats Bar ────────────────────────────────────────────────────────────
function BookStatsBar({book}){
  const wc=book.word_count||0;
  const totalMins=Math.ceil(wc/250);
  const hrs=Math.floor(totalMins/60);
  const mins=totalMins%60;
  const timeStr=hrs>0?`${hrs}h ${mins}m`:`${totalMins}m`;
  const pages=Math.round(wc/250);
  const writtenChs=(book.chapters||[]).filter(c=>c.content).length;
  return(
    <div className="flex items-center gap-6 p-4 bg-purple-500/10 border border-purple-500/20 rounded-xl mb-6 flex-wrap justify-center sm:justify-start">
      <div className="text-center"><p className="text-white text-2xl font-bold">{wc.toLocaleString()}</p><p className="text-white/40 text-xs">Words</p></div>
      <div className="text-center"><p className="text-white text-2xl font-bold">{writtenChs}</p><p className="text-white/40 text-xs">Chapters</p></div>
      <div className="text-center"><p className="text-white text-2xl font-bold">{timeStr}</p><p className="text-white/40 text-xs">Read Time</p></div>
      <div className="text-center"><p className="text-white text-2xl font-bold">{pages}</p><p className="text-white/40 text-xs">Pages</p></div>
    </div>
  );
}

// ── Inline Chapter Editor ─────────────────────────────────────────────────────
function ChapterEditor({book,chIdx,upd}){
  const ch=book.chapters?.[chIdx];
  const [editing,setEditing]=useState(false);
  const [draft,setDraft]=useState(ch?.content||"");
  const [selPara,setSelPara]=useState(null);
  const [rewriting,setRewriting]=useState(false);
  const [rewriteErr,setRewriteErr]=useState("");
  const textareaRef=useRef(null);
  const wordCount=draft.trim()?draft.trim().split(/\s+/).length:0;

  useEffect(()=>{setDraft(ch?.content||"");setEditing(false);setSelPara(null);},[chIdx,ch?.content]);

  const save=()=>{
    const chapters=[...(book.chapters||[])];
    chapters[chIdx]={...chapters[chIdx],content:draft,generated:true};
    const wc=chapters.reduce((a,c)=>a+(c.content?c.content.split(/\s+/).length:0),0);
    const allDone=chapters.every(c=>c.generated);
    const curB=typeof getBook==="function"?getBook(book.id):null;
    const extraStamps=allDone&&curB?.seo_done&&curB?.cover_done&&curB?.review_done&&!curB.build_complete
      ?{build_complete:true,build_complete_date:new Date().toISOString(),gates_passed:curB?.review?.verdict==="PASS"&&curB?.manuscript_quality?.manuscript_verdict==="PASS"}
      :{};
    upd({chapters,word_count:wc,...extraStamps});
    setEditing(false);
  };

  // Paragraph-level rewrite
  const rewriteParagraph=async(paraText,paraIdx,paragraphs)=>{
    if(rewriting||!getKey())return;
    setRewriting(true);setRewriteErr("");
    try{
      const vp=getVoiceProfile();
      const voiceCtx=vp?.sample_analysis?`\nVOICE STYLE: ${vp.sample_analysis}\nMatch this style exactly.`:"";
      const result=await callGemini(
        `You are a master editor. Rewrite ONLY this paragraph to sound more human, specific, and vivid.\n`+
        `Book: "${book.title}" (${book.genre})\n`+
        `Chapter: "${ch?.title||""}"\n${voiceCtx}\n\n`+
        `ORIGINAL PARAGRAPH:\n${paraText}\n\n`+
        `RULES:\n• Keep the same scene/action/meaning\n• Remove ALL AI tells (hollow openers, stated emotions, em-dash drama)\n• Add specific sensory detail\n• Vary sentence length — use fragments\n• Sound like a novelist, not a language model\n• Return ONLY the rewritten paragraph — no preamble, no explanation`,
        0.9
      );
      trackUsage();
      const newParas=[...paragraphs];
      newParas[paraIdx]=result.trim();
      const newContent=newParas.join("\n\n");
      setDraft(newContent);
    }catch(e){setRewriteErr(errMsg(e));}finally{setRewriting(false);}
  };

  if(editing){
    const paragraphs=draft.split(/\n\n+/).filter(p=>p.trim());
    return(
      <div>
        <div className="flex items-center justify-between mb-3">
          <span className="text-white/40 text-xs">{wordCount.toLocaleString()} words</span>
          <div className="flex gap-2">
            <button onClick={()=>{setDraft(ch?.content||"");setEditing(false);setSelPara(null);}} className="text-xs px-3 py-1.5 rounded-lg bg-white/5 text-white/50 hover:bg-white/10">Cancel</button>
            <button onClick={save} className="text-xs px-3 py-1.5 rounded-lg bg-green-500/20 text-green-300 border border-green-500/30 hover:bg-green-500/30 font-medium">✅ Save</button>
          </div>
        </div>
        {rewriteErr&&<p className="text-red-400 text-xs mb-2">{rewriteErr}</p>}
        <div className="mb-3 p-3 bg-purple-500/10 border border-purple-500/20 rounded-xl">
          <p className="text-purple-300 text-xs font-medium mb-2">✨ Click any paragraph below to rewrite it with AI</p>
          <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
            {paragraphs.map((p,i)=>(
              <div key={i}
                onClick={()=>!rewriting&&rewriteParagraph(p,i,paragraphs)}
                className={`text-xs p-2 rounded-lg cursor-pointer transition-all leading-relaxed ${rewriting?"opacity-40 cursor-wait":"hover:bg-purple-500/20 text-white/60 hover:text-white/90 bg-white/5 border border-white/5"}`}
              >
                {rewriting&&selPara===i?<span className="text-purple-300">Rewriting…</span>:p.slice(0,120)+(p.length>120?"…":"")}
              </div>
            ))}
          </div>
        </div>
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={e=>setDraft(e.target.value)}
          className="w-full h-[420px] bg-white/5 border border-white/10 rounded-xl p-4 text-white/80 text-sm leading-relaxed resize-none focus:outline-none focus:border-purple-500/50"
          placeholder="Write or paste chapter content here…"
          spellCheck={true}
        />
      </div>
    );
  }

  return(
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <span className="text-white/40 text-xs">{ch?.content?ch.content.trim().split(/\s+/).length.toLocaleString():0} words</span>
          {ch?.content&&<span className="text-white/25 text-xs">~{Math.ceil((ch.content.split(/\s+/).length||0)/200)} min read</span>}
        </div>
        <button onClick={()=>{setDraft(ch?.content||"");setEditing(true);}} className="text-xs px-3 py-1.5 rounded-lg bg-white/5 text-white/50 border border-white/10 hover:bg-white/10 hover:text-white/80 transition-all">✏️ Edit & Rewrite</button>
      </div>
      <div className="text-white/75 text-sm leading-relaxed whitespace-pre-wrap max-h-[560px] overflow-y-auto pr-2">{ch?.content}</div>
    </div>
  );
}

function EditorPage({bookId,navigate,onSettings}){
  const [book,setBook]=useState(null);
  const [tab,setTab]=useState(0);
  const [busy,setBusy]=useState(false);
  const [busyStep,setBusyStep]=useState("");
  const [altTitles,setAltTitles]=useState([]);
  const [busyCh,setBusyCh]=useState(null);
  const [error,setError]=useState("");
  const [success,setSuccess]=useState("");
  const [selCh,setSelCh]=useState(0);
  const [quotaHit,setQuotaHit]=useState(false);
  const [buildLog,setBuildLog]=useState([]);
  const [isBuilding,setIsBuilding]=useState(false);
  const [coverMode,setCoverMode]=useState("auto");
  const [customPrompt,setCustomPrompt]=useState("");
  const [lastAiPrompt,setLastAiPrompt]=useState("");
  const buildRef=useRef(false);
  const TABS=["📋 Outline","✍️ Chapters","🎨 Cover","🔍 SEO","🤖 Review","🔎 Market","🪝 Hooks","📊 Quality","✍️ Writing","👥 Characters","📤 Publish","🌍 Translate","🎙️ Audio Studio","📦 Amazon KDP"];

  useEffect(()=>{
    const b=getBook(bookId);if(!b){navigate("home");return;}
    setBook(b);if(getUsage()>=DAILY_LIMIT)setQuotaHit(true);
    if(b.auto_build&&!buildRef.current){buildRef.current=true;runAutoBuild(b);}
    return()=>{buildRef.current=false;};
  },[bookId]);

  const upd=(updates)=>{const b=updateBook(bookId,updates);if(b)setBook(b);return b;};
  const bump=()=>{const c=trackUsage();if(c>=DAILY_LIMIT)setQuotaHit(true);return c;};
  const flash=msg=>{setSuccess(msg);setTimeout(()=>setSuccess(""),4000);};
  const handleErr=e=>{setError(errMsg(e));if(e?.code==="QUOTA")setQuotaHit(true);};
  const log=msg=>{setBuildLog(prev=>[...prev,msg]);updateBook(bookId,{build_step:msg});};

  const generateSeriesOutline=async(b)=>{
    if(!b.book_plan)return null;
    const bp=b.book_plan;
    const series=getSeriesById(b.series_id);
    const seriesBibleCtx=series?buildSeriesContext(series):"";
    log(`📋 Generating outline for Book ${bp.number}: "${bp.title}"…`);
    const raw=await callGemini(
      `You are a master series author. Generate a detailed chapter outline for Book ${bp.number} of the "${b.series_name}" series.\n\n`+
      `BOOK: "${bp.title}" — ${bp.subtitle||""}\nDescription: ${bp.description}\nConflict: ${bp.main_conflict||""}\nHook: ${bp.hook||""}\nCharacter Focus: ${bp.character_focus||""}\n`+
      `Genre: ${b.genre}\nAudience: ${b.target_audience}\n\n`+
      (seriesBibleCtx?seriesBibleCtx+"\n":"")+
      `Generate 10-15 chapters. Weave series-world details consistently.\n\n`+
      `Respond ONLY with valid JSON:\n{"title":"","subtitle":"","description":"","themes":[""],"estimated_word_count":55000,"chapters":[{"number":1,"title":"","description":""}]}`
    );
    bump();
    const match=raw.match(/\{[\s\S]*\}/);if(!match)throw{code:"PARSE"};
    let outline;try{outline=JSON.parse(match[0]);}catch(pe){throw{code:"PARSE",msg:"AI returned malformed JSON — please retry."};}
    const chapters=(outline.chapters||[]).map(c=>({...c,content:"",generated:false}));
    updateBook(bookId,{outline:JSON.stringify(outline),chapters,needs_outline:false,status:"writing"});
    return{outline,chapters};
  };

  const runAutoBuild=async(b)=>{
    if(getUsage()>=DAILY_LIMIT){setQuotaHit(true);upd({auto_build:false});return;}
    // Guard: if build is already fully complete and all chapters are written, don't re-run
    const allChaptersDone=(b.chapters||[]).length>0&&(b.chapters||[]).every(c=>c.generated);
    if(b.build_complete&&allChaptersDone){
      log("✅ Build already complete — nothing to do. Use ↺ Re-run in the banner to reset.");
      upd({auto_build:false});setIsBuilding(false);return;
    }
    // Validate chapter count
    if(!b.needs_outline&&(!b.chapters||b.chapters.length<8)){
      log("⚠️ Only "+(b.chapters?.length||0)+" chapters found in outline. Regenerate the outline with at least 8 chapters before building.");
      upd({auto_build:false,build_step:""});setIsBuilding(false);return;
    }
    setIsBuilding(true);setTab(0);
    try{
      let chapters=b.chapters||[];let outline=b.outline?JSON.parse(b.outline):{};
      if(b.needs_outline&&b.book_plan){const result=await generateSeriesOutline(b);if(result){outline=result.outline;chapters=result.chapters;}else{upd({auto_build:false,build_step:""});setIsBuilding(false);return;}}
      const total=chapters.length;
      for(let i=0;i<total;i++){
        if(!buildRef.current)break;if(getUsage()>=DAILY_LIMIT){setQuotaHit(true);break;}
        if(chapters[i].generated){continue;} // resume-safe: skip chapters already written
        log(`✍️ Writing chapter ${i+1}/${total}: "${chapters[i].title}"…`);setTab(1);setSelCh(i);
        try{
          const prev=chapters.slice(0,i).filter(c=>c.generated).map(c=>c.title).join(", ")||"None";
          const series=b.series_id?getSeriesById(b.series_id):null;
          const seriesCtx=series?`\n\n${buildSeriesContext(series)}\nMaintain full consistency with all established facts.`:"";
          const vp=getVoiceProfile();
          const voiceCtx=vp?.sample_analysis?`\n\nVOICE STYLE TO MATCH: ${vp.sample_analysis}\nSentence rhythm: ${vp.sentence_rhythm||""}\nDistinctive patterns: ${(vp.distinctive_patterns||[]).join(", ")}\nWrite EXACTLY in this style — not generic AI prose.`:"";
          const chars=getCharacters(bookId);
          const charCtx=chars.length?`\n\nESTABLISHED CHARACTERS (maintain exact consistency):\n${chars.map(c=>`${c.name} [${c.role||""}]: ${c.appearance||""} — ${c.personality||""}`).join("\n")}`:"";
          const langNote=b.writing_language&&b.writing_language!=="English"?`\n\nWRITE IN: ${b.writing_language}`:"";
          const nonfictionNote=b.nonfiction_mode?"\n\nNONFICTION MODE: End the chapter with a clearly marked Exercise, Reflection question, and Action Step.":"";
          const content=await callGemini(`Write Chapter ${chapters[i].number}: "${chapters[i].title}" for a ${b.genre} book titled "${outline.title}".${seriesCtx}${voiceCtx}${charCtx}${langNote}${nonfictionNote}\n\nChapter: ${chapters[i].description}\nPrevious: ${prev}\nAudience: ${b.target_audience}\n\n2,500–3,500 words. Match genre tone precisely.\n\nSTRUCTURE:\n• 3-5 distinct scenes per chapter, separated by: ⁂\n• Each scene has a clear goal → obstacle → outcome\n• Chapter must END on a hook, unresolved tension, or revelation that forces reading on\n• DO NOT wrap up cleanly — the best chapters end mid-breath\n\nWRITING RULES — violating these will get this chapter rejected:\n• NEVER start a sentence with 'He/She/They couldn't help but', 'In that moment', 'It dawned on', 'Something about the way', 'A wave of', 'A surge of'\n• NEVER state emotions directly ('he felt sad', 'warmth spread through her') — express through physical action, dialogue, or specific sensory detail\n• NEVER use em-dashes for dramatic effect more than once per page\n• VARY sentence length violently: one-word sentences. Fragments. Then a long, breathing sentence that winds through a scene and refuses to end neatly.\n• Dialogue must be messy and human: people talk past each other, leave things half-said, interrupt, change subject\n• Use SPECIFIC details: not 'the coffee shop smelled like coffee' but the burnt-sugar smell of the espresso machine at 6am, the sticky ring on the table from someone's iced latte\n• No clean emotional resolutions — conflict leaves residue\n• Character psychology must be specific, not convenient\n• Read like a novel — no chapter summaries, no scene headers, no markdown`);
          bump();chapters[i]={...chapters[i],content,generated:true};
          const wc=chapters.reduce((a,c)=>a+(c.content?c.content.split(/\s+/).length:0),0);
          updateBook(bookId,{chapters:[...chapters],word_count:wc});setBook(getBook(bookId));
          if(b.series_id&&getUsage()<DAILY_LIMIT-2){try{
            const evRaw=await callGemini(`List 2-3 key plot events from this chapter that matter for the series. ONLY valid JSON: {"events":["short event description"]}\nBook: "${outline.title||b.title}"\nChapter ${chapters[i].number}: "${chapters[i].title}"\nExcerpt: ${content.slice(0,600)}`,0.2);
            bump();const em=evRaw.match(/\{[\s\S]*\}/);
            if(em){let evD;try{evD=JSON.parse(em[0]);}catch(pe){evD={};}const sa=getSeries();const si=sa.findIndex(s=>s.id===b.series_id);
            if(si>-1){sa[si].plot_events=[...(sa[si].plot_events||[]),...(evD.events||[]).map(ev=>({book:`Book ${b.series_number||"?"}`,event:ev}))];setSeries(sa);}}
          }catch(evE){/* silent */}}
        }catch(e){if(e?.code==="QUOTA"){setQuotaHit(true);break;}log(`⚠️ Ch.${i+1} error — skipped`);}
      }
      if(getUsage()>=DAILY_LIMIT){upd({auto_build:false,build_step:""});setIsBuilding(false);return;}
      // SEO
      if(!getBook(bookId)?.seo_done){
      log("🔍 Generating SEO…");setTab(3);
      try{const raw=await callGemini(`You are an Amazon KDP bestseller SEO strategist. Generate complete publishing metadata.\nTitle: "${outline.title||b.title}"\nGenre: ${b.genre}\nAudience: ${b.target_audience}\nDescription: ${outline.description||''}\n\nRespond ONLY valid JSON (no markdown): {"seo_title":"MAX 60 CHARS — pack the top keyword first","seo_description":"150-200 words — compelling blurb ending with a call to action","primary_keywords":["2-4 word phrase","2-4 word phrase","2-4 word phrase","2-4 word phrase","2-4 word phrase","2-4 word phrase","2-4 word phrase"],"bisac_categories":["CAT1","CAT2"],"back_cover_copy":"","author_bio_template":""}`);bump();const match=raw.match(/\{[\s\S]*\}/);if(match){let seo;try{seo=JSON.parse(match[0]);}catch(pe){throw{code:"PARSE",msg:"AI returned malformed JSON — please retry."};}updateBook(bookId,{seo_title:seo.seo_title||"",seo_description:seo.seo_description||"",seo_keywords:(seo.primary_keywords||[]).join(", "),notes:JSON.stringify(seo),seo_done:true});setBook(getBook(bookId));}}catch(e){if(e?.code==="QUOTA"){setQuotaHit(true);upd({auto_build:false,build_step:""});setIsBuilding(false);return;}}} // end seo_done if
      if(getUsage()>=DAILY_LIMIT){upd({auto_build:false,build_step:""});setIsBuilding(false);return;}
      // Cover
      if(!getBook(bookId)?.cover_done){
      log("🎨 Generating cover…");setTab(2);
      try{const aiPrompt=await callGemini(`Detailed image generation prompt for professional book cover.\nBook: "${outline.title}"\nGenre: ${b.genre}\nDesc: ${outline.description}\n\n- Describe specific characters (gender, age, look, ethnicity)\n- For gay/LGBT+ romance: two male characters, emotional interaction\n- Setting, mood, lighting, palette, art style\n- NO text or words\n- Commercial quality\nReturn ONLY the prompt.`);bump();const finalPrompt=aiPrompt.trim()+". No text, no words, no letters.";setLastAiPrompt(finalPrompt);const artUrl=`https://image.pollinations.ai/prompt/${encodeURIComponent(finalPrompt)}?width=832&height=1216&model=flux&nologo=true&enhance=true&seed=${Date.now()}`;const finalUrl=await finalizeCoverImage(artUrl,outline.title||b.title,getAuthorProfile().name,b.subtitle);updateBook(bookId,{cover_art_url:artUrl,cover_image_url:finalUrl,cover_done:true});setBook(getBook(bookId));}catch(e){if(e?.code==="QUOTA"){setQuotaHit(true);upd({auto_build:false,build_step:""});setIsBuilding(false);return;}}} // end cover_done if
      if(getUsage()>=DAILY_LIMIT){upd({auto_build:false,build_step:""});setIsBuilding(false);return;}
      // Review
      if(!getBook(bookId)?.review_done){
      log("🤖 Running Review Agent…");setTab(4);
      try{const freshBook=getBook(bookId);const review=await runReviewAgent(freshBook);updateBook(bookId,{review,status:review.verdict==="PASS"?"ready":"writing",review_done:true});setBook(getBook(bookId));log(review.verdict==="PASS"?`✅ Review passed! ${review.overall_score}/100`:`⚠️ Review: ${review.overall_score}/100 — see Review tab`);}catch(e){if(e?.code==="QUOTA"){setQuotaHit(true);}}
      } // end review_done if
      if(getUsage()>=DAILY_LIMIT){upd({auto_build:false,build_step:""});setIsBuilding(false);return;}
      // Competitor analysis
      if(!getBook(bookId)?.competitor_done){
      log("🔎 Running competitor analysis…");setTab(5);
      try{
        const freshBook=getBook(bookId);
        const raw=await callGemini(`Amazon KDP market research expert. Analyze competitive landscape.\nTitle: ${freshBook.title}\nGenre: ${freshBook.genre}\nAudience: ${freshBook.target_audience}\nDesc: ${freshBook.description}\n\nRespond ONLY JSON: {"market_summary":"","positioning_statement":"","market_gaps":[""],"reader_pain_points":[""],"pricing_recommendation":{"launch_price":"","rationale":""},"ku_recommendation":{"enroll_in_ku":true,"rationale":""},"categories":{"primary":"","secondary":"","why":""},"launch_strategy":[""]}`,0.4);
        bump();const match=raw.match(/\{[\s\S]*\}/);if(match){try{updateBook(bookId,{competitor_analysis:JSON.parse(match[0]),competitor_done:true});setBook(getBook(bookId));}catch(pe){throw{code:"PARSE",msg:"AI returned malformed competitor analysis JSON — please retry."};} }
      }catch(e){if(e?.code==="QUOTA"){setQuotaHit(true);}}
      } // end competitor_done if
      if(getUsage()>=DAILY_LIMIT){upd({auto_build:false,build_step:""});setIsBuilding(false);return;}
      // Hooks
      if(!getBook(bookId)?.hooks_done){
      log("🪝 Generating hooks…");setTab(6);
      try{
        const freshBook=getBook(bookId);const freshOutline=JSON.parse(freshBook.outline||"{}");
        const raw=await callGemini(`Bestselling author and book marketer. Generate high-converting hooks.\nTitle: ${freshBook.title}\nGenre: ${freshBook.genre}\nAudience: ${freshBook.target_audience}\nDesc: ${freshOutline.description||freshBook.description}\n\nRespond ONLY JSON: {"opening_lines":[""],"back_cover_blurbs":[""],"tagline":"","social_media_hooks":[""],"email_subject_lines":[""],"series_read_order_page":"","amazon_a_plus_headline":""}`,0.9);
        bump();const match=raw.match(/\{[\s\S]*\}/);if(match){try{updateBook(bookId,{hooks:JSON.parse(match[0]),auto_build:false,build_step:"",hooks_done:true});setBook(getBook(bookId));}catch(pe){throw{code:"PARSE",msg:"AI returned malformed hooks JSON — please retry."};} }
      }catch(e){if(e?.code==="QUOTA"){setQuotaHit(true);}}
      } // end hooks_done if

      if(getUsage()<DAILY_LIMIT&&!getBook(bookId)?.wq_done){
        // Writing Quality manuscript check
        log("✍️ Running Writing Quality check…");
        try{
          const freshBook=getBook(bookId);
          const wq=await runManuscriptHumanCheck(freshBook);
          updateBook(bookId,{manuscript_quality:wq,wq_done:true});setBook(getBook(bookId));
          log(wq.manuscript_verdict==="PASS"?`✅ Writing quality: ${wq.overall_human_score}/100 — reads human!`:`⚠️ Writing quality: ${wq.overall_human_score}/100 — AI patterns detected`);
        }catch(e){if(e?.code==="QUOTA"){setQuotaHit(true);}}
      }
      // ── AUTO-CORRECTION ROUND ──────────────────────────────────────
      // If either quality gate failed, attempt one automatic improvement round
      let curBook=getBook(bookId);
      let rvPassed=curBook?.review?.verdict==="PASS";
      let wqPassed=curBook?.manuscript_quality?.manuscript_verdict==="PASS";

      if((!rvPassed||!wqPassed)&&getUsage()<DAILY_LIMIT-3&&getAutoCorrect()){
        log("🔧 Auto-correcting — applying AI suggestions to improve scores…");

        // ── Fix Review Agent if it failed ──
        if(!rvPassed&&curBook?.review&&getUsage()<DAILY_LIMIT-2){
          try{
            const rv=curBook.review;
            const fixes={};
            if(rv.title_suggestions?.[0]){
              const parts=rv.title_suggestions[0].split(":");
              fixes.title=parts[0].trim();
              const sub=parts.slice(1).join(":").trim();
              if(sub)fixes.subtitle=sub;
            }
            if(rv.subtitle_suggestion)fixes.subtitle=rv.subtitle_suggestion;
            if(rv.keyword_suggestions?.length)fixes.seo_keywords=rv.keyword_suggestions.join(", ");
            if(rv.seo_rewrite)fixes.seo_description=rv.seo_rewrite;
            if(Object.keys(fixes).length>0){
              log("  📖 Applying Review Agent suggestions…");
              const updated=updateBook(bookId,fixes);setBook(getBook(bookId));
              const reReview=await runReviewAgent(updated);
              updateBook(bookId,{review:reReview,review_done:true});setBook(getBook(bookId));
              rvPassed=reReview.verdict==="PASS";
              log(rvPassed?`  ✅ Review improved to ${reReview.overall_score}/100 — PASS!`:`  📊 Review improved to ${reReview.overall_score}/100 (still below 70)`);
            }
          }catch(e){if(e?.code==="QUOTA"){setQuotaHit(true);}log("  ⚠️ Review auto-fix failed — see Review tab");}
        }

        // ── Fix Writing Quality if it failed ──
        if(!wqPassed&&getUsage()<DAILY_LIMIT-2){
          try{
            log("  ✍️ Analyzing chapters for rewrite suggestions…");setTab(8);
            const chaps=curBook.chapters||[];
            const wqScores={};
            // Analyze up to 5 chapters to collect rewrite examples
            const sampleIdxs=[];
            const writtenIdxs=chaps.map((c,i)=>c.content?i:-1).filter(i=>i>=0);
            if(writtenIdxs.length<=5){sampleIdxs.push(...writtenIdxs);}
            else{sampleIdxs.push(writtenIdxs[0],writtenIdxs[Math.floor(writtenIdxs.length*0.25)],writtenIdxs[Math.floor(writtenIdxs.length*0.5)],writtenIdxs[Math.floor(writtenIdxs.length*0.75)],writtenIdxs[writtenIdxs.length-1]);}
            for(const idx of sampleIdxs){
              if(getUsage()>=DAILY_LIMIT)break;
              try{
                const res=await analyzeChapterHumanness(chaps[idx].content,curBook.title,curBook.genre,chaps[idx].title);
                wqScores[idx]=res;
              }catch(e){if(e?.code==="QUOTA"){setQuotaHit(true);break;}}
            }
            // Apply all rewrite examples across analyzed chapters
            let rewritesApplied=0;
            const fixedChapters=chaps.map((ch,idx)=>{
              const s=wqScores[idx];
              if(!s?.rewrite_examples?.length||!ch.content)return ch;
              let content=ch.content;
              for(const ex of s.rewrite_examples){
                if(ex.original&&ex.rewrite&&content.includes(ex.original)){
                  content=content.replace(ex.original,ex.rewrite);
                  rewritesApplied++;
                }
              }
              return {...ch,content};
            });
            if(rewritesApplied>0){
              log(`  ✍️ Applied ${rewritesApplied} rewrite fixes across manuscript…`);
              updateBook(bookId,{chapters:fixedChapters,writing_quality:wqScores});setBook(getBook(bookId));
              // Re-run manuscript check
              const reWQ=await runManuscriptHumanCheck(getBook(bookId));
              updateBook(bookId,{manuscript_quality:reWQ,wq_done:true});setBook(getBook(bookId));
              wqPassed=reWQ.manuscript_verdict==="PASS";
              log(wqPassed?`  ✅ Writing quality improved to ${reWQ.overall_human_score}/100 — PASS!`:`  📊 Writing quality improved to ${reWQ.overall_human_score}/100 (still below 78)`);
            }else{
              log("  ℹ️ No specific rewrites found — see Writing Quality tab for manual fixes");
            }
          }catch(e){if(e?.code==="QUOTA"){setQuotaHit(true);}log("  ⚠️ Writing quality auto-fix failed — see Writing Quality tab");}
        }

        log("🔧 Auto-correction complete.");
      }

      // ── FINAL STATUS ──────────────────────────────────────────────
      const finalBook=getBook(bookId);
      const passed=finalBook?.review?.verdict==="PASS";
      const wPassed=finalBook?.manuscript_quality?.manuscript_verdict==="PASS";
      flash(passed&&wPassed?"🎉 Both quality checks passed — ready to publish!":!passed?"📋 Review tab has improvements needed.":"✍️ Writing Quality tab has suggestions to humanize your manuscript.");
      upd({auto_build:false,build_step:"",status:passed&&wPassed?"ready":"writing",build_complete:true,gates_passed:passed&&wPassed,build_complete_date:new Date().toISOString()});
      setTab(passed&&wPassed?10:!passed?4:8);
    }catch(e){handleErr(e);upd({auto_build:false,build_step:""});}
    finally{setIsBuilding(false);buildRef.current=false;}
  };

  const genChapter=async(idx)=>{
    if(quotaHit||isBuilding)return;setBusyCh(idx);setError("");
    try{
      const outline=(()=>{try{return JSON.parse(book.outline||"{}");}catch{return {};}})();const ch=outline.chapters?.[idx];if(!ch){setError("Chapter outline missing — regenerate the outline.");setBusyCh(null);return;}
      const prevChaps=(book.chapters||[]).slice(0,idx).filter(c=>c.generated);
      const prev=prevChaps.length===0?"None":
        prevChaps.length<=2?prevChaps.map(c=>c.title).join(", "):
        prevChaps.slice(-3).map(c=>`Ch.${c.number} "${c.title}": ${(c.content||"").slice(0,200).replace(/\n/g," ")}…`).join("\n");
      const series=book.series_id?getSeriesById(book.series_id):null;
      const seriesCtx=series?`\n\n${buildSeriesContext(series)}\nMaintain full consistency.`:"";
      const vp=getVoiceProfile();
      const voiceCtx=vp?.sample_analysis?`\n\nVOICE STYLE: ${vp.sample_analysis}\nRhythm: ${vp.sentence_rhythm||""}\nPatterns: ${(vp.distinctive_patterns||[]).join(", ")}\nMatch this style exactly.`:"";
      const chars=getCharacters(bookId);
      const charCtx=chars.length?`\n\nCHARACTERS:\n${chars.map(c=>`${c.name}: ${c.appearance||""} — ${c.personality||""}`).join("\n")}`:"";
      const langNote=book.writing_language&&book.writing_language!=="English"?`\n\nWRITE IN: ${book.writing_language}`:"";
      const nfNote=book.nonfiction_mode?"\n\nEnd with: Exercise, Reflection, Action Step.":"";
      const content=await callGemini(`Write Chapter ${ch.number}: "${ch.title}" for a ${book.genre} book titled "${outline.title}".${seriesCtx}${voiceCtx}${charCtx}${langNote}${nfNote}\n\nDesc: ${ch.description}\nPrevious: ${prev}\nAudience: ${book.target_audience}\n\n2,500–3,500 words. Match genre tone.\n\nSTRUCTURE:\n• 3-5 distinct scenes per chapter, separated by: ⁂\n• Each scene has a clear goal → obstacle → outcome\n• Chapter must END on a hook, unresolved tension, or revelation that forces reading on\n• DO NOT wrap up cleanly — the best chapters end mid-breath\n\nWRITING RULES — violating these will get this chapter rejected:\n• NEVER start a sentence with 'He/She/They couldn't help but', 'In that moment', 'It dawned on', 'Something about the way', 'A wave of', 'A surge of'\n• NEVER state emotions directly ('he felt sad', 'warmth spread through her') — express through physical action, dialogue, or specific sensory detail\n• NEVER use em-dashes for dramatic effect more than once per page\n• VARY sentence length violently: one-word sentences. Fragments. Then a long, breathing sentence that winds through a scene and refuses to end neatly.\n• Dialogue must be messy and human: people talk past each other, leave things half-said, interrupt, change subject\n• Use SPECIFIC details: not 'the coffee shop smelled like coffee' but the burnt-sugar smell of the espresso machine at 6am, the sticky ring on the table from someone's iced latte\n• No clean emotional resolutions — conflict leaves residue\n• Character psychology must be specific, not convenient\n• Read like a novel — no chapter summaries, no scene headers, no markdown`);
      bump();const chapters=[...(book.chapters||[])];chapters[idx]={...chapters[idx],content,generated:true};
      const wc=chapters.reduce((a,c)=>a+(c.content?c.content.split(/\s+/).length:0),0);
      // If all chapters now done + pipeline already ran → auto-stamp build_complete
      const allDone=chapters.every(c=>c.generated);
      const curB=getBook(bookId);
      const extraStamps=allDone&&curB?.seo_done&&curB?.cover_done&&curB?.review_done&&!curB.build_complete
        ?{build_complete:true,build_complete_date:new Date().toISOString(),gates_passed:curB?.review?.verdict==="PASS"&&curB?.manuscript_quality?.manuscript_verdict==="PASS"}
        :{};
      upd({chapters,word_count:wc,status:"writing",...extraStamps});flash(`Chapter ${idx+1} written! ✍️`);
    }catch(e){handleErr(e);}finally{setBusyCh(null);}
  };

  const genChapterIllustration=async(idx)=>{
    if(quotaHit||isBuilding||busy)return;
    const ch=book.chapters?.[idx];if(!ch?.content){setError("Write this chapter first.");return;}
    setBusy(true);setError("");
    try{
      // Generate image prompt from chapter content
      const imgPrompt=await callGemini(
        `You are a book illustrator. Write a Stable Diffusion prompt for an illustration for this chapter.\n`+
        `Book: "${book.title}" (${book.genre})\n`+
        `Chapter: "${ch.title}"\n`+
        `Chapter excerpt: ${ch.content.slice(0,600)}\n\n`+
        `Rules: describe ONE key visual scene from this chapter. No text/words in the image. Cinematic, painterly style. Max 100 words. Return ONLY the prompt.`,
        0.7
      );
      bump();
      const seed=Date.now();
      const illustrationUrl=`https://image.pollinations.ai/prompt/${encodeURIComponent(imgPrompt.trim()+". Book illustration, painterly, cinematic, no text.")}?width=1216&height=832&model=flux&nologo=true&enhance=true&seed=${seed}`;
      const chapters=[...(book.chapters||[])];
      chapters[idx]={...chapters[idx],illustration_url:illustrationUrl,illustration_prompt:imgPrompt.trim()};
      upd({chapters});
      flash(`Chapter ${idx+1} illustration generated! 🖼️`);
    }catch(e){handleErr(e);}finally{setBusy(false);}
  };

  
  // ══════════════════════════════════════════════════════════════════════════════
  // 📦 AMAZON KDP PACKAGE GENERATOR
  // ══════════════════════════════════════════════════════════════════════════════
  const genKDPPackage=async()=>{
    if(quotaHit||isBuilding)return;
    setBusy(true);setBusyStep("🔍 Analyzing your book for Amazon KDP…");setError("");
    try{
      const outline=(()=>{try{return JSON.parse(book.outline||"{}");}catch{return {};}})();
      const chapterSample=((book.chapters||[]).filter(c=>c.content).slice(0,2).map(c=>`Ch.${c.number} "${c.title}":\n${(c.content||"").slice(0,600)}`).join("\n\n"))||"No chapters written yet.";
      const isAudio=book.format==="audiobook"||book.audio_url||book.audio_script;
      const seriesCtx=book.series_name?`\nSeries: ${book.series_name} (Book ${book.series_number||1})`:""

      setBusyStep("🧠 Building KDP title, keywords & BISAC categories…");
      const raw1=await callGemini(
        `You are a top Amazon KDP bestseller consultant. I need a COMPLETE Amazon product page package for this book.\n\nBook Title: "${outline.title||book.title}"\nSubtitle: "${outline.subtitle||book.subtitle||""}"\nGenre: ${book.genre}\nTarget Audience: ${book.target_audience}\nDescription: ${outline.description||book.description||""}\n${seriesCtx}\nHooks: ${book.hooks?(()=>{try{return JSON.stringify(JSON.parse(book.hooks)).slice(0,400);}catch{return "";}})():""}\nSEO keywords already found: ${book.seo_keywords||""}\n\nChapter Sample:\n${chapterSample}\n\nGenerate the COMPLETE KDP product page package. Respond ONLY with valid JSON (no markdown, no code blocks):\n{\n  "kdp_title": "Keyword-optimized book title for KDP (include 1-2 high-volume search terms naturally, max 200 chars)",\n  "kdp_subtitle": "Benefit-driven subtitle with top search keywords, max 200 chars",\n  "kdp_description_html": "Full Amazon book description in HTML (use <h2>, <b>, <p>, <ul><li> tags). Must be 3500-4000 chars. Structure: compelling 2-sentence hook → 3 bullet <li> points of what readers gain → story/content overview paragraph → who this book is for → final call to action. Use Amazon-specific formatting.",\n  "kdp_7_keywords": ["exact phrase 1","exact phrase 2","exact phrase 3","exact phrase 4","exact phrase 5","exact phrase 6","exact phrase 7"],\n  "kdp_bisac_1": "Full BISAC category path e.g. FICTION / Romance / Contemporary",\n  "kdp_bisac_2": "Second BISAC path",\n  "kdp_price_usd": 4.99,\n  "kdp_price_rationale": "One sentence pricing strategy with royalty math",\n  "kdp_author_bio": "Professional 3rd-person Amazon Author Central bio, 120-150 words, written as if the author is established",\n  "kdp_editorial_review": "A mock 4-5 star editorial review quote (for Amazon Editorial Reviews section), 60 words, from a fictional trade publication",\n  "kdp_series_info": "${book.series_name||"Standalone"}",\n  "kdp_territorial_rights": "worldwide",\n  "kdp_ai_disclosure": "This work was created with AI assistance. The author directed the creative vision, plot, characters, and content.",\n  "kdp_look_inside_hook": "The first 200-word excerpt optimized to hook readers in the Look Inside preview",\n  "kdp_a_plus_headline": "Amazon A+ Content headline (150 chars max)",\n  "kdp_a_plus_body": "Amazon A+ Content body paragraph (600 chars), emotionally engaging, uses lifestyle language",\n  "ai_search_keywords": ["8 discovery phrases optimized for AI search engines like ChatGPT, Perplexity, and Claude — conversational, question-based, or use-case phrasing e.g. best romance novel about second chances 2025"]\n}`
      );
      bump();
      setBusyStep("✅ Parsing KDP metadata…");
      const m1=raw1.match(/\{[\s\S]*\}/);
      if(!m1)throw{code:"PARSE",msg:"KDP package JSON not found in AI response"};
      let kdp;try{kdp=JSON.parse(m1[0]);}catch(pe){throw{code:"PARSE",msg:"AI returned malformed KDP JSON — please retry."};};

      // Build optimized KDP cover prompt
      setBusyStep("🎨 Generating KDP-optimized thumbnail prompt…");
      const coverRaw=await callGemini(
        `You are an Amazon KDP cover design expert. Generate a Pollinations.ai image prompt for a HIGH-CONVERTING Amazon thumbnail.\n\nBook: "${kdp.kdp_title}"\nGenre: ${book.genre}\nAudience: ${book.target_audience}\nBISAC: ${kdp.kdp_bisac_1}\nExisting cover URL: ${book.cover_image_url||"none"}\n\nAmazon thumbnail requirements:\n• Must look STUNNING at 160x250px (thumbnail size on search results)\n• Bold, high-contrast imagery that pops on white Amazon background\n• Strong focal point — single hero element or face\n• Genre visual language (romance: warm intimate tones; thriller: cold dark contrast; self-help: clean aspirational; fantasy: epic dramatic)\n• "Professional bestselling book cover" quality\n\nReturn ONLY the image prompt string — no JSON, no explanations.\nEnd with: "Amazon book cover, ultra-detailed, commercially published quality, no text no words no letters, portrait orientation 2:3 ratio"`
      );
      bump();
      const coverPrompt=coverRaw.trim();

      // Generate the KDP thumbnail via Pollinations
      setBusyStep("🖼️ Rendering KDP thumbnail (optimized for Amazon search)…");
      const seed=Math.floor(Math.random()*99999);
      const thumbUrl=`https://image.pollinations.ai/prompt/${encodeURIComponent(coverPrompt)}?width=1400&height=2100&seed=${seed}&nologo=true&enhance=true`;

      // ACX/Audiobook fields if applicable
      let acx={};
      if(isAudio){
        setBusyStep("🎧 Building ACX/Audible product page…");
        const acxRaw=await callGemini(
          `You are an ACX (Audible Creation Exchange) publishing expert. Generate the complete Audible/ACX product page for this audiobook.\n\nBook: "${kdp.kdp_title}"\nGenre: ${book.genre}\nAudience: ${book.target_audience}\nRuntime estimate: ${Math.ceil(((book.chapters||[]).reduce((s,c)=>s+(c.content||"").split(/\s+/).length,0))/150)} minutes\n\nRespond ONLY with valid JSON:\n{"acx_title":"Audiobook title for ACX/Audible","acx_subtitle":"Audiobook subtitle","acx_description":"Audible product description 2000 chars — hook, what listeners experience, narrator style note, call to action","acx_keywords":["8 Audible search keywords"],"acx_categories":["Primary Audible category","Secondary"],"acx_narrator_direction":"2-sentence note to narrator on tone, pacing and emotion","acx_cover_prompt":"Pollinations.ai prompt for ACX square cover (3000x3000 required) — same art style as book cover but square crop"}`
        );
        bump();
        const acxM=acxRaw.match(/\{[\s\S]*\}/);
        if(acxM){try{acx=JSON.parse(acxM[0]);}catch(pe){acx={};}}
      }

      // Save everything
      upd({
        kdp_package:JSON.stringify({...kdp,coverPrompt,thumbUrl,...acx,generated_at:new Date().toISOString()}),
        kdp_thumb_url:thumbUrl
      });
      flash("Amazon KDP package ready! 📦");
    }catch(e){handleErr(e);}
    finally{setBusy(false);setBusyStep("");}
  };

const genSEO=async()=>{if(quotaHit||isBuilding)return;setBusy(true);setError("");try{const outline=(()=>{try{return JSON.parse(book.outline||"{}");}catch{return {};}})();const raw=await callGemini(`You are a top-tier Amazon KDP bestseller strategist with 15+ years optimizing book discoverability.\n\nBook Details:\nTitle: "${outline.title||book.title}"\nGenre: ${book.genre}\nAudience: ${book.target_audience}\nDescription: ${outline.description||''}\n\nGenerate complete publishing metadata. Respond ONLY with valid JSON (no markdown, no code blocks):\n{"seo_title":"Exact-match keyword-rich title for KDP (max 200 chars)","seo_description":"400-word Amazon description with hook, 3 bullet points using • , social proof, call to action","primary_keywords":["7 long-tail exact-match Amazon search phrases readers actually type"],"backend_keywords":"up to 7 extra search terms space-separated for Amazon backend field (no repeats from primary)","bisac_categories":["Primary BISAC category path","Secondary BISAC category path"],"back_cover_copy":"3-paragraph back cover blurb: hook sentence, escalating tension or benefit, cliffhanger or promise","author_bio_template":"Professional 3rd-person author bio template 80 words","recommended_price_usd":4.99,"price_rationale":"One sentence pricing strategy","comp_titles":["3 comparable bestselling books Author — Title format"],"hook_line":"One irresistible sentence for social media"}`);bump();const match=raw.match(/\{[\s\S]*\}/);if(!match)throw{code:"PARSE"};let seo;try{seo=JSON.parse(match[0]);}catch(pe){throw{code:"PARSE",msg:"AI returned malformed SEO JSON — please retry."};}upd({seo_title:seo.seo_title||"",seo_description:seo.seo_description||"",seo_keywords:(seo.primary_keywords||[]).join(", "),notes:JSON.stringify(seo)});flash("SEO generated! 🔍");}catch(e){handleErr(e);}finally{setBusy(false);}};

  const genAltTitles=async()=>{
    if(quotaHit||isBuilding||busy)return;setBusy(true);setError("");
    try{
      const outline=(()=>{try{return JSON.parse(book.outline||"{}");}catch{return {};}})();
      const raw=await callGemini(`You are an Amazon KDP bestseller expert. Generate 5 KILLER alternative titles for this book.\nBook: "${book.title}"\nGenre: ${book.genre}\nAudience: ${book.target_audience}\nDescription: ${outline.description||book.description}\n\nRules:\n• Each title must be unique in approach (curiosity, benefit, transformation, emotional, bold claim)\n• For fiction: evocative, genre-appropriate, memorable\n• For nonfiction: benefit-driven, searchable on Amazon\n\nRespond ONLY with valid JSON: {"alternatives":[{"title":"","subtitle":"","rationale":"why this works on KDP"}]}`);
      bump();const m=raw.match(/\{[\s\S]*\}/);if(!m)throw{code:"PARSE"};
      let d;try{d=JSON.parse(m[0]);}catch(pe){throw{code:"PARSE",msg:"AI returned malformed titles JSON — please retry."};}
      setAltTitles(d.alternatives||[]);
      flash("5 alternative titles generated! 📝");
    }catch(e){handleErr(e);}finally{setBusy(false);}
  };

  const genCover=async()=>{if(quotaHit||isBuilding)return;setBusy(true);setError("");try{let finalPrompt="";if(coverMode==="custom"&&customPrompt.trim()){finalPrompt=customPrompt.trim()+". Professional book cover, no text, no letters.";}else{const outline=(()=>{try{return JSON.parse(book.outline||"{}");}catch{return {};}})();const aiPrompt=await callGemini(`You are a professional book cover art director. Generate a detailed Pollinations.ai image prompt for a stunning, commercially competitive book cover.\n\nBook: "${outline.title}"\nGenre: ${book.genre}\nTarget Audience: ${book.target_audience}\nDescription: ${outline.description}\n\nCOVER REQUIREMENTS:\n• Describe EXACTLY what the illustration shows: subjects (age, gender, expression, pose, clothing), setting, foreground/background\n• For romance: two emotionally connected characters, chemistry visible in body language\n• For gay/LGBT+ romance: two male characters, intimate and emotionally charged interaction\n• For thriller/mystery: dark, cinematic, tense atmosphere with strong single focal point\n• For nonfiction/self-help: clean, bold, aspirational — minimalist design language\n• For fantasy/sci-fi: epic world-building detail, dramatic lighting, expansive scale\n\n• Color palette: specify 2-3 dominant colors that match the genre mood\n• Lighting: (e.g., "golden hour backlight", "neon noir", "cold winter morning", "dramatic studio")\n• Art style: (e.g., "painterly digital art", "photorealistic", "graphic novel ink", "watercolor", "CGI render")\n• Camera angle and composition (rule of thirds, centered, low angle)\n• Quality tags: masterpiece, award-winning book cover, professional commercial illustration, 4k detail\n\nCRITICAL RULES:\n• NO text, letters, words, numbers, watermarks of any kind\n• Portrait orientation optimized for book covers\n• Return ONLY the image prompt — no explanations, no JSON, just the prompt string.`);bump();finalPrompt=aiPrompt.trim()+". No text, no words, no letters.";setLastAiPrompt(finalPrompt);}const artUrl=`https://image.pollinations.ai/prompt/${encodeURIComponent(finalPrompt)}?width=832&height=1216&model=flux&nologo=true&enhance=true&seed=${Date.now()}`;const _ol=(()=>{try{return JSON.parse(book.outline||"{}");}catch{return {};}})();const finalUrl=await finalizeCoverImage(artUrl,_ol.title||book.title,getAuthorProfile().name,book.subtitle);upd({cover_art_url:artUrl,cover_image_url:finalUrl});flash(getAuthorProfile().name?"Cover generated! 🎨":"Cover generated! 🎨 (set your author name in Settings to replace the \"Author\" placeholder)");}catch(e){handleErr(e);}finally{setBusy(false);}};

  const newVariation=async()=>{if(!book?.cover_art_url&&!book?.cover_image_url)return;setBusy(true);try{const base=book.cover_art_url||book.cover_image_url;const u=new URL(base);u.searchParams.set("seed",Date.now().toString());const artUrl=u.toString();const _ol=(()=>{try{return JSON.parse(book.outline||"{}");}catch{return {};}})();const finalUrl=await finalizeCoverImage(artUrl,_ol.title||book.title,getAuthorProfile().name,book.subtitle);upd({cover_art_url:artUrl,cover_image_url:finalUrl});flash("New variation! 🎨");}catch(e){handleErr(e);}finally{setBusy(false);}};

  const download=(fmt="md")=>{
    if(!book.review){setError("Run the Review Agent first (Review tab).");setTab(4);return;}
    if(book.review.verdict!=="PASS"){setError(`Review score ${book.review.overall_score}/100 — needs 70+. Check Review tab.`);setTab(4);return;}
    if(!book.manuscript_quality){setError("Run the Writing Quality check first (Writing tab).");setTab(8);return;}
    if(book.manuscript_quality.manuscript_verdict!=="PASS"){setError(`Writing Quality score ${book.manuscript_quality.overall_human_score}/100 — needs 72+. Fix AI patterns in Writing tab.`);setTab(8);return;}
    if(!book.chapters?.some(c=>c.content)){setError("Write at least one chapter first.");return;}
    const chaps=(book.chapters||[]).filter(c=>c.content);
    const seriesPage=book.hooks?.series_read_order_page?"\n\n---\n\n# Also By This Author\n\n"+book.hooks.series_read_order_page:"";
    if(fmt==="md"){
      const md="# "+book.title+"\n"+(book.subtitle?"## "+book.subtitle+"\n":"")+"\n"+(book.description||"")+"\n\n---\n\n"+chaps.map(c=>"# Chapter "+c.number+": "+c.title+"\n\n"+c.content).join("\n\n---\n\n")+seriesPage;
      const a=Object.assign(document.createElement("a"),{href:URL.createObjectURL(new Blob([md],{type:"text/markdown"})),download:(book.title||"book").replace(/[^a-z0-9]/gi,"_")+".md"});a.click();
    } else if(fmt==="epub"){
      setBusy(true);
      (async()=>{
        try{
          const epubBlob=await buildEPUB({...book,author_name:getAuthorProfile().name||"Author"});
          const a=Object.assign(document.createElement("a"),{href:URL.createObjectURL(epubBlob),download:(book.title||"book").replace(/[^a-z0-9]/gi,"_")+".epub"});a.click();
        }catch(err){
          setError("EPUB generation failed: "+(err.message||"unknown error"));
        }finally{
          setTimeout(()=>setBusy(false),800);
        }
      })();
    } else if(fmt==="txt"){
      const txt=(book.title||"")+(book.subtitle?"\n"+book.subtitle:"")+"\n"+"=".repeat(50)+"\n\n"+(book.description||"")+"\n\n"+chaps.map(c=>"CHAPTER "+c.number+": "+c.title.toUpperCase()+"\n\n"+c.content).join("\n\n"+"─".repeat(40)+"\n\n")+seriesPage;
      const a=Object.assign(document.createElement("a"),{href:URL.createObjectURL(new Blob([txt],{type:"text/plain"})),download:(book.title||"book").replace(/[^a-z0-9]/gi,"_")+".txt"});a.click();
    } else if(fmt==="rtf"){
      const rtfContent=buildRTF({...book,author_name:getAuthorProfile().name||"Author"});
      const a=Object.assign(document.createElement("a"),{href:URL.createObjectURL(new Blob([rtfContent],{type:"application/rtf"})),download:(book.title||"book").replace(/[^a-z0-9]/gi,"_")+".rtf"});a.click();
    } else if(fmt==="audio"){
      const ap=getAuthorProfile();
      // Build character voice guide from character manager data
      const chars=getCharacters(bookId)||[];
      const voiceGuide=chars.length>0?`\n\nCHARACTER VOICES:\n${chars.map(c=>`• ${c.name}: ${c.personality||""} — Voice: ${c.voice_notes||c.appearance||"distinctive"}`).join("\n")}`:"";
      // Detect chapter tone from content (fast/slow/tense/emotional)
      const getChTone=(content)=>{
        const c=content.toLowerCase();
        if(c.includes("scream")||c.includes("ran")||c.includes("chase")||c.includes("gunshot"))return"FAST-PACED — increase tempo, shorter breaths";
        if(c.includes("kiss")||c.includes("held")||c.includes("cried")||c.includes("tears"))return"EMOTIONAL — slow down, let pauses breathe";
        if(c.includes("crept")||c.includes("whisper")||c.includes("shadow")||c.includes("silence"))return"TENSE — hushed, deliberate";
        return"STANDARD — follow natural prose rhythm";
      };
      const outline=(()=>{try{return JSON.parse(book.outline||"{}");}catch{return {};}})();      const script=
        "════════════════════════════════════════════════════════════\n"+
        "AUDIOBOOK NARRATION SCRIPT\n"+
        "════════════════════════════════════════════════════════════\n"+
        "Title:    "+(book.title||"")+"\n"+
        (book.subtitle?"Subtitle: "+book.subtitle+"\n":"")+
        "Author:   "+(ap.name||"Author")+"\n"+
        "Genre:    "+book.genre+"\n"+
        "Audience: "+book.target_audience+"\n"+
        "Chapters: "+chaps.length+"\n"+
        "Est. Time: ~"+Math.round(chaps.reduce((a,c)=>a+(c.content||"").split(/\s+/).length,0)/150)+" minutes\n"+
        "════════════════════════════════════════════════════════════\n"+
        "\nNARRATOR DIRECTION\n"+
        "────────────────────────────────────────\n"+
        "• Reading pace: 150 words/minute (adjust per tone notes below)\n"+
        "• Pause after chapter titles: 2 seconds\n"+
        "• Pause at scene breaks (⁂): 1.5 seconds\n"+
        "• Dialogue: give each character a distinct, consistent vocal quality\n"+
        voiceGuide+"\n\n"+
        "════════════════════════════════════════════════════════════\n\n"+
        chaps.map(c=>{
          const tone=getChTone(c.content||"");
          const cleanContent=c.content
            .replace(/[#*_`]/g,"")
            .replace(/---+/g,"\n⁂\n")
            .replace(/([.!?])\s*"\s*([A-Z])/g,'$1" [brief pause] $2')
            .replace(/\n{3,}/g,"\n\n");
          return(
            "════════════════════════════════════════════════════════════\n"+
            "CHAPTER "+c.number+": "+c.title.toUpperCase()+"\n"+
            "[Tone: "+tone+"]\n"+
            "[Words: ~"+(c.content.split(/\s+/).length)+" | Est. "+Math.round(c.content.split(/\s+/).length/150)+" min]\n"+
            "────────────────────────────────────────\n\n"+
            cleanContent
          );
        }).join("\n\n[CHAPTER BREAK — 3 second pause]\n\n")+"\n\n"+
        "════════════════════════════════════════════════════════════\n"+
        "[END OF BOOK — 5 second pause — End credits music]\n"+
        "════════════════════════════════════════════════════════════\n";
      const a=Object.assign(document.createElement("a"),{href:URL.createObjectURL(new Blob([script],{type:"text/plain"})),download:(book.title||"book").replace(/[^a-z0-9]/gi,"_")+"_audiobook.txt"});a.click();
    }
  };

  if(!book)return<div className="text-white/40 text-center py-20">Loading…</div>;
  const reviewPassed=book.review?.verdict==="PASS";
  const reviewScore=book.review?.overall_score;
  const writingPassed=book.manuscript_quality?.manuscript_verdict==="PASS";
  const writingScore=book.manuscript_quality?.overall_human_score;

  return(
    <div>
      <div className="border-b border-white/10 bg-black/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 flex gap-1 overflow-x-auto">
          {TABS.map((t,i)=>(
            <button key={i} onClick={()=>setTab(i)} className={`px-3 py-2.5 text-xs sm:text-sm font-medium whitespace-nowrap rounded-t-lg transition-all relative ${tab===i?"bg-white/10 text-white border-b-2 border-purple-500":"text-white/35 hover:text-white/70"}`}>
              {t}
              {i===4&&book.review&&<span className={`ml-1 text-xs font-bold ${reviewPassed?"text-green-400":"text-red-400"}`}>{reviewScore}</span>}
              {i===8&&book.manuscript_quality&&<span className={`ml-1 text-xs font-bold ${writingPassed?"text-green-400":"text-red-400"}`}>{writingScore}</span>}
              {i===9&&(getCharacters(bookId)||[]).length>0&&<span className="ml-1 text-xs text-purple-300">{(getCharacters(bookId)||[]).length}</span>}
            </button>
          ))}
        </div>
      </div>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        {isBuilding&&<div className="bg-purple-500/15 border border-purple-500/40 rounded-xl p-5 mb-5">
          <div className="flex items-center gap-3 mb-3"><Spin/><p className="text-purple-300 font-semibold">Auto-building your book…</p></div>
          <div className="h-1.5 bg-white/10 rounded-full overflow-hidden mb-3"><div className="h-full bg-gradient-to-r from-purple-500 to-pink-500 rounded-full pulse-a" style={{width:`${Math.min(((book.chapters||[]).filter(c=>c.generated).length/Math.max((book.chapters||[{a:1}]).length,1))*70+5,95)}%`}}/></div>
          {/* Pipeline step status tracker */}
          <div className="grid grid-cols-4 gap-1.5 mb-3">
            {[
              ["📋","Outline",!book.needs_outline],
              ["✍️","Chapters",(book.chapters||[]).length>0&&(book.chapters||[]).every(c=>c.generated)],
              ["🔍","SEO",!!book.seo_done],
              ["🎨","Cover",!!book.cover_done],
              ["🤖","Review",!!book.review_done],
              ["🔎","Market",!!book.competitor_done],
              ["🪝","Hooks",!!book.hooks_done],
              ["📊","Writing",!!book.wq_done],
            ].map(([icon,label,done])=>(
              <div key={label} className={`flex items-center gap-1 rounded-lg px-2 py-1 text-xs ${done?"bg-green-500/20 text-green-300":"bg-white/5 text-white/30"}`}>
                <span>{done?"✅":icon}</span><span className="truncate">{label}</span>
              </div>
            ))}
          </div>
          <div className="space-y-1 max-h-24 overflow-y-auto">{buildLog.slice(-5).map((l,i)=><p key={i} className="text-purple-200/50 text-xs">{l}</p>)}</div>
        </div>}
        {quotaHit&&<div className="bg-amber-500/20 border border-amber-500/40 rounded-xl p-4 mb-5 flex gap-3 items-start"><span className="text-2xl">⏳</span><div className="flex-1"><p className="text-amber-300 font-semibold">Daily Gemini Limit Reached</p><p className="text-amber-200/60 text-sm mt-0.5">Resets at midnight Pacific Time. All progress saved!</p></div><button onClick={()=>{setQuotaHit(false);setError("");}} className="text-amber-400/40 hover:text-amber-300">✕</button></div>}
        {error&&!quotaHit&&<div className="bg-red-500/20 border border-red-500/30 text-red-300 rounded-xl p-4 mb-5 text-sm flex items-center justify-between gap-3"><span className="flex-1">{error}</span><div className="flex items-center gap-2 shrink-0">{(book?.chapters?.length>0||book?.needs_outline)&&!isBuilding&&<button onClick={()=>{setError("");upd({auto_build:true});runAutoBuild(getBook(bookId));}} className="bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 text-xs font-bold px-3 py-1.5 rounded-lg hover:bg-cyan-500/30">🔄 Retry</button>}<button onClick={()=>setError("")} className="text-red-300/60 hover:text-red-300">✕</button></div></div>}
        {success&&<div className="bg-green-500/20 border border-green-500/30 text-green-300 rounded-xl p-4 mb-5 text-sm">{success}</div>}
        {!isBuilding&&!quotaHit&&book&&!book.build_complete&&!book.auto_build&&(book.needs_outline||(book.chapters?.length>0&&book.chapters.some(c=>!c.generated)))&&(
          <div className="bg-cyan-500/10 border border-cyan-500/30 rounded-xl p-4 mb-5 text-sm flex items-center justify-between gap-3">
            <span className="text-cyan-200">⏸️ This book's build stopped partway — {book.needs_outline?"outline not generated yet":`${book.chapters.filter(c=>c.generated).length}/${book.chapters.length} chapters done`}. Nothing is lost.</span>
            <button onClick={()=>{setError("");upd({auto_build:true});runAutoBuild(getBook(bookId));}} className="bg-cyan-500 text-white text-xs font-bold px-4 py-2 rounded-lg hover:bg-cyan-400 shrink-0">▶ Resume Build</button>
          </div>
        )}
        {book?.build_complete&&!isBuilding&&(
          <div className={`${book.gates_passed?"bg-green-500/10 border-green-500/30":"bg-amber-500/10 border-amber-500/30"} border rounded-xl p-4 mb-5 text-sm flex items-center justify-between gap-3`}>
            <div>
              <span className={`${book.gates_passed?"text-green-300":"text-amber-300"} font-semibold`}>{book.gates_passed?"✅ Build complete":"⚠️ Pipeline finished"}</span>
              <span className={`${book.gates_passed?"text-green-200/60":"text-amber-200/60"} ml-2`}>
                {book.gates_passed
                  ?"— all chapters written, SEO, cover, and quality checks done. Ready to publish!"
                  :"— pipeline ran to completion. Check Review and Writing Quality tabs for what needs improving."}
              </span>
            </div>
            <button onClick={()=>upd({build_complete:false,gates_passed:false,seo_done:false,cover_done:false,review_done:false,competitor_done:false,hooks_done:false,wq_done:false})} className="text-white/30 text-xs hover:text-white/60 shrink-0" title="Reset all completion flags to re-run the full pipeline">↺ Re-run</button>
          </div>
        )}

        {/* OUTLINE */}
        {tab===0&&<div className="max-w-3xl mx-auto"><Card>{book.series_name&&<div className="mb-3"><SeriesBibleInline bookId={bookId}/></div>}<h2 className="text-white text-xl font-bold">{book.title}</h2>{book.subtitle&&<p className="text-purple-300 mt-1 mb-4 text-sm">{book.subtitle}</p>}<p className="text-white/60 text-sm leading-relaxed mb-6">{book.description}</p>{book.chapters?.length>0&&<><p className="text-white/40 text-xs uppercase tracking-wider mb-3">Chapters ({book.chapters.length})</p><div className="space-y-2">{book.chapters.map((ch,i)=><div key={i} className={`rounded-xl p-3 border flex gap-3 items-start ${ch.generated?"bg-green-500/10 border-green-500/20":"bg-white/5 border-white/10"}`}><span className={`font-bold text-sm min-w-[24px] ${ch.generated?"text-green-400":"text-purple-400"}`}>{ch.generated?"✓":ch.number+"."}</span><div className="flex-1"><p className="text-white text-sm font-medium">{ch.title}</p><p className="text-white/35 text-xs mt-0.5">{ch.description}</p>{ch.content&&<div className="flex items-center gap-3 mt-1.5"><span className="text-green-400/70 text-xs">{ch.content.split(/\s+/).length.toLocaleString()} words</span><span className="text-white/20 text-xs">~{Math.ceil(ch.content.split(/\s+/).length/200)} min read</span></div>}{ch.opening_hook&&!ch.content&&<p className="text-purple-300/50 text-xs mt-1 italic">Hook: {ch.opening_hook.slice(0,80)}…</p>}</div>{ch.generated?<span className="text-green-400/50 text-xs shrink-0">✅ Done</span>:<span className="text-white/20 text-xs shrink-0">Pending</span>}</div>)}</div><div className="mt-5 bg-white/5 rounded-xl p-4"><div className="flex justify-between text-xs text-white/40 mb-2"><span>Progress</span><span>{book.chapters.filter(c=>c.generated).length}/{book.chapters.length} chapters</span></div><div className="h-2 bg-white/10 rounded-full overflow-hidden"><div className="h-full bg-gradient-to-r from-purple-500 to-pink-500 rounded-full" style={{width:`${(book.chapters.filter(c=>c.generated).length/book.chapters.length)*100}%`}}/></div></div></>}{(!book.chapters||book.chapters.length===0)&&isBuilding&&<div className="text-center py-8 text-white/30"><Spin/><p className="mt-3 text-sm">Generating outline…</p></div>}</Card></div>}

        {/* CHAPTERS */}
        {tab===1&&<div className="grid grid-cols-1 lg:grid-cols-3 gap-5"><div className="lg:col-span-1"><div className="bg-white/5 border border-white/10 rounded-2xl p-4 sticky top-24"><div className="flex items-center justify-between mb-3"><h3 className="text-white font-semibold text-sm">Chapters</h3>{!isBuilding&&<button onClick={async()=>{for(const i of (book.chapters||[]).map((_,i)=>i).filter(i=>!(book.chapters?.[i]?.generated))){if(quotaHit)break;await genChapter(i);}}} disabled={busy||busyCh!==null||quotaHit||isBuilding} className="text-xs bg-purple-500/20 text-purple-300 border border-purple-500/30 px-3 py-1.5 rounded-lg hover:bg-purple-500/30 disabled:opacity-40">Write All</button>}</div><div className="space-y-1">{(book.chapters||[]).map((ch,i)=><button key={i} onClick={()=>setSelCh(i)} className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-all ${selCh===i?"bg-purple-500/20 text-white border border-purple-500/30":"text-white/50 hover:bg-white/5"}`}><span className={ch.generated?"text-green-400":""}>{ch.generated?"✓ ":""}</span>{ch.number}. {ch.title}</button>)}</div></div></div><div className="lg:col-span-2">{book.chapters?.[selCh]&&<Card><div className="flex items-start justify-between mb-5 gap-4"><div><h2 className="text-white text-lg font-bold">Ch. {book.chapters?.[selCh].number}: {book.chapters?.[selCh].title}</h2><p className="text-white/35 text-sm mt-1">{book.chapters?.[selCh].description}</p></div>{!isBuilding&&<div className="flex gap-2 shrink-0"><button onClick={()=>genChapterIllustration(selCh)} disabled={busyCh!==null||quotaHit||isBuilding||busy} className="bg-white/5 border border-white/10 text-white/60 px-3 py-2 rounded-xl font-medium text-sm hover:bg-white/10 disabled:opacity-40 flex items-center gap-1.5" title="Generate chapter illustration">🖼️</button><button onClick={()=>genChapter(selCh)} disabled={busyCh!==null||quotaHit||isBuilding} className="bg-gradient-to-r from-purple-500 to-pink-500 text-white px-4 py-2 rounded-xl font-medium text-sm hover:opacity-90 disabled:opacity-50 flex items-center gap-2">{busyCh===selCh?<><Spin size="h-4 w-4"/>Writing…</>:book.chapters?.[selCh].generated?"✍️ Rewrite":"✍️ Write"}</button></div>}</div>{book.chapters?.[selCh]?.illustration_url&&<div className="mb-4"><img src={book.chapters?.[selCh].illustration_url} alt={`Chapter ${book.chapters?.[selCh].number} illustration`} className="w-full rounded-xl max-h-48 object-cover border border-white/10"/><p className="text-white/20 text-xs mt-1 text-center italic">{book.chapters?.[selCh].illustration_prompt?.slice(0,80)}…</p></div>}{book.chapters?.[selCh].content?<ChapterEditor book={book} chIdx={selCh} upd={upd}/>:<div className="text-center py-16 text-white/25"><div className="text-4xl mb-3">✍️</div><p>{isBuilding?"Generating…":"Click Write to generate"}</p></div>}</Card>}</div></div>}

        {/* COVER */}
        {tab===2&&<div className="max-w-5xl mx-auto">{!getAuthorProfile().name&&<div className="bg-amber-500/15 border border-amber-500/40 rounded-xl p-4 mb-6 flex items-center gap-3"><span className="text-2xl">✍️</span><div className="flex-1"><p className="text-amber-300 font-semibold text-sm">No author name set</p><p className="text-amber-200/50 text-xs">Your cover will show "AUTHOR" as a placeholder until you add your name.</p></div><button onClick={onSettings} className="bg-amber-500 text-black text-xs font-bold px-4 py-2 rounded-lg hover:bg-amber-400 whitespace-nowrap">Set Name</button></div>}<div className="grid grid-cols-1 lg:grid-cols-2 gap-8"><div><h2 className="text-white text-xl font-bold mb-4">Cover Preview</h2>{book.cover_image_url?<><img src={book.cover_image_url} alt="Cover" className="w-full max-w-xs rounded-2xl shadow-2xl shadow-purple-900/60 mx-auto block"/><div className="flex gap-2 mt-4 justify-center"><button onClick={newVariation} disabled={busy||isBuilding} className="text-sm border border-white/20 text-white/50 px-4 py-2 rounded-lg hover:bg-white/5 disabled:opacity-40">🎲 Variation</button><a href={book.cover_image_url} download={`${(book.title||"cover").replace(/[^a-z0-9]/gi,"_")}_cover.jpg`} className="text-sm border border-white/20 text-white/50 px-4 py-2 rounded-lg hover:bg-white/5">⬇️ Download</a></div></>:<div className="w-full max-w-xs aspect-[2/3] bg-white/5 border-2 border-dashed border-white/15 rounded-2xl flex items-center justify-center mx-auto"><div className="text-center text-white/20">{isBuilding?<><Spin/><p className="text-sm mt-2">Generating…</p></>:<><div className="text-5xl mb-2">🎨</div><p className="text-sm">Cover appears here</p></>}</div></div>}</div><div className="space-y-5"><h2 className="text-white text-xl font-bold">Cover Settings</h2><div className="bg-white/5 border border-white/10 rounded-xl p-1 flex gap-1">{[["auto","✨ AI Auto"],["custom","✏️ Custom"]].map(([m,label])=><button key={m} onClick={()=>setCoverMode(m)} className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${coverMode===m?"bg-purple-500 text-white":"text-white/40 hover:text-white"}`}>{label}</button>)}</div>{coverMode==="auto"?<div className="bg-white/5 border border-white/10 rounded-xl p-4 text-sm text-white/50">Gemini analyzes your book and writes a detailed character-specific prompt.{lastAiPrompt&&<p className="text-white/25 text-xs mt-3 italic leading-relaxed">{lastAiPrompt}</p>}</div>:<div><label className="text-white/60 text-sm font-medium block mb-2">Describe your cover</label><div className="flex flex-wrap gap-1.5 mb-2">{[["🌅 Painterly","painterly digital art, warm golden light, cinematic depth"],["🎨 Watercolor","loose expressive watercolor illustration, soft edges, artistic"],["📸 Photorealistic","hyperrealistic photography, studio lighting, cinematic"],["🖤 Dark Ink","dark ink graphic novel style, high contrast, moody shadows"],["✨ Fantasy","epic fantasy concept art, magical atmosphere, dramatic lighting, ArtStation"],["💫 Minimalist","clean minimalist design, bold typography space, subtle gradient background, modern"],["🌃 Neon Noir","cyberpunk neon noir, rain-slicked streets, atmospheric fog"],["🌸 Soft Romance","soft romantic illustration, warm pastels, bokeh background, dreamy"]].map(([label,tag])=><button key={label} onClick={()=>setCustomPrompt(p=>(p?p+", ":"")+tag)} className="text-xs bg-white/5 border border-white/10 text-white/50 hover:text-white/80 hover:border-purple-500/40 px-2.5 py-1.5 rounded-lg transition-all">{label}</button>)}</div><textarea rows={6} value={customPrompt} onChange={e=>setCustomPrompt(e.target.value)} placeholder="E.g. Two men in their 20s, dark curly hair and red hair, standing close on a rainy rooftop at dusk, golden light, painterly cinematic style, no text..." className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white placeholder-white/20 focus:outline-none focus:border-purple-500 resize-none text-sm"/><p className="text-white/20 text-xs mt-1.5">💡 Click style chips to append — or type freely. Always generates no-text portrait covers.</p></div>}<button onClick={genCover} disabled={busy||quotaHit||isBuilding||(coverMode==="custom"&&!customPrompt.trim())} className="w-full bg-gradient-to-r from-purple-500 to-pink-500 text-white py-4 rounded-xl font-semibold text-lg hover:opacity-90 disabled:opacity-40 flex items-center justify-center gap-2">{busy?<><Spin/>Generating…</>:book.cover_image_url?"🔄 Regenerate":"🎨 Generate Cover"}</button></div></div></div>}

        {/* SEO */}
        {tab===3&&<div className="max-w-3xl mx-auto"><Card><div className="flex items-center justify-between mb-6"><div><h2 className="text-white text-xl font-bold">SEO Optimization</h2><p className="text-white/40 text-sm mt-1">Amazon KDP & publishing metadata</p></div>{!isBuilding&&<button onClick={genSEO} disabled={busy||quotaHit||isBuilding} className="bg-gradient-to-r from-purple-500 to-pink-500 text-white px-5 py-2.5 rounded-xl font-semibold hover:opacity-90 disabled:opacity-50 flex items-center gap-2">{busy?<><Spin size="h-4 w-4"/>Generating…</>:"🔍 Generate SEO"}</button>}</div><div className="space-y-5">{[{label:"SEO Title",val:book.seo_title},{label:"SEO Description",val:book.seo_description,large:true},{label:"Keywords",val:book.seo_keywords}].map(f=><div key={f.label}><div className="flex items-center justify-between mb-2"><p className="text-white/40 text-xs uppercase tracking-wider">{f.label}</p>{f.val&&<button onClick={()=>{navigator.clipboard.writeText(f.val);flash("Copied! 📋");}} className="text-xs text-white/30 hover:text-white/60 transition-colors">📋 Copy</button>}</div>{f.val?<div className={`bg-white/10 rounded-xl p-4 text-white/80 text-sm ${f.large?"leading-relaxed":""}`}>{f.val}</div>:<div className="bg-white/5 border border-dashed border-white/10 rounded-xl p-4 text-white/20 text-sm italic">{isBuilding?"Generating…":"Auto-populated during build"}</div>}</div>)}{book.notes&&(()=>{try{const n=JSON.parse(book.notes);return(<div className="space-y-5">{n.back_cover_copy&&<div><p className="text-white/40 text-xs uppercase tracking-wider mb-2">Back Cover Copy</p><div className="bg-white/10 rounded-xl p-4 text-white/80 text-sm leading-relaxed">{n.back_cover_copy}</div></div>}{n.bisac_categories?.length>0&&<div><p className="text-white/40 text-xs uppercase tracking-wider mb-2">BISAC Categories (KDP)</p><div className="flex flex-wrap gap-2">{n.bisac_categories.map((c,i)=><span key={i} className="bg-blue-500/20 text-blue-300 border border-blue-500/30 px-3 py-1 rounded-full text-xs">{c}</span>)}</div></div>}{n.backend_keywords&&<div><div className="flex items-center justify-between mb-2"><p className="text-white/40 text-xs uppercase tracking-wider">Amazon Backend Keywords</p><button onClick={()=>{navigator.clipboard.writeText(n.backend_keywords);flash("Copied! 📋");}} className="text-xs text-white/30 hover:text-white/60">📋 Copy</button></div><div className="bg-white/10 rounded-xl p-4 text-white/80 text-sm font-mono">{n.backend_keywords}</div><p className="text-white/20 text-xs mt-1">Paste into KDP "Keywords" field 8 — these are invisible to readers but boost search rank.</p></div>}{n.comp_titles?.length>0&&<div><p className="text-white/40 text-xs uppercase tracking-wider mb-2">Comparable Titles (Comps)</p><div className="bg-white/10 rounded-xl p-4 space-y-1">{n.comp_titles.map((t,i)=><p key={i} className="text-white/70 text-sm">📚 {t}</p>)}</div><p className="text-white/20 text-xs mt-1">Use comps in your KDP description and marketing: "Fans of [Comp] will love this."</p></div>}{n.recommended_price_usd&&<div className="bg-green-500/10 border border-green-500/20 rounded-xl p-4"><div className="flex items-center justify-between"><div><p className="text-white/40 text-xs uppercase tracking-wider mb-1">Recommended Price</p><p className="text-green-300 text-2xl font-bold">${n.recommended_price_usd}</p><p className="text-white/40 text-xs mt-1">{n.price_rationale}</p></div><div className="text-right text-xs text-white/30"><p>Royalty @ 70%</p><p className="text-green-400 font-bold text-base">${(n.recommended_price_usd*0.70-0.15).toFixed(2)}/sale</p><p className="text-white/20">KDP direct (US)</p></div></div></div>}{n.hook_line&&<div><p className="text-white/40 text-xs uppercase tracking-wider mb-2">Marketing Hook Line</p><div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4"><p className="text-amber-200 text-sm italic">"{n.hook_line}"</p></div><p className="text-white/20 text-xs mt-1">Use this in social media posts, email subject lines, and Amazon ads.</p></div>}</div>);}catch{return null;}})()}{/* Title A/B Testing */}<div className="mt-6 pt-6 border-t border-white/10"><div className="flex items-center justify-between mb-4"><div><h3 className="text-white font-bold text-sm">Title A/B Testing</h3><p className="text-white/35 text-xs mt-0.5">Generate alternative titles to find your bestseller hook</p></div><button onClick={genAltTitles} disabled={busy||quotaHit||isBuilding} className="text-xs bg-purple-500/20 text-purple-300 border border-purple-500/30 px-3 py-1.5 rounded-lg hover:bg-purple-500/30 disabled:opacity-40 flex items-center gap-1">{busy?<><Spin size="h-3 w-3"/>Generating…</>:"📝 Generate 5 Titles"}</button></div>{altTitles.length>0&&<div className="space-y-3">{altTitles.map((t,i)=><div key={i} className="bg-white/5 border border-white/10 rounded-xl p-4"><div className="flex items-start justify-between gap-3"><div className="flex-1"><p className="text-white font-semibold text-sm">{t.title}</p>{t.subtitle&&<p className="text-white/50 text-xs mt-0.5 italic">{t.subtitle}</p>}<p className="text-white/30 text-xs mt-2">💡 {t.rationale}</p></div><button onClick={()=>upd({title:t.title,subtitle:t.subtitle||book.subtitle})} className="text-xs bg-green-500/20 text-green-300 border border-green-500/30 px-2 py-1 rounded-lg hover:bg-green-500/30 shrink-0">Use This</button></div></div>)}</div>}</div></div></Card></div>}

        {/* REVIEW */}
        {tab===4&&<ReviewPanel book={book} onSettings={onSettings} onApply={(updates)=>{const b=upd(updates);flash("Applied! Re-run review to update score.");return b;}}/>}

        {/* MARKET */}
        {tab===5&&<div className="max-w-3xl mx-auto"><CompetitorPanel book={book} onSettings={onSettings}/></div>}

        {/* HOOKS */}
        {tab===6&&<div className="max-w-3xl mx-auto"><HookPanel book={book} onSettings={onSettings}/></div>}

        {/* QUALITY */}
        {tab===7&&<div className="max-w-3xl mx-auto"><ChapterQualityPanel book={book} onSettings={onSettings}/></div>}

        {/* WRITING QUALITY */}
        {tab===8&&<WritingQualityPanel book={book} onSettings={onSettings} onApply={(updates)=>{const b=upd(updates);return b;}}/>}

        {/* PUBLISH */}
        {tab===9&&<CharactersPanel book={book} onSettings={onSettings}/>}

        {tab===10&&<div className="max-w-3xl mx-auto space-y-5">
          {/* Gate 1: Review Agent */}
          {!book.review?<div className="bg-amber-500/15 border border-amber-500/40 rounded-2xl p-6 text-center"><div className="text-4xl mb-3">🤖</div><h3 className="text-amber-300 font-bold text-lg mb-2">Review Agent Required</h3><p className="text-amber-200/60 text-sm mb-5">The Review Agent must score 70+ before you can publish.</p><button onClick={()=>setTab(4)} className="bg-gradient-to-r from-amber-500 to-orange-500 text-black font-bold px-8 py-3 rounded-xl hover:opacity-90">Run Review Agent →</button></div>
          :!reviewPassed?<div className="bg-red-500/15 border border-red-500/40 rounded-2xl p-6 text-center"><div className="text-4xl mb-3">❌</div><h3 className="text-red-300 font-bold text-lg mb-2">Review Score Too Low ({reviewScore}/100)</h3><p className="text-red-200/60 text-sm mb-5">Needs 70+. Apply improvements in the Review tab then re-run.</p><button onClick={()=>setTab(4)} className="bg-gradient-to-r from-red-500 to-pink-500 text-white font-bold px-8 py-3 rounded-xl hover:opacity-90">View Review Suggestions →</button></div>
          :<div className="bg-green-500/10 border border-green-500/30 rounded-2xl p-4 flex items-center gap-3"><span className="text-2xl">✅</span><div><p className="text-green-300 font-bold text-sm">Review Passed — {reviewScore}/100</p></div></div>}
          {/* Gate 2: Writing Quality */}
          {reviewPassed&&(!book.manuscript_quality?<div className="bg-amber-500/15 border border-amber-500/40 rounded-2xl p-6 text-center"><div className="text-4xl mb-3">✍️</div><h3 className="text-amber-300 font-bold text-lg mb-2">Writing Quality Check Required</h3><p className="text-amber-200/60 text-sm mb-5">Run the Writing Quality Agent to verify your manuscript reads like a human author, not AI. Required before publishing.</p><button onClick={()=>setTab(8)} className="bg-gradient-to-r from-purple-500 to-pink-500 text-white font-bold px-8 py-3 rounded-xl hover:opacity-90">Run Writing Quality Check →</button></div>
          :!writingPassed?<div className="bg-red-500/15 border border-red-500/40 rounded-2xl p-6 text-center"><div className="text-4xl mb-3">🤖</div><h3 className="text-red-300 font-bold text-lg mb-2">AI Writing Patterns Detected ({writingScore}/100)</h3><p className="text-red-200/60 text-sm mb-5">Your manuscript has AI tells that need to be addressed. Apply the chapter rewrites suggested in the Writing Quality tab, then re-run chapters and re-analyze.</p><button onClick={()=>setTab(8)} className="bg-gradient-to-r from-red-500 to-pink-500 text-white font-bold px-8 py-3 rounded-xl hover:opacity-90">View Writing Issues →</button></div>
          :<div className="bg-green-500/10 border border-green-500/30 rounded-2xl p-4 flex items-center gap-3"><span className="text-2xl">✅</span><div><p className="text-green-300 font-bold text-sm">Writing Quality Passed — {writingScore}/100 human</p></div></div>)}
          {reviewPassed&&writingPassed&&<Card><h2 className="text-white text-xl font-bold mb-2">Publish Your Book</h2><p className="text-white/40 mb-6 text-sm">Your book includes the series read-order page (if hooks were generated).</p>
            <div className="space-y-3 mb-8">
              <BookStatsBar book={book}/>{[{label:"Chapters written",done:book.chapters?.some(c=>c.content)},{label:"Cover generated",done:!!book.cover_image_url},{label:"SEO ready",done:!!book.seo_title},{label:"Review Agent passed (70+)",done:reviewPassed},{label:"Writing Quality passed (72+)",done:writingPassed},{label:"Market analysis done",done:!!book.competitor_analysis},{label:"Hooks & blurbs generated",done:!!book.hooks},{label:"Characters documented",done:(getCharacters(bookId)||[]).length>0}].map((item,i)=><div key={i} className={`flex items-center gap-3 px-4 py-3 rounded-lg ${item.done?"bg-green-500/10":"bg-white/5"}`}><span>{item.done?"✅":"⭕"}</span><span className={`text-sm ${item.done?"text-white":"text-white/35"}`}>{item.label}</span></div>)}
            </div>
            <p className="text-white/50 text-sm font-semibold mb-3">Export Formats</p>
            <div className="grid grid-cols-2 gap-3">
              <button onClick={()=>download("md")} className="bg-gradient-to-r from-purple-500 to-pink-500 text-white py-3 rounded-xl font-semibold hover:opacity-90 flex items-center justify-center gap-2 text-sm">📝 Markdown (.md)</button>
              <button onClick={()=>download("epub")} className="bg-gradient-to-r from-blue-500 to-cyan-500 text-white py-3 rounded-xl font-semibold hover:opacity-90 flex items-center justify-center gap-2 text-sm">📖 EPUB-ready (.html)</button>
              <button onClick={()=>download("txt")} className="bg-white/10 border border-white/20 text-white py-3 rounded-xl font-semibold hover:bg-white/15 flex items-center justify-center gap-2 text-sm">📄 Plain Text (.txt)</button>
              <button onClick={()=>download("rtf")} className="bg-gradient-to-r from-orange-500 to-amber-500 text-white py-3 rounded-xl font-semibold hover:opacity-90 flex items-center justify-center gap-2 text-sm">📋 Word Doc (.rtf)</button>
              <button onClick={()=>download("audio")} className="bg-gradient-to-r from-green-500 to-emerald-500 text-white py-3 rounded-xl font-semibold hover:opacity-90 flex items-center justify-center gap-2 text-sm">🎙️ Audiobook Script</button>
              <button onClick={()=>{const ch=book.chapters?.find(c=>c.content);if(!ch){alert("Write a chapter first.");return;}const u=window.speechSynthesis;if(u.speaking){u.cancel();flash("⏹ Stopped");return;}const utt=new SpeechSynthesisUtterance(ch.content.replace(/[#*_`]/g,"").slice(0,2000));utt.rate=0.92;utt.pitch=1.0;const voices=u.getVoices();const eng=voices.find(v=>v.lang.startsWith("en")&&!v.name.includes("Google"));if(eng)utt.voice=eng;u.speak(utt);flash("🔊 Reading Ch.1 preview — click again to stop");}} className="bg-white/5 border border-white/10 text-white/60 py-3 rounded-xl font-semibold hover:bg-white/10 flex items-center justify-center gap-2 text-sm">🔊 Listen Preview</button>
            </div>
            <div className="mt-4 bg-blue-500/10 border border-blue-500/20 rounded-xl p-4 text-xs text-white/50 space-y-2">
              <p className="text-white/70 font-semibold text-sm">📖 Where to publish your .epub</p>
              <div className="grid grid-cols-2 gap-2 mt-2">
                <div className="bg-white/5 rounded-lg p-2.5"><p className="text-white/60 font-semibold">Amazon KDP</p><p className="text-white/30">Upload .epub directly. Reaches millions. Royalties 35-70%.</p></div>
                <div className="bg-white/5 rounded-lg p-2.5"><p className="text-white/60 font-semibold">Smashwords</p><p className="text-white/30">Free. Distributes to Apple Books, Barnes &amp; Noble, Kobo, libraries.</p></div>
                <div className="bg-white/5 rounded-lg p-2.5"><p className="text-white/60 font-semibold">Draft2Digital</p><p className="text-white/30">Free. Uploads to 12+ stores in one click. Best aggregator.</p></div>
                <div className="bg-white/5 rounded-lg p-2.5"><p className="text-white/60 font-semibold">Payhip / Gumroad</p><p className="text-white/30">Sell directly. Keep ~97% of revenue. No approval needed.</p></div>
                <div className="bg-white/5 rounded-lg p-2.5"><p className="text-white/60 font-semibold">Leanpub</p><p className="text-white/30">Great for nonfiction &amp; guides. Readers pay what they want.</p></div>
                <div className="bg-white/5 rounded-lg p-2.5"><p className="text-white/60 font-semibold">Wattpad / Royal Road</p><p className="text-white/30">Upload as chapters for free fiction audiences. Build a following.</p></div>
              </div>
              <p className="text-white/25 mt-2">📋 RTF = best for Word/Docs editing before publish · TXT = plain archive · Audiobook script = hand to narrator or use Audio Studio tab</p>
            </div>
          </Card>}
          <div className="grid grid-cols-3 gap-4">
            {[{name:"Amazon KDP",url:"https://kdp.amazon.com",icon:"📦",color:"border-orange-500/30 bg-orange-500/10"},{name:"Smashwords",url:"https://www.smashwords.com",icon:"📚",color:"border-blue-500/30 bg-blue-500/10"},{name:"Draft2Digital",url:"https://draft2digital.com",icon:"🌐",color:"border-green-500/30 bg-green-500/10"}].map(p=><a key={p.name} href={p.url} target="_blank" rel="noopener noreferrer" className={`border ${p.color} rounded-xl p-4 text-center hover:opacity-80`}><div className="text-2xl mb-2">{p.icon}</div><p className="text-white font-semibold text-sm">{p.name}</p><p className="text-white/30 text-xs mt-1">Open →</p></a>)}
          </div>
        </div>}
        {tab===11&&<TranslatePanel book={book} upd={upd} quotaHit={quotaHit} bump={bump} handleErr={handleErr} flash={flash}/>}
        {tab===12&&<AudioStudioPanel book={book} bookId={bookId} onSettings={onSettings} flash={flash}/>}
      

        {/* AMAZON KDP PACKAGE */}
        {tab===13&&<KDPPackagePanel book={book} busy={busy} busyStep={busyStep} onGenerate={genKDPPackage} quotaHit={quotaHit} flash={flash} isBuilding={isBuilding}/>}
        </div>
    </div>
  );
}



// ══════════════════════════════════════════════════════════════════════════════
// 📦 AMAZON KDP PACKAGE PANEL
// Full Amazon product page generator — books & audiobooks
// ══════════════════════════════════════════════════════════════════════════════

function KDPCopyBtn({text,label="📋 Copy"}){
  const [copied,setCopied]=useState(false);
  return(
    <button onClick={()=>{navigator.clipboard.writeText(text).then(()=>{setCopied(true);setTimeout(()=>setCopied(false),2000);});}} className="text-xs text-white/30 hover:text-white/60 transition-colors px-2 py-0.5 rounded border border-white/10 hover:border-white/30">
      {copied?"✅ Copied":label}
    </button>
  );
}

function KDPField({label,value,large=false,html=false,mono=false,badge=null}){
  if(!value)return null;
  const displayValue=Array.isArray(value)?value.join("\n"):value;
  return(
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <p className="text-white/40 text-xs uppercase tracking-wider font-semibold">{label}{badge&&<span className="ml-2 text-xs bg-purple-500/20 text-purple-300 border border-purple-500/30 px-2 py-0.5 rounded-full normal-case">{badge}</span>}</p>
        <KDPCopyBtn text={displayValue}/>
      </div>
      {html
        ?<div className="bg-white/10 rounded-xl p-4 text-white/80 text-sm leading-relaxed" dangerouslySetInnerHTML={{__html:value}}/>
        :<div className={`bg-white/10 rounded-xl p-4 text-white/80 text-sm ${large?"leading-relaxed whitespace-pre-wrap":""}${mono?" font-mono":""}`}>{displayValue}</div>
      }
    </div>
  );
}

function KDPBadgeList({label,items}){
  if(!items||items.length===0)return null;
  return(
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <p className="text-white/40 text-xs uppercase tracking-wider font-semibold">{label}</p>
        <KDPCopyBtn text={items.join(", ")}/>
      </div>
      <div className="flex flex-wrap gap-2">
        {items.map((item,i)=>(
          <span key={i} className="bg-blue-500/15 text-blue-300 border border-blue-500/25 px-3 py-1 rounded-full text-xs">{item}</span>
        ))}
      </div>
    </div>
  );
}

function KDPPackagePanel({book,busy,busyStep,onGenerate,quotaHit,flash,isBuilding}){
  const [kdp,setKdp]=useState(null);
  const [showACX,setShowACX]=useState(false);
  const [thumbLoaded,setThumbLoaded]=useState(false);

  useEffect(()=>{
    if(book?.kdp_package){
      try{setKdp(JSON.parse(book.kdp_package));}catch(e){setKdp(null);}
    }
  },[book?.kdp_package]);

  const isAudio=book?.format==="audiobook"||!!(book?.audio_url)||!!(book?.audio_script);
  const hasPackage=!!kdp;

  // Character count helpers for KDP limits
  const titleChars=(kdp?.kdp_title||"").length;
  const subtitleChars=(kdp?.kdp_subtitle||"").length;
  const descChars=(kdp?.kdp_description_html||"").replace(/<[^>]+>/g,"").length;
  const keywordsValid=(kdp?.kdp_7_keywords||[]).filter(k=>k.length<=50).length;

  return(
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-white text-2xl font-bold">📦 Amazon KDP Package</h2>
          <p className="text-white/40 text-sm mt-1">Complete product page for Amazon KDP — books & audiobooks</p>
        </div>
        <button
          onClick={onGenerate}
          disabled={busy||quotaHit||isBuilding}
          className="bg-gradient-to-r from-orange-500 to-amber-500 text-black px-5 py-2.5 rounded-xl font-bold hover:opacity-90 disabled:opacity-40 flex items-center gap-2 shrink-0 text-sm"
        >
          {busy?<><Spin size="h-4 w-4"/>{busyStep||"Generating…"}</>:(hasPackage?"🔄 Regenerate":"🚀 Generate KDP Package")}
        </button>
      </div>

      {/* Quota warning */}
      {quotaHit&&<div className="bg-amber-500/15 border border-amber-500/30 rounded-xl p-4 text-amber-300 text-sm">⚠️ Daily quota reached — generation paused. Resets at midnight Pacific.</div>}

      {/* Empty state */}
      {!hasPackage&&!busy&&(
        <div className="bg-white/5 border border-white/10 rounded-2xl p-10 text-center">
          <div className="text-6xl mb-4">📦</div>
          <h3 className="text-white text-lg font-bold mb-2">Generate Your Amazon KDP Package</h3>
          <p className="text-white/40 text-sm max-w-md mx-auto mb-6 leading-relaxed">
            AI generates every field for your Amazon product page — keyword-rich title, HTML description, 7 backend keywords, BISAC categories, author bio, A+ content, editorial review, thumbnail prompt, and AI-search optimization.
            {isAudio&&" Includes full ACX/Audible package too."}
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs text-white/30 mb-6">
            {[["📝","KDP Title & Subtitle"],["🏷️","7 Backend Keywords"],["📚","BISAC Categories"],["💰","Pricing Strategy"],["📖","HTML Description"],["👤","Author Bio"],["⭐","Editorial Review"],["🔍","A+ Content"],["🤖","AI Search Keywords"],["🖼️","KDP Thumbnail"],isAudio&&["🎧","ACX Package"],["🔎","Look Inside Hook"]].filter(Boolean).map(([icon,label],i)=>(
              <div key={i} className="bg-white/5 rounded-lg p-2.5 text-center">
                <div className="text-xl mb-1">{icon}</div>
                <p>{label}</p>
              </div>
            ))}
          </div>
          <button onClick={onGenerate} disabled={busy||quotaHit||isBuilding} className="bg-gradient-to-r from-orange-500 to-amber-500 text-black font-bold px-8 py-3 rounded-xl hover:opacity-90 disabled:opacity-40">
            🚀 Generate KDP Package (~3 API calls)
          </button>
        </div>
      )}

      {/* Loading state */}
      {busy&&(
        <div className="bg-white/5 border border-white/10 rounded-2xl p-8 text-center">
          <Spin size="h-8 w-8"/>
          <p className="text-white/60 mt-4 text-sm">{busyStep||"Generating…"}</p>
          <p className="text-white/20 text-xs mt-2">Takes ~30 seconds — building all KDP fields</p>
        </div>
      )}

      {/* KDP Package Results */}
      {hasPackage&&!busy&&(
        <div className="space-y-6">

          {/* Compliance checklist */}
          <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
            <h3 className="text-white font-bold mb-3 text-sm uppercase tracking-wider">📋 KDP Compliance Check</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
              {[
                {label:"Title length",ok:titleChars>0&&titleChars<=200,val:`${titleChars}/200 chars`},
                {label:"Subtitle length",ok:subtitleChars>0&&subtitleChars<=200,val:`${subtitleChars}/200 chars`},
                {label:"Description length",ok:descChars>=2000&&descChars<=4000,val:`${descChars} chars`},
                {label:"7 Keywords ≤50 chars",ok:keywordsValid===7,val:`${keywordsValid}/7 valid`},
                {label:"BISAC Category 1",ok:!!(kdp.kdp_bisac_1),val:kdp.kdp_bisac_1?"✅ Set":"Missing"},
                {label:"BISAC Category 2",ok:!!(kdp.kdp_bisac_2),val:kdp.kdp_bisac_2?"✅ Set":"Missing"},
                {label:"Author Bio",ok:!!(kdp.kdp_author_bio),val:kdp.kdp_author_bio?"✅ Ready":"Missing"},
                {label:"AI Disclosure",ok:!!(kdp.kdp_ai_disclosure),val:kdp.kdp_ai_disclosure?"✅ Ready":"Missing"},
              ].map((item,i)=>(
                <div key={i} className={`rounded-lg p-2.5 border ${item.ok?"bg-green-500/10 border-green-500/20":"bg-amber-500/10 border-amber-500/20"}`}>
                  <p className={`font-semibold ${item.ok?"text-green-300":"text-amber-300"}`}>{item.ok?"✅":"⚠️"} {item.label}</p>
                  <p className="text-white/40 mt-0.5">{item.val}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Thumbnail */}
          <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-white font-bold">🖼️ KDP Thumbnail</h3>
              <div className="flex gap-2">
                <span className="text-xs text-white/30 bg-white/5 px-2 py-1 rounded">1400×2100px (KDP min)</span>
                {kdp.thumbUrl&&<a href={kdp.thumbUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-white/50 hover:text-white bg-white/5 border border-white/10 px-3 py-1 rounded-lg hover:bg-white/10">⬇️ Download</a>}
              </div>
            </div>
            <div className="flex gap-6 items-start">
              {kdp.thumbUrl?(
                <div className="shrink-0">
                  <img
                    src={kdp.thumbUrl}
                    alt="KDP Thumbnail"
                    className="w-28 rounded-xl shadow-xl shadow-purple-900/60 border border-white/10"
                    onLoad={()=>setThumbLoaded(true)}
                    onError={e=>{e.target.style.display="none";}}
                  />
                  {!thumbLoaded&&<div className="w-28 h-40 bg-white/5 rounded-xl flex items-center justify-center text-white/20 text-xs">Loading…</div>}
                </div>
              ):<div className="w-28 h-40 bg-white/5 border border-dashed border-white/10 rounded-xl flex items-center justify-center text-white/20 text-xs text-center p-2">No thumbnail yet</div>}
              <div className="flex-1 space-y-3">
                <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-3">
                  <p className="text-blue-300 text-xs font-semibold mb-1">📐 KDP Cover Specs</p>
                  <ul className="text-white/40 text-xs space-y-1">
                    <li>• Minimum: 1000×625px, ideal: 2560×1600px</li>
                    <li>• KDP eBook: 1400×2100px portrait (2:3 ratio)</li>
                    <li>• Print cover: calculated by KDP Cover Creator</li>
                    <li>• Format: JPEG or TIFF, ≤50MB, RGB color</li>
                  </ul>
                </div>
                <div>
                  <p className="text-white/40 text-xs font-semibold mb-1">AI Prompt Used:</p>
                  <p className="text-white/30 text-xs leading-relaxed italic">{(kdp.coverPrompt||"").slice(0,200)}…</p>
                </div>
              </div>
            </div>
          </div>

          {/* Core KDP Fields */}
          <div className="bg-white/5 border border-white/10 rounded-2xl p-5 space-y-5">
            <h3 className="text-white font-bold">📝 KDP Title & Metadata</h3>
            <KDPField label="KDP Title" value={kdp.kdp_title} badge={`${titleChars} chars`}/>
            <KDPField label="KDP Subtitle" value={kdp.kdp_subtitle} badge={`${subtitleChars} chars`}/>
            <div className="grid grid-cols-2 gap-4">
              <KDPField label="BISAC Category 1" value={kdp.kdp_bisac_1}/>
              <KDPField label="BISAC Category 2" value={kdp.kdp_bisac_2}/>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <KDPField label="Suggested Price" value={`$${kdp.kdp_price_usd||4.99}`}/>
              <KDPField label="Series / Volume" value={kdp.kdp_series_info}/>
            </div>
            <KDPField label="Price Rationale" value={kdp.kdp_price_rationale}/>
            <KDPField label="Territorial Rights" value={kdp.kdp_territorial_rights}/>
            <KDPField label="AI Disclosure (KDP Required)" value={kdp.kdp_ai_disclosure}/>
          </div>

          {/* Amazon Description HTML */}
          <div className="bg-white/5 border border-white/10 rounded-2xl p-5 space-y-4">
            <h3 className="text-white font-bold">📖 Amazon Description (HTML)</h3>
            <p className="text-white/30 text-xs">Paste directly into KDP's Book Description field — Amazon renders the HTML tags.</p>
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-white/40 text-xs uppercase tracking-wider">Raw HTML (paste into KDP)</p>
                <KDPCopyBtn text={kdp.kdp_description_html||""} label="📋 Copy HTML"/>
              </div>
              <textarea
                readOnly
                value={kdp.kdp_description_html||""}
                className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white/70 text-xs font-mono h-32 resize-none"
              />
            </div>
            <div>
              <p className="text-white/40 text-xs uppercase tracking-wider mb-2">Preview (how it renders)</p>
              <div className="bg-white rounded-xl p-5 text-gray-800 text-sm leading-relaxed amazon-preview" dangerouslySetInnerHTML={{__html:kdp.kdp_description_html||""}}/>
            </div>
            <p className="text-white/20 text-xs">Description length: {descChars} chars (KDP allows up to 4000)</p>
          </div>

          {/* 7 Backend Keywords */}
          <div className="bg-white/5 border border-white/10 rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-white font-bold">🏷️ 7 Backend Keywords</h3>
              <KDPCopyBtn text={(kdp.kdp_7_keywords||[]).join("\n")} label="📋 Copy All"/>
            </div>
            <p className="text-white/30 text-xs">Paste one per line into KDP's Keywords fields. Each must be ≤50 chars. Never repeat words from your title.</p>
            <div className="space-y-2">
              {(kdp.kdp_7_keywords||[]).map((kw,i)=>(
                <div key={i} className="flex items-center gap-3">
                  <span className={`text-xs font-bold w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${kw.length<=50?"bg-green-500/20 text-green-400":"bg-red-500/20 text-red-400"}`}>{i+1}</span>
                  <div className="flex-1 bg-white/10 rounded-lg px-3 py-2 text-white/80 text-sm font-mono">{kw}</div>
                  <span className={`text-xs ${kw.length<=50?"text-white/30":"text-red-400"}`}>{kw.length}/50</span>
                  <KDPCopyBtn text={kw}/>
                </div>
              ))}
            </div>
          </div>

          {/* AI Search Keywords */}
          <div className="bg-white/5 border border-white/10 rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-white font-bold">🤖 AI Search Keywords</h3>
              <KDPCopyBtn text={(kdp.ai_search_keywords||[]).join("\n")} label="📋 Copy All"/>
            </div>
            <p className="text-white/30 text-xs">Optimized for discovery via AI engines (ChatGPT, Perplexity, Claude). Use in your website meta tags, social bios, and Amazon Author Central.</p>
            <KDPBadgeList label="" items={kdp.ai_search_keywords}/>
          </div>

          {/* Author Bio + Editorial Review */}
          <div className="bg-white/5 border border-white/10 rounded-2xl p-5 space-y-5">
            <h3 className="text-white font-bold">👤 Author & Press Content</h3>
            <KDPField label="Amazon Author Bio (Author Central)" value={kdp.kdp_author_bio} large/>
            <KDPField label="Editorial Review (Amazon Listing)" value={kdp.kdp_editorial_review} large/>
          </div>

          {/* A+ Content */}
          <div className="bg-white/5 border border-white/10 rounded-2xl p-5 space-y-5">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-white font-bold">⭐ Amazon A+ Content</h3>
                <p className="text-white/30 text-xs mt-1">Available after first sale. Add in KDP → A+ Content Manager. Boosts conversion by up to 10%.</p>
              </div>
            </div>
            <KDPField label="A+ Headline" value={kdp.kdp_a_plus_headline}/>
            <KDPField label="A+ Body Copy" value={kdp.kdp_a_plus_body} large/>
          </div>

          {/* Look Inside Hook */}
          <div className="bg-white/5 border border-white/10 rounded-2xl p-5 space-y-4">
            <h3 className="text-white font-bold">🔎 Look Inside Hook</h3>
            <p className="text-white/30 text-xs">Amazon shows the first 10% of your book free. This optimized excerpt is written to hook readers in the first 200 words and drive purchase.</p>
            <KDPField label="Opening Hook" value={kdp.kdp_look_inside_hook} large/>
          </div>

          {/* ACX / Audiobook Section */}
          {(kdp.acx_title||isAudio)&&(
            <div className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden">
              <button
                onClick={()=>setShowACX(p=>!p)}
                className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-white/5 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <span className="text-xl">🎧</span>
                  <div>
                    <h3 className="text-white font-bold">ACX / Audible Package</h3>
                    <p className="text-white/30 text-xs">{kdp.acx_title?"Ready":"Click to expand"}</p>
                  </div>
                </div>
                <span className="text-white/30">{showACX?"▲":"▼"}</span>
              </button>
              {showACX&&(
                <div className="px-5 pb-5 space-y-5 border-t border-white/10 pt-5">
                  {kdp.acx_title?(
                    <>
                      <KDPField label="ACX Title" value={kdp.acx_title}/>
                      <KDPField label="ACX Subtitle" value={kdp.acx_subtitle}/>
                      <KDPField label="ACX Description (Audible)" value={kdp.acx_description} large/>
                      <KDPBadgeList label="ACX Keywords" items={kdp.acx_keywords}/>
                      <div className="grid grid-cols-2 gap-4">
                        <KDPField label="Primary Category" value={kdp.acx_categories?.[0]}/>
                        <KDPField label="Secondary Category" value={kdp.acx_categories?.[1]}/>
                      </div>
                      <KDPField label="Narrator Direction" value={kdp.acx_narrator_direction} large/>
                      <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-4">
                        <p className="text-blue-300 text-xs font-semibold mb-2">📐 ACX/Audible Cover Specs</p>
                        <ul className="text-white/40 text-xs space-y-1">
                          <li>• Required: 3000×3000px SQUARE (1:1 ratio)</li>
                          <li>• Format: JPEG or PNG, RGB, ≤5MB</li>
                          <li>• Must include title and author name visibly</li>
                          <li>• No borders, no white space around edges</li>
                        </ul>
                      </div>
                    </>
                  ):(
                    <div className="text-center py-6">
                      <p className="text-white/40 text-sm">Re-run the KDP generator — ACX package is auto-included when an audiobook is detected.</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Quick guide */}
          <div className="bg-gradient-to-br from-orange-500/10 to-amber-500/10 border border-orange-500/20 rounded-2xl p-5">
            <h3 className="text-orange-300 font-bold mb-3">📋 KDP Upload Checklist</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs text-white/50">
              {[
                "1. Download your .epub from the Publish tab",
                "2. Paste KDP Title & Subtitle into manuscript title fields",
                "3. Copy the HTML Description into KDP's description box",
                "4. Enter the 7 keywords one per field",
                "5. Select both BISAC categories",
                "6. Upload your KDP thumbnail (download above)",
                "7. Set your price using the strategy above",
                "8. Add AI disclosure in the Content Disclosure section",
                "9. After approval, add Author Bio to Author Central",
                "10. Once live, add A+ Content for conversion boost",
              ].map((step,i)=>(
                <div key={i} className="flex items-start gap-2"><span className="text-orange-400/60 shrink-0">◦</span>{step}</div>
              ))}
            </div>
          </div>

          {/* Regenerated timestamp */}
          {kdp.generated_at&&<p className="text-white/15 text-xs text-center">Generated {new Date(kdp.generated_at).toLocaleString()}</p>}
        </div>
      )}
    </div>
  );
}


// ══════════════════════════════════════════════════════════════════════════════
// 🎙️ AUDIO STUDIO — Powered by Kokoro TTS (82M param ONNX model, runs in browser)
// Model: onnx-community/Kokoro-82M-v1.0-ONNX | License: Apache 2.0
// Quality: comparable to commercial TTS, 27 voices, 100% free, no API key
// First load: ~82MB download, cached in browser IndexedDB afterwards
// ══════════════════════════════════════════════════════════════════════════════
const KOKORO_VOICES = [
  {id:"af_heart",label:"Heart ❤️",gender:"F",accent:"American"},
  {id:"af_bella",label:"Bella 🔥",gender:"F",accent:"American"},
  {id:"am_michael",label:"Michael",gender:"M",accent:"American"},
  {id:"am_fenrir",label:"Fenrir",gender:"M",accent:"American"},
  {id:"am_puck",label:"Puck",gender:"M",accent:"American"},
  {id:"af_nicole",label:"Nicole 🎧",gender:"F",accent:"American"},
  {id:"af_aoede",label:"Aoede",gender:"F",accent:"American"},
  {id:"af_sarah",label:"Sarah",gender:"F",accent:"American"},
  {id:"af_kore",label:"Kore",gender:"F",accent:"American"},
  {id:"af_sky",label:"Sky",gender:"F",accent:"American"},
  {id:"bf_emma",label:"Emma",gender:"F",accent:"British"},
  {id:"bf_isabella",label:"Isabella",gender:"F",accent:"British"},
  {id:"bm_george",label:"George",gender:"M",accent:"British"},
  {id:"bm_daniel",label:"Daniel",gender:"M",accent:"British"},
  {id:"bm_fable",label:"Fable",gender:"M",accent:"British"},
];

let _kokoroTTS = null;
let _kokoroLoading = false;
let _kokoroLoadCallbacks = [];

async function loadKokoro(onProgress){
  if(_kokoroTTS)return _kokoroTTS;
  if(_kokoroLoading){return new Promise(res=>_kokoroLoadCallbacks.push(res));}
  _kokoroLoading=true;
  try{
    onProgress("Loading Kokoro TTS module…");
    const { KokoroTTS } = await import("https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/dist/kokoro.js");
    onProgress("Downloading model (~82MB, cached after first use)…");
    const tts = await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX",{
      dtype:"q8",
      device:"wasm",
      progress_callback:(p)=>{
        if(p.status==="progress"&&p.total>0){
          const pct=Math.round(p.loaded/p.total*100);
          onProgress(`Downloading model: ${pct}% — (${(p.loaded/1024/1024).toFixed(0)}MB / ${(p.total/1024/1024).toFixed(0)}MB)`);
        }
      }
    });
    _kokoroTTS=tts;
    _kokoroLoadCallbacks.forEach(cb=>cb(tts));
    _kokoroLoadCallbacks=[];
    return tts;
  }catch(err){
    _kokoroLoading=false;
    throw err;
  }
}

function AudioStudioPanel({book,bookId,onSettings,flash}){
  const [modelState,setModelState]=useState("idle"); // idle | loading | ready | error
  const [modelProgress,setModelProgress]=useState("");
  const [voice,setVoice]=useState("af_heart");
  const [speed,setSpeed]=useState(1.0);
  const [selectedChapters,setSelectedChapters]=useState([]);
  const [generating,setGenerating]=useState(false);
  const [genLog,setGenLog]=useState([]);
  const [audioBlobs,setAudioBlobs]=useState({}); // {chapterIdx: blobUrl}
  const [playingCh,setPlayingCh]=useState(null);
  const audioRef=useRef(null);
  const cancelRef=useRef(false);

  const chapters=(book.chapters||[]).filter(c=>c.content);
  const addLog=msg=>setGenLog(prev=>[{msg,time:new Date().toLocaleTimeString()},...prev.slice(0,49)]);

  const loadModel=async()=>{
    if(modelState==="ready")return true;
    setModelState("loading");setModelProgress("Starting…");
    try{
      await loadKokoro(msg=>{setModelProgress(msg);});
      setModelState("ready");setModelProgress("");
      addLog("✅ Kokoro TTS loaded and ready");
      return true;
    }catch(err){
      setModelState("error");setModelProgress(err.message||"Load failed");
      addLog("❌ Model load error: "+(err.message||String(err)));
      return false;
    }
  };

  // Helper: split text into narration-safe chunks (max ~400 chars, split at sentence boundaries)
  const splitText=(text)=>{
    const clean=text.replace(/[#*_`]/g,"").replace(/---+/g," ").replace(/\n{3,}/g,"\n\n").trim();
    const sentences=clean.match(/[^.!?]+[.!?]+["'»]?|[^.!?]+$/g)||[clean];
    const chunks=[];let cur="";
    for(const s of sentences){
      if((cur+s).length>380){if(cur.trim())chunks.push(cur.trim());cur=s;}
      else cur+=s;
    }
    if(cur.trim())chunks.push(cur.trim());
    return chunks.filter(c=>c.length>5);
  };

  // Generate audio for a single chapter using Kokoro
  const generateChapter=async(tts,ch,chIdx)=>{
    addLog(`🎙️ Generating Ch.${ch.number}: "${ch.title}"…`);
    const chunks=splitText(ch.content);
    const buffers=[];
    for(let i=0;i<chunks.length;i++){
      if(cancelRef.current)throw new Error("Cancelled");
      addLog(`  ↳ Segment ${i+1}/${chunks.length}…`);
      const audio=await tts.generate(chunks[i],{voice,speed});
      // audio.audio is a Float32Array at 24000 Hz
      buffers.push(audio.audio);
    }
    // Concatenate all Float32Arrays into one
    const totalLen=buffers.reduce((a,b)=>a+b.length,0);
    const combined=new Float32Array(totalLen);
    let offset=0;for(const b of buffers){combined.set(b,offset);offset+=b.length;}
    // Encode as WAV
    const wavBlob=float32ToWav(combined,24000);
    const url=URL.createObjectURL(wavBlob);
    setAudioBlobs(prev=>({...prev,[chIdx]:url}));
    addLog(`  ✅ Ch.${ch.number} done — ${(combined.length/24000/60).toFixed(1)} min`);
    return{chIdx,url,audio:combined};
  };

  // WAV encoder (PCM 16-bit)
  const float32ToWav=(samples,sampleRate)=>{
    const buf=new ArrayBuffer(44+samples.length*2);
    const view=new DataView(buf);
    const writeStr=(o,s)=>{for(let i=0;i<s.length;i++)view.setUint8(o+i,s.charCodeAt(i));};
    writeStr(0,"RIFF");view.setUint32(4,36+samples.length*2,true);writeStr(8,"WAVE");
    writeStr(12,"fmt ");view.setUint32(16,16,true);view.setUint16(20,1,true);
    view.setUint16(22,1,true);view.setUint32(24,sampleRate,true);
    view.setUint32(28,sampleRate*2,true);view.setUint16(32,2,true);view.setUint16(34,16,true);
    writeStr(36,"data");view.setUint32(40,samples.length*2,true);
    let offset=44;
    for(let i=0;i<samples.length;i++){
      const s=Math.max(-1,Math.min(1,samples[i]));
      view.setInt16(offset,s<0?s*0x8000:s*0x7FFF,true);offset+=2;
    }
    return new Blob([buf],{type:"audio/wav"});
  };

  const generateSelected=async()=>{
    if(selectedChapters.length===0){flash("Select at least one chapter");return;}
    cancelRef.current=false;
    setGenerating(true);setGenLog([]);
    try{
      const tts=await loadKokoro(msg=>setModelProgress(msg));
      setModelState("ready");
      const selected=chapters.filter((_,i)=>selectedChapters.includes(i));
      addLog(`🚀 Starting ${selected.length} chapter(s) with voice: ${voice}`);
      for(let i=0;i<selected.length;i++){
        if(cancelRef.current)break;
        const ch=selected[i];
        const chIdx=chapters.indexOf(ch);
        await generateChapter(tts,ch,chIdx);
      }
      addLog("🎉 Generation complete!");
      flash("Audio generated! 🎙️");
    }catch(err){
      if(err.message!=="Cancelled")addLog("❌ Error: "+err.message);
    }finally{setGenerating(false);cancelRef.current=false;}
  };

  const downloadAllWav=async()=>{
    const indices=Object.keys(audioBlobs);
    if(indices.length===0){flash("Generate audio first");return;}
    try{
      addLog("📦 Bundling all chapters into ZIP-like download…");
      // Download each chapter individually (browser limitation — no zip without lib)
      for(const idx of indices){
        const ch=chapters[Number(idx)];
        if(!ch)continue;
        const a=document.createElement("a");
        a.href=audioBlobs[idx];
        a.download=`${(book.title||"book").replace(/[^a-z0-9]/gi,"_")}_ch${ch.number}_${ch.title.replace(/[^a-z0-9]/gi,"_")}.wav`;
        a.click();await new Promise(r=>setTimeout(r,300));
      }
      flash("Downloaded "+indices.length+" chapter WAVs 🎧");
    }catch(e){
      addLog("❌ Download error: "+(e?.message||String(e)));
      flash("Download failed — check console");
    }
  };

  const playChapter=(idx)=>{
    const url=audioBlobs[idx];if(!url)return;
    if(audioRef.current){audioRef.current.pause();audioRef.current.src="";}
    const audio=new Audio(url);audio.playbackRate=1.0;
    audioRef.current=audio;setPlayingCh(idx);
    audio.play();
    audio.onended=()=>setPlayingCh(null);
  };

  const toggleAll=()=>{
    if(selectedChapters.length===chapters.length)setSelectedChapters([]);
    else setSelectedChapters(chapters.map((_,i)=>i));
  };

  const voicesByAccent={
    American:KOKORO_VOICES.filter(v=>v.accent==="American"),
    British:KOKORO_VOICES.filter(v=>v.accent==="British"),
  };

  return(
    <div className="space-y-5 max-w-4xl mx-auto">
      {/* Header */}
      <Card>
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 bg-gradient-to-br from-purple-500 to-pink-500 rounded-2xl flex items-center justify-center text-2xl shrink-0">🎙️</div>
          <div className="flex-1">
            <h2 className="text-white text-xl font-bold">Audio Studio</h2>
            <p className="text-white/40 text-sm mt-1">Powered by <a href="https://github.com/hexgrad/kokoro" target="_blank" className="text-purple-400 hover:text-purple-300">Kokoro TTS</a> — 82M parameter open-source model, 100% in-browser, no API key. Near-ElevenLabs quality.</p>
          </div>
          <div className={`text-xs px-3 py-1 rounded-full border font-semibold shrink-0 ${modelState==="ready"?"bg-green-500/20 text-green-300 border-green-500/30":modelState==="loading"?"bg-amber-500/20 text-amber-300 border-amber-500/30":modelState==="error"?"bg-red-500/20 text-red-300 border-red-500/30":"bg-white/10 text-white/40 border-white/10"}`}>
            {modelState==="ready"?"✅ Model Ready":modelState==="loading"?"⏳ Loading…":modelState==="error"?"❌ Error":"Not Loaded"}
          </div>
        </div>
        {modelState==="loading"&&modelProgress&&(
          <div className="mt-4">
            <div className="bg-white/5 rounded-lg p-3 text-amber-300/70 text-xs">{modelProgress}</div>
            <p className="text-white/20 text-xs mt-2">After the first download (~82MB), the model is cached in your browser — future loads are instant.</p>
          </div>
        )}
        {modelState==="error"&&<div className="mt-3 bg-red-500/10 border border-red-500/20 rounded-xl p-3 text-red-300 text-sm">{modelProgress}<br/><span className="text-red-300/50 text-xs">Tip: Try in Chrome/Edge with WebAssembly support.</span></div>}
      </Card>

      {/* Voice & Settings */}
      <Card>
        <h3 className="text-white font-semibold mb-4">Voice & Settings</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="text-white/50 text-xs uppercase tracking-wider block mb-2">Narrator Voice</label>
            <select value={voice} onChange={e=>setVoice(e.target.value)} className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-purple-500 text-sm">
              {Object.entries(voicesByAccent).map(([accent,voices])=>(
                <optgroup key={accent} label={`─── ${accent} ───`}>
                  {voices.map(v=><option key={v.id} value={v.id}>{v.label} [{v.gender}]</option>)}
                </optgroup>
              ))}
            </select>
          </div>
          <div>
            <label className="text-white/50 text-xs uppercase tracking-wider block mb-2">Speed: {speed.toFixed(2)}×</label>
            <input type="range" min="0.7" max="1.3" step="0.05" value={speed} onChange={e=>setSpeed(Number(e.target.value))} className="w-full accent-purple-500 mt-2"/>
            <div className="flex justify-between text-white/20 text-xs mt-1"><span>0.7× slow</span><span>1.0× natural</span><span>1.3× fast</span></div>
          </div>
        </div>
        <div className="bg-purple-500/10 border border-purple-500/20 rounded-xl p-3 text-xs text-purple-300/70">
          <strong>Voice guide:</strong> Heart ❤️ / Bella 🔥 = warmest, most natural. Michael / George = strong male narrator. Emma / Isabella = polished British.
        </div>
      </Card>

      {/* Chapter Selection */}
      <Card>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-white font-semibold">Select Chapters ({selectedChapters.length}/{chapters.length})</h3>
          <div className="flex gap-2">
            <button onClick={toggleAll} className="text-xs border border-white/20 text-white/40 px-3 py-1.5 rounded-lg hover:bg-white/5">{selectedChapters.length===chapters.length?"Deselect All":"Select All"}</button>
          </div>
        </div>
        {chapters.length===0?(
          <div className="text-center py-8 text-white/20 text-sm">No chapters written yet — write chapters first.</div>
        ):(
          <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1">
            {chapters.map((ch,i)=>{
              const hasAudio=!!audioBlobs[i];
              const isPlaying=playingCh===i;
              const isSelected=selectedChapters.includes(i);
              return(
                <div key={i} className={`flex items-center gap-3 p-3 rounded-xl border transition-all cursor-pointer ${isSelected?"bg-purple-500/15 border-purple-500/30":"bg-white/5 border-white/10 hover:border-white/20"}`}>
                  <input type="checkbox" checked={isSelected} onChange={e=>{e.stopPropagation();setSelectedChapters(prev=>isSelected?prev.filter(x=>x!==i):[...prev,i]);}} className="accent-purple-500 w-4 h-4 shrink-0" onClick={e=>e.stopPropagation()}/>
                  <div className="flex-1 min-w-0" onClick={()=>setSelectedChapters(prev=>isSelected?prev.filter(x=>x!==i):[...prev,i])}>
                    <p className="text-white text-sm font-medium truncate">Ch.{ch.number}: {ch.title}</p>
                    <p className="text-white/30 text-xs">{(ch.content||"").split(/\s+/).length} words · ~{Math.round((ch.content||"").split(/\s+/).length/150)} min audio</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {hasAudio&&(
                      <>
                        <button onClick={e=>{e.stopPropagation();if(isPlaying){audioRef.current?.pause();setPlayingCh(null);}else{playChapter(i);}}} className={`w-8 h-8 rounded-full flex items-center justify-center text-sm transition-all ${isPlaying?"bg-pink-500/30 text-pink-300":"bg-green-500/20 text-green-300 hover:bg-green-500/30"}`}>
                          {isPlaying?"⏸":"▶"}
                        </button>
                        <a href={audioBlobs[i]} download={`ch${ch.number}_${ch.title.replace(/[^a-z0-9]/gi,"_")}.wav`} onClick={e=>e.stopPropagation()} className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-white/40 hover:text-white text-xs">💾</a>
                      </>
                    )}
                    {hasAudio&&<span className="text-green-400/70 text-xs shrink-0">✅</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Generate Controls */}
      <Card>
        <div className="flex gap-3 mb-4">
          {!generating?(
            <button onClick={generateSelected} disabled={selectedChapters.length===0||chapters.length===0} className="flex-1 bg-gradient-to-r from-purple-500 to-pink-500 text-white py-3.5 rounded-xl font-semibold hover:opacity-90 disabled:opacity-40 flex items-center justify-center gap-2">
              🎙️ Generate Audio ({selectedChapters.length} ch)
            </button>
          ):(
            <button onClick={()=>{cancelRef.current=true;addLog("⏹ Cancelling…");}} className="flex-1 bg-red-500/20 border border-red-500/30 text-red-300 py-3.5 rounded-xl font-semibold hover:bg-red-500/30 flex items-center justify-center gap-2">
              <Spin/>Generating… (click to cancel)
            </button>
          )}
          {Object.keys(audioBlobs).length>0&&(
            <button onClick={downloadAllWav} className="border border-white/20 text-white/60 px-5 py-3.5 rounded-xl hover:bg-white/5 text-sm whitespace-nowrap">💾 Download All</button>
          )}
        </div>

        {/* Generation Log */}
        {genLog.length>0&&(
          <div className="bg-black/30 rounded-xl p-4 max-h-48 overflow-y-auto space-y-1">
            {genLog.map((entry,i)=>(
              <div key={i} className="flex gap-2 text-xs">
                <span className="text-white/20 shrink-0">{entry.time}</span>
                <span className="text-white/60">{entry.msg}</span>
              </div>
            ))}
          </div>
        )}

        <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-3 text-center">
          <div className="bg-white/5 rounded-xl p-3"><p className="text-white text-lg font-bold">{Object.keys(audioBlobs).length}</p><p className="text-white/30 text-xs">Chapters ready</p></div>
          <div className="bg-white/5 rounded-xl p-3"><p className="text-white text-lg font-bold">{chapters.reduce((a,c)=>a+Math.round((c.content||"").split(/\s+/).length/150),0)}</p><p className="text-white/30 text-xs">Est. total minutes</p></div>
          <div className="bg-white/5 rounded-xl p-3"><p className="text-white text-lg font-bold">FREE</p><p className="text-white/30 text-xs">No API cost</p></div>
        </div>
      </Card>

      {/* Info box */}
      <div className="bg-white/3 border border-white/8 rounded-xl p-4 text-xs text-white/30 leading-relaxed">
        <strong className="text-white/50">How it works:</strong> Kokoro-82M runs entirely in your browser via WebAssembly. The model (~82MB) downloads once and is cached permanently. Audio is WAV format (24kHz, 16-bit PCM) — import into Audacity, Adobe Premiere, or ACX-compatible software for final mastering. Each chapter generates independently so you can regenerate just the chapters that need it.
      </div>
    </div>
  );
}

// ── App Shell ─────────────────────────────────────────────────────────────────


// ── Book Translation Panel ────────────────────────────────────────────────────
function TranslatePanel({book,upd,quotaHit,bump,handleErr,flash}){
  const LANGS=["Spanish","French","German","Italian","Portuguese","Dutch","Polish","Swedish","Norwegian","Danish","Finnish","Russian","Ukrainian","Chinese (Simplified)","Chinese (Traditional)","Japanese","Korean","Arabic","Hebrew","Hindi","Turkish","Greek","Romanian","Czech","Hungarian","Thai","Vietnamese","Indonesian","Malay"];
  const [targetLang,setTargetLang]=useState("Spanish");
  const [translating,setTranslating]=useState(false);
  const [progress,setProgress]=useState("");
  const [done,setDone]=useState(false);
  const [error,setError]=useState("");

  const translate=async()=>{
    if(quotaHit||translating)return;
    if(!book.chapters?.some(c=>c.content)){setError("Write at least one chapter first.");return;}
    if(!confirm(`Translate all chapters to ${targetLang}? This will use ${(book.chapters||[]).filter(c=>c.content).length} API calls.`))return;
    setTranslating(true);setError("");setDone(false);
    try{
      const chapters=[...(book.chapters||[])];
      const toTranslate=chapters.filter(c=>c.content);
      for(let i=0;i<toTranslate.length;i++){
        if(getUsage()>=DAILY_LIMIT){setError("Daily quota hit — translation paused. Resume tomorrow.");break;}
        const ch=toTranslate[i];
        const chIdx=chapters.findIndex(c=>c.number===ch.number);
        setProgress(`Translating chapter ${i+1}/${toTranslate.length}…`);
        const translated=await callGemini(
          `You are a professional literary translator. Translate this chapter into ${targetLang}.\n\n`+
          `Rules:\n• Preserve the author's voice, sentence rhythm, and style\n• Keep character names as-is\n• Keep all emotional beats intact\n• Natural ${targetLang} — not word-for-word literal translation\n• Return ONLY the translated text — no preamble\n\n`+
          `CHAPTER:\n${ch.content}`,
          0.4
        );
        bump();
        chapters[chIdx]={...chapters[chIdx],content:translated};
      }
      // Update title & subtitle
      setProgress("Translating title…");
      const titleRaw=await callGemini(`Translate this book title and subtitle to ${targetLang}. Return ONLY JSON: {"title":"","subtitle":""}.\nTitle: ${book.title}\nSubtitle: ${book.subtitle||""}`,0.3);
      bump();
      const tm=titleRaw.match(/\{[\s\S]*\}/);
      let titles={title:book.title,subtitle:book.subtitle};if(tm){try{titles=JSON.parse(tm[0]);}catch(pe){/* keep defaults */}}
      const wc=chapters.reduce((a,c)=>a+(c.content?c.content.split(/\s+/).length:0),0);
      upd({chapters,word_count:wc,title:titles.title||book.title,subtitle:titles.subtitle||book.subtitle,writing_language:targetLang});
      setDone(true);setProgress("");
      flash(`Book translated to ${targetLang}! 🌍`);
    }catch(e){setError(errMsg(e));}finally{setTranslating(false);}
  };

  return(
    <div className="max-w-2xl mx-auto">
      <Card>
        <div className="text-center mb-6">
          <div className="text-4xl mb-3">🌍</div>
          <h2 className="text-white text-xl font-bold mb-1">Book Translation</h2>
          <p className="text-white/40 text-sm">Translate your entire book into 30+ languages. Reach new KDP markets.</p>
        </div>
        {done&&<div className="bg-green-500/15 border border-green-500/30 rounded-xl p-4 mb-5 text-center"><p className="text-green-300 font-semibold">✅ Translation complete! All chapters now in {targetLang}.</p><p className="text-green-300/60 text-xs mt-1">Re-run the Writing Quality Agent to verify quality in the new language.</p></div>}
        {error&&<p className="text-red-400 text-sm mb-4 bg-red-500/10 rounded-xl p-3">{error}</p>}
        <div className="space-y-4">
          <div>
            <label className="text-white/50 text-xs uppercase tracking-wider block mb-2">Target Language</label>
            <select value={targetLang} onChange={e=>setTargetLang(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-purple-500/50">
              {LANGS.map(l=><option key={l} value={l}>{l}</option>)}
            </select>
          </div>
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4">
            <p className="text-amber-300 text-sm font-semibold mb-1">⚠️ This modifies your book in-place</p>
            <p className="text-amber-200/60 text-xs">Export a backup copy first if you want to keep the original language. Translation uses one API call per chapter.</p>
          </div>
          <div className="flex items-center justify-between p-4 bg-white/5 rounded-xl">
            <div><p className="text-white/70 text-sm">Chapters to translate</p><p className="text-white/30 text-xs">API calls: {(book.chapters||[]).filter(c=>c.content).length + 1}</p></div>
            <span className="text-white text-2xl font-bold">{(book.chapters||[]).filter(c=>c.content).length}</span>
          </div>
          {translating&&<div className="text-center py-4"><Spin/><p className="text-purple-300 text-sm mt-2">{progress}</p></div>}
          <button onClick={translate} disabled={translating||quotaHit} className="w-full bg-gradient-to-r from-blue-500 to-cyan-500 text-white py-3 rounded-xl font-semibold hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2">
            {translating?<><Spin size="h-4 w-4"/>Translating…</>:`🌍 Translate to ${targetLang}`}
          </button>
        </div>
      </Card>
    </div>
  );
}

// ── Error Boundary ────────────────────────────────────────────────────────────
class ErrorBoundary extends React.Component{
  constructor(props){super(props);this.state={error:null};}
  static getDerivedStateFromError(e){return{error:e};}
  componentDidCatch(e,info){console.error("BookForge Error:",e,info);}
  render(){
    if(this.state.error){
      return(
        <div className="min-h-screen bg-[#0f0a1e] flex items-center justify-center p-6">
          <div className="bg-red-500/10 border border-red-500/30 rounded-2xl p-8 max-w-md text-center">
            <div className="text-4xl mb-4">😵</div>
            <h2 className="text-white font-bold text-xl mb-2">Something went wrong</h2>
            <p className="text-red-300/70 text-sm mb-4">{this.state.error.message}</p>
            <button onClick={()=>{this.setState({error:null});}} className="bg-purple-500/20 text-purple-300 border border-purple-500/30 px-6 py-2 rounded-xl text-sm hover:bg-purple-500/30">Try Again</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}



// ══════════════════════════════════════════════════════════════════════════════
// ❓ TOUR GUIDE SYSTEM — powered by Driver.js (MIT, 25k stars, zero deps)
// Loaded from CDN. Each page/tab has its own step-by-step walkthrough.
// ══════════════════════════════════════════════════════════════════════════════

let _driverLoaded = false;
let _driverLoading = false;
let _driverCallbacks = [];

async function loadDriver(){
  if(window.driver && window.driver.js) return window.driver.js;
  if(_driverLoaded && window.driver?.js) return window.driver.js;
  if(_driverLoading) return new Promise(res => _driverCallbacks.push(res));
  _driverLoading = true;
  return new Promise((resolve, reject) => {
    // Load CSS
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://cdn.jsdelivr.net/npm/driver.js@1.3.5/dist/driver.css";
    document.head.appendChild(link);
    // Load JS
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/driver.js@1.3.5/dist/driver.js.iife.js";
    script.onload = () => {
      _driverLoaded = true;
      _driverLoading = false;
      const dj = window.driver.js;
      _driverCallbacks.forEach(cb => cb(dj));
      _driverCallbacks = [];
      resolve(dj);
    };
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

const TOUR_STEPS = {
  home_library: [
    { element: "#tour-btn", popover: { title: "❓ Tour Button", description: "This button is on every page! Click it anytime to get a guided walkthrough of what you can do here.", side: "bottom" }},
    { element: ".bf-home-new-btn", popover: { title: "📝 Create a Book", description: "Click here to start generating a new book. You'll enter your genre, audience, and topic — then AI builds a full outline, chapters, SEO, and cover.", side: "bottom" }},
    { element: ".bf-search-bar", popover: { title: "🔍 Search", description: "Search your existing books by title or genre. Works across your whole library.", side: "bottom" }},
    { element: ".bf-home-tabs", popover: { title: "🗂️ Navigation Tabs", description: "Switch between your Library (books), Series (multi-book projects), Queue (batch generation), and Manga Studio.", side: "bottom" }},
    { popover: { title: "💡 Pro Tip: Daily Quota", description: "See the number in the top-right header (e.g. 45/1500)? That's your daily Gemini API usage. It resets at midnight Pacific. Each book generation uses about 5-10 requests.", side: "bottom" }},
  ],
  home_series: [
    { element: "#tour-btn", popover: { title: "📗 Series Manager", description: "Build multi-book series where every book shares the same world, characters, and arc — and the AI remembers everything.", side: "bottom" }},
    { popover: { title: "🗺️ Series Arc", description: "When you create a series, you define the overarching story arc. Each book you generate inside it picks up from where the last one left off.", side: "bottom" }},
    { popover: { title: "🔁 Series Bible", description: "Every chapter you write automatically extracts key plot events and adds them to the Series Bible. This prevents contradictions across books.", side: "bottom" }},
  ],
  home_queue: [
    { element: "#tour-btn", popover: { title: "⏳ Generation Queue", description: "Queue up multiple books to generate in order. This is how you batch-produce a full catalog — queue 10 books, walk away.", side: "bottom" }},
    { popover: { title: "⚡ How it works", description: "Add books to queue from the Create page. They generate one at a time using your Gemini API key. Each book takes ~5-15 minutes depending on chapter count.", side: "bottom" }},
    { popover: { title: "💾 Auto-save", description: "If you hit your daily quota mid-queue, progress is saved automatically. Come back tomorrow and it resumes from where it stopped.", side: "bottom" }},
  ],
  home_manga: [
    { element: "#tour-btn", popover: { title: "🎌 Manga Studio", description: "A complete manga/manhwa creation system — concept, chapters, panel art, and publication-ready exports. All free.", side: "bottom" }},
    { popover: { title: "Step 1: New Project", description: "Click '+ New Project' to start the 3-step wizard. Choose format (Manga/Manhwa/Manhua), genre, and optionally run the Market Research Agent to find the best niches.", side: "bottom" }},
    { popover: { title: "Step 2: Research Agent", description: "The Research Agent analyzes trending niches in your genre — what readers want, what tropes to use/avoid, and which platforms pay best. Powered by Gemini, free.", side: "bottom" }},
    { popover: { title: "Step 3: Series Concept", description: "AI generates a full series bible: protagonist, antagonist, supporting cast, power system, world setting, series arc, and a Chapter 1 hook. Takes ~30 seconds.", side: "bottom" }},
  ],
  editor: [
    { element: "#tour-btn", popover: { title: "📖 Book Editor", description: "This is your book's workspace. Every tab here handles a different part of your book's creation pipeline.", side: "bottom" }},
    { popover: { title: "📋 Outline Tab", description: "AI generates a chapter-by-chapter outline first. You review and approve it before writing begins. You can edit any chapter title or description directly.", side: "bottom" }},
    { popover: { title: "✍️ Chapters Tab", description: "Once your outline is approved, write chapters one at a time or use 'Write All'. Each chapter is ~2,000-3,000 words with anti-AI patterns built in for natural prose.", side: "bottom" }},
    { popover: { title: "🎨 Cover Tab", description: "Generate a professional book cover using Pollinations.ai (free, no API key needed). Describe your cover or let it auto-generate from your book's details.", side: "bottom" }},
    { popover: { title: "🔍 SEO Tab", description: "Generates Amazon KDP-optimized title, subtitle, description, and 7 exact-match keywords. This is what makes your book discoverable.", side: "bottom" }},
    { popover: { title: "🤖 Review Agent", description: "Your book must score 70+ on marketability before downloads unlock. The agent checks title appeal, keyword strength, SEO quality, and market differentiation.", side: "bottom" }},
    { popover: { title: "📊 Quality Agent", description: "Your book must also score 78+ on writing quality. This agent specifically hunts AI writing patterns: em-dash overuse, filler openers, unstated emotions, passive voice.", side: "bottom" }},
    { popover: { title: "📤 Publish Tab", description: "Download your book as EPUB (for Amazon KDP), TXT, Audiobook script, or RTF. The dual gate (Review 70+ AND Quality 78+) must pass first.", side: "bottom" }},
    { popover: { title: "🎙️ Audio Studio Tab", description: "Generate a real narrated audiobook using Kokoro TTS — 82M parameter AI model running free in your browser. 15 voices, WAV export. First load downloads ~82MB (cached after).", side: "bottom" }},
  ],
  manga_editor: [
    { element: "#tour-btn", popover: { title: "🎌 Manga Editor", description: "Your manga series workspace. The AI maintains your full series bible across every chapter it writes.", side: "bottom" }},
    { popover: { title: "📖 Series Bible Tab", description: "Your auto-generated series foundation: protagonist (appearance, personality, goal, flaw, power), antagonist, supporting cast, world setting, power system, and full series arc.", side: "bottom" }},
    { popover: { title: "✍️ Write Tab", description: "Choose how many chapters to write at once: 1, 2, 3, 5, or 10. The AI reads the full series bible + last 3 chapter summaries before writing each chapter — memory is maintained automatically.", side: "bottom" }},
    { popover: { title: "📋 Chapters Tab", description: "Every written chapter is listed here with its mood, scene count, and ending type. Click 'View →' on any chapter to see the full scene breakdown with panel descriptions and dialogue.", side: "bottom" }},
    { popover: { title: "🎨 Panel Art (in Chapter View)", description: "Inside each chapter, click 'Generate Panel Art' on any scene. Pollinations.ai generates scene art tuned to your chosen art style (Shonen Bold, Manhwa Color, Dark Ink, etc.).", side: "bottom" }},
    { popover: { title: "📤 Export Tab", description: "Exports publication-ready image files: Webtoon Canvas (800px JPEG strips), Tapas (940px PNG), or GlobalComix (900px PNG). Files go straight to your Downloads — upload directly to the platform.", side: "bottom" }},
    { popover: { title: "📄 Production Script", description: "Downloads a fully formatted .txt script for a human artist — every panel description, dialogue line, SFX, and inner monologue. Ready to send to a Fiverr/Upwork artist.", side: "bottom" }},
  ],
  create: [
    { element: "#tour-btn", popover: { title: "📝 Create New Book", description: "This page generates a brand-new book. Fill in as much or as little as you want — AI fills in the rest.", side: "bottom" }},
    { popover: { title: "📚 Genre & Topic", description: "Pick your genre and enter your book topic. The more specific your topic (e.g. 'intermittent fasting for women over 40'), the better the outline and SEO.", side: "bottom" }},
    { popover: { title: "🎯 Target Audience", description: "Be specific here. 'People who want to lose weight' is weak. 'Busy working mothers aged 30-45' is strong — it directly shapes the tone, examples, and Amazon keyword targeting.", side: "bottom" }},
    { popover: { title: "📖 Nonfiction Mode", description: "Toggle this for how-to books, guides, memoirs. Nonfiction mode uses a different chapter structure with actionable steps, case studies, and a practical tone.", side: "bottom" }},
    { popover: { title: "🚀 Generate", description: "Hit Generate and AI builds a full outline in ~20 seconds. You'll be taken to the editor where you review the outline before any chapters are written.", side: "bottom" }},
  ],
};

async function startTour(page, homeTab, isEditor){
  try{
    const dj = await loadDriver();
    const { driver } = dj;

    let steps;
    if(page === "manga-editor") steps = TOUR_STEPS.manga_editor;
    else if(page === "editor") steps = TOUR_STEPS.editor;
    else if(page === "create") steps = TOUR_STEPS.create;
    else if(homeTab === "series") steps = TOUR_STEPS.home_series;
    else if(homeTab === "queue") steps = TOUR_STEPS.home_queue;
    else if(homeTab === "manga") steps = TOUR_STEPS.home_manga;
    else steps = TOUR_STEPS.home_library;

    // Filter out steps that reference elements that don't exist in the DOM
    const validSteps = steps.filter(s => {
      if(!s.element) return true; // popover-only steps always valid
      return !!document.querySelector(s.element);
    });

    const driverObj = driver({
      showProgress: true,
      showButtons: ["next","previous","close"],
      nextBtnText: "Next →",
      prevBtnText: "← Back",
      doneBtnText: "Done ✓",
      popoverClass: "bf-tour-popover",
      steps: validSteps,
    });
    driverObj.drive();
  } catch(err){
    console.warn("Tour failed to load:", err);
    alert("Tour guide couldn't load. Check your internet connection and try again.");
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// MANGA / MANHWA STORAGE HELPERS
// ══════════════════════════════════════════════════════════════════════════════
const MANGA_KEY="bf_manga_projects";
const getMangaProjects=()=>{try{return JSON.parse(localStorage.getItem(MANGA_KEY)||"[]");}catch{return[];}};
const setMangaProjects=v=>{try{localStorage.setItem(MANGA_KEY,JSON.stringify(v));}catch(e){if(e.name==="QuotaExceededError")alert("Storage full — export or delete some manga projects.");}};
const getMangaProject=id=>getMangaProjects().find(p=>p.id===id)||null;
const saveMangaProject=p=>{const all=getMangaProjects();const i=all.findIndex(x=>x.id===p.id);if(i>-1)all[i]=p;else all.unshift(p);setMangaProjects(all);};
const deleteMangaProject=id=>setMangaProjects(getMangaProjects().filter(p=>p.id!==id));

function App(){
  const savedNav=getNavState();
  const [page,setPage]=useState(savedNav?.page||"home");
  const [bookId,setBookId]=useState(savedNav?.bookId||null);
  const [showSettings,setShowSettings]=useState(false);
  const [homeTab,setHomeTab]=useState("library");
  const [retryToasts,setRetryToasts]=useState([]);
  useEffect(()=>{
    // Hide loading screen once React has mounted
    const el=document.getElementById("loading");
    if(el){el.classList.add("hidden");setTimeout(()=>{el.style.display="none";},500);}
  },[]);
  useEffect(()=>{
    const onRetry=e=>{
      const{attempt,totalAttempts,reason}=e.detail||{};
      const label=reason==="timeout"?"⏱️ Timed out":reason==="network"?"📡 Network hiccup":"⚠️ Server hiccup";
      const id=Date.now()+Math.random();
      setRetryToasts(prev=>[...prev,{id,msg:`${label} — auto-retrying (${attempt}/${totalAttempts})…`}]);
      setTimeout(()=>setRetryToasts(prev=>prev.filter(t=>t.id!==id)),4000);
    };
    window.addEventListener("bfai:retry",onRetry);
    return()=>window.removeEventListener("bfai:retry",onRetry);
  },[]);
  const navigate=(p,id=null)=>{setPage(p);if(id)setBookId(id);setNavState({page:p,bookId:id||bookId});window.scrollTo(0,0);};
  const currentBook=bookId?getBook(bookId):null;
  const isHome=page==="home";const isEditor=page==="editor";const isCreate=page==="create";
  return(
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
      <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none">
        {retryToasts.map(t=>(
          <div key={t.id} className="bg-cyan-500/95 text-white text-xs font-semibold px-4 py-2.5 rounded-lg shadow-lg backdrop-blur-sm animate-pulse">{t.msg}</div>
        ))}
      </div>
      {showSettings&&<SettingsModal onClose={()=>setShowSettings(false)}/>}
      <Header
        onBack={!isHome?()=>navigate("home"):null}
        title={isEditor&&currentBook?currentBook.title:page==="manga-editor"&&bookId?getMangaProject(bookId)?.title||"Manga Editor":"BookForge AI"}
        subtitle={isEditor&&currentBook?`${currentBook.genre} · ${currentBook.target_audience}`:page==="manga-editor"?"Manga · Manhwa Creator":"AI-Powered Book Generator"}
        onSettings={()=>setShowSettings(true)}
        onTour={()=>startTour(page,homeTab,isEditor)}
        activeTab={isHome?homeTab:null}
        setActiveTab={isHome?t=>setHomeTab(t):null}
      />
      {isHome&&homeTab==="library"&&<HomePage navigate={navigate} onSettings={()=>setShowSettings(true)}/>}
      {isHome&&homeTab==="series"&&<SeriesPage navigate={navigate} onSettings={()=>setShowSettings(true)}/>}
      {isHome&&homeTab==="queue"&&<QueuePage navigate={navigate} onSettings={()=>setShowSettings(true)}/>}
      {isHome&&homeTab==="manga"&&<MangaHomePage navigate={navigate} onSettings={()=>setShowSettings(true)}/>}
      {page==="manga-editor"&&<MangaEditorPage projectId={bookId} navigate={navigate} onSettings={()=>setShowSettings(true)}/>}
      {isCreate&&<CreatePage navigate={navigate} onSettings={()=>setShowSettings(true)}/>}
      {isEditor&&<EditorPage bookId={bookId} navigate={navigate} onSettings={()=>setShowSettings(true)}/>}
    </div>
  );
}
ReactDOM.createRoot(document.getElementById("root")).render(<ErrorBoundary><App/></ErrorBoundary>);

// ══════════════════════════════════════════════════════════════════════════════
// 🎌 MANGA / MANHWA CREATOR — FULL SYSTEM
// ══════════════════════════════════════════════════════════════════════════════

// ─── Data ──────────────────────────────────────────────────────────────────
const MANGA_GENRES = [
  {id:"action-shonen",label:"⚔️ Action Shonen",desc:"Power systems, rivals, training arcs. Demon Slayer / JJK energy.",color:"from-orange-500 to-red-500"},
  {id:"romance-manhwa",label:"💕 Romance Manhwa",desc:"CEO × commoner, enemies-to-lovers, second chances. #1 global genre.",color:"from-pink-500 to-rose-500"},
  {id:"isekai-fantasy",label:"🌀 Isekai / Fantasy",desc:"Reincarnation, cheat skills, dungeon crawling, overpowered MC.",color:"from-violet-500 to-purple-500"},
  {id:"thriller-horror",label:"🩸 Thriller / Horror",desc:"Psychological horror, survival games, dark atmosphere.",color:"from-gray-700 to-red-900"},
  {id:"slice-of-life",label:"☕ Slice of Life",desc:"Everyday warmth, cozy relationships, school or workplace settings.",color:"from-sky-400 to-teal-500"},
  {id:"mecha-scifi",label:"🤖 Mecha / Sci-Fi",desc:"Giant robots, space opera, cyberpunk, tech dystopia.",color:"from-cyan-500 to-blue-600"},
  {id:"martial-arts",label:"🥋 Martial Arts",desc:"Cultivation, tournaments, ancient clans, qi systems.",color:"from-amber-500 to-orange-600"},
  {id:"dark-fantasy",label:"🧙 Dark Fantasy",desc:"Grimdark worlds, anti-heroes, morally complex, Berserk vibes.",color:"from-indigo-700 to-slate-800"},
  {id:"comedy-gag",label:"😂 Comedy / Gag",desc:"4-koma style, absurdist humor, chibi moments, situational comedy.",color:"from-yellow-400 to-orange-400"},
  {id:"sports",label:"🏃 Sports",desc:"Underdog journeys, team dynamics, tournament arcs.",color:"from-green-500 to-emerald-600"},
  {id:"villainess",label:"👑 Villainess",desc:"Otome game reincarnation, reverse harem, palace intrigue.",color:"from-purple-400 to-pink-600"},
  {id:"survival-game",label:"🎮 Survival Game",desc:"Battle royale, death games, strategic horror.",color:"from-slate-600 to-red-700"},
];

const MANGA_FORMATS = [
  {id:"manga",label:"📖 Manga",desc:"Right-to-left, black & white, Japanese style panels"},
  {id:"manhwa",label:"📱 Manhwa",desc:"Vertical scroll, full color, Korean webtoon style"},
  {id:"manhua",label:"🏮 Manhua",desc:"Vertical scroll, color, Chinese cultivation/action heavy"},
];

const ART_STYLES = [
  {id:"shonen-bold",label:"Shonen Bold","prompt":"bold sharp manga linework, heavy contrast, speed lines, dramatic angles, Jujutsu Kaisen art style, screentone shadows, intense expressions, black and white manga panel"},
  {id:"shoujo-delicate",label:"Shoujo Delicate","prompt":"delicate thin linework shoujo manga, flower sparkle decorations, large starry eyes, flowing hair, soft pastel tones, CLAMP art style influence, romantic atmosphere"},
  {id:"manhwa-color",label:"Manhwa Color","prompt":"vertical manhwa webtoon style, full color illustration, Korean webtoon art, clean linework, soft gradient shadows, Solo Leveling aesthetic, detailed character designs"},
  {id:"dark-ink",label:"Dark Ink (Berserk)","prompt":"black and white manga panel, high contrast ink illustration, cross-hatching shadows, screentone texture, intense dramatic composition, Berserk meets Vagabond art quality"},
  {id:"chibi-cute",label:"Chibi Cute","prompt":"chibi character illustration, super-deformed 3:1 head ratio, kawaii aesthetic, pastel candy colors, sparkle effects, extremely clean linework, cute sticker quality"},
  {id:"cyberpunk-neo",label:"Cyberpunk Neo-Tokyo","prompt":"cyberpunk anime illustration, neon-lit dark cityscape, teal and magenta palette, Production I.G. quality, holographic backgrounds, rain reflections, Ghost in the Shell aesthetic"},
  {id:"fantasy-epic",label:"Fantasy Epic","prompt":"detailed fantasy manga illustration, epic battle scene composition, intricate armor and magic effects, Mushishi meets Berserk art quality, dynamic perspective, rich environmental detail"},
  {id:"romance-soft",label:"Romance Soft","prompt":"soft watercolor manga style, warm romantic lighting, cherry blossom atmosphere, gentle pastel palette, expressive emotional character faces, shoujo manga romance scene"},
];

// ─── Manga Research Agent ────────────────────────────────────────────────────
async function runMangaResearch(bump,genre){
  const prompt = `You are a manga/manhwa industry analyst with deep knowledge of Webtoon, Tapas, MangaDex, and Amazon Kindle charts.

Analyze the "${genre}" genre and identify the most profitable, underserved niches right now (2025).

Respond ONLY with valid JSON:
{
  "market_summary": "2-3 sentence overview of this genre's current popularity and growth",
  "top_niches": [
    {"name":"Niche name","why":"Why this sub-niche is hot right now","example_titles":["title1","title2"],"reader_craving":"What readers desperately want but rarely get","competition":"low|medium|high"}
  ],
  "trending_tropes": ["trope 1","trope 2","trope 3","trope 4","trope 5"],
  "avoid_tropes": ["overused trope readers are sick of"],
  "hook_formula": "The proven story hook formula for this genre",
  "mc_archetypes": ["archetype 1","archetype 2","archetype 3"],
  "recommended_chapter_length": "average panel count / word count per chapter",
  "monetization_tip": "Best platform and pricing strategy for this genre"
}`;
  const raw = await callGemini(prompt, 0.5);
  bump();
  try{
    const m = raw.match(/\{[\s\S]*\}/);
    if(!m) throw {code:"PARSE", msg:"Research agent returned no JSON."};
    try{return JSON.parse(m[0]);}catch(pe){throw{code:"PARSE",msg:"AI returned malformed JSON — please retry."};}
  } catch(e){
    throw {code:"PARSE", msg:"Research agent response was malformed. Try again."};
  }
}

// ─── Manga Project Creator ───────────────────────────────────────────────────
async function generateMangaConcept(bump, data){
  const {genre, format, artStyle, userIdea, targetAudience} = data;
  const prompt = `You are a professional manga/manhwa story architect. Create a complete series concept.

Format: ${format} | Genre: ${genre} | Art Style: ${artStyle}
Target Audience: ${targetAudience}
User's idea/premise: ${userIdea||"(none — generate a compelling original concept)"}

Create a professional manga series concept. Respond ONLY with valid JSON:
{
  "title": "Compelling manga title",
  "subtitle": "Tagline (optional)",
  "logline": "One punchy sentence that sells the series",
  "synopsis": "3-4 paragraph story overview covering setup, conflict, and stakes",
  "genre_tags": ["tag1","tag2","tag3"],
  "setting": "World/setting description (2-3 sentences)",
  "tone": "Dark and gritty | Lighthearted | Romantic | etc.",
  "protagonist": {"name":"","age":"","appearance":"brief description for consistent art generation","personality":"","goal":"","flaw":"","power_or_skill":""},
  "antagonist": {"name":"","role":"","motivation":"","appearance":""},
  "supporting_cast": [{"name":"","role":"","brief":""}],
  "power_system": "Description of magic/powers/abilities (or 'None' if slice of life)",
  "series_arc": "The overarching story across the full run (3-5 sentences)",
  "chapter_one_hook": "Exact first chapter opening scenario — the hook that makes readers subscribe immediately",
  "estimated_chapters": "Realistic chapter count for a complete story",
  "chapter_structure": "How each chapter is structured (setup, escalation, cliffhanger format)",
  "recurring_themes": ["theme1","theme2","theme3"]
}`;
  const raw = await callGemini(prompt, 0.8);
  bump();
  try{
    const m = raw.match(/\{[\s\S]*\}/);
    if(!m) throw {code:"PARSE", msg:"Concept generation returned no JSON."};
    try{return JSON.parse(m[0]);}catch(pe){throw{code:"PARSE",msg:"AI returned malformed JSON — please retry."};}
  } catch(e){
    if(e.code==="PARSE") throw e;
    throw {code:"PARSE", msg:"Concept JSON was malformed — regenerate to try again."};
  }
}

// ─── Chapter Generator ───────────────────────────────────────────────────────
async function generateMangaChapters(bump, project, startChapter, count, onProgress){
  const concept = project.concept || {};
  const existingChapters = project.chapters || [];
  const chapters = [];

  // Build story memory — last 3 chapters for context
  const recentChapters = existingChapters.slice(-3).map(ch =>
    `Ch.${ch.number} "${ch.title}": ${ch.summary}`
  ).join("\n");

  const overarchingArc = `
SERIES BIBLE:
Title: ${project.title}
Genre: ${project.genre} | Format: ${project.format}
Setting: ${concept.setting||""}
Series Arc: ${concept.series_arc||""}
Power System: ${concept.power_system||"None"}
Protagonist: ${concept.protagonist?.name||""} — ${concept.protagonist?.personality||""} — Goal: ${concept.protagonist?.goal||""}
Antagonist: ${concept.antagonist?.name||""} — ${concept.antagonist?.motivation||""}
Tone: ${concept.tone||""}
Themes: ${(concept.recurring_themes||[]).join(", ")}
Chapter Structure Formula: ${concept.chapter_structure||"Setup → Escalation → Cliffhanger"}`;

  for(let i = 0; i < count; i++){
    const chNum = startChapter + i;
    if(onProgress) onProgress(i+1, count, chNum);

    const prevSummaries = [...existingChapters, ...chapters].slice(-3).map(ch =>
      `Ch.${ch.number} "${ch.title}": ${ch.summary}`
    ).join("\n");

    const prompt = `You are a professional manga script writer. Write Chapter ${chNum} for this ${project.genre} ${project.format}.

${overarchingArc}

RECENT CHAPTERS (maintain continuity — do NOT contradict these):
${prevSummaries || "(This is the first chapter)"}

CHAPTER ${chNum} TASK:
Write a full, gripping chapter. Include:
- A punchy chapter title
- Scene-by-scene breakdown with panel descriptions (each scene = one or more panels)
- Character dialogue (realistic, genre-appropriate, NOT generic)
- Internal monologue for the MC when emotionally impactful
- At least one moment of tension, surprise, or emotional resonance
- End on a satisfying beat OR a cliffhanger (alternate every 2-3 chapters)
- Maintain strict character voice consistency

FORMAT your response as ONLY valid JSON:
{
  "title": "Chapter ${chNum}: [title]",
  "summary": "2-3 sentence plot summary for continuity tracking",
  "mood": "tense|action|romance|comedy|horror|emotional|mystery",
  "scenes": [
    {
      "scene_number": 1,
      "location": "Where this scene takes place",
      "time_of_day": "day/night/dusk/etc",
      "panel_count": 4,
      "panel_descriptions": ["Panel 1: ...", "Panel 2: ...", "Panel 3: ...", "Panel 4: ..."],
      "dialogue": [{"character":"Name","line":"dialogue text","tone":"aggressive|soft|shocked|etc"}],
      "internal_monologue": "MC's thoughts if applicable (or empty string)",
      "sfx": ["CRASH","SLAM"],
      "tension_level": 1
    }
  ],
  "chapter_end_type": "cliffhanger|resolution|twist|emotional",
  "next_chapter_setup": "What seeds are planted for Ch.${chNum+1}"
}`;

    try{
      const raw = await callGemini(prompt, 0.85);
      bump();
      const m = raw.match(/\{[\s\S]*\}/);
      if(!m) throw {code:"PARSE", chapter: chNum};
      let ch;try{ch=JSON.parse(m[0]);}catch(pe){throw{code:"PARSE",msg:`Malformed JSON for chapter ${chNum}`};}
      ch.number = chNum;
      ch.generated_at = new Date().toISOString();
      ch.art_style = project.art_style;
      chapters.push(ch);
    }catch(chErr){
      // Skip failed chapter but continue batch — caller sees partial results
      console.warn(`Chapter ${chNum} generation failed:`, chErr);
      chapters.push({number:chNum,title:`Chapter ${chNum}`,summary:"(generation failed — retry this chapter)",scenes:[],error:true,generated_at:new Date().toISOString()});
    }
  }
  return chapters;
}

// ─── Panel Image Generator ───────────────────────────────────────────────────
async function generatePanelImage(project, scene, panelDesc){
  const artStyle = ART_STYLES.find(a => a.id === (project.art_style || "manhwa-color"));
  const stylePrompt = artStyle?.prompt || "manhwa webtoon style, full color";
  const concept = project.concept || {};
  const protagonist = concept.protagonist || {};

  const fullPrompt = [
    stylePrompt,
    panelDesc,
    `scene at ${scene.location}, ${scene.time_of_day}`,
    protagonist.appearance ? `protagonist: ${protagonist.appearance}` : "",
    "manga panel composition, high quality, no text, no speech bubbles",
    "professional manga illustration"
  ].filter(Boolean).join(", ");

  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(fullPrompt)}?width=1024&height=1024&model=flux&nologo=true&seed=${Math.floor(Math.random()*99999)}`;
  return url;
}

// ══════════════════════════════════════════════════════════════════════════════
// MANGA HOME PAGE
// ══════════════════════════════════════════════════════════════════════════════
function MangaHomePage({navigate, onSettings}){
  const [projects, setProjects] = useState(getMangaProjects());
  const [view, setView] = useState("library"); // library | create | research
  const [researchGenre, setResearchGenre] = useState(null);
  const [researchData, setResearchData] = useState(null);
  const [researchLoading, setResearchLoading] = useState(false);
  const [search, setSearch] = useState("");

  const reload = () => setProjects(getMangaProjects());

  const deleteProject = (id) => {
    if(!confirm("Delete this manga project? This cannot be undone.")) return;
    deleteMangaProject(id);
    reload();
  };

  const filtered = projects.filter(p =>
    !search || p.title?.toLowerCase().includes(search.toLowerCase()) || p.genre?.toLowerCase().includes(search.toLowerCase())
  );

  if(view === "create") return <MangaCreateWizard navigate={navigate} onSettings={onSettings} onBack={() => setView("library")} onCreated={() => { reload(); setView("library"); }}/>;

  return(
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
      {/* Header bar */}
      <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="text-white text-2xl font-bold">🎌 Manga Studio</h1>
          <p className="text-white/40 text-sm mt-1">AI-powered manga & manhwa creator — from concept to chapters with AI art</p>
        </div>
        <button onClick={() => setView("create")} className="bg-gradient-to-r from-pink-500 to-purple-500 text-white px-5 py-2.5 rounded-xl font-semibold hover:opacity-90 flex items-center gap-2 text-sm shrink-0">
          + New Project
        </button>
      </div>

      {/* Stats */}
      {projects.length > 0 && (
        <div className="grid grid-cols-3 gap-3 mb-6">
          <div className="bg-white/5 border border-white/10 rounded-xl p-3 text-center"><p className="text-white text-xl font-bold">{projects.length}</p><p className="text-white/30 text-xs">Projects</p></div>
          <div className="bg-white/5 border border-white/10 rounded-xl p-3 text-center"><p className="text-white text-xl font-bold">{projects.reduce((a,p)=>(a+(p.chapters?.length||0)),0)}</p><p className="text-white/30 text-xs">Chapters</p></div>
          <div className="bg-white/5 border border-white/10 rounded-xl p-3 text-center"><p className="text-white text-xl font-bold">{projects.reduce((a,p)=>(a+(p.chapters?.reduce((b,c)=>b+(c.scenes?.length||0),0)||0)),0)}</p><p className="text-white/30 text-xs">Scenes</p></div>
        </div>
      )}

      {/* Search */}
      {projects.length > 2 && (
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search projects…" className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-2.5 text-white placeholder-white/30 focus:outline-none focus:border-purple-500 text-sm mb-4"/>
      )}

      {/* Empty state */}
      {projects.length === 0 && (
        <div className="text-center py-20">
          <div className="text-6xl mb-4">🎌</div>
          <h2 className="text-white text-xl font-bold mb-2">Start Your Manga</h2>
          <p className="text-white/40 text-sm mb-6 max-w-md mx-auto">Generate a full series concept, draft chapters with AI, and get panel art — all in one place.</p>
          <button onClick={() => setView("create")} className="bg-gradient-to-r from-pink-500 to-purple-500 text-white px-8 py-3 rounded-xl font-semibold hover:opacity-90">✨ Create First Project</button>
        </div>
      )}

      {/* Project Grid */}
      {filtered.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(p => {
            const genre = MANGA_GENRES.find(g => g.id === p.genre);
            const chCount = p.chapters?.length || 0;
            const lastCh = p.chapters?.slice(-1)[0];
            return(
              <div key={p.id} className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden hover:border-white/25 transition-all group">
                {/* Cover */}
                <div className={`h-32 bg-gradient-to-br ${genre?.color||"from-purple-500 to-pink-500"} relative flex items-center justify-center`}>
                  {p.cover_url ? (
                    <img src={p.cover_url} alt="" className="w-full h-full object-cover"/>
                  ) : (
                    <span className="text-5xl opacity-60">🎌</span>
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent"/>
                  <div className="absolute bottom-2 left-3 right-3">
                    <span className="text-white/70 text-xs">{p.format?.toUpperCase()} · {p.art_style}</span>
                  </div>
                </div>
                {/* Info */}
                <div className="p-4">
                  <h3 className="text-white font-bold text-sm leading-tight mb-1 line-clamp-2">{p.title}</h3>
                  <p className="text-white/40 text-xs mb-1">{genre?.label}</p>
                  <p className="text-white/30 text-xs line-clamp-2 mb-3">{p.concept?.logline||p.concept?.synopsis?.slice(0,80)||""}</p>
                  <div className="flex items-center justify-between">
                    <span className="text-purple-300/70 text-xs">{chCount} chapter{chCount!==1?"s":""}</span>
                    {lastCh && <span className="text-white/20 text-xs">Last: Ch.{lastCh.number}</span>}
                  </div>
                  <div className="flex gap-2 mt-3">
                    <button onClick={() => navigate("manga-editor", p.id)} className="flex-1 bg-gradient-to-r from-pink-500 to-purple-500 text-white py-2 rounded-lg text-xs font-semibold hover:opacity-90">Open Studio →</button>
                    <button onClick={() => deleteProject(p.id)} className="w-8 h-8 rounded-lg bg-red-500/10 text-red-400/60 hover:bg-red-500/20 text-xs flex items-center justify-center">🗑</button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// MANGA CREATE WIZARD
// ══════════════════════════════════════════════════════════════════════════════
function MangaCreateWizard({navigate, onSettings, onBack, onCreated}){
  const [step, setStep] = useState(1); // 1=format, 2=genre+niche, 3=details, 4=generating
  const [format, setFormat] = useState("manhwa");
  const [genre, setGenre] = useState("");
  const [artStyle, setArtStyle] = useState("manhwa-color");
  const [userIdea, setUserIdea] = useState("");
  const [targetAudience, setTargetAudience] = useState("Young Adults (18-25)");
  const [useResearch, setUseResearch] = useState(false);
  const [researchData, setResearchData] = useState(null);
  const [researchLoading, setResearchLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [genStatus, setGenStatus] = useState("");
  const [error, setError] = useState("");
  const [usage, setUsage] = useState(getUsage());

  const key = getKey();

  const runResearch = async () => {
    if(!key){ onSettings(); return; }
    if(getUsage() >= DAILY_LIMIT){ setError("Daily quota reached."); return; }
    setResearchLoading(true); setError("");
    try{
      const data = await runMangaResearch(() => { trackUsage(); setUsage(getUsage()); }, MANGA_GENRES.find(g=>g.id===genre)?.label || genre);
      setResearchData(data);
    } catch(e){ setError(errMsg(e)); }
    finally{ setResearchLoading(false); }
  };

  const create = async () => {
    if(!key){ onSettings(); return; }
    if(getUsage() >= DAILY_LIMIT){ setError("Daily quota reached."); return; }
    setStep(4); setGenerating(true); setGenStatus("🧠 Crafting series concept…"); setError("");
    try{
      const concept = await generateMangaConcept(
        () => { trackUsage(); setUsage(getUsage()); },
        { genre: MANGA_GENRES.find(g=>g.id===genre)?.label || genre, format, artStyle: ART_STYLES.find(a=>a.id===artStyle)?.label || artStyle, userIdea, targetAudience }
      );

      setGenStatus("🎨 Generating cover image…");
      const coverPrompt = ART_STYLES.find(a=>a.id===artStyle)?.prompt || "manhwa style";
      const cover_url = `https://image.pollinations.ai/prompt/${encodeURIComponent(coverPrompt+", "+concept.title+", manga cover art, dramatic composition, professional, no text")}?width=800&height=1200&model=flux&nologo=true&seed=${Date.now()%99999}`;

      const project = {
        id: "manga_" + Date.now(),
        title: concept.title,
        subtitle: concept.subtitle || "",
        genre,
        format,
        art_style: artStyle,
        target_audience: targetAudience,
        concept,
        cover_url,
        chapters: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        research: researchData || null,
      };
      saveMangaProject(project);
      setGenStatus("✅ Project created!");
      setTimeout(() => { onCreated(); navigate("manga-editor", project.id); }, 800);
    } catch(e){
      setError(errMsg(e));
      setGenerating(false);
      setStep(3);
    }
  };

  return(
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
      <button onClick={onBack} className="text-white/40 hover:text-white text-sm mb-6">← Back to Manga Studio</button>

      {/* Step indicator */}
      <div className="flex items-center gap-2 mb-8">
        {[1,2,3].map(s => (
          <div key={s} className="flex items-center gap-2">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold border-2 transition-all ${step>=s?"bg-purple-500 border-purple-500 text-white":"border-white/20 text-white/30"}`}>{s}</div>
            {s<3&&<div className={`h-0.5 w-12 sm:w-24 rounded ${step>s?"bg-purple-500":"bg-white/10"}`}/>}
          </div>
        ))}
        <span className="text-white/40 text-xs ml-2">{step===1?"Format":step===2?"Genre":step===3?"Details":"Creating…"}</span>
      </div>

      {/* STEP 1: Format */}
      {step===1&&(
        <div>
          <h2 className="text-white text-xl font-bold mb-2">Choose your format</h2>
          <p className="text-white/40 text-sm mb-6">This affects layout style, reading direction, and art generation prompts.</p>
          <div className="space-y-3 mb-8">
            {MANGA_FORMATS.map(f => (
              <button key={f.id} onClick={() => setFormat(f.id)} className={`w-full p-4 rounded-2xl border-2 text-left transition-all ${format===f.id?"border-purple-500 bg-purple-500/15":"border-white/10 bg-white/5 hover:border-white/25"}`}>
                <p className="text-white font-semibold">{f.label}</p>
                <p className="text-white/50 text-sm mt-0.5">{f.desc}</p>
              </button>
            ))}
          </div>
          <button onClick={() => setStep(2)} className="w-full bg-gradient-to-r from-pink-500 to-purple-500 text-white py-3.5 rounded-xl font-semibold hover:opacity-90">Next: Choose Genre →</button>
        </div>
      )}

      {/* STEP 2: Genre */}
      {step===2&&(
        <div>
          <h2 className="text-white text-xl font-bold mb-2">Pick your genre</h2>
          <p className="text-white/40 text-sm mb-6">Select the genre that fits your story. You can refine it with your own idea in the next step.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
            {MANGA_GENRES.map(g => (
              <button key={g.id} onClick={() => setGenre(g.id)} className={`p-4 rounded-2xl border-2 text-left transition-all ${genre===g.id?"border-purple-500 bg-purple-500/15":"border-white/10 bg-white/5 hover:border-white/25"}`}>
                <p className="text-white font-semibold text-sm">{g.label}</p>
                <p className="text-white/40 text-xs mt-1 leading-relaxed">{g.desc}</p>
              </button>
            ))}
          </div>
          <div className="flex gap-3">
            <button onClick={() => setStep(1)} className="border border-white/20 text-white/50 px-6 py-3 rounded-xl hover:bg-white/5">← Back</button>
            <button onClick={() => setStep(3)} disabled={!genre} className="flex-1 bg-gradient-to-r from-pink-500 to-purple-500 text-white py-3 rounded-xl font-semibold hover:opacity-90 disabled:opacity-40">Next: Details →</button>
          </div>
        </div>
      )}

      {/* STEP 3: Details + Research */}
      {step===3&&(
        <div className="space-y-5">
          <h2 className="text-white text-xl font-bold">Story details</h2>

          {/* Research agent toggle */}
          <div className="bg-gradient-to-r from-cyan-900/40 to-blue-900/40 border border-cyan-500/30 rounded-2xl p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-white font-semibold text-sm">🔬 Market Research Agent</p>
                <p className="text-white/50 text-xs mt-1">Analyzes top-performing niches in {MANGA_GENRES.find(g=>g.id===genre)?.label} — shows what's trending, what readers want, and what to avoid.</p>
              </div>
              {!researchData ? (
                <button onClick={runResearch} disabled={researchLoading} className="bg-cyan-500/20 border border-cyan-500/30 text-cyan-300 px-3 py-1.5 rounded-lg text-xs font-semibold hover:bg-cyan-500/30 disabled:opacity-50 whitespace-nowrap shrink-0">
                  {researchLoading ? <><Spin/> Analyzing…</> : "🔬 Run Research"}
                </button>
              ) : (
                <span className="text-green-400 text-xs shrink-0">✅ Done</span>
              )}
            </div>
            {researchData && (
              <div className="mt-4 space-y-3">
                <p className="text-white/60 text-xs leading-relaxed">{researchData.market_summary}</p>
                <div>
                  <p className="text-cyan-300/70 text-xs font-semibold mb-2 uppercase tracking-wider">Top Niches Right Now</p>
                  <div className="space-y-2">
                    {(researchData.top_niches||[]).slice(0,3).map((n,i) => (
                      <div key={i} className="bg-white/5 rounded-xl p-3">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-white text-xs font-semibold">{n.name}</span>
                          <span className={`text-xs px-1.5 py-0.5 rounded-full ${n.competition==="low"?"bg-green-500/20 text-green-300":n.competition==="medium"?"bg-amber-500/20 text-amber-300":"bg-red-500/20 text-red-300"}`}>{n.competition} competition</span>
                        </div>
                        <p className="text-white/40 text-xs">{n.why}</p>
                        <p className="text-purple-300/60 text-xs mt-1">Readers want: {n.reader_craving}</p>
                      </div>
                    ))}
                  </div>
                </div>
                {researchData.trending_tropes?.length > 0 && (
                  <div>
                    <p className="text-cyan-300/70 text-xs font-semibold mb-1 uppercase tracking-wider">Trending Tropes ✅</p>
                    <div className="flex flex-wrap gap-1.5">{researchData.trending_tropes.map((t,i)=><span key={i} className="bg-purple-500/20 text-purple-300 text-xs px-2 py-0.5 rounded-full">{t}</span>)}</div>
                  </div>
                )}
                {researchData.avoid_tropes?.length > 0 && (
                  <div>
                    <p className="text-red-300/70 text-xs font-semibold mb-1 uppercase tracking-wider">Avoid These ❌</p>
                    <div className="flex flex-wrap gap-1.5">{researchData.avoid_tropes.map((t,i)=><span key={i} className="bg-red-500/10 text-red-400/60 text-xs px-2 py-0.5 rounded-full">{t}</span>)}</div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Your idea */}
          <div>
            <label className="text-white/60 text-xs uppercase tracking-wider block mb-2">Your Story Idea (optional)</label>
            <textarea value={userIdea} onChange={e=>setUserIdea(e.target.value)} rows={4} placeholder="Describe your concept, characters, setting, or specific plot ideas. Leave blank and the AI will create a fresh concept based on your genre and research." className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white placeholder-white/25 focus:outline-none focus:border-purple-500 text-sm resize-none leading-relaxed"/>
          </div>

          {/* Art style */}
          <div>
            <label className="text-white/60 text-xs uppercase tracking-wider block mb-2">Art Style</label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {ART_STYLES.map(a => (
                <button key={a.id} onClick={() => setArtStyle(a.id)} className={`p-3 rounded-xl border text-center text-xs transition-all ${artStyle===a.id?"border-purple-500 bg-purple-500/20 text-white":"border-white/10 bg-white/5 text-white/50 hover:border-white/25"}`}>
                  {a.label}
                </button>
              ))}
            </div>
          </div>

          {/* Target audience */}
          <div>
            <label className="text-white/60 text-xs uppercase tracking-wider block mb-2">Target Audience</label>
            <select value={targetAudience} onChange={e=>setTargetAudience(e.target.value)} className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-purple-500 text-sm">
              {["Teens (13-17)","Young Adults (18-25)","Adults (25-35)","General (All Ages)","Mature (18+)"].map(a=><option key={a} value={a}>{a}</option>)}
            </select>
          </div>

          {error && <div className="bg-red-500/20 border border-red-500/30 text-red-300 rounded-xl p-3 text-sm">{error}</div>}

          <div className="flex gap-3">
            <button onClick={() => setStep(2)} className="border border-white/20 text-white/50 px-6 py-3 rounded-xl hover:bg-white/5">← Back</button>
            <button onClick={create} disabled={!genre} className="flex-1 bg-gradient-to-r from-pink-500 to-purple-500 text-white py-3 rounded-xl font-semibold hover:opacity-90 disabled:opacity-40 flex items-center justify-center gap-2">
              ✨ Generate Series Concept
            </button>
          </div>
        </div>
      )}

      {/* STEP 4: Generating */}
      {step===4&&(
        <div className="text-center py-20">
          <div className="text-6xl mb-4 animate-bounce">🎌</div>
          <h2 className="text-white text-xl font-bold mb-3">{genStatus}</h2>
          <p className="text-white/40 text-sm">Building your series concept, characters, and arc…</p>
          {error && <div className="mt-6 bg-red-500/20 border border-red-500/30 text-red-300 rounded-xl p-3 text-sm max-w-md mx-auto">{error}</div>}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// MANGA EDITOR PAGE
// ══════════════════════════════════════════════════════════════════════════════
function MangaEditorPage({projectId, navigate, onSettings}){
  const [project, setProject] = useState(getMangaProject(projectId));
  const [tab, setTab] = useState(0); // 0=bible, 1=chapters, 2=chapter-view, 3=write
  const [viewingChapter, setViewingChapter] = useState(null);
  const [writing, setWriting] = useState(false);
  const [writeLog, setWriteLog] = useState([]);
  const [chapterCount, setChapterCount] = useState(1);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [generatingPanels, setGeneratingPanels] = useState({});
  const [usage, setUsage] = useState(getUsage());
  const cancelRef = useRef(false);

  if(!project) return <div className="text-center py-20 text-white/40">Project not found.</div>;

  const reload = () => { const p = getMangaProject(projectId); if(p) setProject(p); };
  const save = (updates) => { const p = {...getMangaProject(projectId)||project, ...updates, updated_at: new Date().toISOString()}; saveMangaProject(p); setProject(p); };
  const addLog = msg => setWriteLog(prev => [{msg, time: new Date().toLocaleTimeString()}, ...prev.slice(0,99)]);
  const flash = (msg, isErr=false) => { if(isErr) setError(msg); else setSuccess(msg); setTimeout(()=>{ setError(""); setSuccess(""); }, 4000); };

  const concept = project.concept || {};
  const chapters = project.chapters || [];
  const lastChNum = chapters.length > 0 ? Math.max(...chapters.map(c => c.number||0)) : 0;

  const writeChapters = async () => {
    if(!getKey()){ onSettings(); return; }
    if(getUsage() >= DAILY_LIMIT){ flash("Daily quota reached.", true); return; }
    cancelRef.current = false;
    setWriting(true); setWriteLog([]); setError("");
    try{
      const startCh = lastChNum + 1;
      addLog(`🚀 Writing ${chapterCount} chapter(s) starting from Ch.${startCh}…`);
      const newChapters = await generateMangaChapters(
        () => { trackUsage(); setUsage(getUsage()); },
        project,
        startCh,
        chapterCount,
        (i, total, num) => addLog(`📝 Writing Chapter ${num} (${i}/${total})…`)
      );
      const allChapters = [...(project.chapters||[]), ...newChapters];
      save({ chapters: allChapters });
      addLog(`✅ Done! ${newChapters.length} chapter(s) added.`);
      flash(`✅ ${newChapters.length} chapter${newChapters.length!==1?"s":""} written!`);
      setTab(1);
    } catch(e){
      flash(errMsg(e), true);
      addLog("❌ Error: " + errMsg(e));
    } finally { setWriting(false); }
  };

  const generatePanelArt = async (chapterIdx, sceneIdx, panelDesc) => {
    const key = `${chapterIdx}-${sceneIdx}`;
    setGeneratingPanels(prev => ({...prev, [key]: true}));
    try{
      const ch = chapters[chapterIdx];
      const scene = ch.scenes[sceneIdx];
      const url = await generatePanelImage(project, scene, panelDesc);
      // Store art url in project
      const newChapters = [...chapters];
      if(!newChapters[chapterIdx].panel_art) newChapters[chapterIdx].panel_art = {};
      newChapters[chapterIdx].panel_art[`${sceneIdx}`] = url;
      save({ chapters: newChapters });
    } catch(e){ flash("Panel art failed: " + e.message, true); }
    finally { setGeneratingPanels(prev => ({...prev, [key]: false})); }
  };

  const deleteChapter = (num) => {
    if(!confirm(`Delete Chapter ${num}?`)) return;
    save({ chapters: chapters.filter(c => c.number !== num) });
    if(viewingChapter?.number === num){ setViewingChapter(null); setTab(1); }
  };

  const exportScript = () => {
    const lines = [];
    lines.push(`MANGA SCRIPT: ${project.title}`);
    lines.push(`Format: ${project.format?.toUpperCase()} | Genre: ${project.genre} | Art: ${project.art_style}`);
    lines.push("=".repeat(60));
    lines.push("");
    lines.push("SERIES BIBLE");
    lines.push("-".repeat(40));
    lines.push(`Logline: ${concept.logline||""}`);
    lines.push(`Synopsis: ${concept.synopsis||""}`);
    lines.push(`Protagonist: ${concept.protagonist?.name||""} — ${concept.protagonist?.personality||""}`);
    lines.push(`Series Arc: ${concept.series_arc||""}`);
    lines.push("");
    chapters.forEach(ch => {
      lines.push("=".repeat(60));
      lines.push(ch.title || `Chapter ${ch.number}`);
      lines.push(`Summary: ${ch.summary||""}`);
      lines.push(`Mood: ${ch.mood||""} | Ending: ${ch.chapter_end_type||""}`);
      lines.push("");
      (ch.scenes||[]).forEach(scene => {
        lines.push(`SCENE ${scene.scene_number} — ${scene.location} [${scene.time_of_day}] — ${scene.panel_count} panels`);
        (scene.panel_descriptions||[]).forEach((p,i) => lines.push(`  Panel ${i+1}: ${p}`));
        if(scene.dialogue?.length > 0){
          lines.push("  DIALOGUE:");
          scene.dialogue.forEach(d => lines.push(`    ${d.character}: "${d.line}" [${d.tone}]`));
        }
        if(scene.internal_monologue) lines.push(`  MONOLOGUE: ${scene.internal_monologue}`);
        if(scene.sfx?.length > 0) lines.push(`  SFX: ${scene.sfx.join(", ")}`);
        lines.push("");
      });
      if(ch.next_chapter_setup) lines.push(`→ Seeds for Ch.${ch.number+1}: ${ch.next_chapter_setup}`);
      lines.push("");
    });
    const blob = new Blob([lines.join("\n")], {type:"text/plain"});
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${(project.title||"manga").replace(/[^a-z0-9]/gi,"_")}_script.txt`;
    a.click();
    flash("Script downloaded!");
  };

  const MANGA_TABS = ["📖 Series Bible","📋 Chapters","✍️ Write","🖼️ Gallery","📤 Export"];

  return(
    <div className="min-h-screen">
      {/* Tab bar */}
      <div className="border-b border-white/10 bg-black/20 sticky top-[57px] z-10">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 flex gap-1 overflow-x-auto">
          {MANGA_TABS.map((t,i) => (
            <button key={i} onClick={() => { setTab(i); if(i!==2) setViewingChapter(null); }} className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap rounded-t-lg transition-all ${tab===i?"bg-white/10 text-white border-b-2 border-pink-500":"text-white/35 hover:text-white/70"}`}>{t}</button>
          ))}
          <div className="flex-1"/>
          <button onClick={exportScript} className="text-xs border border-white/20 text-white/40 px-3 py-2 my-1 rounded-lg hover:bg-white/5 whitespace-nowrap">⬇ Export Script</button>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
        {error&&<div className="bg-red-500/20 border border-red-500/30 text-red-300 rounded-xl p-3 mb-4 text-sm">{error}</div>}
        {success&&<div className="bg-green-500/20 border border-green-500/30 text-green-300 rounded-xl p-3 mb-4 text-sm">{success}</div>}

        {/* ── TAB 0: Series Bible ── */}
        {tab===0&&(
          <div className="max-w-3xl mx-auto space-y-5">
            <div className="flex items-center gap-4">
              {project.cover_url&&<img src={project.cover_url} alt="" className="w-24 h-36 object-cover rounded-xl border border-white/10"/>}
              <div>
                <h2 className="text-white text-2xl font-bold">{project.title}</h2>
                {concept.subtitle&&<p className="text-purple-300 text-sm mt-0.5">{concept.subtitle}</p>}
                {concept.logline&&<p className="text-white/50 text-sm mt-2 italic">"{concept.logline}"</p>}
                <div className="flex flex-wrap gap-2 mt-3">
                  {(concept.genre_tags||[]).map((t,i)=><span key={i} className="bg-pink-500/20 text-pink-300 text-xs px-2 py-0.5 rounded-full border border-pink-500/20">{t}</span>)}
                  <span className="bg-white/10 text-white/40 text-xs px-2 py-0.5 rounded-full">{project.format}</span>
                </div>
              </div>
            </div>

            {concept.synopsis&&<Card><h3 className="text-white font-semibold mb-2">📖 Synopsis</h3><p className="text-white/60 text-sm leading-relaxed whitespace-pre-line">{concept.synopsis}</p></Card>}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {concept.protagonist&&<Card>
                <h3 className="text-white font-semibold mb-3">🦸 Protagonist</h3>
                <div className="space-y-2">
                  <div className="flex justify-between"><span className="text-white/40 text-xs">Name</span><span className="text-white text-sm font-medium">{concept.protagonist.name}</span></div>
                  <div className="flex justify-between"><span className="text-white/40 text-xs">Age</span><span className="text-white text-sm">{concept.protagonist.age}</span></div>
                  <p className="text-white/50 text-xs leading-relaxed border-t border-white/10 pt-2 mt-2">{concept.protagonist.personality}</p>
                  {concept.protagonist.goal&&<p className="text-purple-300/70 text-xs"><strong>Goal:</strong> {concept.protagonist.goal}</p>}
                  {concept.protagonist.flaw&&<p className="text-red-300/60 text-xs"><strong>Flaw:</strong> {concept.protagonist.flaw}</p>}
                  {concept.protagonist.power_or_skill&&<p className="text-cyan-300/70 text-xs"><strong>Power:</strong> {concept.protagonist.power_or_skill}</p>}
                </div>
              </Card>}

              {concept.antagonist&&<Card>
                <h3 className="text-white font-semibold mb-3">🦹 Antagonist</h3>
                <div className="space-y-2">
                  <div className="flex justify-between"><span className="text-white/40 text-xs">Name</span><span className="text-white text-sm font-medium">{concept.antagonist.name}</span></div>
                  <div className="flex justify-between"><span className="text-white/40 text-xs">Role</span><span className="text-white text-sm">{concept.antagonist.role}</span></div>
                  {concept.antagonist.motivation&&<p className="text-amber-300/70 text-xs border-t border-white/10 pt-2 mt-2"><strong>Motivation:</strong> {concept.antagonist.motivation}</p>}
                </div>
              </Card>}
            </div>

            {concept.supporting_cast?.length>0&&<Card>
              <h3 className="text-white font-semibold mb-3">👥 Supporting Cast</h3>
              <div className="space-y-2">
                {concept.supporting_cast.map((c,i)=>(
                  <div key={i} className="flex gap-3 items-start">
                    <div className="w-6 h-6 bg-white/10 rounded-full flex items-center justify-center text-xs text-white/40 shrink-0">{i+1}</div>
                    <div><p className="text-white text-sm font-medium">{c.name} <span className="text-white/30 font-normal">({c.role})</span></p><p className="text-white/40 text-xs">{c.brief}</p></div>
                  </div>
                ))}
              </div>
            </Card>}

            {concept.setting&&<Card><h3 className="text-white font-semibold mb-2">🌍 World & Setting</h3><p className="text-white/60 text-sm leading-relaxed">{concept.setting}</p></Card>}
            {concept.power_system&&concept.power_system!=="None"&&<Card><h3 className="text-white font-semibold mb-2">⚡ Power System</h3><p className="text-white/60 text-sm leading-relaxed">{concept.power_system}</p></Card>}
            {concept.series_arc&&<Card><h3 className="text-white font-semibold mb-2">🗺️ Series Arc</h3><p className="text-white/60 text-sm leading-relaxed">{concept.series_arc}</p><p className="text-purple-300/60 text-xs mt-2">Est. chapters: {concept.estimated_chapters}</p></Card>}

            {concept.chapter_one_hook&&<div className="bg-gradient-to-r from-pink-900/50 to-purple-900/40 border border-pink-500/30 rounded-2xl p-5">
              <p className="text-white/40 text-xs uppercase tracking-wider mb-2">Chapter 1 Hook</p>
              <p className="text-white text-sm leading-relaxed italic">"{concept.chapter_one_hook}"</p>
            </div>}

            {project.research&&<Card>
              <h3 className="text-white font-semibold mb-2">🔬 Market Research Snapshot</h3>
              <p className="text-white/50 text-xs leading-relaxed mb-2">{project.research.market_summary}</p>
              {project.research.hook_formula&&<p className="text-cyan-300/70 text-xs"><strong>Hook formula:</strong> {project.research.hook_formula}</p>}
              {project.research.monetization_tip&&<p className="text-amber-300/70 text-xs mt-1"><strong>Monetization:</strong> {project.research.monetization_tip}</p>}
            </Card>}
          </div>
        )}

        {/* ── TAB 1: Chapters ── */}
        {tab===1&&(
          <div className="max-w-4xl mx-auto">
            {chapters.length===0?(
              <div className="text-center py-16">
                <div className="text-5xl mb-4">✍️</div>
                <h3 className="text-white font-semibold mb-2">No chapters yet</h3>
                <p className="text-white/40 text-sm mb-6">Head to the Write tab to generate your first chapter.</p>
                <button onClick={()=>setTab(2)} className="bg-gradient-to-r from-pink-500 to-purple-500 text-white px-6 py-2.5 rounded-xl font-semibold hover:opacity-90 text-sm">✍️ Write Chapters →</button>
              </div>
            ):(
              <div className="space-y-3">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-white font-bold text-lg">{chapters.length} Chapter{chapters.length!==1?"s":""}</h2>
                  <button onClick={()=>setTab(2)} className="bg-gradient-to-r from-pink-500 to-purple-500 text-white px-4 py-2 rounded-xl font-semibold hover:opacity-90 text-sm">+ Write More</button>
                </div>
                {chapters.map((ch,idx) => (
                  <div key={idx} className="bg-white/5 border border-white/10 rounded-2xl p-4 hover:border-white/20 transition-all">
                    <div className="flex items-start gap-4">
                      <div className="w-10 h-10 bg-gradient-to-br from-pink-500 to-purple-500 rounded-xl flex items-center justify-center text-white font-bold text-sm shrink-0">{ch.number}</div>
                      <div className="flex-1 min-w-0">
                        <h3 className="text-white font-semibold text-sm">{ch.title||`Chapter ${ch.number}`}</h3>
                        <p className="text-white/40 text-xs mt-1 line-clamp-2">{ch.summary}</p>
                        <div className="flex items-center gap-3 mt-2">
                          <span className="text-white/25 text-xs">{ch.scenes?.length||0} scenes</span>
                          <span className="text-white/25 text-xs">·</span>
                          <span className={`text-xs px-2 py-0.5 rounded-full ${ch.mood==="action"?"bg-orange-500/20 text-orange-300":ch.mood==="romance"?"bg-pink-500/20 text-pink-300":ch.mood==="tense"?"bg-red-500/20 text-red-300":"bg-white/10 text-white/40"}`}>{ch.mood}</span>
                          <span className="text-white/25 text-xs">·</span>
                          <span className="text-white/30 text-xs">{ch.chapter_end_type}</span>
                        </div>
                      </div>
                      <div className="flex gap-2 shrink-0">
                        <button onClick={() => { setViewingChapter(ch); setTab(3); }} className="text-xs border border-white/20 text-white/50 px-3 py-1.5 rounded-lg hover:bg-white/5">View →</button>
                        <button onClick={() => deleteChapter(ch.number)} className="w-7 h-7 rounded-lg bg-red-500/10 text-red-400/50 hover:bg-red-500/20 text-xs flex items-center justify-center">×</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── TAB 2: Write ── */}
        {tab===2&&(
          <div className="max-w-3xl mx-auto space-y-5">
            <Card>
              <h2 className="text-white text-xl font-bold mb-1">✍️ Write Chapters</h2>
              <p className="text-white/40 text-sm mb-5">AI writes full manga chapters with scene breakdowns, panel descriptions, and dialogue — maintaining the full story arc and character voices.</p>

              <div className="bg-white/5 border border-white/10 rounded-xl p-4 mb-5">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-white/60 text-sm">Next chapter: <span className="text-white font-bold">Ch.{lastChNum+1}</span></p>
                  <span className="text-white/30 text-xs">{chapters.length} written so far</span>
                </div>
                {chapters.length > 0 && (
                  <p className="text-white/30 text-xs">Last chapter: "{chapters.slice(-1)[0]?.title}" — {chapters.slice(-1)[0]?.chapter_end_type}</p>
                )}
              </div>

              {/* Chapter count selector */}
              <div className="mb-5">
                <label className="text-white/60 text-xs uppercase tracking-wider block mb-3">How many chapters to write at once?</label>
                <div className="grid grid-cols-5 gap-2">
                  {[1,2,3,5,10].map(n => (
                    <button key={n} onClick={() => setChapterCount(n)} className={`py-3 rounded-xl border text-center font-bold text-sm transition-all ${chapterCount===n?"border-pink-500 bg-pink-500/20 text-white":"border-white/10 bg-white/5 text-white/40 hover:border-white/25"}`}>
                      {n}
                    </button>
                  ))}
                </div>
                <p className="text-white/25 text-xs mt-2 text-center">Writing {chapterCount} chapter{chapterCount!==1?"s":""} = ~{chapterCount} Gemini requests</p>
              </div>

              {/* Story context badge */}
              <div className="bg-cyan-500/10 border border-cyan-500/20 rounded-xl p-3 mb-4 text-xs text-cyan-300/70">
                <strong className="text-cyan-300">AI Memory:</strong> Full series bible + last {Math.min(3,chapters.length)} chapter summaries are injected into every generation. Characters, power systems, and arc stay consistent automatically.
              </div>

              {getUsage() >= DAILY_LIMIT && (
                <div className="bg-amber-500/20 border border-amber-500/30 text-amber-300 rounded-xl p-3 mb-4 text-sm">⏳ Daily quota reached — come back tomorrow to continue writing.</div>
              )}

              {!writing ? (
                <button onClick={writeChapters} disabled={getUsage()>=DAILY_LIMIT} className="w-full bg-gradient-to-r from-pink-500 to-purple-500 text-white py-4 rounded-xl font-semibold hover:opacity-90 disabled:opacity-40 text-base flex items-center justify-center gap-2">
                  ✨ Write {chapterCount} Chapter{chapterCount!==1?"s":""}
                </button>
              ) : (
                <button onClick={() => { cancelRef.current = true; }} className="w-full bg-red-500/20 border border-red-500/30 text-red-300 py-4 rounded-xl font-semibold hover:bg-red-500/30 flex items-center justify-center gap-2">
                  <Spin/> Writing… (click to cancel)
                </button>
              )}
            </Card>

            {/* Write log */}
            {writeLog.length > 0 && (
              <Card>
                <h3 className="text-white font-semibold mb-3 text-sm">Generation Log</h3>
                <div className="space-y-1 max-h-48 overflow-y-auto">
                  {writeLog.map((e,i) => (
                    <div key={i} className="flex gap-2 text-xs">
                      <span className="text-white/20 shrink-0">{e.time}</span>
                      <span className="text-white/60">{e.msg}</span>
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </div>
        )}

        {/* ── TAB 3: Chapter Viewer ── */}
        {tab===3&&(
          <div className="max-w-3xl mx-auto">
            {!viewingChapter ? (
              <div className="text-center py-16">
                <p className="text-white/40">Select a chapter from the Chapters tab to view it here.</p>
                <button onClick={()=>setTab(1)} className="mt-4 text-purple-400 hover:text-purple-300 text-sm">← Back to chapters</button>
              </div>
            ) : (
              <div className="space-y-6">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <button onClick={()=>setTab(1)} className="text-white/40 hover:text-white text-xs mb-2">← All Chapters</button>
                    <h2 className="text-white text-xl font-bold">{viewingChapter.title}</h2>
                    <div className="flex gap-2 mt-1">
                      <span className={`text-xs px-2 py-0.5 rounded-full bg-white/10 text-white/40`}>{viewingChapter.mood}</span>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-white/10 text-white/40">{viewingChapter.chapter_end_type}</span>
                    </div>
                  </div>
                </div>

                {viewingChapter.summary&&<div className="bg-white/5 border border-white/10 rounded-xl p-4"><p className="text-white/60 text-sm italic">"{viewingChapter.summary}"</p></div>}

                {(viewingChapter.scenes||[]).map((scene,si) => {
                  const panelArtUrl = viewingChapter.panel_art?.[`${chapters.findIndex(c=>c.number===viewingChapter.number)}-${si}`];
                  const chIdx = chapters.findIndex(c=>c.number===viewingChapter.number);
                  const genKey = `${chIdx}-${si}`;
                  const isGenning = generatingPanels[genKey];
                  return(
                    <div key={si} className="bg-white/5 border border-white/10 rounded-2xl p-5">
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="text-white font-semibold text-sm">Scene {scene.scene_number} — {scene.location}</h3>
                        <span className="text-white/30 text-xs">{scene.time_of_day} · {scene.panel_count} panels</span>
                      </div>

                      {/* Panel Art */}
                      <div className="mb-4">
                        {panelArtUrl ? (
                          <div className="relative">
                            <img src={panelArtUrl} alt="" className="w-full max-w-sm mx-auto rounded-xl border border-white/10"/>
                            <button onClick={() => generatePanelArt(chIdx, si, scene.panel_descriptions?.[0]||scene.location)} disabled={isGenning} className="mt-2 text-xs border border-white/20 text-white/30 px-3 py-1 rounded-lg hover:bg-white/5 block mx-auto">
                              {isGenning ? <><Spin/> Regenerating…</> : "🔄 Regenerate Art"}
                            </button>
                          </div>
                        ) : (
                          <button onClick={() => generatePanelArt(chIdx, si, scene.panel_descriptions?.[0]||scene.location)} disabled={isGenning} className="w-full border-2 border-dashed border-white/10 rounded-xl py-8 text-center hover:border-white/25 transition-all">
                            {isGenning ? <><Spin className="mx-auto"/> <p className="text-white/30 text-xs mt-2">Generating panel art…</p></> : <><p className="text-2xl mb-2">🎨</p><p className="text-white/40 text-sm">Generate Panel Art</p><p className="text-white/20 text-xs mt-1">Uses Pollinations.ai · Free</p></>}
                          </button>
                        )}
                      </div>

                      {/* Panels */}
                      {scene.panel_descriptions?.length > 0 && (
                        <div className="space-y-2 mb-4">
                          <p className="text-white/40 text-xs uppercase tracking-wider">Panel Breakdowns</p>
                          {scene.panel_descriptions.map((p,pi) => (
                            <div key={pi} className="flex gap-2 text-sm">
                              <span className="text-pink-400/60 font-mono text-xs shrink-0 mt-0.5">[{pi+1}]</span>
                              <p className="text-white/60 text-xs leading-relaxed">{p}</p>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Dialogue */}
                      {scene.dialogue?.length > 0 && (
                        <div className="space-y-2 mb-3">
                          <p className="text-white/40 text-xs uppercase tracking-wider">Dialogue</p>
                          {scene.dialogue.map((d,di) => (
                            <div key={di} className="bg-white/5 rounded-lg p-3">
                              <p className="text-purple-300 text-xs font-semibold mb-0.5">{d.character} <span className="text-white/20 font-normal">[{d.tone}]</span></p>
                              <p className="text-white/70 text-sm">"{d.line}"</p>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Monologue + SFX */}
                      {scene.internal_monologue && <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-lg p-3 mb-3"><p className="text-white/30 text-xs mb-1">Inner Monologue</p><p className="text-indigo-200/70 text-sm italic">{scene.internal_monologue}</p></div>}
                      {scene.sfx?.length > 0 && <div className="flex gap-2 flex-wrap">{scene.sfx.map((fx,fi)=><span key={fi} className="bg-amber-500/20 text-amber-300 text-xs px-2 py-0.5 rounded font-bold font-mono">{fx}</span>)}</div>}
                    </div>
                  );
                })}

                {viewingChapter.next_chapter_setup && (
                  <div className="bg-gradient-to-r from-purple-900/40 to-pink-900/30 border border-purple-500/20 rounded-xl p-4">
                    <p className="text-white/30 text-xs uppercase tracking-wider mb-1">Seeds for Next Chapter</p>
                    <p className="text-white/60 text-sm">{viewingChapter.next_chapter_setup}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── TAB 3: Gallery ── */}
        {tab===3&&<MangaGalleryTab chapters={project.chapters||[]} project={project} onGenerate={(chIdx,sIdx,desc)=>generatePanelArt(chIdx,sIdx,desc)} generatingPanels={generatingPanels}/>}

        {/* ── TAB 4: Export ── */}
        {tab===4&&<MangaExportTab project={project} flash={flash}/>}
      </div>
    </div>
  );
}


// ══════════════════════════════════════════════════════════════════════════════
// 🖼️ MANGA GALLERY TAB
// ══════════════════════════════════════════════════════════════════════════════
function MangaGalleryTab({chapters, project, onGenerate, generatingPanels}){
  const allPanels = [];
  chapters.forEach((ch, chIdx) => {
    (ch.scenes||[]).forEach((scene, sIdx) => {
      const artUrl = ch.panel_art?.[`${chIdx}-${sIdx}`];
      allPanels.push({ ch, chIdx, scene, sIdx, artUrl });
    });
  });
  const withArt = allPanels.filter(p => p.artUrl);
  const withoutArt = allPanels.filter(p => !p.artUrl);

  return(
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-white font-bold text-lg">🖼️ Panel Art Gallery</h2>
          <p className="text-white/40 text-sm">{withArt.length} of {allPanels.length} scenes have art</p>
        </div>
        {withoutArt.length > 0 && (
          <p className="text-white/30 text-xs">{withoutArt.length} scenes need art — open a chapter to generate</p>
        )}
      </div>

      {withArt.length === 0 && (
        <div className="text-center py-20">
          <div className="text-5xl mb-4">🎨</div>
          <h3 className="text-white font-semibold mb-2">No panel art yet</h3>
          <p className="text-white/40 text-sm">Open a chapter in the Chapters tab and click "Generate Panel Art" on each scene.</p>
        </div>
      )}

      {withArt.length > 0 && (
        <div className="columns-2 sm:columns-3 md:columns-4 gap-3 space-y-3">
          {withArt.map((item, i) => (
            <div key={i} className="break-inside-avoid bg-white/5 border border-white/10 rounded-xl overflow-hidden">
              <img src={item.artUrl} alt="" className="w-full"/>
              <div className="p-2">
                <p className="text-white/50 text-xs font-medium">Ch.{item.ch.number} · Sc.{item.scene.scene_number}</p>
                <p className="text-white/25 text-xs truncate">{item.scene.location}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// 📤 MANGA EXPORT TAB — Webtoon/Tapas/Print ready
// ══════════════════════════════════════════════════════════════════════════════
function MangaExportTab({project, flash}){
  const [platform, setPlatform] = useState("webtoon");
  const [exporting, setExporting] = useState(false);
  const [exportLog, setExportLog] = useState([]);
  const [progress, setProgress] = useState(0);
  const [done, setDone] = useState(false);

  const chapters = project.chapters || [];
  const concept = project.concept || {};

  const PLATFORMS = [
    {
      id: "webtoon",
      label: "📱 Webtoon Canvas",
      color: "from-green-500 to-emerald-600",
      width: 800,
      maxChunkHeight: 1280,
      format: "JPEG",
      desc: "800px wide · JPEG · Sliced into ≤1280px strips",
      notes: ["Upload each strip as a separate image per episode", "Max 100 images per episode on Webtoon", "Cover: 436×436px square"],
      tip: "Webtoon readers scroll vertically — stack all your panels top-to-bottom with no gaps."
    },
    {
      id: "tapas",
      label: "📖 Tapas",
      color: "from-orange-500 to-amber-500",
      width: 940,
      maxChunkHeight: 99999,
      format: "PNG",
      desc: "940px wide · PNG · Full strip per scene",
      notes: ["Upload full tall strips (no height limit)", "Max 60 images per episode", "Cover: 960×1440px"],
      tip: "Tapas readers prefer longer strips — you can combine multiple scenes into one tall image."
    },
    {
      id: "globalcomix",
      label: "🌐 GlobalComix",
      color: "from-blue-500 to-indigo-600",
      width: 900,
      maxChunkHeight: 99999,
      format: "PNG",
      desc: "900px wide · PNG · CBZ bundle",
      notes: ["Accepts CBZ, PDF, PNG", "No strict height limit", "Good for traditional page format too"],
      tip: "GlobalComix accepts CBZ files — a ZIP renamed to .cbz with numbered images inside."
    },
    {
      id: "script",
      label: "📄 Production Script",
      color: "from-purple-500 to-pink-500",
      width: null,
      format: "TXT",
      desc: "Full script with panel specs for a human artist",
      notes: ["Panel descriptions numbered and formatted", "Dialogue with character attribution", "SFX and inner monologue marked", "Artist direction notes included"],
      tip: "Share this with a Fiverr/Upwork manga artist. They'll know exactly what to draw for each panel."
    },
  ];

  const sel = PLATFORMS.find(p => p.id === platform);
  const chaptersWithArt = chapters.filter(ch =>
    (ch.scenes||[]).some((_, si) => {
      const chIdx = chapters.indexOf(ch);
      return !!ch.panel_art?.[`${chIdx}-${si}`];
    })
  );
  const totalScenes = chapters.reduce((a,c) => a + (c.scenes?.length||0), 0);
  const totalWithArt = chapters.reduce((a,c,chIdx) =>
    a + (c.scenes||[]).filter((_,si) => !!c.panel_art?.[`${chIdx}-${si}`]).length, 0);

  const addLog = msg => setExportLog(prev => [{msg, t: new Date().toLocaleTimeString()}, ...prev.slice(0,49)]);

  // ── Core canvas stitcher ──────────────────────────────────────────────────
  const stitchSceneToCanvas = (artUrl, panelDescs, dialogue, sfx, monoLog, targetWidth) => {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        // Panel art: scale to targetWidth
        const artH = Math.round(img.height * (targetWidth / img.width));
        // Text section height: estimate
        const textLines = [
          ...(panelDescs||[]).map((p,i) => `[${i+1}] ${p}`),
          ...(dialogue||[]).map(d => `${d.character}: "${d.line}"`),
          monoLog ? `[Monologue] ${monoLog}` : null,
          (sfx||[]).length > 0 ? `SFX: ${sfx.join(" · ")}` : null,
        ].filter(Boolean);

        const lineH = 18;
        const padding = 16;
        const textH = textLines.length > 0 ? padding * 2 + textLines.length * lineH + 8 : 0;
        const totalH = artH + textH;

        const canvas = document.createElement("canvas");
        canvas.width = targetWidth;
        canvas.height = totalH;
        const ctx = canvas.getContext("2d");

        // Background
        ctx.fillStyle = "#0f0a1e";
        ctx.fillRect(0, 0, targetWidth, totalH);

        // Draw art
        ctx.drawImage(img, 0, 0, targetWidth, artH);

        // Text overlay at bottom
        if(textH > 0){
          ctx.fillStyle = "rgba(0,0,0,0.85)";
          ctx.fillRect(0, artH, targetWidth, textH);
          ctx.fillStyle = "#ffffff";
          ctx.font = "13px monospace";
          textLines.forEach((line, i) => {
            const y = artH + padding + i * lineH + lineH;
            const maxW = targetWidth - padding * 2;
            // Word-wrap long lines
            const words = line.split(" ");
            let cur = "";
            let ly = y;
            for(const w of words){
              const test = cur ? cur + " " + w : w;
              if(ctx.measureText(test).width > maxW && cur){
                ctx.fillText(cur, padding, ly);
                cur = w; ly += lineH;
              } else { cur = test; }
            }
            if(cur) ctx.fillText(cur, padding, ly);
          });
        }

        resolve(canvas);
      };
      img.onerror = () => {
        // No art — create text-only card
        const textLines = [
          ...(panelDescs||[]).map((p,i) => `[${i+1}] ${p}`),
          ...(dialogue||[]).map(d => `${d.character}: "${d.line}"`),
          monoLog ? `↳ ${monoLog}` : null,
          (sfx||[]).length > 0 ? `SFX: ${sfx.join(" · ")}` : null,
        ].filter(Boolean);
        const lineH = 20, padding = 20;
        const h = Math.max(200, padding * 2 + textLines.length * lineH + 40);
        const canvas = document.createElement("canvas");
        canvas.width = targetWidth; canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#1a1030"; ctx.fillRect(0,0,targetWidth,h);
        ctx.strokeStyle = "rgba(139,92,246,0.3)"; ctx.strokeRect(2,2,targetWidth-4,h-4);
        ctx.fillStyle = "#9b8fcf"; ctx.font = "bold 14px monospace";
        textLines.forEach((line,i) => ctx.fillText(line.slice(0,60), padding, padding + 20 + i*lineH));
        resolve(canvas);
      };
      img.src = artUrl || "broken";
    });
  };

  // ── Stitch full chapter into one tall canvas ──────────────────────────────
  const stitchChapter = async (ch, chIdx, targetWidth) => {
    const scenes = ch.scenes || [];
    const canvases = [];
    for(let si = 0; si < scenes.length; si++){
      const scene = scenes[si];
      const artUrl = ch.panel_art?.[`${chIdx}-${si}`] || null;
      const c = await stitchSceneToCanvas(
        artUrl,
        scene.panel_descriptions || [],
        scene.dialogue || [],
        scene.sfx || [],
        scene.internal_monologue || "",
        targetWidth
      );
      canvases.push(c);
    }
    if(canvases.length === 0) return null;
    const totalH = canvases.reduce((a,c) => a + c.height + 4, 0);
    const master = document.createElement("canvas");
    master.width = targetWidth; master.height = totalH;
    const ctx = master.getContext("2d");
    ctx.fillStyle = "#0f0a1e"; ctx.fillRect(0,0,targetWidth,totalH);
    let y = 0;
    for(const c of canvases){ ctx.drawImage(c, 0, y); y += c.height + 4; }
    return master;
  };

  // ── Slice a tall canvas into chunks ──────────────────────────────────────
  const sliceCanvas = (master, maxH) => {
    if(maxH >= 99999) return [master];
    const slices = [];
    let y = 0;
    while(y < master.height){
      const h = Math.min(maxH, master.height - y);
      const slice = document.createElement("canvas");
      slice.width = master.width; slice.height = h;
      slice.getContext("2d").drawImage(master, 0, y, master.width, h, 0, 0, master.width, h);
      slices.push(slice);
      y += h;
    }
    return slices;
  };

  // ── Canvas → blob ─────────────────────────────────────────────────────────
  const canvasToBlob = (canvas, fmt) => new Promise(res =>
    canvas.toBlob(res, fmt === "JPEG" ? "image/jpeg" : "image/png", 0.92)
  );

  // ── Download a blob ──────────────────────────────────────────────────────
  const dlBlob = (blob, filename) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  // ── Export Production Script ──────────────────────────────────────────────
  const exportProductionScript = () => {
    const lines = [];
    const slug = (project.title||"manga").replace(/[^a-z0-9]/gi,"_");
    lines.push("═".repeat(70));
    lines.push(`PRODUCTION SCRIPT: ${project.title?.toUpperCase()}`);
    lines.push(`Format: ${project.format?.toUpperCase()} | Genre: ${project.genre} | Art Style: ${project.art_style}`);
    lines.push(`Target Audience: ${project.target_audience}`);
    lines.push("═".repeat(70));
    lines.push("");
    lines.push("SERIES BIBLE");
    lines.push("─".repeat(40));
    if(concept.logline) lines.push(`LOGLINE: ${concept.logline}`);
    if(concept.synopsis) lines.push(`\nSYNOPSIS:\n${concept.synopsis}`);
    if(concept.protagonist) lines.push(`\nPROTAGONIST: ${concept.protagonist.name}, ${concept.protagonist.age}\n  Appearance: ${concept.protagonist.appearance}\n  Personality: ${concept.protagonist.personality}\n  Goal: ${concept.protagonist.goal}\n  Flaw: ${concept.protagonist.flaw}\n  Power/Skill: ${concept.protagonist.power_or_skill}`);
    if(concept.antagonist) lines.push(`\nANTAGONIST: ${concept.antagonist.name} (${concept.antagonist.role})\n  Motivation: ${concept.antagonist.motivation}\n  Appearance: ${concept.antagonist.appearance}`);
    if(concept.supporting_cast?.length > 0) lines.push(`\nSUPPORTING CAST:\n${concept.supporting_cast.map(c=>`  • ${c.name} (${c.role}): ${c.brief}`).join("\n")}`);
    if(concept.setting) lines.push(`\nSETTING:\n${concept.setting}`);
    if(concept.power_system && concept.power_system !== "None") lines.push(`\nPOWER SYSTEM:\n${concept.power_system}`);
    if(concept.series_arc) lines.push(`\nSERIES ARC:\n${concept.series_arc}`);
    lines.push("\n");
    chapters.forEach(ch => {
      lines.push("═".repeat(70));
      lines.push(`${ch.title || "Chapter " + ch.number}  [Mood: ${ch.mood||"?"} | Ending: ${ch.chapter_end_type||"?"}]`);
      lines.push(`SUMMARY: ${ch.summary||""}`);
      lines.push("");
      (ch.scenes||[]).forEach(scene => {
        lines.push(`  SCENE ${scene.scene_number}  —  ${scene.location}  [${scene.time_of_day}]  [${scene.panel_count} panels]`);
        lines.push("  " + "─".repeat(50));
        if(scene.panel_descriptions?.length > 0){
          lines.push("  PANELS:");
          scene.panel_descriptions.forEach((p,i) => lines.push(`    Panel ${i+1}: ${p}`));
        }
        if(scene.dialogue?.length > 0){
          lines.push("  DIALOGUE:");
          scene.dialogue.forEach(d => lines.push(`    ${d.character} [${d.tone}]: "${d.line}"`));
        }
        if(scene.internal_monologue) lines.push(`  INNER MONOLOGUE: ${scene.internal_monologue}`);
        if(scene.sfx?.length > 0) lines.push(`  SFX: ${scene.sfx.join(" / ")}`);
        lines.push(`  TENSION LEVEL: ${scene.tension_level||"?"}/5`);
        lines.push("");
      });
      if(ch.next_chapter_setup) lines.push(`  → NEXT CHAPTER SETUP: ${ch.next_chapter_setup}\n`);
    });
    lines.push("═".repeat(70));
    lines.push("END OF SCRIPT");
    const blob = new Blob([lines.join("\n")], {type:"text/plain"});
    dlBlob(blob, `${slug}_production_script.txt`);
    flash("Production script downloaded!");
  };

  // ── Main export handler ────────────────────────────────────────────────────
  const runExport = async () => {
    if(platform === "script"){ exportProductionScript(); return; }
    if(chapters.length === 0){ flash("No chapters to export — write some chapters first."); return; }
    setExporting(true); setExportLog([]); setDone(false); setProgress(0);
    try{
      const targetWidth = sel.width;
      const maxH = sel.maxChunkHeight;
      const fmt = sel.format;
      const slug = (project.title||"manga").replace(/[^a-z0-9]/gi,"_");
      addLog(`🚀 Exporting for ${sel.label} — ${targetWidth}px wide, ${fmt}`);

      for(let ci = 0; ci < chapters.length; ci++){
        const ch = chapters[ci];
        addLog(`📖 Processing Chapter ${ch.number}: "${ch.title||""}"…`);
        setProgress(Math.round((ci / chapters.length) * 100));

        const master = await stitchChapter(ch, ci, targetWidth);
        if(!master){ addLog(`  ⚠️ Ch.${ch.number} has no scenes — skipping.`); continue; }

        const slices = sliceCanvas(master, maxH);
        addLog(`  ↳ ${slices.length} image${slices.length!==1?"s":""} for this chapter`);

        for(let si = 0; si < slices.length; si++){
          const blob = await canvasToBlob(slices[si], fmt);
          const ext = fmt === "JPEG" ? "jpg" : "png";
          const filename = `${slug}_ch${String(ch.number).padStart(2,"0")}_p${String(si+1).padStart(3,"0")}.${ext}`;
          dlBlob(blob, filename);
          await new Promise(r => setTimeout(r, 250));
        }
        addLog(`  ✅ Ch.${ch.number} done`);
      }

      setProgress(100);
      setDone(true);
      addLog(`🎉 All chapters exported! Check your Downloads folder.`);
      flash("Export complete! 🎉");
    } catch(e){
      addLog("❌ Error: " + (e.message||String(e)));
      flash("Export failed: " + (e.message||"unknown error"), true);
    } finally { setExporting(false); }
  };

  return(
    <div className="max-w-3xl mx-auto space-y-5">

      {/* Header */}
      <Card>
        <h2 className="text-white text-xl font-bold mb-1">📤 Export for Publishing</h2>
        <p className="text-white/40 text-sm">Generates publication-ready image files sized and formatted for each platform — download and upload directly.</p>
      </Card>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white/5 border border-white/10 rounded-xl p-3 text-center">
          <p className="text-white text-xl font-bold">{chapters.length}</p>
          <p className="text-white/30 text-xs">Chapters</p>
        </div>
        <div className="bg-white/5 border border-white/10 rounded-xl p-3 text-center">
          <p className="text-white text-xl font-bold">{totalScenes}</p>
          <p className="text-white/30 text-xs">Scenes</p>
        </div>
        <div className={`border rounded-xl p-3 text-center ${totalWithArt > 0 ? "bg-green-500/10 border-green-500/20" : "bg-white/5 border-white/10"}`}>
          <p className={`text-xl font-bold ${totalWithArt > 0 ? "text-green-300" : "text-white"}`}>{totalWithArt}/{totalScenes}</p>
          <p className="text-white/30 text-xs">Have Panel Art</p>
        </div>
      </div>

      {totalWithArt === 0 && (
        <div className="bg-amber-500/15 border border-amber-500/30 rounded-xl p-4 text-sm text-amber-300">
          ⚠️ No panel art generated yet. You can still export the production script, or generate panel art in the Chapters tab first for illustrated exports.
        </div>
      )}

      {/* Platform picker */}
      <Card>
        <h3 className="text-white font-semibold mb-4">Choose Platform</h3>
        <div className="space-y-3">
          {PLATFORMS.map(p => (
            <button key={p.id} onClick={() => setPlatform(p.id)} className={`w-full p-4 rounded-2xl border-2 text-left transition-all ${platform===p.id?"border-purple-500 bg-purple-500/15":"border-white/10 bg-white/5 hover:border-white/25"}`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-white font-semibold text-sm">{p.label}</p>
                  <p className="text-white/40 text-xs mt-0.5">{p.desc}</p>
                </div>
                {platform===p.id && <span className="text-purple-400 text-xs mt-1 shrink-0">✓ Selected</span>}
              </div>
              {platform===p.id && (
                <div className="mt-3 pt-3 border-t border-white/10 space-y-1">
                  {p.notes.map((n,i) => <p key={i} className="text-white/30 text-xs">• {n}</p>)}
                  <div className="bg-cyan-500/10 border border-cyan-500/20 rounded-lg p-2.5 mt-2">
                    <p className="text-cyan-300/70 text-xs leading-relaxed">💡 {p.tip}</p>
                  </div>
                </div>
              )}
            </button>
          ))}
        </div>
      </Card>

      {/* Export button */}
      <Card>
        {!exporting ? (
          <button onClick={runExport} className="w-full bg-gradient-to-r from-pink-500 to-purple-500 text-white py-4 rounded-xl font-semibold hover:opacity-90 text-base flex items-center justify-center gap-2">
            {platform === "script" ? "📄 Download Production Script" : `📤 Export for ${sel?.label}`}
          </button>
        ) : (
          <div className="space-y-3">
            <div className="w-full bg-white/10 rounded-full h-2">
              <div className="bg-gradient-to-r from-pink-500 to-purple-500 h-2 rounded-full transition-all" style={{width: progress+"%"}}/>
            </div>
            <p className="text-white/40 text-sm text-center">Generating… {progress}%</p>
          </div>
        )}

        {done && !exporting && (
          <div className="mt-4 bg-green-500/15 border border-green-500/30 rounded-xl p-4 text-sm text-green-300">
            ✅ <strong>Export complete!</strong> Files are in your Downloads folder. Upload them directly to {sel?.label?.split(" ").slice(1).join(" ")} as a new episode.
          </div>
        )}

        {exportLog.length > 0 && (
          <div className="mt-4 bg-black/30 rounded-xl p-4 max-h-48 overflow-y-auto space-y-1">
            {exportLog.map((e,i) => (
              <div key={i} className="flex gap-2 text-xs">
                <span className="text-white/20 shrink-0">{e.t}</span>
                <span className="text-white/60">{e.msg}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Upload guide */}
      {platform !== "script" && (
        <div className="bg-white/3 border border-white/8 rounded-xl p-4 text-xs text-white/30 leading-relaxed space-y-2">
          <p className="text-white/50 font-semibold">How to upload to {sel?.label}:</p>
          {platform === "webtoon" && <>
            <p>1. Go to <span className="text-purple-400">canvas.webtoons.com</span> → My Canvas → + New Episode</p>
            <p>2. Drag in all the exported .jpg strips in order (p001, p002…)</p>
            <p>3. Set your episode title, thumbnail, and schedule or publish</p>
          </>}
          {platform === "tapas" && <>
            <p>1. Go to <span className="text-purple-400">creators.tapas.io</span> → your series → + Add Episode</p>
            <p>2. Upload the exported .png files — Tapas accepts full-height strips</p>
            <p>3. Add title, tags, and publish (or schedule)</p>
          </>}
          {platform === "globalcomix" && <>
            <p>1. Go to <span className="text-purple-400">globalcomix.com</span> → Creator Dashboard → Upload</p>
            <p>2. Upload the .png files — or ZIP them and rename to .cbz for a single upload</p>
            <p>3. Set chapter metadata and publish</p>
          </>}
        </div>
      )}
    </div>
  );
}

