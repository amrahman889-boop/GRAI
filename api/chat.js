const SYSTEM_PROMPT = `
You are GRAI, a helpful, smart, warm, and natural AI assistant.
Understand and reply in whatever language the user writes in across world languages (such as Bengali, Banglish, English, Hindi, Urdu, Arabic, Spanish, French, Japanese, Korean, German, etc.), keeping spelling clean and natural without forcing only Bengali or English.
If the user writes in Banglish and asks for pure Bengali, reply in clean natural Bengali. Complete every sentence cleanly without cutting off mid-word.

Identity Rules:
- When asked who you are or who made/developed you, answer naturally using GRAI and GRL without giving full forms unless asked.
- Only when asked what GRAI or GRL means or stands for, explain naturally that GRAI-এর পূর্ণরূপ Gamer Rafi Artificial Intelligence এবং GRL-এর পূর্ণরূপ Gamer Rafi Limited.
- Never mention Flint, Recursive, or any other creator/company.

Formatting, Vision & Error Rules:
- Do not wrap every word or phrase in ** asterisks. Use punctuation like (), [], "", and * naturally only when helpful.
- You DO have image vision capability. When an image is attached, inspect what is actually in the image carefully and reply directly in the user's language without saying you cannot view images.
- If a technical issue occurs, simply say "Temporary issue" (or "সাময়িক সমস্যা" if the user writes in Bengali) without giving long excuses.
`.trim();

const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID || "e6c66fe73c44eca9e77db3de2cc6e6ad";
const TEXT_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const VISION_MODEL = "@cf/meta/llama-3.2-11b-vision-instruct";

function extractImageInfo(attachment) {
  if (!attachment) return null;

  if (typeof attachment === "string") {
    attachment = { dataUrl: attachment };
  }

  if (typeof attachment !== "object") return null;

  const candidates = [
    attachment.dataUrl,
    attachment.base64,
    attachment.image,
    attachment.preview,
    attachment.url,
    attachment.src,
    attachment.content,
  ];

  for (const raw of candidates) {
    if (typeof raw !== "string" || !raw.trim()) continue;

    const match = raw.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
    if (match) {
      const cleanBase64 = match[2].replace(/\s+/g, "");
      if (cleanBase64.length > 50) {
        return {
          mimeType: match[1].toLowerCase(),
          base64: cleanBase64,
        };
      }
    }

    const cleaned = raw.replace(/\s+/g, "");
    if (/^[A-Za-z0-9+/=]+$/.test(cleaned) && cleaned.length > 100) {
      return {
        mimeType:
          typeof attachment.type === "string" && attachment.type.startsWith("image/")
            ? attachment.type
            : "image/jpeg",
        base64: cleaned,
      };
    }
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
        reply: "Temporary issue",
      });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const { message = "", history = [], attachment = null } = body;

    const cleanMessage = typeof message === "string" ? message.trim() : "";
    const imageInfo = extractImageInfo(attachment);

    if (!cleanMessage && !imageInfo) {
      return res.status(200).json({
        reply: "Temporary issue",
      });
    }

    if (imageInfo) {
      const visionEndpoint = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${VISION_MODEL}`;
      const imageBytes = Array.from(Buffer.from(imageInfo.base64, "base64"));

      const promptText = cleanMessage
        ? `${cleanMessage}\nRespond clearly in the user's language.`
        : "Look carefully at what is shown or written in this image and describe it clearly in natural Bengali (or matching text in the image).";

      const visionRes = await fetch(visionEndpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt: promptText,
          image: imageBytes,
          max_tokens: 1024,
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
        reply: "Temporary issue",
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
          .slice(-8)
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
        temperature: 0.55,
      }),
    });

    const data = await response.json().catch(() => ({}));
    const replyText = data?.result?.response;

    if (response.ok && typeof replyText === "string" && replyText.trim()) {
      return res.status(200).json({ reply: replyText.trim() });
    }

    return res.status(200).json({
      reply: "Temporary issue",
    });
  } catch (err) {
    return res.status(200).json({
      reply: "Temporary issue",
    });
  }
};
