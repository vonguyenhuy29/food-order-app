/**
 * AdminFoodList.jsx — Admin/Kitchen (NO QZ TRAY)
 * In 3 bước:
 *   1) Print Agent (HTTP) — tự dò IP/host
 *   2) Fallback: print dialog của trình duyệt
 *
 * Env (tùy chọn):
 *   - REACT_APP_API_URL            : base URL cho backend
 *   - REACT_APP_PRINT_AGENT_URL    : URL cố định cho agent (nếu muốn)
 *   - REACT_APP_AGENT_PORT         : mặc định 9393
 */

import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import ManageProductsModal from './ManageProducts.jsx';
import AIChatBox from './AIChatBox.jsx';
import io from 'socket.io-client';
import axios from 'axios';

// SAFE_CLEANUP_PHASE2D_20260913
// ===== Limit concurrent axios requests to avoid net::ERR_INSUFFICIENT_RESOURCES =====
const MAX_CONCURRENT = 4;
let __axios_pending = 0;
const __axios_queue = [];

function __axios_release() {
  const next = __axios_queue.shift();
  if (next) next();
}

function __axios_done() {
  __axios_pending = Math.max(0, __axios_pending - 1);
  __axios_release();
}

axios.interceptors.request.use(async (config) => {
  if (__axios_pending >= MAX_CONCURRENT) {
    await new Promise((res) => __axios_queue.push(res));
  }
  __axios_pending++;
  return config;
});

const AUTH_STORAGE_KEY = 'auth';
const LEGACY_TOKEN_KEY = 'food-admin-token';
let __authExpiredNotified = false;

function dispatchAuthExpired(message = 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại để tiếp tục sử dụng app.') {
  if (__authExpiredNotified) return;

  __authExpiredNotified = true;

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('food-auth-expired', {
      detail: { message },
    }));
  }
}

function notifyAuthExpired(error) {
  const url = String(error?.config?.url || '');

  // Đăng nhập sai cũng trả 401, không được xem là hết hạn phiên.
  if (url.includes('/api/login')) return;

  dispatchAuthExpired();
}

function getJwtExpirationMs(token) {
  try {
    const payloadPart = String(token || '').split('.')[1];
    if (!payloadPart) return null;

    const normalized = payloadPart.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(normalized.length + ((4 - normalized.length % 4) % 4), '=');
    const payload = JSON.parse(atob(padded));

    return payload?.exp ? Number(payload.exp) * 1000 : null;
  } catch {
    return null;
  }
}

axios.interceptors.response.use(
  (res) => {
    __axios_done();
    return res;
  },
  (error) => {
    __axios_done();
    const status = error?.response?.status;

    if (status === 401) {
      notifyAuthExpired(error);
    }

    return Promise.reject(error);
  }
);





// ===== API & Socket =====
const API =
  process.env.REACT_APP_API_URL ||
  process.env.REACT_APP_API_BASE ||
  '';
const socketOptions = {
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 500,
  reconnectionDelayMax: 5000,
  randomizationFactor: 0.5,
  timeout: 20000,
  transports: ['polling', 'websocket'],
  upgrade: true,
};

const socket = API ? io(API, socketOptions) : io(socketOptions);

