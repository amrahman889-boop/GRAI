const SYSTEM_PROMPT = `
You are GRAI, a smart, natural, helpful, and accurate AI assistant under GRL.
Your default and system language is English. Always default to clear, natural English unless the user writes in another language (such as Bengali, Banglish, Hindi, Arabic, Spanish, French, etc.) or asks for another language, in which case reply naturally in that language.

Conversation & Memory Rules:
- Always pay close attention to the entire recent conversation so short follow-ups (like "সার্চ করে দেখো", "এখানে প্রুফ রিডার নাই?", "করো") use the exact previous context naturally.
- If the conversation just started with a short greeting or call like "ওই", "hey", or "hi", respond naturally and casually without talking about memory or chat history.
- Sound human, warm, and natural—never stiff, robotic, preachy, or overly formal.
- Keep responses focused on what the user actually asked; do not pad answers with unrelated tangents (for example, when asked if a specific post/role exists in an office, answer directly from search/context without lecturing about unrelated freelance/book rates unless asked).
- Keep casual chat, feelings, and playful banter concise and natural without repeating robotic disclaimers.
- In urgent health or safety situations (such as severe chest pain radiating to the arm, neck, or jaw), be calm, clear, and structured: highlight immediate emergency care (such as calling emergency services / 999 in Bangladesh or going to the nearest emergency department) right away rather than vague guessing.
- Do NOT force a question at the end of every message; add a short, natural follow-up only when it genuinely fits.

Fact, Uncertainty & Search Rules:
- Whenever a question involves real-world facts, current/recent events, numbers/helplines, organizations/departments, specific roles/posts, places/hospitals, laws/rules, websites, or anything you are not 100% certain about, rely on the provided live web search results rather than guessing from memory.
- Never invent or guess phone numbers, helpline purposes, addresses, dates, prices, official posts, or facts not supported by the search results or verified knowledge. If search results do not clearly confirm something, say so plainly and briefly without making up details.

Identity & Formatting Rules:
- Name: GRAI; under GRL. Mention GRL/GRAI naturally only when asked who you are or who made you.
- Only when asked what GRAI or GRL means or stands for, state that GRAI stands for Gamer Rafi Artificial Intelligence and GRL stands for Gamer Rafi Limited.
- Never mention Flint, Recursive, or any other company.
- Do not wrap every word or phrase in ** asterisks; use bolding only selectively when helpful.
- Use clean, standard Bengali spelling and clear punctuation when replying in Bengali.
- You have vision capability. When an image is attached, inspect it carefully and answer directly in the user's language (defaulting to English).
- If a technical issue occurs, say "Temporary issue" by default (or "সাময়িক সমস্যা" only when the user writes in Bengali) briefly.
`.trim();

const PRIMARY_ACCOUNT_ID = (
  process.env.CF_ACCOUNT_ID || "5d17dd64f2a0e4001e1f608ac4f6676d"
).trim();
const SECONDARY_ACCOUNT_ID = (
  process.env.CF_ACCOUNT_ID_2 || "f39e832eb036785cac96dfdd98f271fb"
).trim();

const TEXT_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const VISION_MODEL = "@cf/meta/llama-3.2-11b-vision-instruct";

