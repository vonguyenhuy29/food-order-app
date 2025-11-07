// agent.js - Zero-dep ESC/POS agent → chuyển tiếp tới TCP 9100
// Usage:
//   node agent.js --listen 0.0.0.0 --port 9393 --printer 192.168.100.131:9100
//
// Env tuỳ chọn:
//   LINE_WIDTH=48            (độ rộng ký tự mỗi dòng, thường 42-48 cho khổ 80mm, font A, tỉ lệ W=1,H=1~2)
//   QTY_COL=3                (độ rộng cột SL)
//   FEED_BEFORE_CUT=6        (số dòng \n trước khi cắt)
//   CUT_AFTER_FEED=2         (số dòng \n sau khi cắt - vài máy in cần thêm; cũng chấp nhận CUT_AFTER_CUT)
//   LETTER_SPACE=1           (khoảng cách chữ ESC SP n; 0..255)

const http = require('http');
const net  = require('net');
const { URL } = require('url');

function argsToMap() {
  const m = new Map();
  for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i];
    if (a.startsWith('--')) {
      const [k, v] = a.replace(/^--/, '').split('=');
      if (v !== undefined) m.set(k, v);
      else m.set(k, process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[++i] : true);
    }
  }
  return m;
}
const argv = argsToMap();

const LISTEN_HOST  = argv.get('listen') || process.env.LISTEN_HOST || '0.0.0.0';
const LISTEN_PORT  = Number(argv.get('port') || process.env.LISTEN_PORT || 9393);
const PRINTER_HOST = (argv.get('printer') || process.env.PRINTER_HOST || '127.0.0.1').split(':')[0];
const PRINTER_PORT = Number((argv.get('printer') || '').split(':')[1] || process.env.PRINTER_PORT || 9100);

// ===== Layout config (có thể chỉnh bằng ENV) =====
const LINE_WIDTH      = Number(process.env.LINE_WIDTH || 48); // 48 cho 80mm phổ biến (font A, width=1)
const QTY_COL         = Math.max(2, Number(process.env.QTY_COL || 3)); // cột SL
const FEED_BEFORE_CUT = Number(process.env.FEED_BEFORE_CUT || 6);
// Hỗ trợ cả CUT_AFTER_FEED và CUT_AFTER_CUT để tương thích ngược
const CUT_AFTER_CUT   = Number(process.env.CUT_AFTER_CUT || process.env.CUT_AFTER_FEED || 2);
// Khoảng cách chữ (ESC SP n)
const LETTER_SPACE    = Math.max(0, Math.min(255, Number(process.env.LETTER_SPACE || 1)));

// ===== HTTP helpers =====
function ok(res, data = {}) {
  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify({ ok: true, ...data }));
}
function bad(res, code, msg, extra = {}) {
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify({ ok: false, error: msg, ...extra }));
}

// ===== ESC/POS helpers =====
const ESC = '\x1B', GS = '\x1D', LF = '\x0A';
const init     = ESC + '@';
const left     = ESC + 'a' + '\x00';
const center   = ESC + 'a' + '\x01';
const boldOn   = ESC + 'E' + '\x01';
const boldOff  = ESC + 'E' + '\x00';
const cut      = GS  + 'V' + '\x00'; // partial cut (tuỳ máy)

function size(widthMul = 1, heightMul = 2) {
  const w = Math.max(0, Math.min(7, widthMul - 1));
  const h = Math.max(0, Math.min(7, heightMul - 1));
  return GS + '!' + String.fromCharCode((w << 4) | h);
}
function fontA() { return ESC + 'M' + '\x00'; } // Font A (rộng hơn, 48 cột)
function fontB() { return ESC + 'M' + '\x01'; } // Font B (hẹp hơn, 64 cột tuỳ máy)
function charSpace(n = 0) { return ESC + ' ' + String.fromCharCode(Math.max(0, Math.min(255, n))); }

