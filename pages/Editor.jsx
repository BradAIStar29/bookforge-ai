import { useState, useEffect } from "react";
import { Book, GeminiUsage } from "@/api/entities";
import { Link, useSearchParams } from "react-router-dom";


const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent";
const DAILY_LIMIT = 1500;
const tabs = ["📋 Outline", "✍️ Write", "🎨 Cover", "🔍 SEO", "📤 Publish"];

async function callGemini(prompt) {
  const apiKey = localStorage.getItem("gemini_api_key") || "";
  const res = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.8, maxOutputTokens: 8192 }
    })
  });
  const data = await res.json();
  if (!res.ok) {
    const errStatus = data.error?.status;
    if (res.status === 429 || errStatus === "RESOURCE_EXHAUSTED") throw { type: "quota_exceeded", message: "Daily Gemini limit reached. Resets at midnight Pacific Time." };
    if (res.status === 403) throw { type: "api_key_error", message: "Invalid Gemini API key." };
    throw { type: "general", message: data.error?.message || "Gemini API error" };
  }
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    if (data.candidates?.[0]?.finishReason === "SAFETY") throw { type: "safety_block", message: "Content blocked for safety. Try rephrasing." };
    throw { type: "general", message: "Empty response from Gemini. Please try again." };
  }
  return text;
}

function QuotaBanner({ onDismiss }) {
  return (
    <div className="bg-amber-500/20 border border-amber-500/40 rounded-xl p-5 mb-6 flex items-start gap-4">
      <span className="text-3xl">⏳</span>
      <div className="flex-1">
        <p className="text-amber-300 font-semibold">Gemini Free Daily Limit Reached</p>
        <p className="text-amber-200/70 text-sm mt-1">You've used all {DAILY_LIMIT} free requests today. Limits reset at <strong>midnight Pacific Time</strong>. Your progress is saved!</p>
        <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" className="inline-block mt-2 text-amber-300 text-xs underline">Upgrade for unlimited access →</a>
      </div>
      <button onClick={onDismiss} className="text-amber-400/50 hover:text-amber-300">✕</button>
    </div>
  );
}

