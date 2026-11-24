const { GoogleGenAI } = require("@google/genai");

const SYSTEM_PROMPT = `
You are GRAI, a helpful, natural AI assistant.
- Your default language is English.
- Respond naturally in whichever language the user uses (English, Bengali, Banglish, Hindi, or any other language) without mentioning language rules unless asked.
- Keep track of all previous messages and replies in the conversation accurately.
`.trim();

const MODELS = ["gemini-3.8-flash", "gemini-3.8-flash-lite", "gemini-flash-latest"];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function generateWithFallback(ai, contents) {
  let lastError;

  for (const model of MODELS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await ai.models.generateContent({
          model,
          contents,
          config: {
            systemInstruction: SYSTEM_PROMPT,
          },
        });
      } catch (err) {
        lastError = err;
        const msg = String(err?.message || "");
        const isBusyOrNotFound =
          msg.includes("503") ||
          msg.includes("UNAVAILABLE") ||
          msg.includes("429") ||
          msg.includes("high demand") ||
          msg.includes("404") ||
          msg.includes("NOT_FOUND");

        if (!isBusyOrNotFound) {
          throw err;
        }

        if (attempt === 0) {
          await sleep(500);
        }
      }
    }
  }

  throw lastError;
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
    const { message, history = [] } = body;

    if (!message || typeof message !== "string" || !message.trim()) {
      return res.status(400).json({ error: "Message is required." });
    }

    const ai = new GoogleGenAI({ apiKey });

    const formattedHistory = Array.isArray(history)
      ? history
          .filter(
            (item) =>
              item &&
              (item.role === "user" || item.role === "assistant") &&
              typeof item.content === "string" &&
              item.content.trim()
          )
          .slice(-30)
          .map((item) => ({
            role: item.role === "assistant" ? "model" : "user",
            parts: [{ text: item.content }],
          }))
      : [];

    const contents = [
      ...formattedHistory,
      {
        role: "user",
        parts: [{ text: message.trim() }],
      },
    ];

    const response = await generateWithFallback(ai, contents);
    const replyText = response?.text?.trim();

    if (!replyText) {
      return res.status(500).json({ error: "Empty response received from GRAI." });
    }

    return res.status(200).json({ reply: replyText });
  } catch (err) {
    console.error("GRAI API error:", err);
    return res.status(500).json({
      error: err?.message || "Failed to generate response from server.",
    });
  }
};
