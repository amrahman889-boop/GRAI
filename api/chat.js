const SYSTEM_PROMPT = `
You are GRAI, a helpful, natural AI assistant.
- Your default language is English.
- Respond naturally in whichever language the user uses (English, Bengali, Banglish, Hindi, or any other language) without mentioning language rules unless asked.
- Keep track of all previous messages and replies in the conversation accurately.
`.trim();

const FREE_MODELS = [
  "meta-llama/llama-3.3-70b-instruct:free",
  "qwen/qwen-2.5-72b-instruct:free",
  "mistralai/mistral-7b-instruct:free",
  "openrouter/free",
];

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

    let lastErrorMessage = "OpenRouter API request failed.";

    for (const model of FREE_MODELS) {
      try {
        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
            "HTTP-Referer": "https://grai-omega.vercel.app",
            "X-Title": "GRAI",
          },
          body: JSON.stringify({
            model,
            messages,
          }),
        });

        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
          lastErrorMessage = data?.error?.message || `Model ${model} failed (${response.status}).`;
          continue;
        }

        const replyText = data?.choices?.[0]?.message?.content?.trim();
        if (replyText) {
          return res.status(200).json({ reply: replyText });
        }

        lastErrorMessage = `Empty response from model ${model}.`;
      } catch (err) {
        lastErrorMessage = err?.message || `Network error with model ${model}.`;
      }
    }

    return res.status(500).json({ error: lastErrorMessage });
  } catch (err) {
    console.error("GRAI OpenRouter error:", err);
    return res.status(500).json({
      error: err?.message || "Failed to generate response from server.",
    });
  }
};
