import type { VercelRequest, VercelResponse } from "@vercel/node";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    const MODEL = process.env.OPENAI_MODEL || "gpt-5";

    if (!OPENAI_API_KEY) {
      return res.status(500).json({ error: "Missing OPENAI_API_KEY" });
    }

    const { snapshot, referenceNotes, brand } = req.body || {};
    if (!snapshot || !Array.isArray(snapshot.scores)) {
      return res.status(400).json({ error: "Missing snapshot.scores (array required)" });
    }

    const system = `
You are an executive culture advisor for the premium consultancy "${brand || "The Elysium Group"}".
Use the 8-style culture model (Caring, Purpose, Learning, Enjoyment, Results, Authority, Safety, Order).
Audience: sophisticated corporate executives. Be plain-spoken, premium, and actionable.
Do not include numeric scores in the prose; translate signal into insight.

Return:
1) Executive Summary (3–5 bullets)
2) Strengths (why they matter to outcomes)
3) Priority Shifts (2–4 targeted, high-leverage moves)
4) Leadership Behaviors & Rituals (90-day emphasis, then 12-month horizon)
5) Risks to Monitor & Business Metrics to Watch
`;

    const user = `
Aggregated Snapshot (input JSON):
${JSON.stringify(snapshot, null, 2)}

Reference notes for voice/constraints:
${Array.isArray(referenceNotes) ? referenceNotes.join("\n") : ""}

Constraints:
- Keep it concise and board-ready.
- Tie culture/leadership to measurable business outcomes.
- Offer examples or short case-style illustrations where helpful.
- Avoid numeric scores in the text; speak to signal and patterns.
`;

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        // Omit temperature to satisfy models that only accept default
        // temperature: 1, // (commented out intentionally)
      }),
    });

    const raw = await r.text();
    let data: any = null;
    try {
      data = JSON.parse(raw);
    } catch {
      // leave as raw if parsing fails
    }

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (!r.ok) {
      return res.status(r.status).json({
        error: "OpenAI error",
        detail: data || raw,
      });
    }

    const text = data?.choices?.[0]?.message?.content || "";
    return res.status(200).json({ text });
  } catch (e: any) {
    return res.status(500).json({ error: "server", detail: e?.message || String(e) });
  }
}
