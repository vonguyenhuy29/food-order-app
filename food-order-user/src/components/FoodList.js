// src/components/FoodList.js
import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import AIChatBox from './AIChatBox.jsx';
import axios from 'axios';
import io from 'socket.io-client';

// ==== API & Socket fallback ====
const API =
  process.env.REACT_APP_API_URL ||
  process.env.REACT_APP_API_BASE ||
  ''; // '' => same-origin (relative /api)

const socketOptions = {
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 500,
  reconnectionDelayMax: 5000,
  randomizationFactor: 0.5,
  timeout: 20000,

  // Cho phép fallback polling trước rồi upgrade lên websocket
  // Ổn định hơn khi mạng nội bộ hoặc proxy có lúc chập chờn
  transports: ['polling', 'websocket'],
  upgrade: true,
};

const socket = API ? io(API, socketOptions) : io(socketOptions);

const apiUrl = (path) => `${API || ''}${path}`;
// Trả về URL ảnh có host API nếu đang chạy khác origin
const withBase = (url) => {
  if (!url) return '';
  if (/^https?:\/\//i.test(url)) return url;  // đã là absolute URL
  return `${API || ''}${url}`;                 // gắn host API (nếu có)
};

const imageSrc = (foodOrUrl) => {
  const url = typeof foodOrUrl === 'string'
    ? foodOrUrl
    : foodOrUrl?.imageUrl;

  const base = withBase(url);

  const version = typeof foodOrUrl === 'object'
    ? (foodOrUrl?.updatedAt || foodOrUrl?.hash || foodOrUrl?.id || '')
    : '';

  if (!base || !version) return base;

  return `${base}${base.includes('?') ? '&' : '?'}v=${encodeURIComponent(version)}`;
};

const thumbSrc = (foodOrUrl) => {
  const original = imageSrc(foodOrUrl);
  if (!original) return '';

  try {
    const url = new URL(original, API || window.location.origin);
    const marker = '/images/';
    const idx = url.pathname.indexOf(marker);

    if (idx < 0) return original;

    const rel = url.pathname
      .slice(idx + marker.length)
      .replace(/\.[^/.]+$/i, '.webp');

    url.pathname = `/thumbs/${rel}`;
    return url.toString();
  } catch {
    const parts = String(original).split('?');
    const pathPart = parts[0];
    const query = parts[1] ? `?${parts[1]}` : '';

    return pathPart
      .replace('/images/', '/thumbs/')
      .replace(/\.[^/.]+$/i, '.webp') + query;
  }
};

const preloadImage = (src) => {
  if (!src) return;

  const img = new Image();
  img.decoding = 'async';
  img.src = src;

  if (img.decode) {
    img.decode().catch(() => {});
  }
};
const SOLD_OUT_MENU = 'Sold out';
const SOLD_OUT_KEY = '__SOLD_OUT__';
const OFF_MENU_CODE = 'H100';
const OFF_MENU_LABEL = `${OFF_MENU_CODE} - OFF MENU`;
const LEVELS = ['P', 'I-I+', 'V-One'];
const ORDER_STATUS = {
  PENDING: 'PENDING',
  IN_PROGRESS: 'IN_PROGRESS',
  DONE: 'DONE',
  CANCELLED: 'CANCELLED',
};

const ORDER_FILTERS = ['ALL', 'OPEN', 'PENDING', 'IN_PROGRESS', 'DONE', 'CANCELLED'];
const BUSINESS_HOUR = 6;

// Khu vực và số bàn hiện tại (cập nhật theo sơ đồ thực tế 08/2026)
const AREA_DEFS = [
  { name: 'Roulette 1', ranges: [[101, 117]] },
  { name: 'Roulette 2', ranges: [[201, 231]] },
  { name: 'Roulette 3', ranges: [[301, 317]] },
  { name: 'Reception 1', tables: [7001, 7002, 7003, 7004, 7005, 7006, 7007, 7008] },
  { name: 'Reception 2', ranges: [[1001, 1004], [1009, 1020]] },
  {
    name: 'Center',
    tables: [
      1005, 1006, 1007, 1008,
      1023, 1024, 1025, 1026, 1027, 1028, 1029, 1030,
      3001, 3002, 3003, 3004, 3005, 3006, 3007, 3008,
      3012,
      3014, 3015, 3016, 3017, 3018, 3019, 3020, 3021, 3022, 3023, 3024, 3025, 3026, 3027,
    ],
  },
  { name: 'Multi', tables: [501, 502, 503, 504, 505, 506, 507, 508, 509, 510, 8001, 8002, 8003, 8004, 8005, 8006] },
  { name: 'Table', ranges: [[11, 15], [21, 25]] },
  {
    name: '2 Floor',
    tables: [
      1021, 3013,
      2001, 2002, 2003, 2004, 2005, 2006,
      2008, 2009, 2010, 2011, 2012, 2013, 2014,
      2016, 2018,
      2021, 2022, 2023, 2024, 2025, 2026, 2027, 2028,
      8007, 8008, 8009,
    ],
  },
];
const genTables = (areaOrRanges) => {
  const area = Array.isArray(areaOrRanges) ? { ranges: areaOrRanges } : (areaOrRanges || {});
  const out = new Set(
    (Array.isArray(area.tables) ? area.tables : [])
      .map(Number)
      .filter(Number.isFinite)
  );

  (Array.isArray(area.ranges) ? area.ranges : []).forEach(([a, b]) => {
    const from = Number(a);
    const to = Number(b);
    if (!Number.isFinite(from) || !Number.isFinite(to)) return;
    for (let i = from; i <= to; i += 1) out.add(i);
  });

  return Array.from(out).sort((a, b) => a - b);
};
const tableKeyOf = (area, tableNo) => (area && tableNo) ? `${area}#${tableNo}` : '';
const tableStatusTextOf = (o) => o?.tableClosed ? 'Done (thu bàn)' : 'Pending';
const tableStatusColorOf = (o) => o?.tableClosed ? '#16a34a' : '#f59e0b';

function playBeep() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = new AC();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine'; o.frequency.value = 880;
    o.connect(g); g.connect(ctx.destination);
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.4);
    o.start(); o.stop(ctx.currentTime + 0.5);
  } catch {}
}

// ===== Gesture menu =====
const MENU_WIDTH = 240;
const EDGE_ZONE = 30;
const SWIPE_THRESH = 50;
const ANGLE_GUARD = 1.5;
const TOP_BAR_H = 52;
const BOTTOM_BAR_H = 48;

