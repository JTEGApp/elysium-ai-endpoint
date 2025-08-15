// api/analyze.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";

/**
 * POST /api/analyze
 * Body: {
 *   brand?: string,
 *   snapshot: { scores: Array<{key:string, style?:string, current:number}>, top3?: {observed?: string[], personal?: string[]} },
 *   referenceNotes?: string[]
 * }
 *
 * Returns: { text: string }
 */

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // --- CORS preflight ---
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "content-type, authorization");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    return res.status(200).end();
  }

  if (req.method === "GET") {
    // lightweight health probe
    return res.status(200).json({ ok: true, endpoint: "analyze", ts: Date.now() });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini"; // set in Vercel -> Settings -> Environment Variables
    if (!OPENAI_API_KEY) {
      return res.status(500).json({ error: "Missing OPENAI_API_KEY" });
    }

    const { snapshot, referenceNotes, brand } = (req.body || {}) as {
      brand?: string;
      snapshot?: {
        scores?: Array<{ key: string; style?: string; current: number }>;
        top3?: { observed?: string[]; personal?: string[] };
      };
      referenceNotes?: string[];
    };

    if (!snapshot || !Array.isArray(snapshot.scores) || snapshot.scores.length === 0) {
      return res.status(400).json({ error: "Missing snapshot.scores (array required)" });
    }

    const system = `
You are an organizational culture advisor for a premium consultancy called "${brand || "The Elysium Group"}".
Use the 8 culture styles (Caring, Purpose, Learning, Enjoyment, Results, Authority, Safety, Order).
Audience: sophisticated corporate executives. Be plain-spoken, premium, and actionable.
Connect culture + leadership behaviors to measurable business outcomes.
No numeric scores in the prose. Provide near-term (90-day) and 12-month horizons.

Return sections:
1) Executive Summary (3–5 bullets)
2) Strengths That Matter (tie to outcomes)
3) Priority Shifts (2–4 targeted recommendations)
4) Leadership Behaviors & Rituals (by style)
5) Risks to Monitor & Metrics to Watch
`;

    const user = `
Snapshot (aggregated):
${JSON.stringify(snapshot, null, 2)}

Reference notes:
${(referenceNotes || []).join("\n")}

Constraints:
- No numeric scoring in the prose.
- Include targeted examples or short case-style illustrations where helpful.
- Keep it concise and board-ready.
`;

    // IMPORTANT: no temperature here (some models only allow default=1)
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
      }),
    });

    if (!r.ok) {
      const detail = await r.text().catch(() => "");
      return res.status(502).json({ error: "OpenAI error", detail });
    }

    const data = await r.json();
    const text = data?.choices?.[0]?.message?.content || "";

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "content-type, authorization");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");

    return res.status(200).json({ text });
  } catch (e: any) {
    console.error("analyze error:", e);
    return res.status(500).json({ error: "server", detail: e?.message || String(e) });
  }
}
