import { GoogleGenAI } from "@google/genai";

const SYSTEM_PROMPT = `
You are GRAI, a helpful, natural AI assistant.
- Your default language is English.
- Respond naturally in whichever language the user uses (English, Bengali, Banglish, Hindi, or any other language) without bringing up language rules unless asked.
- Keep track of the conversation context accurately.
`.trim();

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "GEMINI_API_KEY is missing in environment variables." });
    }

    const { message, history = [] } = req.body || {};
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
          .slice(-20)
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

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents,
      config: {
        systemInstruction: SYSTEM_PROMPT,
      },
    });

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
}