const getImageName = (url) => (url || '').split('/').pop()?.toLowerCase() || '';
const formatMoneyVnd = (v) => {
  const n = Number(v || 0);
  if (!Number.isFinite(n) || n <= 0) return '0 VND';
  return `${Math.round(n).toLocaleString('vi-VN')} VND`;
};
const normalize = (s) => String(s || '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[_\-./]+/g, ' ')
  .replace(/\s{2,}/g,' ')
  .trim()
  .toUpperCase();

const UserFoodList = () => {
  const [foods, setFoods] = useState([]);
  const [menuLevels, setMenuLevels] = useState({}); // <— NEW: default levels per menu/type
  const [, setConnectionError] = useState(null);
  const [, setApiError] = useState(null);

  // Socket/Sync state
  const [connState, setConnState] = useState('connecting');
  const [lastSyncAt, setLastSyncAt] = useState(null);

  // Menu state
  const [selectedLevel, setSelectedLevel] = useState(() => localStorage.getItem('ui.selectedLevel') || null);
  const [selectedType, setSelectedType]   = useState(() => localStorage.getItem('ui.selectedType') || null);
  const [columns, setColumns] = useState(() => {
  const w = window.innerWidth || 1200;
  if (w <= 768) return 2;
  if (w <= 1024) return 3;
  return 4;
});
  const [menuOpen, setMenuOpen] = useState(true);
  const [previewImage, setPreviewImage] = useState(null);

  // Search
  const [searchQuery, setSearchQuery] = useState('');
  const isSearching = searchQuery.trim().length > 0;

  // Chế độ hiển thị & bàn
  const [mode, setMode] = useState('menu'); // 'menu' | 'tables' | 'orders'
  const [activeArea, setActiveArea] = useState(AREA_DEFS[0].name);
  const [tableSearch, setTableSearch] = useState('');
  const [selectedTable, setSelectedTable] = useState(() => {
    try { return JSON.parse(localStorage.getItem('selectedTable')) || null; } catch { return null; }
  });

  const currentTableKey = useMemo(
    () => (selectedTable ? tableKeyOf(selectedTable.area, selectedTable.tableNo) : ''),
    [selectedTable]
  );

  // Giỏ theo bàn
const [carts, setCarts] = useState(() => {
  try { return JSON.parse(localStorage.getItem('tableCarts')) || {}; } catch { return {}; }
});


  // Orders theo bàn
  const [ordersByTable, setOrdersByTable] = useState(() => {
    try { return JSON.parse(localStorage.getItem('ordersByTable')) || {}; } catch { return {}; }
  });
  useEffect(() => { localStorage.setItem('ordersByTable', JSON.stringify(ordersByTable)); }, [ordersByTable]);

  // Tables hiển thị ở sidebar
  const visibleTables = useMemo(() => {
    const q = tableSearch.trim();
    if (q) {
      const results = [];
      AREA_DEFS.forEach(a => {
        genTables(a).forEach(n => {
          if (String(n).includes(q)) results.push({ area: a.name, tableNo: n });
        });
      });
      return results;
    }
    const area = AREA_DEFS.find(a => a.name === activeArea) || AREA_DEFS[0];
    return genTables(area).map(n => ({ area: area.name, tableNo: n }));
  }, [tableSearch, activeArea]);

  // Badge đếm orders mở + màu theo trạng thái mới nhất
  const openOrderBadgeFor = useCallback((areaName, tableNo) => {
    const key = tableKeyOf(areaName, tableNo);
    const list = (ordersByTable[key] || []).filter(o => !o.tableClosed);
    const count = list.length;
    if (count === 0) return { count: 0, color: null, status: null };
    const latest = [...list].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
    const colorMap = {
      PENDING: '#ef4444',
      IN_PROGRESS: '#f59e0b',
      DONE: '#16a34a',
      CANCELLED: '#9ca3af',
    };
    return { count, status: latest.status, color: colorMap[latest.status] || '#9ca3af' };
  }, [ordersByTable]);

  const tableOrders = useMemo(() => currentTableKey ? (ordersByTable[currentTableKey] || []) : [], [ordersByTable, currentTableKey]);
  // ===== Orders view read-only =====
const [ordersViewOrders, setOrdersViewOrders] = useState([]);
const [ordersViewLoading, setOrdersViewLoading] = useState(false);
const [ordersViewError, setOrdersViewError] = useState(null);
const [ordersViewFilter, setOrdersViewFilter] = useState('ALL');
const [ordersViewSort, setOrdersViewSort] = useState('time_desc');
const [ordersViewDateRange, setOrdersViewDateRange] = useState('today');
const [ordersViewFromDate, setOrdersViewFromDate] = useState('');
const [ordersViewToDate, setOrdersViewToDate] = useState('');
const [ordersViewActiveTable, setOrdersViewActiveTable] = useState(null);
const [ordersViewCustomerSearch, setOrdersViewCustomerSearch] = useState('');

const toISO = (d) => (d ? d.toISOString() : undefined);

const parseYmd = (s) => {
  if (!s) return null;
  const [y, m, d] = String(s).split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
};

const startAtBusinessHour = (d) => {
  const x = new Date(d);
  x.setHours(BUSINESS_HOUR, 0, 0, 0);
  return x;
};

const endFromStart = (start, days = 1) => {
  const x = new Date(start);
  x.setDate(x.getDate() + days);
  x.setMilliseconds(-1);
  return x;
};

const shiftForBusinessDay = (d) => {
  const x = new Date(d);
  if (x.getHours() < BUSINESS_HOUR) x.setDate(x.getDate() - 1);
  return x;
};

const buildOrdersViewRange = useCallback(() => {
  const now = new Date();
  const shiftedNow = shiftForBusinessDay(now);

  let from = null;
  let to = null;

  switch (ordersViewDateRange) {
        case 'all': {
      from = null;
      to = null;
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
      const d = new Date(shiftedNow);
      const day = d.getDay() || 7; // Monday = 1, Sunday = 7
      d.setDate(d.getDate() - day + 1);
      from = startAtBusinessHour(d);
      to = endFromStart(from, 7);
      break;
    }

    case 'month': {
      const d = new Date(shiftedNow.getFullYear(), shiftedNow.getMonth(), 1);
      from = startAtBusinessHour(d);

      const nextMonth = new Date(shiftedNow.getFullYear(), shiftedNow.getMonth() + 1, 1, BUSINESS_HOUR, 0, 0, 0);
      to = new Date(nextMonth.getTime() - 1);
      break;
    }

    case 'year': {
      const d = new Date(shiftedNow.getFullYear(), 0, 1);
      from = startAtBusinessHour(d);

      const nextYear = new Date(shiftedNow.getFullYear() + 1, 0, 1, BUSINESS_HOUR, 0, 0, 0);
      to = new Date(nextYear.getTime() - 1);
      break;
    }

    case 'custom': {
      const f = parseYmd(ordersViewFromDate);
      const t = parseYmd(ordersViewToDate);

      from = f ? startAtBusinessHour(f) : null;
      to = t ? endFromStart(startAtBusinessHour(t), 1) : null;
      break;
    }

    case 'today':
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
}, [ordersViewDateRange, ordersViewFromDate, ordersViewToDate]);

const fetchOrdersView = useCallback(async () => {
  try {
    setOrdersViewLoading(true);
    setOrdersViewError(null);

    const { from, to } = buildOrdersViewRange();

const params = {
  status: ordersViewFilter,
};

if (from) params.from = from;
if (to) params.to = to;

const res = await axios.get(apiUrl('/api/user/orders-view'), {
  params,
  headers: {
    'Cache-Control': 'no-cache',
  },
});

    const normalizeOrder = (o = {}) => ({
      ...o,
      cancelReason: o.cancelReason ?? o.reason ?? o?.meta?.cancelReason ?? o?.statusReason ?? null,
    });

    const rows = Array.isArray(res.data)
      ? res.data.map(normalizeOrder)
      : [];

    rows.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    setOrdersViewOrders(rows);
  } catch (e) {
    setOrdersViewError(e?.response?.data?.error || e?.message || 'Cannot load orders');
  } finally {
    setOrdersViewLoading(false);
  }
}, [ordersViewFilter, buildOrdersViewRange]);

useEffect(() => {
  if (mode !== 'orders') return;
  fetchOrdersView();
}, [mode, fetchOrdersView]);

const orderAreaOf = (o) => String(o?.area || 'No area');
const orderTableNoOf = (o) => String(o?.tableNo || 'No table');
const orderGroupKeyOf = (o) => tableKeyOf(orderAreaOf(o), orderTableNoOf(o));

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

const ordersViewFiltered = useMemo(() => {
  let rows = [];

  if (ordersViewFilter === 'OPEN') {
    rows = ordersViewOrders.filter(
      (o) => o.status === ORDER_STATUS.PENDING || o.status === ORDER_STATUS.IN_PROGRESS
    );
  } else if (ordersViewFilter === 'ALL') {
    rows = ordersViewOrders;
  } else {
    rows = ordersViewOrders.filter((o) => o.status === ordersViewFilter);
  }

  const qRaw = String(ordersViewCustomerSearch || '').trim();
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
}, [ordersViewOrders, ordersViewFilter, ordersViewCustomerSearch]);
const ordersViewGroupedTables = useMemo(() => {
  const grouped = new Map();

for (const o of ordersViewFiltered) {
  const area = orderAreaOf(o);
  const tableNo = orderTableNoOf(o);
  const key = tableKeyOf(area, tableNo);

  if (!grouped.has(key)) {
    grouped.set(key, {
      key,
      area,
      tableNo,
      orders: [],
      latestAt: new Date(0),
    });
  }

    const g = grouped.get(key);
    g.orders.push(o);

    const t = o.createdAt ? new Date(o.createdAt) : new Date(0);
    if (t > g.latestAt) g.latestAt = t;
  }

  const arr = Array.from(grouped.values());

  arr.sort((a, b) => {
    switch (ordersViewSort) {
      case 'time_asc':
        return a.latestAt - b.latestAt;

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
      default:
        return b.latestAt - a.latestAt;
    }
  });

  return arr;
}, [ordersViewFiltered, ordersViewSort]);

  // Order form
  const [showOrderForm, setShowOrderForm] = useState(false);
  const [orderForm, setOrderForm] = useState(() => {
    try {
      const last = JSON.parse(localStorage.getItem('lastOrderInfo') || '{}');
      return { staff: last.staff || '', memberCard: '', customerCode: '', customerName: '', level: '', note: '' };

    } catch { return { staff: '', memberCard: '', customerName: '', note: '' }; }
  });
  const [toast, setToast] = useState('');
  const [globalCustomerEventAlert, setGlobalCustomerEventAlert] = useState(null);
const [insightsOpenCode, setInsightsOpenCode] = useState('');
  const [isPlacingOrder, setIsPlacingOrder] = useState(false);
  const placeOrderLockRef = useRef(false);
  const orderRequestIdRef = useRef(null);
    // === Staff lookup ===
  // Lưu map mã nhân viên -> tên nhân viên (loaded từ API)
  const [staffMap, setStaffMap] = useState({});
  // Tên nhân viên hiện tại theo mã đã nhập
  const [staffName, setStaffName] = useState('');

  // Tải danh sách nhân viên từ API backend (/api/staffs)
  useEffect(() => {
    const loadStaffs = async () => {
      try {
        const res = await axios.get(apiUrl('/api/staffs'));
        const arr = Array.isArray(res.data) ? res.data : [];
        const map = {};
        arr.forEach((it) => {
          const id = String(it?.id ?? it?.code ?? '').trim();
          if (id) map[id] = String(it?.name ?? '');
        });
        setStaffMap(map);
      } catch (e) {
        // Nếu lỗi, giữ staffMap rỗng
      }
    };
    loadStaffs();
  }, []);

  // Cập nhật staffName mỗi khi mã nhân viên thay đổi hoặc staffMap đổi
  useEffect(() => {
    const id = String(orderForm.staff || '').replace(/\s+/g, '');
    setStaffName(staffMap[id] || '');
  }, [orderForm.staff, staffMap]);
  // ==== Quick order state ====
// khi người dùng bấm vào ảnh trong preview để order nhanh
const [quickOrderFood, setQuickOrderFood] = useState(null);
const [quickOrderForm, setQuickOrderForm] = useState({ staff: '', members: '' });
  // Refs
  const touchStartXRef = useRef(null);
  const touchStartYRef = useRef(null);
  const touchStartContextRef = useRef(null); // 'edge' | 'menu' | 'content'
  const swipingRef = useRef(false);
  const menuOpenRef = useRef(menuOpen);
  const versionRef = useRef(null);

  const sliderRef = useRef(null);
  const draggingRef = useRef(false);

    useEffect(() => { menuOpenRef.current = menuOpen; }, [menuOpen]);
  useEffect(() => { if (selectedLevel) localStorage.setItem('ui.selectedLevel', selectedLevel); }, [selectedLevel]);
  useEffect(() => { localStorage.setItem('ui.selectedType', selectedType ?? ''); }, [selectedType]);
  useEffect(() => { localStorage.setItem('tableCarts', JSON.stringify(carts)); }, [carts]);
  useEffect(() => { localStorage.setItem('selectedTable', JSON.stringify(selectedTable)); }, [selectedTable]);
  useEffect(() => { if (!toast) return; const t = setTimeout(()=>setToast(''),1300); return ()=>clearTimeout(t); }, [toast]);
  // Global Customer Event Alarm
// Nhận alarm dù đang ở Table / Menu / Orders / Insights
useEffect(() => {
  const onCustomerEventAlarm = (event = {}) => {
    setGlobalCustomerEventAlert(event);

    try {
      playBeep();
    } catch {}
  };

  socket.on('customerEventAlarm', onCustomerEventAlarm);

  return () => {
    socket.off('customerEventAlarm', onCustomerEventAlarm);
  };
}, []);

  // API
const foodsReqRef = useRef(null);

const fetchFoods = useCallback(async () => {
  if (foodsReqRef.current) return foodsReqRef.current;

  foodsReqRef.current = (async () => {
    try {
      const res = await axios.get(apiUrl('/api/foods'), {
        timeout: 8000,
      });

      setFoods(res.data || []);
      setApiError(null);
      setConnState('connected');
      setLastSyncAt(new Date());

      return res.data || [];
    } catch (e) {
      setApiError(e?.message || 'API error');
      setConnState('offline');

      // Quan trọng: không setFoods([])
      // Giữ menu cũ để nhân viên vẫn xem/chọn được khi server chập chờn.
      return null;
    } finally {
      foodsReqRef.current = null;
    }
  })();

  return foodsReqRef.current;
}, []);
  // NEW: load menu-levels (default levels per type)
  const loadMenuLevels = useCallback(async () => {
    try {
      const r = await axios.get(apiUrl('/api/products/menu-levels'));
      setMenuLevels(r.data || {});
    } catch {
      try {
        const r2 = await axios.get(apiUrl('/api/menu-levels'));
        setMenuLevels(r2.data || {});
      } catch {}
    }
  }, []);
  const fetchOrdersOfTable = useCallback(async (area, tableNo) => {
    try {
      const res = await axios.get(apiUrl('/api/orders'), { params: { area, tableNo } });
      const normalizeOrder = (o = {}) => ({
        ...o,
        cancelReason: o.cancelReason ?? o.reason ?? o?.meta?.cancelReason ?? o?.statusReason ?? null,
      });
      const list = Array.isArray(res.data) ? res.data.map(normalizeOrder) : [];
      const key = tableKeyOf(area, tableNo);
      setOrdersByTable(prev => ({ ...prev, [key]: list }));
    } catch {}
  }, []);

// Preload orders cho các bàn đang hiển thị bằng 1 request duy nhất
const fetchOpenOrdersForVisibleTables = useCallback(async () => {
  try {
    const res = await axios.get(apiUrl('/api/user/orders-view'), {
      params: {
        status: 'OPEN',
      },
      headers: {
        'Cache-Control': 'no-cache',
      },
      timeout: 8000,
    });

    const rows = Array.isArray(res.data) ? res.data : [];

    const visibleKeys = new Set(
      visibleTables.map((t) => tableKeyOf(t.area, t.tableNo))
    );

    const grouped = {};

    rows.forEach((o) => {
      const key = tableKeyOf(o.area, o.tableNo);
      if (!visibleKeys.has(key)) return;

      if (!grouped[key]) grouped[key] = [];
      grouped[key].push({
        ...o,
        cancelReason: o.cancelReason ?? o.reason ?? o?.meta?.cancelReason ?? o?.statusReason ?? null,
      });
    });

    Object.keys(grouped).forEach((key) => {
      grouped[key].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    });

    setOrdersByTable((prev) => {
      const next = { ...prev };

      // Clear những bàn đang hiển thị nhưng không còn order mở
      visibleKeys.forEach((key) => {
        next[key] = grouped[key] || [];
      });

      return next;
    });
  } catch (e) {
    // Không xoá dữ liệu cũ nếu lỗi tạm thời
  }
}, [visibleTables]);

useEffect(() => {
  fetchOpenOrdersForVisibleTables();
}, [fetchOpenOrdersForVisibleTables]);

  const fetchRef = useRef(null);
  const debounceFetch = useCallback(() => {
    clearTimeout(fetchRef.current);
    fetchRef.current = setTimeout(() => { fetchFoods(); }, 220);
  }, [fetchFoods]);
  useEffect(() => () => clearTimeout(fetchRef.current), []);

  // Socket lifecycle
  useEffect(() => {
    const handleDisconnect = () => {
      setConnectionError(true);
      setConnState('offline');
    };
    const handleConnect = () => {
      setConnectionError(false);
      setConnState('connecting');
      fetchFoods();
    };

    socket.on('disconnect', handleDisconnect);
    socket.on('connect', handleConnect);
    socket.on('reconnect_attempt', () => setConnState('connecting'));
    socket.on('reconnect_error', () => setConnState('offline'));
    socket.on('reconnect', () => { setConnState('connecting'); fetchFoods(); });

    return () => {
      socket.off('disconnect', handleDisconnect);
      socket.off('connect', handleConnect);
      socket.off('reconnect_attempt');
      socket.off('reconnect_error');
      socket.off('reconnect');
    };
  }, [fetchFoods]);

// Auto sync mềm khi backend phát version mới
useEffect(() => {
  const onVersion = (ver) => {
    if (!versionRef.current) {
      versionRef.current = ver;
      return;
    }

    if (versionRef.current !== ver) {
      versionRef.current = ver;

      // Không reload nguyên trang, chỉ tải lại data cần thiết
      fetchFoods();
      loadMenuLevels();
      setToast('Menu đã được cập nhật');
    }
  };

  socket.on('appVersion', onVersion);
  return () => socket.off('appVersion', onVersion);
}, [fetchFoods, loadMenuLevels]);

  // Wake & sync khi app quay lại foreground
  useEffect(() => {
    const wakeAndSync = () => {
      if (document.visibilityState !== 'visible') return;
      setConnState('connecting');
      if (!socket.connected) socket.connect();
      fetchFoods();
      if (selectedTable) fetchOrdersOfTable(selectedTable.area, selectedTable.tableNo);
    };
    document.addEventListener('visibilitychange', wakeAndSync);
    window.addEventListener('focus', wakeAndSync);
    window.addEventListener('pageshow', wakeAndSync);
    window.addEventListener('online', wakeAndSync);
    return () => {
      document.removeEventListener('visibilitychange', wakeAndSync);
      window.removeEventListener('focus', wakeAndSync);
      window.removeEventListener('pageshow', wakeAndSync);
      window.removeEventListener('online', wakeAndSync);
    };
  }, [fetchFoods, selectedTable, fetchOrdersOfTable]);

  useEffect(() => {
    if (!selectedTable) return;
    fetchOrdersOfTable(selectedTable.area, selectedTable.tableNo);
  }, [selectedTable, fetchOrdersOfTable]);

  // Initial fetch & realtime events
  useEffect(() => {
    fetchFoods();
    loadMenuLevels();
    socket.on('foodAdded', debounceFetch);
    socket.on('foodStatusUpdated', debounceFetch);
    socket.on('foodDeleted', debounceFetch);
    socket.on('foodsReordered', ({ orderedIds }) => {
      setFoods(prev => {
        const orderMap = new Map();
        orderedIds.forEach((id, idx) => orderMap.set(id, idx));
        return prev.map(f => ({ ...f, order: orderMap.has(f.id) ? orderMap.get(f.id) : f.order }));
      });
    });
    socket.on('foodLevelsUpdated', debounceFetch);
    socket.on('foodRenamed', debounceFetch);
    // Khi server cập nhật default levels của menu → tải lại map levels (không cần refetch foods)
    socket.on('menuLevelsUpdated', loadMenuLevels); 
    const onOrderPlacedUser = ({ order }) => {
      const key = tableKeyOf(order.area, order.tableNo);
      setOrdersByTable(prev => {
        const cur = prev[key] || [];
        const next = [order, ...cur].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        return { ...prev, [key]: next };
      });
      if (currentTableKey && key === currentTableKey) {
        setToast(`Đã nhận order mới: ${order.items.map(i => `x${i.qty} ${i.imageName}`).join(', ')}`);
        playBeep();
      }
    };

    const onOrderUpdatedUser = (payload = {}) => {
      const { orderId, status, order, reason, cancelReason, area: areaHint, tableNo: tableHint } = payload;
      const area = order?.area ?? areaHint;
      const tableNo = order?.tableNo ?? tableHint;
      if (!area || !tableNo) return;
      const key = tableKeyOf(area, tableNo);
      const reasonFinal = cancelReason ?? reason ?? order?.cancelReason ?? order?.reason ?? null;

      setOrdersByTable(prev => {
        const list = (prev[key] || []).map(o =>
          o.id === orderId ? { ...o, ...(order || {}), status, ...(reasonFinal ? { cancelReason: reasonFinal } : {}) } : o
        );
        return { ...prev, [key]: list };
      });

      if (status === 'DONE' && currentTableKey && key === currentTableKey && !(order?.tableClosed)) {
        const itemsText = Array.isArray(order?.items) ? order.items.map(i => `x${i.qty} ${i.imageName}`).join(', ') : '';
        setToast(`Order đã hoàn thành: ${itemsText}`);
        playBeep();
      }
    };

    const onQty = ({ imageName, quantity }) => {
      const key = String(imageName || '').toLowerCase();
      if (!key) return;
      setFoods(prev =>
        prev.map(f =>
          getImageName(f.imageUrl) === key ? { ...f, quantity, status: quantity <= 0 ? 'Sold Out' : 'Available' } : f
        )
      );
    };

    socket.on('orderPlaced', onOrderPlacedUser);
    socket.on('orderUpdated', onOrderUpdatedUser);
    socket.on('foodQuantityUpdated', onQty);
    const refreshOrdersView = () => {
  if (mode === 'orders') fetchOrdersView();
};

socket.on('orderPlaced', refreshOrdersView);
socket.on('orderUpdated', refreshOrdersView);

    return () => {
      socket.off('foodAdded', debounceFetch);
      socket.off('foodStatusUpdated', debounceFetch);
      socket.off('foodDeleted', debounceFetch);
      socket.off('foodRenamed', debounceFetch);
      socket.off('foodsReordered');
      socket.off('foodLevelsUpdated', debounceFetch);
      socket.off('orderPlaced', onOrderPlacedUser);
      socket.off('orderUpdated', onOrderUpdatedUser);
      socket.off('foodQuantityUpdated', onQty);
      socket.off('menuLevelsUpdated', loadMenuLevels);
      socket.off('orderPlaced', refreshOrdersView);
socket.off('orderUpdated', refreshOrdersView);
    };
  }, [fetchFoods, debounceFetch, selectedTable, currentTableKey, loadMenuLevels, mode, fetchOrdersView]);

  // ====== Groups / types cho sidebar ======
  const [productGroups, setProductGroups] = useState([]);
const fetchGroups = useCallback(async () => {
    try {
      const r = await fetch(apiUrl('/api/products/groups'));
      if (r.ok) {
        const data = await r.json();
        return setProductGroups((data || []).map(g => g.name));
      }
      throw new Error('fallback');
} catch {
  try {
    const r2 = await fetch(apiUrl('/api/products/item-groups'));
    if (r2.ok) {
      const data2 = await r2.json();
      setProductGroups((data2 || []).map(g => g.name));
    }
  } catch {}
}
  }, []);
  useEffect(() => { fetchGroups(); }, [fetchGroups]);
  useEffect(() => {
    const onUpd = () => fetchGroups();
    socket.on('productGroupsUpdated', onUpd);
    return () => socket.off('productGroupsUpdated', onUpd);
  }, [fetchGroups]);

const allTypesFromFoods = useMemo(
  () => Array.from(new Set(foods.map(f => f.type))).sort(),
  [foods]
);

// Ưu tiên theo thứ tự productGroups (nếu backend trả về), phần còn lại giữ nguyên
const preferredTypes = useMemo(() => {
  if (!Array.isArray(productGroups) || productGroups.length === 0) {
    return allTypesFromFoods;
  }
  const set = new Set(allTypesFromFoods);
  const ordered = productGroups.filter(g => set.has(g));
  const leftovers = allTypesFromFoods.filter(t => !productGroups.includes(t));
  return [...ordered, ...leftovers];
}, [allTypesFromFoods, productGroups]);




 // Ưu tiên default levels của menu nếu đã thiết lập; nếu chưa có default thì fallback về item-level
 const typeAllowedForLevel = useCallback(
   (type, level) => {
     if (!level) return false;
     const arr = menuLevels?.[type];
     if (Array.isArray(arr)) return arr.includes(level); // ưu tiên menu-levels
     // fallback: có ít nhất một item thuộc type này có level đó
     return foods.some(f => f.type === type && Array.isArray(f.levelAccess) && f.levelAccess.includes(level));
   },
   [menuLevels, foods]
 );
 const filteredTypes = useMemo(() => {
   if (!selectedLevel) return [];
   return preferredTypes.filter((type) => typeAllowedForLevel(type, selectedLevel));
 }, [selectedLevel, preferredTypes, typeAllowedForLevel]);

  const hasSoldOutThisLevel = useMemo(
    () => foods.some(f => f.status === 'Sold Out' && typeAllowedForLevel(f.type, selectedLevel)),
    [foods, selectedLevel, typeAllowedForLevel]
  );
  const menuOptions = [...filteredTypes, ...(hasSoldOutThisLevel ? [SOLD_OUT_MENU] : [])];

  // Giữ hành vi: chọn level => selectedType = null; nếu type hiện không còn hợp lệ => null
  useEffect(() => {
    if (!selectedLevel) return;
    if (selectedType === SOLD_OUT_KEY) return;
    if (selectedType != null && !filteredTypes.includes(selectedType)) {
      setSelectedType(null);
    }
  }, [filteredTypes, selectedLevel, selectedType]);

  const isSoldOutPage = selectedType === SOLD_OUT_KEY;

  // Sort chuẩn
  const sortedFoods = useMemo(
    () => [...foods].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    [foods]
  );

  // (ĐÃ SỬA) Filter foods theo level + (type|group). Khi đang search => bỏ filter theo type/group
const foodsByTypeRaw = sortedFoods.filter((f) => {
  // Khi đang search: cho phép search toàn bộ món, không giới hạn theo level/type
  if (isSearching) {
    return true;
  }

  const typeFilter = selectedType;
  const inSelectedType =
    (typeFilter === null) ||
    (typeFilter === SOLD_OUT_KEY && f.status === 'Sold Out') ||
    (f.type === typeFilter);

  if (!inSelectedType) return false;
  if (!selectedLevel) return false;

  // Trang Sold-out: chỉ hiện món hết + menu/type đó được phép cho level đang chọn
  if (isSoldOutPage) {
    return f.status === 'Sold Out' && typeAllowedForLevel(f.type, selectedLevel);
  }

  // Trang thường: chỉ hiện món chưa sold out + menu/type đó được phép cho level đang chọn
  if (f.status === 'Sold Out') return false;
  return typeAllowedForLevel(f.type, selectedLevel);
});

  // Deduplicate theo file ảnh
  const foodsByType = [];
  const seenNames = new Set();
  for (const food of foodsByTypeRaw) {
    const fileName = getImageName(food.imageUrl);
    if (!seenNames.has(fileName)) {
      seenNames.add(fileName);
      foodsByType.push(food);
    }
  }

  // Search
const normQ = normalize(searchQuery);
const tokens = normQ ? normQ.split(' ') : [];

const foodsForDisplay = normQ
  ? foodsByType.filter((f) => {
      const type = normalize(f.type);
      const img  = normalize(getImageName(f.imageUrl));
      const code = normalize(f.productCode || f.code || '');
      const name = normalize(f.productName || f.name || '');
      const hay = [type, img, code, name].filter(Boolean).join(' ');
      return tokens.every(t => hay.includes(t));
    })
  : foodsByType;
// Preload ảnh nhẹ hơn để tránh Safari/iPad/iPhone bị crash vì thiếu RAM
useEffect(() => {
  if (mode !== 'menu') return;
  if (!selectedLevel) return;
  if (!Array.isArray(foods) || foods.length === 0) return;

  const timers = [];

  const isMobileOrTablet =
    /iPad|iPhone|iPod|Android/i.test(navigator.userAgent) ||
    window.innerWidth <= 1024;

  const currentLimit = isMobileOrTablet ? 8 : 32;
  const otherLimit = isMobileOrTablet ? 0 : 60;

  const currentMenuImages = foodsForDisplay
    .map((f) => thumbSrc(f))
    .filter(Boolean);

  currentMenuImages.slice(0, currentLimit).forEach((src, idx) => {
    const t = setTimeout(() => preloadImage(src), idx * 100);
    timers.push(t);
  });

  if (otherLimit > 0) {
    const otherImages = sortedFoods
      .filter((f) => {
        if (!f || f.status === 'Sold Out') return false;
        if (!typeAllowedForLevel(f.type, selectedLevel)) return false;
        if (selectedType && selectedType !== SOLD_OUT_KEY && f.type === selectedType) return false;
        return true;
      })
      .map((f) => thumbSrc(f))
      .filter(Boolean);

    otherImages.slice(0, otherLimit).forEach((src, idx) => {
      const t = setTimeout(() => preloadImage(src), 1500 + idx * 120);
      timers.push(t);
    });
  }

  return () => {
    timers.forEach(clearTimeout);
  };
}, [
  mode,
  selectedLevel,
  selectedType,
  foods,
  foodsForDisplay,
  sortedFoods,
  typeAllowedForLevel,
]);

  // ===== Preview gallery =====
  const [previewIndex, setPreviewIndex] = useState(-1);
  const galleryList = foodsForDisplay.length ? foodsForDisplay : foodsByType;

  const openPreviewAt = (url) => {
    const idx = Math.max(0, galleryList.findIndex(f => f.imageUrl === url));
    setPreviewIndex(idx);
    setPreviewImage(galleryList[idx]?.imageUrl || url);
  };
  const closePreview = () => { setPreviewImage(null); setPreviewIndex(-1); };
  const goPrev = useCallback(() => {
    if (!galleryList.length) return;
    const next = (previewIndex - 1 + galleryList.length) % galleryList.length;
    setPreviewIndex(next);
    setPreviewImage(galleryList[next].imageUrl);
  }, [galleryList, previewIndex]);
  const goNext = useCallback(() => {
    if (!galleryList.length) return;
    const next = (previewIndex + 1) % galleryList.length;
    setPreviewIndex(next);
    setPreviewImage(galleryList[next].imageUrl);
  }, [galleryList, previewIndex]);

  useEffect(() => {
    if (!previewImage) return;
    const onKey = (e) => {
      if (e.key === 'Escape') return closePreview();
      if (e.key === 'ArrowLeft') { e.preventDefault(); return goPrev(); }
      if (e.key === 'ArrowRight') { e.preventDefault(); return goNext(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [previewImage, previewIndex, galleryList, goPrev, goNext]);

  // ===== Funnel slider (điều chỉnh số cột) =====
  const minCols = 3, maxCols = 6;
  const pct = (columns - minCols) / (maxCols - minCols);
  const innerTop = 6, innerBottom = 154, innerHeight = innerBottom - innerTop;
  const fillH = Math.max(0, innerHeight * pct);
  const fillY = innerBottom - fillH;

  const setColsFromPointer = (clientY) => {
    const el = sliderRef.current; if (!el) return;
    const rect = el.getBoundingClientRect();
    const rel = (clientY - rect.top) / rect.height;
    const ratio = 1 - Math.max(0, Math.min(1, rel));
    const raw = minCols + ratio * (maxCols - minCols);
    const stepped = Math.round(raw);
    const clamped = Math.max(minCols, Math.min(maxCols, stepped));
    setColumns(clamped);
  };
  const onPointerDown = (e) => { draggingRef.current = true; e.currentTarget.setPointerCapture?.(e.pointerId); setColsFromPointer(e.clientY); };
  const onPointerMove = (e) => { if (!draggingRef.current) return; setColsFromPointer(e.clientY); };
  const onPointerUp   = (e) => { draggingRef.current = false; e.currentTarget.releasePointerCapture?.(e.pointerId); };
  const onKeyDown = (e) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') setColumns((c) => Math.min(maxCols, c + 1));
    else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') setColumns((c) => Math.max(minCols, c - 1));
  };

  // ===== Touch swipe sidebar =====
  const handleTouchStart = (e) => {
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    touchStartXRef.current = t.clientX;
    touchStartYRef.current = t.clientY;
    if (!menuOpenRef.current && t.clientX <= EDGE_ZONE) touchStartContextRef.current = 'edge';
    else if (menuOpenRef.current && t.clientX <= MENU_WIDTH) touchStartContextRef.current = 'menu';
    else touchStartContextRef.current = 'content';
    swipingRef.current = false;
  };
  const handleTouchMove = (e) => {
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    const dx = t.clientX - (touchStartXRef.current ?? t.clientX);
    const dy = t.clientY - (touchStartYRef.current ?? t.clientY);
    if (!swipingRef.current && Math.abs(dx) > 12 && Math.abs(dx) > ANGLE_GUARD * Math.abs(dy)) swipingRef.current = true;
    if (swipingRef.current) e.preventDefault();
  };
  const handleTouchEnd = (e) => {
    if (!swipingRef.current) return;
    const changedTouch = e.changedTouches && e.changedTouches[0];
    const endX = changedTouch ? changedTouch.clientX : null;
    const startX = touchStartXRef.current ?? endX;
    const dx = endX !== null ? (endX - startX) : 0;
    const ctx = touchStartContextRef.current;
    if (ctx === 'edge') { if (dx > SWIPE_THRESH) setMenuOpen(true); }
    else if (ctx === 'menu') { if (dx < -SWIPE_THRESH) setMenuOpen(false); }
    else { if (menuOpenRef.current && dx < -SWIPE_THRESH) setMenuOpen(false); }
  };

  // ==== Cart helpers
  const currentCart = useMemo(() => (currentTableKey ? (carts[currentTableKey] || {}) : {}), [carts, currentTableKey]);
const cartQtyOf = (imageName) => currentCart[imageName]?.qty || 0;

const OFF_MENU_PREFIX = '__offmenu__';

const isOffMenuKey = (key) => String(key || '').startsWith(OFF_MENU_PREFIX);

const makeOffMenuKey = () =>
  `${OFF_MENU_PREFIX}${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const addOffMenuItem = () => {
  if (!selectedTable) return setToast('Hãy chọn bàn');

  const key = makeOffMenuKey();
  setCarts((prev) => {
    const cart = { ...(prev[currentTableKey] || {}) };
    cart[key] = {
      qty: 1,
      note: '',
      name: '',
      isOffMenu: true,
    };
    return { ...prev, [currentTableKey]: cart };
  });
};

const setCartQty = (cartKey, qty) => {
  if (!currentTableKey) return;

  setCarts((prev) => {
    const cart = { ...(prev[currentTableKey] || {}) };

    if (qty <= 0) {
      delete cart[cartKey];
    } else {
      const cur = cart[cartKey] || {
        qty: 0,
        note: '',
        name: '',
        isOffMenu: isOffMenuKey(cartKey),
      };
      cart[cartKey] = { ...cur, qty };
    }

    return { ...prev, [currentTableKey]: cart };
  });
};


  const incItem = (food) => {
    if (!selectedTable) return setToast('Hãy chọn bàn');
    const imageName = getImageName(food.imageUrl);
    // guard sold-out / tồn kho
    if (food.status === 'Sold Out') { setToast('Món đã hết'); playBeep(); return; }
    const max = Number.isFinite(food.quantity) ? food.quantity : Infinity;
    const now = cartQtyOf(imageName);
    if (now >= max) { setToast('Đã đạt tồn tối đa'); playBeep(); return; }
    setCartQty(imageName, now + 1);
  };
  const decItem = (food) => {
    if (!selectedTable) return setToast('Hãy chọn bàn');
    const imageName = getImageName(food.imageUrl);
    const now = cartQtyOf(imageName);
    setCartQty(imageName, Math.max(0, now - 1));
  };
  const totalItems = useMemo(() => Object.values(currentCart).reduce((s, it) => s + (it.qty || 0), 0), [currentCart]);

  const updateCartItemField = (cartKey, patch) => {
  if (!currentTableKey) return;

  setCarts((prev) => {
    const cart = { ...(prev[currentTableKey] || {}) };
    cart[cartKey] = { ...(cart[cartKey] || {}), ...patch };
    return { ...prev, [currentTableKey]: cart };
  });
};

const orderDraftItems = useMemo(() => {
  return Object.entries(currentCart)
    .map(([cartKey, item]) => {
      const offMenu = Boolean(item?.isOffMenu) || isOffMenuKey(cartKey);
      const food = offMenu
        ? null
        : foods.find((f) => getImageName(f.imageUrl) === String(cartKey || '').toLowerCase());

      return {
        cartKey,
        offMenu,
        qty: Number(item?.qty || 0),
        note: item?.note || '',
name: offMenu
  ? (String(item?.name || '').trim() || 'Món ngoài menu')
  : (food?.productName || food?.name || cartKey),
code: offMenu ? OFF_MENU_CODE : (food?.productCode || food?.code || ''),
label: offMenu
  ? `${OFF_MENU_LABEL}${String(item?.name || '').trim() ? ` - ${String(item?.name || '').trim()}` : ''}`
  : `${food?.productCode || food?.code ? `${food?.productCode || food?.code} - ` : ''}${food?.productName || food?.name || cartKey}`,
      };
    })
    .filter((it) => it.qty > 0);
}, [currentCart, foods]);

  const tableCartCount = useCallback((areaName, tableNo) => {
    const key = tableKeyOf(areaName, tableNo);
    const cart = (carts && carts[key]) || {};
    return Object.values(cart).reduce((sum, it) => sum + Number(it.qty || 0), 0);

  }, [carts]);

// Member/Name lookup

const memberSearchTimerRef = useRef(null);
const memberLookupSeqRef = useRef(0);
const memberRefreshTimerRef = useRef(null);
const currentMemberCardRef = useRef('');

const [memberSearchText, setMemberSearchText] = useState('');
const [memberSuggestions, setMemberSuggestions] = useState([]);
const [memberSearchLoading, setMemberSearchLoading] = useState(false);
const [memberLookupLoading, setMemberLookupLoading] = useState(false);
const [memberApiRefreshing, setMemberApiRefreshing] = useState(false);
const [memberDropdownOpen, setMemberDropdownOpen] = useState(false);
const [customerSpending, setCustomerSpending] = useState(null);
const [customerSpendingLoading, setCustomerSpendingLoading] = useState(false);

const loadCustomerSpending = useCallback(async (codeInput) => {
  const code = String(codeInput || '').replace(/\s+/g, '').trim();

  if (!code || !/^\d+$/.test(code)) {
    setCustomerSpending(null);
    setCustomerSpendingLoading(false);
    return;
  }

  try {
    setCustomerSpendingLoading(true);

    const res = await axios.get(
      apiUrl(`/api/user/customer-spending/${encodeURIComponent(code)}`),
      {
        params: { t: Date.now() },
        headers: {
          'Cache-Control': 'no-cache',
        },
        timeout: 5000,
      }
    );

    setCustomerSpending(res.data || null);
  } catch {
    setCustomerSpending(null);
  } finally {
    setCustomerSpendingLoading(false);
  }
}, []);
useEffect(() => {
  const code = String(orderForm.customerCode || orderForm.memberCard || '')
    .replace(/\s+/g, '')
    .trim();

  if (!code || !/^\d+$/.test(code)) {
    setCustomerSpending(null);
    setCustomerSpendingLoading(false);
    return;
  }

  const t = setTimeout(() => {
    loadCustomerSpending(code);
  }, 500);

  return () => clearTimeout(t);
}, [orderForm.customerCode, orderForm.memberCard, loadCustomerSpending]);
useEffect(() => {
  currentMemberCardRef.current = String(orderForm.memberCard || '').replace(/\s+/g, '').trim();
}, [orderForm.memberCard]);

useEffect(() => {
  return () => {
    if (memberRefreshTimerRef.current) {
      clearTimeout(memberRefreshTimerRef.current);
      memberRefreshTimerRef.current = null;
    }
  };
}, []);

useEffect(() => {
  let cancelled = false;

  const onMemberUpdated = async (payload = {}) => {
    const code = String(payload.code || payload.member?.code || '').replace(/\s+/g, '').trim();
    const currentCode = currentMemberCardRef.current;

    if (!code || !currentCode || code !== currentCode) return;

    try {
      // Socket chỉ báo Database vừa thay đổi. Frontend đọc lại từ Database,
      // không dùng trực tiếp payload API làm nguồn hiển thị.
      const res = await axios.get(apiUrl('/api/member-lookup'), {
        params: {
          memberCard: code,
          refresh: 'false',
          t: Date.now(),
        },
        headers: { 'Cache-Control': 'no-cache' },
        timeout: 3000,
      });

      if (cancelled || currentMemberCardRef.current !== code) return;

      const name = String(res?.data?.customerName || res?.data?.name || '').trim();
      const lv = String(res?.data?.level || res?.data?.tier || '').trim();

      setOrderForm((f) => ({
        ...f,
        customerCode: code,
        customerName: name || f.customerName || 'Chưa có dữ liệu trong Database',
        level: lv || f.level || '---',
      }));
    } catch {
      // Giữ nguyên dữ liệu Database đang hiển thị nếu request đọc lại bị lỗi tạm thời.
    } finally {
      if (memberRefreshTimerRef.current) {
        clearTimeout(memberRefreshTimerRef.current);
        memberRefreshTimerRef.current = null;
      }

      setMemberApiRefreshing(false);
      setMemberLookupLoading(false);
    }
  };

  socket.on('memberUpdated', onMemberUpdated);
  return () => {
    cancelled = true;
    socket.off('memberUpdated', onMemberUpdated);
  };
}, []);

const selectMemberSuggestion = useCallback((member) => {
  const code = String(member?.code || member?.customerCode || '')
    .replace(/\s+/g, '')
    .trim();

  if (!code) return;

  const name = String(member?.name || member?.customerName || '').trim();
  const lv = String(member?.level || member?.memberLevel || member?.tier || '').trim();

  // Hiển thị ngay dữ liệu từ search để user không phải chờ
  setOrderForm(f => ({
    ...f,
    memberCard: code,
    customerCode: code,
    customerName: name || 'Chưa có thông tin',
    level: lv || 'Chưa có thông tin',
  }));

  setMemberSearchText(name ? `${code} - ${name}` : code);
  setMemberSuggestions([]);
  if (memberRefreshTimerRef.current) {
    clearTimeout(memberRefreshTimerRef.current);
    memberRefreshTimerRef.current = null;
  }
  setMemberApiRefreshing(false);
  setMemberLookupLoading(false);
  setMemberDropdownOpen(false);
}, []);

const lookupMember = useCallback(async (memberCard, opts = {}) => {
  const card = String(memberCard || '').replace(/\s+/g, '').trim();

  if (!card) return;
  if (!/^\d+$/.test(card)) return;

  const seq = ++memberLookupSeqRef.current;
  if (memberRefreshTimerRef.current) {
    clearTimeout(memberRefreshTimerRef.current);
    memberRefreshTimerRef.current = null;
  }
  setMemberLookupLoading(true);
  setMemberApiRefreshing(false);

  setOrderForm(f => ({
    ...f,
    memberCard: card,
    customerCode: card,
    customerName: 'Đang tìm khách...',
    level: 'Đang tìm...',
  }));

  try {
    const res = await axios.get(apiUrl('/api/member-lookup'), {
      params: {
        memberCard: card,
        refresh: opts.force ? 'true' : 'false',
        t: Date.now(),
      },
      headers: {
        'Cache-Control': 'no-cache',
      },
      timeout: 2500,
    });

    // Nếu user đã nhập mã khác trong lúc request cũ chưa xong thì bỏ kết quả cũ
    if (seq !== memberLookupSeqRef.current) return;

    const code = res?.data?.code || res?.data?.customerCode || card;
    const name = res?.data?.customerName || res?.data?.name || '';
    const lv = res?.data?.level || res?.data?.tier || '';

    const isRefreshing = Boolean(res?.data?.backgroundRefreshing || res?.data?.refreshing);
    setMemberApiRefreshing(isRefreshing);

    // Backend có thể trả dữ liệu local trước rồi kiểm tra API level ở nền.
    // Không để UI kẹt mãi ở "Đang kiểm tra level..." nếu socket memberUpdated bị mất.
    if (isRefreshing) {
      memberRefreshTimerRef.current = setTimeout(() => {
        if (currentMemberCardRef.current === card) {
          setMemberApiRefreshing(false);
        }
        memberRefreshTimerRef.current = null;
      }, 5500);
    }

    setOrderForm(f => ({
      ...f,
      memberCard: card,
      customerCode: code || card,
      customerName: name || 'Chưa có dữ liệu trong Database',
      level: lv || '---',
    }));
  } catch {
    if (seq !== memberLookupSeqRef.current) return;

    if (memberRefreshTimerRef.current) {
      clearTimeout(memberRefreshTimerRef.current);
      memberRefreshTimerRef.current = null;
    }

    setMemberApiRefreshing(false);

    setOrderForm(f => ({
      ...f,
      memberCard: card,
      customerCode: card,
      customerName: 'Không đọc được Database',
      level: '---',
    }));
  } finally {
    if (seq === memberLookupSeqRef.current) {
      setMemberLookupLoading(false);
    }
  }
}, []);

useEffect(() => {
  const card = String(orderForm.memberCard || '').replace(/\s+/g, '').trim();

  if (!card) {
    return;
  }

  // Chỉ lookup API chi tiết khi đã có mã số member.
  if (!/^\d+$/.test(card)) {
    return;
  }

  const t = setTimeout(() => lookupMember(card, { force: false }), 500);
  return () => clearTimeout(t);
}, [orderForm.memberCard, lookupMember]);

useEffect(() => {
  const q = String(memberSearchText || '').trim();

  clearTimeout(memberSearchTimerRef.current);

  if (!q) {
    setMemberSuggestions([]);
    setMemberSearchLoading(false);
    setMemberLookupLoading(false);
    if (memberRefreshTimerRef.current) {
      clearTimeout(memberRefreshTimerRef.current);
      memberRefreshTimerRef.current = null;
    }
    setMemberApiRefreshing(false);
    setMemberDropdownOpen(false);
    setOrderForm(f => ({
      ...f,
      memberCard: '',
      customerCode: '',
      customerName: '',
      level: '',
    }));
    return;
  }

  const compactQ = q.replace(/\s+/g, '');

  // Nếu user nhập toàn số thì đây là member card.
  // Không gọi /api/member-search để tránh quét dữ liệu nặng.
  if (/^\d+$/.test(compactQ)) {
    setMemberSuggestions([]);
    setMemberSearchLoading(false);
    setMemberDropdownOpen(false);

    setOrderForm(f => {
      if (f.memberCard === compactQ && f.customerCode === compactQ) return f;

      return {
        ...f,
        memberCard: compactQ,
        customerCode: compactQ,
        customerName: 'Đang tìm khách...',
        level: 'Đang tìm...',
      };
    });

    return;
  }

  const selectedCode = String(orderForm.memberCard || '').replace(/\s+/g, '').trim();
  const selectedPrefix = selectedCode ? `${selectedCode} -` : '';

  if (
    selectedCode &&
    (q.replace(/\s+/g, '') === selectedCode || q.startsWith(selectedPrefix))
  ) {
    setMemberSuggestions([]);
    setMemberSearchLoading(false);
    setMemberDropdownOpen(false);
    return;
  }

  if (q.length < 2) {
    setMemberSuggestions([]);
    setMemberSearchLoading(false);
    setMemberDropdownOpen(false);
    return;
  }

  memberSearchTimerRef.current = setTimeout(async () => {
    try {
      setMemberSearchLoading(true);

      const res = await axios.get(apiUrl('/api/member-search'), {
        params: { q, limit: 10 },
        timeout: 6000,
      });

      const items = Array.isArray(res?.data?.items) ? res.data.items : [];
      setMemberSuggestions(items);
      setMemberDropdownOpen(true);
    } catch {
      setMemberSuggestions([]);
      setMemberDropdownOpen(false);
    } finally {
      setMemberSearchLoading(false);
    }
  }, 400);

  return () => clearTimeout(memberSearchTimerRef.current);
}, [memberSearchText, orderForm.memberCard]);

  // Submit order
const placeOrder = async () => {
  if (placeOrderLockRef.current) {
    setToast('Order đang được gửi, vui lòng chờ...');
    return;
  }

  if (!selectedTable) return setToast('Hãy chọn bàn');
  if (totalItems <= 0) return setToast('Giỏ trống');

  const staffVal = String(orderForm.staff || '').replace(/\s+/g, '');
  if (!staffVal || !/^\d+$/.test(staffVal)) {
    setToast('Mã nhân viên phải là số');
    return;
  }

  const memberCardVal = String(orderForm.memberCard || orderForm.customerCode || '').replace(/\s+/g, '');

  if (!memberCardVal) {
    setToast('Nhập Member/Name và chọn khách');
    return;
  }

  if (memberLookupLoading) {
    setToast('Đang tìm thông tin khách, vui lòng chờ...');
    return;
  }
const items = Object.entries(currentCart)
  .map(([cartKey, item]) => {
    const offMenu = Boolean(item?.isOffMenu) || isOffMenuKey(cartKey);

if (offMenu) {
  const offMenuName = String(item?.name || '').trim();

return {
  isOffMenu: true,
  imageKey: '',
  imageName: '',
  productCode: OFF_MENU_CODE,
  code: OFF_MENU_CODE,
  group: 'OFF MENU',
  itemGroup: 'OFF MENU',
  name: offMenuName,
  qty: Number(item?.qty || 0),
  note: String(item?.note || '').trim(),
  price: Number(item?.price || 0) || 0,
};
}

    return {
      imageKey: cartKey,
      qty: Number(item?.qty || 0),
      note: item?.note || '',
    };
  })
  .filter((it) => Number(it.qty || 0) > 0);
  const invalidOffMenu = items.find((it) => it.isOffMenu && !String(it.name || '').trim());
if (invalidOffMenu) {
  setToast('Nhập tên món ngoài menu');
  return;
}

placeOrderLockRef.current = true;
setIsPlacingOrder(true);

if (!orderRequestIdRef.current) {
  orderRequestIdRef.current = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

try {
const body = {
  clientRequestId: orderRequestIdRef.current,
  area: selectedTable.area,
  tableNo: selectedTable.tableNo,
  staff: staffVal,
  memberCard: memberCardVal,
     customer: {                              // <— SNAPSHOT ngay tại thời điểm gửi
       code: (orderForm.customerCode || '').trim() || null,
      name: (orderForm.customerName || '').trim() || null,
       level: (orderForm.level || '').trim() || null
    },
        note: orderForm.note || '',
        items,
        consumeStock: false,
      };
      const res = await axios.post(apiUrl('/api/orders'), body);
if (res?.data?.ok) {
  const savedStaff = staffVal;

  localStorage.setItem('lastOrderInfo', JSON.stringify({ staff: savedStaff }));
  setCarts(prev => ({ ...prev, [currentTableKey]: {} }));

  setOrderForm({
    staff: savedStaff,
    memberCard: '',
    customerCode: '',
    customerName: '',
    level: '',
    note: ''
  });
  setMemberSearchText('');
  setMemberSuggestions([]);
  if (memberRefreshTimerRef.current) {
    clearTimeout(memberRefreshTimerRef.current);
    memberRefreshTimerRef.current = null;
  }
  setMemberApiRefreshing(false);
  setMemberDropdownOpen(false);
  setCustomerSpending(null);
  setCustomerSpendingLoading(false);

orderRequestIdRef.current = null;
setShowOrderForm(false);
setToast('Đã gửi Order');
}
    } catch (e) {
      if (e?.response?.status === 409 && Array.isArray(e.response.data?.missing)) {
        const miss = e.response.data.missing;
        setCarts(prev => {
          const cart = { ...(prev[currentTableKey] || {}) };
          miss.forEach(m => {
            const key = String(m.imageName).toLowerCase();
            const available = Math.max(0, Number(m.available || 0));
            const current = cart[key];

            if (!current) return;

            const currentQty = Number(current?.qty || 0);
            if (currentQty > available) {
              cart[key] = { ...current, qty: available };
            }

            if (Number(cart[key]?.qty || 0) <= 0) delete cart[key];
          });
          return { ...prev, [currentTableKey]: cart };
        });
        alert('Một số món không đủ số lượng. Giỏ đã được điều chỉnh theo tồn kho.');
      } else {
        alert('Order thất bại: ' + (e?.response?.data?.error || e?.message || ''));
      }
    } finally {
      placeOrderLockRef.current = false;
      setIsPlacingOrder(false);
    }
  };

  // Helper map imageName -> food
  const findFoodByImageName = (imgName) =>
    foods.find(f => getImageName(f.imageUrl) === String(imgName || '').toLowerCase());

  const getOrderStaffDisplay = (o = {}) => {
    const code = String(o.staff || '').replace(/\s+/g, '').trim();
    const name = String(staffMap?.[code] || '').trim();

    if (!code) return 'Chưa có thông tin';
    return `${code} - ${name || 'Chưa có thông tin'}`;
  };

  const renderUserOrderItems = (order = {}) => (
    <div style={{ display: 'grid', gap: 8 }}>
      {(order.items || []).map((it, idx) => {
        const offMenu = Boolean(it?.isOffMenu);
        const key = it.imageKey || it.imageName || it.imageUrl || '';
        const f = offMenu ? null : findFoodByImageName(key);
        const code = offMenu
          ? String(it.productCode || it.code || OFF_MENU_CODE).trim()
          : String(f?.productCode || f?.code || it.productCode || it.code || '').trim();
        const name = offMenu
          ? `OFF MENU${it.name ? ` - ${String(it.name).trim()}` : ''}`
          : String(f?.productName || f?.name || it.name || key || 'Chưa có tên món').trim();
        const qty = Math.max(1, Number(it.qty || it.quantity || 1));

        return (
          <div
            key={`${order.id || 'order'}-${idx}`}
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
            {f ? (
              <img
                src={imageSrc(f)}
                alt={f.name || ''}
                loading="lazy"
                decoding="async"
                style={{
                  width: 42,
                  height: 42,
                  borderRadius: 7,
                  border: '1px solid #eee',
                  objectFit: 'cover',
                }}
              />
            ) : (
              <div style={{ width: 42, height: 42 }} />
            )}

            <div
              style={{
                fontSize: 13,
                fontWeight: 900,
                color: offMenu ? '#7c3aed' : '#1d4ed8',
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

  const renderOrdersView = () => (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) 420px',
        gap: 12,
        height: '100%',
        minHeight: 0,
        overflow: 'hidden',
      }}
    >
      {/* Left: table tiles */}
      <div style={{ overflowY: 'auto', paddingRight: 4, minHeight: 0, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <h2 style={{ margin: 0 }}>Orders</h2>

          <span style={{ fontSize: 12, color: '#555' }}>
            {ordersViewLoading ? 'Loading… • ' : ''}
            {ordersViewFiltered.length} order(s) • {ordersViewGroupedTables.length} table(s)
            {ordersViewError ? ` • Error: ${ordersViewError}` : ''}
          </span>
        </div>

        {ordersViewGroupedTables.length === 0 ? (
          <div style={{ color: '#6b7280', padding: 12 }}>
            No orders for current filter.
          </div>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
              gap: 12,
            }}
          >
            {ordersViewGroupedTables.map((t) => {
              const isActive =
                ordersViewActiveTable &&
                tableKeyOf(ordersViewActiveTable.area, ordersViewActiveTable.tableNo) === t.key;

              const openCount = t.orders.filter(
                (o) => o.status === ORDER_STATUS.PENDING || o.status === ORDER_STATUS.IN_PROGRESS
              ).length;

              const lastAt = t.latestAt ? t.latestAt.toLocaleString() : '';

              return (
                <div
                  key={t.key}
                  onClick={() => setOrdersViewActiveTable({ area: t.area, tableNo: t.tableNo })}
                  style={{
                    background: isActive ? '#fef3c7' : '#fff',
                    border: isActive ? '2px solid #f59e0b' : '1px solid #e5e7eb',
                    borderRadius: 12,
                    padding: 12,
                    cursor: 'pointer',
                    boxShadow: isActive ? '0 4px 10px rgba(245,158,11,.18)' : 'none',
                  }}
                >
                  <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>
                    {t.area}
                  </div>

                  <div style={{ fontSize: 26, fontWeight: 800 }}>
                    Table {t.tableNo}
                  </div>

                  <div style={{ marginTop: 8, fontSize: 13 }}>
                    <b>{t.orders.length}</b> order(s)
                    {openCount > 0 ? (
                      <span style={{ color: '#dc2626' }}> • {openCount} open</span>
                    ) : (
                      <span style={{ color: '#16a34a' }}> • no open</span>
                    )}
                  </div>

                  <div style={{ marginTop: 6, fontSize: 11, color: '#6b7280' }}>
                    Last: {lastAt}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Right: order details */}
      <div
        style={{
          background: '#fff',
          border: '1px solid #e5e7eb',
          borderRadius: 12,
          overflowY: 'auto',
          minHeight: 0,
          height: '100%',
        }}
      >
{!ordersViewActiveTable ? (
  <div style={{ padding: 12 }}>
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 13, color: '#6b7280', fontWeight: 700 }}>
        Latest Orders
      </div>

      <div style={{ fontSize: 28, fontWeight: 900, color: '#111827' }}>
        {ordersViewFiltered.length} order(s)
      </div>

      <div style={{ fontSize: 12, color: '#6b7280' }}>
        Đơn mới nhất nằm trên cùng. Bấm vào bàn bên trái để lọc riêng theo bàn.
      </div>
    </div>

    {ordersViewFiltered.length === 0 ? (
      <div style={{ color: '#6b7280', padding: 12, background: '#f9fafb', borderRadius: 10 }}>
        Không có order phù hợp bộ lọc hiện tại.
      </div>
    ) : (
      <div style={{ display: 'grid', gap: 12 }}>
        {ordersViewFiltered.slice(0, 100).map((o) => {
          const pill = {
            PENDING: { bg: '#fee2e2', fg: '#991b1b', label: 'PENDING' },
            IN_PROGRESS: { bg: '#dbeafe', fg: '#1d4ed8', label: 'IN PROGRESS' },
            DONE: { bg: '#dcfce7', fg: '#065f46', label: 'DONE' },
            CANCELLED: { bg: '#f3f4f6', fg: '#374151', label: 'CANCELLED' },
          }[o.status] || { bg: '#eee', fg: '#333', label: o.status };

          return (
            <div
              key={o.id}
              onClick={() => setOrdersViewActiveTable({ area: o.area, tableNo: o.tableNo })}
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
                      background: pill.bg,
                      color: pill.fg,
                      padding: '3px 8px',
                      borderRadius: 999,
                      fontWeight: 800,
                    }}
                  >
                    {pill.label}
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

                {renderUserOrderItems(o)}

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
            <div
              style={{
                display: 'flex',
                alignItems: 'baseline',
                justifyContent: 'space-between',
                marginBottom: 8,
              }}
            >
              <div>
                <div style={{ fontWeight: 700, color: '#374151' }}>
                  {ordersViewActiveTable.area}
                </div>

                <div style={{ fontSize: 28, fontWeight: 800 }}>
                  Table {ordersViewActiveTable.tableNo}
                </div>
              </div>

              <button
                onClick={() => setOrdersViewActiveTable(null)}
                style={{
                  border: 'none',
                  background: '#ef4444',
                  color: '#fff',
                  padding: '6px 10px',
                  borderRadius: 6,
                  cursor: 'pointer',
                  fontSize: 12,
                }}
              >
                Close
              </button>
            </div>

            {(() => {
const key = tableKeyOf(ordersViewActiveTable.area, ordersViewActiveTable.tableNo);

const list = ordersViewFiltered
  .filter((o) => orderGroupKeyOf(o) === key)
                .sort((a, b) => {
                  const ta = new Date(a.createdAt || 0);
                  const tb = new Date(b.createdAt || 0);
                  return ordersViewSort === 'time_asc' ? ta - tb : tb - ta;
                });

              if (list.length === 0) {
                return (
                  <div style={{ color: '#6b7280', padding: 8 }}>
                    Không có order phù hợp bộ lọc.
                  </div>
                );
              }

              return (
                <div style={{ display: 'grid', gap: 10 }}>
                  {list.map((o) => {
                    const pill = {
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
                                background: pill.bg,
                                color: pill.fg,
                                padding: '4px 9px',
                                borderRadius: 999,
                                fontWeight: 800,
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {pill.label}
                            </div>
                          </div>

                          <div style={{ marginTop: 12, display: 'grid', gap: 7 }}>
                            <div style={{ fontSize: 16, color: '#374151' }}>
                              Staff: <b style={{ color: '#111827' }}>{getOrderStaffDisplay(o)}</b>
                            </div>

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

                          {renderUserOrderItems(o)}

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

                          {(o.cancelReason || o.reason) && (
                            <div style={{ marginTop: 10, fontSize: 13, color: '#991b1b' }}>
                              ❌ Lý do huỷ: <b>{o.cancelReason || o.reason}</b>
                            </div>
                          )}

                          {/* Read-only: không có Print / Start / Done / Cancel */}
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
  );

   // ===== RENDER =====
  return (
    <div
      style={{ position: 'relative', height: '100vh', overflow: 'hidden' }}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Toggle side menu */}
      <button
        onClick={() => setMenuOpen(!menuOpen)}
        style={{
          position: 'absolute',
          top: 20,
          left: 20,
          zIndex: 999,
          background: 'rgba(255,255,255,0.1)',
          color: 'white',
          fontSize: '22px',
          border: '1px solid rgba(255,255,255,0.3)',
          cursor: 'pointer',
          borderRadius: '50%',
          width: 40,
          height: 40,
          backdropFilter: 'blur(6px)',
          transition: 'background 0.2s ease',
        }}
        aria-label="Toggle menu"
      >
        ☰
      </button>

      {/* Side menu */}
      {menuOpen && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            height: '100vh',
            width: `${MENU_WIDTH}px`,
            background: '#222',
            color: '#fff',
            display: 'flex',
            flexDirection: 'column',
            overflowY: 'auto',
            zIndex: 1000,
            willChange: 'transform',
          }}
        >
         {/* Tabs */}
<div
  style={{
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: 6,
    padding: 8,
  }}
>
            <button
              onClick={() => setMode('tables')}
              style={{
                minWidth: 0,
fontSize: 12,
padding: '8px 6px',
                flex: 1, padding: '8px 10px', borderRadius: 8, border: '1px solid #555',
                background: mode === 'tables' ? '#f59e0b' : '#333', color: '#fff', cursor: 'pointer'
              }}
            >
              Table
            </button>
            <button
              onClick={() => setMode('menu')}
              style={{
                minWidth: 0,
fontSize: 12,
padding: '8px 6px',
                flex: 1, padding: '8px 10px', borderRadius: 8, border: '1px solid #555',
                background: mode === 'menu' ? '#f59e0b' : '#333', color: '#fff', cursor: 'pointer'
              }}
            >
              Menu
            </button>
            <button
    onClick={() => {
      setMode('orders');
      setOrdersViewActiveTable(null);
    }}
    style={{
      minWidth: 0,
fontSize: 12,
padding: '8px 6px',
      flex: 1,
      padding: '8px 6px',
      borderRadius: 8,
      border: '1px solid #555',
      background: mode === 'orders' ? '#f59e0b' : '#333',
      color: '#fff',
      cursor: 'pointer',
      fontSize: 12,
    }}
  >
    Orders
  </button>
            <button
  onClick={() => setMode('insights')}
  style={{
    minWidth: 0,
fontSize: 12,
padding: '8px 6px',
    flex: 1,
    padding: '8px 10px',
    borderRadius: 8,
    border: '1px solid #555',
    background: mode === 'insights' ? '#f59e0b' : '#333',
    color: '#fff',
    cursor: 'pointer',
    fontSize: 12
  }}
>
  Insights
</button>
          </div>
{mode === 'orders' && (
  <div style={{ display: 'grid', gap: 8, padding: '0 8px 12px' }}>
    <div style={{ fontWeight: 700, marginTop: 8 }}>Order filters</div>
    <label style={{ fontSize: 12, color: '#9ca3af' }}>Search member / customer</label>
<input
  value={ordersViewCustomerSearch}
  onChange={(e) => {
    setOrdersViewCustomerSearch(e.target.value);
    setOrdersViewActiveTable(null);
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

{ordersViewCustomerSearch.trim() && (
  <button
    onClick={() => {
      setOrdersViewCustomerSearch('');
      setOrdersViewActiveTable(null);
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

    <label style={{ fontSize: 12, color: '#9ca3af' }}>Date range</label>
    <select
      value={ordersViewDateRange}
      onChange={(e) => {
        setOrdersViewDateRange(e.target.value);
        setOrdersViewActiveTable(null);
      }}
      style={{
        padding: 8,
        background: '#1f2937',
        color: '#fff',
        border: '1px solid #374151',
        borderRadius: 6,
      }}
    >
      <option value="today">Hôm nay</option>
      <option value="all">All orders</option>
      <option value="yesterday">Yesterday</option>
      <option value="week">Tuần này</option>
      <option value="month">Tháng này</option>
      <option value="year">Năm này</option>
      <option value="custom">Custom…</option>
    </select>

    {ordersViewDateRange === 'custom' && (
      <div style={{ display: 'grid', gap: 6 }}>
        <input
          type="date"
          value={ordersViewFromDate}
          onChange={(e) => setOrdersViewFromDate(e.target.value)}
          style={{
            padding: 8,
            background: '#1f2937',
            color: '#fff',
            border: '1px solid #374151',
            borderRadius: 6,
          }}
        />

        <input
          type="date"
          value={ordersViewToDate}
          onChange={(e) => setOrdersViewToDate(e.target.value)}
          style={{
            padding: 8,
            background: '#1f2937',
            color: '#fff',
            border: '1px solid #374151',
            borderRadius: 6,
          }}
        />
      </div>
    )}

    <label style={{ fontSize: 12, color: '#9ca3af' }}>Status</label>
    <select
      value={ordersViewFilter}
      onChange={(e) => {
        setOrdersViewFilter(e.target.value);
        setOrdersViewActiveTable(null);
      }}
      style={{
        padding: 8,
        background: '#1f2937',
        color: '#fff',
        border: '1px solid #374151',
        borderRadius: 6,
      }}
    >
      {ORDER_FILTERS.map((f) => (
        <option key={f} value={f}>{f}</option>
      ))}
    </select>

    <label style={{ fontSize: 12, color: '#9ca3af' }}>Sort by</label>
    <select
      value={ordersViewSort}
      onChange={(e) => setOrdersViewSort(e.target.value)}
      style={{
        padding: 8,
        background: '#1f2937',
        color: '#fff',
        border: '1px solid #374151',
        borderRadius: 6,
      }}
    >
      <option value="time_desc">Time: Newest → Oldest</option>
      <option value="time_asc">Time: Oldest → Newest</option>
      <option value="table_asc">Table: A→Z • 1→9</option>
      <option value="table_desc">Table: Z→A • 9→1</option>
    </select>

    <button
      onClick={fetchOrdersView}
      disabled={ordersViewLoading}
      style={{
        padding: 8,
        background: ordersViewLoading ? '#6b7280' : '#2563eb',
        color: '#fff',
        border: 'none',
        borderRadius: 6,
        cursor: ordersViewLoading ? 'not-allowed' : 'pointer',
      }}
    >
      {ordersViewLoading ? 'Refreshing…' : 'Refresh'}
    </button>
  </div>
)}
          {/* Status pill */}
          <div style={{ padding: 12 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 10px',
                borderRadius: 999,
                background:
                  connState === 'connected'
                    ? 'rgba(34,197,94,0.22)'
                    : connState === 'connecting'
                    ? 'rgba(59,130,246,0.22)'
                    : 'rgba(115,115,115,0.22)',
                color: '#fff',
                border: '1px solid rgba(255,255,255,0.25)',
                backdropFilter: 'blur(4px)',
                fontWeight: 600,
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background:
                    connState === 'connected'
                      ? '#22c55e'
                      : connState === 'connecting'
                      ? '#3b82f6'
                      : '#9ca3af',
                }}
              />
              <span style={{ whiteSpace: 'nowrap' }}>
                {connState === 'connected' && <>✓ Connected{lastSyncAt ? ` • ${lastSyncAt.toLocaleTimeString()}` : ''}</>}
                {connState === 'connecting' && 'Connecting…'}
                {connState === 'offline' && 'Trying to reconnect…'}
              </span>
            </div>
          </div>

          {/* Sidebar body */}
          <div style={{ flexGrow: 1, overflowY: 'auto' }}>
{mode === 'insights' ? (
  <div style={{ padding: 10, color: '#d1d5db', fontSize: 12, lineHeight: 1.5 }}>
    
  </div>
) : mode === 'menu' ? (
              <>
                {!selectedLevel &&
                  LEVELS.map((level) => (
                    <div
                      key={level}
                      onClick={() => { setSelectedLevel(level); setSelectedType(null); }}
                      style={sidebarItemStyle}
                    >
                      Level {level}
                    </div>
                  ))}

                {selectedLevel && menuOptions.map((type) => {
                  const key = (type === SOLD_OUT_MENU) ? SOLD_OUT_KEY : type;
                  const isActive = selectedType === key;
                  return (
                    <div
                      key={key}
                      onClick={() => setSelectedType(key)}
                      style={{
                        ...sidebarItemStyle,
                        background: isActive ? '#555' : '#333',
                        fontWeight: isActive ? 'bold' : 'normal',
                      }}
                    >
                      {type}
                    </div>
                  );
                })}
              </>
            ) : mode === 'tables' ? (
              <>
                <div style={{ padding: '8px 10px' }}>
                  <input
                    value={tableSearch}
                    onChange={e => setTableSearch(e.target.value)}
                    placeholder="Search…"
                    style={{
                      width: '100%', padding: 6, borderRadius: 6,
                      border: '1px solid #555', background: '#111', color: '#fff'
                    }}
                  />
                </div>

                {AREA_DEFS.map(a => (
                  <div
                    key={a.name}
                    onClick={() => setActiveArea(a.name)}
                    style={{
                      ...sidebarItemStyle,
                      background: activeArea === a.name ? '#555' : '#333',
                      fontWeight: activeArea === a.name ? 'bold' : 'normal'
                    }}
                  >
                    {a.name}
                  </div>
                ))}

                <div style={{ padding: '8px 10px', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
                  {visibleTables.map(({ area, tableNo }) => {
                    const isSel = selectedTable && selectedTable.area === area && selectedTable.tableNo === tableNo;
                    const { count: oCount, color: oColor } = openOrderBadgeFor(area, tableNo);
                    const cartCount = tableCartCount(area, tableNo);
                    const hasCart = cartCount > 0;

                    return (
                      <button
                        key={`${area}-${tableNo}`}
                        onClick={() => { setSelectedTable({ area, tableNo }); }}
                        style={{
                          position: 'relative',
                          padding: '6px 8px', borderRadius: 6, border: '1px solid #666',
                          background: isSel ? '#16a34a' : (hasCart ? '#2563eb' : '#2d2d2d'),
                          color: '#fff', cursor: 'pointer', display: 'grid', gap: 2
                        }}
                        title={`${area} - ${tableNo}`}
                      >
                        {oCount > 0 && (
                          <span style={{
                            position: 'absolute', top: 6, right: 6, fontSize: 11,
                            background: oColor, color: '#fff', padding: '2px 6px',
                            borderRadius: 999, border: '1px solid rgba(255,255,255,0.2)'
                          }}>
                            x{oCount}
                          </span>
                        )}
                        <span style={{ fontWeight: 700 }}>{tableNo}</span>
                        <span style={{ fontSize: 10, opacity: 0.9 }}>{area}</span>
                      </button>
                    );
                  })}
                </div>
              </>
              ) : (
  <div style={{ padding: 10, color: '#d1d5db', fontSize: 12, lineHeight: 1.5 }}>
    Nhập mã khách ở màn chính để xem món khách hay gọi, ghi chú món và gợi ý món.
  </div>
            )}
          </div>

          {/* Back cho menu */}
          {mode === 'menu' && (selectedLevel || selectedType) && (
            <div style={{ paddingTop: 10, paddingBottom: 10 }}>
              {selectedType && (
                <button onClick={() => setSelectedType(null)} style={backButtonStyle}>⬅</button>
              )}
              {!selectedType && selectedLevel && (
                <button onClick={() => setSelectedLevel(null)} style={backButtonStyle}>⬅</button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Main */}
      <div
        style={{
          height: '100vh',
          background: '#fff8dc',
          marginLeft: menuOpen ? `${MENU_WIDTH}px` : 0,
          transition: 'margin-left 0.3s ease',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* TOP BAR */}
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: menuOpen ? `${MENU_WIDTH}px` : 0,
            right: 0,
            height: TOP_BAR_H,
            background: '#fff',
            borderBottom: '1px solid #eee',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '8px 12px',
            zIndex: 1900,
          }}
        >
          <button
            onClick={() => setMode(mode === 'tables' ? 'menu' : 'tables')}
            style={{
              padding: '6px 10px',
              borderRadius: 8,
              border: '1px solid #ddd',
              background: selectedTable ? '#fde68a' : '#eee',
              cursor: 'pointer',
              fontSize: 13,
            }}
            title="Nhấn để chuyển qua lại Bàn/Menu"
          >
            {selectedTable ? `Table: ${selectedTable.area} - ${selectedTable.tableNo}` : 'Hãy chọn bàn'}
          </button>

          {mode === 'tables' && (
            <button
              onClick={() => { setSelectedTable(null); setMode('tables'); }}
              aria-label="Đóng chọn bàn"
              title="Đóng chọn bàn"
              style={{
                padding: '6px 10px',
                borderRadius: 8,
                border: '1px solid #ddd',
                background: '#fff',
                cursor: 'pointer',
                fontSize: 13,
              }}
            >
              ✕
            </button>
          )}

          {selectedTable && (
            <span style={{ fontSize: 12, color: '#555' }}>
              Đang chọn: <b>{totalItems}</b> món
            </span>
          )}

          {mode === 'menu' && selectedLevel && (
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search…"
              style={{ marginLeft: 'auto', width: 220, padding: '6px 8px', border: '1px solid #ddd', borderRadius: 6, fontSize: 13, background: '#fff' }}
            />
          )}
        </div>

        {/* CONTENT SCROLL AREA */}
        <div
          style={{
            position: 'fixed',
            top: TOP_BAR_H,
            left: menuOpen ? `${MENU_WIDTH}px` : 0,
            right: 0,
            bottom: selectedTable && mode !== 'orders' && mode !== 'insights' ? BOTTOM_BAR_H : 0,
            overflowY: 'auto',
            padding: '12px 16px',
            background: '#fff8dc',
            zIndex: 100,
          }}
        >
{mode === 'orders' ? (
  renderOrdersView()
) : mode === 'insights' ? (
<UserCustomerInsightsPanel
  apiUrl={apiUrl}
  withBase={withBase}
  currentMemberCard={orderForm.memberCard}
  staffMap={staffMap}
  initialProfileCode={insightsOpenCode}
  onOpenedProfileCode={() => setInsightsOpenCode('')}
  onOpenOrders={() => setMode('orders')}
/>
) : mode === 'menu' ? (
  selectedLevel ? (
              <>
                {/* Grid món */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: `repeat(${columns}, 1fr)`,
                    gap: 16,
                  }}
                >
                  {foodsForDisplay.map((food, idx) => (
                    <div
                      key={food.id}
                      style={{
                        borderRadius: 8,
                        overflow: 'hidden',
                        border: '1px solid #ccc',
                        background: '#fff',
                        cursor: 'pointer',
                        position: 'relative',
                      }}
                      onClick={() => openPreviewAt(food.imageUrl)}
                    >
                      <div style={{ position: 'relative' }}>
<img
  src={thumbSrc(food)}
  alt=""
  loading={idx < 8 ? 'eager' : 'lazy'}
  decoding="async"
  fetchPriority={idx < 8 ? 'high' : 'auto'}
  onError={(e) => {
    const full = imageSrc(food);
    if (e.currentTarget.src !== full) {
      e.currentTarget.src = full;
    }
  }}
  style={{
    width: '100%',
    aspectRatio: '3 / 4',
    objectFit: 'cover',
    display: 'block',
    background: '#f3f4f6',
  }}
/>
                      </div>

                      {/* Controls chỉ hiện khi đã chọn bàn */}
                      {selectedTable && (
                        <div
                          onClick={(e) => e.stopPropagation()}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 8,
                            padding: 8,
                            background: '#fff',
                            borderTop: '1px solid #eee'
                          }}
                        >
                          <button
                            onClick={() => decItem(food)}
                            style={{ width: 32, height: 32, borderRadius: 8, border: '1px solid #ddd', background: '#fff', cursor: 'pointer' }}
                            title="Giảm"
                          >
                            −
                          </button>
                          <div
                            style={{
                              minWidth: 40,
                              textAlign: 'center',
                              fontWeight: 700,
                              border: '1px solid #eee',
                              borderRadius: 8,
                              padding: '4px 8px',
                              background: '#f9fafb'
                            }}
                          >
                            {cartQtyOf(getImageName(food.imageUrl))}
                          </div>
                          <button
                            onClick={() => incItem(food)}
                            style={{ width: 32, height: 32, borderRadius: 8, border: '1px solid #ddd', background: '#fff', cursor: 'pointer' }}
                            title="Tăng"
                          >
                            +
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {foodsForDisplay.length === 0 && <p style={{ padding: 8 }}>Không có món nào.</p>}
              </>
            ) : null
          ) : (
            // ====== TRANG BÀN ======
            <>
              {!selectedTable ? (
                <div style={{ padding: 12, color: '#6b7280' }}>Hãy chọn bàn ở thanh bên trái.</div>
              ) : (
                <div style={{ background: '#fff', border: '1px solid #eee', borderRadius: 8 }}>
                  {/* Header */}
                  <div style={{ padding: '12px 14px', borderBottom: '1px solid #eee', display: 'flex', alignItems: 'center' }}>
                    <div style={{ fontWeight: 700 }}>Table {selectedTable.tableNo}</div>
                    <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                      <button
                        onClick={() => setMode('menu')}
                        style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid #ddd', background: '#fff', cursor: 'pointer', fontSize: 13 }}
                      >
                        + Thêm món
                      </button>
                      <button
  onClick={addOffMenuItem}
  style={{
    padding: '6px 10px',
    borderRadius: 8,
    border: '1px solid #8b5cf6',
    background: '#fff',
    color: '#7c3aed',
    cursor: 'pointer',
    fontSize: 13
  }}
>
  + Món ngoài menu
</button>
                          {Object.keys(currentCart).length > 0 && (
      <button
        onClick={() => setCarts(prev => ({ ...prev, [currentTableKey]: {} }))}
        style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid #ef4444', background: '#fff', color: '#ef4444', cursor: 'pointer', fontSize: 13 }}
        title="Xoá toàn bộ món đã chọn"
      >
        Xoá giỏ
      </button>
    )}
                    </div>
                  </div>

                  {/* Cart */}
                  <div style={{ padding: 12 }}>
                    {Object.keys(currentCart).length === 0 ? (
                      <div style={{ color: '#6b7280' }}>Chưa chọn món nào. Nhấn “+ Thêm món”.</div>
                    ) : (
                      <div style={{ display: 'grid', gap: 8 }}>
{Object.entries(currentCart).map(([cartKey, item]) => {
  const offMenu = Boolean(item?.isOffMenu) || isOffMenuKey(cartKey);
  const f = offMenu ? null : findFoodByImageName(cartKey);

  return (
    <div key={cartKey} style={{ display:'flex', alignItems:'center', marginBottom:8, gap: 8 }}>
      {offMenu ? (
        <div style={{ flex: 1, display: 'grid', gap: 6 }}>
<div style={{ fontSize: 12, fontWeight: 700, color: '#7c3aed' }}>
  {OFF_MENU_LABEL}
</div>

          <input
            value={item.name || ''}
            onChange={(e) =>
              setCarts((prev) => {
                const cart = { ...(prev[currentTableKey] || {}) };
                cart[cartKey] = { ...(cart[cartKey] || {}), name: e.target.value, isOffMenu: true };
                return { ...prev, [currentTableKey]: cart };
              })
            }
            placeholder="Nhập tên món ngoài menu..."
            style={{ padding: 6, border: '1px solid #ddd', borderRadius: 6 }}
          />
        </div>
      ) : f ? (
        <>
          <img
            src={imageSrc(f)}
            alt={f.name}
            loading="lazy"
decoding="async"
            style={{ width: 40, height: 40, marginRight: 8, borderRadius: 4 }}
          />
          <div style={{ flex: 1 }}>
            <div>
              {(f.productCode || f.code) && (
                <span style={{ fontWeight: 600, marginRight: 4 }}>
                  [{f.productCode || f.code}]
                </span>
              )}
              {f.productName || f.name}
            </div>
          </div>
        </>
      ) : (
        <div style={{ flex: 1 }}>{cartKey}</div>
      )}

      <div style={{ display:'flex', alignItems:'center', gap: 8 }}>
        <button
          onClick={() => {
            if (offMenu) setCartQty(cartKey, Math.max(0, Number(item.qty || 0) - 1));
            else decItem(f || { imageUrl: cartKey });
          }}
        >
          −
        </button>

        <div style={{ minWidth: 32, textAlign: 'center' }}>{item.qty}</div>

        <button
          onClick={() => {
            if (offMenu) setCartQty(cartKey, Number(item.qty || 0) + 1);
            else incItem(f || { imageUrl: cartKey });
          }}
        >
          +
        </button>

        <div
  style={{
    minWidth: 140,
    fontSize: 12,
    color: '#6b7280',
    padding: '4px 6px',
    border: '1px dashed #ddd',
    borderRadius: 6,
    background: '#fafafa'
  }}
>
  {item.note ? `📝 ${item.note}` : 'Ghi chú trong Order'}
</div>

        <button onClick={() => setCartQty(cartKey, 0)}>Xóa</button>
      </div>
    </div>
  );
})}

                      </div>
                    )}
                  </div>

                  {/* Orders đã gửi */}
                  <div style={{ marginTop: 12, borderTop: '1px solid #eee' }}>
                    <div style={{ padding: '12px 14px', display: 'flex', alignItems: 'center' }}>
                      <div style={{ fontWeight: 700 }}>Đơn đã gửi</div>
                      <div style={{ marginLeft: 'auto', fontSize: 12, color: '#6b7280' }}>
                        {tableOrders.filter(o => !o.tableClosed).length} đơn đang mở
                      </div>
                    </div>

                    <div style={{ padding: 12 }}>
                      {tableOrders.filter(o => !o.tableClosed).length === 0 ? (
                        <div style={{ color: '#6b7280' }}>Chưa có đơn nào hoặc đã đóng bàn.</div>
                      ) : (
                        <div style={{ display: 'grid', gap: 10 }}>

                          {tableOrders.filter(o => !o.tableClosed).map((o) => {
  const pill = {
    PENDING:    { bg:'#fee2e2', fg:'#991b1b', label:'PENDING' },
    IN_PROGRESS:{ bg:'#dbeafe', fg:'#1d4ed8', label:'IN PROGRESS' },
    DONE:       { bg:'#dcfce7', fg:'#065f46', label:'DONE' },
    CANCELLED:  { bg:'#f3f4f6', fg:'#374151', label:'CANCELLED' },
  }[o.status] || { bg:'#eee', fg:'#333', label:o.status };

return (
  <div key={o.id} style={{ border:'1px solid #eee', borderRadius:8, overflow:'hidden' }}>
    <div
      style={{
        padding: 10,
        background: '#f9fafb',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 10,
        borderBottom: '1px solid #eee'
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ fontWeight: 700 }}>Order #{o.id}</div>
          <div style={{ fontSize: 12, color: '#6b7280' }}>
            {o.createdAt ? new Date(o.createdAt).toLocaleString() : ''}
          </div>
        </div>

        <div style={{ fontSize: 12, color: '#6b7280', lineHeight: 1.5 }}>
          <div>
            Staff:{' '}
            <b>
              {staffMap[o.staff]
                ? `${o.staff} - ${staffMap[o.staff]}`
                : (o.staff || '')}
            </b>
          </div>

          <div>
            Customer:{' '}
            <b>
              {(() => {
                const custName =
                  (o.customerName != null && o.customerName !== undefined)
                    ? o.customerName
                    : (o.customer && typeof o.customer === 'object'
                        ? (o.customer.name || '')
                        : '');

                return o.memberCard
                  ? (custName ? `${o.memberCard} - ${custName}` : o.memberCard)
                  : (custName || '');
              })()}
            </b>
          </div>
        </div>
      </div>

      <div
        style={{
          fontSize: 12,
          background: pill.bg,
          color: pill.fg,
          padding: '2px 8px',
          borderRadius: 999,
          fontWeight: 700,
          whiteSpace: 'nowrap'
        }}
      >
        {pill.label}
      </div>
    </div>

    <div style={{ padding:10 }}>
        <div style={{ display:'grid', gridTemplateColumns:'1fr auto', rowGap:6, alignItems:'center' }}>
          {o.items.map((it, idx) => {
            // Ưu tiên dùng imageKey (do backend enrichItem tạo ra)
const offMenu = Boolean(it?.isOffMenu);
const key = it.imageKey || it.imageName;
const f = offMenu ? null : findFoodByImageName(key);
const label = offMenu
  ? `${it.productCode || it.code || OFF_MENU_CODE} - OFF MENU${it.name ? ` - ${String(it.name).trim()}` : ''}`
  : (f?.productName || f?.name || it.name || key || '').trim();

            return (
              <React.Fragment key={idx}>
                <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                  {f ? (
                    <img
                      src={imageSrc(f)}
                      alt={f.name}
                      loading="lazy"
decoding="async"
                      style={{ width: 40, height: 40, borderRadius: 6, border:'1px solid #eee' }}
                    />
                  ) : (
                    <div style={{ width: 40, height: 40 }} />
                  )}

<div style={{ fontSize: 12 }}>
{!offMenu && (f?.productCode || f?.code) && (
  <span style={{ fontWeight: 600, marginRight: 4 }}>
    [{f.productCode || f.code}]
  </span>
)}
{label}
</div>
                </div>

                <div style={{ fontWeight: 700 }}>x{it.qty}</div>
              </React.Fragment>
            );
          })}
        </div>

                                  {o.note && (
                                    <div style={{ marginTop: 8, fontSize: 12, color: '#6b7280' }}>📝 {o.note}</div>
                                  )}
                                  {(o.cancelReason || o.reason) && (
                                    <div style={{ marginTop: 8, fontSize: 12, color: '#991b1b' }}>
                                      ❌ Lý do huỷ: <b>{o.cancelReason || o.reason}</b>
                                    </div>
                                  )}

                                  <div style={{ marginTop:10, display:'flex', gap:8 }}>
                                    <button
                                      onClick={async () => {
                                        try { await axios.post(apiUrl(`/api/orders/${o.id}/close`), { by: orderForm.staff || 'user' }); }
                                        catch(e){ alert('Không đóng được order: ' + (e?.response?.data?.error || e?.message || '')); }
                                      }}
                                      style={{ padding:'6px 10px', background:'#111', color:'#fff', border:'none', borderRadius:8, cursor:'pointer', fontSize:12 }}
                                      title="Khách rời bàn (ẩn order khỏi bàn)"
                                    >
                                      Done (Thu bàn)
                                    </button>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

{/* ORDER BAR */}
{selectedTable && mode !== 'orders' && mode !== 'insights' && (
          <div
            style={{
              position: 'fixed',
              left: menuOpen ? `${MENU_WIDTH}px` : 0,
              right: 0,
              bottom: 0,
              height: BOTTOM_BAR_H,
              background: '#fff',
              borderTop: '1px solid #eee',
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '8px 12px',
              zIndex: 2000,
            }}
          >
            <div style={{ fontSize: 13, color: '#444' }}>
              Table <b>{selectedTable.tableNo}</b> • Món đã chọn: <b>{totalItems}</b>
            </div>
            <button
              onClick={() => setShowOrderForm(true)}
              disabled={totalItems <= 0 || connState !== 'connected'}
              style={{
                marginLeft: 'auto',
                padding: '8px 12px',
                background: totalItems>0 ? '#10b981' : '#9ca3af',
                color:'#fff',
                border:'none',
                borderRadius:8,
                cursor: totalItems>0 ? 'pointer' : 'not-allowed',
                fontSize: 13
              }}
            >
              Order
            </button>
          </div>
        )}
      </div>
{globalCustomerEventAlert && (
  <div
    onClick={() => {
      const code = String(globalCustomerEventAlert.memberCode || '').replace(/\s+/g, '').trim();

      if (code) {
        setInsightsOpenCode(code);
      }

      setMode('insights');
      setGlobalCustomerEventAlert(null);
    }}
    style={{
      position: 'fixed',
      right: 18,
      bottom: 18,
      width: 360,
      maxWidth: 'calc(100vw - 36px)',
      background: '#111827',
      color: '#fff',
      borderRadius: 14,
      boxShadow: '0 16px 40px rgba(0,0,0,.28)',
      border: '1px solid rgba(255,255,255,.18)',
      zIndex: 30000,
      padding: 14,
      cursor: 'pointer',
    }}
  >
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: 999,
          background: '#f59e0b',
          display: 'grid',
          placeItems: 'center',
          fontWeight: 900,
          flex: '0 0 auto',
        }}
      >
        🔔
      </div>

      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontWeight: 800, marginBottom: 4 }}>
          Customer Event
        </div>

        <div style={{ fontSize: 13, color: '#e5e7eb', marginBottom: 4 }}>
          {globalCustomerEventAlert.alarmLabel || 'Nhắc sự kiện'}
        </div>

        <div style={{ fontSize: 14, fontWeight: 800 }}>
          {globalCustomerEventAlert.memberCode || ''}
          {globalCustomerEventAlert.customerName
            ? ` - ${globalCustomerEventAlert.customerName}`
            : ''}
        </div>

        <div style={{ fontSize: 12, color: '#d1d5db', marginTop: 4 }}>
          Vào club:{' '}
          <b>
            {globalCustomerEventAlert.eventAt
              ? new Date(globalCustomerEventAlert.eventAt).toLocaleString()
              : ''}
          </b>
        </div>

        {globalCustomerEventAlert.note && (
          <div style={{ fontSize: 12, color: '#d1d5db', marginTop: 4 }}>
            📝 {globalCustomerEventAlert.note}
          </div>
        )}

        <div style={{ fontSize: 12, color: '#93c5fd', marginTop: 8 }}>
          Bấm để mở Insights
        </div>
      </div>

      <button
        onClick={(e) => {
          e.stopPropagation();
          setGlobalCustomerEventAlert(null);
        }}
        style={{
          border: 'none',
          background: 'rgba(255,255,255,.12)',
          color: '#fff',
          borderRadius: 8,
          width: 28,
          height: 28,
          cursor: 'pointer',
          flex: '0 0 auto',
        }}
        title="Đóng thông báo"
      >
        ×
      </button>
    </div>
  </div>
)}
      {/* Preview overlay */}
      {previewImage && (
        <div
          onClick={closePreview}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.75)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            cursor: 'zoom-out',
            userSelect: 'none',
          }}
        >
          <button
            onClick={(e) => { e.stopPropagation(); goPrev(); }}
            aria-label="Previous image"
            style={{
              position: 'absolute',
              left: 20, top: '50%', transform: 'translateY(-50%)',
              fontSize: 28, lineHeight: 1, padding: '10px 14px',
              background: 'rgba(255,255,255,0.15)', color: '#fff',
              border: '1px solid rgba(255,255,255,0.35)',
              borderRadius: 999, cursor: 'pointer', backdropFilter: 'blur(6px)'
            }}
          >‹</button>

          <img
            src={withBase(previewImage)}
            alt="Preview"
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: '90vw',
              maxHeight: '90vh',
              borderRadius: 8,
              boxShadow: '0 0 15px rgba(0,0,0,0.5)',
              cursor: 'default'
            }}
          />

          <button
            onClick={(e) => { e.stopPropagation(); goNext(); }}
            aria-label="Next image"
            style={{
              position: 'absolute',
              right: 20, top: '50%', transform: 'translateY(-50%)',
              fontSize: 28, lineHeight: 1, padding: '10px 14px',
              background: 'rgba(255,255,255,0.15)', color: '#fff',
              border: '1px solid rgba(255,255,255,0.35)',
              borderRadius: 999, cursor: 'pointer', backdropFilter: 'blur(6px)'
            }}
          >›</button>

          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'absolute', bottom: 20, left: '50%', transform: 'translateX(-50%)',
              fontSize: 12, padding: '6px 10px',
              background: 'rgba(0,0,0,0.35)', color: '#fff',
              borderRadius: 999, border: '1px solid rgba(255,255,255,0.25)'
            }}
          >
            {previewIndex + 1} / {galleryList.length}
          </div>
          {/* Nút Order nhanh trong preview overlay */}
<button
  onClick={(e) => {
    e.stopPropagation();
    const food = galleryList[previewIndex];
    if (food) {
      // lưu món hiện tại và prefill staff từ orderForm
      setQuickOrderFood(food);
      setQuickOrderForm(prev => ({ ...prev, staff: orderForm.staff || prev.staff, members: '' }));
    }
  }}
  aria-label="Order this item"
  style={{
    position: 'absolute',
    bottom: 80,
    left: 20,
    padding: '8px 12px',
    background: '#10b981',
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: 13,
  }}
>
  Order
</button>
        </div>
      )}

      {/* Order Form Overlay */}
      {showOrderForm && (
  <div
    onClick={() => {
  if (!isPlacingOrder) setShowOrderForm(false);
}}
    style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(0,0,0,0.5)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 9999,
      padding: 12,
    }}
  >
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        width: 'min(560px, calc(100vw - 24px))',
        maxHeight: '85vh',
        overflowY: 'auto',
        background: '#fff',
        borderRadius: 10,
        padding: 16,
      }}
    >
      <h3 style={{ marginTop: 0 }}>Tạo Order</h3>

      <div style={{ display: 'grid', gap: 10 }}>
        <div>
          <label>Staff *</label>
          <input
            type="number"
            pattern="[0-9]*"
            inputMode="numeric"
            value={orderForm.staff}
            onChange={e =>
  setOrderForm(f => ({
    ...f,
    staff: e.target.value.replace(/\s+/g, ''),
  }))
}
            placeholder="Mã nhân viên"
            style={{ width: '100%', padding: 8, border: '1px solid #ddd', borderRadius: 6 }}
          />
          {staffName && (
            <div style={{ marginTop: 4, fontSize: 12, color: '#6b7280' }}>
              Tên nhân viên: {staffName}
            </div>
          )}
        </div>

        <div style={{ position: 'relative' }}>
          <label>Member/Name *</label>
          <input
            value={memberSearchText}
            onFocus={() => {
              if (memberSuggestions.length > 0) setMemberDropdownOpen(true);
            }}
            onBlur={() => {
              setTimeout(() => setMemberDropdownOpen(false), 160);
            }}
            onChange={e => {
              const raw = e.target.value;
              const compact = raw.replace(/\s+/g, '').trim();

              setMemberSearchText(raw);
              setMemberDropdownOpen(true);
              setMemberLookupLoading(false);
              if (memberRefreshTimerRef.current) {
                clearTimeout(memberRefreshTimerRef.current);
                memberRefreshTimerRef.current = null;
              }
              setMemberApiRefreshing(false);
              memberLookupSeqRef.current += 1;

              setOrderForm(f => ({
                ...f,
                memberCard: /^\d+$/.test(compact) ? compact : '',
                customerCode: /^\d+$/.test(compact) ? compact : '',
                customerName: '',
                level: '',
              }));
            }}
            placeholder="Nhập mã member hoặc tên khách"
            style={{ width: '100%', padding: 8, border: '1px solid #ddd', borderRadius: 6 }}
          />

          {memberLookupLoading && (
            <div style={{ marginTop: 4, fontSize: 12, color: '#2563eb' }}>
              Đang tra cứu thông tin khách...
            </div>
          )}

          {!memberLookupLoading && memberApiRefreshing && (
            <div style={{ marginTop: 4, fontSize: 12, color: '#7c3aed' }}>
              Đã hiện dữ liệu từ Database. Backend đang đồng bộ API ở nền; khi Database cập nhật, thông tin khách sẽ tự đổi.
            </div>
          )}

          {!memberLookupLoading &&
            orderForm.memberCard &&
            ['Chưa có dữ liệu trong Database', 'Không đọc được Database'].includes(orderForm.customerName) && (
              <div style={{ marginTop: 4, fontSize: 12, color: '#dc2626' }}>
                Database chưa có thông tin khách này. Backend vẫn đang thử đồng bộ từ Customer API ở nền.
              </div>
            )}

          {memberDropdownOpen && (memberSearchLoading || memberSuggestions.length > 0) && (
            <div
              style={{
                position: 'absolute',
                top: '100%',
                left: 0,
                right: 0,
                zIndex: 10002,
                marginTop: 4,
                maxHeight: 260,
                overflowY: 'auto',
                background: '#fff',
                border: '1px solid #ddd',
                borderRadius: 8,
                boxShadow: '0 8px 20px rgba(0,0,0,0.15)',
              }}
            >
              {memberSearchLoading && (
                <div style={{ padding: 10, fontSize: 12, color: '#6b7280' }}>
                  Đang tìm khách...
                </div>
              )}

              {!memberSearchLoading && memberSuggestions.map((m) => (
                <div
                  key={m.code}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    selectMemberSuggestion(m);
                  }}
                  style={{
                    padding: '8px 10px',
                    cursor: 'pointer',
                    borderBottom: '1px solid #f3f4f6',
                  }}
                >
                  <div style={{ fontWeight: 700, color: '#111827' }}>
                    {m.code} - {m.name || 'Chưa có tên'}
                  </div>
                  <div style={{ fontSize: 12, color: '#6b7280' }}>
                    Level: {m.level || '---'} • Orders: {m.ordersCount || 0}
                    {m.lastOrderAt ? ` • Gần nhất: ${new Date(m.lastOrderAt).toLocaleDateString()}` : ''}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

<div>
  <label>Name</label>
  <input
    value={orderForm.customerName}
    readOnly
    placeholder="Chưa có thông tin"
    style={{ width: '100%', padding: 8, border: '1px solid #ddd', borderRadius: 6, background: '#f3f4f6' }}
  />

  <label style={{ display: 'block', marginTop: 10 }}>Level</label>
  <input
    value={orderForm.level}
    readOnly
    placeholder="Chưa có thông tin"
    style={{ width: '100%', padding: 8, border: '1px solid #ddd', borderRadius: 6, background: '#f3f4f6' }}
  />

  {(customerSpendingLoading || customerSpending) && (
    <div
      style={{
        marginTop: 10,
        border: '1px solid #dbeafe',
        background: '#eff6ff',
        borderRadius: 10,
        padding: 10,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <div style={{ fontWeight: 800, color: '#1e3a8a' }}>
          Tổng tiền khách đã order
        </div>

        {customerSpendingLoading && (
          <div style={{ fontSize: 12, color: '#2563eb' }}>
            Đang tải...
          </div>
        )}

        {customerSpending?.code && (
          <button
            type="button"
            onClick={() => {
              setInsightsOpenCode(customerSpending.code);
              setMode('insights');
              setShowOrderForm(false);
            }}
            style={{
              marginLeft: 'auto',
              border: 'none',
              background: '#2563eb',
              color: '#fff',
              borderRadius: 6,
              padding: '4px 8px',
              cursor: 'pointer',
              fontSize: 12,
            }}
          >
            Xem Insights
          </button>
        )}
      </div>

      {customerSpending && (
        <>
<div
  style={{
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: 8,
  }}
>
  <div style={{ background: '#fff', borderRadius: 8, padding: 8 }}>
    <div style={{ fontSize: 11, color: '#6b7280' }}>Today</div>
    <div style={{ fontWeight: 800, color: '#111827' }}>
      {formatMoneyVnd(customerSpending.today?.total)}
    </div>
    <div style={{ fontSize: 11, color: '#6b7280' }}>
      {customerSpending.today?.orders || 0} order
    </div>
  </div>

  <div style={{ background: '#fff', borderRadius: 8, padding: 8 }}>
    <div style={{ fontSize: 11, color: '#6b7280' }}>This week</div>
    <div style={{ fontWeight: 800, color: '#111827' }}>
      {formatMoneyVnd(customerSpending.thisWeek?.total)}
    </div>
    <div style={{ fontSize: 11, color: '#6b7280' }}>
      {customerSpending.thisWeek?.orders || 0} order
    </div>
  </div>

  <div style={{ background: '#fff', borderRadius: 8, padding: 8 }}>
    <div style={{ fontSize: 11, color: '#6b7280' }}>This month</div>
    <div style={{ fontWeight: 800, color: '#111827' }}>
      {formatMoneyVnd(customerSpending.thisMonth?.total)}
    </div>
    <div style={{ fontSize: 11, color: '#6b7280' }}>
      {customerSpending.thisMonth?.orders || 0} order
    </div>
  </div>
</div>

          {customerSpending.pendingPriceItems > 0 && (
            <div style={{ marginTop: 8, fontSize: 12, color: '#92400e' }}>
              ⚠ Có {customerSpending.pendingPriceItems} món OFF MENU chưa có giá nên chưa tính vào tổng tiền.
            </div>
          )}
        </>
      )}
    </div>
  )}
</div>

        {orderDraftItems.length > 0 && (
          <div
            style={{
              display: 'grid',
              gap: 10,
              paddingTop: 10,
              borderTop: '1px solid #eee'
            }}
          >
            <div style={{ fontWeight: 700, fontSize: 14 }}>
              Ghi chú từng món
            </div>

            {orderDraftItems.map((it) => (
              <div key={it.cartKey}>
                <label
                  style={{
                    display: 'block',
                    marginBottom: 6,
                    fontSize: 12,
                    fontWeight: 600,
                    color: '#111827'
                  }}
                >
{it.qty} | {it.offMenu ? it.label : `${it.name} | ${it.code || '---'}`}
                </label>

                <textarea
                  value={it.note}
                  onChange={(e) => updateCartItemField(it.cartKey, { note: e.target.value })}
                  rows={2}
                  placeholder="Nhập ghi chú cho món này..."
                  style={{
                    width: '100%',
                    padding: 8,
                    border: '1px solid #ddd',
                    borderRadius: 6,
                    resize: 'vertical'
                  }}
                />
              </div>
            ))}
          </div>
        )}

        <div>
          <label>Ghi chú Tổng</label>
          <textarea
            value={orderForm.note}
            onChange={e => setOrderForm(f => ({ ...f, note: e.target.value }))}
            rows={3}
            style={{ width: '100%', padding: 8, border: '1px solid #ddd', borderRadius: 6 }}
          />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
<button
  disabled={isPlacingOrder}
  onClick={() => {
    if (isPlacingOrder) return;
    orderRequestIdRef.current = null;
    setShowOrderForm(false);
  }}
          style={{ padding: '8px 12px', border: '1px solid #ddd', borderRadius: 8, background: '#fff' }}
        >
          Huỷ
        </button>
<button
  onClick={placeOrder}
  disabled={isPlacingOrder || memberLookupLoading}
  style={{
    padding: '8px 12px',
    border: 'none',
    borderRadius: 8,
    background: (isPlacingOrder || memberLookupLoading) ? '#9ca3af' : '#10b981',
    color: '#fff',
    cursor: (isPlacingOrder || memberLookupLoading) ? 'not-allowed' : 'pointer',
    opacity: (isPlacingOrder || memberLookupLoading) ? 0.8 : 1,
  }}
>
  {memberLookupLoading ? 'Đang tìm khách...' : isPlacingOrder ? 'Đang gửi...' : 'Gửi Order'}
</button>
      </div>
    </div>
  </div>
)}

      {/* Funnel slider */}
      <div
        ref={sliderRef}
        role="slider"
        aria-valuemin={minCols}
        aria-valuemax={maxCols}
        aria-valuenow={columns}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onContextMenu={(e) => e.preventDefault()}
        style={{
          position: 'fixed',
          right: 10,
          top: '50%',
          transform: 'translateY(-50%)',
          width: 28,
          height: 160,
          zIndex: 1000,
          touchAction: 'none',
          overscrollBehavior: 'contain',
          WebkitUserSelect: 'none',
          userSelect: 'none',
          cursor: 'pointer',
        }}
      >
        <svg width="28" height="160" viewBox="0 0 28 160" style={{ display: 'block' }}>
          <defs>
            <clipPath id="funnel-clip">
              <path d="M6 6 L22 6 L18 154 L10 154 Z" />
            </clipPath>
          </defs>

          <path
            d="M6 6 L22 6 L18 154 L10 154 Z"
            fill="transparent"
            stroke="#8a8a8a"
            strokeWidth="2"
            strokeLinejoin="round"
          />

          <rect
            x="0"
            y={fillY}
            width="28"
            height={fillH}
            fill="#22c55e"
            clipPath="url(#funnel-clip)"
          />
        </svg>
      </div>
{/* Quick Order Overlay */}
{quickOrderFood && (
  <div
    onClick={() => setQuickOrderFood(null)}
    style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:9999 }}
  >
    <div
      onClick={(e) => e.stopPropagation()}
      style={{ width: 420, background:'#fff', borderRadius:10, padding:16 }}
    >
      <h3 style={{ marginTop:0 }}>Order nhanh</h3>
      <p><strong>Món:</strong> {quickOrderFood.name || quickOrderFood.productName || getImageName(quickOrderFood.imageUrl || quickOrderFood.imageName || '')}</p>
      {/* Nhập staff */}
      <div style={{ marginBottom:12 }}>
        <label>Staff *</label>
        <input
          type="number"
          pattern="[0-9]*"
          inputMode="numeric"
          value={quickOrderForm.staff}
          onChange={e =>
  setQuickOrderForm(f => ({
    ...f,
    staff: e.target.value.replace(/\s+/g, ''),
  }))
}
          placeholder="Mã nhân viên"
          style={{ width:'100%', padding:8, border:'1px solid #ddd', borderRadius:6 }}
        />
      </div>
      {/* Nhập nhiều mã member */}
      <div style={{ marginBottom:12 }}>
        <label>Members *</label>
        <textarea
          value={quickOrderForm.members}
          onChange={e => setQuickOrderForm(f => ({ ...f, members: e.target.value }))}
          placeholder="Nhập mã thẻ, ngăn cách bằng dấu phẩy hoặc xuống dòng"
          rows={3}
          style={{ width:'100%', padding:8, border:'1px solid #ddd', borderRadius:6 }}
        />
      </div>
      <div style={{ display:'flex', justifyContent:'flex-end', gap:8 }}>
        <button
          onClick={() => setQuickOrderFood(null)}
          style={{ padding:'8px 12px', background:'#ccc', border:'none', borderRadius:6, cursor:'pointer' }}
        >
          Hủy
        </button>
        <button
          onClick={async () => {
            const staffVal = String(quickOrderForm.staff || '').replace(/\s+/g, '');
            // Validate staff
            if (!staffVal || !/^\d+$/.test(staffVal)) {
              setToast('Mã nhân viên phải là số');
              return;
            }
            // Tách mã member theo dấu phẩy hoặc xuống dòng
const codes = (quickOrderForm.members || '')
  .split(/[,\n]+/)
  .map(s => s.replace(/\s+/g, ''))
  .filter(s => s);
            if (codes.length === 0) {
              setToast('Nhập Member');
              return;
            }
            const food = quickOrderFood;
            const imageKey = getImageName(food.imageUrl || food.imageName || '');
            try {
              for (const card of codes) {
                const body = {
                  area: null,
                  tableNo: null,
                  staff: staffVal,
                  memberCard: card,
                  customer: { code: null, name: null, level: null },
                  note: '',
                  items: [{ imageKey, qty: 1, note: '' }],
                  consumeStock: false,
                };
                await axios.post(apiUrl('/api/orders'), body);
              }
              setQuickOrderFood(null);
              setQuickOrderForm({ staff: staffVal, members: '' });
              setToast('Đã ghi Order nhanh');
            } catch (e) {
              alert('Order nhanh thất bại: ' + (e?.response?.data?.error || e?.message || ''));
            }
          }}
          style={{ padding:'8px 12px', background:'#10b981', color:'#fff', border:'none', borderRadius:6, cursor:'pointer' }}
        >
          Order
        </button>
      </div>
    </div>
  </div>
)}

<AIChatBox
  mode="user"
  apiUrl={apiUrl}
  userContext={{
    selectedTable,
    selectedLevel,
    selectedType,
    screenMode: mode,
    memberCard: orderForm.memberCard,
    customerName: orderForm.customerName,
    customerLevel: orderForm.level,
  }}
/>

{/* Toast */}
{toast && (
        <div style={{
          position:'fixed', bottom:20, left:'50%', transform:'translateX(-50%)',
          background:'#111', color:'#fff', padding:'8px 12px', borderRadius:8, zIndex:10000, opacity:0.95
        }}>
          {toast}
        </div>
      )}
    </div>
  );
};

// Sidebar item style
const sidebarItemStyle = {
  padding: '10px',
  marginBottom: '6px',
  background: '#333',
  borderRadius: '4px',
  cursor: 'pointer',
  textAlign: 'center',
};

// Back button style
const backButtonStyle = {
  background: '#444',
  color: 'white',
  border: 'none',
  padding: '10px',
  width: '100%',
  cursor: 'pointer',
  fontSize: '14px',
  borderRadius: '6px',
};
function UserCustomerInsightsPanel({
  apiUrl,
  withBase,
  currentMemberCard,
  staffMap = {},
  initialProfileCode = '',
  onOpenedProfileCode = null,
  onOpenOrders = null,
}) {
  const cleanCode = (v) => String(v || '').replace(/\s+/g, '').trim();
const normalizeProfileCode = (v) => {
  const code = cleanCode(v);

  if (/^\d$/.test(code)) {
    return code.padStart(2, '0');
  }

  return code;
};

const getProfileCodeCandidates = (v) => {
  const raw = cleanCode(v);
  if (!raw) return [];

  const out = [];

  const add = (x) => {
    const c = cleanCode(x);
    if (c && !out.includes(c)) out.push(c);
  };

  // Nếu nhập 1-9: thử cả 01 và 1
  if (/^\d$/.test(raw)) {
    add(raw.padStart(2, '0'));
    add(raw);
    return out;
  }

  // Nếu input đang là 01-09: thử cả 01 và 1
  if (/^0[1-9]$/.test(raw)) {
    add(raw);
    add(String(Number(raw)));
    return out;
  }

  add(raw);
  return out;
};

const profileDataScore = (data) => {
  if (!data) return -1;

  const member = data.member || {};
  const orders = Array.isArray(data.orders) ? data.orders : [];
  const events = Array.isArray(data.events) ? data.events : [];
  const favoriteItems = Array.isArray(data.preferences?.favoriteItems)
    ? data.preferences.favoriteItems
    : [];

  return (
    orders.length * 1000 +
    Number(member.ordersCount || 0) * 100 +
    favoriteItems.length * 10 +
    events.length
  );
};
  const staffNameOf = (staffCode) => {
  const code = String(staffCode || '').replace(/\s+/g, '').trim();
  return staffMap?.[code] || '';
};
    const cleanCustomerName = (nameInput, codeInput = '') => {
    const code = cleanCode(codeInput);
    let name = String(nameInput || '').trim();

    if (!name) return '';

    if (code) {
      name = name
        .replace(new RegExp(`\\s*-\\s*${code}\\s*$`, 'i'), '')
        .replace(new RegExp(`^${code}\\s*-\\s*`, 'i'), '')
        .trim();
    }

    return name;
  };

  const normalizeCustomerIdentityText = (value) =>
    String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'D')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  const isUsableCustomerName = (value, code = '') => {
    const cleaned = cleanCustomerName(value, code);
    if (!cleaned) return false;

    const norm = normalizeCustomerIdentityText(cleaned);
    const blocked = [
      'khong tim thay hoac api cham',
      'khong tim thay',
      'api cham',
      'dang tim khach',
      'dang kiem tra khach',
      'chua co thong tin',
      'chua co ten',
      'unknown',
      'not found',
      'loading',
      'null',
      'undefined',
      'n a',
      'na',
    ];

    if (!norm || blocked.some((x) => norm === x || norm.startsWith(`${x} `))) return false;
    if (code && norm === normalizeCustomerIdentityText(code)) return false;
    return true;
  };

  const isUsableCustomerLevel = (value) => {
    const norm = normalizeCustomerIdentityText(value);
    if (!norm) return false;

    return !new Set([
      'dang tim',
      'dang kiem tra',
      'dang kiem tra level',
      'chua co thong tin',
      'unknown',
      'not found',
      'loading',
      'null',
      'undefined',
      'n a',
      'na',
    ]).has(norm) && !['---', '--', '-'].includes(String(value || '').trim());
  };

  const pickCustomerName = (code, ...values) => {
    for (const value of values) {
      if (isUsableCustomerName(value, code)) return cleanCustomerName(value, code);
    }
    return '';
  };

  const pickCustomerLevel = (...values) => {
    for (const value of values) {
      if (isUsableCustomerLevel(value)) return String(value || '').trim();
    }
    return '';
  };

  const [searchText, setSearchText] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);

  const [profile, setProfile] = useState(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('overview');

  const [overview, setOverview] = useState(null);
  const [insightsRange, setInsightsRange] = useState('all');
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insightsError, setInsightsError] = useState('');
  const [topItemsVisible] = useState(15);
  const [topCustomersVisible] = useState(15);
  const [upcomingEvents, setUpcomingEvents] = useState([]);

  // Modal danh sách đầy đủ: chỉ tải khi người dùng thật sự bấm xem.
  const [fullListType, setFullListType] = useState(''); // 'items' | 'customers'
  const [fullListRows, setFullListRows] = useState([]);
  const [fullListLoading, setFullListLoading] = useState(false);
  const [fullListError, setFullListError] = useState('');
  const [fullListSearch, setFullListSearch] = useState('');
  const [fullListSort, setFullListSort] = useState('default');
  const [fullListVisibleCount, setFullListVisibleCount] = useState(100);

  const [eventAtLocal, setEventAtLocal] = useState('');
  const [eventNote, setEventNote] = useState('');
  const [creatingEvent, setCreatingEvent] = useState(false);

  const [spendingRange, setSpendingRange] = useState('month');
const [spendingData, setSpendingData] = useState(null);
const [spendingLoading, setSpendingLoading] = useState(false);

const loadSpendingDetail = useCallback(async (codeInput, rangeInput = spendingRange) => {
  const code = cleanCode(codeInput);
  if (!code) return;

  try {
    setSpendingLoading(true);

    const res = await axios.get(
      apiUrl(`/api/user/customer-spending/${encodeURIComponent(code)}/detail`),
      {
        params: {
          range: rangeInput,
          t: Date.now(),
        },
        headers: {
          'Cache-Control': 'no-cache',
        },
        timeout: 7000,
      }
    );

    setSpendingData(res.data || null);
  } catch {
    setSpendingData(null);
  } finally {
    setSpendingLoading(false);
  }
}, [apiUrl, spendingRange]);


  const formatDateTime = (v) => {
    if (!v) return '';
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString();
  };

  const toDatetimeLocalValue = (dateInput) => {
    const d = dateInput ? new Date(dateInput) : new Date();
    if (Number.isNaN(d.getTime())) return '';

    const pad = (n) => String(n).padStart(2, '0');

    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const eventStatusStyle = (status) => {
    const s = String(status || '').toUpperCase();

    if (s === 'ARRIVED') return { bg: '#dcfce7', fg: '#065f46', label: 'Khách đã đến' };
    if (s === 'ACKNOWLEDGED') return { bg: '#dbeafe', fg: '#1d4ed8', label: 'Đã nắm' };
    if (s === 'SNOOZED') return { bg: '#fef3c7', fg: '#92400e', label: 'Nhắc lại' };
    if (s === 'CANCELLED') return { bg: '#f3f4f6', fg: '#374151', label: 'Đã hủy' };
    if (s === 'EXPIRED') return { bg: '#fee2e2', fg: '#991b1b', label: 'Quá hạn' };

    return { bg: '#fff7ed', fg: '#c2410c', label: 'Pending' };
  };

  const shiftLabel = (ev) => {
    if (!ev?.shift) return '';
    if (ev.shift === 'A') return 'Ca A • 06:00 - 14:00';
    if (ev.shift === 'B') return 'Ca B • 14:00 - 22:00';
    if (ev.shift === 'C') return 'Ca C • 22:00 - 06:00';
    return `Ca ${ev.shift}`;
  };

  const buildInsightRange = useCallback((rangeInput) => {
    const range = String(rangeInput || 'all');
    const BUSINESS_HOUR = 6;
    const DAY_MS = 24 * 60 * 60 * 1000;
    const now = new Date();
    const shifted = new Date(now.getTime() - BUSINESS_HOUR * 60 * 60 * 1000);

    const businessStart = (d) =>
      new Date(d.getFullYear(), d.getMonth(), d.getDate(), BUSINESS_HOUR, 0, 0, 0);

    let from = null;
    let to = null;

    if (range === 'today') {
      from = businessStart(shifted);
      to = new Date(from.getTime() + DAY_MS - 1);
    } else if (range === '7d') {
      const d = new Date(shifted);
      d.setDate(d.getDate() - 6);
      from = businessStart(d);
      to = new Date(businessStart(shifted).getTime() + DAY_MS - 1);
    } else if (range === '30d') {
      const d = new Date(shifted);
      d.setDate(d.getDate() - 29);
      from = businessStart(d);
      to = new Date(businessStart(shifted).getTime() + DAY_MS - 1);
    } else if (range === 'month') {
      from = new Date(shifted.getFullYear(), shifted.getMonth(), 1, BUSINESS_HOUR, 0, 0, 0);
      const nextMonth = new Date(shifted.getFullYear(), shifted.getMonth() + 1, 1, BUSINESS_HOUR, 0, 0, 0);
      to = new Date(nextMonth.getTime() - 1);
    }

    return {
      from: from ? from.toISOString() : undefined,
      to: to ? to.toISOString() : undefined,
    };
  }, []);

  const loadOverview = useCallback(async (force = false, rangeInput = insightsRange) => {
    try {
      setInsightsLoading(true);
      setInsightsError('');

      const range = buildInsightRange(rangeInput);
      const params = {
        limit: 20,
        force: force ? 'true' : 'false',
      };

      if (range.from) params.from = range.from;
      if (range.to) params.to = range.to;

      const res = await axios.get(apiUrl('/api/user/customer-insights/overview'), {
        params,
        headers: { 'Cache-Control': 'no-cache' },
        timeout: 12000,
      });

      setOverview(res.data || null);
    } catch (e) {
      setInsightsError(e?.response?.data?.error || e?.message || 'Không tải được Insights');
    } finally {
      setInsightsLoading(false);
    }
  }, [apiUrl, buildInsightRange, insightsRange]);

  const loadFullList = useCallback(async (type) => {
    const normalizedType = type === 'items' ? 'items' : 'customers';
    try {
      setFullListType(normalizedType);
      setFullListLoading(true);
      setFullListError('');
      setFullListSearch('');
      setFullListSort('default');
      setFullListVisibleCount(100);

      const range = buildInsightRange(insightsRange);
      const params = { type: normalizedType };
      if (range.from) params.from = range.from;
      if (range.to) params.to = range.to;

      const res = await axios.get(apiUrl('/api/user/customer-insights/list'), {
        params,
        headers: { 'Cache-Control': 'no-cache' },
        timeout: 15000,
      });

      setFullListRows(
        normalizedType === 'items'
          ? (res.data?.items || [])
          : (res.data?.customers || [])
      );
    } catch (e) {
      setFullListRows([]);
      setFullListError(e?.response?.data?.error || e?.message || 'Không tải được danh sách');
    } finally {
      setFullListLoading(false);
    }
  }, [apiUrl, buildInsightRange, insightsRange]);

  const loadUpcomingEvents = useCallback(async () => {
    try {
      const res = await axios.get(apiUrl('/api/customer-events/upcoming'), {
        params: { days: 7 },
      });

      setUpcomingEvents(res.data?.events || []);
    } catch {}
  }, [apiUrl]);

const searchCustomers = useCallback(async (q) => {
  const text = String(q || '').trim();
  const compact = cleanCode(text);
  const isNumeric = /^\d+$/.test(compact);

  if (!text) {
    setSearchResults([]);
    return;
  }

  // Nếu nhập số: lookup exact giống Tạo Order.
  // Với 1-9 hoặc 01-09: thử cả 01 và 1, chọn mã nào có data thật hơn.
  if (isNumeric) {
    const candidates = getProfileCodeCandidates(compact);

    try {
      setSearchLoading(true);

      const candidateRows = [];

      for (const candidate of candidates) {
        let lookup = null;
        let profileData = null;

        try {
          const lookupRes = await axios.get(apiUrl('/api/member-lookup'), {
            params: {
              memberCard: candidate,
              refresh: 'true',
              t: Date.now(),
            },
            headers: {
              'Cache-Control': 'no-cache',
            },
            timeout: 4500,
          });

          lookup = lookupRes.data || null;
        } catch {}

        try {
          const profileRes = await axios.get(
            apiUrl(`/api/user/customer-profile/${encodeURIComponent(candidate)}`),
            {
              params: { t: Date.now() },
              headers: {
                'Cache-Control': 'no-cache',
              },
              timeout: 5000,
            }
          );

          profileData = profileRes.data || null;
        } catch {}

        const profileMember = profileData?.member || null;
        const score = profileDataScore(profileData);

        const hasLookup =
          lookup &&
          (lookup.ok || lookup.customerName || lookup.name || lookup.level || lookup.tier);

        const hasProfile =
          profileData &&
          (
            Number(profileMember?.ordersCount || 0) > 0 ||
            Array.isArray(profileData.orders) && profileData.orders.length > 0 ||
            Array.isArray(profileData.preferences?.favoriteItems) && profileData.preferences.favoriteItems.length > 0
          );

        if (!hasLookup && !hasProfile) {
          continue;
        }

        candidateRows.push({
          code: candidate,
          name: pickCustomerName(
            candidate,
            lookup?.customerName,
            lookup?.name,
            profileMember?.name
          ),
          level: pickCustomerLevel(
            lookup?.level,
            lookup?.tier,
            profileMember?.level
          ),
          ordersCount:
            Number(profileMember?.ordersCount || lookup?.ordersCount || 0) || 0,
          lastOrderAt:
            profileMember?.lastSeenAt ||
            lookup?.lastSeenAt ||
            null,
          _score: score,
        });
      }

      if (candidateRows.length === 0) {
        setSearchResults([]);
        return;
      }

      candidateRows.sort((a, b) => {
        if ((b._score || 0) !== (a._score || 0)) {
          return (b._score || 0) - (a._score || 0);
        }

        return Number(b.ordersCount || 0) - Number(a.ordersCount || 0);
      });

      const best = candidateRows[0];
      setSearchResults([{ ...best, _score: undefined }]);
    } finally {
      setSearchLoading(false);
    }

    return;
  }

  // Search tên: chỉ search khi từ 2 ký tự trở lên
  if (text.length < 2) {
    setSearchResults([]);
    return;
  }

  try {
    setSearchLoading(true);

    const res = await axios.get(apiUrl('/api/user/customer-profile/search'), {
      params: { q: text, limit: 12 },
      timeout: 6000,
    });

    const items = Array.isArray(res.data?.items) ? res.data.items : [];

    const normalized = items
      .map((m) => {
        const code = cleanCode(m.code || m.customerCode || m.id || '');

        return {
          ...m,
          code,
          name: pickCustomerName(code, m.name, m.customerName),
          level: pickCustomerLevel(m.level, m.memberLevel, m.tier),
          ordersCount: Number(m.ordersCount || 0) || 0,
          lastOrderAt: m.lastOrderAt || m.lastSeenAt || null,
        };
      })
      .filter((m) => m.code);

    setSearchResults(normalized);
  } catch {
    setSearchResults([]);
  } finally {
    setSearchLoading(false);
  }
}, [apiUrl]);

const loadProfile = useCallback(async (codeInput) => {
  const candidates = getProfileCodeCandidates(codeInput);
  if (candidates.length === 0) return;

  try {
    setProfileLoading(true);
    setActiveTab('overview');

    let bestData = null;
    let bestLookup = null;
    let bestCode = candidates[0];
    let bestScore = -1;

    for (const candidate of candidates) {
      let lookup = null;

      if (/^\d+$/.test(candidate)) {
        try {
          const lookupRes = await axios.get(apiUrl('/api/member-lookup'), {
            params: {
              memberCard: candidate,
              refresh: 'true',
              t: Date.now(),
            },
            headers: {
              'Cache-Control': 'no-cache',
            },
            timeout: 2500,
          });

          lookup = lookupRes.data || null;
        } catch {}
      }

      let data = null;

      try {
        const res = await axios.get(
          apiUrl(`/api/user/customer-profile/${encodeURIComponent(candidate)}`),
          {
            params: { t: Date.now() },
            headers: {
              'Cache-Control': 'no-cache',
            },
            timeout: 6000,
          }
        );

        data = res.data || null;
      } catch {}

      const score = profileDataScore(data);

      // Ưu tiên profile nào có order/data thật
      if (score > bestScore) {
        bestScore = score;
        bestData = data;
        bestLookup = lookup;
        bestCode = candidate;
      }

      // Nếu đã có order/history thì đủ tốt, không cần thử tiếp
      if (score >= 1000) break;
    }

    if (!bestData) {
      throw new Error('Không lấy được profile khách.');
    }

    if (bestData?.member) {
      const lookupName = bestLookup?.customerName || bestLookup?.name || '';
      const lookupLevel = bestLookup?.level || bestLookup?.tier || '';

      bestData.member = {
        ...bestData.member,
        code: bestData.member.code || bestCode,
        name: pickCustomerName(
          bestCode,
          lookupName,
          bestData.member.name
        ),
        level: pickCustomerLevel(
          lookupLevel,
          bestData.member.level
        ),
      };
    }

    setProfile(bestData);
    setSearchText(bestData?.member?.code || bestCode);

    const defaultAt = new Date();
    defaultAt.setHours(defaultAt.getHours() + 1, 0, 0, 0);
    setEventAtLocal(toDatetimeLocalValue(defaultAt));
    setEventNote('');
  } catch (e) {
    alert('Không mở được hồ sơ khách: ' + (e?.response?.data?.error || e.message));
  } finally {
    setProfileLoading(false);
  }
}, [apiUrl]);
useEffect(() => {
  const code = cleanCode(initialProfileCode);
  if (!code) return;

  setSearchText(code);
  loadProfile(code);

  if (typeof onOpenedProfileCode === 'function') {
    onOpenedProfileCode();
  }
}, [initialProfileCode, loadProfile, onOpenedProfileCode]);
  const reloadCurrentProfile = useCallback(async () => {
    const code = profile?.member?.code;
    if (!code) return;

    try {
      const res = await axios.get(apiUrl(`/api/user/customer-profile/${encodeURIComponent(code)}`));
      setProfile(res.data || null);
    } catch {}
  }, [apiUrl, profile?.member?.code]);

  useEffect(() => {
    loadOverview(false, insightsRange);
    loadUpcomingEvents();
  }, [loadOverview, loadUpcomingEvents, insightsRange]);

  useEffect(() => {
    let timer = null;

    const refreshInsights = () => {
      clearTimeout(timer);
      timer = setTimeout(() => loadOverview(true, insightsRange), 500);
    };

    socket.on('orderPlaced', refreshInsights);
    socket.on('orderUpdated', refreshInsights);

    return () => {
      clearTimeout(timer);
      socket.off('orderPlaced', refreshInsights);
      socket.off('orderUpdated', refreshInsights);
    };
  }, [loadOverview, insightsRange]);


  useEffect(() => {
    let timer = null;

    const onMemberUpdated = (payload = {}) => {
      const updatedCode = cleanCode(payload.code || payload.member?.code || '');
      if (!updatedCode) return;

      clearTimeout(timer);
      timer = setTimeout(async () => {
        // Member update chỉ cần tải lại đúng hồ sơ/search đang mở.
        // Không build lại toàn bộ Insights cho từng khách trong batch sync.
        const currentProfileCode = cleanCode(profile?.member?.code || '');
        if (currentProfileCode && updatedCode === currentProfileCode) {
          await reloadCurrentProfile();
        }

        const exactSearchCode = cleanCode(searchText);
        if (/^\d+$/.test(exactSearchCode) && updatedCode === exactSearchCode) {
          await searchCustomers(searchText);
        }
      }, 350);
    };

    socket.on('memberUpdated', onMemberUpdated);

    return () => {
      clearTimeout(timer);
      socket.off('memberUpdated', onMemberUpdated);
    };
  }, [
    profile?.member?.code,
    reloadCurrentProfile,
    searchText,
    searchCustomers,
  ]);

  useEffect(() => {
    let timer = null;

    const onCustomersUpdated = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        // Batch sync chỉ refresh tổng quan đúng một lần.
        loadOverview(true, insightsRange);
      }, 500);
    };

    socket.on('customersUpdated', onCustomersUpdated);

    return () => {
      clearTimeout(timer);
      socket.off('customersUpdated', onCustomersUpdated);
    };
  }, [loadOverview, insightsRange]);
useEffect(() => {
  if (activeTab !== 'spending') return;

  const code = profile?.member?.code;
  if (!code) return;

  loadSpendingDetail(code, spendingRange);
}, [activeTab, profile?.member?.code, spendingRange, loadSpendingDetail]);
  useEffect(() => {
    const clean = cleanCode(currentMemberCard);
    if (clean && !searchText) {
      setSearchText(clean);
    }
  }, [currentMemberCard, searchText]);

  useEffect(() => {
    const t = setTimeout(() => {
      searchCustomers(searchText);
    }, 350);

    return () => clearTimeout(t);
  }, [searchText, searchCustomers]);

useEffect(() => {
  const onEventsUpdated = () => {
    loadUpcomingEvents();
    reloadCurrentProfile();
  };

  socket.on('customerEventsUpdated', onEventsUpdated);

  return () => {
    socket.off('customerEventsUpdated', onEventsUpdated);
  };
}, [loadUpcomingEvents, reloadCurrentProfile]);



  const createEvent = async () => {
    const member = profile?.member;
    if (!member?.code) return alert('Chưa chọn khách.');
    if (!eventAtLocal) return alert('Chưa chọn thời gian khách vào club.');

    try {
      setCreatingEvent(true);

      const eventAtIso = new Date(eventAtLocal).toISOString();

      await axios.post(apiUrl('/api/customer-events'), {
        memberCode: member.code,
        customerName: member.name || '',
        customerLevel: member.level || '',
        eventAt: eventAtIso,
        note: eventNote,
        createdBy: 'user',
      });

      setEventNote('');
      await reloadCurrentProfile();
      await loadUpcomingEvents();
      alert('Đã tạo event cho khách.');
    } catch (e) {
      alert('Tạo event thất bại: ' + (e?.response?.data?.error || e.message));
    } finally {
      setCreatingEvent(false);
    }
  };

  const eventAction = async (eventId, action, body = {}) => {
    if (!eventId) return;

    try {
      await axios.post(apiUrl(`/api/customer-events/${eventId}/${action}`), body);
      await reloadCurrentProfile();
      await loadUpcomingEvents();
    } catch (e) {
      alert('Không cập nhật được event: ' + (e?.response?.data?.error || e.message));
    }
  };

  const renderEventCard = (ev, compact = false) => {
    const st = eventStatusStyle(ev.status);

    return (
      <div
        key={ev.id}
        style={{
          border: '1px solid #e5e7eb',
          borderRadius: 10,
          padding: 10,
          background: '#fff',
          display: 'grid',
          gap: 6,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <b>{formatDateTime(ev.eventAt)}</b>

          <span
            style={{
              background: st.bg,
              color: st.fg,
              borderRadius: 999,
              padding: '2px 8px',
              fontSize: 12,
              fontWeight: 700,
              marginLeft: 'auto',
            }}
          >
            {st.label}
          </span>
        </div>

        <div style={{ fontSize: 12, color: '#6b7280' }}>
          {ev.memberCode} - {ev.customerName || 'Chưa có tên'} {ev.customerLevel ? `• ${ev.customerLevel}` : ''}
        </div>

        <div style={{ fontSize: 12, color: '#374151' }}>
          {shiftLabel(ev)}
        </div>

        {ev.note && (
          <div style={{ fontSize: 12, color: '#6b7280' }}>
            📝 {ev.note}
          </div>
        )}

        {!compact && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
            <button
              onClick={() => eventAction(ev.id, 'ack')}
              style={smallBtn('#2563eb')}
            >
              Đã nắm
            </button>

            <button
              onClick={() => eventAction(ev.id, 'snooze', { minutes: 10 })}
              style={smallBtn('#f59e0b')}
            >
              Nhắc lại 10 phút
            </button>

            <button
              onClick={() => eventAction(ev.id, 'arrived')}
              style={smallBtn('#16a34a')}
            >
              Khách đã đến
            </button>

            <button
              onClick={() => {
                if (window.confirm('Hủy event này?')) eventAction(ev.id, 'cancel');
              }}
              style={smallBtn('#6b7280')}
            >
              Hủy
            </button>
          </div>
        )}
      </div>
    );
  };

  const th = {
    textAlign: 'left',
    padding: '8px 10px',
    borderBottom: '1px solid #e5e7eb',
    fontSize: 12,
    color: '#374151',
    whiteSpace: 'nowrap',
  };

  const td = {
    padding: '8px 10px',
    borderBottom: '1px solid #f3f4f6',
    fontSize: 12,
    verticalAlign: 'top',
  };

  const cardStyle = {
    background: '#fff',
    border: '1px solid #eee',
    borderRadius: 10,
    padding: 12,
  };

const tabs = [
  ['overview', 'Tổng quan'],
  ['spending', 'Chi tiêu'],
  ['orders', 'Orders'],
  ['preferences', 'Sở thích'],
  ['history', 'Lịch sử'],
  ['events', 'Events'],
];

  const topItems = overview?.topItems || [];
  const topCustomers = overview?.topCustomers || [];
  const recentNotes = overview?.recentNotes || [];
  const formatCount = (value) => Number(value || 0).toLocaleString('vi-VN');

  const fullListFilteredRows = useMemo(() => {
    const q = normalizeCustomerIdentityText(fullListSearch);
    let rows = Array.isArray(fullListRows) ? fullListRows.slice() : [];

    if (q) {
      rows = rows.filter((row) => {
        if (fullListType === 'items') {
          return normalizeCustomerIdentityText(
            `${row.productCode || ''} ${row.name || ''} ${row.itemGroup || ''} ${row.type || ''}`
          ).includes(q);
        }

        return normalizeCustomerIdentityText(
          `${row.code || ''} ${row.name || ''} ${row.level || ''}`
        ).includes(q);
      });
    }

    rows.sort((a, b) => {
      if (fullListType === 'items') {
        if (fullListSort === 'orders') return Number(b.orderCount || 0) - Number(a.orderCount || 0);
        if (fullListSort === 'customers') return Number(b.customerCount || 0) - Number(a.customerCount || 0);
        if (fullListSort === 'recent') return new Date(b.lastOrderAt || 0) - new Date(a.lastOrderAt || 0);
        if (fullListSort === 'name') return String(a.name || '').localeCompare(String(b.name || ''));
        return Number(b.qty || 0) - Number(a.qty || 0);
      }

      if (fullListSort === 'spend') return Number(b.totalSpend || 0) - Number(a.totalSpend || 0);
      if (fullListSort === 'items') return Number(b.totalQty || 0) - Number(a.totalQty || 0);
      if (fullListSort === 'recent') return new Date(b.lastOrderAt || 0) - new Date(a.lastOrderAt || 0);
      if (fullListSort === 'name') return String(a.name || '').localeCompare(String(b.name || ''));
      return Number(b.orderCount || 0) - Number(a.orderCount || 0);
    });

    return rows;
  }, [fullListRows, fullListType, fullListSearch, fullListSort]);
  const insightRangeLabel = {
    today: 'Hôm nay',
    '7d': '7 ngày gần nhất',
    '30d': '30 ngày gần nhất',
    month: 'Tháng này',
    all: 'Toàn bộ dữ liệu',
  }[insightsRange] || 'Toàn bộ dữ liệu';

  const member = profile?.member || {};
  const preferences = profile?.preferences || {};
  const orders = profile?.orders || [];
  const history = profile?.history || [];
  const profileEvents = profile?.events || [];

  const renderHistoryDetail = (h) => {
  const type = String(h?.type || '').toUpperCase();

  if (type === 'API_SYNC') {
    return (
      <div style={{ display: 'grid', gap: 4, fontSize: 13 }}>
        <div>
          <b>Đồng bộ API khách hàng</b>
        </div>

        {h.detail && (
          <div style={{ color: '#374151' }}>
            {h.detail}
          </div>
        )}

        {h.data && typeof h.data === 'object' && (
          <div style={{ display: 'grid', gap: 3 }}>
            {Object.entries(h.data).map(([k, v]) => (
              <div key={k}>
                {k}:{' '}
                <b>{v?.from || '---'}</b>
                {' → '}
                <b>{v?.to || '---'}</b>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (type === 'ORDER') {
    const items = Array.isArray(h.items) ? h.items : [];

    return (
      <div style={{ display: 'grid', gap: 6, fontSize: 13 }}>
        <div>
          Order: <b>#{h.orderId || '---'}</b>
          {' • '}
          Table: <b>{h.area || ''} {h.tableNo || ''}</b>
        </div>

        {items.length > 0 && (
          <div style={{ display: 'grid', gap: 4 }}>
            {items.map((it, idx) => (
              <div
                key={idx}
                style={{
                  padding: '6px 8px',
                  background: '#f9fafb',
                  border: '1px solid #eee',
                  borderRadius: 8,
                }}
              >
                <b>x{it.qty || it.quantity || 1}</b>
                {' '}
                {it.productCode ? `[${it.productCode}] ` : ''}
                {it.name || it.imageName || it.imageKey || 'Unknown item'}
                {it.note ? (
                  <div style={{ color: '#6b7280', marginTop: 2 }}>
                    📝 {it.note}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}

        {h.note && (
          <div style={{ color: '#6b7280' }}>
            Order note: {h.note}
          </div>
        )}
      </div>
    );
  }

  if (h.detail) {
    return <div style={{ fontSize: 13, color: '#374151' }}>{h.detail}</div>;
  }

  if (h.data && typeof h.data === 'object') {
    return (
      <div style={{ display: 'grid', gap: 3, fontSize: 13 }}>
        {Object.entries(h.data).map(([k, v]) => (
          <div key={k}>
            {k}: {typeof v === 'object' ? JSON.stringify(v) : String(v)}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div style={{ fontSize: 13, color: '#6b7280' }}>
      Không có chi tiết.
    </div>
  );
};

const historyTypeStyle = (typeInput) => {
  const type = String(typeInput || '').toUpperCase();

  if (type === 'ORDER') return { bg: '#dbeafe', fg: '#1d4ed8', label: 'ORDER' };
  if (type === 'API_SYNC') return { bg: '#dcfce7', fg: '#065f46', label: 'API SYNC' };
  if (type === 'UPDATE') return { bg: '#fef3c7', fg: '#92400e', label: 'UPDATE' };
  if (type === 'CREATE') return { bg: '#f3f4f6', fg: '#374151', label: 'CREATE' };

  return { bg: '#f3f4f6', fg: '#374151', label: type || 'HISTORY' };
};

  return (
    <div style={{ display: 'grid', gap: 12, minWidth: 0 }}>
      <div
        style={{
          ...cardStyle,
          padding: 14,
          borderRadius: 14,
          border: '1px solid #e5e7eb',
          boxShadow: '0 4px 14px rgba(15,23,42,0.05)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ minWidth: 220 }}>
            <h2 style={{ margin: 0, color: '#111827' }}>Customer Insights</h2>
          </div>

          <div
            style={{
              marginLeft: 'auto',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              flexWrap: 'wrap',
            }}
          >
            <select
              value={insightsRange}
              onChange={(e) => setInsightsRange(e.target.value)}
              style={{
                padding: '8px 10px',
                border: '1px solid #d1d5db',
                borderRadius: 8,
                background: '#fff',
                fontWeight: 700,
                color: '#374151',
              }}
            >
              <option value="today">Hôm nay</option>
              <option value="7d">7 ngày</option>
              <option value="30d">30 ngày</option>
              <option value="month">Tháng này</option>
              <option value="all">Toàn bộ</option>
            </select>

            <button
              onClick={() => loadOverview(true, insightsRange)}
              disabled={insightsLoading}
              style={{
                ...mainBtn(insightsLoading ? '#9ca3af' : '#111827'),
                cursor: insightsLoading ? 'not-allowed' : 'pointer',
              }}
            >
              {insightsLoading ? 'Đang tải…' : 'Refresh'}
            </button>
          </div>
        </div>

        <div
          style={{
            marginTop: 12,
            display: 'grid',
            gridTemplateColumns: 'minmax(220px, 1fr) auto',
            gap: 8,
            alignItems: 'center',
          }}
        >
          <input
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                if (searchResults[0]?.code) loadProfile(searchResults[0].code);
                else searchCustomers(searchText);
              }
            }}
            placeholder="Nhập chính xác mã member hoặc tìm theo tên khách..."
            style={{
              minWidth: 0,
              width: '100%',
              padding: '10px 12px',
              border: '1px solid #d1d5db',
              borderRadius: 10,
              outline: 'none',
              fontSize: 13,
            }}
          />

          <button
            onClick={() => searchCustomers(searchText)}
            style={mainBtn('#2563eb')}
          >
            {searchLoading ? 'Đang tìm…' : 'Tìm khách'}
          </button>
        </div>

        {insightsError && (
          <div
            style={{
              marginTop: 10,
              padding: '9px 10px',
              borderRadius: 8,
              background: '#fef2f2',
              color: '#b91c1c',
              fontSize: 12,
            }}
          >
            {insightsError}
          </div>
        )}

        {searchResults.length > 0 && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
              gap: 8,
              marginTop: 10,
            }}
          >
            {searchResults.map((m) => (
              <button
                type="button"
                key={m.code}
                onClick={() => loadProfile(m.code)}
                style={{
                  border: '1px solid #dbe3ee',
                  borderRadius: 10,
                  padding: 10,
                  cursor: 'pointer',
                  background: '#f8fafc',
                  textAlign: 'left',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                }}
              >
                <div
                  style={{
                    width: 42,
                    height: 42,
                    borderRadius: 10,
                    background: '#e0e7ff',
                    color: '#3730a3',
                    display: 'grid',
                    placeItems: 'center',
                    fontWeight: 900,
                    flex: '0 0 auto',
                  }}
                >
                  {String(m.level || '—').slice(0, 3)}
                </div>

                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 900, color: '#111827' }}>
                    {m.code} - {m.name || 'Chưa có tên'}
                  </div>
                  <div style={{ marginTop: 2, fontSize: 12, color: '#6b7280' }}>
                    Level: {m.level || '---'} • {formatCount(m.ordersCount)} orders
                    {m.lastOrderAt ? ` • Gần nhất: ${formatDateTime(m.lastOrderAt)}` : ''}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
          gap: 10,
        }}
      >
        {[
          {
            label: 'Orders',
            display: insightsLoading && !overview ? '…' : formatCount(overview?.totalOrders),
            hint: `${insightRangeLabel} • Bấm để xem danh sách order`,
            accent: '#2563eb',
            onClick: () => { if (typeof onOpenOrders === 'function') onOpenOrders(); },
          },
          {
            label: 'Khách đã order',
            display: insightsLoading && !overview ? '…' : formatCount(overview?.totalCustomers),
            hint: 'Bấm để xem toàn bộ khách + chi tiêu',
            accent: '#7c3aed',
            onClick: () => loadFullList('customers'),
          },
          {
            label: 'Tổng số lượng món',
            display: insightsLoading && !overview ? '…' : formatCount(overview?.totalQty),
            hint: `${formatCount(overview?.totalItems)} món khác nhau • Bấm để xem toàn bộ`,
            accent: '#ea580c',
            onClick: () => loadFullList('items'),
          },
          {
            label: 'Tổng giá trị order',
            display: insightsLoading && !overview ? '…' : formatMoneyVnd(overview?.totalSpend),
            hint: Number(overview?.pendingPriceItems || 0) > 0
              ? `${formatCount(overview.pendingPriceItems)} món chưa có giá • Bấm xem theo khách`
              : 'Bấm để xem khách chi tiêu nhiều nhất',
            accent: '#059669',
            onClick: () => { loadFullList('customers'); setFullListSort('spend'); },
          },
        ].map((card) => (
          <button
            type="button"
            key={card.label}
            onClick={card.onClick}
            style={{
              background: '#fff',
              border: '1px solid #e5e7eb',
              borderRadius: 14,
              padding: 14,
              boxShadow: '0 4px 14px rgba(15,23,42,0.05)',
              borderTop: `4px solid ${card.accent}`,
              minWidth: 0,
              textAlign: 'left',
              cursor: 'pointer',
            }}
            title={card.hint}
          >
            <div style={{ fontSize: 12, color: '#6b7280', fontWeight: 800 }}>
              {card.label}
            </div>
            <div style={{ marginTop: 3, fontSize: 26, fontWeight: 900, color: '#111827' }}>
              {card.display}
            </div>
            <div
              style={{
                marginTop: 5,
                fontSize: 11,
                color: '#6b7280',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {card.hint}
            </div>
          </button>
        ))}
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 500px), 1fr))',
          gap: 12,
          alignItems: 'start',
          minWidth: 0,
        }}
      >
        <div
          style={{
            ...cardStyle,
            borderRadius: 14,
            border: '1px solid #e5e7eb',
            boxShadow: '0 4px 14px rgba(15,23,42,0.05)',
            minWidth: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <div>
              <h3 style={{ margin: 0 }}>Bảng xếp hạng món</h3>
              <div style={{ marginTop: 2, fontSize: 11, color: '#6b7280' }}>
                Xếp theo tổng số lượng món được order
              </div>
            </div>
            <button
              type="button"
              onClick={() => loadFullList('items')}
              style={{
                marginLeft: 'auto',
                border: '1px solid #bfdbfe',
                background: '#eff6ff',
                color: '#1d4ed8',
                borderRadius: 999,
                padding: '5px 10px',
                fontSize: 11,
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              Xem tất cả {formatCount(overview?.totalItems)} món
            </button>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
              <thead>
                <tr>
                  <th style={{ ...th, width: 44, textAlign: 'center' }}>#</th>
                  <th style={th}>Món</th>
                  <th style={{ ...th, width: 70, textAlign: 'center' }}>SL</th>
                  <th style={{ ...th, width: 90, textAlign: 'center' }}>Lần order</th>
                  <th style={{ ...th, width: 76, textAlign: 'center' }}>Khách</th>
                  <th style={{ ...th, width: 145 }}>Gần nhất</th>
                  <th style={{ ...th, minWidth: 160 }}>Ghi chú hay gặp</th>
                </tr>
              </thead>
              <tbody>
                {topItems.slice(0, topItemsVisible).map((it, idx) => (
                  <tr key={it.key || `${it.name}-${idx}`}>
                    <td style={{ ...td, textAlign: 'center', fontWeight: 900, color: idx < 3 ? '#b45309' : '#374151' }}>
                      {idx + 1}
                    </td>
                    <td style={td}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 220 }}>
                        {it.imageUrl ? (
                          <img
                            src={imageSrc(it)}
                            alt=""
                            loading="lazy"
                            style={{
                              width: 44,
                              height: 44,
                              objectFit: 'cover',
                              borderRadius: 8,
                              border: '1px solid #e5e7eb',
                              flex: '0 0 auto',
                            }}
                          />
                        ) : (
                          <div style={{ width: 44, height: 44, borderRadius: 8, background: '#f3f4f6', flex: '0 0 auto' }} />
                        )}
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 900, color: '#111827', lineHeight: 1.3 }}>
                            {it.productCode ? `[${it.productCode}] ` : ''}{it.name}
                          </div>
                          <div style={{ marginTop: 2, fontSize: 11, color: '#6b7280' }}>
                            {it.itemGroup || it.type || 'Chưa có nhóm'}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td style={{ ...td, textAlign: 'center', fontWeight: 900 }}>{formatCount(it.qty)}</td>
                    <td style={{ ...td, textAlign: 'center' }}>{formatCount(it.orderCount)}</td>
                    <td style={{ ...td, textAlign: 'center' }}>{formatCount(it.customerCount)}</td>
                    <td style={{ ...td, whiteSpace: 'nowrap', color: '#6b7280' }}>
                      {formatDateTime(it.lastOrderAt) || '---'}
                    </td>
                    <td style={td}>
                      {(it.notes || []).length === 0 ? (
                        <span style={{ color: '#9ca3af' }}>Không có ghi chú</span>
                      ) : (
                        (it.notes || []).slice(0, 2).map((n, noteIdx) => (
                          <div
                            key={`${it.key || idx}-note-${noteIdx}`}
                            title={n.note}
                            style={{
                              maxWidth: 250,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              color: '#92400e',
                              marginBottom: 2,
                            }}
                          >
                            📝 {n.note}
                          </div>
                        ))
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

        </div>

        <div
          style={{
            ...cardStyle,
            borderRadius: 14,
            border: '1px solid #e5e7eb',
            boxShadow: '0 4px 14px rgba(15,23,42,0.05)',
            minWidth: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <div>
              <h3 style={{ margin: 0 }}>Khách order nhiều</h3>
              <div style={{ marginTop: 2, fontSize: 11, color: '#6b7280' }}>
                Bấm vào khách để mở hồ sơ chi tiết
              </div>
            </div>
            <button
              type="button"
              onClick={() => loadFullList('customers')}
              style={{
                marginLeft: 'auto',
                border: '1px solid #ddd6fe',
                background: '#f5f3ff',
                color: '#6d28d9',
                borderRadius: 999,
                padding: '5px 10px',
                fontSize: 11,
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              Xem tất cả {formatCount(overview?.totalCustomers)} khách
            </button>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
              <thead>
                <tr>
                  <th style={th}>Khách</th>
                  <th style={{ ...th, width: 70 }}>Level</th>
                  <th style={{ ...th, width: 70, textAlign: 'center' }}>Orders</th>
                  <th style={{ ...th, width: 70, textAlign: 'center' }}>Món</th>
                  <th style={{ ...th, width: 130, textAlign: 'right' }}>Tổng tiền</th>
                  <th style={th}>Món yêu thích</th>
                  <th style={{ ...th, width: 145 }}>Gần nhất</th>
                </tr>
              </thead>
              <tbody>
                {topCustomers.slice(0, topCustomersVisible).map((c) => (
                  <tr
                    key={c.code}
                    onClick={() => loadProfile(c.code)}
                    style={{ cursor: 'pointer' }}
                    title="Mở hồ sơ khách"
                  >
                    <td style={td}>
                      <div style={{ fontWeight: 900, color: '#111827' }}>{c.code}</div>
                      <div style={{ marginTop: 2, color: '#4b5563' }}>{c.name || 'Chưa có tên'}</div>
                    </td>
                    <td style={td}>
                      <span
                        style={{
                          display: 'inline-block',
                          background: '#eef2ff',
                          color: '#3730a3',
                          borderRadius: 999,
                          padding: '3px 8px',
                          fontWeight: 800,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {c.level || '---'}
                      </span>
                    </td>
                    <td style={{ ...td, textAlign: 'center', fontWeight: 900 }}>{formatCount(c.orderCount)}</td>
                    <td style={{ ...td, textAlign: 'center' }}>{formatCount(c.totalQty)}</td>
                    <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 800 }}>
                      {formatMoneyVnd(c.totalSpend)}
                      {Number(c.pendingPriceItems || 0) > 0 && (
                        <div style={{ marginTop: 2, fontSize: 10, color: '#92400e', fontWeight: 600 }}>
                          + {formatCount(c.pendingPriceItems)} món chưa giá
                        </div>
                      )}
                    </td>
                    <td style={td}>
                      <div style={{ maxWidth: 240, lineHeight: 1.4 }}>
                        {(c.favoriteItems || []).slice(0, 3).map((it) => it.name).join(', ') || '---'}
                      </div>
                    </td>
                    <td style={{ ...td, whiteSpace: 'nowrap', color: '#6b7280' }}>
                      {formatDateTime(c.lastOrderAt) || '---'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 460px), 1fr))',
          gap: 12,
          alignItems: 'start',
        }}
      >
        <div
          style={{
            ...cardStyle,
            borderRadius: 14,
            border: '1px solid #e5e7eb',
            boxShadow: '0 4px 14px rgba(15,23,42,0.05)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <div>
              <h3 style={{ margin: 0 }}>Khách sắp tới</h3>
              <div style={{ marginTop: 2, fontSize: 11, color: '#6b7280' }}>
                Lịch khách dự kiến đến trong 7 ngày tới
              </div>
            </div>
            <span
              style={{
                marginLeft: 'auto',
                background: upcomingEvents.length ? '#fff7ed' : '#f3f4f6',
                color: upcomingEvents.length ? '#c2410c' : '#6b7280',
                borderRadius: 999,
                padding: '4px 9px',
                fontSize: 11,
                fontWeight: 800,
              }}
            >
              {formatCount(upcomingEvents.length)} event
            </span>
          </div>

          {upcomingEvents.length === 0 ? (
            <div
              style={{
                padding: 14,
                background: '#f8fafc',
                border: '1px dashed #cbd5e1',
                borderRadius: 10,
                color: '#64748b',
                textAlign: 'center',
              }}
            >
              Chưa có event sắp tới.
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 8 }}>
              {upcomingEvents.slice(0, 6).map((ev) => (
                <div
                  key={ev.id}
                  onClick={() => loadProfile(ev.memberCode)}
                  style={{ cursor: 'pointer' }}
                >
                  {renderEventCard(ev, true)}
                </div>
              ))}
            </div>
          )}
        </div>

        <div
          style={{
            ...cardStyle,
            borderRadius: 14,
            border: '1px solid #e5e7eb',
            boxShadow: '0 4px 14px rgba(15,23,42,0.05)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <div>
              <h3 style={{ margin: 0 }}>Ghi chú món gần đây</h3>
              <div style={{ marginTop: 2, fontSize: 11, color: '#6b7280' }}>
                Dùng để nhớ nhanh yêu cầu đặc biệt của khách
              </div>
            </div>
            <span
              style={{
                marginLeft: 'auto',
                background: recentNotes.length ? '#fffbeb' : '#f3f4f6',
                color: recentNotes.length ? '#92400e' : '#6b7280',
                borderRadius: 999,
                padding: '4px 9px',
                fontSize: 11,
                fontWeight: 800,
              }}
            >
              {formatCount(recentNotes.length)} note
            </span>
          </div>

          {recentNotes.length === 0 ? (
            <div
              style={{
                padding: 14,
                background: '#f8fafc',
                border: '1px dashed #cbd5e1',
                borderRadius: 10,
                color: '#64748b',
                textAlign: 'center',
              }}
            >
              Chưa có ghi chú trong phạm vi đang xem.
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 7 }}>
              {recentNotes.slice(0, 8).map((n, idx) => (
                <button
                  type="button"
                  key={`${n.orderId || 'note'}-${idx}`}
                  onClick={() => {
                    if (n.customerCode && n.customerCode !== 'UNKNOWN') loadProfile(n.customerCode);
                  }}
                  style={{
                    border: '1px solid #fde68a',
                    background: '#fffbeb',
                    borderRadius: 9,
                    padding: '8px 10px',
                    textAlign: 'left',
                    cursor: n.customerCode && n.customerCode !== 'UNKNOWN' ? 'pointer' : 'default',
                  }}
                >
                  <div style={{ fontSize: 12, fontWeight: 900, color: '#78350f' }}>
                    {n.customerCode && n.customerCode !== 'UNKNOWN' ? `${n.customerCode} - ` : ''}
                    {n.customerName || 'Khách chưa có tên'}
                  </div>
                  <div style={{ marginTop: 2, fontSize: 12, color: '#92400e' }}>
                    <b>{n.itemName || 'Món'}</b>: {n.note}
                  </div>
                  <div style={{ marginTop: 3, fontSize: 10, color: '#a16207' }}>
                    {formatDateTime(n.at) || '---'}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {fullListType && (
        <div
          onClick={() => setFullListType('')}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.55)',
            zIndex: 10045,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 'min(1280px, calc(100vw - 32px))',
              height: 'min(820px, calc(100vh - 32px))',
              background: '#fff',
              borderRadius: 14,
              overflow: 'hidden',
              display: 'grid',
              gridTemplateRows: 'auto auto 1fr auto',
              boxShadow: '0 24px 70px rgba(0,0,0,0.28)',
            }}
          >
            <div
              style={{
                padding: '14px 16px',
                borderBottom: '1px solid #e5e7eb',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
              }}
            >
              <div>
                <h2 style={{ margin: 0, color: '#111827' }}>
                  {fullListType === 'items' ? 'Tất cả món đã order' : 'Tất cả khách đã order'}
                </h2>
                <div style={{ marginTop: 3, fontSize: 12, color: '#6b7280' }}>
                  {insightRangeLabel} • {formatCount(fullListFilteredRows.length)} kết quả
                </div>
              </div>

              <button
                type="button"
                onClick={() => setFullListType('')}
                style={{ ...mainBtn('#ef4444'), marginLeft: 'auto' }}
              >
                Đóng
              </button>
            </div>

            <div
              style={{
                padding: 10,
                borderBottom: '1px solid #e5e7eb',
                background: '#f8fafc',
                display: 'grid',
                gridTemplateColumns: 'minmax(220px, 1fr) minmax(180px, 240px)',
                gap: 8,
              }}
            >
              <input
                value={fullListSearch}
                onChange={(e) => {
                  setFullListSearch(e.target.value);
                  setFullListVisibleCount(100);
                }}
                placeholder={fullListType === 'items' ? 'Tìm mã món, tên món, nhóm...' : 'Tìm mã member, tên khách, level...'}
                style={{
                  width: '100%',
                  minWidth: 0,
                  padding: '9px 10px',
                  border: '1px solid #d1d5db',
                  borderRadius: 8,
                  background: '#fff',
                }}
              />

              <select
                value={fullListSort}
                onChange={(e) => {
                  setFullListSort(e.target.value);
                  setFullListVisibleCount(100);
                }}
                style={{
                  padding: '9px 10px',
                  border: '1px solid #d1d5db',
                  borderRadius: 8,
                  background: '#fff',
                  fontWeight: 700,
                }}
              >
                {fullListType === 'items' ? (
                  <>
                    <option value="default">SL nhiều nhất</option>
                    <option value="orders">Lần order nhiều nhất</option>
                    <option value="customers">Nhiều khách nhất</option>
                    <option value="recent">Gần đây nhất</option>
                    <option value="name">Tên A-Z</option>
                  </>
                ) : (
                  <>
                    <option value="default">Orders nhiều nhất</option>
                    <option value="spend">Chi tiêu nhiều nhất</option>
                    <option value="items">Số món nhiều nhất</option>
                    <option value="recent">Gần đây nhất</option>
                    <option value="name">Tên A-Z</option>
                  </>
                )}
              </select>
            </div>

            <div style={{ overflow: 'auto', minHeight: 0 }}>
              {fullListLoading ? (
                <div style={{ padding: 24, textAlign: 'center', color: '#6b7280' }}>Đang tải danh sách…</div>
              ) : fullListError ? (
                <div style={{ padding: 24, textAlign: 'center', color: '#b91c1c' }}>{fullListError}</div>
              ) : fullListType === 'items' ? (
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 850 }}>
                  <thead style={{ position: 'sticky', top: 0, background: '#fff', zIndex: 1 }}>
                    <tr>
                      <th style={{ ...th, width: 54, textAlign: 'center' }}>#</th>
                      <th style={th}>Món</th>
                      <th style={{ ...th, width: 90, textAlign: 'center' }}>SL</th>
                      <th style={{ ...th, width: 100, textAlign: 'center' }}>Lần order</th>
                      <th style={{ ...th, width: 90, textAlign: 'center' }}>Khách</th>
                      <th style={{ ...th, width: 160 }}>Gần nhất</th>
                      <th style={{ ...th, minWidth: 190 }}>Ghi chú gần đây</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fullListFilteredRows.slice(0, fullListVisibleCount).map((it, idx) => (
                      <tr key={it.key || `${it.name}-${idx}`}>
                        <td style={{ ...td, textAlign: 'center', fontWeight: 800 }}>{idx + 1}</td>
                        <td style={td}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            {it.imageUrl ? (
                              <img
                                src={imageSrc(it)}
                                alt=""
                                loading="lazy"
                                style={{ width: 38, height: 38, objectFit: 'cover', borderRadius: 7, border: '1px solid #e5e7eb' }}
                              />
                            ) : null}
                            <div>
                              <div style={{ fontWeight: 900 }}>
                                {it.productCode ? `[${it.productCode}] ` : ''}{it.name || '---'}
                              </div>
                              <div style={{ fontSize: 11, color: '#6b7280' }}>{it.itemGroup || it.type || '---'}</div>
                            </div>
                          </div>
                        </td>
                        <td style={{ ...td, textAlign: 'center', fontWeight: 900 }}>{formatCount(it.qty)}</td>
                        <td style={{ ...td, textAlign: 'center' }}>{formatCount(it.orderCount)}</td>
                        <td style={{ ...td, textAlign: 'center' }}>{formatCount(it.customerCount)}</td>
                        <td style={{ ...td, whiteSpace: 'nowrap' }}>{formatDateTime(it.lastOrderAt) || '---'}</td>
                        <td style={td}>
                          {(it.notes || []).slice(0, 2).map((n, nIdx) => (
                            <div key={nIdx} style={{ color: '#92400e', marginBottom: 2 }}>📝 {n.note}</div>
                          ))}
                          {(it.notes || []).length === 0 && <span style={{ color: '#9ca3af' }}>---</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 980 }}>
                  <thead style={{ position: 'sticky', top: 0, background: '#fff', zIndex: 1 }}>
                    <tr>
                      <th style={{ ...th, width: 54, textAlign: 'center' }}>#</th>
                      <th style={th}>Khách</th>
                      <th style={{ ...th, width: 75 }}>Level</th>
                      <th style={{ ...th, width: 80, textAlign: 'center' }}>Orders</th>
                      <th style={{ ...th, width: 80, textAlign: 'center' }}>Món</th>
                      <th style={{ ...th, width: 145, textAlign: 'right' }}>Tổng tiền</th>
                      <th style={th}>Món yêu thích</th>
                      <th style={{ ...th, width: 160 }}>Gần nhất</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fullListFilteredRows.slice(0, fullListVisibleCount).map((c, idx) => (
                      <tr
                        key={c.code || idx}
                        onClick={() => {
                          if (!c.code) return;
                          setFullListType('');
                          loadProfile(c.code);
                        }}
                        style={{ cursor: c.code ? 'pointer' : 'default' }}
                        title="Bấm để mở hồ sơ khách"
                      >
                        <td style={{ ...td, textAlign: 'center', fontWeight: 800 }}>{idx + 1}</td>
                        <td style={td}>
                          <div style={{ fontWeight: 900 }}>{c.code || '---'}</div>
                          <div style={{ marginTop: 2, color: '#4b5563' }}>{c.name || 'Chưa có tên'}</div>
                        </td>
                        <td style={td}>{c.level || '---'}</td>
                        <td style={{ ...td, textAlign: 'center', fontWeight: 900 }}>{formatCount(c.orderCount)}</td>
                        <td style={{ ...td, textAlign: 'center' }}>{formatCount(c.totalQty)}</td>
                        <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 900 }}>
                          {formatMoneyVnd(c.totalSpend)}
                          {Number(c.pendingPriceItems || 0) > 0 && (
                            <div style={{ fontSize: 10, color: '#92400e', fontWeight: 600 }}>
                              +{formatCount(c.pendingPriceItems)} món chưa giá
                            </div>
                          )}
                        </td>
                        <td style={td}>
                          {(c.favoriteItems || []).slice(0, 4).map((it) => it.name).filter(Boolean).join(', ') || '---'}
                        </td>
                        <td style={{ ...td, whiteSpace: 'nowrap' }}>{formatDateTime(c.lastOrderAt) || '---'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div
              style={{
                padding: '9px 12px',
                borderTop: '1px solid #e5e7eb',
                background: '#f8fafc',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                justifyContent: 'center',
              }}
            >
              <span style={{ fontSize: 12, color: '#6b7280' }}>
                Đang hiển thị {formatCount(Math.min(fullListVisibleCount, fullListFilteredRows.length))} / {formatCount(fullListFilteredRows.length)}
              </span>
              {fullListVisibleCount < fullListFilteredRows.length && (
                <button
                  type="button"
                  onClick={() => setFullListVisibleCount((n) => n + 100)}
                  style={{
                    border: '1px solid #d1d5db',
                    background: '#fff',
                    borderRadius: 8,
                    padding: '6px 10px',
                    cursor: 'pointer',
                    fontWeight: 800,
                  }}
                >
                  Xem thêm 100
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {profile && (
        <div
          onClick={() => setProfile(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.55)',
            zIndex: 10050,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 'min(1120px, calc(100vw - 32px))',
              height: 'min(760px, calc(100vh - 32px))',
              background: '#fff',
              borderRadius: 14,
              overflow: 'hidden',
              display: 'grid',
              gridTemplateRows: 'auto auto 1fr',
            }}
          >
            <div
              style={{
                padding: 14,
                borderBottom: '1px solid #eee',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
              }}
            >
              <div>
                <h2 style={{ margin: 0 }}>
                  {member.code} - {member.name || 'Chưa có tên'}
                </h2>

                <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
                  Level: <b>{member.level || '---'}</b>
                  {' • '}
                  Orders: <b>{member.ordersCount || 0}</b>
                  {member.lastSeenAt ? ` • Last seen: ${formatDateTime(member.lastSeenAt)}` : ''}
                </div>
              </div>

              <button
                onClick={() => setProfile(null)}
                style={{ ...mainBtn('#ef4444'), marginLeft: 'auto' }}
              >
                Close
              </button>
            </div>

            <div
              style={{
                display: 'flex',
                gap: 6,
                padding: 10,
                borderBottom: '1px solid #eee',
                background: '#f9fafb',
              }}
            >
              {tabs.map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setActiveTab(key)}
                  style={{
                    border: '1px solid #ddd',
                    background: activeTab === key ? '#2563eb' : '#fff',
                    color: activeTab === key ? '#fff' : '#111',
                    borderRadius: 999,
                    padding: '6px 12px',
                    cursor: 'pointer',
                    fontWeight: 700,
                  }}
                >
                  {label}
                </button>
              ))}
            </div>

            <div style={{ overflowY: 'auto', padding: 14 }}>
              {activeTab === 'overview' && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div style={cardStyle}>
                    <h3 style={{ marginTop: 0 }}>Thông tin khách hàng</h3>

                    <div style={infoRowStyle}>Mã khách: <b>{member.code}</b></div>
                    <div style={infoRowStyle}>Tên khách: <b>{member.name || '---'}</b></div>
                    <div style={infoRowStyle}>Level: <b>{member.level || '---'}</b></div>
                    <div style={infoRowStyle}>Số lần order: <b>{member.ordersCount || 0}</b></div>
                    <div style={infoRowStyle}>Lần gần nhất: <b>{formatDateTime(member.lastSeenAt) || '---'}</b></div>
                    <div style={infoRowStyle}>API synced: <b>{formatDateTime(member.apiSyncedAt) || '---'}</b></div>
                  </div>

                  <div style={cardStyle}>
                    <h3 style={{ marginTop: 0 }}>Event sắp tới</h3>

                    {profileEvents.filter((ev) => ['PENDING', 'ACKNOWLEDGED', 'SNOOZED'].includes(String(ev.status).toUpperCase())).length === 0 ? (
                      <div style={{ color: '#6b7280' }}>Chưa có event sắp tới.</div>
                    ) : (
                      <div style={{ display: 'grid', gap: 8 }}>
                        {profileEvents
                          .filter((ev) => ['PENDING', 'ACKNOWLEDGED', 'SNOOZED'].includes(String(ev.status).toUpperCase()))
                          .slice(0, 5)
                          .map((ev) => renderEventCard(ev))}
                      </div>
                    )}
                  </div>
                </div>
              )}
{activeTab === 'spending' && (
  <div style={{ display: 'grid', gap: 12 }}>
    <div style={cardStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0 }}>Tổng tiền khách đã order</h3>

        <select
          value={spendingRange}
          onChange={(e) => setSpendingRange(e.target.value)}
          style={{
            marginLeft: 'auto',
            padding: '6px 8px',
            border: '1px solid #ddd',
            borderRadius: 6,
            background: '#fff',
          }}
        >
          <option value="today">Hôm nay</option>
          <option value="week">Tuần này</option>
          <option value="month">Tháng này</option>
          <option value="year">Năm này</option>
          <option value="all">Toàn bộ</option>
        </select>

        <button
          onClick={() => loadSpendingDetail(member.code, spendingRange)}
          disabled={spendingLoading}
          style={{
            border: 'none',
            background: spendingLoading ? '#9ca3af' : '#2563eb',
            color: '#fff',
            borderRadius: 6,
            padding: '6px 10px',
            cursor: spendingLoading ? 'not-allowed' : 'pointer',
          }}
        >
          {spendingLoading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          gap: 10,
          marginTop: 12,
        }}
      >
        <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 10 }}>
          <div style={{ fontSize: 12, color: '#6b7280' }}>Tổng tiền</div>
          <div style={{ fontSize: 22, fontWeight: 900, color: '#111827' }}>
            {formatMoneyVnd(spendingData?.summary?.total)}
          </div>
        </div>

        <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 10 }}>
          <div style={{ fontSize: 12, color: '#6b7280' }}>Orders</div>
          <div style={{ fontSize: 22, fontWeight: 900, color: '#111827' }}>
            {spendingData?.summary?.orders || 0}
          </div>
        </div>

        <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 10 }}>
          <div style={{ fontSize: 12, color: '#6b7280' }}>Số món</div>
          <div style={{ fontSize: 22, fontWeight: 900, color: '#111827' }}>
            {spendingData?.summary?.items || 0}
          </div>
        </div>

        <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 10 }}>
          <div style={{ fontSize: 12, color: '#6b7280' }}>Trung bình / order</div>
          <div style={{ fontSize: 22, fontWeight: 900, color: '#111827' }}>
            {formatMoneyVnd(spendingData?.summary?.avgOrder)}
          </div>
        </div>
      </div>

      {(spendingData?.summary?.pendingPriceItems || 0) > 0 && (
        <div style={{ marginTop: 10, fontSize: 12, color: '#92400e' }}>
          ⚠ Có {spendingData.summary.pendingPriceItems} món OFF MENU chưa có giá nên chưa tính vào tổng tiền.
        </div>
      )}
    </div>

    <div style={cardStyle}>
      <h3 style={{ marginTop: 0 }}>Chi tiết theo ngày</h3>

      {!spendingData || (spendingData.byDay || []).length === 0 ? (
        <div style={{ color: '#6b7280' }}>
          Chưa có dữ liệu chi tiêu.
        </div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th}>Ngày</th>
              <th style={{ ...th, textAlign: 'right' }}>Tổng tiền</th>
              <th style={{ ...th, textAlign: 'center' }}>Orders</th>
              <th style={{ ...th, textAlign: 'center' }}>Items</th>
              <th style={{ ...th, textAlign: 'center' }}>Chưa có giá</th>
            </tr>
          </thead>

          <tbody>
            {(spendingData.byDay || []).map((d) => (
              <tr key={d.date}>
                <td style={td}>{d.date}</td>
                <td style={{ ...td, textAlign: 'right', fontWeight: 800 }}>
                  {formatMoneyVnd(d.total)}
                </td>
                <td style={{ ...td, textAlign: 'center' }}>{d.orders}</td>
                <td style={{ ...td, textAlign: 'center' }}>{d.items}</td>
                <td style={{ ...td, textAlign: 'center', color: d.pendingPriceItems > 0 ? '#92400e' : '#6b7280' }}>
                  {d.pendingPriceItems || 0}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>

    <div style={cardStyle}>
      <h3 style={{ marginTop: 0 }}>Order trong khoảng đang xem</h3>

      {!spendingData || (spendingData.orders || []).length === 0 ? (
        <div style={{ color: '#6b7280' }}>
          Không có order.
        </div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th}>Order</th>
              <th style={th}>Time</th>
              <th style={th}>Table</th>
              <th style={th}>Status</th>
              <th style={{ ...th, textAlign: 'right' }}>Total</th>
            </tr>
          </thead>

          <tbody>
            {(spendingData.orders || []).map((o) => (
              <tr key={o.id}>
                <td style={td}>#{o.id}</td>
                <td style={td}>{formatDateTime(o.createdAt)}</td>
                <td style={td}>{o.area || ''} {o.tableNo || ''}</td>
                <td style={td}>{o.status}</td>
                <td style={{ ...td, textAlign: 'right', fontWeight: 800 }}>
                  {formatMoneyVnd(o.total)}
                  {o.pendingPriceItems > 0 ? (
                    <div style={{ color: '#92400e', fontSize: 11 }}>
                      {o.pendingPriceItems} món chưa có giá
                    </div>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  </div>
)}
              {activeTab === 'orders' && (
                <div>
                  <h3 style={{ marginTop: 0 }}>Lịch sử order</h3>

                  {orders.length === 0 ? (
                    <div style={{ color: '#6b7280' }}>Chưa có order.</div>
                  ) : (
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr>
                          <th style={th}>Order</th>
                          <th style={th}>Time</th>
                          <th style={th}>Table</th>
                          <th style={th}>Staff</th>
                          <th style={th}>Tên Staff</th>
                          <th style={th}>Status</th>
                          <th style={th}>Items</th>
                        </tr>
                      </thead>

                      <tbody>
                        {orders.slice(0, 100).map((o) => (
                          <tr key={o.id}>
                            <td style={td}>#{o.id}</td>
                            <td style={td}>{formatDateTime(o.createdAt)}</td>
                            <td style={td}>
                              {o.area || ''} {o.tableNo || ''}
                              <div style={{ color: o.tableClosed ? '#16a34a' : '#f59e0b', fontWeight: 700 }}>
                                Table: {o.tableClosed ? 'Done (thu bàn)' : 'Pending'}
                              </div>
                            </td>
                            <td style={td}>{o.staff || ''}</td>
<td style={td}>
  <b>{staffNameOf(o.staff) || '---'}</b>
</td>
<td style={td}><b>{o.status}</b></td>
                            <td style={td}>
                              {(o.items || []).map((it, idx) => (
                                <div key={idx}>
                                  x{it.qty || it.quantity || 1} {it.productCode ? `[${it.productCode}] ` : ''}{it.name || it.imageName || ''}
                                  {it.note ? <span style={{ color: '#6b7280' }}> • 📝 {it.note}</span> : null}
                                </div>
                              ))}
                              {o.note ? <div style={{ color: '#6b7280' }}>Order note: {o.note}</div> : null}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}

              {activeTab === 'preferences' && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div style={cardStyle}>
                    <h3 style={{ marginTop: 0 }}>Món khách hay gọi</h3>

                    {(preferences.favoriteItems || []).length === 0 ? (
                      <div style={{ color: '#6b7280' }}>Chưa có dữ liệu sở thích.</div>
                    ) : (
                      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                          <tr>
                            <th style={th}>Món</th>
                            <th style={{ ...th, textAlign: 'center' }}>SL</th>
                            <th style={{ ...th, textAlign: 'center' }}>Số lần</th>
                          </tr>
                        </thead>

                        <tbody>
                          {(preferences.favoriteItems || []).slice(0, 20).map((it) => (
                            <tr key={it.key}>
                              <td style={td}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                  {it.imageUrl && (
                                    <img
                                      src={imageSrc(it)}
                                      alt=""
                                      style={{ width: 38, height: 38, objectFit: 'cover', borderRadius: 6, border: '1px solid #eee' }}
                                    />
                                  )}
                                  <div>
                                    <b>{it.productCode ? `[${it.productCode}] ` : ''}{it.name}</b>
                                    <div style={{ color: '#6b7280' }}>{it.itemGroup || it.type || ''}</div>
                                  </div>
                                </div>
                              </td>
                              <td style={{ ...td, textAlign: 'center', fontWeight: 700 }}>{it.qty}</td>
                              <td style={{ ...td, textAlign: 'center', fontWeight: 700 }}>{it.orderCount || 0}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>

                  <div style={cardStyle}>
                    <h3 style={{ marginTop: 0 }}>Gợi ý món</h3>

                    {(preferences.recommendations || []).slice(0, 20).map((it) => (
                      <div key={it.key} style={{ display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid #f3f4f6', padding: '8px 0' }}>
                        {it.imageUrl && (
                          <img
                            src={imageSrc(it)}
                            alt=""
                            style={{ width: 38, height: 38, objectFit: 'cover', borderRadius: 6, border: '1px solid #eee' }}
                          />
                        )}
                        <div>
                          <b>{it.productCode ? `[${it.productCode}] ` : ''}{it.name}</b>
                          <div style={{ color: '#6b7280', fontSize: 12 }}>{it.reason || `${it.customerCount || 0} khách từng gọi`}</div>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div style={{ ...cardStyle, gridColumn: '1 / -1' }}>
                    <h3 style={{ marginTop: 0 }}>Ghi chú món gần đây</h3>

                    {(preferences.notes || []).length === 0 ? (
                      <div style={{ color: '#6b7280' }}>Chưa có ghi chú.</div>
                    ) : (
                      <div style={{ display: 'grid', gap: 6 }}>
                        {(preferences.notes || []).slice(0, 20).map((n, idx) => (
                          <div key={idx} style={{ background: '#f9fafb', border: '1px solid #eee', borderRadius: 8, padding: 8, fontSize: 12 }}>
                            <b>{n.itemName}</b>: {n.note}
                            <div style={{ color: '#6b7280' }}>{formatDateTime(n.at)}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {activeTab === 'history' && (
                <div>
                  <h3 style={{ marginTop: 0 }}>Lịch sử thay đổi thông tin</h3>

                  {history.length === 0 ? (
                    <div style={{ color: '#6b7280' }}>Chưa có lịch sử.</div>
                  ) : (
                    <div style={{ display: 'grid', gap: 8 }}>
{history.map((h, idx) => {
  const st = historyTypeStyle(h.type);

  return (
    <div
      key={idx}
      style={{
        border: '1px solid #e5e7eb',
        borderRadius: 10,
        padding: 10,
        background: '#fff',
        display: 'grid',
        gap: 8,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span
          style={{
            background: st.bg,
            color: st.fg,
            borderRadius: 999,
            padding: '2px 8px',
            fontSize: 12,
            fontWeight: 800,
          }}
        >
          {st.label}
        </span>

        <span style={{ color: '#6b7280', fontSize: 12 }}>
          {formatDateTime(h.at)}
        </span>
      </div>

      {renderHistoryDetail(h)}
    </div>
  );
})}
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'events' && (
                <div style={{ display: 'grid', gridTemplateColumns: '360px 1fr', gap: 12 }}>
                  <div style={cardStyle}>
                    <h3 style={{ marginTop: 0 }}>Tạo event khách vào club</h3>

                    <label style={labelStyle}>Thời gian khách vào</label>
                    <input
                      type="datetime-local"
                      value={eventAtLocal}
                      onChange={(e) => setEventAtLocal(e.target.value)}
                      style={inputStyle}
                    />

                    <label style={labelStyle}>Ghi chú</label>
                    <textarea
                      value={eventNote}
                      onChange={(e) => setEventNote(e.target.value)}
                      rows={4}
                      placeholder="Ví dụ: Khách VIP, chuẩn bị món hay gọi..."
                      style={{ ...inputStyle, resize: 'vertical' }}
                    />

                    <button
                      onClick={createEvent}
                      disabled={creatingEvent}
                      style={{
                        ...mainBtn(creatingEvent ? '#9ca3af' : '#16a34a'),
                        width: '100%',
                        marginTop: 10,
                      }}
                    >
                      {creatingEvent ? 'Đang tạo...' : 'Tạo event'}
                    </button>

                    <div style={{ marginTop: 10, fontSize: 12, color: '#6b7280', lineHeight: 1.5 }}>
                      Alarm sẽ tự nhảy:
                      <br />• Đầu ca A/B/C
                      <br />• Trước giờ khách vào 1 tiếng
                    </div>
                  </div>

                  <div style={cardStyle}>
                    <h3 style={{ marginTop: 0 }}>Danh sách event của khách</h3>

                    {profileEvents.length === 0 ? (
                      <div style={{ color: '#6b7280' }}>Chưa có event.</div>
                    ) : (
                      <div style={{ display: 'grid', gap: 8 }}>
                        {profileEvents.map((ev) => renderEventCard(ev))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}


    </div>
  );
}

const mainBtn = (bg) => ({
  padding: '8px 12px',
  border: 'none',
  borderRadius: 8,
  background: bg,
  color: '#fff',
  cursor: 'pointer',
  fontWeight: 700,
  fontSize: 13,
});

const smallBtn = (bg) => ({
  padding: '5px 8px',
  border: 'none',
  borderRadius: 6,
  background: bg,
  color: '#fff',
  cursor: 'pointer',
  fontWeight: 700,
  fontSize: 12,
});

const inputStyle = {
  width: '100%',
  padding: 8,
  border: '1px solid #ddd',
  borderRadius: 8,
  marginTop: 4,
  marginBottom: 10,
};

const labelStyle = {
  display: 'block',
  fontSize: 12,
  fontWeight: 700,
  color: '#374151',
};

const infoRowStyle = {
  padding: '7px 0',
  borderBottom: '1px solid #f3f4f6',
};
export default UserFoodList;
