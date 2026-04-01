// src/components/FoodList.js
import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import axios from 'axios';
import io from 'socket.io-client';

// ==== API & Socket fallback ====
const API =
  process.env.REACT_APP_API_URL ||
  process.env.REACT_APP_API_BASE ||
  ''; // '' => same-origin (relative /api)

const socket = API
  ? io(API, {
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      transports: ['websocket'],
    })
  : io({
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      transports: ['websocket'],
    });

const apiUrl = (path) => `${API || ''}${path}`;
// Trả về URL ảnh có host API nếu đang chạy khác origin
const withBase = (url) => {
  if (!url) return '';
  if (/^https?:\/\//i.test(url)) return url;  // đã là absolute URL
  return `${API || ''}${url}`;                 // gắn host API (nếu có)
};

const SOLD_OUT_MENU = 'Sold out';
const SOLD_OUT_KEY = '__SOLD_OUT__';
const LEVELS = ['P', 'I-I+', 'V-One'];

// Khu vực và dải số bàn
const AREA_DEFS = [
  { name: 'Roulette 1', ranges: [[101, 120]] },
  { name: 'Roulette 2', ranges: [[201, 240]] },
  { name: 'Roulette 3', ranges: [[301, 320]] },
  { name: 'Multi', ranges: [[501, 508]] },
  { name: 'Non - Smoking', ranges: [[1001, 1008]] },
  { name: 'Reception 2', ranges: [[1009, 1024]] },
  { name: 'Center', ranges: [[1025, 1040], [5001, 5008], [3001, 3030]] },
  { name: 'Table', ranges: [[11, 15], [21, 25]] },
  { name: '2 Floor', ranges: [[2001, 2030]] },
];
const genTables = (ranges) => { const out=[]; ranges.forEach(([a,b])=>{ for(let i=a;i<=b;i++) out.push(i);}); return out; };
const tableKeyOf = (area, tableNo) => (area && tableNo) ? `${area}#${tableNo}` : '';

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
  const [columns, setColumns] = useState(4);
  const [menuOpen, setMenuOpen] = useState(true);
  const [previewImage, setPreviewImage] = useState(null);

  // Search
  const [searchQuery, setSearchQuery] = useState('');
  const isSearching = searchQuery.trim().length > 0;

  // Chế độ hiển thị & bàn
  const [mode, setMode] = useState('menu'); // 'menu' | 'tables'
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
        genTables(a.ranges).forEach(n => {
          if (String(n).includes(q)) results.push({ area: a.name, tableNo: n });
        });
      });
      return results;
    }
    const area = AREA_DEFS.find(a => a.name === activeArea) || AREA_DEFS[0];
    return genTables(area.ranges).map(n => ({ area: area.name, tableNo: n }));
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

  // Order form
  const [showOrderForm, setShowOrderForm] = useState(false);
  const [orderForm, setOrderForm] = useState(() => {
    try {
      const last = JSON.parse(localStorage.getItem('lastOrderInfo') || '{}');
      return { staff: last.staff || '', memberCard: '', customerCode: '', customerName: '', level: '', note: '' };

    } catch { return { staff: '', memberCard: '', customerName: '', note: '' }; }
  });
  const [toast, setToast] = useState('');
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
    const id = String(orderForm.staff || '').trim();
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

  // API
  const fetchFoods = useCallback(async () => {
    try {
      const res = await axios.get(apiUrl('/api/foods'));
      setFoods(res.data || []);
      setApiError(null);
      setConnState('connected');
      setLastSyncAt(new Date());
    } catch (e) {
      setApiError(e?.message || 'API error');
      setFoods([]);
      setConnState('offline');
    }
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

  // Preload orders cho các bàn đang hiển thị
  const fetchedTablesRef = useRef(new Set());
  useEffect(() => {
    const toFetch = visibleTables
      .map(t => tableKeyOf(t.area, t.tableNo))
      .filter(k => !fetchedTablesRef.current.has(k));
    toFetch.forEach((key, idx) => {
      const [area, tableStr] = key.split('#');
      const tableNo = Number(tableStr);
      setTimeout(() => {
        fetchOrdersOfTable(area, tableNo);
        fetchedTablesRef.current.add(key);
      }, idx * 60);
    });
  }, [visibleTables, fetchOrdersOfTable]);

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

  // Auto reload khi backend phát version mới
  useEffect(() => {
    const onVersion = (ver) => {
      if (versionRef.current && versionRef.current !== ver) {
        window.location.reload();
      } else {
        versionRef.current = ver;
      }
    };
    socket.on('appVersion', onVersion);
    return () => socket.off('appVersion', onVersion);
  }, []);

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
    };
  }, [fetchFoods, debounceFetch, selectedTable, currentTableKey, loadMenuLevels]);

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
    const typeFilter = isSearching ? null : selectedType;
    const inSelectedType =
      (typeFilter === null) ||
      (typeFilter === SOLD_OUT_KEY && f.status === 'Sold Out') ||
      (f.type === typeFilter);

    if (!inSelectedType) return false;
    if (!selectedLevel) return false;

    // Trang Sold-out: chỉ hiện món hết + menu/type đó được phép cho level đang chọn
    if (isSoldOutPage) return f.status === 'Sold Out' && typeAllowedForLevel(f.type, selectedLevel);

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

  const setCartQty = (imageName, qty) => {
    if (!currentTableKey) return;
    setCarts(prev => {
      const cart = { ...(prev[currentTableKey] || {}) };
      if (qty <= 0) delete cart[imageName];
        else {
    const cur = cart[imageName] || { qty: 0, note: '' };
    cart[imageName] = { ...cur, qty };
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


  const tableCartCount = useCallback((areaName, tableNo) => {
    const key = tableKeyOf(areaName, tableNo);
    const cart = (carts && carts[key]) || {};
    return Object.values(cart).reduce((sum, it) => sum + Number(it.qty || 0), 0);

  }, [carts]);

  // Member lookup
const lookupMember = useCallback(async (memberCard) => {
  try {
    if (!memberCard) return;
    const res = await axios.get(apiUrl('/api/member-lookup'), { params: { memberCard } });
 const code = res?.data?.code || res?.data?.customerCode || '';
 const name = res?.data?.customerName || res?.data?.name || '';
 const lv   = res?.data?.level || res?.data?.tier || '';
    setOrderForm(f => ({
      ...f,
      customerCode: code || '',
      customerName: name || 'Chưa có thông tin',
      level: lv || 'Chưa có thông tin'
    }));
  } catch {
    setOrderForm(f => ({ ...f, customerName: 'Chưa có thông tin', level: 'Chưa có thông tin' }));
  }
}, []);

  useEffect(() => {
    const card = (orderForm.memberCard || '').trim();
    if (!card) return;
    const t = setTimeout(() => lookupMember(card), 300);
    return () => clearTimeout(t);
  }, [orderForm.memberCard, lookupMember]);

  // Submit order
  const placeOrder = async () => {
if (!selectedTable) return setToast('Hãy chọn bàn');
if (totalItems <= 0) return setToast('Giỏ trống');
// Validate staff: phải có và là số
const staffVal = (orderForm.staff || '').trim();
if (!staffVal || !/^\d+$/.test(staffVal)) {
  setToast('Mã nhân viên phải là số');
  return;
}
// Validate member card
if (!orderForm.memberCard?.trim()) {
  setToast('Nhập Member');
  return;
}
    const items = Object.entries(currentCart).map(([imageName, item]) => ({
  imageKey: imageName, // <— chuẩn hoá key ảnh
  qty: item.qty,
  note: item.note || ''
}));

    try {
      const body = {
        area: selectedTable.area,
        tableNo: selectedTable.tableNo,
        staff: orderForm.staff.trim(),
     memberCard: orderForm.memberCard.trim(), // để server đối chiếu nếu cần
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
        localStorage.setItem('lastOrderInfo', JSON.stringify({ staff: orderForm.staff.trim() }));
        setCarts(prev => ({ ...prev, [currentTableKey]: {} }));
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
            if (cart[key] > m.available) cart[key] = m.available;
            if (cart[key] <= 0) delete cart[key];
          });
          return { ...prev, [currentTableKey]: cart };
        });
        alert('Một số món không đủ số lượng. Giỏ đã được điều chỉnh theo tồn kho.');
      } else {
        alert('Order thất bại: ' + (e?.response?.data?.error || e?.message || ''));
      }
    }
  };

  // Helper map imageName -> food
  const findFoodByImageName = (imgName) =>
    foods.find(f => getImageName(f.imageUrl) === String(imgName || '').toLowerCase());

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
          {/* Tabs: Bàn | MENU */}
          <div style={{ display: 'flex', gap: 8, padding: 8 }}>
            <button
              onClick={() => setMode('tables')}
              style={{
                flex: 1, padding: '8px 10px', borderRadius: 8, border: '1px solid #555',
                background: mode === 'tables' ? '#f59e0b' : '#333', color: '#fff', cursor: 'pointer'
              }}
            >
              Table
            </button>
            <button
              onClick={() => setMode('menu')}
              style={{
                flex: 1, padding: '8px 10px', borderRadius: 8, border: '1px solid #555',
                background: mode === 'menu' ? '#f59e0b' : '#333', color: '#fff', cursor: 'pointer'
              }}
            >
              MENU
            </button>
          </div>

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
            {mode === 'menu' ? (
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
            ) : (
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
            bottom: selectedTable ? BOTTOM_BAR_H : 0,
            overflowY: 'auto',
            padding: '12px 16px',
            background: '#fff8dc',
            zIndex: 100,
          }}
        >
          {mode === 'menu' ? (
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
                  {foodsForDisplay.map((food) => (
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
                          src={withBase(food.imageUrl)}
                          alt=""
                          style={{ width: '100%', height: 'auto', objectFit: 'cover', display: 'block' }}
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
{Object.entries(currentCart).map(([imgName, item]) => {
  const f = findFoodByImageName(imgName); // tìm thông tin món
  return (
    <div key={imgName} style={{ display:'flex', alignItems:'center', marginBottom:8 }}>
      {/* Hiển thị hình ảnh và tên món */}
      {f ? (
        <>
<img src={withBase(f.imageUrl)} alt={f.name}
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
        <div style={{ flex: 1 }}>
          {imgName}
        </div>
      )}

      {/* Các nút điều chỉnh số lượng và ghi chú */}
      <div style={{ display:'flex', alignItems:'center', gap: 8 }}>
        <button onClick={() => decItem(f || { imageUrl: imgName })}>−</button>
        <div style={{ minWidth: 32, textAlign: 'center' }}>{item.qty}</div>
        <button onClick={() => incItem(f || { imageUrl: imgName })}>+</button>
        <input
          value={item.note}
          onChange={e => setCarts(prev => {
            const cart = { ...(prev[currentTableKey] || {}) };
            cart[imgName] = { ...cart[imgName], note: e.target.value };
            return { ...prev, [currentTableKey]: cart };
          })}
          placeholder="Ghi chú... "
          style={{ width: 120, padding: 4, border:'1px solid #ddd', borderRadius:6 }}
        />
        <button onClick={() => setCartQty(imgName, 0)}>Xóa</button>
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
            const key = it.imageKey || it.imageName;
            const f = findFoodByImageName(key);
            const label = (f?.productName || f?.name || it.name || key || '').trim();

            return (
              <React.Fragment key={idx}>
                <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                  {f ? (
                    <img
                      src={withBase(f.imageUrl)}
                      alt={f.name}
                      style={{ width: 40, height: 40, borderRadius: 6, border:'1px solid #eee' }}
                    />
                  ) : (
                    <div style={{ width: 40, height: 40 }} />
                  )}

                  <div style={{ fontSize: 12 }}>
                    {(f?.productCode || f?.code) && (
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
        {selectedTable && (
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
          onClick={() => setShowOrderForm(false)}
          style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:9999 }}
        >
          <div
            onClick={(e)=>e.stopPropagation()}
            style={{ width: 420, background:'#fff', borderRadius:10, padding:16 }}
          >
            <h3 style={{ marginTop:0 }}>Tạo Order</h3>

            <div style={{ display:'grid', gap:10 }}>
              <div>
              <label>Staff *</label>
              <input
                type="number"
                pattern="[0-9]*"
                inputMode="numeric"
                value={orderForm.staff}
                onChange={e => setOrderForm(f => ({ ...f, staff: e.target.value }))}
                placeholder="Mã nhân viên"
                style={{ width:'100%', padding:8, border:'1px solid #ddd', borderRadius:6 }}
              />
              {/* Hiển thị tên nhân viên nếu tìm thấy */}
              {staffName && (
                <div style={{ marginTop: 4, fontSize: 12, color: '#6b7280' }}>
                  Tên nhân viên: {staffName}
                </div>
              )}
              </div>
              <div>
                <label>Member *</label>
                <input
                  value={orderForm.memberCard}
                  onChange={e=>setOrderForm(f=>({...f, memberCard:e.target.value}))}
                  placeholder="Nhập mã thẻ / số thẻ"
                  style={{ width:'100%', padding:8, border:'1px solid #ddd', borderRadius:6 }}
                />
              </div>
              <div>
<label>Name</label>
<input
  value={orderForm.customerName}
  readOnly
  placeholder="Chưa có thông tin"
  style={{ width:'100%', padding:8, border:'1px solid #ddd', borderRadius:6, background:'#f3f4f6' }}
/>
<label>Level</label>
<input
  value={orderForm.level}
  readOnly
  placeholder="Chưa có thông tin"
  style={{ width:'100%', padding:8, border:'1px solid #ddd', borderRadius:6, background:'#f3f4f6' }}
/>


              </div>
              <div>
                <label>Ghi chú</label>
                <textarea
                  value={orderForm.note}
                  onChange={e=>setOrderForm(f=>({...f, note:e.target.value}))}
                  rows={3}
                  style={{ width:'100%', padding:8, border:'1px solid #ddd', borderRadius:6 }}
                />
              </div>
            </div>

            <div style={{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:12 }}>
              <button onClick={()=>setShowOrderForm(false)} style={{ padding:'8px 12px', border:'1px solid #ddd', borderRadius:8, background:'#fff' }}>Huỷ</button>
              <button onClick={placeOrder} style={{ padding:'8px 12px', border:'none', borderRadius:8, background:'#10b981', color:'#fff' }}>Gửi Order</button>
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
          onChange={e => setQuickOrderForm(f => ({ ...f, staff: e.target.value }))}
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
            const staffVal = (quickOrderForm.staff || '').trim();
            // Validate staff
            if (!staffVal || !/^\\d+$/.test(staffVal)) {
              setToast('Mã nhân viên phải là số');
              return;
            }
            // Tách mã member theo dấu phẩy hoặc xuống dòng
            const codes = (quickOrderForm.members || '')
              .split(/[,\\n]+/)
              .map(s => s.trim())
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

export default UserFoodList;
