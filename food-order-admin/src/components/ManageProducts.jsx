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
const [membersMap, setMembersMap] = React.useState({});

// === Staff lookup ===
const [staffMap, setStaffMap] = React.useState({});
React.useEffect(() => {
  let cancelled = false;
  (async () => {
    try {
      const url = apiUrl ? apiUrl('/api/staffs') : '/api/staffs';
      const res = await axios.get(url, { headers: { 'Cache-Control': 'no-cache' } });
      const arr = Array.isArray(res.data) ? res.data : [];
      const map = {};
      arr.forEach(it => {
        const id = String(it.id || it.code || '').trim();
        if (id) map[id] = String(it.name || '');
      });
      if (!cancelled) setStaffMap(map);
    } catch (e) {
      // nếu lỗi, staffMap sẽ rỗng
    }
  })();
  return () => { cancelled = true; };
}, [apiUrl]);
React.useEffect(() => {
  let cancelled = false;

  (async () => {
    try {
      // Ưu tiên backend (/api/members), sau đó fallback sang /members.json (public)
      const urlCandidates = [
        apiUrl ? apiUrl('/api/members') : null,
        '/members.json',
      ].filter(Boolean);

      let data = null;
      for (const u of urlCandidates) {
        try {
          const isMembersApi = u.includes('/api/members');
          const res = await axios.get(u, {
            headers: { 'Cache-Control': 'no-cache' },
            ...(isMembersApi ? { params: { limit: 70000 } } : {}),
          });
          if (res?.data) { data = res.data; break; }
        } catch (_) {
          // thử URL kế tiếp
        }
      }
      if (!data) return;

      // Chuẩn hóa về map theo code
      // data có thể là:
      // - Array các member
      // - Object { items: [...] } hoặc { rows: [...] } từ /api/members
      // - Object key=code từ /members.json
      let rows = null;
      if (Array.isArray(data)) {
        rows = data;
      } else if (Array.isArray(data.items)) {
        rows = data.items;
      } else if (Array.isArray(data.rows)) {
        rows = data.rows;
      }

      const map = {};
      if (Array.isArray(rows)) {
        rows.forEach(m => {
          const code = String(m?.code ?? m?.customerCode ?? '').trim();
          if (!code) return;
          map[code] = {
            code,
            name: m?.name || m?.customerName || '',
            level: m?.level || m?.memberLevel || '',
          };
        });
      } else if (data && typeof data === 'object') {
        // data đang là object key=code (đúng như members.json bạn gửi)
        Object.keys(data).forEach(k => {
          const m = data[k] || {};
          const code = String(m?.code ?? k).trim();
          if (!code) return;
          map[code] = {
            code,
            name: m?.name || m?.customerName || '',
            level: m?.level || m?.memberLevel || '',
          };
        });
      }

      if (!cancelled) setMembersMap(map);
    } catch (err) {
      console.error('Load members failed', err);
    }
  })();

  return () => { cancelled = true; };
}, [apiUrl]);









  // ===== Helpers/Constants =====
  const [activeTab, setActiveTab] = React.useState('products'); // 'products' | 'customers'
  const SOURCE_FOLDER = 'SOURCE'; // thư mục chứa ảnh gốc
  const custSearchTimer = React.useRef(null);
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

  async function addMenuType() {
    const raw = prompt('Tên loại thực đơn mới (ví dụ: combo)');
    if (!raw) return;
    const name = normalizeType(raw);
    if (!name) return alert('Tên không hợp lệ.');
    if (RESERVED_TYPES.includes(name)) return alert('Loại mặc định đã tồn tại.');
    setTypeOptions(prev => (prev.includes(name) ? prev : [...prev, name]));
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
       try {
   await axios.delete(apiUrl(`/api/products/menu-levels/${encodeURIComponent(name)}`));
 } catch {
   await axios.delete(apiUrl(`/api/menu-levels/${encodeURIComponent(name)}`));
 }
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
        alert('Không có ảnh nào cần cập nhật. Tên ảnh hiện tại đã khớp với Tên hàng.');
        return;
      }

      const sampleText = sample
        .map(x => `${x.from} → ${x.to}`)
        .join('\n');

      const ok = window.confirm(
        `Hệ thống sẽ đổi tên ${willRename} ảnh theo cột Tên hàng.\n\n` +
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

function ReportPanel({ apiUrl,membersMap = {},    ALL_LEVELS = ['P','I','I+','V','One','One+','EC'] }) {
    
  // ====== Time range ======
const REPORT_UI_KEY = 'manage-products-report-ui';

const readReportUi = () => {
  try {
    return JSON.parse(localStorage.getItem(REPORT_UI_KEY) || '{}');
  } catch {
    return {};
  }
};

const reportUi = readReportUi();

const [preset, setPreset] = React.useState(reportUi.preset || 'today');
const [fromDate, setFromDate] = React.useState(reportUi.fromDate || '');
const [toDate, setToDate] = React.useState(reportUi.toDate || '');
const [exchangeRate, setExchangeRate] = React.useState(
  Number(reportUi.exchangeRate || 27000)
);

const usd = (x) =>
  new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(+x || 0);

const toUsd = React.useCallback((vnd) => {
  const rate = Number(exchangeRate);
  if (!Number.isFinite(rate) || rate <= 0) return 0;
  return (Number(vnd) || 0) / rate;
}, [exchangeRate]);

  // ====== Group filter (NHÓM HÀNG) ======
  const [selectedGroups] = React.useState(new Set());



  // ===== Helpers =====
  const norm = (s) => String(s || '').trim().toLowerCase();
  const phoneDigits = s => String(s||'').replace(/[^\d]/g,'').replace(/^84/, '0');
  const money = x => new Intl.NumberFormat('vi-VN').format(+x || 0);
  // Đọc membersMap theo code (hỗ trợ Object hoặc Map)
const getMemberByCode = (map, code) => {
  if (!code) return null;
  const k = String(code).trim();
  if (!map) return null;
  if (typeof map.get === 'function') return map.get(k) || null; // Map
  return map[k] || map[String(k)] || null;                      // Object
};

const isoRange = React.useMemo(() => {
  const BUSINESS_HOUR = 6;
  const DAY_MS = 24 * 60 * 60 * 1000;

  const startAtBusinessHour = (d) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate(), BUSINESS_HOUR, 0, 0, 0);

  const endFromStart = (start, days = 1) =>
    new Date(start.getTime() + days * DAY_MS - 1);

  const shiftForBusinessDay = (d) =>
    new Date(d.getTime() - BUSINESS_HOUR * 60 * 60 * 1000);

  const parseYmd = (ymd) => {
    const [y, m, d] = String(ymd || '').split('-').map(Number);
    if (!y || !m || !d) return null;
    return new Date(y, m - 1, d);
  };

  const getBusinessWeekStart = (d) => {
    const shifted = shiftForBusinessDay(d);
    const base = new Date(shifted.getFullYear(), shifted.getMonth(), shifted.getDate());
    const dow = (base.getDay() + 6) % 7; // Monday = 0
    base.setDate(base.getDate() - dow);
    return startAtBusinessHour(base);
  };

  const getBusinessMonthStart = (d) => {
    const shifted = shiftForBusinessDay(d);
    return new Date(shifted.getFullYear(), shifted.getMonth(), 1, BUSINESS_HOUR, 0, 0, 0);
  };

  const getBusinessYearStart = (d) => {
    const shifted = shiftForBusinessDay(d);
    return new Date(shifted.getFullYear(), 0, 1, BUSINESS_HOUR, 0, 0, 0);
  };

  const now = new Date();
  const shiftedNow = shiftForBusinessDay(now);

  let from;
  let to;

  switch (preset) {
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
    case 'thisWeek': {
      from = getBusinessWeekStart(now);
      to = endFromStart(from, 7);
      break;
    }
    case 'lastWeek': {
      const thisWeekStart = getBusinessWeekStart(now);
      from = new Date(thisWeekStart.getTime() - 7 * DAY_MS);
      to = new Date(thisWeekStart.getTime() - 1);
      break;
    }
    case 'thisMonth': {
      from = getBusinessMonthStart(now);
      const shifted = shiftForBusinessDay(now);
      const nextMonthStart = new Date(
        shifted.getFullYear(),
        shifted.getMonth() + 1,
        1,
        BUSINESS_HOUR, 0, 0, 0
      );
      to = new Date(nextMonthStart.getTime() - 1);
      break;
    }
    case 'lastMonth': {
      const shifted = shiftForBusinessDay(now);
      from = new Date(
        shifted.getFullYear(),
        shifted.getMonth() - 1,
        1,
        BUSINESS_HOUR, 0, 0, 0
      );
      const thisMonthStart = new Date(
        shifted.getFullYear(),
        shifted.getMonth(),
        1,
        BUSINESS_HOUR, 0, 0, 0
      );
      to = new Date(thisMonthStart.getTime() - 1);
      break;
    }
    case 'thisYear': {
      from = getBusinessYearStart(now);
      const shifted = shiftForBusinessDay(now);
      const nextYearStart = new Date(
        shifted.getFullYear() + 1,
        0,
        1,
        BUSINESS_HOUR, 0, 0, 0
      );
      to = new Date(nextYearStart.getTime() - 1);
      break;
    }
    case 'lastYear': {
      const shifted = shiftForBusinessDay(now);
      from = new Date(shifted.getFullYear() - 1, 0, 1, BUSINESS_HOUR, 0, 0, 0);
      const thisYearStart = new Date(shifted.getFullYear(), 0, 1, BUSINESS_HOUR, 0, 0, 0);
      to = new Date(thisYearStart.getTime() - 1);
      break;
    }
    case 'custom': {
      const fromBase = parseYmd(fromDate);
      const toBase = parseYmd(toDate);

      from = fromBase ? startAtBusinessHour(fromBase) : undefined;
      to = toBase ? endFromStart(startAtBusinessHour(toBase), 1) : undefined;
      break;
    }
    default: {
      from = startAtBusinessHour(shiftedNow);
      to = endFromStart(from, 1);
      break;
    }
  }

  return {
    from: from ? from.toISOString() : undefined,
    to: to ? to.toISOString() : undefined,
  };
}, [preset, fromDate, toDate]);

  // ====== Maps from /api/products ======
  const [nameMap, setNameMap] = React.useState(new Map());   // imageKey -> product.name
  const [groupMap, setGroupMap] = React.useState(new Map()); // imageKey -> itemGroup
  const [codeMap, setCodeMap] = React.useState(new Map());   // imageKey -> productCode
  const [priceMap, setPriceMap] = React.useState(new Map()); // img:/code:/name: -> price

const keyFrom = (imageUrl, imageName, fallbackName = '', imageKey = '') => {
  // Ưu tiên key ảnh để join products/foods đúng, kể cả order cũ chỉ có imageKey.
  const pick = imageUrl || imageName || imageKey || fallbackName || '';
  return (String(pick).split('/').pop() || '').trim().toLowerCase();
};

const cleanImageNameForReport = (value) => {
  let s = String(value || '').split('/').pop() || '';

  // Bỏ đuôi file
  s = s.replace(/\.[A-Za-z0-9]{2,5}(\?.*)?$/i, '');

  // Bỏ timestamp cuối tên file:
  // strawberry smoothie-1763843415030 -> strawberry smoothie
  s = s.replace(/[-_\s]+\d{10,17}$/g, '');

  s = s
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return s ? s.toUpperCase() : '';
};

const resolveItemName = React.useCallback((item) => {
  // Ưu tiên tên snapshot đã lưu trong order.
  // Không lấy imageName trước name vì order cũ có imageName dạng:
  // strawberry smoothie-1763843415030.jpg
  const directName = String(item?.name || item?.productName || '').trim();

  if (directName) {
    return directName.toUpperCase();
  }

  const pick = item?.imageUrl || item?.imageName || item?.imageKey || '';
  const k = (String(pick).split('/').pop() || '').trim().toLowerCase();

  const mappedName = nameMap.get(k);
  if (mappedName) {
    return String(mappedName).toUpperCase();
  }

  return (
    cleanImageNameForReport(item?.imageName || item?.imageKey || pick) ||
    '(Không rõ tên)'
  );
}, [nameMap]);

const resolveItemCode = React.useCallback((item) => {
  const pick = item?.imageName || item?.imageKey ||
               item?.imageUrl || item?.name || '';
  const k = (String(pick).split('/').pop() || '').trim().toLowerCase();

  // Ưu tiên mapping từ products
  if (codeMap.has(k)) return codeMap.get(k);

  // fallback
  return item?.productCode || item?.code || item?.sku || item?.itemCode || '';
}, [codeMap]);



  const deriveItemGroup = React.useCallback((item, k) => {
    const g = item?.itemGroup ?? item?.group ?? groupMap.get(k) ?? '';
    return g || '(Chưa có nhóm)';
  }, [groupMap]);

  const buildMaps = React.useCallback(async () => {
    try {
      const pr = await axios.get(apiUrl('/api/products'), { params: { limit: 70000 } });
      const rows = Array.isArray(pr.data?.rows) ? pr.data.rows : (Array.isArray(pr.data) ? pr.data : []);

      const _name  = new Map();
      const _group = new Map();
      const _code  = new Map();
      const _price = new Map();

      for (const p of rows) {
        const k = keyFrom(p?.imageUrl, p?.imageName, p?.name);
        if (!k) continue;

        if (p?.name) _name.set(k, p.name);
        _group.set(k, (p?.itemGroup ?? '').trim());

 // Ưu tiên productCode giống màn Hàng hóa
      const codeVal = p?.productCode || p?.code || p?.sku || p?.itemCode || '';
      if (codeVal) _code.set(k, String(codeVal));

        const price = Number(p?.price);
        if (Number.isFinite(price) && price > 0) {
          _price.set(`img:${k}`, price);
          const codeKey = norm(p?.productCode ?? p?.code ?? p?.sku ?? p?.itemCode);
          if (codeKey) _price.set(`code:${codeKey}`, price);
          const nm = norm(p?.name);
          if (nm) _price.set(`name:${nm}`, price);
        }
      }

      setNameMap(_name); setGroupMap(_group); setCodeMap(_code); setPriceMap(_price);
    } catch (e) {
      console.warn('buildMaps fail:', e?.message || e);
      setNameMap(new Map()); setGroupMap(new Map()); setCodeMap(new Map()); setPriceMap(new Map());
    }
  }, [apiUrl]);

  React.useEffect(() => { buildMaps(); }, [buildMaps]);

  // ====== Customers index (JOIN để lấy Level) ======
  const [custIndex, setCustIndex] = React.useState(new Map());

  const splitNameAndTrailingCode = (name) => {
    const raw = (name ?? '').trim();
    const m = raw.match(/^(.*?)[-#(]\s*(\d{2,})\s*\)?\s*$/);
    if (m) return { baseName: m[1].trim(), code: m[2] };
    return { baseName: raw, code: '' };
  };

  const normalizeLevel = (lv) => {
    if (!lv) return '';
    const upper = String(lv).trim().toUpperCase();
    const map = { 'P':'P','I':'I','I+':'I+','V':'V','ONE':'One','ONE+':'One+','EC':'EC' };
    return map[upper] ?? lv;
  };

  const fetchCustomersAll = React.useCallback(async () => {
    const tryGet = async (url) => {
      try { const r = await axios.get(apiUrl(url), { params: { limit: 70000 } }); return r.data; }
      catch { return null; }
    };
    return (await tryGet('/api/customers'))
        || (await tryGet('/api/members'))
        || (await tryGet('/api/clients'))
        || [];
  }, [apiUrl]);

  const buildCustomerIndex = React.useCallback(async () => {
    const data = await fetchCustomersAll();
    const arr  = Array.isArray(data?.rows) ? data.rows
               : Array.isArray(data?.items) ? data.items
               : Array.isArray(data) ? data : [];
               // Đếm số lần xuất hiện baseName để tránh key name:<base> bị trùng
const baseNameCount = new Map();
for (const c of arr) {
  const n = (c.name ?? c.customerName ?? '').toString().trim();
  if (!n) continue;
  const m = n.match(/^(.*?)[-#(]\s*(\d{2,})\s*\)?\s*$/);
  const base = (m ? m[1] : n).trim();
  if (!base) continue;
  const k = `name:${(base).toLowerCase()}`;
  baseNameCount.set(k, (baseNameCount.get(k) || 0) + 1);
}

    const idx = new Map();

    for (const c of arr) {
      const id    = c.id ?? '';
      const code  = (c.code ?? c.customerCode ?? '').toString().trim();
      const name  = (c.name ?? c.customerName ?? '').toString().trim();
      const phone = (c.phone ?? c.customerPhone ?? '').toString().trim();
      const email = (c.email ?? c.customerEmail ?? '').toString().trim();
      const level = normalizeLevel(c.level ?? c.memberLevel ?? c.tier ?? '');

      const obj = { code, name, level };

      if (id)      idx.set(`id:${norm(id)}`, obj);
      if (code)    idx.set(`code:${norm(code)}`, obj);
      if (phone)   idx.set(`phone:${norm(phone)}`, obj);
      if (phone)   idx.set(`phoned:${phoneDigits(phone)}`, obj);
      if (email)   idx.set(`email:${norm(email)}`, obj);
      if (name)    idx.set(`name:${norm(name)}`, obj);

      
if (name) {
  // Index theo full name
  idx.set(`name:${norm(name)}`, obj);

  // Bóc mã ở đuôi tên (ví dụ: "Nguyễn A - 10767") để index theo code
  const { baseName, code: tail } = splitNameAndTrailingCode(name);
  if (tail) {
    const codeKey = `code:${norm(tail)}`;
    if (!idx.has(codeKey)) idx.set(codeKey, obj);
  }

  // Nếu baseName không mơ hồ (chỉ xuất hiện 1 lần) thì index thêm theo baseName
  if (baseName) {
    const k = `name:${norm(baseName)}`;
    if ((baseNameCount.get(k) || 0) === 1 && !idx.has(k)) {
      idx.set(k, obj);
    }
  }
}


    }
        // +++ Fallback từ members.json: đưa vào index theo code
    try {
      (Object.values(membersMap || {})).forEach(m => {
        const code = (m?.code || '').toString().trim();
        if (!code) return;
        const obj = {
          code,
          name: (m?.name || '').toString().trim(),
          level: normalizeLevel(m?.level || '')
        };
        // chỉ add nếu chưa có trong idx
        const key = `code:${code.toLowerCase()}`;
        if (!idx.has(key)) idx.set(key, obj);
      });
    } catch {}

    setCustIndex(idx);
}, [fetchCustomersAll, membersMap]);

  React.useEffect(() => {
  const t = setTimeout(() => { buildCustomerIndex(); }, 800);
  return () => clearTimeout(t);
}, [buildCustomerIndex]);


  // ====== Report type ======
  // hanghoa_mon | hanghoa_nhom | hanghoa_ban | khachhang_tomtat | khachhang_chitiet
const [reportType, setReportType] = React.useState(
  reportUi.reportType || 'orders_detail'
);
  const [loading, setLoading] = React.useState(false);
  const [reportData, setReportData] = React.useState(null);
React.useEffect(() => {
  localStorage.setItem(
    REPORT_UI_KEY,
    JSON.stringify({
      preset,
      fromDate,
      toDate,
      exchangeRate,
      reportType,
    })
  );
}, [preset, fromDate, toDate, exchangeRate, reportType]);
  // ====== Core builders ======
  const getLineRevenue = React.useCallback((it) => {
    const qty = Number(it?.qty) || 0;

    // total line available?
    const line = [it?.total, it?.amount, it?.lineTotal]
      .map(v => Number(v)).find(v => Number.isFinite(v));
    if (Number.isFinite(line)) return { qty, revenue: line };

    // unit price available?
    const unit = [it?.price, it?.unitPrice, it?.unit_price, it?.pricePerUnit, it?.p]
      .map(v => Number(v)).find(v => Number.isFinite(v));
    if (Number.isFinite(unit)) return { qty, revenue: unit * qty };

    // fallback → priceMap
    const imgKey = keyFrom(it?.imageUrl, it?.imageName, it?.name);
    const byImg  = priceMap.get(`img:${imgKey}`);
    if (Number.isFinite(byImg)) return { qty, revenue: byImg * qty };

    const codeKey = norm(it?.productCode || it?.code || it?.sku);
    if (codeKey) {
      const byCode = priceMap.get(`code:${codeKey}`);
      if (Number.isFinite(byCode)) return { qty, revenue: byCode * qty };
    }

    const nameKey = norm(resolveItemName(it));
    if (nameKey) {
      const byName = priceMap.get(`name:${nameKey}`);
      if (Number.isFinite(byName)) return { qty, revenue: byName * qty };
    }

    return { qty, revenue: 0 };
  }, [priceMap, resolveItemName]);

// ===== Helpers để lấy MÃ KH từ order (chỉ để JOIN) =====
const extractCustomerCode = (o) => {
  // Ưu tiên các trường code/card trong order
  const pick = (...arr) => arr.find(v => v !== undefined && v !== null && String(v).trim() !== '');
  const raw = pick(o?.customer?.code, o?.customerCode, o?.memberCard, o?.card, o?.customer?.card);
  if (raw) return String(raw).trim();

  // Fallback duy nhất: lấy mã từ đuôi tên (nếu có định dạng "Tên - 12345")
  const name0 = pick(o?.customer?.name, o?.customerName);
  if (name0) {
    const m = String(name0).trim().match(/(\d{2,})\s*\)?\s*$/);
    if (m) return String(m[1]).trim();
  }
  return '';
};

// JOIN CHỈ THEO MÃ KH; Tên + Level lấy từ bảng Khách hàng (hoặc membersMap fallback)
const lookupCustomerByCode = React.useCallback((o) => {
  const code = extractCustomerCode(o);
  if (!code) return { code: '', name: '', level: '' };

  const k = `code:${code.toLowerCase()}`;
  const fromApi = custIndex.get(k) || null;                  // index build từ /api/customers|/api/members
  const fromFallback = getMemberByCode(membersMap, code) || null; // fallback từ membersMap nếu có

  const src = fromApi || fromFallback;
  return {
    code,
    name: (src?.name || '').toString(),
    level: normalizeLevel(src?.level || ''),
  };
}, [custIndex, membersMap]);



  const buildReport = React.useCallback((orders, type) => {
    const gset = (selectedGroups instanceof Set) ? selectedGroups : new Set();
    const out = { totalOrders: 0, totalRevenue: 0 };
    if (!Array.isArray(orders) || orders.length === 0) return out;

    const acceptedOrderIds = new Set();

    if (type === 'hanghoa_mon') {
      const by = new Map(); // key -> {name, code, qty, revenue}
      for (const o of orders) {
        let hit = false;
        for (const it of (o.items || [])) {
          const k = keyFrom(it?.imageUrl, it?.imageName, it?.name, it?.imageKey);
          const g = deriveItemGroup(it, k);
          if (gset.size && !gset.has(g)) continue;

          hit = true;
          const name = resolveItemName(it);
          const code = resolveItemCode(it);
          const { qty, revenue } = getLineRevenue(it);
          out.totalRevenue += revenue;

          if (!by.has(k)) by.set(k, { name, code, qty: 0, revenue: 0 });
          const row = by.get(k);
          row.qty += qty; row.revenue += revenue;
        }
        if (hit) acceptedOrderIds.add(o.id || o._id || JSON.stringify(o));
      }
      out.totalOrders = acceptedOrderIds.size;
      out.rows = Array.from(by.values());
      return out;
    }

    if (type === 'hanghoa_nhom') {
      const by = new Map(); // group -> {qty, revenue}
      for (const o of orders) {
        let hit = false;
        for (const it of (o.items || [])) {
          const k = keyFrom(it?.imageUrl, it?.imageName, it?.name, it?.imageKey);
          const g = deriveItemGroup(it, k);
          if (gset.size && !gset.has(g)) continue;

          hit = true;
          const { qty, revenue } = getLineRevenue(it);
          out.totalRevenue += revenue;

          if (!by.has(g)) by.set(g, { qty: 0, revenue: 0 });
          const row = by.get(g);
          row.qty += qty; row.revenue += revenue;
        }
        if (hit) acceptedOrderIds.add(o.id || o._id || JSON.stringify(o));
      }
      out.totalOrders = acceptedOrderIds.size;
      out.rows = Array.from(by, ([group, v]) => ({ group, qty: v.qty, revenue: v.revenue }));
      return out;
    }

    if (type === 'hanghoa_ban') {
      const by = new Map(); // table -> {qty, revenue}
      for (const o of orders) {
        const table = [o?.area, o?.tableNo].filter(Boolean).join('-') || '(Không rõ bàn)';
        let hit = false;
        let sumQty = 0, sumRev = 0;
        for (const it of (o.items || [])) {
          const k = keyFrom(it?.imageUrl, it?.imageName, it?.name, it?.imageKey);
          const g = deriveItemGroup(it, k);
          if (gset.size && !gset.has(g)) continue;

          hit = true;
          const { qty, revenue } = getLineRevenue(it);
          sumQty += qty; sumRev += revenue; out.totalRevenue += revenue;
        }
        if (sumQty || sumRev) {
          if (!by.has(table)) by.set(table, { qty: 0, revenue: 0 });
          const row = by.get(table); row.qty += sumQty; row.revenue += sumRev;
        }
        if (hit) acceptedOrderIds.add(o.id || o._id || JSON.stringify(o));
      }
      out.totalOrders = acceptedOrderIds.size;
      out.rows = Array.from(by, ([table, v]) => ({ table, qty: v.qty, revenue: v.revenue }));
      return out;
    }
// === Đơn hàng chi tiết ===
if (type === 'orders_detail') {
  const norm = (s) => String(s || '').trim().toLowerCase();
  const out = { totalOrders: 0, totalRevenue: 0, totalRevenueUSD: 0, rows: [] };
  const acceptedOrderIds = new Set();

  for (const o of orders) {
    let orderSum = 0;
    const orderId = o?.id || o?.orderId || '';
    const staffId = o?.staff || '';
    const staffName = staffId ? (staffMap[staffId] || '') : '';
    const dateTime = o?.createdAt || '';
    const table = [o?.area, o?.tableNo].filter(Boolean).join('-') || '(Không rõ bàn)';
    const customerInfo = lookupCustomerByCode(o) || {};
    const memberCode = customerInfo.code || '';
    const memberName = customerInfo.name || '';

    for (const it of (o.items || [])) {
      const k = keyFrom(it?.imageUrl, it?.imageName, it?.name, it?.imageKey);
      const code = resolveItemCode(it);
      const name = resolveItemName(it);
      const group = deriveItemGroup(it, k);

      const types = new Set();
      for (const key of foodsIndex.keys()) {
        const parts = String(key).split('|');
        if (parts.length === 2 && parts[1] === k) types.add(parts[0]);
      }

      const menuSet = menusOfImage.get(k) || new Set();
      const categoryParts = new Set();
      if (group) categoryParts.add(group);
      types.forEach(t => { if (t) categoryParts.add(t); });
      menuSet.forEach(m => { if (m) categoryParts.add(m); });
      const category = Array.from(categoryParts).join(', ');

      const qty = Number(it?.qty || 0);

      let price = Number(it?.price || 0);
      if (!price && priceMap) {
        const pImg  = priceMap.get(`img:${k}`);
        const pCode = priceMap.get(`code:${norm(code)}`);
        const pName = priceMap.get(`name:${norm(name)}`);
        price = pImg || pCode || pName || 0;
      }

      orderSum += qty * price;

      let dateTimeText = '';
      if (dateTime) {
        const dtObj = new Date(dateTime);
        const day = String(dtObj.getDate()).padStart(2, '0');
        const month = String(dtObj.getMonth() + 1).padStart(2, '0');
        const year = dtObj.getFullYear();
        const hours = String(dtObj.getHours()).padStart(2, '0');
        const minutes = String(dtObj.getMinutes()).padStart(2, '0');
        dateTimeText = `${day}/${month}/${year} ${hours}:${minutes}`;
      }

      out.rows.push({
        orderId,
        staffId,
        staffName,
        code,
        name,
        category,
        memberCode,
        memberName,
        qty,
        price,
        priceUSD: toUsd(price),
        dateTime: dateTimeText,
        table
      });
    }

    if (orderSum) {
      acceptedOrderIds.add(o.id || o._id || JSON.stringify(o));
      out.totalRevenue += orderSum;
    }
  }

  out.totalOrders = acceptedOrderIds.size;
  out.totalRevenueUSD = toUsd(out.totalRevenue);
  return out;
}
if (type === 'khachhang_tomtat' || type === 'khachhang_chitiet') {
  const cust = new Map(); // key = code:<MÃ>, hoặc fallback unique theo order nếu không có mã
  for (const o of orders) {
    let hit = false;

    // Lấy thông tin CHỈ-TỪ-MÃ
    const info = lookupCustomerByCode(o);

    // Key group: chỉ theo MÃ KH; nếu không có mã thì tách riêng từng order để không trộn sai
    const key = info.code
      ? `code:${norm(info.code)}`
      : (o.id || o._id ? `order:${o.id || o._id}` : `order:${JSON.stringify(o)}`);

    // Tạo bucket với TÊN và LEVEL LẤY TỪ BẢNG KHÁCH HÀNG (không lấy từ order)
    if (!cust.has(key)) {
      cust.set(key, {
        id: key,
        code: info.code || '',
        name: info.name || '',
        level: info.level || '',
        qty: 0,
        revenue: 0,
        items: new Map(),
      });
    }
    const bucket = cust.get(key);

    // level chuẩn hóa — luôn ưu tiên từ bảng khách hàng
    if (info.level && info.level !== bucket.level) bucket.level = info.level;

    // Cộng dồn món
    for (const it of (o.items || [])) {
      const k = keyFrom(it?.imageUrl, it?.imageName, it?.name, it?.imageKey);
      const g = deriveItemGroup(it, k);

      // Lọc theo nhóm hàng nếu có
      if (selectedGroups.size && !selectedGroups.has(g)) continue;

      hit = true;
      const name = resolveItemName(it);
      const { qty, revenue } = getLineRevenue(it);

      bucket.qty += qty;
      bucket.revenue += revenue;
      out.totalRevenue += revenue;

      if (!bucket.items.has(name)) bucket.items.set(name, { qty: 0, revenue: 0 });
      const irow = bucket.items.get(name);
      irow.qty += qty;
      irow.revenue += revenue;
    }

    if (hit) acceptedOrderIds.add(o.id || o._id || JSON.stringify(o));
  }

  out.totalOrders = acceptedOrderIds.size;

  if (type === 'khachhang_tomtat') {
    out.rows = Array.from(cust.values()).map(v => ({
      id: v.id, code: v.code, name: v.name, level: v.level, qty: v.qty, revenue: v.revenue
    }));
  } else {
    out.customers = Array.from(cust.values()).map(v => ({
      ...v,
      items: Array.from(v.items, ([n, val]) => ({ name: n, qty: val.qty, revenue: val.revenue })),
    }));
  }
  return out;
}


    return out;
  }, [
  selectedGroups,
  deriveItemGroup,
  resolveItemName,
  resolveItemCode,
  getLineRevenue,
  lookupCustomerByCode,
  menusOfImage,
  foodsIndex,
  priceMap,
  staffMap,
  toUsd,
]);

  // ====== Fetch orders & build report ======
// thêm state cache orders ở trên:
const [reportOrders, setReportOrders] = React.useState([]); // đặt ngay dưới reportData

// eslint-disable-next-line react-hooks/exhaustive-deps
const fetchReport = React.useCallback(async () => {
  setLoading(true);
  try {
    const r = await axios.get(apiUrl('/api/orders'), {
      params: {
        status: 'DONE',
        from: isoRange.from,
        to: isoRange.to,
      },
    });

    const orders = Array.isArray(r.data) ? r.data : [];
    setReportOrders(orders);
    setReportData(buildReport(orders, reportType));
  } catch (e) {
    alert('Không tải được báo cáo: ' + (e?.response?.data?.error || e?.message || ''));
    setReportData(null);
  } finally {
    setLoading(false);
  }
}, [apiUrl, isoRange.from, isoRange.to, buildReport, reportType]);

// === Guard: tránh bắn request chồng nhau ===
const reportBusyRef = React.useRef(false);

const safeFetchReport = React.useCallback(async () => {
  if (reportBusyRef.current) return;     // đang bận thì bỏ qua
  reportBusyRef.current = true;
  try {
    await fetchReport();                  // gọi hàm fetchReport có sẵn
  } finally {
    reportBusyRef.current = false;
  }
}, [fetchReport]);

// Khi maps (codeMap, groupMap, nameMap...) hoặc bộ lọc nhóm đổi,
// buildReport sẽ đổi -> ta chỉ build lại từ reportOrders, KHÔNG gọi API nữa.
React.useEffect(() => {
  if (!reportOrders || reportOrders.length === 0) return;
  setReportData(buildReport(reportOrders, reportType));
}, [buildReport, reportOrders, reportType]);


// Debounce nhẹ để gom thay đổi filter, đồng thời dùng guard để tránh overlap
React.useEffect(() => {
  const t = setTimeout(safeFetchReport, 120);
  return () => clearTimeout(t);
}, [safeFetchReport, isoRange.from, isoRange.to, reportType]);

  // ====== Export Excel (.xlsx) ======
  const exportReportXlsx = () => {
    if (!reportData) return;

    const rows = [];
    const push = (arr) => rows.push(arr);

const presetLabel = (() => {
  if (preset === 'custom') return `${fromDate || '…'} → ${toDate || '…'}`;
if (preset === 'today') return 'Hôm nay';
if (preset === 'yesterday') return 'Hôm qua';
if (preset === 'thisWeek') return 'Tuần này';
if (preset === 'lastWeek') return 'Tuần trước';
if (preset === 'thisMonth') return 'Tháng này';
if (preset === 'lastMonth') return 'Tháng trước';
if (preset === 'thisYear') return 'Năm nay';
if (preset === 'lastYear') return 'Năm trước';
  return preset;
})();

    const typeLabel = (() => {
      if (reportType === 'orders_detail') return 'BÁO CÁO ĐƠN HÀNG — CHI TIẾT';
      if (reportType === 'hanghoa_mon') return 'BÁO CÁO HÀNG HÓA — THEO MÓN';
      if (reportType === 'hanghoa_nhom') return 'BÁO CÁO HÀNG HÓA — THEO NHÓM HÀNG';
      if (reportType === 'hanghoa_ban') return 'BÁO CÁO HÀNG HÓA — THEO BÀN';
      if (reportType === 'khachhang_tomtat') return 'BÁO CÁO KHÁCH HÀNG — HÀNG BÁN THEO KHÁCH';
      if (reportType === 'khachhang_chitiet') return 'BÁO CÁO KHÁCH HÀNG — CHI TIẾT KHÁCH ORDER';
      return reportType || '';
    })();

    // Thông tin header
    push([typeLabel]);
    push([`Khoảng thời gian: ${presetLabel}`]);
    push([]);

    if (reportType === 'hanghoa_mon') {
      push(['Tên món', 'Mã món', 'Nhóm hàng', 'Số lượng', 'Doanh thu']);
      (reportData.rows || []).forEach(r =>
        push([r.name, r.code, r.group, r.qty, r.revenue])
      );
    } else if (reportType === 'hanghoa_nhom') {
      push(['Nhóm hàng', 'Số lượng món', 'Doanh thu']);
      (reportData.rows || []).forEach(r =>
        push([r.group, r.qty, r.revenue])
      );
    } else if (reportType === 'hanghoa_ban') {
      push(['Bàn', 'Số lượng món', 'Doanh thu']);
      (reportData.rows || []).forEach(r =>
        push([r.table, r.qty, r.revenue])
      );
    } else if (reportType === 'khachhang_tomtat') {
      push(['Mã khách hàng', 'Tên khách hàng', 'Level', 'Số lượng món đã order', 'Tổng doanh thu']);
      (reportData.rows || []).forEach(r =>
        push([r.code, r.name, r.level, r.qty, r.revenue])
      );
    } else if (reportType === 'khachhang_chitiet') {
      push(['Mã KH', 'Tên KH', 'Level', 'Món', 'Số lượng', 'Doanh thu món']);
      (reportData.customers || []).forEach(c => {
        if (!c.items || c.items.length === 0) {
          push([c.code, c.name, c.level, '', 0, 0]);
        } else {
          c.items.forEach(it =>
            push([c.code, c.name, c.level, it.name, it.qty, it.revenue])
          );
        }
      });
} else if (reportType === 'orders_detail') {
  push([`Tỷ giá USD: ${Number(exchangeRate || 0).toLocaleString('vi-VN')}`]);
  push([]);

  push([
    'Mã order',
    'Mã nhân viên',
    'Tên nhân viên',
    'Mã món',
    'Tên món',
    'Menu Category',
    'Mã khách hàng',
    'Tên khách hàng',
    'Số lượng',
    'Giá',
    'Giá USD',
    'Ngày giờ',
    'Bàn'
  ]);

  (reportData.rows || []).forEach(r =>
    push([
      r.orderId,
      r.staffId,
      r.staffName,
      r.code,
      r.name,
      r.category,
      r.memberCode,
      r.memberName,
      r.qty,
      r.price,
      r.priceUSD,
      r.dateTime,
      r.table
    ])
  );

  push([]);
  push(['Tổng doanh thu (VND)', reportData.totalRevenue || 0]);
  push(['Tổng doanh thu (USD)', reportData.totalRevenueUSD || 0]);
}

    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Report');

    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([wbout], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `report-${reportType}-${Date.now()}.xlsx`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };


const pageStyle = {
  maxWidth: 1500,
  margin: '0 auto',
  background: '#fff',
  border: '1px solid #e5e7eb',
  borderRadius: 12,
  boxShadow: '0 10px 36px rgba(0,0,0,0.08)',
};
const ordersDetailWrapStyle = {
  width: '100%',
  overflowX: 'auto',
};

const ordersDetailTableStyle = {
  width: '100%',
  minWidth: 1480,
  borderCollapse: 'collapse',
  tableLayout: 'fixed',
};

const ordersDetailThStyle = {
  padding: '10px 8px',
  background: '#f8fafc',
  border: '1px solid #d1d5db',
  textAlign: 'center',
  whiteSpace: 'nowrap',
  fontWeight: 700,
  fontSize: 13,
};

const ordersDetailTdStyle = {
  padding: '10px 8px',
  border: '1px solid #e5e7eb',
  verticalAlign: 'top',
  fontSize: 13,
  lineHeight: 1.35,
  wordBreak: 'break-word',
};

const ordersDetailTdNowrapStyle = {
  ...ordersDetailTdStyle,
  whiteSpace: 'nowrap',
  wordBreak: 'normal',
};

const ordersDetailTdCenterStyle = {
  ...ordersDetailTdNowrapStyle,
  textAlign: 'center',
};

const ordersDetailTdRightStyle = {
  ...ordersDetailTdNowrapStyle,
  textAlign: 'right',
};  
  const handlePrint = () => {
    const container = document.getElementById('report-print-area');
    if (!container) {
      window.print();
      return;
    }
    const printContents = container.innerHTML;
    const printWindow = window.open('', '', 'height=800,width=1000');
    if (!printWindow) {
      window.print();
      return;
    }
    printWindow.document.write('<html><head><title>Báo cáo</title>');
    // copy CSS hiện tại sang cửa sổ in
    const styles = Array.from(document.querySelectorAll('style, link[rel="stylesheet"]'));
    styles.forEach((node) => {
      printWindow.document.write(node.outerHTML);
    });
    printWindow.document.write('</head><body>');
    printWindow.document.write(printContents);
    printWindow.document.write('</body></html>');
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
    printWindow.close();
  };


  return (
    <div style={{ padding: 16 }}>
      {/* Toolbar */}
      <div style={{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'center', marginBottom:12 }}>
<select value={reportType} onChange={e => setReportType(e.target.value)}>
  <optgroup label="Hàng hóa">
    <option value="hanghoa_mon">Theo Món</option>
    <option value="hanghoa_nhom">Theo Nhóm hàng</option>
    <option value="hanghoa_ban">Theo Bàn</option>
  </optgroup>
  <optgroup label="Khách hàng">
    <option value="khachhang_tomtat">Hàng bán theo khách (tổng hợp)</option>
    <option value="khachhang_chitiet">Khách order (chi tiết)</option>
  </optgroup>
  {/* New: Chi tiết đơn hàng */}
  <optgroup label="Đơn hàng">
    <option value="orders_detail">Đơn hàng chi tiết</option>
  </optgroup>
</select>

<select value={preset} onChange={e => setPreset(e.target.value)}>
  <option value="today">Hôm nay</option>
  <option value="yesterday">Hôm qua</option>
  <option value="thisWeek">Tuần này</option>
  <option value="lastWeek">Tuần trước</option>
  <option value="thisMonth">Tháng này</option>
  <option value="lastMonth">Tháng trước</option>
  <option value="thisYear">Năm nay</option>
  <option value="lastYear">Năm trước</option>
  <option value="custom">Tùy chọn…</option>
</select>

        {preset === 'custom' && (
          <>
            <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} />
            <span>→</span>
            <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} />
          </>
        )}

{reportType === 'orders_detail' && (
  <div style={{ display:'flex', alignItems:'center', gap:6 }}>
    <span>Tỷ giá USD</span>
    <input
      type="number"
      min="1"
      step="1"
      value={exchangeRate}
      onChange={(e) => setExchangeRate(e.target.value)}
      placeholder="Nhập tỷ giá"
      style={{ width: 120 }}
    />
  </div>
)}
<button onClick={safeFetchReport} disabled={loading}>
  {loading ? 'Đang tải…' : 'Xem báo cáo'}
</button>
<button onClick={exportReportXlsx} disabled={loading}>Export Excel</button>
<button onClick={handlePrint} title="In / Lưu PDF">In</button>

      </div>

      {/* Khung như trang PDF */}
      <div id="report-print-area" style={pageStyle}>
        <div style={{ padding: '18px 20px', borderBottom: '1px solid #f1f5f9' }}>
          <div style={{ fontSize: 18, fontWeight: 800 }}>
            {reportType === 'orders_detail' && 'BÁO CÁO ĐƠN HÀNG — CHI TIẾT'}
            {reportType === 'hanghoa_mon' && 'BÁO CÁO HÀNG HÓA — THEO MÓN'}
            {reportType === 'hanghoa_nhom' && 'BÁO CÁO HÀNG HÓA — THEO NHÓM HÀNG'}
            {reportType === 'hanghoa_ban' && 'BÁO CÁO HÀNG HÓA — THEO BÀN'}
            {reportType === 'khachhang_tomtat' && 'BÁO CÁO KHÁCH HÀNG — HÀNG BÁN THEO KHÁCH'}
            {reportType === 'khachhang_chitiet' && 'BÁO CÁO KHÁCH HÀNG — CHI TIẾT KHÁCH ORDER'}
          </div>
<div style={{ display:'flex', gap:16, flexWrap:'wrap', marginTop:8, fontSize:13 }}>
  <div><b>Tổng đơn:</b> {reportData?.totalOrders || 0}</div>
  <div><b>Tổng doanh thu (VND):</b> {money(reportData?.totalRevenue || 0)}</div>

  {reportType === 'orders_detail' && (
    <>
      <div><b>Tỷ giá USD:</b> {Number(exchangeRate || 0).toLocaleString('vi-VN')}</div>
      <div><b>Tổng doanh thu (USD):</b> {usd(reportData?.totalRevenueUSD || 0)}</div>
    </>
  )}
</div>
        </div>

        <div style={{ padding: 16 }}>
          {loading && <div>Đang tải dữ liệu…</div>}

          {/* === Theo món === */}
          {!loading && reportType === 'hanghoa_mon' && (
            (() => {
              const rows = (reportData?.rows || [])
                .slice()
                .sort((a,b)=> (b.revenue||0)-(a.revenue||0));
              return rows.length === 0 ? (
                <div style={{ color:'#6b7280' }}>Không có dữ liệu.</div>
              ) : (
                <table border="1" cellPadding="6" style={{ width:'100%', borderCollapse:'collapse' }}>
                  <thead>
                    <tr>
                      <th>Tên món</th>
                      <th>Mã món</th>
                      <th style={{ textAlign:'right' }}>Số lượng</th>
                      <th style={{ textAlign:'right' }}>Doanh thu</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, idx) => (
                      <tr key={r.code || r.name || idx}>
                        <td>{r.name}</td>
                        <td>{r.code}</td>
                        <td style={{ textAlign:'right' }}>{money(r.qty)}</td>
                        <td style={{ textAlign:'right' }}>{money(r.revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              );
            })()
          )}

          {/* === Theo nhóm hàng === */}
          {!loading && reportType === 'hanghoa_nhom' && (
            (() => {
              const rows = (reportData?.rows || []).slice().sort((a,b)=> (b.revenue||0)-(a.revenue||0));
              return rows.length === 0 ? <div style={{ color:'#6b7280' }}>Không có dữ liệu.</div> : (
                <table border="1" cellPadding="6" style={{ width:'100%', borderCollapse:'collapse' }}>
                  <thead><tr><th>Nhóm hàng</th><th style={{textAlign:'right'}}>Số lượng</th><th style={{textAlign:'right'}}>Doanh thu</th></tr></thead>
                  <tbody>
                    {rows.map(r => (
                      <tr key={r.group}>
                        <td>{r.group}</td>
                        <td style={{ textAlign:'right' }}>{money(r.qty)}</td>
                        <td style={{ textAlign:'right' }}>{money(r.revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              );
            })()
          )}

          {/* === Theo bàn === */}
          {!loading && reportType === 'hanghoa_ban' && (
            (() => {
              const rows = (reportData?.rows || []).slice().sort((a,b)=> (b.revenue||0)-(a.revenue||0));
              return rows.length === 0 ? <div style={{ color:'#6b7280' }}>Không có dữ liệu.</div> : (
                <table border="1" cellPadding="6" style={{ width:'100%', borderCollapse:'collapse' }}>
                  <thead><tr><th>Bàn</th><th style={{textAlign:'right'}}>Số lượng món</th><th style={{textAlign:'right'}}>Doanh thu</th></tr></thead>
                  <tbody>
                    {rows.map(r => (
                      <tr key={r.table}>
                        <td>{r.table}</td>
                        <td style={{ textAlign:'right' }}>{money(r.qty)}</td>
                        <td style={{ textAlign:'right' }}>{money(r.revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              );
            })()
          )}

          {/* === KH tổng hợp === */}
          {!loading && reportType === 'khachhang_tomtat' && (
            (() => {
              const rows = (reportData?.rows || []).slice().sort((a,b)=> (b.revenue||0)-(a.revenue||0));
              return rows.length === 0 ? <div style={{ color:'#6b7280' }}>Không có dữ liệu.</div> : (
                <table border="1" cellPadding="6" style={{ width:'100%', borderCollapse:'collapse' }}>
                  <thead>
                    <tr>
                      <th>Mã khách hàng</th>
                      <th>Tên khách hàng</th>
                      <th>Level</th>
                      <th style={{ textAlign:'right' }}>Số lượng món đã order</th>
                      <th style={{ textAlign:'right' }}>Tổng doanh thu</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(r => (
                      <tr key={r.id || r.code || r.name}>
                        <td>{r.code || ''}</td>
                        <td>{r.name || ''}</td>
                        <td>{r.level || ''}</td>
                        <td style={{ textAlign:'right' }}>{money(r.qty)}</td>
                        <td style={{ textAlign:'right' }}>{money(r.revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              );
            })()
          )}

          {/* === KH chi tiết === */}
          {!loading && reportType === 'khachhang_chitiet' && (
            (() => {
              const customers = Array.isArray(reportData?.customers) ? reportData.customers : [];
              if (customers.length === 0) return <div style={{ color:'#6b7280' }}>Không có dữ liệu.</div>;
              return (
                <div style={{ display:'grid', gap:16 }}>
                  {customers.map(c => (
                    <div key={c.id || c.code} style={{ border:'1px solid #e5e7eb', borderRadius:10 }}>
                      <div style={{ padding:10, background:'#f9fafb', borderBottom:'1px solid #e5e7eb' }}>
                        <b>{c.code || '(Chưa có mã)'}</b> — {c.name || '(không tên)'} &nbsp; | &nbsp; Level: {c.level || '—'}
                        <span style={{ float:'right' }}>Tổng SL: <b>{money(c.qty)}</b> · Doanh thu: <b>{money(c.revenue)}</b></span>
                      </div>
                      <div style={{ padding:10 }}>
                        {(!c.items || c.items.length === 0) ? (
                          <div style={{ color:'#6b7280' }}>(Chưa gọi món)</div>
                        ) : (
                          <table border="1" cellPadding="6" style={{ width:'100%', borderCollapse:'collapse' }}>
                            <thead><tr><th>Món</th><th style={{ textAlign:'right' }}>Số lượng</th><th style={{ textAlign:'right' }}>Doanh thu món</th></tr></thead>
                            <tbody>
                              {c.items.slice().sort((a,b)=> (b.revenue||0)-(a.revenue||0)).map(it => (
                                <tr key={it.name}>
                                  <td>{it.name}</td>
                                  <td style={{ textAlign:'right' }}>{money(it.qty)}</td>
                                  <td style={{ textAlign:'right' }}>{money(it.revenue)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              );
            })()
          )}
          {/* === Đơn hàng chi tiết === */}
{!loading && reportType === 'orders_detail' && (
  (() => {
    const rows = Array.isArray(reportData?.rows) ? reportData.rows : [];
    if (!rows || rows.length === 0) {
      return <div style={{ color:'#6b7280' }}>Không có dữ liệu.</div>;
    }

    return (
      <div style={ordersDetailWrapStyle}>
        <table style={ordersDetailTableStyle}>
          <colgroup>
            <col style={{ width: 80 }} />
            <col style={{ width: 90 }} />
            <col style={{ width: 120 }} />
            <col style={{ width: 80 }} />
            <col style={{ width: 180 }} />
            <col style={{ width: 130 }} />
            <col style={{ width: 90 }} />
            <col style={{ width: 160 }} />
            <col style={{ width: 70 }} />
            <col style={{ width: 95 }} />
            <col style={{ width: 95 }} />
            <col style={{ width: 150 }} />
            <col style={{ width: 110 }} />
          </colgroup>

          <thead>
            <tr>
              <th style={ordersDetailThStyle}>Mã order</th>
              <th style={ordersDetailThStyle}>Mã nhân viên</th>
              <th style={ordersDetailThStyle}>Tên nhân viên</th>
              <th style={ordersDetailThStyle}>Mã món</th>
              <th style={ordersDetailThStyle}>Tên món</th>
              <th style={ordersDetailThStyle}>Menu Category</th>
              <th style={ordersDetailThStyle}>Mã khách hàng</th>
              <th style={ordersDetailThStyle}>Tên khách hàng</th>
              <th style={ordersDetailThStyle}>Số lượng</th>
              <th style={ordersDetailThStyle}>Giá</th>
              <th style={ordersDetailThStyle}>Giá USD</th>
              <th style={ordersDetailThStyle}>Ngày giờ</th>
              <th style={ordersDetailThStyle}>Bàn</th>
            </tr>
          </thead>

          <tbody>
            {rows.map((r, idx) => (
              <tr key={`${r.orderId}-${r.code}-${idx}`}>
                <td style={ordersDetailTdCenterStyle}>{r.orderId}</td>
                <td style={ordersDetailTdCenterStyle}>{r.staffId}</td>
                <td style={ordersDetailTdNowrapStyle}>{r.staffName}</td>
                <td style={ordersDetailTdCenterStyle}>{r.code}</td>
                <td style={ordersDetailTdStyle}>{r.name}</td>
                <td style={ordersDetailTdStyle}>{r.category}</td>
                <td style={ordersDetailTdCenterStyle}>{r.memberCode}</td>
                <td style={ordersDetailTdStyle}>{r.memberName}</td>
                <td style={ordersDetailTdCenterStyle}>{r.qty}</td>
                <td style={ordersDetailTdRightStyle}>{money(r.price)}</td>
                <td style={ordersDetailTdRightStyle}>{usd(r.priceUSD)}</td>
                <td style={ordersDetailTdNowrapStyle}>{r.dateTime}</td>
                <td style={ordersDetailTdNowrapStyle}>{r.table}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  })()
)}
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

  function AddProduct({ itemGroups = [], typeOptions = ['đồ ăn', 'đồ uống', 'khác'], addType, existing = [], onDone, onCancel }) {
    const [saving, setSaving] = React.useState(false);
    const [form, setForm] = React.useState({
      imageName: '',
      imageUrl: '',
      name: '',
      productCode: '',
      menuType: 'đồ ăn',
      itemGroup: '',
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

    async function uploadNewImage(file) {
      if (!file) return;
      if (!form.itemGroup) {
        alert('Vui lòng chọn Nhóm hàng trước khi tải ảnh.');
        return;
      }
      const folder = SOURCE_FOLDER; // luôn lưu bản gốc vào SOURCE
      const fd = new FormData();
      fd.append('image', file);
      fd.append('type', folder);
      const r = await axios.post(apiUrl('/api/upload'), fd);
      const { imageUrl } = r.data || {};
      setForm(f => ({ ...f, imageUrl, imageName: imageUrl?.split('/').pop() || f.imageName }));
    }

    async function save(closeAfter = true) {
      if (!form.name?.trim()) return alert('Tên món là bắt buộc.');
      if (!form.productCode?.trim()) return alert('Mã món là bắt buộc.');
      if (nameExists) return alert('Tên món đã tồn tại. Vui lòng nhập tên khác.');
      if (codeExists) return alert('Mã món đã tồn tại. Vui lòng nhập mã khác.');
      if (!form.menuType) return alert('Chọn loại thực đơn.');
      if (!form.itemGroup) return alert('Chọn Nhóm hàng.');
      const price = Number(form.price);
      if (!Number.isFinite(price) || price <= 0) return alert('Giá phải là số dương.');
      if (!form.imageUrl) return alert('Vui lòng tải ảnh mới trước khi lưu.');

      try {
        setSaving(true);
        const payload = {
          name: form.name.trim(),
          productCode: form.productCode.trim(),
          menuType: form.menuType,
          itemGroup: form.itemGroup,
          price,
          imageName: form.imageName || undefined,
          imageUrl: form.imageUrl || undefined,
        };
        await axios.post(apiUrl('/api/products'), payload);
        if (closeAfter) {
          onDone && onDone(true);
        } else {
          setForm(f => ({ ...f, name: '', productCode: '', price: '', imageName: '', imageUrl: '' }));
        }
      } catch (e) {
        alert('Thêm thất bại: ' + (e?.response?.data?.error || e?.message || ''));
      } finally {
        setSaving(false);
      }
    }

    return (
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000 }}>
        <div style={{ width: 720, maxHeight: '90%', overflow: 'auto', background: '#fff', borderRadius: 10, boxShadow: '0 10px 30px rgba(0,0,0,0.2)' }}>
          <div style={{ padding: 12, borderBottom: '1px solid #e5e7eb', fontWeight: 700 }}>Thêm món</div>

          <div style={{ padding: 12, display: 'grid', gridTemplateColumns: '1fr', gap: 12 }}>
            <div style={{ display: 'grid', gap: 10 }}>
              <div>
                <label style={{ fontSize: 12, color: '#6b7280' }}>Tên món *</label>
                <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} style={{ width: '100%', border: '1px solid #e5e7eb', borderRadius: 6, padding: '8px 10px' }} />
                {nameExists && <div style={{ color: '#ef4444', fontSize: 12, marginTop: 4 }}>Tên đã tồn tại.</div>}
              </div>

              <div>
                <label style={{ fontSize: 12, color: '#6b7280' }}>Mã món *</label>
                <input value={form.productCode} onChange={e => setForm({ ...form, productCode: e.target.value })} style={{ width: '100%', border: '1px solid #e5e7eb', borderRadius: 6, padding: '8px 10px' }} />
                {codeExists && <div style={{ color: '#ef4444', fontSize: 12, marginTop: 4 }}>Mã đã tồn tại.</div>}
              </div>

              <div>
                <label style={{ fontSize: 12, color: '#6b7280' }}>Loại thực đơn *</label>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <select value={form.menuType} onChange={e => setForm({ ...form, menuType: e.target.value })} style={{ flex: 1, border: '1px solid #e5e7eb', borderRadius: 6, padding: '8px 10px' }}>
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
                      const name = String(raw).trim().toLowerCase();
                      if (!name) return;
                      addType && addType(name);
                      setForm(f => ({ ...f, menuType: name }));
                    }}
                    style={{ border: '1px solid #e5e7eb', borderRadius: 6, padding: '8px 10px', background: '#fff' }}
                  >
                    +
                  </button>
                </div>
              </div>

              <div>
                <label style={{ fontSize: 12, color: '#6b7280' }}>Nhóm hàng *</label>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <select value={form.itemGroup} onChange={e => setForm({ ...form, itemGroup: e.target.value })} style={{ flex: 1, border: '1px solid #e5e7eb', borderRadius: 6, padding: '8px 10px' }}>
                    <option value="">(chọn nhóm)</option>
                    {(itemGroups || []).map(g => (
                      <option key={g.name} value={g.name}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={async () => {
                      const name = prompt('Tên nhóm mới');
                      if (!name) return;
                      try {
                        await axios.post(apiUrl('/api/products/item-groups'), { name });
                        setForm(f => ({ ...f, itemGroup: name }));
                      } catch (e) {
                        alert('Tạo nhóm thất bại: ' + (e?.message || ''));
                      }
                    }}
                    style={{ border: '1px solid #e5e7eb', borderRadius: 6, padding: '8px 10px', background: '#fff' }}
                  >
                    +
                  </button>
                </div>
              </div>

              <div>
                <label style={{ fontSize: 12, color: '#6b7280' }}>Giá *</label>
                <input type="number" value={form.price} onChange={e => setForm({ ...form, price: e.target.value })} style={{ width: '100%', border: '1px solid #e5e7eb', borderRadius: 6, padding: '8px 10px' }} />
              </div>

              <div style={{ display: 'grid', gap: 6 }}>
                <label style={{ fontSize: 12, color: '#6b7280' }}>Tải ảnh mới (chọn file) — yêu cầu đã chọn Nhóm hàng</label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={async e => {
                    const f = e.target.files?.[0];
                    if (f)
                      try {
                        await uploadNewImage(f);
                      } catch (err) {
                        alert('Upload lỗi: ' + (err?.message || ''));
                      }
                  }}
                />
                {form.imageUrl && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <img src={resolveImg(form.imageUrl)} alt="" style={{ height: 46, objectFit: 'contain', border: '1px solid #eee', borderRadius: 6 }} />
                    <span style={{ fontSize: 12, color: '#6b7280' }}>{form.imageUrl}</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div style={{ padding: 12, borderTop: '1px solid #e5e7eb', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button type="button" onClick={onCancel} disabled={saving} style={{ border: '1px solid #e5e7eb', borderRadius: 6, padding: '8px 12px', background: '#fff' }}>
              Bỏ qua
            </button>
            <button type="button" onClick={() => save(false)} disabled={saving} style={{ border: '1px solid #e5e7eb', borderRadius: 6, padding: '8px 12px', background: '#fff' }}>
              Lưu & thêm mới
            </button>
            <button type="button" onClick={() => save(true)} disabled={saving} style={{ border: '1px solid #111', borderRadius: 6, padding: '8px 12px', background: '#111', color: '#fff' }}>
              {saving ? 'Đang lưu…' : 'Lưu'}
            </button>
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
    const [loading, setLoading] = React.useState(true);
    const [items, setItems] = React.useState([]);

    React.useEffect(() => {
      let mounted = true;
      (async () => {
        const out = [];
        async function safeGet(url, params) {
          try { const r = await axios.get(apiUrl(url), params ? { params } : undefined); return r.data; }
          catch { return null; }
        }
        // 1) History chuẩn
const h1 = await safeGet(`/api/customers/${customer.id}/history`);
if (Array.isArray(h1)) {
  out.push(...h1.map(x => ({
    kind: x.type?.toLowerCase() === 'create' ? 'create' : 'edit',
    time: x.at || x.time || x.createdAt || x.updatedAt,
    detail: x.detail || JSON.stringify(x) // fallback nếu chưa có detail
  })));
}

        // 2) Orders theo customerId
        const h2 = await safeGet('/api/orders', { customerId: customer.id, limit: 200 });
const rows2 = Array.isArray(h2?.rows) ? h2.rows : (Array.isArray(h2) ? h2 : []);
out.push(...rows2.map(o => ({
  kind: 'order',
  time: o.createdAt || o.time,
  detail: `Order #${o.id} — bàn ${o.area}-${o.tableNo} — ` +
          (o.items || []).map(it => `${it.imageName} x${it.qty}`).join(', ')
})));

        // 3) Logs chung
        const h3 = await safeGet('/api/customer-logs', { customerId: customer.id, limit: 200 });
        const rows3 = Array.isArray(h3?.rows) ? h3.rows : (Array.isArray(h3) ? h3 : []);
        out.push(...rows3.map(l => ({ kind: l.kind || 'log', time:l.time||l.createdAt, detail:l.detail || l.message || JSON.stringify(l) })));
        out.sort((a,b)=> new Date(b.time||0) - new Date(a.time||0));
        if (mounted) { setItems(out); setLoading(false); }
      })();
      return ()=>{ mounted=false; };
    }, [apiUrl, customer]);

    return ReactDOM.createPortal(
      <div onClick={onClose} style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.45)', display:'grid', placeItems:'center', zIndex:20010 }}>
        <div onClick={e=>e.stopPropagation()} style={{ width:760, maxHeight:'88vh', overflow:'auto', background:'#fff', borderRadius:12, boxShadow:'0 20px 60px rgba(0,0,0,0.35)' }}>
          <div style={{ padding:12, borderBottom:'1px solid #e5e7eb', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
            <div style={{ fontWeight:700 }}>Lịch sử: {customer.name} ({customer.code})</div>
            <button onClick={onClose} style={{ border:'none', background:'#ef4444', color:'#fff', padding:'6px 10px', borderRadius:6, cursor:'pointer' }}>Đóng</button>
          </div>
          <div style={{ padding:12 }}>
            {loading ? 'Đang tải…' : (
              items.length === 0 ? <div style={{ color:'#6b7280' }}>Chưa có lịch sử.</div> :
              <div style={{ display:'grid', gap:10 }}>
                {items.map((it, idx)=>(
                  <div key={idx} style={{ border:'1px solid #e5e7eb', borderRadius:8, padding:10, background:'#fafafa' }}>
                    <div style={{ fontSize:12, color:'#6b7280' }}>{new Date(it.time||Date.now()).toLocaleString()}</div>
                    <div><b>{it.kind.toUpperCase()}</b> — {it.detail}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>,
      document.body
    );
  }

  function CustomersPanel({ apiUrl, LEVELS, onAddLevel, onDeleteLevel, onDiscoverLevels, socket }) {
    const [loading, setLoading] = React.useState(false);
    const [rawRows, setRawRows] = React.useState([]);
    const [rows, setRows] = React.useState([]);
    const [kSearch, setKSearch] = React.useState('');
    const [selectedLevels, setSelectedLevels] = React.useState(new Set());
    const [sortKey, setSortKey] = React.useState('code'); // code | name | level
    const [sortDir, setSortDir] = React.useState('asc');
    const [selectedIds, setSelectedIds] = React.useState(new Set());
    const [showAdd, setShowAdd] = React.useState(false);
    const [savingId, setSavingId] = React.useState(null);
    const [historyOf, setHistoryOf] = React.useState(null); // {id, code, name}
    const [page, setPage] = React.useState(1);
    const [totalCustomers, setTotalCustomers] = React.useState(0);
    

    // Danh sách file backup và modal hiển thị
    const [backupList, setBackupList] = React.useState([]);
    const [showBackupModal, setShowBackupModal] = React.useState(false);
    const loadLock = React.useRef(false); // chặn bắn trùng
    // === Customers fetch control ===
const PAGE_SIZE = 50;                // số bản ghi mỗi trang (có thể tăng 80/100 nếu máy khỏe)
const cancelRef = React.useRef(null); // axios cancel cho request hiện tại
const reloadTimerRef = React.useRef(null); // debounce cho socket customersUpdated
const [customerApiStatus, setCustomerApiStatus] = React.useState(null);
const [syncingApi, setSyncingApi] = React.useState(false);
const [syncCursor, setSyncCursor] = React.useState(0);

const loadCustomerApiStatus = React.useCallback(async () => {
  try {
    const r = await axios.get(apiUrl('/api/customer-api/status'), {
      params: { _ts: Date.now() },
      headers: { 'Cache-Control': 'no-cache' },
    });
    setCustomerApiStatus(r.data || null);
  } catch {
    setCustomerApiStatus({
      ok: false,
      lastError: 'Không gọi được /api/customer-api/status',
    });
  }
}, [apiUrl]);

React.useEffect(() => {
  loadCustomerApiStatus();
  const t = setInterval(loadCustomerApiStatus, 60 * 1000);
  return () => clearInterval(t);
}, [loadCustomerApiStatus]);

async function checkCustomerApiNow() {
  const id = window.prompt('Nhập mã khách để test API:', '20242');
  if (!id) return;

  try {
    const r = await axios.post(apiUrl('/api/customer-api/check'), { id });
    setCustomerApiStatus(r.data?.apiStatus || null);

    if (r.data?.ok) {
      alert(
        `API OK\n` +
        `Mã: ${r.data.member?.code || ''}\n` +
        `Tên: ${r.data.member?.name || ''}\n` +
        `Level: ${r.data.member?.level || ''}\n` +
        `Nguồn: ${r.data.source || ''}`
      );
      await loadCustomers({ q: kSearch, page });
    } else {
      alert('API không trả được dữ liệu khách này.');
    }
  } catch (e) {
    alert('Check API lỗi: ' + (e.response?.data?.error || e.message));
    await loadCustomerApiStatus();
  }
}

async function syncCustomersFromApiBatch(force = false) {
  if (syncingApi) return;

  const msg = force
    ? 'Sync lại khách hàng từ API? Chỉ chạy 20 khách/lần để tránh làm nặng API.'
    : 'Cập nhật khách cũ từ API? Hệ thống chỉ chạy 20 khách/lần, không chạy ồ ạt.';

  if (!window.confirm(msg)) return;

  try {
    setSyncingApi(true);

    const r = await axios.post(apiUrl('/api/customers/sync-from-api'), {
      cursor: syncCursor,
      batchSize: 20,
      delayMs: 250,
      force,
    });

    const data = r.data || {};
    setSyncCursor(data.nextCursor || 0);
    await loadCustomerApiStatus();
    await loadCustomers({ q: kSearch, page });

    alert(
      `Sync xong batch nhỏ.\n` +
      `Đã xử lý: ${data.requested || 0}\n` +
      `Cập nhật OK: ${data.updated || 0}\n` +
      `Có thay đổi tên/level: ${data.changed || 0}\n` +
      `Lỗi: ${data.failed || 0}\n` +
      `Tiến độ: ${data.nextCursor || 0}/${data.total || 0}\n` +
      `${data.done ? 'Đã hết danh sách.' : 'Bấm Sync tiếp để chạy batch tiếp theo.'}`
    );
  } catch (e) {
    alert('Sync API thất bại: ' + (e.response?.data?.error || e.message));
  } finally {
    setSyncingApi(false);
  }
}

// Lấy danh sách backup từ server
async function listBackups() {
  try {
    // thêm tham số _ts để tránh bị cache
    const res = await axios.get(apiUrl('/api/members/backups'), {
      params: { _ts: Date.now() }
    });
    setBackupList(res.data?.files || []);
  } catch (e) {
    alert('Không lấy được danh sách backup: ' + (e.response?.data?.error || e.message));
  }
}


// Khôi phục từ file backup (hỏi trước khi gọi API)
async function restoreBackup(file) {
  if (!window.confirm(`Bạn có chắc muốn khôi phục dữ liệu từ bản "${file}" không?`)) return;
  try {
    await axios.post(apiUrl('/api/members/restore'), { file });
    alert('Khôi phục dữ liệu thành công.');
    // Sau khi khôi phục, reload danh sách khách hàng
    await loadCustomers({ q: kSearch, page });
  } catch (e) {
    alert('Khôi phục thất bại: ' + (e.response?.data?.error || e.message));
  }
}


    const allSelected = rows.length > 0 && selectedIds.size === rows.length;

const fetchCustomersApi = React.useCallback(async (q = '', page = 1) => {
  // huỷ request trước nếu còn
  if (cancelRef.current) { try { cancelRef.current(); } catch {} }
  const source = axios.CancelToken.source();
  cancelRef.current = source.cancel;

  const common = {
    cancelToken: source.token,
    timeout: 10000, // 10s
    params: { q, limit: PAGE_SIZE, page, _ts: Date.now() } // _ts chống cache
  };

  try {
    const r = await axios.get(apiUrl('/api/customers'), common);
    return r.data;
  } catch (_) {
    try {
      const r2 = await axios.get(apiUrl('/api/members'), common);
      return r2.data;
    } catch {
      const r3 = await axios.get(apiUrl('/api/clients'), common);
      return r3.data;
    }
  }
}, [apiUrl]);




const loadCustomers = React.useCallback(async ({ q = kSearch, page = 1 } = {}) => {
  if (loadLock.current) return;          // 🔒 đang tải thì bỏ qua
  loadLock.current = true;
  setLoading(true);
  try {
    const data = await fetchCustomersApi(q, page);

    let items = [];
    let total = 0;
    let curPage = page;

    if (Array.isArray(data)) {
      items = data;
      total = data.length;
      curPage = 1;
    } else {
      const rows = data.items || data.rows || [];
      items = rows;
      total = Number(data.total ?? rows.length ?? 0);
      curPage = Number(data.page ?? page);
    }

    setRawRows(items);
    setRows(normalizeCustomers(items));
    setPage(curPage);
    setTotalCustomers(total);

    // 🔎 Chỉ gửi lên cha khi thực sự có level mới chưa có trong LEVELS
    try {
      if (onDiscoverLevels) {
        const found = new Set(
          (items || [])
            .map(c => (c.level ?? c.memberLevel ?? '').toString().trim())
            .filter(Boolean)
        );
        const missing = [...found].filter(lv => !(LEVELS || []).includes(lv));
        if (missing.length) onDiscoverLevels(new Set(missing));
      }
    } catch {}
  } catch (e) {
    console.error(e);
    alert('Không tải được danh sách khách hàng.');
  } finally {
    setLoading(false);
    loadLock.current = false;            // 🔓 mở khóa
  }
}, [fetchCustomersApi, kSearch, LEVELS, onDiscoverLevels]);



    // Nhận sự kiện filter từ Sidebar trái (để không phải truyền props quá sâu)
    React.useEffect(()=>{
      const onSearch = (e)=> setKSearch(e.detail?.q || '');
      const onToggle = (e)=>{
        const lv = e.detail?.level;
        if (!lv) return;
        setSelectedLevels(prev => {
          const s = new Set(prev);
          s.has(lv) ? s.delete(lv) : s.add(lv);
          return s;
        });
      };
      window.addEventListener('CUSTOMERS_SEARCH', onSearch);
      window.addEventListener('CUSTOMERS_LEVEL_TOGGLE', onToggle);
      return ()=>{
        window.removeEventListener('CUSTOMERS_SEARCH', onSearch);
        window.removeEventListener('CUSTOMERS_LEVEL_TOGGLE', onToggle);
      };
    }, []);

    React.useEffect(()=>{ loadCustomers(); }, [loadCustomers]);
React.useEffect(() => {
  const onChange = () => {
    if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current);
    reloadTimerRef.current = setTimeout(() => {
      loadCustomers();
    }, 300); // debounce 300ms
  };
  socket?.on?.('customersUpdated', onChange);
  return () => {
    clearTimeout(reloadTimerRef.current);
    socket?.off?.('customersUpdated', onChange);
  };
}, [socket, loadCustomers]);


    React.useEffect(() => {
      const lset = selectedLevels;
      const list = rawRows.filter(r => {
        if (kSearch) {
          const q = kSearch.toLowerCase();
          const hay = [r.code, r.name, r.level].join(' ').toLowerCase();
          if (!hay.includes(q)) return false;
        }
        if (lset.size && !lset.has(r.level)) return false;
        return true;
      });
      const collator = new Intl.Collator(undefined, { numeric: true, sensitivity:'base' });
      list.sort((a,b)=>{
        const dir = (sortDir==='desc') ? -1 : 1;
        if (sortKey==='code') return collator.compare(a.code||'', b.code||'')*dir;
        if (sortKey==='name') return collator.compare(a.name||'', b.name||'')*dir;
        return collator.compare(a.level||'', b.level||'')*dir;
      });
      setRows(list);
    }, [rawRows, kSearch, selectedLevels, sortKey, sortDir]);



    async function saveRow(r) {
      setSavingId(r.id);
      try {
        try { await axios.put(apiUrl(`/api/customers/${r.id}`), { code:r.code, name:r.name, level:r.level }); }
        catch { await axios.put(apiUrl(`/api/members/${r.id}`), { code:r.code, name:r.name, level:r.level }); }
      } catch (e) {
        alert('Lưu khách hàng thất bại: ' + (e?.response?.data?.error || e?.message || ''));
      } finally {
        setSavingId(null);
      }
    }

    async function deleteRow(id) {
     if (!window.confirm('Xóa khách hàng này?')) return;
      try {
        try { await axios.delete(apiUrl(`/api/customers/${id}`)); }
        catch { await axios.delete(apiUrl(`/api/members/${id}`)); }
        setRawRows(prev => prev.filter(x => x.id !== id));
      } catch (e) {
        alert('Xóa thất bại: ' + (e?.response?.data?.error || e?.message || ''));
      }
    }

    async function bulkDelete() {
      if (selectedIds.size === 0) return;
      if (!window.confirm('Xóa các khách hàng đã chọn?')) return;
      const ids = Array.from(selectedIds);
      try {
        try { await axios.post(apiUrl('/api/customers/bulk-delete'), { ids }); }
        catch {
          // Fallback: xóa từng cái
          await Promise.all(ids.map(id => axios.delete(apiUrl(`/api/customers/${id}`)).catch(()=>{})));
        }
        setRawRows(prev => prev.filter(x => !selectedIds.has(x.id)));
        setSelectedIds(new Set());
      } catch (e) {
        alert('Bulk delete thất bại: ' + (e?.response?.data?.error || e?.message || ''));
      }
    }
function normalizeCustomers(items) {
  const pullCard = (s) => {
    const m = String(s || '').match(/(?:-|#|\(|\s)(\d{2,})\)?\s*$/);
    return m ? m[1] : '';
  };
  return (items || []).map(c => {
    const name = c.name ?? c.customerName ?? '';
    const inferred = pullCard(name);
    const code = c.code ?? c.customerCode ?? inferred ?? '';
    return {
      id: c.id ?? code ?? '',
      code,
      name,
      level: c.level ?? c.memberLevel ?? ''
    };
  });
}

    function download(filename, text) {
      const blob = new Blob([text], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
      setTimeout(()=>URL.revokeObjectURL(url), 2500);
    }
    function csvCell(v){ if(v==null) return ''; const s=String(v); return (s.includes('"')||s.includes(',')||s.includes('\n')) ? '"' + s.replace(/"/g,'""') + '"' : s; }
    function exportCsv() {
      const header = ['id','code','name','level'];
      const lines = [header.join(',')];
      rows.forEach(r => lines.push([r.id??'', r.code??'', r.name??'', r.level??''].map(csvCell).join(',')));
     download(`customers-export-${Date.now()}.csv`, lines.join('\n'));
    }
    function parseCsvLine(line, expect) {
      const out=[]; let cur='', inQ=false;
      for (let i=0;i<line.length;i++){ const ch=line[i];
        if(inQ){ if(ch===`"`){ if(line[i+1]===`"`){ cur+=`"`; i++; } else inQ=false; } else cur+=ch; }
        else { if(ch===`"`){ inQ=true; } else if(ch===','){ out.push(cur); cur=''; } else cur+=ch; }
      } out.push(cur); return out;
    }
    const safeCell = v => (v==null ? '' : String(v).trim());
    async function importCsv(file) {
      try {
        const txt = await file.text();
        const lines = txt.split(/\r?\n/).filter(Boolean);
        if (lines.length < 2) return alert('File trống hoặc sai định dạng.');
        const header = lines[0].split(',');
        const idx = name => header.findIndex(h => h.trim().toLowerCase() === name);
        const idIdx = idx('id'), codeIdx = idx('code'), nameIdx = idx('name'), levelIdx = idx('level');
        let ok=0, fail=0;
        for (let i=1; i<lines.length; i++){
          const cols = parseCsvLine(lines[i], header.length);
          const payload = { code: safeCell(cols[codeIdx]), name: safeCell(cols[nameIdx]), level: safeCell(cols[levelIdx]) || (LEVELS?.[0] || 'P') };
                // Bỏ qua nếu thiếu mã hoặc tên
      if (!payload.code || !payload.name) {
        fail++;
        continue;
      }
          try {
            const id = safeCell(cols[idIdx]);
            if (id) {
              try { await axios.put(apiUrl(`/api/customers/${id}`), payload); }
              catch { await axios.put(apiUrl(`/api/members/${id}`), payload); }
            } else {
              try { await axios.post(apiUrl('/api/customers'), payload); }
              catch { await axios.post(apiUrl('/api/members'), payload); }
            }
            ok++;
          } catch { fail++; }
        }
        await loadCustomers();
        alert(`Import xong. OK: ${ok} • Fail: ${fail}`);
      } catch (e) {
        alert('Import lỗi: ' + (e?.message || ''));
      }
    }

    const importRef = React.useRef(null);
     const allLevels = LEVELS || [];


    return (
      <div style={{ background:'#fff', borderTopLeftRadius:12, padding:12, overflow:'auto' }}>
        {/* Toolbar */}
        <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap', marginBottom:10 }}>
          <button onClick={()=>setShowAdd(true)} style={{ border:'1px solid #e5e7eb', borderRadius:6, background:'#111', color:'#fff', padding:'8px 12px', fontSize:12 }}>+ Thêm khách hàng</button>
          <div style={{
  display:'flex',
  alignItems:'center',
  gap:6,
  border:'1px solid #e5e7eb',
  borderRadius:8,
  padding:'6px 8px',
  background: customerApiStatus?.ok ? '#ecfdf5' : '#fef2f2',
  fontSize:12
}}>
  <span style={{
    width:8,
    height:8,
    borderRadius:'50%',
    background: customerApiStatus?.ok ? '#16a34a' : '#ef4444',
    display:'inline-block'
  }} />
  <b>Customer API:</b>
  <span>{customerApiStatus?.ok ? 'Online' : 'Offline/Fallback'}</span>
  {customerApiStatus?.lastOkAt && (
    <span style={{ color:'#6b7280' }}>
      OK: {new Date(customerApiStatus.lastOkAt).toLocaleTimeString()}
    </span>
  )}
</div>

<button
  type="button"
  onClick={checkCustomerApiNow}
  style={{ border:'1px solid #e5e7eb', borderRadius:6, background:'#fff', padding:'8px 12px', fontSize:12 }}
>
  Check API
</button>

<button
  type="button"
  disabled={syncingApi}
  onClick={() => syncCustomersFromApiBatch(false)}
  style={{ border:'1px solid #2563eb', borderRadius:6, background:'#eff6ff', color:'#1d4ed8', padding:'8px 12px', fontSize:12 }}
>
  {syncingApi ? 'Đang sync…' : 'Sync khách từ API'}
</button>

<button
  type="button"
  disabled={syncingApi}
  onClick={() => setSyncCursor(0)}
  style={{ border:'1px solid #e5e7eb', borderRadius:6, background:'#fff', padding:'8px 12px', fontSize:12 }}
>
  Reset Sync
</button>
          <button type="button" onClick={exportCsv} style={{ border:'1px solid #e5e7eb', borderRadius:6, background:'#fff', padding:'8px 12px', fontSize:12 }}>Export CSV</button>
          <input ref={importRef} type="file" accept=".csv" hidden onChange={e=>{ if(e.target.files?.[0]) importCsv(e.target.files[0]); e.target.value=''; }} />
          <button type="button" onClick={()=>importRef.current?.click()} style={{ border:'1px solid #e5e7eb', borderRadius:6, background:'#fff', padding:'8px 12px', fontSize:12 }}>Import CSV</button>
<button onClick={async () => {
  try {
    await axios.post(apiUrl('/api/members/backup'));
    alert('Đã sao lưu dữ liệu.');
  } catch (e) {
    alert('Backup thất bại: ' + (e.response?.data?.error || e.message));
  }
}}>
  Backup
</button>

<button onClick={async () => {
  await listBackups();
  setShowBackupModal(true);
}}>
  View Backups
</button>


<div style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
  <span style={{ fontSize:12, color:'#6b7280' }}>Sắp xếp:</span>
  <select
    value={sortKey}
    onChange={e=>setSortKey(e.target.value)}
    style={{ border:'1px solid #e5e7eb', borderRadius:6, padding:'6px 8px' }}
  >
    <option value="code">Mã KH</option>
    <option value="name">Tên KH</option>
    <option value="level">Level</option>
  </select>

  <select
    value={sortDir}
    onChange={e=>setSortDir(e.target.value)}
    style={{ border:'1px solid #e5e7eb', borderRadius:6, padding:'6px 8px' }}
  >
    <option value="asc">Tăng dần</option>
    <option value="desc">Giảm dần</option>
  </select>

  <div style={{ width:1, height:20, background:'#e5e7eb', margin:'0 8px' }} />

  {/* Phân trang */}
  <span style={{ fontSize:12, color:'#6b7280' }}>Trang:</span>
  <button
    disabled={page <= 1 || loading}
    onClick={() => loadCustomers({ q: kSearch, page: Math.max(1, page - 1) })}
    style={{ border:'1px solid #e5e7eb', borderRadius:6, padding:'6px 10px', background:'#fff' }}
    title="Trang trước"
  >‹</button>

  <span style={{ minWidth: 52, textAlign:'center' }}>
    <b>{page}</b> / {Math.max(1, Math.ceil(totalCustomers / PAGE_SIZE))}
  </span>

  <button
    disabled={page >= Math.ceil(totalCustomers / PAGE_SIZE) || loading}
    onClick={() => loadCustomers({ q: kSearch, page: page + 1 })}
    style={{ border:'1px solid #e5e7eb', borderRadius:6, padding:'6px 10px', background:'#fff' }}
    title="Trang sau"
  >›</button>
</div>

        </div>

        {/* Bulk actions */}
        {selectedIds.size > 0 && (
          <div style={{ display:'flex', gap:8, alignItems:'center', padding:'6px 0 12px' }}>
            <div><b>{selectedIds.size}</b> khách hàng được chọn</div>
            <button type="button" onClick={bulkDelete} style={{ border:'1px solid #ef4444', color:'#ef4444', borderRadius:6, padding:'6px 8px', background:'#fff' }}>Xóa hàng loạt</button>
          </div>
        )}

{/* Table */}
<div style={{ position:'relative' }}>
  {loading && (
    <div style={{
      position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center',
      pointerEvents:'none', fontStyle:'italic'
    }}>
      Loading…
    </div>
  )}
  <div style={{ border:'1px solid #e5e7eb', borderRadius:10, overflow:'hidden' }}>
            <table style={{ width:'100%', fontSize:14, borderCollapse:'collapse' }}>
              <thead>
                <tr style={{ background:'#f9fafb' }}>
                  <th style={{ textAlign:'center', padding:10, width:40 }}>
                    <input type="checkbox" checked={allSelected} onChange={e=>{ if(e.target.checked) setSelectedIds(new Set(rows.map(x=>x.id))); else setSelectedIds(new Set()); }} />
                  </th>
                  <th style={{ textAlign:'left', padding:10, width:160 }}>Mã khách hàng</th>
                  <th style={{ textAlign:'left', padding:10 }}>Tên khách hàng</th>
                  <th style={{ textAlign:'left', padding:10, width:140 }}>Level</th>
                  <th style={{ textAlign:'center', padding:10, width:120 }}>Lịch sử</th>
                  <th style={{ textAlign:'center', padding:10, width:120 }}>Lưu</th>
                  <th style={{ textAlign:'center', padding:10, width:80 }}>Xóa</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r=>(
                  <tr key={r.id} style={{ borderTop:'1px solid #f1f5f9' }}>
                    <td style={{ textAlign:'center', padding:8 }}>
                      <input type="checkbox" checked={selectedIds.has(r.id)} onChange={(e)=>setSelectedIds(prev=>{ const s=new Set(prev); e.target.checked ? s.add(r.id) : s.delete(r.id); return s; })} />
                    </td>
                    <td style={{ padding:8 }}>
                      <input value={r.code||''} onChange={e=>setRows(prev=>prev.map(x=>x.id===r.id?{...x, code:e.target.value}:x))}
                             style={{ border:'1px solid #e5e7eb', borderRadius:6, padding:'6px 8px', width:140 }} />
                    </td>
                    <td style={{ padding:8 }}>
                      <input value={r.name||''} onChange={e=>setRows(prev=>prev.map(x=>x.id===r.id?{...x, name:e.target.value}:x))}
                             style={{ border:'1px solid #e5e7eb', borderRadius:6, padding:'6px 8px', width:260 }} />
                    </td>
                    <td style={{ padding:8 }}>
                      <select value={r.level || (allLevels[0] || 'P')} onChange={e=>setRows(prev=>prev.map(x=>x.id===r.id?{...x, level:e.target.value}:x))}
                              style={{ border:'1px solid #e5e7eb', borderRadius:6, padding:'6px 8px' }}>
   {/* nếu dữ liệu đang có level lạ (vd: "V-One") mà chưa kịp thêm vào list — vẫn hiển thị được */}
   {!allLevels.includes(r.level) && r.level ? <option value={r.level}>{r.level}</option> : null}
   {allLevels.map(lv=>(<option key={lv} value={lv}>{lv}</option>))}
 </select>
                    </td>
                    <td style={{ textAlign:'center', padding:8 }}>
                      <button onClick={()=>setHistoryOf({ id:r.id, code:r.code, name:r.name })} style={{ border:'1px solid #e5e7eb', borderRadius:6, background:'#fff', padding:'6px 8px' }}>Xem</button>
                    </td>
                    <td style={{ textAlign:'center', padding:8 }}>
                      <button disabled={savingId===r.id} onClick={()=>saveRow(r)}
                              style={{ border:'1px solid #e5e7eb', borderRadius:6, background:'#fff', padding:'6px 8px' }}>
                        {savingId===r.id ? 'Đang lưu…' : 'Lưu'}
                      </button>
                    </td>
                    <td style={{ textAlign:'center', padding:8 }}>
                      <button onClick={()=>deleteRow(r.id)} style={{ border:'1px solid #ef4444', color:'#ef4444', borderRadius:6, background:'#fff', padding:'6px 8px' }}>🗑</button>
                    </td>
                  </tr>
                ))}
                {rows.length===0 && (
                  <tr><td colSpan={7} style={{ padding:14, textAlign:'center', color:'#6b7280' }}>Không có dữ liệu.</td></tr>
                )}
              </tbody>
            </table>
            <div style={{ marginTop: '10px' }}>
  <button
    disabled={page <= 1}
    onClick={() => loadCustomers({ q: kSearch, page: page - 1 })}
  >
    Prev
  </button>
  <span style={{ margin: '0 10px' }}>
    Page {page} / {Math.ceil(totalCustomers / 100)}
  </span>
  <button
    disabled={page * 100 >= totalCustomers}
    onClick={() => loadCustomers({ q: kSearch, page: page + 1 })}
  >
    Next
  </button>
</div>

          </div>
          
        </div>

        {showAdd && (
 <AddCustomerModal
   LEVELS={allLevels}
            onDone={async ok=>{ setShowAdd(false); if(ok) await loadCustomers(); }}
            onCancel={()=>setShowAdd(false)}
            apiUrl={apiUrl}
            existing={rawRows}
          />
        )}
        {historyOf && (
          <CustomerHistoryModal apiUrl={apiUrl} customer={historyOf} onClose={()=>setHistoryOf(null)} />
        )}
        {showBackupModal && ReactDOM.createPortal(
   <div
     onClick={() => setShowBackupModal(false)}
     style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.45)', display:'grid', placeItems:'center', zIndex:20010 }}
   >
     <div
       onClick={e => e.stopPropagation()}
       style={{ width:480, maxHeight:'80vh', overflow:'auto', background:'#fff', borderRadius:10, boxShadow:'0 20px 60px rgba(0,0,0,0.35)', padding:16 }}
     >
       <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
         <div style={{ fontWeight:700 }}>Danh sách bản sao lưu</div>
         <button onClick={() => setShowBackupModal(false)} style={{ border:'none', background:'#ef4444', color:'#fff', padding:'6px 10px', borderRadius:6, cursor:'pointer' }}>
           Đóng
         </button>
       </div>
       {backupList.length === 0 ? (
         <div style={{ color:'#6b7280' }}>(Chưa có bản backup nào)</div>
       ) : (
         <ul style={{ listStyle:'none', padding:0, margin:0, display:'grid', gap:8 }}>
           {backupList.map(f => (
             <li key={f} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', border:'1px solid #e5e7eb', borderRadius:6, padding:'6px 10px' }}>
               <span>{f}</span>
               <button onClick={() => restoreBackup(f)} style={{ border:'1px solid #10b981', color:'#10b981', borderRadius:6, background:'#fff', padding:'4px 8px' }}>
                 Restore
               </button>
             </li>
           ))}
         </ul>
       )}
     </div>
   </div>,
   document.body
 )}

      </div>
    );
  }
    // ==== StaffPanel ====
  // Quản lý danh sách nhân viên: tải, thêm, sửa, xoá
  function StaffPanel({ apiUrl }) {
    const [loading, setLoading] = React.useState(false);
    const [rows, setRows] = React.useState([]);
    const [search, setSearch] = React.useState('');

    const loadStaffs = React.useCallback(async () => {
      setLoading(true);
      try {
        const url = apiUrl ? apiUrl('/api/staffs') : '/api/staffs';
        const res = await axios.get(url, { headers: { 'Cache-Control': 'no-cache' } });
        const data = Array.isArray(res.data) ? res.data : [];
        setRows(data.map(it => ({ id: String(it.id || it.code || '').trim(), name: String(it.name || '') })));
      } catch (e) {
        alert('Không tải được danh sách nhân viên: ' + (e.response?.data?.error || e.message));
      } finally {
        setLoading(false);
      }
    }, [apiUrl]);

    React.useEffect(() => { loadStaffs(); }, [loadStaffs]);

    const handleChange = (idx, field, value) => {
      setRows(prev => prev.map((r, i) => i === idx ? { ...r, [field]: value } : r));
    };

    const handleSave = async (idx) => {
      const item = rows[idx];
      const id = String(item.id || '').trim();
      const name = String(item.name || '').trim();
      if (!id || !name) return alert('Mã và tên nhân viên bắt buộc.');
      try {
        const url = apiUrl ? apiUrl(`/api/staffs/${encodeURIComponent(item.id)}`) : `/api/staffs/${encodeURIComponent(item.id)}`;
        await axios.put(url, { id, name });
        await loadStaffs();
        alert('Đã lưu nhân viên.');
      } catch (e) {
        alert('Không lưu được nhân viên: ' + (e.response?.data?.error || e.message));
      }
    };

    const handleDelete = async (id) => {
      if (!window.confirm('Bạn có chắc muốn xoá nhân viên này?')) return;
      try {
        const url = apiUrl ? apiUrl(`/api/staffs/${encodeURIComponent(id)}`) : `/api/staffs/${encodeURIComponent(id)}`;
        await axios.delete(url);
        await loadStaffs();
        alert('Đã xoá nhân viên.');
      } catch (e) {
        alert('Không xoá được nhân viên: ' + (e.response?.data?.error || e.message));
      }
    };

    const handleAdd = () => {
      setRows(prev => [...prev, { id: '', name: '' }]);
    };

    const filtered = rows.filter(r => {
      const q = search.trim().toLowerCase();
      if (!q) return true;
      return r.id.toLowerCase().includes(q) || (r.name || '').toLowerCase().includes(q);
    });

    return (
      <div style={{ color: '#111' }}>
        <h3>Danh sách nhân viên</h3>
        <div style={{ marginBottom: 8, display:'flex', alignItems:'center', gap: 8 }}>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Tìm kiếm"
            style={{ flexGrow: 1, padding:'6px 8px', border:'1px solid #d1d5db', borderRadius: 4 }}
          />
          <button
            type="button"
            onClick={handleAdd}
            style={{ background:'#334155', color:'#fff', border:'none', padding:'6px 10px', borderRadius:6, cursor:'pointer' }}
          >+ Thêm nhân viên</button>
        </div>
        {loading ? (
          <div>Đang tải dữ liệu…</div>
        ) : (
          <table border="1" cellPadding="6" style={{ width:'100%', borderCollapse:'collapse' }}>
            <thead>
              <tr>
                <th>Mã NV</th>
                <th>Tên NV</th>
                <th>Hành động</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, idx) => (
                <tr key={idx}>
                  <td>
                    <input value={r.id} onChange={e => handleChange(idx, 'id', e.target.value)} style={{ width:'100%', padding:'4px 6px' }} />
                  </td>
                  <td>
                    <input value={r.name} onChange={e => handleChange(idx, 'name', e.target.value)} style={{ width:'100%', padding:'4px 6px' }} />
                  </td>
                  <td>
                    <button
                      type="button"
                      onClick={() => handleSave(idx)}
                      style={{ marginRight:4, background:'#10b981', color:'#fff', border:'none', padding:'4px 8px', borderRadius:4 }}
                    >Lưu</button>
                    <button
                      type="button"
                      onClick={() => handleDelete(r.id)}
                      style={{ background:'#ef4444', color:'#fff', border:'none', padding:'4px 8px', borderRadius:4 }}
                    >Xoá</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    );
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
        <div style={{ background: '#1f2937', borderRadius: 10, marginBottom: 12, overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px', cursor: 'pointer' }} onClick={() => setTypeOpen(x => !x)}>
            <div style={{ fontWeight: 700 }}>Loại thực đơn</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <button
                type="button"
                onClick={e => {
                  e.stopPropagation();
                  addMenuType();
                }}
                title="Thêm loại thực đơn"
                style={{ border: 'none', background: '#334155', color: '#fff', padding: '4px 8px', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}
              >
                +
              </button>
              <button style={{ border: 'none', background: '#111', color: '#fff', borderRadius: 6, padding: '4px 8px', cursor: 'pointer' }}>{typeOpen ? '︿' : '﹀'}</button>
            </div>
          </div>

          {typeOpen && (
            <div style={{ padding: '0 10px 10px', display: 'grid', gap: 8 }}>
              {(typeOptions || []).map(t => (
                <div key={t} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
                    <input type="checkbox" checked={selectedTypes.has(t)} onChange={() => toggleType(t)} />
                    <span>{t}</span>
                  </label>
                  {!RESERVED_TYPES.includes(t) && (
                    <button
                      type="button"
                      onClick={() => deleteMenuType(t)}
                      title={`Xóa loại "${t}"`}
                      style={{ border: '1px solid #ef4444', color: '#ef4444', background: '#111', borderRadius: 6, padding: '2px 6px', fontSize: 12 }}
                    >
                      🗑
                    </button>
                  )}
                </div>
              ))}
              {(typeOptions || []).length === 0 && <div style={{ color: '#9ca3af' }}>(chưa có loại)</div>}
            </div>
          )}
        </div>

        {/* Nhóm hàng */}
        <div style={{ background: '#1f2937', borderRadius: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ fontWeight: 700 }}>Nhóm hàng</div>
              <button
                onClick={async () => {
                  const name = prompt('Tên nhóm mới');
                  if (!name) return;
                  try {
                    await axios.post(apiUrl('/api/products/item-groups'), { name });
                    await reloadItemGroups();
                  } catch (e) {
                    alert('Tạo nhóm thất bại: ' + (e?.message || ''));
                  }
                }}
                title="Thêm nhóm"
                style={{ border: 'none', background: '#334155', color: '#fff', padding: '4px 8px', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}
              >
                +
              </button>
            </div>
            <button onClick={() => setGroupOpen(x => !x)} style={{ border: 'none', background: '#111', color: '#fff', borderRadius: 6, padding: '4px 8px', cursor: 'pointer' }}>
              {groupOpen ? '︿' : '﹀'}
            </button>
          </div>
          {groupOpen && (
            <div style={{ padding: '0 10px 10px', display: 'grid', gap: 8, maxHeight: 280, overflow: 'auto' }}>
              {(itemGroups || []).map(g => (
                <div key={g.name} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
                    <input type="checkbox" checked={selectedItemGroups.has(g.name)} onChange={() => toggleItemGroup(g.name)} />
                    <span>{g.name}</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => deleteItemGroupHard(g.name)}
                    title={`Xóa nhóm "${g.name}"`}
                    style={{ border: '1px solid #ef4444', color: '#ef4444', background: '#111', borderRadius: 6, padding: '2px 6px', fontSize: 12 }}
                  >
                    🗑
                  </button>
                </div>
              ))}
              {(!itemGroups || itemGroups.length === 0) && <div style={{ color: '#9ca3af' }}>Chưa có nhóm nào.</div>}
            </div>
          )}
        </div>

        {/* Menu filter */}
        <div style={{ background: '#1f2937', borderRadius: 10, marginTop: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px', cursor: 'pointer' }} onClick={() => setMenuOpen(x => !x)}>
            <div style={{ fontWeight: 700 }}>Menu (Admin/User)</div>
            <button type="button" style={{ border: 'none', background: '#111', color: '#fff', borderRadius: 6, padding: '4px 8px', cursor: 'pointer' }}>
              {menuOpen ? '︿' : '﹀'}
            </button>
          </div>

          {menuOpen && (
            <div style={{ padding: '0 10px 10px', display: 'grid', gap: 8, maxHeight: 240, overflow: 'auto' }}>
              {(menuOptions || []).map(m => (
                <label key={m} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input type="checkbox" checked={selectedMenus.has(m)} onChange={() => toggleMenuFilter(m)} />
                  <span>{m}</span>
                </label>
              ))}
              {(menuOptions || []).length === 0 && <div style={{ color: '#9ca3af' }}>(chưa có menu)</div>}
            </div>
          )}
        </div>

        {/* Quản lý Menu (thêm/xóa + default levels) */}
        <div style={{ background: '#1f2937', borderRadius: 10, marginTop: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px' }}>
            <div style={{ fontWeight: 700 }}>Menu (Admin/User)</div>
          </div>

          <div style={{ padding: '0 10px 10px', display: 'flex', gap: 6 }}>
            <input
              value={newMenuName}
              onChange={e => setNewMenuName(e.target.value)}
              placeholder="VD: CLUB MENU"
              style={{ flex: 1, border: '1px solid #374151', borderRadius: 6, padding: '6px 8px', background: '#111', color: '#fff' }}
            />
            <button onClick={addMenu} style={{ border: '1px solid #e5e7eb', borderRadius: 6, padding: '6px 10px', background: '#fff', fontSize: 12 }}>
              Thêm
            </button>
          </div>

          <div style={{ padding: '0 10px 10px', display: 'grid', gap: 6, maxHeight: 240, overflow: 'auto' }}>
            {(menuOptions || []).length === 0 && <div style={{ color: '#9ca3af' }}>(chưa có menu)</div>}
            {(menuOptions || []).map(m => (
              <div key={m} style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#0b1220', padding: '6px 8px', borderRadius: 6 }}>
                <span style={{ flex: 1 }}>{m}</span>
                <button
                  type="button"
                  onClick={() => deleteMenu(m)}
                  style={{ border: '1px solid #ef4444', color: '#ef4444', background: '#111', borderRadius: 6, padding: '4px 6px', fontSize: 12 }}
                  title={`Xóa menu "${m}"`}
                >
                  🗑
                </button>
              </div>
            ))}
          </div>

          <div style={{ background: '#1f2937', borderRadius: 10, marginTop: 12 }}>
            <div style={{ padding: '8px 10px', fontWeight: 700 }}>Levels mặc định cho Menu</div>
            <div style={{ padding: '0 10px 10px', display: 'grid', gap: 8 }}>
              <select value={selectedMenu} onChange={e => setSelectedMenu(e.target.value)} style={{ border: '1px solid #374151', borderRadius: 6, padding: '6px 8px', background: '#111', color: '#fff' }}>
                <option value="">(chọn menu)</option>
                {(menuOptions || []).map(m => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>

              {selectedMenu && (
                <>
        <div style={{ display: 'flex', gap: 10, color: '#e5e7eb' }}>
          {USER_MENU_LEVELS.map(lv => (
            <label key={lv} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                type="checkbox"
                checked={levelsSel.has(lv)}
                onChange={() =>
                  setLevelsSel(prev => {
                    const s = new Set(prev);
                    s.has(lv) ? s.delete(lv) : s.add(lv);
                    return s;
                  })
                }
              />
              {lv}
            </label>
          ))}
        </div>


                  <div style={{ display: 'flex', gap: 8 }}>
                    <button type="button" onClick={saveDefaultLevels} style={{ border: 'none', background: '#334155', color: '#fff', padding: '6px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}>
                      Lưu default
                    </button>
                    <button type="button" onClick={applyLevelsToAll} style={{ border: 'none', background: '#6366f1', color: '#fff', padding: '6px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}>
                      Áp dụng xuống toàn menu
                    </button>
                  </div>

                  <div style={{ fontSize: 12, color: '#9ca3af' }}>
                    “Lưu default”: dùng cho <b>món mới thêm</b> vào menu này. <br />
                    “Áp dụng xuống toàn menu”: cập nhật <b>mọi món đang có</b> trong menu.
                  </div>
                  
                </>
              )}
              
            </div>
            
          </div>
         
        </div>
              </>   
                )}    
                 {activeTab === 'customers' && (
  <div>
    <input
  placeholder="Tìm KH (mã, tên, level)…"
  onChange={(e) => {
    // Thay toàn bộ handler hiện tại bằng khối dưới:
    const v = e.target.value;
    clearTimeout(custSearchTimer.current);
    custSearchTimer.current = setTimeout(() => {
      const ev = new CustomEvent('CUSTOMERS_SEARCH', { detail: { q: v } });
      window.dispatchEvent(ev);
    }, 300); // 300ms cho mượt, có thể chỉnh 200–400ms
  }}
  
      style={{
        width: '100%',
        border: '1px solid #374151',
        borderRadius: 8,
        padding: '8px 10px',
        background: '#1f2937',
        color: '#fff',
        marginBottom: 12,
      }}
    />

    <div style={{ background: '#1f2937', borderRadius: 10, marginBottom: 12, overflow: 'hidden' }}>
      <div
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px' }}
      >
        <div style={{ fontWeight: 700 }}>Level</div>
        <div style={{ display: 'flex', gap: 6 }}>
          {/* SỬA: dùng addLevelOption thay vì onAddLevel */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              addLevelOption();
            }}
            title="Thêm level"
            style={{
              border: 'none',
              background: '#334155',
              color: '#fff',
              padding: '4px 8px',
              borderRadius: 6,
              cursor: 'pointer',
              fontSize: 12,
            }}
          >
            +
          </button>
        </div>
      </div>

      <div style={{ padding: '0 10px 10px', display: 'grid', gap: 8 }}>
        {/* SỬA: dùng levelOptions thay vì allLevels */}
        {levelOptions.map((lv) => (
          <label key={lv} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="checkbox"
              onChange={() => {
                const ev = new CustomEvent('CUSTOMERS_LEVEL_TOGGLE', { detail: { level: lv } });
                window.dispatchEvent(ev);
              }}
            />
            <span>{lv}</span>

            {/* SỬA: dùng deleteLevelOption thay vì onDeleteLevel */}
            {!['P', 'I', 'I+', 'V', 'One', 'One+', 'EC'].includes(lv) && (
              <button
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  deleteLevelOption(lv);
                }}
                title={`Xoá level "${lv}"`}
                style={{
                  marginLeft: 'auto',
                  border: '1px solid #ef4444',
                  color: '#ef4444',
                  background: '#111',
                  borderRadius: 6,
                  padding: '2px 6px',
                  fontSize: 12,
                }}
              >
                🗑
              </button>
            )}
          </label>
        ))}
      </div>
    </div>

<div style={{ fontSize: 12, color: '#9ca3af' }}>
  Tip: Export Excel thao tác ở toolbar bên phải.
</div>

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
    title="Đổi tên file ảnh theo cột Tên hàng"
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
                  <th style={{ textAlign: 'center', padding: 10, width: 120 }}>Lưu</th>
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
      membersMap={membersMap}     // 🚩 PHẢI truyền
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
