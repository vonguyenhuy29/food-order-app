require('dotenv').config();
/**
 * server.js — Backend cho Food App (bản có Quantity + SAFE MENU COPY)
 */

const express = require('express');
const http = require('http');
const https = require('https');
const { Server } = require('socket.io');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const productsRouter = require('./routes/products');
const ordersRouter = require('./routes/orders');
const sqliteStore = require('./sqliteStore');
const rateLimitPkg = require('express-rate-limit');
const rateLimit = rateLimitPkg.rateLimit || rateLimitPkg;
const { ipKeyGenerator } = rateLimitPkg;
const {
  answerLocalFoodQuestion,
  trainLocalFoodAI,
  listLocalFoodAiSuggestions,
  recordLocalFoodAiFeedback,
  listLocalFoodAiPending,
  approveLocalFoodAiLearning,
} = require('./utils/localFoodAI');

// Giới hạn: tối đa 10 lần / phút / IP (+ phân tách theo memberCard nếu có)
const orderLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 phút
  max: 10,             // cho mỗi "key"
  standardHeaders: true, // gửi RateLimit-* headers (hữu ích cho debug/monitor)
  legacyHeaders: false,

  // Gom key theo IP + memberCard (nếu có) để 1 IP có thể tạo đơn cho khách khác nhau mà vẫn an toàn
keyGenerator: (req/*, res*/) => {
  const forwardedIp = String(req.headers['x-forwarded-for'] || '')
    .split(',')[0]
    .trim();

  const rawIp = forwardedIp || req.ip || req.socket?.remoteAddress || '';
  const safeIp = typeof ipKeyGenerator === 'function'
    ? ipKeyGenerator(rawIp)
    : String(rawIp || '');

  const member = req.body?.memberCard
    ? String(req.body.memberCard).replace(/\s+/g, '').trim()
    : '';

  return member ? `${safeIp}:${member}` : safeIp;
},

  // Trả JSON 429 thân thiện
  handler: (req, res, _next, options) => {
    const retryAfter = res.getHeader('Retry-After'); // giây
    return res.status(options.statusCode).json({
      error: 'RATE_LIMITED',
      message: 'Bạn gửi quá nhiều đơn. Vui lòng thử lại sau.',
      retryAfterSeconds: retryAfter ? Number(retryAfter) : undefined,
    });
  },

  // Đếm mọi request (thành công hay lỗi) để tránh spam
  skipFailedRequests: false,
  skipSuccessfulRequests: false,
});

const app = express();
app.set('trust proxy', 1);
const server = http.createServer(app);

// ====== ENV & Đường dẫn ======
const PORT = process.env.PORT || 5000;
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const FOODS_JSON = path.join(DATA_DIR, 'foods.json');
const USERS_JSON = path.join(DATA_DIR, 'users.json');
const MENU_LEVELS_JSON = path.join(DATA_DIR, 'menu-levels.json');
const STATUS_HISTORY_JSON = path.join(DATA_DIR, 'status-history.json');
const ORDERS_JSON  = path.join(DATA_DIR, 'orders.json');
const MEMBERS_JSON = path.join(DATA_DIR, 'members.json');
// NEW: file chứa danh sách nhân viên
const STAFFS_JSON = path.join(DATA_DIR, 'staffs.json');

// Đảm bảo file staff.json luôn tồn tại (nếu chưa có thì tạo rỗng)
try {
  if (!fs.existsSync(STAFFS_JSON)) {
    fs.writeFileSync(STAFFS_JSON, '[]', 'utf8');
  }
} catch (e) {
  console.error('Could not initialize STAFFS_JSON:', e.message);
}

const BACKUP_DIR = path.join(DATA_DIR, 'backups');
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

function backupMembers() {
  try {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const dest = path.join(BACKUP_DIR, `members-${ts}.json`);

    // Backup từ SQLite ra JSON để Admin vẫn dễ kiểm tra/phục hồi
    const currentMembers = sqliteStore.loadMembers();
    fs.writeFileSync(dest, JSON.stringify(currentMembers, null, 2), 'utf8');

    console.log('Backup members from SQLite to', dest);
  } catch (e) {
    console.error('Backup members failed:', e.message);
  }
}


// products.json để enrich /api/foods với menus/itemGroup...
const PRODUCTS_JSON = path.join(DATA_DIR, 'products.json');
// Import products.json vào SQLite lần đầu nếu DB đang rỗng.
// Sau đó SQLite là nơi lưu chính, không ghi lại toàn bộ products.json nữa.
try {
  const importResult = sqliteStore.importProductsFromJsonIfEmpty(PRODUCTS_JSON);
  if (importResult.imported) {
    console.log(`[SQLite] Imported ${importResult.count} products from products.json`);
  }
} catch (e) {
  console.error('[SQLite] Import products failed:', e.message);
}
const PUBLIC_DIR = path.join(ROOT, 'public');
const IMAGES_DIR = path.join(PUBLIC_DIR, 'images');
const THUMBS_DIR = path.join(PUBLIC_DIR, 'thumbs');
// ★ MASTER giữ bản gốc của ảnh
const MASTER_DIR = path.join(IMAGES_DIR, '__MASTER__');

const MULTER_TMP = path.join(ROOT, 'temp_uploads');

[DATA_DIR, PUBLIC_DIR, IMAGES_DIR, THUMBS_DIR, MASTER_DIR, MULTER_TMP].forEach((p) => {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
});

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-env';
const JWT_TTL    = process.env.JWT_TTL    || '7d';

function signToken(user) {
  return jwt.sign(
    { sub: user.id, username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: JWT_TTL }
  );
}


// ====== CORS + Socket.IO ======
const allowOrigins = (() => {
  if (process.env.CORS_ORIGINS) return process.env.CORS_ORIGINS.split(',').map(s => s.trim());
  return '*';
})();
const io = new Server(server, {
  cors: {
    origin: allowOrigins,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: false,
  },

  // Giữ kết nối Socket ổn định hơn khi mạng chập chờn / server bận nhẹ
  pingInterval: 25000,
  pingTimeout: 60000,
});
app.locals.io = io;

app.use(cors({
  origin: allowOrigins,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  // thêm cả 'Cache-Control' và 'cache-control' vào allowedHeaders
  allowedHeaders: ['Content-Type', 'Authorization', 'Cache-Control', 'cache-control'],
}));

app.use(express.json({ limit: '4mb' }));
app.use('/images', express.static(path.join(PUBLIC_DIR, 'images'), {
  maxAge: '30d',
  etag: true,
  lastModified: true,
  immutable: true,
  setHeaders(res, filePath) {
    if (/\.(jpg|jpeg|png|webp|gif)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=2592000, immutable');
    }
  },
}));
app.use('/thumbs', express.static(THUMBS_DIR, {
  maxAge: '30d',
  etag: true,
  lastModified: true,
  immutable: true,
  setHeaders(res, filePath) {
    if (/\.(webp|jpg|jpeg|png)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=2592000, immutable');
    }
  },
}));

app.use('/api/products', productsRouter);
// KHÔNG mount ordersRouter ở đây, vì sẽ chặn app.post('/api/orders') bên dưới
// ===================================================================
// ======================  QZ SIGNING (NEW)  ==========================
// ===================================================================
const selfsigned = require('selfsigned');

const CERT_DIR = path.join(ROOT, 'certs');
const QZ_KEY   = path.join(CERT_DIR, 'qz-private.key');
const QZ_CERT  = path.join(CERT_DIR, 'qz-public.crt');

function ensureQZCerts() {
  try {
    if (!fs.existsSync(CERT_DIR)) fs.mkdirSync(CERT_DIR, { recursive: true });
    if (!fs.existsSync(QZ_KEY) || !fs.existsSync(QZ_CERT)) {
      const pems = selfsigned.generate(
        [{ name: 'commonName', value: 'FoodAdmin-QZ' }],
        { keySize: 2048, days: 3650, algorithm: 'sha256' }
      );
      fs.writeFileSync(QZ_KEY,  pems.private, 'utf8');
      fs.writeFileSync(QZ_CERT, pems.cert,    'utf8');
      console.log('🔐 Generated QZ certs at', CERT_DIR);
    }
  } catch (e) {
    console.error('❌ ensureQZCerts failed:', e.message);
  }
}
ensureQZCerts();

