'use strict';

const fs = require('fs');
const path = require('path');
// Danh sách khu vực và dải số bàn chuẩn của app
const AREA_DEFS = [
  { name: 'Roulette 1', ranges: [[101, 117]] },
  { name: 'Roulette 2', ranges: [[201, 231]] },
  { name: 'Roulette 3', ranges: [[301, 317]] },
  { name: 'Multi', ranges: [[501, 510]] },
  { name: 'Non - Smoking', ranges: [[1001, 1008]] },
  { name: 'Reception 2', ranges: [[1009, 1024]] },
  { name: 'Center', ranges: [[1025, 1030], [5001, 5008], [3001, 3027]] },
  { name: 'Table', ranges: [[11, 15], [21, 25]] },
  { name: '2 Floor', ranges: [[2001, 2028]] },
];
function readJsonSafe(file, fallback) {
  try {
    if (!file || !fs.existsSync(file)) return fallback;
    const raw = fs.readFileSync(file, 'utf8') || '';
    if (!raw.trim()) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeJsonSafe(file, data) {
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

function removeVietnameseAccent(str) {
  return String(str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');
}

function norm(str) {
  return removeVietnameseAccent(str)
    .toLowerCase()
    .replace(/[_\-.\/]+/g, ' ')
    .replace(/[^a-z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function basenameLower(v) {
  return (String(v || '').split('/').pop() || '').toLowerCase().trim();
}

function cleanDishName(raw) {
  let s = String(raw || '').split('/').pop() || '';
  s = s.replace(/\?.*$/, '');
  s = s.replace(/\.[A-Za-z0-9]{2,5}$/i, '');
  // bỏ timestamp cuối: strawberry smoothie-1763843415030 -> strawberry smoothie
  s = s.replace(/[-_\s]+\d{10,17}$/g, '');
  // bỏ mã đầu file kiểu k17.dwaeji-gukbap -> dwaeji gukbap
  s = s.replace(/^[a-z]{1,3}\d{1,3}[\s._-]+/i, '');
  s = s.replace(/[._-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return s ? s.toUpperCase() : '';
}

function fmtDateTime(v) {
  if (!v) return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function getBusinessRangeToday(now = new Date()) {
  const start = new Date(now);
  start.setHours(6, 0, 0, 0);
  if (now < start) start.setDate(start.getDate() - 1);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  end.setMilliseconds(-1);
  return { from: start, to: end, label: 'hôm nay' };
}

function getBusinessRangeYesterday(now = new Date()) {
  const today = getBusinessRangeToday(now);
  const from = new Date(today.from);
  from.setDate(from.getDate() - 1);
  const to = new Date(today.from.getTime() - 1);
  return { from, to, label: 'hôm qua' };
}

function getRangeFromMessage(message) {
  const m = norm(message);
  if (m.includes('hom qua')) return getBusinessRangeYesterday();
  if (m.includes('hom nay') || m.includes('today')) return getBusinessRangeToday();
  if (m.includes('7 ngay') || m.includes('tuan nay') || m.includes('last 7')) {
    const to = new Date();
    const from = new Date(to);
    from.setDate(from.getDate() - 7);
    return { from, to, label: '7 ngày gần đây' };
  }
  if (m.includes('30 ngay') || m.includes('thang nay') || m.includes('last 30')) {
    const to = new Date();
    const from = new Date(to);
    from.setDate(from.getDate() - 30);
    return { from, to, label: '30 ngày gần đây' };
  }
  return null;
}

function inRange(order, range) {
  if (!range) return true;
  const t = new Date(order?.createdAt || order?.updatedAt || 0).getTime();
  if (!Number.isFinite(t)) return false;
  return t >= range.from.getTime() && t <= range.to.getTime();
}

function loadData(paths = {}) {
  const orders = readJsonSafe(paths.orders, []);
  const foods = readJsonSafe(paths.foods, []);
  const productsRaw = readJsonSafe(paths.products, []);
  const products = Array.isArray(productsRaw) ? productsRaw : (Array.isArray(productsRaw?.rows) ? productsRaw.rows : []);
  const members = readJsonSafe(paths.members, {});
  const training = readJsonSafe(paths.training, []);
  const memory = readJsonSafe(paths.memory, []);
  const pendingLearning = readJsonSafe(paths.pendingLearning, []);
  return { orders, foods, products, members, training, memory, pendingLearning };
}

function buildProductMaps(products = [], foods = []) {
  const byImage = new Map();
  const byNameNorm = new Map();
  const byCodeNorm = new Map();

  for (const p of products || []) {
    const img = basenameLower(p.imageName || p.imageUrl || p.id || '');
    const row = {
      imageName: img,
      name: String(p.name || p.productName || cleanDishName(img) || '').trim(),
      productCode: String(p.productCode || p.code || '').trim(),
      itemGroup: String(p.itemGroup || p.group || '').trim(),
      menuType: String(p.menuType || '').trim(),
      price: Number.isFinite(Number(p.price)) ? Number(p.price) : null,
    };
    if (img) byImage.set(img, row);
    if (row.name) byNameNorm.set(norm(row.name), row);
    if (row.productCode) byCodeNorm.set(norm(row.productCode), row);
  }

  for (const f of foods || []) {
    const img = basenameLower(f.imageUrl || '');
    if (!img) continue;
    const prev = byImage.get(img) || {};
    byImage.set(img, {
      ...prev,
      imageName: img,
      name: prev.name || f.name || cleanDishName(img),
      productCode: prev.productCode || f.productCode || f.code || '',
      itemGroup: prev.itemGroup || f.itemGroup || f.group || '',
      menuType: prev.menuType || f.type || '',
      status: f.status || prev.status || '',
      quantity: f.quantity ?? prev.quantity ?? null,
    });
  }

  return { byImage, byNameNorm, byCodeNorm };
}

function enrichItem(item = {}, maps) {
  const isOffMenu = Boolean(item.isOffMenu);
  const imageKey = basenameLower(item.imageName || item.imageKey || item.imageUrl || '');
  const meta = imageKey ? (maps.byImage.get(imageKey) || {}) : {};

  const name = String(
    item.name || item.productName || meta.name || cleanDishName(imageKey) || '(Không rõ tên)'
  ).trim();

  const productCode = String(item.productCode || item.code || meta.productCode || '').trim();
  const itemGroup = String(item.itemGroup || item.group || meta.itemGroup || '').trim();
  const qty = Math.max(1, Number(item.qty || item.quantity || 1));

  return {
    isOffMenu,
    imageKey,
    name: name.toUpperCase(),
    nameNorm: norm(name),
    productCode,
    productCodeNorm: norm(productCode),
    itemGroup,
    itemGroupNorm: norm(itemGroup),
    menuType: meta.menuType || item.type || '',
    status: meta.status || '',
    quantityStock: meta.quantity,
    qty,
    note: String(item.note || '').trim(),
    price: Number.isFinite(Number(item.price ?? meta.price)) ? Number(item.price ?? meta.price) : null,
  };
}

function customerNameFromOrder(order, members) {
  const code = String(order?.memberCard || order?.customer?.code || '').trim();
  const m = code ? (members[code] || {}) : {};
  return String(order?.customer?.name || order?.customerName || m.name || m.customerName || '').trim();
}

function customerLevelFromOrder(order, members) {
  const code = String(order?.memberCard || order?.customer?.code || '').trim();
  const m = code ? (members[code] || {}) : {};
  return String(order?.customer?.level || m.level || m.memberLevel || '').trim();
}

function compactCode(v) {
  return String(v || '').replace(/[^A-Za-z0-9]/g, '').trim();
}

function isCodeStopToken(t) {
  return /^(nay|này|co|có|hay|thuong|thường|an|ăn|uong|uống|order|goi|gọi|gio|giờ|luc|lúc|may|mấy|ghi|chu|chú|note|mon|món|gi|gì|chua|chưa|ko|khong|không|k|cho|da|đã|tung|từng)$/i.test(String(t || ''));
}

function looksLikeCustomerQuestion(message) {
  const m = norm(message);
  if (!m) return false;

  const padded = ` ${m} `;
  const tokens = m.split(' ').filter(Boolean);
  const firstLooksLikeCode = tokens.length >= 2 && compactCode(tokens[0]) && !isCodeStopToken(tokens[0]);
  const hasCustomerMarker = ['khach', 'customer', 'member', 'card'].some((x) => padded.includes(` ${x} `));
  const hasOrderDateIntent = ['hom nay', 'hom qua', 'today', 'yesterday', '7 ngay', '30 ngay', 'tuan nay', 'thang nay', 'gan day', 'order', 'goi', 'goi mon', 'dat mon', 'an', 'uong'].some((x) => padded.includes(` ${x} `));

  // Cho phép câu thiếu chữ "khách" nhưng bắt đầu bằng mã khách:
  // "1 hôm qua có order không", "1 hôm nay ăn gì", "1613 order gì gần nhất".
  if (firstLooksLikeCode && hasOrderDateIntent) return true;

  // Tránh hiểu nhầm câu chung kiểu "top 5 món hôm nay" thành khách mã 5.
  const blockedGeneral = ['top', 'ban chay', 'sold out', 'in stock', 'hom nay', 'hom qua', 'bao cao', 'doanh thu', 'gia', 'tong tien'].some((x) => padded.includes(` ${x} `));
  if (blockedGeneral && !hasCustomerMarker) return false;

  return ['co', 'hay', 'thuong', 'an', 'uong', 'order', 'goi', 'goi y', 'suggest', 'recommend', 'ghi chu', 'note', 'luc', 'gio', 'may gio', 'so thich', 'chua', 'ko', 'khong', 'k'].some((x) => padded.includes(` ${x} `));
}

function pickCodeAfterToken(tokens, startIdx) {
  const parts = [];
  for (let i = startIdx; i < tokens.length; i += 1) {
    const t = tokens[i];
    if (!t || isCodeStopToken(t)) break;
    if (/^(ma|mã|so|số|code|hang|hàng)$/i.test(t)) continue;
    if (/^[a-z0-9]+$/i.test(t)) parts.push(t);
    else break;
    if (parts.join('').length >= 12) break;
  }
  return compactCode(parts.join(''));
}
function looksLikeRealCustomerCode(v) {
  const s = compactCode(v);
  if (!s) return false;

  // Tránh bắt nhầm chữ thường trong câu hỏi tổng quan.
  const bad = new Set([
    'khach', 'customer', 'member', 'card',
    'tong', 'hom', 'nay', 'qua', 'ban', 'o',
    'top', 'ai', 'bao', 'nhieu', 'so', 'co',
    'order', 'goi', 'mon', 'it', 'nhieu', 'nhat',
  ]);

  if (bad.has(norm(s))) return false;

  // Mã khách thật thường là số, hoặc mã có chữ + số như A123.
  // Không cho chữ thuần như "khach", "tong", "hom".
  return /\d/.test(s);
}
function getCustomerCodeFromMessage(message, context = {}) {
  const ctxCode = context?.memberCard || context?.customerCode || context?.currentMemberCard || context?.customer?.code;
  const normalized = norm(message);
  const tokens = normalized.split(/\s+/).filter(Boolean);

  // 1) Bắt các mẫu có chữ khách/customer/member/card.
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i];
    const isMarker = ['khach', 'customer', 'member', 'card'].includes(t)
      || (t === 'ma' && ['khach', 'member', 'card', 'customer'].includes(tokens[i + 1]))
      || (t === 'customer' && tokens[i + 1] === 'code');
    if (!isMarker) continue;
    const start = (t === 'ma' || (t === 'customer' && tokens[i + 1] === 'code')) ? i + 2 : i + 1;
    const code = pickCodeAfterToken(tokens, start);
    if (code && looksLikeRealCustomerCode(code)) return code;
  }

  // 2) Bắt mẫu "gợi ý món cho 123".
  const choIdx = tokens.lastIndexOf('cho');
  if (choIdx >= 0 && /\b(goi y|suggest|recommend|nen)\b/.test(normalized)) {
    const code = pickCodeAfterToken(tokens, choIdx + 1);
   if (code && looksLikeRealCustomerCode(code)) return code;
  }

  // 3) Bắt câu thiếu chữ khách: "1 hay uống gì", "1 có ăn cơm chiên không?".
  if (tokens.length >= 2 && looksLikeCustomerQuestion(message)) {
    const first = compactCode(tokens[0]);
   if (first && !isCodeStopToken(first) && /^[a-z0-9]{1,12}$/i.test(first) && looksLikeRealCustomerCode(first)) {
  return first;
}
  }

  // 4) Nếu đang ở context bàn/khách hiện tại thì dùng context.
  if (ctxCode) return compactCode(ctxCode);
  return '';
}

function getCustomerOrders(orders, code, range = null) {
  const c = String(code || '').trim();
  return (orders || [])
    .filter((o) => o && o.status !== 'CANCELLED')
    .filter((o) => String(o.memberCard || o.customer?.code || '').trim() === c)
    .filter((o) => inRange(o, range))
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
}

function isBeverageItem(it) {
  const hay = `${it.nameNorm} ${it.itemGroupNorm} ${it.productCodeNorm}`;
  return (
    it.itemGroupNorm.includes('beverage') ||
    it.itemGroupNorm.includes('drink') ||
    /\b(smoothie|juice|coffee|cafe|tea|water|coke|coca|soda|milk|beer|wine)\b/.test(hay) ||
    /\b(sinh to|nuoc ep|ca phe|tra|nuoc suoi|do uong|thuc uong)\b/.test(hay) ||
    /^b\d+$/i.test(it.productCode)
  );
}

const FOOD_ALIAS_GROUPS = [
  { id: 'noodle', label: 'mì/noodles', terms: ['mi', 'my', 'mì', 'mỳ', 'noodle', 'noodles', 'ramen', 'ramyun', 'udon', 'soba', 'pho', 'phở', 'chapagetti', 'jjamppong', 'jjajang', 'jjajangmyoen', 'wonton noodles', 'cold noodle'] },
  { id: 'rice', label: 'cơm/rice', terms: ['com', 'cơm', 'rice', 'bibimbap', 'gukbap', 'curry rice'] },
  { id: 'friedrice', label: 'cơm chiên/fried rice', terms: ['com chien', 'cơm chiên', 'fried rice', 'wok fried rice'] },
  { id: 'congee', label: 'cháo/congee', terms: ['chao', 'cháo', 'congee', 'porridge'] },
  { id: 'soup', label: 'súp/canh/soup', terms: ['sup', 'súp', 'soup', 'canh', 'tang', 'guk', 'jjigae', 'haejangguk', 'miyukguk'] },
  { id: 'egg', label: 'trứng/egg', terms: ['trung', 'trứng', 'egg', 'fried egg', 'boil egg', 'boiled egg', 'egg tart'] },
  { id: 'beef', label: 'bò/beef', terms: ['beef', 'galbi', 'tenderloin', 'sirloin', 'bulgogi'] },
  { id: 'chicken', label: 'gà/chicken', terms: ['ga', 'gà', 'chicken', 'satay'] },
  { id: 'pork', label: 'heo/pork', terms: ['heo', 'lợn', 'lon', 'pork', 'bbq pork', 'char siu', 'jok bal', 'samgyupsal'] },
  { id: 'seafood', label: 'hải sản/seafood', terms: ['hai san', 'hải sản', 'seafood', 'prawn', 'shrimp', 'tom', 'tôm', 'squid', 'muc', 'mực', 'scallop', 'lobster'] },
  { id: 'fish', label: 'cá/fish', terms: ['fish', 'grouper', 'tooth fish', 'fish cake'] },
  { id: 'tofu', label: 'đậu hũ/tofu', terms: ['dau hu', 'đậu hũ', 'tofu'] },
  { id: 'salad', label: 'salad/rau', terms: ['rau', 'salad', 'asparagus', 'celery', 'vegetable', 'veggie'] },
  { id: 'bakery', label: 'bánh/bakery', terms: ['banh', 'bánh', 'cake', 'tart', 'croissant', 'croffle', 'bun', 'sandwich', 'banh mi', 'bread', 'dimsum', 'dumpling'] },
  { id: 'sandwich', label: 'bánh mì/sandwich', terms: ['banh mi', 'bánh mì', 'sandwich', 'bread'] },
  { id: 'fries', label: 'khoai tây/fries', terms: ['khoai', 'khoai tay', 'khoai tây', 'fries', 'french fried', 'french fries', 'potato'] },
  { id: 'smoothie', label: 'sinh tố/smoothie', terms: ['sinh to', 'sinh tố', 'smoothie'] },
  { id: 'juice', label: 'nước ép/juice', terms: ['nuoc ep', 'nước ép', 'juice'] },
  { id: 'coffee', label: 'cà phê/coffee', terms: ['ca phe', 'cà phê', 'cafe', 'coffee', 'americano', 'latte', 'espresso', 'cappuccino'] },
  { id: 'tea', label: 'trà/tea', terms: ['tra', 'trà', 'tea', 'oolong', 'chamomile'] },
  { id: 'water', label: 'nước suối/water', terms: ['nuoc suoi', 'nước suối', 'water', 'evian', 'filtered water', 'soda', 'aquafina'] },
  { id: 'softdrink', label: 'nước ngọt/soft drink', terms: ['nuoc ngot', 'nước ngọt', 'soft drink', 'coke', 'coca', 'cola', '7 up', 'sprite', 'zero'] },
  { id: 'beer', label: 'bia/beer', terms: ['bia', 'beer', 'heineken'] },
  { id: 'wine', label: 'rượu/wine', terms: ['ruou', 'rượu', 'wine', 'champagne'] },
  { id: 'avocado', label: 'bơ/avocado', terms: ['avocado'] },
  { id: 'mango', label: 'xoài/mango', terms: ['xoai', 'xoài', 'mango'] },
  { id: 'strawberry', label: 'dâu/strawberry', terms: ['strawberry'] },
  { id: 'apple', label: 'táo/apple', terms: ['tao', 'táo', 'apple'] },
  { id: 'coconut', label: 'dừa/coconut', terms: ['dua', 'dừa', 'coconut'] },
  { id: 'passionfruit', label: 'chanh dây/passion fruit', terms: ['chanh day', 'chanh dây', 'passion fruit'] },
  { id: 'garlic', label: 'tỏi/garlic', terms: ['toi', 'tỏi', 'garlic'] },
  { id: 'spicy', label: 'cay/spicy', terms: ['cay', 'spicy', 'kimchi', 'jjamppong', 'ramyun'] },
  { id: 'sweet', label: 'ngọt/sweet', terms: ['ngot', 'ngọt', 'sweet', 'dessert'] },
];

const FOOD_STOP_TERMS = new Set([
  'mon', 'món', 'food', 'item', 'do', 'đồ', 'an', 'ăn', 'uong', 'uống',
  'co', 'có', 'khong', 'không', 'ko', 'k', 'chua', 'chưa', 'gi', 'gì', 'nao', 'nào',
  'hay', 'thuong', 'thường', 'goi', 'gọi', 'order', 'khach', 'khách', 'customer', 'member',

  // Các từ hỏi sở thích, không phải tên món
  'thich', 'thích', 'like', 'favorite', 'yeu', 'yêu', 'ua', 'ưa', 'chuong', 'chuộng',
  'chac', 'chắc', 'chan', 'chắn',
]);

function hasAliasTerm(textNorm, term) {
  const t = norm(term);
  if (!t) return false;
  const padded = ` ${textNorm} `;
  if (t.length <= 2) return padded.includes(` ${t} `);
  return padded.includes(` ${t} `) || textNorm.includes(t);
}

function foodAliasToken(id) {
  return `foodalias${id}`;
}

function addAliasTerms(out, group) {
  // Chỉ thêm token nhóm, không bung tất cả từ trong nhóm ra.
  // Ví dụ hỏi "mì" sẽ thêm foodaliasnoodle, không thêm "egg" từ cụm "egg noodle".
  out.add(foodAliasToken(group.id));
}

function expandQueryTerms(query) {
  const q = norm(query);
  const out = new Set(q.split(' ').filter(Boolean));

  for (const group of FOOD_ALIAS_GROUPS) {
    const hit = group.terms.some((t) => hasAliasTerm(q, t));
    if (!hit) continue;

    // Với nhóm mì: chỉ từ rộng "mì/mi/noodle/noodles" mới match cả nhóm.
    // Còn món cụ thể như phở/soba/udon/chapagetti thì chỉ match đúng tên đó.
    if (group.id === 'noodle') {
      const broadNoodle = ['mi', 'my', 'mì', 'mỳ', 'noodle', 'noodles'].some((t) => hasAliasTerm(q, t));
      if (broadNoodle) addAliasTerms(out, group);
      continue;
    }

    addAliasTerms(out, group);
  }

  if (q.includes('com chien') || q.includes('fried rice')) ['fried', 'rice'].forEach((x) => out.add(x));
  if (q.includes('bo luc lac') || q.includes('luc lac')) ['beef', 'tenderloin', 'sirloin'].forEach((x) => out.add(x));
  if (q.includes('trung chien') || q.includes('fried egg') || q.includes('op la')) ['fried', 'egg'].forEach((x) => out.add(x));
  if (q.includes('trung luoc') || q.includes('boil egg') || q.includes('boiled egg')) ['boil', 'boiled', 'egg'].forEach((x) => out.add(x));
  if (q.includes('sua chua') || q.includes('yogurt')) ['yogurt', 'milk'].forEach((x) => out.add(x));

  return Array.from(out)
    .map((x) => norm(x))
    .filter((x) => x && x.length >= 2 && !FOOD_STOP_TERMS.has(x));
}

function buildItemSearchText(it) {
  const base = norm(`${it.nameNorm} ${it.name} ${it.imageKey} ${it.productCodeNorm} ${it.productCode} ${it.itemGroupNorm} ${it.itemGroup} ${it.menuType}`);
  const out = new Set(base.split(' ').filter(Boolean));
  for (const group of FOOD_ALIAS_GROUPS) {
    const hit = group.terms.some((t) => hasAliasTerm(base, t));
    if (hit) addAliasTerms(out, group);
  }
  return Array.from(out).join(' ');
}

function aliasGroupHit(queryNorm, itemText) {
  return FOOD_ALIAS_GROUPS.some((group) => {
    const token = foodAliasToken(group.id);
    return queryNorm.includes(token) && itemText.includes(token);
  });
}

function scoreItemAgainstQuery(it, query) {
  const q0 = norm(query);
  if (!q0) return 0;

  const hay = buildItemSearchText(it);
  const terms = expandQueryTerms(q0);
  if (!terms.length) return 0;

  if (hasAliasTerm(hay, q0) || hay.includes(q0)) return 100;

  let score = 0;
  let matched = 0;
  const importantTerms = terms.filter((t) => t.length >= 2 && !FOOD_STOP_TERMS.has(t));

  for (const t of importantTerms) {
    if (hasAliasTerm(hay, t) || (t.length >= 4 && hay.includes(t))) {
      matched += 1;
      score += t.length >= 4 ? 4 : 2;
    }
  }

  const queryAliasTokens = FOOD_ALIAS_GROUPS
    .map((group) => foodAliasToken(group.id))
    .filter((token) => q0.includes(token));

  if (queryAliasTokens.length) {
    const allAliasMatched = queryAliasTokens.every((token) => hay.includes(token));
    if (!allAliasMatched) return 0;
    score += queryAliasTokens.length * 12;
  }

  if ((q0.includes('fried') || q0.includes('chien')) && (q0.includes('rice') || q0.includes('com')) && hay.includes('fried') && hay.includes('rice')) score += 10;
  if ((q0.includes('egg') || q0.includes('trung')) && hay.includes('egg')) score += 8;
  if ((q0.includes('garlic') || q0.includes('toi')) && hay.includes('garlic')) score += 8;

  if (score >= 12) return score;

  const needed = importantTerms.length <= 2 ? 1 : Math.ceil(Math.min(importantTerms.length, 5) / 2);
  return matched >= needed ? score : 0;
}

function itemMatchesKeyword(it, query) {
  return scoreItemAgainstQuery(it, query) > 0;
}

function extractWantedItemText(message) {
  const raw = String(message || '').toLowerCase();
  const original = norm(message);
  let tokens = original.split(' ').filter(Boolean);

  // Bỏ mã khách ở đầu câu: "1 ăn mì ko" -> chỉ giữ "mì".
  if (tokens.length >= 2 && compactCode(tokens[0]) && !isCodeStopToken(tokens[0])) {
    tokens = tokens.slice(1);
  }

  const out = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i];
    if (['khach', 'customer', 'member', 'card'].includes(t)) {
      i += 1;
      continue;
    }
if ([
  'goi', 'y', 'suggest', 'recommend', 'cho', 'nay',
  'co', 'khong', 'ko', 'k', 'chua', 'da', 'tung',
  'hay', 'thuong', 'mon', 'food', 'item', 'gi', 'nao',
  'luc', 'may', 'gio', 'an', 'uong', 'order', 'kiem', 'tra', 'xem',

  // Bỏ các từ hỏi sở thích ra khỏi tên món
  'thich', 'like', 'favorite', 'yeu', 'ua', 'chuong',
  'chac', 'chan',
].includes(t)) {
  continue;
}
    out.push(t);
  }

  const m = out.join(' ').trim();
  const expanded = expandQueryTerms(m || original);
  const extras = [];

  // Các từ mất dấu dễ nhầm: bơ/bò, cà/cá. Ưu tiên bắt bằng raw còn dấu.
  if (raw.includes('bơ') || raw.includes('sinh tố bơ') || original.includes('sinh to bo')) extras.push(foodAliasToken('avocado'), 'avocado');
  if (raw.includes('bò') || raw.includes('thịt bò') || original.includes('thit bo') || original.includes('beef')) extras.push(foodAliasToken('beef'), 'beef');
  if (raw.includes('cà phê') || original.includes('ca phe') || original.includes('cafe') || original.includes('coffee')) extras.push(foodAliasToken('coffee'), 'coffee');
  if (raw.includes('cá') || original.includes(' fish ')) extras.push(foodAliasToken('fish'), 'fish');
  if (raw.includes('nước ép') || original.includes('nuoc ep') || original.includes('juice')) extras.push(foodAliasToken('juice'), 'juice');
  if (raw.includes('nước suối') || original.includes('nuoc suoi')) extras.push(foodAliasToken('water'), 'water');
  if (raw.includes('mì') || raw.includes('mỳ') || original.split(' ').includes('mi') || original.split(' ').includes('my')) extras.push(foodAliasToken('noodle'));
// Ưu tiên cụm món cụ thể "cơm chiên/fried rice".
// Nếu không thêm rõ, hệ thống dễ hiểu nhầm thành nhóm rộng "cơm/rice".
if (
  original.includes('com chien') ||
  raw.includes('cơm chiên') ||
  original.includes('fried rice')
) {
  extras.push(foodAliasToken('friedrice'), 'fried rice', 'com chien');
}
  return [m, ...expanded, ...extras].filter(Boolean).join(' ');
}

function buildItemStats(orders, maps, filterFn = null) {
  const stats = new Map();
  for (const o of orders || []) {
    const orderAt = o.createdAt || o.updatedAt || '';
    for (const raw of o.items || []) {
      const it = enrichItem(raw, maps);
      if (filterFn && !filterFn(it, o)) continue;
      const key = it.productCodeNorm || it.nameNorm || it.imageKey;
      if (!key) continue;
      const cur = stats.get(key) || {
        key,
        name: it.name,
        productCode: it.productCode,
        itemGroup: it.itemGroup,
        qty: 0,
        orderCount: 0,
        lastAt: null,
        notes: new Map(),
      };
      cur.qty += it.qty;
      cur.orderCount += 1;
      if (orderAt && (!cur.lastAt || new Date(orderAt) > new Date(cur.lastAt))) cur.lastAt = orderAt;
      if (it.note) cur.notes.set(it.note, (cur.notes.get(it.note) || 0) + 1);
      stats.set(key, cur);
    }
  }
  return Array.from(stats.values()).sort((a, b) => {
    if (b.orderCount !== a.orderCount) return b.orderCount - a.orderCount;
    if (b.qty !== a.qty) return b.qty - a.qty;
    return new Date(b.lastAt || 0) - new Date(a.lastAt || 0);
  });
}

function countNotes(orders, maps) {
  const noteMap = new Map();
  for (const o of orders || []) {
    const push = (note, itemName = '') => {
      const n = String(note || '').trim();
      if (!n) return;
      const cur = noteMap.get(n) || { note: n, count: 0, items: new Map(), lastAt: null };
      cur.count += 1;
      if (itemName) cur.items.set(itemName, (cur.items.get(itemName) || 0) + 1);
      if (o.createdAt && (!cur.lastAt || new Date(o.createdAt) > new Date(cur.lastAt))) cur.lastAt = o.createdAt;
      noteMap.set(n, cur);
    };
    push(o.note, 'Order note');
    for (const raw of o.items || []) {
      const it = enrichItem(raw, maps);
      push(it.note, it.name);
    }
  }
  return Array.from(noteMap.values()).sort((a, b) => b.count - a.count || new Date(b.lastAt || 0) - new Date(a.lastAt || 0));
}

function timeBucket(dateValue) {
  const d = new Date(dateValue);
  if (Number.isNaN(d.getTime())) return 'Không rõ';
  const h = d.getHours();
  if (h >= 6 && h <= 10) return 'Sáng 06:00-10:59';
  if (h >= 11 && h <= 13) return 'Trưa 11:00-13:59';
  if (h >= 14 && h <= 17) return 'Chiều 14:00-17:59';
  if (h >= 18 && h <= 23) return 'Tối 18:00-23:59';
  return 'Khuya 00:00-05:59';
}

function buildTimePattern(orders, maps) {
  const buckets = new Map();
  for (const o of orders || []) {
    const bucket = timeBucket(o.createdAt || o.updatedAt);
    const cur = buckets.get(bucket) || { bucket, count: 0, items: new Map() };
    cur.count += 1;
    for (const raw of o.items || []) {
      const it = enrichItem(raw, maps);
      const row = cur.items.get(it.name) || { name: it.name, productCode: it.productCode, qty: 0 };
      row.qty += it.qty;
      cur.items.set(it.name, row);
    }
    buckets.set(bucket, cur);
  }
  return Array.from(buckets.values()).sort((a, b) => b.count - a.count);
}

function formatTopItems(items, limit = 8) {
  if (!items.length) return 'Chưa thấy dữ liệu món phù hợp.';
  return items.slice(0, limit).map((it, idx) => {
    const code = it.productCode ? ` [${it.productCode}]` : '';
    const last = it.lastAt ? `, lần gần nhất ${fmtDateTime(it.lastAt)}` : '';
    return `${idx + 1}. ${it.name}${code} — ${it.orderCount} lần, tổng ${it.qty} phần${last}`;
  }).join('\n');
}

function getRelevantTraining(training, message, limit = 3) {
  const qTokens = new Set(norm(message).split(/\s+/).filter((x) => x.length >= 3));
  if (!qTokens.size) return [];
  return (training || [])
    .map((t) => {
      const content = String(t.content || '');
      const tokens = norm(content).split(/\s+/).filter((x) => x.length >= 3);
      let score = 0;
      tokens.forEach((x) => { if (qTokens.has(x)) score += 1; });
      return { ...t, score };
    })
    .filter((t) => t.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function isBlockedForUser(message) {
  const m = norm(message);
  return /\b(gia|price|doanh thu|bao cao|report|revenue|profit|loi nhuan|tong tien|usd|vnd|tien)\b/.test(m);
}

function displayWantedText(wanted) {
  const w = norm(wanted);

  if (w.includes('pho') || w.includes('phở')) return 'phở/PHO';

  // Ưu tiên cụm cụ thể trước cụm rộng.
  // Nếu hỏi "cơm chiên" thì không được hiển thị thành "cơm/rice".
  if (
    w.includes('foodaliasfriedrice') ||
    w.includes('com chien') ||
    w.includes('fried rice')
  ) {
    return 'cơm chiên/fried rice';
  }

  if (w.includes('foodaliasavocado') && w.includes('foodaliassmoothie')) {
    return 'sinh tố bơ/avocado smoothie';
  }

  for (const group of FOOD_ALIAS_GROUPS) {
    const token = foodAliasToken(group.id);
    if (w.includes(token) || group.terms.some((t) => hasAliasTerm(w, t))) {
      return group.label;
    }
  }

  return wanted || 'món này';
}

function hasNegativeNoteForWanted(notes, wanted) {
  const w = norm(wanted);
  return Array.from(notes.keys ? notes.keys() : []).some((note) => {
    const n = norm(note);
    if (/(trung|egg)/.test(w)) {
      return /(khong trung|no egg|without egg|remove egg|bo trung|khong egg)/.test(n);
    }
    if (/(cay|spicy)/.test(w)) {
      return /(khong cay|it cay|no spicy|not spicy|less spicy)/.test(n);
    }
    if (/(duong|sugar)/.test(w)) {
      return /(khong duong|it duong|no sugar|less sugar)/.test(n);
    }
    return false;
  });
}

function answerHasCustomerOrderedItem({ code, customerOrders, maps, members, message }) {
  const wanted = extractWantedItemText(message);
  const matches = [];
  for (const o of customerOrders) {
    for (const raw of o.items || []) {
      const it = enrichItem(raw, maps);
      if (itemMatchesKeyword(it, wanted)) {
        matches.push({ order: o, item: it });
      }
    }
  }
  const name = customerOrders[0] ? customerNameFromOrder(customerOrders[0], members) : (members[code]?.name || members[code]?.customerName || '');
  const title = name ? `${name} (${code})` : `khách ${code} (chưa có tên khách trong dữ liệu)`;

  if (!matches.length) {
    const top = buildItemStats(customerOrders, maps).slice(0, 5);
    return [
      `Chưa thấy ${title} từng order món liên quan "${displayWantedText(wanted)}" trong dữ liệu hiện có.`,
      top.length ? `\nCác món khách này thường gọi:\n${formatTopItems(top, 5)}` : '',
    ].filter(Boolean).join('\n');
  }

  const grouped = new Map();
  let totalQty = 0;
  let last = null;
  const notes = new Map();
  for (const row of matches) {
    const k = row.item.productCodeNorm || row.item.nameNorm;
    const cur = grouped.get(k) || { name: row.item.name, productCode: row.item.productCode, count: 0, qty: 0 };
    cur.count += 1;
    cur.qty += row.item.qty;
    grouped.set(k, cur);
    totalQty += row.item.qty;
    if (!last || new Date(row.order.createdAt) > new Date(last.order.createdAt)) last = row;
    if (row.item.note) notes.set(row.item.note, (notes.get(row.item.note) || 0) + 1);
  }
  const rows = Array.from(grouped.values()).sort((a, b) => b.count - a.count || b.qty - a.qty);
  const noteRows = Array.from(notes.entries()).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const hasNegativeNote = hasNegativeNoteForWanted(notes, wanted);
  return [
    `${title} đã từng order món liên quan "${displayWantedText(wanted)}".`,
    `Tổng cộng: ${matches.length} lần, ${totalQty} phần.`,
    rows.map((r, idx) => `${idx + 1}. ${r.name}${r.productCode ? ` [${r.productCode}]` : ''} — ${r.count} lần, ${r.qty} phần`).join('\n'),
    last ? `Lần gần nhất: ${fmtDateTime(last.order.createdAt)} — ${last.item.name}${last.item.productCode ? ` [${last.item.productCode}]` : ''}.` : '',
    noteRows.length ? `Ghi chú từng gặp: ${noteRows.map(([n, c]) => `${n} (${c} lần)`).join(', ')}.` : '',

  ].filter(Boolean).join('\n');
}

function answerCustomerTop({ code, customerOrders, maps, members, type }) {
  const name = customerOrders[0] ? customerNameFromOrder(customerOrders[0], members) : (members[code]?.name || members[code]?.customerName || '');
  const level = customerOrders[0] ? customerLevelFromOrder(customerOrders[0], members) : (members[code]?.level || members[code]?.memberLevel || '');
  const title = name ? `${name}${level ? ` - level ${level}` : ''} (${code})` : `khách ${code} (chưa có tên khách trong dữ liệu)`;

  let filterFn = null;
  let heading = `Món ${title} hay order`;
  if (type === 'drinks') {
    filterFn = (it) => isBeverageItem(it);
    heading = `${title} hay uống`;
  } else if (type === 'foods') {
    filterFn = (it) => !isBeverageItem(it);
    heading = `${title} hay ăn`;
  }

  const top = buildItemStats(customerOrders, maps, filterFn);
  if (!customerOrders.length) return `Chưa thấy lịch sử order của khách ${code}.`;
  if (!top.length) return `Có ${customerOrders.length} order của ${title}, nhưng chưa thấy dữ liệu phù hợp để trả lời nhóm này.`;

  return [
    `${heading}:`,
    `- Tổng lịch sử: ${customerOrders.length} order`,
    formatTopItems(top, 8),

  ].join('\n');
}

function answerCustomerTime({ code, customerOrders, maps, members }) {
  if (!customerOrders.length) return `Chưa thấy lịch sử order của khách ${code}.`;
  const name = customerNameFromOrder(customerOrders[0], members);
  const title = name ? `${name} (${code})` : `khách ${code} (chưa có tên khách trong dữ liệu)`;
  const buckets = buildTimePattern(customerOrders, maps);
  const topBucket = buckets[0];
  const lines = buckets.map((b) => `- ${b.bucket}: ${b.count} lần`).join('\n');
  const topItems = topBucket
    ? Array.from(topBucket.items.values()).sort((a, b) => b.qty - a.qty).slice(0, 5)
    : [];
  return [
    `${title} thường order nhiều nhất vào khung giờ ${topBucket?.bucket || 'chưa rõ'}.`,
    'Thống kê theo khung giờ:',
    lines,
    topItems.length ? `Món hay gọi trong khung giờ này: ${topItems.map((x) => `${x.name}${x.productCode ? ` [${x.productCode}]` : ''}`).join(', ')}.` : '',
  ].filter(Boolean).join('\n');
}

function answerCustomerNotes({ code, customerOrders, maps, members }) {
  if (!customerOrders.length) return `Chưa thấy lịch sử order của khách ${code}.`;
  const name = customerNameFromOrder(customerOrders[0], members);
  const title = name ? `${name} (${code})` : `khách ${code} (chưa có tên khách trong dữ liệu)`;
  const notes = countNotes(customerOrders, maps);
  if (!notes.length) return `Chưa thấy ghi chú nào trong lịch sử order của ${title}.`;
  const lines = notes.slice(0, 10).map((n, idx) => {
    const item = Array.from(n.items.entries()).sort((a, b) => b[1] - a[1])[0]?.[0];
    return `${idx + 1}. ${n.note} — ${n.count} lần${item ? `, thường gặp với: ${item}` : ''}`;
  }).join('\n');
  return [`Ghi chú hay gặp của ${title}:`, lines].join('\n');
}

function formatOrderItems(order, maps, filterFn = null) {
  const items = (order.items || [])
    .map((raw) => enrichItem(raw, maps))
    .filter((it) => !filterFn || filterFn(it));

  if (!items.length) return '';
  return items.map((it) => {
    const code = it.productCode ? ` [${it.productCode}]` : '';
    const note = it.note ? `, note: ${it.note}` : '';
    return `${it.name}${code} x${it.qty}${note}`;
  }).join('; ');
}

function answerCustomerOrdersInRange({ code, customerOrders, maps, members, range, message }) {
  const m = norm(message);
  const label = range?.label || 'toàn bộ lịch sử';

  const firstOrder = customerOrders[0];
  const name = firstOrder ? customerNameFromOrder(firstOrder, members) : (members[code]?.name || members[code]?.customerName || '');
  const title = name ? `${name} (${code})` : `khách ${code} (chưa có tên khách trong dữ liệu)`;

  if (!customerOrders.length) {
    return `Chưa thấy ${title} có order trong ${label}.`;
  }

  let filterFn = null;
  let scopeText = 'món đã order';
  if (/\b(uong|drink|beverage|nuoc|thuc uong|do uong)\b/.test(m)) {
    filterFn = (it) => isBeverageItem(it);
    scopeText = 'đồ uống đã order';
  } else if (/\b(an|food|mon an)\b/.test(m)) {
    filterFn = (it) => !isBeverageItem(it);
    scopeText = 'món ăn đã order';
  }

  const topItems = buildItemStats(customerOrders, maps, filterFn).slice(0, 8);
  const latest = customerOrders[0];
  const latestItems = formatOrderItems(latest, maps, filterFn);
  const totalQty = topItems.reduce((sum, it) => sum + it.qty, 0);

  if (filterFn && !topItems.length) {
    return `Có ${customerOrders.length} order của ${title} trong ${label}, nhưng chưa thấy ${scopeText} phù hợp trong các order đó.`;
  }

  const latestPlace = [latest?.area, latest?.tableNo ? `bàn ${latest.tableNo}` : ''].filter(Boolean).join(' - ');
  const latestLine = latest
    ? `Lần gần nhất: ${fmtDateTime(latest.createdAt || latest.updatedAt)}${latestPlace ? ` tại ${latestPlace}` : ''}${latestItems ? ` — ${latestItems}` : ''}.`
    : '';

  return [
    `Có, ${title} có ${customerOrders.length} order trong ${label}.`,
    topItems.length ? `Tổng ${scopeText}: ${totalQty} phần.` : '',
    topItems.length ? formatTopItems(topItems, 8) : '',
    latestLine,
  ].filter(Boolean).join('\n');
}

function isCustomerOrderSummaryIntent(message) {
  const m = norm(message);
  const hasOrderWord = /\b(order|goi|goi mon|dat mon)\b/.test(m);
  const hasDateWord = /\b(hom nay|hom qua|7 ngay|30 ngay|tuan nay|thang nay|gan day|today|yesterday)\b/.test(m);
  const askExist = /\b(co|da|chua|ko|khong|k)\b/.test(m) && hasOrderWord;
  const askWhat = /\b(order gi|goi gi|goi mon gi|an gi|uong gi|mon gi)\b/.test(m);
  const askLatest = /\b(lan gan nhat|gan nhat|moi nhat|last order|latest order)\b/.test(m);
  return (hasOrderWord && (hasDateWord || askExist || askWhat || askLatest)) || (hasDateWord && /\b(an|uong)\b/.test(m));
}
function isOpenEndedLikeQuestion(message) {
  const m = norm(message);
  const padded = ` ${m} `;

  const hasLikeWord = [
    ' thich ',
    ' like ',
    ' favorite ',
    ' yeu thich ',
    ' ua thich ',
    ' mon yeu thich ',
  ].some((x) => padded.includes(x));

  if (!hasLikeWord) return false;

  // Câu mở: thích ăn gì / thích uống gì / thích gì
  return (
    padded.includes(' an gi ') ||
    padded.includes(' uong gi ') ||
    padded.includes(' mon gi ') ||
    padded.includes(' thich gi ') ||
    padded.trim().endsWith('thich an gi') ||
    padded.trim().endsWith('thich uong gi') ||
    padded.trim().endsWith('thich gi')
  );
}

function getOpenEndedLikeType(message) {
  const m = norm(message);
  const padded = ` ${m} `;

  if (padded.includes(' uong ') || padded.includes(' nuoc ') || padded.includes(' drink ')) {
    return 'drinks';
  }

  if (padded.includes(' an ') || padded.includes(' food ') || padded.includes(' mon an ')) {
    return 'foods';
  }

  return 'all';
}
function isCustomerDislikeIntent(message) {
  const m = norm(message);
  const padded = ` ${m} `;

  return [
    ' khong thich ',
    ' khong an ',
    ' khong uong ',
    ' ghet ',
    ' tranh ',
    ' can tranh ',
    ' di ung ',
    ' khong hop ',
    ' khong an duoc ',
    ' khong uong duoc ',
  ].some((x) => padded.includes(x));
}

function extractNegativePreferenceFromNote(note) {
  const n = norm(note);
  const out = [];

  const rules = [
    {
      label: 'không cay / ít cay',
      patterns: ['khong cay', 'it cay', 'no spicy', 'not spicy', 'less spicy'],
    },
    {
      label: 'không hành',
      patterns: ['khong hanh', 'no onion', 'without onion'],
    },
    {
      label: 'không tỏi',
      patterns: ['khong toi', 'no garlic', 'without garlic'],
    },
    {
      label: 'không đường / ít đường',
      patterns: ['khong duong', 'it duong', 'no sugar', 'less sugar'],
    },
    {
      label: 'không đá / ít đá',
      patterns: ['khong da', 'it da', 'no ice', 'less ice'],
    },
    {
      label: 'không trứng',
      patterns: ['khong trung', 'no egg', 'without egg', 'remove egg'],
    },
    {
      label: 'không mì / tránh noodles',
      patterns: ['khong mi', 'khong my', 'no noodle', 'no noodles'],
    },
    {
      label: 'không bò',
      patterns: ['khong bo', 'no beef', 'without beef'],
    },
    {
      label: 'không gà',
      patterns: ['khong ga', 'no chicken', 'without chicken'],
    },
    {
      label: 'không hải sản',
      patterns: ['khong hai san', 'no seafood', 'without seafood'],
    },
  ];

  for (const rule of rules) {
    if (rule.patterns.some((p) => n.includes(norm(p)))) {
      out.push(rule.label);
    }
  }

  return out;
}

function answerCustomerDislikes({ code, customerOrders, maps, members }) {
  const firstOrder = customerOrders[0];
  const name = firstOrder
    ? customerNameFromOrder(firstOrder, members)
    : (members[code]?.name || members[code]?.customerName || '');

  const title = name
    ? `${name} (${code})`
    : `khách ${code} (chưa có tên khách trong dữ liệu)`;

  if (!customerOrders.length) {
    return `Chưa thấy lịch sử order của ${title}, nên chưa có dữ liệu để biết khách không thích hoặc cần tránh món gì.`;
  }

  const prefMap = new Map();
  const rawNotes = [];

  const addPref = (label, note, itemName, orderAt) => {
    const cur = prefMap.get(label) || {
      label,
      count: 0,
      notes: new Map(),
      items: new Map(),
      lastAt: null,
    };

    cur.count += 1;

    if (note) {
  const noteKey = norm(note);
  const existed = Array.from(cur.notes.keys()).find((k) => norm(k) === noteKey);
  const finalKey = existed || note;
  cur.notes.set(finalKey, (cur.notes.get(finalKey) || 0) + 1);
}
    if (itemName) cur.items.set(itemName, (cur.items.get(itemName) || 0) + 1);

    if (orderAt && (!cur.lastAt || new Date(orderAt) > new Date(cur.lastAt))) {
      cur.lastAt = orderAt;
    }

    prefMap.set(label, cur);
  };

  for (const o of customerOrders) {
    const orderAt = o.createdAt || o.updatedAt || '';

    const orderNote = String(o.note || '').trim();
    if (orderNote) {
      const labels = extractNegativePreferenceFromNote(orderNote);
      if (labels.length) rawNotes.push(orderNote);
      labels.forEach((label) => addPref(label, orderNote, 'Order note', orderAt));
    }

    for (const raw of o.items || []) {
      const it = enrichItem(raw, maps);
      const itemNote = String(it.note || '').trim();

      if (!itemNote) continue;

      const labels = extractNegativePreferenceFromNote(itemNote);
      if (labels.length) rawNotes.push(itemNote);

      labels.forEach((label) => addPref(label, itemNote, it.name, orderAt));
    }
  }

  const prefs = Array.from(prefMap.values())
    .sort((a, b) => b.count - a.count || new Date(b.lastAt || 0) - new Date(a.lastAt || 0));

  if (!prefs.length) {
    const top = buildItemStats(customerOrders, maps).slice(0, 5);

    return [
      `Chưa thấy ghi chú rõ ràng cho biết ${title} cần tránh món hoặc thành phần nào.`,
      top.length ? `\nCác món khách này thường gọi:\n${formatTopItems(top, 5)}` : '',
    ].filter(Boolean).join('\n');
  }

  const lines = prefs.slice(0, 10).map((p, idx) => {
    const noteText = Array.from(p.notes.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([note, count]) => `${note} (${count} lần)`)
      .join(', ');

    const itemText = Array.from(p.items.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([item]) => item)
      .join(', ');

    return [
      `${idx + 1}. ${p.label} — ${p.count} lần`,
      itemText ? `, thường gặp với: ${itemText}` : '',
      p.lastAt ? `, gần nhất ${fmtDateTime(p.lastAt)}` : '',
      noteText ? `\n   Ghi chú: ${noteText}` : '',
    ].join('');
  }).join('\n');

  return [
    `Theo ghi chú trong lịch sử order, ${title} nên tránh:`,
    lines,
  ].join('\n');
}
function isCustomerPreferenceIntent(message) {
  const m = norm(message);
  const padded = ` ${m} `;

  return [
    ' thich ',
    ' like ',
    ' favorite ',
    ' yeu thich ',
    ' ua thich ',
    ' mon yeu thich ',
    ' so thich ',
  ].some((x) => padded.includes(x));
}

function answerCustomerPreferenceFromOrders({ code, customerOrders, maps, members, message }) {
  const wanted = extractWantedItemText(message);
  const matches = [];

  for (const o of customerOrders) {
    for (const raw of o.items || []) {
      const it = enrichItem(raw, maps);
      if (itemMatchesKeyword(it, wanted)) {
        matches.push({ order: o, item: it });
      }
    }
  }

  const name = customerOrders[0]
    ? customerNameFromOrder(customerOrders[0], members)
    : (members[code]?.name || members[code]?.customerName || '');

  const title = name
    ? `${name} (${code})`
    : `khách ${code} (chưa có tên khách trong dữ liệu)`;

  if (!customerOrders.length) {
    return `Chưa thấy lịch sử order của ${title}, nên chưa đủ dữ liệu để đánh giá khách có thích món "${displayWantedText(wanted)}" hay không.`;
  }

  if (!matches.length) {
    const top = buildItemStats(customerOrders, maps).slice(0, 5);

    return [
      `Chưa thấy ${title} từng order món "${displayWantedText(wanted)}", nên chưa đủ dữ liệu để nói khách thích món này.`,
      top.length ? `\nCác món khách này thường gọi hơn:\n${formatTopItems(top, 5)}` : '',
 
    ].filter(Boolean).join('\n');
  }

  const grouped = new Map();
  let totalQty = 0;
  let last = null;

  for (const row of matches) {
    const key = row.item.productCodeNorm || row.item.nameNorm || row.item.imageKey;
    const cur = grouped.get(key) || {
      name: row.item.name,
      productCode: row.item.productCode,
      count: 0,
      qty: 0,
    };

    cur.count += 1;
    cur.qty += row.item.qty;
    grouped.set(key, cur);

    totalQty += row.item.qty;

    if (!last || new Date(row.order.createdAt) > new Date(last.order.createdAt)) {
      last = row;
    }
  }

  const rows = Array.from(grouped.values())
    .sort((a, b) => b.count - a.count || b.qty - a.qty);

  return [
    `Dựa trên lịch sử order, ${title} đã từng gọi món liên quan "${displayWantedText(wanted)}".`,
    `Tổng cộng: ${matches.length} lần, ${totalQty} phần.`,
    rows.map((r, idx) =>
      `${idx + 1}. ${r.name}${r.productCode ? ` [${r.productCode}]` : ''} — ${r.count} lần, ${r.qty} phần`
    ).join('\n'),
    last ? `Lần gần nhất: ${fmtDateTime(last.order.createdAt)} — ${last.item.name}${last.item.productCode ? ` [${last.item.productCode}]` : ''}.` : '',

  ].filter(Boolean).join('\n');
}
function answerRecommendation({ code, customerOrders, maps, members, orders }) {
  if (!customerOrders.length) {
    const today = getBusinessRangeToday();
    const topToday = buildItemStats((orders || []).filter((o) => o.status !== 'CANCELLED' && inRange(o, today)), maps).slice(0, 6);
    return [
      `Chưa thấy lịch sử order của khách ${code}.`,
      topToday.length ? `Có thể gợi ý món đang bán chạy ${today.label}:\n${formatTopItems(topToday, 6)}` : 'Chưa có dữ liệu món bán chạy để gợi ý.',
    ].join('\n');
  }
  const name = customerNameFromOrder(customerOrders[0], members);
  const title = name ? `${name} (${code})` : `khách ${code} (chưa có tên khách trong dữ liệu)`;
  const favoriteFoods = buildItemStats(customerOrders, maps, (it) => !isBeverageItem(it)).slice(0, 4);
  const favoriteDrinks = buildItemStats(customerOrders, maps, (it) => isBeverageItem(it)).slice(0, 4);
  const notes = countNotes(customerOrders, maps).slice(0, 3);
  return [
    `Gợi ý món cho ${title}:`,
    favoriteFoods.length ? `\nMón nên gợi ý lại:\n${formatTopItems(favoriteFoods, 4)}` : '',
    favoriteDrinks.length ? `\nĐồ uống phù hợp:\n${formatTopItems(favoriteDrinks, 4)}` : '',
    notes.length ? `\nLưu ý ghi chú: ${notes.map((n) => `${n.note} (${n.count} lần)`).join(', ')}.` : '',

  ].filter(Boolean).join('\n');
}
function validOrdersInRange(orders, range = null) {
  return (orders || [])
    .filter((o) => o && o.status !== 'CANCELLED')
    .filter((o) => inRange(o, range));
}

function getOrderCustomerCode(order) {
  return String(order?.memberCard || order?.customer?.code || '').trim();
}

function getOrderCustomerName(order, members) {
  const code = getOrderCustomerCode(order);
  const m = code ? (members[code] || {}) : {};
  return String(
    order?.customer?.name ||
    order?.customerName ||
    m.name ||
    m.customerName ||
    ''
  ).trim();
}

function getOrderCustomerLevel(order, members) {
  const code = getOrderCustomerCode(order);
  const m = code ? (members[code] || {}) : {};
  return String(
    order?.customer?.level ||
    m.level ||
    m.memberLevel ||
    ''
  ).trim();
}

function getOrderTotalQty(order) {
  return (order.items || []).reduce((sum, it) => {
    return sum + Math.max(1, Number(it.qty || it.quantity || 1));
  }, 0);
}

function buildCustomerOrderStats(orders, members, range = null) {
  const rows = validOrdersInRange(orders, range);
  const stats = new Map();

  for (const o of rows) {
    const code = getOrderCustomerCode(o);
    if (!code) continue;

    const cur = stats.get(code) || {
      code,
      name: getOrderCustomerName(o, members),
      level: getOrderCustomerLevel(o, members),
      orderCount: 0,
      totalQty: 0,
      lastAt: null,
      tables: new Map(),
      areas: new Map(),
    };

    cur.orderCount += 1;
    cur.totalQty += getOrderTotalQty(o);

    const t = o.createdAt || o.updatedAt || '';
    if (t && (!cur.lastAt || new Date(t) > new Date(cur.lastAt))) {
      cur.lastAt = t;
    }

    if (!cur.name) cur.name = getOrderCustomerName(o, members);
    if (!cur.level) cur.level = getOrderCustomerLevel(o, members);

    const tableKey = [o.area || '', o.tableNo || ''].filter(Boolean).join(' - ');
    if (tableKey) cur.tables.set(tableKey, (cur.tables.get(tableKey) || 0) + 1);
    if (o.area) cur.areas.set(o.area, (cur.areas.get(o.area) || 0) + 1);

    stats.set(code, cur);
  }

  return Array.from(stats.values());
}

function formatCustomerStatLine(row, idx) {
  const name = row.name || 'chưa có tên khách trong dữ liệu';
  const level = row.level ? ` - level ${row.level}` : '';
  const last = row.lastAt ? `, gần nhất ${fmtDateTime(row.lastAt)}` : '';
  const topTable = Array.from(row.tables.entries()).sort((a, b) => b[1] - a[1])[0]?.[0];

  return `${idx + 1}. ${name} (${row.code})${level} — ${row.orderCount} order, ${row.totalQty} phần${topTable ? `, hay ở ${topTable}` : ''}${last}`;
}

function getAllKnownCustomerCodes(members, orders) {
  const set = new Set();

  Object.keys(members || {}).forEach((code) => {
    const c = String(code || '').trim();
    if (c) set.add(c);
  });

  for (const o of orders || []) {
    const c = getOrderCustomerCode(o);
    if (c) set.add(c);
  }

  return set;
}
function buildDefinedTableKeys() {
  const keys = [];

  for (const area of AREA_DEFS) {
    for (const [from, to] of area.ranges || []) {
      for (let n = Number(from); n <= Number(to); n += 1) {
        keys.push(`${area.name}|${n}`);
      }
    }
  }

  return keys;
}
function buildTableOrderStats(orderRows) {
  const allTables = new Set(buildDefinedTableKeys());
  const map = new Map();

  for (const o of orderRows || []) {
    const key = getTableKey(o);
    if (!key || !allTables.has(key)) continue;

    const cur = map.get(key) || {
      key,
      area: String(o.area || ''),
      tableNo: String(o.tableNo || ''),
      orderCount: 0,
      customerCodes: new Set(),
      totalQty: 0,
      lastAt: null,
    };

    cur.orderCount += 1;

    const code = getOrderCustomerCode(o);
    if (code) cur.customerCodes.add(code);

    cur.totalQty += getOrderTotalQty(o);

    const t = o.createdAt || o.updatedAt || '';
    if (t && (!cur.lastAt || new Date(t) > new Date(cur.lastAt))) {
      cur.lastAt = t;
    }

    map.set(key, cur);
  }

  return Array.from(map.values()).sort((a, b) => {
    if (b.orderCount !== a.orderCount) return b.orderCount - a.orderCount;
    if (b.totalQty !== a.totalQty) return b.totalQty - a.totalQty;
    return new Date(b.lastAt || 0) - new Date(a.lastAt || 0);
  });
}

function formatTableStatLine(row, idx) {
  const last = row.lastAt ? `, gần nhất ${fmtDateTime(row.lastAt)}` : '';
  return `${idx + 1}. ${row.area} - bàn ${row.tableNo} — ${row.orderCount} order, ${row.customerCodes.size} khách, ${row.totalQty} phần${last}`;
}

function customerDisplayByCode(code, members = {}) {
  const m = members[code] || {};
  const name = m.name || m.customerName || 'chưa có tên khách trong dữ liệu';
  const level = m.level || m.memberLevel || '';
  return `${name} (${code})${level ? ` - level ${level}` : ''}`;
}
function countDefinedTables() {
  return buildDefinedTableKeys().length;
}
function getTableKey(order) {
  const area = String(order?.area || '').trim();
  const tableNo = String(order?.tableNo || '').trim();
  if (!area && !tableNo) return '';
  return `${area || 'Không rõ khu'}|${tableNo || 'Không rõ bàn'}`;
}

function formatTableKey(key) {
  const [area, tableNo] = String(key || '').split('|');
  return [area, tableNo ? `bàn ${tableNo}` : ''].filter(Boolean).join(' - ');
}

function extractTableNoFromMessage(message) {
  const m = norm(message);
  const raw = String(message || '');

  const badTableWords = new Set([
    'ch', 'chua', 'chưa',
    'da', 'đã',
    'co', 'có',
    'bao', 'nhieu', 'nhiêu',
    'order', 'goi', 'gọi',
    'khach', 'khách',
    'nao', 'nào',
  ]);

  const cleanHit = (v) => {
    const s = String(v || '').trim();
    const sn = norm(s);
    if (!s || badTableWords.has(sn)) return '';
    // Số bàn thật nên có ít nhất 1 chữ số, ví dụ 1001, A12, VIP1.
    if (!/\d/.test(s)) return '';
    return s;
  };

  const patterns = [
    /(?:ban|bàn|table)\s*[:#-]?\s*([A-Za-z0-9]+)/i,
    /(?:o|ở)\s*(?:ban|bàn|table)\s*[:#-]?\s*([A-Za-z0-9]+)/i,
  ];

  for (const re of patterns) {
    const hit = raw.match(re);
    const tableNo = cleanHit(hit?.[1]);
    if (tableNo) return tableNo;
  }

  const hitNorm = m.match(/(?:ban|table)\s+([a-z0-9]+)/i);
  const tableNo = cleanHit(hitNorm?.[1]);
  if (tableNo) return tableNo;

  return '';
}

function isAppAnalyticsIntent(message) {
  const m = norm(message);
  const padded = ` ${m} `;

  // Các câu tổng quan về khách/order/bàn, không phải mã khách cụ thể.
  const hasGlobalCustomer =
    padded.includes(' khach co order ') ||
    padded.includes(' khach order ') ||
    padded.includes(' top khach ') ||
    padded.includes(' khach nao ') ||
    padded.includes(' tong so cac khach ') ||
    padded.includes(' tong so khach ') ||
    padded.includes(' bao nhieu khach ') ||
    padded.includes(' khach da order ') ||
    padded.includes(' khach chua order ');

  const hasTable =
    padded.includes(' ban ') ||
    padded.includes(' table ') ||
    padded.includes(' o ban ') ||
    padded.includes(' ở bàn ');

  const hasCount =
    padded.includes(' bao nhieu ') ||
    padded.includes(' tong so ') ||
    padded.includes(' so luong ') ||
    padded.includes(' dem ');

  const hasMostLeast =
    padded.includes(' nhieu nhat ') ||
    padded.includes(' it nhat ') ||
    padded.includes(' top ') ||
    padded.includes(' order nhieu ') ||
    padded.includes(' order it ');

  const hasOrder = padded.includes(' order ') || padded.includes(' goi ');

  return Boolean(
    hasGlobalCustomer ||
    (hasTable && (hasOrder || hasCount)) ||
    (hasCount && padded.includes(' khach ')) ||
    (hasCount && padded.includes(' ban ')) ||
    (hasMostLeast && padded.includes(' khach '))
  );
}

function answerAppAnalytics({ orders, members, message, range, maps }) {
  const m = norm(message);
  const padded = ` ${m} `;
  const label = range?.label || 'toàn bộ lịch sử';
  const rows = validOrdersInRange(orders, range);
  const wantsList =
  padded.includes(' danh sach ') ||
  padded.includes(' liet ke ') ||
  padded.includes(' xem cac ') ||
  padded.includes(' cac ban ') ||
  padded.includes(' cac khach ');

// Bàn chưa order — phải xử lý trước bàn cụ thể để tránh "bàn chưa" bị hiểu thành bàn "ch".
if (
  padded.includes(' ban chua order ') ||
  padded.includes(' ban chua goi ') ||
  padded.includes(' ban chua co order ') ||
  padded.includes(' ban nao chua order ') ||
  padded.includes(' ban nao chua goi ') ||
  padded.includes(' ban nao chua goi mon ') ||
  padded.includes(' ban nao chua dat mon ') ||
  (padded.includes(' bao nhieu ban ') && padded.includes(' chua '))
) {
  const allTables = new Set(buildDefinedTableKeys());

  const orderedTables = new Set(
    rows
      .map(getTableKey)
      .filter(Boolean)
      .filter((key) => allTables.has(key))
  );

  const notOrdered = Array.from(allTables).filter((x) => !orderedTables.has(x));
const askWhich =
  padded.includes(' ban nao ') ||
  padded.includes(' danh sach ') ||
  padded.includes(' liet ke ') ||
  padded.includes(' cac ban ');

return [
  `${label} có ${notOrdered.length}/${allTables.size} bàn chưa thấy order.`,
  `Bàn đã order: ${orderedTables.size}/${allTables.size}.`,
  notOrdered.length
    ? `${askWhich ? 'Danh sách bàn chưa order' : 'Một số bàn chưa order'}: ${notOrdered.slice(0, askWhich ? 80 : 30).map(formatTableKey).join(', ')}`
    : '',
  askWhich && notOrdered.length > 80 ? `Đang hiển thị 80/${notOrdered.length} bàn.` : '',
].filter(Boolean).join('\n');
}

// Bàn cụ thể: "bàn 1001 đã có bao nhiêu order", "hôm nay có ai order bàn đó chưa"
const tableNo = extractTableNoFromMessage(message);
if (tableNo) {
  const tableOrders = rows.filter((o) => String(o.tableNo || '').trim() === String(tableNo).trim());
  const customerSet = new Set(tableOrders.map(getOrderCustomerCode).filter(Boolean));
  const qty = tableOrders.reduce((sum, o) => sum + getOrderTotalQty(o), 0);
const askItems =
  padded.includes(' goi mon gi ') ||
  padded.includes(' goi gi ') ||
  padded.includes(' order gi ') ||
  padded.includes(' order mon gi ') ||
  padded.includes(' an gi ') ||
  padded.includes(' uong gi ') ||
  padded.includes(' mon gi ') ||
  padded.includes(' danh sach mon ') ||
  padded.includes(' liet ke mon ');

const itemRows = askItems && maps
  ? buildItemStats(tableOrders, maps).slice(0, 12)
  : [];
  const customerRows = buildCustomerOrderStats(tableOrders, members, null)
    .sort((a, b) => new Date(b.lastAt || 0) - new Date(a.lastAt || 0))
    .slice(0, 20);

  const last = tableOrders
    .slice()
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))[0];

  if (!tableOrders.length) {
    return `Chưa thấy bàn ${tableNo} có order trong ${label}.`;
  }

  const askWho =
    padded.includes(' ai ') ||
    padded.includes(' khach nao ') ||
    padded.includes(' danh sach khach ') ||
    padded.includes(' co ai ');

return [
  `Bàn ${tableNo} có ${tableOrders.length} order trong ${label}.`,
  `Số khách: ${customerSet.size}`,
  `Tổng số phần: ${qty}`,
  askItems && itemRows.length
    ? `Món đã gọi:\n${formatTopItems(itemRows, 12)}`
    : '',
  askWho && customerRows.length
    ? `Khách đã order:\n${customerRows.map(formatCustomerStatLine).join('\n')}`
    : '',
  last ? `Lần gần nhất: ${fmtDateTime(last.createdAt || last.updatedAt)}${last.area ? ` tại ${last.area}` : ''}.` : '',
].filter(Boolean).join('\n');
}

// Danh sách bàn đã order
if (
  wantsList &&
  padded.includes(' ban ') &&
  (padded.includes(' da order ') || padded.includes(' order ') || padded.includes(' da goi ') || padded.includes(' goi '))
) {
  const stats = buildTableOrderStats(rows);

  if (!stats.length) return `Chưa thấy bàn nào có order trong ${label}.`;

  return [
    `Danh sách bàn đã order trong ${label}:`,
    stats.slice(0, 50).map(formatTableStatLine).join('\n'),
    stats.length > 50 ? `Đang hiển thị 50/${stats.length} bàn.` : '',
  ].filter(Boolean).join('\n');
}

// Danh sách khách chưa order
if (
  wantsList &&
  padded.includes(' khach ') &&
  padded.includes(' chua ') &&
  (padded.includes(' order ') || padded.includes(' goi '))
) {
  const allCustomers = getAllKnownCustomerCodes(members, orders);
  const orderedCustomers = new Set(rows.map(getOrderCustomerCode).filter(Boolean));
  const notOrdered = Array.from(allCustomers).filter((code) => !orderedCustomers.has(code));

  return [
    `Danh sách khách chưa thấy order trong ${label}:`,
    notOrdered.slice(0, 50).map((code, idx) => `${idx + 1}. ${customerDisplayByCode(code, members)}`).join('\n'),
    notOrdered.length > 50 ? `Đang hiển thị 50/${notOrdered.length} khách.` : '',
  ].filter(Boolean).join('\n');
}

// Danh sách khách đã order
if (
  wantsList &&
  padded.includes(' khach ') &&
  (padded.includes(' da order ') || padded.includes(' order ') || padded.includes(' da goi ') || padded.includes(' goi '))
) {
  const stats = buildCustomerOrderStats(orders, members, range)
    .sort((a, b) => b.orderCount - a.orderCount || b.totalQty - a.totalQty)
    .slice(0, 50);

  if (!stats.length) return `Chưa thấy khách nào order trong ${label}.`;

  return [
    `Danh sách khách đã order trong ${label}:`,
    stats.map(formatCustomerStatLine).join('\n'),
  ].join('\n');
}


  // 2) Bàn chưa order trong khoảng thời gian.
  if (
    (padded.includes(' ban chua order ') || padded.includes(' ban chua goi ') || padded.includes(' ban chua co order ')) ||
    (padded.includes(' bao nhieu ban ') && padded.includes(' chua '))
  ) {
const allTables = new Set(buildDefinedTableKeys());

const orderedTables = new Set(
  rows
    .map(getTableKey)
    .filter(Boolean)
    .filter((key) => allTables.has(key))
);

const notOrdered = Array.from(allTables).filter((x) => !orderedTables.has(x));

return [
  `${label} có ${notOrdered.length}/${allTables.size} bàn chưa thấy order.`,
  `Bàn đã order: ${orderedTables.size}/${allTables.size}.`,
  notOrdered.length ? `Một số bàn chưa order: ${notOrdered.slice(0, 30).map(formatTableKey).join(', ')}` : '',
].filter(Boolean).join('\n');
  }

  // 3) Có bao nhiêu bàn đã order.
  if (
    padded.includes(' bao nhieu ban order ') ||
    padded.includes(' bao nhieu ban da order ') ||
    (padded.includes(' bao nhieu ban ') && padded.includes(' order '))
  ) {
const allTables = new Set(buildDefinedTableKeys());
const tables = new Set(
  rows
    .map(getTableKey)
    .filter(Boolean)
    .filter((key) => allTables.has(key))
);

return `${label} có ${tables.size}/${allTables.size} bàn đã có order.`;
  }

  // 4) Tổng số khách đã order.
  if (
    padded.includes(' tong so cac khach da order ') ||
    padded.includes(' tong so khach da order ') ||
    padded.includes(' bao nhieu khach order ') ||
    padded.includes(' bao nhieu khach da order ')
  ) {
    const customerSet = new Set(rows.map(getOrderCustomerCode).filter(Boolean));
    return `${label} có ${customerSet.size} khách đã order.`;
  }

  // 5) Tổng số khách chưa order.
  if (
    padded.includes(' tong so cac khach chua order ') ||
    padded.includes(' tong so khach chua order ') ||
    padded.includes(' bao nhieu khach chua order ')
  ) {
    const allCustomers = getAllKnownCustomerCodes(members, orders);
    const orderedCustomers = new Set(rows.map(getOrderCustomerCode).filter(Boolean));
    const notOrdered = Array.from(allCustomers).filter((code) => !orderedCustomers.has(code));

    return [
      `${label} có ${notOrdered.length} khách chưa thấy order.`,
      `Tổng khách trong dữ liệu: ${allCustomers.size}`,
      `Khách đã order trong ${label}: ${orderedCustomers.size}`,
      notOrdered.length ? `Một số mã khách chưa order: ${notOrdered.slice(0, 20).join(', ')}` : '',
    ].filter(Boolean).join('\n');
  }

  const stats = buildCustomerOrderStats(orders, members, range);

  if (!stats.length) {
    return `Chưa thấy dữ liệu khách order trong ${label}.`;
  }

  // 6) Khách order ít nhất.
  if (
    padded.includes(' it nhat ') ||
    padded.includes(' order it ') ||
    padded.includes(' goi it ')
  ) {
    const sorted = stats
      .slice()
      .sort((a, b) => a.orderCount - b.orderCount || a.totalQty - b.totalQty || new Date(b.lastAt || 0) - new Date(a.lastAt || 0))
      .slice(0, 10);

    return [
      `Khách order ít nhất trong ${label}:`,
      sorted.map(formatCustomerStatLine).join('\n'),
    ].join('\n');
  }

  // 7) Khách order nhiều nhất.
  if (
    padded.includes(' nhieu nhat ') ||
    padded.includes(' order nhieu ') ||
    padded.includes(' top khach ') ||
    padded.includes(' khach nao ')
  ) {
    const sorted = stats
      .slice()
      .sort((a, b) => b.orderCount - a.orderCount || b.totalQty - a.totalQty || new Date(b.lastAt || 0) - new Date(a.lastAt || 0))
      .slice(0, 10);

    return [
      `Khách order nhiều nhất trong ${label}:`,
      sorted.map(formatCustomerStatLine).join('\n'),
    ].join('\n');
  }

  return [
    `Tổng quan order trong ${label}:`,
    `- Số order: ${rows.length}`,
    `- Số khách đã order: ${new Set(rows.map(getOrderCustomerCode).filter(Boolean)).size}`,
    `- Số bàn đã order: ${new Set(rows.map(getTableKey).filter(Boolean)).size}`,
  ].join('\n');
}
function answerTopItemsToday({ orders, maps, message }) {
  const range = getRangeFromMessage(message) || getBusinessRangeToday();
  const rows = (orders || []).filter((o) => o.status !== 'CANCELLED' && inRange(o, range));
  const top = buildItemStats(rows, maps).slice(0, 10);
  return [`Top món được order nhiều nhất trong ${range.label}:`, formatTopItems(top, 10)].join('\n');
}

function answerGeneralNotesToday({ orders, maps, message }) {
  const range = getRangeFromMessage(message) || getBusinessRangeToday();
  const rows = (orders || []).filter((o) => o.status !== 'CANCELLED' && inRange(o, range));
  const notes = countNotes(rows, maps).slice(0, 10);
  if (!notes.length) return `Chưa thấy ghi chú nào trong ${range.label}.`;
  return [`Ghi chú hay gặp trong ${range.label}:`, notes.map((n, i) => `${i + 1}. ${n.note} — ${n.count} lần`).join('\n')].join('\n');
}

function answerSoldOutItems({ foods, products }) {
  const maps = buildProductMaps(products, foods);
  const rows = [];
  const seen = new Set();
  for (const f of foods || []) {
    const status = norm(f.status || '');
    const qty = Number(f.quantity);
    const isSold = status.includes('sold out') || status.includes('soldout') || qty === 0;
    if (!isSold) continue;
    const imageKey = basenameLower(f.imageUrl || f.imageName || '');
    const meta = imageKey ? (maps.byImage.get(imageKey) || {}) : {};
    const key = imageKey || `${meta.name}-${f.type}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      name: String(meta.name || cleanDishName(imageKey) || imageKey || 'Không rõ tên').toUpperCase(),
      productCode: meta.productCode || f.productCode || f.code || '',
      menu: f.type || meta.menuType || '',
      quantity: Number.isFinite(qty) ? qty : '',
    });
  }
  if (!rows.length) return 'Hiện chưa thấy món nào đang Sold Out trong dữ liệu foods.json.';
  return [
    `Mình thấy ${rows.length} món đang Sold Out/hết số lượng. Top hiển thị trước:`,
    rows.slice(0, 20).map((x, i) => `${i + 1}. ${x.name}${x.productCode ? ` [${x.productCode}]` : ''}${x.menu ? ` — ${x.menu}` : ''}${x.quantity !== '' ? `, tồn ${x.quantity}` : ''}`).join('\n'),
  ].join('\n');
}

function answerTopCustomers({ orders, members, message }) {
  const range = getRangeFromMessage(message) || null;
  const rows = (orders || []).filter((o) => o.status !== 'CANCELLED' && inRange(o, range));
  const stats = new Map();
  for (const o of rows) {
    const code = String(o.memberCard || o.customer?.code || '').trim();
    if (!code) continue;
    const cur = stats.get(code) || { code, name: customerNameFromOrder(o, members), level: customerLevelFromOrder(o, members), orders: 0, items: 0, lastAt: null };
    cur.orders += 1;
    cur.items += (o.items || []).reduce((sum, it) => sum + Math.max(1, Number(it.qty || it.quantity || 1)), 0);
    if (o.createdAt && (!cur.lastAt || new Date(o.createdAt) > new Date(cur.lastAt))) cur.lastAt = o.createdAt;
    if (!cur.name) cur.name = customerNameFromOrder(o, members);
    if (!cur.level) cur.level = customerLevelFromOrder(o, members);
    stats.set(code, cur);
  }
  const top = Array.from(stats.values()).sort((a, b) => b.orders - a.orders || b.items - a.items || new Date(b.lastAt || 0) - new Date(a.lastAt || 0)).slice(0, 10);
  if (!top.length) return 'Chưa thấy dữ liệu khách hàng phù hợp để thống kê.';
  const label = range?.label ? ` trong ${range.label}` : '';
  return [`Top khách order nhiều${label}:`, top.map((x, i) => `${i + 1}. ${x.name || 'chưa có tên khách trong dữ liệu'} (${x.code})${x.level ? ` - level ${x.level}` : ''} — ${x.orders} order, ${x.items} phần${x.lastAt ? `, gần nhất ${fmtDateTime(x.lastAt)}` : ''}`).join('\n')].join('\n');
}

function answerRevenueSummary({ orders, message }) {
  const range = getRangeFromMessage(message) || getBusinessRangeToday();
  const rows = (orders || []).filter((o) => o.status !== 'CANCELLED' && inRange(o, range));
  let total = 0;
  let items = 0;
  for (const o of rows) {
    for (const it of o.items || []) {
      const qty = Math.max(1, Number(it.qty || it.quantity || 1));
      const price = Number(it.price || 0);
      if (Number.isFinite(price)) total += price * qty;
      items += qty;
    }
  }
  const money = new Intl.NumberFormat('vi-VN').format(total);
  return [`Tóm tắt doanh thu ${range.label}:`, `- Số order: ${rows.length}`, `- Số phần: ${items}`, `- Tổng tiền tạm tính theo giá lưu trong order: ${money} VND`].join('\n');
}

function isHasItemIntent(message) {
  const m = norm(message);
  const padded = ` ${m} `;

  // Những câu này là hỏi lịch sử/order theo thời gian, không phải hỏi món cụ thể.
  // Ví dụ: "1 hôm nay có order ko", "1 hôm qua có order không".
  if (isCustomerOrderSummaryIntent(message)) return false;

  const wanted = extractWantedItemText(message);
  if (!wanted) return false;

  // Nếu phần "món muốn hỏi" chỉ còn lại từ thời gian/order thì không xem là hỏi món.
  const wantedNorm = norm(wanted);
  const badOnlyWords = new Set(['hom', 'nay', 'qua', 'today', 'yesterday', 'order', 'goi', 'dat', 'mon']);
  const meaningful = wantedNorm.split(' ').filter((x) => x && !badOnlyWords.has(x));
  if (!meaningful.length) return false;

  const hasHabitWord = [' hay ', ' thuong '].some((x) => padded.includes(x));
  const hasEatDrinkOrderWord = [' an ', ' uong ', ' goi ', ' order '].some((x) => padded.includes(x));
  if (hasHabitWord && hasEatDrinkOrderWord) return false;

  const hasCheckWord = [' da tung ', ' tung ', ' co ', ' kiem tra ', ' xem ', ' chua ', ' ko ', ' khong ', ' k '].some((x) => padded.includes(x));
  const hasFoodActionWord = [' an ', ' uong ', ' order ', ' goi ', ' mon ', ' food ', ' drink ', ' item '].some((x) => padded.includes(x));
  const endsLikeQuestion = [' chua', ' ko', ' khong', ' k'].some((x) => padded.trim().endsWith(x.trim()));

  return (hasCheckWord && hasFoodActionWord) || endsLikeQuestion;
}
function getTableNoFromText(text) {
  const raw = String(text || '');
  const n = norm(raw);

  const bad = new Set([
    'ch', 'chua', 'da', 'co', 'bao', 'nhieu', 'order', 'goi', 'khach', 'nao'
  ]);

  const clean = (v) => {
    const s = String(v || '').trim();
    if (!s) return '';
    if (bad.has(norm(s))) return '';
    if (!/\d/.test(s)) return '';
    return s;
  };

  const rawPatterns = [
    /(?:bàn|ban|table)\s*[:#-]?\s*([A-Za-z0-9]+)/i,
    /(?:ở|o)\s*(?:bàn|ban|table)\s*[:#-]?\s*([A-Za-z0-9]+)/i,
  ];

  for (const re of rawPatterns) {
    const hit = raw.match(re);
    const tableNo = clean(hit?.[1]);
    if (tableNo) return tableNo;
  }

  const hit = n.match(/(?:ban|table)\s+([a-z0-9]+)/i);
  const tableNo = clean(hit?.[1]);
  if (tableNo) return tableNo;

  return '';
}

function getContextTableNo(context = {}) {
  const st = context?.selectedTable || context?.table || context?.currentTable;

  if (!st) return '';

  if (typeof st === 'string' || typeof st === 'number') {
    const s = String(st).trim();
    return /\d/.test(s) ? s : '';
  }

  if (typeof st === 'object') {
    const val =
      st.tableNo ||
      st.table ||
      st.no ||
      st.id ||
      st.value ||
      st.name ||
      '';

    const s = String(val).trim();
    return /\d/.test(s) ? s : '';
  }

  return '';
}

function getLastTableNoFromHistory(history = [], context = {}) {
  const ctxTable = getContextTableNo(context);
  if (ctxTable) return ctxTable;

  const list = Array.isArray(history) ? history : [];

  for (let i = list.length - 1; i >= 0; i -= 1) {
    const text = String(list[i]?.content || '');
    const tableNo = getTableNoFromText(text);
    if (tableNo) return tableNo;
  }

  return '';
}

function getLastUserTextFromHistory(history = []) {
  const list = Array.isArray(history) ? history : [];

  for (let i = list.length - 1; i >= 0; i -= 1) {
    const row = list[i];
    if (row?.role === 'user' && String(row.content || '').trim()) {
      return String(row.content || '').trim();
    }
  }

  return '';
}

function getRangePrefixFromText(text) {
  const n = norm(text);
  if (n.includes('hom nay')) return 'hôm nay ';
  if (n.includes('hom qua')) return 'hôm qua ';
  if (n.includes('7 ngay')) return '7 ngày gần đây ';
  if (n.includes('30 ngay') || n.includes('thang nay')) return '30 ngày gần đây ';
  return '';
}

function resolveFollowupReferences(message, history = [], context = {}) {
  let out = String(message || '').trim();
  const m = norm(out);

  const tableNo = getLastTableNoFromHistory(history, context);

const isTableFollowup =
  tableNo &&
  (
    m.includes('ban do') ||
    m.includes('ban nay') ||
    m.includes('table do') ||
    m.includes('table nay')
  );

if (isTableFollowup) {
  out = out.replace(/(bàn|ban|table)\s*(đó|do|này|nay)/gi, `bàn ${tableNo}`);

  // Giữ mốc thời gian từ câu trước.
  // Ví dụ:
  // "bàn 1001 hôm nay có order chưa?"
  // "bàn đó gọi món gì?"
  // => "hôm nay bàn 1001 gọi món gì?"
  const lastUser = getLastUserTextFromHistory(history);
  const lastAssistant = Array.isArray(history)
    ? [...history].reverse().find((row) => row?.role === 'assistant' && String(row.content || '').trim())?.content || ''
    : '';

  const rangePrefix =
    getRangePrefixFromText(lastUser) ||
    getRangePrefixFromText(lastAssistant);

  const currentHasRange = !!getRangePrefixFromText(out);

  if (rangePrefix && !currentHasRange) {
    out = `${rangePrefix}${out}`;
  }
}

  // Câu hỏi tiếp theo ngắn: "danh sách", "liệt kê", "xem danh sách"
  // → suy ra từ câu hỏi trước.
  const shortListQuestion = [
    'danh sach',
    'liet ke',
    'xem danh sach',
    'cho xem danh sach',
    'list',
  ].includes(m);

  if (shortListQuestion) {
    const lastUser = getLastUserTextFromHistory(history);
    const last = norm(lastUser);
    const rangePrefix = getRangePrefixFromText(lastUser);

    if (last.includes('ban') && last.includes('chua')) {
      return `${rangePrefix}danh sách các bàn chưa order`;
    }

    if (last.includes('ban') && (last.includes('da order') || last.includes('order') || last.includes('goi'))) {
      return `${rangePrefix}danh sách các bàn đã order`;
    }

    if (last.includes('khach') && last.includes('chua')) {
      return `${rangePrefix}danh sách khách chưa order`;
    }

    if (last.includes('khach') && (last.includes('da order') || last.includes('order') || last.includes('goi'))) {
      return `${rangePrefix}danh sách khách đã order`;
    }

    if (last.includes('mon') || last.includes('food')) {
      return `${rangePrefix}danh sách món được order nhiều`;
    }
  }

  return out;
}

function answerGeneralAppQuestion({ message = '', mode = 'user' } = {}) {
  const m = norm(message);
  const padded = ` ${m} `;

  const isGreeting =
    ['hello', 'hi', 'xin chao', 'chao', 'chao ban', 'alo', 'hey']
      .some((x) => padded.includes(` ${x} `));

  if (isGreeting && m.split(' ').length <= 4) {
    return [
      'Chào bạn, mình là Chatbot hỗ trợ phần mềm Food Order.',
      'Bạn có thể hỏi mình về khách, order, bàn, món ăn, món bán chạy, ghi chú và gợi ý món.'
    ].join('\n');
  }

  const askCapability =
    m.includes('ban co the tra loi') ||
    m.includes('ban lam duoc gi') ||
    m.includes('hoi duoc gi') ||
    m.includes('co the hoi gi') ||
    m.includes('chatbot lam duoc gi') ||
    m.includes('tro ly lam duoc gi');

  if (askCapability) {
    const base = [
      'Mình có thể hỗ trợ các nhóm câu hỏi như:',
      '',
      '1. Về khách hàng:',
      '- 1 hay ăn gì?',
      '- 1 hay uống gì?',
      '- 1 có ăn KIMBAP chưa?',
      '- 1 hôm nay có order không?',
      '- 1 hay order lúc mấy giờ?',
      '- 1 hay ghi chú gì?',
      '- gợi ý món cho 1',
      '',
      '2. Về bàn/order:',
      '- hôm nay có bao nhiêu bàn đã order?',
      '- hôm nay có bao nhiêu bàn chưa order?',
      '- bàn 1001 đã có bao nhiêu order?',
      '- hôm nay có ai order bàn 1001 chưa?',
      '- danh sách các bàn đã order',
      '',
      '3. Về món ăn:',
      '- top món hôm nay',
      '- món nào đang sold out?',
      '- khách nào order món KIMBAP nhiều nhất?',
      '',
      '4. Về thống kê khách:',
      '- khách order nhiều nhất là ai?',
      '- tổng số khách đã order',
      '- danh sách khách đã order',
    ];

    if (mode === 'admin') {
      base.push(
        '',
        'Admin có thể hỏi thêm về báo cáo, doanh thu, giá và thống kê nội bộ nếu dữ liệu có trong hệ thống.'
      );
    }

    return base.join('\n');
  }

  const askWhatApp =
    m.includes('day la phan mem gi') ||
    m.includes('phan mem gi') ||
    m.includes('app gi') ||
    m.includes('food order la gi') ||
    m.includes('he thong nay la gi');

  if (askWhatApp) {
    return [
      'Đây là phần mềm Food Order dùng để quản lý order món ăn theo bàn/khu vực.',
      '',
      'Phần mềm hiện có các phần chính:',
      '- User: chọn bàn, chọn món, gửi order.',
      '- Admin/Kitchen: nhận order, xử lý món, quản lý trạng thái món.',
      '- Báo cáo/Sở thích khách: xem lịch sử order, món khách hay gọi, ghi chú và gợi ý món.',
      '- Chatbot: hỗ trợ hỏi nhanh dữ liệu về khách, bàn, order và món ăn.'
    ].join('\n');
  }

  const askHowToUse =
    m.includes('su dung nhu nao') ||
    m.includes('dung nhu nao') ||
    m.includes('huong dan su dung') ||
    m.includes('cach su dung') ||
    m.includes('xai nhu nao') ||
    m.includes('xài như nào');

  if (askHowToUse) {
    return [
      'Cách sử dụng cơ bản:',
      '',
      '1. Bên User:',
      '- Chọn khu vực và bàn.',
      '- Chọn món trong menu.',
      '- Nhập mã nhân viên, mã khách nếu có.',
      '- Gửi order.',
      '',
      '2. Bên Admin/Kitchen:',
      '- Xem order mới.',
      '- Cập nhật trạng thái món/order.',
      '- Quản lý món sold out/còn hàng.',
      '- Xem báo cáo và lịch sử order.',
      '',
      '3. Với chatbot:',
      '- Hỏi theo mã khách, ví dụ: “1 hay ăn gì?”.',
      '- Hỏi theo bàn, ví dụ: “bàn 1001 hôm nay có ai order chưa?”.',
      '- Hỏi thống kê, ví dụ: “top món hôm nay”.'
    ].join('\n');
  }
const askCreator =
  m.includes('ai lam ra phan mem nay') ||
  m.includes('ai tao ra phan mem nay') ||
  m.includes('ai viet phan mem nay') ||
  m.includes('phan mem nay cua ai') ||
  m.includes('ai phat trien phan mem nay') ||

  // Thêm các cách hỏi bằng chữ "app/ứng dụng"
  m.includes('app nay do ai lam') ||
  m.includes('ai lam app nay') ||
  m.includes('ai tao app nay') ||
  m.includes('ai viet app nay') ||
  m.includes('app nay cua ai') ||
  m.includes('ung dung nay do ai lam') ||
  m.includes('ung dung nay cua ai') ||
  m.includes('ai phat trien app nay');

if (askCreator) {
const owner = process.env.APP_OWNER_NAME || 'Jack';
return `Phần mềm Food Order này được phát triển bởi ${owner} để hỗ trợ quản lý order món ăn, bàn, khách hàng và báo cáo.`;
}
  const askWhoAreYou =
    m.includes('ban la ai') ||
    m.includes('chatbot la gi') ||
    m.includes('ai la gi') ||
    m.includes('tro ly la gi');

  if (askWhoAreYou) {
    return [
      'Mình là chatbot nội bộ của phần mềm Food Order.',
      'Nhiệm vụ của mình là giúp nhân viên hỏi nhanh dữ liệu về khách, order, bàn, món ăn, ghi chú và gợi ý món dựa trên dữ liệu thật trong hệ thống.'
    ].join('\n');
  }

  const thanks =
    ['cam on', 'thanks', 'thank you', 'ok cam on', 'oke cam on']
      .some((x) => padded.includes(` ${x} `));

  if (thanks) {
    return 'Không có gì nha. Bạn cứ hỏi mã khách, bàn, order hoặc món ăn là mình check giúp.';
  }

  return '';
}
// ===== LOCAL SMART ROUTER HELPERS (không dùng AI bên thứ 3) =====
function smartIncludesAny(textNorm, phrases = []) {
  const padded = ` ${textNorm} `;
  return phrases.some((p) => {
    const n = norm(p);
    if (!n) return false;
    return padded.includes(` ${n} `) || textNorm.includes(n);
  });
}

function rewriteSmartLocalQuestion(message = '') {
  let out = String(message || '').trim();
  const m = norm(out);

  const additions = [];

  if (smartIncludesAny(m, ['goi gi', 'goi mon gi', 'dat gi', 'dat mon gi', 'an uong gi'])) {
    additions.push('order gì');
  }

  if (smartIncludesAny(m, ['thich an gi', 'ua an gi', 'mon ruot', 'mon tu', 'mon quen', 'hay dung mon nao', 'thuong dung mon nao'])) {
    additions.push('hay ăn gì');
  }

  if (smartIncludesAny(m, ['thich uong gi', 'ua uong gi', 'nuoc quen', 'do uong quen', 'hay dung nuoc nao', 'thuong dung nuoc nao'])) {
    additions.push('hay uống gì');
  }

  if (smartIncludesAny(m, ['khong thich', 'di ung', 'can tranh', 'tranh mon', 'khong hop', 'khong an duoc', 'khong uong duoc'])) {
    additions.push('không thích cần tránh ghi chú');
  }

  if (smartIncludesAny(m, ['nen cho an gi', 'nen goi gi', 'tu van mon', 'recommend', 'suggest', 'goi y'])) {
    additions.push('gợi ý món');
  }

  if (smartIncludesAny(m, ['gio nao', 'luc nao', 'khung gio nao', 'hay an luc nao', 'hay uong luc nao'])) {
    additions.push('hay order lúc mấy giờ');
  }

  if (smartIncludesAny(m, ['yeu cau gi', 'note gi', 'ghi chu gi', 'hay doi gi', 'hay yeu cau gi'])) {
    additions.push('hay ghi chú gì');
  }

  if (additions.length) {
    out = `${out} ${additions.join(' ')}`;
  }

  return out;
}

function detectLocalSmartIntent(message = '') {
  const m = norm(message);
  if (!m) return '';

  const scores = {};
  const add = (intent, points) => {
    scores[intent] = (scores[intent] || 0) + points;
  };
// Câu hỏi kiểm tra khách đã từng ăn/uống/gọi một món cụ thể chưa.
// Ví dụ: "1 từng ăn cơm chiên chưa", "1 có uống avocado smoothie không".
const asksSpecificItem =
  (
    /\b(tung|da|co)\b.*\b(an|uong|order|goi)\b/.test(m) ||
    /\b(an|uong|order|goi)\b.*\b(chua|khong|ko|k)\b/.test(m)
  ) &&
  !/\b(order gi|goi gi|goi mon gi|an gi|uong gi|mon gi)\b/.test(m);

if (asksSpecificItem) {
  add('customer_has_item', 30);
}
  if (smartIncludesAny(m, ['goi y', 'recommend', 'suggest', 'nen goi', 'nen an', 'nen uong', 'tu van'])) {
    add('customer_recommendation', 6);
  }

  if (smartIncludesAny(m, ['khong thich', 'di ung', 'can tranh', 'tranh mon', 'khong hop', 'khong an duoc', 'khong uong duoc'])) {
    add('customer_dislikes', 7);
  }

  if (smartIncludesAny(m, ['ghi chu', 'note', 'yeu cau', 'request', 'hay doi', 'hay yeu cau'])) {
    add('customer_notes', 6);
  }

  if (smartIncludesAny(m, ['may gio', 'gio nao', 'luc nao', 'khung gio', 'thoi gian', 'time', 'when'])) {
    add('customer_order_time', 6);
  }

  if (smartIncludesAny(m, ['uong', 'nuoc', 'do uong', 'drink', 'beverage', 'coffee', 'cafe', 'tea', 'juice', 'smoothie'])) {
    add('customer_top_drinks', 4);
  }

  if (smartIncludesAny(m, ['an', 'mon an', 'food', 'dish', 'com', 'mi', 'pho', 'rice', 'noodle'])) {
    add('customer_top_foods', 4);
  }

  if (smartIncludesAny(m, ['hay', 'thuong', 'thich', 'ua', 'mon quen', 'mon ruot', 'mon tu', 'so thich'])) {
    add('customer_top_all', 3);
  }

  if (smartIncludesAny(m, ['co order khong', 'co goi khong', 'co dat khong', 'order gi', 'goi gi', 'dat gi', 'hom nay', 'hom qua', 'gan day', 'lan gan nhat', 'moi nhat'])) {
    add('customer_order_summary', 5);
  }

  if (smartIncludesAny(m, ['co an', 'co uong', 'tung an', 'tung uong', 'da an', 'da uong', 'chua', 'ko', 'khong'])) {
    add('customer_has_item', 4);
  }

  const entries = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  if (!entries.length || entries[0][1] < 4) return '';
  return entries[0][0];
}

const SMART_NAME_STOP_WORDS = new Set([
  'khach', 'customer', 'member', 'card', 'ma', 'so', 'code',
  'nay', 'do', 'co', 'khong', 'ko', 'k', 'chua', 'da', 'tung',
  'hay', 'thuong', 'thich', 'ua', 'an', 'uong', 'goi', 'order', 'dat',
  'mon', 'food', 'do', 'nuoc', 'gi', 'nao', 'luc', 'gio', 'may', 'khung',
  'hom', 'qua', 'nay', 'today', 'yesterday', 'gan', 'day', 'tuan', 'thang',
  'goi', 'y', 'suggest', 'recommend', 'nen', 'tu', 'van', 'ghi', 'chu', 'note',
  'khong', 'thich', 'di', 'ung', 'can', 'tranh', 'cho', 'toi', 'minh', 'xem', 'kiem', 'tra',
  'theo', 'ghi', 'chu', 'dua', 'tren',
  'app', 'phan', 'mem',
  'ban', 'chay', 'sold', 'out',
]);

function extractCustomerNameQuery(message = '') {
  const tokens = norm(message).split(/\s+/).filter(Boolean);
  const kept = tokens.filter((t) => {
    if (!t || SMART_NAME_STOP_WORDS.has(t)) return false;
    if (/^\d+$/.test(t)) return false;
    return t.length >= 2;
  });

  return kept.slice(0, 5).join(' ').trim();
}

function buildCustomerSearchRowsLocal(orders = [], members = {}) {
  const rows = new Map();

  const ensure = (codeInput, data = {}) => {
    const code = compactCode(codeInput);
    if (!code) return null;

    const prev = rows.get(code) || {
      code,
      name: '',
      level: '',
      ordersCount: 0,
      totalQty: 0,
      lastOrderAt: null,
    };

    const m = members[code] || {};
    const name = String(data.name || prev.name || m.name || m.customerName || '').trim();
    const level = String(data.level || prev.level || m.level || m.memberLevel || m.tier || '').trim();

    const next = {
      ...prev,
      name,
      level,
    };

    rows.set(code, next);
    return next;
  };

  for (const [code, m] of Object.entries(members || {})) {
    ensure(code, {
      name: m?.name || m?.customerName || '',
      level: m?.level || m?.memberLevel || m?.tier || '',
    });
  }

  for (const o of orders || []) {
    if (!o || o.status === 'CANCELLED') continue;
    const code = getOrderCustomerCode(o);
    if (!code) continue;

    const row = ensure(code, {
      name: getOrderCustomerName(o, members),
      level: getOrderCustomerLevel(o, members),
    });

    if (!row) continue;
    row.ordersCount += 1;
    row.totalQty += getOrderTotalQty(o);

    const orderAt = o.createdAt || o.updatedAt || '';
    if (orderAt && (!row.lastOrderAt || new Date(orderAt) > new Date(row.lastOrderAt))) {
      row.lastOrderAt = orderAt;
    }
  }

  return Array.from(rows.values()).sort((a, b) => {
    if (b.ordersCount !== a.ordersCount) return b.ordersCount - a.ordersCount;
    if (b.totalQty !== a.totalQty) return b.totalQty - a.totalQty;
    return new Date(b.lastOrderAt || 0) - new Date(a.lastOrderAt || 0);
  });
}

function resolveCustomerByNameLocal({ message = '', orders = [], members = {} } = {}) {
  const q = extractCustomerNameQuery(message);
  if (!q || q.length < 2) return { type: 'none' };

  const qTokens = q.split(/\s+/).filter((t) => t.length >= 2);
  if (!qTokens.length) return { type: 'none' };

  const rows = buildCustomerSearchRowsLocal(orders, members).filter((row) => {
    const nameNorm = norm(row.name || '');
    if (!nameNorm) return false;
    return qTokens.every((t) => nameNorm.includes(t));
  });

  if (!rows.length) return { type: 'none', q };
  if (rows.length === 1) return { type: 'single', code: rows[0].code, row: rows[0], q };
  return { type: 'multiple', rows: rows.slice(0, 8), q };
}

function formatCustomerSelectionList(match) {
  const lines = (match.rows || []).map((row, idx) => {
    const level = row.level ? ` - ${row.level}` : '';
    const count = Number(row.ordersCount || 0);
    return `${idx + 1}. ${row.name || 'Chưa có tên'}${level} (${row.code}) — ${count} order`;
  });

  return [
    `Mình tìm thấy nhiều khách gần giống "${match.q}". Bạn chọn đúng mã khách rồi hỏi lại nha:`,
    '',
    lines.join('\n'),
    '',
    'Ví dụ: "17860 hay ăn gì?" hoặc "gợi ý món cho 17860".'
  ].join('\n');
}

// ===== SMART APP CHATBOT INTENT HELPERS =====
function hasPhrase(message, phrases = []) {
  const m = norm(message);
  const padded = ` ${m} `;
  return phrases.some((p) => {
    const x = norm(p);
    if (!x) return false;
    return padded.includes(` ${x} `) || m.includes(x);
  });
}

function wantsTopItemsQuestion(message = '') {
  const m = norm(message);
  const padded = ` ${m} `;

  const hasItemWord =
    padded.includes(' mon ') ||
    padded.includes(' food ') ||
    padded.includes(' item ') ||
    padded.includes(' do an ') ||
    padded.includes(' do uong ');

  return (
    hasPhrase(m, [
      'top mon',
      'mon ban chay',
      'mon nao ban chay',
      'mon nao dang duoc order nhieu',
      'mon nao duoc order nhieu',
      'mon nao goi nhieu',
      'mon nao dat nhieu',
      'order nhieu nhat',
      'goi nhieu nhat',
      'ban chay hom nay',
      'goi y mon ban chay',
      'goi y mon dang ban chay',
      'mon hot',
      'mon nao hot',
    ]) ||
    (
      hasItemWord &&
      hasPhrase(m, ['top', 'ban chay', 'order nhieu', 'goi nhieu', 'dat nhieu', 'nhieu nhat'])
    )
  );
}

function wantsSoldOutQuestion(message = '') {
  return hasPhrase(message, [
    'sold out',
    'soldout',
    'het hang',
    'het mon',
    'mon nao het',
    'mon nao sold out',
    'mon het hang',
    'dang het hang',
    'khong con mon nao',
  ]);
}

function wantsGeneralNotesQuestion(message = '') {
  return hasPhrase(message, [
    'ghi chu hay gap',
    'note hay gap',
    'ghi chu hom nay',
    'note hom nay',
    'khach hay note gi',
    'khach hay ghi chu gi',
    'ghi chu mon an',
    'note mon an',
  ]);
}

function wantsRevenueQuestion(message = '') {
  return hasPhrase(message, [
    'doanh thu',
    'revenue',
    'tong tien',
    'bao cao doanh thu',
    'tong doanh thu',
    'tien hom nay',
    'tong tien hom nay',
  ]);
}

function isCurrentCustomerReference(message = '') {
  return hasPhrase(message, [
    'khach nay',
    'khach do',
    'customer nay',
    'customer do',
    'member nay',
    'member do',
    'nguoi nay',
    'nguoi do',
  ]);
}

function getLastCustomerCodeFromHistory(history = []) {
  const list = Array.isArray(history) ? history : [];

  for (let i = list.length - 1; i >= 0; i -= 1) {
    const text = String(list[i]?.content || '');
    const code = getCustomerCodeFromMessage(text, {});
    if (code) return code;
  }

  return '';
}

function asksCustomerNoteSuggestion(message = '') {
  return (
    hasPhrase(message, ['goi y', 'suggest', 'recommend', 'nen goi', 'nen cho']) &&
    hasPhrase(message, ['ghi chu', 'note', 'yeu cau', 'so thich']) &&
    hasPhrase(message, ['khach', 'customer', 'member'])
  );
}

function looksLikeCustomerNameQuestion(message = '') {
  const m = norm(message);

  // Cho phép hỏi tên ở đầu câu:
  // "nikunj hay ăn gì", "theodore thường uống gì"
  if (/^[a-z][a-z\s]{2,}\s+(hay|thuong|thich|order|goi|an|uong|ghi chu|note|goi y|khong thich)/i.test(m)) {
    return true;
  }

  // Cho phép: "gợi ý món cho Nikunj", "khách Nikunj hay ăn gì"
  return (
    /\bcho\s+[a-z][a-z\s]{1,}/i.test(m) ||
    /\b(khach|customer|member)\s+[a-z][a-z\s]{1,}/i.test(m)
  );
}

function shouldAskForCustomerCode(message = '', smartIntent = '') {
  if (!smartIntent) return false;

  if (isCurrentCustomerReference(message)) return true;

  return [
    'customer_order_summary',
    'customer_dislikes',
    'customer_has_item',
    'customer_top_foods',
    'customer_top_drinks',
    'customer_top_all',
    'customer_recommendation',
    'customer_notes',
    'customer_order_time',
  ].includes(smartIntent);
}

function missingCustomerCodeAnswer(message = '') {
  if (asksCustomerNoteSuggestion(message)) {
    return [
      'Bạn nhập mã khách/memberCard để mình gợi ý món theo ghi chú và lịch sử order của khách nhé.',
      '',
      'Ví dụ:',
      '- gợi ý món theo ghi chú khách 1',
      '- gợi ý món cho 1',
      '- 1 hay ghi chú gì?'
    ].join('\n');
  }

  if (isCurrentCustomerReference(message)) {
    return [
      'Mình chưa biết “khách này” là khách nào.',
      'Bạn nhập mã khách trước hoặc hỏi theo mẫu:',
      '- 1 hay ăn gì?',
      '- gợi ý món cho 1',
      '- 1 hay ghi chú gì?'
    ].join('\n');
  }

  return [
    'Bạn cho mình mã khách/memberCard hoặc tên khách rõ hơn để mình kiểm tra nhé.',
    '',
    'Ví dụ:',
    '- 1 hay ăn gì?',
    '- Nikunj hay uống gì?',
    '- gợi ý món cho 17860'
  ].join('\n');
}

function canSearchCustomerNameFromQuestion(message = '') {
  if (asksCustomerNoteSuggestion(message)) return false;

  const q = extractCustomerNameQuery(message);
  if (!q || q.length < 2) return false;

  // Chặn các từ không phải tên nhưng dễ bị hiểu nhầm thành tên khách.
  const bad = new Set([
    'theo',
    'ghi',
    'chu',
    'note',
    'mon',
    'ban',
    'hom',
    'nay',
    'qua',
    'top',
    'sold',
    'out',
    'app',
    'phan',
    'mem',
    'doanh',
    'thu',
  ]);

  const tokens = q.split(/\s+/).filter(Boolean);
  if (!tokens.length) return false;
  if (tokens.every((t) => bad.has(t))) return false;

  return looksLikeCustomerNameQuestion(message);
}

function isGeneralAppDataQuestion(message = '') {
  return (
    wantsTopItemsQuestion(message) ||
    wantsSoldOutQuestion(message) ||
    wantsGeneralNotesQuestion(message) ||
    isAppAnalyticsIntent(message)
  );
}
function answerLocalFoodQuestion({ mode = 'user', message = '', history = [], context = {}, paths = {} } = {}) {
  let msg = String(message || '').trim();
  const { orders, foods, products, members, memory } = loadData(paths);
  const maps = buildProductMaps(products, foods);

  if (!msg) {
    return {
      ok: false,
      mode,
      provider: 'local',
      answer: 'Bạn nhập câu hỏi giúp mình nhé.',
    };
  }

  // 1) Hiểu follow-up: "bàn đó", "bàn này", "khách này".
  if (typeof resolveFollowupReferences === 'function') {
    msg = resolveFollowupReferences(msg, history, context);
  }

  // 2) Chuẩn hóa câu hỏi tự nhiên.
  if (typeof rewriteSmartLocalQuestion === 'function') {
    msg = rewriteSmartLocalQuestion(msg);
  }

  // 3) Áp dụng memory đã duyệt.
  if (typeof applyAiMemoryToMessage === 'function') {
    msg = applyAiMemoryToMessage(msg, memory);
  }

  const m = norm(msg);
  const range = getRangeFromMessage(msg);

  // 4) Câu hỏi chung về app.
  const generalAnswer = answerGeneralAppQuestion({ message: msg, mode });
  if (generalAnswer) {
    return {
      ok: true,
      mode,
      provider: 'local',
      answer: generalAnswer,
    };
  }

  // 5) Chặn user hỏi dữ liệu nhạy cảm/tài chính.
  if (mode !== 'admin' && isBlockedForUser(msg)) {
    return {
      ok: true,
      mode,
      provider: 'local',
      answer: 'Phần User không được hỏi về giá, doanh thu, báo cáo, lợi nhuận hoặc tổng tiền. Bạn hỏi mình về gợi ý món, khách hay gọi gì, ghi chú món ăn hoặc món đang bán chạy là được nha.',
    };
  }

  // 6) Admin được hỏi doanh thu.
  if (mode === 'admin' && wantsRevenueQuestion(msg)) {
    return {
      ok: true,
      mode,
      provider: 'local',
      answer: answerRevenueSummary({ orders, message: msg }),
    };
  }

  // 7) Ưu tiên top món/bán chạy trước analytics tổng quan.
  // Fix lỗi: "Gợi ý món bán chạy hôm nay" không được trả tổng quan order.
  if (wantsTopItemsQuestion(msg)) {
    return {
      ok: true,
      mode,
      provider: 'local',
      answer: answerTopItemsToday({ orders, maps, message: msg }),
    };
  }

  // 8) Sold out/hết hàng.
  if (wantsSoldOutQuestion(msg)) {
    return {
      ok: true,
      mode,
      provider: 'local',
      answer: answerSoldOutItems({ foods, products }),
    };
  }

  // 9) Ghi chú tổng quan.
  if (wantsGeneralNotesQuestion(msg)) {
    return {
      ok: true,
      mode,
      provider: 'local',
      answer: answerGeneralNotesToday({ orders, maps, message: msg }),
    };
  }

  // 10) Analytics app: bàn, khách, danh sách, tổng quan.
  if (isAppAnalyticsIntent(msg)) {
    return {
      ok: true,
      mode,
      provider: 'local',
      answer: answerAppAnalytics({
        orders,
        members,
        message: msg,
        range,
        maps,
      }),
    };
  }

  // 11) Xác định mã khách.
  let code = getCustomerCodeFromMessage(msg, context);
  const smartIntent = detectLocalSmartIntent(msg);

  // 11.1) Nếu user nói "khách này/khách đó", lấy mã khách từ history.
  if (!code && isCurrentCustomerReference(msg)) {
    code = getLastCustomerCodeFromHistory(history);
  }

  // 11.2) Nếu user hỏi tên khách thay vì mã, chỉ search tên khi câu thật sự giống tên.
  if (!code && smartIntent && canSearchCustomerNameFromQuestion(msg)) {
    const nameMatch = resolveCustomerByNameLocal({ message: msg, orders, members });

    if (nameMatch.type === 'single') {
      code = nameMatch.code;
    } else if (nameMatch.type === 'multiple') {
      return {
        ok: true,
        mode,
        provider: 'local-smart-name-search',
        answer: formatCustomerSelectionList(nameMatch),
      };
    }
  }

  // 11.3) Nếu câu cần khách nhưng thiếu mã/tên rõ ràng.
  if (!code && shouldAskForCustomerCode(msg, smartIntent)) {
    return {
      ok: true,
      mode,
      provider: 'local',
      answer: missingCustomerCodeAnswer(msg),
    };
  }

  const customerOrders = code ? getCustomerOrders(orders, code, range) : [];

  let answer = '';

  // 12) Intent theo khách.
  if (code && (smartIntent === 'customer_has_item' || isHasItemIntent(msg))) {
    answer = answerHasCustomerOrderedItem({
      code,
      customerOrders,
      maps,
      members,
      message: msg,
    });
  } else if (code && (smartIntent === 'customer_order_summary' || isCustomerOrderSummaryIntent(msg))) {
    answer = answerCustomerOrdersInRange({
      code,
      customerOrders,
      maps,
      members,
      range,
      message: msg,
    });
  } else if (code && (smartIntent === 'customer_dislikes' || isCustomerDislikeIntent(msg))) {
    answer = answerCustomerDislikes({
      code,
      customerOrders,
      maps,
      members,
    });
  } else if (
    code &&
    (
      smartIntent === 'customer_top_foods' ||
      smartIntent === 'customer_top_drinks' ||
      smartIntent === 'customer_top_all' ||
      isOpenEndedLikeQuestion(msg)
    )
  ) {
    const type =
      smartIntent === 'customer_top_drinks'
        ? 'drinks'
        : smartIntent === 'customer_top_foods'
          ? 'foods'
          : getOpenEndedLikeType(msg);

    answer = answerCustomerTop({
      code,
      customerOrders,
      maps,
      members,
      type,
    });
  } else if (
    code &&
    (
      smartIntent === 'customer_recommendation' ||
      /\b(goi y|recommend|suggest|nen goi|nen mon|tu van|nen cho)\b/.test(m)
    )
  ) {
    answer = answerRecommendation({
      code,
      customerOrders,
      maps,
      members,
      orders,
    });
  } else if (
    code &&
    (
      smartIntent === 'customer_notes' ||
      (/\b(ghi chu|note|yeu cau|request|preference|so thich)\b/.test(m) &&
        !/\b(goi y|recommend|suggest)\b/.test(m))
    )
  ) {
    answer = answerCustomerNotes({
      code,
      customerOrders,
      maps,
      members,
    });
  } else if (
    code &&
    (
      smartIntent === 'customer_order_time' ||
      /\b(gio|may gio|luc nao|khung gio|thoi gian|time|when|buoi nao)\b/.test(m)
    )
  ) {
    answer = answerCustomerTime({
      code,
      customerOrders,
      maps,
      members,
    });
  } else if (code && isCustomerPreferenceIntent(msg)) {
    answer = answerCustomerPreferenceFromOrders({
      code,
      customerOrders,
      maps,
      members,
      message: msg,
    });
  }

  if (answer) {
    return {
      ok: true,
      mode,
      provider: 'local',
      answer,
    };
  }

  // 13) Fallback cho câu liên quan app nhưng chưa đủ dữ liệu.
  if (isGeneralAppDataQuestion(msg)) {
    return {
      ok: true,
      mode,
      provider: 'local',
      answer: [
        'Mình hiểu đây là câu hỏi liên quan dữ liệu app, nhưng câu hỏi chưa đủ rõ để thống kê chính xác.',
        '',
        'Bạn có thể hỏi theo mẫu:',
        '- top món hôm nay',
        '- bàn 1001 hôm nay gọi món gì?',
        '- 1 hay ăn gì?',
        '- gợi ý món cho 1',
        '- hôm nay bàn nào chưa order?'
      ].join('\n'),
    };
  }

  // 14) Training/memory fallback.
  const related = getRelevantTraining(memory || [], msg, 3);
  if (related.length) {
    return {
      ok: true,
      mode,
      provider: 'local-memory',
      answer: related.map((x) => x.content).join('\n\n'),
    };
  }

  return {
    ok: true,
    mode,
    provider: 'local',
    answer: [
      'Mình chưa hiểu rõ câu này để trả lời bằng dữ liệu thật.',
      '',
      'Bạn thử hỏi theo các mẫu sau:',
      '- 1 hay ăn gì?',
      '- 1 từng ăn cơm chiên chưa?',
      '- gợi ý món cho 1',
      '- bàn 1001 hôm nay gọi món gì?',
      '- top món hôm nay',
      '- món nào đang sold out?'
    ].join('\n'),
  };
}

function memoryId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeMemoryItem(row) {
  if (!row || row.status !== 'approved') return null;
  const type = String(row.type || '').trim();
  const phrase = String(row.phrase || '').trim();
  const meaning = String(row.meaning || row.target || '').trim();
  if (!type || !phrase || !meaning) return null;
  return { ...row, type, phrase, meaning, phraseNorm: norm(phrase), meaningNorm: norm(meaning) };
}

function applyAiMemoryToMessage(message, memory = []) {
  let out = String(message || '');
  const baseNorm = norm(out);
  const approved = (memory || []).map(normalizeMemoryItem).filter(Boolean);

  for (const row of approved) {
    if (!row.phraseNorm || !baseNorm.includes(row.phraseNorm)) continue;

    if (row.type === 'intent_alias') {
      if (row.meaning === 'customer_order_summary') out += ' order gì';
      else if (row.meaning === 'customer_order_today') out += ' hôm nay order gì';
      else if (row.meaning === 'customer_order_yesterday') out += ' hôm qua order gì';
      else if (row.meaning === 'customer_top_foods') out += ' hay ăn gì';
      else if (row.meaning === 'customer_top_drinks') out += ' hay uống gì';
      else if (row.meaning === 'customer_order_time') out += ' hay order lúc mấy giờ';
      else if (row.meaning === 'customer_notes') out += ' hay ghi chú gì';
      else if (row.meaning === 'customer_recommendation') out += ' gợi ý món';
    }

    if (row.type === 'food_alias') {
      out += ` ${row.meaning}`;
    }

    if (row.type === 'note_alias') {
      out += ` ${row.meaning}`;
    }
  }

  return out;
}

function detectLearningType(question, correction) {
  const q = norm(question);
  const c = norm(correction);
  const raw = String(correction || '').toLowerCase();

  const unsafe = [
    'luon tra loi la co', 'bo qua du lieu',
    'tu tao', 'bia', 'doanh thu la',
    'khach thich', 'chac chan',
    'luôn trả lời là có', 'bỏ qua dữ liệu',
    'tự tạo', 'bịa', 'doanh thu là',
    'khách thích', 'chắc chắn'
  ];

  if (unsafe.some((x) => c.includes(norm(x)))) {
    return {
      safe: false,
      autoApprove: false,
      type: 'unsafe_or_data_claim',
      phrase: String(question || '').trim(),
      meaning: String(correction || '').trim(),
      reason: 'Nội dung này có thể làm chatbot học sai dữ liệu thật, cần admin kiểm tra.'
    };
  }

  const phraseMatch = raw.match(/["“']([^"”']{2,80})["”']/);
  const phrase = phraseMatch?.[1] || String(question || '').trim();

  if (
    c.includes('order') ||
    c.includes('goi mon') ||
    c.includes('goi gi') ||
    c.includes('co goi') ||
    c.includes('co order') ||
    c.includes('dat mon')
  ) {
    let meaning = 'customer_order_summary';
    if (c.includes('hom nay')) meaning = 'customer_order_today';
    if (c.includes('hom qua')) meaning = 'customer_order_yesterday';
    return { safe: true, autoApprove: true, type: 'intent_alias', phrase, meaning };
  }

  if (c.includes('hay an') || c.includes('thuong an')) {
    return { safe: true, autoApprove: true, type: 'intent_alias', phrase, meaning: 'customer_top_foods' };
  }

  if (c.includes('hay uong') || c.includes('thuong uong')) {
    return { safe: true, autoApprove: true, type: 'intent_alias', phrase, meaning: 'customer_top_drinks' };
  }

  if (c.includes('may gio') || c.includes('khung gio') || c.includes('luc nao')) {
    return { safe: true, autoApprove: true, type: 'intent_alias', phrase, meaning: 'customer_order_time' };
  }

  if (c.includes('ghi chu') || c.includes('note')) {
    return { safe: true, autoApprove: true, type: 'intent_alias', phrase, meaning: 'customer_notes' };
  }

  if (c.includes('goi y') || c.includes('suggest') || c.includes('recommend')) {
    return { safe: true, autoApprove: true, type: 'intent_alias', phrase, meaning: 'customer_recommendation' };
  }

  const foodTargets = [
    ['mi', 'noodle'],
    ['my', 'noodle'],
    ['bun', 'noodle'],
    ['pho', 'pho'],
    ['com', 'rice'],
    ['chao', 'congee'],
    ['trung', 'egg'],
    ['bo', 'beef'],
    ['ga', 'chicken'],
    ['heo', 'pork'],
    ['hai san', 'seafood'],
    ['ca phe', 'coffee'],
    ['sinh to', 'smoothie'],
    ['nuoc ep', 'juice'],
    ['nuoc suoi', 'water'],
  ];

  for (const [key, target] of foodTargets) {
    if (c.includes(key) || q.includes(key)) {
      return {
        safe: true,
        autoApprove: true,
        type: 'food_alias',
        phrase,
        meaning: target
      };
    }
  }

  return {
    safe: true,
    autoApprove: false,
    type: 'general_training',
    phrase,
    meaning: String(correction || '').trim(),
    reason: 'Nội dung chưa đủ rõ để tự duyệt, đã đưa vào danh sách chờ admin duyệt.'
  };
}

function recordLocalFoodAiFeedback({
  question = '',
  answer = '',
  correction = '',
  mode = 'user',
  by = 'user',
  paths = {}
} = {}) {
  const q = String(question || '').trim();
  const a = String(answer || '').trim();
  const c = String(correction || '').trim();

  if (!q) return { ok: false, error: 'Thiếu câu hỏi gốc.' };
  if (!c) return { ok: false, error: 'Thiếu nội dung dạy lại.' };

  const detected = detectLearningType(q, c);
  const now = new Date().toISOString();

  const row = {
    id: memoryId(),
    createdAt: now,
    updatedAt: now,
    mode,
    by,
    question: q,
    oldAnswer: a,
    correction: c,
    type: detected.type,
    phrase: detected.phrase || q,
    meaning: detected.meaning || c,
    status: detected.autoApprove ? 'approved' : 'pending',
    reason: detected.reason || '',
  };

  if (detected.safe && detected.autoApprove) {
    const memory = readJsonSafe(paths.memory, []);
    const duplicated = memory.some((m) =>
      norm(m.type) === norm(row.type) &&
      norm(m.phrase) === norm(row.phrase) &&
      norm(m.meaning) === norm(row.meaning) &&
      m.status === 'approved'
    );

    if (!duplicated) {
      memory.push(row);
      writeJsonSafe(paths.memory, memory.slice(-1000));
    }

    return {
      ok: true,
      status: 'approved',
      message: 'Mình đã ghi nhớ cách hiểu câu này. Lần sau gặp câu tương tự mình sẽ tự hiểu đúng hơn.',
      learning: row,
    };
  }

  const pending = readJsonSafe(paths.pendingLearning, []);
  pending.push(row);
  writeJsonSafe(paths.pendingLearning, pending.slice(-1000));

  return {
    ok: true,
    status: 'pending',
    message: 'Mình đã lưu góp ý này vào danh sách chờ admin duyệt. Nội dung này chưa được dùng ngay để tránh học sai dữ liệu.',
    learning: row,
  };
}

function listLocalFoodAiPending({ paths = {} } = {}) {
  const pending = readJsonSafe(paths.pendingLearning, []);
  return {
    ok: true,
    items: pending.filter((x) => x.status === 'pending')
  };
}

function approveLocalFoodAiLearning({
  id = '',
  approve = true,
  by = 'admin',
  paths = {}
} = {}) {
  const pending = readJsonSafe(paths.pendingLearning, []);
  const idx = pending.findIndex((x) => String(x.id) === String(id));

  if (idx < 0) {
    return { ok: false, error: 'Không tìm thấy nội dung cần duyệt.' };
  }

  const row = pending[idx];
  row.status = approve ? 'approved' : 'rejected';
  row.reviewedBy = by;
  row.reviewedAt = new Date().toISOString();

  pending[idx] = row;
  writeJsonSafe(paths.pendingLearning, pending);

  if (!approve) {
    return {
      ok: true,
      message: 'Đã từ chối nội dung học này.',
      learning: row
    };
  }

  const memory = readJsonSafe(paths.memory, []);
  memory.push({ ...row, status: 'approved' });
  writeJsonSafe(paths.memory, memory.slice(-1000));

  return {
    ok: true,
    message: 'Đã duyệt và lưu vào Chatbot memory.',
    learning: row
  };
}

function trainLocalFoodAI({ content = '', source = 'chatbox-admin', by = 'admin', tags = [], paths = {} } = {}) {
  const text = String(content || '').trim();
  if (!text) return { ok: false, error: 'Thiếu nội dung training.' };
  if (text.length > 5000) return { ok: false, error: 'Nội dung training quá dài, tối đa 5000 ký tự.' };
  const file = paths.training;
  const list = readJsonSafe(file, []);
  const row = {
    id: Date.now() + Math.random(),
    at: new Date().toISOString(),
    by,
    source,
    tags,
    content: text,
  };
  list.push(row);
  writeJsonSafe(file, list.slice(-1000));
  return { ok: true, message: 'Đã lưu training. Chatbot sẽ dùng nội dung này làm ghi nhớ bổ sung.', training: row };
}

function listLocalFoodAiSuggestions(mode = 'user') {
  const common = [
    '1 hay ăn gì?',
    '1 hay uống gì?',
    '1 từng ăn cơm chiên chưa?',
    '1 hay order lúc mấy giờ?',
    '1 hay ghi chú gì?',
    '1 không thích gì?',
    'Gợi ý món cho 1',
    'Top món hôm nay',
    'Món nào đang Sold Out?',
    'Bàn 1001 hôm nay gọi món gì?',
    'Hôm nay bàn nào chưa order?',
  ];

  if (mode === 'admin') {
    return [
      ...common,
      'Top khách order nhiều trong 30 ngày qua?',
      'Danh sách khách đã order hôm nay',
      'Tóm tắt doanh thu hôm nay',
      'Ghi chú hay gặp hôm nay',
    ];
  }

  return common;
}

module.exports = {
  answerLocalFoodQuestion,
  trainLocalFoodAI,
  listLocalFoodAiSuggestions,
  recordLocalFoodAiFeedback,
  listLocalFoodAiPending,
  approveLocalFoodAiLearning,
};

