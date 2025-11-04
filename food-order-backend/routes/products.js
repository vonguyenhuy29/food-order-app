// routes/products.js
const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const { parseFromImageFile } = require('../utils/fileParsing');

// ----- Auth stub (giữ như cũ — nếu có middleware riêng thì thay vào) -----
const authenticateJWT = (req, res, next) => next();
const authorizeRoles = (..._r) => (req, res, next) => next();

// ----- Đường dẫn dữ liệu / thư mục -----
const DATA_DIR          = path.join(__dirname, '..', 'data');
const PRODUCTS_FILE     = path.join(DATA_DIR, 'products.json');
const FOODS_FILE        = path.join(DATA_DIR, 'foods.json'); // dữ liệu User/Admin dùng
const IMAGES_DIR        = path.join(__dirname, '..', 'public', 'images');
const GROUPS_FILE       = path.join(DATA_DIR, 'groups.json'); // (legacy) — KHÔNG còn dùng làm Menu
const ITEM_GROUPS_FILE  = path.join(DATA_DIR, 'item-groups.json'); // ★ mới
const VERSION_FILE      = path.join(DATA_DIR, 'version.json');
const MENU_LEVELS_FILE  = path.join(DATA_DIR, 'menu-levels.json');

// cấp độ hợp lệ dùng cho menu-levels
const VALID_LEVELS = ['P', 'I-I+', 'V-One'];

// Chuẩn hóa tên menu: bỏ khoảng trắng thừa, so khớp không phân biệt hoa/thường
const normMenu = (s) => String(s || '').trim().replace(/\s+/g, ' ');
const canonMenu = (s) => normMenu(s).toUpperCase();

// ----- Danh sách MENU cố định dùng cho Admin/User -----
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

// ----- Danh sách NHÓM HÀNG mặc định -----
const DEFAULT_ITEM_GROUPS = [

  'Beverage',
  'Chinese',
  'Dessert & Savoury',
  'HOTEL',
  'Japanese',
  'Korea',
  'Snack Menu',
].map((name, idx) => ({ name, order: idx + 1 }));

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(IMAGES_DIR)) fs.mkdirSync(IMAGES_DIR, { recursive: true });

// ===== Utilities =====
function bumpVersion(req) {
  let v = { ts: Date.now() };
  try { v = JSON.parse(fs.readFileSync(VERSION_FILE, 'utf8')); } catch {}
  v.ts = Date.now();
  fs.writeFileSync(VERSION_FILE, JSON.stringify(v, null, 2));

  const io = req?.app?.locals?.io || req?.app?.get?.('io');
  if (io) io.emit('appVersion', v.ts);
}

function readJson(p, fallback = []) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}
function writeJson(p, data) { fs.writeFileSync(p, JSON.stringify(data, null, 2)); }

// (legacy) groups.json — vẫn giữ cho tương thích, nhưng KHÔNG dùng làm Menu nữa
function readGroups() { try { return JSON.parse(fs.readFileSync(GROUPS_FILE, 'utf8')); } catch { return []; } }
function writeGroups(list) { fs.writeFileSync(GROUPS_FILE, JSON.stringify(list, null, 2)); }

// ★ item-groups.json — NHÓM HÀNG (mới)
function ensureItemGroupsFile() {
  if (!fs.existsSync(ITEM_GROUPS_FILE)) {
    writeJson(ITEM_GROUPS_FILE, DEFAULT_ITEM_GROUPS);
  }
}
function readItemGroups() { ensureItemGroupsFile(); return readJson(ITEM_GROUPS_FILE, DEFAULT_ITEM_GROUPS); }
function writeItemGroups(list) { writeJson(ITEM_GROUPS_FILE, list); }
function isReservedAll(name) { return String(name || '').trim().toLowerCase() === 'tất cả'; }

function assertSafeGroup(name) {
  const n = String(name || '').trim();
  if (!n) return n;
  if (/[\/\\]/.test(n) || n.includes('..')) throw new Error('Invalid group name');
  if (n.length > 80) throw new Error('Group name too long');
  return n;
}
function assertSafeImageName(name) {
  const base = path.basename(String(name || ''));
  if (!base || base !== name) throw new Error('Invalid imageName');
  if (/[\/\\]/.test(base) || base.includes('..')) throw new Error('Invalid imageName');
  return base;
}
const basenameLower = (p) => (String(p || '').split('/').pop() || '').toLowerCase();
function canonicalMenuName(name) {
  const s = String(name || '').trim();
  if (!s) return '';
  const norm = s.replace(/\s+/g, '').toLowerCase();
  const hit = MENU_TYPES.find(m => m.replace(/\s+/g,'').toLowerCase() === norm);
  return hit || s.toUpperCase();
}
const menuFolderOf = (menu) => canonicalMenuName(menu).toUpperCase();

