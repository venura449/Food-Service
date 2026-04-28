const fs = require('fs');
const path = require('path');
const multer = require('multer');

const ROOM_DIR = path.join(__dirname, '..', 'uploads', 'rooms');

function ensureRoomDir() {
  fs.mkdirSync(ROOM_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    ensureRoomDir();
    cb(null, ROOM_DIR);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const safe =
      ext && ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext) ? ext : '.jpg';
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${safe}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 6 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = /^image\/(jpeg|jpg|png|webp|gif)$/i.test(file.mimetype);
    if (!ok) {
      cb(new Error('Only JPEG, PNG, WebP, or GIF images are allowed'));
      return;
    }
    cb(null, true);
  },
});

function optionalImageUpload(req, res, next) {
  const ct = String(req.headers['content-type'] || '');
  if (ct.includes('multipart/form-data')) {
    return upload.single('image')(req, res, (err) => {
      if (err) {
        return res.status(400).json({ error: err.message || 'Invalid upload' });
      }
      next();
    });
  }
  next();
}

function publicPathForFile(filename) {
  return `/uploads/rooms/${filename}`;
}

function absoluteDiskPath(publicUrlPath) {
  if (!publicUrlPath || typeof publicUrlPath !== 'string') return null;
  const rel = publicUrlPath.replace(/^\//, '');
  return path.join(__dirname, '..', rel);
}

function removeImageFile(publicUrlPath) {
  if (!publicUrlPath || typeof publicUrlPath !== 'string') return;
  if (!publicUrlPath.startsWith('/uploads/rooms/')) return;
  const abs = absoluteDiskPath(publicUrlPath);
  if (!abs || !abs.startsWith(ROOM_DIR)) return;
  try {
    fs.unlinkSync(abs);
  } catch {
    /* ignore */
  }
}

module.exports = {
  optionalImageUpload,
  publicPathForFile,
  removeImageFile,
  ROOM_DIR,
};
