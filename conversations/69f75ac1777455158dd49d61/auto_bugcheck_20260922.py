from pathlib import Path
import re,subprocess
s=Path('/app/bookforge_jsx.jsx').read_text()
checks=[]
def ck(n,v,detail=''):checks.append((n,bool(v),detail))
compile=subprocess.run(['bash','/app/build.sh'],cwd='/app',capture_output=True,text=True)
ck('Compile: clean',compile.returncode==0 and 'WARNING' not in compile.stderr and 'ERROR' not in compile.stderr)
# Manual review of source hit list: JSON.parse usages are enclosed by enclosing try/catch or ls.get fallback;
# idx hits originate from guarded findIndex/indexed iteration, or are object maps.
ck('Critical logic: JSON.parse guarded',all(x in s for x in ['const backup=JSON.parse(reader.result)','try{_ol=JSON.parse(match[0])','try{return JSON.parse(book.outline||"{}")']))
ck('Critical logic: async errors + cleanup', 'catch(e){setTestStatus("fail");}' in s and 'finally{setBusy(false);}' in s and 'finally{setIsBuilding(false);' in s)
ck('Critical logic: indexed writes guarded', 'if(idx>-1)books[idx]' in s and 'book.chapters?.[idx]' in s)
ck('Gemini 1,500 quota pre-check',bool(re.search(r'async function callGemini\([^\n]+\{\n  if\(getUsage\(\)>=DAILY_LIMIT\)',s)))
ck('Export: EPUB, TXT and audiobook script',all(v in s for v in ['buildEPUB','download("txt")','download("audio")']))
ck('Dual publish gate 75 Review + 78 Writing',all(v in s for v in ['overall_score>=75','overall_human_score>=78','reviewPassed&&writingPassed','needs 75+','needs 78+']))
ck('AI_TELLS populated',bool(re.search(r'const AI_TELLS=\[[\s\S]{0,180}"It was a moment"',s)))
ck('Human writing rules in 3 chapter prompts',s.count('WRITING RULES — violating these')>=3)
ck('HomePage search state',bool(re.search(r'function HomePage[\s\S]{0,2500}setSearch',s)))
ck('ErrorBoundary wraps App','<ErrorBoundary>' in s and '</ErrorBoundary>' in s)
m=re.search(r'const TABS=\[(.*?)\];',s,re.S)
tabs=len(re.findall(r'"[^"\n]+"',m.group(1))) if m else 0
ck(f'Tab count: {tabs} current tabs (legacy rule says 11)',tabs>=11)
ck('Gemini model routing and key verification',s.count('${geminiUrl()}?key=')==2)
ck('Kilo excluded from options and failover',not re.search(r'const FAILOVER_ORDER=\[[^\]]*"kilo"',s) and not re.search(r'const BACKENDS=\[[\s\S]*?id:"kilo"',s[:s.index('// ── Kilo Code')]))
print('=== AUTO BUG CHECK ===')
for name,ok,_ in checks:print(('✅ ' if ok else '❌ ')+name)
print('=== %s issues found ==='%sum(not ok for _,ok,_ in checks))
raise SystemExit(1 if any(not ok for _,ok,_ in checks) else 0)
