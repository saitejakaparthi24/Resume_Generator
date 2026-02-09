import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import OpenAI from "openai";
import path from "path";
import { fileURLToPath } from "url";
import { Document, Packer, Paragraph, TextRun, UnderlineType } from "docx";
import bcrypt from "bcrypt";
import session from "express-session";
import pg from "pg";
import connectPgSimple from "connect-pg-simple";
import PDFDocument from "pdfkit";
import fs from "fs";
import fetch from "node-fetch";
import { JSDOM } from "jsdom";


dotenv.config();

const app = express();

// -------------------- DB --------------------
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// -------------------- Middleware --------------------
app.use(cors({ origin: "http://localhost:5000", credentials: true }));
app.use(express.json());

// -------------------- Sessions (Postgres Store) --------------------
const PgSession = connectPgSimple(session);
app.use(
  session({
    store: new PgSession({
      pool,
      tableName: "user_sessions",
      createTableIfMissing: true,
    }),
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      maxAge: 1000 * 60 * 60 * 8,
    },
  })
);

// -------------------- Static files --------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use(express.static(path.join(__dirname, "public"), { index: false }));

// -------------------- Helpers --------------------
function requireAuth(req, res, next) {
  if (!req.session?.user) return res.status(401).json({ error: "Not authenticated" });
  next();
}

