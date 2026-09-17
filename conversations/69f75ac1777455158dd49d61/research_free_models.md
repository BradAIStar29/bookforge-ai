# BookForge AI: September 2026 Browser-Usable Free LLM & Media API Research

## VERDICT & EXECUTIVE SUMMARY

### Current Backend Health & Breaking Changes
* **Puter.js**: ✅ **WORKING**. Metered user-pays SDK. Excellent for keyless fallback.
* **Groq API**: ✅ **WORKING**. Generous free tier (30 RPM). Unmatched speed for Llama 3.3 70B and DeepSeek R1.
* **Google Gemini API**: ✅ **WORKING**. Gemini 2.5 Flash / 3.0 Flash free tier (10-15 RPM, 1,500 RPD). Massive 1M+ token context window.
* **Cloudflare Workers AI**: ✅ **WORKING**. 10,000 free daily Neurons. OpenAI-compatible browser endpoint.
* **Cerebras API**: ⚠️ **CHANGED / DEMOTED**. Free 1M daily tokens without credit card **ENDED August 17, 2026**. Now requires a credit card to access $5 trial credits. Demote to "Optional BYO Key".
* **Kilo Code Gateway**: ❌ **DEAD / BROKEN**. Fails in browser due to lack of CORS headers (`Access-Control-Allow-Origin`). Must be removed or marked disabled.

---

### Top Recommended Additions for BookForge AI (Ranked)

1. **SambaNova Cloud (`cloud.sambanova.ai`) — PRIORITY #1**
   * **Why**: 100% FREE without credit card. Provides **Meta-Llama-3.1-405B-Instruct**, **Meta-Llama-3.3-70B-Instruct**, and **DeepSeek-R1-Distill-Llama-70B** at 400–1,000 tokens/sec. Full browser CORS support.
   * **Role**: Primary heavy-weight creative writing backend (30B–405B parameter models).

2. **OpenRouter `:free` Router (`openrouter.ai`) — PRIORITY #2**
   * **Why**: Unlocks 25+ free models via a single OpenAI-compatible API key. Full CORS support. Auto-fallbacks across multiple free providers.
   * **Role**: Diverse model choice (Qwen 2.5 72B, Gemma 2, Mistral Small 24B, Llama 3.3 70B) and high reliability through multi-provider routing.

3. **HuggingFace Serverless Inference API (`router.huggingface.co`) — PRIORITY #3**
   * **Why**: Free HF user token gives access to thousands of open-source models with full CORS support and OpenAI-compatible `/v1/chat/completions` syntax.
   * **Role**: Backup text generation + free FLUX.1-schnell cover art generation.

4. **Kokoro.js (In-Browser Local Neural TTS via WebGPU/ONNX) — PRIORITY #4 (Audio)**
   * **Why**: 82M parameter state-of-the-art neural TTS running **100% client-side** in JavaScript via WebGPU/WASM. Zero API costs, zero keys, 100% offline capability.
   * **Role**: Upgrade book audio reading from basic browser Web Speech to realistic neural voice narration.

5. **Mistral AI La Plateforme (`api.mistral.ai`) — PRIORITY #5**
   * **Why**: Free Experiment tier with full CORS support. Access to `mistral-small-latest` (22B) and `pixtral-12b`.
   * **Role**: Specialized European/multilingual writing backend.

---

## DETAILED CANDIDATE EVALUATIONS

### 1. Groq API
* **(a) Free-Tier Limits TODAY**: No credit card required. Rate limits vary per model:
  * Meta Llama 3.3 70B Versatile: 30 RPM, 1,000 RPD, ~6,000 TPM.
  * Meta Llama 3.1 8B / Llama 3.2 3B: 30 RPM, 14,400 RPD, ~131,072 TPM.
  * DeepSeek R1 Distill Llama 70B: 30 RPM, 1,000 RPD, ~6,000 TPM.
  * Whisper Large v3 / Turbo: 20 RPM, 2,000 RPD, 28,800 audio seconds/day.
* **(b) API Style**: OpenAI-compatible REST API (`https://api.groq.com/openai/v1/chat/completions`).
* **(c) CORS / Browser-Usable**: **YES**. Groq endpoints send `Access-Control-Allow-Origin: *`.
* **(d) Key Requirements**: Free Groq API Key (`console.groq.com`, no credit card required).
* **(e) Notable Models**: `llama-3.3-70b-versatile` (70B, excellent for creative writing), `deepseek-r1-distill-llama-70b` (reasoning & story outline planning), `llama-3.1-8b-instant` (ultra-fast drafting at 800+ tokens/sec).
* **(f) Source URL**: https://console.groq.com/docs/rate-limits

