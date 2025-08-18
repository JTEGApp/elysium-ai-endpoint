// api/analyze.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";

// Hard cap for the upstream OpenAI request (keep lower than Vercel maxDuration)
const OPENAI_TIMEOUT_MS = 8000; // 8s

// Safe, minimal schema guard
function isValidScores(x: any): x is { key: string; current: number }[] {
  return Array.isArray(x) && x.every(r => r && typeof r.key === "string" && typeof r.current === "number");
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    // CORS preflight
    if (req.method === "OPTIONS") {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
      return res.status(200).end();
    }
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    // Use your intended model; keep params compatible (some models ignore/forbid non-default temperature)
    const MODEL = process.env.OPENAI_MODEL || "gpt-5";

    if (!OPENAI_API_KEY) {
      return res.status(500).json({ error: "Missing OPENAI_API_KEY" });
    }

    const { snapshot, referenceNotes, brand } = (req.body || {}) as {
      snapshot?: { scores?: Array<{ key: string; style?: string; current: number }>; top3?: any };
      referenceNotes?: string[];
      brand?: string;
    };

    if (!snapshot || !isValidScores(snapshot.scores)) {
      return res.status(400).json({ error: "Missing snapshot.scores (array required)" });
    }

    // Keep system & user prompts tight for speed
    const system = [
      `You are an organizational culture advisor for "${brand || "The Elysium Group"}".`,
      `Use HBR’s 8 styles: Caring, Purpose, Learning, Enjoyment, Results, Authority, Safety, Order.`,
      `Tone: premium, plain-spoken, executive-ready. No numeric scores in the prose.`,
      `Focus on 90-day leader behaviors linked to business outcomes.`
    ].join(" ");

    const user = [
      `Snapshot (aggregated):`,
      JSON.stringify(snapshot, null, 2),
      ``,
      `Reference notes:`,
      (referenceNotes || []).join("\n")
    ].join("\n");

    // Abort if OpenAI is slow
    const ctrl = new AbortController();
    const kill = setTimeout(() => ctrl.abort(), OPENAI_TIMEOUT_MS);

    // IMPORTANT: don’t send unsupported params (e.g., some models reject temperature!=1)
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user }
        ]
        // omit temperature/max_tokens to avoid "unsupported_value" for strict models
      })
    }).catch((e) => {
      throw new Error(`Upstream fetch failed: ${e?.message || e}`);
    });

    clearTimeout(kill);

    if (!r.ok) {
      const detail = await r.text().catch(() => "");
      return res.status(502).json({ error: "OpenAI error", detail });
    }

    const data = await r.json();
    const text = data?.choices?.[0]?.message?.content || "";

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    return res.status(200).json({ text });
  } catch (e: any) {
    // AbortError -> upstream timeout; map to 504 for clarity
    if (e?.name === "AbortError") {
      return res.status(504).json({ error: "Upstream timeout" });
    }
    console.error("Server error:", e);
    return res.status(500).json({ error: "server", detail: e?.message || String(e) });
  }
}
