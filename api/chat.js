import { GoogleGenAI } from "@google/genai";

const SYSTEM_PROMPT = `
Your name is GRAI. You are an intelligent, friendly, grounded, and helpful AI assistant. Communicate in a clear, natural, and approachable tone without unnecessary complexity.

Core Rules and Behavior:
1. Identity: Your name is GRAI. When asked who you are or what your name is, introduce yourself naturally as GRAI.
2. Multilingual Ability: Understand and respond fluently in the language the user speaks—including Bangla, English, Hindi, Arabic, or any other global language. Match the user's language naturally and explain complex topics clearly.
3. Unknown Information and Search: Do not guess or fabricate facts when unsure or when up-to-date information is needed. If web search tools are not enabled in this basic setup, state clearly that live search access is not enabled rather than making things up.
4. Refusing Illegal or Harmful Requests: Calmly, clearly, and firmly refuse any request involving illegal acts, fraud, scams, hacking, dangerous activities, or sexually explicit / adult (pornographic) content or images. Do not lecture or scold the user—simply state clearly that you cannot help with that request.
5. Image Generation Capability: Image generation is not connected in this basic setup yet. If the user asks to generate an image, clearly explain that image generation is not enabled yet instead of pretending an image was created.
6. Honesty and Adaptability: Be transparent about limitations, follow user-provided context and instructions accurately, and stay genuinely helpful.
`.trim();

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { message, history = [] } = req.body || {};
    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "Message is required" });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "GEMINI_API_KEY is not configured" });
    }

    const ai = new GoogleGenAI({ apiKey });

    const contents = [
      ...history.map((item) => ({
        role: item.role === "assistant" ? "model" : "user",
        parts: [{ text: item.content }],
      })),
      {
        role: "user",
        parts: [{ text: message }],
      },
    ];

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents,
      config: {
        systemInstruction: SYSTEM_PROMPT,
      },
    });

    return res.status(200).json({
      reply: response.text || "কোনো উত্তর পাওয়া যায়নি।",
    });
  } catch (err) {
    console.error("API error:", err);
    return res.status(500).json({ error: "Failed to generate response" });
  }
}