---

### 2. Google Gemini API
* **(a) Free-Tier Limits TODAY**:
  * Gemini 2.5 Flash / Gemini 3.0 Flash: 10–15 RPM, 1,500 RPD, 250,000 TPM.
  * Gemini 3.1 Flash-Lite: 15 RPM, 1,000–1,500 RPD, 250,000 TPM.
  * Free quota enforced per Google AI Studio API key.
* **(b) API Style**: Native Gemini REST API (`https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={apiKey}`) or `@google/genai` JS SDK via CDN/ESM. (OpenAI-compatible wrapper exists at `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions`).
* **(c) CORS / Browser-Usable**: **YES**. Native REST API and JS SDK work directly in client-side browser JS.
* **(d) Key Requirements**: Free Google AI Studio API key (`aistudio.google.com`, no credit card required).
* **(e) Notable Models**: `gemini-2.5-flash` and `gemini-3-flash` (1,000,000+ token context window, perfect for full-book context retention and editing).
* **(f) Source URL**: https://ai.google.dev/gemini-api/docs/rate-limits

---

### 3. Cloudflare Workers AI
* **(a) Free-Tier Limits TODAY**: 10,000 Neurons per day per Cloudflare account (resets daily at 00:00 UTC). Yields approximately 15,000–30,000 generated tokens/day depending on model parameter size.
* **(b) API Style**: OpenAI-compatible (`https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1/chat/completions`) or native REST.
* **(c) CORS / Browser-Usable**: **YES**. Cloudflare API handles CORS preflight for client-side fetches.
* **(d) Key Requirements**: Cloudflare Account ID + API Token with Workers AI read/write scope.
* **(e) Notable Models**: `@cf/meta/llama-3.3-70b-instruct`, `@cf/meta/llama-3.1-8b-instruct`, `@cf/deepseek-ai/deepseek-r1-distill-qwen-32b`, `@cf/qwen/qwen2.5-72b-instruct`.
* **(f) Source URL**: https://developers.cloudflare.com/workers-ai/platform/pricing/

---

### 4. Cerebras API
* **(a) Free-Tier Limits TODAY**: **Free no-card tier ENDED August 17, 2026**. New accounts receive $5 in free trial credits after linking a verified credit card/payment method. Trial rate limits: 5 RPM, 30,000 uncached TPM, 1,000,000 TPD while trial credits last.
* **(b) API Style**: OpenAI-compatible (`https://api.cerebras.ai/v1/chat/completions`).
* **(c) CORS / Browser-Usable**: **YES** (Endpoint supports CORS, but free access without credit card is removed).
* **(d) Key Requirements**: Account registration + **Verified Credit Card**.
* **(e) Notable Models**: `llama-3.3-70b`, `qwen-3.8-27b`, `gpt-oss-120b` (runs at ultra-fast 1,500–2,000 tokens/sec on CS-3 wafer-scale engine).
* **(f) Source URL**: https://inference-docs.cerebras.ai/support/rate-limits

---

### 5. Mistral AI La Plateforme
* **(a) Free-Tier Limits TODAY**: Free "Experiment Tier" available upon signup. Limits: ~1 RPS (1–2 RPM for large models), 500k–1M tokens/month.
* **(b) API Style**: OpenAI-compatible (`https://api.mistral.ai/v1/chat/completions`).
* **(c) CORS / Browser-Usable**: **YES**. `api.mistral.ai` responds with `Access-Control-Allow-Origin: *`.
* **(d) Key Requirements**: Free Mistral account & API key (`console.mistral.ai`). Phone verification may be requested.
* **(e) Notable Models**: `mistral-small-latest` (22B, excellent creative writer), `pixtral-12b` (multimodal vision), `codestral-latest`.
* **(f) Source URL**: https://mistral.ai/pricing/

---

### 6. NEW ENTRANTS & OTHER PROVIDERS

