// BookForge AI — Create Book
// 100% localStorage, zero backend calls
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";

const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent";
const DAILY_LIMIT = 1500;

const GENRES = [
  "Fiction - Romance","Fiction - Gay Romance","Fiction - LGBT+","Fiction - Thriller",
  "Fiction - Fantasy","Fiction - Sci-Fi","Fiction - Mystery","Fiction - Horror",
  "Self-Help","Business & Finance","Health & Wellness","Personal Development",
  "Biography & Memoir","History","True Crime","Cookbook","Travel","Spirituality",
  "Science","Technology","Parenting","Education"
];

const AUDIENCES = [
  "General Adults","Young Adults (18-25)","LGBT+ Readers","Women","Men",
  "Professionals & Entrepreneurs","Parents","Students","Seniors","Beginners","Advanced Readers"
];

function trackUsage() {
  try {
    const today = new Date().toISOString().split("T")[0];
    const d = JSON.parse(localStorage.getItem("bfai_usage") || "{}");
    const count = (d.date === today ? d.count : 0) + 1;
    localStorage.setItem("bfai_usage", JSON.stringify({ date: today, count }));
    return count;
  } catch { return 0; }
}

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
    const status = data?.error?.status || "";
    if (res.status === 401 || res.status === 403) throw { code: "BAD_KEY" };
    if (res.status === 429 || status === "RESOURCE_EXHAUSTED") throw { code: "QUOTA" };
    throw { code: "ERROR", msg: data?.error?.message || `HTTP ${res.status}` };
  }
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    if (data?.candidates?.[0]?.finishReason === "SAFETY") throw { code: "SAFETY" };
    throw { code: "EMPTY" };
  }
  return text;
}

