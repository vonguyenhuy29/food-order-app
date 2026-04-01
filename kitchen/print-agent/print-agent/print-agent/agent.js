'use strict';

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, exec } = require('child_process');
const net = require('net');

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

const LISTEN_HOST = argv.get('listen') || process.env.LISTEN_HOST || '0.0.0.0';
const LISTEN_PORT = Number(argv.get('port') || process.env.LISTEN_PORT || 9393);

// html | raw
const PRINT_MODE = String(process.env.PRINT_MODE || 'html').toLowerCase();

// raw only
const PRINTER_HOST = (argv.get('printer') || process.env.PRINTER_HOST || '127.0.0.1').split(':')[0];
const PRINTER_PORT = Number((argv.get('printer') || '').split(':')[1] || process.env.PRINTER_PORT || 9100);

const LINE_WIDTH = Number(process.env.LINE_WIDTH || 48);
const QTY_COL = Math.max(2, Number(process.env.QTY_COL || 3));

/* ================ HTTP helpers ================ */
function ok(res, data = {}) {
  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(JSON.stringify({ ok: true, ...data }));
}

function bad(res, code, msg, extra = {}) {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(JSON.stringify({ ok: false, error: msg, ...extra }));
}

/* ================ Shared helpers ================ */
function escHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function padRight(s, w) {
  s = String(s || '');
  return s.length >= w ? s.slice(0, w) : s + ' '.repeat(w - s.length);
}

function padLeft(s, w) {
  s = String(s || '');
  return s.length >= w ? s.slice(-w) : ' '.repeat(w - s.length) + s;
}

function wrapText(s, w) {
  s = String(s || '');
  const out = [];
  for (let i = 0; i < s.length; i += w) out.push(s.slice(i, i + w));
  return out.length ? out : [''];
}

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

