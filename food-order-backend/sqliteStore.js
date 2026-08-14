const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'food-order.db');
const db = new Database(DB_PATH);

// WAL giúp ghi/đọc ổn định hơn, giảm lock database
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('busy_timeout = 5000');

// Không để SQLite tạo file tạm khi ORDER BY / GROUP BY lớn.
// Trên Windows + PM2, TEMP/TMP của service account đôi lúc không ghi được,
// dẫn đến SQLITE_CANTOPEN dù file database chính vẫn tồn tại.
db.pragma('temp_store = MEMORY');

// Tự checkpoint WAL để file -wal không phình quá lâu.
db.pragma('wal_autocheckpoint = 1000');
db.pragma('journal_size_limit = 67108864');

db.exec(`
CREATE TABLE IF NOT EXISTS members (
  code TEXT PRIMARY KEY,
  name TEXT,
  customerName TEXT,
  level TEXT,
  memberLevel TEXT,
  membershipType TEXT,
  apiSyncedAt TEXT,
  lastSeenAt TEXT,
  ordersCount INTEGER DEFAULT 0,
  createdAt TEXT,
  updatedAt TEXT,
  rawJson TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_members_name ON members(name);
CREATE INDEX IF NOT EXISTS idx_members_level ON members(level);
CREATE INDEX IF NOT EXISTS idx_members_updatedAt ON members(updatedAt);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  clientRequestId TEXT UNIQUE,
  area TEXT,
  tableNo TEXT,
  staff TEXT,
  memberCard TEXT,
  customerName TEXT,
  customerLevel TEXT,
  status TEXT,
  tableClosed INTEGER DEFAULT 0,
  createdAt TEXT,
  updatedAt TEXT,
  rawJson TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_orders_createdAt ON orders(createdAt);
CREATE INDEX IF NOT EXISTS idx_orders_memberCard ON orders(memberCard);
CREATE INDEX IF NOT EXISTS idx_orders_area_table ON orders(area, tableNo);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_tableClosed ON orders(tableClosed);
CREATE INDEX IF NOT EXISTS idx_orders_clientRequestId ON orders(clientRequestId);

CREATE TABLE IF NOT EXISTS status_history (
  id TEXT PRIMARY KEY,
  at TEXT,
  byUser TEXT,
  role TEXT,
  imageName TEXT,
  imageUrl TEXT,
  type TEXT,
  fromStatus TEXT,
  toStatus TEXT,
  affectedCount INTEGER DEFAULT 0,
  reason TEXT,
  rawJson TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_status_history_at ON status_history(at);
CREATE INDEX IF NOT EXISTS idx_status_history_byUser ON status_history(byUser);
CREATE INDEX IF NOT EXISTS idx_status_history_type ON status_history(type);
CREATE INDEX IF NOT EXISTS idx_status_history_toStatus ON status_history(toStatus);
CREATE INDEX IF NOT EXISTS idx_status_history_fromStatus ON status_history(fromStatus);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  imageName TEXT,
  imageUrl TEXT,
  productCode TEXT,
  name TEXT,
  menuType TEXT,
  groupName TEXT,
  itemGroup TEXT,
  price REAL DEFAULT 0,
  menusJson TEXT,
  createdAt TEXT,
  updatedAt TEXT,
  rawJson TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_products_imageName ON products(imageName);
CREATE INDEX IF NOT EXISTS idx_products_productCode ON products(productCode);
CREATE INDEX IF NOT EXISTS idx_products_name ON products(name);
CREATE INDEX IF NOT EXISTS idx_products_menuType ON products(menuType);
CREATE INDEX IF NOT EXISTS idx_products_groupName ON products(groupName);
CREATE INDEX IF NOT EXISTS idx_products_itemGroup ON products(itemGroup);

CREATE TABLE IF NOT EXISTS foods (
  id TEXT PRIMARY KEY,
  imageUrl TEXT,
  type TEXT,
  status TEXT,
  hash TEXT,
  levelAccessJson TEXT,
  orderIndex INTEGER DEFAULT 0,
  quantity INTEGER DEFAULT 1,
  createdAt TEXT,
  updatedAt TEXT,
  rawJson TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_foods_imageUrl ON foods(imageUrl);
CREATE INDEX IF NOT EXISTS idx_foods_type ON foods(type);
CREATE INDEX IF NOT EXISTS idx_foods_status ON foods(status);
CREATE INDEX IF NOT EXISTS idx_foods_orderIndex ON foods(orderIndex);

CREATE TABLE IF NOT EXISTS local_ai_training (
  id TEXT PRIMARY KEY,
  at TEXT,
  byUser TEXT,
  source TEXT,
  tagsJson TEXT,
  content TEXT,
  rawJson TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_local_ai_training_at ON local_ai_training(at);
CREATE INDEX IF NOT EXISTS idx_local_ai_training_byUser ON local_ai_training(byUser);
CREATE INDEX IF NOT EXISTS idx_local_ai_training_source ON local_ai_training(source);

CREATE TABLE IF NOT EXISTS local_ai_memory (
  id TEXT PRIMARY KEY,
  createdAt TEXT,
  updatedAt TEXT,
  mode TEXT,
  byUser TEXT,
  type TEXT,
  phrase TEXT,
  meaning TEXT,
  status TEXT,
  rawJson TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_local_ai_memory_createdAt ON local_ai_memory(createdAt);
CREATE INDEX IF NOT EXISTS idx_local_ai_memory_type ON local_ai_memory(type);
CREATE INDEX IF NOT EXISTS idx_local_ai_memory_status ON local_ai_memory(status);
CREATE INDEX IF NOT EXISTS idx_local_ai_memory_phrase ON local_ai_memory(phrase);

CREATE TABLE IF NOT EXISTS local_ai_pending_learning (
  id TEXT PRIMARY KEY,
  createdAt TEXT,
  updatedAt TEXT,
  reviewedAt TEXT,
  reviewedBy TEXT,
  mode TEXT,
  byUser TEXT,
  type TEXT,
  phrase TEXT,
  meaning TEXT,
  status TEXT,
  rawJson TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_local_ai_pending_createdAt ON local_ai_pending_learning(createdAt);
CREATE INDEX IF NOT EXISTS idx_local_ai_pending_status ON local_ai_pending_learning(status);
CREATE INDEX IF NOT EXISTS idx_local_ai_pending_type ON local_ai_pending_learning(type);

CREATE TABLE IF NOT EXISTS customer_events (
  id TEXT PRIMARY KEY,
  memberCode TEXT NOT NULL,
  customerName TEXT,
  customerLevel TEXT,
  eventAt TEXT NOT NULL,
  shift TEXT,
  shiftStartAt TEXT,
  note TEXT,
  status TEXT DEFAULT 'PENDING',
  createdBy TEXT,
  createdAt TEXT,
  updatedAt TEXT,
  acknowledgedAt TEXT,
  snoozedUntil TEXT,
  arrivedAt TEXT,
  cancelledAt TEXT,
  lastShiftAlarmAt TEXT,
  lastOneHourAlarmAt TEXT,
  lastSnoozeAlarmAt TEXT,
  rawJson TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_customer_events_memberCode ON customer_events(memberCode);
CREATE INDEX IF NOT EXISTS idx_customer_events_eventAt ON customer_events(eventAt);
CREATE INDEX IF NOT EXISTS idx_customer_events_status ON customer_events(status);
CREATE INDEX IF NOT EXISTS idx_customer_events_shiftStartAt ON customer_events(shiftStartAt);

`);

