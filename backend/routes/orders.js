const express = require('express');
const mongoose = require('mongoose');
const Stripe = require('stripe');

const FoodOrder = require('../models/FoodOrder');
const Reservation = require('../models/Reservation');
const { requireAdmin } = require('../middleware/auth');
const MenuItem = require('../models/MenuItem');
const { createNotification, createAdminNotifications } = require('../lib/notificationService');

const router = express.Router();
const MIN_STRIPE_LKR = 0.5;
const MIN_STRIPE_LKR_MINOR = 50;

function stripeClient() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  return new Stripe(key);
}

function serialize(order) {
  return {
    id: order._id.toString(),
    reservationId: order.reservationId?.toString?.() || String(order.reservationId),
    userId: order.userId?.toString?.() || String(order.userId),
    tableName: order.tableName,
    orderType: order.orderType || 'table',
    slotStartAt: order.slotStartAt,
    slotEndAt: order.slotEndAt,
    items: order.items || [],
    totalAmount: order.totalAmount,
    currency: order.currency || 'LKR',
    paymentStatus: order.paymentStatus,
    stripeCheckoutSessionId: order.stripeCheckoutSessionId || '',
    status: order.status,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
}

router.get('/admin', requireAdmin, async (req, res) => {
  try {
    const status = String(req.query.status || '').trim().toLowerCase();
    const q = String(req.query.q || '').trim();
    const filter = { status: { $ne: 'pending_payment' } };
    if (['placed', 'in_production', 'delivered', 'cancelled'].includes(status)) {
      filter.status = status;
    }
    if (q) {
      const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ tableName: rx }, { 'items.name': rx }];
    }
    const orders = await FoodOrder.find(filter).sort({ createdAt: -1 }).lean();
    return res.json({ orders: orders.map(serialize) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to load orders' });
  }
});

router.patch('/admin/:id/status', requireAdmin, async (req, res) => {
  try {
    const status = String(req.body?.status || '').trim().toLowerCase();
    if (!['placed', 'in_production', 'delivered', 'cancelled'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    const order = await FoodOrder.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }
    order.status = status;
    await order.save();

    const reservation = order.reservationId ? await Reservation.findById(order.reservationId) : null;
    if (reservation) {
      if (status === 'in_production') reservation.reservationStatus = 'in_production';
      if (status === 'delivered') reservation.reservationStatus = 'delivered';
      if (status === 'cancelled') reservation.reservationStatus = 'cancelled';
      await reservation.save();
    }

    if (status === 'in_production') {
      await createNotification({
        userId: order.userId,
        type: 'order_in_production',
        title: 'Order in production',
        message: `${order.tableName} is now being prepared.`,
        resourceType: 'order',
        resourceId: order._id,
      });
    }
    if (status === 'delivered') {
      await createNotification({
        userId: order.userId,
        type: 'order_delivered',
        title: 'Order delivered',
        message: `${order.tableName} has been marked as delivered.`,
        resourceType: 'order',
        resourceId: order._id,
      });
    }

    return res.json({ order: serialize(order.toObject()) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to update order status' });
  }
});

async function computeFoodCart(itemsInput) {
  const qtyById = new Map();
  for (const raw of itemsInput) {
    const id = String(raw?.menuItemId || '').trim();
    const qty = Number(raw?.quantity);
    if (!id || !mongoose.isValidObjectId(id)) continue;
    if (!Number.isInteger(qty) || qty < 1 || qty > 20) continue;
    qtyById.set(id, (qtyById.get(id) || 0) + qty);
  }
  const ids = [...qtyById.keys()];
  if (!ids.length) return { orderItems: [], totalAmount: 0 };
  const menuItems = await MenuItem.find({ _id: { $in: ids }, isAvailable: true }).lean();
  const found = new Map(menuItems.map((m) => [m._id.toString(), m]));
  const orderItems = [];
  let totalAmount = 0;
  for (const [id, qty] of qtyById.entries()) {
    const m = found.get(id);
    if (!m) continue;
    const unitPrice = Number(m.price || 0);
    const lineTotal = unitPrice * qty;
    orderItems.push({
      menuItemId: m._id,
      name: m.name,
      unitPrice,
      quantity: qty,
      lineTotal,
    });
    totalAmount += lineTotal;
  }
  return { orderItems, totalAmount };
}

router.post('/user/food/checkout-session', async (req, res) => {
  try {
    const itemsInput = Array.isArray(req.body?.items) ? req.body.items : [];
    const returnUrl = String(req.body?.returnUrl || '').trim();
    if (!itemsInput.length) return res.status(400).json({ error: 'Cart items are required' });
    if (!returnUrl.startsWith('http://') && !returnUrl.startsWith('https://') && !returnUrl.includes('://')) {
      return res.status(400).json({ error: 'returnUrl is required' });
    }
    const stripe = stripeClient();
    if (!stripe) {
      return res.status(500).json({ error: 'Stripe is not configured. Add STRIPE_SECRET_KEY.' });
    }

    const { orderItems, totalAmount } = await computeFoodCart(itemsInput);
    if (!orderItems.length || totalAmount <= 0) {
      return res.status(400).json({ error: 'Cart total must be greater than zero' });
    }
    if (Math.round(totalAmount * 100) < MIN_STRIPE_LKR_MINOR) {
      return res.status(400).json({
        error: `Stripe requires a minimum payment of LKR ${MIN_STRIPE_LKR.toFixed(2)}.`,
      });
    }

    const order = await FoodOrder.create({
      userId: req.user.id,
      tableName: String(req.body?.tableName || 'Food Order').trim() || 'Food Order',
      orderType: 'food',
      slotStartAt: null,
      slotEndAt: null,
      items: orderItems,
      totalAmount,
      currency: 'LKR',
      paymentStatus: 'unpaid',
      stripeCheckoutSessionId: '',
      status: 'pending_payment',
    });

    const lineItems = orderItems
      .filter((item) => item.unitPrice > 0 && item.quantity > 0)
      .map((item) => ({
      price_data: {
        currency: 'lkr',
        product_data: { name: item.name },
        unit_amount: Math.round(item.unitPrice * 100),
      },
      quantity: item.quantity,
      }));

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: lineItems,
      success_url: `${returnUrl}?stripe=success&session_id={CHECKOUT_SESSION_ID}&foodOrderId=${order._id}`,
      cancel_url: `${returnUrl}?stripe=cancel&foodOrderId=${order._id}`,
      metadata: {
        foodOrderId: order._id.toString(),
        userId: String(req.user.id),
      },
    });

    order.stripeCheckoutSessionId = session.id;
    await order.save();

    return res.status(201).json({ order: serialize(order.toObject()), checkoutUrl: session.url, sessionId: session.id });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to create food checkout session' });
  }
});

router.post('/user/food/confirm-payment', async (req, res) => {
  try {
    const stripe = stripeClient();
    if (!stripe) {
      return res.status(500).json({ error: 'Stripe is not configured. Add STRIPE_SECRET_KEY.' });
    }
    const foodOrderId = String(req.body?.foodOrderId || '').trim();
    const sessionId = String(req.body?.sessionId || '').trim();
    if (!mongoose.isValidObjectId(foodOrderId) || !sessionId) {
      return res.status(400).json({ error: 'foodOrderId and sessionId are required' });
    }
    const order = await FoodOrder.findById(foodOrderId);
    if (!order || String(order.userId) !== String(req.user.id)) {
      return res.status(404).json({ error: 'Food order not found' });
    }
    if (order.stripeCheckoutSessionId && order.stripeCheckoutSessionId !== sessionId) {
      return res.status(400).json({ error: 'Session mismatch' });
    }
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.payment_status !== 'paid') {
      order.paymentStatus = 'failed';
      await order.save();
      return res.status(400).json({ error: 'Payment is not completed yet' });
    }
    order.paymentStatus = 'paid';
    order.status = 'placed';
    await order.save();
    await createNotification({
      userId: order.userId,
      type: 'new_order',
      title: 'Order placed',
      message: `${order.tableName} was placed successfully.`,
      resourceType: 'order',
      resourceId: order._id,
    });
    await createAdminNotifications({
      type: 'new_order',
      title: 'New order placed',
      message: `${order.tableName} was added to the kitchen queue.`,
      resourceType: 'order',
      resourceId: order._id,
    });
    return res.json({ order: serialize(order.toObject()) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to confirm food payment' });
  }
});

router.delete('/admin/:id', requireAdmin, async (req, res) => {
  try {
    const order = await FoodOrder.findById(req.params.id).lean();
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.status !== 'delivered') {
      return res.status(400).json({ error: 'Only delivered orders can be deleted' });
    }
    await FoodOrder.deleteOne({ _id: req.params.id });
    return res.status(204).end();
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to delete order' });
  }
});

module.exports = router;