const apiUrl = (p) => `${API || ''}${p}`;
const resolveImg = (u) => {
  if (!u) return '';
  if (/^https?:\/\//i.test(u)) return u;         // đã absolute
  const base = API || '';
  if (!base && u.startsWith('/')) return u;      // cùng origin (dev)
  return u.startsWith('/') ? `${base}${u}` : `${base}/${u}`;
};
function setAuthHeader(token) {
  if (token) axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
  else delete axios.defaults.headers.common['Authorization'];
}

const SOLD_OUT_MENU = 'Sold out';
const SOLD_OUT_KEY = '__SOLD_OUT__';

// --- Helper: kiểm tra ảnh gốc có trong thư mục SOURCE chưa
// Ưu tiên HEAD tới /images/SOURCE/<file>, fallback GET blob, cuối cùng thử API /api/source/exists


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

const ALL_LEVELS = ['P', 'I-I+', 'V-One'];

// ==== Orders constants
const ORDER_STATUS = {
  PENDING: 'PENDING',
  IN_PROGRESS: 'IN_PROGRESS',
  DONE: 'DONE',
  CANCELLED: 'CANCELLED',
};
const ORDER_FILTERS = ['OPEN', 'PENDING', 'IN_PROGRESS', 'DONE', 'CANCELLED', 'ALL'];

const getImageName = (url) => {
  const raw = String(url || '').trim();
  if (!raw) return '';

  // Chuẩn hóa cùng cách với trang User: bỏ query/hash, decode URL và so sánh không phân biệt hoa/thường.
  const cleanPath = raw.split(/[?#]/)[0];
  const lastPart = cleanPath.split('/').pop() || '';

  try {
    return decodeURIComponent(lastPart).trim().toLowerCase();
  } catch {
    return lastPart.trim().toLowerCase();
  }
};
const tableKeyOf = (area, tableNo) => `${area}#${tableNo}`;
const tableStatusTextOf = (o) => o?.tableClosed ? 'Done (thu bàn)' : 'Pending';
const tableStatusColorOf = (o) => o?.tableClosed ? '#16a34a' : '#f59e0b';

const FLOORLENS_STATION_LABELS = {
  TECH: 'Tech',
  PIT14: 'PIT 14',
  PIT15: 'PIT 15',
  PIT33: 'PIT 33',
  PIT2F: 'PIT 2F',
  RECEPTION1: 'Reception 1',
  RECEPTION2: 'Reception 2',
  BC1: 'BC1',
  BC2: 'BC2',
  CENTER3022: 'Center',
};
const normalizeFloorlensStationCode = (value) => String(value == null ? '' : value).trim().toUpperCase().replace(/[\s_-]+/g, '');
const floorlensStationLabelOf = (value) => {
  const raw = normalizeFloorlensStationCode(value);
  if (!raw) return '';
  const aliases = { CENTER: 'CENTER3022' };
  const normalized = aliases[raw] || raw;
  return FLOORLENS_STATION_LABELS[normalized] || String(value || '').trim();
};
const renderOrderIpadLine = (o, style = {}) => {
  const label = floorlensStationLabelOf(o?.sourceStation);
  if (!label) return null;
  return (
    <div style={{ fontSize: 13, color: '#475569', ...style }}>
      iPad: <b style={{ color: '#0f172a' }}>{label}</b>
    </div>
  );
};
const normalizeOrderSearchText = (v) =>
  String(v || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[_\-./]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const getOrderCustomerName = (o = {}) =>
  String(
    o.customerName ||
      (o.customer && typeof o.customer === 'object' ? o.customer.name : '') ||
      ''
  ).trim();

const getOrderCustomerDisplay = (o = {}) => {
  const member = String(o.memberCard || o.customer?.code || '').trim();
  const name = getOrderCustomerName(o);

  if (member) return `${member} - ${name || 'Chưa có thông tin'}`;
  return name || 'Chưa có thông tin';
};

const getOrderSearchText = (o = {}) => {
  const member = String(o.memberCard || o.customer?.code || '').replace(/\s+/g, '').trim();
  const name = getOrderCustomerName(o);
  const level = String(o.customer?.level || o.customerLevel || '').trim();

  return normalizeOrderSearchText(`${member} ${name} ${level}`);
};

function sanitizeMenuName(name) {
  return String(name || '')
    .replace(/\s+/g, ' ')
    .replace(/[^A-Za-z0-9 -]/g, '')
    .trim()
    .toUpperCase();
}

// 1) --- fetchMenuLevels: ưu tiên nhánh /api/products ---
let __menuLevelsInFlight = null;
async function fetchMenuLevels() {
  if (__menuLevelsInFlight) return __menuLevelsInFlight; // dùng lại request đang chạy
  __menuLevelsInFlight = (async () => {
    try {
      const res = await axios.get(apiUrl('/api/products/menu-levels'));
      return res.data || {};
    } catch (e) {
      try {
        const res2 = await axios.get(apiUrl('/api/menu-levels'));
        return res2.data || {};
      } catch (e2) {
        console.warn('GET menu-levels fail:', e2?.message || e?.message);
        return {};
      }
    } finally {
      __menuLevelsInFlight = null; // mở khoá khi xong
    }
  })();
  return __menuLevelsInFlight;
}



// ====== Print Agent config ======
const AGENT_PORT = Number(process.env.REACT_APP_AGENT_PORT || 9393);
export default function AdminFoodList() {
  // ===== Auth state =====
  const [auth, setAuth] = useState(() => {
    try {
      const raw = localStorage.getItem(AUTH_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed?.token) setAuthHeader(parsed.token);
      return parsed;
    } catch { return null; }
  });
  const [authExpiredNotice, setAuthExpiredNotice] = useState(null);
  const isLoggedIn = !!auth?.token;
  const role = auth?.role; // 'admin' | 'kitchen'
  const isAdmin = role === 'admin';
  const isKitchen = role === 'kitchen';

  useEffect(() => {
    const onAuthExpired = (ev) => {
      setAuthExpiredNotice(
        ev?.detail?.message ||
        'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại để tiếp tục sử dụng app.'
      );
    };

    window.addEventListener('food-auth-expired', onAuthExpired);
    return () => window.removeEventListener('food-auth-expired', onAuthExpired);
  }, []);

  useEffect(() => {
    if (!auth?.token) return;

    const expMs = getJwtExpirationMs(auth.token);
    if (!expMs) return;

    const delay = expMs - Date.now();
    const showExpired = () => dispatchAuthExpired();

    if (delay <= 0) {
      showExpired();
      return;
    }

    const t = setTimeout(showExpired, Math.min(delay, 2147483647));
    return () => clearTimeout(t);
  }, [auth?.token]);

  const confirmAuthExpired = useCallback(() => {
    localStorage.removeItem(AUTH_STORAGE_KEY);
    localStorage.removeItem(LEGACY_TOKEN_KEY);
    setAuthHeader(null);
    setAuth(null);
    setAuthExpiredNotice(null);
    setApiError(null);
    __authExpiredNotified = false;
  }, []);

  // ===== App state =====
  const [foods, setFoods] = useState([]);
  const [selectedType, setSelectedType] = useState('SNACK MENU');
  const [draggedId, setDraggedId] = useState(null);
  const [apiError, setApiError] = useState(null);
  const [showManage, setShowManage] = useState(false);
  // ——— defer app reload nếu đang mở modal Quản lý ———
const [reloadPending, setReloadPending] = useState(false);
const showManageRef = useRef(false);
useEffect(() => { showManageRef.current = showManage; }, [showManage]);


  // Search
  const [searchQuery, setSearchQuery] = useState('');

  // Level config
  const [levelConfig, setLevelConfig] = useState({});

  // Custom menus
  const [customMenus, setCustomMenus] = useState(() => {
    try {
      const raw = localStorage.getItem('customMenus');
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  });
  useEffect(() => { localStorage.setItem('customMenus', JSON.stringify(customMenus)); }, [customMenus]);
// === Staff lookup ===
const [staffMap, setStaffMap] = useState({});
useEffect(() => {
  async function loadStaffs() {
    const res = await axios.get(apiUrl('/api/staffs'));
    const map = {};
    (res.data || []).forEach(it => {
      const id = String(it.id || it.code || '').trim();
      if (id) map[id] = String(it.name || '');
    });
    setStaffMap(map);
  }
  loadStaffs();
}, []);
const foodsReqRef = useRef(null);
const fetchFoods = useCallback(async () => {
  if (foodsReqRef.current) return foodsReqRef.current;

  foodsReqRef.current = (async () => {
    try {
      const res = await axios.get(apiUrl('/api/foods'), {
        timeout: 8000,
      });

      const data = res.data || [];
      setFoods(data);
      setApiError(null);
      return data;
    } catch (e) {
      setApiError(e?.message || 'API error');

      // Không setFoods([]), giữ dữ liệu cũ nếu server chập chờn
      return null;
    } finally {
      foodsReqRef.current = null;
    }
  })();

  return foodsReqRef.current;
}, []);

  const fetchRef = useRef(null);
  const debounceFetch = useCallback(() => {
    clearTimeout(fetchRef.current);
    fetchRef.current = setTimeout(() => { fetchFoods(); }, 1000);
  }, [fetchFoods]);
  useEffect(() => () => clearTimeout(fetchRef.current), []);

  // History
  const [showHistory, setShowHistory] = useState(false);
 const [historyLoading, setHistoryLoading] = useState(false);
 const [historyRows, setHistoryRows] = useState([]);
 const histFiltersRef = useRef({});
// ✅ Đặt fetchStatusHistory TRƯỚC khi bị gọi ở dưới
const fetchStatusHistory = useCallback(async (params = {}) => {
  try {
    setHistoryLoading(true);
    const res = await axios.get(apiUrl('/api/status-history'), { params });
    setHistoryRows(res.data || []);
  } catch (e) {
    alert('Failed to load history: ' + (e?.response?.data?.error || e?.message || ''));
  } finally {
    setHistoryLoading(false);
  }
}, []);
 const applyHistFilters = useCallback((patch) => {
   histFiltersRef.current = { ...histFiltersRef.current, ...patch };
   fetchStatusHistory(histFiltersRef.current);
 }, [fetchStatusHistory]);

  const showHistoryRef = useRef(false);
  useEffect(() => { showHistoryRef.current = showHistory; }, [showHistory]);

  const versionRef = useRef(null);
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
  }, []);

  // Chuông báo đơn mới — không sử dụng giọng đọc.
  const playOrderBell = useCallback(() => {
    try {
      // Hủy giọng đọc còn sót lại nếu trang vừa được cập nhật từ phiên bản cũ.
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }

      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;

      const ctx = new AudioCtx();
      const startAt = ctx.currentTime + 0.01;

      // Hai nốt ngắn tạo cảm giác giống chuông thông báo, dễ nghe nhưng không quá dài.
      const notes = [
        { frequency: 880, start: 0, duration: 0.24, gain: 0.18 },
        { frequency: 1174.66, start: 0.18, duration: 0.42, gain: 0.16 },
      ];

      notes.forEach(({ frequency, start, duration, gain }) => {
        const oscillator = ctx.createOscillator();
        const volume = ctx.createGain();
        const noteStart = startAt + start;
        const noteEnd = noteStart + duration;

        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(frequency, noteStart);

        volume.gain.setValueAtTime(0.0001, noteStart);
        volume.gain.exponentialRampToValueAtTime(gain, noteStart + 0.025);
        volume.gain.exponentialRampToValueAtTime(0.0001, noteEnd);

        oscillator.connect(volume);
        volume.connect(ctx.destination);
        oscillator.start(noteStart);
        oscillator.stop(noteEnd + 0.02);
      });

      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }

      window.setTimeout(() => {
        ctx.close().catch(() => {});
      }, 1000);
    } catch (e) {
      console.warn('Không phát được chuông báo order:', e?.message || e);
    }
  }, []);
const humanizeName = useCallback((s) =>
  String(s||'')
    .replace(/\.(jpe?g|png|gif|webp|bmp|tiff?|jfif|heic|heif)$/i,'')
    .replace(/[-_.]+/g,' ')
    .replace(/\s{2,}/g,' ')
    .trim()
, []);
  
  const formatPrintDateTime = (value) => {
  const d = new Date(value || Date.now());
  const pad = (n) => String(n).padStart(2, '0');

  let hours = d.getHours();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  if (hours === 0) hours = 12;

  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(hours)}:${pad(d.getMinutes())}:${pad(d.getSeconds())} ${ampm}`;
};
 
const printDialog = useCallback((o) => {
  try {
    const w = window.open('', '_blank', 'width=480,height=640');
    if (!w) return alert('Trình duyệt đang chặn popup. Hãy cho phép để in.');

    const esc = (s) => String(s ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

    const rows = (o.items || [])
      .map(it => {
        const code = (it.code || it.productCode || '').trim();
        const itemName = humanizeName(it.name || it.imageName || it.imageKey).toUpperCase();
        const noteLine = it.note
          ? `<div class="item-note">Ghi chú: ${esc(it.note)}</div>`
          : '';

        return `
          <tr>
            <td colspan="3" style="padding: 0;">
              <div class="item-row">
                <div class="col-qty">${esc(String(it.qty || ''))}</div>
                <div class="col-name">${esc(itemName)}</div>
                <div class="col-code">${esc(code)}</div>
              </div>
              ${noteLine}
            </td>
          </tr>
        `;
      })
      .join('');

    const sName = staffMap[o.staff] || '';
    const staffDisplay = o.staff ? (sName ? `${o.staff} - ${sName}` : o.staff) : '';

    const customerDisplay = o.memberCard
      ? (o.customerName ? `${o.memberCard} - ${o.customerName}` : o.memberCard)
      : (o.customerName || '');

    const html = `
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Order #${o.id}</title>
  <style>
    @page { size: 80mm auto; margin: 4mm; }

    body {
      font-family: "Segoe UI", Tahoma, Arial, sans-serif;
      font-size: 13px;
      line-height: 1.35;
      color: #000;
    }

    .center { text-align: center; }

    .row {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      margin: 2px 0;
    }

    .title {
      font-size: 20px;
      font-weight: 700;
      letter-spacing: 0.5px;
      margin-bottom: 2px;
    }

    .sub {
      font-size: 12px;
      margin-bottom: 6px;
    }

    .normal-label {
      font-weight: 400;
    }

    .value-normal {
      font-weight: 400;
    }

    .value-bold {
      font-weight: 700;
    }

    hr {
      border: none;
      border-top: 1px dashed #000;
      margin: 8px 0;
    }

    table {
      width: 100%;
      border-collapse: collapse;
    }

    td {
      vertical-align: top;
    }

    .item-row {
      display: grid;
      grid-template-columns: 32px 1fr 44px;
      column-gap: 8px;
      align-items: start;
      font-weight: 700;
      font-size: 14px;
      padding: 4px 0;
    }

    .col-qty {
      text-align: left;
    }

    .col-name {
      text-transform: uppercase;
      word-break: break-word;
    }

    .col-code {
      text-align: right;
      white-space: nowrap;
    }

    .item-note {
      font-size: 12px;
      margin: 2px 0 6px 40px;
    }
  </style>
</head>
<body onload="window.print(); setTimeout(()=>window.close(), 500);">
  <div class="center title">KITCHEN ORDER</div>
  <div class="center sub">#${o.id} • ${formatPrintDateTime(o.createdAt)}</div>

  <hr />

  <div class="row"><span class="normal-label">Area</span><span class="value-normal">${esc(o.area || '')}</span></div>
  <div class="row"><span class="normal-label">Table</span><span class="value-normal">${esc(o.tableNo || '')}</span></div>
  <div class="row"><span class="normal-label">Staff</span><span class="value-bold">${esc(staffDisplay)}</span></div>
  <div class="row"><span class="normal-label">Customer</span><span class="value-bold">${esc(customerDisplay)}</span></div>

  ${o.note ? `<div style="margin-top:4px;"><span class="value-bold">Note:</span> ${esc(o.note)}</div>` : ''}

  <hr />

  <table>${rows}</table>

  <hr />
  <div class="center">— THANK YOU —</div>
</body>
</html>`;

    w.document.write(html);
    w.document.close();
  } catch (e) {
    alert('Không in được: ' + (e?.message || e));
  }
}, [humanizeName, staffMap]);

  // ---------- PRINT AGENT (HTTP, auto-detect host) ----------
  const [agentBase, setAgentBase] = useState(
    () => localStorage.getItem('printAgent') || ''
  );
  const [agentStatus, setAgentStatus] = useState('unknown'); // unknown | ok | offline | detecting

  const agentCandidates = useCallback(() => {
    const set = new Set();
    const push = (u) => { if (u && typeof u === 'string') set.add(u.replace(/\/+$/,'')); };

    push(localStorage.getItem('printAgent'));
    push(process.env.REACT_APP_PRINT_AGENT_URL);

    const host = window.location.hostname;
    if (host) push(`http://${host}:${AGENT_PORT}`);
    push(`http://127.0.0.1:${AGENT_PORT}`);
    push(`http://localhost:${AGENT_PORT}`);
    push(`http://print-agent:${AGENT_PORT}`);
    push(`http://print-agent.local:${AGENT_PORT}`);

    return Array.from(set);
  }, []);

  const detectAgent = useCallback(async (silent = false) => {
    const list = agentCandidates();
    if (!silent) setAgentStatus('detecting');

    for (const base of list) {
      try {
        const r = await fetch(`${base}/health`, { method: 'GET' });
        if (r.ok) {
          setAgentBase(base);
          setAgentStatus('ok');
          localStorage.setItem('printAgent', base);
          return base;
        }
      } catch (_) { /* next */ }
    }
    if (!silent) setAgentStatus('offline');
    return null;
  }, [agentCandidates]);

  useEffect(() => {
    if (!agentBase) detectAgent(true);
    const t = setInterval(() => detectAgent(true), 60000);
    return () => clearInterval(t);
  }, [agentBase, detectAgent]);

const printOrderAgent = useCallback(async (order) => {
  const base = agentBase || await detectAgent(true);
  if (!base) throw new Error('Print Agent not found');
  const res = await fetch(`${base}/print`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ order })
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}, [agentBase, detectAgent]);

