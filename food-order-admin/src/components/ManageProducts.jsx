// SAFE_CLEANUP_PHASE2D_20260913
// src/components/ManageProducts.jsx
import React from 'react';
import ReactDOM from 'react-dom';
import axios from 'axios';
import * as XLSX from 'xlsx';




export default function ManageProductsModal({
  onClose,
  apiUrl,
  resolveImg,
  socket,
  ALL_LEVELS = ['P', 'I', 'I+', 'V', 'One', 'One+', 'EC'],
}) 


{
    // Level menu dùng bên User (FoodList)
  const USER_MENU_LEVELS = ['P', 'I-I+', 'V-One'];

// ===== Helpers/Constants =====
  const [activeTab, setActiveTab] = React.useState('products'); // 'products' | 'customers'
  const SOURCE_FOLDER = 'SOURCE'; // thư mục chứa ảnh gốc
const TYPE_LS_KEY = 'menuTypeOptions';


  // ==== Levels (Khách hàng) — động + lưu localStorage ====
  const LEVELS_LS_KEY = 'customerLevelsOptions';
  const RESERVED_LEVELS = ['P', 'I', 'I+', 'V', 'One', 'One+', 'EC'];
  const [levelOptions, setLevelOptions] = React.useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(LEVELS_LS_KEY) || '[]');
      return Array.from(new Set([...RESERVED_LEVELS, ...saved]));
    } catch { return RESERVED_LEVELS; }
  });
React.useEffect(() => {
  const custom = levelOptions.filter(lv => !RESERVED_LEVELS.includes(lv));
  localStorage.setItem(LEVELS_LS_KEY, JSON.stringify(custom));
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [levelOptions]);


  const addLevelOption = () => {
    const raw = prompt('Tên level mới (ví dụ: VIP, Diamond…)');
    if (!raw) return;
    const name = String(raw).trim();
    if (!name) return alert('Tên level không hợp lệ.');
    setLevelOptions(prev => (prev.includes(name) ? prev : [...prev, name]));
  };
  const deleteLevelOption = (lv) => {
    if (RESERVED_LEVELS.includes(lv)) return alert('Không thể xoá level mặc định.');
    setLevelOptions(prev => prev.filter(x => x !== lv));
  };

  function sanitizeMenuName(s = '') {
    const t = String(s).trim();
    if (!t) return '';
    return t
      .split(/\s+/)
      .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(' ');
  }

  async function checkSourcePresence(imgKey) {
    try {
      const url = resolveImg(`/images/${SOURCE_FOLDER}/${imgKey}`);
     const res = await fetch(url, { method: 'HEAD' });
     if (res.ok) return true;
     // Fallback: thử GET (có thể vẫn bị CORS chặn ở 1 số cấu hình)
     try {
       const res2 = await fetch(url, { method: 'GET', cache: 'no-store' });
       return res2.ok;
     } catch {}
     return false;
    } catch {
      return false;
    }
  }

const fetchMenuLevels = React.useCallback(async () => {
  try {
    const r = await axios.get(apiUrl('/api/products/menu-levels'));
    return r.data || {};
  } catch {
    try {
      const r2 = await axios.get(apiUrl('/api/menu-levels'));
      return r2.data || {};
    } catch {
      return {};
    }
  }
}, [apiUrl]);


  const [menuOptions, setMenuOptions] = React.useState([]);
  const [rawRows, setRawRows] = React.useState([]);
  const [rows, setRows] = React.useState([]);
  const [itemGroups, setItemGroups] = React.useState([]);

  const RESERVED_TYPES = React.useMemo(() => ['đồ ăn', 'đồ uống', 'khác'], []);
  const [typeOptions, setTypeOptions] = React.useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(TYPE_LS_KEY) || '[]');
      return Array.from(new Set([...RESERVED_TYPES, ...saved]));
    } catch {
      return RESERVED_TYPES;
    }
  });

  // Đồng bộ loại từ dữ liệu (giữ loại mặc định + loại user thêm)
  React.useEffect(() => {
    const fromRows = Array.from(
      new Set(
        (rawRows || [])
          .map(r => String(r.menuType || '').trim().toLowerCase())
          .filter(Boolean),
      ),
    );
    setTypeOptions(prev => Array.from(new Set([...prev, ...fromRows, ...RESERVED_TYPES])));
  }, [rawRows, RESERVED_TYPES]);

  // Persist custom types
  React.useEffect(() => {
    const custom = typeOptions.filter(t => !RESERVED_TYPES.includes(t));
    localStorage.setItem(TYPE_LS_KEY, JSON.stringify(custom));
  }, [typeOptions, RESERVED_TYPES]);

  function normalizeType(s) {
    return String(s || '').trim().toLowerCase();
  }

    async function deleteMenuType(name) {
    if (RESERVED_TYPES.includes(name)) return alert('Không thể xóa loại mặc định.');
    const usedIds = (rawRows || []).filter(r => normalizeType(r.menuType) === name).map(r => r.id);
    const msg = usedIds.length
      ? `Có ${usedIds.length} sản phẩm đang thuộc "${name}". Xóa loại này sẽ chuyển các sản phẩm đó sang "khác". Tiếp tục?`
      : `Xóa loại "${name}"?`;
    if (!window.confirm(msg)) return;

    try {
      if (usedIds.length) {
        await axios.post(apiUrl('/api/products/bulk-update'), { ids: usedIds, patch: { menuType: 'khác' } });
        setRawRows(prev => prev.map(x => (usedIds.includes(x.id) ? { ...x, menuType: 'khác' } : x)));
        setRows(prev => prev.map(x => (usedIds.includes(x.id) ? { ...x, menuType: 'khác' } : x)));
      }
      setTypeOptions(prev => prev.filter(t => t !== name));
      setSelectedTypes(prev => {
        const s = new Set(prev);
        s.delete(name);
        return s;
      });
    } catch (e) {
      alert('Xóa loại thất bại: ' + (e?.response?.data?.error || e?.message || ''));
    }
  }

  async function deleteItemGroupHard(name) {
    if (!name) return;
    if (!window.confirm(`Xóa nhóm "${name}"? Các sản phẩm trong nhóm sẽ bị bỏ trống nhóm.`)) return;

    try {
      try {
        try {
          await axios.delete(apiUrl(`/api/products/item-groups/${encodeURIComponent(name)}`));
        } catch (eA) {
          await axios.delete(apiUrl(`/api/item-groups/${encodeURIComponent(name)}`)); // fallback server cũ
        }
      } catch (e) {
        const ids = (rawRows || []).filter(r => (r.itemGroup || '') === name).map(r => r.id);
        if (ids.length) {
          await axios.post(apiUrl('/api/products/bulk-update'), { ids, patch: { itemGroup: '' } });
          setRawRows(prev => prev.map(x => (ids.includes(x.id) ? { ...x, itemGroup: '' } : x)));
          setRows(prev => prev.map(x => (ids.includes(x.id) ? { ...x, itemGroup: '' } : x)));
        }
      }

      await reloadItemGroups();
      setSelectedItemGroups(prev => {
        const s = new Set(prev);
        s.delete(name);
        return s;
      });
    } catch (e) {
      alert('Xóa nhóm thất bại: ' + (e?.response?.data?.error || e?.message || ''));
    }
  }

  const [loading, setLoading] = React.useState(false);
  const [savingId, setSavingId] = React.useState(null);
  const [previewUrl, setPreviewUrl] = React.useState('');
  const [preview, setPreview] = React.useState(null);
  const [showBulk, setShowBulk] = React.useState(false);

  // PATCH: phân trang + lock + cancel
const PRODUCTS_PAGE_SIZE = 500;
const [productsPage, setProductsPage] = React.useState(1);

const productsLoadLock = React.useRef(false);
const productsCancelRef = React.useRef(null);
const productsReloadTimerRef = React.useRef(null);


  // Index menu/foods để quản lý menu thực sự (Admin/User)
  const [foodsIndex, setFoodsIndex] = React.useState(new Map()); // key = `${type}|${imageKey}` -> food
  const [menusOfImage, setMenusOfImage] = React.useState(new Map()); // key = imageKey -> Set(menuTypes)
  const [imageVersions, setImageVersions] = React.useState({}); // cache-buster cho ảnh sau khi đổi
  const [menuEditor, setMenuEditor] = React.useState({ open: false, product: null });


  // Filters (sidebar)
  const [kSearch, setKSearch] = React.useState('');
  const [typeOpen, setTypeOpen] = React.useState(true);
  const [groupOpen, setGroupOpen] = React.useState(true);
  const [selectedTypes, setSelectedTypes] = React.useState(new Set()); // đồ ăn, đồ uống, khác
  const [selectedItemGroups, setSelectedItemGroups] = React.useState(new Set()); // filter nhiều nhóm
  // Menu (Admin/User) — filter giống Loại thực đơn & Nhóm hàng
  const [menuOpen, setMenuOpen] = React.useState(true);
  const [selectedMenus, setSelectedMenus] = React.useState(new Set());
  const toggleMenuFilter = m =>
    setSelectedMenus(prev => {
      const s = new Set(prev);
      s.has(m) ? s.delete(m) : s.add(m);
      return s;
    });

  // Sort
  const [sortKey, setSortKey] = React.useState('code'); // default: Mã hàng
  const [sortDir, setSortDir] = React.useState('asc'); // default: Từ thấp → cao

  // Selection
  const [selectedIds, setSelectedIds] = React.useState(new Set());
  const allSelected = rows.length > 0 && selectedIds.size === rows.length;

  // Add modal / Import
  const [showAdd, setShowAdd] = React.useState(false);


  // Levels mặc định cho từng Menu
  const [menuLevelsMap, setMenuLevelsMap] = React.useState({});
  const [selectedMenu, setSelectedMenu] = React.useState('');
  const [levelsSel, setLevelsSel] = React.useState(new Set());
  const [justSavedId, setJustSavedId] = React.useState(null);

  // Giữ vị trí scroll ở panel bên phải (bảng)
  const rightPaneRef = React.useRef(null);
  const keepScroll = fn => {
    const el = rightPaneRef.current;
    const top = el ? el.scrollTop : 0;
    const left = el ? el.scrollLeft : 0;
    fn();
    requestAnimationFrame(() => {
      if (el) {
        el.scrollTop = top;
        el.scrollLeft = left;
      }
    });
  };

  React.useEffect(() => {
    (async () => {
      const lv = await fetchMenuLevels();
      setMenuLevelsMap(lv || {});
    })();
}, [fetchMenuLevels]);

  React.useEffect(() => {
    const lv = menuLevelsMap[selectedMenu] || [];
    setLevelsSel(new Set(lv));
  }, [selectedMenu, menuLevelsMap]);

  async function saveDefaultLevels() {
    if (!selectedMenu) return alert('Chọn menu.');
    const arr = Array.from(levelsSel);
    try {
      try {
        await axios.post(apiUrl('/api/products/menu-levels'), { type: selectedMenu, levelAccess: arr });
      } catch {
        await axios.post(apiUrl('/api/menu-levels'), { type: selectedMenu, levelAccess: arr });
      }
    } catch (er) {
      return alert('Lưu default thất bại: ' + (er?.response?.data?.error || er?.message || ''));
    }
    setMenuLevelsMap(prev => ({ ...prev, [selectedMenu]: arr }));
    alert('Đã lưu default levels.');
  }

  async function applyLevelsToAll() {
    if (!selectedMenu) return alert('Chọn menu.');
    const arr = Array.from(levelsSel);
    if (!window.confirm(`Áp dụng levels [${arr.join(', ') || '—'}] cho toàn bộ món trong "${selectedMenu}"?`)) return;

    try {
      try {
        await axios.post(apiUrl('/api/products/update-levels-by-type'), { type: selectedMenu, levelAccess: arr });
      } catch {
        await axios.post(apiUrl('/api/update-levels-by-type'), { type: selectedMenu, levelAccess: arr });
      }
    } catch (er) {
      return alert('Áp dụng thất bại: ' + (er?.response?.data?.error || er?.message || ''));
    }
    await loadFoodsLite();
    alert('Đã áp dụng xuống các món.');
  }

  const [newMenuName, setNewMenuName] = React.useState('');
  const [newTypeName, setNewTypeName] = React.useState('');
  const [newItemGroupName, setNewItemGroupName] = React.useState('');
  const addMenu = async () => {
    const raw = (newMenuName || '').trim() || window.prompt('Tên menu mới (VD: CLUB MENU)') || '';
    if (!raw) return;

    const name = sanitizeMenuName(raw);
    try {
      try {
        await axios.post(apiUrl('/api/products/menu-levels'), { type: name, levelAccess: [] });
      } catch {
        await axios.post(apiUrl('/api/menu-levels'), { type: name, levelAccess: [] });
      }

      setMenuOptions(prev => Array.from(new Set([...(prev || []), name])).sort());
            // đảm bảo map levels hiện ngay là rỗng cho menu mới:
      setMenuLevelsMap(prev => ({ ...prev, [name]: [] }));
      // tuỳ chọn: chọn luôn menu vừa tạo để bạn tick level thủ công:
      setSelectedMenu(name);
      setNewMenuName('');

      await loadFoodsLite();
    } catch (e) {
      alert('Tạo menu thất bại: ' + (e?.response?.data?.error || e?.message || ''));
    }
  };

  const deleteMenu = async name => {
    if (!name) return;
    if (!window.confirm(`Xóa menu "${name}"? Tất cả món thuộc menu này ở Admin/User sẽ bị gỡ khỏi menu.`)) return;

    try {
      // server.js route này xóa membership foods + level map của menu đúng với hành vi UI hiện tại.
      await axios.delete(apiUrl(`/api/menu-levels/${encodeURIComponent(name)}`));
      setMenuOptions(prev => (prev || []).filter(m => m !== name));
      await loadFoodsLite();
    } catch (e) {
      alert('Xóa menu thất bại: ' + (e?.response?.data?.error || e?.message || ''));
    }
  };

  const imageKeyFromUrlOrName = React.useCallback((imageUrl, imageName) => {
    const pick = imageUrl || imageName || '';
    return (pick.split('/').pop() || '').trim().toLowerCase();
  }, []);

  const resolveImageUrlForProduct = React.useCallback(
    p => {
      if (p?.imageUrl) return p.imageUrl;
      const key = imageKeyFromUrlOrName(p?.imageUrl, p?.imageName);
      for (const k of foodsIndex.keys()) {
        const [, imgKey] = k.split('|');
        if (imgKey === key) {
          const f = foodsIndex.get(k);
          if (f?.imageUrl) return f.imageUrl;
        }
      }
      return null;
    },
    [foodsIndex, imageKeyFromUrlOrName],
  );

  React.useEffect(() => {
    (async () => {
      try {
        const r = await axios.get(apiUrl('/api/products/menu-types'));
        if (Array.isArray(r.data) && r.data.length) {
          setMenuOptions(r.data);
          return;
        }
        throw new Error('empty');
      } catch {
        try {
          const lv = await fetchMenuLevels();
          const fromLevels = Object.keys(lv || {});
          const fromFoods = Array.from(new Set(Array.from(foodsIndex.keys()).map(k => k.split('|')[0])));
          const merged = Array.from(new Set([...fromLevels, ...fromFoods])).sort();
          setMenuOptions(merged);
        } catch {
          const fallback = Array.from(new Set(Array.from(foodsIndex.keys()).map(k => k.split('|')[0])));
          setMenuOptions(fallback.sort());
        }
      }
    })();
}, [foodsIndex, apiUrl, fetchMenuLevels]);

  const reloadItemGroups = React.useCallback(async () => {
    try {
      const r = await axios.get(apiUrl('/api/products/item-groups'));
      setItemGroups(r.data || []);
    } catch (e1) {
      try {
        const r2 = await axios.get(apiUrl('/api/item-groups'));
        setItemGroups(r2.data || []);
      } catch (e2) {
        console.warn('GET item-groups failed:', e2?.message || e1?.message);
        setItemGroups([]);
      }
    }
  }, [apiUrl]);

  React.useEffect(() => {
    reloadItemGroups();
  }, [reloadItemGroups]);

  // Load foods (để biết 1 ảnh đang nằm ở các Menu nào)
  const __liteRef = React.useRef(null);
  const loadFoodsLite = React.useCallback(async () => {
    if (__liteRef.current) return __liteRef.current;
    __liteRef.current = (async () => {
      try {
        const r = await axios.get(apiUrl('/api/foods'));
        const data = Array.isArray(r.data) ? r.data : [];
        const idx = new Map();
        const byImage = new Map();
        for (const f of data) {
          const imgKey = (f.imageUrl || '').split('/').pop()?.toLowerCase() || '';
          const k = `${f.type}|${imgKey}`;
          idx.set(k, f);
          if (!byImage.has(imgKey)) byImage.set(imgKey, new Set());
          byImage.get(imgKey).add(f.type);
        }
        setFoodsIndex(idx);
        setMenusOfImage(byImage);
      } catch (e) {
        console.warn('Load foods for menu-map fail:', e?.message || e);
      } finally {
        __liteRef.current = null;
      }
    })();
    return __liteRef.current;
  }, [apiUrl]);

  React.useEffect(() => {
    loadFoodsLite();
  }, [loadFoodsLite]);




  // PATCH: đặt gần loadProducts
