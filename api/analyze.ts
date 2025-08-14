import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

// Server-side Supabase admin client (service role)
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const supabaseAdmin =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    : null;

// Which roles are allowed to access AI
const ALLOWED_ROLES = (process.env.ALLOWED_ROLES || "admin,analyst")
  .split(",")
  .map((r) => r.trim());

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "content-type,authorization");
    return res.status(200).end();
  }
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    if (!OPENAI_API_KEY) {
      return res.status(500).json({ error: "Missing OPENAI_API_KEY" });
    }
    if (!supabaseAdmin) {
      return res.status(500).json({ error: "Supabase admin not configured" });
    }

    // 1) Verify Supabase user token from Authorization: Bearer <jwt>
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!token) {
      return res.status(401).json({ error: "Missing bearer token" });
    }

    const { data: userInfo, error: userErr } = await supabaseAdmin.auth.getUser(
      token
    );
    if (userErr || !userInfo?.user) {
      return res.status(401).json({ error: "Invalid token" });
    }

    // 2) Load profile for role check
    const userId = userInfo.user.id;
    const { data: profile, error: profErr } = await supabaseAdmin
      .from("profiles")
      .select("role,email")
      .eq("id", userId)
      .maybeSingle();

    if (profErr || !profile) {
      return res.status(403).json({ error: "No profile found" });
    }
    if (!ALLOWED_ROLES.includes(profile.role)) {
      return res.status(403).json({ error: "Insufficient role" });
    }

    // 3) Proceed with AI generation
    const { snapshot, referenceNotes, brand } = req.body || {};
    if (!snapshot?.scores) {
      return res.status(400).json({ error: "Missing snapshot.scores" });
    }

    const system = `
You are an organizational culture advisor for a premium consultancy "${brand || "The Elysium Group"}".
Use HBR's 8 culture styles (Caring, Purpose, Learning, Enjoyment, Results, Authority, Safety, Order).
Audience: senior executives. Be incisive, concrete, and outcome-oriented.
Do not show numeric scores in prose. Offer examples or brief case references when helpful.
Return sections:
1) Executive Summary (3–5 bullets)
2) Strengths that Enable Performance
3) Gaps & Organizational Risks
4) 90-Day Leadership Moves (rituals, cadences, decisions)
5) KPIs to Watch (leading/lagging)
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
    });

    if (!r.ok) {
      const detail = await r.text();
      return res.status(500).json({ error: "OpenAI error", detail });
    }
    const data = await r.json();
    const text = data?.choices?.[0]?.message?.content || "";

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "content-type,authorization");
    return res.status(200).json({ text });
  } catch (e: any) {
    console.error("Server error:", e);
    return res
      .status(500)
      .json({ error: "server", detail: e?.message || String(e) });
  }
}
