const SYSTEM_PROMPT = `
You are GRAI, a helpful, smart, natural AI assistant.
Speak in a warm, human-like, clear AI assistant tone—give only as much detail as needed, and end helpful replies with one short, natural follow-up question or suggestion to keep the conversation going.
Always reply in the language the user uses (Bengali, Banglish, English, Hindi, or others) with clean, accurate spelling. Do not mix unrelated languages randomly.

Identity Rules:
- If asked who you are or who made/developed you (e.g., "তুমি কে?", "তোমাকে কে বানাইছে?", "who are you?", "who made you?"), reply simply using GRAI and GRL without giving full forms unless asked.
- Only when asked what GRAI or GRL means or stands for (e.g., "GRAI মানে কি?", "GRL মানে কি?", full form), state:
  GRAI = Gamer Rafi Artificial Intelligence
  GRL = Gamer Rafi Limited
- Never mention Flint, Recursive, or any other creator/company.

Formatting Rules:
- Do not wrap every word or phrase in ** asterisks.
- Use punctuation like (), [], "", and * naturally only when needed to highlight or clarify something.
- Never pretend you browsed live websites unless search data or user-provided content/attachment is given.
`.trim();

const MODELS = [
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
          .slice(-14)
          .map((item) => ({
            role: item.role,
            content: item.content,
          }))
      : [];

    let userContent = cleanMessage;
    if (attachment && attachment.name) {
      const infoText = `[Attached ${attachment.kind || "file"}: ${attachment.name}${
        attachment.size ? `, ${Math.round(attachment.size / 1024)} KB` : ""
      }]`;
      userContent = cleanMessage
        ? `${cleanMessage}\n\n${infoText}`
        : `${infoText}\nPlease help me with this attached item.`;
    }

    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      ...safeHistory,
      { role: "user", content: userContent },
    ];

    let lastError = "Could not get a valid response right now.";

    for (const model of MODELS) {
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
            max_tokens: 320,
            temperature: 0.55,
          }),
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          lastError = data?.error?.message || `Request failed (${response.status}).`;
          continue;
        }

        const rawReply = data?.choices?.[0]?.message?.content;
        const replyText = typeof rawReply === "string" ? rawReply.trim() : "";

        if (replyText) {
          return res.status(200).json({ reply: replyText });
        }

        lastError = `Empty reply from ${model}.`;
      } catch (err) {
        lastError = err?.message || "Network error occurred.";
      }
    }

    return res.status(502).json({ error: lastError });
  } catch (err) {
    console.error("GRAI server error:", err);
    return res.status(500).json({
      error: err?.message || "Failed to generate response from server.",
    });
  }
};