function getCredentialsList() {
  const primaryToken = (
    process.env.GEMINI_API_KEY ||
    process.env.CF_API_TOKEN ||
    ""
  ).trim();
  const secondaryToken = (
    process.env.CF_API_TOKEN_2 ||
    process.env.CF_API_TOKEN_SECOND ||
    primaryToken
  ).trim();
  const thirdToken = (process.env.CF_API_TOKEN_3 || "").trim();

  const pairs = [];
  if (PRIMARY_ACCOUNT_ID && primaryToken) {
    pairs.push({ accountId: PRIMARY_ACCOUNT_ID, token: primaryToken });
  }
  if (SECONDARY_ACCOUNT_ID && secondaryToken) {
    pairs.push({ accountId: SECONDARY_ACCOUNT_ID, token: secondaryToken });
  }
  if (PRIMARY_ACCOUNT_ID && secondaryToken && secondaryToken !== primaryToken) {
    pairs.push({ accountId: PRIMARY_ACCOUNT_ID, token: secondaryToken });
  }
  if (SECONDARY_ACCOUNT_ID && thirdToken) {
    pairs.push({ accountId: SECONDARY_ACCOUNT_ID, token: thirdToken });
  } else if (PRIMARY_ACCOUNT_ID && thirdToken) {
    pairs.push({ accountId: PRIMARY_ACCOUNT_ID, token: thirdToken });
  }

  const unique = [];
  const seen = new Set();
  for (const item of pairs) {
    const key = `${item.accountId}::${item.token}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(item);
    }
  }
  return unique;
}

async function runCloudflareModelWithFallback(modelName, payload, credentials) {
  for (const cred of credentials) {
    try {
      const endpoint = `https://api.cloudflare.com/client/v4/accounts/${cred.accountId}/ai/run/${modelName}`;
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${cred.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({}));
      const textOut =
        data?.result?.response ||
        data?.result?.description ||
        data?.result?.output_text;

      if (res.ok && typeof textOut === "string" && textOut.trim()) {
        return { text: textOut.trim(), cred };
      }
    } catch (_) {
      // পরের ক্রেডেনশিয়াল দিয়ে চেষ্টা করবে
    }
  }
  return null;
}

function getFallbackErrorText(text = "") {
  return /[\u0980-\u09FF]/.test(text) ? "সাময়িক সমস্যা" : "Temporary issue";
}

function getCurrentTimeInfo() {
  try {
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
      }).format(new Date()) + " (Asia/Dhaka)"
    );
  } catch (_) {
    return new Date().toISOString();
  }
}

function isPureCasualOrGreeting(query = "", history = []) {
  const q = query.trim().toLowerCase();
  if (!q) return true;

  const onlyGreetingOrEmoji =
    /^(hi|hello|hey|oi|salam|assalamu alaikum|good morning|good afternoon|good evening|kemon acho|ki khobor|valo acho|thanks|thank you|dhonnobad|ok|okay|hmm|হাই|হ্যালো|ওই|সালাম|কেমন আছেন|ধন্যবাদ|ভালো লাগতেছে না|মন খারাপ|চলো মজা করি|চলো ফান করি|জোকস)[\s!.?]*$/i;
  if (onlyGreetingOrEmoji.test(q)) return true;

  const hasTopicInHistory =
    Array.isArray(history) &&
    history.some(
      (m) =>
        m &&
        m.role === "user" &&
        typeof m.content === "string" &&
        m.content.trim().length > 8 &&
        !onlyGreetingOrEmoji.test(m.content.trim().toLowerCase())
    );

  if (!hasTopicInHistory && q.length < 4) return true;

  return false;
}

function shouldSearchWeb(query = "", history = []) {
  const q = query.trim();
  if (!q) return false;
  if (isPureCasualOrGreeting(q, history)) return false;

  const hasNumber = /\d{2,}/.test(q);
  const hasQuestionOrLookup =
    /[?？]|(search|news|latest|current|today|update|price|score|schedule|event|fair|mela|office|department|post|role|officer|proof|hospital|clinic|near|nearest|website|address|location|who|what|when|where|which|how|কবে|কখন|কোথায়|কী|কি|কিসের|খবর|তথ্য|মেলা|দপ্তর|অফিস|পদ|কর্মকর্তা|প্রুফ|রিডার|হসপিটাল|হাসপাতাল|নিকটস্থ|কাছাকাছি|সার্চ|দাম|ওয়েবসাইট|ঠিকানা|লোকেশন|কেন|কীভাবে|নাই|আছে)/i.test(
      q
    );

  const hasHistory = Array.isArray(history) && history.length > 0;
  return hasNumber || hasQuestionOrLookup || hasHistory || q.length >= 10;
}

