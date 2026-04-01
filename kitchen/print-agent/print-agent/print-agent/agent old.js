// agent.js - Zero-dep ESC/POS agent → chuyển tiếp tới TCP 9100
// Usage:
//   node agent.js --listen 0.0.0.0 --port 9393 --printer 192.168.100.131:9100
//
// ENV tùy chọn:
//   LINE_WIDTH=48  | QTY_COL=3 | FEED_BEFORE_CUT=6 | CUT_AFTER_CUT=2 | LETTER_SPACE=1

'use strict';

const http = require('http');
const net  = require('net');
const { URL } = require('url');

/* ================= CLI & ENV ================= */
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

const LINE_WIDTH      = Number(process.env.LINE_WIDTH || 48);       // 48 cho 80mm (font A)
const QTY_COL         = Math.max(2, Number(process.env.QTY_COL || 3));
const FEED_BEFORE_CUT = Number(process.env.FEED_BEFORE_CUT || 6);
const CUT_AFTER_CUT   = Number(process.env.CUT_AFTER_CUT || process.env.CUT_AFTER_FEED || 2);
const LETTER_SPACE    = Math.max(0, Math.min(255, Number(process.env.LETTER_SPACE || 1)));

/* ================ HTTP helpers ================ */
function ok(res, data = {}) {
  res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify({ ok: true, ...data }));
}
function bad(res, code, msg, extra = {}) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify({ ok: false, error: msg, ...extra }));
}

/* ================ ESC/POS helpers ================ */
const ESC = '\x1b';
const GS  = '\x1d';
const LF  = '\n';

const init     = ESC + '@';
const left     = ESC + 'a' + '\x00';
const center   = ESC + 'a' + '\x01';
const boldOn   = ESC + 'E' + '\x01';
const boldOff  = ESC + 'E' + '\x00';
const cut      = GS  + 'V' + '\x00'; // partial cut (tùy máy)

// Helper: remove diacritical marks (accents) from Vietnamese and other accented characters.
// Many ESC/POS printers do not support Unicode, so we convert to simple ASCII.
function removeAccents(str = '') {
  try {
    return String(str)
      // Normalize to decompose accents
      .normalize('NFD')
      // Remove combining diacritical marks
      .replace(/[\u0300-\u036f]/g, '')
      // Replace specific Vietnamese letters
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'D');
  } catch {
    return str;
  }
}

