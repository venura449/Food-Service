const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: {
      type: String,
      enum: ['new_order', 'reservation_reminder', 'order_in_production', 'order_delivered'],
      required: true,
      index: true,
    },
    title: { type: String, required: true, trim: true },
    message: { type: String, required: true, trim: true },
    resourceType: { type: String, trim: true, default: '' },
    resourceId: { type: String, trim: true, default: '' },
    isRead: { type: Boolean, default: false, index: true },
  },
  { timestamps: true }
);

notificationSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.models.Notification || mongoose.model('Notification', notificationSchema);
