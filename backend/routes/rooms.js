const express = require('express');
const Room = require('../models/Room');
const { requireAdmin } = require('../middleware/auth');
const { optionalImageUpload, publicPathForFile, removeImageFile } = require('../lib/roomUpload');
const { toAbsoluteAssetUrl } = require('../lib/assetUrl');

const router = express.Router();

const ALLOWED_FEATURES = new Set([
  'wifi',
  'private_area',
  'ac',
  'window_side',
  'family_friendly',
  'outdoor',
  'live_music',
  'wheelchair_access',
  'power_outlet',
  'quiet_zone',
]);

function serialize(doc, req) {
  return {
    id: doc._id.toString(),
    name: doc.name,
    description: doc.description || '',
    imagePath: toAbsoluteAssetUrl(req, doc.imagePath || ''),
    features: doc.features || [],
    packages: (doc.packages || []).map((p) => ({
      guestCount: p.guestCount,
      label: p.label || '',
      pricePerNight: p.pricePerNight,
    })),
    offersNote: doc.offersNote || '',
    isAvailable: doc.isAvailable,
    sortOrder: doc.sortOrder ?? 0,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function boolFromBody(v, defaultVal = true) {
  if (v === undefined || v === '') return defaultVal;
  if (typeof v === 'boolean') return v;
  const s = String(v).toLowerCase();
  if (s === 'false' || s === '0') return false;
  if (s === 'true' || s === '1') return true;
  return defaultVal;
}

function parsePackages(raw) {
  let arr;
  if (Array.isArray(raw)) arr = raw;
  else if (typeof raw === 'string' && raw.trim()) {
    try {
      arr = JSON.parse(raw);
    } catch {
      return { error: 'packages must be valid JSON' };
    }
  } else {
    return { error: 'packages are required (array of guest tiers)' };
  }
  if (!Array.isArray(arr) || arr.length < 1 || arr.length > 6) {
    return { error: 'Need 1–6 packages (guest count + price per night)' };
  }
  const out = [];
  const seen = new Set();
  for (const p of arr) {
    const guestCount = Number(p.guestCount);
    const pricePerNight = Number(p.pricePerNight);
    if (!Number.isInteger(guestCount) || guestCount < 1 || guestCount > 12) {
      return { error: 'Each package needs guestCount 1–12' };
    }
    if (!Number.isFinite(pricePerNight) || pricePerNight < 0) {
      return { error: 'Each package needs a valid pricePerNight' };
    }
    if (seen.has(guestCount)) {
      return { error: 'Duplicate guestCount in packages' };
    }
    seen.add(guestCount);
    out.push({
      guestCount,
      label: String(p.label || '').trim(),
      pricePerNight,
    });
  }
  return { packages: out };
}

function parseFeatures(raw) {
  let arr;
  if (Array.isArray(raw)) arr = raw;
  else if (typeof raw === 'string' && raw.trim()) {
    try {
      const j = JSON.parse(raw);
      arr = Array.isArray(j) ? j : String(raw).split(',').map((s) => s.trim());
    } catch {
      arr = String(raw)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    }
  } else {
    arr = [];
  }
  const out = [];
  for (const f of arr) {
    const k = String(f || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '_');
    if (ALLOWED_FEATURES.has(k) && !out.includes(k)) out.push(k);
  }
  return out;
}

function guestFilter(query) {
  const guests = query.guests;
  const guestsMin = query.guestsMin;
  if (guests !== undefined && guests !== '' && guests != null) {
    const n = Number(guests);
    if (Number.isInteger(n) && n >= 1 && n <= 12) {
      return { packages: { $elemMatch: { guestCount: n } } };
    }
  }
  if (guestsMin !== undefined && guestsMin !== '' && guestsMin != null) {
    const n = Number(guestsMin);
    if (Number.isInteger(n) && n >= 1 && n <= 12) {
      return { packages: { $elemMatch: { guestCount: { $gte: n } } } };
    }
  }
  return {};
}

/** GET /api/rooms/items?q=&guests=&guestsMin= — available rooms */
router.get('/items', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const filter = { isAvailable: true, ...guestFilter(req.query) };
    if (q) {
      const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ name: rx }, { description: rx }, { offersNote: rx }];
    }
    const rooms = await Room.find(filter).sort({ sortOrder: 1, createdAt: -1 }).lean();
    return res.json({ rooms: rooms.map((room) => serialize(room, req)) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to load rooms' });
  }
});

router.get('/items/admin', requireAdmin, async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const filter = { ...guestFilter(req.query) };
    if (q) {
      const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ name: rx }, { description: rx }, { offersNote: rx }];
    }
    const rooms = await Room.find(filter).sort({ sortOrder: 1, createdAt: -1 }).lean();
    return res.json({ rooms: rooms.map((room) => serialize(room, req)) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to load rooms' });
  }
});

router.post('/items', requireAdmin, optionalImageUpload, async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    const description = String(req.body?.description || '').trim();
    const offersNote = String(req.body?.offersNote || '').trim();
    const isAvailable = boolFromBody(req.body?.isAvailable, true);
    const sortOrder = Number(req.body?.sortOrder);
    const parsed = parsePackages(req.body?.packages);
    if (parsed.error) {
      return res.status(400).json({ error: parsed.error });
    }
    const features = parseFeatures(req.body?.features);

    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }

    let imagePath = '';
    if (req.file?.filename) {
      imagePath = publicPathForFile(req.file.filename);
    }

    const doc = {
      name,
      description,
      offersNote,
      features,
      packages: parsed.packages,
      isAvailable,
      imagePath,
    };
    if (Number.isFinite(sortOrder)) doc.sortOrder = sortOrder;

    const room = await Room.create(doc);
    return res.status(201).json({ room: serialize(room.toObject(), req) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to create room' });
  }
});

router.patch('/items/:id', requireAdmin, optionalImageUpload, async (req, res) => {
  try {
    const room = await Room.findById(req.params.id);
    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }

    if (req.body.name !== undefined) room.name = String(req.body.name).trim();
    if (req.body.description !== undefined) room.description = String(req.body.description).trim();
    if (req.body.offersNote !== undefined) room.offersNote = String(req.body.offersNote).trim();
    if (req.body.isAvailable !== undefined) room.isAvailable = boolFromBody(req.body.isAvailable);
    if (req.body.sortOrder !== undefined) {
      const s = Number(req.body.sortOrder);
      if (Number.isFinite(s)) room.sortOrder = s;
    }
    if (req.body.features !== undefined) {
      room.features = parseFeatures(req.body.features);
    }
    if (req.body.packages !== undefined) {
      const parsed = parsePackages(req.body.packages);
      if (parsed.error) {
        return res.status(400).json({ error: parsed.error });
      }
      room.packages = parsed.packages;
    }

    if (req.file?.filename) {
      if (room.imagePath) removeImageFile(room.imagePath);
      room.imagePath = publicPathForFile(req.file.filename);
    }

    await room.save();
    return res.json({ room: serialize(room.toObject(), req) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to update room' });
  }
});

router.delete('/items/:id', requireAdmin, async (req, res) => {
  try {
    const room = await Room.findById(req.params.id).lean();
    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }
    if (room.imagePath) removeImageFile(room.imagePath);
    await Room.deleteOne({ _id: req.params.id });
    return res.status(204).end();
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to delete room' });
  }
});

module.exports = router;
