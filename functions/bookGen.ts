import base44 from "npm:@base44/sdk";

const client = base44({ appId: Deno.env.get("BASE44_APP_ID") });
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent";
const DAILY_LIMIT = 1500;

async function trackUsage() {
  const today = new Date().toISOString().split("T")[0];
  const records = await client.asServiceRole.entities.GeminiUsage.filter({ date: today });
  if (records.length === 0) {
    await client.asServiceRole.entities.GeminiUsage.create({ date: today, request_count: 1, daily_limit: DAILY_LIMIT });
    return { count: 1, limit: DAILY_LIMIT, remaining: DAILY_LIMIT - 1 };
  }
  const rec = records[0];
  const newCount = (rec.request_count || 0) + 1;
  await client.asServiceRole.entities.GeminiUsage.update(rec.id, { request_count: newCount });
  return { count: newCount, limit: DAILY_LIMIT, remaining: DAILY_LIMIT - newCount };
}

async function getTodayUsage() {
  const today = new Date().toISOString().split("T")[0];
  const records = await client.asServiceRole.entities.GeminiUsage.filter({ date: today });
  const count = records[0]?.request_count || 0;
  return { count, limit: DAILY_LIMIT, remaining: DAILY_LIMIT - count };
}

async function callGemini(prompt) {
  const res = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.8, maxOutputTokens: 8192 }
    })
  });
  const data = await res.json();
  if (!res.ok) {
    const errMsg = data.error?.message || "";
    const errStatus = data.error?.status;
    if (res.status === 429 || errStatus === "RESOURCE_EXHAUSTED") throw new Error("QUOTA_EXCEEDED: You've reached Gemini's free daily limit. Limits reset at midnight Pacific Time.");
    if (res.status === 403) throw new Error("API_KEY_ERROR: Invalid Gemini API key.");
    throw new Error("GEMINI_ERROR: " + (errMsg || "HTTP " + res.status));
  }
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    if (data.candidates?.[0]?.finishReason === "SAFETY") throw new Error("SAFETY_BLOCK: Content blocked. Try rephrasing.");
    throw new Error("EMPTY_RESPONSE: Empty response from Gemini.");
  }
  return text;
}

export default async function handler(req) {
  const body = await req.json();
  const { action, topic, genre, targetAudience, chapterIndex, outline, existingChapters } = body;

  if (action === "get_usage") {
    const usage = await getTodayUsage();
    return Response.json({ success: true, usage });
  }

  try {
    let result = {};

    if (action === "generate_outline") {
      const raw = await callGemini(
        "You are a bestselling book author. Create a book outline.\nTopic: " + topic +
        "\nGenre: " + genre + "\nTarget Audience: " + targetAudience +
        "\n\nRespond with ONLY valid JSON (no markdown fences):\n{\"title\":\"\",\"subtitle\":\"\",\"description\":\"\",\"chapters\":[{\"number\":1,\"title\":\"\",\"description\":\"\"}],\"themes\":[\"\"],\"estimated_word_count\":50000}"
      );
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("Could not parse outline. Please try again.");
      result = { outline: JSON.parse(jsonMatch[0]) };

    } else if (action === "generate_chapter") {
      const ch = outline.chapters[chapterIndex];
      const prev = (existingChapters || []).slice(0, chapterIndex).map(c => c.title).join(", ") || "None";
      const content = await callGemini(
        "Write Chapter " + ch.number + ": \"" + ch.title + "\" for a " + genre + " book titled \"" + outline.title + "\".\n" +
        "Description: " + ch.description + "\nPrev chapters: " + prev + "\nAudience: " + targetAudience +
        "\n\nWrite 2,500-3,500 words with subheadings. High quality and engaging."
      );
      result = { content, chapterIndex };

    } else if (action === "generate_seo") {
      const raw = await callGemini(
        "Amazon KDP SEO expert. Generate metadata.\nTitle: " + outline.title +
        "\nGenre: " + genre + "\nDesc: " + outline.description +
        "\n\nRespond with ONLY valid JSON:\n{\"seo_title\":\"\",\"seo_description\":\"\",\"primary_keywords\":[\"\"],\"bisac_categories\":[\"\"],\"back_cover_copy\":\"\",\"author_bio_template\":\"\"}"
      );
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("Could not parse SEO data. Please try again.");
      result = { seo: JSON.parse(jsonMatch[0]) };

    } else if (action === "generate_cover_prompt") {
      const coverPrompt = await callGemini(
        "Create a detailed AI image prompt for a professional book cover.\nTitle: \"" + outline.title +
        "\"\nGenre: " + genre + "\nDesc: " + outline.description +
        "\nArt style, colors, imagery, mood, composition. No text in image. Return only the prompt."
      );
      result = { coverPrompt: coverPrompt.trim() };

    } else {
      return Response.json({ error: "Unknown action" }, { status: 400 });
    }

    const usage = await trackUsage();
    return Response.json({ success: true, ...result, usage });

  } catch (err) {
    const msg = err.message || "Unknown error";
    if (msg.startsWith("QUOTA_EXCEEDED:")) return Response.json({ error: msg.replace("QUOTA_EXCEEDED: ", ""), errorType: "quota_exceeded" }, { status: 429 });
    if (msg.startsWith("API_KEY_ERROR:")) return Response.json({ error: msg.replace("API_KEY_ERROR: ", ""), errorType: "api_key_error" }, { status: 403 });
    if (msg.startsWith("SAFETY_BLOCK:")) return Response.json({ error: msg.replace("SAFETY_BLOCK: ", ""), errorType: "safety_block" }, { status: 400 });
    return Response.json({ error: msg, errorType: "general" }, { status: 500 });
  }
}
