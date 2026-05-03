import { useState, useEffect } from "react";
import { Book } from "@/api/entities";
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
  idea: "💡",
  outlining: "📋",
  writing: "✍️",
  editing: "✏️",
  ready: "✅",
  published: "🚀",
};

export default function Home() {
  const [books, setBooks] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Book.list().then(setBooks).finally(() => setLoading(false));
  }, []);

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
          <Link
            to="/create"
            className="bg-gradient-to-r from-purple-500 to-pink-500 text-white px-5 py-2.5 rounded-xl font-semibold hover:opacity-90 transition-opacity flex items-center gap-2"
          >
            <span>+</span> New Book
          </Link>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-10">
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
            <Link
              to="/create"
              className="bg-gradient-to-r from-purple-500 to-pink-500 text-white px-8 py-3 rounded-xl font-semibold hover:opacity-90 transition-opacity inline-block"
            >
              Create Your First Book
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {books.map((book) => (
              <Link key={book.id} to={`/editor?id=${book.id}`} className="group">
                <div className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden hover:border-purple-500/50 transition-all hover:bg-white/8">
                  {/* Cover */}
                  <div className="aspect-[3/2] bg-gradient-to-br from-purple-800/50 to-pink-800/50 relative overflow-hidden">
                    {book.cover_image_url ? (
                      <img src={book.cover_image_url} alt={book.title} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-5xl opacity-30">📚</div>
                    )}
                    <div className="absolute top-3 right-3">
                      <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${statusColors[book.status] || "bg-gray-100 text-gray-600"}`}>
                        {statusIcons[book.status]} {book.status}
                      </span>
                    </div>
                  </div>
                  {/* Info */}
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
