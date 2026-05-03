import base44 from "npm:@base44/sdk";

const client = base44({ appId: Deno.env.get("BASE44_APP_ID") });

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
  if (!res.ok) throw new Error(data.error?.message || "Gemini API error");
  return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

export default async function handler(req: Request) {
  const { action, bookId, topic, genre, targetAudience, chapterIndex, outline, existingChapters } = await req.json();

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
      if (!jsonMatch) throw new Error("Could not parse outline JSON");
      const outline = JSON.parse(jsonMatch[0]);
      return Response.json({ success: true, outline });

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
  "primary_keywords": ["...", "..."] (7 keywords Amazon KDP allows),
  "bisac_categories": ["...", "..."] (2-3 best BISAC categories),
  "a_plus_content_hook": "...(1 paragraph hook for A+ content)",
  "back_cover_copy": "...(compelling back cover text)",
  "author_bio_template": "...(fill-in author bio template)"
}`;

      const result = await callGemini(prompt);
      const jsonMatch = result.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("Could not parse SEO JSON");
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
Make it highly specific and visual. No text instructions (the title will be added separately).

Return just the image prompt, nothing else.`;

      const coverPrompt = await callGemini(prompt);
      return Response.json({ success: true, coverPrompt: coverPrompt.trim() });

    } else {
      return Response.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