function readMenuLevels() {
  try { return JSON.parse(fs.readFileSync(MENU_LEVELS_FILE, 'utf8')); } catch { return {}; }
}

// foods.json helpers
function readFoods() { return readJson(FOODS_FILE, []); }
function writeFoods(list) { writeJson(FOODS_FILE, list); }
function nextFoodId(list) {
  const max = list.reduce((m, f) => Number.isFinite(f.id) ? Math.max(m, f.id) : m, 0);
  return max + 1;
}
function sortAndNormalizeOrders(list) {
  list.sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).forEach((f, i) => f.order = i);
}

// tìm đường dẫn file ảnh bất kỳ theo imageName
function findAnyImagePath(imageName, products) {
  // 1) từ foods.json
  const foods = readFoods();
  const byName = foods.find(f => basenameLower(f.imageUrl) === String(imageName).toLowerCase());
  if (byName) {
    const rel = (String(byName.imageUrl || '').split('/images/')[1] || '').replace(/^\/+/, '');
    const abs = path.join(IMAGES_DIR, rel);
    if (fs.existsSync(abs)) return abs;
  }
  // 2) từ products.json
  const p = (products || []).find(x => (x.imageName || '').toLowerCase() === String(imageName).toLowerCase());
  if (p?.imageUrl) {
    const rel = (String(p.imageUrl || '').split('/images/')[1] || '').replace(/^\/+/, '');
    const abs = path.join(IMAGES_DIR, rel);
    if (fs.existsSync(abs)) return abs;
  }
  // 3) fallback: quét thư mục images/**
  const target = String(imageName).toLowerCase();
  const stack = [IMAGES_DIR];
  while (stack.length) {
    const dir = stack.pop();
    const ents = fs.readdirSync(dir, { withFileTypes: true });
    for (const ent of ents) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) stack.push(full);
      else if (ent.isFile() && ent.name.toLowerCase() === target) return full;
    }
  }
  return null;
}

function getMenusOfImage(imageName) {
  const foods = readFoods();
  const name = String(imageName || '').toLowerCase();
  const menus = new Set(
    foods
      .filter(f => basenameLower(f.imageUrl) === name)
      .map(f => canonicalMenuName(f.type))
      .filter(Boolean)
  );
  return Array.from(menus);
}

function syncMenusForImage(req, imageName, targetMenus = []) {
  const io = req?.app?.locals?.io || req?.app?.get?.('io');

  const desired = [...new Set((targetMenus || []).map(normMenu).filter(Boolean))]; // lưu bản "đẹp" để hiển thị/type
  const foods = readFoods();
  const products = readJson(PRODUCTS_FILE, []);
  const current = getMenusOfImage(imageName);

  // So khớp theo canonical (không phân biệt hoa/thường, gom space)
  const desiredCanon = new Set(desired.map(canonicalMenuName));
  const currentCanon = new Set(current.map(canonicalMenuName));

  const toAdd    = desired.filter(m => !currentCanon.has(canonicalMenuName(m)));
  const toRemove = current.filter(m => !desiredCanon.has(canonicalMenuName(m)));

  if (toAdd.length === 0 && toRemove.length === 0) {
    return { ok: true, added: 0, removed: 0, before: current, after: current };
  }
  if (process.env.NODE_ENV !== 'production') {
    console.log('[menu-sync]', { imageName, desired, current, toAdd, toRemove });
  }

  // lấy trạng thái tham chiếu
  let ref = foods.find(f => basenameLower(f.imageUrl) === String(imageName).toLowerCase());
  const refQty = Math.max(0, Number(ref?.quantity ?? 1));
  const refStatus = refQty <= 0 ? 'Sold Out' : (ref?.status || 'Available');

  // level access mặc định theo menu-levels.json
  const menuLevels = readMenuLevels();
  const VALID = new Set(['P', 'I-I+', 'V-One']);

  // nguồn ảnh
  const srcAbs = findAnyImagePath(imageName, products);

  // ---- ADD ----
  const addedIds = [];
  for (const menu of toAdd) {
    const folder = menuFolderOf(menu);
    const destDir = path.join(IMAGES_DIR, folder);
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
    const destAbs = path.join(destDir, imageName);
    if (!fs.existsSync(destAbs)) {
      if (!srcAbs) throw new Error(`Không tìm thấy ảnh nguồn cho ${imageName}`);
      try { fs.copyFileSync(srcAbs, destAbs); } catch {}
    }

    const id = nextFoodId(foods);
    const maxOrder = foods.reduce((m, f) => Number.isFinite(f.order) ? Math.max(m, f.order) : m, -1);
    const key = canonicalMenuName(menu);
    const lv  = Array.isArray(menuLevels[key]) ? menuLevels[key].filter(x => VALID.has(x)) : ['V-One'];

    const imageUrl = path.posix.join('/images', folder, imageName);

    const newFood = {
      id,
      imageUrl,
      type: canonicalMenuName(menu),
      status: refStatus,
      hash: undefined,
      levelAccess: lv.length ? lv : ['V-One'],
      order: maxOrder + 1,
      quantity: refQty || (refStatus === 'Sold Out' ? 0 : 1),
    };
    foods.push(newFood);
    addedIds.push(id);
    if (io) io.emit('foodAdded', newFood);
  }

  // ---- REMOVE (an toàn & đúng menu) ----
  let removed = 0;
  for (const menu of toRemove) {
    const idx = foods.findIndex(f =>
      canonicalMenuName(f.type) === menu &&
      basenameLower(f.imageUrl) === String(imageName).toLowerCase()
    );
    if (idx >= 0) {
      const removedFood = foods[idx];
      foods.splice(idx, 1);
      removed++;

      // Luôn xoá file ở đúng thư mục của MENU đang bỏ
      const folderOfRemovedMenu = menuFolderOf(menu); // ví dụ: 'SNACK TRAVEL'
      const absFileOfRemovedMenu = path.join(IMAGES_DIR, folderOfRemovedMenu, imageName);
      if (fs.existsSync(absFileOfRemovedMenu)) {
        try { fs.unlinkSync(absFileOfRemovedMenu); } catch {}
      }

      // Nếu ảnh này KHÔNG còn được dùng bởi bất kỳ menu nào nữa, dọn sạch mọi bản copy rải rác
      const stillUseByName = foods.some(f => basenameLower(f.imageUrl) === String(imageName).toLowerCase());
      if (!stillUseByName) {
        for (const t of MENU_TYPES) {
          const abs = path.join(IMAGES_DIR, menuFolderOf(t), imageName);
          if (fs.existsSync(abs)) { try { fs.unlinkSync(abs); } catch {} }
        }
      }

      if (io) io.emit('foodDeleted', { id: removedFood.id });
    }
  }

  sortAndNormalizeOrders(foods);
  writeFoods(foods);
  bumpVersion(req);

  const after = getMenusOfImage(imageName);
  return { ok: true, added: addedIds.length, removed, before: current, after, addedIds };
}

