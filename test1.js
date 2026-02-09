// test.js
// Usage:
// node test.js "https://example.com" "Summarize this page in 5 bullet points"

import dotenv from "dotenv";
import OpenAI from "openai";
import fetch from "node-fetch";
import { JSDOM } from "jsdom";

dotenv.config();

// -------------------- Inputs --------------------
const url = process.argv[2];
const command = process.argv[3];

if (!url || !command) {
  console.error(`
❌ Missing arguments.

Usage:
node test.js "<URL>" "<COMMAND>"

Example:
node test.js "https://openai.com" "Summarize this page in 5 bullets"
`);
  process.exit(1);
}

// -------------------- OpenAI --------------------
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// -------------------- Scrape Function --------------------
async function scrapeUrlText(targetUrl) {
  const res = await fetch(targetUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (ResumeBot Test)",
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch URL (${res.status})`);
  }

  const html = await res.text();
  const dom = new JSDOM(html);
  const document = dom.window.document;

  // Remove noisy tags
  document.querySelectorAll("script, style, nav, footer, header").forEach(el => el.remove());

  const text = document.body.textContent || "";

  return text
    .replace(/\s+/g, " ")
    .replace(/\u00A0/g, " ")
    .trim()
    .slice(0, 12000); // keep prompt size safe
}

// -------------------- Main --------------------
(async () => {
  try {
    console.log("🔍 Scraping URL...");
    const pageText = await scrapeUrlText(url);

    console.log("🧠 Sending to OpenAI...\n");

    const prompt = `
You are a professional analyst.

COMMAND:
${command}

CONTENT FROM URL:
${pageText}

Rules:
- Be concise
- Be accurate
- Do not hallucinate
`;

    const response = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 1,
    });

    console.log("✅ AI RESPONSE:\n");
    console.log(response.choices[0].message.content);
  } catch (err) {
    console.error("❌ ERROR:", err.message);
  }
})();



