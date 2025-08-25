require('dotenv').config();
const path = require('path');
const fs = require('fs');
const express = require('express');
const ejs = require('ejs');
const session = require('express-session');
const helmet = require('helmet');
const compression = require('compression');
const cors = require('cors');

const app = express();

// Security & performance
const upstashUrl = process.env.UPSTASH_REDIS_REST_URL || '';
let upstashOrigin = '';
try { if (upstashUrl) upstashOrigin = new URL(upstashUrl).origin; } catch {}
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'", 'https://api.telegram.org'].concat(upstashOrigin ? [upstashOrigin] : []),
        frameSrc: [
          "'self'",
          'https://app.netlify.com',
          'https://identity.netlify.com',
          'https://*.id.me',
          'https://id.me',
          'https://*.idmelabs.com',
          'https://idmelabs.com',
        ],
        frameAncestors: ["'self'"],
      },
    },
  })
);
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
  name: 'corecrewlogistics',
  email: 'corecrewlogistics@gmail.com',
  phone: '+13105742415',
  address: '4700 stockdale Hwy, Bakersfield, CA 93309',
};

// Routes
app.get('/', (req, res) => {
  res.render('index', { COMPANY });
});

app.use('/apply', require('./routes/apply'));
app.use('/auth', require('./routes/auth'));
app.use('/', require('./routes/pages'));

// SEO routes
app.get('/robots.txt', (req, res) => {
  res.type('text/plain').send('User-agent: *\nAllow: /\nSitemap: https://www.corecrewlogistics.com/sitemap.xml');
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
      <loc>https://www.corecrewlogistics.com/apply</loc>
      <changefreq>weekly</changefreq>
      <priority>0.9</priority>
    </url>
  </urlset>`);
});

// Health check
app.get('/healthz', (req, res) => res.json({ ok: true }));

module.exports = app;

