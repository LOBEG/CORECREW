const express = require('express');

const router = express.Router();

let cachedClient = null;

async function getOpenIdLib() {
  // Dynamically import ESM module from CommonJS context
  const mod = await import('openid-client');
  return mod;
}

async function getClient() {
  if (cachedClient) return cachedClient;
  const { Issuer } = await getOpenIdLib();
  const issuerUrl = process.env.IDME_ISSUER; // e.g., https://api.id.me or https://api.idmelabs.com
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
    const scope = process.env.IDME_SCOPE || 'openid email profile';
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
    res.redirect('/apply/submit');
  } catch (err) {
    next(err);
  }
});

module.exports = router;