// ====== API gốc (giữ nguyên phần sản phẩm, bỏ “reportGroup”, thêm “itemGroup”) ======

router.get('/', authenticateJWT, authorizeRoles('admin'), (req, res) => {
  let { q = '', type = '', group = '', itemGroup = '', sort = 'name', dir = 'asc', page = 1, limit = 200 } = req.query;
  page = +page; limit = +limit;
  const list = readJson(PRODUCTS_FILE, []);

  const qq = q.toLowerCase();
  let rows = list.filter(x => (
    (!type || (x.menuType || '').toLowerCase() === type.toLowerCase()) &&
    (!group || (x.group || '').toLowerCase() === group.toLowerCase()) &&
    (!itemGroup || (x.itemGroup || '').toLowerCase() === itemGroup.toLowerCase()) &&
    (!q || ((x.name + ' ' + x.productCode + ' ' + (x.imageName || '')).toLowerCase().includes(qq)))
  ));

  if (sort === 'price') {
    rows.sort((a, b) => (dir === 'desc' ? (+(b.price || 0) - +(a.price || 0)) : (+(a.price || 0) - +(b.price || 0))));
  } else {
    rows.sort((a, b) => {
      const A = (a[sort] ?? '').toString().toLowerCase();
      const B = (b[sort] ?? '').toString().toLowerCase();
      return dir === 'desc' ? (A > B ? -1 : A < B ? 1 : 0) : (A > B ? 1 : A < B ? -1 : 0);
    });
  }

  const total = rows.length, start = (page - 1) * limit;
  res.json({ total, rows: rows.slice(start, start + limit) });
});