export default function Editor() {
  const [searchParams] = useSearchParams();
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
  const [usage, setUsage] = useState({ count: 0, limit: DAILY_LIMIT, remaining: DAILY_LIMIT, pct: 0 });

  useEffect(() => {
    if (bookId) Book.get(bookId).then(b => { setBook(b); setLoading(false); });
    loadUsage();
  }, [bookId]);

  const loadUsage = () => {
    const today = new Date().toISOString().split("T")[0];
    GeminiUsage.filter({ date: today }).then(records => {
      const count = records[0]?.request_count || 0;
      const pct = Math.round((count / DAILY_LIMIT) * 100);
      setUsage({ count, limit: DAILY_LIMIT, remaining: DAILY_LIMIT - count, pct });
      if (count >= DAILY_LIMIT) setQuotaHit(true);
    }).catch(() => {});
  };

  const incrementUsage = () => {
    const today = new Date().toISOString().split("T")[0];
    GeminiUsage.filter({ date: today }).then(records => {
      if (records.length === 0) {
        GeminiUsage.create({ date: today, request_count: 1, daily_limit: DAILY_LIMIT }).catch(() => {});
        setUsage(u => ({ ...u, count: 1, remaining: DAILY_LIMIT - 1, pct: 0 }));
      } else {
        const newCount = (records[0].request_count || 0) + 1;
        GeminiUsage.update(records[0].id, { request_count: newCount }).catch(() => {});
        const pct = Math.round((newCount / DAILY_LIMIT) * 100);
        setUsage({ count: newCount, limit: DAILY_LIMIT, remaining: DAILY_LIMIT - newCount, pct });
        if (newCount >= DAILY_LIMIT) setQuotaHit(true);
      }
    }).catch(() => {});
  };

  const saveBook = async (updates) => {
    const updated = await Book.update(bookId, updates);
    setBook(updated);
    return updated;
  };

  const handleApiError = (e) => {
    const type = e.type || "general";
    setErrorType(type);
    setError(e.message || "Something went wrong");
    if (type === "quota_exceeded") setQuotaHit(true);
  };

  const generateChapter = async (idx) => {
    if (quotaHit) { setErrorType("quota_exceeded"); setError("quota"); return; }
    setGeneratingChapter(idx); setError("");
    try {
      const outline = JSON.parse(book.outline || "{}");
      const ch = outline.chapters[idx];
      const prev = (book.chapters || []).slice(0, idx).map(c => c.title).join(", ") || "None";
      const content = await callGemini(
        'Write Chapter ' + ch.number + ': "' + ch.title + '" for a ' + book.genre + ' book titled "' + outline.title + '".\n' +
        "Description: " + ch.description + "\nPrevious chapters: " + prev + "\nAudience: " + book.target_audience +
        "\n\nWrite 2,500-3,500 words with headings/subheadings. High quality and engaging."
      );
      incrementUsage(); // fire-and-forget
      const updatedChapters = [...(book.chapters || [])];
      updatedChapters[idx] = { ...updatedChapters[idx], content, generated: true };
      const wordCount = updatedChapters.reduce((acc, c) => acc + (c.content?.split(/\s+/).length || 0), 0);
      await saveBook({ chapters: updatedChapters, word_count: wordCount, status: "writing" });
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
    if (quotaHit) { setErrorType("quota_exceeded"); setError("quota"); return; }
    setGenerating(true); setError("");
    try {
      const outline = JSON.parse(book.outline || "{}");
      const raw = await callGemini(
        "Amazon KDP SEO expert. Generate metadata.\nTitle: " + outline.title +
        "\nGenre: " + book.genre + "\nDesc: " + outline.description +
        '\n\nRespond with ONLY valid JSON:\n{"seo_title":"","seo_description":"","primary_keywords":[""],"bisac_categories":[""],"back_cover_copy":"","author_bio_template":""}'
      );
      incrementUsage(); // fire-and-forget
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw { type: "general", message: "Could not parse SEO data. Please try again." };
      const seo = JSON.parse(jsonMatch[0]);
      await saveBook({
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
    if (quotaHit) { setErrorType("quota_exceeded"); setError("quota"); return; }
    setGenerating(true); setError("");
    try {
      const outline = JSON.parse(book.outline || "{}");
      const coverPrompt = await callGemini(
        'Book cover image prompt for: "' + outline.title + '"\nGenre: ' + book.genre + "\nDesc: " + outline.description +
        "\nDetailed art style, colors, imagery, mood, composition. No text in image. Return only the prompt."
      );
      incrementUsage(); // fire-and-forget
      const fullPrompt = `Professional book cover for "${book.title}". ${coverPrompt.trim()}. High quality, commercial publishing standard, eye-catching composition. No text.`;
      const encodedPrompt = encodeURIComponent(fullPrompt);
      const coverUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=800&height=1200&nologo=true&seed=${Date.now()}`;
      await saveBook({ cover_image_url: coverUrl });
      setSuccess("Cover generated! 🎨");
      setTimeout(() => setSuccess(""), 3000);
    } catch (e) { handleApiError(e); }
    finally { setGenerating(false); }
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

  const markPublished = async () => {
    await saveBook({ status: "published" });
    setSuccess("Marked as published! 🎉");
    setTimeout(() => setSuccess(""), 4000);
  };

  if (loading) return <div className="min-h-screen bg-slate-900 flex items-center justify-center text-white/50">Loading...</div>;
  if (!book) return <div className="min-h-screen bg-slate-900 flex items-center justify-center text-white/50">Book not found</div>;

  const outline = (() => { try { return JSON.parse(book.outline || "{}"); } catch { return {}; } })();
  const generatedCount = (book.chapters || []).filter(c => c.generated).length;
  const totalChapters = (book.chapters || []).length;
  const progress = totalChapters > 0 ? Math.round((generatedCount / totalChapters) * 100) : 0;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
      {/* Header */}
      <div className="border-b border-white/10 bg-black/20 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link to="/" className="text-white/50 hover:text-white transition-colors text-sm">← Library</Link>
            <div>
              <h1 className="text-white font-bold">{book.title}</h1>
              <p className="text-white/40 text-xs">{book.genre} · {book.target_audience}</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            {/* Gemini Counter */}
            <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5">
              <span className="text-white/40 text-xs">Gemini</span>
              <div className="w-20 h-1.5 bg-white/10 rounded-full overflow-hidden">
                <div className={`h-full rounded-full transition-all ${usage.pct >= 90 ? "bg-red-500" : usage.pct >= 70 ? "bg-amber-500" : "bg-green-500"}`}
                  style={{ width: `${Math.min(usage.pct, 100)}%` }} />
              </div>
              <span className={`text-xs font-mono font-medium ${usage.pct >= 90 ? "text-red-400" : usage.pct >= 70 ? "text-amber-400" : "text-green-400"}`}>
                {usage.count}/{usage.limit}
              </span>
            </div>
            <div className="text-white/50 text-sm">{book.word_count?.toLocaleString() || 0} words</div>
            <div className="flex items-center gap-2">
              <div className="h-2 w-20 bg-white/10 rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-purple-500 to-pink-500 transition-all" style={{ width: `${progress}%` }} />
              </div>
              <span className="text-white/50 text-xs">{generatedCount}/{totalChapters} ch</span>
            </div>
          </div>
        </div>
        <div className="max-w-7xl mx-auto px-6 flex gap-1">
          {tabs.map((tab, i) => (
            <button key={i} onClick={() => setActiveTab(i)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === i ? "border-purple-500 text-white" : "border-transparent text-white/40 hover:text-white/70"}`}>
              {tab}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8">
        {errorType === "quota_exceeded" && error && <QuotaBanner onDismiss={() => { setError(""); setErrorType("general"); }} />}
        {error && errorType !== "quota_exceeded" && (
          <div className="bg-red-500/20 border border-red-500/30 text-red-300 rounded-xl p-4 mb-6 flex justify-between">
            <span className="text-sm">{error}</span>
            <button onClick={() => setError("")} className="text-red-300/50 hover:text-red-300 ml-4">✕</button>
          </div>
        )}
        {success && <div className="bg-green-500/20 border border-green-500/30 text-green-300 rounded-xl p-4 mb-6">✅ {success}</div>}

        {/* OUTLINE TAB */}
        {activeTab === 0 && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div className="space-y-4">
              <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
                <h3 className="text-white font-bold text-lg mb-1">{book.title}</h3>
                <p className="text-purple-300 mb-4">{book.subtitle}</p>
                <p className="text-white/60 text-sm leading-relaxed">{book.description}</p>
              </div>
              {outline.themes && (
                <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
                  <h3 className="text-white/70 text-xs uppercase tracking-wider mb-3">Key Themes</h3>
                  <ul className="space-y-1">
                    {outline.themes.map((t, i) => <li key={i} className="text-white/60 text-sm flex gap-2"><span className="text-purple-400">•</span>{t}</li>)}
                  </ul>
                </div>
              )}
            </div>
            <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
              <h3 className="text-white/70 text-xs uppercase tracking-wider mb-4">Chapters ({totalChapters})</h3>
              <div className="space-y-2 max-h-[500px] overflow-y-auto pr-2">
                {(book.chapters || []).map((ch, i) => (
                  <div key={i} className={`p-3 rounded-lg border ${ch.generated ? "border-green-500/30 bg-green-500/5" : "border-white/10 bg-white/5"}`}>
                    <div className="flex items-center justify-between">
                      <span className="text-white/80 text-sm font-medium">{ch.number}. {ch.title}</span>
                      {ch.generated ? <span className="text-green-400 text-xs">✓ Done</span> : <span className="text-white/30 text-xs">Pending</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* WRITE TAB */}
        {activeTab === 1 && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-1">
              <div className="bg-white/5 border border-white/10 rounded-2xl p-4 sticky top-32">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-white font-semibold">Chapters</h3>
                  {generatedCount < totalChapters && (
                    <button onClick={generateAllChapters} disabled={generatingChapter !== null || quotaHit}
                      className="text-xs bg-purple-500/20 text-purple-300 px-3 py-1 rounded-lg hover:bg-purple-500/30 disabled:opacity-50">
                      Generate All
                    </button>
                  )}
                </div>
                <div className="space-y-1.5">
                  {(book.chapters || []).map((ch, i) => (
                    <button key={i} onClick={() => setSelectedChapter(i)}
                      className={`w-full text-left px-3 py-2.5 rounded-lg transition-all text-sm flex items-center justify-between ${selectedChapter === i ? "bg-purple-500/20 text-white border border-purple-500/40" : "text-white/60 hover:bg-white/5"}`}>
                      <span className="truncate">{ch.number}. {ch.title}</span>
                      {generatingChapter === i
                        ? <svg className="animate-spin h-3 w-3 text-purple-400 flex-shrink-0" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
                        : ch.generated ? <span className="text-green-400 text-xs flex-shrink-0">✓</span> : null}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="lg:col-span-2">
              {book.chapters?.[selectedChapter] && (
                <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
                  <div className="flex items-start justify-between mb-6">
                    <div>
                      <h2 className="text-white text-xl font-bold">Chapter {book.chapters[selectedChapter].number}: {book.chapters[selectedChapter].title}</h2>
                      <p className="text-white/40 text-sm mt-1">{book.chapters[selectedChapter].description}</p>
                    </div>
                    <button onClick={() => generateChapter(selectedChapter)} disabled={generatingChapter !== null || quotaHit}
                      className="bg-gradient-to-r from-purple-500 to-pink-500 text-white px-4 py-2 rounded-xl text-sm font-semibold hover:opacity-90 disabled:opacity-50 flex items-center gap-2 ml-4 flex-shrink-0">
                      {generatingChapter === selectedChapter
                        ? <><svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>Writing...</>
                        : book.chapters[selectedChapter].generated ? "♻️ Regenerate" : "✨ Generate"}
                    </button>
                  </div>
                  {book.chapters[selectedChapter].content ? (
                    <div className="bg-white/5 rounded-xl p-6 max-h-[600px] overflow-y-auto">
                      <pre className="text-white/80 text-sm leading-relaxed whitespace-pre-wrap font-sans">{book.chapters[selectedChapter].content}</pre>
                    </div>
                  ) : (
                    <div className="text-center py-16 text-white/30">
                      <div className="text-4xl mb-3">✍️</div>
                      <p>{quotaHit ? "⏳ Daily quota reached — come back tomorrow!" : "Click \"Generate\" to write this chapter with Gemini AI"}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* COVER TAB */}
        {activeTab === 2 && (
          <div className="max-w-2xl mx-auto">
            <div className="bg-white/5 border border-white/10 rounded-2xl p-8 text-center">
              <h2 className="text-white text-2xl font-bold mb-2">Book Cover</h2>
              <p className="text-white/50 mb-8">AI generates a professional, marketable cover for your book</p>
              {book.cover_image_url
                ? <div className="mb-6"><img src={book.cover_image_url} alt="Book Cover" className="max-w-sm mx-auto rounded-2xl shadow-2xl shadow-purple-900/50" /></div>
                : <div className="w-64 h-96 bg-white/5 border-2 border-dashed border-white/20 rounded-2xl mx-auto mb-8 flex items-center justify-center">
                    <div className="text-center text-white/30"><div className="text-5xl mb-2">🎨</div><p className="text-sm">Cover will appear here</p></div>
                  </div>}
              <button onClick={generateCover} disabled={generating || quotaHit}
                className="bg-gradient-to-r from-purple-500 to-pink-500 text-white px-8 py-4 rounded-xl font-semibold text-lg hover:opacity-90 disabled:opacity-50 flex items-center gap-2 mx-auto">
                {generating
                  ? <><svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>Generating...</>
                  : book.cover_image_url ? "🔄 Regenerate Cover" : "🎨 Generate Cover"}
              </button>
              {quotaHit && <p className="text-amber-400/70 text-sm mt-3">⏳ Daily quota reached — try again tomorrow</p>}
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
                  <p className="text-white/50 text-sm">Optimized for Amazon KDP & all major platforms</p>
                </div>
                <button onClick={generateSEO} disabled={generating || quotaHit}
                  className="bg-gradient-to-r from-purple-500 to-pink-500 text-white px-5 py-2.5 rounded-xl font-semibold hover:opacity-90 disabled:opacity-50">
                  {generating ? "Generating..." : "🔍 Generate SEO"}
                </button>
              </div>
              {book.seo_title ? (
                <div className="space-y-5">
                  <div><label className="text-white/50 text-xs uppercase tracking-wider block mb-2">SEO Title</label><div className="bg-white/10 rounded-xl p-4 text-white">{book.seo_title}</div></div>
                  <div><label className="text-white/50 text-xs uppercase tracking-wider block mb-2">Amazon Description</label><div className="bg-white/10 rounded-xl p-4 text-white/80 text-sm leading-relaxed max-h-48 overflow-y-auto whitespace-pre-wrap">{book.seo_description}</div></div>
                  <div>
                    <label className="text-white/50 text-xs uppercase tracking-wider block mb-2">Keywords</label>
                    <div className="flex flex-wrap gap-2">
                      {book.seo_keywords?.split(",").map((k, i) => <span key={i} className="bg-purple-500/20 text-purple-300 px-3 py-1 rounded-full text-sm border border-purple-500/30">{k.trim()}</span>)}
                    </div>
                  </div>
                  {book.notes && (() => { try { const n = JSON.parse(book.notes); return n.back_cover_copy ? <div><label className="text-white/50 text-xs uppercase tracking-wider block mb-2">Back Cover Copy</label><div className="bg-white/10 rounded-xl p-4 text-white/80 text-sm leading-relaxed">{n.back_cover_copy}</div></div> : null; } catch { return null; } })()}
                </div>
              ) : (
                <div className="text-center py-12 text-white/30">
                  <div className="text-4xl mb-3">🔍</div>
                  <p>{quotaHit ? "⏳ Daily quota reached — try again tomorrow" : "Click \"Generate SEO\" to create optimized metadata"}</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* PUBLISH TAB */}
        {activeTab === 4 && (
          <div className="max-w-3xl mx-auto">
            <div className="bg-white/5 border border-white/10 rounded-2xl p-8">
              <h2 className="text-white text-2xl font-bold mb-2">Publish Your Book</h2>
              <p className="text-white/50 mb-8">Download and publish on these platforms</p>
              <div className="bg-white/5 rounded-xl p-5 mb-8">
                <h3 className="text-white font-semibold mb-4">Publishing Readiness</h3>
                <div className="space-y-2">
                  {[
                    { label: "Book outline created", done: !!book.outline },
                    { label: `Chapters written (${generatedCount}/${totalChapters})`, done: generatedCount > 0 },
                    { label: "All chapters complete", done: generatedCount === totalChapters && totalChapters > 0 },
                    { label: "Cover image generated", done: !!book.cover_image_url },
                    { label: "SEO metadata ready", done: !!book.seo_title },
                  ].map((item, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <span className={item.done ? "text-green-400" : "text-white/20"}>{item.done ? "✅" : "○"}</span>
                      <span className={item.done ? "text-white/80" : "text-white/30"}>{item.label}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="mb-8">
                <h3 className="text-white font-semibold mb-4">📥 Download Your Book</h3>
                <button onClick={downloadBook} className="w-full border border-purple-500/40 bg-purple-500/10 text-purple-300 py-3 rounded-xl hover:bg-purple-500/20 transition-colors font-medium">
                  Download as Markdown
                </button>
                <p className="text-white/30 text-xs mt-2 text-center">Use <a href="https://calibre-ebook.com" target="_blank" rel="noopener noreferrer" className="underline">Calibre (free)</a> to convert to EPUB/PDF for KDP</p>
              </div>
              <h3 className="text-white font-semibold mb-4">🚀 Publishing Platforms</h3>
              <div className="space-y-3">
                {[
                  { name: "Amazon KDP", icon: "📦", desc: "35-70% royalties. Largest marketplace.", url: "https://kdp.amazon.com", badge: "Most Popular", color: "from-orange-500/20 to-orange-600/10 border-orange-500/30" },
                  { name: "Smashwords", icon: "📚", desc: "Distributes to Apple Books, B&N, Kobo & more.", url: "https://www.smashwords.com", badge: "Multi-platform", color: "from-blue-500/20 to-blue-600/10 border-blue-500/30" },
                  { name: "Draft2Digital", icon: "✍️", desc: "Free formatting, 40+ retailers.", url: "https://www.draft2digital.com", badge: "Best Tools", color: "from-teal-500/20 to-teal-600/10 border-teal-500/30" },
                  { name: "Lulu", icon: "🌟", desc: "Print-on-demand + ebook.", url: "https://www.lulu.com", badge: "Print + Digital", color: "from-pink-500/20 to-pink-600/10 border-pink-500/30" },
                  { name: "PublishDrive", icon: "🚀", desc: "Distribute to 400+ stores.", url: "https://publishdrive.com", badge: "400+ Stores", color: "from-purple-500/20 to-purple-600/10 border-purple-500/30" },
                ].map(p => (
                  <a key={p.name} href={p.url} target="_blank" rel="noopener noreferrer"
                    className={`block bg-gradient-to-r ${p.color} border rounded-xl p-4 hover:opacity-90 transition-opacity`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className="text-2xl">{p.icon}</span>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-white font-semibold">{p.name}</span>
                            <span className="text-xs bg-white/10 px-2 py-0.5 rounded text-white/60">{p.badge}</span>
                          </div>
                          <p className="text-white/50 text-sm">{p.desc}</p>
                        </div>
                      </div>
                      <span className="text-white/40">→</span>
                    </div>
                  </a>
                ))}
              </div>
              <div className="mt-6 pt-6 border-t border-white/10">
                <button onClick={markPublished} className="w-full bg-gradient-to-r from-purple-500 to-pink-500 text-white py-3 rounded-xl font-semibold hover:opacity-90">
                  🚀 Mark as Published
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