const fetchProductsApi = React.useCallback(async (q = '', page = 1, limit = PRODUCTS_PAGE_SIZE) => {
  // Hủy request trước nếu còn
  if (productsCancelRef.current) { try { productsCancelRef.current(); } catch {} }
  const source = axios.CancelToken.source();
  productsCancelRef.current = source.cancel;

  try {
    const r = await axios.get(apiUrl('/api/products'), {
      params: { q: q || undefined, limit, page, _ts: Date.now() }, // _ts tránh cache
      cancelToken: source.token,
      timeout: 10000
    });
    return r.data;
  } finally {
    productsCancelRef.current = null;
  }
}, [apiUrl]);

// PATCH: thay loadProducts cũ
const loadProducts = React.useCallback(async ({ q = kSearch, page = productsPage } = {}) => {
  if (productsLoadLock.current) return;
  productsLoadLock.current = true;
  setLoading(true);
  try {
    const data = await fetchProductsApi(q, page);
    const rows = Array.isArray(data?.rows) ? data.rows : (Array.isArray(data) ? data : []);


    setRawRows(rows);                // chỉ giữ dữ liệu của trang hiện tại

    setProductsPage(Number(data?.page ?? page));
  } catch (e) {
    alert('Load products fail: ' + (e?.response?.data?.error || e?.message || ''));
  } finally {
    setLoading(false);
    productsLoadLock.current = false;
  }
}, [fetchProductsApi, kSearch, productsPage]);


  React.useEffect(() => {
    loadProducts();
  }, [loadProducts]);

