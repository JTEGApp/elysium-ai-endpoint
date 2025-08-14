// api/analyze.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";

// Optional: CSV & XLSX parsing
// You'll need to add "xlsx" as a dependency in the endpoint project.
import * as XLSX from "xlsx";

// ---------- Small utils ----------
function ok(res: VercelResponse, data: any, status = 200) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type, authorization");
  return res.status(status).json(data);
}

function err(res: VercelResponse, error: string, detail?: any, status = 500) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type, authorization");
  return res.status(status).json({ error, detail });
}

async function fetchText(url: string) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Fetch failed ${r.status}`);
  return await r.text();
}

function csvToRows(csv: string): string[][] {
  const lines = csv.split(/\r?\n/).filter(Boolean);
  return lines.map((l) =>
    // a very light CSV split (no quoted-field handling). If you need full CSV fidelity, swap for a CSV lib.
    l.split(",").map((s) => s.trim())
  );
}

function xlsxBase64ToRows(b64: string): string[][] {
  const buf = Buffer.from(b64, "base64");
  const wb = XLSX.read(buf, { type: "buffer" });
  const sheetName = wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  const aoa = XLSX.utils.sheet_to_json<string[]>({
    ...sheet,
  }, { header: 1 }) as any[];
  return (aoa || []).map((row: any[]) => row.map(String));
}

/**
 * Normalize any matrix shape into a compact, model-friendly object.
 * Expected logical meaning:
 * - Either a header row with culture styles and “Chosen XIII” items as rows,
 *   or vice-versa.
 * - We reduce to { cultures: string[], chosen: string[], weights: number[][] }
 *   where weights[i][j] indicates the strength/relationship of chosen[i] to cultures[j].
 */
function normalizeMatrixFromRows(rows: string[][]) {
  if (!rows.length) return null;

  // Heuristic: detect if first row is header of cultures
  // Assume first cell is blank or "Item"/"Chosen" style
  const header = rows[0].map((s) => s?.trim());
  const body = rows.slice(1);

  // If header is likely cultures:
  const cultures = header.slice(1).filter(Boolean);
  const chosen: string[] = [];
  const weights: number[][] = [];

  for (const r of body) {
    if (!r.length) continue;
    const label = (r[0] || "").trim();
    if (!label) continue;
    chosen.push(label);
    const rowWeights = r.slice(1).map((x) => {
      const n = Number(x);
      return isFinite(n) ? n : 0;
    });
    // pad to cultures length
    while (rowWeights.length < cultures.length) rowWeights.push(0);
    weights.push(rowWeights);
  }

  if (!cultures.length || !chosen.length) return null;

  return { cultures, chosen, weights };
}

/**
 * Try to produce a compact JSON structure usable by the model from any provided matrix input.
 * Priority: matrixJson > matrixCsv > matrixXlsxBase64 > matrixUrl
 */
async function getNormalizedMatrix(body: any) {
  // 1) Direct JSON
  if (body?.matrixJson && typeof body.matrixJson === "object") {
    // Expect { cultures:string[], chosen:string[], weights:number[][] } OR raw rows: string[][]
    if (Array.isArray(body.matrixJson?.cultures) &&
        Array.isArray(body.matrixJson?.chosen) &&
        Array.isArray(body.matrixJson?.weights)) {
      return body.matrixJson;
    }
    if (Array.isArray(body.matrixJson?.rows)) {
      const nm = normalizeMatrixFromRows(body.matrixJson.rows);
      if (nm) return nm;
    }
  }

  // 2) CSV string
  if (typeof body?.matrixCsv === "string" && body.matrixCsv.trim()) {
    const rows = csvToRows(body.matrixCsv);
    const nm = normalizeMatrixFromRows(rows);
    if (nm) return nm;
  }

  // 3) XLSX base64
  if (typeof body?.matrixXlsxBase64 === "string" && body.matrixXlsxBase64.trim()) {
    try {
      const rows = xlsxBase64ToRows(body.matrixXlsxBase64);
      const nm = normalizeMatrixFromRows(rows);
      if (nm) return nm;
    } catch {
      // ignore parse errors
    }
  }

  // 4) matrixUrl (supports CSV/JSON/XLSX naive detection by extension)
  if (typeof body?.matrixUrl === "string" && /^https?:\/\//.test(body.matrixUrl)) {
    const url = body.matrixUrl;
    const lower = url.toLowerCase();
    const txt = await fetchText(url);

    if (lower.endsWith(".csv")) {
      const rows = csvToRows(txt);
      const nm = normalizeMatrixFromRows(rows);
      if (nm) return nm;
    }
    if (lower.endsWith(".json")) {
      const j = JSON.parse(txt);
      if (Array.isArray(j?.cultures) && Array.isArray(j?.chosen) && Array.isArray(j?.weights)) {
        return j;
      }
      if (Array.isArray(j?.rows)) {
        const nm = normalizeMatrixFromRows(j.rows);
        if (nm) return nm;
      }
    }
    if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) {
      // We can't read binary via simple fetch in all environments reliably; prefer base64 in request for XLSX.
      // If you need remote XLSX parsing, fetch as ArrayBuffer and pass to XLSX.read. Skipping here for simplicity.
    }
  }

  return null;
}

// ---------- Handler ----------
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS preflight
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "content-type, authorization");
    return res.status(200).end();
  }
  if (req.method !== "POST") {
    return err(res, "Method not allowed", undefined, 405);
  }

  try {
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5";
    const OPENAI_BASE = process.env.OPENAI_API_BASE || "https://api.openai.com/v1";

    if (!OPENAI_API_KEY) {
      return err(res, "Missing OPENAI_API_KEY", undefined, 500);
    }

    const { snapshot, referenceNotes, brand } = req.body || {};
    if (!snapshot?.scores) {
      return err(res, "Missing snapshot.scores", undefined, 400);
    }

    // Attempt to load & normalize the Chosen XIII x Culture Styles alignment matrix
    const normalizedMatrix = await getNormalizedMatrix(req.body);

    const system = `
