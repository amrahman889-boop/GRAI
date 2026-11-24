const SYSTEM_PROMPT = `
You are GRAI, a helpful, natural AI assistant.
- Your default language is English.
- Respond naturally in whichever language the user uses (English, Bengali, Banglish, Hindi, or any other language) without mentioning language rules unless asked.
- Keep track of all previous messages and replies in the conversation accurately.
`.trim();

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

    const safeHistory = Array.isArray(history)
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
            role: item.role,
            content: item.content,
          }))
      : [];

    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      ...safeHistory,
      { role: "user", content: message.trim() },
    ];

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: data?.error?.message || "OpenAI API request failed.",
      });
    }

    const replyText = data?.choices?.[0]?.message?.content?.trim();
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
