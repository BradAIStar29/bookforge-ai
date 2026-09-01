#!/usr/bin/env bash
# BookForge AI — Safe build script
# Compiles JSX → bookforge.html → index.html
# ALWAYS preserves the body template (loading div + root div)
set -euo pipefail

JSX_FILE="bookforge_jsx.jsx"
HTML_FILE="bookforge.html"
INDEX_FILE="index.html"

echo "🔧 Compiling JSX with esbuild..."
npx esbuild "$JSX_FILE" \
  --bundle \
  --format=iife \
  --jsx=automatic \
  --jsx-factory=React.createElement \
  --jsx-fragment=React.Fragment \
  --minify \
  --target=es2020 \
  --outfile=/tmp/bookforge_compiled.js

echo "📦 Building HTML..."
python3 << 'PYEOF'
with open('bookforge.html') as f:
    html = f.read()

with open('/tmp/bookforge_compiled.js') as f:
    compiled_js = f.read()

# Find where the main script starts (after the body template)
head_end = html.find('<script>\nvar{useState')
if head_end == -1:
    head_end = html.find('<script>\nconst{useState')
if head_end == -1:
    body_idx = html.find('<body>')
    if body_idx == -1:
        raise Exception("Cannot find <body> tag!")
    script_idx = html.find('<script>', body_idx)
    if script_idx == -1:
        raise Exception("Cannot find <script> after <body>!")
    head_end = script_idx

head_template = html[:head_end]

# CRITICAL: Verify #loading and #root divs exist — reconstruct if missing
if 'id="loading"' not in head_template or 'id="root"' not in head_template:
    print("⚠️  Template missing #loading/#root — reconstructing body...")
    body_start = head_template.find('<body>')
    if body_start == -1:
        raise Exception("No <body> tag found!")
    head_template = head_template[:body_start] + '''<body>
<div id="loading"><div style="font-size:2.5rem;font-weight:700;background:linear-gradient(135deg,#a855f7,#ec4899);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text">BookForge AI</div><div id="load-bar"><div id="load-bar-fill"></div></div></div>
<div id="root"></div>
'''

# Find the closing script tag
tail_start = html.rfind('</script>')
if tail_start == -1:
    raise Exception("Cannot find </script>!")
tail = html[tail_start:]

# Assemble
final_html = head_template + '<script>\n' + compiled_js + '\n' + tail

with open('bookforge.html', 'w') as f:
    f.write(final_html)
print("✅ bookforge.html built")
PYEOF

echo "📋 Copying to index.html..."
cp "$HTML_FILE" "$INDEX_FILE"

echo "🔍 Verifying build..."
python3 << 'PYEOF'
with open('bookforge.html') as f:
    html = f.read()
checks = [
    ('id="root"', 'React mount point'),
    ('id="loading"', 'Loading splash'),
    ('createRoot', 'createRoot call'),
    ('ErrorBoundary', 'ErrorBoundary'),
    ('callGemini', 'Gemini API'),
    ('buildEPUB', 'EPUB export'),
    ('downloadPDF', 'PDF export'),
]
ok = True
for pat, label in checks:
    if pat in html:
        print(f"  ✅ {label}")
    else:
        print(f"  ❌ {label} — MISSING!")
        ok = False
exit(0 if ok else 1)
PYEOF

echo "🚀 Build complete!"
echo "Deploy: git add bookforge.html index.html && git commit -m 'Build' && git push origin main && git push github main"
