import "dotenv/config";

const CONFIG = {
  personalEmail : process.env.personalEmail,
  schoolEmail   : process.env.schoolEmail,
  geminiApiKey  : process.env.geminiApiKey,
  timezone      : process.env.timezone,
  uniDomain     : process.env.uniDomain,
  studentDomain : process.env.studentDomain,

  // ── Keywords (subject OR body must contain one of these) ──
  keywords: process.env.keywords,
  importantSenders: process.env.importantSenders
};


//  DAY-OF-WEEK GUARD
//  Saturday  → never send
//  Sunday    → only at the 6 PM trigger (hour >= 17)
//  Mon–Fri   → always (8 AM, 1 PM, 6 PM)

function shouldRunNow() {
  const now     = new Date();
  const day     = now.toLocaleDateString("en-US", { timeZone: CONFIG.timezone, weekday: "long" });
  const hourStr = now.toLocaleString("en-US", { timeZone: CONFIG.timezone, hour: "numeric", hour12: false });
  const hour    = parseInt(hourStr, 10);

  if (day === "Saturday") {
    console.log("Saturday — no digest scheduled.");
    return false;
  }

  if (day === "Sunday" && hour < 17) {
    console.log("Sunday — only the 6 PM digest runs. Skipping this trigger.");
    return false;
  }

  return true;
}



//  MAIN FUNCTION — triggered at 8 AM, 1 PM, 6 PM daily

const fs = require('fs');
const path = require('path');

function sendEmailDigest() {
  if (!shouldRunNow()) return;

  const now = new Date();
  const propsPath = path.join(__dirname, 'scriptProperties.json');
  let properties = {};
  if (fs.existsSync(propsPath)) {
    try {
      properties = JSON.parse(fs.readFileSync(propsPath, 'utf-8'));
    } catch (e) {
      console.error('Failed to read scriptProperties.json:', e);
      properties = {};
    }
  }
  const lastRun = properties.lastRun;

  // First-ever run: look back 6 hours
  const lastRunDate = lastRun
    ? new Date(lastRun)
    : new Date(now.getTime() - 6 * 60 * 60 * 1000);

  const relevantEmails = getRelevantEmails(lastRunDate, now);
  properties.lastRun = now.toISOString();
  try {
    fs.writeFileSync(propsPath, JSON.stringify(properties, null, 2));
  } catch (e) {
    console.error('Failed to write scriptProperties.json:', e);
  }

  if (relevantEmails.length === 0) {
    console.log("No relevant emails since " + lastRunDate + ". No digest sent.");
    return;
  }

  sendDigest(relevantEmails, now);
  console.log("Digest sent — " + relevantEmails.length + " email(s).");
}



//  FETCH & FILTER EMAILS

function getRelevantEmails(since, now) {
  const sinceStr = Utilities.formatDate(since, "GMT", "yyyy/MM/dd");
  const query    = `in:inbox after:${sinceStr} -label:sent`;
  const threads  = GmailApp.search(query, 0, 100);

  const relevant = [];
  const seenIds  = new Set();

  for (const thread of threads) {
    for (const msg of thread.getMessages()) {
      const msgDate = msg.getDate();

      if (msgDate <= since || msgDate > now) continue;

      const id = msg.getId();
      if (seenIds.has(id)) continue;
      seenIds.add(id);

      if (isRelevant(msg)) relevant.push(msg);
    }
  }

  // Sort oldest → newest
  relevant.sort((a, b) => a.getDate() - b.getDate());
  return relevant;
}



//  RELEVANCE CHECKER

function isRelevant(message) {
  const rawFrom   = message.getFrom();
  const fromLower = rawFrom.toLowerCase();

  // Extract bare email address from "Name <email@domain.com>"
  const emailMatch = rawFrom.match(/<([^>]+)>/);
  const fromEmail  = (emailMatch ? emailMatch[1] : rawFrom).toLowerCase();

  const subject = message.getSubject().toLowerCase();
  const snippet = message.getPlainBody().toLowerCase().substring(0, 2000);

  // ── Rule 1: Fellow student → always relevant ──────────────
  if (fromEmail.endsWith("@" + CONFIG.studentDomain)) {
    console.log("Included (fellow student): " + fromEmail);
    return true;
  }

  // ── Rule 2: External / non-UoN sender → always relevant ───
  if (!fromEmail.endsWith("@" + CONFIG.uniDomain) &&
      !fromEmail.endsWith("@" + CONFIG.studentDomain)) {
    console.log("Included (external sender): " + fromEmail);
    return true;
  }

  // ── Rule 3: Named important senders ───────────────────────
  for (const sender of CONFIG.importantSenders) {
    if (fromLower.includes(sender.toLowerCase())) {
      console.log("Included (important sender): " + fromEmail);
      return true;
    }
  }

  // ── Rule 4: Keyword match in subject or body ───────────────
  for (const kw of CONFIG.keywords) {
    const k = kw.toLowerCase();

    if (subject.includes(k) || snippet.includes(k)) {
      console.log("Included (keyword '" + kw + "'): " + message.getSubject());
      return true;
    }
  }

  return false;
}


