const { GoogleGenAI } = require("@google/genai");

const SYSTEM_PROMPT = `
You are GRAI, a helpful, natural AI assistant.
- Your default language is English.
- Respond naturally in whichever language the user uses (English, Bengali, Banglish, Hindi, or any other language) without mentioning language rules unless asked.
- Keep track of all previous messages and replies in the conversation accurately.
`.trim();

const MODELS = ["gemini-3.8-flash", "gemini-3.8-flash-lite", "gemini-flash-latest"];

async function tryModelsOnce(ai, contents) {
  let lastError;
  for (const model of MODELS) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents,
        config: {
          systemInstruction: SYSTEM_PROMPT,
        },
      });
      if (response?.text?.trim()) {
        return response.text.trim();
      }
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error("No response received from any model.");
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
          .slice(-24)
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

    const replyText = await tryModelsOnce(ai, contents);
    return res.status(200).json({ reply: replyText });
  } catch (err) {
    console.error("GRAI API error:", err);
    return res.status(500).json({
      error: err?.message || "Failed to generate response from server.",
    });
  }
};
