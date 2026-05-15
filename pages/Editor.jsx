import { useState, useEffect } from "react";
import { Link, useSearchParams, useNavigate } from "react-router-dom";

const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent";
const DAILY_LIMIT = 1500;
const tabs = ["📋 Outline", "✍️ Write", "🎨 Cover", "🔍 SEO", "📤 Publish"];

// ── localStorage helpers ─────────────────────────────────────────────────────
function getBooks() {
  try { return JSON.parse(localStorage.getItem("bfai_books") || "[]"); } catch { return []; }
}
function saveBooks(books) { localStorage.setItem("bfai_books", JSON.stringify(books)); }
function getBook(id) { return getBooks().find(b => b.id === id) || null; }
function updateBook(id, updates) {
  const books = getBooks();
  const idx = books.findIndex(b => b.id === id);
  if (idx === -1) return null;
  books[idx] = { ...books[idx], ...updates };
  saveBooks(books);
  return books[idx];
}
function trackUsage() {
  try {
    const today = new Date().toISOString().split("T")[0];
    const data = JSON.parse(localStorage.getItem("bfai_usage") || "{}");
    const count = (data.date === today ? data.count : 0) + 1;
    localStorage.setItem("bfai_usage", JSON.stringify({ date: today, count }));
    return count;
  } catch { return 0; }
}
function getUsageCount() {
  try {
    const today = new Date().toISOString().split("T")[0];
    const data = JSON.parse(localStorage.getItem("bfai_usage") || "{}");
    return data.date === today ? (data.count || 0) : 0;
  } catch { return 0; }
}

// ── Gemini ───────────────────────────────────────────────────────────────────
async function callGemini(prompt) {
  const apiKey = localStorage.getItem("gemini_api_key") || "";
  if (!apiKey) throw { type: "api_key_error", message: "No Gemini API key set. Go back to Home and add your key." };
  let res, data;
  try {
    res = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.8, maxOutputTokens: 8192 }
      })
    });
    data = await res.json();
  } catch { throw { type: "general", message: "Network error — check your connection." }; }
  if (!res.ok) {
    const errStatus = data?.error?.status || "";
    const errMsg = data?.error?.message || "";
    if (res.status === 401 || res.status === 403) throw { type: "api_key_error", message: "Invalid Gemini API key." };
    if (res.status === 429 || errStatus === "RESOURCE_EXHAUSTED") throw { type: "quota_exceeded", message: "Daily Gemini limit reached. Resets at midnight Pacific Time." };
    throw { type: "general", message: "Gemini error " + res.status + ": " + (errMsg || "unknown") };
  }
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    if (data?.candidates?.[0]?.finishReason === "SAFETY") throw { type: "safety_block", message: "Content blocked for safety. Try rephrasing." };
    throw { type: "general", message: "Empty response from Gemini. Please try again." };
  }
  return text;
}