export default function Create() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [outline, setOutline] = useState(null);
  const [form, setForm] = useState({ topic: "", genre: "", audience: "" });
  const [keyDraft, setKeyDraft] = useState("");
  const [showKeyInput, setShowKeyInput] = useState(!localStorage.getItem("gemini_api_key"));

  const saveKey = () => {
    const k = keyDraft.trim();
    if (!k) return;
    localStorage.setItem("gemini_api_key", k);
    setShowKeyInput(false);
    setKeyDraft("");
    setError("");
  };

  const generate = async () => {
    if (!localStorage.getItem("gemini_api_key")) { setShowKeyInput(true); setError("Add your Gemini API key first."); return; }
    if (!form.topic || !form.genre || !form.audience) { setError("Please fill in all three fields."); return; }
    setLoading(true); setError("");
    try {
      const raw = await callGemini(
        "You are a bestselling author. Create a detailed book outline.\n" +
        "Topic/Idea: " + form.topic + "\nGenre: " + form.genre + "\nTarget Audience: " + form.audience + "\n\n" +
        "Respond with ONLY valid JSON (no markdown, no explanation):\n" +
        '{"title":"","subtitle":"","description":"","themes":[""],"estimated_word_count":50000,' +
        '"chapters":[{"number":1,"title":"","description":""}]}'
      );
      trackUsage();
      const match = raw.match(/\{[\s\S]*\}/);
      if (!match) throw { code: "PARSE" };
      setOutline(JSON.parse(match[0]));
      setStep(2);
    } catch (e) {
      const c = e.code || "ERROR";
      if (c === "NO_KEY" || c === "BAD_KEY") { setShowKeyInput(true); setError("API key missing or invalid. Please check it."); }
      else if (c === "QUOTA") setError("⏳ Gemini daily limit reached. Try again after midnight Pacific Time.");
      else if (c === "SAFETY") setError("Content blocked by safety filter. Try rephrasing your topic.");
      else if (c === "PARSE") setError("Couldn't parse the outline. Please try again.");
      else setError(e.msg || "Something went wrong. Please try again.");
    } finally { setLoading(false); }
  };

  const confirm = () => {
    const books = JSON.parse(localStorage.getItem("bfai_books") || "[]");
    const book = {
      id: "book_" + Date.now() + "_" + Math.random().toString(36).slice(2,7),
      title: outline.title,
      subtitle: outline.subtitle || "",
      genre: form.genre,
      target_audience: form.audience,
      description: outline.description,
      themes: outline.themes || [],
      estimated_word_count: outline.estimated_word_count || 50000,
      chapters: (outline.chapters || []).map(c => ({ ...c, content: "", generated: false })),
      outline: JSON.stringify(outline),
      status: "outlining",
      word_count: 0,
      cover_image_url: "",
      seo_title: "", seo_description: "", seo_keywords: "", notes: "",
      created_date: new Date().toISOString(),
    };
    books.unshift(book);
    localStorage.setItem("bfai_books", JSON.stringify(books));
    navigate(`/editor?id=${book.id}`);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
      <div className="border-b border-white/10 bg-black/20 backdrop-blur-sm">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center gap-4">
          <Link to="/" className="text-white/40 hover:text-white text-sm transition-colors">← Library</Link>
          <h1 className="text-white font-bold text-xl">Create New Book</h1>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-6 py-10">
        {/* API Key banner */}
        {showKeyInput ? (
          <div className="bg-amber-500/15 border border-amber-500/40 rounded-xl p-5 mb-6">
            <p className="text-amber-300 font-semibold mb-1">🔑 Gemini API Key Required</p>
            <p className="text-amber-200/60 text-sm mb-3">
              Free key at{" "}
              <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" className="underline text-amber-300">aistudio.google.com</a>
              {" "}— stored only in your browser.
            </p>
            <div className="flex gap-2">
              <input type="password" placeholder="AIza..." value={keyDraft} onChange={e => setKeyDraft(e.target.value)}
                onKeyDown={e => e.key === "Enter" && saveKey()}
                className="flex-1 bg-white/10 border border-white/20 rounded-lg px-4 py-2 text-white placeholder-white/30 focus:outline-none focus:border-amber-500 font-mono text-sm" />
              <button onClick={saveKey} disabled={!keyDraft.trim()}
                className="bg-amber-500 text-black px-5 py-2 rounded-lg font-semibold text-sm hover:bg-amber-400 disabled:opacity-40">Save</button>
              {localStorage.getItem("gemini_api_key") && (
                <button onClick={() => setShowKeyInput(false)} className="text-white/40 hover:text-white px-3 text-sm">✕</button>
              )}
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between bg-green-500/10 border border-green-500/30 rounded-xl px-5 py-3 mb-6">
            <span className="text-green-400 text-sm">✅ Gemini API key is set</span>
            <button onClick={() => { setKeyDraft(""); setShowKeyInput(true); }} className="text-green-400/50 hover:text-green-300 text-xs underline">Change</button>
          </div>
        )}

        {/* Steps */}
        <div className="flex items-center gap-3 mb-8">
          {["Book Concept", "Review & Confirm"].map((label, i) => (
            <div key={i} className="flex items-center gap-2">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${step > i+1 ? "bg-green-500 text-white" : step === i+1 ? "bg-purple-500 text-white" : "bg-white/10 text-white/30"}`}>
                {step > i+1 ? "✓" : i+1}
              </div>
              <span className={`text-sm ${step === i+1 ? "text-white" : "text-white/30"}`}>{label}</span>
              {i < 1 && <div className="w-10 h-px bg-white/20 mx-1" />}
            </div>
          ))}
        </div>

        {error && <div className="bg-red-500/20 border border-red-500/30 text-red-300 rounded-xl p-4 mb-6 text-sm">{error}</div>}

        {/* Step 1 */}
        {step === 1 && (
          <div className="bg-white/5 border border-white/10 rounded-2xl p-8">
            <h2 className="text-white text-2xl font-bold mb-2">Your Book Idea</h2>
            <p className="text-white/40 mb-8 text-sm">Gemini AI will generate a full outline, chapters, cover, and SEO metadata</p>
            <div className="space-y-6">
              <div>
                <label className="text-white/70 text-sm font-medium block mb-2">Topic / Story Idea *</label>
                <textarea rows={4} placeholder='E.g. "Two gay college athletes fall in love across rival teams during championship season"'
                  value={form.topic} onChange={e => setForm({...form, topic: e.target.value})}
                  className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white placeholder-white/25 focus:outline-none focus:border-purple-500 resize-none text-sm" />
              </div>
              <div>
                <label className="text-white/70 text-sm font-medium block mb-3">Genre *</label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {GENRES.map(g => (
                    <button key={g} onClick={() => setForm({...form, genre: g})}
                      className={`text-xs px-3 py-2 rounded-lg border text-left transition-all ${form.genre === g ? "border-purple-500 bg-purple-500/25 text-white" : "border-white/15 text-white/40 hover:border-white/30 hover:text-white/70"}`}>
                      {g}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-white/70 text-sm font-medium block mb-3">Target Audience *</label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {AUDIENCES.map(a => (
                    <button key={a} onClick={() => setForm({...form, audience: a})}
                      className={`text-xs px-3 py-2 rounded-lg border text-left transition-all ${form.audience === a ? "border-purple-500 bg-purple-500/25 text-white" : "border-white/15 text-white/40 hover:border-white/30 hover:text-white/70"}`}>
                      {a}
                    </button>
                  ))}
                </div>
              </div>
              <button onClick={generate} disabled={loading || !form.topic.trim() || !form.genre || !form.audience}
                className="w-full bg-gradient-to-r from-purple-500 to-pink-500 text-white py-4 rounded-xl font-semibold text-lg hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2">
                {loading
                  ? <><svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>Generating outline…</>
                  : "✨ Generate Book Outline"}
              </button>
            </div>
          </div>
        )}

        {/* Step 2 */}
        {step === 2 && outline && (
          <div className="space-y-6">
            <div className="bg-white/5 border border-white/10 rounded-2xl p-8">
              <div className="flex items-start justify-between mb-5">
                <div>
                  <h2 className="text-white text-2xl font-bold">{outline.title}</h2>
                  {outline.subtitle && <p className="text-purple-300 mt-1 text-sm">{outline.subtitle}</p>}
                </div>
                <span className="bg-green-500/20 text-green-400 text-xs px-3 py-1 rounded-full border border-green-500/30 whitespace-nowrap ml-4">AI Generated</span>
              </div>
              <div className="bg-white/5 rounded-xl p-4 mb-6">
                <p className="text-white/40 text-xs uppercase tracking-wider mb-2">Description</p>
                <p className="text-white/80 text-sm leading-relaxed">{outline.description}</p>
              </div>
              <p className="text-white/40 text-xs uppercase tracking-wider mb-3">Chapters ({outline.chapters?.length})</p>
              <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                {outline.chapters?.map((ch, i) => (
                  <div key={i} className="bg-white/5 rounded-lg px-4 py-3 flex gap-3">
                    <span className="text-purple-400 font-bold text-sm min-w-[24px]">{ch.number}.</span>
                    <div>
                      <p className="text-white text-sm font-medium">{ch.title}</p>
                      {ch.description && <p className="text-white/35 text-xs mt-0.5">{ch.description}</p>}
                    </div>
                  </div>
                ))}
              </div>
              {outline.estimated_word_count && (
                <p className="text-white/30 text-sm mt-4">📊 ~{outline.estimated_word_count.toLocaleString()} words estimated</p>
              )}
            </div>
            <div className="flex gap-4">
              <button onClick={() => { setStep(1); setOutline(null); setError(""); }}
                className="flex-1 border border-white/20 text-white/60 py-3 rounded-xl hover:bg-white/5 transition-colors">
                ← Regenerate
              </button>
              <button onClick={confirm}
                className="flex-1 bg-gradient-to-r from-purple-500 to-pink-500 text-white py-3 rounded-xl font-semibold hover:opacity-90 flex items-center justify-center gap-2">
                ✅ Start Writing This Book →
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