// ===== Orders state =====
const [tab, setTab] = useState('foods'); // 'foods' | 'orders'
const [orders, setOrders] = useState([]);
const [ordersLoading, setOrdersLoading] = useState(false);
const [ordersError, setOrdersError] = useState(null);
const [orderFilter, setOrderFilter] = useState('ALL');
const [dateRange, setDateRange] = useState('today');
const [fromDate, setFromDate]   = useState('');
const [toDate, setToDate]       = useState('');
const [activeTable, setActiveTable] = useState(null);
const [orderSort, setOrderSort] = useState('time_desc');
const [orderCustomerSearch, setOrderCustomerSearch] = useState('');
const [offMenuPriceDrafts, setOffMenuPriceDrafts] = useState({});
// PHẢI đặt state này lên trước resolveItemCode
const [productCodeByImage, setProductCodeByImage] = useState({});

const [autoPrint, setAutoPrint] = useState(() => {
  const raw = localStorage.getItem('autoPrint');
  return raw ? raw === 'true' : true;
});
useEffect(() => { localStorage.setItem('autoPrint', String(autoPrint)); }, [autoPrint]);

const autoPrintClientIdRef = useRef('');
if (!autoPrintClientIdRef.current) {
  try {
    const saved = sessionStorage.getItem('food-admin-print-client-id');
    const id = saved || `admin-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    sessionStorage.setItem('food-admin-print-client-id', id);
    autoPrintClientIdRef.current = id;
  } catch {
    autoPrintClientIdRef.current = `admin-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

const claimAutoPrint = useCallback(async (orderId) => {
  if (!orderId) return false;

  const res = await axios.post(
    apiUrl(`/api/orders/${encodeURIComponent(orderId)}/claim-print`),
    { clientId: autoPrintClientIdRef.current },
    { timeout: 3000 }
  );

  return Boolean(res?.data?.claimed);
}, []);

// Load danh sách sản phẩm để map imageName -> mã món (productCode)
useEffect(() => {
  if (!isLoggedIn) return;

  let cancelled = false;

  (async () => {
    try {
      const res = await axios.get(apiUrl('/api/products'), {
        params: { limit: 70000 },
      });

      const rows = Array.isArray(res.data?.rows)
        ? res.data.rows
        : Array.isArray(res.data)
        ? res.data
        : [];

      const map = {};
      for (const p of rows) {
        const img = getImageName(p.imageUrl || p.imageName || '');
        if (!img) continue;

        const code = (p.productCode || p.code || '').toString().trim();
        if (!code) continue;

        map[img] = code;
      }

      if (!cancelled) setProductCodeByImage(map);
    } catch (e) {
      console.warn('Load product codes for Orders view failed:', e?.message || e);
    }
  })();

  return () => {
    cancelled = true;
  };
}, [isLoggedIn]);

const resolveItemCode = useCallback(
  (item) => {
    if (!item) return '';

    const direct = (item.productCode || item.code || '').toString().trim();
    if (direct) return direct;

    const img = getImageName(item.imageUrl || item.imageName || item.imageKey || '');
    if (img && productCodeByImage[img]) return productCodeByImage[img];

    return '';
  },
  [productCodeByImage]
);

const printOrderSmart = useCallback(async (o) => {
  const staffName = staffMap[o.staff] || '';

  const customerNameVal =
    (o.customerName != null && o.customerName !== undefined)
      ? o.customerName
      : (o.customer && typeof o.customer === 'object' ? (o.customer.name || '') : '');

  const itemsWithCode = Array.isArray(o.items)
    ? o.items.map((it) => {
        const direct = (it.productCode || it.code || '').toString().trim();
        const resolved = direct || resolveItemCode(it) || '';
        return {
          ...it,
          code: resolved || it.code || it.productCode || '',
        };
      })
    : [];

  const orderForPrint = {
    ...o,
    staffName,
    customerName: customerNameVal,
    items: itemsWithCode,
  };

  try {
    await printOrderAgent(orderForPrint);
    return;
  } catch (e) {
    console.warn('[Agent] print fail:', e?.message || e);
  }

  printDialog(orderForPrint);
}, [printOrderAgent, printDialog, staffMap, resolveItemCode]);




const buildRange = useCallback(() => {
  const BUSINESS_HOUR = 6;
  const DAY_MS = 24 * 60 * 60 * 1000;

  const toISO = (d) => d.toISOString();

  const startAtBusinessHour = (d) =>
    new Date(
      d.getFullYear(),
      d.getMonth(),
      d.getDate(),
      BUSINESS_HOUR,
      0,
      0,
      0
    );

  const endFromStart = (start, days = 1) =>
    new Date(start.getTime() + days * DAY_MS - 1);

  // Dịch thời gian lùi 6 tiếng để trước 6h sáng vẫn thuộc ngày kinh doanh hôm trước
  const shiftForBusinessDay = (d) =>
    new Date(d.getTime() - BUSINESS_HOUR * 60 * 60 * 1000);

  const parseYmd = (ymd) => {
    const [y, m, d] = String(ymd || '').split('-').map(Number);
    if (!y || !m || !d) return null;
    return new Date(y, m - 1, d);
  };

  const getBusinessWeekStart = (d) => {
    const shifted = shiftForBusinessDay(d);
    const base = new Date(
      shifted.getFullYear(),
      shifted.getMonth(),
      shifted.getDate()
    );

    const dow = (base.getDay() + 6) % 7; // Monday = 0
    base.setDate(base.getDate() - dow);

    return startAtBusinessHour(base);
  };

  const getBusinessMonthStart = (d) => {
    const shifted = shiftForBusinessDay(d);
    return new Date(
      shifted.getFullYear(),
      shifted.getMonth(),
      1,
      BUSINESS_HOUR,
      0,
      0,
      0
    );
  };

  const getBusinessYearStart = (d) => {
    const shifted = shiftForBusinessDay(d);
    return new Date(
      shifted.getFullYear(),
      0,
      1,
      BUSINESS_HOUR,
      0,
      0,
      0
    );
  };

  const now = new Date();
  const shiftedNow = shiftForBusinessDay(now);

  let from = null;
  let to = null;

  switch (dateRange) {
    case 'today': {
      from = startAtBusinessHour(shiftedNow);
      to = endFromStart(from, 1);
      break;
    }

    case 'yesterday': {
      const y = new Date(shiftedNow);
      y.setDate(y.getDate() - 1);
      from = startAtBusinessHour(y);
      to = endFromStart(from, 1);
      break;
    }

    case 'week': {
      from = getBusinessWeekStart(now);
      to = endFromStart(from, 7);
      break;
    }

    case 'month': {
      from = getBusinessMonthStart(now);

      const shifted = shiftForBusinessDay(now);
      const nextMonthStart = new Date(
        shifted.getFullYear(),
        shifted.getMonth() + 1,
        1,
        BUSINESS_HOUR,
        0,
        0,
        0
      );

      to = new Date(nextMonthStart.getTime() - 1);
      break;
    }

    case 'year': {
      from = getBusinessYearStart(now);

      const shifted = shiftForBusinessDay(now);
      const nextYearStart = new Date(
        shifted.getFullYear() + 1,
        0,
        1,
        BUSINESS_HOUR,
        0,
        0,
        0
      );

      to = new Date(nextYearStart.getTime() - 1);
      break;
    }

    case 'custom': {
      const fromBase = parseYmd(fromDate);
      const toBase = parseYmd(toDate);

      from = fromBase ? startAtBusinessHour(fromBase) : null;
      to = toBase ? endFromStart(startAtBusinessHour(toBase), 1) : null;
      break;
    }

    default: {
      from = startAtBusinessHour(shiftedNow);
      to = endFromStart(from, 1);
      break;
    }
  }

  return {
    from: from ? toISO(from) : undefined,
    to: to ? toISO(to) : undefined,
  };
}, [dateRange, fromDate, toDate]);

  const fetchOrders = useCallback(async () => {
    setOrdersLoading(true);
    setOrdersError(null);
    try {
      const { from, to } = buildRange();
      const res = await axios.get(apiUrl('/api/orders'), { params: { status: orderFilter, from, to } });
      const normalize = (o = {}) => ({ ...o, cancelReason: o.cancelReason ?? o.reason ?? o?.meta?.cancelReason ?? o?.statusReason ?? null });
      const data = Array.isArray(res.data) ? res.data.map(normalize) : [];
      data.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      setOrders(data);
    } catch (e) {
      setOrdersError(e?.response?.data?.error || e?.message || 'Cannot load orders');
    } finally {
      setOrdersLoading(false);
    }
  }, [orderFilter, buildRange]);
const didInitRef = useRef(false);
  // ===== Effects =====
useEffect(() => {
  if (!isLoggedIn) {
    didInitRef.current = false;
    return;
  }

  // Chỉ fetch dữ liệu khởi tạo 1 lần sau khi login.
  // Không dùng didInitRef để bỏ qua việc gắn socket listener,
  // vì nếu tab/autoPrint thay đổi React sẽ cleanup listener cũ trước khi effect chạy lại.
  if (!didInitRef.current) {
    didInitRef.current = true;
    (async () => {
      await fetchFoods();
      setLevelConfig(await fetchMenuLevels());
      if (tab === 'orders') await fetchOrders();
    })();
  }

  socket.on('foodAdded', debounceFetch);
  socket.on('foodStatusUpdated', debounceFetch);
  socket.on('foodDeleted', debounceFetch);
  socket.on('foodsDeleted', debounceFetch);
  socket.on('foodsReordered', debounceFetch);
  socket.on('foodLevelsUpdated', debounceFetch);

  let __mlTimer = null;
  const onMenuLevelsUpdated = () => {
    clearTimeout(__mlTimer);
    __mlTimer = setTimeout(async () => {
      setLevelConfig(await fetchMenuLevels());
    }, 400); // gộp các burst trong 400ms thành 1 lần fetch
  };

  socket.on('menuLevelsUpdated', onMenuLevelsUpdated);
  socket.on('statusHistoryAdded', async () => {
    if (showHistoryRef.current) await fetchStatusHistory();
  });

  return () => {
    clearTimeout(__mlTimer);
    socket.off('foodAdded', debounceFetch);
    socket.off('foodStatusUpdated', debounceFetch);
    socket.off('foodDeleted', debounceFetch);
    socket.off('foodsDeleted', debounceFetch);
    socket.off('foodsReordered', debounceFetch);
    socket.off('foodLevelsUpdated', debounceFetch);
    socket.off('statusHistoryAdded');
    socket.off('menuLevelsUpdated', onMenuLevelsUpdated);
  };
}, [
  isLoggedIn,
  tab,
  fetchFoods,
  fetchOrders,
  debounceFetch,
  fetchStatusHistory,
]);

  useEffect(() => {
 const normVer = (v) => String(v ?? '');
 const onVersion = (ver) => {
   const cur = normVer(versionRef.current);
   const next = normVer(ver);
   if (cur && cur !== next) {
      // Nếu đang mở trang Quản lý thì không reload vội
      if (showManageRef.current) {

        setReloadPending(true);
      } else {
       if (!window.__reloadedOnce) {
         window.__reloadedOnce = true;
         window.location.reload();
      }
    }
   } else {
     versionRef.current = next; // ghi nhớ lần đầu (đã chuẩn hoá)
    }
  };
    socket.on('appVersion', onVersion);
    return () => socket.off('appVersion', onVersion);
  }, []);

// 1) Effect chỉ lo sự kiện "connect" thôi
useEffect(() => {
  if (!isLoggedIn) return;
  const onConnect = () => {
    fetchFoods();
    if (tab === 'orders') fetchOrders();
  };
  socket.on('connect', onConnect);
  return () => {
    socket.off('connect', onConnect);
  };
}, [isLoggedIn, fetchFoods, fetchOrders, tab]);

// 2) Effect riêng cho "reconnect"
useEffect(() => {
  if (!isLoggedIn) return;
  const onReconnect = () => { if (tab === 'orders') fetchOrders(); };
  socket.on('reconnect', onReconnect);
  return () => socket.off('reconnect', onReconnect);
}, [isLoggedIn, tab, fetchOrders]);


  useEffect(() => {
    if (!isLoggedIn) return;
    socket.on('foodRenamed', debounceFetch);
    return () => socket.off('foodRenamed', debounceFetch);
  }, [isLoggedIn, debounceFetch]);
// Luôn gắn listener cho đơn hàng, không phụ thuộc didInitRef
useEffect(() => {
  if (!isLoggedIn) return;

  const normalize = (o = {}) => ({
    ...o,
    cancelReason: o.cancelReason ?? o.reason ?? o?.meta?.cancelReason ?? o?.statusReason ?? null,
  });

  // Dùng Set để tránh auto-print lặp nếu nhận trùng event
  const printedRef = window.__printedOnce || (window.__printedOnce = new Set());

  const onOrderPlaced = async ({ order }) => {
    const ord = normalize(order || {});

    // Cập nhật danh sách đơn (dedupe + sort)
    setOrders((prev) => {
      const map = new Map(prev.map((o) => [o.id, o]));
      map.set(ord.id, { ...(map.get(ord.id) || {}), ...ord });
      const arr = Array.from(map.values());
      arr.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      return arr;
    });
    // Chỉ phát chuông khi có order mới, không đọc mã nhân viên hoặc tên món.
    playOrderBell();

    // Tự in nếu bật Auto print. claimAutoPrint đảm bảo nhiều tab/máy Admin chỉ 1 nơi được in.
    if (autoPrint && !printedRef.has(ord.id)) {
      try {
        const claimed = await claimAutoPrint(ord.id);
        if (!claimed) return;

        await printOrderSmart(ord);
        printedRef.add(ord.id);
      } catch (e) {
        console.warn('Auto print failed:', e?.message || e);
      }
    }
  };

  const onOrderUpdated = (payload = {}) => {
    const { orderId, status, order, reason, cancelReason, area: areaHint, tableNo: tableHint } = payload;
    const reasonFinal = cancelReason ?? reason ?? order?.cancelReason ?? order?.reason ?? null;

    setOrders((prev) =>
      prev.map((o) => {
        if (o.id !== orderId) return o;
        const merged = { ...o, ...(order || {}), status };
        if (reasonFinal) merged.cancelReason = reasonFinal;
        merged.area = merged.area ?? areaHint ?? o.area;
        merged.tableNo = merged.tableNo ?? tableHint ?? o.tableNo;
        return merged;
      })
    );
  };

  socket.on('orderPlaced', onOrderPlaced);
  socket.on('orderUpdated', onOrderUpdated);
  return () => {
    socket.off('orderPlaced', onOrderPlaced);
    socket.off('orderUpdated', onOrderUpdated);
  };
}, [isLoggedIn, autoPrint, claimAutoPrint, printOrderSmart, playOrderBell]);



  // ===== Types cho sidebar =====
  const typesFromData = useMemo(() => Array.from(new Set(foods.map(f => f.type))), [foods]);
  const preferredWithData = useMemo(() => {
    const set = new Set(typesFromData);
    return MENU_TYPES.filter(t => set.has(t));
  }, [typesFromData]);
  const othersFromData = useMemo(() => {
    const preferredSet = new Set(MENU_TYPES);
    return typesFromData.filter(t => !preferredSet.has(t));
  }, [typesFromData]);
  const customStillEmpty = useMemo(() => {
    const inData = new Set(typesFromData);
    return customMenus.filter(t => !inData.has(t));
  }, [customMenus, typesFromData]);

  // ❗ Sidebar chỉ dựa trên các menu thực trong /api/foods + customMenus (không đẩy itemGroup vào)
  const sidebarTypes = useMemo(() => {
    const seen = new Set(); const out = [];
    const push = (arr) => arr.forEach(t => { if (t && !seen.has(t)) { seen.add(t); out.push(t); } });
    push(preferredWithData);
    push(othersFromData);
    push(customStillEmpty);
    return out;
  }, [preferredWithData, othersFromData, customStillEmpty]);

  const sidebarTypesWithFallback = sidebarTypes.length ? sidebarTypes : MENU_TYPES;



  useEffect(() => {
    if (selectedType === SOLD_OUT_KEY) return;
    const list = sidebarTypesWithFallback;
    if (!list.includes(selectedType)) setSelectedType(list[0] ?? SOLD_OUT_KEY);
  }, [sidebarTypesWithFallback, selectedType]);

  // ===== Auth handlers =====
  const handleLogin = async (e) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const username = form.get('username');
    const password = form.get('password');
    try {
      const res = await axios.post(apiUrl('/api/login'), { username, password });
      const { token, role, username: uname } = res.data || {};
      const info = { token, role, username: uname };
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(info));
      __authExpiredNotified = false;
      setAuthExpiredNotice(null);
      setAuth(info);
      setAuthHeader(token);
      setApiError(null);
      await fetchFoods();
      setLevelConfig(await fetchMenuLevels());
    } catch (err) {
      setApiError(err?.response?.data?.error || err?.message || 'Sign-in failed');
    }
  };
  const handleLogout = () => {
    localStorage.removeItem(AUTH_STORAGE_KEY);
    localStorage.removeItem(LEGACY_TOKEN_KEY);
    __authExpiredNotified = false;
    setAuthExpiredNotice(null);
    setAuth(null);
    setAuthHeader(null);
  };