//  AI SUMMARY via Gemini 3 Flash Preview (Free tier)

function getAISummary(from, subject, body) {
  if (!CONFIG.geminiApiKey || CONFIG.geminiApiKey === "YOUR_GEMINI_API_KEY_HERE") {
    return "⚠️ Add your Gemini API key to enable AI summaries.";
  }

  try {
    const prompt =
      `You are a concise assistant summarizing university emails for a Year 1 Computer Science student at the University of Nairobi.\n` +
      `Summarize the following email in exactly 2–3 sentences. Highlight: key information, deadlines, action items, or opportunities.\n\n` +
      `From: ${from}\nSubject: ${subject}\n\nEmail Body:\n${body.substring(0, 3000)}`;

    const url = process.env.url;

    const payload = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 180, temperature: 0.2 }
    };

    Utilities.sleep(15000);

    const res = UrlFetchApp.fetch(url, {
      method: "POST",
      contentType: "application/json",
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    const data = JSON.parse(res.getContentText());
    return data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim()
      || "Summary could not be generated.";

  } catch (e) {
    console.error("Gemini error: " + e.message);
    return "Summary unavailable.";
  }
}



//  BUILD & SEND THE DIGEST EMAIL

function sendDigest(emails, now) {
  const dateLabel = Utilities.formatDate(now, CONFIG.timezone, "EEEE, MMMM dd, yyyy");
  const timeLabel = Utilities.formatDate(now, CONFIG.timezone, "h:mm a 'EAT'");
  const count     = emails.length;

  // ── Sender-type badge ───────────────────────────────────────
  function senderTag(rawFrom) {
    const m    = rawFrom.match(/<([^>]+)>/);
    const addr = (m ? m[1] : rawFrom).toLowerCase();
    if (addr.endsWith("@students.uonbi.ac.ke"))
      return `<span style="background:#e6f4ea;color:#1a7340;border:1px solid #a8d5b5;border-radius:12px;padding:2px 10px;font-size:11px;font-weight:700;">&#x1F468;&#x200D;&#x1F393; Fellow Student</span>`;

    if (!addr.endsWith("@uonbi.ac.ke"))
      return `<span style="background:#fff3e0;color:#b45309;border:1px solid #fcd9a0;border-radius:12px;padding:2px 10px;font-size:11px;font-weight:700;">&#x1F310; External</span>`;

    return `<span style="background:#e8f0fe;color:#1a56db;border:1px solid #b3c6f9;border-radius:12px;padding:2px 10px;font-size:11px;font-weight:700;">&#x1F3EB; University</span>`;
  }

  // ── HTML body ───────────────────────────────────────────────
  let html = `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Arial, sans-serif; background: #f0f2f5; color: #1a1a2e; padding: 24px 16px; }
  .wrapper { max-width: 680px; margin: 0 auto; }
  .header { background: linear-gradient(135deg, #003366 0%, #0055aa 100%); color: #fff; padding: 28px 32px; border-radius: 12px 12px 0 0; }
  .header h1 { font-size: 22px; font-weight: 700; }
  .header .sub { margin-top: 6px; font-size: 13px; opacity: 0.82; }
  .badge { display: inline-block; margin-top: 12px; background: rgba(255,255,255,0.18); border: 1px solid rgba(255,255,255,0.35); border-radius: 20px; padding: 4px 14px; font-size: 13px; font-weight: 600; }
  .section-label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.2px; color: #0055aa; padding: 18px 0 8px 2px; }
  .card { background: #fff; border-radius: 10px; margin-bottom: 16px; overflow: hidden; border: 1px solid #dde3ee; box-shadow: 0 1px 4px rgba(0,51,102,0.07); }
  .card-header { padding: 16px 20px 14px; border-bottom: 1px solid #eef0f6; }
  .card-header .tag-row { margin-bottom: 8px; }
  .card-header .from { font-size: 13px; color: #555; margin-bottom: 4px; }
  .card-header .from strong { color: #003366; }
  .card-header .subject { font-size: 16px; font-weight: 700; color: #1a1a2e; line-height: 1.4; margin-bottom: 6px; }
  .card-header .meta { font-size: 12px; color: #888; }
  .summary { background: #f0f5ff; border-left: 4px solid #0055aa; padding: 14px 20px; }
  .summary .ai-label { font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 1.4px; color: #0055aa; margin-bottom: 6px; }
  .summary p { font-size: 14px; line-height: 1.65; color: #2c2c54; }
  .footer { background: #fff; border-radius: 0 0 12px 12px; border: 1px solid #dde3ee; border-top: none; text-align: center; padding: 20px; font-size: 12px; color: #999; line-height: 1.8; }
  .footer a { color: #0055aa; text-decoration: none; }
</style>
</head>
<body>
<div class="wrapper">
  <div class="header">
    <h1>&#x1F4EC; School Email Digest</h1>
    <div class="sub">${dateLabel} &nbsp;·&nbsp; ${timeLabel}</div>
    <div class="badge">${count} relevant email${count !== 1 ? "s" : ""} found</div>
  </div>
  <div class="section-label">Relevant Emails</div>
`;

// ── HTML and Plain-text setup ─────────────────────────────────────────────
  let plain = `SCHOOL EMAIL DIGEST — ${dateLabel} at ${timeLabel}\n${count} email(s)\n${"=".repeat(60)}\n\n`;

  for (const msg of emails) {
    const from    = msg.getFrom();
    const subject = msg.getSubject() || "(No Subject)";
    const date    = Utilities.formatDate(msg.getDate(), CONFIG.timezone, "EEE, MMM dd 'at' h:mm a 'EAT'");
    const body    = msg.getPlainBody();
    
    // ONE single API call per email!
    const summary = getAISummary(from, subject, body);
    const tag     = senderTag(from);

    // 1. Build the HTML card
    html += `
  <div class="card">
    <div class="card-header">
      <div class="tag-row">${tag}</div>
      <div class="from">From: <strong>${escapeHtml(from)}</strong></div>
      <div class="subject">${escapeHtml(subject)}</div>
      <div class="meta">&#x1F4C5; ${date}</div>
    </div>
    <div class="summary">
      <div class="ai-label">&#x1F916; AI Summary</div>
      <p>${escapeHtml(summary)}</p>
    </div>
  </div>`;

    // 2. Build the Plain-text section at the same time
    plain += `FROM:    ${from}\n`;
    plain += `SUBJECT: ${subject}\n`;
    plain += `DATE:    ${date}\n`;
    plain += `SUMMARY: ${summary}\n`;
    plain += `${"-".repeat(60)}\n\n`;
  }

  // (Keep your existing HTML footer addition below this)
  html += `
  <div class="footer">...`

  html += `
  <div class="footer">
    Auto-generated from <strong>${CONFIG.schoolEmail}</strong><br>
    Delivered to <a href="mailto:${CONFIG.personalEmail}">${CONFIG.personalEmail}</a><br>
    Powered by Google Apps Script + Gemini AI &nbsp;·&nbsp; Runs 24/7 on Google's servers
  </div>
</div>
</body>
</html>`;

  const subjectLine =
    ` UoN Emails — ${count} Email${count !== 1 ? "s" : ""} | ` +
      Utilities.formatDate(now, CONFIG.timezone, "EEE MMM dd, h:mm a 'EAT'");

  GmailApp.sendEmail(CONFIG.personalEmail, subjectLine, plain, {
    htmlBody : html,
    name     : "UoN Email Analyzer"
  });
}



//  HTML ESCAPE HELPER

function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

//  SETUP TRIGGERS — Run ONCE manually after pasting
const cron = require('node-cron');

// 8 AM Mon–Fri
cron.schedule('0 8 * * 1-5', () => {
  sendEmailDigest();
});

// 1 PM Mon–Fri
cron.schedule('0 13 * * 1-5', () => {
  sendEmailDigest();
});

// 6 PM every day, but skip Saturday
cron.schedule('0 18 * * *', () => {
  const now = new Date();
  const day = now.toLocaleDateString('en-US', { timeZone: CONFIG.timezone, weekday: 'long' });
  if (day !== 'Saturday') {
    sendEmailDigest();
  }
});

//  TEST FUNCTION — Run for an instant digest (last 48 hrs)
function testDigestNow() {
  const now      = new Date();
  const lookback = new Date(now.getTime() - 48 * 60 * 60 * 1000);
  const emails   = getRelevantEmails(lookback, now);

  if (emails.length === 0) {
    console.log("No relevant emails in the last 48 hours.");
    return;
  }

  sendDigest(emails, now);
  console.log("✅ Test digest sent — " + emails.length + " email(s).");
}