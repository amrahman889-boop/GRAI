const SYSTEM_PROMPT = `
You are GRAI, a helpful, smart, warm, and natural AI assistant.
Speak in a clear, natural, friendly AI assistant tone—give as much explanation as needed without overdoing it, keep spelling clean and accurate, and end helpful replies with one natural follow-up question or suggestion to keep the conversation going.

Language Rules:
- Your default language is English.
- You understand and can respond naturally in English, Bengali, Banglish, Hindi, or any other language the user uses.

Identity Rules:
- When asked who you are or who made/developed you, answer naturally using GRAI and GRL without giving full forms unless asked.
- Only when asked what GRAI or GRL means or stands for, state naturally that GRAI-এর পূর্ণরূপ Gamer Rafi Artificial Intelligence এবং GRL-এর পূর্ণরূপ Gamer Rafi Limited.
- Never mention Flint, Recursive, or any other creator/company.

Formatting & Error Rules:
- Do not wrap every word or phrase in ** asterisks. Use punctuation like (), [], "", and * naturally only when helpful.
- If an image is attached, inspect it carefully and answer based on what is actually in the image.
- If you face a technical issue or cannot process something, do not give long excuses or self-explanations on your own; simply say "সাময়িক সমস্যা" (or "Temporary issue" if the conversation is in English).
`.trim();

const GEMINI_MODELS = [
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.0-flash",
];

function parseDataUrl(dataUrl) {
  if (typeof dataUrl !== "string") return null;
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) return null;
  return {
    mimeType: match[1],
    data: match[2],
  };
}

function buildContents(history, message, attachment) {
  const contents = [];

  if (Array.isArray(history)) {
    for (const item of history.slice(-14)) {
      if (!item || typeof item.content !== "string" || !item.content.trim()) continue;
      const role = item.role === "assistant" ? "model" : "user";
      contents.push({
        role,
        parts: [{ text: item.content.trim() }],
      });
    }
  }

  const userParts = [];
  const parsedImage = attachment ? parseDataUrl(attachment.dataUrl) : null;

  if (parsedImage) {
    userParts.push({
      inlineData: {
        mimeType: parsedImage.mimeType,
        data: parsedImage.data,
      },
    });
  }

  const cleanMessage = typeof message === "string" ? message.trim() : "";
  if (cleanMessage) {
    userParts.push({ text: cleanMessage });
  } else if (parsedImage) {
    userParts.push({
      text: "What is shown or written in this image? Explain clearly and concisely.",
    });
  } else if (attachment && attachment.name) {
    userParts.push({
      text: `Attached file: ${attachment.name}${
        attachment.size ? ` (${Math.round(attachment.size / 1024)} KB)` : ""
      }. Please help with this.`,
    });
  }

  contents.push({
    role: "user",
    parts: userParts,
  });

  return contents;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "GEMINI_API_KEY is missing in Vercel Environment Variables." });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const { message = "", history = [], attachment = null } = body;

    const cleanMessage = typeof message === "string" ? message.trim() : "";
    if (!cleanMessage && !attachment) {
      return res.status(400).json({ error: "Message or attachment is required." });
    }

    const contents = buildContents(history, cleanMessage, attachment);

    for (const model of GEMINI_MODELS) {
      try {
        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(
          apiKey
        )}`;

        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            systemInstruction: {
              parts: [{ text: SYSTEM_PROMPT }],
            },
            contents,
            generationConfig: {
              temperature: 0.5,
              maxOutputTokens: 600,
            },
          }),
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          continue;
        }

        const parts = data?.candidates?.[0]?.content?.parts || [];
        const replyText = parts
          .map((p) => (typeof p?.text === "string" ? p.text : ""))
          .join("")
          .trim();

        if (replyText) {
          return res.status(200).json({ reply: replyText });
        }
      } catch {
        // Try next fallback model
      }
    }

    const wantsEnglish = /[a-zA-Z]/.test(cleanMessage) && !/[\u0980-\u09FF]/.test(cleanMessage);
    return res.status(200).json({
      reply: wantsEnglish ? "Temporary issue" : "সাময়িক সমস্যা",
    });
  } catch {
    return res.status(200).json({ reply: "সাময়িক সমস্যা" });
  }
};