function normalizeLine(line) {
  return (line || "")
    .replace(/\r/g, "")
    .replace(/\u00A0/g, " ")
    .replace(/\u200B/g, "")
    .replace(/\t/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function safePart(s, fallback) {
  const t = (s || "").toString().trim();
  if (!t) return fallback;

  return t
    .replace(/[\/\\:*?"<>|]/g, "")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}

// First line example: "Saiteja Kaparthi - SDET"
function extractFirstNameAndTitle(resumeMarkdown) {
  const lines = (resumeMarkdown || "")
    .split("\n")
    .map((l) => (l || "").trim())
    .filter(Boolean);

  const firstLine = lines[0] || "";
  const parts = firstLine.split(/\s*[-–—]\s*/);

  const left = (parts[0] || "").trim();
  const firstName = left.split(/\s+/)[0] || "User";
  const title = (parts[1] || "").trim() || "Role";

  return { firstName, title };
}

function parseBoldSegments(text) {
  const parts = String(text || "").split("**");
  const segs = [];
  for (let i = 0; i < parts.length; i++) {
    if (!parts[i]) continue;
    segs.push({ text: parts[i], bold: i % 2 === 1 });
  }
  return segs.length ? segs : [{ text: String(text || ""), bold: false }];
}

// -------------------- JSON helpers --------------------
function stripStars(s) {
  return String(s || "").replace(/\*\*/g, "").trim();
}

// Prevent "usingVertex" joins if model returns adjacent segments without spaces
function normalizeInlineSpacing(inline) {
  if (!Array.isArray(inline)) return [{ t: "", b: false }];

  const out = [];
  for (const seg of inline) {
    const tRaw = String(seg?.t ?? "");
    if (!tRaw) continue;

    let t = tRaw.replace(/\u00A0/g, " ");

    const prev = out[out.length - 1];
    if (prev) {
      const prevEndsSpace = /\s$/.test(prev.t);
      const curStartsSpace = /^\s/.test(t);
      const curStartsPunct = /^[,.;:!?)]/.test(t);

      if (!prevEndsSpace && !curStartsSpace && !curStartsPunct) {
        prev.t += " ";
      }
    }

    out.push({ t, b: !!seg?.b });
  }

  // merge adjacent same-bold after spacing fix
  const merged = [];
  for (const s of out) {
    const last = merged[merged.length - 1];
    if (last && last.b === s.b) last.t += s.t;
    else merged.push({ t: s.t, b: s.b });
  }
  return merged.length ? merged : [{ t: "", b: false }];
}

function normalizeInline(inline) {
  if (!Array.isArray(inline)) return [{ t: "", b: false }];

  const cleaned = [];
  for (const seg of inline) {
    const t = stripStars(seg?.t ?? "").replace(/\u00A0/g, " ");
    if (!t) continue;
    cleaned.push({ t, b: !!seg?.b });
  }
  return normalizeInlineSpacing(cleaned);
}

function isValidResumeJson(x) {
  if (!x || typeof x !== "object") return false;
  if (!x.header || typeof x.header !== "object") return false;
  if (!Array.isArray(x.sections)) return false;
  return true;
}

// Convert resumeJson -> markdown (NO company location + NO extra pipes)
function resumeJsonToMarkdown(resumeJson) {
  const h = resumeJson.header || {};
  const out = [];

  const headerLine1 = `${stripStars(h.name || "")} - ${stripStars(h.title || "")}`.trim();
  const headerLine2 = [
    stripStars(h.phone || ""),
    stripStars(h.email || ""),
    stripStars(h.location || ""),
  ].filter(Boolean).join(" | ");

  if (headerLine1) out.push(headerLine1);
  if (headerLine2) out.push(headerLine2);
  out.push("");

  for (const sec of resumeJson.sections || []) {
    const heading = String(sec.heading || "").toUpperCase().trim();
    if (heading) {
      out.push(heading);
      out.push("");
    }

    if (sec.type === "summary") {
      const line = normalizeInline(sec.inline)
        .map((seg) => (seg.b ? `**${seg.t}**` : seg.t))
        .join("");
      out.push(line);
      out.push("");
      continue;
    }

    if (sec.type === "skills") {
      for (const g of sec.groups || []) {
        const label = stripStars(g.label || "");
        const items = Array.isArray(g.items) ? g.items.map(stripStars).filter(Boolean) : [];
        out.push(`**${label}**: ${items.join(", ")}`);
      }
      out.push("");
      continue;
    }

    if (sec.type === "experience") {
      for (const r of sec.roles || []) {
        const roleTitle = stripStars(r.roleTitle || "");
        const company = stripStars(r.company || "");
        const start = stripStars(r.start || "");
        const end = stripStars(r.end || "");

        // ✅ no location + only ONE pipe
        out.push(`**${roleTitle}** @ ${company} | ${start} – ${end}`);

        for (const b of r.bullets || []) {
          const line = normalizeInline(b.inline)
            .map((seg) => (seg.b ? `**${seg.t}**` : seg.t))
            .join("");
          out.push(`- ${line}`);
        }
        out.push("");
      }
      continue;
    }

    if (sec.type === "education" || sec.type === "generic") {
      for (const it of sec.items || []) {
        const line = normalizeInline(it.inline)
          .map((seg) => (seg.b ? `**${seg.t}**` : seg.t))
          .join("");
        out.push(line);
      }
      out.push("");
      continue;
    }

    // fallback
    if (Array.isArray(sec.items)) {
      for (const it of sec.items) {
        const line = normalizeInline(it.inline)
          .map((seg) => (seg.b ? `**${seg.t}**` : seg.t))
          .join("");
        out.push(line);
      }
      out.push("");
    }
  }

  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

// -------------------- Pages routing --------------------
app.get("/", (req, res) => {
  if (req.session?.user) return res.redirect("/app");
  return res.redirect("/login");
});

app.get("/login", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

app.get("/app", (req, res) => {
  if (!req.session?.user) return res.redirect("/login");
  res.sendFile(path.join(__dirname, "public", "app.html"));
});

// -------------------- OpenAI --------------------
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// -------------------- Auth APIs --------------------
app.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: "username and password are required" });
    }

    const { rows } = await pool.query(
      "SELECT id, username, firstname, lastname, password_hash FROM users WHERE username=$1",
      [username]
    );
    if (rows.length === 0) return res.status(401).json({ error: "Invalid credentials" });

    const user = rows[0];
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: "Invalid credentials" });

    req.session.user = {
      id: user.id,
      username: user.username,
      firstname: user.firstname,
      lastname: user.lastname,
    };

    res.json({ message: "Login successful", user: req.session.user });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Login failed" });
  }
});