// Thêm mới sản phẩm (bổ sung itemGroup; bỏ reportGroup)
router.post('/', authenticateJWT, authorizeRoles('admin'), (req, res) => {
  const items = readJson(PRODUCTS_FILE, []);
  const p = { ...req.body }; // {productCode,name,menuType,groups,price,imageName,imageUrl, itemGroup?}

  try {
    if (p.group) p.group = assertSafeGroup(p.group);
    if (p.imageName) p.imageName = assertSafeImageName(p.imageName);
    if (p.itemGroup) p.itemGroup = assertSafeGroup(p.itemGroup);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  // Parse mặc định từ imageName
  if ((!p.productCode || !p.name) && p.imageName) {
    const { productCode, name } = parseFromImageFile(p.imageName);
    if (!p.productCode) p.productCode = productCode;
    if (!p.name) p.name = name;
  }

  if (!p.menuType) p.menuType = 'đồ ăn';

  if (!p.imageUrl && p.imageName && p.group) {
    p.imageUrl = path.posix.join('/images', p.group, p.imageName);
  }

  // Chuẩn hoá itemGroup: không cho gán "Tất cả"
  if (p.itemGroup && isReservedAll(p.itemGroup)) p.itemGroup = null;

  p.id = p.id || p.imageName;
  p.createdAt = Date.now(); p.updatedAt = Date.now();

  if (items.find(x => x.id === p.id)) return res.status(409).json({ error: 'Product exists' });

  items.push(p);
  writeJson(PRODUCTS_FILE, items);

  // KHÔNG auto tạo foods từ products — sync menu làm riêng
  bumpVersion(req);
  res.json(p);
});

// Sửa sản phẩm (bổ sung itemGroup; bỏ reportGroup)
router.put('/:id', authenticateJWT, authorizeRoles('admin'), (req, res) => {
  const items = readJson(PRODUCTS_FILE, []);
  const id = req.params.id;
  const i = items.findIndex(x => x.id === id);
  if (i < 0) return res.status(404).json({ error: 'Not found' });

  const patch = { ...req.body };
  try {
    if (patch.group) patch.group = assertSafeGroup(patch.group);
    if (patch.imageName) patch.imageName = assertSafeImageName(patch.imageName);
    if (patch.itemGroup) patch.itemGroup = assertSafeGroup(patch.itemGroup);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  // Không cho đặt "Tất cả" làm itemGroup
  if (patch.itemGroup && isReservedAll(patch.itemGroup)) patch.itemGroup = null;

  items[i] = { ...items[i], ...patch, id, updatedAt: Date.now() };
  if (!items[i].menuType) items[i].menuType = 'đồ ăn';

  if (!items[i].imageUrl && items[i].imageName && items[i].group) {
    items[i].imageUrl = path.posix.join('/images', items[i].group, items[i].imageName);
  }

  writeJson(PRODUCTS_FILE, items);
  bumpVersion(req);
  res.json(items[i]);
});

// Quét ảnh có sẵn (giữ nguyên)
router.post('/bootstrap-from-images', authenticateJWT, authorizeRoles('admin'), (req, res) => {
  const { defaultMenuType = '', defaultGroup = '' } = req.body || {};
  const items = readJson(PRODUCTS_FILE, []);
  const exists = new Map(items.map(x => [x.id, x]));
  let created = 0;

  function walk(dir, groupName) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) { walk(full, groupName || ent.name); continue; }
      if (!/\.(jpg|jpeg|png|webp)$/i.test(ent.name)) continue;

      const imageName = ent.name;
      const { productCode, name } = parseFromImageFile(imageName);
      const relDir = path.relative(IMAGES_DIR, path.dirname(full));
      const group = groupName || relDir || defaultGroup || '';
      const imageUrl = path.posix.join('/images', relDir.split(path.sep).join('/'), imageName);
      const id = imageName;

      if (!exists.has(id)) {
        const p = {
          id, productCode, name,
          menuType: defaultMenuType || 'đồ ăn',
          group, price: 0,
          imageName, imageUrl,
          createdAt: Date.now(), updatedAt: Date.now(),
        };
        items.push(p); exists.set(id, p);
        created++;
      }
    }
  }

  walk(IMAGES_DIR, '');
  writeJson(PRODUCTS_FILE, items);
  bumpVersion(req);
  res.json({ ok: true, created, total: items.length });
});

// Refresh codes (giữ nguyên)
router.post('/refresh-codes', authenticateJWT, authorizeRoles('admin'), (req, res) => {
  const items = readJson(PRODUCTS_FILE, []);
  let updated = 0, filled = 0;
  for (const it of items) {
    const { productCode, name } = parseFromImageFile(it.imageName || it.id || '');
    if (it.productCode !== productCode) { it.productCode = productCode; updated++; }
    if ((!it.name || !it.name.trim()) && name) { it.name = name; filled++; }
    if (!it.menuType) it.menuType = 'đồ ăn';
    it.updatedAt = Date.now();
  }
  writeJson(PRODUCTS_FILE, items);
  res.json({ ok: true, updatedCodes: updated, filledNames: filled, total: items.length });
});

// Ảnh chưa gắn product (giữ nguyên)
router.get('/list-images', authenticateJWT, authorizeRoles('admin'), (req, res) => {
  const items = readJson(PRODUCTS_FILE, []);
  const exists = new Set(items.map(x => (x.imageName || '').toLowerCase()));
  const out = [];
  function walk(dir, groupName) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) { walk(full, groupName || ent.name); continue; }
      if (!/\.(jpg|jpeg|png|webp)$/i.test(ent.name)) continue;
      const imageName = ent.name;
      if (exists.has(imageName.toLowerCase())) continue;
      const relDir = path.relative(IMAGES_DIR, path.dirname(full));
      const imageUrl = path.posix.join('/images', relDir.split(path.sep).join('/'), imageName);
      out.push({ imageName, imageUrl, group: groupName || relDir });
    }
  }
  walk(IMAGES_DIR, '');
  res.json(out);
});

