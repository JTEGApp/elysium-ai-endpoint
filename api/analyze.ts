// api/analyze.ts
export const config = { runtime: "edge" };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "content-type,authorization",
      "access-control-allow-methods": "POST,OPTIONS",
    },
  });
}

export default async function handler(req: Request): Promise<Response> {
  // CORS preflight
  if (req.method === "OPTIONS") return json({ ok: true }, 200);
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
    if (!OPENAI_API_KEY) return json({ error: "Missing OPENAI_API_KEY" }, 500);

    const url = new URL(req.url);
    const mode = url.searchParams.get("mode") || ""; // use ?mode=dry to bypass OpenAI

    const body = await req.json().catch(() => ({}));
    const { snapshot, referenceNotes, brand } = body || {};
    if (!snapshot?.scores) return json({ error: "Missing snapshot.scores" }, 400);

    if (mode === "dry") {
      return json({
        text:
          "DRY RUN — Endpoint is healthy. OpenAI call skipped.\n" +
          `Brand: ${brand || "The Elysium Group"}\n` +
          `Scores: ${snapshot.scores.length}\n` +
          `Top3: ${JSON.stringify(snapshot.top3 || {})}`,
      });
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

    // Add an internal timeout (~20s) so we fail before the gateway does
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 20000);

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
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
        temperature: 0.4,
      }),
    }).catch((e) => {
      throw new Error(`OpenAI fetch failed: ${e?.message || e}`);
    });

    clearTimeout(t);

    if (!r.ok) {
      const detail = await r.text().catch(() => "");
      return json({ error: "OpenAI error", status: r.status, detail }, 502);
    }

    const data = await r.json().catch(() => ({}));
    const text = data?.choices?.[0]?.message?.content || "";
    return json({ text }, 200);
  } catch (e: any) {
    const msg = String(e?.message || e);
    const isAbort = e?.name === "AbortError" || /abort|timed out|timeout/i.test(msg);
    return json({ error: isAbort ? "timeout" : "server", detail: msg }, isAbort ? 504 : 500);
  }
}
