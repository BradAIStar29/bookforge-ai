# Auto Bug Check Rule

## Trigger
After EVERY session where any code change is made to `bookforge_jsx.jsx` or `bookforge.html`, automatically run a full bug check before ending the session.

## What to Check
Run the following checks in order:

1. **Compile test** — esbuild compile with JSX transform. Zero errors required.
2. **Critical logic bugs** — scan for:
   - `JSON.parse()` calls without try/catch or optional chaining guard
   - Async functions missing try/catch
   - State reads that could be stale (panels reading from props instead of re-fetching localStorage)
   - Array access `[idx]` without `?.[idx]` where index may be invalid
   - Missing `finally` blocks on loading states (causes spinner to get stuck)
3. **Quota enforcement** — confirm `callGemini()` still has the `getUsage()>=DAILY_LIMIT` pre-check
4. **Export sanity** — confirm EPUB, TXT, Audiobook script functions exist and are not accidentally removed
5. **Publish gate** — confirm dual-gate (Review 70+ AND Writing Quality 78+) still enforced
6. **AI_TELLS list** — confirm it exists and has entries
7. **Human writing rules** — confirm anti-AI instructions are still in all 3 chapter write prompts
8. **Search bar** — confirm HomePage has search state
9. **ErrorBoundary** — confirm it wraps App
10. **Tab count** — confirm all 11 tabs still present

## Report Format
Print a clean report:
```
=== AUTO BUG CHECK ===
✅ Compile: clean
✅ Quota guard: present
❌ Missing finally: genSEO line 1714
...
=== X issues found ===
```

Fix any ❌ issues immediately before pushing to GitHub.

## Applies To
User: Brad
App: BookForge AI
Repo: BradAIStar29/bookforge-ai
