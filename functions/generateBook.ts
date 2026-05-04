import base44 from "npm:@base44/sdk";

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent";

async function callGemini(prompt: string): Promise<string> {
  const res = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.8, maxOutputTokens: 8192 }
    })
  });

  const data = await res.json();

  // Handle Gemini-specific quota/rate limit errors
  if (!res.ok) {
    const errMsg = data.error?.message || "";
    const errCode = data.error?.code;
    const errStatus = data.error?.status;

    if (res.status === 429 || errStatus === "RESOURCE_EXHAUSTED") {
      throw new Error("QUOTA_EXCEEDED: You've reached Gemini's free daily limit. Please wait until tomorrow (limits reset at midnight Pacific Time) and try again.");
    }
    if (res.status === 403) {
      throw new Error("API_KEY_ERROR: Invalid or unauthorized Gemini API key. Please check your key at https://aistudio.google.com/app/apikey");
    }
    if (res.status === 400) {
      throw new Error(`INVALID_REQUEST: ${errMsg}`);
    }
    throw new Error(`GEMINI_ERROR: ${errMsg || `HTTP ${res.status}`}`);
  }

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    // Check for safety blocks
    const blockReason = data.candidates?.[0]?.finishReason;
    if (blockReason === "SAFETY") {
      throw new Error("SAFETY_BLOCK: Gemini blocked this content for safety reasons. Try rephrasing your topic.");
    }
    throw new Error("EMPTY_RESPONSE: Gemini returned an empty response. Please try again.");
  }

  return text;
}

export default async function handler(req: Request) {
  const { action, topic, genre, targetAudience, chapterIndex, outline, existingChapters } = await req.json();

  try {
    if (action === "generate_outline") {
      const prompt = `You are a bestselling book author and publisher. Create a detailed, compelling book outline for the following:

Topic/Idea: ${topic}
Genre: ${genre}
Target Audience: ${targetAudience}

Generate:
1. A captivating TITLE (make it marketable and SEO-friendly)
2. A compelling SUBTITLE 
3. A SHORT DESCRIPTION (150 words, hook for readers)
4. 10-15 CHAPTER TITLES with a 2-3 sentence description of what each chapter covers
5. KEY THEMES (5 bullet points)
6. TARGET WORD COUNT estimate

Format your response as JSON like this:
{
  "title": "...",
  "subtitle": "...",
  "description": "...",
  "chapters": [{"number": 1, "title": "...", "description": "..."}],
  "themes": ["...", "..."],
  "estimated_word_count": 50000
}`;

      const result = await callGemini(prompt);
      const jsonMatch = result.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("Could not parse outline JSON from Gemini response. Please try again.");
      const outlineData = JSON.parse(jsonMatch[0]);
      return Response.json({ success: true, outline: outlineData });

    } else if (action === "generate_chapter") {
      const chapter = outline.chapters[chapterIndex];
      const prevChapters = existingChapters?.slice(0, chapterIndex).map((c: any) => c.title).join(", ") || "None yet";

      const prompt = `You are a bestselling author writing a chapter for a ${genre} book titled "${outline.title}".

Book Description: ${outline.description}
Target Audience: ${targetAudience}

Previous chapters covered: ${prevChapters}

Now write Chapter ${chapter.number}: "${chapter.title}"
Chapter description: ${chapter.description}

Requirements:
- Write 2,000-3,500 words of engaging, high-quality content
- Use proper headings, subheadings where appropriate
- Include examples, stories, or practical insights
- Write in a voice appropriate for ${genre} targeting ${targetAudience}
- End with a smooth transition or summary
- Make it compelling, informative, and valuable to the reader

Write the full chapter now:`;

      const content = await callGemini(prompt);
      return Response.json({ success: true, content, chapterIndex });

    } else if (action === "generate_seo") {
      const prompt = `You are an Amazon KDP SEO expert. Generate optimized SEO metadata for maximum book visibility.

Book Title: ${outline.title}
Subtitle: ${outline.subtitle}
Genre: ${genre}
Description: ${outline.description}
Target Audience: ${targetAudience}

Generate the following as JSON:
{
  "seo_title": "...(max 200 chars, keyword-rich)",
  "seo_description": "...(400-600 words, compelling, keyword-rich, formatted for Amazon KDP)",
  "primary_keywords": ["...", "..."],
  "bisac_categories": ["...", "..."],
  "a_plus_content_hook": "...",
  "back_cover_copy": "...",
  "author_bio_template": "..."
}`;

      const result = await callGemini(prompt);
      const jsonMatch = result.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("Could not parse SEO JSON. Please try again.");
      const seo = JSON.parse(jsonMatch[0]);
      return Response.json({ success: true, seo });

    } else if (action === "generate_cover_prompt") {
      const prompt = `You are a professional book cover designer. Create a detailed image generation prompt for a book cover.

Book Title: "${outline.title}"
Subtitle: "${outline.subtitle}"
Genre: ${genre}
Target Audience: ${targetAudience}
Description: ${outline.description}

Create a detailed, specific prompt for generating a professional, eye-catching book cover that would sell well on Amazon. 
Include: art style, color palette, imagery, mood, composition. 
Make it highly specific and visual. No text in the image.

Return just the image prompt, nothing else.`;

      const coverPrompt = await callGemini(prompt);
      return Response.json({ success: true, coverPrompt: coverPrompt.trim() });

    } else {
      return Response.json({ error: "Unknown action" }, { status: 400 });
    }

  } catch (err: any) {
    const msg = err.message || "Unknown error";

    // Return structured error so frontend can show the right message
    if (msg.startsWith("QUOTA_EXCEEDED:")) {
      return Response.json({
        error: msg.replace("QUOTA_EXCEEDED: ", ""),
        errorType: "quota_exceeded"
      }, { status: 429 });
    }
    if (msg.startsWith("API_KEY_ERROR:")) {
      return Response.json({
        error: msg.replace("API_KEY_ERROR: ", ""),
        errorType: "api_key_error"
      }, { status: 403 });
    }
    if (msg.startsWith("SAFETY_BLOCK:")) {
      return Response.json({
        error: msg.replace("SAFETY_BLOCK: ", ""),
        errorType: "safety_block"
      }, { status: 400 });
    }

    return Response.json({ error: msg, errorType: "general" }, { status: 500 });
  }
}
