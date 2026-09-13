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
CREATE INDEX IF NOT EXISTS idx_members_level_code ON members(level, code);
CREATE INDEX IF NOT EXISTS idx_members_apiSyncedAt ON members(apiSyncedAt);

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
  businessDate TEXT,
  updatedAt TEXT,
  rawJson TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_orders_createdAt ON orders(createdAt);
CREATE INDEX IF NOT EXISTS idx_orders_memberCard ON orders(memberCard);
CREATE INDEX IF NOT EXISTS idx_orders_area_table ON orders(area, tableNo);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_tableClosed ON orders(tableClosed);
CREATE INDEX IF NOT EXISTS idx_orders_clientRequestId ON orders(clientRequestId);
CREATE INDEX IF NOT EXISTS idx_orders_status_createdAt ON orders(status, createdAt DESC);
CREATE INDEX IF NOT EXISTS idx_orders_area_table_createdAt ON orders(area, tableNo, createdAt DESC);
CREATE INDEX IF NOT EXISTS idx_orders_member_date ON orders(memberCard, createdAt DESC);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  orderId TEXT NOT NULL,
  itemIndex INTEGER NOT NULL,
  createdAt TEXT,
  businessDate TEXT,
  status TEXT,
  area TEXT,
  tableNo TEXT,
  staff TEXT,
  memberCard TEXT,
  customerName TEXT,
  customerLevel TEXT,
  productCode TEXT,
  itemName TEXT,
  itemGroup TEXT,
  imageName TEXT,
  qty REAL DEFAULT 0,
  unitPrice REAL DEFAULT 0,
  lineTotal REAL DEFAULT 0,
  note TEXT,
  isOffMenu INTEGER DEFAULT 0,
  UNIQUE(orderId, itemIndex)
);

CREATE INDEX IF NOT EXISTS idx_order_items_orderId ON order_items(orderId);
CREATE INDEX IF NOT EXISTS idx_order_items_createdAt ON order_items(createdAt);
CREATE INDEX IF NOT EXISTS idx_order_items_businessDate ON order_items(businessDate);
CREATE INDEX IF NOT EXISTS idx_order_items_status_createdAt ON order_items(status, createdAt);
CREATE INDEX IF NOT EXISTS idx_order_items_product_date ON order_items(productCode, createdAt);
CREATE INDEX IF NOT EXISTS idx_order_items_group_date ON order_items(itemGroup, createdAt);
CREATE INDEX IF NOT EXISTS idx_order_items_member_date ON order_items(memberCard, createdAt);
CREATE INDEX IF NOT EXISTS idx_order_items_table_date ON order_items(area, tableNo, createdAt);

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

