const mongoose = require('mongoose');

const foodOrderItemSchema = new mongoose.Schema(
  {
    menuItemId: { type: mongoose.Schema.Types.ObjectId, ref: 'MenuItem', required: true },
    name: { type: String, required: true, trim: true },
    unitPrice: { type: Number, required: true, min: 0 },
    quantity: { type: Number, required: true, min: 1, max: 20 },
    lineTotal: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const foodOrderSchema = new mongoose.Schema(
  {
    reservationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Reservation',
    },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tableName: { type: String, required: true, trim: true },
    orderType: { type: String, enum: ['table', 'food'], default: 'table' },
    slotStartAt: { type: Date, default: null },
    slotEndAt: { type: Date, default: null },
    items: { type: [foodOrderItemSchema], default: [] },
    totalAmount: { type: Number, required: true, min: 0, default: 0 },
    currency: { type: String, default: 'LKR' },
    paymentStatus: {
      type: String,
      enum: ['unpaid', 'paid', 'failed', 'refunded'],
      default: 'paid',
      index: true,
    },
    stripeCheckoutSessionId: { type: String, default: '' },
    status: {
      type: String,
      enum: ['pending_payment', 'placed', 'in_production', 'delivered', 'cancelled'],
      default: 'placed',
      index: true,
    },
  },
  { timestamps: true }
);

foodOrderSchema.index({ status: 1, createdAt: -1 });

// Ensure reservationId is unique only when the field exists on reservation-linked orders.
foodOrderSchema.index({ reservationId: 1 }, { unique: true, sparse: true });

module.exports = mongoose.models.FoodOrder || mongoose.model('FoodOrder', foodOrderSchema);