function safeJsonParse(raw, fallback) {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function isTransientSqliteReadError(error) {
  return ['SQLITE_BUSY', 'SQLITE_LOCKED', 'SQLITE_CANTOPEN'].includes(error?.code);
}

function runSqliteReadWithRetry(readFn) {
  try {
    return readFn();
  } catch (error) {
    if (!isTransientSqliteReadError(error)) throw error;

    // Khôi phục nhẹ kết nối hiện tại rồi thử lại đúng 1 lần.
    // temp_store=MEMORY xử lý trường hợp Windows không mở được file temp.
    try { db.pragma('temp_store = MEMORY'); } catch {}
    try { db.pragma('wal_checkpoint(PASSIVE)'); } catch {}

    return readFn();
  }
}

function cleanCode(v) {
  return String(v || '').replace(/\s+/g, '').trim();
}

function getMemberName(m = {}) {
  return String(m.name || m.customerName || '').trim();
}

function getMemberLevel(m = {}) {
  return String(m.level || m.memberLevel || m.tier || '').trim();
}

function memberFromRow(row) {
  if (!row) return null;

  const raw = safeJsonParse(row.rawJson, {}) || {};

  return {
    ...raw,
    code: row.code,
    name: raw.name || row.name || row.customerName || '',
    customerName: raw.customerName || row.customerName || row.name || '',
    level: raw.level || row.level || row.memberLevel || null,
    memberLevel: raw.memberLevel || row.memberLevel || row.level || null,
    membershipType: raw.membershipType || row.membershipType || null,
    apiSyncedAt: raw.apiSyncedAt || row.apiSyncedAt || null,
    lastSeenAt: raw.lastSeenAt || row.lastSeenAt || null,
    ordersCount: Number(raw.ordersCount ?? row.ordersCount ?? 0) || 0,
    createdAt: raw.createdAt || row.createdAt || null,
    updatedAt: raw.updatedAt || row.updatedAt || null,
  };
}

const upsertMemberStmt = db.prepare(`
INSERT INTO members (
  code,
  name,
  customerName,
  level,
  memberLevel,
  membershipType,
  apiSyncedAt,
  lastSeenAt,
  ordersCount,
  createdAt,
  updatedAt,
  rawJson
)
VALUES (
  @code,
  @name,
  @customerName,
  @level,
  @memberLevel,
  @membershipType,
  @apiSyncedAt,
  @lastSeenAt,
  @ordersCount,
  @createdAt,
  @updatedAt,
  @rawJson
)
ON CONFLICT(code) DO UPDATE SET
  name = excluded.name,
  customerName = excluded.customerName,
  level = excluded.level,
  memberLevel = excluded.memberLevel,
  membershipType = excluded.membershipType,
  apiSyncedAt = excluded.apiSyncedAt,
  lastSeenAt = excluded.lastSeenAt,
  ordersCount = excluded.ordersCount,
  createdAt = excluded.createdAt,
  updatedAt = excluded.updatedAt,
  rawJson = excluded.rawJson
`);

function upsertMember(codeInput, memberInput) {
  const code = cleanCode(codeInput || memberInput?.code);
  if (!code) return false;

  const member = {
    ...(memberInput || {}),
    code,
  };

  const name = getMemberName(member);
  const level = getMemberLevel(member);

  upsertMemberStmt.run({
    code,
    name,
    customerName: String(member.customerName || name || '').trim(),
    level: level || null,
    memberLevel: String(member.memberLevel || level || '').trim() || null,
    membershipType: member.membershipType || null,
    apiSyncedAt: member.apiSyncedAt || null,
    lastSeenAt: member.lastSeenAt || null,
    ordersCount: Number(member.ordersCount || 0) || 0,
    createdAt: member.createdAt || null,
    updatedAt: member.updatedAt || new Date().toISOString(),
    rawJson: JSON.stringify(member),
  });

  return true;
}

function deleteMember(codeInput) {
  const code = cleanCode(codeInput);
  if (!code) return false;

  db.prepare(`DELETE FROM members WHERE code = ?`).run(code);
  return true;
}

function loadMembers() {
  const rows = db.prepare(`SELECT * FROM members`).all();
  const out = {};

  for (const row of rows) {
    out[row.code] = memberFromRow(row);
  }

  return out;
}

function replaceAllMembers(membersObj = {}) {
  const tx = db.transaction((obj) => {
    db.prepare(`DELETE FROM members`).run();

    for (const [code, member] of Object.entries(obj || {})) {
      upsertMember(code, member);
    }
  });

  tx(membersObj);
}

function importMembersFromJsonIfEmpty(jsonPath) {
  const count = db.prepare(`SELECT COUNT(*) AS c FROM members`).get().c;
  if (count > 0) return { imported: false, reason: 'members table already has data' };

  if (!fs.existsSync(jsonPath)) {
    return { imported: false, reason: 'members.json not found' };
  }

  const raw = fs.readFileSync(jsonPath, 'utf8') || '{}';
  const parsed = safeJsonParse(raw, {});
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { imported: false, reason: 'members.json invalid format' };
  }

  const tx = db.transaction((obj) => {
    for (const [code, member] of Object.entries(obj)) {
      upsertMember(code, member);
    }
  });

  tx(parsed);

  return { imported: true, count: Object.keys(parsed).length };
}

function orderFromRow(row) {
  if (!row) return null;

  const raw = safeJsonParse(row.rawJson, {}) || {};

  return {
    ...raw,
    id: String(row.id),
    clientRequestId: raw.clientRequestId ?? row.clientRequestId ?? null,
    area: raw.area ?? row.area ?? null,
    tableNo: raw.tableNo ?? row.tableNo ?? null,
    staff: raw.staff ?? row.staff ?? '',
    memberCard: raw.memberCard ?? row.memberCard ?? '',
    customerName: raw.customerName ?? row.customerName ?? null,
    customer: raw.customer || {
      code: row.memberCard || null,
      name: row.customerName || null,
      level: row.customerLevel || null,
    },
    status: raw.status || row.status || 'PENDING',
    tableClosed: Boolean(raw.tableClosed ?? row.tableClosed),
    createdAt: raw.createdAt || row.createdAt || null,
    updatedAt: raw.updatedAt || row.updatedAt || null,
    items: Array.isArray(raw.items) ? raw.items : [],
  };
}

