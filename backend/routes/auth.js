const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { authenticate } = require('../middleware/auth');
const {
  optionalProfileUpload,
  publicPathForProfile,
  removeProfileImage,
} = require('../lib/profileUpload');

const router = express.Router();

function signToken(user) {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not configured');
  return jwt.sign(
    { sub: user._id.toString(), email: user.email, role: user.role || 'user' },
    secret,
    { expiresIn: '7d' }
  );
}

function publicUser(user) {
  return {
    id: user._id.toString(),
    email: user.email,
    name: user.name || '',
    profileImagePath: user.profileImagePath || '',
    role: user.role || 'user',
  };
}

router.post('/register', async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const name = String(req.body?.name || '').trim();

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const adminEmail = String(process.env.ADMIN_EMAIL || 'admin@foodorder.local')
      .trim()
      .toLowerCase();
    if (email === adminEmail) {
      return res.status(403).json({ error: 'This email is reserved for the system administrator' });
    }

    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({ email, passwordHash, name, role: 'user' });

    const token = signToken(user);
    return res.status(201).json({
      token,
      user: publicUser(user),
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Registration failed' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = signToken(user);
    return res.json({
      token,
      user: publicUser(user),
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Login failed' });
  }
});

router.get('/me', authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    return res.json({ user: publicUser(user) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to load profile' });
  }
});

router.patch('/me', authenticate, optionalProfileUpload, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (req.body.name !== undefined) user.name = String(req.body.name || '').trim();
    if (req.file?.filename) {
      if (user.profileImagePath) removeProfileImage(user.profileImagePath);
      user.profileImagePath = publicPathForProfile(req.file.filename);
    }
    await user.save();
    return res.json({ user: publicUser(user) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to update profile' });
  }
});

module.exports = router;
