import type { VercelRequest, VercelResponse } from "@vercel/node";
import OpenAI from "openai";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    // ✅ Read environment variable directly from process.env
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.error("❌ OPENAI_API_KEY is not set in environment variables");
      return res.status(500).json({ error: "Missing OPENAI_API_KEY" });
    }

    // ✅ Parse JSON body
    const { brand, snapshot, referenceNotes } = req.body || {};
    if (!brand || !snapshot) {
      return res.status(400).json({ error: "Missing brand or snapshot data" });
    }

    // ✅ Create OpenAI client
    const client = new OpenAI({ apiKey });

    // Build a prompt for the AI
    const prompt = `
You are an expert in organizational culture and leadership.
Brand: ${brand}

Observed culture styles: ${snapshot.top3?.observed?.join(", ")}
Personal affinity styles: ${snapshot.top3?.personal?.join(", ")}

Scores:
${snapshot.scores
  ?.map((s: any) => `${s.style}: ${s.current}`)
  .join("\n")}

Reference notes:
${referenceNotes?.join("\n") || "None"}

Write a plain-spoken analysis for the leadership team.
Avoid numeric scoring in the prose.
Provide recommendations for reinforcing strengths and addressing gaps.
    `;

    // Call GPT-4o or GPT-5
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "You are a leadership and culture consultant." },
        { role: "user", content: prompt }
      ],
      temperature: 0.7
    });

    const output = completion.choices[0].message?.content || "";

    res.status(200).json({ text: output });
  } catch (err: any) {
    console.error("❌ API error:", err);
    res.status(500).json({ error: err.message || "Internal Server Error" });
  }
}
