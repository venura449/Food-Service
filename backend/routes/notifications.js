const express = require('express');

const Notification = require('../models/Notification');
const Reservation = require('../models/Reservation');

const router = express.Router();

function serialize(doc) {
  return {
    id: doc._id.toString(),
    type: doc.type,
    title: doc.title,
    message: doc.message,
    resourceType: doc.resourceType || '',
    resourceId: doc.resourceId || '',
    isRead: doc.isRead,
    createdAt: doc.createdAt,
  };
}

async function ensureReservationReminders(userId) {
  const now = new Date();
  const twoHoursFromNow = new Date(now.getTime() + 2 * 60 * 60 * 1000);
  const reservations = await Reservation.find({
    userId,
    reservationStatus: { $in: ['confirmed', 'in_production'] },
    startAt: { $gte: now, $lte: twoHoursFromNow },
  }).lean();

  for (const r of reservations) {
    const existing = await Notification.findOne({
      userId,
      type: 'reservation_reminder',
      resourceType: 'reservation',
      resourceId: String(r._id),
    }).lean();
    if (existing) continue;
    await Notification.create({
      userId,
      type: 'reservation_reminder',
      title: 'Reservation reminder',
      message: `${r.tableName} starts at ${new Date(r.startAt).toLocaleString()}.`,
      resourceType: 'reservation',
      resourceId: String(r._id),
    });
  }
}

router.get('/', async (req, res) => {
  try {
    await ensureReservationReminders(req.user.id);
    const list = await Notification.find({ userId: req.user.id }).sort({ createdAt: -1 }).limit(30).lean();
    return res.json({ notifications: list.map(serialize) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to load notifications' });
  }
});

router.patch('/:id/read', async (req, res) => {
  try {
    const n = await Notification.findOne({ _id: req.params.id, userId: req.user.id });
    if (!n) return res.status(404).json({ error: 'Notification not found' });
    n.isRead = true;
    await n.save();
    return res.json({ notification: serialize(n.toObject()) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to update notification' });
  }
});

module.exports = router;