// (legacy) Groups API — vẫn để nguyên cho ai đang dùng, nhưng KHÔNG còn là “Menu”
router.get('/groups', authenticateJWT, authorizeRoles('admin'), (req, res) => {
  const groups = readGroups().sort((a, b) => (a.order || 999) - (b.order || 999) || a.name.localeCompare(b.name));
  res.json(groups);
});
router.post('/groups', authenticateJWT, authorizeRoles('admin'), (req, res) => {
  let { name } = req.body || {};
  try { name = assertSafeGroup(name || ''); } catch (err) { return res.status(400).json({ error: err.message }); }
  if (!name) return res.status(400).json({ error: 'Tên nhóm không được trống' });

  const groups = readGroups();
  if (groups.find(g => g.name.toLowerCase() === name.toLowerCase())) {
    return res.status(409).json({ error: 'Nhóm đã tồn tại' });
  }
  const order = Math.max(0, ...groups.map(g => +g.order || 0)) + 1;
  const newG = { name, order };
  groups.push(newG);
  writeGroups(groups);

  const io = req.app?.locals?.io || req.app?.get?.('io');
  if (io) io.emit('productGroupsUpdated');

  bumpVersion(req);
  res.json(newG);
});
// ===== ITEM-GROUPS (Nhóm hàng) =====

// GET /api/products/item-groups
router.get('/item-groups', authenticateJWT, authorizeRoles('admin'), (_req, res) => {
  try {
    const list = readItemGroups()
      .sort((a, b) => (a.order || 999) - (b.order || 999) || a.name.localeCompare(b.name));
    res.json(list);
  } catch (e) {
    res.status(500).json({ error: e?.message || 'Read item-groups failed' });
  }
});

// POST /api/products/item-groups {name}
router.post('/item-groups', authenticateJWT, authorizeRoles('admin'), (req, res) => {
  try {
    let { name } = req.body || {};
    name = assertSafeGroup(name || '');
    if (!name) return res.status(400).json({ error: 'Tên nhóm không được trống' });
    if (isReservedAll(name)) return res.status(400).json({ error: 'Không thể tạo nhóm "Tất cả"' });

    const list = readItemGroups();
    if (list.find(g => g.name.toLowerCase() === name.toLowerCase())) {
      return res.status(409).json({ error: 'Nhóm đã tồn tại' });
    }
    const order = Math.max(0, ...list.map(g => +g.order || 0)) + 1;
    const newG = { name, order };
    list.push(newG);
    writeItemGroups(list);

    const io = req.app?.locals?.io || req.app?.get?.('io');
    if (io) io.emit('productGroupsUpdated');

    bumpVersion(req);
    res.json(newG);
  } catch (e) {
    res.status(500).json({ error: e?.message || 'Create item-group failed' });
  }
});

// DELETE /api/products/item-groups/:name?reassign=
router.delete('/item-groups/:name', authenticateJWT, authorizeRoles('admin'), (req, res) => {
  try {
    const raw = req.params.name || '';
    const name = assertSafeGroup(raw);
    if (!name) return res.status(400).json({ error: 'Thiếu tên nhóm' });
    if (isReservedAll(name)) return res.status(400).json({ error: 'Không thể xóa nhóm "Tất cả"' });

    const list = readItemGroups();
    const remain = list.filter(g => g.name.toLowerCase() !== name.toLowerCase());
    if (remain.length === list.length) {
      return res.status(404).json({ error: 'Nhóm không tồn tại' });
    }
    writeItemGroups(remain);

    // Tùy chọn: chuyển các product đang gắn itemGroup này sang null hoặc nhóm khác
    const { reassign = '' } = req.query || {};
    const items = readJson(PRODUCTS_FILE, []);
    let changed = 0;
    for (const it of items) {
      if ((it.itemGroup || '').toLowerCase() === name.toLowerCase()) {
        it.itemGroup = reassign && !isReservedAll(reassign) ? reassign : null;
        it.updatedAt = Date.now();
        changed++;
      }
    }
    writeJson(PRODUCTS_FILE, items);

    const io = req.app?.locals?.io || req.app?.get?.('io');
    if (io) io.emit('productGroupsUpdated');

    bumpVersion(req);
    res.json({ ok: true, removed: 1, reassignedProducts: changed });
  } catch (e) {
    res.status(500).json({ error: e?.message || 'Delete item-group failed' });
  }
});

