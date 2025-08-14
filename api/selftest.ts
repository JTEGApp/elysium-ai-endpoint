import type { VercelRequest, VercelResponse } from "@vercel/node";

function cors(res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type, authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
  if (!OPENAI_API_KEY) {
    return res.status(401).json({ ok: false, error: "Missing OPENAI_API_KEY" });
  }

  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0,
        messages: [
          { role: "system", content: "You are a terse assistant." },
          { role: "user", content: "Reply with 'OK'." },
        ],
      }),
    });

    const data = await r.json().catch(() => ({}));
    const msg = data?.choices?.[0]?.message?.content || "";
    return res.status(200).json({ ok: true, model: MODEL, reply: msg.slice(0, 50) });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
}
