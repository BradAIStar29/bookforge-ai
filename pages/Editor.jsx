// BookForge AI — Editor
// 100% localStorage, zero backend calls
import { useState, useEffect } from "react";
import { Link, useSearchParams, useNavigate } from "react-router-dom";

const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent";
const DAILY_LIMIT = 1500;
const TABS = ["📋 Outline", "✍️ Write", "🎨 Cover", "🔍 SEO", "📤 Publish"];

// ── localStorage ─────────────────────────────────────────────────────────────
function getBooks() { try { return JSON.parse(localStorage.getItem("bfai_books") || "[]"); } catch { return []; } }
function getBook(id) { return getBooks().find(b => b.id === id) || null; }
function saveBook(id, updates) {
  const books = getBooks();
  const i = books.findIndex(b => b.id === id);
  if (i === -1) return null;
  books[i] = { ...books[i], ...updates };
  localStorage.setItem("bfai_books", JSON.stringify(books));
  return books[i];
}
function trackUsage() {
  try {
    const today = new Date().toISOString().split("T")[0];
    const d = JSON.parse(localStorage.getItem("bfai_usage") || "{}");
    const count = (d.date === today ? d.count : 0) + 1;
    localStorage.setItem("bfai_usage", JSON.stringify({ date: today, count }));
    return count;
  } catch { return 0; }
}
function getUsageToday() {
  try {
    const today = new Date().toISOString().split("T")[0];
    const d = JSON.parse(localStorage.getItem("bfai_usage") || "{}");
    return d.date === today ? (d.count || 0) : 0;
  } catch { return 0; }
}