app.get('/qz/cert', (_req, res) => {
  try {
    res.type('text/plain').send(fs.readFileSync(QZ_CERT, 'utf8'));
  } catch (e) {
    res.status(500).type('text/plain').send('CERT_NOT_FOUND');
  }
});
app.post('/qz/sign', express.text({ type: '*/*' }), (req, res) => {
  try {
    const toSign = req.body || '';
    const keyPem = fs.readFileSync(QZ_KEY, 'utf8');
    const signer = crypto.createSign('sha256');
    signer.update(toSign); signer.end();
    const sig = signer.sign(keyPem, 'base64');
    res.type('text/plain').send(sig);
  } catch (e) {
    res.status(500).type('text/plain').send(String(e));
  }
});
// ===================================================================
// ==== Staffs API ====
// Trả về danh sách nhân viên. File lưu tại STAFFS_JSON dưới dạng array các object { id, name }.
app.get('/api/staffs', (_req, res) => {
  try {
    const data = fs.existsSync(STAFFS_JSON)
      ? JSON.parse(fs.readFileSync(STAFFS_JSON, 'utf8'))
      : [];
    // Đảm bảo luôn trả về array of objects { id, name }
    const out = Array.isArray(data)
      ? data.map((it) => {
          const id = String(it?.id ?? it?.code ?? '').trim();
          return { id, name: String(it?.name ?? '') };
        })
      : [];
    res.json(out);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// Cập nhật danh sách nhân viên (ghi đè toàn bộ). Yêu cầu body là array các object { id/code, name }.
app.post('/api/staffs', (req, res) => {
  try {
    const list = Array.isArray(req.body) ? req.body : [];
    // normalize
    const normalized = list
      .map((it) => {
        const id = String(it?.id ?? it?.code ?? '').trim();
        const name = String(it?.name ?? '').trim();
        if (!id || !name) return null;
        return { id, name };
      })
      .filter(Boolean);
    fs.writeFileSync(STAFFS_JSON, JSON.stringify(normalized, null, 2), 'utf8');
    res.json({ success: true, count: normalized.length });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});
// Cập nhật hoặc tạo nhân viên theo id
app.put('/api/staffs/:id', (req, res) => {
  try {
    const idParam = req.params.id;
    const { id = idParam, code, name } = req.body || {};
    const staffId = String(id || code || '').trim();
    const staffName = String(name || '').trim();
    if (!staffId || !staffName) {
      return res.status(400).json({ error: 'id and name required' });
    }
    const list = fs.existsSync(STAFFS_JSON)
      ? JSON.parse(fs.readFileSync(STAFFS_JSON, 'utf8') || '[]')
      : [];
    const idx = list.findIndex(it => String(it.id || it.code).trim() === staffId);
    if (idx >= 0) list[idx] = { id: staffId, name: staffName };
    else list.push({ id: staffId, name: staffName });
    fs.writeFileSync(STAFFS_JSON, JSON.stringify(list, null, 2), 'utf8');
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// Xoá nhân viên theo id
app.delete('/api/staffs/:id', (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ error: 'id required' });
    const list = fs.existsSync(STAFFS_JSON)
      ? JSON.parse(fs.readFileSync(STAFFS_JSON, 'utf8') || '[]')
      : [];
    const newList = list.filter(it => String(it.id || it.code).trim() !== id);
    fs.writeFileSync(STAFFS_JSON, JSON.stringify(newList, null, 2), 'utf8');
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});
// ====== Helpers ======
function extractImageName(url) {
  try { return url.split('/').pop().toLowerCase(); } catch { return null; }
}

function cleanDishNameFromImageName(raw) {
  const base = path.basename(String(raw || '')).replace(/\.[A-Za-z0-9]{2,5}(\?.*)?$/i, '');
  return base
    .replace(/[._-]+/g, ' ')
    .replace(/\s+\d{10,13}$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .toUpperCase();
}
function getFoodsByImageName(imageName) {
  const key = String(imageName || '').toLowerCase();
  return foods.filter(f => extractImageName(f.imageUrl) === key);
}
function getRefFoodByImageName(imageName) {
  return getFoodsByImageName(imageName)[0] || null;
}

// ====== Products helper ======
function loadProductsSafe() {
  try {
    return sqliteStore.loadProducts();
  } catch (e) {
    console.error('[SQLite] loadProducts failed:', e.message);
    return [];
  }
}

// ====== NEW: file/path helpers (MASTER-safe) ======
function ensureDir(p) { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); }

function urlToDiskPath(publicUrl) {
  if (!publicUrl) return null;
  const m = publicUrl.match(/\/images\/(.+)$/i);
  if (!m) return null;
  return path.join(IMAGES_DIR, m[1].replace(/\//g, path.sep));
}

function md5File(p) {
  const b = fs.readFileSync(p);
  return crypto.createHash('md5').update(b).digest('hex');
}

function findCaseInsensitiveFile(dir, lowerName) {
  if (!fs.existsSync(dir)) return null;
  const list = fs.readdirSync(dir);
  const hit = list.find(fn => fn.toLowerCase() === lowerName);
  return hit ? path.join(dir, hit) : null;
}

function findAnyExistingVariant(imgLower) {
  // 1) Master first
  const m = findCaseInsensitiveFile(MASTER_DIR, imgLower);
  if (m) return m;
  // 2) Any menu folder
for (const menu of getAllMenuTypes()) {
  const f = findCaseInsensitiveFile(path.join(IMAGES_DIR, menu), imgLower);
  if (f) return f;
}

  // 3) Root images (rare)
  const root = findCaseInsensitiveFile(IMAGES_DIR, imgLower);
  if (root) return root;
  return null;
}

function ensureMasterCopy(imgLower, preferPath = null) {
  ensureDir(MASTER_DIR);
  const master = findCaseInsensitiveFile(MASTER_DIR, imgLower);
  if (master) return master;
  let src = null;
  if (preferPath && fs.existsSync(preferPath)) src = preferPath;
  if (!src) src = findAnyExistingVariant(imgLower);
  if (!src) return null;
  const dest = path.join(MASTER_DIR, path.basename(src));
  if (!fs.existsSync(dest)) fs.copyFileSync(src, dest);
  return dest;
}

function copyToMenuFromMaster(menu, imgLower) {
  const master = ensureMasterCopy(imgLower);
  if (!master) return null;
  const dir = path.join(IMAGES_DIR, menu);
  ensureDir(dir);
  const existing = findCaseInsensitiveFile(dir, imgLower);
  const dest = existing || path.join(dir, path.basename(master).toLowerCase());
  if (!fs.existsSync(dest)) fs.copyFileSync(master, dest);
  return dest;
}

function deleteFromMenu(menu, imgLower) {
  const p = findCaseInsensitiveFile(path.join(IMAGES_DIR, menu), imgLower);
  if (p && fs.existsSync(p)) { try { fs.unlinkSync(p); } catch (_) {} }
}

// ====== Products SQLite helpers ======
function readProductsDoc() {
  try {
    return { doc: sqliteStore.loadProducts(), mode: 'array' };
  } catch (e) {
    console.error('[SQLite] readProductsDoc failed:', e.message);
    return { doc: [], mode: 'array' };
  }
}

function writeProductsDoc(doc, mode) {
  const arr = mode === 'rows' ? (doc.rows || []) : doc;
  sqliteStore.replaceAllProducts(Array.isArray(arr) ? arr : []);
}

function updateProductMenusByImageName(imageNameLower, updater) {
  return sqliteStore.updateProductMenusByImageName(imageNameLower, updater);
}

// ====== Stock helper ======
function adjustStockByImageName(imageName, delta, actor, reason = '') {
  const key = String(imageName || '').toLowerCase();
  const refs = getFoodsByImageName(key);
  if (!refs.length) return null;

  const beforeQty = Math.max(0, Number(refs[0].quantity ?? 0));
  const afterQty  = Math.max(0, beforeQty + Number(delta || 0));
  const prevStatus = refs[0].status;
  const newStatus  = afterQty <= 0 ? 'Sold Out' : 'Available';

  refs.forEach(f => { f.quantity = afterQty; f.status = newStatus; });
  saveFoods();

  io.emit('foodQuantityUpdated', { imageName: key, quantity: afterQty });

  if (prevStatus !== newStatus) {
    io.emit('foodStatusUpdated', { updatedFoods: refs });
    addStatusHistory({
      at: new Date().toISOString(),
      by: actor || 'system',
      role: 'admin',
      imageName: key,
      imageUrl: refs[0].imageUrl,
      type: refs[0].type,
      from: prevStatus,
      to: newStatus,
      count: refs.length,
      affectedIds: refs.map(f => f.id),
      reason,
    });
  }
  return { afterQty, newStatus };
}

function maybeAuth(req, _res, next) {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) {
    const token = auth.slice(7);
    try {
      req.user = jwt.verify(token, JWT_SECRET); // { sub, role }
    } catch { /* ignore */ }
  }
  next();
}

// ====== Dữ liệu: Foods ======
// Import foods.json vào SQLite lần đầu nếu bảng foods đang rỗng.
// Sau đó SQLite là nơi lưu chính, không ghi lại toàn bộ foods.json nữa.
try {
  const importResult = sqliteStore.importFoodsFromJsonIfEmpty(FOODS_JSON);
  if (importResult.imported) {
    console.log(`[SQLite] Imported ${importResult.count} foods from foods.json`);
  }
} catch (e) {
  console.error('[SQLite] Import foods failed:', e.message);
}

let foods = [];
try {
  foods = sqliteStore.loadFoods();
} catch (e) {
  console.error('[SQLite] Load foods failed:', e.message);
  foods = [];
}

foods.forEach((f, i) => {
  if (typeof f.order !== 'number') f.order = i;

  if (typeof f.quantity !== 'number') {
    f.quantity = f.status === 'Sold Out' ? 0 : 1;
  } else {
    if (f.quantity <= 0) f.status = 'Sold Out';
    else if (!f.status || f.status === 'Sold Out') f.status = 'Available';
  }
});

function saveFoods() {
  sqliteStore.replaceAllFoods(foods);
}


function nextNumericId() {
  const maxId = foods.reduce((m, f) => (Number.isFinite(f.id) ? Math.max(m, f.id) : m), 0);
  return maxId + 1;
}

// ====== Dữ liệu: Users (Auth) ======
function readUsers() {
  try { return fs.existsSync(USERS_JSON) ? JSON.parse(fs.readFileSync(USERS_JSON, 'utf-8') || '[]') : []; }
  catch (e) { console.error('❌ Lỗi đọc users.json:', e.message); return []; }
}
function writeUsers(users) {
  const tmp = USERS_JSON + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(users, null, 2), 'utf-8');
  fs.renameSync(tmp, USERS_JSON);
}
let users = readUsers();
if (users.length === 0) {
  const adminHash = bcrypt.hashSync('admin123', 10);
  const kitchenHash = bcrypt.hashSync('kitchen123', 10);
  users = [
    { username: 'admin', passwordHash: adminHash, role: 'admin' },
    { username: 'kitchen', passwordHash: kitchenHash, role: 'kitchen' },
  ];
  writeUsers(users);
  console.log('✅ Seed users: admin/admin123, kitchen/kitchen123');
}

// ====== Dữ liệu: Menu Levels ======
let menuLevels = {};
try { if (fs.existsSync(MENU_LEVELS_JSON)) menuLevels = JSON.parse(fs.readFileSync(MENU_LEVELS_JSON, 'utf-8') || '{}'); }
catch (e) { console.error('❌ Lỗi đọc menu-levels.json:', e.message); menuLevels = {}; }
function saveMenuLevels() {
  const tmp = MENU_LEVELS_JSON + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(menuLevels, null, 2), 'utf-8');
  fs.renameSync(tmp, MENU_LEVELS_JSON);
}

// ====== Dữ liệu: Lịch sử đổi trạng thái ======
// Import status-history.json vào SQLite lần đầu nếu DB đang rỗng.
// Sau đó SQLite là nơi lưu chính, không ghi lại toàn bộ status-history.json nữa.
try {
  const importResult = sqliteStore.importStatusHistoryFromJsonIfEmpty(STATUS_HISTORY_JSON);
  if (importResult.imported) {
    console.log(`[SQLite] Imported ${importResult.count} status-history rows from status-history.json`);
  }
} catch (e) {
  console.error('[SQLite] Import status-history failed:', e.message);
}

function addStatusHistory(entry) {
  const savedEntry = sqliteStore.insertStatusHistory({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    ...entry,
  });

  io.emit('statusHistoryAdded', savedEntry);
}

// ====== Orders ======
// Import orders.json vào SQLite lần đầu nếu DB đang rỗng.
// Sau đó SQLite là nơi lưu chính, không ghi lại toàn bộ orders.json nữa.
try {
  const importResult = sqliteStore.importOrdersFromJsonIfEmpty(ORDERS_JSON);
  if (importResult.imported) {
    console.log(`[SQLite] Imported ${importResult.count} orders from orders.json`);
  }
} catch (e) {
  console.error('[SQLite] Import orders failed:', e.message);
}

let orders = [];
try {
  orders = sqliteStore.loadOrders();
} catch (e) {
  console.error('[SQLite] Load orders failed:', e.message);
  orders = [];
}

function persistOrder(order) {
  sqliteStore.upsertOrder(order);
  clearMemberSearchCache();
  clearCustomerInsightsCache();
}

function persistOrders(orderList) {
  const rows = Array.isArray(orderList) ? orderList : [];

  if (typeof sqliteStore.upsertOrders === 'function') {
    sqliteStore.upsertOrders(rows);
  } else {
    for (const order of rows) {
      sqliteStore.upsertOrder(order);
    }
  }

  clearMemberSearchCache();
  clearCustomerInsightsCache();
}

function reloadOrdersSafe(context = 'orders') {
  try {
    const fresh = sqliteStore.loadOrders();
    orders = fresh;
    return fresh;
  } catch (error) {
    console.error(`[SQLite] ${context} loadOrders failed:`, error);

    // Khi SQLite lỗi tạm thời, ưu tiên giữ dữ liệu cache đang có
    // để Admin/User không bị màn hình trắng.
    if (Array.isArray(orders) && orders.length > 0) {
      return orders;
    }

    throw error;
  }
}

// Route phụ trong routes/orders.js sẽ gọi hàm này để đồng bộ lại bộ nhớ của server.js
// Ví dụ: cập nhật giá OFF MENU từ Admin.
app.locals.persistOrderFromRouter = (updatedOrder) => {
  if (!updatedOrder?.id) return false;
  const idx = orders.findIndex(o => String(o.id) === String(updatedOrder.id));
  if (idx >= 0) orders[idx] = updatedOrder;
  else orders.push(updatedOrder);
  persistOrder(updatedOrder);
  return true;
};

// Giữ lại function cũ để tránh vỡ code. Không ghi JSON nữa.
function saveOrders() {
  clearMemberSearchCache();
}
// ====== AUTO DONE theo ngày kinh doanh 06:00 VN ======
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function getBusinessCutoff06VN(nowMs = Date.now()) {
  // Trả về mốc 06:00 sáng VN của ngày kinh doanh đã kết thúc gần nhất
  const vnNow = new Date(nowMs + VN_OFFSET_MS);

  let cutoffUtcMs =
    Date.UTC(
      vnNow.getUTCFullYear(),
      vnNow.getUTCMonth(),
      vnNow.getUTCDate(),
      6, 0, 0, 0
    ) - VN_OFFSET_MS;

  // Nếu hiện tại chưa tới 06:00 VN, lùi cutoff về 06:00 hôm qua
  if (nowMs < cutoffUtcMs) {
    cutoffUtcMs -= DAY_MS;
  }

  return cutoffUtcMs;
}

function autoDoneOldOrdersByBusinessDay06() {
  let freshOrders;

  try {
    // Luôn đọc bản mới nhất trước khi auto-done.
    // Nếu SQLite đang lỗi thì bỏ qua lượt này, không xử lý cache cũ.
    freshOrders = sqliteStore.loadOrders();
    orders = freshOrders;
  } catch (error) {
    console.error('[AUTO DONE] Skip because SQLite cannot be read:', error);
    return 0;
  }

  const cutoffMs = getBusinessCutoff06VN();
  const nowIso = new Date().toISOString();

  const changedOrders = [];

  for (const o of freshOrders) {
    const orderMs = Date.parse(o.createdAt);
    if (!Number.isFinite(orderMs)) continue;

    const statusText = String(o.status || '').toUpperCase();

    if (statusText === 'CANCELLED') continue;
    if (orderMs >= cutoffMs) continue;

    let touched = false;

    if (o.tableClosed !== true) {
      o.tableClosed = true;
      o.closedAt = nowIso;
      o.closedBy = 'system-auto-06';
      o.tableAutoClosedAt = nowIso;
      o.tableAutoClosedReason = 'AUTO_TABLE_CLOSED_BY_BUSINESS_DAY_06';
      touched = true;
    }

    if (['PENDING', 'IN_PROGRESS'].includes(statusText)) {
      o.status = 'DONE';
      o.updatedAt = nowIso;
      o.autoDoneAt = nowIso;
      o.autoDoneReason = 'AUTO_DONE_BY_BUSINESS_DAY_06';
      touched = true;
    }

    if (touched) changedOrders.push(o);
  }

  if (changedOrders.length === 0) return 0;

  try {
    // Ghi trong một transaction để giảm WAL và tránh ghi dở dang.
    persistOrders(changedOrders);
  } catch (error) {
    console.error('[AUTO DONE] Persist failed:', error);
    return 0;
  }

  for (const o of changedOrders) {
    io.emit('orderUpdated', {
      orderId: o.id,
      status: o.status,
      order: o,
    });
  }

  console.log(
    `[AUTO DONE] Auto closed/done ${changedOrders.length} old orders by business day 06:00 VN`
  );

  return changedOrders.length;
}


function nextOrderId() {
  return sqliteStore.getNextOrderId();
}

// ====== Members map ======
// Import members.json vào SQLite lần đầu nếu DB đang rỗng.
// Sau đó SQLite là nơi lưu chính, không ghi lại toàn bộ members.json nữa.
try {
  const importResult = sqliteStore.importMembersFromJsonIfEmpty(MEMBERS_JSON);
  if (importResult.imported) {
    console.log(`[SQLite] Imported ${importResult.count} members from members.json`);
  }
} catch (e) {
  console.error('[SQLite] Import members failed:', e.message);
}

let members = {};
try {
  members = sqliteStore.loadMembers();
} catch (e) {
  console.error('[SQLite] Load members failed:', e.message);
  members = {};
}

function persistMember(code) {
  const cleanCode = cleanMemberId(code);
  if (!cleanCode || !members[cleanCode]) return;

  sqliteStore.upsertMember(cleanCode, members[cleanCode]);
  clearMemberSearchCache();
}

function persistMembersByCodes(codes) {
  const uniqueCodes = Array.from(new Set((codes || []).map(cleanMemberId).filter(Boolean)));
  for (const code of uniqueCodes) {
    if (members[code]) sqliteStore.upsertMember(code, members[code]);
  }
  clearMemberSearchCache();
}

function deletePersistedMember(code) {
  const cleanCode = cleanMemberId(code);
  if (!cleanCode) return;

  sqliteStore.deleteMember(cleanCode);
  clearMemberSearchCache();
}

// Giữ lại function cũ để tránh vỡ code. Không ghi JSON nữa.
function saveMembers() {
  clearMemberSearchCache();
}

// ====== External Customer API ======
const CUSTOMER_API_URL =
  process.env.CUSTOMER_API_URL ||
  'http://192.168.101.58:8090/api/user_number_level_by_id';

// Database-first customer sync:
// - User/Admin luôn đọc thông tin khách từ SQLite.
// - Customer API chỉ có nhiệm vụ đồng bộ dữ liệu mới vào SQLite ở nền.
// - Khi SQLite được cập nhật, backend phát socket để frontend đọc lại Database.
const CUSTOMER_API_CACHE_MS = Number(process.env.CUSTOMER_API_CACHE_MS || 5 * 60 * 1000); // 5 phút
const CUSTOMER_MEMBER_TTL_MS = Number(process.env.CUSTOMER_MEMBER_TTL_MS || 30 * 60 * 1000); // 30 phút
const CUSTOMER_API_TIMEOUT_MS = Number(process.env.CUSTOMER_API_TIMEOUT_MS || 3500);
const CUSTOMER_LOOKUP_TIMEOUT_MS = Number(process.env.CUSTOMER_LOOKUP_TIMEOUT_MS || 2500);
const CUSTOMER_API_RETRY_BACKOFF_MS = Number(process.env.CUSTOMER_API_RETRY_BACKOFF_MS || 5 * 60 * 1000); // 5 phút

// Priority sync cho hệ thống có hơn 60.000 khách.
// User chọn 3 request song song để đủ nhanh nhưng vẫn tránh làm Customer API quá tải.
const CUSTOMER_SYNC_CONCURRENCY = Math.max(
  1,
  Math.min(10, Number(process.env.CUSTOMER_SYNC_CONCURRENCY || 3))
);
const CUSTOMER_SYNC_WORKER_DELAY_MS = Math.max(
  250,
  Number(process.env.CUSTOMER_SYNC_WORKER_DELAY_MS || 1000)
);
const CUSTOMER_SYNC_MAX_PER_RUN = Math.max(
  1,
  Math.min(2000, Number(process.env.CUSTOMER_SYNC_MAX_PER_RUN || 300))
);
const CUSTOMER_SYNC_QUEUE_MAX = Math.max(
  100,
  Math.min(50000, Number(process.env.CUSTOMER_SYNC_QUEUE_MAX || 10000))
);
const CUSTOMER_AUTO_SYNC_INTERVAL_MS = Math.max(
  60 * 1000,
  Number(process.env.CUSTOMER_AUTO_SYNC_INTERVAL_MS || 5 * 60 * 1000)
);
const CUSTOMER_AUTO_SYNC_ENQUEUE_SIZE = Math.max(
  1,
  Math.min(5000, Number(process.env.CUSTOMER_AUTO_SYNC_ENQUEUE_SIZE || 500))
);
const CUSTOMER_AUTO_SYNC_RECENT_DAYS = Math.max(
  1,
  Math.min(365, Number(process.env.CUSTOMER_AUTO_SYNC_RECENT_DAYS || 90))
);
// Cache danh sách search khách để không phải quét lại orders + members mỗi lần gõ tên
const MEMBER_SEARCH_CACHE_MS = Number(process.env.MEMBER_SEARCH_CACHE_MS || 30 * 1000); // 30 giây

const customerApiCache = new Map();        // code -> { at, data }
const customerApiInflight = new Map();     // code -> Promise<detailed result>

// Queue có ưu tiên: search/order/manual đứng trước đồng bộ nền.
const customerSyncQueue = new Map();       // code -> queue item
const customerSyncProcessing = new Set();  // code đang xử lý
const customerSyncScheduled = new Set();   // queued hoặc processing
let customerSyncWorkerRunning = false;
let customerSyncWorkerTimer = null;
let customerSyncLastRunAt = null;
let customerSyncLastFinishedAt = null;
let customerSyncLastResult = {
  processed: 0,
  updated: 0,
  changed: 0,
  failed: 0,
  stoppedByApi: false,
};

let customerApiHealth = {
  ok: false, // chỉ phản ánh khả năng kết nối API, không phản ánh riêng 1 mã khách có tồn tại hay không
  connectionStatus: 'UNKNOWN', // UNKNOWN | ONLINE | OFFLINE | TIMEOUT | HTTP_ERROR
  lookupStatus: 'IDLE',        // IDLE | FOUND | NOT_FOUND | INVALID_RESPONSE | ERROR
  url: CUSTOMER_API_URL,
  lastCheckedAt: null,
  lastOkAt: null,
  lastDataAt: null,
  lastErrorAt: null,
  lastError: null,
  lastCheckedCode: null,
};

function cleanMemberId(v) {
  return String(v || '').replace(/\s+/g, '').trim();
}
function cleanCustomerDisplayName(nameInput, codeInput = '') {
  const code = cleanMemberId(codeInput);
  let name = String(nameInput || '').trim();

  if (!name) return '';

  if (code) {
    name = name
      .replace(new RegExp(`\\s*-\\s*${code}\\s*$`, 'i'), '')
      .replace(new RegExp(`^${code}\\s*-\\s*`, 'i'), '')
      .trim();
  }

  return name;
}

function normalizeCustomerIdentityText(v) {
  return String(v || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isMeaningfulCustomerName(value, codeInput = '') {
  const code = cleanMemberId(codeInput);
  const cleaned = cleanCustomerDisplayName(value, code);
  if (!cleaned) return false;

  const norm = normalizeCustomerIdentityText(cleaned);
  if (!norm) return false;

  const blocked = [
    'khong tim thay hoac api cham',
    'khong tim thay',
    'api cham',
    'dang tim khach',
    'dang kiem tra khach',
    'chua co thong tin',
    'chua co ten',
    'unknown',
    'not found',
    'loading',
    'null',
    'undefined',
    'n a',
    'na',
  ];

  if (blocked.some((x) => norm === x || norm.startsWith(`${x} `))) return false;
  if (norm === '---' || norm === '--' || norm === '-') return false;
  if (code && norm === normalizeCustomerIdentityText(code)) return false;
  if (code && norm === `khach ${normalizeCustomerIdentityText(code)}`) return false;

  return true;
}

function isMeaningfulCustomerLevel(value) {
  const raw = String(value || '').trim();
  if (!raw) return false;

  const norm = normalizeCustomerIdentityText(raw);
  if (!norm) return false;

  const blocked = new Set([
    '---', '--', '-',
    'dang tim',
    'dang kiem tra',
    'dang kiem tra level',
    'chua co thong tin',
    'unknown',
    'not found',
    'loading',
    'null',
    'undefined',
    'n a',
    'na',
  ]);

  return !blocked.has(norm);
}

function meaningfulCustomerName(value, codeInput = '') {
  return isMeaningfulCustomerName(value, codeInput)
    ? cleanCustomerDisplayName(value, codeInput)
    : '';
}

function meaningfulCustomerLevel(value) {
  return isMeaningfulCustomerLevel(value) ? String(value || '').trim() : '';
}

function getBestKnownCustomerIdentity(codeInput) {
  const code = cleanMemberId(codeInput);
  if (!code) {
    return { exists: false, code: '', name: '', level: '', lastSeenAt: null, ordersCount: 0 };
  }

  const m = members[code] || {};
  let name = meaningfulCustomerName(m.name || m.customerName || '', code);
  let level = meaningfulCustomerLevel(m.level || m.memberLevel || m.tier || '');
  let lastSeenAt = m.lastSeenAt || null;
  let ordersCount = 0;

  const customerOrders = (orders || [])
    .filter((o) => cleanMemberId(o?.customer?.code || o?.memberCard || '') === code)
    .sort((a, b) => new Date(b?.createdAt || b?.updatedAt || 0) - new Date(a?.createdAt || a?.updatedAt || 0));

  ordersCount = customerOrders.length;

  for (const o of customerOrders) {
    if (!name) {
      name = meaningfulCustomerName(
        o?.customer?.name || o?.customerName || '',
        code
      );
    }

    if (!level) {
      level = meaningfulCustomerLevel(
        o?.customer?.level || o?.customerLevel || o?.level || ''
      );
    }

    const at = o?.createdAt || o?.updatedAt || null;
    if (at && (!lastSeenAt || new Date(at) > new Date(lastSeenAt))) {
      lastSeenAt = at;
    }

    if (name && level && lastSeenAt) break;
  }

  return {
    exists: Boolean(members[code]) || customerOrders.length > 0,
    code,
    name,
    level,
    lastSeenAt,
    ordersCount: Math.max(Number(m.ordersCount || 0) || 0, ordersCount),
    apiSyncedAt: m.apiSyncedAt || null,
  };
}

function normalizeMemberSearchText(v) {
  return String(v || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[_\-.\/]+/g, ' ')
    .replace(/[^a-z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildMemberOrderStats() {
  const stats = new Map();

  for (const o of orders || []) {
    if (!o || o.status === 'CANCELLED') continue;

    const code = cleanMemberId(o.memberCard || o.customer?.code || '');
    if (!code) continue;

    const cur = stats.get(code) || {
      orderCount: 0,
      totalQty: 0,
      lastOrderAt: null,
      name: '',
      level: '',
    };

    cur.orderCount += 1;
    cur.totalQty += (o.items || []).reduce(
      (sum, it) => sum + Math.max(1, Number(it?.qty || it?.quantity || 1)),
      0
    );

    const orderAt = o.createdAt || o.updatedAt || '';
    if (orderAt && (!cur.lastOrderAt || new Date(orderAt) > new Date(cur.lastOrderAt))) {
      cur.lastOrderAt = orderAt;
    }

    if (!cur.name) {
      cur.name = meaningfulCustomerName(
        o.customer?.name || o.customerName || '',
        code
      );
    }
    if (!cur.level) {
      cur.level = meaningfulCustomerLevel(o.customer?.level || o.customerLevel || '');
    }

    stats.set(code, cur);
  }

  return stats;
}

function buildMemberOrderStatsExact({ includeCancelled = true } = {}) {
  const stats = new Map();

  for (const o of orders || []) {
    if (!o) continue;

    const statusText = String(o.status || '').toUpperCase();
    if (!includeCancelled && statusText === 'CANCELLED') continue;

    const code = cleanMemberId(o.memberCard || o.customer?.code || '');
    if (!code) continue;

    const cur = stats.get(code) || {
      orderCount: 0,
      totalQty: 0,
      lastOrderAt: null,
    };

    cur.orderCount += 1;
    cur.totalQty += (o.items || []).reduce(
      (sum, it) => sum + Math.max(1, Number(it?.qty || it?.quantity || 1)),
      0
    );

    const orderAt = o.createdAt || o.updatedAt || '';
    if (orderAt && (!cur.lastOrderAt || new Date(orderAt) > new Date(cur.lastOrderAt))) {
      cur.lastOrderAt = orderAt;
    }

    stats.set(code, cur);
  }

  return stats;
}

let memberSearchCache = {
  at: 0,
  rows: null,
  ordersLen: 0,
  membersLen: 0,
};

function clearMemberSearchCache() {
  memberSearchCache = { at: 0, rows: null, ordersLen: 0, membersLen: 0 };
}

function getMemberSearchBaseRows() {
  const now = Date.now();
  const ordersLen = Array.isArray(orders) ? orders.length : 0;
  const membersLen = Object.keys(members || {}).length;

  if (
    memberSearchCache.rows &&
    now - memberSearchCache.at < MEMBER_SEARCH_CACHE_MS &&
    memberSearchCache.ordersLen === ordersLen &&
    memberSearchCache.membersLen === membersLen
  ) {
    return memberSearchCache.rows;
  }

  const stats = buildMemberOrderStats();
  const rowsByCode = new Map();

  const upsertRow = (codeInput, data = {}) => {
    const code = cleanMemberId(codeInput);
    if (!code) return;

    const prev = rowsByCode.get(code) || {};
    const st = stats.get(code) || {};
    const m = members[code] || {};

    const name =
      meaningfulCustomerName(data.name, code) ||
      meaningfulCustomerName(prev.name, code) ||
      meaningfulCustomerName(m.name || m.customerName, code) ||
      meaningfulCustomerName(st.name, code) ||
      '';

    const level =
      meaningfulCustomerLevel(data.level) ||
      meaningfulCustomerLevel(prev.level) ||
      meaningfulCustomerLevel(m.level || m.memberLevel || m.tier) ||
      meaningfulCustomerLevel(st.level) ||
      '';

    rowsByCode.set(code, {
      id: code,
      code,
      name,
      level,
      ordersCount: Number(st.orderCount ?? m.ordersCount ?? prev.ordersCount ?? 0) || 0,
      totalQty: Number(st.totalQty ?? prev.totalQty ?? 0) || 0,
      lastOrderAt: st.lastOrderAt || m.lastSeenAt || prev.lastOrderAt || null,
    });
  };

  for (const [code, m] of Object.entries(members || {})) {
    upsertRow(code, {
      name: m?.name || m?.customerName || '',
      level: m?.level || m?.memberLevel || m?.tier || '',
    });
  }

  for (const o of orders || []) {
    if (!o || o.status === 'CANCELLED') continue;

    const code = cleanMemberId(o.memberCard || o.customer?.code || '');
    if (!code) continue;

    upsertRow(code, {
      name: o.customer?.name || o.customerName || '',
      level: o.customer?.level || '',
    });
  }

  const rows = Array.from(rowsByCode.values());

  memberSearchCache = {
    at: now,
    rows,
    ordersLen,
    membersLen,
  };

  return rows;
}
function postJsonExternal(urlString, payload, timeoutMs = CUSTOMER_API_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlString);
    const body = Buffer.from(JSON.stringify(payload), 'utf8');
    const lib = u.protocol === 'https:' ? https : http;

    const req = lib.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: `${u.pathname}${u.search}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': body.length,
        },
      },
      (res) => {
        let raw = '';
        res.setEncoding('utf8');

        res.on('data', (chunk) => {
          raw += chunk;
          if (raw.length > 1024 * 1024) {
            const err = new Error('Customer API response too large');
            err.code = 'RESPONSE_TOO_LARGE';
            req.destroy(err);
          }
        });

        res.on('end', () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            const err = new Error(`Customer API HTTP ${res.statusCode}: ${raw.slice(0, 200)}`);
            err.code = 'HTTP_ERROR';
            err.statusCode = res.statusCode;
            return reject(err);
          }

          try {
            resolve(JSON.parse(raw || '{}'));
          } catch (e) {
            const err = new Error('Customer API invalid JSON');
            err.code = 'INVALID_JSON';
            reject(err);
          }
        });
      }
    );

    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      const err = new Error('Customer API timeout');
      err.code = 'API_TIMEOUT';
      req.destroy(err);
    });
    req.write(body);
    req.end();
  });
}

function classifyCustomerApiError(error) {
  const code = String(error?.code || '').toUpperCase();
  const message = String(error?.message || error || 'Customer API error');

  if (code === 'API_TIMEOUT' || /timeout/i.test(message)) {
    return { connectionStatus: 'TIMEOUT', lookupStatus: 'ERROR', message };
  }

  if (code === 'ECONNREFUSED' || code === 'EHOSTUNREACH' || code === 'ENETUNREACH' || code === 'ENOTFOUND') {
    return { connectionStatus: 'OFFLINE', lookupStatus: 'ERROR', message };
  }

  if (code === 'HTTP_ERROR' || /^Customer API HTTP/i.test(message)) {
    return { connectionStatus: 'HTTP_ERROR', lookupStatus: 'ERROR', message };
  }

  if (code === 'INVALID_JSON') {
    return { connectionStatus: 'ONLINE', lookupStatus: 'INVALID_RESPONSE', message };
  }

  return { connectionStatus: 'OFFLINE', lookupStatus: 'ERROR', message };
}

function externalResponseSucceeded(json) {
  if (!json || typeof json !== 'object') return false;

  // Một số phiên bản API trả thẳng object khách, không bọc { status, data }.
  const looksLikeDirectCustomer = Boolean(
    json.Number ||
    json.number ||
    json.UserNumber ||
    json.MemberNumber ||
    json.MemberCode ||
    json.CustomerCode
  );
  if (looksLikeDirectCustomer && !json.data && !json.result && !json.customer) {
    return true;
  }

  const raw = json.status ?? json.Status ?? json.success ?? json.ok;
  if (raw === undefined || raw === null || raw === '') {
    return Boolean(json.data || json.result || json.customer || json.Number || json.number);
  }

  if (raw === true || raw === 1) return true;

  const text = String(raw).trim().toLowerCase();
  return ['true', '1', 'ok', 'success', 'successful'].includes(text);
}

function extractExternalCustomerPayload(json) {
  if (!json || typeof json !== 'object') return null;

  let payload = json.data ?? json.result ?? json.customer ?? json;

  for (let i = 0; i < 3; i++) {
    if (Array.isArray(payload)) {
      payload = payload[0] || null;
      continue;
    }

    if (!payload || typeof payload !== 'object') break;

    if (Array.isArray(payload.rows)) {
      payload = payload.rows[0] || null;
      continue;
    }

    if (Array.isArray(payload.items)) {
      payload = payload.items[0] || null;
      continue;
    }

    if (payload.data && typeof payload.data === 'object') {
      payload = payload.data;
      continue;
    }

    break;
  }

  return payload && typeof payload === 'object' ? payload : null;
}

function normalizeExternalCustomer(data, fallbackCode = '') {
  if (!data || typeof data !== 'object') return null;

  const code = cleanMemberId(
    data.Number ??
    data.number ??
    data.UserNumber ??
    data.MemberNumber ??
    data.MemberCode ??
    data.CustomerCode ??
    data.code ??
    data.id ??
    fallbackCode
  );
  if (!code) return null;

  const joinedName = [
    data.Surname ?? data.LastName,
    data.Forename ?? data.FirstName,
    data.MiddleName,
  ]
    .map((x) => String(x || '').trim())
    .filter(Boolean)
    .join(' ')
    .trim();

  const fullName = meaningfulCustomerName(
    data.PreferredName ||
    data.FullName ||
    data.CustomerName ||
    data.MemberName ||
    data.Name ||
    joinedName,
    code
  );

  const membershipType = meaningfulCustomerLevel(
    data.MembershipType ||
    data.Membership ||
    data.MembershipLevel ||
    data.MemberLevel ||
    data.LevelName ||
    data.Level ||
    data.TierName ||
    data.Tier ||
    ''
  ) || null;

  // Chỉ xem là dữ liệu API hợp lệ khi có ít nhất tên hoặc level thật.
  if (!fullName && !membershipType) return null;

  return {
    code,
    name: fullName || null,
    level: membershipType,
    membershipType,
    title: data.Title || data.title || null,
    surname: data.Surname || data.LastName || null,
    forename: data.Forename || data.FirstName || null,
    middleName: data.MiddleName || null,
    raw: data,
  };
}

async function fetchCustomerFromExternalDetailed(
  code,
  { force = false, timeoutMs = CUSTOMER_API_TIMEOUT_MS } = {}
) {
  const cleanCode = cleanMemberId(code);

  if (!cleanCode || !/^\d+$/.test(cleanCode)) {
    return {
      status: 'INVALID_CODE',
      data: null,
      connectionStatus: customerApiHealth.connectionStatus,
      fromCache: false,
    };
  }

  const now = Date.now();
  const cached = customerApiCache.get(cleanCode);

  if (!force && cached && now - cached.at < CUSTOMER_API_CACHE_MS) {
    return {
      status: 'FOUND',
      data: cached.data,
      connectionStatus: 'ONLINE',
      fromCache: true,
    };
  }

  if (!force && customerApiInflight.has(cleanCode)) {
    return customerApiInflight.get(cleanCode);
  }

  const promise = (async () => {
    const checkedAt = new Date().toISOString();
    customerApiHealth.lastCheckedAt = checkedAt;
    customerApiHealth.lastCheckedCode = cleanCode;

    try {
      const json = await postJsonExternal(
        CUSTOMER_API_URL,
        { id: cleanCode },
        timeoutMs
      );

      const apiReachableAt = new Date().toISOString();
      customerApiHealth.ok = true;
      customerApiHealth.connectionStatus = 'ONLINE';
      customerApiHealth.lastOkAt = apiReachableAt;
      customerApiHealth.lastError = null;

      if (!externalResponseSucceeded(json)) {
        customerApiHealth.lookupStatus = 'NOT_FOUND';
        return {
          status: 'NOT_FOUND',
          data: null,
          connectionStatus: 'ONLINE',
          fromCache: false,
          raw: json,
        };
      }

      const payload = extractExternalCustomerPayload(json);
      const data = payload ? normalizeExternalCustomer(payload, cleanCode) : null;

      if (!data) {
        customerApiHealth.lookupStatus = payload ? 'INVALID_RESPONSE' : 'NOT_FOUND';
        customerApiHealth.lastError = payload
          ? 'Customer API response did not contain a valid customer name/level'
          : null;

        return {
          status: payload ? 'INVALID_RESPONSE' : 'NOT_FOUND',
          data: null,
          connectionStatus: 'ONLINE',
          fromCache: false,
          raw: json,
        };
      }

      customerApiHealth.lookupStatus = 'FOUND';
      customerApiHealth.lastDataAt = new Date().toISOString();
      customerApiCache.set(cleanCode, { at: Date.now(), data });

      return {
        status: 'FOUND',
        data,
        connectionStatus: 'ONLINE',
        fromCache: false,
        raw: json,
      };
    } catch (error) {
      const classified = classifyCustomerApiError(error);
      customerApiHealth.ok = classified.connectionStatus === 'ONLINE';
      customerApiHealth.connectionStatus = classified.connectionStatus;
      customerApiHealth.lookupStatus = classified.lookupStatus;
      customerApiHealth.lastErrorAt = new Date().toISOString();
      customerApiHealth.lastError = classified.message;

      return {
        status: classified.lookupStatus === 'INVALID_RESPONSE'
          ? 'INVALID_RESPONSE'
          : classified.connectionStatus,
        data: null,
        connectionStatus: classified.connectionStatus,
        fromCache: false,
        error: classified.message,
      };
    } finally {
      customerApiInflight.delete(cleanCode);
    }
  })();

  customerApiInflight.set(cleanCode, promise);
  return promise;
}

// Giữ helper cũ cho các phần code chưa chuyển đổi hoàn toàn.
// Chỉ trả dữ liệu khi API/cache có bản ghi hợp lệ; lỗi API không lấy cache làm kết quả mới.
async function fetchCustomerFromExternal(code, options = {}) {
  const result = await fetchCustomerFromExternalDetailed(code, options);
  return result.status === 'FOUND' ? result.data : null;
}

function localMemberRow(code) {
  const identity = getBestKnownCustomerIdentity(code);
  if (!identity.exists) return null;

  const stored = members[identity.code] || {};

  return {
    code: identity.code,
    name: identity.name || null,
    level: identity.level || null,
    lastSeenAt: identity.lastSeenAt || null,
    ordersCount: identity.ordersCount || 0,
    apiSyncedAt: stored.apiSyncedAt || identity.apiSyncedAt || null,
    lastApiAttemptAt: stored.lastApiAttemptAt || null,
    lastApiSuccessAt: stored.lastApiSuccessAt || stored.apiSyncedAt || null,
    syncStatus: stored.syncStatus || (stored.apiSyncedAt ? 'SUCCESS' : 'LOCAL_ONLY'),
    syncError: stored.syncError || null,
    dataSource: stored.dataSource || (stored.apiSyncedAt ? 'CUSTOMER_API' : 'DATABASE'),
  };
}

function isMemberApiFresh(code) {
  const m = members[code];
  if (!m?.apiSyncedAt) return false;

  const t = Date.parse(m.apiSyncedAt);
  if (Number.isNaN(t)) return false;

  return Date.now() - t < CUSTOMER_MEMBER_TTL_MS;
}

function upsertMemberFromExternal(external, { by = 'customer-api', save = true } = {}) {
  if (!external?.code) return { ok: false, changed: false };

  const code = cleanMemberId(external.code);
  const prev = members[code] || {};
  const prevExists = !!members[code];
  const nowIso = new Date().toISOString();

  const oldName = meaningfulCustomerName(prev.name || prev.customerName || '', code);
  const oldLevel = meaningfulCustomerLevel(prev.level || prev.memberLevel || '');
  const oldMembershipType = String(prev.membershipType || '').trim();

  const nextName = meaningfulCustomerName(external.name, code) || oldName || null;
  const nextLevel = meaningfulCustomerLevel(external.level) || oldLevel || null;
  const nextMembershipType =
    external.membershipType ||
    prev.membershipType ||
    nextLevel ||
    null;

  const changes = {};

  if (nextName && oldName !== nextName) {
    changes.name = { from: oldName || null, to: nextName };
  }

  if (nextLevel && oldLevel !== nextLevel) {
    changes.level = { from: oldLevel || null, to: nextLevel };
  }

  if (
    nextMembershipType &&
    oldMembershipType &&
    oldMembershipType !== nextMembershipType
  ) {
    changes.membershipType = {
      from: oldMembershipType || null,
      to: nextMembershipType,
    };
  }

  const hasChanges = Object.keys(changes).length > 0;

  members[code] = {
    ...prev,
    code,
    name: nextName,
    customerName: nextName,
    level: nextLevel,
    memberLevel: nextLevel,
    membershipType: nextMembershipType,
    title: external.title ?? prev.title ?? null,
    surname: external.surname ?? prev.surname ?? null,
    forename: external.forename ?? prev.forename ?? null,
    middleName: external.middleName ?? prev.middleName ?? null,
    apiSource: 'user_number_level_by_id',
    apiSyncedAt: nowIso,
    lastApiAttemptAt: nowIso,
    lastApiSuccessAt: nowIso,
    syncStatus: 'SUCCESS',
    syncError: null,
    dataSource: 'CUSTOMER_API',
    updatedAt: hasChanges || !prevExists ? nowIso : prev.updatedAt || nowIso,
    createdAt: prev.createdAt || nowIso,
  };

  if (hasChanges) {
    pushMemberHistory(code, {
      type: 'API_SYNC',
      by,
      data: changes,
      detail: Object.entries(changes)
        .map(([k, v]) => `${k}: '${v.from || ''}' → '${v.to || ''}'`)
        .join('; '),
    });
  }

  // Ghi đúng 1 member vào SQLite sau mỗi lần API trả dữ liệu.
  // Dù name/level không đổi, apiSyncedAt vẫn cần được cập nhật để tránh gọi API lặp lại liên tục.
  if (save) {
    persistMember(code);
  }
  clearCustomerInsightsCache();

  return {
    ok: true,
    changed: !prevExists || hasChanges,
    member: localMemberRow(code),
  };
}

function shouldAttemptCustomerApiSync(codeInput, { force = false } = {}) {
  if (force) return true;

  const code = cleanMemberId(codeInput);
  const m = members[code] || {};
  const attemptMs = Date.parse(m.lastApiAttemptAt || '');

  if (Number.isFinite(attemptMs) && Date.now() - attemptMs < CUSTOMER_API_RETRY_BACKOFF_MS) {
    return false;
  }

  // Khi API vừa bị xác nhận offline/timeout, tránh để nhiều máy User đồng loạt gọi lại.
  const globalErrorMs = Date.parse(customerApiHealth.lastErrorAt || '');
  if (
    ['OFFLINE', 'TIMEOUT'].includes(customerApiHealth.connectionStatus) &&
    Number.isFinite(globalErrorMs) &&
    Date.now() - globalErrorMs < CUSTOMER_API_RETRY_BACKOFF_MS
  ) {
    return false;
  }

  return true;
}

function updateMemberSyncMetadata(codeInput, patch = {}) {
  const code = cleanMemberId(codeInput);
  if (!code || !members[code]) return null;

  const prev = members[code] || {};
  const nowIso = new Date().toISOString();

  members[code] = {
    ...prev,
    lastApiAttemptAt: patch.lastApiAttemptAt || nowIso,
    lastApiSuccessAt: patch.lastApiSuccessAt ?? prev.lastApiSuccessAt ?? prev.apiSyncedAt ?? null,
    syncStatus: patch.syncStatus || prev.syncStatus || 'LOCAL_ONLY',
    syncError: patch.syncError === undefined ? (prev.syncError || null) : patch.syncError,
    dataSource: patch.dataSource || prev.dataSource || (prev.apiSyncedAt ? 'CUSTOMER_API' : 'DATABASE'),
    updatedAt: nowIso,
  };

  persistMember(code);
  return localMemberRow(code);
}

async function syncCustomerDatabaseFromApi(
  codeInput,
  {
    force = false,
    by = 'customer-db-sync',
    timeoutMs = CUSTOMER_API_TIMEOUT_MS,
    emit = true,
  } = {}
) {
  const code = cleanMemberId(codeInput);
  if (!code || !/^\d+$/.test(code)) {
    return {
      ok: false,
      apiOk: false,
      status: 'INVALID_CODE',
      changed: false,
      member: localMemberRow(code),
    };
  }

  const detailed = await fetchCustomerFromExternalDetailed(code, {
    force,
    timeoutMs,
  });

  if (detailed.status === 'FOUND' && detailed.data) {
    const updated = upsertMemberFromExternal(detailed.data, {
      by,
      save: true,
    });
    const dbMember = localMemberRow(code);

    if (emit) {
      io.emit('customersUpdated', {
        count: 1,
        code,
        source: detailed.fromCache ? 'customer-api-cache' : 'customer-api',
      });
      io.emit('memberUpdated', {
        code,
        member: dbMember,
        source: 'database-after-api-sync',
        refreshDone: true,
        changed: updated.changed,
      });
    }

    return {
      ok: true,
      apiOk: true,
      status: detailed.fromCache ? 'CACHE_HIT' : 'SUCCESS',
      changed: updated.changed,
      member: dbMember,
      apiStatus: { ...customerApiHealth },
    };
  }

  const status = detailed.status || 'ERROR';
  const existing = members[code] ? updateMemberSyncMetadata(code, {
    syncStatus: status,
    syncError: detailed.error || customerApiHealth.lastError || null,
    dataSource: members[code]?.dataSource || (members[code]?.apiSyncedAt ? 'CUSTOMER_API' : 'DATABASE'),
  }) : null;

  if (emit) {
    io.emit('customerSyncStatus', {
      code,
      status,
      apiStatus: { ...customerApiHealth },
      member: existing,
    });
  }

  return {
    ok: false,
    apiOk: false,
    status,
    changed: false,
    member: existing || localMemberRow(code),
    apiStatus: { ...customerApiHealth },
  };
}

function getCustomerSyncPriority(options = {}) {
  if (Number.isFinite(Number(options.priority))) {
    return Math.max(0, Math.min(1000, Number(options.priority)));
  }

  const by = String(options.by || '').toLowerCase();
  if (options.force || by.includes('admin-check') || by.includes('manual')) return 300;
  if (by.includes('priority') || by.includes('member-lookup')) return 220;
  if (by.includes('order')) return 200;
  if (by.includes('recent') || by.includes('automatic')) return 40;
  return 100;
}

function scheduleCustomerSyncWorker(delayMs = 0) {
  if (customerSyncWorkerTimer || customerSyncWorkerRunning) return;

  customerSyncWorkerTimer = setTimeout(() => {
    customerSyncWorkerTimer = null;
    runCustomerSyncWorker().catch((error) => {
      console.warn('[customer sync worker]', error?.message || String(error));
    });
  }, Math.max(0, Number(delayMs || 0)));
}

function queueCustomerDatabaseSync(codeInput, options = {}) {
  const code = cleanMemberId(codeInput);
  if (!code || !/^\d+$/.test(code)) return false;
  if (customerSyncProcessing.has(code) || customerApiInflight.has(code)) return false;
  if (!shouldAttemptCustomerApiSync(code, options)) return false;

  const priority = getCustomerSyncPriority(options);
  const existing = customerSyncQueue.get(code);

  if (existing) {
    // Nếu cùng mã được search/order lại, nâng priority thay vì thêm bản ghi trùng.
    customerSyncQueue.set(code, {
      ...existing,
      priority: Math.max(existing.priority || 0, priority),
      force: Boolean(existing.force || options.force),
      emit: existing.emit !== false || options.emit !== false,
      by: priority >= (existing.priority || 0)
        ? (options.by || existing.by)
        : existing.by,
      timeoutMs: Math.max(
        Number(existing.timeoutMs || 0),
        Number(options.timeoutMs || CUSTOMER_API_TIMEOUT_MS)
      ),
      updatedAt: Date.now(),
    });
    scheduleCustomerSyncWorker(0);
    return true;
  }

  if (customerSyncQueue.size >= CUSTOMER_SYNC_QUEUE_MAX) {
    // Queue đầy: chỉ cho phép khách ưu tiên cao chen vào bằng cách bỏ 1 item nền thấp nhất.
    const lowest = Array.from(customerSyncQueue.values())
      .sort((a, b) => (a.priority - b.priority) || (b.queuedAt - a.queuedAt))[0];

    if (!lowest || lowest.priority >= priority) return false;

    customerSyncQueue.delete(lowest.code);
    customerSyncScheduled.delete(lowest.code);
  }

  const now = Date.now();
  customerSyncQueue.set(code, {
    code,
    priority,
    force: Boolean(options.force),
    by: options.by || 'customer-db-background-sync',
    timeoutMs: options.timeoutMs || CUSTOMER_API_TIMEOUT_MS,
    emit: options.emit !== false,
    queuedAt: now,
    updatedAt: now,
  });
  customerSyncScheduled.add(code);
  scheduleCustomerSyncWorker(0);
  return true;
}

function takeNextCustomerSyncItems(limit) {
  return Array.from(customerSyncQueue.values())
    .sort((a, b) => {
      if ((b.priority || 0) !== (a.priority || 0)) {
        return (b.priority || 0) - (a.priority || 0);
      }
      return (a.queuedAt || 0) - (b.queuedAt || 0);
    })
    .slice(0, Math.max(1, limit));
}

async function runCustomerSyncWorker() {
  if (customerSyncWorkerRunning || customerSyncQueue.size === 0) return;

  const globalErrorMs = Date.parse(customerApiHealth.lastErrorAt || '');
  if (
    ['OFFLINE', 'TIMEOUT'].includes(customerApiHealth.connectionStatus) &&
    Number.isFinite(globalErrorMs) &&
    Date.now() - globalErrorMs < CUSTOMER_API_RETRY_BACKOFF_MS
  ) {
    scheduleCustomerSyncWorker(CUSTOMER_API_RETRY_BACKOFF_MS - (Date.now() - globalErrorMs));
    return;
  }

  customerSyncWorkerRunning = true;
  customerSyncLastRunAt = new Date().toISOString();

  const summary = {
    processed: 0,
    updated: 0,
    changed: 0,
    failed: 0,
    stoppedByApi: false,
  };

  try {
    while (
      customerSyncQueue.size > 0 &&
      summary.processed < CUSTOMER_SYNC_MAX_PER_RUN &&
      !summary.stoppedByApi
    ) {
      const capacity = Math.min(
        CUSTOMER_SYNC_CONCURRENCY,
        CUSTOMER_SYNC_MAX_PER_RUN - summary.processed
      );
      const items = takeNextCustomerSyncItems(capacity);
      if (items.length === 0) break;

      for (const item of items) {
        customerSyncQueue.delete(item.code);
        customerSyncProcessing.add(item.code);
      }

      const rows = await Promise.all(items.map(async (item) => {
        try {
          return await syncCustomerDatabaseFromApi(item.code, {
            force: item.force,
            by: item.by,
            timeoutMs: item.timeoutMs,
            emit: item.emit,
          });
        } catch (error) {
          return {
            ok: false,
            apiOk: false,
            status: 'ERROR',
            changed: false,
            member: localMemberRow(item.code),
            error: error?.message || String(error),
          };
        } finally {
          customerSyncProcessing.delete(item.code);
          customerSyncScheduled.delete(item.code);
        }
      }));

      summary.processed += rows.length;
      for (const row of rows) {
        if (row?.apiOk) {
          summary.updated += 1;
          if (row.changed) summary.changed += 1;
        } else {
          summary.failed += 1;
        }

        if (['OFFLINE', 'TIMEOUT'].includes(row?.status)) {
          summary.stoppedByApi = true;
        }
      }

      // Nhường event loop giữa các nhóm request.
      if (!summary.stoppedByApi && customerSyncQueue.size > 0) {
        await new Promise((resolve) => setTimeout(resolve, 120));
      }
    }
  } finally {
    customerSyncWorkerRunning = false;
    customerSyncLastFinishedAt = new Date().toISOString();
    customerSyncLastResult = summary;

    if (summary.updated > 0) {
      io.emit('customersUpdated', {
        count: summary.updated,
        changed: summary.changed,
        source: 'priority-customer-sync-worker',
      });
    }

    if (customerSyncQueue.size > 0) {
      scheduleCustomerSyncWorker(
        summary.stoppedByApi
          ? CUSTOMER_API_RETRY_BACKOFF_MS
          : CUSTOMER_SYNC_WORKER_DELAY_MS
      );
    }
  }
}

async function resolveCustomerByApiOrLocal(code, { force = false, by = 'lookup' } = {}) {
  const cleanCode = cleanMemberId(code);
  if (!cleanCode) return { source: 'empty', member: null, apiUsed: false };

  // Đảm bảo dữ liệu fallback từ order được ghi vào Database trước khi app đọc.
  const storedBeforeRecovery = members[cleanCode] || null;
  let local = storedBeforeRecovery ? localMemberRow(cleanCode) : null;
  if (
    !storedBeforeRecovery ||
    (!meaningfulCustomerName(storedBeforeRecovery.name || storedBeforeRecovery.customerName, cleanCode) &&
      !meaningfulCustomerLevel(storedBeforeRecovery.level || storedBeforeRecovery.memberLevel || storedBeforeRecovery.tier))
  ) {
    recoverMemberFromKnownHistory(cleanCode, `${by}-db-recovery`);
    local = members[cleanCode] ? localMemberRow(cleanCode) : null;
  }

  const fresh = Boolean(local && isMemberApiFresh(cleanCode));
  const queued = (!fresh || force)
    ? queueCustomerDatabaseSync(cleanCode, {
        force,
        by: `${by}-background-api-sync`,
      })
    : false;

  return {
    source: 'database',
    member: local,
    apiUsed: false,
    backgroundRefreshing: queued || customerSyncScheduled.has(cleanCode) || customerApiInflight.has(cleanCode),
  };
}

async function buildCustomerSnapshot(memberCard, customerFromBody = {}, fallbackName = null) {
  const code = cleanMemberId(memberCard);

  const bodyName = meaningfulCustomerName(
    customerFromBody.name ||
    customerFromBody.customerName ||
    fallbackName ||
    '',
    code
  );

  const bodyLevel = meaningfulCustomerLevel(
    customerFromBody.level ||
    customerFromBody.memberLevel ||
    customerFromBody.tier ||
    ''
  );

  // Chỉ dùng snapshot frontend ngay khi cả tên và level đều là dữ liệu thật.
  // Các text UI như "Không tìm thấy hoặc API chậm" / "---" không được lưu vào member/order.
  if (code && bodyName && bodyLevel) {
    return {
      code,
      name: bodyName,
      level: bodyLevel,
      source: 'body-snapshot',
    };
  }

  const resolved = await resolveCustomerByApiOrLocal(code, {
    force: false,
    by: 'order',
  });

  const m = resolved.member || {};

  return {
    code: m.code || code || null,
    name: bodyName || meaningfulCustomerName(m.name, code) || null,
    level: bodyLevel || meaningfulCustomerLevel(m.level) || null,
    source: resolved.source,
  };
}

// ====== Auth helpers ======
function authenticateJWT(req, res, next) {
  const auth = req.headers['authorization'] || '';
  if (!auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing token' });
  }
  const token = auth.slice(7);
  jwt.verify(token, JWT_SECRET, (err, payload) => {
    if (err) {
      // Token hết hạn / sai key
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    req.user = payload;
    next();
  });
}

function authorizeRoles(...roles) {
  return (req, _res, next) => {
    if (!req.user) return next({ status: 401, message: 'Unauthorized' });
    if (!roles.includes(req.user.role)) return next({ status: 403, message: 'Forbidden' });
    next();
  };
}

// ====== Upload ảnh (Multer) ======
const multerUpload = multer({
  dest: MULTER_TMP,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!['.jpg', '.jpeg', '.png'].includes(ext)) return cb(new Error('Chỉ cho phép ảnh JPG/JPEG/PNG'));
    cb(null, true);
  },
});

// ==== App Version ====
const APP_VERSION =
  process.env.APP_VERSION ||
  (require('./package.json').version + '-' + Math.floor(Date.now() / 1000));

io.on('connection', (socket) => {
  socket.emit('appVersion', APP_VERSION);
});


// Danh sách khách hàng có phân trang + tìm kiếm
app.get('/api/customers', authenticateJWT, authorizeRoles('admin'), (req, res) => {
  const norm = (s) => String(s || '').toLowerCase();
  const q = norm(req.query.q || '');
  const page = Math.max(1, parseInt(req.query.page || '1', 10));

  // Tăng giới hạn để Báo cáo join đủ Tên KH + Level cho tất cả mã KH
  const MAX_LIMIT = 70000;
  const limit = Math.max(1, Math.min(MAX_LIMIT, parseInt(req.query.limit || '50', 10)));

  const all = Object.entries(members || {}).map(([code, m]) => {
    const name  = m?.name || m?.customerName || '';
    const level = m?.level || m?.memberLevel || m?.tier || '';
    return { id: code, code, name, level };
  });

  const filtered = q
    ? all.filter(it => [it.code, it.name, it.level].some(v => norm(v).includes(q)))
    : all;

  const start = (page - 1) * limit;
  const items = filtered.slice(start, start + limit);
  res.json({ items, total: filtered.length, page, limit });
});


 // Alias để FE fallback: giữ đúng output & phân trang như /api/customers
 app.get('/api/members', authenticateJWT, authorizeRoles('admin'), (req, res) => {
   req.url = req.url.replace('/api/members', '/api/customers');
   app._router.handle(req, res);
 });

app.get('/api/version', (_req, res) => res.json({ version: APP_VERSION }));

// ====== MENU TYPES API (NEW) ======
const MENU_TYPES = [
  'SNACK TRAVEL',
  'SNACK MENU',
  'CLUB MENU',
  'HOTEL MENU',
  'VIP MENU',
  'WINE MENU - KOREAN',
  'WINE MENU - ENGLISH',
  'WINE MENU - CHINESE',
  'WINE MENU - JAPANESE',
];
// ✓ Helper: gộp danh sách menu động (có trong foods.json, menu-levels.json) + base
function getAllMenuTypes() {
  const base = Array.isArray(MENU_TYPES) ? MENU_TYPES : [];
  const dynLevels = Object.keys(menuLevels || {});
  const fromFoods = foods.map(f => f.type).filter(Boolean);
  return Array.from(new Set([...base, ...dynLevels, ...fromFoods])).sort();
}

// ✓ Helper: tên menu an toàn
function assertSafeMenuName(name) {
  const s = String(name || '').trim();
  if (!s) throw new Error('empty');
  if (/[\/\\]/.test(s) || s.includes('..')) throw new Error('bad');
  if (s.length > 80) throw new Error('too long');
  return s;
}

app.get('/api/menu-types', (_req, res) => {
  res.json(getAllMenuTypes());
});
// Backup thủ công trước khi import
app.post('/api/members/backup',
  authenticateJWT, authorizeRoles('admin'),
  (_req, res) => {
    backupMembers();
    res.json({ ok: true });
  }
);

// Liệt kê file backup
app.get('/api/members/backups',
  authenticateJWT, authorizeRoles('admin'),
  (_req, res) => {
    const files = fs.readdirSync(BACKUP_DIR).filter(f => f.startsWith('members-'));
    res.set('Cache-Control', 'no-store');
res.json({ files });

  }
);

// Phục hồi từ backup
app.post('/api/members/restore',
  authenticateJWT, authorizeRoles('admin'),
  (req, res) => {
    const { file } = req.body || {};
    if (!file) return res.status(400).json({ error: 'Thiếu file' });
    const src = path.join(BACKUP_DIR, file);
    if (!fs.existsSync(src)) return res.status(404).json({ error: 'Backup not found' });
    fs.copyFileSync(src, MEMBERS_JSON);

    // Reload vào bộ nhớ + ghi lại vào SQLite
    members = JSON.parse(fs.readFileSync(MEMBERS_JSON, 'utf-8') || '{}');
    sqliteStore.replaceAllMembers(members);
    clearMemberSearchCache();

    res.json({ ok: true });
  }
);


app.post('/api/broadcast-version',
  authenticateJWT, authorizeRoles('admin'),
  (_req, res) => { io.emit('appVersion', APP_VERSION); res.json({ ok: true }); }
);

// ====== Routes ======

// --- Đăng nhập ---
app.post('/api/login', (req, res) => {
  try {
    const { username, password } = req.body || {};
    const usersPath = USERS_JSON;
    const users = fs.existsSync(usersPath) ? JSON.parse(fs.readFileSync(usersPath,'utf8')||'[]') : [];
    const user = users.find(u => u.username === username);
    if (!user) return res.status(401).json({ error: 'Sai thông tin đăng nhập' });
    const ok = bcrypt.compareSync(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: 'Sai thông tin đăng nhập' });
    const token = jwt.sign(
  { sub: user.username, role: user.role },
  JWT_SECRET,
  { expiresIn: JWT_TTL }
);

    res.json({ token, role: user.role, username: user.username });
  } catch (e) {
    console.error('Login error:', e);
    res.status(500).json({ error: 'Login thất bại' });
  }
});

// --- Lấy danh sách món (public) ---
// Enrich từ products.json: thêm menus[], itemGroup, name, productCode, menuType, price
app.get('/api/foods', (_req, res) => {
  try {
    // Luôn reload nhanh từ SQLite để tránh dữ liệu menu bị cũ
    foods = sqliteStore.loadFoods();
  } catch (e) {
    console.error('[GET /api/foods] reload foods failed:', e.message);
  }

  const sorted = [...foods].sort((a, b) => {
    const ao = typeof a.order === 'number' ? a.order : 0;
    const bo = typeof b.order === 'number' ? b.order : 0;
    if (ao !== bo) return ao - bo;
    return String(a.type || '').localeCompare(String(b.type || ''));
  });

  const prods = loadProductsSafe();
  const pmap = new Map();
  for (const p of prods) {
    const img =
      (p.imageName && String(p.imageName).toLowerCase()) ||
      (p.imageUrl && extractImageName(p.imageUrl)) ||
      null;
    if (!img) continue;
    pmap.set(img, p);
  }

  // Build imageName -> menus fallback từ foods (đảm bảo tick đúng menu cũ)
  const imageNameMenus = new Map();
  for (const f of sorted) {
    const img = extractImageName(f.imageUrl);
    if (!img) continue;
    const arr = imageNameMenus.get(img) || new Set();
    if (f.type) arr.add(String(f.type));
    imageNameMenus.set(img, arr);
  }

  const enriched = sorted.map((f) => {
    const img = extractImageName(f.imageUrl);
    const p = img ? pmap.get(img) : null;

    const priceNum = p && typeof p.price === 'number'
      ? p.price
      : (p && p.price != null && !Number.isNaN(Number(p.price)) ? Number(p.price) : null);

    const menus =
      (p && Array.isArray(p.menus) && p.menus.length ? p.menus
        : (imageNameMenus.get(img) ? Array.from(imageNameMenus.get(img)) : [])) || [];

    // ---- NHÓM HÀNG (itemGroup): single-value, thay cho reportGroup cũ ----
    // Ưu tiên p.itemGroup; fallback p.group; rồi groups[0]; nếu không có thì null
    const itemGroup =
      (p && p.itemGroup) ? p.itemGroup
      : (p && p.group) ? p.group
      : (p && Array.isArray(p.groups) && p.groups.length ? p.groups[0] : null);

    return {
      ...f,
      menus,
      // KHÔNG trả reportGroup nữa
      itemGroup: itemGroup || null,
      name: p?.name || null,
      productCode: (p && p.productCode) ? String(p.productCode).trim() :
             (p && p.code) ? String(p.code).trim() :
             null,

      menuType: p?.menuType || null,
      price: priceNum,
    };
  });


  res.json(enriched);
});

// Tìm khách theo mã member hoặc tên, sắp xếp theo số lần order nhiều nhất
app.get('/api/member-search', (req, res) => {
  try {
    const rawQ = String(req.query.q || req.query.search || '').trim();
    const limit = Math.max(1, Math.min(50, Number(req.query.limit || 10)));

    if (!rawQ) {
      return res.json({ items: [], total: 0, q: rawQ });
    }

    const qCompact = cleanMemberId(rawQ).toLowerCase();
    const qNorm = normalizeMemberSearchText(rawQ);
    const qTokens = qNorm.split(' ').filter(Boolean);

    // Dùng cache base rows để tránh mỗi lần gõ lại quét toàn bộ orders + members
    const allRows = getMemberSearchBaseRows();

    const filtered = allRows.filter((r) => {
      const code = String(r.code || '').toLowerCase();
      const nameNorm = normalizeMemberSearchText(r.name || '');
      const levelNorm = normalizeMemberSearchText(r.level || '');

      const matchCode = qCompact && code.includes(qCompact);
      const matchName = qTokens.length > 0 && qTokens.every((t) => nameNorm.includes(t));
      const matchLevel = qTokens.length > 0 && qTokens.every((t) => levelNorm.includes(t));

      return matchCode || matchName || matchLevel;
    });

    filtered.sort((a, b) => {
      if (b.ordersCount !== a.ordersCount) return b.ordersCount - a.ordersCount;
      if (b.totalQty !== a.totalQty) return b.totalQty - a.totalQty;
      return new Date(b.lastOrderAt || 0) - new Date(a.lastOrderAt || 0);
    });

    res.json({
      items: filtered.slice(0, limit),
      total: filtered.length,
      q: rawQ,
      cached: true,
    });
  } catch (e) {
    console.error('GET /api/member-search error:', e);
    res.status(500).json({ error: 'Cannot search members' });
  }
});

// Tra cứu khách: ưu tiên trả local nhanh, sau đó kiểm tra API nền nếu dữ liệu đã cũ
async function refreshCustomerByApiInBackground(code, { force = false, by = 'member-lookup-background' } = {}) {
  return queueCustomerDatabaseSync(code, {
    force,
    by,
  });
}

app.get('/api/member-lookup', async (req, res) => {
  try {
    const card = cleanMemberId(req.query.memberCard || req.query.id || req.query.code);
    const requestRefresh = ['true', '1', 'yes'].includes(
      String(req.query.refresh ?? req.query.force ?? '').toLowerCase()
    );

    if (!card) {
      return res.json({
        ok: false,
        customerName: null,
        level: null,
        source: 'database',
        syncStatus: 'EMPTY',
      });
    }

    // App chỉ đọc Database. Nếu Database chưa có dữ liệu hợp lệ,
    // phục hồi từ order history vào Database trước rồi mới trả về.
    const storedBeforeRecovery = members[card] || null;
    let local = storedBeforeRecovery ? localMemberRow(card) : null;
    if (
      !storedBeforeRecovery ||
      (!meaningfulCustomerName(storedBeforeRecovery.name || storedBeforeRecovery.customerName, card) &&
        !meaningfulCustomerLevel(storedBeforeRecovery.level || storedBeforeRecovery.memberLevel || storedBeforeRecovery.tier))
    ) {
      recoverMemberFromKnownHistory(card, 'member-lookup-db-recovery');
      local = members[card] ? localMemberRow(card) : null;
    }

    const fresh = Boolean(local && isMemberApiFresh(card));
    const shouldRefresh = requestRefresh || !fresh;
    const queued = shouldRefresh
      ? queueCustomerDatabaseSync(card, {
          force: requestRefresh,
          by: requestRefresh
            ? 'member-lookup-priority-sync'
            : 'member-lookup-background-sync',
        })
      : false;

    return res.json({
      ok: Boolean(local),
      code: local?.code || card,
      customerCode: local?.code || card,
      customerName: local?.name || null,
      name: local?.name || null,
      level: local?.level || null,
      tier: local?.level || null,
      lastSeenAt: local?.lastSeenAt || null,
      ordersCount: local?.ordersCount || 0,
      apiSyncedAt: local?.apiSyncedAt || null,
      lastApiAttemptAt: local?.lastApiAttemptAt || null,
      lastApiSuccessAt: local?.lastApiSuccessAt || null,
      syncStatus: local?.syncStatus || (local ? 'LOCAL_ONLY' : 'NOT_IN_DATABASE'),
      syncError: local?.syncError || null,
      dataSource: local?.dataSource || 'DATABASE',
      apiUsed: false,
      refreshing:
        queued ||
        customerSyncScheduled.has(card) ||
        customerApiInflight.has(card),
      backgroundRefreshing:
        queued ||
        customerSyncScheduled.has(card) ||
        customerApiInflight.has(card),
      source: 'database',
      apiStatus: customerApiHealth,
    });
  } catch (error) {
    const card = cleanMemberId(req.query.memberCard || req.query.id || req.query.code);
    const local = localMemberRow(card);

    return res.json({
      ok: Boolean(local),
      code: local?.code || card || null,
      customerCode: local?.code || card || null,
      customerName: local?.name || null,
      name: local?.name || null,
      level: local?.level || null,
      tier: local?.level || null,
      source: 'database-error-fallback',
      syncStatus: local?.syncStatus || 'DATABASE_ERROR',
      error: error?.message || String(error),
      apiStatus: customerApiHealth,
    });
  }
});

// ===================================================================
// ================= CUSTOMER PROFILE + EVENTS ========================
// ===================================================================

function getShiftInfoForEvent(eventAtInput) {
  const d = new Date(eventAtInput);
  if (Number.isNaN(d.getTime())) return null;

  const h = d.getHours();
  const shiftStart = new Date(d);
  let shift = 'A';

  if (h >= 6 && h < 14) {
    shift = 'A';
    shiftStart.setHours(6, 0, 0, 0);
  } else if (h >= 14 && h < 22) {
    shift = 'B';
    shiftStart.setHours(14, 0, 0, 0);
  } else {
    shift = 'C';

    if (h >= 22) {
      shiftStart.setHours(22, 0, 0, 0);
    } else {
      shiftStart.setDate(shiftStart.getDate() - 1);
      shiftStart.setHours(22, 0, 0, 0);
    }
  }

  return {
    shift,
    shiftStartAt: shiftStart.toISOString(),
  };
}

function eventPublicPayload(ev = {}) {
  return {
    ...ev,
    alarmLabel: ev.alarmType === 'SHIFT_START'
      ? 'Nhắc đầu ca'
      : ev.alarmType === 'ONE_HOUR_BEFORE'
        ? 'Nhắc trước 1 tiếng'
        : ev.alarmType === 'SNOOZE'
          ? 'Nhắc lại'
          : 'Nhắc sự kiện',
  };
}

function emitCustomerEventsUpdated(event) {
  io.emit('customerEventsUpdated', { event });
}
app.get('/api/user/customer-profile/search', (req, res) => {
  try {
    const q = String(req.query.q || req.query.search || '').trim();
    const limit = Math.max(1, Math.min(50, Number(req.query.limit || 12)));

    if (!q) return res.json({ items: [], total: 0, q });

    const qCompact = cleanMemberId(q).toLowerCase();
    const qNorm = normalizeMemberSearchText(q);
    const qTokens = qNorm.split(' ').filter(Boolean);

    const stats = buildMemberOrderStats();
const exactStats = buildMemberOrderStatsExact({ includeCancelled: true });
const allRows = getMemberSearchBaseRows();

    const filtered = allRows.filter((r) => {
      const code = String(r.code || '').toLowerCase();
      const nameNorm = normalizeMemberSearchText(r.name || '');
      const levelNorm = normalizeMemberSearchText(r.level || '');

      const matchCode = qCompact && code.includes(qCompact);
      const matchName = qTokens.length > 0 && qTokens.every((t) => nameNorm.includes(t));
      const matchLevel = qTokens.length > 0 && qTokens.every((t) => levelNorm.includes(t));

      return matchCode || matchName || matchLevel;
    });

    const normalized = filtered.map((r) => {
      const code = cleanMemberId(r.code || r.id || '');
      const m = members[code] || {};
      const st = stats.get(code) || {};

      const name =
        meaningfulCustomerName(m.name || m.customerName, code) ||
        meaningfulCustomerName(r.name, code) ||
        meaningfulCustomerName(st.name, code) ||
        '';

      const level =
        meaningfulCustomerLevel(m.level || m.memberLevel || m.tier) ||
        meaningfulCustomerLevel(r.level) ||
        meaningfulCustomerLevel(st.level) ||
        '';

      const exact = exactStats.get(code) || {};
const ordersCount = Number(exact.orderCount || 0) || 0;

      const totalQty = Math.max(
        Number(r.totalQty || 0) || 0,
        Number(st.totalQty || 0) || 0
      );

const lastOrderAt =
  exact.lastOrderAt ||
  st.lastOrderAt ||
  r.lastOrderAt ||
  m.lastSeenAt ||
  null;

      return {
        ...r,
        id: code,
        code,
        name,
        level,
        ordersCount,
        totalQty,
        lastOrderAt,
      };
    });

    normalized.sort((a, b) => {
      const exactA = qCompact && String(a.code).toLowerCase() === qCompact ? 1 : 0;
      const exactB = qCompact && String(b.code).toLowerCase() === qCompact ? 1 : 0;
      if (exactB !== exactA) return exactB - exactA;

      if (b.ordersCount !== a.ordersCount) return b.ordersCount - a.ordersCount;
      if (b.totalQty !== a.totalQty) return b.totalQty - a.totalQty;

      return new Date(b.lastOrderAt || 0) - new Date(a.lastOrderAt || 0);
    });

    res.json({
      items: normalized.slice(0, limit),
      total: normalized.length,
      q,
    });
  } catch (e) {
    console.error('GET /api/user/customer-profile/search error:', e);
    res.status(500).json({ error: 'Cannot search customer profile' });
  }
});
// Quick spending summary cho Order Form
app.get('/api/user/customer-spending/:code', (req, res) => {
  try {
    orders = reloadOrdersSafe('GET /api/user/customer-spending/:code');

    const code = cleanMemberId(req.params.code || '');
    if (!code) return res.status(400).json({ error: 'Thiếu mã khách' });

const today = buildCustomerSpending(code, { range: 'today', limit: 5 });
const thisWeek = buildCustomerSpending(code, { range: 'week', limit: 5 });
const thisMonth = buildCustomerSpending(code, { range: 'month', limit: 5 });

res.json({
  code,
  today: today.summary,
  thisWeek: thisWeek.summary,
  thisMonth: thisMonth.summary,

  // Lấy lần order gần nhất trong tháng hiện tại để hiển thị nhanh
  lastOrderAt: thisMonth.summary.lastOrderAt,

  // Cảnh báo món chưa có giá trong tháng hiện tại
  pendingPriceItems: thisMonth.summary.pendingPriceItems,
});
  } catch (e) {
    console.error('GET /api/user/customer-spending/:code error:', e);
    res.status(500).json({ error: 'Cannot build customer spending' });
  }
});

// Spending detail cho Insights
app.get('/api/user/customer-spending/:code/detail', (req, res) => {
  try {
    orders = reloadOrdersSafe('GET /api/user/customer-spending/:code/detail');

    const code = cleanMemberId(req.params.code || '');
    if (!code) return res.status(400).json({ error: 'Thiếu mã khách' });

    const range = String(req.query.range || 'month');
    const from = req.query.from;
    const to = req.query.to;

    const data = buildCustomerSpending(code, {
      range,
      from,
      to,
      limit: 500,
    });

    res.json(data);
  } catch (e) {
    console.error('GET /api/user/customer-spending/:code/detail error:', e);
    res.status(500).json({ error: 'Cannot build customer spending detail' });
  }
});
app.get('/api/user/customer-profile/:code', (req, res) => {
  try {
    const code = cleanMemberId(req.params.code || '');
    if (!code) return res.status(400).json({ error: 'Thiếu mã khách' });

    const m = members[code] || {};
    const identity = getBestKnownCustomerIdentity(code);
    const data = getCustomerInsightsSnapshot({ force: false });
    const insight = data.customerMap[code] || null;

const allCustomerOrders = getOrdersByCustomerCodeExact(code, { includeCancelled: true })
  .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

const customerOrders = allCustomerOrders.slice(0, 100);
const exactOrdersCount = allCustomerOrders.length;

    const events = sqliteStore.listCustomerEvents({
      memberCode: code,
      limit: 100,
    });

    const recommendations = insight
      ? buildCustomerRecommendations(insight, data.topItems, 12)
      : data.topItems.slice(0, 12);

    res.json({
member: {
  code,
  name:
    meaningfulCustomerName(identity.name, code) ||
    meaningfulCustomerName(insight?.name, code) ||
    '',
  level:
    meaningfulCustomerLevel(identity.level) ||
    meaningfulCustomerLevel(insight?.level) ||
    '',
  lastSeenAt: identity.lastSeenAt || insight?.lastOrderAt || null,
  ordersCount: exactOrdersCount,
  apiSyncedAt: m.apiSyncedAt || null,
  membershipType: m.membershipType || null,
},
      history: Array.isArray(m.history)
        ? m.history.slice().sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0)).slice(0, 80)
        : [],
      orders: customerOrders,
      preferences: insight
        ? {
            favoriteItems: insight.favoriteItems || [],
            notes: insight.notes || [],
            orderNotes: insight.orderNotes || [],
            recommendations,
          }
        : {
            favoriteItems: [],
            notes: [],
            orderNotes: [],
            recommendations,
          },
      events,
    });
  } catch (e) {
    console.error('GET /api/user/customer-profile/:code error:', e);
    res.status(500).json({ error: 'Cannot build customer profile' });
  }
});
app.get('/api/customer-events/upcoming', (req, res) => {
  try {
    const now = new Date();
    const to = new Date(now);
    to.setDate(to.getDate() + Math.max(1, Math.min(30, Number(req.query.days || 7))));

    const events = sqliteStore.listCustomerEvents({
      from: now.toISOString(),
      to: to.toISOString(),
      status: ['PENDING', 'ACKNOWLEDGED', 'SNOOZED'],
      limit: 500,
    });

    res.json({ events });
  } catch (e) {
    console.error('GET /api/customer-events/upcoming error:', e);
    res.status(500).json({ error: 'Cannot list upcoming events' });
  }
});

app.get('/api/customer-events/member/:code', (req, res) => {
  try {
    const code = cleanMemberId(req.params.code || '');
    const events = sqliteStore.listCustomerEvents({
      memberCode: code,
      limit: 200,
    });

    res.json({ events });
  } catch (e) {
    console.error('GET /api/customer-events/member/:code error:', e);
    res.status(500).json({ error: 'Cannot list member events' });
  }
});

app.post('/api/customer-events', (req, res) => {
  try {
    const body = req.body || {};
    const memberCode = cleanMemberId(body.memberCode || body.code || '');
    const eventAt = body.eventAt;

    if (!memberCode) return res.status(400).json({ error: 'Thiếu mã khách' });
    if (!eventAt) return res.status(400).json({ error: 'Thiếu thời gian khách vào club' });

    const shiftInfo = getShiftInfoForEvent(eventAt);
    if (!shiftInfo) return res.status(400).json({ error: 'Thời gian event không hợp lệ' });

    const m = members[memberCode] || {};

    const event = sqliteStore.upsertCustomerEvent({
      memberCode,
      customerName: body.customerName || m.name || m.customerName || '',
      customerLevel: body.customerLevel || m.level || m.memberLevel || '',
      eventAt,
      shift: shiftInfo.shift,
      shiftStartAt: shiftInfo.shiftStartAt,
      note: body.note || '',
      status: 'PENDING',
      createdBy: body.createdBy || body.by || 'user',
    });

    emitCustomerEventsUpdated(event);

    res.status(201).json({ ok: true, event });
  } catch (e) {
    console.error('POST /api/customer-events error:', e);
    res.status(500).json({ error: 'Cannot create customer event' });
  }
});

app.patch('/api/customer-events/:id', (req, res) => {
  try {
    const current = sqliteStore.getCustomerEventById(req.params.id);
    if (!current) return res.status(404).json({ error: 'Event not found' });

    const patch = { ...(req.body || {}) };

    if (patch.eventAt) {
      const shiftInfo = getShiftInfoForEvent(patch.eventAt);
      if (!shiftInfo) return res.status(400).json({ error: 'Thời gian event không hợp lệ' });
      patch.shift = shiftInfo.shift;
      patch.shiftStartAt = shiftInfo.shiftStartAt;
    }

    const event = sqliteStore.updateCustomerEvent(req.params.id, patch);
    emitCustomerEventsUpdated(event);

    res.json({ ok: true, event });
  } catch (e) {
    console.error('PATCH /api/customer-events/:id error:', e);
    res.status(500).json({ error: 'Cannot update customer event' });
  }
});

app.post('/api/customer-events/:id/ack', (req, res) => {
  try {
    const event = sqliteStore.updateCustomerEvent(req.params.id, {
      status: 'ACKNOWLEDGED',
      acknowledgedAt: new Date().toISOString(),
    });

    if (!event) return res.status(404).json({ error: 'Event not found' });

    emitCustomerEventsUpdated(event);
    res.json({ ok: true, event });
  } catch (e) {
    res.status(500).json({ error: 'Cannot acknowledge event' });
  }
});

app.post('/api/customer-events/:id/snooze', (req, res) => {
  try {
    const minutes = Math.max(1, Math.min(240, Number(req.body?.minutes || 10)));
    const snoozeUntil = new Date(Date.now() + minutes * 60 * 1000).toISOString();

    const event = sqliteStore.updateCustomerEvent(req.params.id, {
      status: 'SNOOZED',
      snoozedUntil: snoozeUntil,
    });

    if (!event) return res.status(404).json({ error: 'Event not found' });

    emitCustomerEventsUpdated(event);
    res.json({ ok: true, event });
  } catch (e) {
    res.status(500).json({ error: 'Cannot snooze event' });
  }
});

app.post('/api/customer-events/:id/arrived', (req, res) => {
  try {
    const event = sqliteStore.updateCustomerEvent(req.params.id, {
      status: 'ARRIVED',
      arrivedAt: new Date().toISOString(),
    });

    if (!event) return res.status(404).json({ error: 'Event not found' });

    emitCustomerEventsUpdated(event);
    res.json({ ok: true, event });
  } catch (e) {
    res.status(500).json({ error: 'Cannot mark arrived' });
  }
});

app.post('/api/customer-events/:id/cancel', (req, res) => {
  try {
    const event = sqliteStore.updateCustomerEvent(req.params.id, {
      status: 'CANCELLED',
      cancelledAt: new Date().toISOString(),
    });

    if (!event) return res.status(404).json({ error: 'Event not found' });

    emitCustomerEventsUpdated(event);
    res.json({ ok: true, event });
  } catch (e) {
    res.status(500).json({ error: 'Cannot cancel event' });
  }
});
// ===================================================================
// ================= CUSTOMER INSIGHTS / PREFERENCES =================
// ===================================================================

let customerInsightsCache = {
  at: 0,
  data: null,
};

function clearCustomerInsightsCache() {
  customerInsightsCache = { at: 0, data: null };
}

const CUSTOMER_INSIGHTS_CACHE_MS = Number(
  process.env.CUSTOMER_INSIGHTS_CACHE_MS || 30 * 1000
);

function normalizeInsightText(v) {
  return String(v || '').trim();
}

function normalizeInsightKey(v) {
  return String(v || '')
    .trim()
    .toLowerCase();
}

function getOrdersByCustomerCodeExact(codeInput, { includeCancelled = true } = {}) {
  const code = cleanMemberId(codeInput);
  if (!code) return [];

  return (orders || []).filter((o) => {
    const orderCode = cleanMemberId(
      o.memberCard ||
      o.customer?.code ||
      ''
    );

    if (orderCode !== code) return false;

    if (!includeCancelled && String(o.status || '').toUpperCase() === 'CANCELLED') {
      return false;
    }

    return true;
  });
}

function getCustomerOrderCountExact(codeInput) {
  // Số lần order trong profile: tính theo lịch sử order thật của khách.
  // Nếu muốn bỏ CANCELLED thì đổi includeCancelled thành false.
  return getOrdersByCustomerCodeExact(codeInput, { includeCancelled: true }).length;
}

function getOrderCustomerInfo(order = {}) {
  const code = cleanMemberId(
    order?.customer?.code ||
    order?.memberCard ||
    ''
  );

  const m = code ? (members[code] || {}) : {};

  const name =
    meaningfulCustomerName(order?.customer?.name, code) ||
    meaningfulCustomerName(order?.customerName, code) ||
    meaningfulCustomerName(m.name || m.customerName, code) ||
    '';

  const level =
    meaningfulCustomerLevel(order?.customer?.level) ||
    meaningfulCustomerLevel(order?.customerLevel) ||
    meaningfulCustomerLevel(m.level || m.memberLevel) ||
    '';

  return {
    code,
    name,
    level,
  };
}

// ===================================================================
// ================= CUSTOMER SPENDING / MONEY ========================
// ===================================================================

const SPENDING_BUSINESS_HOUR = 6;

function toMoneyNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function getOrderItemSpending(item = {}) {
  const qty = Math.max(1, Number(item.qty || item.quantity || 1));

  const lineTotal = toMoneyNumber(item.lineTotal);
  if (lineTotal > 0) {
    return {
      total: lineTotal,
      pendingPriceItems: 0,
      itemCount: qty,
    };
  }

  const price = toMoneyNumber(item.price);
  const isOffMenu = Boolean(item.isOffMenu);

  if (price > 0) {
    return {
      total: price * qty,
      pendingPriceItems: 0,
      itemCount: qty,
    };
  }

  return {
    total: 0,
    pendingPriceItems: isOffMenu ? 1 : 0,
    itemCount: qty,
  };
}

function getOrderSpending(order = {}) {
  let total = 0;
  let pendingPriceItems = 0;
  let itemCount = 0;

  for (const item of order.items || []) {
    const row = getOrderItemSpending(item);
    total += row.total;
    pendingPriceItems += row.pendingPriceItems;
    itemCount += row.itemCount;
  }

  return {
    total,
    pendingPriceItems,
    itemCount,
  };
}

function getOrderCustomerCode(order = {}) {
  return cleanMemberId(
    order.memberCard ||
    order.customer?.code ||
    ''
  );
}

function isOrderCountedForSpending(order = {}) {
  const status = String(order.status || '').toUpperCase();

  // Không tính order đã huỷ
  if (status === 'CANCELLED') return false;

  return true;
}

function startAtBusinessHour(d) {
  const x = new Date(d);
  x.setHours(SPENDING_BUSINESS_HOUR, 0, 0, 0);
  return x;
}

function endFromStart(start, days = 1) {
  const x = new Date(start);
  x.setDate(x.getDate() + days);
  x.setMilliseconds(-1);
  return x;
}

function shiftedBusinessDate(d = new Date()) {
  const x = new Date(d);
  if (x.getHours() < SPENDING_BUSINESS_HOUR) {
    x.setDate(x.getDate() - 1);
  }
  return x;
}

function localYmd(dInput) {
  const d = new Date(dInput);
  if (Number.isNaN(d.getTime())) return '';

  const pad = (n) => String(n).padStart(2, '0');

  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parseYmdLocal(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s || ''))) return null;

  const [y, m, d] = String(s).split('-').map(Number);
  if (!y || !m || !d) return null;

  return new Date(y, m - 1, d);
}

function buildSpendingRange({ range = 'all', from, to } = {}) {
  const now = new Date();
  const shiftedNow = shiftedBusinessDate(now);

  let fromDate = null;
  let toDate = null;

  switch (String(range || 'all')) {
    case 'today': {
      fromDate = startAtBusinessHour(shiftedNow);
      toDate = endFromStart(fromDate, 1);
      break;
    }

    case 'week': {
      const d = new Date(shiftedNow);
      const day = d.getDay() || 7; // Monday = 1
      d.setDate(d.getDate() - day + 1);
      fromDate = startAtBusinessHour(d);
      toDate = endFromStart(fromDate, 7);
      break;
    }

    case 'month': {
      const d = new Date(shiftedNow.getFullYear(), shiftedNow.getMonth(), 1);
      fromDate = startAtBusinessHour(d);

      const nextMonth = new Date(
        shiftedNow.getFullYear(),
        shiftedNow.getMonth() + 1,
        1,
        SPENDING_BUSINESS_HOUR,
        0,
        0,
        0
      );

      toDate = new Date(nextMonth.getTime() - 1);
      break;
    }

    case 'year': {
      const d = new Date(shiftedNow.getFullYear(), 0, 1);
      fromDate = startAtBusinessHour(d);

      const nextYear = new Date(
        shiftedNow.getFullYear() + 1,
        0,
        1,
        SPENDING_BUSINESS_HOUR,
        0,
        0,
        0
      );

      toDate = new Date(nextYear.getTime() - 1);
      break;
    }

    case 'custom': {
      const f = parseYmdLocal(from);
      const t = parseYmdLocal(to);

      fromDate = f ? startAtBusinessHour(f) : null;
      toDate = t ? endFromStart(startAtBusinessHour(t), 1) : null;
      break;
    }

    case 'all':
    default: {
      fromDate = null;
      toDate = null;
      break;
    }
  }

  return {
    fromDate,
    toDate,
    from: fromDate ? fromDate.toISOString() : null,
    to: toDate ? toDate.toISOString() : null,
  };
}

function orderInSpendingRange(order, fromDate, toDate) {
  const t = Date.parse(order.createdAt);
  if (!Number.isFinite(t)) return false;

  if (fromDate && t < fromDate.getTime()) return false;
  if (toDate && t > toDate.getTime()) return false;

  return true;
}

function buildCustomerSpending(codeInput, opts = {}) {
  const code = cleanMemberId(codeInput);
  const { range = 'all', from, to, limit = 100 } = opts;

  const { fromDate, toDate, from: fromIso, to: toIso } = buildSpendingRange({
    range,
    from,
    to,
  });

  const rows = (orders || [])
    .filter((o) => getOrderCustomerCode(o) === code)
    .filter(isOrderCountedForSpending)
    .filter((o) => orderInSpendingRange(o, fromDate, toDate))
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

  let total = 0;
  let itemCount = 0;
  let pendingPriceItems = 0;

  const byDayMap = new Map();

  const detailOrders = rows.map((o) => {
    const money = getOrderSpending(o);
    total += money.total;
    itemCount += money.itemCount;
    pendingPriceItems += money.pendingPriceItems;

    const dayKey = localYmd(o.createdAt);
    const dayRow = byDayMap.get(dayKey) || {
      date: dayKey,
      total: 0,
      orders: 0,
      items: 0,
      pendingPriceItems: 0,
    };

    dayRow.total += money.total;
    dayRow.orders += 1;
    dayRow.items += money.itemCount;
    dayRow.pendingPriceItems += money.pendingPriceItems;

    byDayMap.set(dayKey, dayRow);

    return {
      id: o.id,
      createdAt: o.createdAt,
      area: o.area,
      tableNo: o.tableNo,
      staff: o.staff,
      status: o.status,
      tableClosed: o.tableClosed,
      total: money.total,
      itemCount: money.itemCount,
      pendingPriceItems: money.pendingPriceItems,
      items: o.items || [],
    };
  });

  const byDay = Array.from(byDayMap.values()).sort((a, b) =>
    String(b.date).localeCompare(String(a.date))
  );

  return {
    code,
    range,
    from: fromIso,
    to: toIso,
    summary: {
      total,
      orders: rows.length,
      items: itemCount,
      avgOrder: rows.length ? Math.round(total / rows.length) : 0,
      pendingPriceItems,
      lastOrderAt: rows[0]?.createdAt || null,
    },
    byDay,
    orders: detailOrders.slice(0, limit),
  };
}
function buildFoodMetaMap() {
  const meta = new Map();

  // Từ foods.json: lấy imageUrl, type, status
  for (const f of foods || []) {
    const imageName = extractImageName(f.imageUrl);
    if (!imageName) continue;

    const prev = meta.get(imageName) || {};
    meta.set(imageName, {
      ...prev,
      imageName,
      imageUrl: f.imageUrl || prev.imageUrl || '',
      type: f.type || prev.type || '',
      status: f.status || prev.status || '',
      quantity: f.quantity ?? prev.quantity ?? null,
    });
  }

  // Từ products.json: lấy tên món, code, nhóm hàng, giá
  const products = loadProductsSafe();

  for (const p of products || []) {
    const imageName =
      normalizeInsightKey(p.imageName) ||
      extractImageName(p.imageUrl);

    if (!imageName) continue;

    const prev = meta.get(imageName) || {};

    meta.set(imageName, {
      ...prev,
      imageName,
      imageUrl: prev.imageUrl || p.imageUrl || '',
      productCode: String(p.productCode || p.code || prev.productCode || '').trim(),
      name: String(p.name || p.productName || prev.name || imageName).trim(),
      itemGroup: String(p.itemGroup || p.group || prev.itemGroup || '').trim(),
      menuType: String(p.menuType || prev.menuType || '').trim(),
      price: Number.isFinite(Number(p.price)) ? Number(p.price) : prev.price ?? null,
    });
  }

  return meta;
}

function getOrderItemKey(item = {}) {
  const isOffMenu = Boolean(item.isOffMenu);

  if (isOffMenu) {
    const name = normalizeInsightText(item.name || 'OFF MENU');
    return `offmenu:${name.toLowerCase()}`;
  }

  const imageName =
    normalizeInsightKey(item.imageName) ||
    normalizeInsightKey(item.imageKey) ||
    extractImageName(item.imageUrl);

  if (imageName) return imageName;

  const name = normalizeInsightText(item.name || item.productName || '');
  if (name) return `unknown:${name.toLowerCase()}`;

  return '';
}

function getOrderItemLabel(key, item = {}, foodMetaMap) {
  if (key.startsWith('offmenu:')) {
    const name = normalizeInsightText(item.name || key.replace(/^offmenu:/, ''));
    return {
      key,
      isOffMenu: true,
      imageName: '',
      imageUrl: '',
      productCode: 'OFF MENU',
      name: name || 'OFF MENU',
      itemGroup: 'OFF MENU',
      type: 'OFF MENU',
      status: '',
      price: Number(item.price || 0) || 0,
    };
  }

  const meta = foodMetaMap.get(key) || {};

  return {
    key,
    isOffMenu: false,
    imageName: key,
    imageUrl: meta.imageUrl || item.imageUrl || '',
    productCode: meta.productCode || item.productCode || item.code || '',
    name: meta.name || item.name || item.productName || key,
    itemGroup: meta.itemGroup || item.group || '',
    type: meta.type || item.type || '',
    status: meta.status || '',
    price: meta.price ?? item.price ?? null,
  };
}

function pushLimited(arr, value, max = 30) {
  if (!value) return;
  arr.push(value);
  if (arr.length > max) arr.splice(0, arr.length - max);
}

function buildCustomerInsightsSnapshot({ from = null, to = null } = {}) {
  const foodMetaMap = buildFoodMetaMap();

  const overallItems = new Map();
  const customers = new Map();

  let validOrderCount = 0;
  let totalQty = 0;
  let totalSpend = 0;
  let pendingPriceItems = 0;
  const recentNotes = [];

  const fromMs = from ? Date.parse(from) : NaN;
  const toMs = to ? Date.parse(to) : NaN;

  const validOrders = (orders || []).filter((o) => {
    // Không tính order đã huỷ vào sở thích
    if (!o || o.status === 'CANCELLED') return false;

    const orderMs = Date.parse(o.createdAt || o.updatedAt || '');
    if (Number.isFinite(fromMs) && (!Number.isFinite(orderMs) || orderMs < fromMs)) return false;
    if (Number.isFinite(toMs) && (!Number.isFinite(orderMs) || orderMs > toMs)) return false;

    return true;
  });

  for (const order of validOrders) {
    const customer = getOrderCustomerInfo(order);
    const customerCode = customer.code || 'UNKNOWN';

    if (!customers.has(customerCode)) {
      const local = customerCode !== 'UNKNOWN' ? (members[customerCode] || {}) : {};
      customers.set(customerCode, {
        code: customerCode,
        name:
          meaningfulCustomerName(customer.name, customerCode) ||
          meaningfulCustomerName(local.name || local.customerName, customerCode) ||
          '',
        level:
          meaningfulCustomerLevel(customer.level) ||
          meaningfulCustomerLevel(local.level || local.memberLevel) ||
          '',
        orderCount: 0,
        totalQty: 0,
        totalSpend: 0,
        pendingPriceItems: 0,
        lastOrderAt: null,
        items: new Map(),
        notes: [],
        orderNotes: [],
      });
    }

    const c = customers.get(customerCode);

    // Nếu bản ghi đầu tiên chỉ có placeholder nhưng order sau có tên/level thật,
    // cập nhật lại thay vì giữ placeholder cho toàn bộ Insights.
    const betterName = meaningfulCustomerName(customer.name, customerCode);
    const betterLevel = meaningfulCustomerLevel(customer.level);
    if (!c.name && betterName) c.name = betterName;
    if (!c.level && betterLevel) c.level = betterLevel;

    c.orderCount += 1;

    // Tính tổng giá trị order cho Insights. Order CANCELLED đã bị loại ở validOrders.
    const spending = getOrderSpending(order);
    c.totalSpend += Number(spending.total || 0);
    c.pendingPriceItems += Number(spending.pendingPriceItems || 0);
    totalSpend += Number(spending.total || 0);
    pendingPriceItems += Number(spending.pendingPriceItems || 0);

    const orderAt = order.createdAt || order.updatedAt || '';
    if (orderAt && (!c.lastOrderAt || new Date(orderAt) > new Date(c.lastOrderAt))) {
      c.lastOrderAt = orderAt;
    }

    if (normalizeInsightText(order.note)) {
      pushLimited(c.orderNotes, {
        orderId: order.id,
        at: orderAt,
        note: normalizeInsightText(order.note),
        area: order.area || '',
        tableNo: order.tableNo || '',
      }, 30);
    }

    validOrderCount += 1;

    for (const item of order.items || []) {
      const key = getOrderItemKey(item);
      if (!key) continue;

      const qty = Math.max(1, Number(item.qty || item.quantity || 1));
      const label = getOrderItemLabel(key, item, foodMetaMap);

      totalQty += qty;
      c.totalQty += qty;

      if (!c.items.has(key)) {
        c.items.set(key, {
          ...label,
          qty: 0,
          orderCount: 0,
          notes: [],
          lastOrderAt: null,
        });
      }

      const ci = c.items.get(key);
      ci.qty += qty;
      ci.orderCount += 1;

      if (orderAt && (!ci.lastOrderAt || new Date(orderAt) > new Date(ci.lastOrderAt))) {
        ci.lastOrderAt = orderAt;
      }

      const itemNote = normalizeInsightText(item.note);
      if (itemNote) {
        const noteRow = {
          orderId: order.id,
          at: orderAt,
          customerCode,
          customerName: c.name,
          itemKey: key,
          itemName: label.name,
          note: itemNote,
          qty,
        };

        pushLimited(ci.notes, noteRow, 30);
        pushLimited(c.notes, noteRow, 50);
        recentNotes.push(noteRow);
      }

      if (!overallItems.has(key)) {
        overallItems.set(key, {
          ...label,
          qty: 0,
          orderCount: 0,
          customers: new Set(),
          notes: [],
          lastOrderAt: null,
        });
      }

      const oi = overallItems.get(key);
      oi.qty += qty;
      oi.orderCount += 1;
      oi.customers.add(customerCode);

      if (orderAt && (!oi.lastOrderAt || new Date(orderAt) > new Date(oi.lastOrderAt))) {
        oi.lastOrderAt = orderAt;
      }

      const itemNote2 = normalizeInsightText(item.note);
      if (itemNote2) {
        pushLimited(oi.notes, {
          orderId: order.id,
          at: orderAt,
          customerCode,
          customerName: c.name,
          itemName: label.name,
          note: itemNote2,
          qty,
        }, 50);
      }
    }
  }

  const topItems = Array.from(overallItems.values())
    .map((it) => ({
      ...it,
      customerCount: it.customers.size,
      customers: undefined,
      score: it.qty * 3 + it.orderCount * 2 + it.customers.size,
      notes: it.notes.slice(-10).reverse(),
    }))
    .sort((a, b) => {
      if (b.qty !== a.qty) return b.qty - a.qty;
      if (b.orderCount !== a.orderCount) return b.orderCount - a.orderCount;
      return b.customerCount - a.customerCount;
    });

  const topCustomers = Array.from(customers.values())
    .map((c) => {
      const favoriteItems = Array.from(c.items.values())
        .sort((a, b) => {
          if (b.qty !== a.qty) return b.qty - a.qty;
          return b.orderCount - a.orderCount;
        })
        .slice(0, 8)
        .map((it) => ({
          ...it,
          notes: it.notes.slice(-5).reverse(),
        }));

      return {
        code: c.code,
        name: c.name,
        level: c.level,
        orderCount: c.orderCount,
        totalQty: c.totalQty,
        totalSpend: c.totalSpend,
        pendingPriceItems: c.pendingPriceItems,
        lastOrderAt: c.lastOrderAt,
        favoriteItems,
        notes: c.notes.slice(-10).reverse(),
        orderNotes: c.orderNotes.slice(-10).reverse(),
      };
    })
    .sort((a, b) => {
      if (b.orderCount !== a.orderCount) return b.orderCount - a.orderCount;
      return b.totalQty - a.totalQty;
    });

  const customerMap = {};
  for (const c of topCustomers) {
    customerMap[c.code] = c;
  }

  return {
    generatedAt: new Date().toISOString(),
    totalOrders: validOrderCount,
    totalQty,
    totalSpend,
    pendingPriceItems,
    totalCustomers: topCustomers.filter((c) => c.code && c.code !== 'UNKNOWN').length,
    totalItems: topItems.length,
    recentNotes: recentNotes
      .slice()
      .sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0))
      .slice(0, 30),
    topItems,
    topCustomers,
    customerMap,
  };
}

function getCustomerInsightsSnapshot({ force = false, from = null, to = null } = {}) {
  const now = Date.now();
  const hasRange = Number.isFinite(Date.parse(from || '')) || Number.isFinite(Date.parse(to || ''));

  // Chỉ dùng cache chung cho chế độ toàn thời gian. Các khoảng ngày được tính riêng
  // để không trả nhầm dữ liệu giữa Today / 7 days / 30 days / This month.
  if (
    !force &&
    !hasRange &&
    customerInsightsCache.data &&
    now - customerInsightsCache.at < CUSTOMER_INSIGHTS_CACHE_MS
  ) {
    return customerInsightsCache.data;
  }

  const data = buildCustomerInsightsSnapshot({ from, to });

  if (!hasRange) {
    customerInsightsCache = {
      at: now,
      data,
    };
  }

  return data;
}

function buildCustomerRecommendations(customer, topItems, limit = 12) {
  if (!customer) return [];

  const orderedKeys = new Set((customer.favoriteItems || []).map((x) => x.key));

  const groupScore = {};
  const typeScore = {};

  for (const it of customer.favoriteItems || []) {
    if (it.itemGroup) groupScore[it.itemGroup] = (groupScore[it.itemGroup] || 0) + it.qty;
    if (it.type) typeScore[it.type] = (typeScore[it.type] || 0) + it.qty;
  }

  return (topItems || [])
    .filter((it) => !orderedKeys.has(it.key))
    .filter((it) => !it.isOffMenu)
    .map((it) => {
      const sameGroupBonus = it.itemGroup ? (groupScore[it.itemGroup] || 0) : 0;
      const sameTypeBonus = it.type ? (typeScore[it.type] || 0) : 0;
      const stockPenalty = it.status === 'Sold Out' ? -1000 : 0;

      return {
        ...it,
        reason: [
          sameGroupBonus > 0 ? `Cùng nhóm khách hay gọi: ${it.itemGroup}` : '',
          sameTypeBonus > 0 ? `Cùng menu khách hay gọi: ${it.type}` : '',
          it.customerCount ? `${it.customerCount} khách từng gọi` : '',
        ].filter(Boolean).join(' • '),
        recommendScore:
          it.score +
          sameGroupBonus * 4 +
          sameTypeBonus * 2 +
          stockPenalty,
      };
    })
    .sort((a, b) => b.recommendScore - a.recommendScore)
    .slice(0, limit);
}

// Admin/Kitchen: xem tổng quan toàn bộ khách
app.get('/api/customer-insights/overview',
  authenticateJWT,
  authorizeRoles('admin', 'kitchen'),
  (req, res) => {
    try {
      const limit = Math.max(1, Math.min(500, Number(req.query.limit || 100)));
      const force = String(req.query.force || '').toLowerCase() === 'true';

      const data = getCustomerInsightsSnapshot({ force });

      res.json({
        generatedAt: data.generatedAt,
        totalOrders: data.totalOrders,
        totalQty: data.totalQty,
        totalCustomers: data.totalCustomers,
        totalItems: data.totalItems,
        topItems: data.topItems.slice(0, limit),
        topCustomers: data.topCustomers.slice(0, limit),
      });
    } catch (e) {
      console.error('GET /api/customer-insights/overview error:', e);
      res.status(500).json({ error: 'Cannot build customer insights' });
    }
  }
);

function toPublicInsightItem(item = {}) {
  const safe = { ...(item || {}) };
  delete safe.price;
  return safe;
}

function toPublicInsightCustomer(customer = {}) {
  return {
    ...customer,
    favoriteItems: (customer.favoriteItems || []).map(toPublicInsightItem),
  };
}

// User: tổng quan Insights giống Admin nhưng không trả field giá.
// Hỗ trợ from/to để frontend lọc Today / 7 days / 30 days / This month / All time.
app.get('/api/user/customer-insights/overview', (req, res) => {
  try {
    // Reload nhanh để số liệu luôn khớp với SQLite sau khi vừa tạo/cập nhật order.
    orders = reloadOrdersSafe('GET /api/user/customer-insights/overview');

    const limit = Math.max(1, Math.min(200, Number(req.query.limit || 100)));
    const force = String(req.query.force || '').toLowerCase() === 'true';
    const from = req.query.from || null;
    const to = req.query.to || null;

    const data = getCustomerInsightsSnapshot({ force, from, to });

    res.set('Cache-Control', 'no-store');
    res.json({
      generatedAt: data.generatedAt,
      from: from || null,
      to: to || null,
      totalOrders: data.totalOrders,
      totalQty: data.totalQty,
      totalSpend: data.totalSpend,
      pendingPriceItems: data.pendingPriceItems,
      totalCustomers: data.totalCustomers,
      totalItems: data.totalItems,
      recentNotes: (data.recentNotes || []).slice(0, 20),
      topItems: data.topItems.slice(0, limit).map(toPublicInsightItem),
      topCustomers: data.topCustomers.slice(0, limit).map(toPublicInsightCustomer),
    });
  } catch (e) {
    console.error('GET /api/user/customer-insights/overview error:', e);
    res.status(500).json({ error: 'Cannot build user customer insights' });
  }
});

// User: tải danh sách đầy đủ cho modal Insights.
// Chỉ trả các field cần hiển thị để response gọn, không trả giá từng món.
app.get('/api/user/customer-insights/list', (req, res) => {
  try {
    orders = reloadOrdersSafe('GET /api/user/customer-insights/list');

    const type = String(req.query.type || 'customers').toLowerCase();
    const from = req.query.from || null;
    const to = req.query.to || null;
    const data = getCustomerInsightsSnapshot({ force: false, from, to });

    res.set('Cache-Control', 'no-store');

    if (type === 'items') {
      const items = (data.topItems || []).map((it) => ({
        key: it.key,
        imageName: it.imageName || '',
        imageUrl: it.imageUrl || '',
        productCode: it.productCode || '',
        name: it.name || '',
        itemGroup: it.itemGroup || '',
        type: it.type || '',
        qty: Number(it.qty || 0),
        orderCount: Number(it.orderCount || 0),
        customerCount: Number(it.customerCount || 0),
        lastOrderAt: it.lastOrderAt || null,
        notes: (it.notes || []).slice(0, 3),
      }));

      return res.json({
        type: 'items',
        generatedAt: data.generatedAt,
        total: items.length,
        items,
      });
    }

    const customers = (data.topCustomers || [])
      .filter((c) => c.code && c.code !== 'UNKNOWN')
      .map((c) => ({
        code: c.code,
        name: c.name || '',
        level: c.level || '',
        orderCount: Number(c.orderCount || 0),
        totalQty: Number(c.totalQty || 0),
        totalSpend: Number(c.totalSpend || 0),
        pendingPriceItems: Number(c.pendingPriceItems || 0),
        lastOrderAt: c.lastOrderAt || null,
        favoriteItems: (c.favoriteItems || []).slice(0, 5).map(toPublicInsightItem),
      }));

    return res.json({
      type: 'customers',
      generatedAt: data.generatedAt,
      total: customers.length,
      customers,
    });
  } catch (e) {
    console.error('GET /api/user/customer-insights/list error:', e);
    res.status(500).json({ error: 'Cannot build customer insights list' });
  }
});

// User/Admin: bảng xếp hạng món được order nhiều
app.get('/api/customer-insights/top-items', (_req, res) => {
  try {
    const limit = Math.max(1, Math.min(300, Number(_req.query.limit || 50)));
    const data = getCustomerInsightsSnapshot();

    res.json({
      generatedAt: data.generatedAt,
      totalOrders: data.totalOrders,
      totalItems: data.totalItems,
      topItems: data.topItems.slice(0, limit),
    });
  } catch (e) {
    console.error('GET /api/customer-insights/top-items error:', e);
    res.status(500).json({ error: 'Cannot build top items' });
  }
});

// User/Admin: xem sở thích + gợi ý theo 1 mã khách
app.get('/api/customer-insights/customer/:code', (req, res) => {
  try {
    const code = cleanMemberId(req.params.code || '');
    if (!code) return res.status(400).json({ error: 'Thiếu mã khách' });

    const data = getCustomerInsightsSnapshot();
    const customer = data.customerMap[code];

    if (!customer) {
      const identity = getBestKnownCustomerIdentity(code);
      return res.json({
        found: false,
        code,
        name: identity.name || '',
        level: identity.level || '',
        favoriteItems: [],
        notes: [],
        orderNotes: [],
        recommendations: data.topItems.slice(0, 10),
      });
    }

    const recommendations = buildCustomerRecommendations(customer, data.topItems, 12);

    res.json({
      found: true,
      ...customer,
      recommendations,
    });
  } catch (e) {
    console.error('GET /api/customer-insights/customer/:code error:', e);
    res.status(500).json({ error: 'Cannot build customer insight' });
  }
});

// ====== MEMBERS CRUD API ======
function memberToRow(code, m) {
  return {
    id: code,              // FE có thể dùng trực tiếp làm key
    code,
    name: m.name || m.customerName || '',
    level: m.level || m.memberLevel || null,
    lastSeenAt: m.lastSeenAt || null,
    ordersCount: m.ordersCount || 0,
    createdAt: m.createdAt || null,
    updatedAt: m.updatedAt || null,
    apiSyncedAt: m.apiSyncedAt || null,
    lastApiAttemptAt: m.lastApiAttemptAt || null,
    lastApiSuccessAt: m.lastApiSuccessAt || m.apiSyncedAt || null,
    syncStatus: m.syncStatus || (m.apiSyncedAt ? 'SUCCESS' : 'LOCAL_ONLY'),
    syncError: m.syncError || null,
    dataSource: m.dataSource || (m.apiSyncedAt ? 'CUSTOMER_API' : 'DATABASE'),
  };
}
function pushMemberHistory(code, entry) {
  const now = new Date().toISOString();
  const rec = members[code] || {};
  const h = Array.isArray(rec.history) ? rec.history : [];
  h.push({ at: now, ...entry });
  rec.history = h;
  rec.updatedAt = now;
  members[code] = rec;
  // không gọi saveMembers() ở đây; để hàm gọi tự lưu
}
const MemberApi = {
list(req, res) {
    try {
      const { q, limit = 100, page = 1 } = req.query || {};
      let arr = Object.keys(members).map(code => memberToRow(code, members[code]));
      if (q) {
        const qn = (q || '').toLowerCase();
        arr = arr.filter(r =>
          (r.code || '').toLowerCase().includes(qn) ||
          (r.name || '').toLowerCase().includes(qn)
        );
      }
      arr.sort((a,b) => a.code.localeCompare(b.code));
      // phân trang: tính start và end index
      const lim  = Math.max(1, Number(limit));   // số bản ghi mỗi trang
      const pg   = Math.max(1, Number(page));    // số trang
      const start = (pg - 1) * lim;
      const end   = start + lim;
      const sliced = arr.slice(start, end);
      return res.json({
        total: arr.length,
        page: pg,
        limit: lim,
        items: sliced,
      });
    } catch (err) {
      console.error('list members error:', err);
      return res.status(500).json({ error: 'Cannot list members' });
    }
  },
  get(req, res) {
    const code = String(req.params.code || '').trim();
    const m = members[code];
    if (!m) return res.status(404).json({ error: 'Not found' });
    res.json({ code, ...m, row: memberToRow(code, m) });
  },
  create(req, res) {
    const body = req.body || {};
    const code = String(body.code || '').trim();
    const name = String(body.name || body.customerName || '').trim();
    const level = body.level ? String(body.level).trim() : null;

if (!code) return res.status(400).json({ error: 'Thiếu mã khách hàng (code)' });
if (!name) return res.status(400).json({ error: 'Thiếu tên khách hàng (name)' });
const now = new Date().toISOString();
// Nếu mã đã tồn tại → cập nhật tên và level
if (members[code]) {
  const prev = members[code];
  members[code] = {
    ...prev,
    code,
    name,
    customerName: name,
    level,
    dataSource: 'MANUAL_IMPORT',
    syncStatus: prev.syncStatus || 'LOCAL_ONLY',
    updatedAt: now,
  };
  // Ghi lịch sử import update
  pushMemberHistory(code, {
    type: 'IMPORT_UPDATE',
    by: req.user?.sub || 'admin',
    data: { name, level },
    detail: `Import update: name → '${name}', level → '${level || ''}'`
  });
  persistMember(code);
  req.app.locals.io.emit('memberUpdated', { code, member: members[code] });
  return res.status(201).json({ ok: true, updated: true, member: memberToRow(code, members[code]) });
}

// Nếu chưa tồn tại → tạo mới như trước
members[code] = {
  code,
  name,
  customerName: name,
  level,
  ordersCount: 0,
  createdAt: now,
  updatedAt: now,
  lastSeenAt: null,
  syncStatus: 'LOCAL_ONLY',
  syncError: null,
  dataSource: 'MANUAL',
  history: [{ at: now, type: 'CREATE', by: req.user?.sub || 'admin', data: { name, level } }],
};
persistMember(code);
req.app.locals.io.emit('memberCreated', { code, member: members[code] });
return res.status(201).json({ ok: true, member: memberToRow(code, members[code]) });
  },
update(req, res) {
  try {
    // Lấy mã khách cũ và bản ghi hiện tại
    const oldCode = String(req.params.code || '').trim();
    const cur = members[oldCode];
    if (!cur) return res.status(404).json({ error: 'Not found' });

    // Lấy dữ liệu gửi lên – nếu không gửi thì giữ nguyên giá trị cũ
    const body   = req.body || {};
    const newCode = (body.newCode != null ? String(body.newCode).trim() : oldCode);
    const name   = (body.name   != null ? String(body.name).trim()   : cur.name || cur.customerName || '');
    const level  = (body.level  != null ? String(body.level).trim()  : (cur.level || null));

    // Kiểm tra hợp lệ mã mới
    if (!newCode) return res.status(400).json({ error: 'newCode không hợp lệ' });
    if (newCode !== oldCode && members[newCode]) return res.status(409).json({ error: 'Mã mới đã tồn tại' });

    // Tạo bản ghi cập nhật
    const now     = new Date().toISOString();
    const updated = {
      ...cur,
      code: newCode,
      name,
      customerName: name || cur.customerName || cur.name || null,
      level,
      dataSource: 'MANUAL',
      syncStatus: cur.syncStatus || 'LOCAL_ONLY',
      updatedAt: now,
    };

    // Nếu thay đổi mã, xoá key cũ và gán vào key mới
    if (newCode !== oldCode) {
      delete members[oldCode];
      deletePersistedMember(oldCode);
      members[newCode] = updated;
    } else {
      members[oldCode] = updated;
    }

// Tạo biến changes để lưu chi tiết các trường thay đổi
const changes = {};
if (name !== cur.name) changes.name = { from: cur.name, to: name };
if (level !== cur.level) changes.level = { from: cur.level, to: level };
if (newCode !== oldCode) changes.code = { from: oldCode, to: newCode };

// Tạo mô tả dễ đọc
const detail = Object.entries(changes)
  .map(([key, value]) => `${key}: '${value.from}' → '${value.to}'`)
  .join('; ');

// Gọi history với detail
pushMemberHistory(newCode, {
  type: 'UPDATE',
  by: req.user?.sub || 'admin',
  data: changes,
  detail,
});

    // Lưu đúng 1 member vào SQLite sau khi history đã được thêm
    persistMember(newCode);


    // Phát sự kiện realtime và trả về JSON
    req.app.locals.io.emit('memberUpdated', { code: newCode, member: members[newCode] });
    res.json({ ok: true, member: memberToRow(newCode, members[newCode]) });

  } catch (err) {
    console.error('Update member error:', err);
    // Nếu có lỗi, trả về HTTP 500 với thông báo rõ ràng
    res.status(500).json({ error: 'Cập nhật khách hàng thất bại' });
  }
},
  remove(req, res) {
    const code = String(req.params.code || '').trim();
    if (!members[code]) return res.status(404).json({ error: 'Not found' });
    const backup = members[code];
    delete members[code];
    deletePersistedMember(code);
    req.app.locals.io.emit('memberDeleted', { code });
    res.json({ ok: true, removed: memberToRow(code, backup) });
  },
  history(req, res) {
    const code = String(req.params.code || '').trim();
    const m = members[code];
    if (!m) return res.status(404).json({ error: 'Not found' });
    const h = Array.isArray(m.history) ? m.history.slice().sort((a,b)=>new Date(b.at)-new Date(a.at)) : [];
    res.json(h);
  }
};

// Mount cho /api/members (Admin)
app.get   ('/api/members',               authenticateJWT, authorizeRoles('admin'), MemberApi.list);
app.get   ('/api/members/:code',         authenticateJWT, authorizeRoles('admin'), MemberApi.get);
app.post  ('/api/members',               authenticateJWT, authorizeRoles('admin'), MemberApi.create);
app.put   ('/api/members/:code',         authenticateJWT, authorizeRoles('admin'), MemberApi.update);
app.delete('/api/members/:code',         authenticateJWT, authorizeRoles('admin'), MemberApi.remove);
app.get   ('/api/members/:code/history', authenticateJWT, authorizeRoles('admin'), MemberApi.history);

// Alias tương thích FE cũ: /api/customers (trỏ sang cùng handler)
app.get   ('/api/customers',               authenticateJWT, authorizeRoles('admin'), MemberApi.list);
app.get   ('/api/customers/:code',         authenticateJWT, authorizeRoles('admin'), MemberApi.get);
app.post  ('/api/customers',               authenticateJWT, authorizeRoles('admin'), MemberApi.create);
app.put   ('/api/customers/:code',         authenticateJWT, authorizeRoles('admin'), MemberApi.update);
app.delete('/api/customers/:code',         authenticateJWT, authorizeRoles('admin'), MemberApi.remove);
app.get   ('/api/customers/:code/history', authenticateJWT, authorizeRoles('admin'), MemberApi.history);
// Phục hồi tên/level khách từ dữ liệu app khi Customer API không trả record.
// Chỉ dùng dữ liệu hợp lệ trong members + lịch sử order; không dùng placeholder UI.
function recoverMemberFromKnownHistory(codeInput, actor = 'admin-check-fallback') {
  const code = cleanMemberId(codeInput);
  if (!code) {
    return { ok: false, changed: false, source: 'not-found', member: null };
  }

  const best = getBestKnownCustomerIdentity(code);
  const bestName = meaningfulCustomerName(best.name, code);
  const bestLevel = meaningfulCustomerLevel(best.level);

  if (!best.exists || (!bestName && !bestLevel)) {
    return {
      ok: false,
      changed: false,
      source: 'not-found',
      member: localMemberRow(code),
    };
  }

  const prev = members[code] || {};
  const prevName = meaningfulCustomerName(prev.name || prev.customerName, code);
  const prevLevel = meaningfulCustomerLevel(prev.level || prev.memberLevel || prev.tier);
  const nextName = bestName || prevName || null;
  const nextLevel = bestLevel || prevLevel || null;
  const nextLastSeenAt = best.lastSeenAt || prev.lastSeenAt || null;
  const nextOrdersCount = Math.max(
    Number(prev.ordersCount || 0) || 0,
    Number(best.ordersCount || 0) || 0
  );

  const changed =
    nextName !== (prevName || null) ||
    nextLevel !== (prevLevel || null) ||
    nextLastSeenAt !== (prev.lastSeenAt || null) ||
    nextOrdersCount !== (Number(prev.ordersCount || 0) || 0);

  const nowIso = new Date().toISOString();

  members[code] = {
    ...prev,
    code,
    name: nextName,
    customerName: nextName,
    level: nextLevel,
    memberLevel: nextLevel,
    lastSeenAt: nextLastSeenAt,
    ordersCount: nextOrdersCount,
    syncStatus: prev.syncStatus || 'LOCAL_ONLY',
    syncError: prev.syncError || null,
    dataSource: prev.apiSyncedAt ? (prev.dataSource || 'CUSTOMER_API') : 'ORDER_HISTORY',
    createdAt: prev.createdAt || nowIso,
    updatedAt: changed ? nowIso : (prev.updatedAt || nowIso),
  };

  if (changed) {
    pushMemberHistory(code, {
      type: 'ORDER_HISTORY_RECOVERY',
      by: actor,
      data: {
        name: { from: prevName || null, to: nextName },
        level: { from: prevLevel || null, to: nextLevel },
      },
      detail: `Recovered from order history: name='${nextName || ''}', level='${nextLevel || ''}'`,
    });
  }

  persistMember(code);
  clearCustomerInsightsCache();

  const member = {
    ...localMemberRow(code),
    ordersCount: nextOrdersCount,
    lastSeenAt: nextLastSeenAt,
  };

  if (changed) {
    io.emit('customersUpdated', { count: 1, code, source: 'order-history-fallback' });
    io.emit('memberUpdated', {
      code,
      member: members[code],
      source: 'order-history-fallback',
      changed: true,
    });
  }

  return {
    ok: Boolean(nextName || nextLevel),
    changed,
    source: 'order-history-fallback',
    member,
  };
}

// Xem trạng thái API khách hàng — dùng để hiển thị trong Admin
app.get('/api/customer-api/status', (_req, res) => {
  res.json({
    ...customerApiHealth,
    architecture: 'DATABASE_FIRST_PRIORITY_QUEUE',
    appReadsFrom: 'SQLITE',
    apiWritesTo: 'SQLITE',
    memberTtlMs: CUSTOMER_MEMBER_TTL_MS,
    retryBackoffMs: CUSTOMER_API_RETRY_BACKOFF_MS,
    autoSyncIntervalMs: CUSTOMER_AUTO_SYNC_INTERVAL_MS,
    autoSyncEnqueueSize: CUSTOMER_AUTO_SYNC_ENQUEUE_SIZE,
    autoSyncRecentDays: CUSTOMER_AUTO_SYNC_RECENT_DAYS,
    syncConcurrency: CUSTOMER_SYNC_CONCURRENCY,
    syncMaxPerRun: CUSTOMER_SYNC_MAX_PER_RUN,
    syncQueueMax: CUSTOMER_SYNC_QUEUE_MAX,
    cacheSize: customerApiCache.size,
    inflight: customerApiInflight.size,
    queued: customerSyncQueue.size,
    processing: customerSyncProcessing.size,
    scheduled: customerSyncScheduled.size,
    workerRunning: customerSyncWorkerRunning,
    workerLastRunAt: customerSyncLastRunAt,
    workerLastFinishedAt: customerSyncLastFinishedAt,
    workerLastResult: customerSyncLastResult,
  });
});

// Check thủ công: đồng bộ Customer API -> Database cho đúng 1 mã khách.
// Frontend sau đó đọc lại dữ liệu từ Database, không dùng trực tiếp response API làm nguồn hiển thị.
app.post('/api/customer-api/check',
  authenticateJWT,
  authorizeRoles('admin'),
  async (req, res) => {
    try {
      const id = cleanMemberId(req.body?.id || req.body?.code || req.query?.id || '');
      if (!id) return res.status(400).json({ error: 'Thiếu id khách hàng' });

      // Đảm bảo Database có fallback hợp lệ trước khi thử API.
      recoverMemberFromKnownHistory(
        id,
        req.user?.username || req.user?.sub || 'admin-check-db-recovery'
      );

      const result = await syncCustomerDatabaseFromApi(id, {
        force: true,
        by: req.user?.username || req.user?.sub || 'admin-check',
        timeoutMs: CUSTOMER_API_TIMEOUT_MS,
        emit: true,
      });

      const dbMember = localMemberRow(id);

      return res.json({
        ok: result.apiOk,
        apiOk: result.apiOk,
        databaseOk: Boolean(dbMember),
        fallbackOk: Boolean(dbMember),
        changed: result.changed,
        status: result.status,
        source: 'database',
        member: dbMember,
        apiStatus: customerApiHealth,
      });
    } catch (error) {
      const id = cleanMemberId(req.body?.id || req.body?.code || req.query?.id || '');
      return res.status(500).json({
        error: error?.message || String(error),
        source: 'database',
        member: localMemberRow(id),
        apiStatus: customerApiHealth,
      });
    }
  }
);

// Sync Database từ Customer API theo batch nhỏ, không làm User phải chờ.
app.post('/api/customers/sync-from-api',
  authenticateJWT,
  authorizeRoles('admin'),
  async (req, res) => {
    try {
      const body = req.body || {};
      const scope = String(body.scope || 'recent').toLowerCase() === 'all' ? 'all' : 'recent';
      const batchSize = Math.max(1, Math.min(5000, Number(body.batchSize || 500)));
      const force = body.force === true;
      const cursor = Math.max(0, Number(body.cursor || 0));

      const allCodes = scope === 'all'
        ? Object.keys(members || {})
            .map(cleanMemberId)
            .filter((code) => code && /^\d+$/.test(code))
            .sort((a, b) => Number(a) - Number(b))
        : getRecentCustomerCodesForAutoSync();

      let nextCursor = Math.min(cursor, allCodes.length);
      let requested = 0;
      let queued = 0;
      let skippedFresh = 0;
      let skippedScheduled = 0;

      while (nextCursor < allCodes.length && requested < batchSize) {
        const code = allCodes[nextCursor];
        nextCursor += 1;
        requested += 1;

        if (!force && isMemberApiFresh(code)) {
          skippedFresh += 1;
          continue;
        }

        const alreadyScheduled =
          customerSyncQueue.has(code) ||
          customerSyncProcessing.has(code) ||
          customerApiInflight.has(code);

        const accepted = queueCustomerDatabaseSync(code, {
          force,
          priority: scope === 'all' ? 80 : 120,
          by: scope === 'all'
            ? 'admin-full-sync-queue'
            : 'admin-recent-sync-queue',
          emit: false,
        });

        if (accepted) queued += 1;
        else if (alreadyScheduled) skippedScheduled += 1;
      }

      scheduleCustomerSyncWorker(0);

      res.json({
        mode: 'PRIORITY_QUEUE',
        scope,
        total: allCodes.length,
        cursor,
        nextCursor,
        batchSize,
        requested,
        queued,
        skippedFresh,
        skippedScheduled,
        queueSize: customerSyncQueue.size,
        processing: customerSyncProcessing.size,
        concurrency: CUSTOMER_SYNC_CONCURRENCY,
        done: nextCursor >= allCodes.length,
      });
    } catch (error) {
      res.status(500).json({ error: error?.message || String(error) });
    }
  }
);

// --- Upload ảnh (Admin) ---
app.post('/api/upload', authenticateJWT, authorizeRoles('admin'), multerUpload.single('image'), (req, res) => {
  const tmpPath = req.file?.path;
  try {
    if (!req.file) return res.status(400).json({ message: 'Không có ảnh được gửi' });
        let type = String(req.body.type || '').trim();
    try { assertSafeMenuName(type); } catch {
      return res.status(400).json({ message: 'Thiếu hoặc type không hợp lệ' });
    }
    if (!type) return res.status(400).json({ message: 'Thiếu type' });

    const folderName = type.toUpperCase();
    const destDir = path.join(IMAGES_DIR, folderName);
    ensureDir(destDir);

    const buf = fs.readFileSync(req.file.path);
    const hash = crypto.createHash('md5').update(buf).digest('hex');

    const origName = req.file.originalname;
    const ext = path.extname(origName);
    const base = path.basename(origName, ext);
    let finalName = origName;
    let finalPath = path.join(destDir, finalName);
    if (fs.existsSync(finalPath)) {
      finalName = `${base}-${Date.now()}${ext}`;
      finalPath = path.join(destDir, finalName);
    }
    fs.renameSync(req.file.path, finalPath);

    // ★ copy vào MASTER để giữ bản gốc
    const lower = finalName.toLowerCase();
    const masterPath = path.join(MASTER_DIR, lower);
    if (!fs.existsSync(masterPath)) {
      try { fs.copyFileSync(finalPath, masterPath); } catch (_) {}
    }

    const host = req.get('host');
    const protocol = (req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0];
    const imageUrl = `${protocol}://${host}/images/${folderName}/${finalName}`;

    res.json({ imageUrl, hash });
  } catch (e) {
    if (tmpPath && fs.existsSync(tmpPath)) { try { fs.unlinkSync(tmpPath); } catch {} }
    console.error('Upload error:', e);
    res.status(500).json({ error: 'Upload thất bại' });
  }
});
// --- Đổi ảnh cho món + đồng bộ lại tên file ảnh trong products/foods ---
app.post(
  '/api/upload/replace',
  authenticateJWT,
  authorizeRoles('admin'),
  multerUpload.single('image'),
  (req, res) => {
    const tmpPath = req.file?.path;
    try {
      if (!req.file) {
        return res.status(400).json({ message: 'Không có ảnh được gửi' });
      }

      const rawOldName = String(req.body.imageName || '').trim();
      if (!rawOldName) {
        return res.status(400).json({ message: 'Thiếu imageName' });
      }

      const oldImageName = path.basename(rawOldName);
      if (/[\/\\]/.test(oldImageName) || oldImageName.includes('..')) {
        return res.status(400).json({ message: 'imageName không hợp lệ' });
      }

      const uploadedNameRaw = path.basename(String(req.file.originalname || oldImageName).trim());
      const uploadedNameOk = uploadedNameRaw && !/[\/\\]/.test(uploadedNameRaw) && !uploadedNameRaw.includes('..');
      const newImageName = uploadedNameOk ? uploadedNameRaw : oldImageName;

      if (!/\.(jpg|jpeg|png|webp)$/i.test(newImageName)) {
        return res.status(400).json({ message: 'Tên ảnh mới phải là JPG/JPEG/PNG/WEBP' });
      }

      const oldLower = oldImageName.toLowerCase();
      const newLower = newImageName.toLowerCase();
      const buf = fs.readFileSync(tmpPath);
      const hash = crypto.createHash('md5').update(buf).digest('hex');
      const nowTs = Date.now();

      const host = req.get('host');
      const protocol = (req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0];

      // Các menu đang dùng ảnh cũ trước khi đổi tên
      const menus = Array.from(
        new Set(
          foods
            .filter(f => extractImageName(f.imageUrl) === oldLower)
            .map(f => f.type)
            .filter(Boolean)
        )
      );

      // 1) Ghi ảnh mới vào MASTER theo tên file mới
      ensureDir(MASTER_DIR);
      const masterPath = path.join(MASTER_DIR, newImageName);
      fs.writeFileSync(masterPath, buf);

      // 2) Ghi ảnh mới vào SOURCE theo tên file mới
      const sourceDir = path.join(IMAGES_DIR, 'SOURCE');
      ensureDir(sourceDir);
      const sourcePath = path.join(sourceDir, newImageName);
      fs.writeFileSync(sourcePath, buf);

      // 3) Ghi ảnh mới vào tất cả menu đang dùng ảnh cũ, rồi xóa file cũ nếu đổi tên
      for (const menu of menus) {
        const dir = path.join(IMAGES_DIR, menu);
        ensureDir(dir);
        const dest = path.join(dir, newImageName);
        fs.writeFileSync(dest, buf);

        if (oldLower !== newLower) {
          const oldPath = findCaseInsensitiveFile(dir, oldLower);
          if (oldPath && oldPath !== dest) {
            try { fs.unlinkSync(oldPath); } catch (_) {}
          }
        }
      }

      if (oldLower !== newLower) {
        const oldMaster = findCaseInsensitiveFile(MASTER_DIR, oldLower);
        if (oldMaster && oldMaster !== masterPath) {
          try { fs.unlinkSync(oldMaster); } catch (_) {}
        }
        const oldSource = findCaseInsensitiveFile(sourceDir, oldLower);
        if (oldSource && oldSource !== sourcePath) {
          try { fs.unlinkSync(oldSource); } catch (_) {}
        }
      }

      // 4) Đồng bộ foods.json: imageUrl không còn giữ tên ảnh cũ có timestamp
      let foodsChanged = false;
      foods.forEach((f) => {
        if (extractImageName(f.imageUrl) === oldLower) {
          f.imageUrl = `${protocol}://${host}/images/${f.type}/${newImageName}`;
          f.hash = hash;
          foodsChanged = true;
        }
      });
      if (foodsChanged) saveFoods();

      // 5) Đồng bộ products.json: imageName/imageUrl/id không còn giữ tên ảnh cũ có timestamp
      const { doc, mode } = readProductsDoc();
      const arr = mode === 'rows' ? (doc.rows = doc.rows || []) : doc;
      let productsChanged = false;

      for (let i = 0; i < arr.length; i++) {
        const p = arr[i] || {};
        const pImage =
          (p.imageName && String(p.imageName).toLowerCase()) ||
          (p.imageUrl && extractImageName(p.imageUrl)) ||
          '';
        const pId = String(p.id || '').toLowerCase();

        if (pImage === oldLower || pId === oldLower) {
          arr[i] = {
            ...p,
            id: pId === oldLower ? newImageName : p.id,
            imageName: newImageName,
            imageUrl: `${protocol}://${host}/images/SOURCE/${newImageName}`,
            updatedAt: nowTs,
          };
          productsChanged = true;
        }
      }

      if (productsChanged) writeProductsDoc(doc, mode);

      io.emit('foodImageReplaced', {
        oldImageName,
        newImageName,
        hash,
        menus,
      });
      io.emit('foodRenamed', {
        imageName: oldLower,
        newImageName,
        count: menus.length,
      });

      res.json({
        ok: true,
        hash,
        oldImageName,
        newImageName,
        renamed: oldLower !== newLower,
        menusUpdated: menus.length,
        productsUpdated: productsChanged,
        foodsUpdated: foodsChanged,
      });
    } catch (e) {
      console.error('Upload replace error:', e);
      res.status(500).json({ error: 'Đổi ảnh thất bại' });
    } finally {
      if (tmpPath && fs.existsSync(tmpPath)) {
        try { fs.unlinkSync(tmpPath); } catch {}
      }
    }
  }
);

// --- Thêm món (Admin) ---
app.post('/api/foods', authenticateJWT, authorizeRoles('admin'), (req, res) => {
  try {
    const { imageUrl, type, hash, levelAccess } = req.body;
    if (!imageUrl || !type || !hash) return res.status(400).json({ message: 'Thiếu trường' });

    if (foods.find(f => f.type === type && f.hash === hash))
      return res.status(409).json({ message: 'Đã tồn tại (hash trùng)' });
    if (foods.find(f => f.type === type && f.imageUrl === imageUrl))
      return res.status(409).json({ message: 'Đã tồn tại (URL trùng)' });

    
const VALID = new Set(['P', 'I-I+', 'V-One']);

// Ưu tiên levelAccess do FE gửi — nếu không có thì dùng level của menu (nếu đã cấu hình), còn lại để RỖNG.
let effective;
if (Array.isArray(levelAccess)) {
  const cleaned = [...new Set(levelAccess.filter(lv => VALID.has(lv)))];
  if (cleaned.length > 0) effective = cleaned;
}
if (!effective || effective.length === 0) {
  const saved = menuLevels[String(type).trim()];
  if (Array.isArray(saved) && saved.length > 0) {
    effective = [...new Set(saved.filter(lv => VALID.has(lv)))];
  }
}
// KHÔNG fallback mặc định — để mảng rỗng nếu chưa cấu hình
if (!effective) effective = [];


    const imageName = extractImageName(imageUrl);
    const existed = foods.find(f => extractImageName(f.imageUrl) === imageName);
    const baseQty = typeof existed?.quantity === 'number' ? existed.quantity : 1;
    const baseStatus = baseQty <= 0 ? 'Sold Out' : 'Available';

    const maxOrder = foods.reduce((m, f) => (typeof f.order === 'number' && f.order > m ? f.order : m), -1);
    const newFood = {
      id: nextNumericId(),
      imageUrl,
      type: type.trim(),
      status: baseStatus,
      hash,
      levelAccess: effective,
      order: maxOrder + 1,
      quantity: baseQty,
    };
    foods.push(newFood);
    saveFoods();
    io.emit('foodAdded', newFood);
    res.status(201).json({ success: true, food: newFood });
  } catch (e) {
    console.error('Add food error:', e);
    res.status(500).json({ error: 'Không thêm được món' });
  }
});

// --- Cập nhật trạng thái (Admin + Kitchen) ---
app.post('/api/update-status/:id', authenticateJWT, authorizeRoles('admin', 'kitchen'), (req, res) => {
  try {
    const foodId = Number(req.params.id);
    const { newStatus } = req.body;
    const target = foods.find(f => f.id === foodId);
    if (!target) return res.status(404).json({ message: 'Not found' });
    if (!['Available', 'Sold Out'].includes(newStatus)) return res.status(400).json({ message: 'Trạng thái không hợp lệ' });

    const prevStatus = target.status;
    const imageName = extractImageName(target.imageUrl);

    let newQty = newStatus === 'Sold Out' ? 0 : (target.quantity > 0 ? target.quantity : 10);

    const updatedFoods = [];
    foods.forEach((f) => {
      if (extractImageName(f.imageUrl) === imageName) {
        f.status = newStatus;
        f.quantity = newQty;
        updatedFoods.push(f);
      }
    });

    saveFoods();

    if (prevStatus !== newStatus) {
      addStatusHistory({
        at: new Date().toISOString(),
        by: req.user?.sub || 'unknown',
        role: req.user?.role || 'unknown',
        imageName,
        imageUrl: target.imageUrl,
        type: target.type,
        from: prevStatus,
        to: newStatus,
        count: updatedFoods.length,
        affectedIds: updatedFoods.map(f => f.id),
      });
    }

    io.emit('foodStatusUpdated', { updatedFoods });
    io.emit('foodQuantityUpdated', { imageName, quantity: newQty });

    res.json({ success: true, quantity: newQty });
  } catch (e) {
    console.error('Update status error:', e);
    res.status(500).json({ error: 'Cập nhật trạng thái thất bại' });
  }
});

// --- Cập nhật SỐ LƯỢNG (Admin + Kitchen) ---
app.post('/api/update-quantity/:id', authenticateJWT, authorizeRoles('admin', 'kitchen'), (req, res) => {
  try {
    const foodId = Number(req.params.id);
    const { op, value } = req.body || {};
    const target = foods.find(f => f.id === foodId);
    if (!target) return res.status(404).json({ message: 'Not found' });

    const imageName = extractImageName(target.imageUrl);
    let currentQty = typeof target.quantity === 'number' ? target.quantity : (target.status === 'Sold Out' ? 0 : 1);

    let newQty;
    if (op === 'inc') {
      const delta = Number(value || 0);
      newQty = Math.max(0, currentQty + delta);
    } else if (op === 'set') {
      newQty = Math.max(0, Number(value || 0));
    } else {
      return res.status(400).json({ error: 'Invalid op. Use "inc" or "set".' });
    }

    const prevStatus = target.status;
    const newStatus = newQty <= 0 ? 'Sold Out' : 'Available';

    const updatedFoods = [];
    foods.forEach((f) => {
      if (extractImageName(f.imageUrl) === imageName) {
        f.quantity = newQty;
        f.status = newStatus;
        updatedFoods.push(f);
      }
    });

    saveFoods();

    if (prevStatus !== newStatus) {
      addStatusHistory({
        at: new Date().toISOString(),
        by: req.user?.sub || 'unknown',
        role: req.user?.role || 'unknown',
        imageName,
        imageUrl: target.imageUrl,
        type: target.type,
        from: prevStatus,
        to: newStatus,
        count: updatedFoods.length,
        affectedIds: updatedFoods.map(f => f.id),
      });
      io.emit('foodStatusUpdated', { updatedFoods });
    }

    io.emit('foodQuantityUpdated', { imageName, quantity: newQty });
    res.json({ success: true, quantity: newQty, status: newStatus });
  } catch (e) {
    console.error('Update quantity error:', e);
    res.status(500).json({ error: 'Cập nhật số lượng thất bại' });
  }
});

// --- Tạo order (public) + trừ tồn kho ---
app.post('/api/orders',orderLimiter, async (req, res) => {
  try {
const {
  clientRequestId,
  area,
  tableNo,
  staff,
  memberCard,
  customerName,
  customer,
  note,
  items,
  consumeStock = true
} = req.body || {};

    if (!area || !tableNo) return res.status(400).json({ error: 'Thiếu khu vực/bàn' });
    if (!staff || !memberCard) return res.status(400).json({ error: 'Thiếu thông tin bắt buộc (staff/memberCard)' });
    if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'Giỏ trống' });
const cleanClientRequestId = String(clientRequestId || '').trim();

if (cleanClientRequestId) {
  const existingOrder = orders.find(
    o => String(o.clientRequestId || '') === cleanClientRequestId
  );

  if (existingOrder) {
    return res.json({
      ok: true,
      duplicate: true,
      orderId: existingOrder.id,
      order: existingOrder,
    });
  }
}
    const productsForOrder = loadProductsSafe();
    const productByImageName = new Map();
    for (const p of productsForOrder) {
      const key =
        (p.imageName && String(p.imageName).toLowerCase()) ||
        (p.imageUrl && extractImageName(p.imageUrl)) ||
        '';
      if (key && !productByImageName.has(key)) productByImageName.set(key, p);
    }

    const grouped = new Map();
    const orderItems = [];
for (const it of items) {
  const qty = Math.max(0, Number(it.qty || it.quantity || 0));
  const noteItem = (typeof it.note === 'string') ? it.note.trim() : '';

  if (qty <= 0) continue;

  // Món ngoài menu: không check tồn kho, không cần imageName
  if (it.isOffMenu) {
    const offMenuName = String(it.name || '').trim();
    if (!offMenuName) continue;

orderItems.push({
  isOffMenu: true,
  imageKey: '',
  imageName: '',
  name: offMenuName,
  qty,
  note: noteItem,
  productCode: 'H100',
  code: 'H100',
  group: 'OFF MENU',
  itemGroup: 'OFF MENU',
  price: Number(it.price || 0) || 0,
});

    continue;
  }

  const imageName =
    (it.imageName && String(it.imageName).toLowerCase()) ||
    (it.imageKey && String(it.imageKey).toLowerCase()) ||
    extractImageName(foods.find(f => f.id === it.foodId)?.imageUrl);

  if (!imageName) continue;

  const product = productByImageName.get(imageName) || {};
  const refFood = getRefFoodByImageName(imageName) || {};
  const productName = String(product.name || product.productName || it.name || refFood.name || '').trim();
  const productCode = String(product.productCode || product.code || it.productCode || it.code || '').trim();
  const itemGroup = String(product.itemGroup || product.group || it.group || '').trim();
  const price = Number(product.price ?? it.price ?? 0) || 0;

  orderItems.push({
    isOffMenu: false,
    imageKey: imageName,
    imageName,
    name: productName || cleanDishNameFromImageName(imageName),
    qty,
    price,
    group: itemGroup,
    note: noteItem,
    productCode,
  });

  // Chỉ món trong menu mới check tồn kho
  grouped.set(imageName, (grouped.get(imageName) || 0) + qty);
}
    if (orderItems.length === 0) return res.status(400).json({ error: 'Không có món hợp lệ' });

    const missing = [];
    for (const [imageName, need] of grouped.entries()) {
      const ref = getRefFoodByImageName(imageName);
      const avail = Math.max(0, Number(ref?.quantity ?? 0));
      if (need > avail) missing.push({ imageName, need, available: avail });
    }
    if (missing.length > 0) return res.status(409).json({ error: 'Insufficient stock', missing });

    const statusChanges = [];
    if (consumeStock) {
      for (const [imageName, take] of grouped.entries()) {
        const refs = getFoodsByImageName(imageName);
        if (!refs.length) continue;
        const beforeQty = Math.max(0, Number(refs[0].quantity ?? 0));
        const afterQty  = Math.max(0, beforeQty - take);
        const newStatus = afterQty <= 0 ? 'Sold Out' : 'Available';

        refs.forEach(f => {
          const prev = f.status;
          f.quantity = afterQty;
          f.status   = newStatus;
          if (prev !== newStatus) statusChanges.push({ f, prevStatus: prev, newStatus, imageName });
        });

        io.emit('foodQuantityUpdated', { imageName, quantity: afterQty });
      }
      saveFoods();

      if (statusChanges.length) {
        io.emit('foodStatusUpdated', { updatedFoods: statusChanges.map(s => s.f) });
        for (const sc of statusChanges) {
          addStatusHistory({
            at: new Date().toISOString(),
            by: staff || 'unknown', role: 'user',
            imageName: sc.imageName,
            imageUrl: sc.f.imageUrl,
            type: sc.f.type,
            from: sc.prevStatus,
            to: sc.newStatus,
            count: getFoodsByImageName(sc.imageName).length,
            affectedIds: getFoodsByImageName(sc.imageName).map(x => x.id),
          });
        }
      }
    }
    const cleanCard = cleanMemberId(memberCard);
    const customerSnapshot = await buildCustomerSnapshot(cleanCard, customer || {}, customerName);
    if (cleanClientRequestId) {
  const existingOrderAfterLookup = orders.find(
    o => String(o.clientRequestId || '') === cleanClientRequestId
  );

  if (existingOrderAfterLookup) {
    return res.json({
      ok: true,
      duplicate: true,
      orderId: existingOrderAfterLookup.id,
      order: existingOrderAfterLookup,
    });
  }
}
const order = {
  id: nextOrderId(),
  clientRequestId: cleanClientRequestId || null,
  area,
  tableNo,
  staff: cleanMemberId(staff),
  memberCard: cleanCard,
  customerName: customerSnapshot.name || null,
  customer: {
    code: customerSnapshot.code || cleanCard || null,
    name: customerSnapshot.name || null,
    level: customerSnapshot.level || null,
  },
  note: note || '',
  items: orderItems,
  createdAt: new Date().toISOString(),
  status: 'PENDING',
  tableClosed: false,
  consumeStock: !!consumeStock,
  restocked: false,
  cancelReason: null,
};
    orders.push(order);
    persistOrder(order);

const card = cleanCard;
if (card) {
  const prev = members[card] || {};
  const now = new Date().toISOString();

  const orderHistoryItem = {
    at: now,
    type: 'ORDER',
    orderId: order.id,
    area,
    tableNo,
    items: orderItems,
    note: note || '',
  };

  // Chỉ giữ 29 dòng cũ + 1 dòng mới = tối đa 30 history gần nhất
  const prevHistory = Array.isArray(prev.history) ? prev.history.slice(-29) : [];

  const previousIdentity = getBestKnownCustomerIdentity(card);
  const safeSnapshotName = meaningfulCustomerName(customerSnapshot.name, card);
  const safeSnapshotLevel = meaningfulCustomerLevel(customerSnapshot.level);
  const nextMemberName = safeSnapshotName || previousIdentity.name || null;
  const nextMemberLevel = safeSnapshotLevel || previousIdentity.level || null;

  members[card] = {
    ...prev,
    code: prev.code || card,
    customerName: nextMemberName,
    name: nextMemberName,
    level: nextMemberLevel,
    memberLevel: nextMemberLevel,
    lastSeenAt: now,
    ordersCount: (prev.ordersCount || 0) + 1,
    history: [...prevHistory, orderHistoryItem],
    updatedAt: now,
  };

  persistMember(card);
  io.emit('memberUpdated', { code: card, member: members[card] });
}


    io.emit('orderPlaced', { order });

    res.json({ ok: true, orderId: order.id });
  } catch (e) {
    console.error('Create order error:', e);
    res.status(500).json({ error: 'Tạo order thất bại' });
  }
});
// User Orders View - chỉ xem, không cần quyền admin/kitchen
app.get('/api/user/orders-view', (req, res) => {
  try {
    orders = reloadOrdersSafe('GET /api/user/orders-view');

    let list = [...orders];
    const { status, area, tableNo, from, to } = req.query || {};

    if (area && tableNo) {
      list = list.filter(
        (o) =>
          String(o.area || '') === String(area) &&
          String(o.tableNo || '') === String(tableNo)
      );
    }

    if (status && status !== 'ALL') {
      if (status === 'OPEN') {
        list = list.filter((o) =>
          ['PENDING', 'IN_PROGRESS'].includes(o.status)
        );
      } else {
        list = list.filter((o) => o.status === status);
      }
    }

    if (from) {
      const fromMs = Date.parse(from);
      if (!Number.isNaN(fromMs)) {
        list = list.filter((o) => Date.parse(o.createdAt) >= fromMs);
      }
    }

    if (to) {
      const toMs = Date.parse(to);
      if (!Number.isNaN(toMs)) {
        list = list.filter((o) => Date.parse(o.createdAt) <= toMs);
      }
    }

    list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.json(
      list.map((o) => ({
        ...o,
        cancelReason: o.cancelReason ?? null,
      }))
    );
  } catch (e) {
    console.error('GET /api/user/orders-view error:', e);
    res.status(500).json({ error: 'Cannot get orders view' });
  }
});
app.get('/api/orders', maybeAuth, (req, res) => {
  try {
    // Reload nhanh từ SQLite để các cập nhật từ route phụ như item-price không bị stale
    orders = reloadOrdersSafe('GET /api/orders');
    let list = [...orders];
    const { customerId, status, area, tableNo, includeClosed, from, to } = req.query || {};
// Thêm đoạn sau:
if (customerId) {
  const card = String(customerId).trim();
  list = list.filter(o => String(o.memberCard || '') === card);
}
    if (area && tableNo) {
      list = list.filter(o => String(o.area) === String(area) && String(o.tableNo) === String(tableNo));
      if (String(includeClosed || '').toLowerCase() !== 'true') {
        list = list.filter(o => !o.tableClosed);
      }
      list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      const normalized = list.map(o => ({ ...o, cancelReason: o.cancelReason ?? null }));
      return res.json(normalized);
    }

    if (!req.user || !['admin', 'kitchen'].includes(req.user.role)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (status && status !== 'ALL') {
      if (status === 'OPEN') list = list.filter(o => ['PENDING', 'IN_PROGRESS'].includes(o.status));
      else                   list = list.filter(o => o.status === status);
    }
    if (from) {
      const fromMs = Date.parse(from);
      if (!Number.isNaN(fromMs)) list = list.filter(o => Date.parse(o.createdAt) >= fromMs);
    }
    if (to) {
      const toMs = Date.parse(to);
      if (!Number.isNaN(toMs)) list = list.filter(o => Date.parse(o.createdAt) <= toMs);
    }
    list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const normalized = list.map(o => ({ ...o, cancelReason: o.cancelReason ?? null }));
    res.json(normalized);

  } catch (e) {
    console.error('GET /api/orders error:', e);
    res.status(500).json({ error: 'Cannot get orders' });
  }
});

const ORDER_PRINT_CLAIM_TTL_MS = Number(process.env.ORDER_PRINT_CLAIM_TTL_MS || 10 * 60 * 1000);
const orderPrintClaims = new Map();

function cleanupOrderPrintClaims(now = Date.now()) {
  for (const [orderId, claim] of orderPrintClaims.entries()) {
    if (!claim?.at || now - claim.at > ORDER_PRINT_CLAIM_TTL_MS) {
      orderPrintClaims.delete(orderId);
    }
  }
}

app.post('/api/orders/:id/claim-print',
  authenticateJWT, authorizeRoles('admin', 'kitchen'),
  (req, res) => {
    try {
      const orderId = String(req.params.id || '').trim();
      if (!orderId) return res.status(400).json({ error: 'Missing order id' });

      const now = Date.now();
      cleanupOrderPrintClaims(now);

      const clientId = String(req.body?.clientId || req.user?.sub || req.ip || 'unknown').slice(0, 120);
      const existed = orderPrintClaims.get(orderId);

      if (existed && now - existed.at <= ORDER_PRINT_CLAIM_TTL_MS) {
        return res.json({
          ok: true,
          claimed: false,
          owner: existed.clientId || null,
          claimedAt: existed.claimedAt || null,
        });
      }

      const claimedAt = new Date().toISOString();
      orderPrintClaims.set(orderId, { clientId, at: now, claimedAt });

      return res.json({ ok: true, claimed: true, clientId, claimedAt });
    } catch (e) {
      console.error('POST /api/orders/:id/claim-print error:', e);
      res.status(500).json({ error: 'Cannot claim print' });
    }
  }
);

const ORDER_STATUS = {
  PENDING: 'PENDING',
  IN_PROGRESS: 'IN_PROGRESS',
  DONE: 'DONE',
  CANCELLED: 'CANCELLED',
};

// Cập nhật trạng thái + hoàn kho khi CANCELLED
app.post('/api/orders/:id/status',
  authenticateJWT, authorizeRoles('admin', 'kitchen'),
  (req, res) => {
    try {
      const orderId = String(req.params.id);
      const { status, reason } = req.body || {};
      const ALLOWED = new Set(Object.values(ORDER_STATUS));
      if (!ALLOWED.has(status)) return res.status(400).json({ error: 'Invalid status' });

      const o = sqliteStore.getOrderById(orderId);
      if (!o) return res.status(404).json({ error: 'Order not found' });

      const prevStatus = o.status;
      o.status = status;
      o.updatedAt = new Date().toISOString();
      if (status === ORDER_STATUS.CANCELLED) {
        o.cancelReason = (reason == null ? o.cancelReason : String(reason).trim()) || null;
      }

      let restocked = false;
      if (status === ORDER_STATUS.CANCELLED && o.consumeStock !== false && !o.restocked) {
        for (const it of (o.items || [])) {
          const img = String(it.imageName || '').toLowerCase();
          const qty = Number(it.qty || 0);
          if (img && qty > 0) {
            adjustStockByImageName(img, +qty, req.user?.sub || 'admin', 'order_cancelled_restock');
          }
        }
        o.restocked = true;
        restocked = true;
      }

      persistOrder(o);

      const cacheIndex = orders.findIndex(x => String(x.id) === orderId);
      if (cacheIndex >= 0) orders[cacheIndex] = o;
      else orders.unshift(o);

      io.emit('orderUpdated', {
        orderId,
        status: o.status,
        order: o,
        reason: o.cancelReason,
        cancelReason: o.cancelReason,
      });

      res.json({ ok: true, restocked, prevStatus, newStatus: o.status, cancelReason: o.cancelReason || null });
    } catch (e) {
      console.error('POST /api/orders/:id/status error:', e);
      res.status(500).json({ error: 'Cannot update order status' });
    }
  }
);

// User đóng bàn
app.post('/api/orders/:id/close', (req, res) => {
  try {
    const orderId = String(req.params.id);
    const o = sqliteStore.getOrderById(orderId);
    if (!o) return res.status(404).json({ error: 'Order not found' });

    if (!o.tableClosed) {
      o.tableClosed = true;
      o.closedAt = new Date().toISOString();
      o.closedBy = req.body?.by || 'user';
      persistOrder(o);

      const cacheIndex = orders.findIndex(x => String(x.id) === orderId);
      if (cacheIndex >= 0) orders[cacheIndex] = o;
      else orders.unshift(o);

      io.emit('orderUpdated', { orderId, status: o.status, order: o });
    }
    res.json({ ok: true });
  } catch (e) {
    console.error('POST /api/orders/:id/close error:', e);
    res.status(500).json({ error: 'Cannot close order' });
  }
});

// Đổi thứ tự
app.post('/api/reorder-foods', authenticateJWT, authorizeRoles('admin'), (req, res) => {
  try {
    const { orderedIds } = req.body;
    if (!Array.isArray(orderedIds)) return res.status(400).json({ message: 'orderedIds phải là mảng' });

    const idSet = new Set(foods.map(f => f.id));
    if (!orderedIds.every(id => idSet.has(id))) return res.status(400).json({ message: 'orderedIds chứa ID không tồn tại' });

    orderedIds.forEach((id, idx) => {
      const f = foods.find(x => x.id === id);
      if (f) f.order = idx;
    });

    foods.sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).forEach((f, i) => (f.order = i));
    saveFoods();
    io.emit('foodsReordered', { orderedIds });
    res.json({ success: true });
  } catch (e) {
    console.error('Reorder error:', e);
    res.status(500).json({ error: 'Reorder thất bại' });
  }
});

// Đổi tên ảnh món ăn
app.post('/api/rename-food', authenticateJWT, authorizeRoles('admin'), (req, res) => {
  try {
    const { id, newType: newName } = req.body || {};
    const foodId = Number(id);
    if (!foodId || !newName) return res.status(400).json({ error: 'Thiếu id hoặc newName' });
    const target = foods.find(f => f.id === foodId);
    if (!target) return res.status(404).json({ error: 'Không tìm thấy món ăn' });

    const finalName = String(newName).trim();
    if (!finalName) return res.status(400).json({ error: 'Tên mới không hợp lệ' });

    const origFile = extractImageName(target.imageUrl);
    if (!origFile) return res.status(400).json({ error: 'Không xác định được ảnh gốc' });
    const ext = path.extname(origFile);
    const baseNew = finalName.replace(/\s+/g, '-').toUpperCase();
    const newFileName = `${baseNew}${ext}`;

    const foodsToUpdate = foods.filter((f) => extractImageName(f.imageUrl) === origFile);

    // Check trùng tên trong từng folder menu
    for (const f of foodsToUpdate) {
      const relPath = f.imageUrl.replace(/.*\/images\//, '');
      const currentPath = path.join(IMAGES_DIR, relPath);
      const currentFolder = path.dirname(currentPath);
      const destPath = path.join(currentFolder, newFileName);
      if (fs.existsSync(destPath) && path.basename(currentPath).toLowerCase() !== newFileName.toLowerCase()) {
        return res.status(409).json({ error: 'Tên ảnh đã tồn tại ở một menu khác, hãy chọn tên khác.' });
      }
    }

    const host = req.get('host');
    const protocol = (req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0];

    // Rename trong từng menu
    foodsToUpdate.forEach((f) => {
      const relPath = f.imageUrl.replace(/.*\/images\//, '');
      const currentPath = path.join(IMAGES_DIR, relPath);
      const currentFolder = path.dirname(currentPath);
      const destPath = path.join(currentFolder, newFileName);
      if (path.basename(currentPath).toLowerCase() !== newFileName.toLowerCase()) {
        try { fs.renameSync(currentPath, destPath); } catch (err) { /* ignore */ }
      }
      const folderName = relPath.split('/')[0];
      f.imageUrl = `${protocol}://${host}/images/${folderName}/${newFileName}`;
    });

    // Cập nhật MASTER
    const masterOld = findCaseInsensitiveFile(MASTER_DIR, origFile);
    if (masterOld) {
      const masterNew = path.join(MASTER_DIR, newFileName);
      try { fs.renameSync(masterOld, masterNew); } catch(_) {}
    }

    saveFoods();
    io.emit('foodRenamed', { newImageUrl: null, imageName: origFile, newName: finalName, count: foodsToUpdate.length });
    res.json({ success: true, count: foodsToUpdate.length });
  } catch (e) {
    console.error('Rename error:', e);
    res.status(500).json({ error: 'Đổi tên thất bại' });
  }
});

// Xoá món
app.delete('/api/foods/:id', authenticateJWT, authorizeRoles('admin'), (req, res) => {
  try {
    const foodId = Number(req.params.id);
    const idx = foods.findIndex(f => f.id === foodId);
    if (idx === -1) return res.status(404).json({ message: 'Không tìm thấy món ăn' });

    const removed = foods[idx];
    foods.splice(idx, 1);

    // Chỉ xóa file nếu không còn record nào dùng chính đường dẫn đó (không đụng MASTER)
    const stillUsed = foods.some(f => f.imageUrl === removed.imageUrl);
    if (!stillUsed && removed.imageUrl) {
      const rel = removed.imageUrl.replace(/.*\/images\//, '');
      const imagePath = path.join(IMAGES_DIR, rel);
      if (fs.existsSync(imagePath)) {
        try { fs.unlinkSync(imagePath); } catch (e) { console.warn('Không thể xoá ảnh:', imagePath, e.message); }
      }
    }

    foods.forEach((f, i) => (f.order = i));
    saveFoods();
    io.emit('foodDeleted', { id: foodId });
    res.json({ success: true });
  } catch (e) {
    console.error('Delete error:', e);
    res.status(500).json({ error: 'Xóa thất bại' });
  }
});

// Áp dụng level theo menu
app.post('/api/update-levels-by-type', authenticateJWT, authorizeRoles('admin'), (req, res) => {
  try {
    const { type, levelAccess } = req.body;
    if (!type) return res.status(400).json({ error: 'Thiếu type' });
    if (!Array.isArray(levelAccess)) return res.status(400).json({ error: 'levelAccess phải là mảng' });

    const VALID = new Set(['P', 'I-I+', 'V-One']);
    const cleaned = [...new Set(levelAccess.filter(lv => VALID.has(lv)))];

    let count = 0;
    foods.forEach((f) => {
      if (f.type === type) {
        f.levelAccess = cleaned;
        count++;
      }
    });

    saveFoods();
    menuLevels[type.trim()] = cleaned;
    saveMenuLevels();

    io.emit('foodLevelsUpdated', { type, levelAccess: cleaned, count });
    io.emit('menuLevelsUpdated', { type: type.trim(), levelAccess: cleaned });

    res.json({ success: true, count });
  } catch (e) {
    console.error('Update levels by type error:', e);
    res.status(500).json({ error: 'Cập nhật level thất bại' });
  }
});

// API Menu Levels
app.get('/api/menu-levels', authenticateJWT, authorizeRoles('admin', 'kitchen'), (_req, res) => {
  res.json(menuLevels);
});
app.post('/api/menu-levels', authenticateJWT, authorizeRoles('admin'), (req, res) => {
  try {
    const { type, levelAccess } = req.body || {};
    if (!type) return res.status(400).json({ error: 'Thiếu type' });
    if (!Array.isArray(levelAccess)) return res.status(400).json({ error: 'levelAccess phải là mảng' });

    const VALID = new Set(['P', 'I-I+', 'V-One']);
    const cleaned = [...new Set(levelAccess.filter(lv => VALID.has(lv)))];

    menuLevels[type.trim()] = cleaned;
    saveMenuLevels();
    io.emit('menuLevelsUpdated', { type: type.trim(), levelAccess: cleaned });

    res.json({ success: true });
  } catch (e) {
    console.error('Save menu-levels error:', e);
    res.status(500).json({ error: 'Lưu level menu thất bại' });
  }
});

app.post('/api/foods/menu-toggle-by-image',
  authenticateJWT, authorizeRoles('admin'),
  (req, res) => {
    try {
      let { imageName, imageUrl, id, menu, checked } = req.body || {};
      const menuName = String(menu || '').trim();

try { assertSafeMenuName(menuName); } catch {
  return res.status(400).json({ error: 'Invalid menu' });
}
const allMenus = new Set(getAllMenuTypes());
// Nếu menu chưa có trong danh sách, tự đăng ký với level mặc định
if (!allMenus.has(menuName)) {
  menuLevels[menuName] = menuLevels[menuName] || [];
  saveMenuLevels();
  io.emit('menuLevelsUpdated', { type: menuName, levelAccess: menuLevels[menuName] });
}


      // Suy ra imageName nếu FE không gửi
      let imgLower = '';
      if (imageName) imgLower = String(imageName).toLowerCase();
      if (!imgLower && imageUrl) imgLower = extractImageName(imageUrl);
      if (!imgLower && (id != null)) {
        const f = foods.find(x => x.id === Number(id));
        if (f) imgLower = extractImageName(f.imageUrl);
      }
      if (!imgLower) {
        return res.status(400).json({ error: 'Missing imageName (and cannot infer from imageUrl/id)' });
      }

      const host = req.get('host');
      const protocol = (req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0];

      if (checked) {
        // Đảm bảo MASTER có ảnh gốc
        let preferPath = null;
        if (imageUrl) {
          const p = urlToDiskPath(imageUrl);
          if (p && fs.existsSync(p)) preferPath = p;
        }
        const master = ensureMasterCopy(imgLower, preferPath);
        if (!master || !fs.existsSync(master)) {
          // Ảnh gốc thực sự đã mất → cần reupload 1 lần
          return res.status(409).json({ error: 'SOURCE_IMAGE_MISSING_REUPLOAD_REQUIRED' });
        }

        // Copy MASTER → menu
        const placed = copyToMenuFromMaster(menuName, imgLower);
        if (!placed || !fs.existsSync(placed)) {
          return res.status(500).json({ error: 'COPY_FAILED' });
        }
        const newImageUrl = `${protocol}://${host}/images/${menuName}/${path.basename(placed)}`;

        // Thêm foods record nếu chưa có
        if (!foods.find(f => f.type === menuName && extractImageName(f.imageUrl) === imgLower)) {
          const ref = getRefFoodByImageName(imgLower);
          const baseQty = typeof ref?.quantity === 'number' ? ref.quantity : 1;
          const baseStatus = baseQty <= 0 ? 'Sold Out' : 'Available';
const VALID = new Set(['P','I-I+','V-One']);
const ml = Array.isArray(menuLevels[menuName]) ? menuLevels[menuName] : [];
const effective = [...new Set(ml.filter(x => VALID.has(x)))]; // có thể là []
          const maxOrder = foods.reduce((m,f)=>(typeof f.order==='number'&&f.order>m?f.order:m),-1);
          const newFood = {
            id: nextNumericId(),
            imageUrl: newImageUrl,
            type: menuName,
            status: baseStatus,
            hash: md5File(master),
            levelAccess: effective,
            order: maxOrder + 1,
            quantity: baseQty
          };
          foods.push(newFood);
          saveFoods();
          io.emit('foodAdded', newFood);
        }

        // Cập nhật products.json (nếu có)
        updateProductMenusByImageName(imgLower, (cur) => Array.from(new Set([...cur, menuName])));

        return res.json({ ok: true, added: menuName });
      } else {
        // Bỏ khỏi menu
        deleteFromMenu(menuName, imgLower);

        const before = foods.length;
        foods = foods.filter(f => !(f.type === menuName && extractImageName(f.imageUrl) === imgLower));
        if (before !== foods.length) {
          saveFoods();
          io.emit('foodDeleted', { type: menuName, imageName: imgLower });
        }

        updateProductMenusByImageName(imgLower, (cur) => cur.filter(m => m !== menuName));

        // Không xoá MASTER
        return res.json({ ok: true, removed: menuName });
      }
    } catch (e) {
      console.error('menu-toggle-by-image error:', e);
      return res.status(500).json({ error: 'INTERNAL_ERROR' });
    }
  }
);


// Lịch sử
app.get('/api/status-history', authenticateJWT, authorizeRoles('admin', 'kitchen'), (req, res) => {
  try {
    const { limit = 200, from, to, user, type, toStatus, fromStatus } = req.query;

    const list = sqliteStore.listStatusHistory({
      limit,
      from,
      to,
      user,
      type,
      toStatus,
      fromStatus,
    });

    res.json(list);
  } catch (e) {
    console.error('GET /status-history error:', e);
    res.status(500).json({ error: 'Không lấy được lịch sử' });
  }
});

// ========== Date helpers for REPORT (mốc 06:00) ==========
function at06h(d) {
  const x = new Date(d);
  x.setHours(6, 0, 0, 0);
  return x;
}
function endAt05h59m59s999(d) {
  // kết thúc 05:59:59.999 của ngày kế tiếp so với mốc 06:00 ngày hiện tại
  const x = at06h(d);
  return new Date(x.getTime() - 1); // sẽ dùng với "mốc của NGÀY KẾ TIẾP"
}
function startOfMonth06(d) {
  const x = new Date(d);
  x.setDate(1);
  return at06h(x);
}
function startOfYear06(d) {
  const x = new Date(d);
  x.setMonth(0, 1);
  return at06h(x);
}
function mondayOfWeek06(d) {
  // chuẩn hoá về thứ Hai 06:00 (week = Mon..Sun)
  const x = at06h(d);
  const day = x.getDay(); // 0=CN, 1=Mon,...6=Sun
  const diffToMonday = (day === 0 ? -6 : (1 - day)); // đưa về thứ Hai
  const monday = new Date(x);
  monday.setDate(x.getDate() + diffToMonday);
  monday.setHours(6, 0, 0, 0);
  return monday;
}
function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function addMonths(d, n) {
  const x = new Date(d);
  x.setMonth(x.getMonth() + n);
  return x;
}
function addYears(d, n) {
  const x = new Date(d);
  x.setFullYear(x.getFullYear() + n);
  return x;
}

/**
 * Trả về { fromTime, toTime } theo preset, với mốc NGÀY MỚI = 06:00
 * - thisWeek:   Mon 06:00 tuần này → Mon 05:59:59.999 tuần sau
 * - lastWeek:   Mon 06:00 tuần trước → Mon 05:59:59.999 tuần này
 * - thisMonth:  ngày 1 06:00 tháng này → ngày 1 05:59:59.999 tháng sau
 * - lastMonth:  ngày 1 06:00 tháng trước → ngày 1 05:59:59.999 tháng này
 * - thisYear:   01/01 06:00 năm nay → 01/01 05:59:59.999 năm sau
 * - lastYear:   01/01 06:00 năm trước → 01/01 05:59:59.999 năm nay
 */
function getDateRangeByPreset(preset) {
  const now = new Date();

  switch (String(preset || '').toLowerCase()) {
    case 'thisweek': {
      const mon = mondayOfWeek06(now);
      const nextMon = addDays(mon, 7);      // thứ Hai tuần sau 06:00
      const to = new Date(nextMon.getTime() - 1); // 05:59:59.999 trước đó
      return { fromTime: mon, toTime: to };
    }
    case 'lastweek': {
      const monThis = mondayOfWeek06(now);
      const monPrev = addDays(monThis, -7); // thứ Hai tuần trước 06:00
      const to = new Date(monThis.getTime() - 1);
      return { fromTime: monPrev, toTime: to };
    }
    case 'thismonth': {
      const start = startOfMonth06(now);      // 01 tháng này 06:00
      const next  = startOfMonth06(addMonths(now, 1));
      const to = new Date(next.getTime() - 1);
      return { fromTime: start, toTime: to };
    }
    case 'lastmonth': {
      const startThis = startOfMonth06(now);
      const startPrev = startOfMonth06(addMonths(now, -1));
      const to = new Date(startThis.getTime() - 1);
      return { fromTime: startPrev, toTime: to };
    }
    case 'thisyear': {
      const start = startOfYear06(now);       // 01/01 năm nay 06:00
      const next  = startOfYear06(addYears(now, 1));
      const to = new Date(next.getTime() - 1);
      return { fromTime: start, toTime: to };
    }
    case 'lastyear': {
      const startThis = startOfYear06(now);
      const startPrev = startOfYear06(addYears(now, -1));
      const to = new Date(startThis.getTime() - 1);
      return { fromTime: startPrev, toTime: to };
    }
    default: {
      // Fallback: coi như "thisWeek"
      const mon = mondayOfWeek06(now);
      const nextMon = addDays(mon, 7);
      const to = new Date(nextMon.getTime() - 1);
      return { fromTime: mon, toTime: to };
    }
  }
}

app.get('/api/report', authenticateJWT, authorizeRoles('admin'), (req, res) => {
  // from/to dạng ISO, hoặc dùng “week”, “lastWeek”, “month”, “lastMonth”, “year”, “lastYear”
  const { from, to, preset } = req.query || {};
  
  // Tính toán thời gian bắt đầu/kết thúc: 
  // Nếu preset = 'thisWeek', 'lastWeek', 'thisMonth', ... thì đổi thành from/to.
  // Bạn cần định nghĩa hàm getDateRangeByPreset(preset) trả về { from, to } theo quy tắc 6h sáng:
  // Ví dụ: tuần này: từ thứ Hai 6h00 đến 6h00 thứ Hai tuần sau.
  
  const { fromTime, toTime } = preset 
    ? getDateRangeByPreset(preset) 
    : { fromTime: new Date(from), toTime: new Date(to) };

  // Lọc orders trong khoảng thời gian
  const selectedOrders = orders.filter(o => {
    const t = new Date(o.createdAt);
    return t >= fromTime && t <= toTime;
  });

  // Tổng số đơn
  const totalOrders = selectedOrders.length;

  // Tính số lượng từng món
  const itemCounts = {};
  selectedOrders.forEach(o => {
    o.items.forEach(it => {
      const key = it.imageName || it.name;
      itemCounts[key] = (itemCounts[key] || 0) + (Number(it.qty) || 1);
    });
  });

  // Tính theo menu (type) – cần mapping imageName -> type
  const itemsByMenu = {};
  selectedOrders.forEach(o => {
    o.items.forEach(it => {
      const f = foods.find(x => extractImageName(x.imageUrl) === String(it.imageName || '').toLowerCase());
      const menu = f?.type || 'OTHER';
      if (!itemsByMenu[menu]) itemsByMenu[menu] = {};
      const name = it.imageName || it.name;
      itemsByMenu[menu][name] = (itemsByMenu[menu][name] || 0) + (Number(it.qty) || 1);
    });
  });

  // Khách hàng đã order
// Khách hàng đã order (kéo cả level từ members)
const customers = {};
selectedOrders.forEach(o => {
  if (!o.memberCard) return;

  const card = String(o.memberCard).trim();
  const m = members[card] || {};                 // <-- dữ liệu mục Khách hàng
  const level = m.level || m.memberLevel || null;

  if (!customers[card]) {
    customers[card] = {
      code: card,                                 // mã khách (cho dễ dùng ở FE)
      name: o.customerName || m.customerName || m.name || null,
      level,                                      // <-- bổ sung cột Level
      lastSeenAt: m.lastSeenAt || null,          // (tuỳ dùng)
      ordersCount: m.ordersCount || 0,           // (tuỳ dùng)
      items: {}
    };
  }

  o.items.forEach(it => {
    const key = it.imageName || it.name;
    customers[card].items[key] = (customers[card].items[key] || 0) + (Number(it.qty) || 1);
  });
});


  res.json({
    totalOrders,
    itemCounts,
    itemsByMenu,
    customers,
    from: fromTime.toISOString(),
    to: toTime.toISOString(),
  });
});

// DELETE: xóa toàn bộ 1 menu (kể cả khi menu không có item)
app.delete('/api/menu-levels/:type', authenticateJWT, authorizeRoles('admin'), (req, res) => {
  try {
    const typeRaw = req.params.type || '';
    const type = String(typeRaw).trim();
    if (!type) return res.status(400).json({ error: 'Thiếu type' });

    // 1) Xóa toàn bộ item thuộc menu này (xóa ảnh trong thư mục menu + record foods)
    const toDel = foods.filter(f => f.type === type);
    for (const f of toDel) {
      const img = extractImageName(f.imageUrl);
      // xóa file ảnh trong folder menu (KHÔNG xóa master)
      try { deleteFromMenu(type, img); } catch {}
      // bắn event để FE cập nhật
      io.emit('foodDeleted', { id: f.id, type, imageName: img });
    }
    const before = foods.length;
    foods = foods.filter(f => f.type !== type);
    if (foods.length !== before) saveFoods();

    // 2) Xóa map level của menu này
    if (menuLevels[type]) {
      delete menuLevels[type];
      saveMenuLevels();
    }
    // Realtime cho FE (kể cả khi trước đó không có key)
    io.emit('menuLevelsUpdated', { type, levelAccess: [] });

    // 3) (Tùy chọn) nếu folder /images/<type> trống thì thử xóa
    try {
      const dir = path.join(IMAGES_DIR, type);
      if (fs.existsSync(dir)) {
        const files = fs.readdirSync(dir);
        if (files.length === 0) fs.rmdirSync(dir);
      }
    } catch {}

    return res.json({ ok: true, deletedItems: toDel.length });
  } catch (e) {
    console.error('DELETE /api/menu-levels/:type error:', e);
    return res.status(500).json({ error: 'Xóa menu thất bại' });
  }
});

// ===================================================================
// =================== LOCAL FOOD AI CHATBOT (FREE) ==================
// ===================================================================
const LOCAL_AI_TRAINING_JSON = path.join(DATA_DIR, 'ai-training.json');
const LOCAL_AI_MEMORY_JSON = path.join(DATA_DIR, 'ai-memory.json');
const LOCAL_AI_PENDING_JSON = path.join(DATA_DIR, 'ai-pending-learning.json');

// ===================================================================
// =================== HYBRID AI CONFIG ===============================
// ===================================================================
// Bật/tắt hybrid. Nếu false thì dùng local AI cũ.
const HYBRID_AI_ENABLED = String(process.env.HYBRID_AI_ENABLED || 'true').toLowerCase() !== 'false';

// LLM_API_URL nên là endpoint dạng OpenAI-compatible chat completions.
// Ví dụ Ollama local: http://127.0.0.1:11434/v1/chat/completions
// Ví dụ provider cloud: https://.../v1/chat/completions
const LLM_API_URL = process.env.LLM_API_URL || '';
const LLM_API_KEY = process.env.LLM_API_KEY || '';
const LLM_MODEL = process.env.LLM_MODEL || 'llama3.1';
const HYBRID_AI_TIMEOUT_MS = Math.max(3000, Number(process.env.HYBRID_AI_TIMEOUT_MS || 10000));

for (const p of [LOCAL_AI_TRAINING_JSON, LOCAL_AI_MEMORY_JSON, LOCAL_AI_PENDING_JSON]) {
  try {
    if (!fs.existsSync(p)) fs.writeFileSync(p, '[]', 'utf8');
  } catch (e) {
    console.error('Could not initialize local AI file:', p, e.message);
  }
}

// Import local AI JSON vào SQLite lần đầu nếu bảng đang rỗng.
// Sau đó SQLite là nơi lưu chính, JSON chỉ giữ lại để backup/khôi phục nếu cần.
try {
  const r1 = sqliteStore.importLocalAiTrainingFromJsonIfEmpty(LOCAL_AI_TRAINING_JSON);
  if (r1.imported) {
    console.log(`[SQLite] Imported ${r1.count} local AI training rows from ai-training.json`);
  }

  const r2 = sqliteStore.importLocalAiMemoryFromJsonIfEmpty(LOCAL_AI_MEMORY_JSON);
  if (r2.imported) {
    console.log(`[SQLite] Imported ${r2.count} local AI memory rows from ai-memory.json`);
  }

  const r3 = sqliteStore.importLocalAiPendingFromJsonIfEmpty(LOCAL_AI_PENDING_JSON);
  if (r3.imported) {
    console.log(`[SQLite] Imported ${r3.count} local AI pending rows from ai-pending-learning.json`);
  }
} catch (e) {
  console.error('[SQLite] Import local AI data failed:', e.message);
}

const localAiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({
      error: 'Bạn hỏi chatbot quá nhanh. Vui lòng thử lại sau vài giây.',
    });
  },
});

function getLocalAiPaths() {
  return {
    orders: ORDERS_JSON,
    foods: FOODS_JSON,
    products: PRODUCTS_JSON,
    statusHistory: STATUS_HISTORY_JSON,
    members: MEMBERS_JSON,
    staffs: STAFFS_JSON,
    training: LOCAL_AI_TRAINING_JSON,
    memory: LOCAL_AI_MEMORY_JSON,
    pendingLearning: LOCAL_AI_PENDING_JSON,
  };
}

function resolveAiMode(req) {
  const requestedMode = req.body?.mode === 'admin' ? 'admin' : 'user';
  const isRealAdmin = req.user?.role === 'admin';
  return requestedMode === 'admin' && isRealAdmin ? 'admin' : 'user';
}

function safeJsonParseLoose(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch (_) {}

  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  if (first >= 0 && last > first) {
    try {
      return JSON.parse(raw.slice(first, last + 1));
    } catch (_) {}
  }

  return null;
}

function normalizeHybridHistory(history = []) {
  return (Array.isArray(history) ? history : [])
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant'))
    .slice(-8)
    .map((m) => ({
      role: m.role,
      content: String(m.content || '').slice(0, 1200),
    }));
}

function safeJsonParseLoose(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch (_) {}

  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  if (first >= 0 && last > first) {
    try {
      return JSON.parse(raw.slice(first, last + 1));
    } catch (_) {}
  }

  return null;
}

function normalizeHybridHistory(history = []) {
  return (Array.isArray(history) ? history : [])
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant'))
    .slice(-8)
    .map((m) => ({
      role: m.role,
      content: String(m.content || '').slice(0, 1200),
    }));
}

function buildHybridRouterPrompt({ mode }) {
  return `Bạn là bộ định tuyến Hybrid AI cho phần mềm Food Order.

NHIỆM VỤ:
- Không tự tính số liệu.
- Không bịa dữ liệu order, khách, món, bàn, doanh thu.
- Chỉ phân tích câu hỏi và chọn tool.
- Nếu cần dữ liệu thật, rewrite câu hỏi thành tiếng Việt rõ ràng để local tool xử lý.
- Nếu chỉ là chào hỏi/hướng dẫn phần mềm, trả lời trực tiếp.
- Nếu câu hỏi không cần số liệu thật, ưu tiên direct_answer.
- Các câu như "ai là người làm ra phần mềm này", "phần mềm này của ai", "bạn là ai", "nói chuyện được không", "giải thích giúp tôi", "tôi nên hỏi gì" là direct_answer.
- Chỉ dùng food_order_data khi user hỏi dữ liệu thật về order, khách, bàn, món, sold out, doanh thu, báo cáo, danh sách hoặc thống kê.
- Nếu không chắc, chọn direct_answer và trả lời/hỏi lại tự nhiên, không ép sang dữ liệu order.
MODE hiện tại: ${mode}

TOOL HỢP LỆ:
1. food_order_data
Dùng khi hỏi về khách, order, bàn, món, sold out, báo cáo, số lượng, top, danh sách, lịch sử, ghi chú, sở thích khách.

2. direct_answer
Dùng khi hỏi chào hỏi, bạn là ai, phần mềm là gì, phần mềm dùng như nào, chatbot làm được gì.

QUY TẮC REWRITE:
- "gọi gì" = "order gì"
- "có gọi gì không" = "có order gì không"
- "thích ăn gì" = "hay ăn gì"
- "thích uống gì" = "hay uống gì"
- "không thích ăn gì" = "cần tránh món/thành phần gì theo ghi chú"
- "bàn đó", "bàn này" giữ nguyên để backend dùng history/context.
- Không tự tạo số liệu.
- "bàn nào chưa gọi món" = "bàn nào chưa order"
- "bàn nào chưa gọi" = "bàn nào chưa order"
- "bàn nào im ắng" = "bàn nào chưa order"
- "danh sách" nếu câu trước hỏi số lượng bàn đã order → "danh sách các bàn đã order" và giữ mốc thời gian câu trước.
- "danh sách" nếu câu trước hỏi số lượng bàn chưa order → "danh sách các bàn chưa order" và giữ mốc thời gian câu trước.
- "ai làm ra phần mềm này" dùng direct_answer, không gọi dữ liệu order.
- "phần mềm này của ai" dùng direct_answer.
CHỈ TRẢ JSON THUẦN, không markdown.

Schema:
{
  "tool": "food_order_data" hoặc "direct_answer",
  "rewrittenQuestion": "bắt buộc nếu tool=food_order_data",
  "directAnswer": "bắt buộc nếu tool=direct_answer",
  "confidence": 0.0 đến 1.0
}

Ví dụ:
{"tool":"direct_answer","directAnswer":"Chào bạn, mình là AI hỗ trợ phần mềm Food Order. Bạn có thể hỏi về khách, bàn, order, món ăn, ghi chú và gợi ý món.","confidence":0.95}

{"tool":"food_order_data","rewrittenQuestion":"khách order nhiều nhất là ai?","confidence":0.9}

{"tool":"food_order_data","rewrittenQuestion":"1 hôm nay có order gì không?","confidence":0.9}

{"tool":"food_order_data","rewrittenQuestion":"hôm nay danh sách các bàn chưa order","confidence":0.9}

{"tool":"food_order_data","rewrittenQuestion":"hôm nay danh sách các bàn đã order","confidence":0.9}

{"tool":"direct_answer","directAnswer":"Phần mềm Food Order là hệ thống nội bộ dùng để quản lý order món ăn, bàn, khách hàng và báo cáo.","confidence":0.9}`;
}

async function callHybridLLMRouter({ message, history = [], mode = 'user' }) {
  if (!HYBRID_AI_ENABLED || !LLM_API_URL) return null;

  if (typeof fetch !== 'function') {
    console.warn('Hybrid AI disabled: global fetch is not available. Use Node.js 18+.');
    return null;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HYBRID_AI_TIMEOUT_MS);

  try {
    const messages = [
      { role: 'system', content: buildHybridRouterPrompt({ mode }) },
      ...normalizeHybridHistory(history),
      { role: 'user', content: String(message || '') },
    ];

    const headers = {
      'Content-Type': 'application/json',
    };

    if (LLM_API_KEY) {
      headers.Authorization = `Bearer ${LLM_API_KEY}`;
    }

    const resp = await fetch(LLM_API_URL, {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        model: LLM_MODEL,
        messages,
        temperature: 0.1,
        max_tokens: 500,
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      console.warn('Hybrid LLM HTTP error:', resp.status, errText.slice(0, 300));
      return null;
    }

    const json = await resp.json();

    const content =
      json?.choices?.[0]?.message?.content ||
      json?.message?.content ||
      json?.content ||
      '';

    const parsed = safeJsonParseLoose(content);
    if (!parsed || typeof parsed !== 'object') return null;

    const tool = String(parsed.tool || '').trim();

    if (!['food_order_data', 'direct_answer'].includes(tool)) {
      return null;
    }

    return {
      tool,
      rewrittenQuestion: String(parsed.rewrittenQuestion || '').trim(),
      directAnswer: String(parsed.directAnswer || '').trim(),
      confidence: Number(parsed.confidence || 0),
      raw: parsed,
    };
  } catch (e) {
    console.warn('Hybrid LLM router failed:', e?.message || String(e));
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function buildHybridMeta(aiRouter, usedQuestion) {
  if (!aiRouter) return undefined;

  return {
    hybrid: true,
    tool: aiRouter.tool,
    rewrittenQuestion: usedQuestion || aiRouter.rewrittenQuestion || '',
    confidence: aiRouter.confidence || 0,
    model: LLM_MODEL,
  };
}
function isLocalFallbackAnswer(answer = '') {
  const a = String(answer || '').toLowerCase();

  return (
    a.includes('mình hiểu ý bạn, nhưng câu này chưa đủ rõ') ||
    a.includes('mình chưa hiểu rõ câu này') ||
    a.includes('bạn thử hỏi ngắn theo kiểu') ||
    a.includes('chưa đủ rõ để thống kê trực tiếp')
  );
}

function buildNaturalAssistantPrompt({ mode }) {
  return `Bạn là AI hỗ trợ phần mềm Food Order.

NHIỆM VỤ:
- Trả lời tự nhiên, thân thiện như một đồng nghiệp IT hỗ trợ nhân viên.
- Không được bịa số liệu order, doanh thu, khách, món, bàn.
- Nếu câu hỏi cần dữ liệu thật mà tool nội bộ không trả lời được, hãy hỏi lại ngắn gọn để làm rõ.
- Nếu câu hỏi là chào hỏi, hỏi phần mềm là gì, ai làm ra phần mềm, cách sử dụng, chatbot làm được gì... thì được trả lời trực tiếp.
- Nếu user hỏi dữ liệu order/khách/bàn/món cụ thể, hãy nhắc user hỏi theo mã khách, số bàn, ngày hoặc món cụ thể.

THÔNG TIN APP:
- Đây là phần mềm Food Order nội bộ.
- App dùng để quản lý order món ăn theo bàn/khu vực, quản lý món, sold out, lịch sử order, khách hàng, báo cáo và sở thích khách.
- Chủ/đơn vị phát triển có thể lấy từ APP_OWNER_NAME. Nếu không có, nói là team nội bộ/IT phát triển.
- Mode hiện tại: ${mode}.

GIỌNG TRẢ LỜI:
- Ngắn gọn.
- Tự nhiên.
- Không văn mẫu.
- Không liệt kê quá dài nếu user chỉ hỏi đơn giản.`;
}

async function callHybridNaturalAnswer({
  message,
  history = [],
  mode = 'user',
  localAnswer = '',
}) {
  if (!HYBRID_AI_ENABLED || !LLM_API_URL) return '';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HYBRID_AI_TIMEOUT_MS);

  try {
    const owner = process.env.APP_OWNER_NAME || 'team IT nội bộ';

    const messages = [
      { role: 'system', content: buildNaturalAssistantPrompt({ mode }) },
      ...normalizeHybridHistory(history),
      {
        role: 'user',
        content: [
          `APP_OWNER_NAME: ${owner}`,
          `Câu hỏi của user: ${String(message || '')}`,
          localAnswer ? `Câu trả lời local tool hiện tại: ${String(localAnswer).slice(0, 1500)}` : '',
          '',
          'Hãy trả lời tự nhiên. Nếu local tool không hiểu và câu hỏi không cần số liệu thật, hãy tự trả lời dựa trên thông tin app. Nếu cần dữ liệu thật nhưng thiếu thông tin, hãy hỏi lại 1 câu ngắn.'
        ].filter(Boolean).join('\n')
      }
    ];

    const headers = { 'Content-Type': 'application/json' };
    if (LLM_API_KEY) headers.Authorization = `Bearer ${LLM_API_KEY}`;

    const resp = await fetch(LLM_API_URL, {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        model: LLM_MODEL,
        messages,
        temperature: 0.3,
        max_tokens: 700,
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      console.warn('Hybrid natural answer HTTP error:', resp.status, errText.slice(0, 300));
      return '';
    }

    const json = await resp.json();

    return String(
      json?.choices?.[0]?.message?.content ||
      json?.message?.content ||
      json?.content ||
      ''
    ).trim();
  } catch (e) {
    console.warn('Hybrid natural answer failed:', e?.message || String(e));
    return '';
  } finally {
    clearTimeout(timer);
  }
}
async function answerHybridFoodQuestion({
  mode,
  message,
  history = [],
  context = {},
  paths = {},
}) {
  const runLocal = (msg = message) =>
    answerLocalFoodQuestion({
      mode,
      message: msg,
      history,
      context,
      paths,
    });

  // 1) Ưu tiên local trước để tránh gọi Ollama cho mọi câu.
  const localFirst = runLocal(message);

  // Nếu local đã trả lời tốt thì trả luôn, không gọi LLM.
  if (!isLocalFallbackAnswer(localFirst.answer)) {
    return {
      ...localFirst,
      provider: 'local-first',
      meta: {
        hybrid: false,
        reason: 'local_answer_ok',
      },
    };
  }

  // 2) Local không hiểu thì mới gọi LLM router.
  const aiRouter = await callHybridLLMRouter({
    message,
    history,
    mode,
  });

  // Nếu LLM không chạy được thì trả local fallback.
  if (!aiRouter) {
    return {
      ...localFirst,
      provider: localFirst.provider || 'local-fallback',
    };
  }

  // 3) Câu hỏi chung thì trả direct.
  if (aiRouter.tool === 'direct_answer' && aiRouter.directAnswer) {
    return {
      ok: true,
      mode,
      provider: 'hybrid-direct',
      answer: aiRouter.directAnswer,
      meta: buildHybridMeta(aiRouter, ''),
    };
  }

  // 4) Câu hỏi cần dữ liệu thật thì dùng câu đã rewrite để gọi local tool.
  if (aiRouter.tool === 'food_order_data') {
    const toolQuestion = aiRouter.rewrittenQuestion || message;
    const toolResult = runLocal(toolQuestion);

    return {
      ...toolResult,
      provider: 'hybrid-tool-after-local-fallback',
      meta: buildHybridMeta(aiRouter, toolQuestion),
    };
  }

  return {
    ...localFirst,
    provider: localFirst.provider || 'local-fallback',
  };
}
async function localAiChatHandler(req, res) {
  try {
    const message = String(req.body?.message || '').trim();

    if (!message) {
      return res.status(400).json({ error: 'Thiếu câu hỏi.' });
    }

    if (message.length > 3000) {
      return res.status(400).json({
        error: 'Câu hỏi quá dài, tối đa 3000 ký tự.',
      });
    }

    const mode = resolveAiMode(req);

const result = answerLocalFoodQuestion({
  mode,
  message,
  history: Array.isArray(req.body?.history) ? req.body.history : [],
  context: req.body?.context || {},
  paths: getLocalAiPaths(),
});

    res.json(result);
  } catch (e) {
    console.error('LOCAL AI chat error:', e);
    res.status(500).json({
      error: e?.message || 'Chatbot nội bộ bị lỗi.',
    });
  }
}

function localAiTrainHandler(req, res) {
  try {
    if (req.user?.role !== 'admin') {
      return res.status(401).json({
        error: 'Chỉ admin mới được training chatbot.',
      });
    }

    const result = trainLocalFoodAI({
      content: req.body?.content || req.body?.message || '',
      source: req.body?.source || 'chatbox-admin',
      by: req.user?.username || req.user?.sub || 'admin',
      tags: Array.isArray(req.body?.tags) ? req.body.tags : [],
      paths: getLocalAiPaths(),
    });

    res.json(result);
  } catch (e) {
    console.error('LOCAL AI train error:', e);
    res.status(500).json({
      error: e?.message || 'Không lưu được training.',
    });
  }
}
function localAiFeedbackHandler(req, res) {
  try {
    const result = recordLocalFoodAiFeedback({
      question: req.body?.question || req.body?.message || '',
      answer: req.body?.answer || '',
      correction: req.body?.correction || req.body?.content || '',
      mode: resolveAiMode(req),
      by: req.user?.username || req.user?.sub || 'user',
      paths: getLocalAiPaths(),
    });
    res.json(result);
  } catch (e) {
    console.error('LOCAL AI feedback error:', e);
    res.status(500).json({ error: e?.message || 'Không lưu được góp ý dạy lại.' });
  }
}

function localAiPendingLearningHandler(req, res) {
  try {
    if (req.user?.role !== 'admin') {
      return res.status(401).json({ error: 'Chỉ admin mới được xem danh sách chờ duyệt.' });
    }
    res.json(listLocalFoodAiPending({ paths: getLocalAiPaths() }));
  } catch (e) {
    res.status(500).json({ error: e?.message || 'Không đọc được pending learning.' });
  }
}

function localAiApproveLearningHandler(req, res) {
  try {
    if (req.user?.role !== 'admin') {
      return res.status(401).json({ error: 'Chỉ admin mới được duyệt learning.' });
    }
    const result = approveLocalFoodAiLearning({
      id: req.body?.id,
      approve: req.body?.approve !== false,
      by: req.user?.username || req.user?.sub || 'admin',
      paths: getLocalAiPaths(),
    });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e?.message || 'Không duyệt được learning.' });
  }
}
app.post('/api/local-ai/chat', localAiLimiter, maybeAuth, localAiChatHandler);
app.post('/api/local-ai/train', localAiLimiter, maybeAuth, localAiTrainHandler);
app.post('/api/local-ai/feedback', localAiLimiter, maybeAuth, localAiFeedbackHandler);
app.get('/api/local-ai/pending-learning', maybeAuth, localAiPendingLearningHandler);
app.post('/api/local-ai/approve-learning', maybeAuth, localAiApproveLearningHandler);

// Alias cũ nếu cần
app.post('/api/ai/feedback', localAiLimiter, maybeAuth, localAiFeedbackHandler);
app.get('/api/local-ai/suggestions', maybeAuth, (req, res) => {
  const mode =
    req.user?.role === 'admin' && req.query?.mode === 'admin'
      ? 'admin'
      : 'user';

  res.json({
    ok: true,
    mode,
    suggestions: listLocalFoodAiSuggestions(mode),
  });
});
app.get('/api/local-ai/hybrid-status', maybeAuth, (req, res) => {
  res.json({
    ok: true,
    hybridEnabled: false,
    localOnly: true,
    message: 'Chatbot đang chạy local-only, không gọi AI bên thứ 3.',
    mode: req.user?.role === 'admin' ? 'admin' : 'user',
  });
});

// ===================================================================
// Mount ordersRouter sau các route /api/orders chính trong server.js
// để /api/orders tạo order dùng được customer snapshot từ Database,
// còn các route phụ trong routes/orders.js như item-price vẫn hoạt động.
app.use('/api/orders', ordersRouter);
// Chạy 1 lần khi backend khởi động để tự cập nhật đơn cũ
autoDoneOldOrdersByBusinessDay06();

// Kiểm tra định kỳ mỗi 5 phút
setInterval(autoDoneOldOrdersByBusinessDay06, 5 * 60 * 1000);

// Checkpoint nhẹ mỗi 10 phút để WAL không tăng liên tục.
// PASSIVE không chặn reader/writer đang hoạt động.
setInterval(() => {
  try {
    sqliteStore.checkpointWal?.('PASSIVE');
  } catch (error) {
    console.warn('[SQLite] WAL checkpoint failed:', error?.message || error);
  }
}, 10 * 60 * 1000);

// ====== AUTO ENQUEUE CUSTOMER API -> SQLITE ======
// Không quét tuần tự toàn bộ hơn 60.000 khách.
// Chỉ đưa khách hoạt động gần đây và dữ liệu đã cũ vào priority queue.
function getRecentCustomerCodesForAutoSync() {
  const cutoffMs = Date.now() - CUSTOMER_AUTO_SYNC_RECENT_DAYS * DAY_MS;
  const activity = new Map();

  for (const [codeRaw, member] of Object.entries(members || {})) {
    const code = cleanMemberId(codeRaw);
    if (!/^\d+$/.test(code)) continue;

    const atMs = Date.parse(
      member?.lastSeenAt || member?.updatedAt || member?.createdAt || ''
    );
    if (Number.isFinite(atMs) && atMs >= cutoffMs) {
      activity.set(code, Math.max(activity.get(code) || 0, atMs));
    }
  }

  for (const order of orders || []) {
    const code = cleanMemberId(order?.customer?.code || order?.memberCard || '');
    if (!/^\d+$/.test(code)) continue;

    const atMs = Date.parse(order?.createdAt || order?.updatedAt || '');
    if (!Number.isFinite(atMs) || atMs < cutoffMs) continue;
    activity.set(code, Math.max(activity.get(code) || 0, atMs));
  }

  return Array.from(activity.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([code]) => code);
}

function enqueueAutomaticCustomerDatabaseSync() {
  const globalErrorMs = Date.parse(customerApiHealth.lastErrorAt || '');
  if (
    ['OFFLINE', 'TIMEOUT'].includes(customerApiHealth.connectionStatus) &&
    Number.isFinite(globalErrorMs) &&
    Date.now() - globalErrorMs < CUSTOMER_API_RETRY_BACKOFF_MS
  ) {
    return {
      queued: 0,
      skipped: 0,
      reason: 'API_BACKOFF',
    };
  }

  const candidates = getRecentCustomerCodesForAutoSync();
  let queued = 0;
  let skipped = 0;

  for (const code of candidates) {
    if (queued >= CUSTOMER_AUTO_SYNC_ENQUEUE_SIZE) break;

    if (
      isMemberApiFresh(code) ||
      customerSyncQueue.has(code) ||
      customerSyncProcessing.has(code) ||
      customerApiInflight.has(code)
    ) {
      skipped += 1;
      continue;
    }

    const accepted = queueCustomerDatabaseSync(code, {
      force: false,
      priority: 30,
      by: 'automatic-recent-customer-sync',
      emit: false,
    });

    if (accepted) queued += 1;
    else skipped += 1;
  }

  if (queued > 0) scheduleCustomerSyncWorker(0);

  return {
    queued,
    skipped,
    totalCandidates: candidates.length,
    queueSize: customerSyncQueue.size,
  };
}

if (CUSTOMER_AUTO_SYNC_INTERVAL_MS > 0) {
  setTimeout(enqueueAutomaticCustomerDatabaseSync, 30 * 1000);
  setInterval(enqueueAutomaticCustomerDatabaseSync, CUSTOMER_AUTO_SYNC_INTERVAL_MS);
}

function checkCustomerEventAlarms() {
  try {
    const now = new Date();
    const nowMs = now.getTime();
    const lookBack = new Date(nowMs - 12 * 60 * 60 * 1000).toISOString();
    const lookAhead = new Date(nowMs + 48 * 60 * 60 * 1000).toISOString();

    const events = sqliteStore.listCustomerEvents({
      from: lookBack,
      to: lookAhead,
      status: ['PENDING', 'ACKNOWLEDGED', 'SNOOZED'],
      limit: 1000,
    });

    for (const ev of events) {
      const eventMs = Date.parse(ev.eventAt);
      const shiftMs = Date.parse(ev.shiftStartAt);
      const oneHourMs = eventMs - 60 * 60 * 1000;

      if (!Number.isFinite(eventMs)) continue;

      // Không nhắc event đã quá 6 tiếng
      if (nowMs > eventMs + 6 * 60 * 60 * 1000) continue;

      let alarmType = null;
      const patch = {};

      if (
        ev.status === 'SNOOZED' &&
        ev.snoozedUntil &&
        Date.parse(ev.snoozedUntil) <= nowMs &&
        !ev.lastSnoozeAlarmAt
      ) {
        alarmType = 'SNOOZE';
        patch.lastSnoozeAlarmAt = now.toISOString();
        patch.status = 'ACKNOWLEDGED';
      } else if (
        Number.isFinite(shiftMs) &&
        nowMs >= shiftMs &&
        nowMs < eventMs &&
        !ev.lastShiftAlarmAt
      ) {
        alarmType = 'SHIFT_START';
        patch.lastShiftAlarmAt = now.toISOString();
      } else if (
        nowMs >= oneHourMs &&
        nowMs < eventMs &&
        !ev.lastOneHourAlarmAt
      ) {
        alarmType = 'ONE_HOUR_BEFORE';
        patch.lastOneHourAlarmAt = now.toISOString();
      }

      if (!alarmType) continue;

      const updated = sqliteStore.updateCustomerEvent(ev.id, patch);

      io.emit('customerEventAlarm', eventPublicPayload({
        ...(updated || ev),
        alarmType,
        alarmAt: now.toISOString(),
      }));

      emitCustomerEventsUpdated(updated || ev);
    }
  } catch (e) {
    console.error('[Customer Event Alarm] error:', e.message);
  }
}

checkCustomerEventAlarms();
setInterval(checkCustomerEventAlarms, 60 * 1000);

// ====== Start ======
server.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Backend running on http://0.0.0.0:${PORT}`);
  console.log(`CORS origins: ${Array.isArray(allowOrigins) ? allowOrigins.join(', ') : allowOrigins}`);
});