// PATCH: gộp sự kiện socket trong 300ms
React.useEffect(() => {
  const onChange = () => {
    if (productsReloadTimerRef.current) clearTimeout(productsReloadTimerRef.current);
    productsReloadTimerRef.current = setTimeout(() => {
      loadProducts();
    }, 300);
  };

  socket?.on?.('foodAdded', onChange);
  socket?.on?.('foodRenamed', onChange);
  socket?.on?.('foodDeleted', onChange);
  socket?.on?.('foodsDeleted', onChange);
  socket?.on?.('foodsReordered', onChange);
  socket?.on?.('menuLevelsUpdated', onChange);

  return () => {
    clearTimeout(productsReloadTimerRef.current);
    socket?.off?.('foodAdded', onChange);
    socket?.off?.('foodRenamed', onChange);
    socket?.off?.('foodDeleted', onChange);
    socket?.off?.('foodsDeleted', onChange);
    socket?.off?.('foodsReordered', onChange);
    socket?.off?.('menuLevelsUpdated', onChange);
  };
}, [socket, loadProducts]);


  // Derive filtered + sorted
  React.useEffect(() => {
    const tset = selectedTypes;
    const gset = selectedItemGroups;
    const mset = selectedMenus;

    let list = rawRows.filter(r => {
      if (tset.size) {
        const t = (r.menuType || '').toLowerCase();
        if (!tset.has(t)) return false;
      }
      if (gset.size) {
        if (!gset.has(r.itemGroup || '')) return false;
      }
      if (mset.size) {
        const key = imageKeyFromUrlOrName(r.imageUrl, r.imageName);
        const curMenus = menusOfImage.get(key) || new Set();
        let hit = false;
        for (const m of mset) {
          if (curMenus.has(m)) {
            hit = true;
            break;
          }
        }
        if (!hit) return false;
      }
      return true;
    });

    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
    list.sort((a, b) => {
      const dir = sortDir === 'desc' ? -1 : 1;
      if (sortKey === 'price') {
        const av = +a.price || 0,
          bv = +b.price || 0;
        return (av - bv) * dir;
      }
      if (sortKey === 'code') {
        return collator.compare(String(a.productCode || ''), String(b.productCode || '')) * dir;
      }
      return collator.compare(String(a.name || ''), String(b.name || '')) * dir;
    });

    setRows(list);
  }, [rawRows, selectedTypes, selectedItemGroups, selectedMenus, sortKey, sortDir, menusOfImage, imageKeyFromUrlOrName]);

  const toggleType = t =>
    setSelectedTypes(prev => {
      const s = new Set(prev);
      s.has(t) ? s.delete(t) : s.add(t);
      return s;
    });
  const toggleItemGroup = g =>
    setSelectedItemGroups(prev => {
      const s = new Set(prev);
      s.has(g) ? s.delete(g) : s.add(g);
      return s;
    });

    // ===== Export Hàng hóa ra Excel (.xlsx) =====
  function exportProductsXlsx() {
    if (!rows || rows.length === 0) {
      alert('Không có dữ liệu để xuất.');
      return;
    }

    const data = rows.map(r => {
      const imgKey = imageKeyFromUrlOrName(r.imageUrl, r.imageName);
      const menuSet = menusOfImage.get(imgKey) || new Set();
      const menuList = Array.from(menuSet).sort().join(', ');

      return {
        'Hình ảnh': r.imageName || r.imageUrl || '',
        'Mã hàng': r.productCode || '',
        'Tên hàng': r.name || '',
        'Loại thực đơn': r.menuType || '',
        'Nhóm hàng': r.itemGroup || '',
        'Menu': menuList,
        'Giá': r.price ?? '',
      };
    });

    const ws = XLSX.utils.json_to_sheet(data, {
      header: ['Hình ảnh', 'Mã hàng', 'Tên hàng', 'Loại thực đơn', 'Nhóm hàng', 'Menu', 'Giá'],
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'HangHoa');

    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([wbout], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `hang-hoa-${Date.now()}.xlsx`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2500);
  }


  async function syncImageNamesFromProductNames() {
    try {
      const previewRes = await axios.post(apiUrl('/api/products/sync-image-names-from-product-names'), {
        dryRun: true,
      });

      const willRename = Number(previewRes?.data?.willRename || 0);
      const sample = Array.isArray(previewRes?.data?.rows)
        ? previewRes.data.rows.slice(0, 8)
        : [];

      if (willRename <= 0) {
        alert('Không có ảnh nào cần cập nhật. Tên ảnh hiện tại đã khớp Mã hàng - Tên hàng.');
        return;
      }

      const sampleText = sample
        .map(x => `${x.from} → ${x.to}`)
        .join('\n');

      const ok = window.confirm(
        `Hệ thống sẽ đổi tên ${willRename} ảnh theo chuẩn MÃ HÀNG - TÊN HÀNG.\n\n` +
        `${sampleText}${willRename > sample.length ? '\n...' : ''}\n\n` +
        'Việc này sẽ cập nhật products.json, foods.json và tên file ảnh trong các thư mục menu/SOURCE. Tiếp tục?'
      );

      if (!ok) return;

      const res = await axios.post(apiUrl('/api/products/sync-image-names-from-product-names'), {
        dryRun: false,
      });

      await Promise.all([loadProducts(), loadFoodsLite()]);

      alert(
        `Đã cập nhật tên ảnh thành công.\n` +
        `Ảnh đổi tên: ${res?.data?.renamedImages || 0}\n` +
        `Hàng hóa cập nhật: ${res?.data?.productsChanged || 0}\n` +
        `Menu foods cập nhật: ${res?.data?.foodsChanged || 0}`
      );
    } catch (e) {
      alert('Cập nhật tên ảnh thất bại: ' + (e?.response?.data?.error || e?.message || ''));
    }
  }

function ReportPanel({ apiUrl }) {
  const REPORT_UI_KEY = 'manage-products-report-ui';
  const readReportUi = () => {
    try { return JSON.parse(localStorage.getItem(REPORT_UI_KEY) || '{}'); }
    catch { return {}; }
  };
  const reportUi = readReportUi();

  const [preset, setPreset] = React.useState(reportUi.preset || 'today');
  const [fromDate, setFromDate] = React.useState(reportUi.fromDate || '');
  const [toDate, setToDate] = React.useState(reportUi.toDate || '');
  const [exchangeRate, setExchangeRate] = React.useState(Number(reportUi.exchangeRate || 27000));
  const [reportType, setReportType] = React.useState(reportUi.reportType || 'orders_detail');
  const [loading, setLoading] = React.useState(false);
  const [reportData, setReportData] = React.useState(null);
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(100);
  const reportBusyRef = React.useRef(false);

  const money = x => new Intl.NumberFormat('vi-VN').format(+x || 0);
  const usd = x => new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(+x || 0);

  const isoRange = React.useMemo(() => {
    const BUSINESS_HOUR = 6;
    const DAY_MS = 24 * 60 * 60 * 1000;
    const startAtBusinessHour = d => new Date(d.getFullYear(), d.getMonth(), d.getDate(), BUSINESS_HOUR, 0, 0, 0);
    const endFromStart = (start, days = 1) => new Date(start.getTime() + days * DAY_MS - 1);
    const shiftForBusinessDay = d => new Date(d.getTime() - BUSINESS_HOUR * 60 * 60 * 1000);
    const parseYmd = ymd => {
      const [y,m,d] = String(ymd || '').split('-').map(Number);
      return y && m && d ? new Date(y, m - 1, d) : null;
    };
    const getBusinessWeekStart = d => {
      const shifted = shiftForBusinessDay(d);
      const base = new Date(shifted.getFullYear(), shifted.getMonth(), shifted.getDate());
      const dow = (base.getDay() + 6) % 7;
      base.setDate(base.getDate() - dow);
      return startAtBusinessHour(base);
    };
    const now = new Date();
    const shiftedNow = shiftForBusinessDay(now);
    let from, to;

    switch (preset) {
      case 'yesterday': {
        const y = new Date(shiftedNow); y.setDate(y.getDate() - 1);
        from = startAtBusinessHour(y); to = endFromStart(from, 1); break;
      }
      case 'thisWeek': from = getBusinessWeekStart(now); to = endFromStart(from, 7); break;
      case 'lastWeek': {
        const thisWeek = getBusinessWeekStart(now);
        from = new Date(thisWeek.getTime() - 7 * DAY_MS); to = new Date(thisWeek.getTime() - 1); break;
      }
      case 'thisMonth': {
        from = new Date(shiftedNow.getFullYear(), shiftedNow.getMonth(), 1, BUSINESS_HOUR, 0, 0, 0);
        to = new Date(new Date(shiftedNow.getFullYear(), shiftedNow.getMonth() + 1, 1, BUSINESS_HOUR, 0, 0, 0).getTime() - 1); break;
      }
      case 'lastMonth': {
        from = new Date(shiftedNow.getFullYear(), shiftedNow.getMonth() - 1, 1, BUSINESS_HOUR, 0, 0, 0);
        to = new Date(new Date(shiftedNow.getFullYear(), shiftedNow.getMonth(), 1, BUSINESS_HOUR, 0, 0, 0).getTime() - 1); break;
      }
      case 'thisYear': {
        from = new Date(shiftedNow.getFullYear(), 0, 1, BUSINESS_HOUR, 0, 0, 0);
        to = new Date(new Date(shiftedNow.getFullYear() + 1, 0, 1, BUSINESS_HOUR, 0, 0, 0).getTime() - 1); break;
      }
      case 'lastYear': {
        from = new Date(shiftedNow.getFullYear() - 1, 0, 1, BUSINESS_HOUR, 0, 0, 0);
        to = new Date(new Date(shiftedNow.getFullYear(), 0, 1, BUSINESS_HOUR, 0, 0, 0).getTime() - 1); break;
      }
      case 'custom': {
        const f = parseYmd(fromDate); const t = parseYmd(toDate);
        from = f ? startAtBusinessHour(f) : undefined;
        to = t ? endFromStart(startAtBusinessHour(t), 1) : undefined;
        break;
      }
      case 'today':
      default: from = startAtBusinessHour(shiftedNow); to = endFromStart(from, 1); break;
    }
    return { from: from?.toISOString(), to: to?.toISOString() };
  }, [preset, fromDate, toDate]);

  React.useEffect(() => {
    localStorage.setItem(REPORT_UI_KEY, JSON.stringify({ preset, fromDate, toDate, exchangeRate, reportType }));
  }, [preset, fromDate, toDate, exchangeRate, reportType]);

  React.useEffect(() => { setPage(1); }, [reportType, preset, fromDate, toDate]);

  const fetchReport = React.useCallback(async () => {
    if (reportBusyRef.current) return;
    reportBusyRef.current = true;
    setLoading(true);
    try {
      const r = await axios.get(apiUrl('/api/reports/scalable'), {
        params: {
          type: reportType,
          from: isoRange.from,
          to: isoRange.to,
          page,
          limit: pageSize,
          exchangeRate,
        },
        timeout: 30000,
        headers: { 'Cache-Control': 'no-cache' },
      });
      setReportData(r.data || null);
    } catch (e) {
      alert('Không tải được báo cáo: ' + (e?.response?.data?.error || e?.message || ''));
      setReportData(null);
    } finally {
      setLoading(false);
      reportBusyRef.current = false;
    }
  }, [apiUrl, reportType, isoRange.from, isoRange.to, page, pageSize, exchangeRate]);

  React.useEffect(() => {
    const t = setTimeout(fetchReport, 150);
    return () => clearTimeout(t);
  }, [fetchReport]);

  const exportReportCsv = async () => {
    try {
      setLoading(true);
      const r = await axios.get(apiUrl('/api/reports/scalable/export.csv'), {
        params: { type: reportType, from: isoRange.from, to: isoRange.to, exchangeRate },
        responseType: 'blob',
        timeout: 0,
      });
      const blob = new Blob([r.data], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `report-${reportType}-${Date.now()}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 3000);
    } catch (e) {
      alert('Export thất bại: ' + (e?.response?.data?.error || e?.message || ''));
    } finally {
      setLoading(false);
    }
  };

  const handlePrint = () => {
    const container = document.getElementById('report-print-area');
    if (!container) return window.print();
    const printWindow = window.open('', '', 'height=800,width=1100');
    if (!printWindow) return window.print();
    printWindow.document.write('<html><head><title>Báo cáo</title>');
    Array.from(document.querySelectorAll('style, link[rel="stylesheet"]')).forEach(node => printWindow.document.write(node.outerHTML));
    printWindow.document.write('</head><body>' + container.innerHTML + '</body></html>');
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
    printWindow.close();
  };

  const pagination = reportData?.pagination || null;
  const pageStyle = { maxWidth: 1500, margin: '0 auto', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, boxShadow: '0 10px 36px rgba(0,0,0,0.08)' };
  const th = { padding: '9px 8px', background: '#f8fafc', border: '1px solid #d1d5db', textAlign: 'center', whiteSpace: 'nowrap', fontWeight: 700, fontSize: 13 };
  const td = { padding: '9px 8px', border: '1px solid #e5e7eb', verticalAlign: 'top', fontSize: 13, lineHeight: 1.35 };
  const typeTitle = {
    orders_detail: 'BÁO CÁO ĐƠN HÀNG — CHI TIẾT',
    hanghoa_mon: 'BÁO CÁO HÀNG HÓA — THEO MÓN',
    hanghoa_nhom: 'BÁO CÁO HÀNG HÓA — THEO NHÓM HÀNG',
    hanghoa_ban: 'BÁO CÁO HÀNG HÓA — THEO BÀN',
    khachhang_tomtat: 'BÁO CÁO KHÁCH HÀNG — HÀNG BÁN THEO KHÁCH',
    khachhang_chitiet: 'BÁO CÁO KHÁCH HÀNG — CHI TIẾT KHÁCH ORDER',
  }[reportType] || 'BÁO CÁO';

  const Pagination = () => pagination && pagination.totalPages > 1 ? (
    <div style={{ display:'flex', gap:8, alignItems:'center', justifyContent:'center', marginTop:12 }}>
      <button disabled={page <= 1 || loading} onClick={() => setPage(p => Math.max(1, p - 1))}>← Trước</button>
      <span>Trang <b>{pagination.page}</b> / {pagination.totalPages} · {money(pagination.totalRows)} dòng</span>
      <button disabled={page >= pagination.totalPages || loading} onClick={() => setPage(p => p + 1)}>Sau →</button>
      <select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }}>
        <option value={50}>50/trang</option><option value={100}>100/trang</option><option value={200}>200/trang</option><option value={500}>500/trang</option>
      </select>
    </div>
  ) : null;

  return (
    <div style={{ padding:16 }}>
      <div style={{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'center', marginBottom:12 }}>
        <select value={reportType} onChange={e => setReportType(e.target.value)}>
          <optgroup label="Hàng hóa"><option value="hanghoa_mon">Theo Món</option><option value="hanghoa_nhom">Theo Nhóm hàng</option><option value="hanghoa_ban">Theo Bàn</option></optgroup>
          <optgroup label="Khách hàng"><option value="khachhang_tomtat">Hàng bán theo khách (tổng hợp)</option><option value="khachhang_chitiet">Khách order (chi tiết)</option></optgroup>
          <optgroup label="Đơn hàng"><option value="orders_detail">Đơn hàng chi tiết</option></optgroup>
        </select>
        <select value={preset} onChange={e => setPreset(e.target.value)}>
          <option value="today">Hôm nay</option><option value="yesterday">Hôm qua</option><option value="thisWeek">Tuần này</option><option value="lastWeek">Tuần trước</option><option value="thisMonth">Tháng này</option><option value="lastMonth">Tháng trước</option><option value="thisYear">Năm nay</option><option value="lastYear">Năm trước</option><option value="custom">Tùy chọn…</option>
        </select>
        {preset === 'custom' && <><input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} /><span>→</span><input type="date" value={toDate} onChange={e => setToDate(e.target.value)} /></>}
        {reportType === 'orders_detail' && <div style={{ display:'flex', alignItems:'center', gap:6 }}><span>Tỷ giá USD</span><input type="number" min="1" value={exchangeRate} onChange={e => setExchangeRate(e.target.value)} style={{ width:120 }} /></div>}
        <button onClick={fetchReport} disabled={loading}>{loading ? 'Đang tải…' : 'Xem báo cáo'}</button>
        <button onClick={exportReportCsv} disabled={loading}>Export CSV (Excel)</button>
        <button onClick={handlePrint} title="In trang đang hiển thị / Lưu PDF">In</button>
        <span style={{ fontSize:11, color:'#64748b' }}>Report V8: xử lý tại SQLite, không tải toàn bộ Customer/Orders về trình duyệt.</span>
      </div>

      <div id="report-print-area" style={pageStyle}>
        <div style={{ padding:'18px 20px', borderBottom:'1px solid #f1f5f9' }}>
          <div style={{ fontSize:18, fontWeight:800 }}>{typeTitle}</div>
          <div style={{ display:'flex', gap:16, flexWrap:'wrap', marginTop:8, fontSize:13 }}>
            <div><b>Tổng đơn:</b> {money(reportData?.totalOrders || 0)}</div>
            <div><b>Tổng số lượng món:</b> {money(reportData?.totalQty || 0)}</div>
            <div><b>Tổng doanh thu (VND):</b> {money(reportData?.totalRevenue || 0)}</div>
            {reportType === 'orders_detail' && <><div><b>Tỷ giá USD:</b> {money(exchangeRate)}</div><div><b>Tổng doanh thu (USD):</b> {usd(reportData?.totalRevenueUSD || 0)}</div></>}
          </div>
        </div>

        <div style={{ padding:16 }}>
          {loading && <div>Đang tải dữ liệu…</div>}

          {!loading && reportType === 'hanghoa_mon' && ((reportData?.rows || []).length ? (
            <table style={{ width:'100%', borderCollapse:'collapse' }}><thead><tr><th style={th}>Tên món</th><th style={th}>Mã món</th><th style={th}>Nhóm hàng</th><th style={th}>Số lượng</th><th style={th}>Doanh thu</th></tr></thead><tbody>{(reportData.rows || []).map((r,i)=><tr key={r.itemKey || r.code || i}><td style={td}>{r.name}</td><td style={td}>{r.code}</td><td style={td}>{r.group}</td><td style={{...td,textAlign:'right'}}>{money(r.qty)}</td><td style={{...td,textAlign:'right'}}>{money(r.revenue)}</td></tr>)}</tbody></table>
          ) : <div style={{color:'#6b7280'}}>Không có dữ liệu.</div>)}

          {!loading && reportType === 'hanghoa_nhom' && ((reportData?.rows || []).length ? (
            <table style={{ width:'100%', borderCollapse:'collapse' }}><thead><tr><th style={th}>Nhóm hàng</th><th style={th}>Số lượng</th><th style={th}>Doanh thu</th></tr></thead><tbody>{reportData.rows.map((r,i)=><tr key={r.group || i}><td style={td}>{r.group}</td><td style={{...td,textAlign:'right'}}>{money(r.qty)}</td><td style={{...td,textAlign:'right'}}>{money(r.revenue)}</td></tr>)}</tbody></table>
          ) : <div style={{color:'#6b7280'}}>Không có dữ liệu.</div>)}

          {!loading && reportType === 'hanghoa_ban' && ((reportData?.rows || []).length ? (
            <table style={{ width:'100%', borderCollapse:'collapse' }}><thead><tr><th style={th}>Bàn</th><th style={th}>Số lượng món</th><th style={th}>Doanh thu</th></tr></thead><tbody>{reportData.rows.map((r,i)=><tr key={r.table || i}><td style={td}>{r.table}</td><td style={{...td,textAlign:'right'}}>{money(r.qty)}</td><td style={{...td,textAlign:'right'}}>{money(r.revenue)}</td></tr>)}</tbody></table>
          ) : <div style={{color:'#6b7280'}}>Không có dữ liệu.</div>)}

          {!loading && reportType === 'khachhang_tomtat' && ((reportData?.rows || []).length ? (
            <><table style={{ width:'100%', borderCollapse:'collapse' }}><thead><tr><th style={th}>Mã khách hàng</th><th style={th}>Tên khách hàng</th><th style={th}>Level</th><th style={th}>Số lượng món đã order</th><th style={th}>Tổng doanh thu</th></tr></thead><tbody>{reportData.rows.map((r,i)=><tr key={r.id || r.code || i}><td style={td}>{r.code}</td><td style={td}>{r.name}</td><td style={td}>{r.level}</td><td style={{...td,textAlign:'right'}}>{money(r.qty)}</td><td style={{...td,textAlign:'right'}}>{money(r.revenue)}</td></tr>)}</tbody></table><Pagination /></>
          ) : <div style={{color:'#6b7280'}}>Không có dữ liệu.</div>)}

          {!loading && reportType === 'khachhang_chitiet' && ((reportData?.customers || []).length ? (
            <><div style={{ display:'grid', gap:16 }}>{reportData.customers.map(c=><div key={c.id || c.code} style={{ border:'1px solid #e5e7eb', borderRadius:10 }}><div style={{ padding:10, background:'#f9fafb', borderBottom:'1px solid #e5e7eb' }}><b>{c.code || '(Chưa có mã)'}</b> — {c.name || '(không tên)'} &nbsp; | &nbsp; Level: {c.level || '—'}<span style={{float:'right'}}>Tổng SL: <b>{money(c.qty)}</b> · Doanh thu: <b>{money(c.revenue)}</b></span></div><div style={{padding:10}}>{(c.items || []).length ? <table style={{width:'100%',borderCollapse:'collapse'}}><thead><tr><th style={th}>Món</th><th style={th}>Số lượng</th><th style={th}>Doanh thu món</th></tr></thead><tbody>{c.items.map((it,i)=><tr key={`${it.name}-${i}`}><td style={td}>{it.name}</td><td style={{...td,textAlign:'right'}}>{money(it.qty)}</td><td style={{...td,textAlign:'right'}}>{money(it.revenue)}</td></tr>)}</tbody></table> : <div style={{color:'#6b7280'}}>(Chưa gọi món)</div>}</div></div>)}</div><Pagination /></>
          ) : <div style={{color:'#6b7280'}}>Không có dữ liệu.</div>)}

          {!loading && reportType === 'orders_detail' && ((reportData?.rows || []).length ? (
            <><div style={{width:'100%',overflowX:'auto'}}><table style={{ width:'100%', minWidth:1480, borderCollapse:'collapse', tableLayout:'fixed' }}><thead><tr>{['Mã order','Mã nhân viên','Tên nhân viên','Mã món','Tên món','Menu Category','Mã khách hàng','Tên khách hàng','Số lượng','Giá','Giá USD','Ngày giờ','Bàn'].map(h=><th key={h} style={th}>{h}</th>)}</tr></thead><tbody>{reportData.rows.map((r,i)=><tr key={`${r.orderId}-${r.code}-${i}`}><td style={td}>{r.orderId}</td><td style={td}>{r.staffId}</td><td style={td}>{r.staffName}</td><td style={td}>{r.code}</td><td style={td}>{r.name}</td><td style={td}>{r.category}</td><td style={td}>{r.memberCode}</td><td style={td}>{r.memberName}</td><td style={{...td,textAlign:'right'}}>{r.qty}</td><td style={{...td,textAlign:'right'}}>{money(r.price)}</td><td style={{...td,textAlign:'right'}}>{usd(r.priceUSD)}</td><td style={td}>{r.dateTime}</td><td style={td}>{r.table}</td></tr>)}</tbody></table></div><Pagination /></>
          ) : <div style={{color:'#6b7280'}}>Không có dữ liệu.</div>)}
        </div>
      </div>
    </div>
  );
}


  async function removeImageFromAllMenusByKey(imgKey) {
    const menus = Array.from(menusOfImage.get(imgKey) || []);
    for (const m of menus) {
      const k = `${m}|${imgKey}`;
      const f = foodsIndex.get(k);
      try {
        if (f?.id) {
          await axios.delete(apiUrl(`/api/foods/${f.id}`));
        } else {
          await axios.post(apiUrl('/api/foods/menu-toggle-by-image'), {
            imageName: imgKey,
            menu: m,
            checked: false,
          });
        }
      } catch (e) {
        console.warn(
          `Gỡ ảnh ${imgKey} khỏi menu "${m}" lỗi:`,
          e?.response?.data?.error || e?.message || e,
        );
      }
    }
  }

  async function bulkDelete() {
    if (selectedIds.size === 0) return;
    if (!window.confirm('Xóa các hàng đã chọn trong Quản lý và GỠ khỏi mọi menu Admin/User?')) return;

    try {
      const sel = rows.filter(r => selectedIds.has(r.id));
      for (const r of sel) {
        const key = imageKeyFromUrlOrName(r.imageUrl, r.imageName);
        if (key) {
          await removeImageFromAllMenusByKey(key);
        }
      }
      await axios.post(apiUrl('/api/products/bulk-delete'), {
        ids: Array.from(selectedIds),
      });
      setSelectedIds(new Set());
      await Promise.all([loadProducts(), loadFoodsLite()]);
    } catch (e) {
      alert('Bulk delete fail: ' + (e?.response?.data?.error || e?.message || ''));
    }
  }

  async function deleteOneProduct(product) {
    if (!product?.id) return;
    if (!window.confirm(`Xóa món "${product.name || product.productCode || product.id}" khỏi Hàng hóa và mọi Menu?`)) return;
    try {
      const key = imageKeyFromUrlOrName(product.imageUrl, product.imageName);
      if (key) await removeImageFromAllMenusByKey(key);
      await axios.post(apiUrl('/api/products/bulk-delete'), { ids: [product.id] });
      await Promise.all([loadProducts(), loadFoodsLite()]);
    } catch (e) {
      alert('Xóa món thất bại: ' + (e?.response?.data?.error || e?.message || ''));
    }
  }

  // =============== Sub Components ===============

  function BulkEditModal({
    onClose,
    selectedIds,
    setSelectedIds,
    rows,
    setRows,
    setRawRows,
    menusOfImage,
    imageKeyFromUrlOrName,
    loadFoodsLite,
    menuOptions,
    keepScroll,
    itemGroups,
    typeOptions,
  }) {
    const [open, setOpen] = React.useState(null); // 'type' | 'group' | 'menus' | null
    const [applyType, setApplyType] = React.useState(false);
    const [applyGroup, setApplyGroup] = React.useState(false);
    const [applyMenus, setApplyMenus] = React.useState(false);

    const [typeValue, setTypeValue] = React.useState('đồ ăn');
    const [groupValue, setGroupValue] = React.useState('');
    const [menuSel, setMenuSel] = React.useState(new Set());
    const [saving, setSaving] = React.useState(false);
    

    const ids = Array.from(selectedIds);
    const toggleMenu = m => {
      setMenuSel(prev => {
        const s = new Set(prev);
        s.has(m) ? s.delete(m) : s.add(m);
        return s;
      });
    };

    const applyChanges = async () => {
      if (!applyType && !applyGroup && !applyMenus) {
        onClose(false);
        return;
      }
      setSaving(true);
      try {
        const patch = {};
        if (applyType) patch.menuType = typeValue;
        if (applyGroup) patch.itemGroup = groupValue;

        if (Object.keys(patch).length > 0) {
          await axios.post(apiUrl('/api/products/bulk-update'), { ids, patch });
          keepScroll(() => {
            setRawRows(prev => prev.map(x => (selectedIds.has(x.id) ? { ...x, ...patch } : x)));
            setRows(prev => prev.map(x => (selectedIds.has(x.id) ? { ...x, ...patch } : x)));
          });
        }

        if (applyMenus) {
          const missing = new Set();
          const targetMenus = new Set(menuSel);
          const selRows = rows.filter(r => selectedIds.has(r.id));
          const keys = selRows.map(r => imageKeyFromUrlOrName(r.imageUrl, r.imageName));

          for (const key of keys) {
            const cur = new Set(menusOfImage.get(key) || []);
            for (const m of targetMenus) {
              if (!cur.has(m)) {
                try {
                  await axios.post(apiUrl('/api/foods/menu-toggle-by-image'), {
                    imageName: key,
                    menu: m,
                    checked: true,
                  });
                } catch (e) {
                  const code = e?.response?.data?.error;
                  if (code === 'SOURCE_IMAGE_MISSING_REUPLOAD_REQUIRED') {
                    missing.add(key);
                  } else {
                    console.warn(`Add menu "${m}" fail for ${key}:`, e?.message || e);
                  }
                }
              }
            }
            for (const m of cur) {
              if (!targetMenus.has(m)) {
                try {
                  await axios.post(apiUrl('/api/foods/menu-toggle-by-image'), {
                    imageName: key,
                    menu: m,
                    checked: false,
                  });
                } catch (e) {
                  console.warn(`Remove menu "${m}" fail for ${key}:`, e?.message || e);
                }
              }
            }
          }
          if (missing.size) {
            const sample = Array.from(missing).slice(0, 3).join(', ');
            alert(
              `Có ${missing.size} ảnh chưa có bản gốc trong thư mục SOURCE, cần re-upload 1 lần ở "Thêm món" để hệ thống có thể copy vào menu.\nVí dụ: ${sample}${
                missing.size > 3 ? '…' : ''
              }`,
            );
          }
          await loadFoodsLite();
        }

        setSelectedIds(new Set());
        onClose(true);
      } finally {
        setSaving(false);
      }
    };

    React.useEffect(() => {
      const onKey = e => {
        if (e.key === 'Escape') onClose(false);
      };
      document.addEventListener('keydown', onKey);
      const prev = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.removeEventListener('keydown', onKey);
        document.body.style.overflow = prev;
      };
    }, [onClose]);

    return ReactDOM.createPortal(
      <div
        onClick={() => onClose(false)}
        onMouseDown={e => e.stopPropagation()}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.35)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 20000,
          pointerEvents: 'auto',
        }}
      >
        <div
          onClick={e => e.stopPropagation()}
          onMouseDown={e => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          tabIndex={-1}
          style={{
            width: 720,
            maxHeight: '90vh',
            overflow: 'auto',
            background: '#fff',
            borderRadius: 10,
            boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
          }}
        >
          <div
            style={{
              padding: 12,
              borderBottom: '1px solid #e5e7eb',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <div style={{ fontWeight: 700 }}>Cập nhật hàng loạt</div>
            <button
              onClick={() => onClose(false)}
              style={{ border: 'none', background: '#ef4444', color: '#fff', padding: '6px 10px', borderRadius: 6, cursor: 'pointer' }}
            >
              Cancel
            </button>
          </div>

          <div style={{ padding: 12, display: 'grid', gap: 12 }}>
            {/* 1) Loại thực đơn */}
            <div style={{ border: '1px solid #e5e7eb', borderRadius: 8 }}>
              <div
                onClick={() => setOpen(open === 'type' ? null : 'type')}
                style={{ padding: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', background: '#f9fafb' }}
              >
                <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input type="checkbox" checked={applyType} onChange={e => setApplyType(e.target.checked)} />
                  <b>Loại thực đơn</b>
                </label>
                <span style={{ color: '#6b7280' }}>{open === 'type' ? '︿' : '﹀'}</span>
              </div>
              {open === 'type' && (
                <div style={{ padding: 10, display: 'flex', gap: 10 }}>
                  {(typeOptions || ['đồ ăn', 'đồ uống', 'khác']).map(v => (
                    <label key={v} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <input type="radio" name="bulk-type" checked={typeValue === v} onChange={() => setTypeValue(v)} />
                      {v}
                    </label>
                  ))}
                </div>
              )}
            </div>

            {/* 2) Nhóm hàng */}
            <div style={{ border: '1px solid #e5e7eb', borderRadius: 8 }}>
              <div
                onClick={() => setOpen(open === 'group' ? null : 'group')}
                style={{ padding: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', background: '#f9fafb' }}
              >
                <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input type="checkbox" checked={applyGroup} onChange={e => setApplyGroup(e.target.checked)} />
                  <b>Nhóm hàng</b>
                </label>
                <span style={{ color: '#6b7280' }}>{open === 'group' ? '︿' : '﹀'}</span>
              </div>
              {open === 'group' && (
                <div style={{ padding: 10 }}>
                  <select value={groupValue} onChange={e => setGroupValue(e.target.value)} style={{ border: '1px solid #e5e7eb', borderRadius: 6, padding: '6px 8px', minWidth: 240 }}>
                    <option value="">(chưa chọn)</option>
                    {(itemGroups || []).map(g => (
                      <option key={g.name} value={g.name}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* 3) Menu */}
            <div style={{ border: '1px solid #e5e7eb', borderRadius: 8 }}>
              <div
                onClick={() => setOpen(open === 'menus' ? null : 'menus')}
                style={{ padding: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', background: '#f9fafb' }}
              >
                <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input type="checkbox" checked={applyMenus} onChange={e => setApplyMenus(e.target.checked)} />
                  <b>Menu (Admin/User)</b>
                </label>
                <span style={{ color: '#6b7280' }}>{open === 'menus' ? '︿' : '﹀'}</span>
              </div>
              {open === 'menus' && (
                <div style={{ padding: 10, display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fill, minmax(180px,1fr))' }}>
                  {(menuOptions || []).length === 0 && <div style={{ color: '#9ca3af' }}>(Chưa có menu — tạo trong Admin)</div>}
                  {(menuOptions || []).map(m => (
                    <label key={m} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <input type="checkbox" checked={menuSel.has(m)} onChange={() => toggleMenu(m)} />
                      <span>{m}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div style={{ padding: 12, borderTop: '1px solid #e5e7eb', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button onClick={() => onClose(false)} disabled={saving} style={{ border: '1px solid #e5e7eb', borderRadius: 6, padding: '8px 12px', background: '#fff' }}>
              Cancel
            </button>
            <button onClick={applyChanges} disabled={saving} style={{ border: '1px solid #111', borderRadius: 6, padding: '8px 12px', background: '#111', color: '#fff' }}>
              {saving ? 'Đang cập nhật…' : 'Cập nhật'}
            </button>
          </div>
        </div>
      </div>,
      document.body,
    );
  }

  function AddProduct({ itemGroups = [], menuOptions = [], typeOptions = ['đồ ăn', 'đồ uống', 'khác'], addType, existing = [], onDone, onCancel }) {
    const [saving, setSaving] = React.useState(false);
    const [codeLoading, setCodeLoading] = React.useState(false);
    const [form, setForm] = React.useState({
      imageName: '',
      imageUrl: '',
      name: '',
      productCode: '',
      menuType: '',
      itemGroup: '',
      menu: '',
      price: '',
    });

    const nameExists = React.useMemo(() => {
      const n = (form.name || '').trim().toLowerCase();
      return !!n && existing.some(x => String(x.name || '').trim().toLowerCase() === n);
    }, [form.name, existing]);

    const codeExists = React.useMemo(() => {
      const c = (form.productCode || '').trim().toLowerCase();
      return !!c && existing.some(x => String(x.productCode || '').trim().toLowerCase() === c);
    }, [form.productCode, existing]);

    const loadNextCode = React.useCallback(async (itemGroup) => {
      const group = String(itemGroup || '').trim();
      if (!group) {
        setForm(f => ({ ...f, productCode: '' }));
        return;
      }
      try {
        setCodeLoading(true);
        const r = await axios.get(apiUrl('/api/products/next-code'), { params: { itemGroup: group } });
        setForm(f => ({ ...f, productCode: String(r.data?.code || '') }));
      } catch (e) {
        setForm(f => ({ ...f, productCode: '' }));
      } finally {
        setCodeLoading(false);
      }
    }, []);

    async function uploadNewImage(file) {
      if (!file) return;
      if (!form.menuType || !form.itemGroup || !form.menu || !form.productCode || !form.name.trim() || !form.price) {
        alert('Vui lòng điền theo đúng thứ tự: Loại thực đơn → Nhóm hàng → Menu → Mã món → Tên → Giá, rồi mới chọn ảnh.');
        return;
      }
      const fd = new FormData();
      fd.append('image', file);
      fd.append('type', SOURCE_FOLDER);
      const r = await axios.post(apiUrl('/api/upload'), fd);
      const { imageUrl } = r.data || {};
      setForm(f => ({ ...f, imageUrl, imageName: imageUrl?.split('/').pop() || f.imageName }));
    }

    async function save(closeAfter = true) {
      if (!form.menuType) return alert('Chọn Loại thực đơn.');
      if (!form.itemGroup) return alert('Chọn Nhóm hàng.');
      if (!form.menu) return alert('Chọn Menu.');
      if (!form.productCode?.trim()) return alert('Không tạo được mã món tự động. Kiểm tra mã của các món đang có trong Nhóm hàng này.');
      if (codeExists) return alert('Mã món đã tồn tại. Vui lòng chọn lại Nhóm hàng hoặc kiểm tra dữ liệu.');
      if (!form.name?.trim()) return alert('Tên món là bắt buộc.');
      if (nameExists) return alert('Tên món đã tồn tại.');
      const price = Number(form.price);
      if (!Number.isFinite(price) || price <= 0) return alert('Giá phải là số dương.');
      if (!form.imageUrl || !form.imageName) return alert('Vui lòng tải ảnh trước khi lưu.');

      try {
        setSaving(true);
        const payload = {
          name: form.name.trim().toUpperCase(),
          productCode: form.productCode.trim().toUpperCase(),
          menuType: form.menuType,
          itemGroup: form.itemGroup,
          price,
          imageName: form.imageName,
          imageUrl: form.imageUrl,
        };
        await axios.post(apiUrl('/api/products'), payload);
        await axios.post(apiUrl('/api/products/menu-memberships'), {
          imageName: form.imageName,
          menus: [form.menu],
        });

        if (closeAfter) {
          onDone && onDone(true);
        } else {
          const keep = { menuType: form.menuType, itemGroup: form.itemGroup, menu: form.menu };
          setForm({ ...keep, imageName:'', imageUrl:'', name:'', productCode:'', price:'' });
          await loadNextCode(form.itemGroup);
        }
      } catch (e) {
        alert('Thêm thất bại: ' + (e?.response?.data?.error || e?.message || ''));
      } finally {
        setSaving(false);
      }
    }

    const stepStyle = { display:'grid', gap:6 };
    const labelStyle = { fontSize:12, color:'#6b7280', fontWeight:700 };
    const inputStyle = { width:'100%', border:'1px solid #d1d5db', borderRadius:8, padding:'9px 10px', boxSizing:'border-box' };

    return (
      <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.4)', display:'grid', placeItems:'center', zIndex:10000 }}>
        <div style={{ width:680, maxWidth:'94vw', maxHeight:'92vh', overflow:'auto', background:'#fff', borderRadius:14, boxShadow:'0 20px 60px rgba(0,0,0,.28)' }}>
          <div style={{ padding:'14px 16px', borderBottom:'1px solid #e5e7eb', fontWeight:800, fontSize:16 }}>Thêm món mới</div>
          <div style={{ padding:16, display:'grid', gap:14 }}>
            <div style={stepStyle}>
              <label style={labelStyle}>1. Loại thực đơn *</label>
              <div style={{ display:'flex', gap:8 }}>
                <select value={form.menuType} onChange={e => setForm(f => ({ ...f, menuType:e.target.value }))} style={{ ...inputStyle, flex:1 }}>
                  <option value="">(chọn loại thực đơn)</option>
                  {(typeOptions || []).map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                <button type="button" onClick={() => { const raw=prompt('Tên loại thực đơn mới'); if(!raw)return; const n=String(raw).trim().toLowerCase(); if(!n)return; addType?.(n); setForm(f=>({...f,menuType:n})); }} style={{ ...inputStyle, width:44 }}>+</button>
              </div>
            </div>

            <div style={stepStyle}>
              <label style={labelStyle}>2. Nhóm hàng *</label>
              <select disabled={!form.menuType} value={form.itemGroup} onChange={async e => { const v=e.target.value; setForm(f=>({...f,itemGroup:v,productCode:''})); await loadNextCode(v); }} style={inputStyle}>
                <option value="">(chọn nhóm hàng)</option>
                {(itemGroups || []).map(g => <option key={g.name} value={g.name}>{g.name}</option>)}
              </select>
            </div>

            <div style={stepStyle}>
              <label style={labelStyle}>3. Menu *</label>
              <select disabled={!form.itemGroup} value={form.menu} onChange={e => setForm(f=>({...f,menu:e.target.value}))} style={inputStyle}>
                <option value="">(chọn menu hiển thị)</option>
                {(menuOptions || []).map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>

            <div style={stepStyle}>
              <label style={labelStyle}>4. Mã món * — tự động theo Nhóm hàng</label>
              <input readOnly value={codeLoading ? 'Đang tạo mã…' : form.productCode} placeholder="Tự động tạo sau khi chọn Nhóm hàng" style={{ ...inputStyle, background:'#f3f4f6', fontWeight:800 }} />
              {!codeLoading && form.itemGroup && !form.productCode && <div style={{ color:'#dc2626', fontSize:12 }}>Không tìm thấy mẫu mã hiện có trong nhóm này để tạo số tiếp theo.</div>}
            </div>

            <div style={stepStyle}>
              <label style={labelStyle}>5. Tên món *</label>
              <input disabled={!form.productCode} value={form.name} onChange={e => setForm(f=>({...f,name:e.target.value}))} style={inputStyle} />
              {nameExists && <div style={{ color:'#dc2626', fontSize:12 }}>Tên đã tồn tại.</div>}
            </div>

            <div style={stepStyle}>
              <label style={labelStyle}>6. Giá *</label>
              <input disabled={!form.name.trim()} type="number" min="0" value={form.price} onChange={e => setForm(f=>({...f,price:e.target.value}))} style={inputStyle} />
            </div>

            <div style={stepStyle}>
              <label style={labelStyle}>7. Ảnh *</label>
              <input disabled={!form.price} type="file" accept="image/*" onChange={async e => { const f=e.target.files?.[0]; if(f) await uploadNewImage(f); }} />
              {form.imageUrl && <div style={{ display:'flex', alignItems:'center', gap:10 }}><img src={resolveImg(form.imageUrl)} alt="" style={{ width:80, height:80, objectFit:'contain', border:'1px solid #e5e7eb', borderRadius:8 }}/><div style={{ fontSize:12, color:'#6b7280' }}>{form.imageName}</div></div>}
            </div>
          </div>
          <div style={{ padding:14, borderTop:'1px solid #e5e7eb', display:'flex', justifyContent:'flex-end', gap:8 }}>
            <button type="button" onClick={onCancel} disabled={saving} style={{ border:'1px solid #d1d5db', borderRadius:8, padding:'8px 12px', background:'#fff' }}>Bỏ qua</button>
            <button type="button" onClick={() => save(false)} disabled={saving} style={{ border:'1px solid #d1d5db', borderRadius:8, padding:'8px 12px', background:'#fff' }}>Lưu & thêm mới</button>
            <button type="button" onClick={() => save(true)} disabled={saving} style={{ border:0, borderRadius:8, padding:'8px 14px', background:'#111827', color:'#fff', fontWeight:700 }}>{saving ? 'Đang lưu…' : 'Lưu món'}</button>
          </div>
        </div>
      </div>
    );
  }

  function EditMenusModal({ apiUrl, product, onClose, getCurrentMenus, resolveImageUrl, foodsIndex, allMenus = [] }) {
    const [saving, setSaving] = React.useState(false);
    const cur = React.useMemo(() => new Set(getCurrentMenus(product)), [product, getCurrentMenus]);
    const [sel, setSel] = React.useState(new Set(cur));
    const [diagnosing, setDiagnosing] = React.useState(false);
    const imgUrl = resolveImageUrl?.(product);
    const imgKey = React.useMemo(() => {
      const pick = product?.imageUrl || product?.imageName || '';
      return (pick.split('/').pop() || '').trim().toLowerCase();
    }, [product]);

    function toggle(menu) {
      setSel(prev => {
        const s = new Set(prev);
        s.has(menu) ? s.delete(menu) : s.add(menu);
        return s;
      });
    }

    function selectAll() {
      setSel(new Set(allMenus));
    }
    function clearAll() {
      setSel(new Set());
    }

    async function diagnoseSource() {
      try {
        setDiagnosing(true);
        const ok = await checkSourcePresence(imgKey);
        if (ok) {
          alert(`Ảnh gốc tồn tại trong SOURCE: ${imgKey}\nBạn có thể gán vào menu mới bình thường.`);
        } else {
          alert(`❗Không tìm thấy bản gốc trong SOURCE: ${imgKey}\n• Vào "Thêm món" → tải lại ảnh (sẽ lưu bản gốc vào SOURCE)\n• Sau đó gán menu lại lần nữa.`);
        }
      } finally {
        setDiagnosing(false);
      }
    }

    async function applyChanges() {
      const toAdd = [];
      const toRemove = [];
      for (const m of sel) if (!cur.has(m)) toAdd.push(m);
      for (const m of cur) if (!sel.has(m)) toRemove.push(m);

      if (toAdd.length === 0 && toRemove.length === 0) {
        onClose(false);
        return;
      }

      setSaving(true);
      try {
        for (const m of toRemove) {
          const k = `${m}|${imgKey}`;
          const f = foodsIndex?.get?.(k);
          try {
            if (f?.id) {
              await axios.delete(apiUrl(`/api/foods/${f.id}`));
            } else {
              await axios.post(apiUrl('/api/foods/menu-toggle-by-image'), {
                imageName: imgKey,
                menu: m,
                checked: false,
              });
            }
          } catch (e) {
            console.warn(`Remove "${imgKey}" khỏi menu "${m}" lỗi:`, e?.response?.data?.error || e?.message || e);
          }
        }

        for (const m of toAdd) {
          try {
            await axios.post(apiUrl('/api/foods/menu-toggle-by-image'), {
              imageName: imgKey,
              menu: m,
              checked: true,
            });
          } catch (e) {
            const code = e?.response?.data?.error;
            if (code === 'SOURCE_IMAGE_MISSING_REUPLOAD_REQUIRED') {
              alert(
                `❗Thiếu bản gốc trong SOURCE cho ảnh: ${imgKey}
• Vào "Thêm món" → tải lại ảnh để lưu bản gốc vào thư mục SOURCE
• Sau đó mở lại "Sửa Menu" và tick menu "${m}" lần nữa.`,
              );
              setSaving(false);
              onClose(false);
              return;
            } else {
              alert(`Gán menu "${m}" thất bại: ` + (e?.response?.data?.error || e?.message || ''));
            }
          }
        }

        onClose(true);
      } finally {
        setSaving(false);
      }
    }

    return (
      <div
        onClick={() => onClose(false)}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.45)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 20010,
        }}
      >
        <div
          onClick={e => e.stopPropagation()}
          style={{
            width: 680,
            maxHeight: '88vh',
            overflow: 'auto',
            background: '#fff',
            borderRadius: 12,
            boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
          }}
        >
          <div style={{ padding: 12, borderBottom: '1px solid #e5e7eb', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontWeight: 700 }}>Sửa Menu hiển thị</div>
            <button onClick={() => onClose(false)} style={{ border: 'none', background: '#ef4444', color: '#fff', padding: '6px 10px', borderRadius: 6, cursor: 'pointer' }}>
              Đóng
            </button>
          </div>

          <div style={{ padding: 12, display: 'grid', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              {imgUrl ? (
                <img src={resolveImg(imgUrl)} alt="" style={{ width: 96, height: 96, objectFit: 'contain', border: '1px solid #eee', borderRadius: 8, background: '#fff' }} />
              ) : (
                <div style={{ width: 96, height: 96, border: '1px solid #eee', borderRadius: 8, display: 'grid', placeItems: 'center', color: '#9ca3af' }}>(no image)</div>
              )}
              <div style={{ fontSize: 12, color: '#6b7280' }}>
                <div>
                  <b>imageKey:</b> {imgKey}
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                  <button onClick={diagnoseSource} disabled={diagnosing} style={{ border: '1px solid #e5e7eb', borderRadius: 6, padding: '6px 8px', background: '#fff', fontSize: 12 }}>
                    {diagnosing ? 'Đang kiểm tra…' : 'Diagnose SOURCE'}
                  </button>
                  <button onClick={selectAll} style={{ border: '1px solid #e5e7eb', borderRadius: 6, padding: '6px 8px', background: '#fff', fontSize: 12 }}>
                    Chọn tất cả
                  </button>
                  <button onClick={clearAll} style={{ border: '1px solid #e5e7eb', borderRadius: 6, padding: '6px 8px', background: '#fff', fontSize: 12 }}>
                    Bỏ chọn
                  </button>
                </div>
              </div>
            </div>

            <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 10 }}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>Menu (Admin/User)</div>
              <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}>
                {(allMenus || []).length === 0 && <div style={{ color: '#9ca3af' }}>(chưa có menu)</div>}
                {(allMenus || []).map(m => (
                  <label key={m} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input type="checkbox" checked={sel.has(m)} onChange={() => toggle(m)} />
                    <span>{m}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          <div style={{ padding: 12, borderTop: '1px solid #e5e7eb', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button onClick={() => onClose(false)} disabled={saving} style={{ border: '1px solid #e5e7eb', borderRadius: 6, padding: '8px 12px', background: '#fff' }}>
              Hủy
            </button>
            <button onClick={applyChanges} disabled={saving} style={{ border: '1px solid #111', borderRadius: 6, padding: '8px 12px', background: '#111', color: '#fff' }}>
              {saving ? 'Đang lưu…' : 'Lưu'}
            </button>
          </div>
        </div>
      </div>
    );
  }
  // =============== Customers (Khách hàng) ===============
  function AddCustomerModal({ LEVELS = ['P','I','I+','V','One','One+','EC'], onDone, onCancel, apiUrl, existing = [] }) {
    const [saving, setSaving] = React.useState(false);
    const [form, setForm] = React.useState({ code: '', name: '', level: LEVELS[0] || 'P' });
    const codeExists = React.useMemo(() => {
      const c = (form.code || '').trim().toLowerCase();
      return !!c && existing.some(x => String(x.code || '').trim().toLowerCase() === c);
    }, [form.code, existing]);

    async function save(closeAfter = true) {
      if (!form.name?.trim()) return alert('Tên khách hàng là bắt buộc.');
      if (!form.code?.trim()) return alert('Mã khách hàng là bắt buộc.');
      if (codeExists) return alert('Mã khách hàng đã tồn tại.');
      try {
        setSaving(true);
        const payload = { code: form.code.trim(), name: form.name.trim(), level: form.level };
        try { await axios.post(apiUrl('/api/customers'), payload); }
        catch { await axios.post(apiUrl('/api/members'), payload); }
        onDone?.(true);
        if (!closeAfter) setForm({ code: '', name: '', level: LEVELS[0] || 'P' });
      } catch (e) {
        alert('Thêm khách hàng thất bại: ' + (e?.response?.data?.error || e?.message || ''));
      } finally {
        setSaving(false);
      }
    }

    return ReactDOM.createPortal(
      <div onClick={onCancel} style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.35)', display:'grid', placeItems:'center', zIndex:20000 }}>
        <div onClick={e=>e.stopPropagation()} style={{ width:560, background:'#fff', borderRadius:10, boxShadow:'0 18px 48px rgba(0,0,0,0.35)', overflow:'hidden' }}>
          <div style={{ padding:12, borderBottom:'1px solid #e5e7eb', fontWeight:700 }}>Thêm khách hàng</div>
          <div style={{ padding:12, display:'grid', gap:10 }}>
            <div>
              <label style={{ fontSize:12, color:'#6b7280' }}>Mã khách hàng *</label>
              <input value={form.code} onChange={e=>setForm(f=>({ ...f, code:e.target.value }))}
                     style={{ width:'100%', border:'1px solid #e5e7eb', borderRadius:6, padding:'8px 10px' }} />
              {codeExists && <div style={{ color:'#ef4444', fontSize:12, marginTop:4 }}>Mã đã tồn tại.</div>}
            </div>
            <div>
              <label style={{ fontSize:12, color:'#6b7280' }}>Tên khách hàng *</label>
              <input value={form.name} onChange={e=>setForm(f=>({ ...f, name:e.target.value }))}
                     style={{ width:'100%', border:'1px solid #e5e7eb', borderRadius:6, padding:'8px 10px' }} />
            </div>
            <div>
              <label style={{ fontSize:12, color:'#6b7280' }}>Level</label>
              <select value={form.level} onChange={e=>setForm(f=>({ ...f, level:e.target.value }))}>
                {/* nếu LEVELS chưa có nhưng form.level có giá trị lạ, vẫn render được */}
                {!LEVELS.includes(form.level) && form.level ? <option value={form.level}>{form.level}</option> : null}
                {LEVELS.map(lv=> <option key={lv} value={lv}>{lv}</option>)}
              </select>
            </div>
          </div>
          <div style={{ padding:12, borderTop:'1px solid #e5e7eb', display:'flex', justifyContent:'flex-end', gap:8 }}>
            <button onClick={onCancel} disabled={saving} style={{ border:'1px solid #e5e7eb', borderRadius:6, padding:'8px 12px', background:'#fff' }}>Bỏ qua</button>
            <button onClick={()=>save(false)} disabled={saving} style={{ border:'1px solid #e5e7eb', borderRadius:6, padding:'8px 12px', background:'#fff' }}>Lưu & thêm mới</button>
            <button onClick={()=>save(true)} disabled={saving} style={{ border:'1px solid #111', borderRadius:6, padding:'8px 12px', background:'#111', color:'#fff' }}>
              {saving ? 'Đang lưu…' : 'Lưu'}
            </button>
          </div>
        </div>
      </div>,
      document.body
    );
  }

  function CustomerHistoryModal({ apiUrl, customer, onClose }) {
    const [rows, setRows] = React.useState([]);
    const [loading, setLoading] = React.useState(true);

    const formatEntry = React.useCallback((h = {}) => {
      const type = String(h.type || 'EVENT').toUpperCase();
      if (type === 'ORDER') {
        const itemText = (Array.isArray(h.items) ? h.items : []).map(it => `${it.productCode || it.code || ''} ${it.name || ''} x${it.qty || 1}`.trim()).join(', ');
        return `Order #${h.orderId || ''}${h.area || h.tableNo ? ` • ${h.area || ''} ${h.tableNo || ''}` : ''}${itemText ? ` • ${itemText}` : ''}`;
      }
      if (type === 'API_SYNC' || type === 'SYNC' || type === 'CUSTOMER_API_SYNC') {
        return h.detail || 'Customer API đã cập nhật thông tin khách vào Database.';
      }
      if (h.detail) return String(h.detail);
      if (h.data && typeof h.data === 'object') {
        return Object.entries(h.data).map(([k,v]) => {
          if (v && typeof v === 'object' && ('from' in v || 'to' in v)) return `${k}: ${v.from ?? '—'} → ${v.to ?? '—'}`;
          return `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`;
        }).join(' • ');
      }
      return type;
    }, []);

    React.useEffect(() => {
      let cancelled=false;
      (async()=>{
        try {
          setLoading(true);
          let r;
          try { r=await axios.get(apiUrl(`/api/customers/${encodeURIComponent(customer.code)}/history`)); }
          catch { r=await axios.get(apiUrl(`/api/members/${encodeURIComponent(customer.code)}/history`)); }
          if (!cancelled) setRows(Array.isArray(r.data) ? r.data : []);
        } catch { if(!cancelled) setRows([]); }
        finally { if(!cancelled) setLoading(false); }
      })();
      return ()=>{cancelled=true;};
    }, [apiUrl, customer.code]);

    return ReactDOM.createPortal(
      <div onClick={onClose} style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.45)', display:'grid', placeItems:'center', zIndex:20020 }}>
        <div onClick={e=>e.stopPropagation()} style={{ width:760, maxWidth:'94vw', maxHeight:'82vh', overflow:'auto', background:'#fff', borderRadius:12, padding:16 }}>
          <div style={{ display:'flex', justifyContent:'space-between', gap:12, alignItems:'center', marginBottom:12 }}><div><b>Lịch sử khách hàng</b><div style={{ fontSize:12, color:'#6b7280' }}>{customer.code} - {customer.name}</div></div><button onClick={onClose}>Đóng</button></div>
          {loading ? <div>Đang tải…</div> : rows.length===0 ? <div style={{ color:'#6b7280' }}>Chưa có lịch sử.</div> : (
            <div style={{ display:'grid', gap:8 }}>{rows.map((h,i)=><div key={h.id || `${h.at}-${i}`} style={{ border:'1px solid #e5e7eb', borderRadius:8, padding:10 }}><div style={{ display:'flex', justifyContent:'space-between', gap:12 }}><b style={{ fontSize:12 }}>{String(h.type || 'EVENT')}</b><span style={{ fontSize:12, color:'#6b7280' }}>{h.at ? new Date(h.at).toLocaleString('vi-VN') : ''}</span></div><div style={{ marginTop:5, fontSize:13 }}>{formatEntry(h)}</div>{h.by && <div style={{ marginTop:4, fontSize:11, color:'#9ca3af' }}>Bởi: {h.by}</div>}</div>)}</div>
          )}
        </div>
      </div>, document.body
    );
  }

  function CustomersPanel({ apiUrl, LEVELS = [], socket }) {
    const PAGE_SIZE = 100;
    const [rows, setRows] = React.useState([]);
    const [loading, setLoading] = React.useState(false);
    const [q, setQ] = React.useState('');
    const [level, setLevel] = React.useState('');
    const [page, setPage] = React.useState(1);
    const [total, setTotal] = React.useState(0);
    const [totalPages, setTotalPages] = React.useState(1);
    const [summary, setSummary] = React.useState({ total:0, byLevel:{} });
    const [historyOf, setHistoryOf] = React.useState(null);
    const [sortKey, setSortKey] = React.useState('code');
    const [sortDir, setSortDir] = React.useState('asc');
    const [apiStatus, setApiStatus] = React.useState(null);
    const searchTimer = React.useRef(null);

    const loadStatus = React.useCallback(async()=>{
      try { const r=await axios.get(apiUrl('/api/customer-api/status'), { headers:{'Cache-Control':'no-cache'} }); setApiStatus(r.data||null); } catch {}
    }, [apiUrl]);

    const load = React.useCallback(async (nextPage = page) => {
      try {
        setLoading(true);
        const r = await axios.get(apiUrl('/api/members'), {
          params: { q: q || undefined, level: level || undefined, page: nextPage, limit: PAGE_SIZE },
          headers: { 'Cache-Control':'no-cache' },
        });
        const data=r.data||{};
        setRows(Array.isArray(data.items) ? data.items : []);
        setTotal(Number(data.total || 0));
        setPage(Number(data.page || nextPage || 1));
        setTotalPages(Math.max(1, Number(data.totalPages || Math.ceil(Number(data.total||0)/PAGE_SIZE) || 1)));
        setSummary(data.summary || { total:Number(data.total||0), byLevel:{} });
      } catch(e) {
        alert('Không tải được danh sách khách hàng: ' + (e?.response?.data?.error || e.message));
      } finally { setLoading(false); }
    }, [apiUrl, page, q, level]);

    React.useEffect(()=>{ setPage(1); load(1); }, [q, level]);
    React.useEffect(()=>{
      loadStatus();
      const timer = window.setInterval(loadStatus, 15000);
      return ()=>window.clearInterval(timer);
    }, [loadStatus]);
    React.useEffect(()=>{
      const onUpdated=()=>{ clearTimeout(searchTimer.current); searchTimer.current=setTimeout(()=>{ load(page); loadStatus(); },350); };
      const onSyncProgress=(progress={})=>{
        // Realtime qua Socket: không gọi HTTP mỗi 3 customer.
        // Status endpoint 15s/lần vẫn dùng để reconcile số liệu SQLite chính xác.
        setApiStatus(prev=>({
          ...(prev||{}),
          workerRunning: Boolean(progress.running),
          queued: Number(progress.queued || 0),
          processing: Number(progress.processing || 0),
          databaseSyncStatus: progress.running ? 'RUNNING' : (prev?.databaseSyncStatus || 'IDLE'),
          liveProgress: progress,
        }));

        // Khi một lượt worker kết thúc, đọc lại đúng COUNT trong SQLite một lần
        // để độ phủ API/SQLite cập nhật ngay thay vì chờ timer 15 giây.
        if (progress?.running === false && progress?.finishedAt) {
          clearTimeout(searchTimer.current);
          searchTimer.current=setTimeout(()=>{ loadStatus(); load(page); },250);
        }
      };
      socket?.on?.('customersUpdated', onUpdated);
      socket?.on?.('memberUpdated', onUpdated);
      socket?.on?.('customerSyncStatus', onUpdated);
      socket?.on?.('customerSyncProgress', onSyncProgress);
      return ()=>{
        clearTimeout(searchTimer.current);
        socket?.off?.('customersUpdated',onUpdated);
        socket?.off?.('memberUpdated',onUpdated);
        socket?.off?.('customerSyncStatus',onUpdated);
        socket?.off?.('customerSyncProgress',onSyncProgress);
      };
    }, [socket, load, page, loadStatus]);

    const levels = React.useMemo(()=>{
      // Ưu tiên chính các Level đang tồn tại trong Database.
      // Chỉ fallback sang LEVELS local khi backend chưa trả summary.
      const fromDb = Object.keys(summary?.byLevel || {})
        .map(v => String(v || '').trim())
        .filter(v => v && v !== 'Chưa có level');

      const source = fromDb.length ? fromDb : (LEVELS || []);
      return Array.from(new Set(source))
        .filter(Boolean)
        .sort((a,b)=>a.localeCompare(b,undefined,{numeric:true,sensitivity:'base'}));
    }, [LEVELS, summary]);

    const visibleRows = React.useMemo(()=>{
      const collator=new Intl.Collator(undefined,{numeric:true,sensitivity:'base'});
      return [...rows].sort((a,b)=>{
        const dir=sortDir==='desc'?-1:1;
        return collator.compare(String(a?.[sortKey]||''), String(b?.[sortKey]||''))*dir;
      });
    }, [rows,sortKey,sortDir]);

    const setSort=(key)=>{ if(sortKey===key) setSortDir(d=>d==='asc'?'desc':'asc'); else {setSortKey(key);setSortDir('asc');} };
    const sortMark=(key)=>sortKey===key?(sortDir==='asc'?' ▲':' ▼'):'';
    const apiConnection = apiStatus?.connectionStatus || (apiStatus?.ok ? 'ONLINE':'UNKNOWN');
    const apiDataStatus = apiStatus?.apiDataStatus || apiStatus?.lookupStatus || 'IDLE';
    const dbStatus = apiStatus?.database?.status || (apiStatus?.database?.ok ? 'ONLINE' : 'UNKNOWN');
    const dbSyncStatus = apiStatus?.databaseSyncStatus || 'IDLE';
    const lastResult = apiStatus?.workerLastResult || {};
    const liveProgress = apiStatus?.liveProgress || {};
    const liveRunning = Boolean(liveProgress?.running || apiStatus?.workerRunning);
    const liveProcessed = Number(liveProgress?.processed || 0);
    const liveTarget = Number(liveProgress?.target || 0);
    const liveUpdated = Number(liveProgress?.updated || 0);
    const liveFailed = Number(liveProgress?.failed || 0);
    const livePercent = Number.isFinite(Number(liveProgress?.percent))
      ? Number(liveProgress.percent)
      : (liveTarget > 0 ? Math.min(100, Math.round((liveProcessed/liveTarget)*1000)/10) : 0);
    const dbTotalMembers = Number(apiStatus?.database?.totalMembers || summary?.total || 0);
    const dbApiSyncedMembers = Number(apiStatus?.database?.apiSyncedMembers || 0);
    const dbCoveragePercent = Number.isFinite(Number(apiStatus?.database?.apiCoveragePercent))
      ? Number(apiStatus.database.apiCoveragePercent)
      : (dbTotalMembers > 0 ? Math.round((dbApiSyncedMembers/dbTotalMembers)*10000)/100 : 0);

    const formatStatusTime = (value) => {
      if (!value) return '—';
      const d = new Date(value);
      return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('vi-VN');
    };

    const formatEta = (seconds) => {
      const n = Number(seconds);
      if (!Number.isFinite(n) || n < 0) return '—';
      if (n < 60) return `${Math.max(1, Math.round(n))} giây`;
      if (n < 3600) return `${Math.ceil(n/60)} phút`;
      const h = Math.floor(n/3600);
      const m = Math.ceil((n%3600)/60);
      return m ? `${h}h ${m}p` : `${h}h`;
    };

    const tone = (kind) => {
      const green = { bg:'#ecfdf5', fg:'#047857', bd:'#a7f3d0' };
      const red = { bg:'#fef2f2', fg:'#b91c1c', bd:'#fecaca' };
      const amber = { bg:'#fffbeb', fg:'#b45309', bd:'#fde68a' };
      const blue = { bg:'#eff6ff', fg:'#1d4ed8', bd:'#bfdbfe' };
      const gray = { bg:'#f8fafc', fg:'#475569', bd:'#e2e8f0' };
      if (kind === 'green') return green;
      if (kind === 'red') return red;
      if (kind === 'amber') return amber;
      if (kind === 'blue') return blue;
      return gray;
    };

    const apiTone = apiConnection === 'ONLINE' ? 'green' : apiConnection === 'UNKNOWN' ? 'gray' : 'red';
    const apiDataTone = apiDataStatus === 'DATA_OK' || apiDataStatus === 'FOUND' ? 'green' : apiDataStatus === 'IDLE' ? 'gray' : apiDataStatus === 'NO_DATA' || apiDataStatus === 'NOT_FOUND' ? 'amber' : 'red';
    const dbTone = dbStatus === 'ONLINE' ? 'green' : dbStatus === 'UNKNOWN' ? 'gray' : 'red';
    const syncTone = dbSyncStatus === 'UPDATED' ? 'green' : dbSyncStatus === 'RUNNING' ? 'blue' : dbSyncStatus === 'FAILED' || dbSyncStatus === 'DATABASE_ERROR' ? 'red' : dbSyncStatus === 'SYNCED_BEFORE' ? 'amber' : 'gray';

    const apiDataLabel = ({ DATA_OK:'Có dữ liệu', FOUND:'Có dữ liệu', NO_DATA:'Không trả data', NOT_FOUND:'Không trả data', INVALID_RESPONSE:'Data không hợp lệ', IDLE:'Chưa kiểm tra' })[apiDataStatus] || apiDataStatus;
    const syncLabel = ({ UPDATED:'Đã cập nhật SQLite', RUNNING:'Đang đồng bộ', FAILED:'Đồng bộ lỗi', DATABASE_ERROR:'SQLite lỗi', SYNCED_BEFORE:'Đã từng đồng bộ', IDLE:'Chưa chạy' })[dbSyncStatus] || dbSyncStatus;

    const StatusCard = ({ title, value, kind='gray', detail, detail2 }) => {
      const c = tone(kind);
      return <div style={{ border:`1px solid ${c.bd}`, background:c.bg, borderRadius:10, padding:10, minHeight:82 }}>
        <div style={{ color:'#64748b', fontSize:11, fontWeight:700 }}>{title}</div>
        <div style={{ color:c.fg, fontSize:15, fontWeight:900, marginTop:3 }}>{value}</div>
        {detail && <div style={{ color:'#64748b', fontSize:11, marginTop:5 }}>{detail}</div>}
        {detail2 && <div style={{ color:'#64748b', fontSize:11, marginTop:2 }}>{detail2}</div>}
      </div>;
    };

    const customerSyncView = (r = {}) => {
      const st = String(r.syncStatus || '').toUpperCase();
      const syncedAt = r.apiSyncedAt || r.lastApiSuccessAt || null;
      if (st === 'SUCCESS' || syncedAt) return { label:'API', kind:'green', at:syncedAt, title:'Đã nhận dữ liệu Customer API và ghi xuống SQLite' };
      if (st === 'NOT_FOUND') return { label:'NOT FOUND', kind:'amber', at:r.lastApiAttemptAt, title:r.syncError || 'API không trả dữ liệu cho khách này' };
      if (['TIMEOUT','OFFLINE','HTTP_ERROR','INVALID_RESPONSE','ERROR'].includes(st)) return { label:st, kind:'red', at:r.lastApiAttemptAt, title:r.syncError || st };
      return { label:'LOCAL', kind:'gray', at:r.lastApiAttemptAt, title:'Hiện đang dùng dữ liệu local/Database' };
    };

    return <div style={{ background:'#fff', borderTopLeftRadius:12, padding:14, overflow:'auto' }}>
      <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap', marginBottom:12 }}>
        <div style={{ flex:'1 1 280px' }}><div style={{ fontWeight:800, fontSize:18 }}>Khách hàng</div><div style={{ color:'#6b7280', fontSize:12 }}>App đọc từ SQLite. Customer API chỉ cập nhật dữ liệu vào SQLite ở nền.</div></div>
        <button type="button" onClick={()=>{load(page);loadStatus();}} style={{ border:'1px solid #d1d5db', borderRadius:8, padding:'7px 10px', background:'#fff' }}>↻ Tải lại</button>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(210px,1fr))', gap:8, marginBottom:12 }}>
        <StatusCard title="Customer API" value={apiConnection} kind={apiTone} detail={`Phản hồi gần nhất: ${formatStatusTime(apiStatus?.lastOkAt)}`} detail2={`Mã kiểm tra: ${apiStatus?.lastCheckedCode || '—'}`} />
        <StatusCard title="Dữ liệu từ API" value={apiDataLabel} kind={apiDataTone} detail={`Có data gần nhất: ${formatStatusTime(apiStatus?.lastDataAt)}`} detail2={`Lookup: ${apiStatus?.lookupStatus || 'IDLE'}`} />
        <StatusCard title="SQLite Database" value={dbStatus} kind={dbTone} detail={`API ghi DB gần nhất: ${formatStatusTime(apiStatus?.database?.lastApiSyncedAt)}`} detail2={`1 giờ: ${Number(apiStatus?.database?.syncedLastHour || 0).toLocaleString('vi-VN')} khách • 24 giờ: ${Number(apiStatus?.database?.syncedLast24h || 0).toLocaleString('vi-VN')}`} />
        {(()=>{
          const c=tone(liveRunning?'blue':syncTone);
          const currentCodes=Array.isArray(liveProgress?.currentCodes) ? liveProgress.currentCodes : [];
          const overallText=dbTotalMembers>0
            ? `${dbApiSyncedMembers.toLocaleString('vi-VN')} / ${dbTotalMembers.toLocaleString('vi-VN')} (${dbCoveragePercent.toLocaleString('vi-VN',{maximumFractionDigits:2})}%)`
            : '—';
          return <div style={{ border:`1px solid ${c.bd}`, background:c.bg, borderRadius:10, padding:10, minHeight:112 }}>
            <div style={{ display:'flex', alignItems:'center', gap:6, color:'#64748b', fontSize:11, fontWeight:700 }}>
              <span>API → SQLite Sync</span>
              {liveRunning && <span style={{ color:'#2563eb', fontWeight:900 }}>● REALTIME</span>}
            </div>
            <div style={{ color:c.fg, fontSize:15, fontWeight:900, marginTop:3 }}>
              {liveRunning ? `Đang đồng bộ ${livePercent.toFixed(1)}%` : syncLabel}
            </div>
            {liveRunning && liveTarget>0 && <div style={{ height:7, background:'#dbeafe', borderRadius:999, overflow:'hidden', marginTop:7 }}>
              <div style={{ width:`${Math.max(0,Math.min(100,livePercent))}%`, height:'100%', background:'#2563eb', transition:'width .2s linear' }} />
            </div>}
            <div style={{ color:'#475569', fontSize:11, marginTop:6 }}>
              {liveRunning
                ? `${liveProcessed.toLocaleString('vi-VN')} / ${liveTarget.toLocaleString('vi-VN')} xử lý • ${liveUpdated.toLocaleString('vi-VN')} ghi OK • ${liveFailed.toLocaleString('vi-VN')} lỗi`
                : `${Number(lastResult.processed||0).toLocaleString('vi-VN')} xử lý • ${Number(lastResult.updated||0).toLocaleString('vi-VN')} ghi OK • ${Number(lastResult.failed||0).toLocaleString('vi-VN')} lỗi`}
            </div>
            {liveRunning && <div style={{ color:'#64748b', fontSize:11, marginTop:2 }}>
              Tốc độ: {Number(liveProgress?.ratePerMinute||0).toLocaleString('vi-VN',{maximumFractionDigits:1})} khách/phút • ETA lượt này: {formatEta(liveProgress?.etaSeconds)}
            </div>}
            {liveRunning && currentCodes.length>0 && <div style={{ color:'#64748b', fontSize:11, marginTop:2, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }} title={currentCodes.join(', ')}>
              Đang xử lý: {currentCodes.join(', ')}
            </div>}
            <div style={{ color:'#64748b', fontSize:11, marginTop:2 }}>
              Queue {Number(apiStatus?.queued||0).toLocaleString('vi-VN')} • đang xử lý {Number(apiStatus?.processing||0).toLocaleString('vi-VN')} • Độ phủ API trong SQLite: {overallText}
            </div>
          </div>;
        })()}
      </div>

      {apiConnection === 'ONLINE' && ['NO_DATA','NOT_FOUND'].includes(apiDataStatus) && (
        <div style={{ marginBottom:12, padding:'9px 11px', border:'1px solid #fde68a', borderRadius:9, background:'#fffbeb', color:'#92400e', fontSize:12 }}>
          <b>API đang Online nhưng không trả dữ liệu khách.</b> SQLite vẫn hoạt động và app tiếp tục dùng dữ liệu local. Khi API trả data lại, worker sẽ tự ghi xuống SQLite.
        </div>
      )}

      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(120px,1fr))', gap:8, marginBottom:12 }}>
        <div style={{ border:'1px solid #e5e7eb', borderRadius:10, padding:10 }}><div style={{ color:'#6b7280', fontSize:11 }}>Tổng khách hàng</div><b style={{ fontSize:22 }}>{Number(summary?.total||0).toLocaleString('vi-VN')}</b></div>
        {Object.entries(summary?.byLevel||{}).sort((a,b)=>b[1]-a[1]).map(([lv,count])=><div key={lv} style={{ border:'1px solid #e5e7eb', borderRadius:10, padding:10 }}><div style={{ color:'#6b7280', fontSize:11 }}>{lv}</div><b style={{ fontSize:20 }}>{Number(count||0).toLocaleString('vi-VN')}</b></div>)}
      </div>

      <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:10 }}>
        <input defaultValue={q} onChange={e=>{const v=e.target.value;clearTimeout(searchTimer.current);searchTimer.current=setTimeout(()=>setQ(v.trim()),300);}} placeholder="Tìm mã hoặc tên khách…" style={{ flex:'1 1 260px', border:'1px solid #d1d5db', borderRadius:8, padding:'8px 10px' }}/>
        <select value={level} onChange={e=>setLevel(e.target.value)} style={{ minWidth:170, border:'1px solid #d1d5db', borderRadius:8, padding:'8px 10px' }}><option value="">Tất cả Level</option>{levels.map(lv=><option key={lv} value={lv}>{lv} ({summary?.byLevel?.[lv]||0})</option>)}</select>
      </div>

      <div style={{ border:'1px solid #e5e7eb', borderRadius:10, overflow:'hidden' }}>
        <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}><thead><tr style={{ background:'#f8fafc' }}>
          <th onClick={()=>setSort('code')} style={{ textAlign:'left', padding:10, cursor:'pointer' }}>Mã khách hàng{sortMark('code')}</th>
          <th onClick={()=>setSort('name')} style={{ textAlign:'left', padding:10, cursor:'pointer' }}>Tên khách hàng{sortMark('name')}</th>
          <th onClick={()=>setSort('level')} style={{ textAlign:'left', padding:10, cursor:'pointer' }}>Level{sortMark('level')}</th>
          <th style={{ textAlign:'left', padding:10, minWidth:155 }}>Sync</th>
          <th style={{ textAlign:'center', padding:10, width:110 }}>Lịch sử</th>
        </tr></thead><tbody>
          {visibleRows.map(r=>{
            const sv=customerSyncView(r);
            const c=tone(sv.kind);
            return <tr key={r.code||r.id} style={{ borderTop:'1px solid #f1f5f9' }}>
              <td style={{ padding:10, fontWeight:700 }}>{r.code}</td>
              <td style={{ padding:10 }}>{r.name||'—'}</td>
              <td style={{ padding:10 }}><span style={{ padding:'3px 8px', background:'#eef2ff', color:'#3730a3', borderRadius:999, fontWeight:700 }}>{r.level||'—'}</span></td>
              <td style={{ padding:10 }} title={sv.title}>
                <span style={{ display:'inline-block', padding:'3px 8px', border:`1px solid ${c.bd}`, background:c.bg, color:c.fg, borderRadius:999, fontSize:11, fontWeight:800 }}>{sv.label}</span>
                <div style={{ color:'#94a3b8', fontSize:10, marginTop:3 }}>{formatStatusTime(sv.at)}</div>
              </td>
              <td style={{ padding:10, textAlign:'center' }}><button onClick={()=>setHistoryOf(r)} style={{ border:'1px solid #d1d5db', background:'#fff', borderRadius:7, padding:'5px 9px' }}>Xem</button></td>
            </tr>;
          })}
          {!loading && visibleRows.length===0 && <tr><td colSpan={5} style={{ padding:18, textAlign:'center', color:'#6b7280' }}>Không có dữ liệu.</td></tr>}
        </tbody></table>
        {loading && <div style={{ padding:12, color:'#6b7280' }}>Đang tải…</div>}
      </div>

      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:8, flexWrap:'wrap', marginTop:10 }}>
        <span style={{ fontSize:12, color:'#6b7280' }}>Kết quả filter: {total.toLocaleString('vi-VN')} khách • Trang {page}/{totalPages}</span>
        <div style={{ display:'flex', gap:6 }}>
          <button disabled={page<=1} onClick={()=>load(1)}>⏮ Đầu</button>
          <button disabled={page<=1} onClick={()=>load(page-1)}>‹ Trước</button>
          <button disabled={page>=totalPages} onClick={()=>load(page+1)}>Sau ›</button>
          <button disabled={page>=totalPages} onClick={()=>load(totalPages)}>Cuối ⏭</button>
        </div>
      </div>
      {historyOf && <CustomerHistoryModal apiUrl={apiUrl} customer={historyOf} onClose={()=>setHistoryOf(null)}/>} 
    </div>;
  }

    // ==== StaffPanel ====
  // Quản lý danh sách nhân viên: tải, thêm, sửa, xoá
  function StaffPanel({ apiUrl }) {
    const [loading,setLoading]=React.useState(false);
    const [rows,setRows]=React.useState([]);
    const [search,setSearch]=React.useState('');
    const [sortKey,setSortKey]=React.useState('id');
    const [sortDir,setSortDir]=React.useState('asc');

    const loadStaffs=React.useCallback(async()=>{
      try { setLoading(true); const r=await axios.get(apiUrl ? apiUrl('/api/staffs') : '/api/staffs',{headers:{'Cache-Control':'no-cache'}}); setRows((Array.isArray(r.data)?r.data:[]).map(x=>({id:String(x.id||x.code||'').trim(),name:String(x.name||'').trim(),isNew:false}))); }
      catch(e){ alert('Không tải được danh sách nhân viên: '+(e?.response?.data?.error||e.message)); }
      finally{setLoading(false);}
    },[apiUrl]);
    React.useEffect(()=>{loadStaffs();},[loadStaffs]);

    const visible=React.useMemo(()=>{
      const q=search.trim().toLowerCase(); const collator=new Intl.Collator(undefined,{numeric:true,sensitivity:'base'});
      return rows.map((r,index)=>({...r,_index:index})).filter(r=>!q||r.id.toLowerCase().includes(q)||r.name.toLowerCase().includes(q)).sort((a,b)=>collator.compare(String(a[sortKey]||''),String(b[sortKey]||''))*(sortDir==='desc'?-1:1));
    },[rows,search,sortKey,sortDir]);
    const sort=(key)=>{if(sortKey===key)setSortDir(d=>d==='asc'?'desc':'asc');else{setSortKey(key);setSortDir('asc');}};
    const mark=(key)=>sortKey===key?(sortDir==='asc'?' ▲':' ▼'):'';
    const change=(idx,key,val)=>setRows(prev=>prev.map((r,i)=>i===idx?{...r,[key]:val}:r));
    const save=async(idx)=>{const r=rows[idx];const id=r.id.trim(),name=r.name.trim();if(!id||!name)return alert('Mã và tên nhân viên bắt buộc.');try{await axios.put(apiUrl(`/api/staffs/${encodeURIComponent(id)}`),{id,name});await loadStaffs();}catch(e){alert('Không lưu được nhân viên: '+(e?.response?.data?.error||e.message));}};
    const remove=async(id)=>{if(!id)return; if(!window.confirm(`Xóa nhân viên ${id}?`))return; try{await axios.delete(apiUrl(`/api/staffs/${encodeURIComponent(id)}`));await loadStaffs();}catch(e){alert('Không xóa được nhân viên: '+(e?.response?.data?.error||e.message));}};

    return <div style={{ background:'#fff', borderTopLeftRadius:12, padding:14, overflow:'auto' }}>
      <div style={{ display:'flex', justifyContent:'space-between', gap:10, alignItems:'center', flexWrap:'wrap', marginBottom:12 }}><div><div style={{ fontSize:18,fontWeight:800 }}>Nhân viên</div><div style={{ fontSize:12,color:'#6b7280' }}>{rows.length} nhân viên</div></div><button onClick={()=>setRows(prev=>[{id:'',name:'',isNew:true},...prev])} style={{ border:0,background:'#111827',color:'#fff',borderRadius:8,padding:'8px 12px' }}>+ Thêm nhân viên</button></div>
      <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Tìm mã hoặc tên nhân viên…" style={{ width:'100%',boxSizing:'border-box',border:'1px solid #d1d5db',borderRadius:8,padding:'8px 10px',marginBottom:10 }}/>
      <div style={{ border:'1px solid #e5e7eb',borderRadius:10,overflow:'hidden' }}><table style={{ width:'100%',borderCollapse:'collapse' }}><thead><tr style={{background:'#f8fafc'}}><th onClick={()=>sort('id')} style={{textAlign:'left',padding:10,cursor:'pointer',width:180}}>Mã nhân viên{mark('id')}</th><th onClick={()=>sort('name')} style={{textAlign:'left',padding:10,cursor:'pointer'}}>Tên nhân viên{mark('name')}</th><th style={{padding:10,width:180}}>Hành động</th></tr></thead><tbody>
        {visible.map(r=><tr key={`${r.id}-${r._index}`} style={{borderTop:'1px solid #f1f5f9'}}><td style={{padding:8}}><input value={r.id} disabled={!r.isNew} onChange={e=>change(r._index,'id',e.target.value)} style={{width:'100%',boxSizing:'border-box',border:'1px solid #d1d5db',borderRadius:7,padding:'7px 8px',background:r.isNew?'#fff':'#f8fafc'}}/></td><td style={{padding:8}}><input value={r.name} onChange={e=>change(r._index,'name',e.target.value)} style={{width:'100%',boxSizing:'border-box',border:'1px solid #d1d5db',borderRadius:7,padding:'7px 8px'}}/></td><td style={{padding:8,textAlign:'center'}}><button onClick={()=>save(r._index)} style={{border:0,background:'#16a34a',color:'#fff',borderRadius:7,padding:'6px 10px',marginRight:6}}>Lưu</button>{!r.isNew&&<button onClick={()=>remove(r.id)} style={{border:'1px solid #ef4444',background:'#fff',color:'#dc2626',borderRadius:7,padding:'6px 10px'}}>Xóa</button>}</td></tr>)}
        {!loading&&visible.length===0&&<tr><td colSpan={3} style={{padding:16,textAlign:'center',color:'#6b7280'}}>Không có dữ liệu.</td></tr>}
      </tbody></table>{loading&&<div style={{padding:12,color:'#6b7280'}}>Đang tải…</div>}</div>
    </div>;
  }
  // =============== UI Chính ===============
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.35)',
        display: 'grid',
        gridTemplateColumns: '320px 1fr',
        gap: 0,
        alignItems: 'stretch',
        justifyContent: 'stretch',
        zIndex: 9999,
      }}
    >
      {/* LEFT: Sidebar filters */}
      <div style={{ background: '#111', color: '#fff', padding: 14, overflow: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div>
    <div style={{ fontWeight: 700, fontSize: 16 }}>Quản lý</div>
    <div style={{ display:'flex', gap:6, marginTop:8 }}>
      <button
        onClick={()=>setActiveTab('products')}
        style={{ border:'1px solid #e5e7eb', borderRadius:8, padding:'6px 10px', cursor:'pointer',
                 background: activeTab==='products' ? '#fff' : '#334155', color: activeTab==='products' ? '#111' : '#fff', fontSize:12 }}>
        Hàng hóa
      </button>
      <button
        onClick={()=>setActiveTab('customers')}
        style={{ border:'1px solid #e5e7eb', borderRadius:8, padding:'6px 10px', cursor:'pointer',
                 background: activeTab==='customers' ? '#fff' : '#334155', color: activeTab==='customers' ? '#111' : '#fff', fontSize:12 }}>
        Khách hàng
      </button>
      <button
  onClick={() => setActiveTab('staffs')}
  style={{
    border:'1px solid #e5e7eb',
    borderRadius:8,
    padding:'6px 10px',
    cursor:'pointer',
    background: activeTab === 'staffs' ? '#fff' : '#334155',
    color: activeTab === 'staffs' ? '#111' : '#fff',
    fontSize:12
  }}>
  Nhân viên
</button>
            <button
        onClick={()=>setActiveTab('report')}
        style={{ border:'1px solid #e5e7eb', borderRadius:8, padding:'6px 10px', cursor:'pointer',
                 background: activeTab==='report' ? '#fff' : '#334155', color: activeTab==='report' ? '#111' : '#fff', fontSize:12 }}>
        Báo cáo
      </button>
    </div>
  </div>
          <button
            type="button"
            onClick={onClose}
            style={{ border: 'none', background: '#ef4444', color: '#fff', padding: '6px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}
          >
            Đóng
          </button>
        </div>
            {activeTab === 'products' && (
  <>
        <input
          placeholder="Tìm kiếm (mã, tên)…"
          value={kSearch}
          onChange={e => setKSearch(e.target.value)}
          style={{ width: '100%', border: '1px solid #374151', borderRadius: 8, padding: '8px 10px', background: '#1f2937', color: '#fff', marginBottom: 12 }}
        />

        {/* Loại thực đơn */}
        <div style={{ background:'#1f2937', borderRadius:10, marginBottom:12, overflow:'hidden' }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'8px 10px', cursor:'pointer' }} onClick={()=>setTypeOpen(x=>!x)}>
            <div style={{ fontWeight:700 }}>Loại thực đơn</div>
            <button type="button" style={{ border:0, background:'#111', color:'#fff', borderRadius:6, padding:'4px 8px' }}>{typeOpen?'︿':'﹀'}</button>
          </div>
          {typeOpen && <div style={{ padding:'0 10px 10px', display:'grid', gap:8 }}>
            <div style={{ display:'flex', gap:6 }}>
              <input value={newTypeName} onChange={e=>setNewTypeName(e.target.value)} placeholder="Tên loại thực đơn mới" style={{ flex:1, border:'1px solid #374151', borderRadius:6, padding:'6px 8px', background:'#111', color:'#fff' }}/>
              <button type="button" onClick={()=>{const n=normalizeType(newTypeName);if(!n)return;if(typeOptions.includes(n))return alert('Loại này đã tồn tại.');setTypeOptions(prev=>[...prev,n]);setNewTypeName('');}} style={{ border:'1px solid #e5e7eb', borderRadius:6, padding:'6px 10px', background:'#fff' }}>+</button>
            </div>
            {(typeOptions||[]).map(t=><div key={t} style={{ display:'flex', alignItems:'center', gap:8 }}><label style={{ display:'flex', alignItems:'center', gap:8, flex:1 }}><input type="checkbox" checked={selectedTypes.has(t)} onChange={()=>toggleType(t)}/><span>{t}</span></label>{!RESERVED_TYPES.includes(t)&&<button type="button" onClick={()=>deleteMenuType(t)} style={{ border:'1px solid #ef4444', color:'#ef4444', background:'#111', borderRadius:6, padding:'2px 6px' }}>🗑</button>}</div>)}
          </div>}
        </div>

        {/* Nhóm hàng */}
        <div style={{ background:'#1f2937', borderRadius:10, overflow:'hidden' }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'8px 10px', cursor:'pointer' }} onClick={()=>setGroupOpen(x=>!x)}><div style={{ fontWeight:700 }}>Nhóm hàng</div><button type="button" style={{ border:0, background:'#111', color:'#fff', borderRadius:6, padding:'4px 8px' }}>{groupOpen?'︿':'﹀'}</button></div>
          {groupOpen && <div style={{ padding:'0 10px 10px', display:'grid', gap:8 }}>
            <div style={{ display:'flex', gap:6 }}><input value={newItemGroupName} onChange={e=>setNewItemGroupName(e.target.value)} placeholder="Tên nhóm hàng mới" style={{ flex:1, border:'1px solid #374151', borderRadius:6, padding:'6px 8px', background:'#111', color:'#fff' }}/><button type="button" onClick={async()=>{const name=String(newItemGroupName||'').trim();if(!name)return;try{await axios.post(apiUrl('/api/products/item-groups'),{name});setNewItemGroupName('');await reloadItemGroups();}catch(e){alert('Tạo nhóm thất bại: '+(e?.response?.data?.error||e.message));}}} style={{ border:'1px solid #e5e7eb', borderRadius:6, padding:'6px 10px', background:'#fff' }}>+</button></div>
            <div style={{ display:'grid', gap:6, maxHeight:280, overflow:'auto' }}>{(itemGroups||[]).map(g=><div key={g.name} style={{ display:'flex', alignItems:'center', gap:8 }}><label style={{ display:'flex', alignItems:'center', gap:8, flex:1 }}><input type="checkbox" checked={selectedItemGroups.has(g.name)} onChange={()=>toggleItemGroup(g.name)}/><span>{g.name}</span></label><button type="button" onClick={()=>deleteItemGroupHard(g.name)} style={{ border:'1px solid #ef4444', color:'#ef4444', background:'#111', borderRadius:6, padding:'2px 6px' }}>🗑</button></div>)}</div>
          </div>}
        </div>

        {/* Menu: filter + thêm/xóa + Access levels trong cùng một khối */}
        <div style={{ background:'#1f2937', borderRadius:10, marginTop:12, overflow:'hidden' }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'8px 10px', cursor:'pointer' }} onClick={() => setMenuOpen(x=>!x)}>
            <div style={{ fontWeight:700 }}>Menu</div>
            <button type="button" style={{ border:0, background:'#111', color:'#fff', borderRadius:6, padding:'4px 8px' }}>{menuOpen ? '︿' : '﹀'}</button>
          </div>
          {menuOpen && (
            <div style={{ padding:'0 10px 10px', display:'grid', gap:8 }}>
              <div style={{ display:'flex', gap:6 }}>
                <input value={newMenuName} onChange={e=>setNewMenuName(e.target.value)} placeholder="Tên menu mới" style={{ flex:1, border:'1px solid #374151', borderRadius:6, padding:'6px 8px', background:'#111', color:'#fff' }}/>
                <button type="button" onClick={addMenu} style={{ border:'1px solid #e5e7eb', borderRadius:6, padding:'6px 10px', background:'#fff' }}>+</button>
              </div>
              <div style={{ display:'grid', gap:6, maxHeight:260, overflow:'auto' }}>
                {(menuOptions || []).map(m => (
                  <div key={m} style={{ display:'flex', alignItems:'center', gap:8 }}>
                    <label style={{ display:'flex', alignItems:'center', gap:8, flex:1 }}>
                      <input type="checkbox" checked={selectedMenus.has(m)} onChange={() => toggleMenuFilter(m)} />
                      <span>{m}</span>
                    </label>
                    <button type="button" onClick={() => deleteMenu(m)} title={`Xóa menu "${m}"`} style={{ border:'1px solid #ef4444', color:'#ef4444', background:'#111', borderRadius:6, padding:'2px 6px' }}>🗑</button>
                  </div>
                ))}
                {(menuOptions || []).length===0 && <div style={{ color:'#9ca3af' }}>(chưa có menu)</div>}
              </div>
              <div style={{ borderTop:'1px solid #374151', paddingTop:8, display:'grid', gap:8 }}>
                <div style={{ fontWeight:700 }}>Access levels for this menu</div>
                <select value={selectedMenu} onChange={e=>setSelectedMenu(e.target.value)} style={{ border:'1px solid #374151', borderRadius:6, padding:'6px 8px', background:'#111', color:'#fff' }}>
                  <option value="">(chọn menu)</option>
                  {(menuOptions || []).map(m=><option key={m} value={m}>{m}</option>)}
                </select>
                {selectedMenu && <>
                  <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
                    {USER_MENU_LEVELS.map(lv => <label key={lv} style={{ display:'flex', alignItems:'center', gap:5 }}><input type="checkbox" checked={levelsSel.has(lv)} onChange={() => setLevelsSel(prev=>{ const n=new Set(prev); n.has(lv)?n.delete(lv):n.add(lv); return n; })}/>{lv}</label>)}
                  </div>
                  <div style={{ display:'flex', gap:6 }}>
                    <button type="button" onClick={saveDefaultLevels} style={{ border:0, borderRadius:6, padding:'6px 9px', background:'#334155', color:'#fff' }}>Lưu default</button>
                    <button type="button" onClick={applyLevelsToAll} style={{ border:0, borderRadius:6, padding:'6px 9px', background:'#6366f1', color:'#fff' }}>Áp dụng toàn menu</button>
                  </div>
                </>}
              </div>
            </div>
          )}
        </div>
              </>   
                )}    
                 {activeTab === 'customers' && (
  <div style={{ color:'#cbd5e1', fontSize:12, lineHeight:1.5 }}>
    Tìm kiếm và lọc Level được thực hiện trực tiếp ở bảng Khách hàng để kết quả áp dụng cho toàn bộ Database, không chỉ trang hiện tại.
  </div>
)}


      </div>

      {/* RIGHT: Main list */}
      {activeTab === 'products' && (
        <div style={{ background: '#fff', borderTopLeftRadius: 12, padding: 12, overflow: 'auto' }} ref={rightPaneRef}>
{/* Toolbar (Hàng hóa) */}
<div
  style={{
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
    marginBottom: 10,
  }}
>
  <button
    onClick={() => setShowAdd(true)}
    style={{
      border: '1px solid #111',
      borderRadius: 6,
      background: '#111',
      color: '#fff',
      padding: '8px 12px',
      fontSize: 12,
    }}
  >
    + Thêm mới
  </button>

  {/* Chỉ còn Export Excel, không còn Import/Tải mẫu */}
  <button
    type="button"
    onClick={exportProductsXlsx}
    style={{
      border: '1px solid #e5e7eb',
      borderRadius: 6,
      background: '#fff',
      padding: '8px 12px',
      fontSize: 12,
    }}
  >
    Export Excel
  </button>


  <button
    type="button"
    onClick={syncImageNamesFromProductNames}
    style={{
      border: '1px solid #2563eb',
      borderRadius: 6,
      background: '#eff6ff',
      color: '#1d4ed8',
      padding: '8px 12px',
      fontSize: 12,
      fontWeight: 700,
    }}
    title="Đổi tên file ảnh theo Mã hàng - Tên hàng"
  >
    Đồng bộ tên ảnh
  </button>

  <div
    style={{
      marginLeft: 'auto',
      display: 'flex',
      alignItems: 'center',
      gap: 6,
    }}
  >
    <span style={{ fontSize: 12, color: '#6b7280' }}>Sắp xếp:</span>
    <select
      value={sortKey}
      onChange={e => setSortKey(e.target.value)}
      style={{
        border: '1px solid #e5e7eb',
        borderRadius: 6,
        padding: '6px 8px',
      }}
    >
      <option value="code">Mã</option>
      <option value="name">Tên</option>
      <option value="price">Giá</option>
    </select>
    <select
      value={sortDir}
      onChange={e => setSortDir(e.target.value)}
      style={{
        border: '1px solid #e5e7eb',
        borderRadius: 6,
        padding: '6px 8px',
      }}
    >
      <option value="asc">Từ thấp → cao</option>
      <option value="desc">Từ cao → thấp</option>
    </select>
  </div>
</div>


        {/* Bulk actions */}
        {selectedIds.size > 0 && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '6px 0 12px' }}>
            <div>
              <b>{selectedIds.size}</b> hàng hóa được chọn
            </div>
            <button
              onClick={() => {
                setPreviewUrl('');
                setPreview(null);
                setShowBulk(true);
              }}
              style={{ border: '1px solid #e5e7eb', borderRadius: 6, padding: '6px 8px', background: '#fff' }}
            >
              Cập nhật hàng loạt
            </button>
            <button type="button" onClick={bulkDelete} style={{ border: '1px solid #ef4444', color: '#ef4444', borderRadius: 6, padding: '6px 8px', background: '#fff' }}>
              Xóa hàng loạt
            </button>
          </div>
        )}

        {/* Table */}
        {loading ? (
          <div style={{ padding: 12 }}>Loading…</div>
        ) : (
          <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, overflow: 'hidden' }}>
            <table style={{ width: '100%', fontSize: 14, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#f9fafb' }}>
                  <th style={{ textAlign: 'center', padding: 10, width: 40 }}>
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={e => {
                        if (e.target.checked) setSelectedIds(new Set(rows.map(x => x.id)));
                        else setSelectedIds(new Set());
                      }}
                    />
                  </th>
                  <th style={{ textAlign: 'left', padding: 10, minWidth: 130 }}>Ảnh</th>
                  <th style={{ textAlign: 'left', padding: 10 }}>Mã hàng</th>
                  <th style={{ textAlign: 'left', padding: 10 }}>Tên hàng</th>
                  <th style={{ textAlign: 'left', padding: 10 }}>Loại thực đơn</th>
                  <th style={{ textAlign: 'left', padding: 10, minWidth: 220 }}>Nhóm hàng</th>
                  <th style={{ textAlign: 'left', padding: 10, minWidth: 260 }}>Menu (Admin/User)</th>
                  <th style={{ textAlign: 'right', padding: 10, width: 140 }}>Giá</th>
                  <th style={{ textAlign: 'center', padding: 10, width: 170 }}>Hành động</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => {
                  const imgKey = imageKeyFromUrlOrName(r.imageUrl, r.imageName);
                  const menuSet = menusOfImage.get(imgKey) || new Set();
                  const menuList = Array.from(menuSet).sort();
                  const chips = menuList.slice(0, 2);
                  const more = Math.max(0, menuList.length - chips.length);

                  return (
                    <tr key={r.id} style={{ borderTop: '1px solid #f1f5f9' }}>
                          <td style={{ textAlign: 'center', padding: 8, width: 40 }}>
    <input
      type="checkbox"
      checked={selectedIds.has(r.id)}
      onChange={(e) => {
        setSelectedIds(prev => {
          const s = new Set(prev);
          if (e.target.checked) s.add(r.id); else s.delete(r.id);
          return s;
        });
      }}
    />
  </td>
{/* Ảnh */}
<td style={{ padding: 8 }}>
  {(() => {
    const imgKey = imageKeyFromUrlOrName(r.imageUrl, r.imageName);
    const thumb = r.imageUrl || resolveImageUrlForProduct(r);
    const ver = imageVersions[imgKey];

    const handleChangeImage = async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (!imgKey) {
        alert('Không xác định được imageName để cập nhật.');
        return;
      }
      try {
        const fd = new FormData();
        fd.append('image', file);
        fd.append('imageName', imgKey); // giữ nguyên imageName, chỉ đổi nội dung file
        await axios.post(apiUrl('/api/upload/replace'), fd);
        // Cập nhật version để tránh cache
        setImageVersions(prev => ({ ...prev, [imgKey]: Date.now() }));
        alert('Đổi ảnh thành công.');
      } catch (err) {
        alert('Đổi ảnh thất bại: ' + (err?.response?.data?.error || err?.message || ''));
      } finally {
        e.target.value = '';
      }
    };

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {thumb ? (
          <img
            src={resolveImg(ver ? `${thumb}?v=${ver}` : thumb)}
            alt=""
            onClick={() => setPreview(thumb)}
            style={{
              width: 96,
              height: 96,
              objectFit: 'contain',
              border: '1px solid #e5e7eb',
              borderRadius: 8,
              cursor: 'zoom-in',
              background: '#fff',
            }}
          />
        ) : (
          <span style={{ color: '#9ca3af' }}>{r.imageName || '(chưa có)'}</span>
        )}

        {/* Nút đổi ảnh */}
        <label
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '4px 8px',
            borderRadius: 6,
            border: '1px solid #e5e7eb',
            fontSize: 12,
            cursor: 'pointer',
            background: '#f9fafb',
          }}
        >
          Đổi ảnh
          <input
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={handleChangeImage}
          />
        </label>
      </div>
    );
  })()}
