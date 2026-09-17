# BookForge AI — Frontend UI/UX Design Review & Upgrade Proposal

**Target Workspace File:** `/app/bookforge_jsx.jsx` (~9,800 lines React single-file client app)  
**Theme Context:** Purple-gradient design language (`bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900`), Tailwind CSS via CDN, dark slate containers, glowing neon highlights (purple, magenta, cyan, emerald).

---

## Executive Summary & Design System Strategy

BookForge AI recently expanded with powerful background automation capabilities: Fully Auto Production, Publish Kit ZIP packaging, Queue quota auto-resumes, Backend auto-failover, Series bulk writing, and new free AI providers. However, these features introduced design language inconsistencies:
1. **Amber Abuse:** System warning colors (`amber-500`) were reused for flagship features (Fully Auto card, Write Series button), making premium features look like caution alerts or errors.
2. **Auto-Build Visibility:** The 8-step auto-build pipeline tracker lacks active step highlighting, progress stage feedback, and mobile responsiveness.
3. **Completion Delight & Reliability:** Fully Auto completion relies on unprompted file downloads that get blocked by browser popup blockers without an on-screen summary modal or celebration feedback.
4. **Header & Navigation Overcrowding:** Status chips for rate limits, failover, queue count, and 14 editor tabs overflow horizontally on mobile devices without tap-friendly fallbacks.

This document presents a **prioritized Top-10 UI/UX Upgrade List** with concrete line number citations and Tailwind CSS class recommendations to align new features with BookForge AI's core purple-gradient aesthetic.

---

## Top-10 Prioritized UI/UX Upgrade List

---

### 1. Hero Redesign for 'Fully Auto Production' (CreatePage)
* **Location:** `CreatePage` (Lines 5131–5137)
* **Impact:** High | **Effort:** Low
* **Current Issue:**
  The flagship feature ("Fully Auto Production") is rendered as a plain amber card (`bg-amber-500/10 border-amber-500/30 text-amber-300`) with a native HTML checkbox (`accent-amber-400`). In BookForge's theme, amber is reserved for offline banners, quota limits, and system warnings. Consequently, Fully Auto looks like an error/warning box rather than the app's most powerful mode. Furthermore, when Fully Auto is checked, all manual configuration inputs (Genre, Audience, Length, Style) remain fully expanded and visible, confusing users about what inputs are actually needed.
* **Proposed UX Upgrade:**
  - Upgrade the card into a glowing, hero-styled feature card using a royal purple-to-magenta gradient border (`bg-gradient-to-r from-purple-900/60 via-pink-900/40 to-slate-900 border-2 border-purple-500/50 hover:border-purple-400 shadow-xl shadow-purple-500/10 rounded-2xl p-5`).
  - Replace the native checkbox with an animated toggle pill switch and add a glowing "🚀 FLAGSHIP FEATURE" badge.
  - When `fullyAuto` is enabled, automatically collapse or dim optional fields (Genre, Audience, Style) under an "Advanced Settings (AI Auto-Inferred)" accordion, highlighting that **only the Topic/Idea is required**.
* **Concrete Tailwind Classes & Code Change:**
  ```jsx
  // Replace L5131-5137:
  <div className="bg-gradient-to-r from-purple-900/60 via-pink-900/40 to-slate-900 border-2 border-purple-500/50 hover:border-purple-400/80 rounded-2xl p-5 shadow-xl shadow-purple-500/10 transition-all mb-6">
    <div className="flex items-start justify-between gap-4">
      <div className="flex-1">
        <div className="flex items-center gap-2 mb-1.5">
          <span className="bg-gradient-to-r from-purple-500 to-pink-500 text-white text-[10px] font-extrabold uppercase px-2.5 py-0.5 rounded-full tracking-wider shadow-sm">
            🚀 Flagship Mode
          </span>
          <span className="text-xs text-purple-300/80 font-medium">Topic is all you need</span>
        </div>
        <h3 className="text-white text-base font-bold flex items-center gap-2">
          Fully Auto Production
        </h3>
        <p className="text-white/60 text-xs mt-1 leading-relaxed">
          AI infers genre & audience, approves the outline, writes all chapters, optimizes SEO, builds the cover, passes quality gates, and downloads your KDP Publish Kit automatically.
        </p>
      </div>
      <label className="relative inline-flex items-center cursor-pointer shrink-0 mt-1">
        <input 
          type="checkbox" 
          checked={fullyAuto} 
          onChange={e => {
            setFullyAuto(e.target.checked);
            safeLS("bfai_fully_auto", e.target.checked ? "1" : "0");
            if(e.target.checked) ensureNotifyPermission();
          }} 
          className="sr-only peer"
        />
        <div className="w-12 h-6 bg-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-gradient-to-r peer-checked:from-purple-500 peer-checked:to-pink-500"></div>
      </label>
    </div>
  </div>
  ```