function size(widthMul = 1, heightMul = 2) {
  const w = Math.max(0, Math.min(7, widthMul - 1));
  const h = Math.max(0, Math.min(7, heightMul - 1));
  return GS + '!' + String.fromCharCode((w << 4) | h);
}
function fontA() { return ESC + 'M' + '\x00'; } // Font A (48 cột)
function fontB() { return ESC + 'M' + '\x01'; } // Font B (hẹp hơn)
function charSpace(n = 0) { // ESC SP n — giãn chữ
  return ESC + ' ' + String.fromCharCode(Math.max(0, Math.min(255, n)));
}
function lineOf(char = '-', width = LINE_WIDTH) { return char.repeat(Math.max(0, width)) + LF; }
function padRight(s, w) { s = String(s || ''); return s.length >= w ? s.slice(0, w) : s + ' '.repeat(w - s.length); }
function padLeft(s, w)  { s = String(s || ''); return s.length >= w ? s.slice(-w) : ' '.repeat(w - s.length) + s; }
function twoCols(L, R, width = LINE_WIDTH) {
  L = String(L || ''); R = String(R || '');
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

// Làm sạch tên món
function cleanFoodName(raw) {
  const s = String(raw || '');
  const withoutExt = s.replace(/\.[A-Za-z0-9]{2,5}(\?.*)?$/i, '');
  const withSpaces = withoutExt.replace(/[._-]+/g, ' ');
  const normalized = withSpaces.replace(/\s+/g, ' ').trim();
  return normalized.toUpperCase();
}

function getCustomerDisplay(o = {}) {
  const code = o.memberCard || (o.customer && o.customer.code) || o.customer_code || '';
  const name = o.customerName || (o.customer && o.customer.name) || o.customer_full_name || '';
  if (code && name) return `${code} - ${name}`;
  if (code) return `${code}`;
  if (name) return `${name}`;
  return '';
}

// >>> REPLACE/ADD HELPERS <<<

// Suy mã hàng từ imageName/imageKey: C2.WONTON-NOODLES.jpg -> C02
function extractProductCodeFromName(name = '') {
  const base = String(name).replace(/\.[A-Za-z0-9]{2,5}(\?.*)?$/i, '');
  const m = base.match(/^([A-Za-z]+)(\d{1,3})/); // ví dụ C + 2
  if (!m) return '';
  const letters = m[1].toUpperCase();
  const num     = m[2].padStart(2, '0');        // 2 chữ số: 1 -> 01
  return letters + num;
}

function getItemCode(it = {}) {
  // 1) Ưu tiên dùng productCode / code nếu backend đã gửi đúng
  const direct = it.productCode || it.code;
  if (direct) return String(direct).toUpperCase();

  // 2) Nếu không có, thử đoán từ tên file / key
  const guess = extractProductCodeFromName(
    it.imageName || it.imageKey || it.name || ''
  );
  return guess ? guess.toUpperCase() : '';
}



// In dòng 3 cột có vạch dọc: SL | FOOD | CODE (tự wrap)
function row3(sl, food, code, lineWidth) {
  const wSL   = Math.max(QTY_COL, 2);
  const wCode = 10;
  const wFood = Math.max(8, lineWidth - wSL - wCode - 6); // 6 ký tự cho " | " x2
  const wrap = (s, w) => {
    const lines = [];
    String(s || '').split('\n').forEach(chunk => {
      let t = chunk;
      while (t.length > w) { lines.push(t.slice(0, w)); t = t.slice(w); }
      lines.push(t);
    });
    return lines;
  };
  const a = wrap(sl,   wSL);
  const b = wrap(food, wFood);
  const c = wrap(code, wCode);
  const rows = Math.max(a.length, b.length, c.length);
  let out = '';
  for (let i = 0; i < rows; i++) {
    const s1 = (a[i]||'').padEnd(wSL,' ');
    const s2 = (b[i]||'').padEnd(wFood,' ');
    const s3 = (c[i]||'').padEnd(wCode,' ');
    out += `${s1} | ${s2} | ${s3}${LF}`;
  }
  return out;
}

function buildKitchenTicket(o = {}) {
  const setFontA   = fontA();

  // Style chính
  const normalSize = size(1, 1); // body bình thường, gọn dễ đọc
  const metaSize   = size(1, 1);
  const focusSize  = size(1, 2); // Staff / Customer nổi bật
  const titleSize  = size(2, 2); // ORDER to rõ

  const parts = [];

  parts.push(init, setFontA, left, normalSize);

  // ===== TITLE =====
  parts.push(
    center +
    boldOn +
    charSpace(1) +
    titleSize +
    'ORDER' +
    normalSize +
    charSpace(0) +
    boldOff +
    LF
  );

  parts.push(left);

  // ===== META =====
  parts.push(metaSize);

  parts.push(
    boldOn + 'Area: ' + boldOff + String(o.area || '') + LF
  );

  parts.push(
    boldOn + 'Table: ' + boldOff + String(o.tableNo || '') + LF
  );

  parts.push(
    boldOn + 'Time: ' + boldOff + fmtTime(o.createdAt) + LF
  );

// Staff: ghép mã và tên, in đậm, size lớn. Convert to ASCII to avoid printer font issues.
// Staff: ghép mã và tên, bỏ dấu, viết hoa
{
  const codeRaw = String(o.staff || '').trim();
  const nameRaw = String(o.staffName || '').trim();
  const staffCode = removeAccents(codeRaw).toUpperCase();
  const staffName = removeAccents(nameRaw).toUpperCase();
  const staffText = staffCode ? (staffName ? `${staffCode} - ${staffName}` : staffCode) : '';
  if (staffText) {
    parts.push(
      boldOn + focusSize + 'STAFF: ' + staffText + normalSize + boldOff + LF
    );
  }
}

// Customer: ghép mã và tên, bỏ dấu, viết hoa
{
  const raw = getCustomerDisplay(o); // trả về "code - name" nếu có cả hai
  if (raw) {
    const custText = removeAccents(String(raw).trim()).toUpperCase();
    parts.push(
      boldOn + focusSize + 'CUSTOMER: ' + custText + normalSize + boldOff + LF
    );
  }
}

  if (o.note) {
    parts.push(
      boldOn + 'Note: ' + boldOff + String(o.note).trim() + LF
    );
  }

  parts.push(lineOf('-', LINE_WIDTH));

  // ===== HEADER BẢNG =====
  parts.push(
    boldOn + 'SL' + boldOff + ' | ' +
    boldOn + 'FOOD' + boldOff + ' | ' +
    boldOn + 'CODE' + boldOff + LF
  );
  parts.push(lineOf('-', LINE_WIDTH));

  // ===== ITEMS =====
  const items = Array.isArray(o.items) ? o.items : [];

  for (let i = 0; i < items.length; i++) {
    const it   = items[i] || {};
    const qty  = String(it.qty ?? 1);
const nameRaw = cleanFoodName(it.name || it.imageName || it.imageKey);
const name    = removeAccents(nameRaw);
let note = it.note ? `Note: ${String(it.note).trim()}` : '';
if (note) note = removeAccents(note);
const code = getItemCode(it);

// ghép tên + note
const foodBlock = `${name}${note ? LF + note : ''}`;

// In đậm và font cao hơn
parts.push(boldOn);
parts.push(focusSize);
parts.push(row3(qty, foodBlock, code, LINE_WIDTH));
parts.push(normalSize);
parts.push(boldOff);
parts.push(lineOf('-', LINE_WIDTH));
  }

  parts.push(LF.repeat(FEED_BEFORE_CUT), cut, LF.repeat(CUT_AFTER_CUT));
  return parts.join('');
}


/* ================ TCP send ================ */
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

/* ================ HTTP handlers ================ */
function handlePrint(_req, res, body) {
  try {
    const parsed = JSON.parse(body || '{}');

    if (parsed.rawBase64) {
      const buf = Buffer.from(parsed.rawBase64, 'base64');
      return sendRawToPrinter(buf).then(() => ok(res)).catch(e => bad(res, 500, 'Print failed', { reason: e.message }));
    }
    if (parsed.order) {
      const data = buildKitchenTicket(parsed.order);
      const buf = Buffer.from(data, 'binary');
      return sendRawToPrinter(buf).then(() => ok(res)).catch(e => bad(res, 500, 'Print failed', { reason: e.message }));
    }
    return bad(res, 400, 'Invalid payload');
  } catch (e) {
    return bad(res, 400, 'Bad JSON', { reason: e.message });
  }
}
function handleDetect(_req, res) {
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
function handleCors(_req, res) {
  res.writeHead(204, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end();
}

/* ================ Server ================ */
const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') return handleCors(req, res);

  const url = new URL(req.url, `http://${req.headers.host}`);
  if (req.method === 'GET'  && url.pathname === '/health')  return ok(res, { status: 'ok', printer: { host: PRINTER_HOST, port: PRINTER_PORT }, lineWidth: LINE_WIDTH, qtyCol: QTY_COL });
  if (req.method === 'GET'  && url.pathname === '/detect')  return handleDetect(req, res);
  if (req.method === 'POST' && url.pathname === '/print')   {
    let body = ''; req.on('data', (c) => (body += c)); req.on('end', () => handlePrint(req, res, body)); return;
  }
  bad(res, 404, 'Not found');
});

server.listen(LISTEN_PORT, LISTEN_HOST, () => {
  console.log(`✅ Print agent listening on http://${LISTEN_HOST}:${LISTEN_PORT}`);
  console.log(`➡️  Forwarding to printer ${PRINTER_HOST}:${PRINTER_PORT}`);
  console.log(`ℹ️  LINE_WIDTH=${LINE_WIDTH}, QTY_COL=${QTY_COL}, FEED_BEFORE_CUT=${FEED_BEFORE_CUT}, CUT_AFTER=${CUT_AFTER_CUT}, LETTER_SPACE=${LETTER_SPACE}`);
});