#### 6A. SambaNova Cloud
* **(a) Free-Tier Limits TODAY**: Generous free tier with **NO credit card required**. 30 RPM, up to 20,000,000 tokens per day (TPD).
* **(b) API Style**: OpenAI-compatible (`https://api.sambanova.ai/v1/chat/completions`).
* **(c) CORS / Browser-Usable**: **YES**. Returns `Access-Control-Allow-Origin: *` on all client fetch requests.
* **(d) Key Requirements**: Free SambaNova Cloud API key (`cloud.sambanova.ai`).
* **(e) Notable Models**: **`Meta-Llama-3.1-405B-Instruct`** (405B parameters free!), `Meta-Llama-3.3-70B-Instruct`, `DeepSeek-R1-Distill-Llama-70B`, `Qwen2.5-72B-Instruct`. Inference speeds: 400–1,000 tokens/sec.
* **(f) Source URL**: https://docs.sambanova.ai/docs/en/models/rate-limits

#### 6B. OpenRouter `:free` Models
* **(a) Free-Tier Limits TODAY**: 20 RPM, ~50–200 RPD per free model (1,000 RPD if account ever had $10 deposit). Automatic fallback via `openrouter/free` endpoint.
* **(b) API Style**: OpenAI-compatible (`https://openrouter.ai/api/v1/chat/completions`).
* **(c) CORS / Browser-Usable**: **YES**. Full browser fetch support.
* **(d) Key Requirements**: Free OpenRouter API Key (`openrouter.ai`).
* **(e) Notable Models**: `meta-llama/llama-3.3-70b-instruct:free`, `deepseek/deepseek-r1:free`, `qwen/qwen-2.5-72b-instruct:free`, `mistralai/mistral-small-24b-instruct-2501:free`.
* **(f) Source URL**: https://openrouter.ai/pricing

#### 6C. HuggingFace Inference API (Serverless Router)
* **(a) Free-Tier Limits TODAY**: Free User Access Token provides rate-limited access (~1,000 requests/day).
* **(b) API Style**: OpenAI-compatible (`https://router.huggingface.co/v1/chat/completions`).
* **(c) CORS / Browser-Usable**: **YES**. `router.huggingface.co` includes `Access-Control-Allow-Origin: *`.
* **(d) Key Requirements**: Free HuggingFace account & User Access Token (`hf_...`).
* **(e) Notable Models**: `meta-llama/Llama-3.3-70B-Instruct`, `Qwen/Qwen2.5-72B-Instruct`, `deepseek-ai/DeepSeek-R1-Distill-Qwen-32B`, `black-forest-labs/FLUX.1-schnell` (images).
* **(f) Source URL**: https://huggingface.co/docs/api-inference/

#### 6D. NVIDIA NIM Build API
* **(a) Free-Tier Limits TODAY**: 1,000 one-time trial credits upon registration. No daily resetting free tier.
* **(b) API Style**: OpenAI-compatible (`https://integrate.api.nvidia.com/v1`).
* **(c) CORS / Browser-Usable**: **NO**. `integrate.api.nvidia.com` omits CORS headers for browser requests. Fails in client-side apps without a server proxy.
* **(d) Key Requirements**: NVIDIA Developer account.
* **(e) Verdict**: **DO NOT ADD** (Fails CORS; trial credits only).
* **(f) Source URL**: https://build.nvidia.com

#### 6E. Together AI & Fireworks AI
* **Together AI**: $5 one-time credit (no permanent free tier). CORS: Yes. Trial only.
* **Fireworks AI**: $1 one-time credit (no permanent free tier). CORS: Yes. Trial only.

#### 6F. Cohere API
* **(a) Free-Tier Limits TODAY**: Trial key allows 20 RPM, 1,000 calls/month.
* **(b) API Style**: Cohere custom REST / OpenAI compatibility mode (`https://api.cohere.com/compatibility/v1/chat/completions`).
* **(c) CORS / Browser-Usable**: **NO / Partial** (Requires backend proxy due to origin restrictions on API endpoints).
* **(d) Verdict**: **NOT RECOMMENDED** (Tight 1,000/mo cap, CORS restricted).

#### 6G. Markitdown
* **Clarification**: Markitdown is Microsoft's open-source Python document parsing library (`pip install markitdown`), not an LLM API endpoint.

---

### 7. FREE IMAGE GENERATION APIS

