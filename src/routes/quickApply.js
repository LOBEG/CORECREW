const express = require('express');
const router = express.Router();
const multer = require('multer');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Multer config for file uploads
const upload = multer({ dest: 'uploads/' });

const TELEGRAM_BOT_TOKEN = 'YOUR_TELEGRAM_BOT_TOKEN'; // <-- Replace this
const TELEGRAM_CHAT_ID = 'YOUR_TELEGRAM_CHAT_ID';     // <-- Replace this

router.post('/', upload.single('resume'), async (req, res) => {
  try {
    const { name, email, message } = req.body;
    const resumeFile = req.file;

    // 1. Send text message to Telegram
    const text = `
New Quick Apply Submission:
Name: ${name}
Email: ${email}
Message: ${message || '(none)'}
`;

    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      chat_id: TELEGRAM_CHAT_ID,
      text: text
    });

    // 2. Send the resume file to Telegram
    const formData = new FormData();
    formData.append('chat_id', TELEGRAM_CHAT_ID);
    formData.append('caption', `${name}'s Resume`);
    formData.append('document', fs.createReadStream(path.resolve(resumeFile.path)), {
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

module.exports = router;