const handleToggleStatus = async (id, status) => {
  if (!isLoggedIn) return alert('Please sign in.');

  const target = foods.find((f) => f.id === id);
  if (!target) return;

  const newStatus = status === 'Available' ? 'Sold Out' : 'Available';
  const imageName = getImageName(target.imageUrl);
  const prevFoods = foods;

  // Kitchen/Admin chỉ quản lý trạng thái món. Không dùng tồn kho/số lượng nữa.
  setFoods((prev) =>
    prev.map((f) =>
      getImageName(f.imageUrl) === imageName
        ? { ...f, status: newStatus }
        : f
    )
  );

  try {
    await axios.post(apiUrl(`/api/update-status/${id}`), { newStatus });
    setApiError(null);
  } catch (e) {
    // rollback nếu lỗi
    setFoods(prevFoods);
    setApiError(e?.message || 'API error');
  }
};

  // Xóa menu chỉ thực hiện trong Quản lý > Hàng hóa > Menu.


// 2) --- handleAddMenu: đổi path ---
const handleAddMenu = async () => {
  if (!isAdmin) return alert('Admin only.');
  const raw = window.prompt('Enter new menu name (e.g., LUNCH MENU):');
  if (raw == null) return;
  const name = sanitizeMenuName(raw);
  if (!name) return alert('Invalid menu name.');

  if (!sidebarTypesWithFallback.includes(name)) {
    setCustomMenus(prev => (prev.includes(name) ? prev : [...prev, name]));
  }
  const defaultLv = levelConfig[name] || ['V-One'];
  setLevelConfig(prev => ({ ...prev, [name]: defaultLv }));
  try {
  await axios.post(apiUrl('/api/products/menu-levels'), { type: name, levelAccess: defaultLv });
} catch {
  // fallback server cũ
  try { await axios.post(apiUrl('/api/menu-levels'), { type: name, levelAccess: defaultLv }); } catch {}
}

  setSelectedType(name);
};


  



const handleDrop = async (targetId) => {
  if (!isAdmin) return;

  const fromId = String(draggedId || '');
  const toId = String(targetId || '');

  if (!fromId || !toId || fromId === toId) {
    setDraggedId(null);
    return;
  }

  const updated = [...foods];

  const i1 = updated.findIndex(f => String(f.id) === fromId);
  const i2 = updated.findIndex(f => String(f.id) === toId);

  if (i1 === -1 || i2 === -1) {
    setDraggedId(null);
    return;
  }

  const [drag] = updated.splice(i1, 1);
  updated.splice(i2, 0, drag);

  const reordered = updated.map((f, idx) => ({ ...f, order: idx }));

  setFoods(reordered);
  setDraggedId(null);

  try {
    await axios.post(apiUrl('/api/reorder-foods'), {
      orderedIds: reordered.map(f => f.id),
    });
    setApiError(null);
  } catch (e) {
    setApiError(e?.response?.data?.error || e?.message || 'API error');
    fetchFoods();
  }
};

