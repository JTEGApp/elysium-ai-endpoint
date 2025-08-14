import type { VercelRequest, VercelResponse } from "@vercel/node";

function cors(res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type, authorization");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
    if (!OPENAI_API_KEY) {
      return res.status(401).json({ error: "Missing OPENAI_API_KEY" });
    }

    const body = (req.body || {}) as {
      brand?: string;
      snapshot?: { scores?: Array<{ key: string; style?: string; title?: string; current?: number }>; top3?: { observed?: string[]; personal?: string[] } };
      referenceNotes?: string[];
      systemOverride?: string;
    };

    const { brand, snapshot, referenceNotes = [], systemOverride } = body;

    if (!snapshot || !Array.isArray(snapshot.scores) || snapshot.scores.length === 0) {
      return res.status(400).json({ error: "Missing snapshot.scores (array required)" });
    }

    // Normalize scores to strip any problem fields & keep content minimal
    const normalizedScores = snapshot.scores
      .filter((r) => typeof r?.current === "number" && isFinite(r.current as number))
      .map((r) => ({
        key: r.key,
        label: r.style ?? r.title ?? r.key,
        current: r.current,
      }));

    const sysPrompt =
      systemOverride ||
      `You are an organizational culture advisor for a premium consultancy called "${brand || "The Elysium Group"}".
Use HBR's 8 culture styles (Caring, Purpose, Learning, Enjoyment, Results, Authority, Safety, Order).
Be plain-spoken, premium, and actionable. No numeric scores in the prose. Focus on the next 90 days.
Return sections:
1) Executive Summary (3–5 bullets)
2) Top Strengths (why they matter)
3) Priority Shifts (2–4 targeted moves)
4) Leadership Behaviors & Rituals (linked to styles)
5) Risks to Monitor & Metrics to Watch`;

    const userPrompt = `
Snapshot (redacted for brevity):
scores: ${JSON.stringify(normalizedScores)}
top3: ${JSON.stringify(snapshot.top3 || {})}

Reference notes:
${referenceNotes.join("\n")}

Constraints:
- No numeric scoring in the prose.
- Premium, concise, actionable tone.
`;

    // Add a reasonable timeout to avoid 504s
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000); // 20s

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.4,
        messages: [
          { role: "system", content: sysPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    }).catch((e) => {
      throw new Error(`Network/OpenAI fetch failed: ${e?.message || String(e)}`);
    });
    clearTimeout(timeout);

    if (!r.ok) {
      const detail = await r.text().catch(() => "");
      return res.status(502).json({ error: "OpenAI error", detail, status: r.status });
    }

    const data = await r.json();
    const text = data?.choices?.[0]?.message?.content || "";
    return res.status(200).json({ ok: true, text });
  } catch (e: any) {
    return res.status(500).json({ error: "Server error", detail: e?.message || String(e) });
  }
}
