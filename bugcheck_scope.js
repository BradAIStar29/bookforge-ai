// BookForge AI — scope gate: acorn scan of COMPILED output for unresolved identifiers.
// Catches the bug class where a function/variable is declared in a different component's
// scope (old splice accidents) so callers compile but throw ReferenceError at runtime.
// esbuild tells on these: it renames colliding defs with a *2 suffix and leaves truly
// unresolvable references BARE in the output. This gate makes the build FAIL on them.
// Usage: node bugcheck_scope.js <compiled-js-file>
const fs = require('fs');
let acorn;
try { acorn = require('/tmp/node_modules/acorn'); } catch { try { acorn = require('/app/node_modules/acorn'); } catch { acorn = require('acorn'); } }

const file = process.argv[2];
if (!file) { console.error('usage: node bugcheck_scope.js <compiled-js-file>'); process.exit(2); }
const code = fs.readFileSync(file, 'utf8');
const ast = acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'script' });

const declared = new Set();
function collect(n) {
  if (!n || typeof n.type !== 'string') return;
  const bind = (p) => {
    if (!p) return;
    switch (p.type) {
      case 'Identifier': declared.add(p.name); break;
      case 'ObjectPattern': p.properties.forEach(pr => bind(pr.value || pr.argument || pr)); break;
      case 'ArrayPattern': p.elements.forEach(e => bind(e)); break;
      case 'AssignmentPattern': bind(p.left); break;
      case 'RestElement': bind(p.argument); break;
    }
  };
  if (n.type === 'VariableDeclarator') bind(n.id);
  if ((n.type === 'FunctionDeclaration' || n.type === 'ClassDeclaration') && n.id) bind(n.id);
  if ((n.type === 'FunctionExpression' || n.type === 'ClassExpression') && n.id) bind(n.id);
  if (n.params) n.params.forEach(bind);
  if (n.type === 'CatchClause' && n.param) bind(n.param);
  for (const k in n) {
    if (k === 'loc' || k === 'start' || k === 'end' || k === 'type') continue;
    const v = n[k];
    if (Array.isArray(v)) v.forEach(collect);
    else if (v && typeof v === 'object' && v.type) collect(v);
  }
}
collect(ast);

const env = new Set(('window document localStorage sessionStorage indexedDB navigator console React ReactDOM ReactDOMClient puter JSZip Dexie fetch setTimeout setInterval clearInterval clearTimeout URL URLSearchParams File Blob FileReader Audio MutationObserver CustomEvent Image HTMLImageElement HTMLAudioElement location history performance alert confirm prompt requestAnimationFrame cancelAnimationFrame crypto SpeechSynthesisUtterance speechSynthesis MediaRecorder FormData Headers Request Response AbortController ReadableStream WritableStream TextDecoder TextEncoder structuredClone queueMicrotask AudioContext webkitAudioContext Intl JSON Math Date Object Array String Number Boolean Promise Set Map RegExp Error TypeError RangeError SyntaxError parseFloat parseInt isNaN isFinite undefined NaN Infinity globalThis encodeURIComponent decodeURIComponent escape unescape Symbol btoa atob Uint8Array Uint16Array Uint32Array Uint8ClampedArray Int8Array Int16Array Int32Array Float32Array Float64Array BigUint64Array BigInt64Array ArrayBuffer DataView DOMParser XMLSerializer Notification SharedWorker Worker WebSocket EventSource Cache caches matchAll')
  .split(/\s+/));

const hits = [];
function scan(n) {
  if (!n || typeof n.type !== 'string') return;
  switch (n.type) {
    case 'MemberExpression': scan(n.object); if (n.computed) scan(n.property); return;
    case 'Property': if (n.computed) scan(n.key); scan(n.value); return;
    case 'MethodDefinition': case 'PropertyDefinition': if (n.computed) scan(n.key); scan(n.value); return;
    case 'LabeledStatement': scan(n.body); return;
    case 'Identifier':
      if (!declared.has(n.name) && !env.has(n.name) && !n.name.startsWith('_')) hits.push({ name: n.name, start: n.start });
      return;
  }
  for (const k in n) {
    if (k === 'loc' || k === 'start' || k === 'end' || k === 'type') continue;
    const v = n[k];
    if (Array.isArray(v)) v.forEach(scan);
    else if (v && typeof v === 'object' && v.type) scan(v);
  }
}
scan(ast);

if (hits.length) {
  console.log('❌ SCOPE GATE FAILED — unresolved identifiers in compiled output:');
  for (const h of hits.slice(0, 20)) {
    const line = code.slice(0, h.start).split('\n').length;
    console.log('   ' + h.name + ' (compiled line ' + line + ')  ctx: ' + JSON.stringify(code.slice(Math.max(0, h.start - 40), h.start + 30)));
  }
  console.log('   ' + hits.length + ' refs: ' + [...new Set(hits.map(h => h.name))].join(', '));
  console.log('   → A referenced function/variable is declared in a different scope (see 2026-09-02 bug check, commit 8d96e8c).');
  process.exit(1);
}
console.log('✅ Scope gate clean — no unresolved identifiers in compiled output');