// Bulk update/delete (giữ nguyên; không đụng itemGroup ngoài patch trực tiếp)
router.post('/bulk-update', authenticateJWT, authorizeRoles('admin'), (req, res) => {
  const { ids = [], patch = {} } = req.body || {};
  if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'ids rỗng' });

  try {
    if (patch.group) patch.group = assertSafeGroup(patch.group);
    if (patch.imageName) patch.imageName = assertSafeImageName(patch.imageName);
    if (patch.itemGroup) patch.itemGroup = assertSafeGroup(patch.itemGroup);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  if (patch.itemGroup && isReservedAll(patch.itemGroup)) patch.itemGroup = null;

  const items = readJson(PRODUCTS_FILE, []);
  let updated = 0;
  for (const id of ids) {
    const i = items.findIndex(x => x.id === id);
    if (i < 0) continue;
    items[i] = { ...items[i], ...patch, updatedAt: Date.now() };
    if (!items[i].menuType) items[i].menuType = 'đồ ăn';
    if (!items[i].imageUrl && items[i].imageName && items[i].group) {
      items[i].imageUrl = path.posix.join('/images', items[i].group, items[i].imageName);
    }
    updated++;
  }
  writeJson(PRODUCTS_FILE, items);
  bumpVersion(req);
  res.json({ ok: true, updated });
});

router.post('/bulk-delete', authenticateJWT, authorizeRoles('admin'), (req, res) => {
  const { ids = [], removeFood = false } = req.body || {};
  if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'ids rỗng' });

  const items = readJson(PRODUCTS_FILE, []);
  const remain = items.filter(x => !ids.includes(x.id));
  const removed = items.length - remain.length;
  writeJson(PRODUCTS_FILE, remain);

  if (removeFood) {
    const foods = readJson(FOODS_FILE, []);
    const idsLower = new Set(ids.map(x => String(x).toLowerCase()));
    const removedFoodIds = [];
    const remainFoods = foods.filter(f => {
      const byId  = idsLower.has(String(f.id).toLowerCase());
      const byImg = idsLower.has(basenameLower(f.imageUrl));
      if (byId || byImg) { removedFoodIds.push(f.id); return false; }
      return true;
    });
    writeJson(FOODS_FILE, remainFoods);

    const io = req.app?.locals?.io || req.app?.get?.('io');
    if (io && removedFoodIds.length) io.emit('foodsDeleted', { ids: removedFoodIds });
  }

  bumpVersion(req);
  res.json({ ok: true, removed });
});

// ====== NEW: MENU MEMBERSHIP APIs (giữ nguyên để không ảnh hưởng UI cũ) ======

// Map toàn cục imageName -> [menus]
router.get('/menu-map', authenticateJWT, authorizeRoles('admin'), (_req, res) => {
  const foods = readFoods();
  const map = {};
  for (const f of foods) {
    const img = basenameLower(f.imageUrl);
    if (!img) continue;
    if (!map[img]) map[img] = [];
    const t = canonicalMenuName(f.type);
if (t && !map[img].includes(t)) map[img].push(t);
  }
  res.json(map);
});

// Lấy menu của 1 ảnh
router.get('/menu-memberships', authenticateJWT, authorizeRoles('admin'), (req, res) => {
  const imageName = assertSafeImageName(req.query.imageName || '');
  if (!imageName) return res.status(400).json({ error: 'Thiếu imageName' });
  const menus = getMenusOfImage(imageName);
  res.json({ imageName, menus });
});

// Gán/bỏ menu cho 1 ảnh
router.post('/menu-memberships', authenticateJWT, authorizeRoles('admin'), (req, res) => {
  try {
    let { imageName, menus } = req.body || {};
    if (!imageName) return res.status(400).json({ error: 'Thiếu imageName' });
    if (!Array.isArray(menus)) menus = menus ? [menus] : [];
    const safeName = assertSafeImageName(imageName);
    const out = syncMenusForImage(req, safeName, menus);
    res.json(out);
  } catch (e) {
    res.status(500).json({ error: e?.message || 'Sync menu failed' });
  }
});
function applyLevelsToFoodsAndBroadcast(req, canonType, finalLevels) {
  const foods = readFoods();
  let updated = 0;

  for (const f of foods) {
    if (canonicalMenuName(f.type) === canonType) {
      f.levelAccess = finalLevels;  // có thể là []
      updated++;
    }
  }
  writeFoods(foods);

  const io = req.app?.locals?.io || req.app?.get?.('io');
  if (io) {
    io.emit('foodLevelsUpdated', { type: canonType });
    io.emit('menuLevelsUpdated', { type: canonType, levelAccess: finalLevels });
  }
  bumpVersion(req);
  return updated;
}

