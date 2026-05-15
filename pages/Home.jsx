import { useState, useEffect } from "react";
import { Link } from "react-router-dom";

const statusColors = {
  idea: "bg-gray-500/20 text-gray-300",
  outlining: "bg-blue-500/20 text-blue-300",
  writing: "bg-yellow-500/20 text-yellow-300",
  editing: "bg-orange-500/20 text-orange-300",
  ready: "bg-green-500/20 text-green-300",
  published: "bg-purple-500/20 text-purple-300",
};

const statusIcons = {
  idea: "💡", outlining: "📋", writing: "✍️", editing: "✏️", ready: "✅", published: "🚀",
};

function getBooks() {
  try { return JSON.parse(localStorage.getItem("bfai_books") || "[]"); } catch { return []; }
}

function getUsage() {
  try {
    const today = new Date().toISOString().split("T")[0];
    const data = JSON.parse(localStorage.getItem("bfai_usage") || "{}");
    if (data.date !== today) return { date: today, count: 0 };
    return data;
  } catch { return { date: new Date().toISOString().split("T")[0], count: 0 }; }
}

export default function Home() {
  const DAILY_LIMIT = 1500;
  const [books, setBooks] = useState([]);
  const [usage, setUsage] = useState(null);
  const [apiKey, setApiKey] = useState(() => localStorage.getItem("gemini_api_key") || "");
  const [showKeyInput, setShowKeyInput] = useState(false);
  const [keyInput, setKeyInput] = useState("");

  useEffect(() => {
    setBooks(getBooks());
    const u = getUsage();
    const pct = Math.round((u.count / DAILY_LIMIT) * 100);
    setUsage({ count: u.count, limit: DAILY_LIMIT, remaining: DAILY_LIMIT - u.count, pct });
    if (!localStorage.getItem("gemini_api_key")) setShowKeyInput(true);
  }, []);

  const saveApiKey = () => {
    if (!keyInput.trim()) return;
    localStorage.setItem("gemini_api_key", keyInput.trim());
    setApiKey(keyInput.trim());
    setShowKeyInput(false);
    setKeyInput("");
  };

  const deleteBook = (id, e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm("Delete this book? This cannot be undone.")) return;
    const updated = getBooks().filter(b => b.id !== id);
    localStorage.setItem("bfai_books", JSON.stringify(updated));
    setBooks(updated);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
      {/* Header */}
      <div className="border-b border-white/10 bg-black/20 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-pink-500 rounded-xl flex items-center justify-center text-xl">📚</div>
            <div>
              <h1 className="text-white font-bold text-xl">BookForge AI</h1>
              <p className="text-white/50 text-xs">Bestseller Generator & Publisher</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <button onClick={() => { setKeyInput(apiKey); setShowKeyInput(true); }}
              className={`text-xs px-3 py-1.5 rounded-lg border transition-all ${apiKey ? "border-green-500/40 text-green-400 bg-green-500/10" : "border-red-500/40 text-red-400 bg-red-500/10 animate-pulse"}`}>
              {apiKey ? "🔑 API Key Set" : "⚠️ Set API Key"}
            </button>
            {usage !== null && (
              <div className="bg-white/5 border border-white/10 rounded-xl px-4 py-2 flex items-center gap-3">
                <div className="text-right">
                  <div className="text-white/80 text-xs font-medium">Gemini Today</div>
                  <div className={`text-sm font-bold ${usage.pct >= 90 ? "text-red-400" : usage.pct >= 70 ? "text-amber-400" : "text-green-400"}`}>
                    {usage.count} / {usage.limit}
                  </div>
                </div>
                <div className="w-16">
                  <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full transition-all ${usage.pct >= 90 ? "bg-red-500" : usage.pct >= 70 ? "bg-amber-500" : "bg-green-500"}`}
                      style={{ width: `${Math.min(usage.pct, 100)}%` }} />
                  </div>
                  <div className="text-white/30 text-xs mt-0.5 text-center">{usage.remaining} left</div>
                </div>
              </div>
            )}
            <Link to="/create"
              className="bg-gradient-to-r from-purple-500 to-pink-500 text-white px-5 py-2.5 rounded-xl font-semibold hover:opacity-90 transition-opacity flex items-center gap-2">
              <span>+</span> New Book
            </Link>
          </div>
        </div>
      </div>

      {/* API Key Modal */}
      {showKeyInput && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-800 border border-white/10 rounded-2xl p-8 max-w-md w-full">
            <div className="text-4xl mb-4 text-center">🔑</div>
            <h2 className="text-white text-xl font-bold text-center mb-2">Enter Gemini API Key</h2>
            <p className="text-white/50 text-sm text-center mb-6">
              Stored only in your browser — never sent anywhere except directly to Google's Gemini API.
            </p>
            <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer"
              className="block text-center text-purple-400 text-sm underline mb-6 hover:text-purple-300">
              Get a free API key at Google AI Studio →
            </a>
            <input type="password" placeholder="AIza..." value={keyInput}
              onChange={e => setKeyInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && saveApiKey()}
              className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white placeholder-white/30 focus:outline-none focus:border-purple-500 mb-4 font-mono text-sm"
            />
            <div className="flex gap-3">
              {apiKey && (
                <button onClick={() => setShowKeyInput(false)}
                  className="flex-1 border border-white/20 text-white/70 py-3 rounded-xl hover:bg-white/5">
                  Cancel
                </button>
              )}
              <button onClick={saveApiKey} disabled={!keyInput.trim()}
                className="flex-1 bg-gradient-to-r from-purple-500 to-pink-500 text-white py-3 rounded-xl font-semibold hover:opacity-90 disabled:opacity-50">
                Save Key
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="max-w-7xl mx-auto px-6 py-10">
        {usage && usage.pct >= 90 && (
          <div className="bg-amber-500/20 border border-amber-500/40 rounded-xl p-4 mb-8 flex items-center gap-3">
            <span className="text-2xl">⏳</span>
            <div>
              <p className="text-amber-300 font-semibold">Gemini quota almost full ({usage.remaining} requests left today)</p>
              <p className="text-amber-200/60 text-sm">Limits reset at midnight Pacific Time.</p>
            </div>
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10">
          {[
            { label: "Total Books", value: books.length, icon: "📚" },
            { label: "In Progress", value: books.filter(b => ["outlining","writing","editing"].includes(b.status)).length, icon: "✍️" },
            { label: "Ready to Publish", value: books.filter(b => b.status === "ready").length, icon: "✅" },
            { label: "Published", value: books.filter(b => b.status === "published").length, icon: "🚀" },
          ].map((stat) => (
            <div key={stat.label} className="bg-white/5 border border-white/10 rounded-2xl p-5">
              <div className="text-3xl mb-1">{stat.icon}</div>
              <div className="text-white text-2xl font-bold">{stat.value}</div>
              <div className="text-white/50 text-sm">{stat.label}</div>
            </div>
          ))}
        </div>

        {/* Books Grid */}
        {books.length === 0 ? (
          <div className="text-center py-20">
            <div className="text-6xl mb-4">📖</div>
            <h2 className="text-white text-2xl font-bold mb-2">No books yet</h2>
            <p className="text-white/50 mb-6">Start your first bestseller with AI-powered generation</p>
            <Link to="/create"
              className="bg-gradient-to-r from-purple-500 to-pink-500 text-white px-8 py-3 rounded-xl font-semibold hover:opacity-90 inline-block">
              Create Your First Book
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {books.map((book) => (
              <Link key={book.id} to={`/editor?id=${book.id}`} className="group relative">
                <div className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden hover:border-purple-500/50 transition-all">
                  <div className="aspect-[3/2] bg-gradient-to-br from-purple-800/50 to-pink-800/50 relative overflow-hidden">
                    {book.cover_image_url
                      ? <img src={book.cover_image_url} alt={book.title} className="w-full h-full object-cover" />
                      : <div className="w-full h-full flex items-center justify-center text-5xl opacity-30">📚</div>}
                    <div className="absolute top-3 right-3">
                      <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${statusColors[book.status] || "bg-gray-500/20 text-gray-300"}`}>
                        {statusIcons[book.status]} {book.status}
                      </span>
                    </div>
                  </div>
                  <div className="p-5">
                    <h3 className="text-white font-bold text-lg leading-tight mb-1 line-clamp-2">{book.title || "Untitled Book"}</h3>
                    {book.subtitle && <p className="text-white/50 text-sm mb-2 line-clamp-1">{book.subtitle}</p>}
                    <div className="flex items-center justify-between mt-3">
                      <span className="text-white/30 text-xs">{book.genre}</span>
                      <span className="text-white/30 text-xs">{book.word_count ? `${book.word_count.toLocaleString()} words` : "0 words"}</span>
                    </div>
                  </div>
                </div>
                <button onClick={(e) => deleteBook(book.id, e)}
                  className="absolute top-2 left-2 w-7 h-7 bg-red-500/80 hover:bg-red-500 rounded-full text-white text-xs opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
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
