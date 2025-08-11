// api/analyze.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";

function cors(res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  cors(res);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    return res.status(500).json({ error: "Missing OPENAI_API_KEY" });
  }

  try {
    const { brand, snapshot, referenceNotes } = req.body || {};

    if (!brand || !snapshot) {
      return res.status(400).json({ error: "Missing brand or snapshot in request body" });
    }

    // Build prompt for GPT
    const messages = [
      {
        role: "system",
        content: `You are an expert in organizational culture and leadership transformation. 
        You write premium, plain-spoken briefs aligned to the eight culture styles from Harvard Business Review. 
        Your tone is clear, confident, and pragmatic.`
      },
      {
        role: "user",
        content: `Brand: ${brand}
Snapshot: ${JSON.stringify(snapshot)}
Reference notes: ${Array.isArray(referenceNotes) ? referenceNotes.join(" | ") : ""}
---
Please produce a leadership recommendations brief tuned for the next 90 days of execution.`
      }
    ];

    // Call OpenAI
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
        messages,
        temperature: 0.7,
        max_tokens: 800,
      }),
    });

    if (!r.ok) {
      const errText = await r.text();
      return res.status(r.status).json({ error: "OpenAI API error", details: errText });
    }

    const data = await r.json();
    const text = data.choices?.[0]?.message?.content?.trim() || "";

    return res.status(200).json({ text });
  } catch (err: any) {
    console.error(err);
    return res.status(500).json({ error: err.message || "Internal server error" });
  }
}
