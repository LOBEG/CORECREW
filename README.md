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

## SEO

- robots.txt at `/robots.txt`
- sitemap at `/sitemap.xml`
- JSON-LD organization schema on pages

## Get indexed on Google

1. Deploy to a public URL (e.g., Render, Vercel, Railway).
2. Set canonical domain (e.g., https://www.corecrewlogistics.com) with DNS.
3. Add property to Google Search Console and submit `/sitemap.xml`.
4. Ensure pages return 200 and are mobile-friendly.