async function generateSearchQueries(userMessage, safeHistory, credentials) {
  try {
    const todayStr = getCurrentTimeInfo();
    const recentContext = safeHistory
      .slice(-6)
      .map((m) => `${m.role}: ${m.content}`)
      .join("\n");

    const out = await runCloudflareModelWithFallback(
      TEXT_MODEL,
      {
        messages: [
          {
            role: "system",
            content:
              "You generate web search queries to find verified, accurate information. Combine the current user message with relevant facts from Recent Context (such as numbers like 16263, organizations like মৎস্য ও প্রাণিসম্পদ তথ্য দপ্তর / FLID, posts like প্রুফ রিডার, places like Dhanmondi 5, or topics) when needed. Output ONLY a JSON array of 2 concise search queries: Query 1 MUST be clean English (with Bangladesh/Dhaka and 2026 when relevant), and Query 2 in Bengali if the user wrote in Bengali (or another clean English query). Output ONLY valid JSON array of 2 strings.",
          },
          {
            role: "user",
            content: `Current Date: ${todayStr}\nRecent Context:\n${recentContext || "None"}\n\nCurrent User Message: ${userMessage}`,
          },
        ],
        max_tokens: 150,
        temperature: 0.1,
      },
      credentials
    );

    const raw = out?.text || "";
    const match = raw.match(/\[[\s\S]*\]/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.map((q) => String(q).trim()).filter(Boolean).slice(0, 2);
      }
    }
  } catch (_) {}

  const lastUserMsg = [...safeHistory].reverse().find((m) => m.role === "user")?.content || "";
  return [lastUserMsg ? `${lastUserMsg} ${userMessage}`.trim() : userMessage];
}

async function runSingleTavilySearch(query, apiKey) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

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

async function performDeepSearch(userMessage, safeHistory, credentials, tavilyKey) {
  const queries = await generateSearchQueries(userMessage, safeHistory, credentials);
  const searchOutputs = await Promise.all(
    queries.map((q) => runSingleTavilySearch(q, tavilyKey))
  );

  const answers = [];
  const allResults = [];
  const seenUrls = new Set();

  for (const out of searchOutputs) {
    if (out.answer) answers.push(out.answer);
    for (const r of out.results) {
      const key = r.url || r.title;
      if (!seenUrls.has(key)) {
        seenUrls.add(key);
        allResults.push(r);
      }
    }
  }

  return {
    queries,
    displayQuery: queries[0] || userMessage,
    summary: answers.join(" | "),
    results: allResults.slice(0, 6),
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
    const credentials = getCredentialsList();
    const tavilyKey = (process.env.TAVILY_API_KEY || "").trim();

    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
    const { message = "", history = [], attachment = null } = body;

    const cleanMessage = typeof message === "string" ? message.trim() : "";
    fallbackMsg = getFallbackErrorText(cleanMessage);

    const parsedImage = extractBase64Image(attachment);

    if (credentials.length === 0) {
      return res.status(200).json({ reply: fallbackMsg });
    }

    if (!cleanMessage && !parsedImage) {
      return res.status(200).json({ reply: fallbackMsg });
    }

    if (parsedImage) {
      const imageBytes = Array.from(Buffer.from(parsedImage.base64, "base64"));
      const userInstruction = cleanMessage
        ? `${cleanMessage}\nReply concisely and naturally in the user's language (defaulting to English).`
        : "Describe what is clearly shown or written in this image concisely and naturally in English (default language).";

      const visionOut = await runCloudflareModelWithFallback(
        VISION_MODEL,
        {
          prompt: userInstruction,
          image: imageBytes,
          max_tokens: 900,
          temperature: 0.35,
        },
        credentials
      );

      if (visionOut?.text) {
        return res.status(200).json({ reply: visionOut.text });
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
          credentials,
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

          searchContext = `\n\n[Web Search Results for "${cleanMessage}" (Queries: ${deepSearch.queries.join(", ")})]\n${
            deepSearch.summary ? `Summary: ${deepSearch.summary}\n\n` : ""
          }${formattedItems}\n[End Web Search Results]`;
        } else {
          searchContext =
            "\n\n[Web Search Status: No search results returned for this query. Do not guess or invent facts.]";
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

    const chatOut = await runCloudflareModelWithFallback(
      TEXT_MODEL,
      {
        messages,
        max_tokens: 1200,
        temperature: 0.3,
      },
      credentials
    );

    if (chatOut?.text) {
      return res.status(200).json({
        reply: chatOut.text,
        searched: searchResultsCount > 0,
        searchQuery: displaySearchQuery,
      });
    }

    return res.status(200).json({ reply: fallbackMsg });
  } catch (err) {
    return res.status(200).json({ reply: fallbackMsg });
  }
};
