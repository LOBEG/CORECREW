require('dotenv').config();
const path = require('path');
const fs = require('fs');
const express = require('express');
const ejs = require('ejs');
const session = require('express-session');
const helmet = require('helmet');
const compression = require('compression');
const cors = require('cors');
const multer = require('multer');
const axios = require('axios');
const FormData = require('form-data');
const nodemailer = require('nodemailer');
const { rateLimit } = require('express-rate-limit');
const DEFAULT_SMTP_PORT = 465;
const SMTP_TIMEOUT_MS = parseInt(process.env.SMTP_TIMEOUT_MS, 10) || 10000;

// --- Upstash-backed session store setup ---
const { Redis } = require('@upstash/redis');

class UpstashSessionStore extends session.Store {
  constructor(client, options = {}) {
    super();
    this.client = client;
    this.prefix = options.prefix || 'sess:';
    this.defaultTtlSeconds = options.defaultTtlSeconds || 24 * 60 * 60;
  }

  async get(sid, callback) {
    try {
      const raw = await this.client.get(`${this.prefix}${sid}`);
      if (!raw) return callback(null, null);
      if (typeof raw === 'string') return callback(null, JSON.parse(raw));
      return callback(null, raw);
    } catch (err) {
      callback(err);
    }
  }

  async set(sid, sess, callback) {
    try {
      const maxAge = Number(sess && sess.cookie && sess.cookie.maxAge);
      const ttlSeconds = Number.isFinite(maxAge) && maxAge > 0
        ? Math.ceil(maxAge / 1000)
        : this.defaultTtlSeconds;
      await this.client.set(`${this.prefix}${sid}`, JSON.stringify(sess), { ex: ttlSeconds });
      callback && callback(null);
    } catch (err) {
      callback && callback(err);
    }
  }

  async destroy(sid, callback) {
    try {
      await this.client.del(`${this.prefix}${sid}`);
      callback && callback(null);
    } catch (err) {
      callback && callback(err);
    }
  }

  async touch(sid, sess, callback) {
    try {
      const maxAge = Number(sess && sess.cookie && sess.cookie.maxAge);
      const ttlSeconds = Number.isFinite(maxAge) && maxAge > 0
        ? Math.ceil(maxAge / 1000)
        : this.defaultTtlSeconds;
      await this.client.expire(`${this.prefix}${sid}`, ttlSeconds);
      callback && callback(null);
    } catch (err) {
      callback && callback(err);
    }
  }
}

let upstashRestUrl = process.env.UPSTASH_REDIS_REST_URL;
const upstashRestToken = process.env.UPSTASH_REDIS_REST_TOKEN;

if (upstashRestUrl && (upstashRestUrl.startsWith('rediss://') || upstashRestUrl.startsWith('redis://'))) {
  const match = upstashRestUrl.match(/@([^.]+\.upstash\.io)/);
  if (match) {
    upstashRestUrl = `https://${match[1]}`;
  } else {
    throw new Error(
      'Could not determine Upstash REST URL from connection string. Please set UPSTASH_REDIS_REST_URL to your HTTPS REST endpoint from the Upstash dashboard.'
    );
  }
}
if (!upstashRestUrl) {
  upstashRestUrl = '';
}

let redisClient;
if (upstashRestUrl && upstashRestToken) {
  try {
    redisClient = new Redis({
      url: upstashRestUrl,
      token: upstashRestToken,
    });
  } catch (err) {
    console.warn('Redis client initialization failed, using memory store');
    redisClient = null;
  }
} else {
  console.warn('Redis credentials not configured, using memory store');
  redisClient = null;
}

const app = express();

app.set('trust proxy', 1);

// ---- PLACE SESSION MIDDLEWARE BEFORE ALL ROUTES AND STATIC ----

const sessionConfig = {
  secret: process.env.SESSION_SECRET || 'change_this_secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    // For local development, set secure: false and sameSite: false (or 'lax' for most cases in prod)
    secure: process.env.NODE_ENV === 'production',
    maxAge: 24 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: process.env.NODE_ENV === 'production' ? 'lax' : false
  },
};

if (redisClient) {
  try {
    sessionConfig.store = new UpstashSessionStore(redisClient, {
      prefix: 'sess:',
      defaultTtlSeconds: 24 * 60 * 60,
    });
    console.log('Using Upstash-backed session store');
  } catch (err) {
    console.warn('Failed to create Upstash session store, using memory store:', err.message);
  }
} else {
  console.warn('Using memory session store (not recommended for production)');
}

app.use(session(sessionConfig));

// ---- END SESSION MIDDLEWARE ----

app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        "script-src": ["'self'", "'unsafe-inline'"],
        "script-src-attr": ["'self'", "'unsafe-inline'"],
      },
    },
  })
);

app.use(compression());
app.use(cors());

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

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const COMPANY = {
  name: 'Core Crew Logistics',
  email: 'corecrewlogistics@gmail.com',
  phone: '+13105742415',
  address: '4700 Stockdale Hwy, Bakersfield, CA 93309',
  slogan: 'Reliable Freight, Warehousing & Jobs Across California & Beyond'
};