// ── Component ────────────────────────────────────────────────────────────────
export default function Editor() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const bookId = searchParams.get("id");

  const [book, setBook] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState(0);
  const [generating, setGenerating] = useState(false);
  const [generatingChapter, setGeneratingChapter] = useState(null);
  const [error, setError] = useState("");
  const [errorType, setErrorType] = useState("general");
  const [success, setSuccess] = useState("");
  const [selectedChapter, setSelectedChapter] = useState(0);
  const [quotaHit, setQuotaHit] = useState(false);
  const [usageCount, setUsageCount] = useState(0);
  const [customCoverPrompt, setCustomCoverPrompt] = useState("");
  const [coverPromptMode, setCoverPromptMode] = useState("auto");
  const [generatedCoverPrompt, setGeneratedCoverPrompt] = useState("");

  useEffect(() => {
    if (!bookId) { navigate("/"); return; }
    const b = getBook(bookId);
    if (b) { setBook(b); } else { navigate("/"); }
    setLoading(false);
    const count = getUsageCount();
    setUsageCount(count);
    if (count >= DAILY_LIMIT) setQuotaHit(true);
  }, [bookId]);

  const saveBook = (updates) => {
    const updated = updateBook(bookId, updates);
    if (updated) setBook(updated);
    return updated;
  };

  const incrementUsageState = () => {
    const count = trackUsage();
    setUsageCount(count);
    if (count >= DAILY_LIMIT) setQuotaHit(true);
  };

  const handleApiError = (e) => {
    const type = e.type || "general";
    setErrorType(type);
    setError(e.message || "Something went wrong");
    if (type === "quota_exceeded") setQuotaHit(true);
  };

  const generateChapter = async (idx) => {
    if (quotaHit) { setErrorType("quota_exceeded"); setError("Daily Gemini limit reached. Resets at midnight Pacific Time."); return; }
    setGeneratingChapter(idx); setError("");
    try {
      const outline = JSON.parse(book.outline || "{}");
      const ch = outline.chapters[idx];
      const prev = (book.chapters || []).slice(0, idx).map(c => c.title).join(", ") || "None";
      const content = await callGemini(
        'Write Chapter ' + ch.number + ': "' + ch.title + '" for a ' + book.genre + ' book titled "' + outline.title + '".\n' +
        "Description: " + ch.description + "\nPrevious chapters: " + prev + "\nAudience: " + book.target_audience +
        "\n\nWrite 2,500–3,500 words with headings and subheadings. Make it engaging and high quality."
      );
      incrementUsageState();
      const updatedChapters = [...(book.chapters || [])];
      updatedChapters[idx] = { ...updatedChapters[idx], content, generated: true };
      const wordCount = updatedChapters.reduce((acc, c) => acc + (c.content?.split(/\s+/).length || 0), 0);
      saveBook({ chapters: updatedChapters, word_count: wordCount, status: "writing" });
      setSuccess(`Chapter ${idx + 1} generated! ✍️`);
      setTimeout(() => setSuccess(""), 3000);
    } catch (e) { handleApiError(e); }
    finally { setGeneratingChapter(null); }
  };

  const generateAllChapters = async () => {
    const ungenerated = (book.chapters || []).map((c, i) => i).filter(i => !book.chapters[i].generated);
    for (const idx of ungenerated) {
      if (quotaHit) break;
      await generateChapter(idx);
    }
  };

  const generateSEO = async () => {
    if (quotaHit) { setErrorType("quota_exceeded"); setError("Daily Gemini limit reached."); return; }
    setGenerating(true); setError("");
    try {
      const outline = JSON.parse(book.outline || "{}");
      const raw = await callGemini(
        "Amazon KDP SEO expert. Generate metadata.\nTitle: " + outline.title +
        "\nGenre: " + book.genre + "\nDesc: " + outline.description +
        '\n\nRespond with ONLY valid JSON:\n{"seo_title":"","seo_description":"","primary_keywords":[""],"bisac_categories":[""],"back_cover_copy":"","author_bio_template":""}'
      );
      incrementUsageState();
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw { type: "general", message: "Could not parse SEO data. Please try again." };
      const seo = JSON.parse(jsonMatch[0]);
      saveBook({
        seo_title: seo.seo_title,
        seo_description: seo.seo_description,
        seo_keywords: seo.primary_keywords?.join(", "),
        keywords: seo.primary_keywords,
        notes: JSON.stringify(seo),
      });
      setSuccess("SEO metadata generated! 🔍");
      setTimeout(() => setSuccess(""), 3000);
    } catch (e) { handleApiError(e); }
    finally { setGenerating(false); }
  };

  const generateCover = async () => {
    if (quotaHit) { setErrorType("quota_exceeded"); setError("Daily Gemini limit reached."); return; }
    setGenerating(true); setError("");
    try {
      let finalPrompt = "";
      if (coverPromptMode === "custom" && customCoverPrompt.trim()) {
        finalPrompt = customCoverPrompt.trim() + ". Professional book cover composition, high quality digital art, no text, no letters, no words.";
      } else {
        const outline = JSON.parse(book.outline || "{}");
        const aiPrompt = await callGemini(
          'Create a detailed image generation prompt for a book cover.\n' +
          'Book title: "' + outline.title + '"\nGenre: ' + book.genre + '\nDescription: ' + outline.description + '\n\n' +
          'Requirements:\n- Describe the visual scene, characters, mood, color palette, lighting, and art style in detail\n' +
          '- For romance/love stories: explicitly describe the characters and their interaction\n' +
          '- Be very specific about character appearance, gender, ethnicity, age\n' +
          '- No text, letters, words, or title in the image\n- Professional book cover quality\n\n' +
          'Return ONLY the image prompt, nothing else.'
        );
        incrementUsageState();
        finalPrompt = aiPrompt.trim() + ". Professional book cover, high quality digital art, cinematic lighting, no text, no letters, no words in image.";
        setGeneratedCoverPrompt(finalPrompt);
      }
      const seed = Date.now();
      const encodedPrompt = encodeURIComponent(finalPrompt);
      const coverUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=832&height=1216&model=flux&nologo=true&enhance=true&seed=${seed}`;
      saveBook({ cover_image_url: coverUrl });
      setSuccess("Cover generated! 🎨");
      setTimeout(() => setSuccess(""), 3000);
    } catch (e) { handleApiError(e); }
    finally { setGenerating(false); }
  };

  const regenerateCoverWithSeed = () => {
    if (!book.cover_image_url) return;
    try {
      const url = new URL(book.cover_image_url);
      url.searchParams.set("seed", Date.now().toString());
      saveBook({ cover_image_url: url.toString() });
      setSuccess("New variation! 🎨");
      setTimeout(() => setSuccess(""), 3000);
    } catch(e) { handleApiError(e); }
  };

  const downloadBook = () => {
    if (!book.chapters?.some(c => c.content)) { setError("Generate at least one chapter first."); setErrorType("general"); return; }
    const content = `# ${book.title}\n## ${book.subtitle || ""}\n\n${book.description || ""}\n\n---\n\n` +
      (book.chapters || []).map(c => `# Chapter ${c.number}: ${c.title}\n\n${c.content || "(Not yet generated)"}`).join("\n\n---\n\n");
    const blob = new Blob([content], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${book.title?.replace(/[^a-z0-9]/gi, "_")}.md`; a.click();
    URL.revokeObjectURL(url);
  };

  const pct = Math.round((usageCount / DAILY_LIMIT) * 100);

  if (loading) return <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center text-white">Loading...</div>;
  if (!book) return <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center text-white">Book not found. <Link to="/" className="underline ml-2">Go home</Link></div>;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
      {/* Header */}
      <div className="border-b border-white/10 bg-black/20 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link to="/" className="text-white/50 hover:text-white transition-colors text-sm">← Library</Link>
            <div>
              <h1 className="text-white font-bold text-lg leading-tight">{book.title}</h1>
              <p className="text-white/40 text-xs">{book.genre} • {book.target_audience}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {/* Usage counter */}
            <div className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 flex items-center gap-2">
              <div className={`text-xs font-bold ${pct >= 90 ? "text-red-400" : pct >= 70 ? "text-amber-400" : "text-green-400"}`}>
                {usageCount}/{DAILY_LIMIT}
              </div>
              <div className="w-12 h-1 bg-white/10 rounded-full overflow-hidden">
                <div className={`h-full rounded-full ${pct >= 90 ? "bg-red-500" : pct >= 70 ? "bg-amber-500" : "bg-green-500"}`}
                  style={{ width: `${Math.min(pct, 100)}%` }} />
              </div>
            </div>
            <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${book.status === "published" ? "bg-purple-500/20 text-purple-300" : book.status === "ready" ? "bg-green-500/20 text-green-300" : "bg-blue-500/20 text-blue-300"}`}>
              {book.status}
            </span>
          </div>
        </div>
        {/* Tabs */}
        <div className="max-w-7xl mx-auto px-6 flex gap-1 pb-0">
          {tabs.map((tab, i) => (
            <button key={i} onClick={() => setActiveTab(i)}
              className={`px-4 py-2.5 text-sm font-medium rounded-t-lg transition-all ${activeTab === i ? "bg-white/10 text-white border-b-2 border-purple-500" : "text-white/40 hover:text-white/70"}`}>
              {tab}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Quota banner */}
        {quotaHit && (
          <div className="bg-amber-500/20 border border-amber-500/40 rounded-xl p-5 mb-6 flex items-start gap-4">
            <span className="text-3xl">⏳</span>
            <div>
              <p className="text-amber-300 font-semibold">Gemini Free Daily Limit Reached</p>
              <p className="text-amber-200/70 text-sm mt-1">You've used all {DAILY_LIMIT} free requests today. Resets at <strong>midnight Pacific Time</strong>. Your progress is saved!</p>
            </div>
            <button onClick={() => { setQuotaHit(false); setError(""); }} className="text-amber-400/50 hover:text-amber-300 ml-auto">✕</button>
          </div>
        )}

        {error && !quotaHit && (
          <div className="bg-red-500/20 border border-red-500/30 text-red-300 rounded-xl p-4 mb-6 text-sm flex justify-between">
            <span>{error}</span>
            <button onClick={() => setError("")} className="text-red-400/50 hover:text-red-300 ml-4">✕</button>
          </div>
        )}
        {success && (
          <div className="bg-green-500/20 border border-green-500/30 text-green-300 rounded-xl p-4 mb-6 text-sm">{success}</div>
        )}

        {/* OUTLINE TAB */}
        {activeTab === 0 && (
          <div className="max-w-3xl mx-auto">
            <div className="bg-white/5 border border-white/10 rounded-2xl p-8">
              <h2 className="text-white text-2xl font-bold mb-1">{book.title}</h2>
              {book.subtitle && <p className="text-purple-300 mb-4">{book.subtitle}</p>}
              <p className="text-white/60 text-sm leading-relaxed mb-8">{book.description}</p>
              <h3 className="text-white/70 text-xs uppercase tracking-wider mb-4">Chapters</h3>
              <div className="space-y-2">
                {(book.chapters || []).map((ch, i) => (
                  <div key={i} className={`rounded-xl p-4 border flex items-start gap-3 ${ch.generated ? "bg-green-500/10 border-green-500/20" : "bg-white/5 border-white/10"}`}>
                    <span className={`font-bold text-sm min-w-[28px] ${ch.generated ? "text-green-400" : "text-purple-400"}`}>{ch.generated ? "✓" : ch.number + "."}</span>
                    <div className="flex-1">
                      <p className="text-white text-sm font-medium">{ch.title}</p>
                      <p className="text-white/40 text-xs mt-0.5">{ch.description}</p>
                    </div>
                    {ch.generated && <span className="text-green-400/60 text-xs">Written</span>}
                  </div>
                ))}
              </div>
              {book.chapters?.length > 0 && (
                <div className="mt-6 p-4 bg-white/5 rounded-xl">
                  <div className="flex justify-between text-sm text-white/60 mb-1">
                    <span>Writing progress</span>
                    <span>{book.chapters.filter(c => c.generated).length}/{book.chapters.length} chapters</span>
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

        {/* WRITE TAB */}
        {activeTab === 1 && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-1">
              <div className="bg-white/5 border border-white/10 rounded-2xl p-4 sticky top-24">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-white font-semibold text-sm">Chapters</h3>
                  <button onClick={generateAllChapters} disabled={generating || generatingChapter !== null || quotaHit}
                    className="text-xs bg-purple-500/20 text-purple-300 px-3 py-1.5 rounded-lg hover:bg-purple-500/30 disabled:opacity-40 border border-purple-500/30">
                    Generate All
                  </button>
                </div>
                <div className="space-y-1">
                  {(book.chapters || []).map((ch, i) => (
                    <button key={i} onClick={() => setSelectedChapter(i)}
                      className={`w-full text-left px-3 py-2.5 rounded-lg text-sm transition-all ${selectedChapter === i ? "bg-purple-500/20 text-white border border-purple-500/30" : "text-white/60 hover:bg-white/5"}`}>
                      <span className={`font-medium ${ch.generated ? "text-green-400" : ""}`}>
                        {ch.generated ? "✓ " : ""}{ch.number}. {ch.title}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="lg:col-span-2">
              {book.chapters?.[selectedChapter] && (
                <div className="bg-white/5 border border-white/10 rounded-2xl p-8">
                  <div className="flex items-start justify-between mb-6">
                    <div>
                      <h2 className="text-white text-xl font-bold">Chapter {book.chapters[selectedChapter].number}: {book.chapters[selectedChapter].title}</h2>
                      <p className="text-white/40 text-sm mt-1">{book.chapters[selectedChapter].description}</p>
                    </div>
                    <button onClick={() => generateChapter(selectedChapter)}
                      disabled={generatingChapter !== null || quotaHit}
                      className="bg-gradient-to-r from-purple-500 to-pink-500 text-white px-5 py-2.5 rounded-xl font-medium text-sm hover:opacity-90 disabled:opacity-50 flex items-center gap-2 whitespace-nowrap">
                      {generatingChapter === selectedChapter
                        ? <><svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>Writing...</>
                        : book.chapters[selectedChapter].generated ? "✍️ Rewrite" : "✍️ Write Chapter"}
                    </button>
                  </div>
                  {book.chapters[selectedChapter].content ? (
                    <div className="prose prose-invert prose-sm max-w-none">
                      <div className="text-white/80 text-sm leading-relaxed whitespace-pre-wrap max-h-[600px] overflow-y-auto pr-2">
                        {book.chapters[selectedChapter].content}
                      </div>
                    </div>
                  ) : (
                    <div className="text-center py-16 text-white/30">
                      <div className="text-4xl mb-3">✍️</div>
                      <p>Click "Write Chapter" to generate this chapter with Gemini AI</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* COVER TAB */}
        {activeTab === 2 && (
          <div className="max-w-5xl mx-auto">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              <div className="flex flex-col items-center">
                <h2 className="text-white text-xl font-bold mb-4 self-start">Cover Preview</h2>
                {book.cover_image_url ? (
                  <div className="w-full">
                    <img src={book.cover_image_url} alt="Book Cover"
                      className="w-full max-w-xs mx-auto rounded-2xl shadow-2xl shadow-purple-900/50 block" />
                    <div className="flex gap-2 mt-4 justify-center">
                      <button onClick={regenerateCoverWithSeed} disabled={generating}
                        className="text-sm border border-white/20 text-white/60 px-4 py-2 rounded-lg hover:bg-white/5 disabled:opacity-40">
                        🎲 New Variation
                      </button>
                      <a href={book.cover_image_url} target="_blank" rel="noopener noreferrer"
                        className="text-sm border border-white/20 text-white/60 px-4 py-2 rounded-lg hover:bg-white/5">
                        ⬇️ Download
                      </a>
                    </div>
                  </div>
                ) : (
                  <div className="w-full max-w-xs aspect-[2/3] bg-white/5 border-2 border-dashed border-white/20 rounded-2xl flex items-center justify-center">
                    <div className="text-center text-white/30">
                      <div className="text-5xl mb-2">🎨</div>
                      <p className="text-sm">Cover will appear here</p>
                    </div>
                  </div>
                )}
              </div>

              <div className="space-y-5">
                <h2 className="text-white text-xl font-bold">Cover Settings</h2>
                <div className="bg-white/5 border border-white/10 rounded-xl p-1 flex gap-1">
                  <button onClick={() => setCoverPromptMode("auto")}
                    className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${coverPromptMode === "auto" ? "bg-purple-500 text-white" : "text-white/50 hover:text-white"}`}>
                    ✨ AI Auto-Generate
                  </button>
                  <button onClick={() => setCoverPromptMode("custom")}
                    className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${coverPromptMode === "custom" ? "bg-purple-500 text-white" : "text-white/50 hover:text-white"}`}>
                    ✏️ Custom Prompt
                  </button>
                </div>

                {coverPromptMode === "auto" ? (
                  <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                    <p className="text-white/70 text-sm mb-2">Gemini will analyze your book and write a detailed cover prompt automatically.</p>
                    {generatedCoverPrompt && (
                      <div className="mt-3">
                        <p className="text-white/40 text-xs uppercase tracking-wider mb-1">Last generated prompt:</p>
                        <p className="text-white/50 text-xs leading-relaxed italic">{generatedCoverPrompt}</p>
                      </div>
                    )}
                  </div>
                ) : (
                  <div>
                    <label className="text-white/70 text-sm font-medium block mb-2">Describe your cover scene</label>
                    <textarea
                      value={customCoverPrompt}
                      onChange={e => setCustomCoverPrompt(e.target.value)}
                      placeholder="E.g. Two young men in their early 20s, one tall with dark hair and one with curly red hair, standing close together on a rainy city street at night, looking at each other with longing, warm ambient lighting from streetlamps, cinematic romantic mood, painterly digital art style..."
                      rows={7}
                      className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white placeholder-white/30 focus:outline-none focus:border-purple-500 resize-none text-sm"
                    />
                    <p className="text-white/30 text-xs mt-1">Be specific — describe characters, setting, mood, colors, art style.</p>
                  </div>
                )}

                <button onClick={generateCover} disabled={generating || quotaHit || (coverPromptMode === "custom" && !customCoverPrompt.trim())}
                  className="w-full bg-gradient-to-r from-purple-500 to-pink-500 text-white py-4 rounded-xl font-semibold text-lg hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">
                  {generating
                    ? <><svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>Generating cover...</>
                    : book.cover_image_url ? "🔄 Regenerate Cover" : "🎨 Generate Cover"}
                </button>
                {quotaHit && <p className="text-amber-400/70 text-sm">⏳ Daily Gemini quota reached — try again tomorrow</p>}

                <div className="bg-white/5 border border-white/10 rounded-xl p-4 text-xs text-white/40 space-y-1">
                  <p>💡 <strong className="text-white/60">Tips for great covers:</strong></p>
                  <p>• Describe character genders, ages, appearance explicitly</p>
                  <p>• Specify art style (photorealistic, painterly, illustrated, etc.)</p>
                  <p>• Include mood, lighting, and color palette</p>
                  <p>• Use "New Variation" to get different interpretations</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* SEO TAB */}
        {activeTab === 3 && (
          <div className="max-w-3xl mx-auto">
            <div className="bg-white/5 border border-white/10 rounded-2xl p-8">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="text-white text-2xl font-bold">SEO Optimization</h2>
                  <p className="text-white/50 text-sm mt-1">Amazon KDP & platform metadata</p>
                </div>
                <button onClick={generateSEO} disabled={generating || quotaHit}
                  className="bg-gradient-to-r from-purple-500 to-pink-500 text-white px-6 py-3 rounded-xl font-semibold hover:opacity-90 disabled:opacity-50 flex items-center gap-2">
                  {generating
                    ? <><svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>Generating...</>
                    : "🔍 Generate SEO"}
                </button>
              </div>
              <div className="space-y-5">
                {[
                  { label: "SEO Title", value: book.seo_title, key: "seo_title" },
                  { label: "SEO Description", value: book.seo_description, key: "seo_description", large: true },
                  { label: "Keywords", value: book.seo_keywords, key: "seo_keywords" },
                ].map(field => (
                  <div key={field.key}>
                    <label className="text-white/50 text-xs uppercase tracking-wider block mb-2">{field.label}</label>
                    {field.value ? (
                      field.large
                        ? <div className="bg-white/10 rounded-xl p-4 text-white/80 text-sm leading-relaxed">{field.value}</div>
                        : <div className="bg-white/10 rounded-xl p-4 text-white/80 text-sm">{field.value}</div>
                    ) : (
                      <div className="bg-white/5 border border-dashed border-white/10 rounded-xl p-4 text-white/20 text-sm italic">
                        Generate SEO to fill this field
                      </div>
                    )}
                  </div>
                ))}
                {book.notes && (() => {
                  try {
                    const n = JSON.parse(book.notes);
                    return n.back_cover_copy ? (
                      <div>
                        <label className="text-white/50 text-xs uppercase tracking-wider block mb-2">Back Cover Copy</label>
                        <div className="bg-white/10 rounded-xl p-4 text-white/80 text-sm leading-relaxed">{n.back_cover_copy}</div>
                      </div>
                    ) : null;
                  } catch { return null; }
                })()}
              </div>
            </div>
          </div>
        )}

        {/* PUBLISH TAB */}
        {activeTab === 4 && (
          <div className="max-w-3xl mx-auto space-y-6">
            <div className="bg-white/5 border border-white/10 rounded-2xl p-8">
              <h2 className="text-white text-2xl font-bold mb-2">Ready to Publish</h2>
              <p className="text-white/50 mb-6">Export your book and upload to publishing platforms</p>
              <div className="space-y-3 mb-8">
                {[
                  { label: "Outline created", done: !!book.outline },
                  { label: "Chapters written", done: book.chapters?.some(c => c.generated) },
                  { label: "Cover image generated", done: !!book.cover_image_url },
                  { label: "SEO metadata ready", done: !!book.seo_title },
                ].map((item, i) => (
                  <div key={i} className={`flex items-center gap-3 p-3 rounded-lg ${item.done ? "bg-green-500/10" : "bg-white/5"}`}>
                    <span className={item.done ? "text-green-400" : "text-white/20"}>{item.done ? "✅" : "⭕"}</span>
                    <span className={`text-sm ${item.done ? "text-white" : "text-white/40"}`}>{item.label}</span>
                  </div>
                ))}
              </div>
              <button onClick={downloadBook}
                className="w-full bg-gradient-to-r from-purple-500 to-pink-500 text-white py-4 rounded-xl font-semibold text-lg hover:opacity-90 flex items-center justify-center gap-2">
                📥 Download as Markdown
              </button>
              <p className="text-white/30 text-xs text-center mt-3">Upload the .md file to Amazon KDP, Smashwords, or Draft2Digital</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {[
                { name: "Amazon KDP", url: "https://kdp.amazon.com", color: "from-orange-500/20 to-orange-600/20", border: "border-orange-500/30", icon: "📦" },
                { name: "Smashwords", url: "https://www.smashwords.com", color: "from-blue-500/20 to-blue-600/20", border: "border-blue-500/30", icon: "📚" },
                { name: "Draft2Digital", url: "https://draft2digital.com", color: "from-green-500/20 to-green-600/20", border: "border-green-500/30", icon: "🌐" },
              ].map(p => (
                <a key={p.name} href={p.url} target="_blank" rel="noopener noreferrer"
                  className={`bg-gradient-to-br ${p.color} border ${p.border} rounded-xl p-5 text-center hover:opacity-80 transition-opacity`}>
                  <div className="text-3xl mb-2">{p.icon}</div>
                  <p className="text-white font-semibold text-sm">{p.name}</p>
                  <p className="text-white/40 text-xs mt-1">Open platform →</p>
                </a>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