app.get("/me", requireAuth, (req, res) => {
  res.json({ user: req.session.user });
});

app.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("connect.sid");
    res.json({ message: "Logged out" });
  });
});

// -------------------- Resume generation (JSON) --------------------
app.post("/generate-resume-json", requireAuth, async (req, res) => {
  try {
    const { jobDescription } = req.body || {};
    if (!jobDescription || !String(jobDescription).trim()) {
      return res.status(400).json({ error: "jobDescription is required" });
    }

    const userId = req.session.user.id;
    const { rows } = await pool.query(
      "SELECT template_markdown, custom_instructions FROM resume_templates WHERE user_id=$1",
      [userId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "No resume template found for this user" });
    }

    const resumeTemplate = rows[0].template_markdown;
    const instructionsSchema = rows[0].custom_instructions;
const prompt = `
You are a senior technical resume writer and ATS specialist.

Return ONLY valid JSON (no markdown, no code fences, no commentary).
DO NOT include "**" anywhere in the output.
Bold must be represented ONLY using inline segments: {"t":"text","b":true}.

${instructionsSchema}

Job Description:
${jobDescription}

Resume Template:
${resumeTemplate}
`;


    const response = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [{ role: "user", content: prompt }],
    });

    const raw = response?.choices?.[0]?.message?.content || "";
    let resumeJson;

    try {
      resumeJson = JSON.parse(raw);
    } catch (e) {
      console.error("JSON parse failed. Raw:", raw);
      return res.status(500).json({ error: "Model did not return valid JSON. Try again." });
    }

    if (!isValidResumeJson(resumeJson)) {
      return res.status(500).json({ error: "Invalid resume JSON. Try again." });
    }

    // sanitize headings + inline arrays
    resumeJson.header = {
      name: stripStars(resumeJson.header?.name),
      title: stripStars(resumeJson.header?.title),
      email: stripStars(resumeJson.header?.email),
      phone: stripStars(resumeJson.header?.phone),
      location: stripStars(resumeJson.header?.location),
    };

    if (Array.isArray(resumeJson.sections)) {
      for (const sec of resumeJson.sections) {
        sec.heading = String(sec.heading || "").toUpperCase().trim();

        if (sec.type === "summary") sec.inline = normalizeInline(sec.inline);

        if (sec.type === "skills" && Array.isArray(sec.groups)) {
          sec.groups = sec.groups.map(g => ({
            label: stripStars(g.label),
            items: Array.isArray(g.items) ? g.items.map(stripStars) : []
          }));
        }

        if (sec.type === "experience" && Array.isArray(sec.roles)) {
          sec.roles = sec.roles.map(r => ({
            roleTitle: stripStars(r.roleTitle),
            company: stripStars(r.company),
            start: stripStars(r.start),
            end: stripStars(r.end),
            bullets: Array.isArray(r.bullets)
              ? r.bullets.map(b => ({ inline: normalizeInline(b.inline) }))
              : []
          }));
        }

        if ((sec.type === "education" || sec.type === "generic") && Array.isArray(sec.items)) {
          sec.items = sec.items.map(it => ({ inline: normalizeInline(it.inline) }));
        }

        // fallback sanitize any items
        if (!sec.type && Array.isArray(sec.items)) {
          sec.items = sec.items.map(it => ({ inline: normalizeInline(it.inline) }));
        }
      }
    }

    res.json({ resumeJson });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to generate resume JSON" });
  }
});

