const SYSTEM_PROMPT = `
You are GRAI, a helpful, smart, warm, and natural AI assistant.
Understand and reply in whatever language the user writes in across world languages (such as Bengali, Banglish, English, Hindi, Urdu, Arabic, Spanish, French, Japanese, Korean, German, etc.), keeping spelling clean and natural without forcing only Bengali or English.
If the user writes in Banglish and asks for pure Bengali, reply in clean natural Bengali. Complete every sentence cleanly with proper punctuation (।, ., ?, !) without cutting off mid-word.

Identity Rules:
- When asked who you are or who made/developed you, answer naturally using GRAI and GRL without giving full forms unless asked.
- Only when asked what GRAI or GRL means or stands for, explain naturally that GRAI-এর পূর্ণরূপ Gamer Rafi Artificial Intelligence এবং GRL-এর পূর্ণরূপ Gamer Rafi Limited.
- Never mention Flint, Recursive, or any other creator/company.

Formatting, Vision & Error Rules:
- Do not wrap every word or phrase in ** asterisks. Use punctuation like (), [], "", and * naturally only when helpful.
- You DO have image vision capability. When an image is attached, inspect what is actually in the image carefully and reply directly in the user's language without saying you cannot view images.
- If a technical issue occurs, simply say "Temporary issue" (or "সাময়িক সমস্যা" if the user writes in Bengali) without giving long excuses.
`.trim();

const CF_ACCOUNT_ID = "5d17dd64f2a0e4001e1f608ac4f6676d";
const TEXT_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const VISION_MODEL = "@cf/meta/llama-3.2-11b-vision-instruct";

function looksIncomplete(text) {
  if (!text || typeof text !== "string") return false;
  const trimmed = text.trim();
  if (trimmed.length < 25) return false;
  return !/[।.!?…"'”’)\]]$/.test(trimmed);
}

function extractBase64Image(attachment) {
  if (!attachment || typeof attachment !== "object") return null;

  const raw =
    attachment.dataUrl ||
    attachment.base64 ||
    attachment.url ||
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

async function runTextModel(accountId, apiToken, messages, maxTokens = 1600) {
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${TEXT_MODEL}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messages,
      max_tokens: maxTokens,
      temperature: 0.55,
    }),
  });

  const data = await response.json().catch(() => ({}));
  const text = data?.result?.response;
  if (response.ok && typeof text === "string" && text.trim()) {
    return text.trim();
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const apiToken = (process.env.GEMINI_API_KEY || process.env.CF_API_TOKEN || "").trim();
    const accountId = CF_ACCOUNT_ID.trim();

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

    let userPrompt = cleanMessage;
    if (attachment && attachment.name) {
      userPrompt = cleanMessage
        ? `${cleanMessage}\n\n[Attached file: ${attachment.name}]`
        : `[Attached file: ${attachment.name}] Please help me with this.`;
    }

    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      ...safeHistory,
      { role: "user", content: userPrompt },
    ];

    let replyText = await runTextModel(accountId, apiToken, messages, 1600);

    if (!replyText) {
      return res.status(200).json({
        reply: "সাময়িক সমস্যা",
      });
    }

    if (looksIncomplete(replyText)) {
      const tail = replyText.slice(-140);
      const continueMessages = [
        ...messages,
        { role: "assistant", content: replyText },
        {
          role: "user",
          content: `Your reply stopped right after "${tail}". Continue directly from there and finish the final sentence cleanly without repeating anything.`,
        },
      ];
      const extra = await runTextModel(accountId, apiToken, continueMessages, 800);
      if (extra) {
        const needsSpace = !/\s$/.test(replyText) && !/^[।.!?,\s]/.test(extra);
        replyText = `${replyText}${needsSpace ? " " : ""}${extra}`;
      }
    }

    return res.status(200).json({ reply: replyText.trim() });
  } catch (err) {
    return res.status(200).json({
      reply: "সাময়িক সমস্যা",
    });
  }
};