const upsertOrderStmt = db.prepare(`
INSERT INTO orders (
  id,
  clientRequestId,
  area,
  tableNo,
  staff,
  memberCard,
  customerName,
  customerLevel,
  status,
  tableClosed,
  createdAt,
  updatedAt,
  rawJson
)
VALUES (
  @id,
  @clientRequestId,
  @area,
  @tableNo,
  @staff,
  @memberCard,
  @customerName,
  @customerLevel,
  @status,
  @tableClosed,
  @createdAt,
  @updatedAt,
  @rawJson
)
ON CONFLICT(id) DO UPDATE SET
  clientRequestId = excluded.clientRequestId,
  area = excluded.area,
  tableNo = excluded.tableNo,
  staff = excluded.staff,
  memberCard = excluded.memberCard,
  customerName = excluded.customerName,
  customerLevel = excluded.customerLevel,
  status = excluded.status,
  tableClosed = excluded.tableClosed,
  createdAt = excluded.createdAt,
  updatedAt = excluded.updatedAt,
  rawJson = excluded.rawJson
`);

function upsertOrder(orderInput) {
  if (!orderInput?.id) return false;

  const order = {
    ...orderInput,
    id: String(orderInput.id),
  };

  const customerName =
    order.customerName ||
    order.customer?.name ||
    null;

  const customerLevel =
    order.customer?.level ||
    null;

  upsertOrderStmt.run({
    id: String(order.id),
    clientRequestId: order.clientRequestId || null,
    area: order.area == null ? null : String(order.area),
    tableNo: order.tableNo == null ? null : String(order.tableNo),
    staff: order.staff == null ? null : String(order.staff),
    memberCard: order.memberCard == null ? null : String(order.memberCard),
    customerName,
    customerLevel,
    status: order.status || 'PENDING',
    tableClosed: order.tableClosed ? 1 : 0,
    createdAt: order.createdAt || null,
    updatedAt: order.updatedAt || null,
    rawJson: JSON.stringify(order),
  });

  return true;
}

const loadOrdersStmt = db.prepare(`
  SELECT *
  FROM orders
  ORDER BY createdAt DESC
`);

function loadOrders() {
  // createdAt đang lưu ISO-8601 nên sort TEXT cho kết quả đúng.
  // Không bọc datetime(createdAt), vì cách cũ làm SQLite bỏ index
  // idx_orders_createdAt và tạo TEMP B-TREE trên disk.
  const rows = runSqliteReadWithRetry(() => loadOrdersStmt.all());
  return rows.map(orderFromRow).filter(Boolean);
}

const upsertOrdersTx = db.transaction((arr) => {
  for (const order of arr || []) {
    upsertOrder(order);
  }
});

function upsertOrders(orderArr = []) {
  upsertOrdersTx(Array.isArray(orderArr) ? orderArr : []);
  return true;
}

function checkpointWal(mode = 'PASSIVE') {
  const safeMode = ['PASSIVE', 'FULL', 'RESTART', 'TRUNCATE'].includes(String(mode).toUpperCase())
    ? String(mode).toUpperCase()
    : 'PASSIVE';

  try {
    return db.pragma(`wal_checkpoint(${safeMode})`);
  } catch (error) {
    if (!isTransientSqliteReadError(error)) throw error;
    return null;
  }
}

function getOrderById(orderId) {
  const id = String(orderId || '').trim();
  if (!id) return null;

  const row = db.prepare(`
    SELECT *
    FROM orders
    WHERE id = ?
    LIMIT 1
  `).get(id);

  return orderFromRow(row);
}

function getNextOrderId() {
  const row = db.prepare(`
    SELECT MAX(CAST(id AS INTEGER)) AS maxId
    FROM orders
  `).get();

  const maxId = Number(row?.maxId || 0) || 0;
  return String(maxId + 1);
}

function replaceAllOrders(orderArr = []) {
  const tx = db.transaction((arr) => {
    db.prepare(`DELETE FROM orders`).run();

    for (const order of arr || []) {
      upsertOrder(order);
    }
  });

  tx(orderArr);
}

function importOrdersFromJsonIfEmpty(jsonPath) {
  const count = db.prepare(`SELECT COUNT(*) AS c FROM orders`).get().c;
  if (count > 0) return { imported: false, reason: 'orders table already has data' };

  if (!fs.existsSync(jsonPath)) {
    return { imported: false, reason: 'orders.json not found' };
  }

  const raw = fs.readFileSync(jsonPath, 'utf8') || '[]';
  const parsed = safeJsonParse(raw, []);
  if (!Array.isArray(parsed)) {
    return { imported: false, reason: 'orders.json invalid format' };
  }

  const tx = db.transaction((arr) => {
    for (const order of arr) {
      upsertOrder(order);
    }
  });

  tx(parsed);

  return { imported: true, count: parsed.length };
}
function statusHistoryFromRow(row) {
  if (!row) return null;

  const raw = safeJsonParse(row.rawJson, {}) || {};

  return {
    ...raw,
    id: raw.id ?? row.id,
    at: raw.at || row.at || null,
    by: raw.by || row.byUser || '',
    role: raw.role || row.role || '',
    imageName: raw.imageName || row.imageName || '',
    imageUrl: raw.imageUrl || row.imageUrl || '',
    type: raw.type || row.type || '',
    from: raw.from ?? row.fromStatus ?? null,
    to: raw.to ?? row.toStatus ?? null,
    count: raw.count ?? row.affectedCount ?? 0,
    reason: raw.reason || row.reason || '',
  };
}

const insertStatusHistoryStmt = db.prepare(`
INSERT OR REPLACE INTO status_history (
  id,
  at,
  byUser,
  role,
  imageName,
  imageUrl,
  type,
  fromStatus,
  toStatus,
  affectedCount,
  reason,
  rawJson
)
VALUES (
  @id,
  @at,
  @byUser,
  @role,
  @imageName,
  @imageUrl,
  @type,
  @fromStatus,
  @toStatus,
  @affectedCount,
  @reason,
  @rawJson
)
`);

