const SYSTEM_PROMPT = `
You are GRAI, a smart, accurate, and helpful AI assistant under GRL.
Your default and system language is English. Reply in clear, natural English by default, and reply naturally in the user's language (such as Bengali, Banglish, Hindi, Arabic, Spanish, French, etc.) when the user writes in that language.
Keep responses clear, grounded, and natural—never over-explain or sound robotic.

Strict Relevance & Anti-Hallucination Rules:
- ONLY use search results that directly match the user's actual topic. Completely ignore and never mention unrelated topics from search results (for example, do not bring up unrelated schemes, people, or events that do not match the user's question).
- If the provided search results do not clearly and reliably answer the user's specific question, say plainly in the user's language that verified details could not be found right now. Do NOT guess, invent dates/venues, or force unrelated search hits into the answer.
- End helpful responses naturally with a short, relevant follow-up question when helpful.

Identity & Formatting Rules:
- Name: GRAI; under GRL. Mention GRL/GRAI naturally only when asked who you are or who made you.
- Only when asked what GRAI or GRL means or stands for, state that GRAI stands for Gamer Rafi Artificial Intelligence and GRL stands for Gamer Rafi Limited.
- Never mention Flint, Recursive, or any other company.
- Do not wrap every word or phrase in ** asterisks; use bolding only selectively when helpful.
- You have vision capability. When an image is attached, inspect it carefully and answer directly in the user's language (defaulting to English).
- If a technical issue occurs, say "Temporary issue" by default (or "সাময়িক সমস্যা" only when the user writes in Bengali) briefly.
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
    return (
      new Intl.DateTimeFormat("en-US", {
        timeZone: "Asia/Dhaka",
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      }).format(now) + " (Asia/Dhaka)"
    );
  } catch (_) {
    return new Date().toISOString();
  }
}

function isNonSearchChat(query = "") {
  const q = query.trim().toLowerCase();
  if (!q || q.length < 3) return true;

  const patterns = [
    /^(hi|hello|hey|salam|assalamu alaikum|good morning|good afternoon|good evening|kemon acho|ki khobor|valo acho|thanks|thank you|dhonnobad|ok|okay|hmm|হাই|হ্যালো|সালাম|কেমন আছেন|ধন্যবাদ)\b/i,
    /(তুমি কে|তুমি কেডা|তোমার মালিক|who are you|your name|grl|grai|ওয়েবসাইট সার্চ করতে পারো|ওয়েবসাইটের ভিতর যেতে পারো)/i,
  ];

  return patterns.some((p) => p.test(q));
}

function shouldSearchWeb(query = "", history = []) {
  if (isNonSearchChat(query)) return false;
  const q = query.trim();
  if (q.length < 4) return false;

  const hasRecentHistory = Array.isArray(history) && history.length > 0;
  const followUpRef = /(এই বছর|এই মাস|ভালো করে সার্চ|সার্চ করে দেখো|this year|this month|search again|check again)/i.test(
    q
  );

  if (hasRecentHistory && followUpRef) return true;

  return /(search|news|latest|current|today|update|price|score|schedule|event|fair|mela|livestock|office|department|oc|police|thana|law|act|cyber|who is|what is|when is|where is|কবে|কখন|কোথায়|খবর|তথ্য|মেলা|প্রাণিসম্পদ|দপ্তর|সার্চ|দাম|থানা|ওসি|আইন|অধীনে|অন্তরে|কে|কারা|কী|কি)/i.test(
    q
  );
}

async function generateSearchQueries(userMessage, safeHistory, cfToken, accountId) {
  try {
    const todayStr = getCurrentTimeInfo();
    const recentContext = safeHistory
      .slice(-4)
      .map((m) => `${m.role}: ${m.content}`)
      .join("\n");

    const textEndpoint = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${TEXT_MODEL}`;

    const res = await fetch(textEndpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messages: [
          {
            role: "system",
            content:
              "Convert the user's question (using recent chat context if it's a follow-up) into a JSON array of 2 focused web search queries. Query 1 MUST be clean English (including Bangladesh and current year 2026 when relevant). Query 2 should be a concise query in the user's language if non-English. Output ONLY a JSON array of strings.",
          },
          {
            role: "user",
            content: `Current Date: ${todayStr}\nRecent Context:\n${recentContext || "None"}\n\nCurrent User Message: ${userMessage}`,
          },
        ],
        max_tokens: 130,
        temperature: 0.1,
      }),
    });

    const data = await res.json().catch(() => ({}));
    const raw = data?.result?.response || "";
    const match = raw.match(/\[[\s\S]*\]/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.map((q) => String(q).trim()).filter(Boolean).slice(0, 2);
      }
    }
  } catch (_) {}

  return [userMessage];
}