</td>


                      <td style={{ padding: 8 }}>
                        <input
                          value={r.productCode || ''}
                          onChange={e => setRows(prev => prev.map(x => (x.id === r.id ? { ...x, productCode: e.target.value } : x)))}
                          style={{ border: '1px solid #e5e7eb', borderRadius: 6, padding: '6px 8px', width: 120 }}
                        />
                      </td>

                      <td style={{ padding: 8 }}>
                        <input
                          value={r.name || ''}
                          onChange={e => setRows(prev => prev.map(x => (x.id === r.id ? { ...x, name: e.target.value } : x)))}
                          style={{ border: '1px solid #e5e7eb', borderRadius: 6, padding: '6px 8px', width: 240 }}
                        />
                      </td>

                      <td style={{ padding: 8 }}>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          <select
                            value={r.menuType || 'đồ ăn'}
                            onChange={e => setRows(prev => prev.map(x => (x.id === r.id ? { ...x, menuType: e.target.value } : x)))}
                            style={{ border: '1px solid #e5e7eb', borderRadius: 6, padding: '6px 8px' }}
                          >
                            {(typeOptions || ['đồ ăn', 'đồ uống', 'khác']).map(t => (
                              <option key={t} value={t}>
                                {t}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            onClick={() => {
                              const raw = prompt('Tên loại thực đơn mới');
                              if (!raw) return;
                              const name = normalizeType(raw);
                              if (!name) return alert('Tên không hợp lệ.');
                              if (RESERVED_TYPES.includes(name)) return alert('Loại mặc định đã tồn tại.');
                              setTypeOptions(prev => (prev.includes(name) ? prev : [...prev, name]));
                              setRows(prev => prev.map(x => (x.id === r.id ? { ...x, menuType: name } : x)));
                            }}
                            title="Thêm loại thực đơn mới"
                            style={{ border: '1px solid #e5e7eb', borderRadius: 6, padding: '6px 8px', background: '#fff' }}
                          >
                            +
                          </button>
                        </div>
                      </td>

                      <td style={{ padding: 8 }}>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          <select
                            value={r.itemGroup || ''}
                            onChange={e => setRows(prev => prev.map(x => (x.id === r.id ? { ...x, itemGroup: e.target.value } : x)))}
                            style={{ border: '1px solid #e5e7eb', borderRadius: 6, padding: '6px 8px', minWidth: 200 }}
                          >
                            <option value="">(chưa chọn)</option>
                            {(itemGroups || []).map(g => (
                              <option key={g.name} value={g.name}>
                                {g.name}
                              </option>
                            ))}
                          </select>
                          <button
                            onClick={async () => {
                              const name = window.prompt('Tên nhóm mới');
                              if (!name) return;
                              try {
                                await axios.post(apiUrl('/api/products/item-groups'), { name });
                                const r2 = await axios.get(apiUrl('/api/products/item-groups'));
                                setItemGroups(r2.data || []);
                                setRows(prev => prev.map(x => (x.id === r.id ? { ...x, itemGroup: name } : x)));
                              } catch (e) {
                                alert('Tạo nhóm thất bại: ' + (e?.message || ''));
                              }
                            }}
                            style={{ border: '1px solid #e5e7eb', borderRadius: 6, padding: '6px 8px', background: '#fff' }}
                          >
                            +
                          </button>
                        </div>
                      </td>

                      {/* Menu chips */}
                      <td style={{ padding: 8 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }} title={menuList.join(', ')}>
                          {menuList.length === 0 && <span style={{ color: '#9ca3af' }}>(chưa ở menu nào)</span>}
                          {chips.map(m => (
                            <span key={m} style={{ fontSize: 12, background: '#eef2ff', color: '#3730a3', padding: '2px 6px', borderRadius: 999 }}>
                              {m}
                            </span>
                          ))}
                          {more > 0 && <span style={{ fontSize: 12, color: '#6b7280' }}>+{more}</span>}
                          <button
                            onClick={() => setMenuEditor({ open: true, product: r })}
                            title="Thêm/bỏ menu hiển thị ở Admin/User"
                            style={{ marginLeft: 'auto', border: '1px solid #e5e7eb', borderRadius: 6, padding: '6px 8px', background: '#fff' }}
                          >
                            Sửa Menu
                          </button>
                        </div>
                      </td>

                      <td style={{ padding: 8, textAlign: 'right' }}>
                        <input
                          type="number"
                          value={r.price ?? 0}
                          onChange={e => setRows(prev => prev.map(x => (x.id === r.id ? { ...x, price: +e.target.value } : x)))}
                          style={{ border: '1px solid #e5e7eb', borderRadius: 6, padding: '6px 8px', width: 120, textAlign: 'right' }}
                        />
                      </td>

                      <td style={{ textAlign: 'center', padding: 8 }}>
                        <button
                          type="button"
                          disabled={savingId === r.id}
                          onClick={async () => {
                            setSavingId(r.id);
                            try {
                              const payload = { ...r, menuType: r.menuType || 'đồ ăn', itemGroup: r.itemGroup || '' };
                              await axios.put(apiUrl(`/api/products/${r.id}`), payload);
                              keepScroll(() => {
                                setRawRows(prev => prev.map(x => (x.id === r.id ? { ...x, ...payload } : x)));
                                setRows(prev => prev.map(x => (x.id === r.id ? { ...x, ...payload } : x)));
                              });
                              setJustSavedId(r.id);
                              setTimeout(() => setJustSavedId(null), 1200);
                            } catch (e) {
                              alert('Save fail: ' + (e?.response?.data?.error || e?.message || ''));
                            } finally {
                              setSavingId(null);
                            }
                          }}
                          style={{ border: '1px solid #e5e7eb', borderRadius: 6, background: '#fff', padding: '6px 8px' }}
                        >
                          {savingId === r.id ? 'Đang lưu…' : justSavedId === r.id ? '✓ Đã lưu' : 'Lưu'}
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteOneProduct(r)}
                          style={{ marginLeft:6, border:'1px solid #ef4444', color:'#dc2626', background:'#fff', borderRadius:6, padding:'6px 8px' }}
                        >
                          Xóa
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={9} style={{ padding: 14, textAlign: 'center', color: '#6b7280' }}>
                      Không có dữ liệu.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Add modal */}
        {showAdd && (
          <AddProduct
            itemGroups={itemGroups}
            menuOptions={menuOptions}
            typeOptions={typeOptions}
            addType={name => {
              const n = (name || '').trim().toLowerCase();
              if (!n) return;
              if (RESERVED_TYPES.includes(n)) return;
              setTypeOptions(prev => (prev.includes(n) ? prev : [...prev, n]));
            }}
            existing={rawRows}
            onDone={async refresh => {
              setShowAdd(false);
              if (refresh) await loadProducts();
            }}
            onCancel={() => setShowAdd(false)}
          />
        )}


{/* Edit Menus modal */}
{menuEditor.open && (
  <EditMenusModal
    apiUrl={apiUrl}
    product={menuEditor.product}
    onClose={(changed) => {
      setMenuEditor({ open: false, product: null });
      if (changed) loadFoodsLite();
    }}
    getCurrentMenus={(p) => {
      const key = imageKeyFromUrlOrName(p?.imageUrl, p?.imageName);
      return Array.from(menusOfImage.get(key) || []);
    }}
    resolveImageUrl={resolveImageUrlForProduct}
    foodsIndex={foodsIndex}
    allMenus={menuOptions}
  />
)}


        {/* Preview ảnh full-screen */}
        {previewUrl && (
          <div
            onClick={() => setPreviewUrl('')}
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.6)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 10001,
              cursor: 'zoom-out',
            }}
          >
            <img src={resolveImg(previewUrl)} alt="" style={{ maxWidth: '90vw', maxHeight: '90vh', borderRadius: 10, boxShadow: '0 12px 40px rgba(0,0,0,0.45)', background: '#fff' }} />
          </div>
        )}
        {showBulk &&
          ReactDOM.createPortal(
            <BulkEditModal
              onClose={ok => {
                setShowBulk(false);
                if (ok) {
                  loadFoodsLite?.();
                }
              }}
              selectedIds={selectedIds}
              setSelectedIds={setSelectedIds}
              rows={rows}
              setRows={setRows}
              setRawRows={setRawRows}
              menusOfImage={menusOfImage}
              imageKeyFromUrlOrName={imageKeyFromUrlOrName}
              loadFoodsLite={loadFoodsLite}
              menuOptions={menuOptions}
              keepScroll={keepScroll}
              itemGroups={itemGroups}
              typeOptions={typeOptions}
            />,
            document.body,
          )}
      </div>
      )}



 {activeTab === 'customers' && (
<CustomersPanel
  apiUrl={apiUrl}
  LEVELS={levelOptions}
  onAddLevel={addLevelOption}
  onDeleteLevel={deleteLevelOption}
  onDiscoverLevels={(found) => {
    if (!found || !found.size) return;                 // không làm gì khi rỗng
    setLevelOptions(prev => {
      const union = new Set(prev);
      let changed = false;
      for (const lv of found) {
        if (!union.has(lv)) { union.add(lv); changed = true; }
      }
      return changed ? Array.from(union) : prev;       // ⚠️ chỉ return mảng mới khi có thay đổi
    });
  }}
  socket={socket}
/>

 )}
 {activeTab === 'staffs' && (
  <div style={{ background:'#fff', borderTopLeftRadius: 12, padding: 12, overflow:'auto' }} ref={rightPaneRef}>
    <StaffPanel apiUrl={apiUrl} />
  </div>
)}
{activeTab === 'report' && (
  <div style={{ background:'#fff', borderTopLeftRadius: 12, padding: 12, overflow: 'auto' }} ref={rightPaneRef}>
    <ReportPanel
      apiUrl={apiUrl}
      ALL_LEVELS={levelOptions}
    />
  </div>
)}

      {/* Overlay preview ảnh (click-zoom) */}
      {preview && (
        <div
          onClick={() => setPreview(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10001,
            cursor: 'zoom-out',
          }}
        >
          <img
            src={resolveImg(preview)}
            alt=""
            style={{
              maxWidth: '92vw',
              maxHeight: '92vh',
              objectFit: 'contain',
              borderRadius: 10,
              background: '#fff',
              boxShadow: '0 20px 60px rgba(0,0,0,0.45)',
            }}
          />
        </div>
      )}
    </div>
  );
}
