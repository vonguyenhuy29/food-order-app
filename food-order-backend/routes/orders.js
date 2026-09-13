// routes/orders.js
// Chỉ giữ các route phụ không trùng với server.js.
// GET/POST orders, status và close được xử lý duy nhất trong server.js
// để tránh 2 business rule khác nhau (đặc biệt business day 06:00).
const express = require('express');
const sqliteStore = require('../sqliteStore');

const router = express.Router();

function emitIO(req, eventName, payload) {
  const io = req?.app?.locals?.io || req?.app?.get?.('io');
  if (io) io.emit(eventName, payload);
}

function persistOrderForMainServer(req, order) {
  if (req?.app?.locals?.persistOrderFromRouter) {
    return req.app.locals.persistOrderFromRouter(order);
  }
  sqliteStore.upsertOrder(order);
  return true;
}

// Sửa giá món OFF MENU từ Admin.
router.post('/:id/item-price', (req, res) => {
  try {
    const { id } = req.params;
    const { itemIndex, price } = req.body || {};

    const order = sqliteStore.getOrderById(id);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    const idx = Number(itemIndex);
    if (!Number.isInteger(idx) || idx < 0 || idx >= (order.items || []).length) {
      return res.status(400).json({ error: 'Invalid itemIndex' });
    }

    const val = Number(price);
    if (!Number.isFinite(val) || val < 0) {
      return res.status(400).json({ error: 'Price must be a non-negative number' });
    }

    const item = order.items[idx];
    item.isOffMenu = true;
    item.group = 'OFF MENU';
    item.itemGroup = 'OFF MENU';
    item.productCode = item.productCode || 'H100';
    item.code = item.code || 'H100';
    item.name = String(item?.name || item?.imageName || '(Off menu)').trim() || '(Off menu)';
    item.price = val;
    item.lineTotal = val * Number(item?.qty || 0);
    order.updatedAt = new Date().toISOString();

    persistOrderForMainServer(req, order);
    emitIO(req, 'orderUpdated', {
      orderId: order.id,
      status: order.status,
      order,
    });

    res.json({ ok: true, order, item });
  } catch (e) {
    res.status(500).json({ error: e?.message || 'Save item price failed' });
  }
});

// Alias report legacy: chỉ đọc DONE, không tự đổi status theo 00:00.
router.get('/report', (req, res) => {
  try {
    const { from, to } = req.query || {};
    const rows = typeof sqliteStore.queryOrders === 'function'
      ? sqliteStore.queryOrders({ status: 'DONE', from, to, includeClosed: true })
      : sqliteStore.loadOrders().filter((o) => o.status === 'DONE');
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e?.message || 'Cannot get report orders' });
  }
});

module.exports = router;