function lineOf(char = '-', width = LINE_WIDTH) {
  return char.repeat(Math.max(0, width)) + LF;
}
function padRight(s, w) {
  s = String(s || '');
  if (s.length >= w) return s.slice(0, w);
  return s + ' '.repeat(w - s.length);
}
function padLeft(s, w) {
  s = String(s || '');
  if (s.length >= w) return s.slice(-w);
  return ' '.repeat(w - s.length) + s;
}
function twoCols(leftText, rightText, width = LINE_WIDTH) {
  const L = String(leftText || '');
  const R = String(rightText || '');
  const space = width - L.length - R.length;
  if (space >= 1) return L + ' '.repeat(space) + R;
  const maxLeft = Math.max(1, width - R.length - 1);
  return L.slice(0, maxLeft) + ' ' + R;
}
function wrapText(s, w) {
  s = String(s || '');
  const out = [];
  for (let i = 0; i < s.length; i += w) out.push(s.slice(i, i + w));
  return out.length ? out : [''];
}
function fmtTime(x) {
  const d = new Date(x || Date.now());
  const pad = n => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth()+1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// Làm sạch tên món: bỏ đuôi ảnh, thay . _ - bằng khoảng trắng, gộp khoảng trắng, trim, in hoa
function cleanFoodName(raw) {
  const s = String(raw || '');
  // 1) Bỏ đuôi ảnh (cuối chuỗi), chấp nhận nhiều loại đuôi + query (nếu có)
  const withoutExt = s.replace(/\.[A-Za-z0-9]{2,5}(\?.*)?$/i, '');
  // 2) Thay . _ - thành khoảng trắng
  const withSpaces = withoutExt.replace(/[._-]+/g, ' ');
  // 3) Gộp khoảng trắng và cắt mép
  const normalized = withSpaces.replace(/\s+/g, ' ').trim();
  // 4) IN HOA
  return normalized.toUpperCase();
}

// ===== Build ticket =====
function buildKitchenTicket(o = {}) {
  const hdrSize  = size(1, 2); // header: cao 2
  const bodySize = size(1, 2); // body: cao 2
  const setFontA = fontA();

  const parts = [];
  parts.push(init, setFontA, left, bodySize);

  // ===== TITLE =====
  parts.push(center, boldOn, hdrSize, 'ORDER' + LF, boldOff, left, bodySize);

  // ===== Meta lines (bold nhãn) =====
  const areaStr  = boldOn + 'Area:'  + boldOff + ' ' + (o.area || '');
  const tableStr = boldOn + 'Table:' + boldOff + ' ' + (o.tableNo || '');
  parts.push(twoCols(areaStr, tableStr, LINE_WIDTH) + LF);

  // Tách Staff và Time ra 2 dòng riêng
  const staffStr = boldOn + 'Staff:' + boldOff + ' ' + (o.staff || '');
  parts.push(staffStr + LF);
  const timeStr  = boldOn + 'Time:'  + boldOff + ' ' + fmtTime(o.createdAt);
  parts.push(timeStr + LF);

  // Member & Customer (tuỳ có dữ liệu)
  if (o.memberCard || o.customerName) {
    const memStr  = boldOn + 'Member:'   + boldOff + ' ' + (o.memberCard || '');
    const custStr = boldOn + 'Customer:' + boldOff + ' ' + (o.customerName || '');
    parts.push(twoCols(memStr, custStr, LINE_WIDTH) + LF);
  }

  // Note (nếu có)
  if (o.note) {
    parts.push(boldOn + 'Note:' + boldOff + ' ' + String(o.note) + LF);
  }

  // ----- line
  parts.push(lineOf('-', LINE_WIDTH));

  // ===== Header items: "SL FOOD"
  const nameCol = Math.max(6, LINE_WIDTH - QTY_COL - 1); // 1 là khoảng trắng giữa cột
  parts.push(boldOn + padLeft('SL', QTY_COL) + ' ' + 'FOOD' + boldOff + LF);

  // Bật chữ đậm + tăng spacing cho phần danh sách món (dễ đọc)
  parts.push(boldOn, charSpace(LETTER_SPACE));

  // Items
  const items = Array.isArray(o.items) ? o.items : [];
  for (const it of items) {
    const qtyStr = padLeft(String(it.qty ?? 1), QTY_COL);
    const name   = cleanFoodName(it.imageName);
    const rows   = wrapText(name, nameCol);
    // dòng 1: qty + name
    parts.push(qtyStr + ' ' + padRight(rows[0], nameCol) + LF);
    // các dòng tiếp theo: chừa chỗ cột SL
    for (let i = 1; i < rows.length; i++) {
      parts.push(' '.repeat(QTY_COL) + ' ' + padRight(rows[i], nameCol) + LF);
    }
  }

  // Tắt spacing + đậm sau phần items
  parts.push(charSpace(0), boldOff);

  // khoảng trống rồi cắt
  parts.push(LF.repeat(FEED_BEFORE_CUT), cut, LF.repeat(CUT_AFTER_CUT));

  return parts.join('');
}

// ===== TCP send =====
function sendRawToPrinter(rawBuffer) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: PRINTER_HOST, port: PRINTER_PORT }, () => {
      socket.write(rawBuffer);
      socket.end();
    });
    socket.setTimeout(8000);
    socket.on('timeout', () => { socket.destroy(); reject(new Error('Printer timeout')); });
    socket.on('error', (e) => reject(e));
    socket.on('close', () => resolve());
  });
}

