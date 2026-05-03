import { useState } from "react";
import { Book } from "@/api/entities";
import { useNavigate, Link } from "react-router-dom";
import { generateBook } from "@/api/functions";

const genres = [
  "Self-Help", "Business & Finance", "Health & Wellness", "Personal Development",
  "Fiction - Thriller", "Fiction - Romance", "Fiction - Fantasy", "Fiction - Sci-Fi",
  "Biography & Memoir", "History", "True Crime", "Cookbook", "Travel",
  "Parenting", "Spirituality", "Science", "Technology", "Education"
];

const audiences = [
  "General Adults", "Young Adults (18-25)", "Professionals & Entrepreneurs",
  "Parents", "Students", "Seniors", "Women", "Men", "Beginners", "Advanced Readers"
];

export default function Create() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [outline, setOutline] = useState(null);

  const [form, setForm] = useState({
    topic: "",
    genre: "",
    targetAudience: "",
    ownIdea: true,
  });

  const handleGenerate = async () => {
    if (!form.topic || !form.genre || !form.targetAudience) {
      setError("Please fill in all fields");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await generateBook({
        action: "generate_outline",
        topic: form.topic,
        genre: form.genre,
        targetAudience: form.targetAudience,
      });
      if (res.error) throw new Error(res.error);
      setOutline(res.outline);
      setStep(2);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = async () => {
    setLoading(true);
    setError("");
    try {
      const book = await Book.create({
        title: outline.title,
        subtitle: outline.subtitle,
        genre: form.genre,
        target_audience: form.targetAudience,
        description: outline.description,
        chapters: outline.chapters.map(c => ({ ...c, content: "", generated: false })),
        outline: JSON.stringify(outline),
        status: "outlining",
        word_count: 0,
      });
      navigate(`/editor?id=${book.id}`);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
      <div className="border-b border-white/10 bg-black/20 backdrop-blur-sm">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center gap-4">
          <Link to="/" className="text-white/50 hover:text-white transition-colors">← Back</Link>
          <h1 className="text-white font-bold text-xl">Create New Book</h1>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-6 py-10">
        {/* Progress */}
        <div className="flex items-center gap-3 mb-10">
          {["Book Concept", "Review Outline"].map((label, i) => (
            <div key={i} className="flex items-center gap-2">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-colors ${step > i + 1 ? "bg-green-500 text-white" : step === i + 1 ? "bg-purple-500 text-white" : "bg-white/10 text-white/40"}`}>
                {step > i + 1 ? "✓" : i + 1}
              </div>
              <span className={`text-sm ${step === i + 1 ? "text-white" : "text-white/40"}`}>{label}</span>
              {i < 1 && <div className="w-12 h-px bg-white/20" />}
            </div>
          ))}
        </div>

        {error && (
          <div className="bg-red-500/20 border border-red-500/30 text-red-300 rounded-xl p-4 mb-6">
            {error}
          </div>
        )}

        {step === 1 && (
          <div className="bg-white/5 border border-white/10 rounded-2xl p-8">
            <h2 className="text-white text-2xl font-bold mb-2">Tell me about your book</h2>
            <p className="text-white/50 mb-8">Gemini AI will generate a complete outline, chapters, cover, and SEO optimization</p>

            <div className="space-y-6">
              <div>
                <label className="text-white/80 text-sm font-medium block mb-2">Your Book Idea or Topic *</label>
                <textarea
                  className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white placeholder-white/30 focus:outline-none focus:border-purple-500 resize-none"
                  rows={4}
                  placeholder="E.g. 'A practical guide to building passive income through digital products and content creation' or 'A thriller about a hacker who discovers a government conspiracy while investigating a minor data breach'"
                  value={form.topic}
                  onChange={e => setForm({...form, topic: e.target.value})}
                />
              </div>

              <div>
                <label className="text-white/80 text-sm font-medium block mb-2">Genre *</label>
                <div className="grid grid-cols-3 gap-2">
                  {genres.map(g => (
                    <button
                      key={g}
                      onClick={() => setForm({...form, genre: g})}
                      className={`text-xs px-3 py-2 rounded-lg border transition-all ${form.genre === g ? "border-purple-500 bg-purple-500/20 text-white" : "border-white/20 text-white/50 hover:border-white/40"}`}
                    >
                      {g}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-white/80 text-sm font-medium block mb-2">Target Audience *</label>
                <div className="grid grid-cols-3 gap-2">
                  {audiences.map(a => (
                    <button
                      key={a}
                      onClick={() => setForm({...form, targetAudience: a})}
                      className={`text-xs px-3 py-2 rounded-lg border transition-all ${form.targetAudience === a ? "border-purple-500 bg-purple-500/20 text-white" : "border-white/20 text-white/50 hover:border-white/40"}`}
                    >
                      {a}
                    </button>
                  ))}
                </div>
              </div>

              <button
                onClick={handleGenerate}
                disabled={loading || !form.topic || !form.genre || !form.targetAudience}
                className="w-full bg-gradient-to-r from-purple-500 to-pink-500 text-white py-4 rounded-xl font-semibold text-lg hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
                    Generating outline with Gemini...
                  </>
                ) : "✨ Generate Book Outline"}
              </button>
            </div>
          </div>
        )}

        {step === 2 && outline && (
          <div className="space-y-6">
            <div className="bg-white/5 border border-white/10 rounded-2xl p-8">
              <div className="flex items-start justify-between mb-6">
                <div>
                  <h2 className="text-white text-2xl font-bold">{outline.title}</h2>
                  <p className="text-purple-300 mt-1">{outline.subtitle}</p>
                </div>
                <span className="bg-green-500/20 text-green-400 text-xs px-3 py-1 rounded-full border border-green-500/30">AI Generated</span>
              </div>

              <div className="bg-white/5 rounded-xl p-4 mb-6">
                <h3 className="text-white/70 text-xs uppercase tracking-wider mb-2">Description</h3>
                <p className="text-white/80 text-sm leading-relaxed">{outline.description}</p>
              </div>

              <div>
                <h3 className="text-white/70 text-xs uppercase tracking-wider mb-3">Chapters ({outline.chapters?.length})</h3>
                <div className="space-y-2 max-h-80 overflow-y-auto pr-2">
                  {outline.chapters?.map((ch, i) => (
                    <div key={i} className="bg-white/5 rounded-lg p-3">
                      <div className="flex items-start gap-3">
                        <span className="text-purple-400 font-bold text-sm min-w-[24px]">{ch.number}.</span>
                        <div>
                          <p className="text-white text-sm font-medium">{ch.title}</p>
                          <p className="text-white/40 text-xs mt-0.5">{ch.description}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {outline.estimated_word_count && (
                <div className="mt-4 text-white/50 text-sm">
                  📊 Estimated: ~{outline.estimated_word_count?.toLocaleString()} words
                </div>
              )}
            </div>

            <div className="flex gap-4">
              <button
                onClick={() => { setStep(1); setOutline(null); }}
                className="flex-1 border border-white/20 text-white/70 py-3 rounded-xl hover:bg-white/5 transition-colors"
              >
                Regenerate
              </button>
              <button
                onClick={handleConfirm}
                disabled={loading}
                className="flex-2 flex-grow bg-gradient-to-r from-purple-500 to-pink-500 text-white py-3 px-8 rounded-xl font-semibold hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {loading ? "Creating..." : "✅ Start Writing This Book →"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