---

### 2. System Color Unification & Primary Action Rebranding for 'Write Series' (SeriesPage)
* **Location:** `SeriesPage` (Line 4828)
* **Impact:** High | **Effort:** Low
* **Current Issue:**
  The "🚀 Write Series" button on series cards uses amber outlined styling (`border-amber-500/40 text-amber-300 hover:bg-amber-500/10`). Siting next to blue (`View Bible`) and emerald (`Continuity`) outlined buttons, the card header lacks visual hierarchy. Because "Write Series" triggers an automated multi-book creation process, an outlined amber ghost button looks like a secondary warning/deletion button rather than the main call-to-action.
* **Proposed UX Upgrade:**
  - Reserve **Amber/Orange** strictly for system state warnings, quota limits, failover notices, and gate blockers.
  - Rebrand "Write Series" into a solid, filled primary action button (`bg-gradient-to-r from-purple-600 via-pink-600 to-purple-700 text-white font-semibold shadow-md shadow-purple-500/20 hover:shadow-purple-500/30 px-4 py-2 rounded-xl transition-all`).
  - Add an animated `Spin` loader during processing and trigger a confirmation toast inviting the user to jump directly to the Queue tab.
* **Concrete Tailwind Classes & Code Change:**
  ```jsx
  // Replace L4828:
  <button 
    disabled={writingSeries?.id === series.id} 
    onClick={() => writeSeries(series.id)} 
    className="text-xs bg-gradient-to-r from-purple-600 via-pink-600 to-purple-700 text-white font-semibold px-4 py-2 rounded-xl shadow-md shadow-purple-500/20 hover:shadow-purple-500/30 hover:opacity-95 transition-all disabled:opacity-50 flex items-center gap-1.5 shrink-0"
  >
    {writingSeries?.id === series.id ? (
      <><Spin size="h-3 w-3"/> {writingSeries.note || "Queuing books…"}</>
    ) : (
      <>🚀 Write Series</>
    )}
  </button>
  ```

---

### 3. Active Step Highlighting & Responsive Layout for 8-Step Auto-Build Pipeline (EditorPage)
* **Location:** `EditorPage` (Lines 6282–6297)
* **Impact:** High | **Effort:** Medium
* **Current Issue:**
  During `runAutoBuild`, the 8 pipeline steps (Outline, Chapters, SEO, Cover, Review, Market, Hooks, Writing) are displayed in a static 4-column grid (`grid-cols-4 gap-1.5`). Completed steps show `✅ bg-green-500/20 text-green-300`, while unstarted steps show `bg-white/5 text-white/60`. However, there is zero visual distinction for the **currently active step**. Users cannot tell at a glance what AI action is executing. On mobile viewports (320px–400px), 4 columns cause severe label truncation.
* **Proposed UX Upgrade:**
  - Introduce an **Active Step State** with a pulsing neon border, glowing ring, and active spinner icon (`bg-purple-500/30 border-2 border-purple-400 text-purple-100 shadow-md shadow-purple-500/30 animate-pulse ring-1 ring-purple-400/50`).
  - Make the grid responsive (`grid-cols-2 sm:grid-cols-4 gap-2`) so labels remain legible on mobile.
  - Add a stage counter header (e.g. `Step 4 of 8: Generating Cover Art…`) and an `aria-live="polite"` region for screen readers.
