const express = require('express');
const MenuItem = require('../models/MenuItem');
const { requireAdmin } = require('../middleware/auth');
const { optionalImageUpload, publicPathForFile, removeImageFile } = require('../lib/menuUpload');

const router = express.Router();

function serialize(doc) {
  return {
    id: doc._id.toString(),
    name: doc.name,
    description: doc.description || '',
    price: doc.price,
    category: doc.category,
    isAvailable: doc.isAvailable,
    sortOrder: doc.sortOrder,
    imagePath: doc.imagePath || '',
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

/** GET /api/menu/items?category=main|side|drink&q=search — available items only */
router.get('/items', async (req, res) => {
  try {
    const category = String(req.query.category || '').toLowerCase();
    const q = String(req.query.q || '').trim();

    const filter = { isAvailable: true };
    if (['main', 'side', 'drink'].includes(category)) {
      filter.category = category;
    }
    if (q) {
      const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ name: rx }, { description: rx }];
    }

    const items = await MenuItem.find(filter).sort({ sortOrder: 1, createdAt: -1 }).lean();
    return res.json({ items: items.map(serialize) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to load menu' });
  }
});

router.get('/items/admin', requireAdmin, async (req, res) => {
  try {
    const category = String(req.query.category || '').toLowerCase();
    const q = String(req.query.q || '').trim();

    const filter = {};
    if (['main', 'side', 'drink'].includes(category)) {
      filter.category = category;
    }
    if (q) {
      const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ name: rx }, { description: rx }];
    }

    const items = await MenuItem.find(filter).sort({ sortOrder: 1, createdAt: -1 }).lean();
    return res.json({ items: items.map(serialize) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to load menu' });
  }
});

router.post('/items', requireAdmin, optionalImageUpload, async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    const description = String(req.body?.description || '').trim();
    const price = Number(req.body?.price);
    const category = String(req.body?.category || '').toLowerCase();
    const isAvailable = boolFromBody(req.body?.isAvailable, true);

    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }
    if (!Number.isFinite(price) || price < 0) {
      return res.status(400).json({ error: 'Valid price is required' });
    }
    if (!['main', 'side', 'drink'].includes(category)) {
      return res.status(400).json({ error: 'Category must be main, side, or drink' });
    }

    let imagePath = '';
    if (req.file?.filename) {
      imagePath = publicPathForFile(req.file.filename);
    }

    const item = await MenuItem.create({
      name,
      description,
      price,
      category,
      isAvailable,
      imagePath,
    });

    return res.status(201).json({ item: serialize(item.toObject()) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to create item' });
  }
});

router.patch('/items/:id', requireAdmin, optionalImageUpload, async (req, res) => {
  try {
    const item = await MenuItem.findById(req.params.id);
    if (!item) {
      return res.status(404).json({ error: 'Item not found' });
    }

    if (req.body.name !== undefined) item.name = String(req.body.name).trim();
    if (req.body.description !== undefined) item.description = String(req.body.description).trim();
    if (req.body.price !== undefined) {
      const p = Number(req.body.price);
      if (!Number.isFinite(p) || p < 0) {
        return res.status(400).json({ error: 'Invalid price' });
      }
      item.price = p;
    }
    if (req.body.category !== undefined) {
      const c = String(req.body.category).toLowerCase();
      if (!['main', 'side', 'drink'].includes(c)) {
        return res.status(400).json({ error: 'Invalid category' });
      }
      item.category = c;
    }
    if (req.body.isAvailable !== undefined) item.isAvailable = boolFromBody(req.body.isAvailable);
    if (req.body.sortOrder !== undefined) {
      const s = Number(req.body.sortOrder);
      if (Number.isFinite(s)) item.sortOrder = s;
    }

    if (req.file?.filename) {
      if (item.imagePath) removeImageFile(item.imagePath);
      item.imagePath = publicPathForFile(req.file.filename);
    }

    await item.save();
    return res.json({ item: serialize(item.toObject()) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to update item' });
  }
});

router.delete('/items/:id', requireAdmin, async (req, res) => {
  try {
    const item = await MenuItem.findById(req.params.id).lean();
    if (!item) {
      return res.status(404).json({ error: 'Item not found' });
    }
    if (item.imagePath) removeImageFile(item.imagePath);
    await MenuItem.deleteOne({ _id: req.params.id });
    return res.status(204).end();
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to delete item' });
  }
});

module.exports = router;
