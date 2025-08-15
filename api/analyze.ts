// api/analyze.ts
import OpenAI from "openai";

// Load environment variables
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Static reference for The Chosen XIII + 8 Culture Styles
// This is condensed for demonstration — replace with your detailed descriptions.
const CULTURE_MATRIX = `
THE CHOSEN XIII — Leadership Competencies:
1. Strategic Vision
2. Operational Excellence
3. Innovation Mindset
4. Talent Development
5. Cross-functional Collaboration
6. Decision-making Under Pressure
7. Ethical Leadership
8. Financial Acumen
9. Change Leadership
10. Customer Centricity
11. Global Perspective
12. Influence & Communication
13. Resilience

EIGHT CULTURE STYLES:
1. Caring — Relationships, mutual trust, collaboration.
2. Purpose — Idealism, shared cause, values-driven.
3. Learning — Creativity, curiosity, exploration.
4. Enjoyment — Fun, excitement, playfulness.
5. Results — Achievement, winning, goal orientation.
6. Authority — Boldness, decisiveness, dominance.
7. Safety — Planning, caution, risk management.
8. Order — Respect, structure, shared norms.
`;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { scores, top3, followups, raw_answers } = req.body;

    // Use gpt-5 by default unless overridden
    const model = process.env.OPENAI_MODEL || "gpt-5";

    const prompt = `
You are an expert in corporate culture and leadership transformation.
You have access to the following reference framework:
${CULTURE_MATRIX}

The following is the cumulative assessment data for a company:
- Scores by culture style and leadership competency: ${JSON.stringify(scores, null, 2)}
- Top 3 culture styles observed: ${JSON.stringify(top3, null, 2)}
- Follow-up responses: ${JSON.stringify(followups, null, 2)}
- Raw answers: ${JSON.stringify(raw_answers, null, 2)}

TASK:
1. Provide a detailed **executive-level analysis** of the organization's current culture and leadership profile.
2. Identify **strengths** in culture and leadership that directly contribute to achieving improved business outcomes.
3. Identify **gaps** and **risks** — highlight how these may affect strategic goals, talent retention, innovation, and market competitiveness.
4. Provide **actionable recommendations** for leadership and culture transformation, prioritizing the most critical changes.
5. Integrate **case studies** or examples from high-performing organizations that successfully addressed similar challenges.
6. Ensure your tone is analytical, authoritative, and insightful — suitable for a CEO or board-level audience.

Begin your report with an **Executive Summary**, then break down each section clearly.
    `;

    const completion = await openai.chat.completions.create({
      model,
      messages: [
        { role: "system", content: "You are a senior culture and leadership transformation advisor for Fortune 500 executives." },
        { role: "user", content: prompt }
      ],
      temperature: 0.3,
      max_tokens: 2000
    });

    const output = completion.choices[0]?.message?.content || "";

    return res.status(200).json({ report: output });
  } catch (error) {
    console.error("AI analysis error:", error);
    return res.status(500).json({ error: "Failed to generate analysis" });
  }
}
