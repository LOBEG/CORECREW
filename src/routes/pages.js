const express = require('express');
const router = express.Router();

router.get('/about', (req, res) => res.render('about'));
router.get('/services', (req, res) => res.render('services'));
router.get('/contact', (req, res) => res.render('contact'));
router.get('/jobs', (req, res) => res.render('jobs'));
router.get('/privacy', (req, res) => res.render('privacy'));
router.get('/terms', (req, res) => res.render('terms'));
router.get('/blog', (req, res) => res.render('blog'));

module.exports = router;

