import { useState, useEffect } from "react";
import { Book, GeminiUsage } from "@/api/entities";
import { Link } from "react-router-dom";

const statusColors = {
  idea: "bg-gray-100 text-gray-600",
  outlining: "bg-blue-100 text-blue-600",
  writing: "bg-yellow-100 text-yellow-700",
  editing: "bg-orange-100 text-orange-600",
  ready: "bg-green-100 text-green-700",
  published: "bg-purple-100 text-purple-700",
};

const statusIcons = {
  idea: "💡", outlining: "📋", writing: "✍️", editing: "✏️", ready: "✅", published: "🚀",
};

export default function Home() {
  const [books, setBooks] = useState([]);
  const [usage, setUsage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [apiKey, setApiKey] = useState(() => localStorage.getItem("gemini_api_key") || "");
  const [showKeyInput, setShowKeyInput] = useState(false);
  const [keyInput, setKeyInput] = useState("");

  useEffect(() => {
    Promise.all([Book.list(), fetchUsage()]).then(([b]) => {
      setBooks(b);
      setLoading(false);
    });
    if (!localStorage.getItem("gemini_api_key")) setShowKeyInput(true);
  }, []);

  const fetchUsage = async () => {
    const today = new Date().toISOString().split("T")[0];
    try {
      const records = await GeminiUsage.filter({ date: today });
      const count = records[0]?.request_count || 0;
      const limit = 1500;
      setUsage({ count, limit, remaining: limit - count, pct: Math.round((count / limit) * 100) });
    } catch { setUsage(null); }
  };

  const saveApiKey = () => {
    if (!keyInput.trim()) return;
    localStorage.setItem("gemini_api_key", keyInput.trim());
    setApiKey(keyInput.trim());
    setShowKeyInput(false);
    setKeyInput("");
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
            {/* API Key status */}
            <button onClick={() => { setKeyInput(apiKey); setShowKeyInput(true); }}
              className={`text-xs px-3 py-1.5 rounded-lg border transition-all ${apiKey ? "border-green-500/40 text-green-400 bg-green-500/10" : "border-red-500/40 text-red-400 bg-red-500/10 animate-pulse"}`}>
              {apiKey ? "🔑 API Key Set" : "⚠️ Set API Key"}
            </button>
            {/* Gemini Usage Counter */}
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
              Your key is stored locally in your browser only — never sent anywhere except directly to Google's Gemini API.
            </p>
            <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer"
              className="block text-center text-purple-400 text-sm underline mb-6 hover:text-purple-300">
              Get a free API key at Google AI Studio →
            </a>
            <input
              type="password"
              placeholder="AIza..."
              value={keyInput}
              onChange={e => setKeyInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && saveApiKey()}
              className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white placeholder-white/30 focus:outline-none focus:border-purple-500 mb-4 font-mono text-sm"
            />
            <div className="flex gap-3">
              {apiKey && (
                <button onClick={() => setShowKeyInput(false)}
                  className="flex-1 border border-white/20 text-white/70 py-3 rounded-xl hover:bg-white/5 transition-colors">
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
        {/* Quota Warning */}
        {usage && usage.pct >= 90 && (
          <div className="bg-amber-500/20 border border-amber-500/40 rounded-xl p-4 mb-8 flex items-center gap-3">
            <span className="text-2xl">⏳</span>
            <div>
              <p className="text-amber-300 font-semibold">Gemini quota almost full ({usage.remaining} requests left today)</p>
              <p className="text-amber-200/60 text-sm">Limits reset at midnight Pacific Time. Save your work and continue tomorrow.</p>
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
        {loading ? (
          <div className="text-center text-white/50 py-20">Loading your books...</div>
        ) : books.length === 0 ? (
          <div className="text-center py-20">
            <div className="text-6xl mb-4">📖</div>
            <h2 className="text-white text-2xl font-bold mb-2">No books yet</h2>
            <p className="text-white/50 mb-6">Start your first bestseller with AI-powered generation</p>
            <Link to="/create"
              className="bg-gradient-to-r from-purple-500 to-pink-500 text-white px-8 py-3 rounded-xl font-semibold hover:opacity-90 transition-opacity inline-block">
              Create Your First Book
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {books.map((book) => (
              <Link key={book.id} to={`/editor?id=${book.id}`} className="group">
                <div className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden hover:border-purple-500/50 transition-all hover:bg-white/8">
                  <div className="aspect-[3/2] bg-gradient-to-br from-purple-800/50 to-pink-800/50 relative overflow-hidden">
                    {book.cover_image_url
                      ? <img src={book.cover_image_url} alt={book.title} className="w-full h-full object-cover" />
                      : <div className="w-full h-full flex items-center justify-center text-5xl opacity-30">📚</div>}
                    <div className="absolute top-3 right-3">
                      <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${statusColors[book.status] || "bg-gray-100 text-gray-600"}`}>
                        {statusIcons[book.status]} {book.status}
                      </span>
                    </div>
                  </div>
                  <div className="p-5">
                    <h3 className="text-white font-bold text-lg leading-tight mb-1 line-clamp-2">{book.title || "Untitled Book"}</h3>
                    {book.subtitle && <p className="text-white/50 text-sm mb-2 line-clamp-1">{book.subtitle}</p>}
                    <div className="flex items-center gap-3 text-white/40 text-xs mt-3">
                      {book.genre && <span className="bg-white/10 px-2 py-0.5 rounded">{book.genre}</span>}
                      {book.word_count > 0 && <span>{book.word_count?.toLocaleString()} words</span>}
                      {book.chapters?.length > 0 && <span>{book.chapters.length} chapters</span>}
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
