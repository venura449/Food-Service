const mongoose = require('mongoose');

const advertisementSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    message: { type: String, trim: true, default: '' },
    /** Public path served under /uploads/ads/... */
    imagePath: { type: String, default: '' },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

advertisementSchema.index({ isActive: 1, updatedAt: -1 });

module.exports = mongoose.models.Advertisement || mongoose.model('Advertisement', advertisementSchema);