const normalize = (s) => String(s || '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // bỏ dấu
  .replace(/[_\-./]+/g, ' ')                        // nối dấu câu thành khoảng trắng
  .replace(/\s{2,}/g,' ')
  .trim()
  .toUpperCase();

  // ====== Foods view data ======
  const isSoldOutPage = selectedType === SOLD_OUT_KEY;
  const listRaw = isSoldOutPage ? foods.filter(f => f.status === 'Sold Out') : foods.filter(f => f.type === selectedType);

  // Một món có thể nằm trong nhiều menu nên trang Sold out phải gộp theo ảnh.
  // Dùng key đã chuẩn hóa để tránh hiện trùng khi tên file chỉ khác chữ hoa/thường,
  // URL encode hoặc có query/hash.
  const foodsByType = [];
  const seenImageKeys = new Set();
  for (const f of listRaw) {
    const imageKey = getImageName(f.imageUrl) || `food-id:${String(f.id ?? '')}`;
    if (seenImageKeys.has(imageKey)) continue;

    seenImageKeys.add(imageKey);
    foodsByType.push(f);
  }

const normQ = normalize(searchQuery);
const tokens = normQ ? normQ.split(' ') : [];

const foodsForDisplay = normQ
  ? foodsByType.filter((f) => {
      const type = normalize(f.type);
      const img = normalize(getImageName(f.imageUrl));
      const code = normalize(f.productCode);
      const name = normalize(f.productName);

      // gộp thành 1 chuỗi lớn để tìm gần đúng
      const hay = [type, img, code, name].filter(Boolean).join(' ');
      // every token của người dùng đều phải xuất hiện (fuzzy cơ bản)
      return tokens.every(t => hay.includes(t));
    })
  : foodsByType;


  useEffect(() => {
    if (tab === 'orders' && isLoggedIn) fetchOrders();
  }, [tab, orderFilter, isLoggedIn, fetchOrders]);

const filteredOrders = useMemo(() => {
  let rows = [];

  if (orderFilter === 'OPEN') {
    rows = orders.filter(
      o => o.status === ORDER_STATUS.PENDING || o.status === ORDER_STATUS.IN_PROGRESS
    );
  } else if (orderFilter === 'ALL') {
    rows = orders;
  } else {
    rows = orders.filter(o => o.status === orderFilter);
  }

  const qRaw = String(orderCustomerSearch || '').trim();
  if (qRaw) {
    const qCompact = qRaw.replace(/\s+/g, '').toLowerCase();
    const qNorm = normalizeOrderSearchText(qRaw);
    const qTokens = qNorm.split(' ').filter(Boolean);

    rows = rows.filter((o) => {
      const member = String(o.memberCard || o.customer?.code || '').replace(/\s+/g, '').toLowerCase();
      const hay = getOrderSearchText(o);

      const matchMember = qCompact && member.includes(qCompact);
      const matchName = qTokens.length > 0 && qTokens.every((t) => hay.includes(t));

      return matchMember || matchName;
    });
  }

  return [...rows].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
}, [orders, orderFilter, orderCustomerSearch]);

  const imageUrlByName = useCallback((imageName) => {
    const f = foods.find(x => getImageName(x.imageUrl) === String(imageName || '').toLowerCase());
    return f?.imageUrl ? resolveImg(f.imageUrl) : null;
  }, [foods]);


  const setOrderStatus = async (orderId, status, reason) => {
    try {
      await axios.post(apiUrl(`/api/orders/${orderId}/status`), { status, reason });
      setOrders(prev =>
        prev.map(o =>
          o.id === orderId
            ? { ...o, status, ...(reason ? { cancelReason: reason } : {}) }
            : o
        )
      );
    } catch (e) {
      alert('Không cập nhật được trạng thái: ' + (e?.response?.data?.error || e?.message || ''));
    }
  };

const saveOffMenuPrice = useCallback(async (orderId, itemIndex) => {
  const key = `${orderId}:${itemIndex}`;
  const raw = offMenuPriceDrafts[key];

  if (raw === '' || raw == null) {
    return alert('Nhập giá');
  }

  const price = Number(raw);
  if (!Number.isFinite(price) || price < 0) {
    return alert('Giá phải là số >= 0');
  }

  try {
    const res = await axios.post(apiUrl(`/api/orders/${orderId}/item-price`), {
      itemIndex,
      price,
    });

    if (res?.data?.order) {
      setOrders((prev) =>
        prev.map((o) => (String(o.id) === String(orderId) ? { ...o, ...res.data.order } : o))
      );
    }

    setOffMenuPriceDrafts((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });

    setApiError(null);
  } catch (e) {
    alert('Lưu giá thất bại: ' + (e?.response?.data?.error || e?.message || ''));
  }
}, [offMenuPriceDrafts]);

const getOrderStaffDisplay = (o = {}) => {
  const code = String(o.staff || '').replace(/\s+/g, '').trim();
  const name = String(staffMap?.[code] || '').trim();

  if (!code) return 'Chưa có thông tin';
  return `${code} - ${name || 'Chưa có thông tin'}`;
};

const renderAdminOrderItems = (order = {}, { allowOffMenuPrice = false } = {}) => (
  <div style={{ display: 'grid', gap: 8 }}>
    {(order.items || []).map((it, idx) => {
      const isOffMenu = Boolean(it?.isOffMenu);
      const imgName = isOffMenu ? '' : getImageName(it.imageName || it.imageKey || it.imageUrl || '');
      const url = isOffMenu ? null : imageUrlByName(imgName);
      const code = isOffMenu
        ? String(it.productCode || it.code || 'H100').trim()
        : String(resolveItemCode(it) || '').trim();
      const name = isOffMenu
        ? `OFF MENU${it.name ? ` - ${String(it.name).trim()}` : ''}`
        : humanizeName(it.name || imgName || 'Chưa có tên món');
      const qty = Math.max(1, Number(it.qty || it.quantity || 1));
      const draftKey = `${order.id}:${idx}`;

      return (
        <div
          key={draftKey}
          style={{
            display: 'grid',
            gridTemplateColumns: '42px 72px minmax(0, 1fr) auto',
            alignItems: 'center',
            gap: 8,
            padding: '8px 10px',
            border: '1px solid #e5e7eb',
            borderRadius: 10,
            background: '#fff',
          }}
        >
          {url ? (
            <img
              src={url}
              alt=""
              style={{
                width: 42,
                height: 42,
                objectFit: 'cover',
                borderRadius: 7,
                border: '1px solid #eee',
              }}
            />
          ) : (
            <div style={{ width: 42, height: 42 }} />
          )}

          <div
            style={{
              fontSize: 13,
              fontWeight: 900,
              color: isOffMenu ? '#7c3aed' : '#1d4ed8',
              wordBreak: 'break-word',
            }}
          >
            {code || '---'}
          </div>

          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: '#111827', lineHeight: 1.35 }}>
              {name}
            </div>

            {it.note && (
              <div style={{ marginTop: 3, fontSize: 12, color: '#92400e', lineHeight: 1.35 }}>
                📝 {it.note}
              </div>
            )}

            {isOffMenu && allowOffMenuPrice && (
              <div style={{ marginTop: 7, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 11, color: '#6b7280' }}>
                  Giá hiện tại: <b>{Number(it.price || 0).toLocaleString('vi-VN')}</b>
                </span>

                <input
                  type="number"
                  inputMode="numeric"
                  min="0"
                  value={offMenuPriceDrafts[draftKey] ?? (it.price ?? '')}
                  onChange={(e) =>
                    setOffMenuPriceDrafts((prev) => ({
                      ...prev,
                      [draftKey]: e.target.value.replace(/[^\d.]/g, ''),
                    }))
                  }
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') saveOffMenuPrice(order.id, idx);
                  }}
                  placeholder="Nhập giá"
                  style={{
                    width: 100,
                    padding: '4px 6px',
                    border: '1px solid #ddd',
                    borderRadius: 6,
                  }}
                />

                <button
                  onClick={() => saveOffMenuPrice(order.id, idx)}
                  style={{
                    padding: '4px 8px',
                    background: '#7c3aed',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 6,
                    cursor: 'pointer',
                    fontSize: 12,
                  }}
                >
                  Save
                </button>
              </div>
            )}
          </div>

          <div
            style={{
              minWidth: 38,
              textAlign: 'right',
              fontSize: 18,
              fontWeight: 900,
              color: '#111827',
            }}
          >
            x{qty}
          </div>
        </div>
      );
    })}
  </div>
);

  // ===== Login screen =====
  if (!isLoggedIn) {
    return (
      <div style={{ height: '100vh', display: 'grid', placeItems: 'center', background: '#111' }}>
        <form onSubmit={handleLogin} style={{ background: '#1f2937', padding: 24, borderRadius: 12, width: 360, color: '#fff' }}>
          <h2 style={{ marginTop: 0, marginBottom: 12 }}>🔐 Sign in</h2>
          <div style={{ marginBottom: 12 }}>
            <label>Username</label>
            <input name="username" placeholder="admin / kitchen" required
              style={{ width: '100%', padding: 8, borderRadius: 6, border: '1px solid #374151', background: '#111', color: '#fff' }} />
          </div>
          <div style={{ marginBottom: 12 }}>
            <label>Password</label>
            <input type="password" name="password" placeholder="••••••••" required
              style={{ width: '100%', padding: 8, borderRadius: 6, border: '1px solid #374151', background: '#111', color: '#fff' }} />
          </div>
          {apiError && <div style={{ color: '#fca5a5', marginBottom: 8 }}>{apiError}</div>}
          <button type="submit" style={{ width: '100%', padding: 10, background: '#10b981', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' }}>
            Sign in
          </button>
          <div style={{ marginTop: 10, fontSize: 12, color: '#9ca3af' }}>
            Default: <b>kitchen / kitchen123</b>
          </div>
        </form>
      </div>
    );
  }

  // ===== Main UI =====
  const th = { textAlign: 'left', padding: '10px 12px', fontSize: 12, color: '#374151', borderBottom: '1px solid #e5e7eb' };
  const td = { padding: '8px 12px', fontSize: 12, color: '#111' };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '280px minmax(0, 1fr)', height: '100vh', overflowX: 'hidden' }}>
      {authExpiredNotice && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 999999,
            background: 'rgba(17,24,39,0.72)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
        >
          <div
            style={{
              width: 'min(420px, 100%)',
              background: '#fff',
              borderRadius: 14,
              boxShadow: '0 20px 50px rgba(0,0,0,0.35)',
              padding: 22,
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: 42, marginBottom: 8 }}>🔐</div>
            <h2 style={{ margin: '0 0 8px', color: '#111827' }}>Phiên đăng nhập đã hết hạn</h2>
            <p style={{ margin: '0 0 18px', color: '#4b5563', lineHeight: 1.5 }}>
              {authExpiredNotice}
            </p>
            <button
              type="button"
              onClick={confirmAuthExpired}
              style={{
                minWidth: 120,
                padding: '10px 18px',
                border: 'none',
                borderRadius: 10,
                background: '#2563eb',
                color: '#fff',
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              OK
            </button>
          </div>
        </div>
      )}
      {/* Sidebar */}
      <div style={{ background: '#111', color: '#fff', padding: 16, overflowY: 'auto', overflowX: 'hidden', width: '100%', minWidth: 0, boxSizing: 'border-box' }}>
        <div style={{ marginBottom: 12 }}>
<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
  <h3 style={{ margin: 0 }}>
    {isAdmin ? 'Admin' : (isKitchen ? 'Kitchen' : 'User')}
  </h3>

  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginLeft: 'auto' }}>
    {isAdmin && (
      <button
        onClick={() => {
          setTab('foods');
          setShowManage(true);
        }}
        style={{
          background: '#2563eb',
          color: '#fff',
          border: 'none',
          borderRadius: 6,
          padding: '6px 10px',
          cursor: 'pointer',
          fontSize: 12,
          fontWeight: 700,
        }}
        title="Quản lý hàng hóa, khách hàng, nhân viên, báo cáo"
      >
        Quản lý
      </button>
    )}

    <button
      onClick={handleLogout}
      style={{
        background: '#ef4444',
        color: '#fff',
        border: 'none',
        borderRadius: 6,
        padding: '6px 10px',
        cursor: 'pointer',
        fontSize: 12,
      }}
    >
      Sign out
    </button>
  </div>
