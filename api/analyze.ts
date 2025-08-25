// api/analyze.ts
import type { VercelRequest, VercelResponse } from 'vercel';

type ScoreRow = { key: string; style?: string; current: number };
type Snapshot = { scores: ScoreRow[]; top3?: { observed?: string[]; personal?: string[] } };

const MODEL = process.env.OPENAI_MODEL || 'gpt-5';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;

// Stable culture style matrix (editable): label + “helps/hurts” one-liners used in the narrative
const STYLE_MATRIX: Record<
  string,
  { label: string; strengths: string[]; risks: string[] }
> = {
  caring: {
    label: 'Caring (Collaboration & Trust)',
    strengths: [
      'High relational trust improves retention and knowledge sharing',
      'Customer empathy tends to increase CSAT and NPS'
    ],
    risks: [
      'Conflict avoidance can slow decisions',
      'Consensus culture may dilute accountability'
    ]
  },
  purpose: {
    label: 'Purpose-Driven (Mission & Impact)',
    strengths: [
      'Mission clarity aligns teams and reduces strategic thrash',
      'Strong hiring magnet for values-aligned talent'
    ],
    risks: [
      'Mission drift if not connected to operating targets',
      'Can underweight near-term execution pressure'
    ]
  },
  learning: {
    label: 'Learning (Innovation & Curiosity)',
    strengths: [
      'Experimentation increases adaptability and time-to-insight',
      'Post-mortems raise institutional memory'
    ],
    risks: [
      'Unbounded experimentation erodes focus',
      'Risk aversion kills ideas before validation'
    ]
  },
  enjoyment: {
    label: 'Enjoyment (Energy & Momentum)',
    strengths: [
      'Celebrating wins sustains pace',
      'Positive affect improves cross-team cooperation'
    ],
    risks: [
      'Can mask hard trade-offs',
      'May be perceived as “style over substance” if metrics lag'
    ]
  },
  results: {
    label: 'Results-Oriented (Performance & Outcomes)',
    strengths: [
      'Clear goals and tracking drive throughput',
      'Metric discipline reveals what works quickly'
    ],
    risks: [
      'Over-pressure risks burnout and corner-cutting',
      'Short-termism weakens innovation capacity'
    ]
  },
  authority: {
    label: 'Authority (Decisiveness & Control)',
    strengths: [
      'Fast, clear calls reduce decision latency',
      'Useful in high-ambiguity or crisis environments'
    ],
    risks: [
      'Top-down bias suppresses IC agency and ideas',
      'Single-threaded leadership becomes a bottleneck'
    ]
  },
  safety: {
    label: 'Safety (Risk Management & Reliability)',
    strengths: [
      'Quality and reliability reduce rework and reputational risk',
      'Great base for regulated industries'
    ],
    risks: [
      'Change friction delays time-to-market',
      'Over-control shrinks experimentation surface area'
    ]
  },
  order: {
    label: 'Order-Oriented (Process & Consistency)',
    strengths: [
      'Clear handoffs and SOPs improve scale efficiency',
      'Predictability supports distributed execution'
    ],
    risks: [
      'Process ossification stifles speed',
      'Excessive controls create compliance theater'
    ]
  }
};

// --- helpers ---
function bad(res: VercelResponse, status: number, msg: string, detail?: any) {
  res.status(status).json({ error: msg, detail });
}

function asPrettyScores(scores: ScoreRow[]) {
  const sorted = [...scores].sort((a, b) => (b.current ?? 0) - (a.current ?? 0));
  return sorted.map(s => ({
    key: s.key,
    label: STYLE_MATRIX[s.key]?.label || s.style || s.key,
    current: s.current
  }));
}

