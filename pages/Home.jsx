// BookForge AI — Home/Library
// 100% localStorage, zero backend calls
import { useState, useEffect } from "react";
import { Link } from "react-router-dom";

const DAILY_LIMIT = 1500;

function getBooks() {
  try { return JSON.parse(localStorage.getItem("bfai_books") || "[]"); } catch { return []; }
}
function getUsageToday() {
  try {
    const today = new Date().toISOString().split("T")[0];
    const d = JSON.parse(localStorage.getItem("bfai_usage") || "{}");
    return d.date === today ? (d.count || 0) : 0;
  } catch { return 0; }
}

const STATUS_COLORS = {
  idea: "bg-gray-500/20 text-gray-300",
  outlining: "bg-blue-500/20 text-blue-300",
  writing: "bg-yellow-500/20 text-yellow-300",
  editing: "bg-orange-500/20 text-orange-300",
  ready: "bg-green-500/20 text-green-300",
  published: "bg-purple-500/20 text-purple-300",
};
const STATUS_ICONS = { idea:"💡", outlining:"📋", writing:"✍️", editing:"✏️", ready:"✅", published:"🚀" };

export default function Home() {
  const [books, setBooks] = useState([]);
  const [usageCount, setUsageCount] = useState(0);
  const [apiKey, setApiKey] = useState("");
  const [showKeyModal, setShowKeyModal] = useState(false);
  const [keyDraft, setKeyDraft] = useState("");

  useEffect(() => {
    setBooks(getBooks());
    setUsageCount(getUsageToday());
    const key = localStorage.getItem("gemini_api_key") || "";
    setApiKey(key);
    if (!key) setShowKeyModal(true);
  }, []);

  const saveKey = () => {
    const k = keyDraft.trim();
    if (!k) return;
    localStorage.setItem("gemini_api_key", k);
    setApiKey(k);
    setShowKeyModal(false);
    setKeyDraft("");
  };

  const deleteBook = (id, e) => {
    e.preventDefault(); e.stopPropagation();
    if (!confirm("Delete this book? This cannot be undone.")) return;
    const updated = getBooks().filter(b => b.id !== id);
    localStorage.setItem("bfai_books", JSON.stringify(updated));
    setBooks(updated);
  };

  const pct = Math.min(Math.round((usageCount / DAILY_LIMIT) * 100), 100);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
      {/* Header */}
      <div className="border-b border-white/10 bg-black/20 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-pink-500 rounded-xl flex items-center justify-center text-xl">📚</div>
            <div>
              <h1 className="text-white font-bold text-xl">BookForge AI</h1>
              <p className="text-white/40 text-xs">AI-Powered Book Generator</p>
            </div>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            {/* API Key button */}
            <button onClick={() => { setKeyDraft(apiKey); setShowKeyModal(true); }}
              className={`text-xs px-3 py-1.5 rounded-lg border transition-all ${apiKey ? "border-green-500/40 text-green-400 bg-green-500/10" : "border-red-500/40 text-red-400 bg-red-500/10 animate-pulse"}`}>
              {apiKey ? "🔑 API Key Set" : "⚠️ Set API Key"}
            </button>
            {/* Usage pill */}
            <div className="bg-white/5 border border-white/10 rounded-xl px-4 py-2 flex items-center gap-3">
              <div className="text-right">
                <div className="text-white/60 text-xs">Gemini Today</div>
                <div className={`text-sm font-bold ${pct >= 90 ? "text-red-400" : pct >= 70 ? "text-amber-400" : "text-green-400"}`}>
                  {usageCount} / {DAILY_LIMIT}
                </div>
              </div>
              <div className="w-14">
                <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full ${pct >= 90 ? "bg-red-500" : pct >= 70 ? "bg-amber-500" : "bg-green-500"}`}
                    style={{ width: `${pct}%` }} />
                </div>
                <div className="text-white/30 text-xs mt-0.5 text-center">{DAILY_LIMIT - usageCount} left</div>
              </div>
            </div>
            <Link to="/create"
              className="bg-gradient-to-r from-purple-500 to-pink-500 text-white px-5 py-2.5 rounded-xl font-semibold hover:opacity-90 flex items-center gap-2">
              + New Book
            </Link>
          </div>
        </div>
      </div>

      {/* API Key Modal */}
      {showKeyModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-800 border border-white/10 rounded-2xl p-8 max-w-md w-full shadow-2xl">
            <div className="text-4xl text-center mb-4">🔑</div>
            <h2 className="text-white text-xl font-bold text-center mb-2">Gemini API Key</h2>
            <p className="text-white/50 text-sm text-center mb-4">
              Stored only in your browser. Never sent anywhere except Google's Gemini API.
            </p>
            <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer"
              className="block text-center text-purple-400 text-sm underline mb-5 hover:text-purple-300">
              Get a free key at Google AI Studio →
            </a>
            <input type="password" placeholder="AIza..." value={keyDraft}
              onChange={e => setKeyDraft(e.target.value)}
              onKeyDown={e => e.key === "Enter" && saveKey()}
              className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white placeholder-white/30 focus:outline-none focus:border-purple-500 mb-4 font-mono text-sm" />
            <div className="flex gap-3">
              {apiKey && <button onClick={() => setShowKeyModal(false)}
                className="flex-1 border border-white/20 text-white/60 py-3 rounded-xl hover:bg-white/5">Cancel</button>}
              <button onClick={saveKey} disabled={!keyDraft.trim()}
                className="flex-1 bg-gradient-to-r from-purple-500 to-pink-500 text-white py-3 rounded-xl font-semibold hover:opacity-90 disabled:opacity-50">
                Save Key
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="max-w-7xl mx-auto px-6 py-10">
        {/* Quota warning */}
        {pct >= 90 && (
          <div className="bg-amber-500/20 border border-amber-500/40 rounded-xl p-4 mb-8 flex items-center gap-3">
            <span className="text-2xl">⏳</span>
            <div>
              <p className="text-amber-300 font-semibold">Gemini quota almost full ({DAILY_LIMIT - usageCount} requests left)</p>
              <p className="text-amber-200/60 text-sm">Resets at midnight Pacific Time. Your work is saved.</p>
            </div>
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10">
          {[
            { label: "Total Books", value: books.length, icon: "📚" },
            { label: "In Progress", value: books.filter(b => ["outlining","writing","editing"].includes(b.status)).length, icon: "✍️" },
            { label: "Ready", value: books.filter(b => b.status === "ready").length, icon: "✅" },
            { label: "Published", value: books.filter(b => b.status === "published").length, icon: "🚀" },
          ].map(s => (
            <div key={s.label} className="bg-white/5 border border-white/10 rounded-2xl p-5">
              <div className="text-3xl mb-1">{s.icon}</div>
              <div className="text-white text-2xl font-bold">{s.value}</div>
              <div className="text-white/50 text-sm">{s.label}</div>
            </div>
          ))}
        </div>

        {/* Books */}
        {books.length === 0 ? (
          <div className="text-center py-24">
            <div className="text-7xl mb-4">📖</div>
            <h2 className="text-white text-2xl font-bold mb-2">No books yet</h2>
            <p className="text-white/50 mb-8">Generate your first AI-powered book in minutes</p>
            <Link to="/create"
              className="bg-gradient-to-r from-purple-500 to-pink-500 text-white px-10 py-4 rounded-xl font-semibold text-lg hover:opacity-90 inline-block">
              ✨ Create Your First Book
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {books.map(book => (
              <Link key={book.id} to={`/editor?id=${book.id}`} className="group relative block">
                <div className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden hover:border-purple-500/50 transition-all hover:shadow-lg hover:shadow-purple-900/20">
                  <div className="aspect-[3/2] bg-gradient-to-br from-purple-800/50 to-pink-800/50 relative overflow-hidden">
                    {book.cover_image_url
                      ? <img src={book.cover_image_url} alt={book.title} className="w-full h-full object-cover" />
                      : <div className="w-full h-full flex items-center justify-center text-5xl opacity-20">📚</div>}
                    <div className="absolute top-3 right-3">
                      <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${STATUS_COLORS[book.status] || "bg-gray-500/20 text-gray-300"}`}>
                        {STATUS_ICONS[book.status]} {book.status}
                      </span>
                    </div>
                  </div>
                  <div className="p-5">
                    <h3 className="text-white font-bold text-lg leading-tight mb-1 line-clamp-2">{book.title || "Untitled"}</h3>
                    {book.subtitle && <p className="text-white/40 text-sm mb-2 line-clamp-1">{book.subtitle}</p>}
                    <div className="flex items-center justify-between mt-3">
                      <span className="text-white/30 text-xs">{book.genre}</span>
                      <span className="text-white/30 text-xs">{book.word_count ? `${Number(book.word_count).toLocaleString()} words` : "0 words"}</span>
                    </div>
                    {book.chapters?.length > 0 && (
                      <div className="mt-3">
                        <div className="h-1 bg-white/10 rounded-full overflow-hidden">
                          <div className="h-full bg-gradient-to-r from-purple-500 to-pink-500 rounded-full"
                            style={{ width: `${(book.chapters.filter(c => c.generated).length / book.chapters.length) * 100}%` }} />
                        </div>
                        <p className="text-white/20 text-xs mt-1">{book.chapters.filter(c => c.generated).length}/{book.chapters.length} chapters written</p>
                      </div>
                    )}
                  </div>
                </div>
                <button onClick={e => deleteBook(book.id, e)}
                  className="absolute top-2 left-2 w-7 h-7 bg-red-500/80 hover:bg-red-600 rounded-full text-white text-xs opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center shadow">
                  ✕
                </button>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
