import React, { useEffect, useState, useRef } from 'react';
import axios from 'axios';
import io from 'socket.io-client';


const socket = io(process.env.REACT_APP_API_URL, {
  reconnection: true,
  reconnectionAttempts: 10,
  reconnectionDelay: 1000,
  transports: ['websocket'],
});

const SOLD_OUT_MENU = 'Sold out';
const SOLD_OUT_KEY = '__SOLD_OUT__';

const UserFoodList = () => {
  const [foods, setFoods] = useState([]);
  const [connectionError, setConnectionError] = useState(false);
  const [selectedLevel, setSelectedLevel] = useState(null);
  const [selectedType, setSelectedType] = useState(null);
  // columns controls how many cards appear per row (between 3 and 6)
  const [columns, setColumns] = useState(4);
  const [menuOpen, setMenuOpen] = useState(true);
  const [previewImage, setPreviewImage] = useState(null);

  // Refs to track touch gestures and menu state across handlers
  const touchStartXRef = useRef(null);
  const touchStartContextRef = useRef(null);
  const menuOpenRef = useRef(menuOpen);

  // Keep menuOpenRef in sync with state
  useEffect(() => {
    menuOpenRef.current = menuOpen;
  }, [menuOpen]);

  // Manage socket connection status and update connectionError flag
  useEffect(() => {
    const handleDisconnect = () => {
      console.warn('⛔ Mất kết nối tới máy chủ');
      setConnectionError(true);
    };
    const handleConnect = () => {
      setConnectionError(false);
    };
    socket.on('disconnect', handleDisconnect);
    socket.on('connect', handleConnect);
    return () => {
      socket.off('disconnect', handleDisconnect);
      socket.off('connect', handleConnect);
    };
  }, []);

  // When returning from background (e.g. iPad resume), reconnect if needed
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && !socket.connected) {
        console.log('⏳ App resumed, reconnecting socket...');
        socket.connect();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  // Listen to WebSocket events (via a separate ws connection) for status
  useEffect(() => {
    const ws = new WebSocket(`ws://${window.location.hostname}:5000`);
    ws.onmessage = (msg) => {
      const data = JSON.parse(msg.data);
      if (data.event === 'foodStatusUpdated') {
        fetchFoods();
      }
    };
    return () => ws.close();
  }, []);

  // Initial fetch and register socket events for CRUD and reorder
  useEffect(() => {
    fetchFoods();
    socket.on('foodAdded', fetchFoods);
    socket.on('foodStatusUpdated', fetchFoods);
    socket.on('foodDeleted', fetchFoods);
    socket.on('foodsReordered', ({ orderedIds }) => {
      setFoods((prev) => {
        const orderMap = new Map();
        orderedIds.forEach((id, idx) => orderMap.set(id, idx));
        return prev.map((f) => {
          const newOrder = orderMap.has(f.id) ? orderMap.get(f.id) : f.order;
          return { ...f, order: newOrder };
        });
      });
    });
    return () => {
      socket.off('foodAdded');
      socket.off('foodStatusUpdated');
      socket.off('foodDeleted');
      socket.off('foodsReordered');
    };
  }, []);

  // Allow Ctrl+scroll to adjust number of columns on desktop
  useEffect(() => {
    const handleWheel = (e) => {
      if (e.ctrlKey) {
        e.preventDefault();
        setColumns((prev) => {
          if (e.deltaY < 0) {
            return Math.max(3, prev - 1);
          }
          if (e.deltaY > 0) {
            return Math.min(6, prev + 1);
          }
          return prev;
        });
      }
    };
    window.addEventListener('wheel', handleWheel, { passive: false });
    return () => window.removeEventListener('wheel', handleWheel);
  }, []);

  // Handle swipe gestures on touch devices to toggle the menu
  useEffect(() => {
    const handleTouchStart = (e) => {
      if (e.touches.length === 1) {
        const startX = e.touches[0].clientX;
        touchStartXRef.current = startX;
        if (!menuOpenRef.current && startX < 50) {
          touchStartContextRef.current = 'edge';
        } else if (menuOpenRef.current) {
          touchStartContextRef.current = 'menu';
        } else {
          touchStartContextRef.current = null;
        }
      }
    };
    const handleTouchEnd = (e) => {
      if (
        touchStartXRef.current != null &&
        e.changedTouches.length === 1 &&
        touchStartContextRef.current
      ) {
        const endX = e.changedTouches[0].clientX;
        const deltaX = endX - touchStartXRef.current;
        if (touchStartContextRef.current === 'edge' && deltaX > 50) {
          setMenuOpen(true);
        }
        if (touchStartContextRef.current === 'menu' && deltaX < -50) {
          setMenuOpen(false);
        }
      }
      touchStartXRef.current = null;
      touchStartContextRef.current = null;
    };
    const opts = { passive: false };
    document.addEventListener('touchstart', handleTouchStart, opts);
    document.addEventListener('touchend', handleTouchEnd, opts);
    return () => {
      document.removeEventListener('touchstart', handleTouchStart, opts);
      document.removeEventListener('touchend', handleTouchEnd, opts);
    };
  }, []);

  // Fetch the list of foods from the API
  const fetchFoods = async () => {
    const res = await axios.get(`${process.env.REACT_APP_API_URL}/api/foods`);
    setFoods(res.data);
  };

  // Compute available menu types for the selected level
  const allTypes = Array.from(new Set(foods.map((f) => f.type))).sort();
  const filteredTypes = allTypes.filter((type) =>
    foods.find((f) => f.type === type)?.levelAccess?.includes(selectedLevel)
  );
  const menuOptions = [...filteredTypes, SOLD_OUT_MENU];

  const isSoldOutPage = selectedType === SOLD_OUT_KEY;

  // Build a set of sold‑out hashes for filtering
  const soldOutHashes = new Set(
    foods.filter((f) => f.status === 'Sold Out').map((f) => f.hash)
  );

  // Sort foods by order and filter by level/type, removing sold‑out items
  const sortedFoods = [...foods].sort((a, b) => {
    const aOrder = a.order ?? 0;
    const bOrder = b.order ?? 0;
    return aOrder - bOrder;
  });
  const foodsByTypeRaw = sortedFoods.filter((f) => {
    if (isSoldOutPage) {
      return f.status === 'Sold Out' && f.levelAccess?.includes(selectedLevel);
    }
    return (
      f.status !== 'Sold Out' &&
      f.levelAccess?.includes(selectedLevel) &&
      (selectedType === null || f.type === selectedType)
    );
  });


  // Deduplicate by image filename to avoid showing the same dish twice across menus
  const foodsByType = [];
  const seenNames = new Set();
  for (const food of foodsByTypeRaw) {
    const urlParts = food.imageUrl ? food.imageUrl.split('/') : [];
    const fileName = urlParts[urlParts.length - 1] || food.imageUrl;
    if (!seenNames.has(fileName)) {
      seenNames.add(fileName);
      foodsByType.push(food);
    }
  }

  return (
    <div style={{ position: 'relative', height: '100vh', overflow: 'hidden' }}>
      {/* Toggle side menu on desktop/mobile */}
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
      >
        ☰
      </button>
      {/* Connection error banner */}
      {connectionError && (
        <div
          style={{
            position: 'absolute',
            top: '80px',
            left: '50%',
            transform: 'translateX(-50%)',
            backgroundColor: '#ffcccc',
            color: '#a00',
            padding: '10px',
            fontWeight: 'bold',
            borderRadius: '4px',
            zIndex: 1000,
            textAlign: 'center',
            boxShadow: '0 0 10px rgba(0,0,0,0.2)',
          }}
        >
          ⛔ Mất kết nối tới máy chủ. Đang chờ kết nối lại...
        </div>
      )}
      {/* Side menu */}
      {menuOpen && (
        <div
          style={{
          position: 'fixed',
          top: 0,
          left: 0,
          height: '100vh',
          width: '240px',
          background: '#222',
          color: '#fff',
          display: 'flex',
          flexDirection: 'column',
          overflowY: 'auto',
          zIndex: 1000,
          }}
        >
          {/* Render các mục menu ở đây */}

          <div style={{ flexGrow: 1, overflowY: 'auto' }}>
            {!selectedLevel &&
              ['P', 'I-I+', 'V-One'].map((level) => (
                <div
                  key={level}
                  onClick={() => {
                    setSelectedLevel(level);
                    setSelectedType(null);
                  }}
                  style={sidebarItemStyle}
                >
                  Level {level}
                </div>
              ))}
            {selectedLevel &&
              menuOptions.map((type) => (
                <div
                  key={type}
                  onClick={() => setSelectedType(type === SOLD_OUT_MENU ? SOLD_OUT_KEY : type)}
                  style={{
                    ...sidebarItemStyle,
                    background: type === selectedType ? '#555' : '#333',
                    fontWeight: type === selectedType ? 'bold' : 'normal',
                  }}
                >
                  {type}
                </div>
              ))}
          </div>
          {(selectedLevel || selectedType) && (
            <div style={{ paddingTop: '10px', paddingBottom: '10px' }}>
              {selectedType && (
                <button
                  onClick={() => setSelectedType(null)}
                  style={backButtonStyle}
                >
                  ⬅
                </button>
              )}
              {!selectedType && selectedLevel && (
                <button
                  onClick={() => setSelectedLevel(null)}
                  style={backButtonStyle}
                >
                  ⬅
                </button>
              )}
            </div>
          )}
        </div>
      )}
      {/* Main content area showing foods */}
      <div
        style={{
          height: '100vh',
          overflowY: 'auto',
          background: '#fff8dc',
          padding: '20px',
          marginLeft: menuOpen ? '240px' : '0',
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
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    display: 'block',
                  }}
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
      {/* Slider to control number of columns */}
      <div
        style={{
          position: 'fixed',
          top: '50%',
          right: '10px',
          transform: 'translateY(-50%) rotate(270deg)',
          zIndex: 1000,
        }}
      >
        <input
          type="range"
          min={3}
          max={6}
          step={1}
          value={columns}
          onChange={(e) => setColumns(parseInt(e.target.value, 10))}
          style={{ width: '200px' }}
        />
      </div>
    </div>
  );
};

// Styles for the side menu list items
const sidebarItemStyle = {
  padding: '10px',
  marginBottom: '6px',
  background: '#333',
  borderRadius: '4px',
  cursor: 'pointer',
  textAlign: 'center',
};

// Styles for back buttons in the side menu
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