// -------------------- Word download (accepts resumeJson OR resumeMarkdown) --------------------
app.post("/download-word", requireAuth, async (req, res) => {
  try {
    const { resumeMarkdown, resumeJson, companyName } = req.body;

    let finalMarkdown = "";
    if (resumeJson && typeof resumeJson === "object") finalMarkdown = resumeJsonToMarkdown(resumeJson);
    else finalMarkdown = resumeMarkdown;

    if (!finalMarkdown || typeof finalMarkdown !== "string") {
      return res.status(400).json({ error: "resumeMarkdown or resumeJson is required" });
    }

    const { firstName, title } = extractFirstNameAndTitle(finalMarkdown);
    const pickedCompany = companyName && String(companyName).trim() ? String(companyName).trim() : "companyname";
    const finalFileName = `${safePart(firstName,"User")}_${safePart(title,"Role")}_${safePart(pickedCompany,"companyname")}.docx`;

    const BASE_FONT = "Arial";
    const BASE_SIZE = 21; // ~10pt
    const PT6 = 120;
    const HEADING_COLOR = "0070C0";
    const PAGE_MARGIN = 180;

    const spacing = (before = 0, after = 0) => ({
      before,
      after,
      line: 288,
      lineRule: "auto",
    });

    function cleanRawLine(rawLine) {
      return normalizeLine(String(rawLine || "").replace(/<<[^>]+>>/g, ""));
    }

    function canonicalHeading(line) {
      let t = line.replace(/^\*\*(.+)\*\*$/, "$1").trim();
      t = t.replace(/[:%\-–—]+$/, "").trim();
      t = normalizeLine(t);
      return t.toUpperCase();
    }

    function parseBoldRunsDocx(text) {
      const parts = String(text || "").split("**");
      const runs = [];
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        if (!part) continue;
        runs.push(
          new TextRun({
            text: part,
            bold: i % 2 === 1,
            font: BASE_FONT,
            size: BASE_SIZE,
            characterSpacing: 10,
          })
        );
      }
      return runs.length
        ? runs
        : [new TextRun({ text: String(text || ""), font: BASE_FONT, size: BASE_SIZE, characterSpacing: 10 })];
    }

    const specialHeadings = new Set([
      "PROFESSIONAL SUMMARY",
      "SUMMARY",
      "EDUCATION",
      "TECHNICAL SKILLS",
      "WORK EXPERIENCE",
      "PROFESSIONAL EXPERIENCE",
      "PROJECTS",
      "VOLUNTEERING",
      "ACHIEVEMENTS",
      "CERTIFICATIONS",
      "PUBLICATIONS",
      "SKILLS"
    ]);

    const isRoleLine = (t) => t.includes("@") && t.includes("|") && t.includes("–");
    const bulletRegex = /^([•●\-])\s*(.+)$/;

    const lines = String(finalMarkdown || "").split("\n");
    const docParagraphs = [];

    for (const rawLine of lines) {
      const line = cleanRawLine(rawLine);
      if (!line) continue;

      const headKey = canonicalHeading(line);

      if (specialHeadings.has(headKey)) {
        docParagraphs.push(
          new Paragraph({
            children: [
              new TextRun({
                text: headKey,
                font: BASE_FONT,
                size: BASE_SIZE,
                bold: true,
                color: HEADING_COLOR,
                underline: { type: UnderlineType.SINGLE, color: HEADING_COLOR },
                characterSpacing: 10,
              }),
            ],
            spacing: spacing(PT6, 0),
            contextualSpacing: false,
          })
        );
        continue;
      }

      if (isRoleLine(line)) {
        docParagraphs.push(
          new Paragraph({
            children: parseBoldRunsDocx(line),
            spacing: spacing(PT6, 0),
            contextualSpacing: false,
          })
        );
        continue;
      }

      const bm = line.match(bulletRegex);
      if (bm) {
        docParagraphs.push(
          new Paragraph({
            children: parseBoldRunsDocx(bm[2]),
            bullet: { level: 0 },
            spacing: spacing(0, 0),
            contextualSpacing: false,
          })
        );
        continue;
      }

      docParagraphs.push(
        new Paragraph({
          children: parseBoldRunsDocx(line),
          spacing: spacing(0, 0),
          contextualSpacing: false,
        })
      );
    }

    const doc = new Document({
      styles: {
        default: {
          document: {
            run: { font: BASE_FONT, size: BASE_SIZE, characterSpacing: 10 },
            paragraph: { spacing: { before: 0, after: 0, line: 276, lineRule: "auto" } },
          },
        },
      },
      sections: [
        {
          properties: {
            page: { margin: { top: PAGE_MARGIN, bottom: PAGE_MARGIN, left: PAGE_MARGIN, right: PAGE_MARGIN } },
          },
          children: docParagraphs,
        },
      ],
    });

    const buffer = await Packer.toBuffer(doc);

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", `attachment; filename="${finalFileName}"`);
    res.send(buffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to generate Word document" });
  }
});

