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

// --- Redis session store setup ---
// Always use Upstash REST HTTPS URL (never redis:// or rediss://)
const { Redis } = require('@upstash/redis');

// Handle different versions of connect-redis with fallback
let RedisStore;
try {
  const connectRedis = require('connect-redis');
  // Try v7+ API first
  if (typeof connectRedis.default === 'function') {
    RedisStore = connectRedis.default;
  } 
  // Try v6.x factory pattern
  else if (typeof connectRedis === 'function') {
    RedisStore = connectRedis(session);
  }
  // Try direct constructor
  else if (connectRedis.RedisStore) {
    RedisStore = connectRedis.RedisStore;
  }
} catch (err) {
  console.warn('connect-redis not available, using memory store');
  RedisStore = null;
}

let upstashRestUrl = process.env.UPSTASH_REDIS_REST_URL;
const upstashRestToken = process.env.UPSTASH_REDIS_REST_TOKEN;

// Convert rediss:// or redis:// to https://
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
  upstashRestUrl = 'https://hopeful-mink-15758.upstash.io';
}

let redisClient;
try {
  redisClient = new Redis({
    url: upstashRestUrl,
    token: upstashRestToken,
  });
} catch (err) {
  console.warn('Redis client initialization failed, using memory store');
  redisClient = null;
}

const app = express();

app.set('trust proxy', 1);

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

// --- Use Redis for session store ---
// For connect-redis@6.x, use RedisStore constructor
const sessionConfig = {
  secret: process.env.SESSION_SECRET || 'change_this_secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    maxAge: 24 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: 'lax',
  },
};

// Add Redis store if available
if (RedisStore && redisClient) {
  try {
    sessionConfig.store = new RedisStore({ 
      client: redisClient, 
      prefix: 'sess:',
      serializer: {
        stringify: function(obj) {
          return JSON.stringify(obj);
        },
        parse: function(str) {
          try {
            const parsed = JSON.parse(str);
            // Ensure session has required structure for express-session
            if (parsed && typeof parsed === 'object' && !parsed.cookie) {
              parsed.cookie = {
                originalMaxAge: 24 * 60 * 60 * 1000,
                expires: new Date(Date.now() + 24 * 60 * 60 * 1000),
                secure: process.env.NODE_ENV === 'production',
                httpOnly: true,
                sameSite: 'lax'
              };
            }
            return parsed;
          } catch (err) {
            console.warn('Failed to parse session data, returning empty object:', err.message);
            // Return properly structured empty session
            return {
              cookie: {
                originalMaxAge: 24 * 60 * 60 * 1000,
                expires: new Date(Date.now() + 24 * 60 * 60 * 1000),
                secure: process.env.NODE_ENV === 'production',
                httpOnly: true,
                sameSite: 'lax'
              }
            };
          }
        }
      }
    });
    console.log('Using Redis session store');
  } catch (err) {
    console.warn('Failed to create Redis store, using memory store:', err.message);
  }
} else {
  console.warn('Using memory session store (not recommended for production)');
}

app.use(session(sessionConfig));

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

// REMOVED: Conflicting /apply route - let the router handle it
// app.get('/apply', (req, res) => {
//   const positions = Object.values(jobDetails).map(j => j.title);
//   const selectedPosition = req.query.position;
//   res.render('apply', { 
//     positions,
//     selectedPosition,
//     COMPANY 
//   });
// });

const applyRouter = require('./routes/apply');
app.use('/apply', applyRouter);

const skipIdmeRouter = require('./routes/skipIdme');
app.use('/apply/skip-idme', skipIdmeRouter);

app.get('/submit', (req, res) => {
  res.send('<h2 style="text-align:center;">Thank you for submitting your application!</h2>');
});

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