#### Pollinations.ai (Current Backend - KEEP & EXPAND)
* **(a) Free-Tier Limits TODAY**: 100% FREE, no API key required, unlimited/generous rate limits.
* **(b) API Style**: REST / direct URL image generation (`https://image.pollinations.ai/prompt/{prompt}?model=flux...`).
* **(c) CORS / Browser-Usable**: **YES**. Fully browser accessible via `<img src="..." />` or `fetch()`.
* **(d) Key Requirements**: None (Keyless).
* **(e) Notable Models**: `flux`, `flux-realism`, `flux-candid`, `flux-3d`, `turbo`, `any-dark`.
* **(f) Source URL**: https://pollinations.ai

#### Puter.js Image SDK
* **Status**: Integrated via `puter.ai.txt2img()`. Free/metered, supports FLUX.1 & FLUX.2. Working as expected.

---

### 8. FREE TEXT-TO-SPEECH (TTS) APIS

#### Web Speech API (Current Backend)
* **Status**: Built-in browser `window.speechSynthesis`. 100% free, offline, instant latency, zero setup. Keep as default fallback.

#### NEW TOP RECOMMENDATION: Kokoro.js (In-Browser Neural TTS)
* **(a) Free-Tier Limits TODAY**: **Unlimited**. Runs 100% client-side inside the browser using ONNX Runtime Web / WebGPU / WASM via Transformers.js (`kokoro-js`).
* **(b) API Style**: Client-side JavaScript library (`import { KokoroTTS } from 'kokoro-js'`).
* **(c) CORS / Browser-Usable**: **YES** (100% in-browser compute).
* **(d) Key Requirements**: None (Model weights downloaded once from HuggingFace CDN and cached in IndexedDB).
* **(e) Voice Quality**: Ultra-realistic 82M parameter neural voice model (comparable to ElevenLabs quality).
* **(f) Source URL**: https://github.com/xenova/kokoro-js

---

## MATRIX SUMMARY OF ALL EVALUATED BACKENDS

| Provider | Free Tier Status | Daily / Monthly Quota | CORS Browser Usable? | OpenAI API Compatible? | Key Needed? | Recommended Role for BookForge AI |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **SambaNova Cloud** | **Active (No card)** | 20M tokens/day | **YES** | **YES** | Free Key | **#1 Top Addition** (Heavy writing, Llama 405B/70B) |
| **OpenRouter (:free)**| **Active (No card)** | 20 RPM / 200 RPD | **YES** | **YES** | Free Key | **#2 Top Addition** (Multi-model routing fallback) |
| **HuggingFace API** | **Active (No card)** | ~1,000 req/day | **YES** | **YES** | Free Token | **#3 Top Addition** (Text + FLUX.1 cover images) |
| **Kokoro.js (TTS)** | **Unlimited Local** | Unlimited | **YES (Local)**| N/A (JS SDK) | None | **#4 Top Addition** (In-browser neural TTS) |
| **Mistral AI** | **Active (No card)** | 1 RPS / 1M tok/mo | **YES** | **YES** | Free Key | **#5 Addition** (Multilingual creative writing) |
| **Groq API** | **Active (No card)** | 30 RPM / 1,000 RPD | **YES** | **YES** | Free Key | **Keep Active** (Fast drafting, Llama 3.3 70B) |
| **Google Gemini API**| **Active (No card)** | 15 RPM / 1,500 RPD | **YES** | REST / Native | Free Key | **Keep Active** (Whole-book 1M+ token context) |
| **Cloudflare Workers**| **Active (No card)** | 10,000 Neurons/day| **YES** | **YES** | Account ID+Token| **Keep Active** (Backup generation) |
| **Puter.js** | **Metered User-Pays**| SDK Balance | **YES** | N/A (JS SDK) | None | **Keep Active** (Default keyless fallback) |
| **Pollinations.ai** | **Active (No card)** | Unlimited | **YES** | REST/URL | None | **Keep Active** (Default keyless image cover art) |
| **Cerebras API** | **Ended (Card required)**| $5 trial credit | **YES** | **YES** | Card + Key | **Demote** (Optional BYO paid/trial key) |
| **Kilo Code** | **Dead** | N/A | **NO (No CORS)**| YES | Key | **Remove / Disable** (Fails CORS in browser) |
| **NVIDIA NIM** | **Trial Credits** | 1,000 credits | **NO (No CORS)**| YES | Key | **Do Not Add** (Fails CORS in browser) |
| **Cohere API** | **Trial Key** | 1,000 calls/mo | **NO / Partial** | Compatibility | Key | **Do Not Add** (Low quota + CORS restricted) |