* **Concrete Tailwind Classes & Code Change:**
  ```jsx
  // Replace L6282-6297:
  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
    {[
      ["📋", "Outline", !book.needs_outline, isBuilding && book.needs_outline],
      ["✍️", "Chapters", (book.chapters||[]).length > 0 && (book.chapters||[]).every(c => c.generated), isBuilding && !book.needs_outline && !(book.chapters||[]).every(c => c.generated)],
      ["🔍", "SEO", !!book.seo_done, isBuilding && !book.seo_done && (book.chapters||[]).every(c => c.generated)],
      ["🎨", "Cover", !!book.cover_done, isBuilding && book.seo_done && !book.cover_done],
      ["🤖", "Review", !!book.review_done, isBuilding && book.cover_done && !book.review_done],
      ["🔎", "Market", !!book.competitor_done, isBuilding && book.review_done && !book.competitor_done],
      ["🪝", "Hooks", !!book.hooks_done, isBuilding && book.competitor_done && !book.hooks_done],
      ["📊", "Writing", !!book.wq_done, isBuilding && book.hooks_done && !book.wq_done],
    ].map(([icon, label, done, active]) => (
      <div 
        key={label} 
        className={`flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium transition-all ${
          done 
            ? "bg-green-500/20 border border-green-500/30 text-green-300" 
            : active 
            ? "bg-purple-500/30 border-2 border-purple-400 text-purple-100 shadow-lg shadow-purple-500/30 animate-pulse ring-1 ring-purple-400/50" 
            : "bg-white/5 border border-white/10 text-white/40"
        }`}
      >
        <span>{done ? "✅" : active ? <Spin size="h-3 w-3"/> : icon}</span>
        <span className="truncate">{label}</span>
      </div>
    ))}
  </div>
  ```

---

### 4. Fully Auto Book Completion Summary Modal & Pop-up Blocker Fallback (EditorPage)
* **Location:** `EditorPage` (Lines 5988–5995)
* **Impact:** High | **Effort:** Medium
* **Current Issue:**
  When auto-build completes a book, it fires a transient toast notification, plays a chime, and executes `downloadPublishKit(getBook(bookId))` programmatically (L5991). Browser security models routinely block programmatic file downloads without direct user clicks. If blocked, the user is left with no visual feedback, no download, and no celebration modal summarizing what was accomplished.
* **Proposed UX Upgrade:**
  - Create a high-delight **Book Completion Celebration Modal** triggered upon auto-build completion.
  - Display lightweight CSS confetti particles, key manuscript stats (Word Count, Chapter Count, Review Score, Writing Score, Cover Thumbnail), and a prominent direct CTA button: `📦 Download Publish Kit ZIP`.
  - Provide inline status feedback if the automatic background download was blocked by the browser.
* **Concrete Tailwind Classes & Code Change:**
  ```jsx
  // Add state to EditorPage: const [showCompletionModal, setShowCompletionModal] = useState(false);
  // Replace L5990-5993:
  notifyDone(
    passed && wPassed ? "📚 Book complete!" : "📚 Build finished",
    `"${finalBook?.title || "Your book"}" — ${passed && wPassed ? "All quality gates passed!" : "Check review tabs."}`
  );
  if(passed && wPassed) {
    setShowCompletionModal(true);
  }

  // Render Modal at bottom of EditorPage:
  {showCompletionModal && (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[9999] flex items-center justify-center p-4">
      <div className="bg-slate-900 border-2 border-purple-500/50 rounded-3xl max-w-lg w-full p-6 text-center shadow-2xl space-y-5 animate-in fade-in zoom-in duration-200">
        <div className="text-5xl animate-bounce">🎉</div>
        <div>
          <h2 className="text-2xl font-extrabold text-white">Your Book is Complete!</h2>
          <p className="text-purple-300 text-sm mt-1">"{book.title}" is ready for Amazon KDP</p>
        </div>
        <div className="grid grid-cols-2 gap-3 bg-white/5 border border-white/10 rounded-2xl p-4 text-left text-xs">
          <div><span className="text-white/40 block">Word Count</span><span className="text-white font-bold text-sm">{(book.word_count||0).toLocaleString()} words</span></div>
          <div><span className="text-white/40 block">Chapters</span><span className="text-white font-bold text-sm">{(book.chapters||[]).length} chapters</span></div>
          <div><span className="text-white/40 block">Review Score</span><span className="text-green-400 font-bold text-sm">{book.review?.overall_score || 0}/100</span></div>
          <div><span className="text-white/40 block">Writing Quality</span><span className="text-green-400 font-bold text-sm">{book.manuscript_quality?.overall_human_score || 0}/100</span></div>
        </div>
        <div className="flex flex-col gap-2">
          <button 
            onClick={() => { downloadPublishKit(book); setShowCompletionModal(false); }} 
            className="w-full bg-gradient-to-r from-purple-500 via-pink-500 to-amber-500 text-white font-bold py-3.5 rounded-xl shadow-lg shadow-purple-500/30 hover:opacity-95 text-sm flex items-center justify-center gap-2"
          >
            📦 Download Publish Kit (ZIP)
          </button>
          <button 
            onClick={() => setShowCompletionModal(false)} 
            className="text-white/40 hover:text-white text-xs py-2"
          >
            Dismiss & Return to Editor
          </button>
        </div>
      </div>
    </div>
  )}
  ```

