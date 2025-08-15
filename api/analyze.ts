import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

// ---------- Types ----------
type ScoreRow = { key: string; current: number; style?: string; title?: string };
type Top3 = { observed?: string[]; personal?: string[] };
type Snapshot = { scores: ScoreRow[]; top3?: Top3 };

type AssessmentRow = {
  id: string;
  submitted_at: string;
  respondent_email: string | null;
  respondent_team: string | null;
  respondent_role: string | null;
  respondent_company_domain: string | null;
  scores: any | null;
  top3: any | null;
  followups: any | null;
  raw_answers: any | null;
};

// A stable list of the 8 styles (used for clean output ordering)
const STYLE_KEYS: { key: string; label: string }[] = [
  { key: "caring", label: "Caring" },
  { key: "purpose", label: "Purpose-Driven" },
  { key: "learning", label: "Learning" },
  { key: "enjoyment", label: "Enjoyment" },
  { key: "results", label: "Results-Oriented" },
  { key: "authority", label: "Authority" },
  { key: "safety", label: "Safety" },
  { key: "order", label: "Order-Oriented" },
];

// Optional static, non-changing matrix you want the model to reference
const CHOSEN_XIII_AND_CULTURE_MATRIX_NOTE = `
Use the "Chosen XIII + 8 Culture Styles" matrix as stable context:
- Map each of the 8 styles (Caring, Purpose-Driven, Learning, Enjoyment, Results-Oriented, Authority, Safety, Order-Oriented)
  to leadership levers (rituals, decisions, incentives, role-modeling) and expected business outcomes.
- Treat this matrix as a static reference—do not invent new factors; synthesize against it.
`;

// ---------- Helpers ----------
function okCORS(res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type, authorization");
}

function bad(res: VercelResponse, status: number, error: string, detail?: any) {
  okCORS(res);
  return res.status(status).json({ error, detail });
}

function avg(nums: number[]): number {
  const n = nums.filter((x) => typeof x === "number" && isFinite(x));
  if (!n.length) return 0;
  const sum = n.reduce((a, b) => a + b, 0);
  return sum / n.length;
}

function aggregateSnapshots(rows: Snapshot[]) {
  // Per-style averages
  const byStyle: Record<string, number[]> = {};
  // Frequencies for personal/observed
  const freqPersonal: Record<string, number> = {};
  const freqObserved: Record<string, number> = {};

  for (const r of rows) {
    // Scores
    (r.scores || []).forEach((s) => {
      const k = s?.key;
      const v = Number(s?.current ?? 0);
      if (!k || !isFinite(v)) return;
      byStyle[k] = byStyle[k] || [];
      byStyle[k].push(v);
    });

    // Top3
    const p = r.top3?.personal || [];
    const o = r.top3?.observed || [];
    p.forEach((label) => {
      const norm = String(label || "").trim();
      if (!norm) return;
      freqPersonal[norm] = (freqPersonal[norm] || 0) + 1;
    });
    o.forEach((label) => {
      const norm = String(label || "").trim();
      if (!norm) return;
      freqObserved[norm] = (freqObserved[norm] || 0) + 1;
    });
  }

  // Build a clean ordered style list with averages
  const styleAverages = STYLE_KEYS.map(({ key, label }) => ({
    key,
    label,
    average: Number(avg(byStyle[key] || []).toFixed(2)),
  })).sort((a, b) => b.average - a.average);

  // Top-3 lists by frequency
  const top3Personal = Object.entries(freqPersonal)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([k]) => k);
  const top3Observed = Object.entries(freqObserved)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([k]) => k);

  return {
    n: rows.length,
    styleAverages,
    top3Personal,
    top3Observed,
  };
}

function normalizeRow(r: any): Snapshot | null {
  if (!r || !Array.isArray(r.scores)) return null;
  const scores: ScoreRow[] = r.scores
    .map((s: any) => ({
      key: s?.key ?? s?.style ?? s?.title,
      current: Number(s?.current ?? 0),
      style: s?.style,
      title: s?.title,
    }))
    .filter((x: ScoreRow) => x.key && isFinite(x.current));
  const top3: Top3 = {
    observed: Array.isArray(r.top3?.observed) ? r.top3.observed : [],
    personal: Array.isArray(r.top3?.personal) ? r.top3.personal : [],
  };
  return { scores, top3 };
}

async function fetchFromSupabase(filters: {
  domain?: string;
  team?: string;
  role?: string;
  sinceDays?: number;
}) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE;
  const ANON = process.env.SUPABASE_ANON_KEY;

  if (!SUPABASE_URL || (!SERVICE_ROLE && !ANON)) {
    throw new Error(
      "Missing Supabase credentials. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE (or SUPABASE_ANON_KEY)."
    );
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE || ANON, {
    auth: { persistSession: false },
  });

  let q = supabase
    .from<AssessmentRow>("assessments")
    .select(
      "id, submitted_at, respondent_email, respondent_team, respondent_role, respondent_company_domain, scores, top3, followups, raw_answers"
    )
    .order("submitted_at", { ascending: false })
    .limit(500); // cap to keep prompt small/fast

  if (filters.domain) q = q.eq("respondent_company_domain", filters.domain);
  if (filters.team) q = q.eq("respondent_team", filters.team);
  if (filters.role) q = q.eq("respondent_role", filters.role);
  if (filters.sinceDays && filters.sinceDays > 0) {
    const since = new Date(Date.now() - filters.sinceDays * 864e5).toISOString();
    q = q.gte("submitted_at", since);
  }

  const { data, error } = await q;
  if (error) throw error;

  // Normalize into snapshots
  const snaps: Snapshot[] = (data || [])
    .map((row) => normalizeRow({ scores: row.scores, top3: row.top3 }))
    .filter(Boolean) as Snapshot[];

  return { rows: data || [], snapshots: snaps };
}