// -------------------- PDF download (accepts resumeJson OR resumeMarkdown) --------------------
app.post("/download-pdf", requireAuth, async (req, res) => {
  try {
    const { resumeMarkdown, resumeJson, companyName } = req.body;

    let finalMarkdown = "";
    if (resumeJson && typeof resumeJson === "object") finalMarkdown = resumeJsonToMarkdown(resumeJson);
    else finalMarkdown = resumeMarkdown;

    if (!finalMarkdown || typeof finalMarkdown !== "string") {
      return res.status(400).json({ error: "resumeMarkdown or resumeJson is required" });
    }

    const { firstName, title } = extractFirstNameAndTitle(finalMarkdown);
    const pickedCompany = companyName && String(companyName).trim() ? String(companyName).trim() : "companyname";
    const finalFileName = `${safePart(firstName,"User")}_${safePart(title,"Role")}_${safePart(pickedCompany,"companyname")}.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${finalFileName}"`);
    res.setHeader("X-Filename", finalFileName);

    const MM = 72 / 25.4;
    const MARGIN_10MM = 3 * MM;
    const GAP_5MM = 1 * MM;
    const ROLE_GAP = 2.5 * MM;
    const HEADING_GAP_BEFORE = 3 * MM;

    const BASE_SIZE = 10;
    const LINE_HEIGHT = 1.28;
    const LINE_GAP = BASE_SIZE * (LINE_HEIGHT - 1);

    const doc = new PDFDocument({
      size: "A4",
      margins: { top: MARGIN_10MM, bottom: MARGIN_10MM, left: MARGIN_10MM, right: MARGIN_10MM },
      autoFirstPage: true,
    });
    doc.pipe(res);

    // Fonts
    const arialPath1 = path.join(__dirname, "public", "fonts", "Arial.ttf");
    const arialPath2 = path.join(__dirname, "public", "fonts", "arial.ttf");
    const arialBoldPath1 = path.join(__dirname, "public", "fonts", "Arial-Bold.ttf");
    const arialBoldPath2 = path.join(__dirname, "public", "fonts", "arialbd.ttf");

    const arialPath = fs.existsSync(arialPath1) ? arialPath1 : arialPath2;
    const arialBoldPath = fs.existsSync(arialBoldPath1) ? arialBoldPath1 : arialBoldPath2;

    const hasArial = fs.existsSync(arialPath);
    const hasArialBold = fs.existsSync(arialBoldPath);

    if (hasArial) doc.registerFont("ARIAL", arialPath);
    if (hasArialBold) doc.registerFont("ARIAL-BOLD", arialBoldPath);

    const FONT_REG = hasArial ? "ARIAL" : "Helvetica";
    const FONT_BOLD = hasArialBold ? "ARIAL-BOLD" : "Helvetica-Bold";

    doc.font(FONT_REG).fontSize(BASE_SIZE).fillColor("#111");

    const specialHeadings = new Set([
      "PROFESSIONAL SUMMARY",
      "SUMMARY",
      "EDUCATION",
      "TECHNICAL SKILLS",
      "WORK EXPERIENCE",
      "PROFESSIONAL EXPERIENCE",
      "PROJECTS",
      "VOLUNTEERING",
      "ACHIEVEMENTS",
      "CERTIFICATIONS",
      "PUBLICATIONS",
      "SKILLS"
    ]);

    const bulletRegex = /^([•●\-])\s*(.+)$/;

    function canonicalHeading(line) {
      let t = line.replace(/^\*\*(.+)\*\*$/, "$1").trim();
      t = t.replace(/[:%\-–—]+$/, "").trim();
      t = normalizeLine(t);
      return t.toUpperCase();
    }

    function writeInlineBold(text) {
      const segs = parseBoldSegments(text);
      segs.forEach((seg, idx) => {
        doc.font(seg.bold ? FONT_BOLD : FONT_REG);
        doc.text(seg.text, { continued: idx !== segs.length - 1, lineGap: LINE_GAP });
      });
      doc.text("");
    }

    function drawHeading(text) {
      doc.font(FONT_BOLD).fontSize(BASE_SIZE).fillColor("#000").text(text, { lineGap: LINE_GAP });

      const underlineY = doc.y - 4.9;
      doc.save()
        .moveTo(doc.page.margins.left, underlineY)
        .lineTo(doc.page.width - doc.page.margins.right, underlineY)
        .lineWidth(0.8)
        .strokeColor("#000")
        .stroke()
        .restore();

      doc.y += GAP_5MM;
      doc.font(FONT_REG).fontSize(BASE_SIZE).fillColor("#111");
    }

    function drawBullet(text) {
      const left = doc.page.margins.left;
      const BULLET_X = left + 3;
      const TEXT_X = left + 14;
      const CONTENT_W = doc.page.width - doc.page.margins.right - TEXT_X;

      const y = doc.y;
      doc.font(FONT_REG).text("•", BULLET_X, y);

      doc.x = TEXT_X;
      doc.y = y;

      const segs = parseBoldSegments(text);
      for (let i = 0; i < segs.length; i++) {
        const seg = segs[i];
        doc.font(seg.bold ? FONT_BOLD : FONT_REG);
        doc.text(seg.text, {
          width: CONTENT_W,
          continued: i !== segs.length - 1,
          lineGap: LINE_GAP,
        });
      }

      doc.text("");
      doc.x = left;
    }

    const lines = String(finalMarkdown).split("\n");

    let inWorkExp = false;
    let lastWasBullet = false;
    let bulletSeqCount = 0;
    let pendingRoleGap = false;

    for (const raw of lines) {
      const line = normalizeLine(String(raw || "").replace(/<<[^>]+>>/g, ""));
      if (!line) continue;

      const headKey = canonicalHeading(line);

      if (specialHeadings.has(headKey)) {
        if (doc.y > doc.page.margins.top + 2) doc.y += HEADING_GAP_BEFORE;
        drawHeading(headKey);

        inWorkExp = headKey === "WORK EXPERIENCE" || headKey === "PROFESSIONAL EXPERIENCE";

        lastWasBullet = false;
        bulletSeqCount = 0;
        pendingRoleGap = false;
        continue;
      }

      const bm = line.match(bulletRegex);
      const isBullet = !!bm;

      if (inWorkExp && !isBullet && lastWasBullet && bulletSeqCount > 0) {
        pendingRoleGap = true;
      }

      if (pendingRoleGap) {
        doc.y += ROLE_GAP;
        pendingRoleGap = false;
        bulletSeqCount = 0;
      }

      if (isBullet) {
        drawBullet(bm[2]);
        lastWasBullet = true;
        bulletSeqCount++;
        continue;
      }

      writeInlineBold(line);
      lastWasBullet = false;
    }

    doc.end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to generate PDF document" });
  }
});

