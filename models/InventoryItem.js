const mongoose = require('mongoose');

const inventoryItemSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    category: { type: String, trim: true, default: 'general' },
    unit: { type: String, trim: true, default: 'pcs' },
    quantity: { type: Number, required: true, min: 0, default: 0 },
    reorderLevel: { type: Number, required: true, min: 0, default: 5 },
    costPerUnit: { type: Number, required: true, min: 0, default: 0 },
    supplier: { type: String, trim: true, default: '' },
    notes: { type: String, trim: true, default: '' },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

inventoryItemSchema.index({ isActive: 1, quantity: 1, name: 1 });

module.exports = mongoose.models.InventoryItem || mongoose.model('InventoryItem', inventoryItemSchema);
