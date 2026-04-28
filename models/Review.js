const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    reservationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Reservation', default: null, index: true },
    userName: { type: String, trim: true, default: '' },
    userEmail: { type: String, trim: true, default: '' },
    rating: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, trim: true, default: '' },
  },
  { timestamps: true }
);

reviewSchema.index({ createdAt: -1 });
reviewSchema.index(
  { userId: 1, reservationId: 1 },
  { unique: true, partialFilterExpression: { reservationId: { $type: 'objectId' } } }
);

module.exports = mongoose.models.Review || mongoose.model('Review', reviewSchema);
