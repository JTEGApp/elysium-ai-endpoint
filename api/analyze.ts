import type { VercelRequest, VercelResponse } from "@vercel/node";

/**
 * POST /api/analyze
 * Body:
 * {
 *   "brand": "The Elysium Group",
 *   "snapshot": {
 *     "scores": [{ "key":"caring","style":"Caring","current":6 }, ...],
 *     "top3": { "observed": [...], "personal": [...] }
 *   },
 *   "referenceNotes": ["executive tone", "no visible numbers in prose"]
 * }
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS for browser calls
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    // You said you set OPENAI_MODEL to “gpt-5” in Vercel; we keep a safe default just in case.
    const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

    if (!OPENAI_API_KEY) {
      res.setHeader("Access-Control-Allow-Origin", "*");
      return res.status(500).json({ error: "Missing OPENAI_API_KEY" });
    }

    const { brand, snapshot, referenceNotes } = (req.body ?? {}) as {
      brand?: string;
      snapshot?: {
        scores?: Array<{ key: string; style?: string; current?: number }>;
        top3?: { observed?: string[]; personal?: string[] };
      };
      referenceNotes?: string[];
    };

    if (!snapshot || !Array.isArray(snapshot.scores)) {
      res.setHeader("Access-Control-Allow-Origin", "*");
      return res
        .status(400)
        .json({ error: "Missing snapshot.scores (array required)" });
    }

    // Light input sanitation/normalization
    const cleanedScores = snapshot.scores
      .filter((r) => r && typeof r.key === "string")
      .map((r) => ({
        key: r.key,
        style: r.style || r.key,
        current: typeof r.current === "number" ? r.current : 0,
      }));

    const sys = `
You are a senior organizational culture advisor writing for discerning corporate executives at "${brand || "The Elysium Group"}".
Use the HBR 8 culture styles (Caring, Purpose, Learning, Enjoyment, Results, Authority, Safety, Order).
Speak in a premium, plain-spoken voice focused on business outcomes.
Do NOT show numeric scores in the prose; translate them into qualitative insights.
When helpful, include concise, relevant case references (no confidential data) and exemplars to make the guidance tangible.

Deliver:
1) Executive Summary: 3–5 bullets on the culture profile and business implications.
2) Strengths Worth Preserving: why they matter and where they create advantage.
3) Priority Shifts (next 90 days): 3–5 practical, leader-led moves (cadence, rituals, governance).
4) Risks to Monitor: early warning signs and counter-measures.
5) Metrics & Signals: how to know it’s working (leading and lagging).
Tone: crisp, board-ready, action-oriented. Keep it under ~600 words.
`;

    const usr = `
Snapshot (qualitative only, no numbers in output):
${JSON.stringify({ scores: cleanedScores, top3: snapshot.top3 || {} }, null, 2)}

Reference notes from client:
${(referenceNotes || []).join("\n") || "(none)"}
`;

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.4,
        messages: [
          { role: "system", content: sys },
          { role: "user", content: usr },
        ],
      }),
    });

    if (!r.ok) {
      const detail = await r.text().catch(() => "");
      res.setHeader("Access-Control-Allow-Origin", "*");
      return res.status(502).json({ error: "OpenAI error", detail });
    }

    const data = (await r.json()) as any;
    const text =
      data?.choices?.[0]?.message?.content?.trim() ||
      "No analysis was generated.";

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    return res.status(200).json({ text, model: MODEL });
  } catch (err: any) {
    console.error("Analyze error:", err);
    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.status(500).json({
      error: "server",
      detail: err?.message || String(err),
    });
  }
}