app.post("/extract-jd", requireAuth, async (req, res) => {
  try {
    const { url } = req.body || {};
    if (!url || !String(url).trim()) {
      return res.status(400).json({ error: "URL is required" });
    }

    // -------------------------
    // 1) Fetch HTML
    // -------------------------
    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (ResumeExtractor)" },
      redirect: "follow",
    });

    if (!response.ok) {
      return res.status(400).json({
        error: `Failed to fetch URL (status ${response.status})`,
      });
    }

    const html = await response.text();

    // -------------------------
    // 2) Parse + Clean HTML → Text
    // -------------------------
    const dom = new JSDOM(html);
    const document = dom.window.document;

    // useful signals for company name
    const pageTitle = (document.querySelector("title")?.textContent || "").trim();
    const ogSiteName = (document.querySelector('meta[property="og:site_name"]')?.getAttribute("content") || "").trim();

    let hostname = "";
    try {
      hostname = new URL(url).hostname.replace(/^www\./i, "");
    } catch {}

    // Remove noise
    document
      .querySelectorAll("script, style, nav, footer, header, aside, noscript, svg")
      .forEach((el) => el.remove());

    let rawText = document.body?.textContent || "";
    rawText = rawText.replace(/\s+/g, " ").replace(/\u00A0/g, " ").trim();
    rawText = rawText.slice(0, 12000);

    if (!rawText) {
      return res.status(400).json({
        error: "No readable text found on the page, Please enter Job Description",
      });
    }

    // -------------------------
    // 3) Ask OpenAI (deterministic) to extract JD + Company
    // -------------------------
    const prompt = `
Return ONLY valid JSON. No markdown.
Extract Company Name and  only Get Exact Job Description from the link

Schema:
{
  "companyName": "string",
  "jobDescription": "string"
}

Rules:
- If companyName cannot be confidently extracted, set companyName to "" (empty string).
- if no Job description exists, set jobDescription to "".

PAGE_TEXT:
${rawText}
`;

    const aiResponse = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 1, // ✅ deterministic (important)
    });

    const raw = aiResponse?.choices?.[0]?.message?.content || "";
    let extracted = null;

    try {
      extracted = JSON.parse(raw);
    } catch (err) {
      console.error("❌ Extract JD JSON parse failed:", raw);
      extracted = null;
    }

    const jobDescription = String(extracted?.jobDescription || "").trim();

    // Prefer AI company, else use og:site_name, else title (first part), else hostname
    let companyName = String(extracted?.companyName || "").trim();

    if (!companyName && ogSiteName) companyName = ogSiteName;

    // If title looks like "Company - Job Title", take first chunk as company candidate
    if (!companyName && pageTitle) {
      const firstChunk = pageTitle.split("|")[0].split("-")[0].trim();
      if (firstChunk && firstChunk.length <= 60) companyName = firstChunk;
    }

    if (!companyName && hostname) {
      // best-effort brand-ish from hostname
      const base = hostname.split(".")[0];
      companyName = base ? base.charAt(0).toUpperCase() + base.slice(1) : "";
    }

    // final fallback
    if (!companyName) companyName = "Company_Name";

    // Validate JD
    if (!jobDescription) {
      return res.status(400).json({
        error: "This URL does not appear to contain a valid job description.",
      });
    }

    // -------------------------
    // 4) Success
    // -------------------------
    //console.log("✅ /extract-jd companyName:", companyName);
    res.json({ companyName, jobDescription });
  } catch (err) {
    console.error("❌ /extract-jd error:", err);
    res.status(500).json({ error: "Failed to extract job description from URL" });
  }
});


// -------------------- Start --------------------
// const PORT = process.env.PORT || 5000;
// app.listen(PORT, () => {
//   console.log(`Server running on http://localhost:${PORT}`);
// });


const PORT = process.env.PORT || 5000;
const HOST = "0.0.0.0"; // listen on all interfaces

app.listen(PORT, HOST, () => {
   console.log(`Server running on:`);
   console.log(`- Local:   http://localhost:${PORT}`);
   console.log(`- Network: http://<YOUR_LAN_IP>:${PORT}`);
 });
