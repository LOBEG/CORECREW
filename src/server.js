require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const compression = require('compression');
const cors = require('cors');

const app = express();

// Security & performance
app.use(helmet());
app.use(compression());
app.use(cors());

// Views and static
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use('/public', express.static(path.join(__dirname, 'public')));

// Body parsing
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Session for simple simulation of ID.me step
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`CoreCrew Logistics app running at http://localhost:${PORT}`);
});