// ── Gemini ───────────────────────────────────────────────────────────────────
async function callGemini(prompt) {
  const apiKey = localStorage.getItem("gemini_api_key") || "";
  if (!apiKey) throw { code: "NO_KEY" };
  const res = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.85, maxOutputTokens: 8192 }
    })
  });
  const data = await res.json();
  if (!res.ok) {
    const s = data?.error?.status || "";
    if (res.status === 401 || res.status === 403) throw { code: "BAD_KEY" };
    if (res.status === 429 || s === "RESOURCE_EXHAUSTED") throw { code: "QUOTA" };
    throw { code: "ERROR", msg: data?.error?.message || `HTTP ${res.status}` };
  }
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    if (data?.candidates?.[0]?.finishReason === "SAFETY") throw { code: "SAFETY" };
    throw { code: "EMPTY" };
  }
  return text;
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function Editor() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const bookId = searchParams.get("id");

  const [book, setBook] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState(0);
  const [busy, setBusy] = useState(false);
  const [busyChapter, setBusyChapter] = useState(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [selChapter, setSelChapter] = useState(0);
  const [quotaHit, setQuotaHit] = useState(false);
  const [usageCount, setUsageCount] = useState(0);
  const [coverMode, setCoverMode] = useState("auto");
  const [customPrompt, setCustomPrompt] = useState("");
  const [lastAiPrompt, setLastAiPrompt] = useState("");

  useEffect(() => {
    if (!bookId) { navigate("/"); return; }
    const b = getBook(bookId);
    if (!b) { navigate("/"); return; }
    setBook(b);
    setLoading(false);
    const u = getUsageToday();
    setUsageCount(u);
    if (u >= DAILY_LIMIT) setQuotaHit(true);
  }, [bookId]);

  const update = (updates) => {
    const updated = saveBook(bookId, updates);
    if (updated) setBook(updated);
    return updated;
  };

  const bumpUsage = () => {
    const c = trackUsage();
    setUsageCount(c);
    if (c >= DAILY_LIMIT) setQuotaHit(true);
  };

  const handleErr = (e) => {
    const c = e.code || "ERROR";
    if (c === "QUOTA") { setQuotaHit(true); setError("⏳ Daily Gemini limit reached. Resets at midnight Pacific Time."); }
    else if (c === "NO_KEY" || c === "BAD_KEY") setError("🔑 API key missing or invalid. Go back to Library to update it.");
    else if (c === "SAFETY") setError("Content blocked by Gemini safety filter. Try rephrasing.");
    else setError(e.msg || "Something went wrong. Please try again.");
  };

  const flash = (msg) => { setSuccess(msg); setTimeout(() => setSuccess(""), 3500); };

  // Generate a single chapter
  const genChapter = async (idx) => {
    if (quotaHit) return;
    setBusyChapter(idx); setError("");
    try {
      const outline = JSON.parse(book.outline || "{}");
      const ch = outline.chapters[idx];
      const prevTitles = (book.chapters || []).slice(0, idx).filter(c => c.generated).map(c => c.title).join(", ") || "None yet";
      const content = await callGemini(
        `Write Chapter ${ch.number}: "${ch.title}" for a ${book.genre} book titled "${outline.title}".\n` +
        `Chapter description: ${ch.description}\n` +
        `Previously written chapters: ${prevTitles}\n` +
        `Target audience: ${book.target_audience}\n\n` +
        `Instructions:\n` +
        `- Write 2,500–3,500 words\n` +
        `- Use headings and subheadings where appropriate\n` +
        `- Match the genre's tone and style precisely\n` +
        `- For romance/LGBT+ genres: write with authenticity, emotion, and representation\n` +
        `- Make it engaging, immersive, and publication-ready`
      );
      bumpUsage();
      const chapters = [...(book.chapters || [])];
      chapters[idx] = { ...chapters[idx], content, generated: true };
      const wc = chapters.reduce((a, c) => a + (c.content ? c.content.split(/\s+/).length : 0), 0);
      update({ chapters, word_count: wc, status: "writing" });
      flash(`Chapter ${idx + 1} written! ✍️`);
    } catch (e) { handleErr(e); }
    finally { setBusyChapter(null); }
  };

  const genAllChapters = async () => {
    const pending = (book.chapters || []).map((c, i) => i).filter(i => !book.chapters[i].generated);
    for (const i of pending) {
      if (quotaHit) break;
      await genChapter(i);
    }
  };

  // Generate SEO
  const genSEO = async () => {
    if (quotaHit) return;
    setBusy(true); setError("");
    try {
      const outline = JSON.parse(book.outline || "{}");
      const raw = await callGemini(
        `You are an Amazon KDP SEO expert. Generate optimized metadata for this book.\n` +
        `Title: ${outline.title}\nGenre: ${book.genre}\nDescription: ${outline.description}\n\n` +
        `Respond with ONLY valid JSON:\n` +
        `{"seo_title":"","seo_description":"","primary_keywords":[""],"bisac_categories":[""],"back_cover_copy":"","author_bio_template":""}`
      );
      bumpUsage();
      const match = raw.match(/\{[\s\S]*\}/);
      if (!match) throw { code: "PARSE" };
      const seo = JSON.parse(match[0]);
      update({
        seo_title: seo.seo_title || "",
        seo_description: seo.seo_description || "",
        seo_keywords: (seo.primary_keywords || []).join(", "),
        notes: JSON.stringify(seo),
      });
      flash("SEO metadata generated! 🔍");
    } catch (e) { handleErr(e); }
    finally { setBusy(false); }
  };

  // Generate cover
  const genCover = async () => {
    if (quotaHit) return;
    setBusy(true); setError("");
    try {
      let finalPrompt = "";
      if (coverMode === "custom" && customPrompt.trim()) {
        finalPrompt = customPrompt.trim() + ". Professional book cover, high quality digital art, no text, no letters, no words in image.";
      } else {
        const outline = JSON.parse(book.outline || "{}");
        const aiPrompt = await callGemini(
          `Create a highly detailed image generation prompt for a professional book cover.\n\n` +
          `Book: "${outline.title}"\nGenre: ${book.genre}\nDescription: ${outline.description}\n\n` +
          `Requirements for the prompt:\n` +
          `- Describe specific characters with explicit details: gender, age, appearance, ethnicity\n` +
          `- For gay/LGBT+ romance: explicitly describe two male/female/non-binary characters and their interaction\n` +
          `- Describe the setting, mood, lighting, color palette in detail\n` +
          `- Specify the art style (e.g. painterly, photorealistic, illustrated, cinematic)\n` +
          `- NO text, letters, words, or titles in the image\n` +
          `- Professional commercial book cover quality\n\n` +
          `Return ONLY the image prompt text, nothing else.`
        );
        bumpUsage();
        finalPrompt = aiPrompt.trim() + ". No text, no words, no letters. Professional book cover art.";
        setLastAiPrompt(finalPrompt);
      }
      const encoded = encodeURIComponent(finalPrompt);
      const seed = Date.now();
      const url = `https://image.pollinations.ai/prompt/${encoded}?width=832&height=1216&model=flux&nologo=true&enhance=true&seed=${seed}`;
      update({ cover_image_url: url });
      flash("Cover generated! 🎨");
    } catch (e) { handleErr(e); }
    finally { setBusy(false); }
  };

  const newCoverVariation = () => {
    if (!book?.cover_image_url) return;
    try {
      const u = new URL(book.cover_image_url);
      u.searchParams.set("seed", Date.now().toString());
      update({ cover_image_url: u.toString() });
      flash("New variation! 🎨");
    } catch {}
  };

  const downloadBook = () => {
    if (!book.chapters?.some(c => c.content)) { setError("Write at least one chapter first."); return; }
    const md = `# ${book.title}\n${book.subtitle ? `## ${book.subtitle}\n` : ""}\n${book.description || ""}\n\n---\n\n` +
      (book.chapters || []).map(c => `# Chapter ${c.number}: ${c.title}\n\n${c.content || "(Not yet generated)"}`).join("\n\n---\n\n");
    const a = Object.assign(document.createElement("a"), {
      href: URL.createObjectURL(new Blob([md], { type: "text/markdown" })),
      download: `${(book.title || "book").replace(/[^a-z0-9]/gi, "_")}.md`
    });
    a.click();
  };

  const pct = Math.min(Math.round((usageCount / DAILY_LIMIT) * 100), 100);

  if (loading) return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center">
      <div className="text-white/50">Loading…</div>
    </div>
  );
  if (!book) return null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
      {/* Header */}
      <div className="border-b border-white/10 bg-black/20 backdrop-blur-sm sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4 min-w-0">
            <Link to="/" className="text-white/40 hover:text-white text-sm shrink-0">← Library</Link>
            <div className="min-w-0">
              <h1 className="text-white font-bold text-base truncate">{book.title}</h1>
              <p className="text-white/30 text-xs">{book.genre} · {book.target_audience}</p>
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <div className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 flex items-center gap-2">
              <span className={`text-xs font-bold ${pct >= 90 ? "text-red-400" : pct >= 70 ? "text-amber-400" : "text-green-400"}`}>
                {usageCount}/{DAILY_LIMIT}
              </span>
              <div className="w-12 h-1 bg-white/10 rounded-full overflow-hidden">
                <div className={`h-full rounded-full transition-all ${pct >= 90 ? "bg-red-500" : pct >= 70 ? "bg-amber-500" : "bg-green-500"}`}
                  style={{ width: `${pct}%` }} />
              </div>
            </div>
            <span className={`text-xs px-2.5 py-1 rounded-full ${book.status === "published" ? "bg-purple-500/20 text-purple-300" : book.status === "ready" ? "bg-green-500/20 text-green-300" : "bg-blue-500/20 text-blue-300"}`}>
              {book.status}
            </span>
          </div>
        </div>
        <div className="max-w-7xl mx-auto px-6 flex gap-1">
          {TABS.map((t, i) => (
            <button key={i} onClick={() => setTab(i)}
              className={`px-4 py-2.5 text-sm font-medium rounded-t-lg transition-all ${tab === i ? "bg-white/10 text-white border-b-2 border-purple-500" : "text-white/35 hover:text-white/70"}`}>
              {t}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Banners */}
        {quotaHit && (
          <div className="bg-amber-500/20 border border-amber-500/40 rounded-xl p-5 mb-6 flex gap-4 items-start">
            <span className="text-3xl">⏳</span>
            <div className="flex-1">
              <p className="text-amber-300 font-semibold">Daily Gemini Limit Reached</p>
              <p className="text-amber-200/60 text-sm mt-1">All {DAILY_LIMIT} free requests used today. Resets at midnight Pacific Time. Your progress is saved!</p>
            </div>
            <button onClick={() => { setQuotaHit(false); setError(""); }} className="text-amber-400/40 hover:text-amber-300">✕</button>
          </div>
        )}
        {error && !quotaHit && (
          <div className="bg-red-500/20 border border-red-500/30 text-red-300 rounded-xl p-4 mb-6 text-sm flex justify-between items-start">
            <span>{error}</span>
            <button onClick={() => setError("")} className="ml-4 text-red-400/40 hover:text-red-300 shrink-0">✕</button>
          </div>
        )}
        {success && (
          <div className="bg-green-500/20 border border-green-500/30 text-green-300 rounded-xl p-4 mb-6 text-sm">{success}</div>
        )}

        {/* ── OUTLINE TAB ── */}
        {tab === 0 && (
          <div className="max-w-3xl mx-auto">
            <div className="bg-white/5 border border-white/10 rounded-2xl p-8">
              <h2 className="text-white text-2xl font-bold">{book.title}</h2>
              {book.subtitle && <p className="text-purple-300 mt-1 mb-4">{book.subtitle}</p>}
              <p className="text-white/60 text-sm leading-relaxed mb-8">{book.description}</p>
              <p className="text-white/40 text-xs uppercase tracking-wider mb-3">Chapters</p>
              <div className="space-y-2">
                {(book.chapters || []).map((ch, i) => (
                  <div key={i} className={`rounded-xl p-4 border flex gap-3 items-start ${ch.generated ? "bg-green-500/10 border-green-500/20" : "bg-white/5 border-white/10"}`}>
                    <span className={`font-bold text-sm min-w-[28px] ${ch.generated ? "text-green-400" : "text-purple-400"}`}>{ch.generated ? "✓" : ch.number + "."}</span>
                    <div className="flex-1">
                      <p className="text-white text-sm font-medium">{ch.title}</p>
                      <p className="text-white/35 text-xs mt-0.5">{ch.description}</p>
                    </div>
                    {ch.generated && <span className="text-green-400/50 text-xs shrink-0">Written</span>}
                  </div>
                ))}
              </div>
              {book.chapters?.length > 0 && (
                <div className="mt-6 bg-white/5 rounded-xl p-4">
                  <div className="flex justify-between text-xs text-white/40 mb-2">
                    <span>Progress</span>
                    <span>{book.chapters.filter(c => c.generated).length} / {book.chapters.length} chapters</span>
                  </div>
                  <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-purple-500 to-pink-500 rounded-full transition-all"
                      style={{ width: `${(book.chapters.filter(c => c.generated).length / book.chapters.length) * 100}%` }} />
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── WRITE TAB ── */}
        {tab === 1 && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Sidebar */}
            <div className="lg:col-span-1">
              <div className="bg-white/5 border border-white/10 rounded-2xl p-4 sticky top-24">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-white font-semibold text-sm">Chapters</h3>
                  <button onClick={genAllChapters} disabled={busy || busyChapter !== null || quotaHit}
                    className="text-xs bg-purple-500/20 text-purple-300 border border-purple-500/30 px-3 py-1.5 rounded-lg hover:bg-purple-500/30 disabled:opacity-40 transition-colors">
                    Write All
                  </button>
                </div>
                <div className="space-y-1">
                  {(book.chapters || []).map((ch, i) => (
                    <button key={i} onClick={() => setSelChapter(i)}
                      className={`w-full text-left px-3 py-2.5 rounded-lg text-sm transition-all ${selChapter === i ? "bg-purple-500/20 text-white border border-purple-500/30" : "text-white/50 hover:bg-white/5"}`}>
                      <span className={ch.generated ? "text-green-400" : ""}>{ch.generated ? "✓ " : ""}</span>
                      {ch.number}. {ch.title}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            {/* Chapter content */}
            <div className="lg:col-span-2">
              {book.chapters?.[selChapter] && (
                <div className="bg-white/5 border border-white/10 rounded-2xl p-8">
                  <div className="flex items-start justify-between mb-6 gap-4">
                    <div>
                      <h2 className="text-white text-xl font-bold">Chapter {book.chapters[selChapter].number}: {book.chapters[selChapter].title}</h2>
                      <p className="text-white/35 text-sm mt-1">{book.chapters[selChapter].description}</p>
                    </div>
                    <button onClick={() => genChapter(selChapter)} disabled={busyChapter !== null || quotaHit}
                      className="bg-gradient-to-r from-purple-500 to-pink-500 text-white px-5 py-2.5 rounded-xl font-medium text-sm hover:opacity-90 disabled:opacity-50 flex items-center gap-2 shrink-0">
                      {busyChapter === selChapter
                        ? <><svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>Writing…</>
                        : book.chapters[selChapter].generated ? "✍️ Rewrite" : "✍️ Write Chapter"}
                    </button>
                  </div>
                  {book.chapters[selChapter].content ? (
                    <div className="text-white/75 text-sm leading-relaxed whitespace-pre-wrap max-h-[620px] overflow-y-auto pr-2">
                      {book.chapters[selChapter].content}
                    </div>
                  ) : (
                    <div className="text-center py-20 text-white/25">
                      <div className="text-4xl mb-3">✍️</div>
                      <p>Click "Write Chapter" to generate this chapter with Gemini AI</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── COVER TAB ── */}
        {tab === 2 && (
          <div className="max-w-5xl mx-auto">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {/* Preview */}
              <div>
                <h2 className="text-white text-xl font-bold mb-4">Cover Preview</h2>
                {book.cover_image_url ? (
                  <>
                    <img src={book.cover_image_url} alt="Cover"
                      className="w-full max-w-xs rounded-2xl shadow-2xl shadow-purple-900/60 mx-auto block" />
                    <div className="flex gap-2 mt-4 justify-center">
                      <button onClick={newCoverVariation} disabled={busy}
                        className="text-sm border border-white/20 text-white/50 px-4 py-2 rounded-lg hover:bg-white/5 disabled:opacity-40">
                        🎲 New Variation
                      </button>
                      <a href={book.cover_image_url} target="_blank" rel="noopener noreferrer"
                        className="text-sm border border-white/20 text-white/50 px-4 py-2 rounded-lg hover:bg-white/5">
                        ⬇️ Download
                      </a>
                    </div>
                  </>
                ) : (
                  <div className="w-full max-w-xs aspect-[2/3] bg-white/5 border-2 border-dashed border-white/15 rounded-2xl flex items-center justify-center mx-auto">
                    <div className="text-center text-white/20">
                      <div className="text-5xl mb-2">🎨</div>
                      <p className="text-sm">Cover will appear here</p>
                    </div>
                  </div>
                )}
              </div>

              {/* Controls */}
              <div className="space-y-5">
                <h2 className="text-white text-xl font-bold">Cover Settings</h2>
                {/* Mode toggle */}
                <div className="bg-white/5 border border-white/10 rounded-xl p-1 flex gap-1">
                  {[["auto","✨ AI Auto-Generate"],["custom","✏️ Custom Prompt"]].map(([m, label]) => (
                    <button key={m} onClick={() => setCoverMode(m)}
                      className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${coverMode === m ? "bg-purple-500 text-white" : "text-white/40 hover:text-white"}`}>
                      {label}
                    </button>
                  ))}
                </div>

                {coverMode === "auto" ? (
                  <div className="bg-white/5 border border-white/10 rounded-xl p-4 text-sm text-white/60">
                    Gemini reads your book's genre and description and writes a detailed, character-specific cover prompt automatically.
                    {lastAiPrompt && (
                      <div className="mt-3 pt-3 border-t border-white/10">
                        <p className="text-white/30 text-xs uppercase tracking-wider mb-1">Last prompt used:</p>
                        <p className="text-white/40 text-xs italic leading-relaxed">{lastAiPrompt}</p>
                      </div>
                    )}
                  </div>
                ) : (
                  <div>
                    <label className="text-white/60 text-sm font-medium block mb-2">Describe your cover</label>
                    <textarea rows={7} value={customPrompt} onChange={e => setCustomPrompt(e.target.value)}
                      placeholder="E.g. Two young men in their early 20s — one with dark curly hair and one with red hair — standing close together on a rainy city rooftop at dusk, looking at each other with longing, warm golden streetlight glow, cinematic painterly art style, rich jewel-tone colors, no text..."
                      className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white placeholder-white/20 focus:outline-none focus:border-purple-500 resize-none text-sm" />
                    <p className="text-white/25 text-xs mt-1">Be very specific — characters, setting, mood, colors, style. More detail = better results.</p>
                  </div>
                )}

                <button onClick={genCover} disabled={busy || quotaHit || (coverMode === "custom" && !customPrompt.trim())}
                  className="w-full bg-gradient-to-r from-purple-500 to-pink-500 text-white py-4 rounded-xl font-semibold text-lg hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2">
                  {busy
                    ? <><svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>Generating…</>
                    : book.cover_image_url ? "🔄 Regenerate Cover" : "🎨 Generate Cover"}
                </button>

                <div className="bg-white/5 border border-white/10 rounded-xl p-4 text-xs text-white/35 space-y-1.5">
                  <p className="text-white/50 font-medium">💡 Tips for better covers:</p>
                  <p>• Explicitly state character genders and appearance</p>
                  <p>• Specify art style: painterly, photorealistic, illustrated, cinematic</p>
                  <p>• Describe lighting and color palette</p>
                  <p>• Use "New Variation" to get different takes on the same prompt</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── SEO TAB ── */}
        {tab === 3 && (
          <div className="max-w-3xl mx-auto">
            <div className="bg-white/5 border border-white/10 rounded-2xl p-8">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="text-white text-2xl font-bold">SEO Optimization</h2>
                  <p className="text-white/40 text-sm mt-1">Amazon KDP & publishing platform metadata</p>
                </div>
                <button onClick={genSEO} disabled={busy || quotaHit}
                  className="bg-gradient-to-r from-purple-500 to-pink-500 text-white px-6 py-3 rounded-xl font-semibold hover:opacity-90 disabled:opacity-50 flex items-center gap-2">
                  {busy ? <><svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>Generating…</> : "🔍 Generate SEO"}
                </button>
              </div>
              <div className="space-y-5">
                {[
                  { label: "SEO Title", val: book.seo_title },
                  { label: "SEO Description", val: book.seo_description, large: true },
                  { label: "Keywords", val: book.seo_keywords },
                ].map(f => (
                  <div key={f.label}>
                    <p className="text-white/40 text-xs uppercase tracking-wider mb-2">{f.label}</p>
                    {f.val
                      ? <div className={`bg-white/10 rounded-xl p-4 text-white/80 text-sm ${f.large ? "leading-relaxed" : ""}`}>{f.val}</div>
                      : <div className="bg-white/5 border border-dashed border-white/10 rounded-xl p-4 text-white/20 text-sm italic">Generate SEO to populate</div>}
                  </div>
                ))}
                {book.notes && (() => {
                  try {
                    const n = JSON.parse(book.notes);
                    return n.back_cover_copy ? (
                      <div>
                        <p className="text-white/40 text-xs uppercase tracking-wider mb-2">Back Cover Copy</p>
                        <div className="bg-white/10 rounded-xl p-4 text-white/80 text-sm leading-relaxed">{n.back_cover_copy}</div>
                      </div>
                    ) : null;
                  } catch { return null; }
                })()}
              </div>
            </div>
          </div>
        )}

        {/* ── PUBLISH TAB ── */}
        {tab === 4 && (
          <div className="max-w-3xl mx-auto space-y-6">
            <div className="bg-white/5 border border-white/10 rounded-2xl p-8">
              <h2 className="text-white text-2xl font-bold mb-2">Publish Your Book</h2>
              <p className="text-white/40 mb-6">Export and upload to your publishing platform of choice</p>
              <div className="space-y-3 mb-8">
                {[
                  { label: "Outline created", done: !!book.outline },
                  { label: "At least one chapter written", done: !!book.chapters?.some(c => c.generated) },
                  { label: "Cover image generated", done: !!book.cover_image_url },
                  { label: "SEO metadata ready", done: !!book.seo_title },
                ].map((item, i) => (
                  <div key={i} className={`flex items-center gap-3 px-4 py-3 rounded-lg ${item.done ? "bg-green-500/10" : "bg-white/5"}`}>
                    <span>{item.done ? "✅" : "⭕"}</span>
                    <span className={`text-sm ${item.done ? "text-white" : "text-white/35"}`}>{item.label}</span>
                  </div>
                ))}
              </div>
              <button onClick={downloadBook}
                className="w-full bg-gradient-to-r from-purple-500 to-pink-500 text-white py-4 rounded-xl font-semibold text-lg hover:opacity-90 flex items-center justify-center gap-2">
                📥 Download as Markdown (.md)
              </button>
              <p className="text-white/25 text-xs text-center mt-3">Upload the .md file to Amazon KDP, Smashwords, or Draft2Digital</p>
            </div>
            <div className="grid grid-cols-3 gap-4">
              {[
                { name: "Amazon KDP", url: "https://kdp.amazon.com", icon: "📦", color: "border-orange-500/30 bg-orange-500/10" },
                { name: "Smashwords", url: "https://www.smashwords.com", icon: "📚", color: "border-blue-500/30 bg-blue-500/10" },
                { name: "Draft2Digital", url: "https://draft2digital.com", icon: "🌐", color: "border-green-500/30 bg-green-500/10" },
              ].map(p => (
                <a key={p.name} href={p.url} target="_blank" rel="noopener noreferrer"
                  className={`border ${p.color} rounded-xl p-5 text-center hover:opacity-80 transition-opacity`}>
                  <div className="text-3xl mb-2">{p.icon}</div>
                  <p className="text-white font-semibold text-sm">{p.name}</p>
                  <p className="text-white/30 text-xs mt-1">Open →</p>
                </a>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
