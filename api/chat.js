const SYSTEM_PROMPT = `
You are GRAI, a smart, helpful, natural, and conversational AI assistant under GRL.
Your default and system language is English. Always default to clear, natural English unless the user writes in another language (such as Bengali, Banglish, Hindi, Arabic, Spanish, French, etc.) or explicitly asks for another language, in which case reply naturally in that language.
Keep replies concise, clear, and natural—say only what is needed without over-explaining or sounding robotic.
At the end of most helpful replies, naturally add a short relevant question or a brief offer like "Would you like me to do that for you?" (or "চাইলে আমি এটি করে দিতে পারি।" when replying in Bengali) when appropriate, without forcing it on every single message.
Do NOT mention current date or time unless the user explicitly asks for date, time, day, or today's info.
Strictly follow these search rules:
- When verified web search results are provided, use only facts found in those results.
- Never guess, fabricate, or invent dates, schedules, names, or events when search results do not confirm them.
- If the user asks for live/current/specific facts (like events, news, prices, current office officials, etc.) and no verified search results are provided, state plainly in the user's language that live verified information could not be found right now.

Identity & Formatting Rules:
- Name: GRAI; under GRL. Mention GRL/GRAI naturally when asked who you are or who made you, without giving full forms unless asked.
- Only when asked what GRAI or GRL means or stands for, state that GRAI stands for Gamer Rafi Artificial Intelligence and GRL stands for Gamer Rafi Limited.
- Never mention Flint, Recursive, or any other company.
- Do not wrap every word or phrase in ** asterisks.
- You have vision capability. When an image is attached, inspect it carefully and answer directly in the user's language (defaulting to English).
- If a technical issue occurs, say "Temporary issue" by default (or "সাময়িক সমস্যা" only when the user writes in Bengali) without long excuses.
`.trim();

const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID || "5d17dd64f2a0e4001e1f608ac4f6676d";
const TEXT_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const VISION_MODEL = "@cf/meta/llama-3.2-11b-vision-instruct";

function getFallbackErrorText(text = "") {
  return /[\u0980-\u09FF]/.test(text) ? "সাময়িক সমস্যা" : "Temporary issue";
}

function getCurrentTimeInfo() {
  try {
    const now = new Date();
    const dhakaStr = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Dhaka",
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    }).format(now);
    return `${dhakaStr} (Asia/Dhaka)`;
  } catch (_) {
    return new Date().toISOString();
  }
}

function needsDateOrTime(query = "") {
  return /(date|time|today|day|month|year|tarikh|somoy|ajke|aj|কত তারিখ|কয়টা বাজে|আজকে|আজ|বার কি|সময়)/i.test(
    query
  );
}

function isNonSearchChat(query = "") {
  const q = query.trim().toLowerCase();
  if (!q || q.length < 2) return true;

  const patterns = [
    /^(hi|hello|hey|salam|assalamu alaikum|good morning|good afternoon|good evening|kemon acho|ki khobor|valo acho|thanks|thank you|dhonnobad|ok|okay|hmm|হাই|হ্যালো|সালাম|কেমন আছেন|ধন্যবাদ)\b/i,
    /(তুমি কে|তুমি কেডা|তোমার মালিক|who are you|your name|grl|grai|ওয়েবসাইট সার্চ করতে পারো|ওয়েবসাইটের ভিতর যেতে পারো|salam dibi|elder sister)/i,
  ];

  return patterns.some((p) => p.test(q));
}

function shouldSearchWeb(query = "") {
  if (isNonSearchChat(query)) return false;
  const q = query.trim();
  if (q.length < 4) return false;

  return /(search|news|latest|current|update|price|score|schedule|event|fair|mela|office|department|who is|what is|when is|where is|কবে|কখন|কোথায়|খবর|তথ্য|মেলা|দপ্তর|সার্চ|দাম|কে|কারা|কী|কি)/i.test(
    q
  );
}