function buildSystemPrompt(brand?: string) {
  const name = brand || "The Elysium Group";
  return `
You are a senior culture & leadership advisor for "${name}" producing executive-grade briefs.
Audience: executive leaders who care how culture + leadership leverage business outcomes.
Tone: premium, plain-spoken, evidence-based. No numeric scores in prose (numbers OK in small tables/labels if needed).
Frameworks: HBR 8 Culture Styles + the stable "Chosen XIII + 8 Culture Styles" leadership matrix.
Return tight, actionable, 90-day guidance: strategic shifts, leader rituals, guardrails, and metrics.
${CHOSEN_XIII_AND_CULTURE_MATRIX_NOTE}
`.trim();
}

function buildUserPromptFromAggregate(agg: ReturnType<typeof aggregateSnapshots>, brand?: string, filters?: any) {
  const lines: string[] = [];
  lines.push(`Brand: ${brand || "The Elysium Group"}`);
  if (filters?.domain) lines.push(`Filter: domain=${filters.domain}`);
  if (filters?.team) lines.push(`Filter: team=${filters.team}`);
  if (filters?.role) lines.push(`Filter: role=${filters.role}`);
  if (filters?.sinceDays) lines.push(`Filter: sinceDays=${filters.sinceDays}`);
  lines.push(`Sample size: ${agg.n}`);
  lines.push(`\nStyle Averages (descending):`);
  agg.styleAverages.forEach((s) => {
    lines.push(`- ${s.label}: ${s.average}`);
  });
  lines.push(`\nMost common Personal Top 3: ${agg.top3Personal.join(", ") || "—"}`);
  lines.push(`Most common Observed Top 3: ${agg.top3Observed.join(", ") || "—"}`);

  lines.push(`
Deliverables:
1) Executive Summary (4–6 bullets)
2) Strengths at Scale (why they matter commercially)
3) Culture Gaps Impacting Outcomes (be specific)
4) 90-Day Leadership Moves (rituals, decisions, incentives, role-modeling)
5) Risks to Monitor & Leading Metrics (with early warning indicators)
6) Example scripts/snippets leaders can use this quarter (max 3)
Avoid fluff; keep it decisive and board-ready.
  `.trim());

  return lines.join("\n");
}

function buildUserPromptFromSnapshot(s: Snapshot, brand?: string) {
  const ordered = STYLE_KEYS.map(({ key, label }) => {
    const row = (s.scores || []).find((r) => r.key === key);
    return { label, value: row?.current ?? 0 };
  });

  const lines: string[] = [];
  lines.push(`Brand: ${brand || "The Elysium Group"}`);
  lines.push(`Single assessment snapshot provided.`);
  lines.push(`\nStyle Scores:`);
  ordered.forEach((o) => lines.push(`- ${o.label}: ${o.value}`));
  const pTop = s.top3?.personal?.join(", ") || "—";
  const oTop = s.top3?.observed?.join(", ") || "—";
  lines.push(`\nPersonal Top 3: ${pTop}`);
  lines.push(`Observed Top 3: ${oTop}`);

  lines.push(`
Deliverables:
- One-page leadership brief (as above). Keep it concise and practical for execution in the next 90 days.
- No numeric scores in prose; use labels. Avoid consulting jargon.
  `.trim());

  return lines.join("\n");
}

// ---------- Handler ----------
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS preflight
  if (req.method === "OPTIONS") {
    okCORS(res);
    return res.status(200).end();
  }
  if (req.method !== "POST") {
    return bad(res, 405, "Method not allowed");
  }

  try {
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
    if (!OPENAI_API_KEY) {
      return bad(res, 500, "Missing OPENAI_API_KEY");
    }

    const body = (req.body || {}) as {
      brand?: string;
      snapshot?: Snapshot;
      // If snapshot not provided, we’ll fetch & aggregate from Supabase:
      filters?: { domain?: string; team?: string; role?: string; sinceDays?: number };
    };

    const brand = body.brand || "The Elysium Group";
    const system = buildSystemPrompt(brand);

    let userPrompt = "";
    let meta: any = {};
    if (body.snapshot?.scores?.length) {
      // Direct mode
      userPrompt = buildUserPromptFromSnapshot(body.snapshot, brand);
      meta.mode = "direct";
    } else {
      // Supabase mode (aggregate)
      const { rows, snapshots } = await fetchFromSupabase(body.filters || {});
      if (!snapshots.length) {
        return bad(res, 404, "No assessments found for the given filters.");
      }
      const agg = aggregateSnapshots(snapshots);
      userPrompt = buildUserPromptFromAggregate(agg, brand, body.filters);
      meta.mode = "aggregate";
      meta.sample = agg.n;
    }

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
          { role: "system", content: system },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    if (!r.ok) {
      const detail = await r.text().catch(() => "");
      return bad(res, 500, "OpenAI error", detail);
    }

    const data = await r.json();
    const text = data?.choices?.[0]?.message?.content || "";

    okCORS(res);
    return res.status(200).json({ ok: true, meta, text });
  } catch (e: any) {
    console.error("analyze error:", e);
    return bad(res, 500, "server", e?.message || String(e));
  }
}
