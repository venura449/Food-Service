const express = require('express');
const mongoose = require('mongoose');

const Review = require('../models/Review');
const Reservation = require('../models/Reservation');
const User = require('../models/User');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

function serialize(doc) {
  return {
    id: doc._id.toString(),
    userId: doc.userId?.toString?.() || String(doc.userId || ''),
    reservationId: doc.reservationId?.toString?.() || '',
    userName: doc.userName || 'Anonymous',
    userEmail: doc.userEmail || '',
    rating: Number(doc.rating || 0),
    comment: doc.comment || '',
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

router.post('/', async (req, res) => {
  try {
    const rating = Number(req.body?.rating);
    const comment = String(req.body?.comment || '').trim();
    const reservationIdRaw = String(req.body?.reservationId || '').trim();
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'Rating must be an integer between 1 and 5' });
    }
    let reservationId = null;
    if (reservationIdRaw) {
      if (!mongoose.isValidObjectId(reservationIdRaw)) {
        return res.status(400).json({ error: 'Invalid reservationId' });
      }
      const reservation = await Reservation.findById(reservationIdRaw).lean();
      if (!reservation || String(reservation.userId) !== String(req.user.id)) {
        return res.status(404).json({ error: 'Reservation not found' });
      }
      if (reservation.reservationStatus !== 'delivered') {
        return res.status(400).json({ error: 'Review is available only after delivery' });
      }
      if (new Date(reservation.endAt).getTime() > Date.now()) {
        return res.status(400).json({ error: 'Review is available when reservation time is over' });
      }
      reservationId = reservation._id;
      const existing = await Review.findOne({ userId: req.user.id, reservationId }).lean();
      if (existing) {
        return res.status(409).json({ error: 'Review already submitted for this reservation' });
      }
    }
    const user = await User.findById(req.user.id).lean();
    const doc = await Review.create({
      userId: req.user.id,
      reservationId,
      userName: user?.name || user?.email || 'Anonymous',
      userEmail: user?.email || '',
      rating,
      comment,
    });
    return res.status(201).json({ review: serialize(doc.toObject()) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to submit review' });
  }
});

router.get('/my-reservation-ids', async (req, res) => {
  try {
    const rows = await Review.find({
      userId: req.user.id,
      reservationId: { $type: 'objectId' },
    })
      .select({ reservationId: 1 })
      .lean();
    const reviewedReservationIds = rows
      .map((r) => (r.reservationId ? String(r.reservationId) : ''))
      .filter(Boolean);
    return res.json({ reviewedReservationIds });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to load reviewed reservations' });
  }
});

router.get('/admin', requireAdmin, async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page || 1) || 1);
    const limit = Math.min(20, Math.max(1, Number(req.query.limit || 5) || 5));
    const skip = (page - 1) * limit;
    const [rows, total] = await Promise.all([
      Review.find({}).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      Review.countDocuments({}),
    ]);
    const avgAgg = await Review.aggregate([
      { $group: { _id: null, avgRating: { $avg: '$rating' } } },
    ]);
    return res.json({
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      avgRating: avgAgg[0]?.avgRating || 0,
      reviews: rows.map(serialize),
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to load reviews' });
  }
});

module.exports = router;
