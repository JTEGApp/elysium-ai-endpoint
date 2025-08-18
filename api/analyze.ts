import type { VercelRequest, VercelResponse } from "@vercel/node";

// Optional: a stable matrix you can tailor over time.
// This “Chosen XIII + 8 Styles” scaffold is used to anchor the model.
const CHOSEN_MATRIX = {
  styles: {
    Caring: {
      strengths: [
        "Trust, collaboration, and retention",
        "Psychological safety and cross-team support",
      ],
      watchouts: [
        "Consensus drag on decisions",
        "Performance avoidance in tough calls",
      ],
      leadership_behaviors: [
        "Frequent 1:1s and skip-levels",
        "Gratitude rituals; amplify peer recognition",
      ],
      metrics: ["eNPS verbatims on support", "Internal mobility / retention"],
    },
    "Purpose-Driven": {
      strengths: [
        "Motivation from meaning; clarity of why",
        "Resilience during setbacks",
      ],
      watchouts: [
        "Mission-over-math bias",
        "Under-investment in operational excellence",
      ],
      leadership_behaviors: [
        "Tie goals to customer impact",
        "Narrate purpose in weekly business reviews",
      ],
      metrics: ["Customer outcome KPIs", "Roadmap value realisation"],
    },
    Learning: {
      strengths: ["Experiment velocity", "Knowledge sharing"],
      watchouts: ["Churn without kill-rules", "Pet experiments"],
      leadership_behaviors: [
        "Pre-mortems / post-mortems",
        "Monthly ‘what we learned’ demos",
      ],
      metrics: ["Exp/quarter", "Time-to-decision", "Re-usable learnings"],
    },
    Enjoyment: {
      strengths: ["Energy and momentum", "Employer brand lift"],
      watchouts: ["Shiny-object drift", "Uneven execution depth"],
      leadership_behaviors: [
        "Celebrate small wins",
        "Manage energy: sprint–recover cycles",
      ],
      metrics: ["Participation in rituals", "Cycle time trend"],
    },
    "Results-Oriented": {
      strengths: ["Focus, accountability, throughput"],
      watchouts: ["Short-termism", "Burnout risk"],
      leadership_behaviors: [
        "3 metrics that matter per team",
        "Weekly commit-review; unblock quickly",
      ],
      metrics: ["On-time delivery", "Outcome vs. output"],
    },
    Authority: {
      strengths: ["Decisiveness; crisp calls", "Clear ownership"],
      watchouts: ["Voice/psych safety erosion", "Single-threaded failure modes"],
      leadership_behaviors: [
        "Decision logs with rationale",
        "Escalation SLAs; clarify DRI",
      ],
      metrics: ["Decision latency", "Escalation resolution time"],
    },
    Safety: {
      strengths: ["Reliability and quality", "Customer trust"],
      watchouts: ["Over-controls; slow cycles", "Gold-plating"],
      leadership_behaviors: [
        "Guardrails, not gates",
        "Error budgets; blameless postmortems",
      ],
      metrics: ["Incident rate/MTTR", "Defect escape rate"],
    },
    "Order-Oriented": {
      strengths: ["Predictability; scalable ops", "Role clarity"],
      watchouts: ["Process over outcomes", "Bureaucratic drag"],
      leadership_behaviors: [
        "Sunset unused processes quarterly",
        "SLA-based handoffs",
      ],
      metrics: ["Lead time", "Handoff rework rate"],
    },
  },
  // “Chosen XIII” – leadership capability lenses (example scaffold)
  chosenXIII: [
    "Strategy clarity",
    "Customer obsession",
    "Decisiveness & speed",
    "Talent density",
    "Coaching & feedback",
    "Cross-functional execution",
    "Operational rigor",
    "Learning & innovation",
    "Accountability systems",
    "Purpose & narrative",
    "Change leadership",
    "Risk & controls",
    "Resource allocation",
  ],
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS preflight
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "content-type, authorization");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    return res.status(200).end();
  }
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    // You told me this should be “gpt-5”
    const MODEL = process.env.OPENAI_MODEL || "gpt-5";
    if (!OPENAI_API_KEY) {
      return res.status(500).json({ error: "Missing OPENAI_API_KEY" });
    }

    const { snapshot, referenceNotes = [], brand, sources = [] } = req.body || {};
    if (!snapshot?.scores || !Array.isArray(snapshot.scores)) {
      return res.status(400).json({ error: "Missing snapshot.scores (array required)" });
    }

    // NB: Some models don’t accept custom temperatures — omit unless you’re sure it’s supported.
    // Also, keep requests compact for Vercel function time limits.
    const system = `
You are an elite organizational culture and leadership transformation advisor at "${brand || "The Elysium Group"}".
Audience: time-constrained corporate executives trying to align culture and leadership to corporate priorities and business performance
Tone: premium, plain-spoken, direct. Include numeric scores in the prose.

Ground truth scaffolds are provided (8 Culture Styles & The Chosen XIII). Use them to
anchor leadership behaviors, risks, and metrics. Do not invent citations. If 'sources'
are provided, you may quote or summarize them and surface the links as "Suggested reading".
Otherwise, use generic, non-branded case vignettes without naming specific companies.

Return a single Markdown document in this outline:

# Executive Summary
- 3–5 bullets on the signal in this data (strengths, tensions, direction)

# Current Culture Profile
- Brief on dominant/lagging styles with positives and watchouts (no numbers)
- “What this looks like on the ground” (2–4 bullets)

# Leadership Needs & Risks (Chosen XIII lens)
- The 4–6 capabilities that matter most now and why
- Clear risks if left unaddressed

# Gaps & Opportunities
- Where execution is leaking energy (tie to styles + XIII)
- Where small moves create outsized impact

# 90-Day Priorities
- 3–5 moves with owners/rituals/decision rules
- What to stop, start, continue

# 12-Month Horizon
- End-state narrative of ways of working
- Operating metrics that prove it’s working

# Metrics to Watch
- Leading & lagging indicators (no vanity metrics)

# Suggested Reading / Cases (optional)
- If 'sources' are provided, list them with 1-line “why it’s relevant”.
`;

    const compactScores = snapshot.scores.map((s: any) => ({
      key: s.key,
      style: s.style || s.key,
      current: s.current, // numeric for analysis; not to be surfaced as numbers in prose
    }));

    const user = {
      referenceNotes,
      matrix: CHOSEN_MATRIX,
      snapshot: {
        scores: compactScores,
        top3: snapshot.top3 || {},
      },
      sources, // optional array of {title, url, why} you pass from the UI
    };

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        // DO NOT set temperature if your account/model rejects it.
        messages: [
          { role: "system", content: system },
          { role: "user", content: JSON.stringify(user) },
        ],
      }),
    });

    if (!r.ok) {
      const detail = await r.text();
      return res.status(502).json({ error: "OpenAI error", detail });
    }

    const data = await r.json();
    const text = data?.choices?.[0]?.message?.content || "";
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "content-type, authorization");
    return res.status(200).json({ text });
  } catch (e: any) {
    console.error("Server error:", e);
    return res.status(500).json({ error: "server", detail: e?.message || String(e) });
  }
}
