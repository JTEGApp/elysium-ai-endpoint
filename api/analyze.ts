import type { VercelRequest, VercelResponse } from "@vercel/node";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "content-type");
    return res.status(200).end();
  }
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    const MODEL = process.env.OPENAI_MODEL || "gpt-5-mini";
    if (!OPENAI_API_KEY) {
      return res.status(500).json({ error: "Missing OPENAI_API_KEY" });
    }

    const { snapshot, referenceNotes, brand } = req.body || {};
    if (!snapshot?.scores) {
      return res.status(400).json({ error: "Missing snapshot.scores" });
    }

    const system = `
You are an organizational culture advisor for a premium consultancy called "${brand || "The Elysium Group"}".
Use HBR's 8 culture styles (Caring, Purpose, Learning, Enjoyment, Results, Authority, Safety, Order).
Be plain-spoken, premium, and actionable. No numeric scores in the prose. Focus on 90-day leader behaviors.
Return:
1) Executive Summary (3–5 bullets)
2) Top Strengths (why they matter)
3) Priority Shifts (2–4 targeted recommendations)
4) Leadership Behaviors & Rituals (linked to styles)
5) Risks to Monitor & Metrics to Watch
`;

    const user = `
Snapshot:
${JSON.stringify(snapshot, null, 2)}

Reference notes:
${(referenceNotes || []).join("\n")}

Constraints:
- No numeric scoring in the text.
- Premium, concise, actionable tone.
`;

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user }
        ],
        temperature: 0.4
      })
    });

    if (!r.ok) {
      const err = await r.text();
      return res.status(500).json({ error: "OpenAI error", detail: err });
    }

    const data = await r.json();
    const text = data?.choices?.[0]?.message?.content || "";

    // CORS for your frontend
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "content-type");
    return res.status(200).json({ text });
  } catch (e: any) {
    return res.status(500).json({ error: "server", detail: e?.message || String(e) });
  }
}

