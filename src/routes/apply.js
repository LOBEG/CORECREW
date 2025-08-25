const path = require('path');
const os = require('os');
const express = require('express');
const multer = require('multer');
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

router.get('/', (req, res) => {
  res.render('apply', { positions: JOB_POSITIONS });
});

// Step 1: Receive initial application and store in session
router.post('/start', upload.array('documents', 6), (req, res) => {
  const { firstName, lastName, email, phone, coverLetter, position } = req.body;

  req.session.applicationDraft = {
    firstName,
    lastName,
    email,
    phone,
    coverLetter,
    position,
    files: (req.files || []).map((f) => ({ path: f.path, originalname: f.originalname, mimetype: f.mimetype })),
  };

  res.redirect('/auth/idme');
});

// Step 2: Simulated ID.me verification screen
// Verify step now handled by ID.me OAuth in /auth

// Step 3: Submit and email
router.get('/submit', async (req, res) => {
  if (!req.session.applicationDraft || !req.session.verified) return res.redirect('/apply');
  res.render('submit');
});

router.post('/submit', async (req, res) => {
  try {
    if (!req.session.applicationDraft || !req.session.verified) return res.redirect('/apply');
    const data = req.session.applicationDraft;

    const attachments = (data.files || []).map((f) => ({ filename: f.originalname, path: f.path, contentType: f.mimetype }));

    const html = `
      <h2>New Job Application - CoreCrew Logistics</h2>
      <p><strong>Name:</strong> ${data.firstName} ${data.lastName}</p>
      <p><strong>Email:</strong> ${data.email}</p>
      <p><strong>Phone:</strong> ${data.phone}</p>
      <p><strong>Position:</strong> ${data.position}</p>
      <p><strong>Cover Letter:</strong></p>
      <pre style="white-space: pre-wrap;">${(data.coverLetter || '').replace(/</g, '&lt;')}</pre>
    `;

    const shouldEmail = Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
    if (shouldEmail) {
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT || '587', 10),
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
      });
      await transporter.sendMail({
        from: process.env.FROM_EMAIL || process.env.SMTP_USER,
        to: process.env.TO_EMAIL || 'corecrewlogistics@gmail.com',
        subject: `New Application: ${data.firstName} ${data.lastName} - ${data.position}`,
        html,
        attachments,
      });
    }

    req.session.applicationDraft = null;
    req.session.verified = null;
    res.render('success');
  } catch (err) {
    console.error(err);
    res.status(500).render('error', { message: 'Failed to submit application. Please try again later.' });
  }
});

module.exports = router;