You are an executive culture & leadership advisor for "${brand || "The Elysium Group"}".
Audience: senior corporate executives. Premium, plain-spoken, and incisive. 
Do not show numeric scores in the prose; keep numbers for labels or tables only if asked.
Link culture, leadership, and business outcomes. Where helpful, add concise real-world examples/case references.
Use the HBR 8 culture styles: Caring, Purpose, Learning, Enjoyment, Results, Authority, Safety, Order.

If a "Chosen XIII ↔ 8 Culture Styles" alignment matrix is provided, use it to:
- Detect areas of over/under-emphasis by cross-referencing the style profile and the XIII capabilities.
- Surface leadership gaps & strengths that are most material to outcomes.
- Recommend focused 90-day rituals, operating mechanisms, and talent moves that align styles to strategy.

Return a JSON with fields:
{
  "executiveSummary": string[], // 3–6 bullets
  "strengths": string[],        // 3–6 bullets
  "priorityShifts": string[],   // 3–5 bullets
  "leadershipMoves": string[],  // 4–8 crisp, concrete actions/rituals
  "risksAndSignals": string[],  // what to watch + leading indicators
  "caseReferences": string[]    // short, relevant examples (1–4 lines each)
}
`.trim();

    // Summarize the matrix compactly for the model (if present)
    const matrixNote = normalizedMatrix
      ? `
Alignment Matrix (normalized):
- Cultures: ${normalizedMatrix.cultures.join(", ")}
- Chosen XIII: ${normalizedMatrix.chosen.join(", ")}
- Weights: 2D numeric array mapping chosen[i] -> culture[j] emphasis.
    `.trim()
      : "(No alignment matrix provided - proceed without it)";

    const user = `
Snapshot (no numeric prose, just structure):
${JSON.stringify(snapshot, null, 2)}

Reference notes:
${(referenceNotes || []).join("\n")}

${matrixNote}
`.trim();

    const r = await fetch(`${OPENAI_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        temperature: 0.35,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (!r.ok) {
      const detail = await r.text().catch(() => "");
      return err(res, "OpenAI error", detail, 500);
    }

    const data = await r.json();
    let text = data?.choices?.[0]?.message?.content ?? "";
    // If the model returns invalid JSON (rare), wrap safely
    let structured: any = null;
    try {
      structured = JSON.parse(text);
    } catch {
      structured = { raw: text };
    }

    return ok(res, {
      model: OPENAI_MODEL,
      usedMatrix: Boolean(normalizedMatrix),
      result: structured,
    });
  } catch (e: any) {
    console.error("Server error:", e);
    return err(res, "server", e?.message || String(e), 500);
  }
}
