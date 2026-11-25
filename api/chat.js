const SYSTEM_PROMPT = `
You are GRAI, a helpful, smart, warm, and natural AI assistant.
Speak clearly and naturally in the user's language (default English, or Bengali, Banglish, Hindi, etc.), keeping spelling clean and accurate.
Give as much explanation as needed without overdoing it, and end helpful replies with one short, relevant follow-up question or suggestion to keep the conversation going.

Identity Rules:
- When asked who you are or who made/developed you, answer naturally using GRAI and GRL without giving full forms unless asked.
- Only when asked what GRAI or GRL means or stands for, explain naturally that GRAI-এর পূর্ণরূপ Gamer Rafi Artificial Intelligence এবং GRL-এর পূর্ণরূপ Gamer Rafi Limited.
- Never mention Flint, Recursive, or any other creator/company.

Formatting & Error Rules:
- Do not wrap every word or phrase in ** asterisks. Use punctuation like (), [], "", and * naturally only when helpful.
- If an image is attached, inspect it carefully and answer based on what is actually in the image.
- If a technical issue occurs, simply say "Temporary issue" (or "সাময়িক সমস্যা" if the user writes in Bengali) without giving long excuses.
`.trim();

const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID || "e6c66fe73c44eca9e77db3de2cc6e6ad";
const TEXT_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const VISION_MODEL = "@cf/meta/llama-3.2-11b-vision-instruct";

function dataUrlToByteArray(dataUrl) {
  if (typeof dataUrl !== "string") return null;
  const match = dataUrl.match(/^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/);
  if (!match) return null;
  const buffer = Buffer.from(match[1], "base64");
  return Array.from(buffer);
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
        reply: "Debug: Missing accountId or API token in environment variables.",
      });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const { message = "", history = [], attachment = null } = body;

    const cleanMessage = typeof message === "string" ? message.trim() : "";
    if (!cleanMessage && !attachment) {
      return res.status(200).json({
        reply: "Debug: Empty message and no attachment.",
      });
    }

    const imageBytes = attachment ? dataUrlToByteArray(attachment.dataUrl) : null;

    if (imageBytes) {
      const visionEndpoint = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${VISION_MODEL}`;
      const promptForImage =
        cleanMessage || "Describe clearly what is shown or written in this image.";

      const visionRes = await fetch(visionEndpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt: `${SYSTEM_PROMPT}\n\nUser request: ${promptForImage}`,
          image: imageBytes,
          max_tokens: 450,
        }),
      });

      const visionData = await visionRes.json().catch(() => ({}));
      const visionReply = visionData?.result?.response;

      if (visionRes.ok && typeof visionReply === "string" && visionReply.trim()) {
        return res.status(200).json({ reply: visionReply.trim() });
      }

      const vErr =
        visionData?.errors?.[0]?.message ||
        visionData?.error ||
        `HTTP ${visionRes.status}`;
      return res.status(200).json({
        reply: `Debug Vision: ${vErr}`,
      });
    }

    const safeHistory = Array.isArray(history)
      ? history
          .filter(
            (item) =>
              item &&
              (item.role === "user" || item.role === "assistant") &&
              typeof item.content === "string" &&
              item.content.trim() &&
              !item.content.trim().startsWith("Debug")
          )
          .slice(-12)
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
        max_tokens: 500,
        temperature: 0.55,
      }),
    });

    const data = await response.json().catch(() => ({}));
    const replyText = data?.result?.response;

    if (response.ok && typeof replyText === "string" && replyText.trim()) {
      return res.status(200).json({ reply: replyText.trim() });
    }

    const apiErr =
      data?.errors?.[0]?.message ||
      data?.error ||
      `HTTP ${response.status}`;

    return res.status(200).json({
      reply: `Debug: ${apiErr}`,
    });
  } catch (err) {
    return res.status(200).json({
      reply: `Debug Catch: ${err?.message || "Unknown error"}`,
    });
  }
};