// === UPDATE LEVELS BY TYPE === (giữ nguyên)
router.post('/update-levels-by-type', authenticateJWT, authorizeRoles('admin'), (req, res) => {
  const { type, levelAccess } = req.body || {};
  if (!type || !Array.isArray(levelAccess)) {
    return res.status(400).json({ error: 'Thiếu type hoặc levelAccess' });
  }

  // Chuẩn hoá tên menu (giữ tương thích với MENU_TYPES nếu trùng chuẩn hoá)
  const canonType = canonicalMenuName(type);

  // Lọc level hợp lệ
const finalLevels = [...new Set((levelAccess || []).filter(lv => VALID_LEVELS.includes(lv)))];

  // 1) Cập nhật map mặc định ở data/menu-levels.json
  const menuLevels = readMenuLevels();
  menuLevels[canonType] = finalLevels;
  writeJson(MENU_LEVELS_FILE, menuLevels);

  // 2) Áp xuống foods + broadcast
  const updated = applyLevelsToFoodsAndBroadcast(req, canonType, finalLevels);
  res.json({ ok: true, type: canonType, updated, levelAccess: finalLevels });
});


// === REPAIR: copy ảnh còn thiếu sang thư mục menu tương ứng ===
router.post('/repair-food-images', authenticateJWT, authorizeRoles('admin'), (req, res) => {
  const foods = readFoods();
  const products = readJson(PRODUCTS_FILE, []);
  let fixed = 0;
  const missing = [];

  for (const f of foods) {
    const imgName = basenameLower(f.imageUrl);
    if (!imgName) continue;

    const folder = menuFolderOf(f.type); // thư mục theo tên menu (UPPERCASE)
    const destDir = path.join(IMAGES_DIR, folder);
    const destAbs = path.join(destDir, imgName);

    if (!fs.existsSync(destAbs)) {
      const srcAbs = findAnyImagePath(imgName, products);
      if (srcAbs && fs.existsSync(srcAbs)) {
        if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
        try { fs.copyFileSync(srcAbs, destAbs); fixed++; } catch { /* ignore */ }
      } else {
        missing.push(imgName);
      }
    }
  }

  bumpVersion(req);
  res.json({ ok: true, fixed, missing });
});

// === REPAIR (1): chuẩn hoá type/imageUrl và bảo đảm ảnh nằm đúng thư mục menu ===
router.post('/repair-food-records', authenticateJWT, authorizeRoles('admin'), (req, res) => {
  const foods = readFoods();
  const products = readJson(PRODUCTS_FILE, []);
  let fixed = 0, moved = 0;

  for (const f of foods) {
    const imgName = basenameLower(f.imageUrl);
    const wantType = canonicalMenuName(f.type);
    const wantFolder = menuFolderOf(wantType);
    const wantUrl = path.posix.join('/images', wantFolder, imgName);

    if (f.type !== wantType) { f.type = wantType; fixed++; }
    const destAbs = path.join(IMAGES_DIR, wantFolder, imgName);
    if (!fs.existsSync(destAbs)) {
      const srcAbs = findAnyImagePath(imgName, products);
      if (srcAbs) {
        const dir = path.dirname(destAbs);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        try { fs.copyFileSync(srcAbs, destAbs); moved++; } catch {}
      }
    }
    if (f.imageUrl !== wantUrl) { f.imageUrl = wantUrl; fixed++; }
  }

  sortAndNormalizeOrders(foods);
  writeFoods(foods);
  bumpVersion(req);
  res.json({ ok:true, fixed, moved });
});

// --- DEBUG ONLY ---
router.get('/_debug-probe', (req, res) => {
  const sampleA = menuFolderOf('SNACK MENU');    // kỳ vọng "SNACK MENU"
  const sampleB = menuFolderOf('SNACK TRAVEL');  // kỳ vọng "SNACK TRAVEL"
  res.json({
    ok: true,
    now: Date.now(),
    sampleA, sampleB,
    hasRepairRecords: !!router.stack.find(l => l.route && l.route.path === '/repair-food-records'),
    hasRepairImages: !!router.stack.find(l => l.route && l.route.path === '/repair-food-images'),
  });
});
// ====== MENU TYPES & LEVELS (cho Quản lý) ======


// Hợp nhất các "type" hiện có từ foods + keys menu-levels
function getAllMenuTypesProducts() {
  const foods = readFoods();
  const fromFoods = Array.from(new Set(
    foods.map(f => canonicalMenuName(f.type)).filter(Boolean)
  ));
  const levelKeys = Object.keys(readMenuLevels() || {});
  // Gộp cả MENU_TYPES mặc định để luôn có đủ lựa chọn
  return Array.from(new Set([...MENU_TYPES, ...fromFoods, ...levelKeys])).sort();
}

// GET /api/products/menu-types
router.get('/menu-types', authenticateJWT, authorizeRoles('admin'), (_req, res) => {
  res.json(getAllMenuTypesProducts());
});

