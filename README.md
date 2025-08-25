# CoreCrew Logistics careers application portal

## How to run

1. Copy `.env.example` to `.env` and fill SMTP settings.
2. Install dependencies and start:

```
npm install
npm run dev
```

App will run on http://localhost:3000

## Email delivery

Configure SMTP variables in `.env`. Applications are sent to `corecrewlogistics@gmail.com` by default or override with `TO_EMAIL`.

## ID.me OAuth setup

- Create an app in ID.me (Sandbox: `https://developer.idmelabs.com`, Prod: `https://developer.id.me`).
- Set redirect URI: `http://localhost:3000/auth/idme/callback` (local) and your production URL `https://YOUR_DOMAIN/auth/idme/callback`.
- Set environment variables:

```
IDME_ISSUER=https://api.idmelabs.com
IDME_CLIENT_ID=your_client_id
IDME_CLIENT_SECRET=your_client_secret
IDME_REDIRECT_URI=http://localhost:3000/auth/idme/callback
IDME_SCOPE=openid email profile
```

## SEO

- robots.txt at `/robots.txt`
- sitemap at `/sitemap.xml`
- JSON-LD organization schema on pages

## Deploy on Netlify

This app uses a Netlify Function to host the Express server.

- Files:
  - `netlify.toml` (routes and function path)
  - `netlify/functions/server.js` (wraps Express via serverless-http)
- Build command:

```
npm run build:netlify
```

- Publish directory: `dist`
- Functions directory: `netlify/functions`

### Steps

1. Push this repo to GitHub.
2. In Netlify, "Add new site" -> "Import from Git" -> select repo.
3. Set Build command `npm run build:netlify`, Publish dir `dist`, Functions dir `netlify/functions`.
4. Add environment variables in Netlify UI: SMTP_*, SESSION_SECRET, IDME_*.
5. Deploy.
6. Set your custom domain and update ID.me Redirect URI to `https://YOUR_DOMAIN/auth/idme/callback`.

## Get indexed on Google

1. Deploy to a public domain (e.g., `https://www.corecrewlogistics.com`).
2. Add the domain to Google Search Console and submit `/sitemap.xml`.
3. Ensure pages return 200 and are mobile-friendly.