---

### 5. Publish Kit Prominence & Gating Clarity (EditorPage / Tab 10 Publish)
* **Location:** `EditorPage` / Tab 10 (Lines 6519–6529)
* **Impact:** Medium | **Effort:** Low
* **Current Issue:**
  On Tab 10 (Publish), the Publish Kit ZIP button uses an emerald gradient (`from-emerald-500 to-teal-500`), departing from BookForge's purple theme. When quality gates have not been passed, the button is disabled (`disabled={!reviewPassed||!writingPassed}`) with `opacity-40` without providing inline tooltips or gate status badges directly on the button card.
* **Proposed UX Upgrade:**
  - Restyle the Publish Kit button with a hero gradient (`bg-gradient-to-r from-purple-600 via-pink-600 to-amber-500 hover:from-purple-500 hover:to-amber-400 text-white font-bold py-4 rounded-2xl shadow-xl shadow-purple-500/20 text-base`).
  - Add an explicit gate indicator on the disabled state: `🔒 Gated: Requires Review Agent (70+) & Writing Quality (78+)`.
  - Add a 1-click shortcut button that navigates directly to the missing quality check tab when locked.
* **Concrete Tailwind Classes & Code Change:**
  ```jsx
  // Replace L6519:
  <div className="col-span-2 space-y-2">
    <button 
      onClick={() => downloadPublishKit(book)} 
      disabled={!reviewPassed || !writingPassed} 
      className="w-full bg-gradient-to-r from-purple-600 via-pink-600 to-amber-500 text-white py-4 rounded-2xl font-bold shadow-xl shadow-purple-500/20 hover:opacity-95 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-base transition-all"
    >
      📦 Download Publish Kit — Complete KDP Upload Bundle (ZIP)
    </button>
    {(!reviewPassed || !writingPassed) && (
      <p className="text-amber-300/80 text-xs text-center flex items-center justify-center gap-1">
        <span>🔒 Gated:</span>
        {!reviewPassed && <button onClick={()=>setTab(4)} className="underline hover:text-amber-200">Pass Review (70+)</button>}
        {!reviewPassed && !writingPassed && <span>&amp;</span>}
        {!writingPassed && <button onClick={()=>setTab(8)} className="underline hover:text-amber-200">Pass Writing Quality (78+)</button>}
      </p>
    )}
  </div>
  ```

---

### 6. Queue Automation UX: Glassmorphic Banner, Accurate ETA, and Sound Control (QueuePage)
* **Location:** `QueuePage` (Lines 4365, 4369–4381)
* **Impact:** Medium | **Effort:** Medium
* **Current Issue:**
  1. The Quota Paused banner uses plain amber text box styling (`bg-amber-500/15 border-amber-500/40 text-amber-300`).
  2. The ETA bar calculation (`builtSoFar / totalToBuild`) hides ETA completely while book 1 is building (`builtSoFar === 0`), leaving the user with no progress bar or estimate during the initial build phase.
  3. Audio chime notifications lack a toggle control for users who prefer silent operation.
* **Proposed UX Upgrade:**
  - Redesign the Quota Paused banner into a glassmorphic state card with countdown polling animation (`bg-amber-950/40 border border-amber-500/30 backdrop-blur-md rounded-2xl p-4 text-amber-200 shadow-lg shadow-amber-500/5 flex items-center justify-between`).
  - Calculate ETA during Book 1 using chapter completion metrics (`chDone / chTotal`).
  - Add a Sound Chime toggle in Settings / Queue header (`🔊 Sound Notifications On/Off`).
