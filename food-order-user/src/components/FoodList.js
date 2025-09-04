import React, { useEffect, useState, useRef, useCallback } from 'react';
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

const SOLD_OUT_MENU = 'Sold out';
const SOLD_OUT_KEY = '__SOLD_OUT__';
const LEVELS = ['P', 'I-I+', 'V-One'];

// ===== Cấu hình gesture menu =====
const MENU_WIDTH = 240;      // px (khớp width sidebar)
const EDGE_ZONE = 30;        // px từ mép trái cho "edge swipe"
const SWIPE_THRESH = 50;     // px tối thiểu để coi là vuốt mở/đóng
const ANGLE_GUARD = 1.5;     // |dx| phải > ANGLE_GUARD * |dy|

const UserFoodList = () => {
  const [foods, setFoods] = useState([]);
  const [connectionError, setConnectionError] = useState(false);
  const [apiError, setApiError] = useState(null);

  // Trạng thái kết nối: 'connecting' | 'connected' | 'offline'
  const [connState, setConnState] = useState('connecting');
  // Lưu thời điểm đồng bộ gần nhất (để hiển thị)
  const [lastSyncAt, setLastSyncAt] = useState(null);

  const [selectedLevel, setSelectedLevel] = useState(null);
  const [selectedType, setSelectedType] = useState(null);
  const [columns, setColumns] = useState(4); // 3..6
  const [menuOpen, setMenuOpen] = useState(true);
  const [previewImage, setPreviewImage] = useState(null);

  // Touch & menu state
  const touchStartXRef = useRef(null);
  const touchStartYRef = useRef(null);
  const touchStartContextRef = useRef(null); // 'edge' | 'menu' | 'content'
  const swipingRef = useRef(false);
  const menuOpenRef = useRef(menuOpen);
  const versionRef = useRef(null);

  // Slider refs
  const sliderRef = useRef(null);
  const draggingRef = useRef(false);

  useEffect(() => { menuOpenRef.current = menuOpen; }, [menuOpen]);

  // API
  const fetchFoods = useCallback(async () => {
    try {
      const res = await axios.get(apiUrl('/api/foods'));
      setFoods(res.data || []);
      setApiError(null);
      setConnState('connected');     // trạng thái xanh
      setLastSyncAt(new Date());     // thời gian sync
    } catch (e) {
      console.error('GET /api/foods failed:', e?.message);
      setApiError(e?.message || 'API error');
      setFoods([]);
      setConnState('offline');
    }
  }, []);

  // Socket status banner + vòng đời reconnect (tất cả trong useEffect)
  useEffect(() => {
    const handleDisconnect = () => {
      console.warn('⛔ Mất kết nối');
      setConnectionError(true);
      setConnState('offline');
    };
    const handleConnect = () => {
      setConnectionError(false);
      setConnState('connecting'); // vào lại coi như đang sync
      fetchFoods();
    };
    const handleReconnectAttempt = () => setConnState('connecting');
    const handleReconnectError = () => setConnState('offline');
    const handleReconnect = () => { setConnState('connecting'); fetchFoods(); };

    socket.on('disconnect', handleDisconnect);
    socket.on('connect', handleConnect);
    socket.on('reconnect_attempt', handleReconnectAttempt);
    socket.on('reconnect_error', handleReconnectError);
    socket.on('reconnect', handleReconnect);

    return () => {
      socket.off('disconnect', handleDisconnect);
      socket.off('connect', handleConnect);
      socket.off('reconnect_attempt', handleReconnectAttempt);
      socket.off('reconnect_error', handleReconnectError);
      socket.off('reconnect', handleReconnect);
    };
  }, [fetchFoods]);

  // Auto reload when backend announces a new app version
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

  // Reconnect & refresh when resuming app (iOS/Safari friendly)
  useEffect(() => {
    const wakeAndSync = () => {
      if (document.visibilityState !== 'visible') return;
      setConnState('connecting');

      if (!socket.connected) {
        console.log('⏳ App resumed, reconnecting socket...');
        socket.connect();
      }
      // Dù còn "connected" vẫn fetch để lấy snapshot mới nhất
      fetchFoods();
    };

    // iOS/Safari: nghe nhiều event để chắc ăn
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
  }, [fetchFoods]);

  // Initial fetch & socket data events
  useEffect(() => {
    fetchFoods();
    socket.on('foodAdded', fetchFoods);
    socket.on('foodStatusUpdated', fetchFoods);
    socket.on('foodDeleted', fetchFoods);
    socket.on('foodsReordered', ({ orderedIds }) => {
      setFoods((prev) => {
        const orderMap = new Map();
        orderedIds.forEach((id, idx) => orderMap.set(id, idx));
        return prev.map((f) => ({ ...f, order: orderMap.has(f.id) ? orderMap.get(f.id) : f.order }));
      });
    });
    // ⭐ realtime khi Admin bấm "Áp dụng" level
    socket.on('foodLevelsUpdated', fetchFoods);

    return () => {
      socket.off('foodAdded', fetchFoods);
      socket.off('foodStatusUpdated', fetchFoods);
      socket.off('foodDeleted', fetchFoods);
      socket.off('foodsReordered');
      socket.off('foodLevelsUpdated', fetchFoods);
    };
  }, [fetchFoods]);

  // Types per level + Sold out menu option
  const allTypes = Array.from(new Set(foods.map((f) => f.type))).sort();
  const filteredTypes = selectedLevel
    ? allTypes.filter((type) => foods.some((f) => f.type === type && f.levelAccess?.includes(selectedLevel)))
    : [];
  const menuOptions = [...filteredTypes, SOLD_OUT_MENU];
  const isSoldOutPage = selectedType === SOLD_OUT_KEY;

  // Sort & filter
  const sortedFoods = [...foods].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const foodsByTypeRaw = sortedFoods.filter((f) => {
    if (!selectedLevel) return false; // chưa chọn level thì chưa hiển thị grid
    if (isSoldOutPage) {
      return f.status === 'Sold Out' && f.levelAccess?.includes(selectedLevel);
    }
    return (
      f.status !== 'Sold Out' &&
      f.levelAccess?.includes(selectedLevel) &&
      (selectedType === null || f.type === selectedType)
    );
  });

  // Deduplicate by image file name
  const foodsByType = [];
  const seenNames = new Set();
  for (const food of foodsByTypeRaw) {
    const parts = food.imageUrl ? food.imageUrl.split('/') : [];
    const fileName = parts[parts.length - 1] || food.imageUrl;
    if (!seenNames.has(fileName)) {
      seenNames.add(fileName);
      foodsByType.push(food);
    }
  }

  // --- Funnel fill math ---
  const minCols = 3;
  const maxCols = 6;
  const pct = (columns - minCols) / (maxCols - minCols); // 0..1
  const innerTop = 6;
  const innerBottom = 154;
  const innerHeight = innerBottom - innerTop; // 148
  const fillH = Math.max(0, innerHeight * pct);
  const fillY = innerBottom - fillH;

  const setColsFromPointer = (clientY) => {
    const el = sliderRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const rel = (clientY - rect.top) / rect.height; // 0 (top) -> 1 (bottom)
    const ratio = 1 - Math.max(0, Math.min(1, rel)); // invert: kéo lên tăng
    const raw = minCols + ratio * (maxCols - minCols);
    const stepped = Math.round(raw); // bước nguyên 3..6
    const clamped = Math.max(minCols, Math.min(maxCols, stepped));
    setColumns(clamped);
  };

  const onPointerDown = (e) => {
    draggingRef.current = true;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setColsFromPointer(e.clientY);
  };

  const onPointerMove = (e) => {
    if (!draggingRef.current) return;
    setColsFromPointer(e.clientY);
  };

  const onPointerUp = (e) => {
    draggingRef.current = false;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
      setColumns((c) => Math.min(maxCols, c + 1));
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
      setColumns((c) => Math.max(minCols, c - 1));
    }
  };

  // ======= Touch swipe để mở/đóng sidebar =======
  const handleTouchStart = (e) => {
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    touchStartXRef.current = t.clientX;
    touchStartYRef.current = t.clientY;

    // Xác định context bắt đầu
    if (!menuOpenRef.current && t.clientX <= EDGE_ZONE) {
      touchStartContextRef.current = 'edge'; // edge-swipe mở menu
    } else if (menuOpenRef.current && t.clientX <= MENU_WIDTH) {
      touchStartContextRef.current = 'menu'; // vuốt trong vùng menu để đóng
    } else {
      touchStartContextRef.current = 'content';
    }
    swipingRef.current = false;
  };

  const handleTouchMove = (e) => {
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    const dx = t.clientX - (touchStartXRef.current ?? t.clientX);
    const dy = t.clientY - (touchStartYRef.current ?? t.clientY);

    // Kích hoạt chế độ swipe nếu ưu thế ngang rõ rệt
    if (!swipingRef.current && Math.abs(dx) > 12 && Math.abs(dx) > ANGLE_GUARD * Math.abs(dy)) {
      swipingRef.current = true;
    }

    if (swipingRef.current) {
      // Ngăn cuộn dọc khi đang swipe ngang
      e.preventDefault();
    }
  };

  const handleTouchEnd = (e) => {
    if (!swipingRef.current) return;

    const changedTouch = e.changedTouches && e.changedTouches[0];
    const endX = changedTouch ? changedTouch.clientX : null;
    const startX = touchStartXRef.current ?? endX;
    const dx = endX !== null ? (endX - startX) : 0;
    const ctx = touchStartContextRef.current;

    if (ctx === 'edge') {
      // Vuốt phải để mở
      if (dx > SWIPE_THRESH) setMenuOpen(true);
    } else if (ctx === 'menu') {
      // Vuốt trái để đóng
      if (dx < -SWIPE_THRESH) setMenuOpen(false);
    } else {
      // Khi menu đang mở, cho phép vuốt trái ở nội dung để đóng nhanh
      if (menuOpenRef.current && dx < -SWIPE_THRESH) setMenuOpen(false);
      // (Không auto-open từ content khi đang đóng; chỉ edge-swipe mới mở)
    }
  };
  // ============================================================

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
          width: '40px',
          height: '40px',
          backdropFilter: 'blur(6px)',
          transition: 'background 0.2s ease',
        }}
        aria-label="Toggle menu"
      >
        ☰
      </button>

      {/* Connection status pill (dịu, không gây hoang mang) */}
      <div
        style={{
          position: 'absolute',
          top: 20,
          right: 20,
          zIndex: 1000,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 10px',
          borderRadius: 999,
          background: (
            connState === 'connected' ? 'rgba(34,197,94,0.15)' :   // xanh: #22c55e
            connState === 'connecting' ? 'rgba(59,130,246,0.15)' : // xanh dương: #3b82f6
            'rgba(115,115,115,0.15)'                               // xám: #737373
          ),
          color: (
            connState === 'connected' ? '#166534' :
            connState === 'connecting' ? '#1e3a8a' :
            '#374151'
          ),
          border: '1px solid rgba(0,0,0,0.08)',
          backdropFilter: 'blur(6px)',
          fontWeight: 600,
        }}
      >
        <span
          style={{
            width: 8, height: 8, borderRadius: '50%',
            background: (
              connState === 'connected' ? '#22c55e' :
              connState === 'connecting' ? '#3b82f6' :
              '#9ca3af'
            )
          }}
        />
        <span>
          {connState === 'connected' && <>✓ Connected{lastSyncAt ? ` • ${lastSyncAt.toLocaleTimeString()}` : ''}</>}
          {connState === 'connecting' && 'Connecting…'}
          {connState === 'offline' && 'Trying to reconnect…'}
        </span>
      </div>

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
          <div style={{ flexGrow: 1, overflowY: 'auto' }}>
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

            {selectedLevel &&
              menuOptions.map((type) => {
                const isActive =
                  (type === SOLD_OUT_MENU && selectedType === SOLD_OUT_KEY) ||
                  (type !== SOLD_OUT_MENU && selectedType === type);

                return (
                  <div
                    key={type}
                    onClick={() => setSelectedType(type === SOLD_OUT_MENU ? SOLD_OUT_KEY : type)}
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
          </div>

          {(selectedLevel || selectedType) && (
            <div style={{ paddingTop: '10px', paddingBottom: '10px' }}>
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

      {/* Main grid */}
      <div
        style={{
          height: '100vh',
          overflowY: 'auto',
          background: '#fff8dc',
          padding: '20px',
          marginLeft: menuOpen ? `${MENU_WIDTH}px` : '0',
          transition: 'margin-left 0.3s ease',
        }}
      >
        {selectedLevel && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${columns}, 1fr)`,
              gap: '16px',
            }}
          >
            {foodsByType.map((food) => (
              <div
                key={food.id}
                style={{
                  borderRadius: '8px',
                  overflow: 'hidden',
                  border: '1px solid #ccc',
                  background: '#fff',
                  cursor: 'pointer',
                }}
                onClick={() => setPreviewImage(food.imageUrl)}
              >
                <img
                  src={food.imageUrl}
                  alt=""
                  style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                />
              </div>
            ))}
            {foodsByType.length === 0 && <p>Không có món nào.</p>}
          </div>
        )}
      </div>

      {/* Preview overlay */}
      {previewImage && (
        <div
          onClick={() => setPreviewImage(null)}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh',
            background: 'rgba(0,0,0,0.75)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            cursor: 'zoom-out',
          }}
        >
          <img
            src={previewImage}
            alt="Preview"
            style={{
              maxWidth: '90vw',
              maxHeight: '90vh',
              borderRadius: '8px',
              boxShadow: '0 0 15px rgba(0,0,0,0.5)',
            }}
          />
        </div>
      )}

      {/* Funnel slider (custom, pointer-based) */}
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

        {/* Khung viền */}
          <path
            d="M6 6 L22 6 L18 154 L10 154 Z"
            fill="transparent"
            stroke="#8a8a8a"
            strokeWidth="2"
            strokeLinejoin="round"
          />

          {/* Fill theo giá trị */}
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
