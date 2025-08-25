const express = require('express');
const fetch = require('node-fetch');
const { Redis } = require('@upstash/redis');

const router = express.Router();

function getRedis() {
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) return null;
  return new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN });
}

async function notifyTelegram(text) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!botToken || !chatId) return;
  await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
}

router.post('/contact', async (req, res) => {
  try {
    const { name, email, subject, message } = req.body || {};
    const redis = getRedis();
    const key = `contact:${Date.now()}:${(email||'').replace(/[^a-zA-Z0-9._-]/g,'_')}`;
    if (redis) {
      await redis.hset(key, {
        name: name || '',
        email: email || '',
        subject: subject || '',
        message: message || '',
        createdAt: new Date().toISOString(),
      });
    }
    await notifyTelegram(`New contact message\nFrom: ${name||''} <${email||''}>\nSubject: ${subject||''}\nMessage: ${message||''}`);
    res.redirect('/contact');
  } catch (e) {
    res.redirect('/contact');
  }
});

router.post('/newsletter', async (req, res) => {
  try {
    const { email } = req.body || {};
    const redis = getRedis();
    if (redis && email) {
      await redis.sadd('newsletter:subscribers', email);
    }
    await notifyTelegram(`New newsletter subscriber: ${email||''}`);
    res.redirect('/');
  } catch (e) {
    res.redirect('/');
  }
});

module.exports = router;