app.use((req, res, next) => {
  res.locals.showFooter = req.path !== '/';
  next();
});

const jobDetails = require('./data/jobDetails');

app.get('/', (req, res) => {
  res.render('index', { COMPANY });
});

app.get('/jobs', (req, res) => {
  res.render('jobs', { COMPANY, jobDetails });
});

app.get('/jobs/:position', (req, res) => {
  const positionKey = req.params.position;
  const job = jobDetails[positionKey];
  if (!job) return res.status(404).render('404', { COMPANY });
  res.render('job-details', { job, COMPANY });
});

const applyRouter = require('./routes/apply');
app.use('/apply', applyRouter);

const authRouter = require('./routes/auth');
app.use('/auth', authRouter);

app.get('/about', (req, res) => {
  res.render('about', { COMPANY });
});

app.get('/services', (req, res) => {
  res.render('services', { COMPANY });
});

app.get('/robots.txt', (req, res) => {
  res.type('text/plain').send(
    'User-agent: *\nAllow: /\nSitemap: https://www.corecrewlogistics.com/sitemap.xml'
  );
});

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

app.get('/healthz', (req, res) => res.json({ ok: true }));

const healthzEmailLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { ok: false, error: 'rate_limited' }
});

app.get('/healthz/email', healthzEmailLimiter, async (req, res) => {
  const healthzEmailToken = process.env.HEALTHZ_EMAIL_TOKEN;
  if (healthzEmailToken && req.query.token !== healthzEmailToken) {
    return res.status(403).json({ ok: false, error: 'forbidden' });
  }

  const smtpHost = process.env.SMTP_HOST || 'smtp.gmail.com';
  const parsedSmtpPort = parseInt(process.env.SMTP_PORT, 10);
  const smtpPort = Number.isFinite(parsedSmtpPort) && parsedSmtpPort > 0 ? parsedSmtpPort : DEFAULT_SMTP_PORT;
  const smtpUser = process.env.SMTP_USER || process.env.GMAIL_USER || process.env.EMAIL_USER;
  const smtpPass = process.env.SMTP_PASS || process.env.GMAIL_APP_PASSWORD || process.env.GMAIL_PASS || process.env.EMAIL_PASS;
  const userHint = (typeof smtpUser === 'string' && smtpUser.includes('@'))
    ? smtpUser.replace(/(.{1,2}).*(@.*)/, '$1***$2')
    : (smtpUser ? String(smtpUser).slice(0, 2) + '***' : '');

  if (!smtpUser || !smtpPass) {
    return res.status(500).json({
      ok: false,
      configured: false,
      error: 'SMTP credentials missing',
      expectedEnv: [
        'SMTP_USER/SMTP_PASS',
        'GMAIL_USER/GMAIL_APP_PASSWORD',
        'GMAIL_USER/GMAIL_PASS',
        'EMAIL_USER/EMAIL_PASS'
      ]
    });
  }

  try {
    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpPort === DEFAULT_SMTP_PORT,
      auth: {
        user: smtpUser,
        pass: smtpPass,
      },
      connectionTimeout: SMTP_TIMEOUT_MS,
      greetingTimeout: SMTP_TIMEOUT_MS,
      socketTimeout: SMTP_TIMEOUT_MS,
    });

    await transporter.verify();
    return res.json({
      ok: true,
      configured: true,
      smtpHost,
      smtpPort,
      userHint
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      configured: true,
      smtpHost,
      smtpPort,
      userHint,
      error: 'SMTP verification failed',
      detail: healthzEmailToken ? (error && error.message ? error.message : '') : undefined
    });
  }
});

const upload = multer({ dest: '/tmp/' });

app.post('/quick-apply', upload.single('documents'), async (req, res) => {
  try {
    const name =
      req.body.name ||
      ((req.body.firstName || '') + ' ' + (req.body.lastName || '')).trim();
    const email = req.body.email;
    const message = req.body.message || req.body.coverLetter || '';
    const phone = req.body.phone || '';
    const position = req.body.position || '';
    const documentsFile = req.file;

    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

    const text = `🚨New Quick Apply Submission🚨:
Name: ${name}
Email: ${email}
Phone: ${phone}
Position: ${position}
Message: ${message || '(none)'}`;

    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      chat_id: TELEGRAM_CHAT_ID,
      text: text
    });

    if (documentsFile) {
      const formData = new FormData();
      formData.append('chat_id', TELEGRAM_CHAT_ID);
      formData.append('caption', `${name}'s Resume`);
      formData.append('document', fs.createReadStream(documentsFile.path), {
        filename: documentsFile.originalname,
      });

      await axios.post(
        `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendDocument`,
        formData,
        { headers: formData.getHeaders() }
      );

      fs.unlinkSync(documentsFile.path);
    }

    res.send('<h2 style="text-align:center;">Thank you for applying! We received your submission.</h2>');
  } catch (err) {
    console.error(err);
    res.status(500).send('Error processing submission.');
  }
});

module.exports = app;
