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
import io from 'socket.io-client';
import axios from 'axios';

// ===== Limit concurrent axios requests to avoid net::ERR_INSUFFICIENT_RESOURCES =====
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

const TOKEN_KEY = 'food-admin-token';

axios.interceptors.response.use(
  (res) => {
    __axios_done();
    return res;
  },
  (error) => {
    __axios_done();
    const status = error?.response?.status;
    if (status === 401) {
      // Phiên đăng nhập hết hạn / token hỏng
      localStorage.removeItem(TOKEN_KEY);
      alert('Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại.');
      window.location.reload();
    }
    return Promise.reject(error);
  }
);





// ===== API & Socket =====
const API =
  process.env.REACT_APP_API_URL ||
  process.env.REACT_APP_API_BASE ||
  '';
const socket = API ? io(API) : io();

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

const getImageName = (url) => (url || '').split('/').pop()?.toLowerCase() || '';
const tableKeyOf = (area, tableNo) => `${area}#${tableNo}`;

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
      const raw = localStorage.getItem('auth');
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed?.token) setAuthHeader(parsed.token);
      return parsed;
    } catch { return null; }
  });
  const isLoggedIn = !!auth?.token;
  const role = auth?.role; // 'admin' | 'kitchen'
  const isAdmin = role === 'admin';
  const isKitchen = role === 'kitchen';

  // ===== App state =====
  const [foods, setFoods] = useState([]);
  const [selectedType, setSelectedType] = useState('SNACK MENU');
  const [draggedId, setDraggedId] = useState(null);
  const [bulkDeleting, setBulkDeleting] = useState(false);
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
  if (foodsReqRef.current) return foodsReqRef.current; // nếu đang chạy, trả về promise cũ
  foodsReqRef.current = (async () => {
    try {
      const res = await axios.get(apiUrl('/api/foods'));
      const data = res.data || [];
      setFoods(data);
      setApiError(null);
      return data;
    } catch (e) {
      setApiError(e?.message || 'API error');
      setFoods([]);
      return [];
    } finally {
      foodsReqRef.current = null; // mở khoá
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

  // âm báo + giọng đọc
  const playBeep = useCallback(() => {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      const ctx = new AC();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = 880;
      o.connect(g); g.connect(ctx.destination);
      g.gain.setValueAtTime(0.0001, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.5);
      o.start(); o.stop(ctx.currentTime + 0.5);
    } catch {}
  }, []);
  const speakName = useCallback((raw) => {
    const s = String(raw || '').trim();
    const noExt = s.replace(/\.(jpg|jpeg|png|gif|webp)$/i, '');
    const m = noExt.match(/^([A-Za-z]+\d+|\d+[A-Za-z]+)/);
    if (m) return m[1].toUpperCase();
    return noExt.replace(/[-_.]+/g, ' ').trim().toLowerCase();
  }, []);
  const speakSequence = useCallback((arr, gapMs = 1000) => {
    if (!('speechSynthesis' in window)) { playBeep(); return; }
    let t = 0;
    arr.forEach((txt) => {
      const u = new SpeechSynthesisUtterance(String(txt || '').replace(/[-_.]/g, ' '));
      u.lang = 'vi-VN';
      u.rate = 0.8;
      setTimeout(() => window.speechSynthesis.speak(u), t);
      t += gapMs;
    });
  }, [playBeep]);
const humanizeName = useCallback((s) =>
  String(s||'')
    .replace(/\.(jpe?g|png|gif|webp|bmp|tiff?|jfif|heic|heif)$/i,'')
    .replace(/[-_.]+/g,' ')
    .replace(/\s{2,}/g,' ')
    .trim()
, []);
  // ====== Print (dialog fallback) ======
  
 
const printDialog = useCallback((o) => {
  try {
    const w = window.open('', '_blank', 'width=480,height=640');
    if (!w) return alert('Trình duyệt đang chặn popup. Hãy cho phép để in.');
    const esc = (s) => String(s ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    const rows = (o.items || [])
      .map(it => `<tr><td style="padding:4px 0; width:32px;">x${it.qty}</td><td style="padding:4px 0;">${esc(humanizeName(it.name || it.imageName || it.imageKey))}</td></tr>`)
      .join('');
      const sName = staffMap[o.staff] || '';
      const staffDisplay = o.staff ? (sName ? `${o.staff} - ${sName}` : o.staff) : '';
      const customerDisplay = o.memberCard
        ? (o.customerName ? `${o.memberCard} - ${o.customerName}` : o.memberCard)
        : (o.customerName || '');
      const html = `
<!doctype html>
<html><head><meta charset="utf-8" /><title>Order #${o.id}</title>
<style>
  @page { size: 80mm auto; margin: 4mm; }
  body { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace; font-size: 12px; }
  .center { text-align: center; } .row { display:flex; justify-content:space-between; }
  .bold { font-weight:700; } hr { border: none; border-top: 1px dashed #000; margin: 8px 0; }
  table { width: 100%; border-collapse: collapse; } td { vertical-align: top; }
</style></head>
<body onload="window.print(); setTimeout(()=>window.close(), 300);">
  <div class="center bold">KITCHEN ORDER</div>
  <div class="center">#${o.id} • ${new Date(o.createdAt).toLocaleString()}</div>
  <hr />
  <div class="row"><span>Area</span><span class="bold">${o.area}</span></div>
  <div class="row"><span>Table</span><span class="bold">${o.tableNo}</span></div>
 <div class="row"><span>Staff</span><span>${esc(staffDisplay)}</span></div>
<div class="row"><span>Customer</span><span>${esc(customerDisplay)}</span></div>

  ${o.customerName ? `<div class="row"><span>Customer</span><span>${esc(o.customerName)}</span></div>` : ''}
  ${o.note ? `<div>Note: ${esc(o.note)}</div>` : ''}
  <hr />
  <table>${rows}</table>
  <hr />
  <div class="center">— thank you —</div>
</body></html>`;
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

  const printOrderSmart = useCallback(async (o) => {
    try { await printOrderAgent(o); return; }
    catch (e) { console.warn('[Agent] print fail:', e?.message || e); }
    printDialog(o);
  }, [printOrderAgent, printDialog]);

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
  const [productCodeByImage, setProductCodeByImage] = useState({});
  const [autoPrint, setAutoPrint] = useState(() => {
    const raw = localStorage.getItem('autoPrint');
    return raw ? raw === 'true' : true;
  });
  useEffect(() => { localStorage.setItem('autoPrint', String(autoPrint)); }, [autoPrint]);
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

      // Nếu backend sau này có trả sẵn productCode / code thì ưu tiên dùng
      const direct = (item.productCode || item.code || '').toString().trim();
      if (direct) return direct;

      // Map theo imageName
      const img = getImageName(item.imageUrl || item.imageName || item.imageKey || '');
      if (img && productCodeByImage[img]) return productCodeByImage[img];

      return '';
    },
    [productCodeByImage]
  );


  const buildRange = useCallback(() => {
    const startOfDay = (d) => { const x = new Date(d); x.setHours(0,0,0,0); return x; };
    const endOfDay   = (d) => { const x = new Date(d); x.setHours(23,59,59,999); return x; };
    const toISO      = (d) => d.toISOString();

    const now = new Date();
    let from = null, to = null;

    switch (dateRange) {
      case 'today': { from = startOfDay(now); to = endOfDay(now); break; }
      case 'yesterday': {
        const y = new Date(now); y.setDate(y.getDate() - 1);
        from = startOfDay(y); to = endOfDay(y); break;
      }
      case 'week': {
        const d = new Date(now);
        const day = d.getDay();
        const diffToMon = (day + 6) % 7;
        const s = new Date(d); s.setDate(d.getDate() - diffToMon);
        const e = new Date(s); e.setDate(s.getDate() + 6);
        from = startOfDay(s); to = endOfDay(e); break;
      }
      case 'month': {
        const s = new Date(now.getFullYear(), now.getMonth(), 1);
        const e = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        from = startOfDay(s); to = endOfDay(e); break;
      }
      case 'year': {
        const s = new Date(now.getFullYear(), 0, 1);
        const e = new Date(now.getFullYear(), 11, 31);
        from = startOfDay(s); to = endOfDay(e); break;
      }
      case 'custom': {
        if (fromDate) from = startOfDay(new Date(fromDate));
        if (toDate)   to   = endOfDay(new Date(toDate));
        break;
      }
      default: { from = startOfDay(now); to = endOfDay(now); break; }
    }
    return { from: from ? toISO(from) : undefined, to: to ? toISO(to) : undefined };
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
  if (!isLoggedIn || didInitRef.current) return;
  didInitRef.current = true;
    (async () => {
      await fetchFoods();
      setLevelConfig(await fetchMenuLevels());
      if (tab === 'orders') await fetchOrders();
    })();

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
    socket.on('statusHistoryAdded', async () => { if (showHistoryRef.current) await fetchStatusHistory(); });

    const onQty = ({ imageName, quantity }) => {
      const key = String(imageName || '').toLowerCase();
      if (!key) return;
      setFoods((prev) =>
        prev.map((f) =>
          getImageName(f.imageUrl) === key ? { ...f, quantity, status: quantity <= 0 ? 'Sold Out' : 'Available' } : f
        )
      );
    };
    socket.on('foodQuantityUpdated', onQty);

    // ==== orderPlaced ====
    const onOrderPlaced = async ({ order }) => {
      const normalize = (o = {}) => ({ ...o, cancelReason: o.cancelReason ?? o.reason ?? o?.meta?.cancelReason ?? o?.statusReason ?? null });
      const ord = normalize(order || {});
       setOrders(prev => {
   const map = new Map(prev.map(o => [o.id, o]));
   map.set(ord.id, { ...(map.get(ord.id) || {}), ...ord });
   const arr = Array.from(map.values());
   arr.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
   return arr;
 });

      const staff = (ord?.staff || '').toUpperCase();
      const dishNames = (ord?.items || []).map(i => speakName(i.name || i.imageName || i.imageKey));
      speakSequence([staff, ...dishNames], 1000);

      if (autoPrint) {
        try { await printOrderSmart(ord); } catch (e) { console.warn('Auto print failed:', e?.message || e); }
      }
    };

    const onOrderUpdated = (payload = {}) => {
      const { orderId, status, order, reason, cancelReason, area: areaHint, tableNo: tableHint } = payload;
      const reasonFinal = cancelReason ?? reason ?? order?.cancelReason ?? order?.reason ?? null;

      setOrders(prev =>
        prev.map(o => {
          if (o.id !== orderId) return o;
          const merged = { ...o, ...(order || {}), status };
          if (reasonFinal) merged.cancelReason = reasonFinal;
          merged.area = merged.area ?? areaHint ?? o.area;
          merged.tableNo = merged.tableNo ?? tableHint ?? o.tableNo;
          return merged;
        })
      );
    };



    return () => {
      socket.off('foodAdded', debounceFetch);
      socket.off('foodStatusUpdated', debounceFetch);
      socket.off('foodDeleted', debounceFetch);
      socket.off('foodsDeleted', debounceFetch);

      socket.off('foodsReordered', debounceFetch);
      socket.off('foodLevelsUpdated', debounceFetch);

      socket.off('statusHistoryAdded');
      socket.off('foodQuantityUpdated', onQty);
      socket.off('orderPlaced', onOrderPlaced);
      socket.off('orderUpdated', onOrderUpdated);
      socket.off('menuLevelsUpdated', onMenuLevelsUpdated);
    };
}, [
  isLoggedIn, tab,
  fetchFoods, fetchOrders, debounceFetch, fetchStatusHistory,
  printOrderSmart, speakName, speakSequence, autoPrint
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

    // Đọc tên món an toàn (name || imageName || imageKey)
    const staff = (ord?.staff || '').toUpperCase();
    const dishNames = (ord?.items || []).map((i) =>
      speakName(i?.name || i?.imageName || i?.imageKey)
    );
    speakSequence([staff, ...dishNames], 1000);

    // Tự in nếu bật Auto print + chưa in lần nào
    if (autoPrint && !printedRef.has(ord.id)) {
      try {
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
}, [isLoggedIn, autoPrint, printOrderSmart, speakName, speakSequence]);



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
      localStorage.setItem('auth', JSON.stringify(info));
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
    localStorage.removeItem('auth');
    setAuth(null);
    setAuthHeader(null);
  };

  // ===== Actions (toggle, delete, rename, add...) =====
  const handleToggleStatus = async (id, status) => {
    if (!isLoggedIn) return alert('Please sign in.');
    try {
      const newStatus = status === 'Available' ? 'Sold Out' : 'Available';
      await axios.post(apiUrl(`/api/update-status/${id}`), { newStatus });
      setApiError(null);
    } catch (e) {
      setApiError(e?.message || 'API error');
    }
  };

  const handleDeleteFood = async (id) => {
    if (!isAdmin) return alert('Admin only.');
    if (!window.confirm('Delete this item?')) return;
    try {
      await axios.delete(apiUrl(`/api/foods/${id}`));
      setApiError(null);
    } catch (e) {
      setApiError(e?.message || 'API error');
    }
  };

  const handleRenameFood = async (id) => {
    if (!isAdmin) return alert('Admin only.');
    const raw = window.prompt('Enter new name for this item (image):');
    if (raw == null) return;
    const newType = raw.trim();
    if (!newType) return alert('Invalid name.');
    try {
      await axios.post(apiUrl('/api/rename-food'), { id, newType });
      await fetchFoods();
    } catch (err) {
      if (err?.response?.status === 409) {
        alert(err?.response?.data?.error || 'Tên ảnh đã tồn tại, hãy chọn tên khác.');
      } else {
        alert('Rename failed: ' + (err?.response?.data?.error || err?.message || ''));
      }
    }
  };

  const handleDeleteEntireMenu = async (menuType, e) => {
  e?.stopPropagation();
  if (!isAdmin) return alert('Admin only.');
  if (!menuType || menuType === SOLD_OUT_KEY) return;

  if (!window.confirm(`Xóa toàn bộ menu "${menuType}"?`)) return;

  try {
    setBulkDeleting(true);
    await axios.delete(apiUrl(`/api/menu-levels/${encodeURIComponent(menuType)}`));

    // Xóa khỏi customMenus (nếu menu được tạo từ client)
    setCustomMenus(prev => prev.filter(t => t !== menuType));

    // Refresh
    const data = await fetchFoods();
    setLevelConfig(await fetchMenuLevels());

    // Chọn menu kế tiếp hợp lý
    const next =
      MENU_TYPES.find(t => data.some(f => f.type === t)) ||
      data[0]?.type ||
      SOLD_OUT_KEY;
    setSelectedType(next);

    alert(`Đã xóa menu "${menuType}".`);
  } catch (e) {
    setApiError(e?.response?.data?.error || e?.message || 'API error');
  } finally {
    setBulkDeleting(false);
  }
};


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
    if (!draggedId || draggedId === targetId) return;
    const updated = [...foods];
    const i1 = updated.findIndex(f => f.id === draggedId);
    const i2 = updated.findIndex(f => f.id === targetId);
    if (i1 === -1 || i2 === -1) return;
    const [drag] = updated.splice(i1, 1);
    updated.splice(i2, 0, drag);
    const reordered = updated.map((f, idx) => ({ ...f, order: idx }));
    setFoods(reordered);
    try { await axios.post(apiUrl('/api/reorder-foods'), { orderedIds: reordered.map(f => f.id) }); setApiError(null); }
    catch (e) { setApiError(e?.message || 'API error'); }
  };

  // ===== Quantity actions =====
  const changeQty = async (id, delta) => {
    try {
      await axios.post(apiUrl(`/api/update-quantity/${id}`), { op: 'inc', value: delta });
    } catch (e) {
      alert('Update quantity failed: ' + (e?.response?.data?.error || e?.message || ''));
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

  const foodsByType = [];
  const seenNames = new Set();
  for (const f of listRaw) {
    const name = (f.imageUrl || '').split('/').pop() || f.imageUrl;
    if (!seenNames.has(name)) { seenNames.add(name); foodsByType.push(f); }
  }

const normQ = normalize(searchQuery);
const tokens = normQ ? normQ.split(' ') : [];

const foodsForDisplay = normQ
  ? foodsByType.filter((f) => {
      const type = normalize(f.type);
      const img = normalize((f.imageUrl || '').split('/').pop());
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
    if (orderFilter === 'OPEN') {
      return orders.filter(
        o => o.status === ORDER_STATUS.PENDING || o.status === ORDER_STATUS.IN_PROGRESS
      );
    }
    if (orderFilter === 'ALL') return orders;
    return orders.filter(o => o.status === orderFilter);
  }, [orders, orderFilter]);

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
  const currentLevels = levelConfig[selectedType] || [];
  const th = { textAlign: 'left', padding: '10px 12px', fontSize: 12, color: '#374151', borderBottom: '1px solid #e5e7eb' };
  const td = { padding: '8px 12px', fontSize: 12, color: '#111' };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', height: '100vh', overflowX: 'hidden' }}>
      {/* Sidebar */}
      <div style={{ background: '#111', color: '#fff', padding: 16, overflowY: 'auto', overflowX: 'hidden', width: 260, minWidth: 260 }}>
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <h3 style={{ margin: 0 }}>{isAdmin ? 'Admin' : (isKitchen ? 'Kitchen' : 'User')}</h3>
            <button onClick={handleLogout}
              style={{ background: '#ef4444', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 10px', cursor: 'pointer', fontSize: 12 }}>
              Sign out
            </button>
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
                  {isAdmin && (
                    <button
                      onClick={(e) => handleDeleteEntireMenu(type, e)}
                      disabled={bulkDeleting}
                      title="Delete this entire menu (all items & images)"
                      style={{ background: bulkDeleting ? '#6b7280' : '#dc2626', color: '#fff', border: 'none', borderRadius: 6, padding: '4px 8px', fontSize: 12, cursor: bulkDeleting ? 'not-allowed' : 'pointer' }}
                    >
                      🗑️ Delete
                    </button>
                  )}
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
        ) : (
          // Orders sidebar
          <div style={{ display: 'grid', gap: 8 }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Order filters</div>
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
        )}
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

      {isAdmin && (
        <button
          onClick={() => setShowManage(true)}
          style={{
            marginLeft: 8,
            padding: '6px 8px',
            border: '1px solid #e5e7eb',
            borderRadius: 6,
            background: '#fff',
            fontSize: 14,
            cursor: 'pointer',
          }}
          title="Quản lý hàng hóa"
        >
          Quản lý
        </button>
      )}
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


          {/* LEVEL selector */}
          {selectedType !== SOLD_OUT_KEY && (
            <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 12, marginBottom: 16 }}>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>Access levels for this menu</div>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                {ALL_LEVELS.map(lv => {
                  const checked = (currentLevels || []).includes(lv);
                  return (
                    <label key={lv} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, opacity: isAdmin ? 1 : 0.6 }}>
                      <input
                        type="checkbox"
                        disabled={!isAdmin}
                        checked={checked}
                        onChange={() => {
                          if (!isAdmin) return;
                          setLevelConfig(prev => {
                            const cur = new Set((prev[selectedType] || []));
                            if (cur.has(lv)) cur.delete(lv); else cur.add(lv);
                            return { ...prev, [selectedType]: Array.from(cur) };
                          });
                        }}
                      />
                      {lv}
                    </label>
                  );
                })}
              </div>
              <div style={{ marginTop: 8, fontSize: 12, color: '#6b7280' }}>
                “Apply levels” will update <b>all items</b> in this menu; newly added items will also use these levels.
              </div>
            </div>
          )}

          {/* Grid */}
          <div style={{ display: 'flex', flexWrap: 'wrap' }}>
            {foodsForDisplay.map((food) => {
              const toSoldOut = food.status === 'Available';
              const toggleLabel = toSoldOut ? 'Sold out' : 'In stock';
              const statusTextColor = toSoldOut ? '#065f46' : '#991b1b';
              const statusDotColor  = toSoldOut ? '#10b981' : '#ef4444';
              const qty = typeof food.quantity === 'number' ? food.quantity : (food.status === 'Sold Out' ? 0 : 1);

              return (
                <div
                  key={food.id}
                  draggable={isAdmin}
                  onDragStart={() => isAdmin && setDraggedId(food.id)}
                  onDragOver={(e) => isAdmin && e.preventDefault()}
                  onDrop={() => isAdmin && handleDrop(food.id)}
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
                    <img src={resolveImg(food.imageUrl)} alt="" style={{ width: '100%', height: 'auto', display: 'block' }} />
                    {isAdmin && (
                      <div
                        style={{
                          position: 'absolute', right: 8, bottom: 8, background: '#111', color: '#fff',
                          padding: '2px 6px', fontSize: 12, borderRadius: 12, opacity: 0.9,
                        }}
                        title="Quantity"
                      >
                        x{qty}
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
                        title={toSoldOut ? 'Chuyển về SOLD OUT (số lượng → 0)' : 'Chuyển về IN STOCK (nếu đang 0 thì đặt 10)'}
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
                      title={food.status}
                    >
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: statusDotColor, display: 'inline-block' }} />
                      {food.status}
                    </span>
                  </div>

                  {/* Quantity controls — Ẩn với Kitchen */}
                  {isAdmin && (
                    <div style={{ padding: '0 10px 10px', display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center' }}>
                      <button
                        onClick={() => changeQty(food.id, -1)}
                        style={{ width: 34, height: 34, borderRadius: 8, border: '1px solid #e5e7eb', background: '#fff', cursor: 'pointer', fontSize: 16 }}
                        title="Decrease"
                      >−</button>
                      <div
                        style={{ minWidth: 44, textAlign: 'center', padding: '6px 10px', borderRadius: 8, border: '1px solid #e5e7eb', background: '#f9fafb', fontWeight: 700 }}
                        title="Current quantity"
                      >
                        {qty}
                      </div>
                      <button
                        onClick={() => changeQty(food.id, +1)}
                        style={{ width: 34, height: 34, borderRadius: 8, border: '1px solid #e5e7eb', background: '#fff', cursor: 'pointer', fontSize: 16 }}
                        title="Increase"
                      >+</button>
                    </div>
                  )}

                  {isAdmin && (
                    <div style={{ padding: '0 10px 10px', display: 'flex', gap: 6 }}>
                      <button
                        onClick={() => handleRenameFood(food.id)}
                        style={{
                          padding: '6px 10px',
                          background: '#3b82f6',
                          color: '#fff',
                          border: 'none',
                          borderRadius: 8,
                          cursor: 'pointer',
                          fontSize: 12,
                        }}
                        title="Rename this item (image)"
                      >
                        Rename
                      </button>
                      <button
                        onClick={() => handleDeleteFood(food.id)}
                        style={{
                          padding: '6px 10px',
                          background: '#ef4444',
                          color: '#fff',
                          border: 'none',
                          borderRadius: 8,
                          cursor: 'pointer',
                          fontSize: 12,
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </div>
              );
            })}

            {foodsForDisplay.length === 0 && (
              <div style={{ color: '#6b7280', padding: 12 }}>No items to display.</div>
            )}
          </div>
        </div>
      ) : (
        // ====== ORDERS MAIN ======
        <div style={{ padding: 16, background: '#fff8dc', overflow: 'hidden', display: 'grid', gridTemplateColumns: '1fr 420px', gap: 12 }}>
          {/* Left: table tiles */}
          <div style={{ overflowY: 'auto', paddingRight: 4 }}>
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
          <div style={{ overflowY: 'auto', border: '1px solid #e5e7eb', borderRadius: 10, background: '#fff' }}>
            {!activeTable ? (
              <div style={{ padding: 16, color: '#6b7280' }}>{ordersLoading ? 'Loading orders…' : 'Chọn một bàn để xem chi tiết order.'}</div>
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
                          <div key={o.id} style={{ border: '1px solid #e5e7eb', borderRadius: 10, overflow: 'hidden' }}>
                            <div style={{ padding: 10, background: '#f9fafb', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                <div style={{ fontWeight: 700 }}>Order #{o.id}</div>
                                <div style={{ fontSize: 12, color: '#6b7280' }}>{new Date(o.createdAt).toLocaleString()}</div>
                                <div style={{ fontSize: 12, background: pillStyle.bg, color: pillStyle.fg, padding: '2px 8px', borderRadius: 999 }}>
                                  {pillStyle.label}
                                </div>
                              </div>
<div style={{ fontSize: 12, color: '#6b7280' }}>
  Staff: <b>{staffMap[o.staff] ? o.staff + ' - ' + staffMap[o.staff] : (o.staff || '')}</b>
  {' · '}
  {/* Tính tên khách từ customerName hoặc snapshot o.customer.name */}
  {(() => {
    const custName =
      (o.customerName != null && o.customerName !== undefined)
        ? o.customerName
        : (o.customer && typeof o.customer === 'object' ? (o.customer.name || '') : '');
    return (
      <>
        Customer: <b>{
          o.memberCard
            ? (custName ? `${o.memberCard} - ${custName}` : o.memberCard)
            : (custName || '')
        }</b>
      </>
    );
  })()}
</div>
                            </div>

                            <div style={{ padding: 10 }}>
                              {/* items */}
<div
  style={{
    display: 'grid',
    gridTemplateColumns: '1fr auto',
    rowGap: 6,
    alignItems: 'center',
  }}
>
  {o.items.map((it, idx) => {
    // Lấy tên ảnh chuẩn
    const imgName = getImageName(it.imageName || it.imageKey || '');
    const url = imageUrlByName(imgName);

    // Lấy mã món từ item / map products
    const code = resolveItemCode(it); // <-- dùng helper

    // Tên món hiển thị
    const label = humanizeName(it.name || imgName);
    const displayName = code ? `${code} - ${label}` : label;

    return (
      <React.Fragment key={idx}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {url ? (
            <img
              src={url}
              alt=""
              style={{
                width: 38,
                height: 38,
                objectFit: 'cover',
                borderRadius: 6,
                border: '1px solid #eee',
              }}
            />
          ) : (
            <div style={{ width: 38 }} />
          )}

          <div style={{ fontSize: 12 }}>
            {displayName}
            {it.note ? ` – ${it.note}` : ''}
          </div>
        </div>

        <div style={{ fontWeight: 700 }}>x{it.qty}</div>
      </React.Fragment>
    );
  })}
</div>


                              {o.note && <div style={{ marginTop: 8, fontSize: 12, color: '#6b7280' }}>📝 {o.note}</div>}
                              {(o.status === ORDER_STATUS.CANCELLED && o.cancelReason) && (
                                <div style={{ marginTop: 8, fontSize: 12, color: '#991b1b' }}>
                                  ❌ Lý do hủy: <b>{o.cancelReason}</b>
                                </div>
                              )}

                              {/* actions */}
                              {(o.status === ORDER_STATUS.PENDING || o.status === ORDER_STATUS.IN_PROGRESS) && (
                                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                                  <button
                                    onClick={() => printOrderSmart(o)}
                                    style={{ padding: '6px 10px', background: '#111', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 12 }}
                                    title="In bill cho bếp"
                                  >
                                    Print
                                  </button>
                                  {o.status === ORDER_STATUS.PENDING && (
                                    <button
                                      onClick={() => setOrderStatus(o.id, ORDER_STATUS.IN_PROGRESS)}
                                      style={{ padding: '6px 10px', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 12 }}
                                    >
                                      Start
                                    </button>
                                  )}
                                  <button
                                    onClick={() => setOrderStatus(o.id, ORDER_STATUS.DONE)}
                                    style={{ padding: '6px 10px', background: '#10b981', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 12 }}
                                  >
                                    Done
                                  </button>
                                  <button
                                    onClick={async () => {
                                      const reason = window.prompt('Lý do hủy đơn?', '');
                                      if (reason == null) return;
                                      await setOrderStatus(o.id, ORDER_STATUS.CANCELLED, reason);
                                    }}
                                    style={{ padding: '6px 10px', background: '#ef4444', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 12 }}
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
      )}

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



