const express = require('express');

const Advertisement = require('../models/Advertisement');
const { requireAdmin } = require('../middleware/auth');
const {
  optionalAdImageUpload,
  publicPathForAdFile,
  removeAdImageFile,
} = require('../lib/advertisementUpload');
const { toAbsoluteAssetUrl } = require('../lib/assetUrl');

const router = express.Router();

function serialize(doc, req) {
  return {
    id: doc._id.toString(),
    title: doc.title,
    message: doc.message || '',
    imagePath: toAbsoluteAssetUrl(req, doc.imagePath || ''),
    isActive: !!doc.isActive,
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

router.get('/random', async (_req, res) => {
  try {
    const [item] = await Advertisement.aggregate([{ $match: { isActive: true } }, { $sample: { size: 1 } }]);
    return res.json({ ad: item ? serialize(item, req) : null });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to load advertisement' });
  }
});

router.get('/admin', requireAdmin, async (_req, res) => {
  try {
    const list = await Advertisement.find({}).sort({ updatedAt: -1, createdAt: -1 }).lean();
    return res.json({ ads: list.map((item) => serialize(item, req)) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to load advertisements' });
  }
});

router.post('/', requireAdmin, optionalAdImageUpload, async (req, res) => {
  try {
    const title = String(req.body?.title || '').trim();
    const message = String(req.body?.message || '').trim();
    const isActive = boolFromBody(req.body?.isActive, true);
    if (!title) return res.status(400).json({ error: 'Title is required' });

    const ad = await Advertisement.create({
      title,
      message,
      isActive,
      imagePath: req.file?.filename ? publicPathForAdFile(req.file.filename) : '',
    });

    return res.status(201).json({ ad: serialize(ad.toObject(), req) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to create advertisement' });
  }
});

router.patch('/:id', requireAdmin, optionalAdImageUpload, async (req, res) => {
  try {
    const ad = await Advertisement.findById(req.params.id);
    if (!ad) return res.status(404).json({ error: 'Advertisement not found' });

    if (req.body.title !== undefined) {
      ad.title = String(req.body.title).trim();
      if (!ad.title) return res.status(400).json({ error: 'Title cannot be empty' });
    }
    if (req.body.message !== undefined) ad.message = String(req.body.message).trim();
    if (req.body.isActive !== undefined) ad.isActive = boolFromBody(req.body.isActive, true);

    if (req.file?.filename) {
      if (ad.imagePath) removeAdImageFile(ad.imagePath);
      ad.imagePath = publicPathForAdFile(req.file.filename);
    }

    await ad.save();
    return res.json({ ad: serialize(ad.toObject(), req) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to update advertisement' });
  }
});

router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const ad = await Advertisement.findById(req.params.id).lean();
    if (!ad) return res.status(404).json({ error: 'Advertisement not found' });
    if (ad.imagePath) removeAdImageFile(ad.imagePath);
    await Advertisement.deleteOne({ _id: req.params.id });
    return res.status(204).end();
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to delete advertisement' });
  }
});

module.exports = router;
