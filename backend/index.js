require('dotenv').config();
const cors = require('cors');
const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');

const { ensureAdminUser } = require('./lib/ensureAdmin');
const { authenticate } = require('./middleware/auth');
const FoodOrder = require('./models/FoodOrder');
const authRoutes = require('./routes/auth');
const menuRoutes = require('./routes/menu');
const roomRoutes = require('./routes/rooms');
const reservationRoutes = require('./routes/reservations');
const orderRoutes = require('./routes/orders');
const inventoryRoutes = require('./routes/inventory');
const salesRoutes = require('./routes/sales');
const reviewRoutes = require('./routes/reviews');
const notificationRoutes = require('./routes/notifications');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: true }));
app.use(express.json());

const uploadsRoot = path.join(__dirname, 'uploads');
fs.mkdirSync(path.join(uploadsRoot, 'menu'), { recursive: true });
fs.mkdirSync(path.join(uploadsRoot, 'rooms'), { recursive: true });
fs.mkdirSync(path.join(uploadsRoot, 'profiles'), { recursive: true });
app.use('/uploads', express.static(uploadsRoot));

app.get('/health', (_req, res) => res.json({ ok: true }));

app.use('/api/auth', authRoutes);
app.use('/api/menu', authenticate, menuRoutes);
app.use('/api/rooms', authenticate, roomRoutes);
app.use('/api/reservations', authenticate, reservationRoutes);
app.use('/api/orders', authenticate, orderRoutes);
app.use('/api/inventory', authenticate, inventoryRoutes);
app.use('/api/sales', authenticate, salesRoutes);
app.use('/api/reviews', authenticate, reviewRoutes);
app.use('/api/notifications', authenticate, notificationRoutes);

async function repairFoodOrderIndexes() {
  const collection = FoodOrder.collection;
  const indexes = await collection.indexes();
  const staleReservationIndex = indexes.find(
    (idx) =>
      idx.name === 'reservationId_1' &&
      idx.unique === true &&
      (!idx.sparse || idx.partialFilterExpression)
  );

  if (staleReservationIndex) {
    console.log('Dropping stale foodorders reservationId_1 index');
    await collection.dropIndex('reservationId_1');
  }

  await FoodOrder.syncIndexes();
}

async function start() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('Set MONGODB_URI in backend/.env');
    process.exit(1);
  }
  if (!process.env.JWT_SECRET) {
    console.error('Set JWT_SECRET in backend/.env');
    process.exit(1);
  }
  await mongoose.connect(uri);
  await repairFoodOrderIndexes();
  await ensureAdminUser();

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`API listening on http://localhost:${PORT}`);
  });
}

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
