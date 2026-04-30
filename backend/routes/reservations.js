const express = require('express');
const Stripe = require('stripe');
const mongoose = require('mongoose');

const MenuItem = require('../models/MenuItem');
const Reservation = require('../models/Reservation');
const Room = require('../models/Room');
const FoodOrder = require('../models/FoodOrder');
const { requireAdmin } = require('../middleware/auth');
const { createNotification, createAdminNotifications } = require('../lib/notificationService');

const router = express.Router();
const MIN_STRIPE_LKR = 0.5;
const MIN_STRIPE_LKR_MINOR = 50;

function stripeClient() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  return new Stripe(key);
}

function activeReservationStatuses() {
  return ['pending_payment', 'confirmed', 'in_production'];
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function serializeReservation(doc) {
  return {
    id: doc._id.toString(),
    userId: doc.userId?.toString?.() || String(doc.userId),
    tableResourceId: doc.tableResourceId?.toString?.() || String(doc.tableResourceId),
    tableName: doc.tableName,
    guestCount: doc.guestCount,
    startAt: doc.startAt,
    endAt: doc.endAt,
    specialNote: doc.specialNote || '',
    reservationFee: doc.reservationFee,
    foodTotal: doc.foodTotal,
    totalAmount: doc.totalAmount,
    currency: doc.currency || 'LKR',
    items: doc.items || [],
    paymentStatus: doc.paymentStatus,
    reservationStatus: doc.reservationStatus,
    paidAt: doc.paidAt,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function getReservationFee(room, guestCount) {
  const sorted = [...(room.packages || [])].sort((a, b) => a.guestCount - b.guestCount);
  const exact = sorted.find((p) => p.guestCount === guestCount);
  if (exact) return Number(exact.pricePerNight || 0);
  const fallback = sorted.find((p) => p.guestCount >= guestCount);
  if (fallback) return Number(fallback.pricePerNight || 0);
  return sorted.length ? Number(sorted[sorted.length - 1].pricePerNight || 0) : 0;
}

async function hasConflict({ tableResourceId, startAt, endAt, excludeReservationId }) {
  const query = {
    tableResourceId,
    reservationStatus: { $in: activeReservationStatuses() },
    startAt: { $lt: endAt },
    endAt: { $gt: startAt },
  };
  if (excludeReservationId) {
    query._id = { $ne: excludeReservationId };
  }
  const found = await Reservation.findOne(query).lean();
  return Boolean(found);
}

async function computeItemsAndFoodTotal(items) {
  const normalized = Array.isArray(items) ? items : [];
  if (!normalized.length) return { reservationItems: [], foodTotal: 0 };
  const ids = [];
  const qtyById = new Map();
  for (const raw of normalized) {
    const id = String(raw.menuItemId || '').trim();
    const quantity = Number(raw.quantity);
    if (!mongoose.isValidObjectId(id)) continue;
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20) continue;
    ids.push(id);
    qtyById.set(id, quantity);
  }
  if (!ids.length) return { reservationItems: [], foodTotal: 0 };

  const menuItems = await MenuItem.find({ _id: { $in: ids }, isAvailable: true }).lean();
  const reservationItems = [];
  let foodTotal = 0;
  for (const m of menuItems) {
    const id = m._id.toString();
    const qty = qtyById.get(id);
    if (!qty) continue;
    const unit = Number(m.price || 0);
    const lineTotal = unit * qty;
    reservationItems.push({
      menuItemId: m._id,
      name: m.name,
      unitPrice: unit,
      quantity: qty,
      lineTotal,
    });
    foodTotal += lineTotal;
  }
  return { reservationItems, foodTotal };
}

router.get('/mine', async (req, res) => {
  try {
    const list = await Reservation.find({ userId: req.user.id }).sort({ createdAt: -1 }).lean();
    return res.json({ reservations: list.map(serializeReservation) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to load reservations' });
  }
});

router.get('/admin', requireAdmin, async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const status = String(req.query.status || '').trim().toLowerCase();
    const filter = {};
    if (q) {
      const rx = new RegExp(escapeRegExp(q), 'i');
      filter.$or = [{ tableName: rx }, { specialNote: rx }];
    }
    if (['pending_payment', 'confirmed', 'in_production', 'delivered', 'cancelled'].includes(status)) {
      filter.reservationStatus = status;
    }
    const list = await Reservation.find(filter).sort({ startAt: 1, createdAt: -1 }).lean();
    return res.json({ reservations: list.map(serializeReservation) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to load reservations' });
  }
});

router.post('/checkout-session', async (req, res) => {
  try {
    const stripe = stripeClient();
    if (!stripe) {
      return res.status(500).json({ error: 'Stripe is not configured. Add STRIPE_SECRET_KEY.' });
    }

    const tableResourceId = String(req.body?.tableResourceId || '').trim();
    const guestCount = Number(req.body?.guestCount);
    const startAt = new Date(req.body?.startAt);
    const endAt = new Date(req.body?.endAt);
    const specialNote = String(req.body?.specialNote || '').trim();
    const returnUrl = String(req.body?.returnUrl || '').trim();
    const itemsInput = Array.isArray(req.body?.items) ? req.body.items : [];

    if (!mongoose.isValidObjectId(tableResourceId)) {
      return res.status(400).json({ error: 'Invalid table resource id' });
    }
    if (!Number.isInteger(guestCount) || guestCount < 1 || guestCount > 12) {
      return res.status(400).json({ error: 'guestCount must be 1-12' });
    }
    if (!(startAt instanceof Date) || Number.isNaN(startAt.valueOf())) {
      return res.status(400).json({ error: 'Invalid startAt' });
    }
    if (!(endAt instanceof Date) || Number.isNaN(endAt.valueOf())) {
      return res.status(400).json({ error: 'Invalid endAt' });
    }
    if (endAt <= startAt) {
      return res.status(400).json({ error: 'endAt must be after startAt' });
    }
    if (!returnUrl.startsWith('http://') && !returnUrl.startsWith('https://') && !returnUrl.includes('://')) {
      return res.status(400).json({ error: 'returnUrl is required' });
    }

    const table = await Room.findById(tableResourceId).lean();
    if (!table || !table.isAvailable) {
      return res.status(404).json({ error: 'Table resource not available' });
    }

    const conflict = await hasConflict({ tableResourceId, startAt, endAt });
    if (conflict) {
      return res.status(409).json({ error: 'This table is already reserved for the selected time.' });
    }

    const reservationFee = getReservationFee(table, guestCount);
    const { reservationItems, foodTotal } = await computeItemsAndFoodTotal(itemsInput);
    const totalAmount = reservationFee + foodTotal;
    if (totalAmount <= 0) {
      return res.status(400).json({ error: 'Reservation total must be greater than zero' });
    }
    if (Math.round(totalAmount * 100) < MIN_STRIPE_LKR_MINOR) {
      return res.status(400).json({
        error: `Stripe requires a minimum payment of LKR ${MIN_STRIPE_LKR.toFixed(2)}.`,
      });
    }

    const expiresAt = new Date(Date.now() + 20 * 60 * 1000);

    const reservation = await Reservation.create({
      userId: req.user.id,
      tableResourceId: table._id,
      tableName: table.name,
      guestCount,
      startAt,
      endAt,
      specialNote,
      reservationFee,
      foodTotal,
      totalAmount,
      currency: 'LKR',
      items: reservationItems,
      paymentStatus: 'unpaid',
      reservationStatus: 'pending_payment',
      expiresAt,
    });

    const lineItems = [];
    if (reservationFee > 0) {
      lineItems.push({
        price_data: {
          currency: 'lkr',
          product_data: { name: `Table reservation: ${table.name}` },
          unit_amount: Math.round(reservationFee * 100),
        },
        quantity: 1,
      });
    }
    for (const item of reservationItems) {
      if (!(item.unitPrice > 0 && item.quantity > 0)) continue;
      lineItems.push({
        price_data: {
          currency: 'lkr',
          product_data: { name: item.name },
          unit_amount: Math.round(item.unitPrice * 100),
        },
        quantity: item.quantity,
      });
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: lineItems,
      success_url: `${returnUrl}?stripe=success&session_id={CHECKOUT_SESSION_ID}&reservationId=${reservation._id}`,
      cancel_url: `${returnUrl}?stripe=cancel&reservationId=${reservation._id}`,
      metadata: {
        reservationId: reservation._id.toString(),
        userId: String(req.user.id),
      },
    });

    reservation.stripeCheckoutSessionId = session.id;
    await reservation.save();

    return res.status(201).json({
      reservation: serializeReservation(reservation.toObject()),
      checkoutUrl: session.url,
      sessionId: session.id,
    });
  } catch (err) {
    console.error(err);
    const detail =
      err && typeof err === 'object' && 'message' in err && typeof err.message === 'string'
        ? err.message
        : 'Unknown Stripe error';
    return res.status(500).json({ error: `Failed to create checkout session: ${detail}` });
  }
});

router.post('/confirm-payment', async (req, res) => {
  try {
    const stripe = stripeClient();
    if (!stripe) {
      return res.status(500).json({ error: 'Stripe is not configured. Add STRIPE_SECRET_KEY.' });
    }

    const reservationId = String(req.body?.reservationId || '').trim();
    const sessionId = String(req.body?.sessionId || '').trim();
    if (!mongoose.isValidObjectId(reservationId) || !sessionId) {
      return res.status(400).json({ error: 'reservationId and sessionId are required' });
    }

    const reservation = await Reservation.findById(reservationId);
    if (!reservation || String(reservation.userId) !== String(req.user.id)) {
      return res.status(404).json({ error: 'Reservation not found' });
    }
    if (reservation.stripeCheckoutSessionId && reservation.stripeCheckoutSessionId !== sessionId) {
      return res.status(400).json({ error: 'Session mismatch' });
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.payment_status !== 'paid') {
      reservation.paymentStatus = 'failed';
      await reservation.save();
      return res.status(400).json({ error: 'Payment is not completed yet' });
    }

    const conflict = await hasConflict({
      tableResourceId: reservation.tableResourceId,
      startAt: reservation.startAt,
      endAt: reservation.endAt,
      excludeReservationId: reservation._id,
    });
    if (conflict) {
      reservation.reservationStatus = 'cancelled';
      await reservation.save();
      return res.status(409).json({ error: 'Time slot was taken before payment confirmation.' });
    }

    reservation.paymentStatus = 'paid';
    reservation.reservationStatus = 'confirmed';
    reservation.paidAt = new Date();
    reservation.expiresAt = null;
    await reservation.save();

    await createNotification({
      userId: reservation.userId,
      type: 'new_order',
      title: 'Reservation confirmed',
      message: `${reservation.tableName} has been reserved successfully.`,
      resourceType: 'reservation',
      resourceId: reservation._id,
    });
    await createAdminNotifications({
      type: 'new_order',
      title: 'New reservation placed',
      message: `${reservation.tableName} was confirmed and is ready for admin review.`,
      resourceType: 'reservation',
      resourceId: reservation._id,
    });

    if (Array.isArray(reservation.items) && reservation.items.length) {
      const existing = await FoodOrder.findOne({ reservationId: reservation._id }).lean();
      if (!existing) {
        await FoodOrder.create({
          reservationId: reservation._id,
          userId: reservation.userId,
          tableName: reservation.tableName,
          orderType: 'table',
          slotStartAt: reservation.startAt,
          slotEndAt: reservation.endAt,
          items: reservation.items,
          totalAmount: reservation.foodTotal,
          currency: reservation.currency || 'LKR',
          paymentStatus: 'paid',
          status: 'placed',
        });
      }
    }

    return res.json({ reservation: serializeReservation(reservation.toObject()) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to confirm payment' });
  }
});

module.exports = router;
