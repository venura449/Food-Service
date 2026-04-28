const fs = require('fs');
const path = require('path');
const multer = require('multer');

const PROFILE_DIR = path.join(__dirname, '..', 'uploads', 'profiles');

function ensureProfileDir() {
  fs.mkdirSync(PROFILE_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    ensureProfileDir();
    cb(null, PROFILE_DIR);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const safe = ext && ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext) ? ext : '.jpg';
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${safe}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = /^image\/(jpeg|jpg|png|webp|gif)$/i.test(file.mimetype);
    if (!ok) return cb(new Error('Only JPEG, PNG, WebP, or GIF images are allowed'));
    cb(null, true);
  },
});

function optionalProfileUpload(req, res, next) {
  const ct = String(req.headers['content-type'] || '');
  if (ct.includes('multipart/form-data')) {
    return upload.single('image')(req, res, (err) => {
      if (err) return res.status(400).json({ error: err.message || 'Invalid upload' });
      next();
    });
  }
  next();
}

function publicPathForProfile(filename) {
  return `/uploads/profiles/${filename}`;
}

function removeProfileImage(publicUrlPath) {
  if (!publicUrlPath || typeof publicUrlPath !== 'string') return;
  if (!publicUrlPath.startsWith('/uploads/profiles/')) return;
  const abs = path.join(__dirname, '..', publicUrlPath.replace(/^\//, ''));
  if (!abs.startsWith(PROFILE_DIR)) return;
  try {
    fs.unlinkSync(abs);
  } catch {}
}

module.exports = { optionalProfileUpload, publicPathForProfile, removeProfileImage };
