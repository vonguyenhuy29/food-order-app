/**
 * AdminFoodList.jsx — Màn hình Quản trị/Kitchen
 * - UI tiếng Anh hoàn toàn
 * - Tiêu đề sidebar hiển thị "Admin" hoặc "User" theo role
 * - Ẩn dòng info Vai trò/API
 * - History: bỏ cột Role & Count; cột Image hiển thị ảnh thật
 * - Card ảnh giữ tỉ lệ gốc; nút "Sold out / In stock"; trạng thái text + chấm màu bên phải
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import io from 'socket.io-client';

// ===== API & Socket =====
const API =
  process.env.REACT_APP_API_URL ||
  process.env.REACT_APP_API_BASE ||
  '';
const socket = API ? io(API) : io();

const apiUrl = (p) => `${API || ''}${p}`;
function setAuthHeader(token) {
  if (token) axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
  else delete axios.defaults.headers.common['Authorization'];
}

const SOLD_OUT_MENU = 'Sold out';
const SOLD_OUT_KEY = '__SOLD_OUT__';

// ĐÃ bỏ 3 menu cũ
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

function sanitizeMenuName(name) {
  return String(name || '')
    .replace(/\s+/g, ' ')
    .replace(/[^A-Za-z0-9 \-]/g, '')
    .trim()
    .toUpperCase();
}

async function fetchMenuLevels() {
  try {
    const res = await axios.get(apiUrl('/api/menu-levels'));
    return res.data || {};
  } catch (e) {
    console.warn('GET /api/menu-levels fail:', e?.message);
    return {};
  }
}

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

  // Level config (đồng bộ từ server)
  const [levelConfig, setLevelConfig] = useState({});

  // Custom menus (chưa có món, chỉ để hiện bên sidebar)
  const [customMenus, setCustomMenus] = useState(() => {
    try {
      const raw = localStorage.getItem('customMenus');
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  });
  useEffect(() => { localStorage.setItem('customMenus', JSON.stringify(customMenus)); }, [customMenus]);

  // History
  const [showHistory, setShowHistory] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyRows, setHistoryRows] = useState([]);
  const showHistoryRef = useRef(false);
  useEffect(() => { showHistoryRef.current = showHistory; }, [showHistory]);
  const versionRef = useRef(null);

  // ===== Effects =====
  useEffect(() => {
    if (!isLoggedIn) return;

    (async () => {
      await fetchFoods();
      setLevelConfig(await fetchMenuLevels());
    })();

    socket.on('foodAdded', fetchFoods);
    socket.on('foodStatusUpdated', fetchFoods);
    socket.on('foodDeleted', fetchFoods);
    socket.on('foodsReordered', fetchFoods);
    socket.on('foodLevelsUpdated', fetchFoods);
    socket.on('menuLevelsUpdated', async () => setLevelConfig(await fetchMenuLevels()));
    socket.on('statusHistoryAdded', async () => { if (showHistoryRef.current) await fetchStatusHistory(); });

    return () => {
      socket.off('foodAdded', fetchFoods);
      socket.off('foodStatusUpdated', fetchFoods);
      socket.off('foodDeleted', fetchFoods);
      socket.off('foodsReordered', fetchFoods);
      socket.off('foodLevelsUpdated', fetchFoods);
      socket.off('menuLevelsUpdated');
      socket.off('statusHistoryAdded');
    };
  }, [isLoggedIn]);
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
useEffect(() => {
  if (!isLoggedIn) return;
  const onConnect = () => { fetchFoods(); };
  socket.on('connect', onConnect);
  return () => socket.off('connect', onConnect);
}, [isLoggedIn]);

  const fetchFoods = async () => {
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
    }
  };

  async function fetchStatusHistory(params = {}) {
    try {
      setHistoryLoading(true);
      const res = await axios.get(apiUrl('/api/status-history'), { params });
      setHistoryRows(res.data || []);
    } catch (e) {
      alert('Failed to load history: ' + (e?.response?.data?.error || e?.message || ''));
    } finally {
      setHistoryLoading(false);
    }
  }

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
  const sidebarTypes = useMemo(() => {
    const seen = new Set(); const out = [];
    const push = (arr) => arr.forEach(t => { if (t && !seen.has(t)) { seen.add(t); out.push(t); } });
    push(preferredWithData); push(othersFromData); push(customStillEmpty);
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

  // ===== Role-aware actions =====
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

  const handleDeleteEntireMenu = async (menuType, e) => {
    e?.stopPropagation();
    if (!isAdmin) return alert('Admin only.');
    if (!menuType || menuType === SOLD_OUT_KEY) return;

    const items = foods.filter(f => f.type === menuType);
    if (items.length === 0) {
      setCustomMenus(prev => prev.filter(t => t !== menuType));
      return;
    }
    if (!window.confirm(`Delete ALL ${items.length} items in "${menuType}"?`)) return;

    try {
      setBulkDeleting(true);
      for (const it of items) { try { await axios.delete(apiUrl(`/api/foods/${it.id}`)); } catch {} }
      const data = await fetchFoods();
      if (!data.some(f => f.type === menuType)) setCustomMenus(prev => prev.filter(t => t !== menuType));
      const next = MENU_TYPES.find(t => data.some(f => f.type === t)) || data[0]?.type || SOLD_OUT_KEY;
      setSelectedType(next);
      alert(`Deleted ${items.length} items in "${menuType}".`);
    } catch (e) {
      setApiError(e?.message || 'API error');
    } finally {
      setBulkDeleting(false);
    }
  };

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
    try { await axios.post(apiUrl('/api/menu-levels'), { type: name, levelAccess: defaultLv }); } catch {}
    setSelectedType(name);
  };

  const handleAddFood = async (forceType) => {
    if (!isAdmin) return alert('Admin only.');
    const chosenType = forceType || selectedType;
    if (!chosenType || chosenType === SOLD_OUT_KEY) return alert('Select a valid menu first.');
    const chosenLevels = levelConfig[chosenType] || [];

    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*'; input.multiple = true;
    input.onchange = async (e) => {
      const files = Array.from(e.target.files || []);
      for (const file of files) {
        const formData = new FormData();
        formData.append('image', file);
        formData.append('type', chosenType);
        try {
          const uploadRes = await axios.post(apiUrl('/api/upload'), formData);
          const { imageUrl, hash } = uploadRes.data || {};
          const body = { imageUrl, type: chosenType, hash };
          if (chosenLevels.length > 0) body.levelAccess = chosenLevels;
          try { await axios.post(apiUrl('/api/foods'), body); }
          catch (err) { if (err.response?.status === 409) alert('Item already exists in this menu.'); else alert('Add failed: ' + (err?.message || '')); }
        } catch (err) {
          alert('Upload failed: ' + (err?.message || ''));
        }
      }
      await fetchFoods();
    };
    input.click();
  };

  const handleApplyLevels = async () => {
    if (!isAdmin) return alert('Admin only.');
    if (selectedType === SOLD_OUT_KEY) return;
    const levels = levelConfig[selectedType] || [];
    if (!window.confirm(`Apply levels [${levels.join(', ') || '—'}] to ALL items in "${selectedType}"?`)) return;
    try {
      await axios.post(apiUrl('/api/update-levels-by-type'), { type: selectedType, levelAccess: levels });
      await axios.post(apiUrl('/api/menu-levels'), { type: selectedType, levelAccess: levels });
      await fetchFoods();
      setLevelConfig(await fetchMenuLevels());
      alert('Levels applied.');
    } catch (e) {
      setApiError(e?.message || 'API error');
    }
  };

  // Drag & drop reorder (admin only)
  const handleDragStart = (id) => { if (!isAdmin) return; setDraggedId(id); };
  const handleDragOver = (e) => { if (!isAdmin) return; e.preventDefault(); };
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

  // ===== Dữ liệu hiển thị =====
  const isSoldOutPage = selectedType === SOLD_OUT_KEY;
  const listRaw = isSoldOutPage ? foods.filter(f => f.status === 'Sold Out') : foods.filter(f => f.type === selectedType);

  const foodsByType = [];
  const seenNames = new Set();
  for (const f of listRaw) {
    const parts = f.imageUrl ? f.imageUrl.split('/') : [];
    const name = parts[parts.length - 1] || f.imageUrl;
    if (!seenNames.has(name)) { seenNames.add(name); foodsByType.push(f); }
  }

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
            Default: <b>admin/admin123</b> or <b>kitchen/kitchen123</b> (change on server).
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
    <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', height: '100vh' }}>
      {/* Sidebar */}
      <div style={{ background: '#111', color: '#fff', padding: 16, overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <h3 style={{ margin: 0 }}>{isAdmin ? 'Admin' : 'User'}</h3>
          <div style={{ display: 'flex', gap: 8 }}>
            {/* Admin & Kitchen: xem lịch sử */}
            <button
              onClick={async () => { setShowHistory(true); await fetchStatusHistory(); }}
              style={{ background: '#374151', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 10px', cursor: 'pointer', fontSize: 12 }}
            >
              History
            </button>
            <button onClick={handleLogout}
              style={{ background: '#ef4444', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 10px', cursor: 'pointer', fontSize: 12 }}>
              Sign out
            </button>
          </div>
        </div>

        {/* Ẩn dòng info Vai trò/API theo yêu cầu */}
        {/* <div style={{ fontSize: 12, color: '#9ca3af', marginBottom: 8 }}>
          Role: <b>{role}</b> • API: <b>{API || '(relative /api)'}</b>
          {apiError ? <span style={{ color: '#fca5a5' }}> • Error: {apiError}</span> : null}
        </div> */}

        {isAdmin && (
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
      </div>

      {/* Main */}
      <div style={{ padding: 16, background: '#fff8dc', overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <h2 style={{ margin: 0 }}>{selectedType === SOLD_OUT_KEY ? SOLD_OUT_MENU : selectedType}</h2>

          {selectedType !== SOLD_OUT_KEY && isAdmin && (
            <>
              <button
                onClick={() => handleAddFood()}
                title="Add images (items) into this menu"
                style={{ padding: '8px 12px', background: '#10b981', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' }}
              >
                + Add item
              </button>

              <button
                onClick={handleApplyLevels}
                title="Apply levels to all items in this menu"
                style={{ padding: '8px 12px', background: '#6366f1', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' }}
              >
                Apply levels
              </button>

              <button
                onClick={(e) => handleDeleteEntireMenu(selectedType, e)}
                disabled={bulkDeleting || !sidebarTypesWithFallback.includes(selectedType)}
                title="Delete the selected menu (all items & images)"
                style={{ padding: '8px 12px', background: bulkDeleting ? '#9ca3af' : '#dc2626', color: '#fff', border: 'none', borderRadius: 8, cursor: bulkDeleting ? 'not-allowed' : 'pointer' }}
              >
                {bulkDeleting ? 'Deleting…' : '🗑️ Delete this menu'}
              </button>
            </>
          )}
        </div>

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

        {/* Grid: ảnh theo tỉ lệ gốc, không crop */}
        <div style={{ display: 'flex', flexWrap: 'wrap' }}>
          {foodsByType.map((food) => {
            const toSoldOut = food.status === 'Available';
            const toggleLabel = toSoldOut ? 'Sold out' : 'In stock';
            const statusTextColor = toSoldOut ? '#065f46' : '#991b1b';
            const statusDotColor  = toSoldOut ? '#10b981' : '#ef4444';

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
                {/* Image keeps original ratio */}
                <div style={{ width: '100%', overflow: 'visible', background: '#fff' }}>
                  <img src={food.imageUrl} alt="" style={{ width: '100%', height: 'auto', display: 'block' }} />
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
                    title={toSoldOut ? 'Set to SOLD OUT' : 'Set to IN STOCK'}
                  >
                    {toggleLabel}
                  </button>

                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      fontSize: 12,
                      fontWeight: 700,
                      color: statusTextColor,
                      whiteSpace: 'nowrap',
                    }}
                    title={food.status}
                  >
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: statusDotColor, display: 'inline-block' }} />
                    {food.status}
                  </span>
                </div>

                {isAdmin && (
                  <div style={{ padding: '0 10px 10px' }}>
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

          {foodsByType.length === 0 && (
            <div style={{ color: '#6b7280', padding: 12 }}>No items to display.</div>
          )}
        </div>
      </div>

      {/* ===== Status History Modal (Admin & Kitchen) ===== */}
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
              <input type="date" onChange={(e) => fetchStatusHistory({ from: e.target.value })} />
              <input type="date" onChange={(e) => fetchStatusHistory({ to: e.target.value })} />
              <input placeholder="User" onBlur={(e) => fetchStatusHistory({ user: e.target.value })} style={{ border: '1px solid #ddd', borderRadius: 6, padding: '6px 8px' }} />
              <input placeholder="Type" onBlur={(e) => fetchStatusHistory({ type: e.target.value })} style={{ border: '1px solid #ddd', borderRadius: 6, padding: '6px 8px' }} />
              <select onChange={(e) => fetchStatusHistory({ toStatus: e.target.value || undefined })} defaultValue="">
                <option value="">-- New status --</option>
                <option value="Available">Available</option>
                <option value="Sold Out">Sold Out</option>
              </select>
            </div>

            {/* Table (Role & Count removed; Image shows actual thumbnail) */}
            <div style={{ border: '1px solid #eee', borderRadius: 8, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead style={{ background: '#f9fafb' }}>
                  <tr>
                    <th style={th}>Time</th>
                    <th style={th}>User</th>
                    <th style={th}>Image</th>
                    <th style={th}>Type</th>
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
                          ? <img src={h.imageUrl} alt="" style={{ width: 60, height: 60, objectFit: 'cover', borderRadius: 6, border: '1px solid #eee' }} />
                          : (h.imageName || '')}
                      </td>
                      <td style={td}>{h.type}</td>
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
    </div>
  );
}
