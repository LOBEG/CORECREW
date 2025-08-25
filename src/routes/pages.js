const express = require('express');
const router = express.Router();

router.get('/about', (req, res) => res.render('about'));
router.get('/services', (req, res) => res.render('services'));
router.get('/contact', (req, res) => res.render('contact'));
router.get('/jobs', (req, res) => res.render('jobs'));

module.exports = router;

