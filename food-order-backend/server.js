/**
 * server.js — Backend cho Food App
 * - Đăng nhập + phân quyền (Admin/Kitchen)
 * - Đồng bộ level theo menu (menu-levels.json)
 * - Ghi & xem lịch sử đổi trạng thái (status-history.json)
 * - Socket.IO realtime
 * Lưu ý: Các API message vẫn có thể là tiếng Việt, UI hiển thị tiếng Anh trên frontend.
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const server = http.createServer(app);

// ====== ENV & Đường dẫn ======
const PORT = process.env.PORT || 5000;
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const FOODS_JSON = path.join(DATA_DIR, 'foods.json');
const USERS_JSON = path.join(DATA_DIR, 'users.json');
const MENU_LEVELS_JSON = path.join(DATA_DIR, 'menu-levels.json');
const STATUS_HISTORY_JSON = path.join(DATA_DIR, 'status-history.json');

const PUBLIC_DIR = path.join(ROOT, 'public');
const IMAGES_DIR = path.join(PUBLIC_DIR, 'images');
const MULTER_TMP = path.join(ROOT, 'temp_uploads');

[DATA_DIR, PUBLIC_DIR, IMAGES_DIR, MULTER_TMP].forEach((p) => {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
});

const JWT_SECRET = process.env.JWT_SECRET || 'CHANGE_ME_DEV_SECRET';
const TOKEN_TTL = '7d';

// ====== CORS + Socket.IO ======
const allowOrigins = (() => {
  if (process.env.CORS_ORIGINS) return process.env.CORS_ORIGINS.split(',').map(s => s.trim());
  return '*';
})();
const io = new Server(server, {
  cors: { origin: allowOrigins, methods: ['GET', 'POST', 'DELETE'], credentials: false },
});


// ====== Middleware ======
app.use(cors({
  origin: allowOrigins,
  methods: ['GET', 'POST', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json({ limit: '4mb' }));
app.use('/images', express.static(path.join(PUBLIC_DIR, 'images')));

// ====== Dữ liệu: Foods ======
let foods = [];
try { if (fs.existsSync(FOODS_JSON)) foods = JSON.parse(fs.readFileSync(FOODS_JSON, 'utf-8') || '[]'); }
catch (e) { console.error('❌ Lỗi đọc foods.json:', e.message); foods = []; }
foods.forEach((f, i) => { if (typeof f.order !== 'number') f.order = i; });

function saveFoods() {
  const tmp = FOODS_JSON + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(foods, null, 2), 'utf-8');
  fs.renameSync(tmp, FOODS_JSON);
}
function nextNumericId() {
  const maxId = foods.reduce((m, f) => (Number.isFinite(f.id) ? Math.max(m, f.id) : m), 0);
  return maxId + 1;
}
function extractImageName(url) {
  try { return url.split('/').pop().toLowerCase(); } catch { return null; }
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

// ====== Dữ liệu: Menu Levels (đồng bộ level theo menu) ======
let menuLevels = {};
try { if (fs.existsSync(MENU_LEVELS_JSON)) menuLevels = JSON.parse(fs.readFileSync(MENU_LEVELS_JSON, 'utf-8') || '{}'); }
catch (e) { console.error('❌ Lỗi đọc menu-levels.json:', e.message); menuLevels = {}; }
function saveMenuLevels() {
  const tmp = MENU_LEVELS_JSON + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(menuLevels, null, 2), 'utf-8');
  fs.renameSync(tmp, MENU_LEVELS_JSON);
}

// ====== Dữ liệu: Lịch sử đổi trạng thái ======
let statusHistory = [];
try { if (fs.existsSync(STATUS_HISTORY_JSON)) statusHistory = JSON.parse(fs.readFileSync(STATUS_HISTORY_JSON, 'utf-8') || '[]'); }
catch (e) { console.error('❌ Lỗi đọc status-history.json:', e.message); statusHistory = []; }
function saveStatusHistory() {
  const tmp = STATUS_HISTORY_JSON + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(statusHistory, null, 2), 'utf-8');
  fs.renameSync(tmp, STATUS_HISTORY_JSON);
}
function addStatusHistory(entry) {
  statusHistory.push({ id: Date.now() + Math.random(), ...entry });
  if (statusHistory.length > 5000) statusHistory = statusHistory.slice(-5000);
  saveStatusHistory();
  io.emit('statusHistoryAdded', entry);
}

// ====== Auth helpers ======
function authenticateJWT(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  const token = auth.slice(7);
  jwt.verify(token, JWT_SECRET, (err, payload) => {
    if (err) return res.status(401).json({ error: 'Invalid token' });
    req.user = payload; // { sub, role }
    next();
  });
}
function authorizeRoles(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
    next();
  };
}

// ====== Upload ảnh (Multer) ======
const upload = multer({
  dest: MULTER_TMP,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!['.jpg', '.jpeg', '.png'].includes(ext)) return cb(new Error('Chỉ cho phép ảnh JPG/JPEG/PNG'));
    cb(null, true);
  },
});

// ==== App Version (đặt ngay sau khi khởi tạo io) ====
// Cách dễ nhất: lấy từ package.json + đóng dấu thời gian build
const APP_VERSION =
  process.env.APP_VERSION ||
  (require('./package.json').version + '-' + Math.floor(Date.now() / 1000));

io.on('connection', (socket) => {
  // Gửi version cho client ngay khi kết nối / reconnect
  socket.emit('appVersion', APP_VERSION);
});

// (tuỳ chọn) API kiểm tra version
app.get('/api/version', (_req, res) => res.json({ version: APP_VERSION }));

// (tuỳ chọn) Admin bắn version thủ công để ép reload (khi bạn muốn)
app.post('/api/broadcast-version',
  authenticateJWT, authorizeRoles('admin'),
  (_req, res) => { io.emit('appVersion', APP_VERSION); res.json({ ok: true }); }
);


// ====== Routes ======

// --- Đăng nhập ---
app.post('/api/login', (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: 'Thiếu username/password' });
    const user = users.find(u => u.username === username);
    if (!user) return res.status(401).json({ error: 'Sai thông tin đăng nhập' });
    const ok = bcrypt.compareSync(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: 'Sai thông tin đăng nhập' });

    const token = jwt.sign({ sub: user.username, role: user.role }, JWT_SECRET, { expiresIn: TOKEN_TTL });
    res.json({ token, role: user.role, username: user.username });
  } catch (e) {
    console.error('Login error:', e);
    res.status(500).json({ error: 'Login thất bại' });
  }
});

// --- Lấy danh sách món (public) ---
app.get('/api/foods', (_req, res) => {
  const sorted = [...foods].sort((a, b) => {
    const ao = typeof a.order === 'number' ? a.order : 0;
    const bo = typeof b.order === 'number' ? b.order : 0;
    if (ao !== bo) return ao - bo;
    return String(a.type || '').localeCompare(String(b.type || ''));
  });
  res.json(sorted);
});

// --- Upload ảnh (Admin) ---
app.post('/api/upload', authenticateJWT, authorizeRoles('admin'), upload.single('image'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'Không có ảnh được gửi' });
    const type = String(req.body.type || '').trim();
    if (!type) return res.status(400).json({ message: 'Thiếu type' });

    const folderName = type.toUpperCase();
    const destDir = path.join(IMAGES_DIR, folderName);
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

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

    const host = req.get('host');
    const protocol = req.protocol;
    const imageUrl = `${protocol}://${host}/images/${folderName}/${finalName}`;

    res.json({ imageUrl, hash });
  } catch (e) {
    console.error('Upload error:', e);
    res.status(500).json({ error: 'Upload thất bại' });
  }
});

// --- Thêm món (Admin) ---
app.post('/api/foods', authenticateJWT, authorizeRoles('admin'), (req, res) => {
  try {
    const { imageUrl, type, hash, levelAccess } = req.body;
    if (!imageUrl || !type || !hash) return res.status(400).json({ message: 'Thiếu trường' });

    if (foods.find(f => f.type === type && f.hash === hash))
      return res.status(409).json({ message: 'Đã tồn tại (hash trùng)' });
    if (foods.find(f => f.type === type && f.imageUrl === imageUrl))
      return res.status(409).json({ message: 'Đã tồn tại (URL trùng)' });

    // LevelAccess: ưu tiên client -> cấu hình server -> fallback
    const VALID = new Set(['P', 'I-I+', 'V-One']);
    let effective;

    if (Array.isArray(levelAccess)) {
      const cleaned = [...new Set(levelAccess.filter(lv => VALID.has(lv)))];
      if (cleaned.length > 0) effective = cleaned;
    }
    if (!effective || effective.length === 0) {
      const tkey = String(type || '').trim();
      const saved = menuLevels[tkey];
      if (Array.isArray(saved) && saved.length > 0) effective = saved.filter(lv => VALID.has(lv));
    }
    if (!effective || effective.length === 0) {
      const lower = String(type || '').trim().toLowerCase();
      effective = ['V-One'];
      if (['snack menu', 'snack travel', 'club menu'].includes(lower)) {
        effective = ['P', 'I-I+', 'V-One'];
      } else if (['hotel menu'].includes(lower)) {
        effective = ['I-I+', 'V-One'];
      }
    }

    const maxOrder = foods.reduce((m, f) => (typeof f.order === 'number' && f.order > m ? f.order : m), -1);
    const newFood = {
      id: nextNumericId(),
      imageUrl,
      type: type.trim(),
      status: 'Available',
      hash,
      levelAccess: effective,
      order: maxOrder + 1,
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

// --- Cập nhật trạng thái (Admin + Kitchen) + Ghi lịch sử ---
app.post('/api/update-status/:id', authenticateJWT, authorizeRoles('admin', 'kitchen'), (req, res) => {
  try {
    const foodId = Number(req.params.id);
    const { newStatus } = req.body;
    const target = foods.find(f => f.id === foodId);
    if (!target) return res.status(404).json({ message: 'Not found' });
    if (!['Available', 'Sold Out'].includes(newStatus)) return res.status(400).json({ message: 'Trạng thái không hợp lệ' });

    const prevStatus = target.status;
    const imageName = extractImageName(target.imageUrl);
    const updatedFoods = [];
    foods.forEach((f) => {
      if (extractImageName(f.imageUrl) === imageName) {
        f.status = newStatus;
        updatedFoods.push(f);
      }
    });

    saveFoods();

    // Ghi lịch sử (kèm imageUrl để frontend hiện ảnh trực tiếp)
    addStatusHistory({
      at: new Date().toISOString(),
      by: req.user?.sub || 'unknown',
      role: req.user?.role || 'unknown',
      imageName,
      imageUrl: target.imageUrl,   // 👈 thêm URL đầy đủ
      type: target.type,
      from: prevStatus,
      to: newStatus,
      count: updatedFoods.length,
      affectedIds: updatedFoods.map(f => f.id),
    });

    io.emit('foodStatusUpdated', { updatedFoods });
    res.json({ success: true });
  } catch (e) {
    console.error('Update status error:', e);
    res.status(500).json({ error: 'Cập nhật trạng thái thất bại' });
  }
});

// --- Đổi thứ tự (Admin) ---
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

// --- Xoá món (Admin) ---
app.delete('/api/foods/:id', authenticateJWT, authorizeRoles('admin'), (req, res) => {
  try {
    const foodId = Number(req.params.id);
    const idx = foods.findIndex(f => f.id === foodId);
    if (idx === -1) return res.status(404).json({ message: 'Không tìm thấy món ăn' });

    const removed = foods[idx];
    foods.splice(idx, 1);

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

// --- Áp dụng level theo menu (Admin) + lưu mặc định ---
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

// --- API Menu Levels ---
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

// --- API Lịch sử (Admin + Kitchen xem được) ---
app.get('/api/status-history', authenticateJWT, authorizeRoles('admin', 'kitchen'), (req, res) => {
  try {
    const { limit = 200, from, to, user, type, toStatus, fromStatus } = req.query;

    let list = [...statusHistory];
    if (from) { const t = new Date(from).getTime() || 0; list = list.filter(x => new Date(x.at).getTime() >= t); }
    if (to)   { const t = new Date(to).getTime()   || Date.now(); list = list.filter(x => new Date(x.at).getTime() <= t); }
    if (user) list = list.filter(x => (x.by || '').toLowerCase().includes(String(user).toLowerCase()));
    if (type) list = list.filter(x => (x.type || '').toLowerCase().includes(String(type).toLowerCase()));
    if (toStatus) list = list.filter(x => x.to === toStatus);
    if (fromStatus) list = list.filter(x => x.from === fromStatus);

    list.sort((a, b) => new Date(b.at) - new Date(a.at));
    res.json(list.slice(0, Number(limit) || 200));
  } catch (e) {
    console.error('GET /status-history error:', e);
    res.status(500).json({ error: 'Không lấy được lịch sử' });
  }
});

// ====== Start ======
server.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Backend running on http://0.0.0.0:${PORT}`);
  console.log(`CORS origins: ${Array.isArray(allowOrigins) ? allowOrigins.join(', ') : allowOrigins}`);
});
