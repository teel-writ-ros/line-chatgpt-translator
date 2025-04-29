import { Configuration, OpenAIApi } from "openai";
import fetch from "node-fetch";

const config = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(config);

// In-memory storage of user language preferences (temporary for now)
let userLanguages = {};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).send("Method Not Allowed");
    return;
  }

  const events = req.body.events || [];

  for (const event of events) {
    if (event.type === "message" && event.message.type === "text") {
      const userMessage = event.message.text;
      const userId = event.source.userId;
      const groupId = event.source.groupId;
      const replyToken = event.replyToken;

      // Handle user language setup if needed
      if (userMessage.toLowerCase().includes("language")) {
        await handleLanguageSetup(userId, userMessage, groupId, replyToken);
        return;
      }

      // Detect language of the message
      const detectedLanguage = await detectLanguage(userMessage);

      // Translate the message for everyone
      const translations = await getTranslations(userMessage, detectedLanguage);

      // Send translations back to the group
      await sendTranslations(groupId, translations, replyToken);
    }
  }

  res.status(200).send("OK");
}

// Function to handle language setup
async function handleLanguageSetup(userId, userMessage, groupId, replyToken) {
  // Simple language setup (for demo purposes)
  const languages = userMessage.split(",").map(lang => lang.trim());
  userLanguages[userId] = languages;

  const replyMessage = `Got it! You understand: ${languages.join(", ")}`;
  await sendReply(groupId, replyToken, replyMessage);
}

// Function to detect language (could be extended to use more powerful models or libraries)
async function detectLanguage(text) {
  const res = await openai.createChatCompletion({
    model: "gpt-3.5-turbo",
    messages: [
      { role: "system", content: "You are a language detection bot." },
      { role: "user", content: `Detect the language of this text: ${text}` },
    ],
  });
  return res.data.choices[0].message.content.trim();
}

// Function to get translations using ChatGPT
async function getTranslations(text, detectedLanguage) {
  const translations = {};

  // Loop through all users' language preferences
  for (const userId in userLanguages) {
    const languages = userLanguages[userId];

    if (!languages.includes(detectedLanguage)) {
      const translateTo = languages[0]; // For simplicity, translating to first language in list
      const translation = await openai.createChatCompletion({
        model: "gpt-3.5-turbo",
        messages: [
          { role: "system", content: `You are a translation bot. Translate the following text to ${translateTo}:` },
          { role: "user", content: text },
        ],
      });
      translations[userId] = translation.data.choices[0].message.content.trim();
    }
  }

  return translations;
}

// Function to send translations back to the group
async function sendTranslations(groupId, translations, replyToken) {
  const messages = [];
  for (const userId in translations) {
    messages.push({
      type: "text",
      text: `User ${userId} says: ${translations[userId]}`,
    });
  }

  await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({
      replyToken,
      messages,
    }),
  });
}

// Function to send a reply message
async function sendReply(groupId, replyToken, message) {
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