function fmtTime12(x) {
  const d = new Date(x || Date.now());
  const pad = n => String(n).padStart(2, '0');
  let hh = d.getHours();
  const ampm = hh >= 12 ? 'PM' : 'AM';
  hh = hh % 12;
  if (hh === 0) hh = 12;
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(hh)}:${pad(d.getMinutes())}:${pad(d.getSeconds())} ${ampm}`;
}

// product code guess giống agent cũ
function extractProductCodeFromName(name = '') {
  const base = String(name).replace(/\.[A-Za-z0-9]{2,5}(\?.*)?$/i, '');
  const m = base.match(/^([A-Za-z]+)(\d{1,3})/);
  if (!m) return '';
  const letters = m[1].toUpperCase();
  const num = m[2].padStart(2, '0');
  return letters + num;
}

function getItemCode(it = {}) {
  const direct = it.productCode || it.code;
  if (direct) return String(direct).toUpperCase();

  const guess = extractProductCodeFromName(
    it.imageName || it.imageKey || it.name || ''
  );
  return guess ? guess.toUpperCase() : '';
}

/* ================ RAW layout helpers (kept for fallback/raw mode) ================ */
function row3Text(sl, food, code, lineWidth = LINE_WIDTH) {
  const wSL = Math.max(QTY_COL, 2);
  const wCode = 10;
  const wFood = Math.max(8, lineWidth - wSL - wCode - 6);

  const wrap = (s, w) => {
    const lines = [];
    String(s || '').split('\n').forEach(chunk => {
      let t = chunk;
      while (t.length > w) {
        lines.push(t.slice(0, w));
        t = t.slice(w);
      }
      lines.push(t);
    });
    return lines.length ? lines : [''];
  };

  const a = wrap(sl, wSL);
  const b = wrap(food, wFood);
  const c = wrap(code, wCode);

  const rows = Math.max(a.length, b.length, c.length);
  let out = '';
  for (let i = 0; i < rows; i++) {
    const s1 = (a[i] || '').padEnd(wSL, ' ');
    const s2 = (b[i] || '').padEnd(wFood, ' ');
    const s3 = (c[i] || '').padEnd(wCode, ' ');
    out += `${s1} | ${s2} | ${s3}\r\n`;
  }
  return out;
}

function buildKitchenTicketText(o = {}) {
  const parts = [];

  parts.push('ORDER\r\n');
  parts.push('\r\n');

  parts.push(`Area: ${String(o.area || '')}\r\n`);
  parts.push(`Table: ${String(o.tableNo || '')}\r\n`);
  parts.push(`Time: ${fmtTime12(o.createdAt)}\r\n`);

  const staffCode = String(o.staff || '').trim();
  const staffName = String(o.staffName || '').trim();
  const staffText = staffCode ? (staffName ? `${staffCode} - ${staffName}` : staffCode) : '';
  if (staffText) parts.push(`STAFF: ${staffText}\r\n`);

  const customerText = getCustomerDisplay(o);
  if (customerText) parts.push(`CUSTOMER: ${customerText}\r\n`);

  if (o.note) parts.push(`Note: ${String(o.note).trim()}\r\n`);

  parts.push('-'.repeat(LINE_WIDTH) + '\r\n');
  parts.push(`SL${' '.repeat(Math.max(0, QTY_COL - 2))} | FOOD${' '.repeat(Math.max(0, LINE_WIDTH - QTY_COL - 3 - 4 - 10))} | CODE\r\n`);
  parts.push('-'.repeat(LINE_WIDTH) + '\r\n');

  const items = Array.isArray(o.items) ? o.items : [];
  for (const it of items) {
    const qty = String(it.qty ?? 1);
    const name = cleanFoodName(it.name || it.imageName || it.imageKey);
    const code = getItemCode(it);
    const note = it.note ? `Note: ${String(it.note).trim()}` : '';
    const foodBlock = `${name}${note ? '\r\n' + note : ''}`;

    parts.push(row3Text(qty, foodBlock, code, LINE_WIDTH));
    parts.push('-'.repeat(LINE_WIDTH) + '\r\n');
  }

  parts.push('\r\n\r\n');
  return parts.join('');
}

/* ================ HTML bill based on old agent layout ================ */
function buildKitchenTicketHtml(o = {}) {
  const staffCode = String(o.staff || '').trim();
  const staffName = String(o.staffName || '').trim();
  const staffText = staffCode ? (staffName ? `${staffCode} - ${staffName}` : staffCode) : '';
  const customerText = getCustomerDisplay(o);
  const timeText = fmtTime12(o.createdAt);

  const items = Array.isArray(o.items) ? o.items : [];

  const rows = items.map((it) => {
    const qty = String(it.qty ?? 1);
    const name = cleanFoodName(it.name || it.imageName || it.imageKey);
    const code = getItemCode(it);
    const note = it.note ? String(it.note).trim() : '';

    return `
      <div class="item-wrap">
        <div class="item-row">
          <div class="col-sl">${escHtml(qty)}</div>
          <div class="col-food">${escHtml(name)}</div>
          <div class="col-code">${escHtml(code)}</div>
        </div>
        ${note ? `<div class="item-note">Note: ${escHtml(note)}</div>` : ''}
        <div class="sep"></div>
      </div>
    `;
  }).join('');

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Order ${escHtml(String(o.id || ''))}</title>
  <style>
    @page {
      size: 72mm auto;
      margin: 2mm 2mm 2mm 2mm;
    }

    html, body {
      margin: 0;
      padding: 0;
      background: #fff;
      color: #000;
      width: 72mm;
      font-family: "Segoe UI", Arial, sans-serif;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    body {
      padding: 0.5mm 1mm 0.5mm 1mm;
      box-sizing: border-box;
      font-size: 11px;
      line-height: 1.2;
    }

    .ticket {
      width: 100%;
      margin: 0;
      padding: 0;
    }

    .title {
      text-align: center;
      font-weight: 800;
      font-size: 18px;
      letter-spacing: 0.4px;
      margin: 0 0 3px 0;
    }

    .meta {
      margin: 0 0 1px 0;
      font-size: 11px;
    }

    .focus {
      font-weight: 400;
      font-size: 13px;
      margin: 1px 0;
      text-transform: uppercase;
    }

    .note {
      margin-top: 2px;
      font-size: 12px;
      font-weight: 700;
    }

    .sep {
      border-top: 1px dashed #000;
      margin: 4px 0;
      height: 0;
    }

    .head-row,
    .item-row {
      display: grid;
      grid-template-columns: 18px 1fr 36px;
      column-gap: 6px;
      align-items: start;
      width: 100%;
    }

    .head-row {
      font-weight: 700;
      font-size: 11px;
    }

    .item-row {
      font-weight: 800;
      font-size: 15px;
    }

    .col-sl {
      text-align: left;
      white-space: nowrap;
    }

    .col-food {
      text-align: left;
      word-break: break-word;
      overflow-wrap: anywhere;
    }

    .col-code {
      text-align: right;
      white-space: nowrap;
      font-weight: 400;
    }

    .item-note {
      margin: 2px 0 0 24px;
      font-size: 12px;
    }

    .spacer {
      height: 4mm;
    }
  </style>
</head>
<body onload="window.print(); setTimeout(() => window.close(), 400);">
  <div class="ticket">
    <div class="title">ORDER</div>

    <div class="meta">Area: ${escHtml(String(o.area || ''))}</div>
    <div class="meta">Table: ${escHtml(String(o.tableNo || ''))}</div>
    <div class="meta">Time: ${escHtml(timeText)}</div>

    ${staffText ? `<div class="focus">STAFF: ${escHtml(staffText)}</div>` : ''}
    ${customerText ? `<div class="focus">CUSTOMER: ${escHtml(customerText)}</div>` : ''}
    ${o.note ? `<div class="note">Note: ${escHtml(String(o.note).trim())}</div>` : ''}

    <div class="sep"></div>

    <div class="head-row">
      <div class="col-sl">SL</div>
      <div class="col-food">FOOD</div>
      <div class="col-code">CODE</div>
    </div>

    <div class="sep"></div>

    ${rows}

    <div class="spacer"></div>
  </div>
</body>
</html>`;
}