</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
            <button
              onClick={() => setTab('foods')}
              style={{ background: tab === 'foods' ? '#10b981' : '#374151', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 10px', cursor: 'pointer', fontSize: 12 }}
            >
              Foods
            </button>
            <button
              onClick={() => { setTab('orders'); }}
              style={{ background: tab === 'orders' ? '#10b981' : '#374151', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 10px', cursor: 'pointer', fontSize: 12 }}
            >
              Orders
            </button>
            <button
              onClick={async () => { setShowHistory(true); await fetchStatusHistory(); }}
              style={{ background: '#374151', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 10px', cursor: 'pointer', fontSize: 12 }}
            >
              History
            </button>
          </div>
        </div>

        {/* Sidebar body */}
        {tab === 'foods' ? (
          <>
            {false && isAdmin && (
              <button
                onClick={handleAddMenu}
                style={{ background: '#2563eb', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 10px', cursor: 'pointer', fontSize: 12, width: '100%', marginBottom: 10 }}
                title="Add a new menu"
              >
                + Add menu
              </button>
            )}

            {sidebarTypesWithFallback.map((type) => {
              const active = selectedType === type;
              return (
                <div
                  key={type}
                  onClick={() => setSelectedType(type)}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                    padding: '10px 12px', background: active ? '#4b5563' : '#1f2937',
                    borderRadius: 8, marginBottom: 8, cursor: 'pointer', userSelect: 'none',
                  }}
                >
                  <span style={{ fontSize: 14 }}>{type}</span>
                </div>
              );
            })}

            {/* Sold out */}
            <div
              onClick={() => setSelectedType(SOLD_OUT_KEY)}
              style={{ padding: '10px 12px', background: selectedType === SOLD_OUT_KEY ? '#4b5563' : '#1f2937', borderRadius: 8, marginTop: 12, cursor: 'pointer', userSelect: 'none' }}
            >
              {SOLD_OUT_MENU}
            </div>
          </>
        ) : tab === 'orders' ? (
  // Orders sidebar
  <div style={{ display: 'grid', gap: 8 }}>
    <div style={{ fontWeight: 700, marginBottom: 6 }}>Order filters</div>

    {/* Search member number / customer name */}
    <label style={{ fontSize: 12, color: '#9ca3af' }}>
      Search member / customer
    </label>

    <input
      value={orderCustomerSearch}
      onChange={(e) => {
        setOrderCustomerSearch(e.target.value);
        setActiveTable(null);
      }}
      placeholder="VD: 01, 1613, Tech Vegas..."
      style={{
        padding: 8,
        background: '#1f2937',
        color: '#fff',
        border: '1px solid #374151',
        borderRadius: 6,
      }}
    />

    {orderCustomerSearch.trim() && (
      <button
        onClick={() => {
          setOrderCustomerSearch('');
          setActiveTable(null);
        }}
        style={{
          padding: 8,
          borderRadius: 6,
          border: '1px solid #4b5563',
          background: '#374151',
          color: '#fff',
          cursor: 'pointer',
        }}
      >
        Clear search
      </button>
    )}

    <div style={{ fontWeight: 700, marginTop: 10 }}>Date range</div>

            <select
              value={dateRange}
              onChange={(e) => setDateRange(e.target.value)}
              style={{ padding: 8, background: '#1f2937', color: '#fff', border: '1px solid #374151', borderRadius: 6 }}
            >
              <option value="today">Today</option>
              <option value="yesterday">Yesterday</option>
              <option value="week">This week</option>
              <option value="month">This month</option>
              <option value="year">This year</option>
              <option value="custom">Custom…</option>
            </select>

            {dateRange === 'custom' && (
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input type="date" value={fromDate} onChange={(e)=>setFromDate(e.target.value)}
                      style={{ padding: 8, background: '#1f2937', color: '#fff', border: '1px solid #374151', borderRadius: 6 }} />
                <span style={{ color:'#9ca3af' }}>→</span>
                <input type="date" value={toDate} onChange={(e)=>setToDate(e.target.value)}
                      style={{ padding: 8, background: '#1f2937', color: '#fff', border: '1px solid #374151', borderRadius: 6 }} />
              </div>
            )}

            <select
              value={orderFilter}
              onChange={(e) => { setOrderFilter(e.target.value); setActiveTable(null); }}
              style={{ padding: '8px', background: '#1f2937', color: '#fff', border: '1px solid #374151', borderRadius: 6 }}
            >
              {ORDER_FILTERS.map(f => <option key={f} value={f}>{f}</option>)}
            </select>

            <label style={{ fontSize: 12, color: '#9ca3af' }}>Sort by</label>
            <select
              value={orderSort}
              onChange={(e) => setOrderSort(e.target.value)}
              style={{ padding: '8px', background: '#1f2937', color: '#fff', border: '1px solid #374151', borderRadius: 6 }}
            >
              <option value="time_desc">Time: Newest → Oldest</option>
              <option value="time_asc">Time: Oldest → Newest</option>
              <option value="table_asc">Table: A→Z • 1→9</option>
              <option value="table_desc">Table: Z→A • 9→1</option>
            </select>

            <label style={{ display:'flex', alignItems:'center', gap:8, fontSize:12, color:'#9ca3af' }}>
              <input
                type="checkbox"
                checked={autoPrint}
                onChange={(e)=>setAutoPrint(e.target.checked)}
              />
              Auto print new orders
            </label>

            <button
              onClick={fetchOrders}
              disabled={ordersLoading}
              style={{ background: ordersLoading ? '#6b7280' : '#2563eb', color: '#fff', border: 'none', borderRadius: 6, padding: '8px', cursor: ordersLoading ? 'not-allowed' : 'pointer', fontSize: 12 }}
            >
              {ordersLoading ? 'Refreshing…' : 'Refresh'}
            </button>

            {/* AGENT */}
            <div style={{marginTop:12, paddingTop:8, borderTop:'1px dashed #374151'}}>
              <div style={{fontWeight:700, marginBottom:6}}>Printer Agent</div>
              <div style={{ fontSize: 12, color: '#9ca3af', marginBottom: 6 }}>
                Status: {agentStatus} {agentBase ? `• ${agentBase}` : ''}
              </div>
              <div style={{display:'flex', gap:6}}>
                <input
                  value={agentBase}
                  onChange={(e)=>setAgentBase(e.target.value)}
                  onBlur={(e)=>{ const v=e.target.value.replace(/\/+$/,''); localStorage.setItem('printAgent', v); setAgentBase(v); }}
                  placeholder={`http://${window.location.hostname || 'host'}:${AGENT_PORT}`}
                  style={{flex:1, padding:8, background:'#1f2937', color:'#fff', border:'1px solid #374151', borderRadius:6}}
                />
                <button
                  onClick={()=>detectAgent(false)}
                  style={{padding:'8px 10px', background:'#334155', color:'#fff', border:'none', borderRadius:6, cursor:'pointer', fontSize:12}}
                >
                  Detect
                </button>
              </div>

              <button
                onClick={async ()=>{
                  try {
                    await printOrderSmart({
                      id: 'TEST', createdAt: Date.now(),
                      area: 'DEV', tableNo: '00', staff: 'ADMIN', memberCard: '', note: 'Test print',
                      items: [{ imageName:'DEMO', qty:1 }]
                    });
                    alert('Đã gửi lệnh in test.');
                  } catch(e) {
                    alert('In test lỗi: ' + (e?.message || e));
                  }
                }}
                style={{marginTop:8, padding:'8px 10px', background:'#111', color:'#fff', border:'none', borderRadius:6, cursor:'pointer', fontSize:12}}
              >
                Test print
              </button>
            </div>
          </div>
          ) : null}
      
      </div>

      {/* Main */}
{tab === 'foods' ? (
  <div
    style={{
      padding: 16,
      background: '#fff8dc',
      overflowY: 'auto',
      height: '100%',          // đảm bảo vùng này là vùng scroll
    }}
  >
    {/* THANH TIÊU ĐỀ + SEARCH + QUẢN LÝ — STICKY */}
    <div
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 10,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        marginBottom: 12,
        paddingBottom: 8,
        background: '#fff8dc',  // cùng màu nền để không bị trong suốt
      }}
    >
      <h2 style={{ margin: 0 }}>
        {selectedType === SOLD_OUT_KEY ? SOLD_OUT_MENU : selectedType}
      </h2>

      {selectedType !== SOLD_OUT_KEY && isAdmin && (
        <>
          {/* các nút Add item / Apply levels / Delete menu đang để false nên không hiện */}
        </>
      )}

      <input
        type="text"
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        placeholder="Search…"
        style={{
          flex: 1,
          maxWidth: 260,
          padding: '6px 8px',
          borderRadius: 6,
          border: '1px solid #d1d5db',
          fontSize: 14,
        }}
      />


    </div>

    {/* Phần dưới vẫn giữ nguyên: modal quản lý, level selector, grid món */}
    {showManage && (
      <ManageProductsModal
        onClose={() => setShowManage(false)}
        apiUrl={apiUrl}
        resolveImg={resolveImg}
        socket={socket}
        ALL_LEVELS={ALL_LEVELS}
      />
    )}


          {/* Access levels được quản lý tập trung trong Quản lý → Hàng hóa. */}

          {/* Grid */}
          <div style={{ display: 'flex', flexWrap: 'wrap' }}>
            {foodsForDisplay.map((food) => {
              const toSoldOut = food.status === 'Available';
              // Nút thể hiện HÀNH ĐỘNG kế tiếp; badge bên cạnh thể hiện TRẠNG THÁI hiện tại.
              const toggleLabel = toSoldOut ? 'Sold out' : 'In stock';
              const currentStatusLabel = toSoldOut ? 'IN STOCK' : 'SOLD OUT';
              const statusTextColor = toSoldOut ? '#065f46' : '#991b1b';
              const statusDotColor  = toSoldOut ? '#10b981' : '#ef4444';

              return (
                <div
                  key={getImageName(food.imageUrl) || `food-${food.id}`}
                  draggable={isAdmin}
onDragStart={(e) => {
  if (!isAdmin) return;

  setDraggedId(String(food.id));

  try {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(food.id));
  } catch {}
}}
onDragEnd={() => setDraggedId(null)}
onDragOver={(e) => {
  if (!isAdmin) return;
  e.preventDefault();

  try {
    e.dataTransfer.dropEffect = 'move';
  } catch {}
}}
onDrop={(e) => {
  if (!isAdmin) return;
  e.preventDefault();
  handleDrop(food.id);
}}
                  style={{
                    width: 220,
                    display: 'flex',
                    flexDirection: 'column',
                    border: '1px solid #e5e7eb',
                    borderRadius: 10,
                    overflow: 'visible',
                    background: '#fff',
                    marginRight: 12,
                    marginBottom: 12,
                    boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
                  }}
                >
                  {/* Image */}
                  <div style={{ width: '100%', overflow: 'visible', background: '#fff', position: 'relative' }}>
                    <img
  src={resolveImg(food.imageUrl)}
  alt=""
  draggable={false}
  onDragStart={(e) => e.preventDefault()}
  style={{
    width: '100%',
    height: 'auto',
    display: 'block',
    userSelect: 'none',
    WebkitUserDrag: 'none',
  }}
/>
{isAdmin && (
  <div
    style={{
      position: 'absolute',
      left: 8,
      bottom: 8,
      background: 'rgba(17,24,39,0.9)',
      color: '#fff',
      padding: '2px 7px',
      fontSize: 12,
      borderRadius: 999,
      fontWeight: 700,
      pointerEvents: 'none',
    }}
  >
    ↕ Drag
  </div>
)}
                  </div>

                  {/* Action row */}
                  <div
                    style={{
                      padding: 10,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 10,
                    }}
                  >
                    {(isAdmin || isKitchen) && (
                      <button
                        onClick={() => handleToggleStatus(food.id, food.status)}
                        style={{
                          padding: '6px 10px',
                          background: toSoldOut ? '#f59e0b' : '#10b981',
                          color: '#fff',
                          border: 'none',
                          borderRadius: 8,
                          cursor: 'pointer',
                          fontSize: 12,
                          whiteSpace: 'nowrap',
                        }}
                        title={toSoldOut ? 'Đánh dấu món đã hết' : 'Đánh dấu món đã có lại'}
                      >
                        {toggleLabel}
                      </button>
                    )}

                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                        fontSize: 12,
                        fontWeight: 700,
                        color: statusTextColor,
                        whiteSpace: 'nowrap',
                        marginLeft: isAdmin ? 0 : 'auto',
                      }}
                      title={`Trạng thái hiện tại: ${food.status}`}
                    >
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: statusDotColor, display: 'inline-block' }} />
                      {currentStatusLabel}
                    </span>
                  </div>

                                </div>
              );
            })}

            {foodsForDisplay.length === 0 && (
              <div style={{ color: '#6b7280', padding: 12 }}>No items to display.</div>
            )}
          </div>
        </div>
      ) : tab === 'orders' ? (
        // ====== ORDERS MAIN ======
        <div style={{ padding: 16, background: '#fff8dc', overflow: 'hidden', display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 420px', gap: 12, minHeight: 0 }}>
          {/* Left: table tiles */}
          <div style={{ overflowY: 'auto', paddingRight: 4, minHeight: 0, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
              <h2 style={{ margin: 0 }}>Orders</h2>
              <span style={{ fontSize: 12, color: '#555' }}>
                {ordersLoading ? 'Loading… • ' : ''}
                {filteredOrders.length} order(s) • {
                  (() => {
                    const ts = new Set(filteredOrders.map(o => tableKeyOf(o.area, o.tableNo)));
                    return ts.size;
                  })()
                } table(s)
                {ordersError ? ` • Error: ${ordersError}` : ''}
              </span>
            </div>

            {(() => {
              const openStatuses = new Set([ORDER_STATUS.PENDING, ORDER_STATUS.IN_PROGRESS]);
              const grouped = new Map();
              for (const o of filteredOrders) {
                const k = tableKeyOf(o.area, o.tableNo);
                if (!grouped.has(k)) grouped.set(k, { area: o.area, tableNo: o.tableNo, orders: [], latestAt: new Date(0) });
                const g = grouped.get(k);
                g.orders.push(o);
                const t = o.createdAt ? new Date(o.createdAt) : new Date(0);
                if (t > g.latestAt) g.latestAt = t;
              }
              const arr = Array.from(grouped.values());
              // Sắp xếp theo lựa chọn
 arr.sort((a, b) => {
   switch (orderSort) {
     case 'time_asc':  return a.latestAt - b.latestAt;
     case 'table_asc': {
       const ac = String(a.area || '').localeCompare(String(b.area || ''));
       if (ac) return ac;
       return Number(a.tableNo) - Number(b.tableNo);
     }
     case 'table_desc': {
       const ac = String(b.area || '').localeCompare(String(a.area || ''));
       if (ac) return ac;
       return Number(b.tableNo) - Number(a.tableNo);
     }
     case 'time_desc':
     default: return b.latestAt - a.latestAt;
   }
 });

              if (arr.length === 0) return <div style={{ color: '#6b7280', padding: 12 }}>No orders for current filter.</div>;

              return (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}>
                  {arr.map(t => {
                    const tk = tableKeyOf(t.area, t.tableNo);
                    const isActive = activeTable && tableKeyOf(activeTable.area, activeTable.tableNo) === tk;
                    const openCount = t.orders.filter(o => openStatuses.has(o.status)).length;
                    const lastAt = t.latestAt ? t.latestAt.toLocaleTimeString() : '';
                    return (
                      <div
                        key={tk}
                        onClick={() => setActiveTable({ area: t.area, tableNo: t.tableNo })}
                        style={{
                          border: '1px solid #e5e7eb',
                          borderRadius: 10,
                          background: isActive ? '#fef3c7' : '#fff',
                          padding: 12,
                          cursor: 'pointer',
                        }}
                      >
                        <div style={{ fontWeight: 700, marginBottom: 4 }}>{t.area}</div>
                        <div style={{ fontSize: 24, fontWeight: 800 }}>Table {t.tableNo}</div>
                        <div style={{ fontSize: 12, color: '#6b7280' }}>{t.orders.length} order(s)</div>
                        {openCount > 0 && (
                          <div style={{ marginTop: 6, fontSize: 12, background: '#fef08a', padding: '2px 6px', borderRadius: 999, display: 'inline-block' }}>
                            Open: {openCount}
                          </div>
                        )}
                        {lastAt && <div style={{ fontSize: 10, color: '#6b7280', marginTop: 6 }}>Last: {lastAt}</div>}
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>

          {/* Right: details panel */}
          <div style={{ overflowY: 'auto', border: '1px solid #e5e7eb', borderRadius: 10, background: '#fff', minHeight: 0 }}>
{!activeTable ? (
  <div style={{ padding: 12 }}>
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 13, color: '#6b7280', fontWeight: 700 }}>
        Latest Orders
      </div>

      <div style={{ fontSize: 28, fontWeight: 900, color: '#111827' }}>
        {ordersLoading ? 'Loading…' : `${filteredOrders.length} order(s)`}
      </div>

      <div style={{ fontSize: 12, color: '#6b7280' }}>
        Đơn mới nhất nằm trên cùng. Bấm vào bàn bên trái để xem riêng từng bàn.
      </div>
    </div>

    {filteredOrders.length === 0 ? (
      <div style={{ color: '#6b7280', padding: 12, background: '#f9fafb', borderRadius: 10 }}>
        Không có order phù hợp bộ lọc hiện tại.
      </div>
    ) : (
      <div style={{ display: 'grid', gap: 12 }}>
        {filteredOrders.slice(0, 100).map((o) => {
          const pillStyle = {
            PENDING: { bg: '#fee2e2', fg: '#991b1b', label: 'PENDING' },
            IN_PROGRESS: { bg: '#dbeafe', fg: '#1d4ed8', label: 'IN PROGRESS' },
            DONE: { bg: '#dcfce7', fg: '#065f46', label: 'DONE' },
            CANCELLED: { bg: '#f3f4f6', fg: '#374151', label: 'CANCELLED' },
          }[o.status] || { bg: '#eee', fg: '#333', label: o.status };

          return (
            <div
              key={o.id}
              onClick={() => setActiveTable({ area: o.area, tableNo: o.tableNo })}
              style={{
                border: '1px solid #dbe3ee',
                borderRadius: 14,
                overflow: 'hidden',
                cursor: 'pointer',
                boxShadow: '0 4px 12px rgba(0,0,0,.06)',
                background: '#fff',
              }}
            >
              <div
                style={{
                  padding: 12,
                  background: '#111827',
                  color: '#fff',
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 10,
                }}
              >
                <div>
                  <div style={{ fontSize: 22, fontWeight: 900 }}>
                    Table {o.tableNo || '---'}
                  </div>
                  <div style={{ fontSize: 12, opacity: 0.82 }}>
                    {o.area || 'No area'} • Order #{o.id}
                  </div>
                </div>

                <div style={{ textAlign: 'right' }}>
                  <div
                    style={{
                      display: 'inline-block',
                      fontSize: 12,
                      background: pillStyle.bg,
                      color: pillStyle.fg,
                      padding: '3px 8px',
                      borderRadius: 999,
                      fontWeight: 800,
                    }}
                  >
                    {pillStyle.label}
                  </div>
                  <div style={{ fontSize: 11, marginTop: 5, opacity: 0.85 }}>
                    {o.createdAt ? new Date(o.createdAt).toLocaleString() : ''}
                  </div>
                </div>
              </div>

              <div style={{ padding: 12, background: '#fff' }}>
                <div style={{ fontSize: 14, color: '#374151', marginBottom: 6 }}>
                  Staff: <b style={{ color: '#111827' }}>{getOrderStaffDisplay(o)}</b>
                </div>
                {renderOrderIpadLine(o, { marginBottom: 8 })}

                <div
                  style={{
                    marginBottom: 10,
                    padding: '8px 10px',
                    border: '1px solid #fed7aa',
                    borderRadius: 9,
                    background: '#fff7ed',
                    color: '#9a3412',
                    fontSize: 15,
                    lineHeight: 1.35,
                  }}
                >
                  Customer: <b style={{ fontSize: 16 }}>{getOrderCustomerDisplay(o)}</b>
                </div>

                {renderAdminOrderItems(o)}

                <div style={{ marginTop: 10, fontSize: 13, color: '#374151' }}>
                  Table:{' '}
                  <b style={{ color: tableStatusColorOf(o) }}>
                    {tableStatusTextOf(o)}
                  </b>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    )}
  </div>
) : (
              <div style={{ padding: 12 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
                  <div>
                    <div style={{ fontWeight: 700, color: '#374151' }}>{activeTable.area}</div>
                    <div style={{ fontSize: 28, fontWeight: 800 }}>Table {activeTable.tableNo}</div>
                  </div>
                  <button
                    onClick={() => setActiveTable(null)}
                    style={{ border: 'none', background: '#ef4444', color: '#fff', padding: '6px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}
                  >
                    Close
                  </button>
                </div>

                {(() => {
                  const key = tableKeyOf(activeTable.area, activeTable.tableNo);
 const list = filteredOrders
   .filter(o => tableKeyOf(o.area, o.tableNo) === key)
   .sort((a, b) => {
     const ta = new Date(a.createdAt), tb = new Date(b.createdAt);
     return (orderSort === 'time_asc') ? (ta - tb) : (tb - ta);
   });

                  if (list.length === 0) return <div style={{ color: '#6b7280', padding: 8 }}>Không có order phù hợp bộ lọc.</div>;

                  return (
                    <div style={{ display: 'grid', gap: 10 }}>
                      {list.map((o) => {
                        const pillStyle = {
                          PENDING: { bg: '#fee2e2', fg: '#991b1b', label: 'PENDING' },
                          IN_PROGRESS: { bg: '#dbeafe', fg: '#1d4ed8', label: 'IN PROGRESS' },
                          DONE: { bg: '#dcfce7', fg: '#065f46', label: 'DONE' },
                          CANCELLED: { bg: '#f3f4f6', fg: '#374151', label: 'CANCELLED' },
                        }[o.status] || { bg: '#eee', fg: '#333', label: o.status };

                        return (
                          <div
                            key={o.id}
                            style={{
                              border: '1px solid #dbe3ee',
                              borderRadius: 12,
                              overflow: 'hidden',
                              background: '#fff',
                              boxShadow: '0 3px 10px rgba(0,0,0,.05)',
                            }}
                          >
                            <div
                              style={{
                                padding: 14,
                                background: '#f8fafc',
                                borderBottom: '1px solid #e5e7eb',
                              }}
                            >
                              <div
                                style={{
                                  display: 'flex',
                                  alignItems: 'flex-start',
                                  justifyContent: 'space-between',
                                  gap: 10,
                                }}
                              >
                                <div>
                                  <div style={{ fontSize: 22, fontWeight: 900, color: '#111827' }}>
                                    Order #{o.id}
                                  </div>
                                  <div style={{ marginTop: 2, fontSize: 13, color: '#6b7280' }}>
                                    {o.createdAt ? new Date(o.createdAt).toLocaleString() : ''}
                                  </div>
                                </div>

                                <div
                                  style={{
                                    fontSize: 12,
                                    background: pillStyle.bg,
                                    color: pillStyle.fg,
                                    padding: '4px 9px',
                                    borderRadius: 999,
                                    fontWeight: 800,
                                    whiteSpace: 'nowrap',
                                  }}
                                >
                                  {pillStyle.label}
                                </div>
                              </div>

                              <div style={{ marginTop: 12, display: 'grid', gap: 7 }}>
                                <div style={{ fontSize: 16, color: '#374151' }}>
                                  Staff: <b style={{ color: '#111827' }}>{getOrderStaffDisplay(o)}</b>
                                </div>
                                {renderOrderIpadLine(o, { fontSize: 15 })}

                                <div
                                  style={{
                                    padding: '9px 10px',
                                    border: '1px solid #fed7aa',
                                    borderRadius: 9,
                                    background: '#fff7ed',
                                    color: '#9a3412',
                                    fontSize: 16,
                                    lineHeight: 1.35,
                                  }}
                                >
                                  Customer: <b style={{ fontSize: 17 }}>{getOrderCustomerDisplay(o)}</b>
                                </div>

                                <div style={{ fontSize: 15, color: '#374151' }}>
                                  Table:{' '}
                                  <b style={{ color: tableStatusColorOf(o) }}>
                                    {tableStatusTextOf(o)}
                                  </b>
                                  {o.tableClosed && o.closedAt ? (
                                    <span style={{ color: '#9ca3af', fontSize: 12 }}>
                                      {' '}• {new Date(o.closedAt).toLocaleString()}
                                    </span>
                                  ) : null}
                                </div>
                              </div>
                            </div>

                            <div style={{ padding: 12 }}>
                              <div
                                style={{
                                  marginBottom: 8,
                                  fontSize: 12,
                                  fontWeight: 800,
                                  color: '#6b7280',
                                  textTransform: 'uppercase',
                                  letterSpacing: 0.5,
                                }}
                              >
                                Order items
                              </div>

                              {renderAdminOrderItems(o, { allowOffMenuPrice: isAdmin })}

                              {o.note && (
                                <div
                                  style={{
                                    marginTop: 10,
                                    padding: '8px 10px',
                                    fontSize: 13,
                                    color: '#374151',
                                    background: '#f9fafb',
                                    borderRadius: 8,
                                  }}
                                >
                                  📝 {o.note}
                                </div>
                              )}

                              {(o.status === ORDER_STATUS.CANCELLED && o.cancelReason) && (
                                <div style={{ marginTop: 10, fontSize: 13, color: '#991b1b' }}>
                                  ❌ Lý do hủy: <b>{o.cancelReason}</b>
                                </div>
                              )}

                              {(o.status === ORDER_STATUS.PENDING || o.status === ORDER_STATUS.IN_PROGRESS) && (
                                <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                                  <button
                                    onClick={() => printOrderSmart(o)}
                                    style={{ padding: '7px 11px', background: '#111', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 700 }}
                                    title="In bill cho bếp"
                                  >
                                    Print
                                  </button>

                                  {o.status === ORDER_STATUS.PENDING && (
                                    <button
                                      onClick={() => setOrderStatus(o.id, ORDER_STATUS.IN_PROGRESS)}
                                      style={{ padding: '7px 11px', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 700 }}
                                    >
                                      Start
                                    </button>
                                  )}

                                  <button
                                    onClick={() => setOrderStatus(o.id, ORDER_STATUS.DONE)}
                                    style={{ padding: '7px 11px', background: '#10b981', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 700 }}
                                  >
                                    Done
                                  </button>

                                  <button
                                    onClick={async () => {
                                      const reason = window.prompt('Lý do hủy đơn?', '');
                                      if (reason == null) return;
                                      await setOrderStatus(o.id, ORDER_STATUS.CANCELLED, reason);
                                    }}
                                    style={{ padding: '7px 11px', background: '#ef4444', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 700 }}
                                  >
                                    Cancel
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
        </div>
        ) : null}

      {/* ===== Status History Modal ===== */}
      {showHistory && (
        <div
          onClick={() => setShowHistory(false)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ width: '90vw', maxWidth: 900, maxHeight: '80vh', overflow: 'auto', background: '#fff', borderRadius: 10, padding: 16 }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <h3 style={{ margin: 0 }}>📜 Status History</h3>
              <button onClick={() => setShowHistory(false)} style={{ border: 'none', background: '#ef4444', color: '#fff', padding: '6px 10px', borderRadius: 6, cursor: 'pointer' }}>Close</button>
            </div>

            {/* Filters */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
              <input type="date" onChange={(e) => applyHistFilters({ from: e.target.value || undefined })} />
              <input type="date" onChange={(e) => applyHistFilters({ to: e.target.value || undefined })} />
              <input placeholder="User" onBlur={(e) => applyHistFilters({ user: e.target.value || undefined })} style={{ border: '1px solid #ddd', borderRadius: 6, padding: '6px 8px' }} />
              <input placeholder="Type (optional)" onBlur={(e) => applyHistFilters({ type: e.target.value || undefined })} style={{ border: '1px solid #ddd', borderRadius: 6, padding: '6px 8px' }} />
              <select onChange={(e) => applyHistFilters({ toStatus: e.target.value || undefined })} defaultValue="">
                <option value="">-- New status --</option>
                <option value="Available">Available</option>
                <option value="Sold Out">Sold Out</option>
              </select>
            </div>

            {/* Table */}
            <div style={{ border: '1px solid #eee', borderRadius: 8, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead style={{ background: '#f9fafb' }}>
                  <tr>
                    <th style={th}>Time</th>
                    <th style={th}>User</th>
                    <th style={th}>Image</th>
                    <th style={th}>Image name</th>
                    <th style={th}>From → To</th>
                  </tr>
                </thead>
                <tbody>
                  {historyLoading ? (
                    <tr><td colSpan={5} style={{ padding: 12, textAlign: 'center' }}>Loading…</td></tr>
                  ) : historyRows.length === 0 ? (
                    <tr><td colSpan={5} style={{ padding: 12, textAlign: 'center' }}>No history yet</td></tr>
                  ) : historyRows.map((h, idx) => (
                    <tr key={h.id || idx} style={{ borderTop: '1px solid #f1f5f9' }}>
                      <td style={td}>{new Date(h.at).toLocaleString()}</td>
                      <td style={td}>{h.by}</td>
                      <td style={{ ...td }}>
                        {h.imageUrl
                          ? <img src={resolveImg(h.imageUrl)} alt="" style={{ width: 60, height: 60, objectFit: 'cover', borderRadius: 6, border: '1px solid #eee' }} />
                          : (h.imageName || '')}
                      </td>
                      <td style={td}>{h.imageName || ''}</td>
                      <td style={td}>
                        <span style={{ color: h.from === 'Available' ? '#065f46' : '#991b1b' }}>{h.from}</span>
                        {' '}→{' '}
                        <span style={{ color: h.to === 'Available' ? '#065f46' : '#991b1b' }}>{h.to}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
      {isLoggedIn && (
        <AIChatBox
          mode={isAdmin ? 'admin' : 'user'}
          apiUrl={apiUrl}
          token={auth?.token || ''}
        />
      )}

      {reloadPending && (
  <div style={{
    position:'fixed', right:16, bottom:16, background:'#111', color:'#fff',
    padding:'10px 12px', borderRadius:8, zIndex:10000, boxShadow:'0 6px 20px rgba(0,0,0,0.25)'
  }}>
    <div style={{ marginBottom:8 }}>Có bản cập nhật mới.</div>
    <div style={{ display:'flex', gap:8, justifyContent:'flex-end' }}>
      <button
        type="button"
        onClick={() => setReloadPending(false)}
        style={{ background:'#fff', color:'#111', border:'1px solid #e5e7eb', borderRadius:6, padding:'6px 10px', fontSize:12 }}
      >
        Để sau
      </button>
      <button
        type="button"
        onClick={() => window.location.reload()}
        style={{ background:'#10b981', color:'#fff', border:'none', borderRadius:6, padding:'6px 10px', fontSize:12 }}
      >
        Tải lại
      </button>
    </div>
  </div>
)}

    </div>
  );
}