function isResultRelevant(item, queries, combinedText) {
  const hay = `${item.title || ""} ${item.snippet || ""}`.toLowerCase();
  if (!hay.trim()) return false;

  if (/প্রাণিসম্পদ|livestock/i.test(combinedText)) {
    return /livestock|pranisampad|প্রাণিসম্পদ|মৎস্য ও প্রাণিসম্পদ|পশু|মেলা|fair/i.test(hay);
  }

  const terms = queries
    .join(" ")
    .toLowerCase()
    .split(/[^a-z0-9\u0980-\u09ff]+/)
    .filter((t) => t.length >= 3 && !["2026", "bangladesh", "search", "latest", "news"].includes(t));

  if (terms.length === 0) return true;
  return terms.some((term) => hay.includes(term));
}

async function runSingleTavilySearch(query, apiKey) {
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
        search_depth: "advanced",
        max_results: 5,
        include_answer: true,
        include_raw_content: false,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    if (!res.ok) return { answer: "", results: [] };

    const data = await res.json().catch(() => ({}));
    const results = Array.isArray(data.results)
      ? data.results
          .filter((item) => item && (item.title || item.content))
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

async function performDeepSearch(userMessage, safeHistory, cfToken, accountId, tavilyKey) {
  const queries = await generateSearchQueries(userMessage, safeHistory, cfToken, accountId);
  const searchOutputs = await Promise.all(
    queries.map((q) => runSingleTavilySearch(q, tavilyKey))
  );

  const combinedContextText = `${safeHistory.slice(-3).map((m) => m.content).join(" ")} ${userMessage}`;
  const filteredResults = [];
  const seenUrls = new Set();

  for (const out of searchOutputs) {
    for (const r of out.results) {
      const key = r.url || r.title;
      if (!seenUrls.has(key) && isResultRelevant(r, queries, combinedContextText)) {
        seenUrls.add(key);
        filteredResults.push(r);
      }
    }
  }

  const answers = searchOutputs
    .map((o) => o.answer)
    .filter((a) => a && isResultRelevant({ title: "", snippet: a }, queries, combinedContextText));

  return {
    queries,
    displayQuery: queries[0] || userMessage,
    summary: answers.join(" | "),
    results: filteredResults.slice(0, 5),
  };
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
          temperature: 0.3,
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

    let searchResultsCount = 0;
    let displaySearchQuery = "";
    let searchContext = "";

    if (shouldSearchWeb(cleanMessage, safeHistory)) {
      if (tavilyKey) {
        const deepSearch = await performDeepSearch(
          cleanMessage,
          safeHistory,
          cfToken,
          accountId,
          tavilyKey
        );
        searchResultsCount = deepSearch.results.length;
        displaySearchQuery = deepSearch.displayQuery || cleanMessage;

        if (deepSearch.results.length > 0 || deepSearch.summary) {
          const formattedItems = deepSearch.results
            .map(
              (r, idx) =>
                `${idx + 1}. ${r.title}\nDetails: ${r.snippet}${r.url ? `\nSource: ${r.url}` : ""}`
            )
            .join("\n\n");

          searchContext = `\n\n[Relevant Web Search Results (Queries: ${deepSearch.queries.join(", ")})]\n${
            deepSearch.summary ? `Key Summary: ${deepSearch.summary}\n\n` : ""
          }${formattedItems}\n[End Relevant Web Search Results]`;
        } else {
          searchContext =
            "\n\n[Web Search Status: No directly relevant verified search results found. Do not guess or bring up unrelated topics.]";
        }
      } else {
        searchContext =
          "\n\n[Web Search Status: TAVILY_API_KEY is missing in environment variables. Do not guess live facts.]";
      }
    }

    let userPrompt = cleanMessage;
    if (attachment && attachment.name) {
      userPrompt = cleanMessage
        ? `${cleanMessage}\n[Attached file: ${attachment.name}]`
        : `[Attached file: ${attachment.name}]`;
    }

    const todayStr = getCurrentTimeInfo();
    userPrompt = `[Context Reference - Today's Date: ${todayStr} (Do not state this date unless relevant to the user's question)]\n\nUser Question: ${userPrompt}`;

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
        max_tokens: 1300,
        temperature: 0.2,
      }),
    });

    const data = await response.json().catch(() => ({}));
    const replyText = data?.result?.response;

    if (response.ok && typeof replyText === "string" && replyText.trim()) {
      return res.status(200).json({
        reply: replyText.trim(),
        searched: searchResultsCount > 0,
        searchQuery: displaySearchQuery,
      });
    }

    return res.status(200).json({ reply: fallbackMsg });
  } catch (err) {
    return res.status(200).json({ reply: fallbackMsg });
  }
};
