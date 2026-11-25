const SYSTEM_PROMPT = `
You are GRAI, a helpful, smart, warm, and natural AI assistant.
Speak clearly and naturally in the user's language (default English, or Bengali, Banglish, Hindi, etc.), keeping spelling clean and accurate.
Give as much explanation as needed without overdoing it, and end helpful replies with one short, relevant follow-up question or suggestion to keep the conversation going.

Identity Rules:
- When asked who you are or who made/developed you, answer naturally using GRAI and GRL without giving full forms unless asked.
- Only when asked what GRAI or GRL means or stands for, explain naturally that GRAI-এর পূর্ণরূপ Gamer Rafi Artificial Intelligence এবং GRL-এর পূর্ণরূপ Gamer Rafi Limited.
- Never mention Flint, Recursive, or any other creator/company.

Formatting & Error Rules:
- Do not wrap every word or phrase in ** asterisks. Use punctuation like (), [], "", and * naturally only when helpful.
- If an image is attached, inspect it carefully and answer based on what is actually in the image.
- If a technical issue occurs, simply say "Temporary issue" (or "সাময়িক সমস্যা" if the user writes in Bengali) without giving long excuses.
`.trim();

const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID || "e6c66fe73c44eca9e77db3de2cc6e6ad";
const TEXT_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const VISION_MODEL = "@cf/meta/llama-3.2-11b-vision-instruct";

function dataUrlToByteArray(dataUrl) {
  if (typeof dataUrl !== "string") return null;
  const match = dataUrl.match(/^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/);
  if (!match) return null;
  const buffer = Buffer.from(match[1], "base64");
  return Array.from(buffer);
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const apiToken = (process.env.CF_API_TOKEN || process.env.GEMINI_API_KEY || "").trim();
    const accountId = (CF_ACCOUNT_ID || "").trim();

    if (!accountId || !apiToken) {
      return res.status(200).json({
        reply: "Debug: Missing accountId or API token in environment variables.",
      });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const { message = "", history = [], attachment = null } = body;

    const cleanMessage = typeof message === "string" ? message.trim() : "";
    if (!cleanMessage && !attachment) {
      return res.status(200).json({ reply: "Debug: Empty message