// GET /api/products/menu-levels
router.get('/menu-levels', authenticateJWT, authorizeRoles('admin'), (_req, res) => {
    const raw = readMenuLevels() || {};
  const out = {};
  for (const k of Object.keys(raw)) out[canonicalMenuName(k)] = raw[k];
  res.json(out);
});

// POST /api/products/menu-levels
router.post('/menu-levels', authenticateJWT, authorizeRoles('admin'), (req, res) => {
  try {
    const { type, levelAccess } = req.body || {};
    if (!type) return res.status(400).json({ error: 'Thiếu type' });
    if (!Array.isArray(levelAccess)) return res.status(400).json({ error: 'levelAccess phải là mảng' });

const cleaned = [...new Set((levelAccess || []).filter(lv => VALID_LEVELS.includes(lv)))];

    const typeKey = canonicalMenuName(type);
    const all = readMenuLevels();
    all[typeKey] = cleaned;
    writeJson(MENU_LEVELS_FILE, all);

    // Áp xuống foods + broadcast (để User thấy ngay)
    const updated = applyLevelsToFoodsAndBroadcast(req, typeKey, cleaned);
    return res.json({ ok: true, type: typeKey, levelAccess: cleaned, updated });
  } catch (e) {
    return res.status(500).json({ error: 'Lưu level menu thất bại' });
  }
});
// === CREATE MENU TYPE ===
// POST /api/products/menu-types { type, levelAccess? }
router.post('/menu-types', authenticateJWT, authorizeRoles('admin'), (req, res) => {
  try {
    const { type, levelAccess } = req.body || {};
    if (!type) return res.status(400).json({ error: 'Thiếu type' });

    // Chuẩn hóa tên loại thực đơn
    const typeKey = canonicalMenuName(type);

    // Kiểm tra trùng: đã tồn tại trong foods, trong keys menu-levels hoặc danh sách mặc định
    const allTypes = getAllMenuTypesProducts(); // đã có sẵn func này ở file
    if (allTypes.some(t => canonicalMenuName(t) === typeKey)) {
      return res.status(409).json({ error: 'Loại thực đơn đã tồn tại' });
    }

    // Level mặc định: nếu không truyền thì dùng tất cả level hợp lệ
    const cleaned = [...new Set((Array.isArray(levelAccess) ? levelAccess : VALID_LEVELS)
                   .filter(lv => VALID_LEVELS.includes(lv)))];

    // Ghi vào data/menu-levels.json
    const all = readMenuLevels();
    all[typeKey] = cleaned;
    writeJson(MENU_LEVELS_FILE, all);

    // Broadcast để UI cập nhật ngay (áp xuống foods nếu có món cùng type — thường chưa có)
    applyLevelsToFoodsAndBroadcast(req, typeKey, cleaned);

    res.json({ ok: true, type: typeKey, levelAccess: cleaned });
  } catch (e) {
    res.status(500).json({ error: e?.message || 'Create menu-type failed' });
  }
});


// === DELETE MENU TYPE ===
// DELETE /api/products/menu-types/:type
// Chỉ cho xóa khi chưa có bất kỳ food nào thuộc type này (tránh rác dữ liệu/ảnh)
router.delete('/menu-types/:type', authenticateJWT, authorizeRoles('admin'), (req, res) => {
  try {
    const raw = req.params.type || '';
    const typeKey = canonicalMenuName(raw);
    if (!typeKey) return res.status(400).json({ error: 'Thiếu type' });

    // Nếu còn món thuộc loại thực đơn này thì chặn xóa (an toàn)
    const foods = readFoods();
    const usedBy = foods.filter(f => canonicalMenuName(f.type) === typeKey).length;
    if (usedBy > 0) {
      return res.status(409).json({
        error: `Không thể xóa vì còn ${usedBy} món thuộc loại thực đơn này`,
        usedBy
      });
    }

    // Gỡ khỏi menu-levels.json (nếu có)
    const all = readMenuLevels();
    if (all[typeKey]) {
      delete all[typeKey];
      writeJson(MENU_LEVELS_FILE, all);
    }

    // Thử xóa thư mục ảnh rỗng của menu (không bắt buộc)
    try {
      const folder = menuFolderOf(typeKey);
      const dir = path.join(IMAGES_DIR, folder);
      if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0) {
        try { fs.rmdirSync(dir); } catch { /* ignore */ }
      }
    } catch {}

    const io = req.app?.locals?.io || req.app?.get?.('io');
    if (io) io.emit('menuLevelsUpdated', { type: typeKey, levelAccess: [] });

    bumpVersion(req);
    res.json({ ok: true, removed: 1 });
  } catch (e) {
    res.status(500).json({ error: e?.message || 'Delete menu-type failed' });
  }
});



module.exports = router;
