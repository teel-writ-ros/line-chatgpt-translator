// /api/callback.js
import { Configuration, OpenAIApi } from "openai";
import fetch from "node-fetch";

const config = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(config);

// Temporary in-memory user language preferences
let groupUserLanguages = {};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).send("Method Not Allowed");
    return;
  }

  const events = req.body.events || [];

  for (const event of events) {
    if (event.type === "message" && event.message.type === "text") {
      const userMessage = event.message.text.trim();
      const userId = event.source.userId;
      const groupId = event.source.groupId;
      const replyToken = event.replyToken;

      if (!groupId || !userId) continue;

      if (!groupUserLanguages[groupId]) {
        groupUserLanguages[groupId] = {};
      }

      // User is declaring their language(s)
      if (userMessage.toLowerCase().includes("language") || userMessage.includes(",")) {
        const languages = userMessage
          .replace(/language[s]?:?/i, "")
          .split(",")
          .map((lang) => lang.trim());

        groupUserLanguages[groupId][userId] = languages;
        await replyToLine(replyToken, `Got it! You understand: ${languages.join(", ")}`);
        continue;
      }

      // Detect message language
      const sourceLanguage = await detectLanguage(userMessage);

      // Translate message for other users
      const translations = await buildTranslations(userMessage, sourceLanguage, groupId, userId);

      if (translations.length > 0) {
        await replyToLine(replyToken, translations.join("\n\n"));
      }
    }
  }

  res.status(200).send("OK");
}

async function detectLanguage(text) {
  const res = await openai.createChatCompletion({
    model: "gpt-3.5-turbo",
    messages: [
      { role: "system", content: "Detect the language of the following message." },
      { role: "user", content: text },
    ],
  });

  return res.data.choices[0].message.content.trim();
}

async function buildTranslations(originalText, sourceLang, groupId, senderId) {
  const userPrefs = groupUserLanguages[groupId];
  const translations = [];

  for (const [userId, langs] of Object.entries(userPrefs)) {
    if (userId === senderId) continue; // skip sender
    if (!langs.includes(sourceLang)) {
      const targetLang = langs[0]; // pick first language as target
      const translatedText = await translateText(originalText, targetLang);
      translations.push(`Translated for ${userId} (${targetLang}):\n${translatedText}`);
    }
  }
  return translations;
}

async function translateText(text, targetLang) {
  const res = await openai.createChatCompletion({
    model: "gpt-3.5-turbo",
    messages: [
      {
        role: "system",
        content: `Translate this to ${targetLang}. Only output the translated text.`,
      },
      { role: "user", content: text },
    ],
  });

  return res.data.choices[0].message.content.trim();
}

async function replyToLine(replyToken, message) {
  await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({
      replyToken,
      messages: [{ type: "text", text: message }],
    }),
  });
}