// ===== HTTP handlers =====
function handlePrint(req, res, body) {
  try {
    const parsed = JSON.parse(body || '{}');

    if (parsed.rawBase64) {
      const buf = Buffer.from(parsed.rawBase64, 'base64');
      return sendRawToPrinter(buf)
        .then(() => ok(res))
        .catch((e) => bad(res, 500, 'Print failed', { reason: e.message }));
    }

    if (parsed.order) {
      const data = buildKitchenTicket(parsed.order);
      const buf = Buffer.from(data, 'binary');
      return sendRawToPrinter(buf)
        .then(() => ok(res))
        .catch((e) => bad(res, 500, 'Print failed', { reason: e.message }));
    }

    return bad(res, 400, 'Invalid payload');
  } catch (e) {
    return bad(res, 400, 'Bad JSON', { reason: e.message });
  }
}

function handleDetect(req, res) {
  const s = net.createConnection({ host: PRINTER_HOST, port: PRINTER_PORT });
  let done = false;
  const finish = (online, reason) => {
    if (done) return; done = true;
    try { s.destroy(); } catch {}
    ok(res, { online, printer: { host: PRINTER_HOST, port: PRINTER_PORT }, reason });
  };
  s.setTimeout(1500);
  s.on('connect', () => finish(true));
  s.on('timeout', () => finish(false, 'timeout'));
  s.on('error', (e) => finish(false, e.message));
}

function handleCors(req, res) {
  res.writeHead(204, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end();
}

// ===== Server =====
const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') return handleCors(req, res);

  const url = new URL(req.url, `http://${req.headers.host}`);
  if (req.method === 'GET' && url.pathname === '/health') {
    return ok(res, {
      status: 'ok',
      printer: { host: PRINTER_HOST, port: PRINTER_PORT },
      lineWidth: LINE_WIDTH,
      qtyCol: QTY_COL
    });
  }
  if (req.method === 'GET' && url.pathname === '/detect') {
    return handleDetect(req, res);
  }
  if (req.method === 'POST' && url.pathname === '/print') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => handlePrint(req, res, body));
    return;
  }

  bad(res, 404, 'Not found');
});

server.listen(LISTEN_PORT, LISTEN_HOST, () => {
  console.log(`✅ Print agent listening on http://${LISTEN_HOST}:${LISTEN_PORT}`);
  console.log(`➡️  Forwarding to printer ${PRINTER_HOST}:${PRINTER_PORT}`);
  console.log(`ℹ️  LINE_WIDTH=${LINE_WIDTH}, QTY_COL=${QTY_COL}, FEED_BEFORE_CUT=${FEED_BEFORE_CUT}, CUT_AFTER=${CUT_AFTER_CUT}, LETTER_SPACE=${LETTER_SPACE}`);
});
