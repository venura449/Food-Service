const bcrypt = require('bcryptjs');
const User = require('../models/User');

/**
 * Single built-in admin (credentials from env). Created on first boot if missing.
 * Registration always creates `user` role only; this account is never created via /register.
 */
async function ensureAdminUser() {
  const email = String(process.env.ADMIN_EMAIL || 'admin@foodorder.local')
    .trim()
    .toLowerCase();
  const password = String(process.env.ADMIN_PASSWORD || 'Admin123!');

  if (!email) return;

  let user = await User.findOne({ email });
  if (!user) {
    const passwordHash = await bcrypt.hash(password, 10);
    await User.create({
      email,
      passwordHash,
      name: 'Administrator',
      role: 'admin',
    });
    console.log(`Admin user created (${email}). Change ADMIN_PASSWORD in production.`);
    return;
  }

  if (user.role !== 'admin') {
    user.role = 'admin';
    await user.save();
    console.log(`Existing account promoted to admin: ${email}`);
  }
}

module.exports = { ensureAdminUser };