/* ================ RAW mode ================ */
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

/* ================ Browser print helpers ================ */
function getDefaultPrinterName() {
  return new Promise((resolve) => {
    const cmd = 'powershell -NoProfile -Command "(Get-CimInstance Win32_Printer | Where-Object {$_.Default -eq $true} | Select-Object -ExpandProperty Name)"';
    exec(cmd, { windowsHide: true }, (err, stdout) => {
      if (err) return resolve('');
      resolve(String(stdout || '').trim());
    });
  });
}

function findBrowserExecutable() {
  const candidates = [
    process.env.PRINT_BROWSER_PATH,
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ].filter(Boolean);

  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {}
  }
  return '';
}

function printHtmlViaBrowser(html) {
  return new Promise((resolve, reject) => {
    const browser = findBrowserExecutable();
    if (!browser) {
      return reject(new Error('Không tìm thấy Microsoft Edge hoặc Google Chrome. Có thể đặt PRINT_BROWSER_PATH.'));
    }

    const tmpDir = path.join(os.tmpdir(), 'food-print-agent');
    fs.mkdirSync(tmpDir, { recursive: true });

    const base = `ticket-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const htmlFile = path.join(tmpDir, `${base}.html`);
    const userDataDir = path.join(tmpDir, `${base}-profile`);

    try {
      fs.writeFileSync(htmlFile, html, { encoding: 'utf8' });
      fs.mkdirSync(userDataDir, { recursive: true });
    } catch (e) {
      return reject(e);
    }

    const fileUrl = 'file:///' + htmlFile.replace(/\\/g, '/');

    const args = [
      '--kiosk-printing',
      `--user-data-dir=${userDataDir}`,
      '--no-first-run',
      '--disable-session-crashed-bubble',
      '--disable-features=Translate,msEdgeSidebarV2',
      `--app=${fileUrl}`,
    ];

    const child = spawn(browser, args, {
      windowsHide: true,
      detached: false,
      stdio: 'ignore'
    });

    let finished = false;

    const cleanup = () => {
      setTimeout(() => {
        try { fs.unlinkSync(htmlFile); } catch (_) {}
        try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch (_) {}
      }, 8000);
    };

    const done = (err) => {
      if (finished) return;
      finished = true;
      cleanup();
      if (err) reject(err);
      else resolve();
    };

    child.on('error', (e) => done(e));

    // chờ trình duyệt load + in + tự đóng
    const timeout = setTimeout(() => {
      try { child.kill(); } catch (_) {}
      done(null);
    }, 8000);

    child.on('close', () => {
      clearTimeout(timeout);
      done(null);
    });
  });
}

/* ================ HTTP handlers ================ */
async function handlePrint(_req, res, body) {
  try {
    const parsed = JSON.parse(body || '{}');

    if (PRINT_MODE === 'raw') {
      if (parsed.rawBase64) {
        const buf = Buffer.from(parsed.rawBase64, 'base64');
        await sendRawToPrinter(buf);
        return ok(res, { mode: 'raw' });
      }
      if (parsed.order) {
        const text = buildKitchenTicketText(parsed.order);
        const buf = Buffer.from(text, 'utf8');
        await sendRawToPrinter(buf);
        return ok(res, { mode: 'raw' });
      }
      return bad(res, 400, 'Invalid payload');
    }

    // html mode
    if (parsed.order) {
      const html = buildKitchenTicketHtml(parsed.order);
      await printHtmlViaBrowser(html);
      return ok(res, { mode: 'html' });
    }

    if (parsed.html) {
      await printHtmlViaBrowser(String(parsed.html));
      return ok(res, { mode: 'html' });
    }

    return bad(res, 400, 'Invalid payload');
  } catch (e) {
    return bad(res, 500, 'Print failed', { reason: e.message || String(e) });
  }
}

/* ================ Server ================ */
const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    return res.end();
  }

  if (req.method === 'GET' && req.url === '/health') {
    const defaultPrinter = PRINT_MODE === 'html' ? await getDefaultPrinterName() : '';
    return ok(res, {
      mode: PRINT_MODE,
      defaultPrinter,
      browser: PRINT_MODE === 'html' ? findBrowserExecutable() : undefined,
      printerHost: PRINT_MODE === 'raw' ? PRINTER_HOST : undefined,
      printerPort: PRINT_MODE === 'raw' ? PRINTER_PORT : undefined,
      lineWidth: LINE_WIDTH,
      qtyCol: QTY_COL
    });
  }

  if (req.method === 'GET' && req.url === '/detect') {
    const defaultPrinter = await getDefaultPrinterName();
    return ok(res, {
      mode: PRINT_MODE,
      defaultPrinter,
      browser: findBrowserExecutable()
    });
  }

  if (req.method === 'POST' && req.url === '/print') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => handlePrint(req, res, body));
    return;
  }

  if (req.method === 'GET' && req.url === '/') {
    return ok(res, { message: 'Food print agent is running', mode: PRINT_MODE });
  }

  return bad(res, 404, 'Not found');
});

server.listen(LISTEN_PORT, LISTEN_HOST, async () => {
  const defaultPrinter = PRINT_MODE === 'html' ? await getDefaultPrinterName() : '';
  console.log(`✅ Print agent listening on http://${LISTEN_HOST}:${LISTEN_PORT}`);
  console.log(`➡️  Mode: ${PRINT_MODE}`);
  if (PRINT_MODE === 'html') {
    console.log(`🖨️  Default printer: ${defaultPrinter || '(not found)'}`);
    console.log(`🌐 Browser: ${findBrowserExecutable() || '(not found)'}`);
  } else {
    console.log(`➡️  Forwarding to printer ${PRINTER_HOST}:${PRINTER_PORT}`);
  }
  console.log(`ℹ️  LINE_WIDTH=${LINE_WIDTH}, QTY_COL=${QTY_COL}`);
});