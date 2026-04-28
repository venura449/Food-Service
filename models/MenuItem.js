const mongoose = require('mongoose');

const menuItemSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true, default: '' },
    price: { type: Number, required: true, min: 0 },
    category: {
      type: String,
      enum: ['main', 'side', 'drink'],
      required: true,
    },
    isAvailable: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
    /** Public path served under /uploads/menu/... */
    imagePath: { type: String, default: '' },
  },
  { timestamps: true }
);

menuItemSchema.index({ category: 1, isAvailable: 1 });

module.exports = mongoose.models.MenuItem || mongoose.model('MenuItem', menuItemSchema);