function insertStatusHistory(entryInput = {}) {
  const id = String(
    entryInput.id ||
    `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  );

  const entry = {
    ...entryInput,
    id,
  };

  insertStatusHistoryStmt.run({
    id,
    at: entry.at || new Date().toISOString(),
    byUser: entry.by || '',
    role: entry.role || '',
    imageName: entry.imageName || '',
    imageUrl: entry.imageUrl || '',
    type: entry.type || '',
    fromStatus: entry.from == null ? null : String(entry.from),
    toStatus: entry.to == null ? null : String(entry.to),
    affectedCount: Number(entry.count || 0) || 0,
    reason: entry.reason || '',
    rawJson: JSON.stringify(entry),
  });

  return entry;
}

function importStatusHistoryFromJsonIfEmpty(jsonPath) {
  const count = db.prepare(`SELECT COUNT(*) AS c FROM status_history`).get().c;
  if (count > 0) {
    return {
      imported: false,
      reason: 'status_history table already has data',
    };
  }

  if (!fs.existsSync(jsonPath)) {
    return {
      imported: false,
      reason: 'status-history.json not found',
    };
  }

  const raw = fs.readFileSync(jsonPath, 'utf8') || '[]';
  const parsed = safeJsonParse(raw, []);

  if (!Array.isArray(parsed)) {
    return {
      imported: false,
      reason: 'status-history.json invalid format',
    };
  }

  const tx = db.transaction((arr) => {
    for (const entry of arr || []) {
      insertStatusHistory(entry);
    }
  });

  tx(parsed);

  return {
    imported: true,
    count: parsed.length,
  };
}

function listStatusHistory(filters = {}) {
  const where = [];
  const params = {};

  if (filters.from) {
    where.push(`datetime(at) >= datetime(@from)`);
    params.from = filters.from;
  }

  if (filters.to) {
    where.push(`datetime(at) <= datetime(@to)`);
    params.to = filters.to;
  }

  if (filters.user) {
    where.push(`LOWER(byUser) LIKE LOWER(@user)`);
    params.user = `%${String(filters.user)}%`;
  }

  if (filters.type) {
    where.push(`LOWER(type) LIKE LOWER(@type)`);
    params.type = `%${String(filters.type)}%`;
  }

  if (filters.toStatus) {
    where.push(`toStatus = @toStatus`);
    params.toStatus = String(filters.toStatus);
  }

  if (filters.fromStatus) {
    where.push(`fromStatus = @fromStatus`);
    params.fromStatus = String(filters.fromStatus);
  }

  const limit = Math.max(1, Math.min(5000, Number(filters.limit || 200)));
  params.limit = limit;

  const sql = `
    SELECT *
    FROM status_history
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY datetime(at) DESC
    LIMIT @limit
  `;

  return db.prepare(sql).all(params).map(statusHistoryFromRow).filter(Boolean);
}
function basenameLower(v) {
  return String(v || '').split('/').pop().toLowerCase();
}


// ================= PRODUCTS =================

function normalizeProductInput(productInput = {}) {
  const p = { ...(productInput || {}) };

  const imageName =
    String(p.imageName || basenameLower(p.imageUrl) || p.id || '').trim();

  const id = String(p.id || imageName || p.productCode || '').trim();
  if (!id) return null;

  if (!p.id) p.id = id;
  if (!p.imageName && imageName) p.imageName = imageName;

  if (p.price != null) {
    const n = Number(p.price);
    p.price = Number.isFinite(n) ? n : 0;
  } else {
    p.price = 0;
  }

  if (!p.menuType) p.menuType = 'đồ ăn';

  const now = Date.now();
  if (!p.createdAt) p.createdAt = now;
  p.updatedAt = p.updatedAt || now;

  return p;
}

function productFromRow(row) {
  if (!row) return null;

  const raw = safeJsonParse(row.rawJson, {}) || {};

  return {
    ...raw,
    id: raw.id || row.id,
    imageName: raw.imageName || row.imageName || '',
    imageUrl: raw.imageUrl || row.imageUrl || '',
    productCode: raw.productCode || raw.code || row.productCode || '',
    name: raw.name || raw.productName || row.name || '',
    menuType: raw.menuType || row.menuType || '',
    group: raw.group || row.groupName || '',
    itemGroup: raw.itemGroup || row.itemGroup || null,
    price: Number(raw.price ?? row.price ?? 0) || 0,
    menus: Array.isArray(raw.menus)
      ? raw.menus
      : safeJsonParse(row.menusJson || '[]', []),
    createdAt: raw.createdAt || row.createdAt || null,
    updatedAt: raw.updatedAt || row.updatedAt || null,
  };
}

const upsertProductStmt = db.prepare(`
INSERT INTO products (
  id,
  imageName,
  imageUrl,
  productCode,
  name,
  menuType,
  groupName,
  itemGroup,
  price,
  menusJson,
  createdAt,
  updatedAt,
  rawJson
)
VALUES (
  @id,
  @imageName,
  @imageUrl,
  @productCode,
  @name,
  @menuType,
  @groupName,
  @itemGroup,
  @price,
  @menusJson,
  @createdAt,
  @updatedAt,
  @rawJson
)
ON CONFLICT(id) DO UPDATE SET
  imageName = excluded.imageName,
  imageUrl = excluded.imageUrl,
  productCode = excluded.productCode,
  name = excluded.name,
  menuType = excluded.menuType,
  groupName = excluded.groupName,
  itemGroup = excluded.itemGroup,
  price = excluded.price,
  menusJson = excluded.menusJson,
  createdAt = excluded.createdAt,
  updatedAt = excluded.updatedAt,
  rawJson = excluded.rawJson
`);

function upsertProduct(productInput = {}) {
  const p = normalizeProductInput(productInput);
  if (!p) return false;

  upsertProductStmt.run({
    id: String(p.id),
    imageName: p.imageName || '',
    imageUrl: p.imageUrl || '',
    productCode: String(p.productCode || p.code || '').trim(),
    name: String(p.name || p.productName || '').trim(),
    menuType: String(p.menuType || '').trim(),
    groupName: String(p.group || '').trim(),
    itemGroup: p.itemGroup || null,
    price: Number(p.price || 0) || 0,
    menusJson: JSON.stringify(Array.isArray(p.menus) ? p.menus : []),
    createdAt: p.createdAt == null ? null : String(p.createdAt),
    updatedAt: p.updatedAt == null ? null : String(p.updatedAt),
    rawJson: JSON.stringify(p),
  });

  return true;
}

function loadProducts() {
  const rows = db.prepare(`
    SELECT *
    FROM products
    ORDER BY LOWER(name), id
  `).all();

  return rows.map(productFromRow).filter(Boolean);
}

function replaceAllProducts(productArr = []) {
  const tx = db.transaction((arr) => {
    db.prepare(`DELETE FROM products`).run();

    for (const product of arr || []) {
      upsertProduct(product);
    }
  });

  tx(Array.isArray(productArr) ? productArr : []);
}

function deleteProduct(idInput) {
  const id = String(idInput || '').trim();
  if (!id) return false;

  db.prepare(`DELETE FROM products WHERE id = ?`).run(id);
  return true;
}

function importProductsFromJsonIfEmpty(jsonPath) {
  const count = db.prepare(`SELECT COUNT(*) AS c FROM products`).get().c;
  if (count > 0) {
    return { imported: false, reason: 'products table already has data' };
  }

  if (!fs.existsSync(jsonPath)) {
    return { imported: false, reason: 'products.json not found' };
  }

  const raw = fs.readFileSync(jsonPath, 'utf8') || '[]';
  const parsed = safeJsonParse(raw, []);

  const rows = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.rows)
      ? parsed.rows
      : [];

  const tx = db.transaction((arr) => {
    for (const product of arr || []) {
      upsertProduct(product);
    }
  });

  tx(rows);

  return { imported: true, count: rows.length };
}

function updateProductMenusByImageName(imageNameInput, updater) {
  const imageName = String(imageNameInput || '').toLowerCase();
  if (!imageName || typeof updater !== 'function') return false;

  const row = db.prepare(`
    SELECT *
    FROM products
    WHERE LOWER(imageName) = LOWER(@imageName)
       OR LOWER(id) = LOWER(@imageName)
    LIMIT 1
  `).get({ imageName });

  const product = productFromRow(row);
  if (!product) return false;

  const cur = Array.isArray(product.menus) ? product.menus.slice() : [];
  const next = updater(cur);

  upsertProduct({
    ...product,
    menus: Array.isArray(next) ? next : [],
    updatedAt: Date.now(),
  });

  return true;
}
// ================= FOODS =================

function normalizeFoodInput(foodInput = {}) {
  const f = { ...(foodInput || {}) };

  if (f.id == null || f.id === '') {
    f.id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  f.imageUrl = String(f.imageUrl || '').trim();
  f.type = String(f.type || '').trim();
  f.status = String(f.status || '').trim() || 'Available';

  if (!Array.isArray(f.levelAccess)) {
    f.levelAccess = [];
  }

  const qtyNum = Number(f.quantity);
  if (!Number.isFinite(qtyNum)) {
    f.quantity = f.status === 'Sold Out' ? 0 : 1;
  } else {
    f.quantity = Math.max(0, qtyNum);
  }

  if (f.quantity <= 0) {
    f.status = 'Sold Out';
  } else if (!f.status || f.status === 'Sold Out') {
    f.status = 'Available';
  }

  const orderNum = Number(f.order);
  f.order = Number.isFinite(orderNum) ? orderNum : 0;

  if (!f.createdAt) f.createdAt = null;
  f.updatedAt = f.updatedAt || new Date().toISOString();

  return f;
}

function foodFromRow(row) {
  if (!row) return null;

  const raw = safeJsonParse(row.rawJson, {}) || {};
  const rawId = raw.id ?? row.id;
  const idNum = Number(rawId);
  const finalId =
    rawId !== '' && Number.isFinite(idNum) && String(idNum) === String(rawId)
      ? idNum
      : rawId;

  const levelAccess = Array.isArray(raw.levelAccess)
    ? raw.levelAccess
    : safeJsonParse(row.levelAccessJson || '[]', []);

  return {
    ...raw,
    id: finalId,
    imageUrl: raw.imageUrl || row.imageUrl || '',
    type: raw.type || row.type || '',
    status: raw.status || row.status || 'Available',
    hash: raw.hash || row.hash || undefined,
    levelAccess: Array.isArray(levelAccess) ? levelAccess : [],
    order: Number(raw.order ?? row.orderIndex ?? 0) || 0,
    quantity: Number(raw.quantity ?? row.quantity ?? 1) || 0,
    createdAt: raw.createdAt || row.createdAt || null,
    updatedAt: raw.updatedAt || row.updatedAt || null,
  };
}

const upsertFoodStmt = db.prepare(`
INSERT INTO foods (
  id,
  imageUrl,
  type,
  status,
  hash,
  levelAccessJson,
  orderIndex,
  quantity,
  createdAt,
  updatedAt,
  rawJson
)
VALUES (
  @id,
  @imageUrl,
  @type,
  @status,
  @hash,
  @levelAccessJson,
  @orderIndex,
  @quantity,
  @createdAt,
  @updatedAt,
  @rawJson
)
ON CONFLICT(id) DO UPDATE SET
  imageUrl = excluded.imageUrl,
  type = excluded.type,
  status = excluded.status,
  hash = excluded.hash,
  levelAccessJson = excluded.levelAccessJson,
  orderIndex = excluded.orderIndex,
  quantity = excluded.quantity,
  createdAt = excluded.createdAt,
  updatedAt = excluded.updatedAt,
  rawJson = excluded.rawJson
`);

function upsertFood(foodInput = {}) {
  const f = normalizeFoodInput(foodInput);
  if (!f) return false;

  upsertFoodStmt.run({
    id: String(f.id),
    imageUrl: f.imageUrl || '',
    type: f.type || '',
    status: f.status || 'Available',
    hash: f.hash || null,
    levelAccessJson: JSON.stringify(Array.isArray(f.levelAccess) ? f.levelAccess : []),
    orderIndex: Number(f.order || 0) || 0,
    quantity: Number(f.quantity || 0) || 0,
    createdAt: f.createdAt == null ? null : String(f.createdAt),
    updatedAt: f.updatedAt == null ? null : String(f.updatedAt),
    rawJson: JSON.stringify(f),
  });

  return true;
}

function loadFoods() {
  const rows = db.prepare(`
    SELECT *
    FROM foods
    ORDER BY orderIndex ASC, CAST(id AS INTEGER) ASC, id ASC
  `).all();

  return rows.map(foodFromRow).filter(Boolean);
}

function replaceAllFoods(foodArr = []) {
  const tx = db.transaction((arr) => {
    db.prepare(`DELETE FROM foods`).run();

    for (const food of arr || []) {
      upsertFood(food);
    }
  });

  tx(Array.isArray(foodArr) ? foodArr : []);
}

function deleteFood(idInput) {
  const id = String(idInput || '').trim();
  if (!id) return false;

  db.prepare(`DELETE FROM foods WHERE id = ?`).run(id);
  return true;
}

function getNextFoodId() {
  const row = db.prepare(`
    SELECT MAX(CAST(id AS INTEGER)) AS maxId
    FROM foods
  `).get();

  const maxId = Number(row?.maxId || 0) || 0;
  return maxId + 1;
}

function importFoodsFromJsonIfEmpty(jsonPath) {
  const count = db.prepare(`SELECT COUNT(*) AS c FROM foods`).get().c;
  if (count > 0) {
    return { imported: false, reason: 'foods table already has data' };
  }

  if (!fs.existsSync(jsonPath)) {
    return { imported: false, reason: 'foods.json not found' };
  }

  const raw = fs.readFileSync(jsonPath, 'utf8') || '[]';
  const parsed = safeJsonParse(raw, []);

  if (!Array.isArray(parsed)) {
    return { imported: false, reason: 'foods.json invalid format' };
  }

  const tx = db.transaction((arr) => {
    arr.forEach((food, idx) => {
      upsertFood({
        ...food,
        order: Number.isFinite(Number(food.order)) ? Number(food.order) : idx,
      });
    });
  });

  tx(parsed);

  return { imported: true, count: parsed.length };
}

// ================= LOCAL AI / CHATBOT DATA =================

function makeLocalAiId(prefix = 'ai') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function localAiTrainingFromRow(row) {
  if (!row) return null;
  const raw = safeJsonParse(row.rawJson, {}) || {};
  return {
    ...raw,
    id: raw.id ?? row.id,
    at: raw.at || row.at || null,
    by: raw.by || row.byUser || '',
    source: raw.source || row.source || '',
    tags: Array.isArray(raw.tags) ? raw.tags : safeJsonParse(row.tagsJson || '[]', []),
    content: raw.content || row.content || '',
  };
}

const insertLocalAiTrainingStmt = db.prepare(`
INSERT OR REPLACE INTO local_ai_training (
  id,
  at,
  byUser,
  source,
  tagsJson,
  content,
  rawJson
)
VALUES (
  @id,
  @at,
  @byUser,
  @source,
  @tagsJson,
  @content,
  @rawJson
)
`);

function insertLocalAiTraining(rowInput = {}) {
  const row = {
    ...rowInput,
    id: String(rowInput.id || makeLocalAiId('train')),
    at: rowInput.at || new Date().toISOString(),
  };

  insertLocalAiTrainingStmt.run({
    id: String(row.id),
    at: row.at || null,
    byUser: row.by || row.byUser || '',
    source: row.source || '',
    tagsJson: JSON.stringify(Array.isArray(row.tags) ? row.tags : []),
    content: String(row.content || ''),
    rawJson: JSON.stringify(row),
  });

  return row;
}

function listLocalAiTraining(limit = 1000) {
  const rows = db.prepare(`
    SELECT *
    FROM local_ai_training
    ORDER BY datetime(at) DESC, id DESC
    LIMIT @limit
  `).all({
    limit: Math.max(1, Math.min(5000, Number(limit || 1000))),
  });

  return rows.map(localAiTrainingFromRow).filter(Boolean).reverse();
}

function importLocalAiTrainingFromJsonIfEmpty(jsonPath) {
  const count = db.prepare(`SELECT COUNT(*) AS c FROM local_ai_training`).get().c;
  if (count > 0) return { imported: false, reason: 'local_ai_training table already has data' };

  if (!fs.existsSync(jsonPath)) {
    return { imported: false, reason: 'ai-training.json not found' };
  }

  const raw = fs.readFileSync(jsonPath, 'utf8') || '[]';
  const parsed = safeJsonParse(raw, []);
  if (!Array.isArray(parsed)) {
    return { imported: false, reason: 'ai-training.json invalid format' };
  }

  const tx = db.transaction((arr) => {
    for (const row of arr || []) {
      insertLocalAiTraining(row);
    }
  });

  tx(parsed);

  return { imported: true, count: parsed.length };
}

function localAiMemoryFromRow(row) {
  if (!row) return null;
  const raw = safeJsonParse(row.rawJson, {}) || {};
  return {
    ...raw,
    id: raw.id ?? row.id,
    createdAt: raw.createdAt || row.createdAt || null,
    updatedAt: raw.updatedAt || row.updatedAt || null,
    mode: raw.mode || row.mode || 'user',
    by: raw.by || row.byUser || '',
    type: raw.type || row.type || '',
    phrase: raw.phrase || row.phrase || '',
    meaning: raw.meaning || row.meaning || '',
    status: raw.status || row.status || 'approved',
  };
}

const insertLocalAiMemoryStmt = db.prepare(`
INSERT OR REPLACE INTO local_ai_memory (
  id,
  createdAt,
  updatedAt,
  mode,
  byUser,
  type,
  phrase,
  meaning,
  status,
  rawJson
)
VALUES (
  @id,
  @createdAt,
  @updatedAt,
  @mode,
  @byUser,
  @type,
  @phrase,
  @meaning,
  @status,
  @rawJson
)
`);

function insertLocalAiMemory(rowInput = {}) {
  const now = new Date().toISOString();

  const row = {
    ...rowInput,
    id: String(rowInput.id || makeLocalAiId('memory')),
    createdAt: rowInput.createdAt || now,
    updatedAt: rowInput.updatedAt || now,
    status: rowInput.status || 'approved',
  };

  insertLocalAiMemoryStmt.run({
    id: String(row.id),
    createdAt: row.createdAt || null,
    updatedAt: row.updatedAt || null,
    mode: row.mode || 'user',
    byUser: row.by || row.byUser || '',
    type: row.type || '',
    phrase: row.phrase || '',
    meaning: row.meaning || '',
    status: row.status || 'approved',
    rawJson: JSON.stringify(row),
  });

  return row;
}

function listLocalAiMemory(limit = 1000) {
  const rows = db.prepare(`
    SELECT *
    FROM local_ai_memory
    ORDER BY datetime(createdAt) DESC, id DESC
    LIMIT @limit
  `).all({
    limit: Math.max(1, Math.min(5000, Number(limit || 1000))),
  });

  return rows.map(localAiMemoryFromRow).filter(Boolean).reverse();
}

function importLocalAiMemoryFromJsonIfEmpty(jsonPath) {
  const count = db.prepare(`SELECT COUNT(*) AS c FROM local_ai_memory`).get().c;
  if (count > 0) return { imported: false, reason: 'local_ai_memory table already has data' };

  if (!fs.existsSync(jsonPath)) {
    return { imported: false, reason: 'ai-memory.json not found' };
  }

  const raw = fs.readFileSync(jsonPath, 'utf8') || '[]';
  const parsed = safeJsonParse(raw, []);
  if (!Array.isArray(parsed)) {
    return { imported: false, reason: 'ai-memory.json invalid format' };
  }

  const tx = db.transaction((arr) => {
    for (const row of arr || []) {
      insertLocalAiMemory(row);
    }
  });

  tx(parsed);

  return { imported: true, count: parsed.length };
}

function localAiPendingFromRow(row) {
  if (!row) return null;
  const raw = safeJsonParse(row.rawJson, {}) || {};
  return {
    ...raw,
    id: raw.id ?? row.id,
    createdAt: raw.createdAt || row.createdAt || null,
    updatedAt: raw.updatedAt || row.updatedAt || null,
    reviewedAt: raw.reviewedAt || row.reviewedAt || null,
    reviewedBy: raw.reviewedBy || row.reviewedBy || null,
    mode: raw.mode || row.mode || 'user',
    by: raw.by || row.byUser || '',
    type: raw.type || row.type || '',
    phrase: raw.phrase || row.phrase || '',
    meaning: raw.meaning || row.meaning || '',
    status: raw.status || row.status || 'pending',
  };
}

const insertLocalAiPendingStmt = db.prepare(`
INSERT OR REPLACE INTO local_ai_pending_learning (
  id,
  createdAt,
  updatedAt,
  reviewedAt,
  reviewedBy,
  mode,
  byUser,
  type,
  phrase,
  meaning,
  status,
  rawJson
)
VALUES (
  @id,
  @createdAt,
  @updatedAt,
  @reviewedAt,
  @reviewedBy,
  @mode,
  @byUser,
  @type,
  @phrase,
  @meaning,
  @status,
  @rawJson
)
`);

function insertLocalAiPendingLearning(rowInput = {}) {
  const now = new Date().toISOString();

  const row = {
    ...rowInput,
    id: String(rowInput.id || makeLocalAiId('pending')),
    createdAt: rowInput.createdAt || now,
    updatedAt: rowInput.updatedAt || now,
    status: rowInput.status || 'pending',
  };

  insertLocalAiPendingStmt.run({
    id: String(row.id),
    createdAt: row.createdAt || null,
    updatedAt: row.updatedAt || null,
    reviewedAt: row.reviewedAt || null,
    reviewedBy: row.reviewedBy || null,
    mode: row.mode || 'user',
    byUser: row.by || row.byUser || '',
    type: row.type || '',
    phrase: row.phrase || '',
    meaning: row.meaning || '',
    status: row.status || 'pending',
    rawJson: JSON.stringify(row),
  });

  return row;
}

function listLocalAiPendingLearning(limit = 1000) {
  const rows = db.prepare(`
    SELECT *
    FROM local_ai_pending_learning
    ORDER BY datetime(createdAt) DESC, id DESC
    LIMIT @limit
  `).all({
    limit: Math.max(1, Math.min(5000, Number(limit || 1000))),
  });

  return rows.map(localAiPendingFromRow).filter(Boolean).reverse();
}

function updateLocalAiPendingLearning(idInput, patch = {}) {
  const id = String(idInput || '').trim();
  if (!id) return null;

  const row = db.prepare(`
    SELECT *
    FROM local_ai_pending_learning
    WHERE id = ?
    LIMIT 1
  `).get(id);

  const current = localAiPendingFromRow(row);
  if (!current) return null;

  const next = {
    ...current,
    ...patch,
    id,
    updatedAt: patch.updatedAt || new Date().toISOString(),
  };

  insertLocalAiPendingLearning(next);
  return next;
}

function importLocalAiPendingFromJsonIfEmpty(jsonPath) {
  const count = db.prepare(`SELECT COUNT(*) AS c FROM local_ai_pending_learning`).get().c;
  if (count > 0) return { imported: false, reason: 'local_ai_pending_learning table already has data' };

  if (!fs.existsSync(jsonPath)) {
    return { imported: false, reason: 'ai-pending-learning.json not found' };
  }

  const raw = fs.readFileSync(jsonPath, 'utf8') || '[]';
  const parsed = safeJsonParse(raw, []);
  if (!Array.isArray(parsed)) {
    return { imported: false, reason: 'ai-pending-learning.json invalid format' };
  }

  const tx = db.transaction((arr) => {
    for (const row of arr || []) {
      insertLocalAiPendingLearning(row);
    }
  });

  tx(parsed);

  return { imported: true, count: parsed.length };
}

// ================= CUSTOMER EVENTS =================

function makeCustomerEventId() {
  return `ce-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeCustomerEventInput(input = {}) {
  const now = new Date().toISOString();

  const row = {
    ...input,
    id: String(input.id || makeCustomerEventId()),
    memberCode: String(input.memberCode || input.code || '').replace(/\s+/g, '').trim(),
    customerName: String(input.customerName || input.name || '').trim(),
    customerLevel: String(input.customerLevel || input.level || '').trim(),
    eventAt: input.eventAt ? new Date(input.eventAt).toISOString() : '',
    shift: input.shift || '',
    shiftStartAt: input.shiftStartAt ? new Date(input.shiftStartAt).toISOString() : '',
    note: String(input.note || '').trim(),
    status: String(input.status || 'PENDING').toUpperCase(),
    createdBy: String(input.createdBy || input.by || 'user').trim(),
    createdAt: input.createdAt || now,
    updatedAt: now,
    acknowledgedAt: input.acknowledgedAt || null,
    snoozedUntil: input.snoozedUntil || null,
    arrivedAt: input.arrivedAt || null,
    cancelledAt: input.cancelledAt || null,
    lastShiftAlarmAt: input.lastShiftAlarmAt || null,
    lastOneHourAlarmAt: input.lastOneHourAlarmAt || null,
    lastSnoozeAlarmAt: input.lastSnoozeAlarmAt || null,
  };

  if (!row.memberCode) throw new Error('memberCode required');
  if (!row.eventAt) throw new Error('eventAt required');

  return row;
}

function customerEventFromRow(row) {
  if (!row) return null;

  const raw = safeJsonParse(row.rawJson, {}) || {};

  return {
    ...raw,
    id: raw.id || row.id,
    memberCode: raw.memberCode || row.memberCode,
    customerName: raw.customerName || row.customerName || '',
    customerLevel: raw.customerLevel || row.customerLevel || '',
    eventAt: raw.eventAt || row.eventAt,
    shift: raw.shift || row.shift || '',
    shiftStartAt: raw.shiftStartAt || row.shiftStartAt || '',
    note: raw.note || row.note || '',
    status: raw.status || row.status || 'PENDING',
    createdBy: raw.createdBy || row.createdBy || '',
    createdAt: raw.createdAt || row.createdAt || null,
    updatedAt: raw.updatedAt || row.updatedAt || null,
    acknowledgedAt: raw.acknowledgedAt || row.acknowledgedAt || null,
    snoozedUntil: raw.snoozedUntil || row.snoozedUntil || null,
    arrivedAt: raw.arrivedAt || row.arrivedAt || null,
    cancelledAt: raw.cancelledAt || row.cancelledAt || null,
    lastShiftAlarmAt: raw.lastShiftAlarmAt || row.lastShiftAlarmAt || null,
    lastOneHourAlarmAt: raw.lastOneHourAlarmAt || row.lastOneHourAlarmAt || null,
    lastSnoozeAlarmAt: raw.lastSnoozeAlarmAt || row.lastSnoozeAlarmAt || null,
  };
}

const upsertCustomerEventStmt = db.prepare(`
INSERT INTO customer_events (
  id,
  memberCode,
  customerName,
  customerLevel,
  eventAt,
  shift,
  shiftStartAt,
  note,
  status,
  createdBy,
  createdAt,
  updatedAt,
  acknowledgedAt,
  snoozedUntil,
  arrivedAt,
  cancelledAt,
  lastShiftAlarmAt,
  lastOneHourAlarmAt,
  lastSnoozeAlarmAt,
  rawJson
)
VALUES (
  @id,
  @memberCode,
  @customerName,
  @customerLevel,
  @eventAt,
  @shift,
  @shiftStartAt,
  @note,
  @status,
  @createdBy,
  @createdAt,
  @updatedAt,
  @acknowledgedAt,
  @snoozedUntil,
  @arrivedAt,
  @cancelledAt,
  @lastShiftAlarmAt,
  @lastOneHourAlarmAt,
  @lastSnoozeAlarmAt,
  @rawJson
)
ON CONFLICT(id) DO UPDATE SET
  memberCode = excluded.memberCode,
  customerName = excluded.customerName,
  customerLevel = excluded.customerLevel,
  eventAt = excluded.eventAt,
  shift = excluded.shift,
  shiftStartAt = excluded.shiftStartAt,
  note = excluded.note,
  status = excluded.status,
  createdBy = excluded.createdBy,
  createdAt = excluded.createdAt,
  updatedAt = excluded.updatedAt,
  acknowledgedAt = excluded.acknowledgedAt,
  snoozedUntil = excluded.snoozedUntil,
  arrivedAt = excluded.arrivedAt,
  cancelledAt = excluded.cancelledAt,
  lastShiftAlarmAt = excluded.lastShiftAlarmAt,
  lastOneHourAlarmAt = excluded.lastOneHourAlarmAt,
  lastSnoozeAlarmAt = excluded.lastSnoozeAlarmAt,
  rawJson = excluded.rawJson
`);

function upsertCustomerEvent(input = {}) {
  const row = normalizeCustomerEventInput(input);

  upsertCustomerEventStmt.run({
    ...row,
    rawJson: JSON.stringify(row),
  });

  return row;
}

function getCustomerEventById(idInput) {
  const id = String(idInput || '').trim();
  if (!id) return null;

  const row = db.prepare(`
    SELECT *
    FROM customer_events
    WHERE id = ?
    LIMIT 1
  `).get(id);

  return customerEventFromRow(row);
}

function listCustomerEvents(filters = {}) {
  const {
    memberCode,
    status,
    from,
    to,
    limit = 500,
  } = filters || {};

  const where = [];
  const params = {};

  if (memberCode) {
    where.push(`memberCode = @memberCode`);
    params.memberCode = String(memberCode).replace(/\s+/g, '').trim();
  }

  if (status && status !== 'ALL') {
    if (Array.isArray(status)) {
      where.push(`status IN (${status.map((_, i) => `@status${i}`).join(',')})`);
      status.forEach((s, i) => params[`status${i}`] = String(s).toUpperCase());
    } else {
      where.push(`status = @status`);
      params.status = String(status).toUpperCase();
    }
  }

  if (from) {
    where.push(`datetime(eventAt) >= datetime(@from)`);
    params.from = new Date(from).toISOString();
  }

  if (to) {
    where.push(`datetime(eventAt) <= datetime(@to)`);
    params.to = new Date(to).toISOString();
  }

  params.limit = Math.max(1, Math.min(2000, Number(limit || 500)));

  const sql = `
    SELECT *
    FROM customer_events
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY datetime(eventAt) ASC, id ASC
    LIMIT @limit
  `;

  return db.prepare(sql).all(params).map(customerEventFromRow).filter(Boolean);
}

function updateCustomerEvent(idInput, patch = {}) {
  const current = getCustomerEventById(idInput);
  if (!current) return null;

  const next = {
    ...current,
    ...patch,
    id: current.id,
    memberCode: patch.memberCode || current.memberCode,
    eventAt: patch.eventAt || current.eventAt,
    createdAt: current.createdAt,
    updatedAt: new Date().toISOString(),
  };

  return upsertCustomerEvent(next);
}

function getInfo() {
  const membersCount = db.prepare(`SELECT COUNT(*) AS c FROM members`).get().c;
  const ordersCount = db.prepare(`SELECT COUNT(*) AS c FROM orders`).get().c;
  const statusHistoryCount = db.prepare(`SELECT COUNT(*) AS c FROM status_history`).get().c;
  const productsCount = db.prepare(`SELECT COUNT(*) AS c FROM products`).get().c;

  let foodsCount = 0;
  try {
    foodsCount = db.prepare(`SELECT COUNT(*) AS c FROM foods`).get().c;
  } catch {}

  const localAiTrainingCount = db.prepare(`SELECT COUNT(*) AS c FROM local_ai_training`).get().c;
  const localAiMemoryCount = db.prepare(`SELECT COUNT(*) AS c FROM local_ai_memory`).get().c;
  const localAiPendingLearningCount = db.prepare(`SELECT COUNT(*) AS c FROM local_ai_pending_learning`).get().c;
  let customerEventsCount = 0;
try {
  customerEventsCount = db.prepare(`SELECT COUNT(*) AS c FROM customer_events`).get().c;
} catch {}
  return {
    dbPath: DB_PATH,
    membersCount,
    ordersCount,
    statusHistoryCount,
    productsCount,
    foodsCount,
    localAiTrainingCount,
    localAiMemoryCount,
    localAiPendingLearningCount,
    customerEventsCount,
  };
}

module.exports = {
  db,
  DB_PATH,

  importMembersFromJsonIfEmpty,
  importOrdersFromJsonIfEmpty,

  loadMembers,
  replaceAllMembers,
  upsertMember,
  deleteMember,

  loadOrders,
  getOrderById,
  replaceAllOrders,
  upsertOrder,
  upsertOrders,
  getNextOrderId,
  checkpointWal,

  importStatusHistoryFromJsonIfEmpty,
  insertStatusHistory,
  listStatusHistory,

  importProductsFromJsonIfEmpty,
  loadProducts,
  replaceAllProducts,
  upsertProduct,
  deleteProduct,
  updateProductMenusByImageName,

importFoodsFromJsonIfEmpty,
  loadFoods,
  replaceAllFoods,
  upsertFood,
  deleteFood,
  getNextFoodId,

    importLocalAiTrainingFromJsonIfEmpty,
  importLocalAiMemoryFromJsonIfEmpty,
  importLocalAiPendingFromJsonIfEmpty,

  insertLocalAiTraining,
  listLocalAiTraining,

  insertLocalAiMemory,
  listLocalAiMemory,

  insertLocalAiPendingLearning,
  listLocalAiPendingLearning,
  updateLocalAiPendingLearning,

    upsertCustomerEvent,
  getCustomerEventById,
  listCustomerEvents,
  updateCustomerEvent,
    
  getInfo,
};