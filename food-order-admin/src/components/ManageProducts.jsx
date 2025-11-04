// src/components/ManageProducts.jsx
import React from 'react';
import ReactDOM from 'react-dom';
import axios from 'axios';

/**
 * Trang Quản lý Hàng hóa — tách file
 * YÊU CẦU: truyền vào các props từ AdminFoodList:
 *   - apiUrl: (path) => string
 *   - resolveImg: (url) => string
 *   - socket: socket.io-client instance (có .on/.off)
 *   - ALL_LEVELS: string[]
 */

export default function ManageProductsModal({
  onClose,
  apiUrl,
  resolveImg,
  socket,
  ALL_LEVELS = ['P', 'I', 'I+', 'V', 'One'],
}) 


{
  // ===== Helpers/Constants =====
  const [activeTab, setActiveTab] = React.useState('products'); // 'products' | 'customers'
  const SOURCE_FOLDER = 'SOURCE'; // thư mục chứa ảnh gốc
  const TYPE_LS_KEY = 'menuTypeOptions';

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

  // Index menu/foods để quản lý menu thực sự (Admin/User)
  const [foodsIndex, setFoodsIndex] = React.useState(new Map()); // key = `${type}|${imageKey}` -> food
  const [menusOfImage, setMenusOfImage] = React.useState(new Map()); // key = imageKey -> Set(menuTypes)
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
  const importRef = React.useRef(null);

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

  React.useEffect(() => {
    const refetch = () => loadFoodsLite();
    socket?.on?.('foodAdded', refetch);
    socket?.on?.('foodDeleted', refetch);
    socket?.on?.('foodsDeleted', refetch);
    socket?.on?.('foodRenamed', refetch);
    socket?.on?.('foodsReordered', refetch);
    socket?.on?.('menuLevelsUpdated', refetch);
    return () => {
      socket?.off?.('foodAdded', refetch);
      socket?.off?.('foodDeleted', refetch);
      socket?.off?.('foodsDeleted', refetch);
      socket?.off?.('foodRenamed', refetch);
      socket?.off?.('foodsReordered', refetch);
      socket?.off?.('menuLevelsUpdated', refetch);
    };
  }, [socket, loadFoodsLite]);

  const loadProducts = React.useCallback(async () => {
    setLoading(true);
    try {
      const r = await axios.get(apiUrl('/api/products'), { params: { limit: 2000, q: kSearch || undefined } });
      const data = Array.isArray(r.data?.rows) ? r.data.rows : [];
      setRawRows(data);
    } catch (e) {
      alert('Load products fail: ' + (e?.message || ''));
    } finally {
      setLoading(false);
    }
  }, [kSearch, apiUrl]);

  React.useEffect(() => {
    loadProducts();
  }, [loadProducts]);

  React.useEffect(() => {
    const onChange = () => {
      loadProducts();
    };
    socket?.on?.('foodAdded', onChange);
    socket?.on?.('foodRenamed', onChange);
    socket?.on?.('foodDeleted', onChange);
    socket?.on?.('menuLevelsUpdated', onChange);
    return () => {
      socket?.off?.('foodAdded', onChange);
      socket?.off?.('foodRenamed', onChange);
      socket?.off?.('foodDeleted', onChange);
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

  function download(filename, text) {
    const blob = new Blob([text], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2500);
  }
  function toCsvCell(v) {
    if (v == null) return '';
    const s = String(v);
    if (s.includes('"') || s.includes(',') || s.includes('\n')) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }
  function exportCsv() {
    const header = ['id', 'productCode', 'name', 'menuType', 'itemGroup', 'price', 'imageName', 'imageUrl'];
    const lines = [header.join(',')];
    rows.forEach(r => {
      lines.push(
        [
          r.id ?? '',
          r.productCode ?? '',
          r.name ?? '',
          r.menuType ?? '',
          r.itemGroup ?? '',
          r.price ?? '',
          r.imageName ?? '',
          r.imageUrl ?? '',
        ].map(toCsvCell).join(','),
      );
    });
    download(`products-export-${Date.now()}.csv`, lines.join('\n'));
  }
  function downloadTemplate() {
    const header = 'productCode,name,menuType,itemGroup,price,imageName,imageUrl';
    const sample = 'SP001,Khoai tây chiên,đồ ăn,SNACK MENU,45000,KHOAI-TAY-CHIENG.PNG,';
    download('products-import-template.csv', header + '\n' + sample + '\n');
  }
  async function importCsv(file) {
    try {
      const txt = await file.text();
      const rows = txt
        .split(/\r?\n/)
        .map(l => l.trim())
        .filter(Boolean);
      if (rows.length < 2) return alert('File trống hoặc sai định dạng.');
      const header = rows[0].split(',');
      const idx = name => header.findIndex(h => h.trim().toLowerCase() === name);
      const idIdx = idx('id');
      const codeIdx = idx('productcode');
      const nameIdx = idx('name');
      const typeIdx = idx('menutype');
      const itemGroupIdx = idx('itemgroup');
      const groupsIdx = idx('groups'); // tương thích cũ
      const groupIdx = idx('group'); // tương thích cũ
      const priceIdx = idx('price');
      const imageNameIdx = idx('imagename');
      const imageUrlIdx = idx('imageurl');

      let ok = 0,
        fail = 0;
      for (let i = 1; i < rows.length; i++) {
        const cols = parseCsvLine(rows[i], header.length);
        if (!cols) continue;

        let itemGroup = itemGroupIdx >= 0 ? safeCell(cols[itemGroupIdx]) || '' : '';
        if (!itemGroup) {
          const groupsStr = groupsIdx >= 0 ? safeCell(cols[groupsIdx]) : '';
          if (groupsStr) itemGroup = groupsStr.split(';').map(s => s.trim()).filter(Boolean)[0] || '';
          if (!itemGroup && groupIdx >= 0) itemGroup = safeCell(cols[groupIdx]) || '';
        }

        const payload = {
          productCode: safeCell(cols[codeIdx]),
          name: safeCell(cols[nameIdx]),
          menuType: safeCell(cols[typeIdx]) || 'đồ ăn',
          itemGroup: itemGroup || '',
          price: Number(safeCell(cols[priceIdx])),
          imageName: safeCell(cols[imageNameIdx]),
          imageUrl: safeCell(cols[imageUrlIdx]),
        };

        try {
          const id = safeCell(cols[idIdx]);
          if (id) {
            await axios.put(apiUrl(`/api/products/${id}`), payload);
          } else {
            await axios.post(apiUrl('/api/products'), payload);
          }
          ok++;
        } catch (e) {
          console.warn('Import row fail:', e?.message || e);
          fail++;
        }
      }
      await loadProducts();
      alert(`Import xong. OK: ${ok} • Fail: ${fail}`);
    } catch (e) {
      alert('Import lỗi: ' + (e?.message || ''));
    }
  }
  function parseCsvLine(line, expectCols) {
    const out = [];
    let cur = '',
      inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQ) {
        if (ch === '"') {
          if (line[i + 1] === '"') {
            cur += '"';
            i++;
          } else inQ = false;
        } else cur += ch;
      } else {
        if (ch === '"') inQ = true;
        else if (ch === ',') {
          out.push(cur);
          cur = '';
        } else cur += ch;
      }
    }
    out.push(cur);
    if (expectCols && out.length !== expectCols) return out;
    return out;
  }
  const safeCell = v => (v == null ? '' : String(v).trim());

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

  function EditMenusModal({ product, onClose, getCurrentMenus, resolveImageUrl, foodsIndex, allMenus = [] }) {
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
  function AddCustomerModal({ ALL_LEVELS, onDone, onCancel, apiUrl, existing = [] }) {
    const [saving, setSaving] = React.useState(false);
    const [form, setForm] = React.useState({ code: '', name: '', level: ALL_LEVELS[0] || 'P' });
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
        if (!closeAfter) setForm({ code: '', name: '', level: ALL_LEVELS[0] || 'P' });
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
              <select value={form.level} onChange={e=>setForm(f=>({ ...f, level:e.target.value }))}
                      style={{ width:'100%', border:'1px solid #e5e7eb', borderRadius:6, padding:'8px 10px' }}>
                {(ALL_LEVELS||[]).map(lv=> <option key={lv} value={lv}>{lv}</option>)}
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
        if (Array.isArray(h1)) out.push(...h1.map(x => ({ kind:'edit', time:x.time||x.createdAt||x.updatedAt, detail:x.detail||x.note||JSON.stringify(x) })));
        // 2) Orders theo customerId
        const h2 = await safeGet('/api/orders', { customerId: customer.id, limit: 200 });
        const rows2 = Array.isArray(h2?.rows) ? h2.rows : (Array.isArray(h2) ? h2 : []);
        out.push(...rows2.map(o => ({ kind:'order', time:o.createdAt||o.time, detail:`Order #${o.code || o.id || ''} — ${o.items?.length||0} mặt hàng, tổng ${o.total ?? ''}` })));
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

  function CustomersPanel({ apiUrl, ALL_LEVELS, socket }) {
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

    const allSelected = rows.length > 0 && selectedIds.size === rows.length;

const fetchCustomersApi = React.useCallback(async () => {
  try {
    const r = await axios.get(apiUrl('/api/customers'), { params:{ limit:2000, q:kSearch||undefined } });
    return r.data?.rows || r.data || [];
  } catch (e1) {
    try {
      const r2 = await axios.get(apiUrl('/api/members'), { params:{ limit:2000, q:kSearch||undefined } });
      return r2.data?.rows || r2.data || [];
    } catch (e2) {
      try {
        const r3 = await axios.get(apiUrl('/api/clients'), { params:{ limit:2000, q:kSearch||undefined } });
        return r3.data?.rows || r3.data || [];
      } catch {
        return [];
      }
    }
  }
}, [apiUrl, kSearch]);


const loadCustomers = React.useCallback(async () => {
  setLoading(true);
  try {
    const data = await fetchCustomersApi();
    const normalized = (Array.isArray(data) ? data : []).map(c => ({
      id: c.id ?? c._id ?? c.customerId ?? c.code,
      code: c.code ?? c.customerCode ?? c.memberCode ?? '',
      name: c.name ?? c.customerName ?? '',
      level: c.level ?? c.memberLevel ?? (ALL_LEVELS[0] || 'P'),
    })).filter(x => x.id != null);
    setRawRows(normalized);
  } finally {
    setLoading(false);
  }
}, [fetchCustomersApi, ALL_LEVELS]);

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
      const onChange = () => loadCustomers();
      socket?.on?.('customersUpdated', onChange);
      return ()=> socket?.off?.('customersUpdated', onChange);
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
          const payload = { code: safeCell(cols[codeIdx]), name: safeCell(cols[nameIdx]), level: safeCell(cols[levelIdx]) || (ALL_LEVELS[0]||'P') };
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
    const allLevels = ALL_LEVELS || [];

    return (
      <div style={{ background:'#fff', borderTopLeftRadius:12, padding:12, overflow:'auto' }}>
        {/* Toolbar */}
        <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap', marginBottom:10 }}>
          <button onClick={()=>setShowAdd(true)} style={{ border:'1px solid #e5e7eb', borderRadius:6, background:'#111', color:'#fff', padding:'8px 12px', fontSize:12 }}>+ Thêm khách hàng</button>
          <button type="button" onClick={exportCsv} style={{ border:'1px solid #e5e7eb', borderRadius:6, background:'#fff', padding:'8px 12px', fontSize:12 }}>Export CSV</button>
          <input ref={importRef} type="file" accept=".csv" hidden onChange={e=>{ if(e.target.files?.[0]) importCsv(e.target.files[0]); e.target.value=''; }} />
          <button type="button" onClick={()=>importRef.current?.click()} style={{ border:'1px solid #e5e7eb', borderRadius:6, background:'#fff', padding:'8px 12px', fontSize:12 }}>Import CSV</button>
          <div style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap:6 }}>
            <span style={{ fontSize:12, color:'#6b7280' }}>Sắp xếp:</span>
            <select value={sortKey} onChange={e=>setSortKey(e.target.value)} style={{ border:'1px solid #e5e7eb', borderRadius:6, padding:'6px 8px' }}>
              <option value="code">Mã KH</option>
              <option value="name">Tên KH</option>
              <option value="level">Level</option>
            </select>
            <select value={sortDir} onChange={e=>setSortDir(e.target.value)} style={{ border:'1px solid #e5e7eb', borderRadius:6, padding:'6px 8px' }}>
              <option value="asc">Tăng dần</option>
              <option value="desc">Giảm dần</option>
            </select>
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
        {loading ? (
          <div style={{ padding:12 }}>Loading…</div>
        ) : (
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
                      <select value={r.level||allLevels[0]||'P'} onChange={e=>setRows(prev=>prev.map(x=>x.id===r.id?{...x, level:e.target.value}:x))}
                              style={{ border:'1px solid #e5e7eb', borderRadius:6, padding:'6px 8px' }}>
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
          </div>
        )}

        {showAdd && (
          <AddCustomerModal
            ALL_LEVELS={ALL_LEVELS}
            onDone={async ok=>{ setShowAdd(false); if(ok) await loadCustomers(); }}
            onCancel={()=>setShowAdd(false)}
            apiUrl={apiUrl}
            existing={rawRows}
          />
        )}
        {historyOf && (
          <CustomerHistoryModal apiUrl={apiUrl} customer={historyOf} onClose={()=>setHistoryOf(null)} />
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
                    {ALL_LEVELS.map(lv => (
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
       onChange={(e)=>{
         // bắn custom event để panel phải nhận kSearch (dùng window event cho gọn, tránh prop drilling lớn)
         const ev = new CustomEvent('CUSTOMERS_SEARCH', { detail: { q: e.target.value }});
         window.dispatchEvent(ev);
       }}
       style={{ width:'100%', border:'1px solid #374151', borderRadius:8, padding:'8px 10px', background:'#1f2937', color:'#fff', marginBottom:12 }}
     />
     <div style={{ background:'#1f2937', borderRadius:10, marginBottom:12, overflow:'hidden' }}>
       <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'8px 10px' }}>
         <div style={{ fontWeight:700 }}>Level</div>
       </div>
       <div style={{ padding:'0 10px 10px', display:'flex', gap:10, flexWrap:'wrap' }}>
         {ALL_LEVELS.map(lv=>(
           <label key={lv} style={{ display:'flex', alignItems:'center', gap:8 }}>
             <input type="checkbox"
               onChange={(e)=>{
                 const ev = new CustomEvent('CUSTOMERS_LEVEL_TOGGLE', { detail: { level: lv }});
                 window.dispatchEvent(ev);
               }} />
             <span>{lv}</span>
           </label>
         ))}
       </div>
     </div>
     <div style={{ fontSize:12, color:'#9ca3af' }}>
       Tip: Import/Export CSV thao tác ở toolbar bên phải.
     </div>
   </div>
 )}

      </div>

      {/* RIGHT: Main list */}
      {activeTab === 'products' ? (
        <div style={{ background: '#fff', borderTopLeftRadius: 12, padding: 12, overflow: 'auto' }} ref={rightPaneRef}>
        {/* Toolbar (Hàng hóa) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
          <button onClick={() => setShowAdd(true)} style={{ border: '1px solid #e5e7eb', borderRadius: 6, background: '#111', color: '#fff', padding: '8px 12px', fontSize: 12 }}>
            + Thêm mới
          </button>

          <button type="button" onClick={exportCsv} style={{ border: '1px solid #e5e7eb', borderRadius: 6, background: '#fff', padding: '8px 12px', fontSize: 12 }}>
            Export CSV
          </button>

          <input ref={importRef} type="file" accept=".csv" hidden onChange={e => { if (e.target.files?.[0]) importCsv(e.target.files[0]); e.target.value = ''; }} />
          <button type="button" onClick={() => importRef.current?.click()} style={{ border: '1px solid #e5e7eb', borderRadius: 6, background: '#fff', padding: '8px 12px', fontSize: 12 }}>
            Import CSV
          </button>

          <button type="button" onClick={downloadTemplate} style={{ border: '1px solid #e5e7eb', borderRadius: 6, background: '#fff', padding: '8px 12px', fontSize: 12 }}>
            Tải mẫu
          </button>

          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 12, color: '#6b7280' }}>Sắp xếp:</span>
            <select value={sortKey} onChange={e => setSortKey(e.target.value)} style={{ border: '1px solid #e5e7eb', borderRadius: 6, padding: '6px 8px' }}>
              <option value="code">Mã</option>
              <option value="name">Tên</option>
              <option value="price">Giá</option>
            </select>
            <select value={sortDir} onChange={e => setSortDir(e.target.value)} style={{ border: '1px solid #e5e7eb', borderRadius: 6, padding: '6px 8px' }}>
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
    const thumb = r.imageUrl || resolveImageUrlForProduct(r);
    return thumb ? (
      <img src={resolveImg(thumb)} alt=""
        onClick={() => setPreview(thumb)}
        style={{ width:96, height:96, objectFit:'contain', border:'1px solid #e5e7eb', borderRadius:8, cursor:'zoom-in', background:'#fff' }} />
    ) : (
      <span style={{ color:'#9ca3af' }}>{r.imageName || '(chưa có)'}</span>
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
            product={menuEditor.product}
            onClose={async changed => {
              setMenuEditor({ open: false, product: null });
              if (changed) await loadFoodsLite();
            }}
            getCurrentMenus={p => {
              const key = imageKeyFromUrlOrName(p.imageUrl, p.imageName);
              return Array.from(menusOfImage.get(key) || new Set());
            }}
            resolveImageUrl={() => resolveImageUrlForProduct(menuEditor.product)}
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
      ) : (
        <CustomersPanel apiUrl={apiUrl} ALL_LEVELS={ALL_LEVELS} socket={socket} />
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
