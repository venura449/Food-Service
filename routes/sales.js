const express = require('express');
const PDFDocument = require('pdfkit');

const Reservation = require('../models/Reservation');
const FoodOrder = require('../models/FoodOrder');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();
router.use(requireAdmin);

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

router.get('/summary', async (req, res) => {
  try {
    const from = req.query.from ? new Date(String(req.query.from)) : startOfDay(new Date(Date.now() - 29 * 86400000));
    const to = req.query.to ? new Date(String(req.query.to)) : endOfDay(new Date());
    const paidReservations = await Reservation.find({
      paymentStatus: 'paid',
      paidAt: { $gte: from, $lte: to },
    }).lean();
    const deliveredOrders = await FoodOrder.find({
      status: { $in: ['placed', 'in_production', 'delivered'] },
      createdAt: { $gte: from, $lte: to },
    }).lean();

    const reservationRevenue = paidReservations.reduce((a, r) => a + Number(r.reservationFee || 0), 0);
    const foodRevenue = paidReservations.reduce((a, r) => a + Number(r.foodTotal || 0), 0);
    const totalRevenue = reservationRevenue + foodRevenue;
    const totalOrders = deliveredOrders.length;

    return res.json({
      from,
      to,
      currency: 'LKR',
      totals: {
        reservationRevenue,
        foodRevenue,
        totalRevenue,
        totalOrders,
        paidReservations: paidReservations.length,
      },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to load sales summary' });
  }
});

router.get('/report', async (req, res) => {
  try {
    const from = req.query.from ? new Date(String(req.query.from)) : startOfDay(new Date(Date.now() - 29 * 86400000));
    const to = req.query.to ? new Date(String(req.query.to)) : endOfDay(new Date());
    const paidReservations = await Reservation.find({
      paymentStatus: 'paid',
      paidAt: { $gte: from, $lte: to },
    })
      .sort({ paidAt: -1 })
      .lean();

    const rows = paidReservations.map((r) => ({
      reservationId: r._id.toString(),
      tableName: r.tableName,
      slotStartAt: r.startAt,
      slotEndAt: r.endAt,
      reservationFeeLKR: Number(r.reservationFee || 0),
      foodRevenueLKR: Number(r.foodTotal || 0),
      totalLKR: Number(r.totalAmount || 0),
      paidAt: r.paidAt,
      status: r.reservationStatus,
    }));

    return res.json({
      from,
      to,
      currency: 'LKR',
      generatedAt: new Date(),
      count: rows.length,
      rows,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to generate report' });
  }
});

router.get('/report.csv', async (req, res) => {
  try {
    const from = req.query.from ? new Date(String(req.query.from)) : startOfDay(new Date(Date.now() - 29 * 86400000));
    const to = req.query.to ? new Date(String(req.query.to)) : endOfDay(new Date());
    const paidReservations = await Reservation.find({
      paymentStatus: 'paid',
      paidAt: { $gte: from, $lte: to },
    })
      .sort({ paidAt: -1 })
      .lean();

    const header = [
      'Reservation ID',
      'Table Name',
      'Slot Start',
      'Slot End',
      'Reservation Fee (LKR)',
      'Food Revenue (LKR)',
      'Total (LKR)',
      'Paid At',
      'Status',
    ];
    const rows = paidReservations.map((r) => [
      r._id.toString(),
      String(r.tableName || '').replace(/"/g, '""'),
      new Date(r.startAt).toISOString(),
      new Date(r.endAt).toISOString(),
      Number(r.reservationFee || 0).toFixed(2),
      Number(r.foodTotal || 0).toFixed(2),
      Number(r.totalAmount || 0).toFixed(2),
      r.paidAt ? new Date(r.paidAt).toISOString() : '',
      r.reservationStatus || '',
    ]);
    const csv = [header, ...rows]
      .map((cols) => cols.map((v) => `"${String(v)}"`).join(','))
      .join('\n');

    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="sales-report-${stamp}.csv"`);
    return res.send(csv);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to export CSV report' });
  }
});

router.get('/report.pdf', async (req, res) => {
  try {
    const from = req.query.from ? new Date(String(req.query.from)) : startOfDay(new Date(Date.now() - 29 * 86400000));
    const to = req.query.to ? new Date(String(req.query.to)) : endOfDay(new Date());
    const paidReservations = await Reservation.find({
      paymentStatus: 'paid',
      paidAt: { $gte: from, $lte: to },
    })
      .sort({ paidAt: -1 })
      .lean();

    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="sales-report-${stamp}.pdf"`);

    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    doc.pipe(res);

    doc.fontSize(18).text('Sales Report', { align: 'left' });
    doc.moveDown(0.4);
    doc.fontSize(10).text(`Range: ${from.toISOString()} to ${to.toISOString()}`);
    doc.text(`Generated: ${new Date().toISOString()}`);
    doc.moveDown(0.6);

    const total = paidReservations.reduce((a, r) => a + Number(r.totalAmount || 0), 0);
    doc.fontSize(11).text(`Paid reservations: ${paidReservations.length}`);
    doc.text(`Total revenue (LKR): ${total.toFixed(2)}`);
    doc.moveDown(0.8);

    doc.fontSize(10).text('Recent rows (max 40):');
    doc.moveDown(0.4);

    paidReservations.slice(0, 40).forEach((r, idx) => {
      const line = `${idx + 1}. ${r.tableName} | ${Number(r.totalAmount || 0).toFixed(2)} LKR | ${r.paidAt ? new Date(r.paidAt).toISOString() : '-'} | ${r.reservationStatus}`;
      doc.text(line, { lineGap: 2 });
    });

    doc.end();
  } catch (err) {
    console.error(err);
    if (!res.headersSent) {
      return res.status(500).json({ error: 'Failed to export PDF report' });
    }
  }
});

module.exports = router;