* **Concrete Tailwind Classes & Code Change:**
  ```jsx
  // Replace L4365:
  {quotaPaused && (
    <div className="bg-amber-950/40 border border-amber-500/40 backdrop-blur-md rounded-2xl p-4 mb-5 text-amber-200 shadow-lg shadow-amber-500/10 flex items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        <span className="text-2xl animate-pulse">⏳</span>
        <div>
          <h4 className="text-amber-300 font-bold text-sm">Build Queue Paused (Daily Quota Hit)</h4>
          <p className="text-amber-200/70 text-xs mt-0.5">
            Auto-resumes automatically when your daily API limit resets. Polling every 60s…
          </p>
        </div>
      </div>
      <span className="text-xs bg-amber-500/20 text-amber-300 border border-amber-500/30 px-3 py-1.5 rounded-lg font-mono shrink-0">
        Auto-Resume Active
      </span>
    </div>
  )}

  // Update ETA calculation (L4369):
  {running && buildStart && (
    <div className="mb-6 bg-white/5 border border-white/10 rounded-2xl p-4 space-y-2">
      <div className="flex items-center justify-between text-xs">
        <span className="text-white/70 font-semibold">{builtSoFar}/{totalToBuild} books completed</span>
        <span className="text-purple-300 font-mono">
          {chTotal > 0 ? `Chapter ${chDone}/${chTotal}` : "Building outline…"}
        </span>
      </div>
      <div className="h-2 bg-white/10 rounded-full overflow-hidden">
        <div 
          className="h-full bg-gradient-to-r from-purple-500 to-pink-500 rounded-full transition-all duration-300" 
          style={{ width: `${Math.max(5, Math.round(((builtSoFar + (chTotal > 0 ? chDone/chTotal : 0)) / totalToBuild) * 100))}%` }} 
        />
      </div>
    </div>
  )}
  ```

---

### 7. Responsive Header Status Chips & Interactive Failover Popover (Header)
* **Location:** `Header` (Lines 3205–3230)
* **Impact:** Medium | **Effort:** Low
* **Current Issue:**
  Header chips (`Puter Free`, `Cerebras 1M/day`, `Cloudflare Workers AI`, `↩︎ groq → cerebras`, `Groq Turbo`) expand horizontally in a single row (`flex items-center gap-2 shrink-0`). On mobile screens (<640px), 4+ status chips cause severe horizontal overflow, forcing essential buttons (Settings, Tour) off-screen. Additionally, failover details are trapped inside native browser `title="..."` attributes, which are inaccessible on touchscreens.
* **Proposed UX Upgrade:**
  - Wrap status chips in a responsive, scrollable container (`overflow-x-auto no-scrollbar hidden sm:flex items-center gap-2`).
  - On mobile, display a consolidated single status pill (e.g. `⚡ Groq (Failover Active)`).
  - Replace native hover `title` tooltips with a tap-friendly modal/popover for failover details.
* **Concrete Tailwind Classes & Code Change:**
  ```jsx
  // Replace L3204-3230 status chips container:
  <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-1 max-w-[50vw] sm:max-w-none">
    {(()=>{
      const fs = failoverStatus();
      return fs.routedTo && fs.routedTo !== fs.original ? (
        <button 
          onClick={() => setShowSettings(true)} 
          className="text-xs bg-amber-500/20 text-amber-300 font-semibold px-2.5 py-1 rounded-lg border border-amber-500/40 hover:bg-amber-500/30 transition-all flex items-center gap-1 shrink-0"
        >
          <span>↩︎</span>
          <span className="truncate">{fs.original} → {fs.routedTo}</span>
        </button>
      ) : null;
    })()}
    {/* Keep provider chips with shrink-0 whitespace-nowrap */}
    {getBackend()==="puter" && <span className="text-xs text-purple-400 font-medium px-2 py-1 bg-purple-500/10 rounded-lg border border-purple-500/20 shrink-0 whitespace-nowrap">⚡ Puter Free</span>}
    {getBackend()==="cerebras" && <span className="text-xs text-cyan-400 font-medium px-2 py-1 bg-cyan-500/10 rounded-lg border border-cyan-500/20 shrink-0 whitespace-nowrap">🧠 Cerebras 1M/day</span>}
    {getBackend()==="kilo" && <span className="text-xs text-green-400 font-medium px-2 py-1 bg-green-500/10 rounded-lg border border-green-500/20 shrink-0 whitespace-nowrap">🎁 Kilo Free</span>}
    {getBackend()==="cloudflare" && <span className="text-xs text-orange-400 font-medium px-2 py-1 bg-orange-500/10 rounded-lg border border-orange-500/20 shrink-0 whitespace-nowrap">☁️ CF Workers AI</span>}
  </div>
  ```

---

