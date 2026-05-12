// routes/orders.js
const express = require('express');
const fs = require('fs');
const path = require('path');

const router = express.Router();


// 🔴 ĐẢM BẢO ĐOẠN NÀY
const DATA_DIR      = path.join(__dirname, '..', 'data');
const ORDERS_FILE   = path.join(DATA_DIR, 'orders.json');
const FOODS_FILE    = path.join(DATA_DIR, 'foods.json');
const PRODUCTS_FILE = path.join(DATA_DIR, 'products.json');
const CUSTOMERS_FILE= path.join(DATA_DIR, 'customers.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const readJson = (p, fb=[]) => { try { return JSON.parse(fs.readFileSync(p,'utf8')); } catch { return fb; } };
const writeJson = (p, d) => fs.writeFileSync(p, JSON.stringify(d,null,2));
const basenameLower = (p) => (String(p || '').split('/').pop() || '').toLowerCase();

function nextOrderId(list){
  const max = list.reduce((m,o)=>Number.isFinite(+o.id)?Math.max(m,+o.id):m,0);
  return String(max+1);
}

/** Enrich 1 item theo imageKey */
function enrichItem(item, foods, products) {
  const isOffMenu = !!item?.isOffMenu;

if (isOffMenu) {
  const offMenuName =
    String(item?.name || item?.imageName || '').trim() || '(Off menu)';

  return {
    isOffMenu: true,
    imageKey: '',
    imageName: '',
    name: offMenuName,
    qty: Number(item?.qty || 0),
    price: Number(item?.price || 0) || 0,
    group: 'OFF MENU',
    note: String(item?.note || '').trim(),
    productCode: '',
  };
}

  const key = String(item.imageKey || item.imageName || '').toLowerCase();
  let name = null, price = 0, group = null, productCode = null;

  const p = products.find(x => (x.imageName || '').toLowerCase() === key);
  if (p) {
    name = p.name || p.productName || name;
    price = Number(p.price || 0);
    group = p.itemGroup || p.group || null;
    productCode = p.productCode || p.code || null;
  }

  if (!name) {
    const f = foods.find(x => basenameLower(x.imageUrl) === key);
    if (f) name = f.name || name || key;
  }

  return {
    isOffMenu: false,
    imageKey: key,
    name: name || key,
    qty: Number(item.qty || 0),
    price,
    group,
    note: item.note || '',
    productCode,
  };
}

/** Chuẩn hoá customer snapshot */
function ensureCustomerSnapshot(body){
  let customer = body.customer && typeof body.customer === 'object' ? body.customer : {};
  let { code, name, level } = customer;

  if ((!code || !name || !level) && body.memberCard){
    const customers = readJson(CUSTOMERS_FILE, []);
    // chấp nhận nhiều field name phổ biến
    const mc = String(body.memberCard).trim().toLowerCase();
    const hit = customers.find(c =>
      String(c.memberCard || c.card || c.code || '').trim().toLowerCase() === mc
    );
    if (hit){
      code  = code  || hit.code  || hit.customerCode || hit.memberCard || null;
      name  = name  || hit.name  || hit.customerName || null;
      level = level || hit.level || hit.tier || null;
    }
  }
  // Nếu vẫn thiếu, ráng lấy từ body cũ (giảm rủi ro null)
  name  = name  || body.customerName || null;
  level = level || body.level || null;

  return {
    code:  code  || null,
    name:  name  || null,
    level: level || null
  };
}

/** Emit socket helper */
function emitIO(req, evt, payload){
  const io = req?.app?.locals?.io || req?.app?.get?.('io');
  if (io) io.emit(evt, payload);
}

/** GET /api/orders */
router.get('/', (req, res) => {
  try {
    const { area, tableNo, includeClosed, status, from, to } = req.query || {};
    let all = readJson(ORDERS_FILE, []);

    // Tự động chuyển đơn của những ngày trước sang DONE
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    let changed = false;

    all.forEach((o) => {
      const orderTime = new Date(o.createdAt).getTime();
      if (
        Number.isFinite(orderTime) &&
        orderTime < todayStart &&
        o.status !== 'CANCELLED' &&
        o.status !== 'DONE'
      ) {
        o.status = 'DONE';
        changed = true;

        emitIO(req, 'orderUpdated', {
          orderId: o.id,
          status: o.status,
          order: o,
        });
      }
    });

    if (changed) writeJson(ORDERS_FILE, all);

    let rows = [...all];

    // User xem theo bàn
    if (area && tableNo) {
      rows = rows.filter(
        (o) => o.area === area && String(o.tableNo) === String(tableNo)
      );

      if (String(includeClosed || '').toLowerCase() !== 'true') {
        rows = rows.filter((o) => !o.tableClosed);
      }
    }

    // Admin filter trạng thái
    if (status && status !== 'ALL') {
      if (status === 'OPEN') {
        rows = rows.filter((o) => ['PENDING', 'IN_PROGRESS'].includes(o.status));
      } else {
        rows = rows.filter((o) => o.status === status);
      }
    }

    // Admin filter thời gian
    if (from) {
      const fromMs = Date.parse(from);
      if (!Number.isNaN(fromMs)) {
        rows = rows.filter((o) => Date.parse(o.createdAt) >= fromMs);
      }
    }

    if (to) {
      const toMs = Date.parse(to);
      if (!Number.isNaN(toMs)) {
        rows = rows.filter((o) => Date.parse(o.createdAt) <= toMs);
      }
    }

    rows.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.json(rows.map((o) => ({
      ...o,
      cancelReason: o.cancelReason ?? null,
    })));
  } catch (e) {
    res.status(500).json({ error: e?.message || 'Cannot get orders' });
  }
});

/** POST /api/orders  (tạo order mới — SNAPSHOT customer + enrich items) */
router.post('/', (req,res)=>{
  try{
    const orders   = readJson(ORDERS_FILE, []);
    const foods    = readJson(FOODS_FILE, []);
    const products = readJson(PRODUCTS_FILE, []);

    const {
      area, tableNo, staff, memberCard,
      customer: customerRaw,
      items: itemsRaw,
      note = '',
      consumeStock = false
    } = req.body || {};

    // Chỉ trả lỗi nếu thiếu bàn mà vẫn muốn trừ tồn kho (consumeStock=true).
if ((!area || !tableNo) && consumeStock) {
  return res.status(400).json({ error: 'Thiếu area/tableNo' });
}
    // Staff phải là chuỗi số hợp lệ
if (!staff || !String(staff).trim() || !/^\d+$/.test(String(staff).trim())) {
  return res.status(400).json({ error:'Invalid staff: phải là mã số' });
}
    if (!Array.isArray(itemsRaw) || itemsRaw.length===0) return res.status(400).json({ error:'Giỏ trống' });

    // Snapshot customer
    const customer = ensureCustomerSnapshot({ memberCard, customer: customerRaw, ...req.body });

    // Enrich items
    const items = itemsRaw.map(it => enrichItem(it, foods, products));

    // (tuỳ chọn) kiểm tra tồn kho khi consumeStock=true
if (consumeStock) {
  const missing = [];
  for (const it of items) {
    if (it.isOffMenu) continue;

    const f = foods.find(x => basenameLower(x.imageUrl) === it.imageKey);
    const avail = Number(f?.quantity ?? Infinity);
    if (Number.isFinite(avail) && it.qty > avail) {
      missing.push({ imageName: it.imageKey, available: avail });
    }
  }
  if (missing.length) {
    return res.status(409).json({ error: 'Not enough stock', missing });
  }
}

    const id = nextOrderId(orders);
    const now = new Date().toISOString();

    const order = {
      id,
      createdAt: now,
      status: 'PENDING',   // PENDING → IN_PROGRESS → DONE/CANCELLED
      area: area || null,
      tableNo: tableNo || null,
      staff,
      memberCard: memberCard || null,
      customer,            // <— SNAPSHOT tại thời điểm order
      note,
      items,
      tableClosed: false
    };

    orders.unshift(order);
    writeJson(ORDERS_FILE, orders);

    emitIO(req, 'orderPlaced', { order }); // FE đang lắng nghe 'orderPlaced'
    return res.json({ ok:true, id, order });
  }catch(e){
    return res.status(500).json({ error: e?.message || 'Create order failed' });
  }
});

/** POST /api/orders/:id/status  (đổi trạng thái) */
router.post('/:id/status',  (req,res)=>{
  const { id } = req.params;
  const { status, reason } = req.body || {};
  const orders = readJson(ORDERS_FILE, []);
  const i = orders.findIndex(o => String(o.id) === String(id));
  if (i<0) return res.status(404).json({ error:'Order not found' });

  orders[i].status = status || orders[i].status;
  if (reason) orders[i].cancelReason = reason;
  writeJson(ORDERS_FILE, orders);
  emitIO(req, 'orderUpdated', { orderId:id, status:orders[i].status, order:orders[i] });
  res.json({ ok:true, order: orders[i] });
});

router.post('/:id/item-price', (req, res) => {
  try {
    const { id } = req.params;
    const { itemIndex, price } = req.body || {};

    const orders = readJson(ORDERS_FILE, []);
    const i = orders.findIndex(o => String(o.id) === String(id));
    if (i < 0) return res.status(404).json({ error: 'Order not found' });

    const idx = Number(itemIndex);
    if (!Number.isInteger(idx) || idx < 0 || idx >= (orders[i].items || []).length) {
      return res.status(400).json({ error: 'Invalid itemIndex' });
    }

    const val = Number(price);
    if (!Number.isFinite(val) || val < 0) {
      return res.status(400).json({ error: 'Price must be a non-negative number' });
    }

    const item = orders[i].items[idx];

    item.isOffMenu = true;
    item.group = 'OFF MENU';
    item.name = String(item?.name || item?.imageName || '(Off menu)').trim() || '(Off menu)';
    item.price = val;
    item.lineTotal = val * Number(item?.qty || 0);

    orders[i].updatedAt = new Date().toISOString();

    writeJson(ORDERS_FILE, orders);

    emitIO(req, 'orderUpdated', {
      orderId: orders[i].id,
      status: orders[i].status,
      order: orders[i],
    });

    res.json({ ok: true, order: orders[i], item });
  } catch (e) {
    res.status(500).json({ error: e?.message || 'Save item price failed' });
  }
});
/** POST /api/orders/:id/close  (đúng với FE hiện tại: “Thu bàn”) */
router.post('/:id/close',(req,res)=>{
  const { id } = req.params;
  const orders = readJson(ORDERS_FILE, []);
  const i = orders.findIndex(o => String(o.id) === String(id));
  if (i<0) return res.status(404).json({ error:'Order not found' });
  orders[i].tableClosed = true;
  writeJson(ORDERS_FILE, orders);
  emitIO(req, 'orderUpdated', { orderId:id, status:orders[i].status, order:orders[i] });
  res.json({ ok:true });
});

/** GET /api/reports/orders?from=YYYY-MM-DD&to=YYYY-MM-DD
 *  → trả đúng dữ liệu snapshot trong order (customer + items)
 */
router.get('/report',  (req,res)=>{
  const { from, to } = req.query || {};
  let all = readJson(ORDERS_FILE, []);

  // Tự động đánh dấu đơn của những ngày trước (không bị CANCELLED) là DONE
  try {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    let changed = false;
    all.forEach(o => {
      const orderTime = new Date(o.createdAt).getTime();
      if (orderTime < todayStart && o.status !== 'CANCELLED' && o.status !== 'DONE') {
        o.status = 'DONE';
        changed = true;
      }
    });
    if (changed) writeJson(ORDERS_FILE, all);
  } catch (e) {
    // Ignore errors
  }
  const rows = all.filter(o => {
    const t = new Date(o.createdAt).getTime();
    const okFrom = from ? (t >= new Date(from+'T00:00:00').getTime()) : true;
    const okTo   = to   ? (t <  new Date(to+'T24:00:00').getTime())   : true;
    return okFrom && okTo && o.status === 'DONE'; // chỉ DONE cho báo cáo
  });
  res.json(rows);
});

module.exports = router;
