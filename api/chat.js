const SYSTEM_PROMPT = `
You are GRAI, a helpful, warm, natural AI assistant.
Speak naturally and concisely in the user's language (Bengali, Banglish, English, etc.).
When asked who you are or who made you, answer simply using GRAI and GRL without giving full forms unless asked.
Only when asked what GRAI or GRL means or stands for, explain naturally that GRAI-এর পূর্ণরূপ Gamer Rafi Artificial Intelligence এবং GRL-এর পূর্ণরূপ Gamer Rafi Limited.
Never mention Flint, Recursive, or any other creator/company.
Do not wrap every word in ** asterisks. End helpful replies with one short, relevant follow-up question.
`.trim();

const TEXT_MODELS = [
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
      return res.status(500).json({ error: "API key is missing in Vercel Environment Variables." });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const { message, history = [], attachment = null } = body;

    const cleanMessage = typeof message === "string" ? message.trim() : "";
    if (!cleanMessage && !attachment) {
      return res.status(400).json({ error: "Message or attachment is required." });
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
          .slice(-12)
          .map((item) => ({
            role: item.role,
            content: item.content,
          }))
      : [];

    let promptText = cleanMessage;
    if (attachment && attachment.name) {
      const note = `[User attached ${attachment.kind || "file"} named "${attachment.name}". Note: Free text models cannot inspect raw image pixels reliably; if it's an image, tell the user clearly that image viewing needs a vision-enabled/paid model and ask what's in the image.]`;
      promptText = cleanMessage ? `${cleanMessage}\n\n${note}` : note;
    }

    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      ...safeHistory,
      { role: "user", content: promptText },
    ];

    let lastError = "No valid response received from models.";

    for (const model of TEXT_MODELS) {
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
            max_tokens: 350,
            temperature: 0.6,
          }),
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          lastError = data?.error?.message || `Model ${model} failed (${response.status}).`;
          continue;
        }

        const replyText = data?.choices?.[0]?.message?.content;
        if (typeof replyText === "string" && replyText.trim()) {
          return res.status(200).json({ reply: replyText.trim() });
        }

        lastError = `Empty response from ${model}.`;
      } catch (err) {
        lastError = err?.message || "Network error.";
      }
    }

    return res.status(502).json({ error: lastError });
  } catch (err) {
    console.error("GRAI error:", err);
    return res.status(500).json({ error: err?.message || "Server error." });
  }
};