### 8. Settings Modal Backend Selection Grid & Feature Badges (SettingsModal)
* **Location:** `SettingsModal` (Lines 3043–3061)
* **Impact:** Medium | **Effort:** Low
* **Current Issue:**
  In `SettingsModal`, 6 AI backends (Kilo, Cerebras, Groq, Gemini, Cloudflare, Puter) are displayed in a plain 2-column grid (`grid-cols-2 gap-2`). The descriptions are small gray text without clear feature badges. Users cannot easily distinguish between zero-config backends (Kilo, Puter), daily quota providers (Gemini, Cloudflare), and speed-optimized providers (Groq).
* **Proposed UX Upgrade:**
  - Enhance backend selection cards with color-coded status pills (`🎁 NO KEY REQUIRED`, `⚡ 500+ TOK/S`, `☁️ 10K/DAY`, `💳 PAID TRIAL`).
  - Make the grid responsive (`grid-cols-1 sm:grid-cols-2 gap-3`) so text is clear on mobile.
* **Concrete Tailwind Classes & Code Change:**
  ```jsx
  // Replace L3052-3061:
  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
    {BACKENDS.map(b => {
      const sel = getBackend() === b.id;
      const badge = b.id === "kilo" || b.id === "puter" ? "🎁 No Key Required" : b.id === "groq" ? "⚡ 500+ tok/sec" : b.id === "cloudflare" ? "☁️ 10K Neurons/day" : b.id === "cerebras" ? "💳 $5 Paid Trial" : "🔑 BYO Key";
      const badgeColor = b.id === "kilo" || b.id === "puter" ? "bg-green-500/20 text-green-300 border-green-500/30" : b.id === "groq" ? "bg-orange-500/20 text-orange-300 border-orange-500/30" : "bg-purple-500/20 text-purple-300 border-purple-500/30";
      return (
        <button 
          key={b.id} 
          onClick={() => { setBackend(b.id); setBackendChanged(true); setTimeout(() => setBackendChanged(false), 2000); }} 
          className={`text-left p-3.5 rounded-2xl border transition-all flex flex-col justify-between ${
            sel ? "bg-purple-500/20 border-purple-500 text-white shadow-lg shadow-purple-500/10 ring-1 ring-purple-500/50" : "bg-white/5 border-white/10 text-white/70 hover:border-purple-400/50 hover:bg-white/8"
          }`}
        >
          <div>
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <p className="text-sm font-bold text-white">{b.label}</p>
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${badgeColor}`}>
                {badge}
              </span>
            </div>
            <p className="text-xs text-white/50 leading-relaxed">{b.desc}</p>
          </div>
        </button>
      );
    })}
  </div>
  ```

---

### 9. Category Grouping & Mobile Navigation Dropdown for 14 Editor Tabs (EditorPage)
* **Location:** `EditorPage` (Lines 6265–6276)
* **Impact:** Medium | **Effort:** Medium
* **Current Issue:**
  EditorPage renders 14 tabs (`📋 Outline`, `✍️ Chapters`, `🎨 Cover`, `🔍 SEO`, `🤖 Review`, `🔎 Market`, `🪝 Hooks`, `📊 Quality`, `✍️ Writing`, `👥 Characters`, `📤 Publish`, `🌍 Translate`, `🎙️ Audio Studio`, `📦 Amazon KDP`) in a single horizontal scrolling strip (`overflow-x-auto`). On mobile devices, finding a specific tab requires tedious horizontal dragging across 14 small text items.
* **Proposed UX Upgrade:**
  - Group tabs logically into 4 workflow categories:
    - **Drafting:** Outline, Chapters, Characters
    - **Quality:** Review, Quality, Writing
    - **Publishing:** Cover, SEO, Market, Hooks, Publish, Amazon KDP
    - **Tools:** Translate, Audio Studio
  - On mobile screens (<640px), render a category-grouped `<select>` dropdown selector alongside tab pills.
* **Concrete Tailwind Classes & Code Change:**
  ```jsx
  // Add mobile tab dropdown above L6276:
  <div className="sm:hidden px-4 mb-3">
    <label htmlFor="editor-tab-select" className="sr-only">Select Tab</label>
    <select 
      id="editor-tab-select"
      value={tab} 
      onChange={e => setTab(Number(e.target.value))} 
      className="w-full bg-slate-800 border border-white/20 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-purple-500 font-medium"
    >
      <optgroup label="📝 Drafting">
        <option value={0}>📋 Outline</option>
        <option value={1}>✍️ Chapters</option>
        <option value={9}>👥 Characters</option>
      </optgroup>
      <optgroup label="📊 Quality & Review">
        <option value={4}>🤖 Review Agent</option>
        <option value={7}>📊 Chapter Quality</option>
        <option value={8}>✍️ Writing Quality</option>
      </optgroup>
      <optgroup label="📦 Publishing & Marketing">
        <option value={2}>🎨 Cover Art</option>
        <option value={3}>🔍 SEO Metadata</option>
        <option value={5}>🔎 Market Analysis</option>
        <option value={6}>🪝 Hooks & Blurbs</option>
        <option value={10}>📤 Publish Kit & Export</option>
        <option value={13}>📦 Amazon KDP Package</option>
      </optgroup>
      <optgroup label="🛠️ Studio Extras">
        <option value={11}>🌍 Translation Studio</option>
        <option value={12}>🎙️ Audio Studio</option>
      </optgroup>
    </select>
  </div>
  ```

---

### 10. Accessibility (ARIA) & Touch Target Upgrades for Automated Controls
* **Location:** App-wide (QueuePage L4407–4409, Header L3230, CreatePage L5132)
* **Impact:** Low–Medium | **Effort:** Low
* **Current Issue:**
  1. Queue reorder buttons (`↑`, `↓`) have small touch bounding boxes (`w-7 h-7`), violating the 44px minimum touch target size requirement for mobile devices.
  2. The `Fully Auto` checkbox card lacks `aria-describedby` linking it to its explanatory paragraph.
  3. The 8-step pipeline tracker updates dynamically without an `aria-live="polite"` container, hiding build updates from screen reader users.
* **Proposed UX Upgrade:**
  - Expand touch targets on mobile controls to `min-h-[44px] min-w-[44px]`.
  - Add explicit `aria-describedby`, `aria-live="polite"`, and `focus-visible:ring-2 focus-visible:ring-purple-400` focus indicators.
* **Concrete Tailwind Classes & Code Change:**
  ```jsx
  // Replace Queue reorder buttons L4407-4409:
  <div className="flex gap-1 shrink-0 items-center">
    <button 
      aria-label="Move book up in queue" 
      onClick={() => moveUp(id)} 
      disabled={i === 0 || running} 
      className="w-11 h-11 flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 rounded-xl transition-all disabled:opacity-20 focus-visible:ring-2 focus-visible:ring-purple-400"
    >
      ↑
    </button>
    <button 
      aria-label="Move book down in queue" 
      onClick={() => moveDown(id)} 
      disabled={i === queuedIds.length - 1 || running} 
      className="w-11 h-11 flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 rounded-xl transition-all disabled:opacity-20 focus-visible:ring-2 focus-visible:ring-purple-400"
    >
      ↓
    </button>
  </div>
  ```

---

## Summary Table of Recommendations

| # | Feature / Area | Component / Line Citation | Priority | Key Fix |
|---|---|---|---|---|
| **1** | Fully Auto Card | `CreatePage` (L5131–5137) | Top Priority | Purple-gradient hero card, toggle switch, collapse optional fields |
| **2** | Write Series Button | `SeriesPage` (L4828) | Top Priority | Rebrand from amber ghost to filled primary purple button |
| **3** | Auto-Build Tracker | `EditorPage` (L6282–6297) | Top Priority | Active pulsing step state, responsive grid, stage counters |
| **4** | Completion Experience | `EditorPage` (L5988–5995) | Top Priority | Book completion celebration modal & popup blocker fallback |
| **5** | Publish Kit ZIP Button | `EditorPage` / Tab 10 (L6519) | Top Priority | Hero gradient, explicit lock indicators, 1-click unlock path |
| **6** | Queue Automation | `QueuePage` (L4365, L4369) | High Priority | Glassmorphic pause card, Book 1 ETA calculation, sound toggle |
| **7** | Mobile Header | `Header` (L3205–3230) | High Priority | Scrollable status chip bar, touch-friendly failover popovers |
| **8** | Settings Backends | `SettingsModal` (L3043–3061) | Medium Priority | Rich cards with color pills (`No Key Required`, `500+ tok/s`) |
| **9** | 14 Editor Tabs | `EditorPage` (L6265–6276) | Medium Priority | Mobile category `<select>` dropdown and workflow grouping |
| **10** | Accessibility / Touch | App-wide (L4407, L5132) | Medium Priority | 44px minimum touch targets, `aria-describedby` & `aria-live` |
