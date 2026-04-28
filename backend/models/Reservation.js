const mongoose = require('mongoose');

const reservationItemSchema = new mongoose.Schema(
  {
    menuItemId: { type: mongoose.Schema.Types.ObjectId, ref: 'MenuItem', required: true },
    name: { type: String, required: true, trim: true },
    unitPrice: { type: Number, required: true, min: 0 },
    quantity: { type: Number, required: true, min: 1, max: 20 },
    lineTotal: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const reservationSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tableResourceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Room', required: true, index: true },
    tableName: { type: String, required: true, trim: true },
    guestCount: { type: Number, required: true, min: 1, max: 12 },
    startAt: { type: Date, required: true, index: true },
    endAt: { type: Date, required: true, index: true },
    specialNote: { type: String, trim: true, default: '' },

    reservationFee: { type: Number, required: true, min: 0, default: 0 },
    foodTotal: { type: Number, required: true, min: 0, default: 0 },
    totalAmount: { type: Number, required: true, min: 0, default: 0 },
    currency: { type: String, default: 'LKR' },

    items: { type: [reservationItemSchema], default: [] },

    paymentStatus: {
      type: String,
      enum: ['unpaid', 'paid', 'failed', 'refunded'],
      default: 'unpaid',
      index: true,
    },
    reservationStatus: {
      type: String,
      enum: ['pending_payment', 'confirmed', 'in_production', 'delivered', 'cancelled'],
      default: 'pending_payment',
      index: true,
    },
    stripeCheckoutSessionId: { type: String, default: '' },
    paidAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null, index: true },
  },
  { timestamps: true }
);

reservationSchema.index({ userId: 1, createdAt: -1 });
reservationSchema.index({ tableResourceId: 1, startAt: 1, endAt: 1 });

module.exports = mongoose.models.Reservation || mongoose.model('Reservation', reservationSchema);