async function searchWithTavily(query, apiKey) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 7000);

    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        search_depth: "basic",
        max_results: 5,
        include_answer: true,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    if (!res.ok) return { answer: "", results: [] };

    const data = await res.json().catch(() => ({}));
    const results = Array.isArray(data.results)
      ? data.results
          .filter((item) => item && (item.title || item.content))
          .slice(0, 5)
          .map((item) => ({
            title: String(item.title || "").trim(),
            url: String(item.url || "").trim(),
            snippet: String(item.content || "").trim(),
          }))
      : [];

    return {
      answer: typeof data.answer === "string" ? data.answer.trim() : "",
      results,
    };
  } catch (_) {
    return { answer: "", results: [] };
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

  const match = raw.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
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

  let fallbackMsg = "Temporary issue";

  try {
    const cfToken = (process.env.CF_API_TOKEN || process.env.GEMINI_API_KEY || "").trim();
    const accountId = (CF_ACCOUNT_ID || "").trim();
    const tavilyKey = (process.env.TAVILY_API_KEY || "").trim();

    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
    const { message = "", history = [], attachment = null } = body;

    const cleanMessage = typeof message === "string" ? message.trim() : "";
    fallbackMsg = getFallbackErrorText(cleanMessage);

    const parsedImage = extractBase64Image(attachment);

    if (!accountId || !cfToken) {
      return res.status(200).json({ reply: fallbackMsg });
    }

    if (!cleanMessage && !parsedImage) {
      return res.status(200).json({ reply: fallbackMsg });
    }

    if (parsedImage) {
      const visionEndpoint = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${VISION_MODEL}`;
      const imageBytes = Array.from(Buffer.from(parsedImage.base64, "base64"));

      const userInstruction = cleanMessage
        ? `${cleanMessage}\nReply concisely and naturally in the user's language (defaulting to English).`
        : "Describe what is clearly shown or written in this image concisely and naturally in English (default language).";

      const visionRes = await fetch(visionEndpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${cfToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt: userInstruction,
          image: imageBytes,
          max_tokens: 900,
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

      return res.status(200).json({ reply: fallbackMsg });
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
          .slice(-8)
          .map((item) => ({
            role: item.role,
            content: item.content.trim(),
          }))
      : [];

    let searchData = { answer: "", results: [] };
    let searchContext = "";

    if (shouldSearchWeb(cleanMessage)) {
      if (tavilyKey) {
        searchData = await searchWithTavily(cleanMessage, tavilyKey);
        if (searchData.results.length > 0 || searchData.answer) {
          const formattedItems = searchData.results
            .map(
              (r, idx) =>
                `${idx + 1}. ${r.title}\nDetails: ${r.snippet}${r.url ? `\nSource: ${r.url}` : ""}`
            )
            .join("\n\n");

          searchContext = `\n\n[Verified Web Search Results]\n${
            searchData.answer ? `Summary: ${searchData.answer}\n\n` : ""
          }${formattedItems}\n[End Verified Web Search Results]`;
        } else {
          searchContext =
            "\n\n[Web Search Status: No verified search results found for this query. Do not guess or fabricate facts.]";
        }
      } else {
        searchContext =
          "\n\n[Web Search Status: Search API key is not configured yet. Do not guess or fabricate live facts.]";
      }
    }

    let userPrompt = cleanMessage;
    if (attachment && attachment.name) {
      userPrompt = cleanMessage
        ? `${cleanMessage}\n[Attached file: ${attachment.name}]`
        : `[Attached file: ${attachment.name}]`;
    }

    if (needsDateOrTime(cleanMessage)) {
      userPrompt = `[Current Date & Time: ${getCurrentTimeInfo()}]\n\n${userPrompt}`;
    }

    if (searchContext) {
      userPrompt = `${userPrompt}${searchContext}`;
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
        Authorization: `Bearer ${cfToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messages,
        max_tokens: 1200,
        temperature: 0.35,
      }),
    });

    const data = await response.json().catch(() => ({}));
    const replyText = data?.result?.response;

    if (response.ok && typeof replyText === "string" && replyText.trim()) {
      return res.status(200).json({
        reply: replyText.trim(),
        searched: searchData.results.length > 0,
      });
    }

    return res.status(200).json({ reply: fallbackMsg });
  } catch (err) {
    return res.status(200).json({ reply: fallbackMsg });
  }
};
