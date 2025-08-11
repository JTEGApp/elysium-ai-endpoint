// api/selftest.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";

function cors(res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  const key = process.env.OPENAI_API_KEY || "";
  const model = (process.env.OPENAI_MODEL || "gpt-4o-mini").trim();
  if (!key) return res.status(500).json({ ok: false, reason: "Missing OPENAI_API_KEY" });

  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: "Reply with OK" }],
      temperature: 0,
      max_tokens: 5
    }),
  });

  const text = await r.text();
  let body: any = text;
  try { body = JSON.parse(text); } catch {}
  return res.status(200).json({ ok: r.ok, status: r.status, model, hasKey: !!key, keyLength: key.length, body });
}
