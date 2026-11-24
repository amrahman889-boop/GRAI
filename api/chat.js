const SYSTEM_PROMPT = `
You are GRAI, a helpful, smart, warm, and natural AI assistant.
Speak naturally like a thoughtful, clear, friendly AI—give only as much detail as needed, keep spelling clean and accurate in the user's language (Bengali, Banglish, English, etc.), and end helpful replies with a natural, relevant follow-up question or suggestion to keep the conversation going.

Identity Rules:
- When asked who you are or who made/developed you (for example: "তুমি কে?", "তোমাকে কে বানাইছে?", "who are you?", "who made you?"), answer naturally using GRAI and GRL without giving full forms unless asked.
- Only when asked what GRAI or GRL means or stands for (for example: "GRAI মানে কি?", "GRL মানে কি?", পূর্ণরূপ), explain naturally in conversation that GRAI-এর পূর্ণরূপ Gamer Rafi Artificial Intelligence এবং GRL-এর পূর্ণরূপ Gamer Rafi Limited.
- Never mention Flint, Recursive, or any other company/creator.

Formatting & Behavior Rules:
- Do not wrap every word or phrase in ** asterisks. Use punctuation like (), [], "", and * naturally only when helpful.
- Never return an empty answer. If an image is attached, inspect it carefully and answer based on what is visible in the image; only say you cannot view the image if the image data is genuinely missing or unsupported.
`.trim();

const MODELS = [
  "meta-llama/llama-3.2-11b-vision-instruct:free",
  "google/gemma-3-27b-it:free",
  "meta-llama/llama-3.3-70b-instruct:free",
  "qwen/qwen-2.5-72b-instruct:free",
  "openrouter/free",
];

function buildUserContent(message, attachment) {
  const cleanMessage = typeof message === "string" ? message.trim() : "";
  const hasImageData =
    attachment &&
    typeof attachment.dataUrl === "string" &&
    attachment.dataUrl.startsWith("data:image/");

  if (hasImageData) {
    const parts = [
      {
        type: "text",
        text:
          cleanMessage ||
          "এই ছবিতে কী দেখা যাচ্ছে বা কী লেখা আছে, তা সহজ ও পরিষ্কারভাবে বলো।",
      },
      {
        type: "image_url",
        image_url: {
          url: attachment.dataUrl,
        },
      },
    ];
    return parts;
  }

  if (attachment && attachment.name) {
    const fileNote = `[Attached ${attachment.kind || "file"}: ${attachment.name}${
      attachment.size ? `, ${Math.round(attachment.size / 1024)} KB` : ""
    }]`;
    return cleanMessage
      ? `${cleanMessage}\n\n${fileNote}`
      : `${fileNote}\nএই ফাইলটি সম্পর্কে কীভাবে সাহায্য করতে পারি?`;
  }

  return cleanMessage;
}

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

    const currentUserContent = buildUserContent(cleanMessage, attachment);
    const hasImage = Array.isArray(currentUserContent);

    const candidateModels = hasImage
      ? MODELS
      : MODELS.filter((m) => !m.includes("vision"));

    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      ...safeHistory,
      { role: "user", content: currentUserContent },
    ];

    let lastError = "সার্ভার থেকে সঠিক উত্তর পাওয়া যায়নি, একটু পর আবার চেষ্টা করুন।";

    for (const model of candidateModels) {
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
            max_tokens: 400,
            temperature: 0.65,
          }),
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          lastError = data?.error?.message || `Model error (${response.status}).`;
          continue;
        }

        const rawReply = data?.choices?.[0]?.message?.content;
        const replyText = typeof rawReply === "string" ? rawReply.trim() : "";

        if (replyText) {
          return res.status(200).json({ reply: replyText });
        }

        lastError = `Empty response from ${model}.`;
      } catch (err) {
        lastError = err?.message || "Network error occurred.";
      }
    }

    return res.status(200).json({
      reply:
        "এই মুহূর্তে ফ্রি সার্ভারগুলো একটু ব্যস্ত থাকায় পুরো উত্তর আনতে পারিনি। একটু পর আবার মেসেজ পাঠালে আমি সাহায্য করতে পারব—আর কী জানতে চাচ্ছেন?",
    });
  } catch (err) {
    console.error("GRAI server error:", err);
    return res.status(500).json({
      error: err?.message || "Failed to generate response from server.",
    });
  }
};
