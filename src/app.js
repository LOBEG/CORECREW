require('dotenv').config();
const path = require('path');
const fs = require('fs');
const express = require('express');
const ejs = require('ejs');
const session = require('express-session');
const helmet = require('helmet');
const compression = require('compression');
const cors = require('cors');
const multer = require('multer'); // For resume upload
const axios = require('axios');   // For Telegram API
const FormData = require('form-data'); // For sending files

const app = express();

// Security & performance
app.use(helmet());
app.use(compression());
app.use(cors());

// Views and static
app.engine('ejs', ejs.__express);
app.set('view engine', 'ejs');
const viewCandidates = [
  path.join(__dirname, 'views'),
  path.join(process.cwd(), 'src', 'views'),
  path.join(__dirname, '..', 'views'),
];
const resolvedViews = viewCandidates.find((p) => {
  try { return fs.existsSync(p); } catch { return false; }
});
app.set('views', resolvedViews || path.join(__dirname, 'views'));
app.use('/public', express.static(path.join(__dirname, 'public')));

// Body parsing
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Session for ID.me and application draft
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'change_this_secret',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false },
  })
);

// Company constants
const COMPANY = {
  name: 'Core Crew Logistics',
  email: 'corecrewlogistics@gmail.com',
  phone: '+13105742415',
  address: '4700 Stockdale Hwy, Bakersfield, CA 93309',
  slogan: 'Reliable Freight, Warehousing & Jobs Across California & Beyond'
};

// Job details data
const jobDetails = require('./data/jobDetails');

// Home page route
app.get('/', (req, res) => {
  res.render('index', { COMPANY });
});

// Jobs listing
app.get('/jobs', (req, res) => {
  res.render('jobs', { COMPANY });
});

// Job details dynamic route
app.get('/jobs/:position', (req, res) => {
  const positionKey = req.params.position;
  const job = jobDetails[positionKey];
  if (!job) return res.status(404).render('404', { COMPANY });
  res.render('job-details', { job, COMPANY });
});

// Application form route
app.get('/apply', (req, res) => {
  const positions = Object.keys(jobDetails);
  const selectedPosition = req.query.position;
  res.render('apply', { 
    positions,
    selectedPosition,
    COMPANY 
  });
});

// Mount the /apply routes (fix for POST /apply/start)
const applyRouter = require('./routes/apply');
app.use('/apply', applyRouter);

// About page route
app.get('/about', (req, res) => {
  res.render('about', { COMPANY });
});

// Services page route
app.get('/services', (req, res) => {
  res.render('services', { COMPANY });
});

// --------- SEO ROUTES ---------
// robots.txt route
app.get('/robots.txt', (req, res) => {
  res.type('text/plain').send(
    'User-agent: *\nAllow: /\nSitemap: https://www.corecrewlogistics.com/sitemap.xml'
  );
});

// sitemap.xml route (reflecting only real, public pages)
app.get('/sitemap.xml', (req, res) => {
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
  <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
    <url>
      <loc>https://www.corecrewlogistics.com/</loc>
      <changefreq>weekly</changefreq>
      <priority>1.0</priority>
    </url>
    <url>
      <loc>https://www.corecrewlogistics.com/about</loc>
      <changefreq>weekly</changefreq>
      <priority>0.9</priority>
    </url>
    <url>
      <loc>https://www.corecrewlogistics.com/apply</loc>
      <changefreq>weekly</changefreq>
      <priority>0.9</priority>
    </url>
    <url>
      <loc>https://www.corecrewlogistics.com/services</loc>
      <changefreq>weekly</changefreq>
      <priority>0.8</priority>
    </url>
    <url>
      <loc>https://www.corecrewlogistics.com/jobs</loc>
      <changefreq>weekly</changefreq>
      <priority>0.8</priority>
    </url>
  </urlset>`);
});

// Health check
app.get('/healthz', (req, res) => res.json({ ok: true }));

// --- Quick Apply POST route ---
// FIX: Use /tmp for uploads when on serverless (e.g., Netlify)
const upload = multer({ dest: '/tmp/' });

app.post('/quick-apply', upload.single('resume'), async (req, res) => {
  try {
    const { name, email, message } = req.body;
    const resumeFile = req.file;

    // Telegram bot constants
    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

    // 1. Send text message to Telegram
    const text = `New Quick Apply Submission:
Name: ${name}
Email: ${email}
Message: ${message || '(none)'}`;

    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      chat_id: TELEGRAM_CHAT_ID,
      text: text
    });

    // 2. Send resume file to Telegram
    const formData = new FormData();
    formData.append('chat_id', TELEGRAM_CHAT_ID);
    formData.append('caption', `${name}'s Resume`);
    formData.append('document', fs.createReadStream(resumeFile.path), {
      filename: resumeFile.originalname,
    });

    await axios.post(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendDocument`,
      formData,
      { headers: formData.getHeaders() }
    );

    // 3. Clean up uploaded file
    fs.unlinkSync(resumeFile.path);

    res.send('<h2 style="text-align:center;">Thank you for applying! We received your submission.</h2>');
  } catch (err) {
    console.error(err);
    res.status(500).send('Error processing submission.');
  }
});

module.exports = app;