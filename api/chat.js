const SYSTEM_PROMPT = `
You are GRAI, a helpful, smart, warm, and natural AI assistant.
Understand and reply in whatever language the user writes in across world languages (such as Bengali, Banglish, English, Hindi, Urdu, Arabic, Spanish, French, Japanese, Korean, German, etc.), keeping spelling clean and natural without forcing only Bengali or English.
If the user writes in Banglish and asks for pure Bengali, reply in clean natural Bengali. Complete every sentence cleanly with proper punctuation (।, ., ?, !) without cutting off mid-word.
When web search results are provided in context, prioritize accurate, up-to-date facts from those results and do not invent unverified details.

Identity Rules:
- When asked who you are or who made/developed you, answer naturally using GRAI and GRL without giving full forms unless asked.
- Only when asked what GRAI or GRL means or stands for, explain naturally that GRAI-এর পূর্ণরূপ Gamer Rafi Artificial Intelligence এবং GRL-এর পূর্ণরূপ Gamer Rafi Limited.
- Never mention Flint, Recursive, or any other creator/company.

Formatting, Vision & Error Rules:
- Do not wrap every word or phrase in ** asterisks. Use punctuation like (), [], "", and * naturally only when helpful.
- You DO have image vision capability. When an image is attached, inspect what is actually in the image carefully and reply directly in the user's language without saying you cannot view images.
- If a technical issue occurs, simply say "Temporary issue" (or "সাময়িক সমস্যা" if the user writes in Bengali) without giving long excuses.
`.trim();

const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID || "5d17dd64f2a0e4001e1f608ac4f6676d";
const TEXT_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const VISION_MODEL = "@cf/meta/llama-3.2-11b-vision-instruct";

function decodeHtmlEntities(str = "") {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function shouldSearchWeb(query = "") {
  const q = query.toLowerCase().trim();
  if (!q || q.length < 3) return false;

  const greetingOnly = /^(hi|hello|hey|salam|assalamu alaikum|kemon acho|ki khobor|valo acho|thanks|thank you|dhonnobad|ok|hmm)\b/i;
  if (greetingOnly.test(q) && q.split(/\s+/).length <= 4) {
    return false;
  }

  return true;
}

async function searchDuckDuckGo(query) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    if (!res.ok) return [];

    const html = await res.text();
    const results = [];

    const titleRegex = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
    const snippetRegex = /<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>|<div[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;

    const titles = [];
    let tMatch;
    while ((tMatch = titleRegex.exec(html)) !== null && titles.length < 6) {
      let rawUrl = decodeHtmlEntities(tMatch[1] || "");
      const uddgMatch = rawUrl.match(/[?&]uddg=([^&]+)/);
      if (uddgMatch) {
        try {
          rawUrl = decodeURIComponent(uddgMatch[1]);
        } catch (_) {}
      }
      titles.push({
        title: decodeHtmlEntities(tMatch[2] || ""),
        url: rawUrl,
      });
    }

    const snippets = [];
    let sMatch;
    while ((sMatch = snippetRegex.exec(html)) !== null && snippets.length < 6) {
      snippets.push(decodeHtmlEntities(sMatch[1] || sMatch[2] || ""));
    }

    for (let i = 0; i < titles.length; i++) {
      if (titles[i].title || snippets[i]) {
        results.push({
          title: titles[i].title || "Result",
          url: titles[i].url || "",
          snippet: snippets[i] || "",
        });
      }
    }

    return results.slice(0, 5);
  } catch (_) {
    return [];
  }
}