// prompt: instructs JSON with sections for exec report
function buildPrompt(brand: string, snapshot: Snapshot, orgMeta?: any) {
  const pretty = asPrettyScores(snapshot.scores);
  const topPersonal = snapshot.top3?.personal || [];
  const company = orgMeta?.company || orgMeta?.domain || '';
  const industry = orgMeta?.industry || '';

  // Lightly formatted, deterministic style with explicit structure
  return [
    {
      role: 'system',
      content:
        `You are a seasoned culture & leadership advisor creating executive-ready reports for The Elysium Group. ` +
        `Audience: C-suite. Tone: plain-spoken, premium, concise. ` +
        `Avoid numeric scores in prose; describe relative strength (e.g., “strong, emerging, weak”) unless placing a data snippet table. ` +
        `Link culture patterns to measurable business outcomes (growth, margin, cycle time, quality, retention). ` +
        `Where relevant, include brief case-style examples that a reader could research (company name + 1-line lesson). ` +
        `Return ONLY JSON matching the schema I will give you. No markdown.`
    },
    {
      role: 'user',
      content: JSON.stringify({
        instruction: 'Produce a complete executive culture report as JSON.',
        brand,
        org: { company, industry },
        inputs: {
          scores: pretty,
          topPersonal,
          matrix: STYLE_MATRIX
        },
        schema: {
          type: 'object',
          required: [
            'executiveSummary',
            'methodology',
            'currentState',
            'leadershipImplications',
            'risks',
            'gapsAndOpportunities',
            'recommendedActions',
            'expectedBusinessImpact',
            'appendix'
          ],
          properties: {
            executiveSummary: { type: 'string' },
            methodology: { type: 'string' },
            currentState: {
              type: 'object',
              properties: {
                styleHighlights: { type: 'array', items: { type: 'string' } },
                table: {
                  type: 'array',
                  items: { type: 'object', properties: { label: { type: 'string' }, relative: { type: 'string' } } }
                },
                personalTop3: { type: 'array', items: { type: 'string' } }
              }
            },
            leadershipImplications: { type: 'array', items: { type: 'string' } },
            risks: { type: 'array', items: { type: 'string' } },
            gapsAndOpportunities: { type: 'array', items: { type: 'string' } },
            recommendedActions: {
              type: 'object',
              properties: {
                days90: { type: 'array', items: { type: 'string' } },
                months12: { type: 'array', items: { type: 'string' } },
                operatingMechanisms: { type: 'array', items: { type: 'string' } }
              }
            },
            expectedBusinessImpact: {
              type: 'array',
              items: { type: 'string' }
            },
            caseBriefs: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  org: { type: 'string' },
                  lesson: { type: 'string' }
                }
              }
            },
            appendix: {
              type: 'object',
              properties: {
                notes: { type: 'array', items: { type: 'string' } },
                assumptions: { type: 'array', items: { type: 'string' } }
              }
            }
          }
        }
      })
    }
  ];
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    return res.status(204).end();
  }

  try {
    const { brand = 'The Elysium Group', snapshot, orgMeta } = req.body || {};

    if (!snapshot || !Array.isArray(snapshot.scores) || snapshot.scores.length === 0) {
      return bad(res, 400, 'Missing snapshot.scores (array required)');
    }
    if (!OPENAI_API_KEY) return bad(res, 500, 'Server not configured (missing OPENAI_API_KEY)');

    const messages = buildPrompt(brand, snapshot as Snapshot, orgMeta);
    // OpenAI Chat Completions (JSON mode)
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: MODEL,
        // Some models only accept default temperature—omit custom values
        messages,
        response_format: { type: 'json_object' }
      })
    });

    if (!r.ok) {
      const detail = await r.text().catch(() => '');
      return bad(res, r.status, 'OpenAI error', detail);
    }
    const data = await r.json();
    const content = data?.choices?.[0]?.message?.content || '{}';

    // Pass-through JSON (client can render & export)
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(200).json(JSON.parse(content));
  } catch (e: any) {
    return bad(res, 500, 'Unexpected server error', e?.message || String(e));
  }
}
