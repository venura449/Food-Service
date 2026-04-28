const express = require('express');

const InventoryItem = require('../models/InventoryItem');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

router.use(requireAdmin);

function serialize(doc) {
  const quantity = Number(doc.quantity || 0);
  const reorderLevel = Number(doc.reorderLevel || 5);
  return {
    id: doc._id.toString(),
    name: doc.name,
    category: doc.category || 'general',
    unit: doc.unit || 'pcs',
    quantity,
    reorderLevel,
    costPerUnit: Number(doc.costPerUnit || 0),
    supplier: doc.supplier || '',
    notes: doc.notes || '',
    isActive: doc.isActive !== false,
    isLowStock: quantity < reorderLevel,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

router.get('/items', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const lowOnly = String(req.query.low || '').toLowerCase() === '1';
    const filter = {};
    if (q) {
      const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ name: rx }, { category: rx }, { supplier: rx }];
    }
    if (lowOnly) filter.$expr = { $lt: ['$quantity', '$reorderLevel'] };
    const list = await InventoryItem.find(filter).sort({ quantity: 1, name: 1 }).lean();
    const items = list.map(serialize);
    const lowStockCount = items.filter((i) => i.isLowStock).length;
    return res.json({ items, lowStockCount });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to load inventory' });
  }
});

router.get('/alerts', async (_req, res) => {
  try {
    const lowItems = await InventoryItem.find({
      $expr: { $lt: ['$quantity', '$reorderLevel'] },
      isActive: true,
    })
      .sort({ quantity: 1, name: 1 })
      .lean();
    const items = lowItems.map(serialize);
    return res.json({
      generatedAt: new Date(),
      lowStockCount: items.length,
      items,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to load low-stock alerts' });
  }
});

router.post('/items', async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Name is required' });
    const doc = await InventoryItem.create({
      name,
      category: String(req.body?.category || 'general').trim() || 'general',
      unit: String(req.body?.unit || 'pcs').trim() || 'pcs',
      quantity: Number(req.body?.quantity ?? 0),
      reorderLevel: Number(req.body?.reorderLevel ?? 5),
      costPerUnit: Number(req.body?.costPerUnit ?? 0),
      supplier: String(req.body?.supplier || '').trim(),
      notes: String(req.body?.notes || '').trim(),
      isActive: req.body?.isActive !== false,
    });
    return res.status(201).json({ item: serialize(doc.toObject()) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to create inventory item' });
  }
});

router.patch('/items/:id', async (req, res) => {
  try {
    const item = await InventoryItem.findById(req.params.id);
    if (!item) return res.status(404).json({ error: 'Item not found' });
    if (req.body.name !== undefined) item.name = String(req.body.name).trim();
    if (req.body.category !== undefined) item.category = String(req.body.category).trim() || 'general';
    if (req.body.unit !== undefined) item.unit = String(req.body.unit).trim() || 'pcs';
    if (req.body.quantity !== undefined) item.quantity = Math.max(0, Number(req.body.quantity) || 0);
    if (req.body.reorderLevel !== undefined) item.reorderLevel = Math.max(0, Number(req.body.reorderLevel) || 0);
    if (req.body.costPerUnit !== undefined) item.costPerUnit = Math.max(0, Number(req.body.costPerUnit) || 0);
    if (req.body.supplier !== undefined) item.supplier = String(req.body.supplier).trim();
    if (req.body.notes !== undefined) item.notes = String(req.body.notes).trim();
    if (req.body.isActive !== undefined) item.isActive = Boolean(req.body.isActive);
    await item.save();
    return res.json({ item: serialize(item.toObject()) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to update inventory item' });
  }
});

router.delete('/items/:id', async (req, res) => {
  try {
    const item = await InventoryItem.findById(req.params.id);
    if (!item) return res.status(404).json({ error: 'Item not found' });
    await InventoryItem.deleteOne({ _id: item._id });
    return res.status(204).end();
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to delete inventory item' });
  }
});

module.exports = router;