// Schema migration an toàn cho DB đã tồn tại trước V8.
function ensureColumn(tableName, columnName, definition) {
  const cols = db.prepare(`PRAGMA table_info(${tableName})`).all();
  if (!cols.some((c) => String(c.name) === columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

ensureColumn('orders', 'businessDate', 'TEXT');
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_orders_businessDate ON orders(businessDate);
  CREATE INDEX IF NOT EXISTS idx_orders_member_date ON orders(memberCard, createdAt DESC);
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

function getMemberByCode(codeInput) {
  const code = cleanCode(codeInput);
  if (!code) return null;
  const row = runSqliteReadWithRetry(() => db.prepare(`SELECT * FROM members WHERE code = ? LIMIT 1`).get(code));
  return memberFromRow(row);
}

function loadMembers() {
  const rows = db.prepare(`SELECT * FROM members`).all();
  const out = {};

  for (const row of rows) {
    out[row.code] = memberFromRow(row);
  }

  return out;
}

// Health nhẹ cho màn Khách hàng: xác nhận SQLite đọc được và lần gần nhất
// Customer API thực sự được ghi xuống bảng members. Các COUNT chỉ chạy trên
// index apiSyncedAt nên vẫn nhẹ khi Database tăng lên hàng trăm nghìn / triệu khách.
function getCustomerSyncHealth() {
  const startedAt = Date.now();
  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

  return runSqliteReadWithRetry(() => {
    const ping = db.prepare(`SELECT 1 AS ok`).get();
    const last = db.prepare(`
      SELECT apiSyncedAt
      FROM members INDEXED BY idx_members_apiSyncedAt
      WHERE apiSyncedAt IS NOT NULL AND apiSyncedAt <> ''
      ORDER BY apiSyncedAt DESC
      LIMIT 1
    `).get();

    const lastHour = db.prepare(`
      SELECT COUNT(*) AS c
      FROM members INDEXED BY idx_members_apiSyncedAt
      WHERE apiSyncedAt >= ?
    `).get(oneHourAgo);

    const last24h = db.prepare(`
      SELECT COUNT(*) AS c
      FROM members INDEXED BY idx_members_apiSyncedAt
      WHERE apiSyncedAt >= ?
    `).get(oneDayAgo);

    // Tổng độ phủ API trong SQLite. COUNT(*) trên bảng members và index apiSyncedAt
    // đủ nhẹ để dùng cho monitor; frontend chủ yếu nhận realtime qua Socket.
    const totalRow = db.prepare(`SELECT COUNT(*) AS c FROM members`).get();
    const syncedRow = db.prepare(`
      SELECT COUNT(*) AS c
      FROM members INDEXED BY idx_members_apiSyncedAt
      WHERE apiSyncedAt IS NOT NULL AND apiSyncedAt <> ''
    `).get();
    const totalMembers = Number(totalRow?.c || 0) || 0;
    const apiSyncedMembers = Number(syncedRow?.c || 0) || 0;

    return {
      ok: Number(ping?.ok || 0) === 1,
      status: Number(ping?.ok || 0) === 1 ? 'ONLINE' : 'ERROR',
      lastApiSyncedAt: last?.apiSyncedAt || null,
      syncedLastHour: Number(lastHour?.c || 0) || 0,
      syncedLast24h: Number(last24h?.c || 0) || 0,
      totalMembers,
      apiSyncedMembers,
      apiPendingMembers: Math.max(0, totalMembers - apiSyncedMembers),
      apiCoveragePercent: totalMembers > 0
        ? Math.round((apiSyncedMembers / totalMembers) * 10000) / 100
        : 0,
      checkedAt: now.toISOString(),
      queryMs: Date.now() - startedAt,
    };
  });
}


// Query phân trang trực tiếp trong SQLite cho màn Khách hàng.
// Tránh tạo/map/sort toàn bộ >60.000 members bằng JavaScript cho mỗi lần search/filter.
function queryMembersPage({ q = '', levels = [], page = 1, limit = 100 } = {}) {
  const where = [];
  const params = {};

  const search = String(q || '').trim().toLowerCase();
  if (search) {
    params.q = `%${search}%`;
    where.push(`(
      LOWER(code) LIKE @q OR
      LOWER(COALESCE(name, '')) LIKE @q OR
      LOWER(COALESCE(customerName, '')) LIKE @q OR
      LOWER(COALESCE(level, '')) LIKE @q OR
      LOWER(COALESCE(memberLevel, '')) LIKE @q
    )`);
  }

  const levelList = Array.from(new Set(
    (Array.isArray(levels) ? levels : String(levels || '').split(','))
      .map((v) => String(v || '').trim().toLowerCase())
      .filter(Boolean)
  ));

  if (levelList.length) {
    const placeholders = [];
    levelList.forEach((value, index) => {
      const key = `lv${index}`;
      params[key] = value;
      placeholders.push(`@${key}`);
    });
    where.push(`LOWER(COALESCE(NULLIF(TRIM(level), ''), NULLIF(TRIM(memberLevel), ''), '')) IN (${placeholders.join(', ')})`);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = Number(db.prepare(`SELECT COUNT(*) AS c FROM members ${whereSql}`).get(params)?.c || 0);

  const safeLimit = Math.max(1, Math.min(70000, Number(limit) || 100));
  const totalPages = Math.max(1, Math.ceil(total / safeLimit));
  const safePage = Math.min(totalPages, Math.max(1, Number(page) || 1));
  params.limit = safeLimit;
  params.offset = (safePage - 1) * safeLimit;

  const rows = runSqliteReadWithRetry(() => db.prepare(`
    SELECT *
    FROM members
    ${whereSql}
    ORDER BY
      CASE WHEN code GLOB '[0-9]*' THEN 0 ELSE 1 END ASC,
      CASE WHEN code GLOB '[0-9]*' THEN CAST(code AS INTEGER) END ASC,
      code COLLATE NOCASE ASC
    LIMIT @limit OFFSET @offset
  `).all(params));

  const summaryRows = runSqliteReadWithRetry(() => db.prepare(`
    SELECT
      COALESCE(NULLIF(TRIM(level), ''), NULLIF(TRIM(memberLevel), ''), 'Chưa có level') AS levelName,
      COUNT(*) AS c
    FROM members
    GROUP BY COALESCE(NULLIF(TRIM(level), ''), NULLIF(TRIM(memberLevel), ''), 'Chưa có level')
  `).all());

  const byLevel = {};
  let summaryTotal = 0;
  for (const row of summaryRows) {
    const name = String(row.levelName || 'Chưa có level').trim() || 'Chưa có level';
    const count = Number(row.c || 0) || 0;
    byLevel[name] = count;
    summaryTotal += count;
  }

  return {
    total,
    page: safePage,
    limit: safeLimit,
    totalPages,
    items: rows.map(memberFromRow).filter(Boolean),
    summary: { total: summaryTotal, byLevel },
  };
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

function businessDate06VN(value = new Date()) {
  const ms = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(ms)) return null;

  // Dịch timestamp sang UTC+7 rồi dùng UTC getters để không phụ thuộc timezone của Windows service.
  const vn = new Date(ms + 7 * 60 * 60 * 1000);
  if (vn.getUTCHours() < 6) vn.setUTCDate(vn.getUTCDate() - 1);
  return `${vn.getUTCFullYear()}-${String(vn.getUTCMonth() + 1).padStart(2, '0')}-${String(vn.getUTCDate()).padStart(2, '0')}`;
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
    businessDate: raw.businessDate || row.businessDate || businessDate06VN(raw.createdAt || row.createdAt),
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
  businessDate,
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
  @businessDate,
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
  businessDate = excluded.businessDate,
  updatedAt = excluded.updatedAt,
  rawJson = excluded.rawJson
`);

const deleteOrderItemsStmt = db.prepare(`DELETE FROM order_items WHERE orderId = ?`);
const findReportProductByImageStmt = db.prepare(`SELECT * FROM products WHERE LOWER(imageName) = LOWER(?) LIMIT 1`);
const findReportProductByCodeStmt = db.prepare(`SELECT * FROM products WHERE LOWER(productCode) = LOWER(?) LIMIT 1`);

function reportProductFallbackForItem(item = {}) {
  const image = String(item.imageName || item.imageKey || '').split('/').pop().trim();
  const code = String(item.productCode || item.code || '').trim();
  let row = null;
  try {
    if (image) row = findReportProductByImageStmt.get(image) || null;
    if (!row && code) row = findReportProductByCodeStmt.get(code) || null;
  } catch (_) {}
  if (!row) return {};
  const raw = safeJsonParse(row.rawJson, {}) || {};
  return {
    imageName: raw.imageName || row.imageName || '',
    productCode: raw.productCode || raw.code || row.productCode || '',
    name: raw.name || raw.productName || row.name || '',
    itemGroup: raw.itemGroup || row.itemGroup || raw.group || row.groupName || '',
    price: Number(raw.price ?? row.price ?? 0) || 0,
  };
}

const insertOrderItemStmt = db.prepare(`
INSERT INTO order_items (
  orderId, itemIndex, createdAt, businessDate, status, area, tableNo, staff,
  memberCard, customerName, customerLevel, productCode, itemName, itemGroup,
  imageName, qty, unitPrice, lineTotal, note, isOffMenu
) VALUES (
  @orderId, @itemIndex, @createdAt, @businessDate, @status, @area, @tableNo, @staff,
  @memberCard, @customerName, @customerLevel, @productCode, @itemName, @itemGroup,
  @imageName, @qty, @unitPrice, @lineTotal, @note, @isOffMenu
)
`);

function syncOrderItems(order) {
  const orderId = String(order?.id || '').trim();
  if (!orderId) return 0;

  deleteOrderItemsStmt.run(orderId);
  const items = Array.isArray(order?.items) ? order.items : [];
  if (!items.length) return 0;

  const createdAt = order.createdAt || null;
  const businessDate = order.businessDate || businessDate06VN(createdAt);
  const customerName = String(order.customerName || order.customer?.name || '').trim() || null;
  const customerLevel = String(order.customerLevel || order.customer?.level || '').trim() || null;
  let inserted = 0;

  items.forEach((item, itemIndex) => {
    const qty = Number(item?.qty ?? item?.quantity ?? 0) || 0;
    if (qty <= 0) return;

    const isOffMenu = item?.isOffMenu ? 1 : 0;
    const productFallback = isOffMenu ? {} : reportProductFallbackForItem(item);

    let unitPrice = Number(item?.price ?? item?.unitPrice ?? item?.unit_price ?? 0) || 0;
    if (!unitPrice) unitPrice = Number(productFallback.price || 0) || 0;
    const explicitLine = Number(item?.lineTotal ?? item?.total ?? item?.amount);
    let lineTotal = Number.isFinite(explicitLine) ? explicitLine : unitPrice * qty;
    if (!unitPrice && qty > 0 && Number.isFinite(lineTotal) && lineTotal > 0) unitPrice = lineTotal / qty;
    if (!Number.isFinite(lineTotal)) lineTotal = 0;

    const productCode = String(
      item?.productCode || item?.code || productFallback.productCode || (isOffMenu ? 'H100' : '')
    ).trim();
    const imageName = String(item?.imageName || item?.imageKey || productFallback.imageName || '').split('/').pop().trim();
    const itemName = String(item?.name || item?.productName || productFallback.name || imageName || (isOffMenu ? 'OFF MENU' : '')).trim();
    const itemGroup = String(item?.itemGroup || item?.group || productFallback.itemGroup || (isOffMenu ? 'OFF MENU' : '')).trim();

    insertOrderItemStmt.run({
      orderId,
      itemIndex,
      createdAt,
      businessDate,
      status: String(order.status || 'PENDING').toUpperCase(),
      area: order.area == null ? null : String(order.area),
      tableNo: order.tableNo == null ? null : String(order.tableNo),
      staff: order.staff == null ? null : String(order.staff),
      memberCard: order.memberCard == null ? null : String(order.memberCard),
      customerName,
      customerLevel,
      productCode,
      itemName,
      itemGroup,
      imageName,
      qty,
      unitPrice,
      lineTotal,
      note: String(item?.note || '').trim(),
      isOffMenu,
    });
    inserted += 1;
  });

  return inserted;
}

function upsertOrder(orderInput) {
  if (!orderInput?.id) return false;

  const createdAt = orderInput.createdAt || null;
  const order = {
    ...orderInput,
    id: String(orderInput.id),
    businessDate: orderInput.businessDate || businessDate06VN(createdAt),
  };

  const customerName = order.customerName || order.customer?.name || null;
  const customerLevel = order.customerLevel || order.customer?.level || null;

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
    createdAt,
    businessDate: order.businessDate || null,
    updatedAt: order.updatedAt || null,
    rawJson: JSON.stringify(order),
  });

  syncOrderItems(order);
  return true;
}

const loadOrdersStmt = db.prepare(`
  SELECT *
  FROM orders
  ORDER BY createdAt DESC
`);

function loadOrders() {
  const rows = runSqliteReadWithRetry(() => loadOrdersStmt.all());
  return rows.map(orderFromRow).filter(Boolean);
}

function queryOrders({
  customerId = '',
  status = '',
  area = '',
  tableNo = '',
  includeClosed = true,
  from = '',
  to = '',
  limit = null,
} = {}) {
  const where = [];
  const params = {};

  const customer = String(customerId || '').trim();
  if (customer) {
    where.push(`memberCard = @customerId`);
    params.customerId = customer;
  }

  const areaText = String(area || '').trim();
  if (areaText) {
    where.push(`area = @area`);
    params.area = areaText;
  }

  const tableText = String(tableNo ?? '').trim();
  if (tableText) {
    where.push(`tableNo = @tableNo`);
    params.tableNo = tableText;
  }

  if (areaText && tableText && includeClosed === false) where.push(`tableClosed = 0`);

  const statusText = String(status || '').trim().toUpperCase();
  if (statusText && statusText !== 'ALL') {
    if (statusText === 'OPEN') where.push(`status IN ('PENDING', 'IN_PROGRESS')`);
    else {
      where.push(`status = @status`);
      params.status = statusText;
    }
  }

  const fromText = String(from || '').trim();
  if (fromText && Number.isFinite(Date.parse(fromText))) {
    where.push(`createdAt >= @from`);
    params.from = new Date(fromText).toISOString();
  }

  const toText = String(to || '').trim();
  if (toText && Number.isFinite(Date.parse(toText))) {
    where.push(`createdAt <= @to`);
    params.to = new Date(toText).toISOString();
  }

  let limitSql = '';
  if (limit != null && Number.isFinite(Number(limit))) {
    params.limit = Math.max(1, Math.min(100000, Number(limit)));
    limitSql = 'LIMIT @limit';
  }

  const sql = `
    SELECT *
    FROM orders
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY createdAt DESC
    ${limitSql}
  `;

  const rows = runSqliteReadWithRetry(() => db.prepare(sql).all(params));
  return rows.map(orderFromRow).filter(Boolean);
}

const upsertOrdersTx = db.transaction((arr) => {
  for (const order of arr || []) upsertOrder(order);
});

function upsertOrders(orderArr = []) {
  upsertOrdersTx(Array.isArray(orderArr) ? orderArr : []);
  return true;
}

function reportWhere(from = '', to = '', alias = 'oi') {
  const where = [`${alias}.status = 'DONE'`];
  const params = {};
  if (from && Number.isFinite(Date.parse(from))) {
    params.from = new Date(from).toISOString();
    where.push(`${alias}.createdAt >= @from`);
  }
  if (to && Number.isFinite(Date.parse(to))) {
    params.to = new Date(to).toISOString();
    where.push(`${alias}.createdAt <= @to`);
  }
  return { whereSql: `WHERE ${where.join(' AND ')}`, params };
}

function queryScalableReport({ type = 'orders_detail', from = '', to = '', page = 1, limit = 100, exchangeRate = 27000 } = {}) {
  const allowed = new Set(['orders_detail', 'hanghoa_mon', 'hanghoa_nhom', 'hanghoa_ban', 'khachhang_tomtat', 'khachhang_chitiet']);
  if (!allowed.has(type)) throw new Error('INVALID_REPORT_TYPE');

  const safeLimit = Math.max(20, Math.min(500, Number(limit) || 100));
  const safePage = Math.max(1, Number(page) || 1);
  const offset = (safePage - 1) * safeLimit;
  const rate = Math.max(1, Number(exchangeRate) || 27000);
  const { whereSql, params } = reportWhere(from, to, 'oi');

  const summary = runSqliteReadWithRetry(() => db.prepare(`
    SELECT COUNT(DISTINCT oi.orderId) AS totalOrders,
           COALESCE(SUM(oi.lineTotal), 0) AS totalRevenue,
           COALESCE(SUM(oi.qty), 0) AS totalQty
    FROM order_items oi
    ${whereSql}
  `).get(params)) || {};

  const base = {
    type,
    totalOrders: Number(summary.totalOrders || 0),
    totalRevenue: Number(summary.totalRevenue || 0),
    totalRevenueUSD: Number(summary.totalRevenue || 0) / rate,
    totalQty: Number(summary.totalQty || 0),
  };

  if (type === 'hanghoa_mon') {
    const rows = runSqliteReadWithRetry(() => db.prepare(`
      SELECT
        COALESCE(NULLIF(TRIM(oi.productCode), ''), NULLIF(TRIM(oi.imageName), ''), oi.itemName) AS itemKey,
        MAX(oi.itemName) AS name,
        MAX(oi.productCode) AS code,
        MAX(COALESCE(NULLIF(TRIM(oi.itemGroup), ''), '(Chưa có nhóm)')) AS \"group\",
        SUM(oi.qty) AS qty,
        SUM(oi.lineTotal) AS revenue
      FROM order_items oi
      ${whereSql}
      GROUP BY COALESCE(NULLIF(TRIM(oi.productCode), ''), NULLIF(TRIM(oi.imageName), ''), oi.itemName)
      ORDER BY revenue DESC, name COLLATE NOCASE ASC
      LIMIT 5000
    `).all(params));
    return { ...base, rows };
  }

  if (type === 'hanghoa_nhom') {
    const rows = runSqliteReadWithRetry(() => db.prepare(`
      SELECT COALESCE(NULLIF(TRIM(oi.itemGroup), ''), '(Chưa có nhóm)') AS \"group\",
             SUM(oi.qty) AS qty,
             SUM(oi.lineTotal) AS revenue
      FROM order_items oi
      ${whereSql}
      GROUP BY COALESCE(NULLIF(TRIM(oi.itemGroup), ''), '(Chưa có nhóm)')
      ORDER BY revenue DESC, \"group\" COLLATE NOCASE ASC
    `).all(params));
    return { ...base, rows };
  }

  if (type === 'hanghoa_ban') {
    const rows = runSqliteReadWithRetry(() => db.prepare(`
      SELECT CASE
               WHEN COALESCE(TRIM(oi.area), '') = '' AND COALESCE(TRIM(oi.tableNo), '') = '' THEN '(Không rõ bàn)'
               WHEN COALESCE(TRIM(oi.area), '') = '' THEN oi.tableNo
               WHEN COALESCE(TRIM(oi.tableNo), '') = '' THEN oi.area
               ELSE oi.area || '-' || oi.tableNo
             END AS tableName,
             SUM(oi.qty) AS qty,
             SUM(oi.lineTotal) AS revenue
      FROM order_items oi
      ${whereSql}
      GROUP BY oi.area, oi.tableNo
      ORDER BY revenue DESC, tableName COLLATE NOCASE ASC
    `).all(params)).map((r) => ({ table: r.tableName, qty: r.qty, revenue: r.revenue }));
    return { ...base, rows };
  }

  if (type === 'orders_detail') {
    const countRow = runSqliteReadWithRetry(() => db.prepare(`SELECT COUNT(*) AS c FROM order_items oi ${whereSql}`).get(params));
    const totalRows = Number(countRow?.c || 0);
    const rows = runSqliteReadWithRetry(() => db.prepare(`
      SELECT oi.*
      FROM order_items oi
      ${whereSql}
      ORDER BY oi.createdAt DESC, CAST(oi.orderId AS INTEGER) DESC, oi.itemIndex ASC
      LIMIT @limit OFFSET @offset
    `).all({ ...params, limit: safeLimit, offset }));
    return {
      ...base,
      rows,
      pagination: { page: safePage, limit: safeLimit, totalRows, totalPages: Math.max(1, Math.ceil(totalRows / safeLimit)) },
    };
  }

  if (type === 'khachhang_tomtat') {
    const groupSql = `
      SELECT
        COALESCE(NULLIF(TRIM(oi.memberCard), ''), 'NO_CODE:' || oi.orderId) AS customerKey,
        MAX(COALESCE(NULLIF(TRIM(oi.memberCard), ''), '')) AS code,
        MAX(COALESCE(NULLIF(TRIM(oi.customerName), ''), '')) AS name,
        MAX(COALESCE(NULLIF(TRIM(oi.customerLevel), ''), '')) AS level,
        SUM(oi.qty) AS qty,
        SUM(oi.lineTotal) AS revenue
      FROM order_items oi
      ${whereSql}
      GROUP BY COALESCE(NULLIF(TRIM(oi.memberCard), ''), 'NO_CODE:' || oi.orderId)
    `;
    const totalRows = Number(runSqliteReadWithRetry(() => db.prepare(`SELECT COUNT(*) AS c FROM (${groupSql})`).get(params))?.c || 0);
    const rows = runSqliteReadWithRetry(() => db.prepare(`
      SELECT * FROM (${groupSql})
      ORDER BY revenue DESC, code COLLATE NOCASE ASC
      LIMIT @limit OFFSET @offset
    `).all({ ...params, limit: safeLimit, offset })).map((r) => ({ id: r.customerKey, ...r }));
    return { ...base, rows, pagination: { page: safePage, limit: safeLimit, totalRows, totalPages: Math.max(1, Math.ceil(totalRows / safeLimit)) } };
  }

  // khachhang_chitiet: phân trang theo khách, rồi lấy các món của đúng page đó.
  const customerGroupSql = `
    SELECT
      COALESCE(NULLIF(TRIM(oi.memberCard), ''), 'NO_CODE:' || oi.orderId) AS customerKey,
      MAX(COALESCE(NULLIF(TRIM(oi.memberCard), ''), '')) AS code,
      MAX(COALESCE(NULLIF(TRIM(oi.customerName), ''), '')) AS name,
      MAX(COALESCE(NULLIF(TRIM(oi.customerLevel), ''), '')) AS level,
      SUM(oi.qty) AS qty,
      SUM(oi.lineTotal) AS revenue
    FROM order_items oi
    ${whereSql}
    GROUP BY COALESCE(NULLIF(TRIM(oi.memberCard), ''), 'NO_CODE:' || oi.orderId)
  `;
  const totalRows = Number(runSqliteReadWithRetry(() => db.prepare(`SELECT COUNT(*) AS c FROM (${customerGroupSql})`).get(params))?.c || 0);
  const customers = runSqliteReadWithRetry(() => db.prepare(`
    SELECT * FROM (${customerGroupSql})
    ORDER BY revenue DESC, code COLLATE NOCASE ASC
    LIMIT @limit OFFSET @offset
  `).all({ ...params, limit: safeLimit, offset })).map((r) => ({ id: r.customerKey, ...r, items: [] }));

  if (customers.length) {
    const keys = customers.map((c) => c.customerKey);
    const keyParams = { ...params };
    const placeholders = keys.map((k, i) => { keyParams[`ck${i}`] = k; return `@ck${i}`; }).join(',');
    const itemRows = runSqliteReadWithRetry(() => db.prepare(`
      SELECT
        COALESCE(NULLIF(TRIM(oi.memberCard), ''), 'NO_CODE:' || oi.orderId) AS customerKey,
        COALESCE(NULLIF(TRIM(oi.itemName), ''), NULLIF(TRIM(oi.productCode), ''), oi.imageName, '(Không rõ món)') AS name,
        SUM(oi.qty) AS qty,
        SUM(oi.lineTotal) AS revenue
      FROM order_items oi
      ${whereSql}
        AND COALESCE(NULLIF(TRIM(oi.memberCard), ''), 'NO_CODE:' || oi.orderId) IN (${placeholders})
      GROUP BY customerKey, COALESCE(NULLIF(TRIM(oi.itemName), ''), NULLIF(TRIM(oi.productCode), ''), oi.imageName, '(Không rõ món)')
      ORDER BY revenue DESC
    `).all(keyParams));
    const byKey = new Map(customers.map((c) => [c.customerKey, c]));
    itemRows.forEach((r) => byKey.get(r.customerKey)?.items.push({ name: r.name, qty: r.qty, revenue: r.revenue }));
  }

  return { ...base, customers, pagination: { page: safePage, limit: safeLimit, totalRows, totalPages: Math.max(1, Math.ceil(totalRows / safeLimit)) } };
}

function iterateScalableReportRows({ type = 'orders_detail', from = '', to = '' } = {}) {
  const { whereSql, params } = reportWhere(from, to, 'oi');

  if (type === 'orders_detail') {
    return db.prepare(`SELECT oi.* FROM order_items oi ${whereSql} ORDER BY oi.createdAt DESC, CAST(oi.orderId AS INTEGER) DESC, oi.itemIndex ASC`).iterate(params);
  }
  if (type === 'hanghoa_mon') {
    return db.prepare(`
      SELECT MAX(oi.itemName) AS name, MAX(oi.productCode) AS code,
             MAX(COALESCE(NULLIF(TRIM(oi.itemGroup), ''), '(Chưa có nhóm)')) AS \"group\",
             SUM(oi.qty) AS qty, SUM(oi.lineTotal) AS revenue
      FROM order_items oi ${whereSql}
      GROUP BY COALESCE(NULLIF(TRIM(oi.productCode), ''), NULLIF(TRIM(oi.imageName), ''), oi.itemName)
      ORDER BY revenue DESC
    `).iterate(params);
  }
  if (type === 'hanghoa_nhom') {
    return db.prepare(`SELECT COALESCE(NULLIF(TRIM(oi.itemGroup), ''), '(Chưa có nhóm)') AS \"group\", SUM(oi.qty) AS qty, SUM(oi.lineTotal) AS revenue FROM order_items oi ${whereSql} GROUP BY COALESCE(NULLIF(TRIM(oi.itemGroup), ''), '(Chưa có nhóm)') ORDER BY revenue DESC`).iterate(params);
  }
  if (type === 'hanghoa_ban') {
    return db.prepare(`SELECT oi.area, oi.tableNo, SUM(oi.qty) AS qty, SUM(oi.lineTotal) AS revenue FROM order_items oi ${whereSql} GROUP BY oi.area, oi.tableNo ORDER BY revenue DESC`).iterate(params);
  }
  if (type === 'khachhang_tomtat') {
    return db.prepare(`SELECT MAX(oi.memberCard) AS code, MAX(oi.customerName) AS name, MAX(oi.customerLevel) AS level, SUM(oi.qty) AS qty, SUM(oi.lineTotal) AS revenue FROM order_items oi ${whereSql} GROUP BY COALESCE(NULLIF(TRIM(oi.memberCard), ''), 'NO_CODE:' || oi.orderId) ORDER BY revenue DESC`).iterate(params);
  }
  return db.prepare(`
    SELECT MAX(oi.memberCard) AS code, MAX(oi.customerName) AS customerName, MAX(oi.customerLevel) AS level,
           COALESCE(NULLIF(TRIM(oi.itemName), ''), NULLIF(TRIM(oi.productCode), ''), oi.imageName, '(Không rõ món)') AS itemName,
           SUM(oi.qty) AS qty, SUM(oi.lineTotal) AS revenue
    FROM order_items oi ${whereSql}
    GROUP BY COALESCE(NULLIF(TRIM(oi.memberCard), ''), 'NO_CODE:' || oi.orderId), itemName
    ORDER BY code COLLATE NOCASE ASC, revenue DESC
  `).iterate(params);
}

function backfillReportData() {
  const rows = runSqliteReadWithRetry(() => db.prepare(`
    SELECT o.*
    FROM orders o
    WHERE o.businessDate IS NULL
       OR NOT EXISTS (SELECT 1 FROM order_items oi WHERE oi.orderId = o.id)
    ORDER BY o.createdAt ASC
  `).all());

  if (!rows.length) return { orders: 0, items: 0 };
  let items = 0;
  const tx = db.transaction((legacyRows) => {
    legacyRows.forEach((row) => {
      const order = orderFromRow(row);
      if (!order) return;
      upsertOrder(order);
      items += Array.isArray(order.items) ? order.items.filter((it) => Number(it?.qty ?? it?.quantity ?? 0) > 0).length : 0;
    });
  });
  tx(rows);
  return { orders: rows.length, items };
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
    // order_items là bảng index report dẫn xuất từ orders; phải xóa cùng lúc để không còn orphan.
    db.prepare(`DELETE FROM order_items`).run();
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

  // Sold Out / Available là trạng thái thủ công do Admin/Kitchen quản lý.
  // quantity chỉ còn là field legacy và TUYỆT ĐỐI không được phép đổi status.
  const requestedStatus = String(f.status || '').trim();
  f.status = ['Available', 'Sold Out'].includes(requestedStatus)
    ? requestedStatus
    : 'Available';

  if (!Array.isArray(f.levelAccess)) {
    f.levelAccess = [];
  }

  const qtyNum = Number(f.quantity);
  f.quantity = Number.isFinite(qtyNum) ? Math.max(0, qtyNum) : 1;

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
  let orderItemsCount = 0;
  try { orderItemsCount = db.prepare(`SELECT COUNT(*) AS c FROM order_items`).get().c; } catch {}
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
    orderItemsCount,
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
  getCustomerSyncHealth,
  queryMembersPage,
  replaceAllMembers,
  upsertMember,
  deleteMember,
  getMemberByCode,

  loadOrders,
  queryOrders,
  queryScalableReport,
  iterateScalableReportRows,
  backfillReportData,
  businessDate06VN,
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