function extractBase64Image(attachment) {
  if (!attachment || typeof attachment !== "object") return null;

  const raw =
    attachment.dataUrl ||
    attachment.base64 ||
    attachment.image ||
    attachment.preview ||
    attachment.url ||
    attachment.src ||
    attachment.content ||
    "";

  if (typeof raw !== "string" || !raw.trim()) return null;

  const match = raw.match(/^data:image\/([a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (match) {
    return {
      mimeType: `image/${match[1].toLowerCase()}`,
      base64: match[2].replace(/\s+/g, ""),
    };
  }

  const cleaned = raw.replace(/\s+/g, "");
  if (/^[A-Za-z0-9+/=]+$/.test(cleaned) && cleaned.length > 100) {
    return {
      mimeType: attachment.type || "image/jpeg",
      base64: cleaned,
    };
  }

  return null;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const apiToken = (process.env.CF_API_TOKEN || process.env.GEMINI_API_KEY || "").trim();
    const accountId = (CF_ACCOUNT_ID || "").trim();

    if (!accountId || !apiToken) {
      return res.status(200).json({
        reply: "সাময়িক সমস্যা",
      });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const { message = "", history = [], attachment = null } = body;

    const cleanMessage = typeof message === "string" ? message.trim() : "";
    const parsedImage = extractBase64Image(attachment);

    if (!cleanMessage && !parsedImage) {
      return res.status(200).json({
        reply: "সাময়িক সমস্যা",
      });
    }

    if (parsedImage) {
      const visionEndpoint = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${VISION_MODEL}`;
      const imageBytes = Array.from(Buffer.from(parsedImage.base64, "base64"));

      const userInstruction = cleanMessage
        ? `User message: ${cleanMessage}\nReply directly in the same language as the user's message.`
        : "Look closely at this image and describe what is shown or written clearly in natural Bengali (or matching any text language in the image).";

      const visionRes = await fetch(visionEndpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt: userInstruction,
          image: imageBytes,
          max_tokens: 1000,
          temperature: 0.35,
        }),
      });

      const visionData = await visionRes.json().catch(() => ({}));
      const visionReply =
        visionData?.result?.response ||
        visionData?.result?.description ||
        visionData?.result?.output_text;

      if (visionRes.ok && typeof visionReply === "string" && visionReply.trim()) {
        return res.status(200).json({ reply: visionReply.trim() });
      }

      return res.status(200).json({
        reply: "সাময়িক সমস্যা",
      });
    }

    const safeHistory = Array.isArray(history)
      ? history
          .filter(
            (item) =>
              item &&
              (item.role === "user" || item.role === "assistant") &&
              typeof item.content === "string" &&
              item.content.trim()
          )
          .slice(-10)
          .map((item) => ({
            role: item.role,
            content: item.content.trim(),
          }))
      : [];

    let searchContext = "";
    if (shouldSearchWeb(cleanMessage)) {
      const searchResults = await searchDuckDuckGo(cleanMessage);
      if (searchResults.length > 0) {
        const formattedResults = searchResults
          .map(
            (r, idx) =>
              `${idx + 1}. ${r.title}\nSnippet: ${r.snippet}${r.url ? `\nSource: ${r.url}` : ""}`
          )
          .join("\n\n");

        searchContext = `\n\n[Live Web Search Results for "${cleanMessage}"]\n${formattedResults}\n[End of Search Results]`;
      }
    }

    let userPrompt = cleanMessage;
    if (attachment && attachment.name) {
      userPrompt = cleanMessage
        ? `${cleanMessage}\n\n[Attached file: ${attachment.name}]`
        : `[Attached file: ${attachment.name}] Please help me with this.`;
    }

    if (searchContext) {
      userPrompt = `${userPrompt}${searchContext}\n\nUse the web search results above to give a clear, accurate, and complete answer in the user's language.`;
    }

    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      ...safeHistory,
      { role: "user", content: userPrompt },
    ];

    const textEndpoint = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${TEXT_MODEL}`;

    const response = await fetch(textEndpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messages,
        max_tokens: 1500,
        temperature: 0.45,
      }),
    });

    const data = await response.json().catch(() => ({}));
    const replyText = data?.result?.response;

    if (response.ok && typeof replyText === "string" && replyText.trim()) {
      return res.status(200).json({ reply: replyText.trim() });
    }

    return res.status(200).json({
      reply: "সাময়িক সমস্যা",
    });
  } catch (err) {
    return res.status(200).json({
      reply: "সাময়িক সমস্যা",
    });
  }
};
