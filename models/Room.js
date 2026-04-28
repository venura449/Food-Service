const mongoose = require('mongoose');

const packageSchema = new mongoose.Schema(
  {
    guestCount: { type: Number, required: true, min: 1, max: 12 },
    label: { type: String, trim: true, default: '' },
    pricePerNight: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const roomSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true, default: '' },
    imagePath: { type: String, default: '' },
    /** e.g. wifi, tv, attached_bathroom */
    features: [{ type: String, trim: true }],
    packages: {
      type: [packageSchema],
      validate: [(v) => Array.isArray(v) && v.length >= 1 && v.length <= 6, 'Need 1–6 packages'],
    },
    offersNote: { type: String, trim: true, default: '' },
    isAvailable: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
);

roomSchema.index({ isAvailable: 1, sortOrder: 1 });

module.exports = mongoose.models.Room || mongoose.model('Room', roomSchema);
