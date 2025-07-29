import React, { useEffect, useState, useRef } from 'react';
import axios from 'axios';
import io from 'socket.io-client';

const socket = io(process.env.REACT_APP_API_URL);

const UserFoodList = () => {
  const [foods, setFoods] = useState([]);
  const [selectedLevel, setSelectedLevel] = useState(null);
  const [selectedType, setSelectedType] = useState(null);
  // columns determines how many food items are displayed per row (3–6)
  const [columns, setColumns] = useState(4);
  const [menuOpen, setMenuOpen] = useState(true);
  const [previewImage, setPreviewImage] = useState(null);

  // refs to track touch gestures
  const touchStartXRef = useRef(null);
  // we'll no longer pinch-zoom on touch devices; instead we'll use a slider to control zoom
  // remove pinchDistanceRef as we no longer track pinch distances
  const touchStartContextRef = useRef(null); // 'edge' or 'menu'

  // use a ref to track the latest value of menuOpen inside touch handlers
  const menuOpenRef = useRef(menuOpen);

  // update menuOpenRef whenever menuOpen changes
  useEffect(() => {
    menuOpenRef.current = menuOpen;
  }, [menuOpen]);

  useEffect(() => {
    const socket = new WebSocket(`ws://${window.location.hostname}:5000`);
    socket.onmessage = (msg) => {
      const data = JSON.parse(msg.data);
      if (data.event === 'foodStatusUpdated') {
        fetchFoods(); // update state when status changes
      }
    };
    return () => socket.close();
  }, []);

  useEffect(() => {
    fetchFoods();
    socket.on('foodAdded', fetchFoods);
    socket.on('foodStatusUpdated', fetchFoods);
    socket.on('foodDeleted', fetchFoods);
    return () => {
      socket.off('foodAdded');
      socket.off('foodStatusUpdated');
      socket.off('foodDeleted');
    };
  }, []);

  // Enable Ctrl+wheel to adjust number of columns on desktop
  useEffect(() => {
    const handleWheel = (e) => {
      if (e.ctrlKey) {
        e.preventDefault();
        // scroll up (deltaY < 0) means zoom in -> fewer columns; scroll down means zoom out -> more columns
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

  // Handle swipe gestures on touch devices (e.g. iPad) to open or close the menu
  // We no longer handle pinch‑zoom; zoom can be controlled via a slider in the UI
  useEffect(() => {
    const handleTouchStart = (e) => {
      if (e.touches.length === 1) {
        // start swipe
        const startX = e.touches[0].clientX;
        touchStartXRef.current = startX;
        // determine context: open from left edge or close from menu
        if (!menuOpenRef.current && startX < 50) {
          touchStartContextRef.current = 'edge';
        } else if (menuOpenRef.current && startX < 240) {
          touchStartContextRef.current = 'menu';
        } else {
          touchStartContextRef.current = null;
        }
      }
    };
    const handleTouchEnd = (e) => {
      // swipe detection only when there is one finger and ended
      if (
        touchStartXRef.current != null &&
        e.changedTouches.length === 1 &&
        touchStartContextRef.current
      ) {
        const endX = e.changedTouches[0].clientX;
        const deltaX = endX - touchStartXRef.current;
        // open menu: started from left edge and swipe right
        if (touchStartContextRef.current === 'edge' && deltaX > 50) {
          setMenuOpen(true);
        }
        // close menu: started within menu and swipe left
        if (touchStartContextRef.current === 'menu' && deltaX < -50) {
          setMenuOpen(false);
        }
      }
      // reset refs
      touchStartXRef.current = null;
      touchStartContextRef.current = null;
    };
    // attach listeners
    const opts = { passive: false };
    document.addEventListener('touchstart', handleTouchStart, opts);
    document.addEventListener('touchend', handleTouchEnd, opts);
    return () => {
      document.removeEventListener('touchstart', handleTouchStart, opts);
      document.removeEventListener('touchend', handleTouchEnd, opts);
    };
  }, []);

  const fetchFoods = async () => {
    const res = await axios.get(
      `${process.env.REACT_APP_API_URL}/api/foods`
    );
    setFoods(res.data);
  };

  const allTypes = Array.from(new Set(foods.map((f) => f.type))).sort();

  const filteredTypes = allTypes.filter((type) =>
    foods.find((f) => f.type === type)?.levelAccess?.includes(selectedLevel)
  );

  const getSoldOutHashes = () => {
    return new Set(
      foods.filter((f) => f.status === 'Sold Out').map((f) => f.hash)
    );
  };

  const soldOutHashes = getSoldOutHashes();

  // Filter foods by selected level/type and remove sold-out items
  const foodsByTypeRaw = foods.filter(
    (f) =>
      f.hash &&
      !soldOutHashes.has(f.hash) &&
      f.levelAccess?.includes(selectedLevel) &&
      (selectedType === null || f.type === selectedType)
  );

  // Deduplicate items with the same image filename (images with identical names are considered duplicates)
  const foodsByType = [];
  const seenNames = new Set();
  for (const food of foodsByTypeRaw) {
    // extract filename from imageUrl (after the last slash)
    const urlParts = food.imageUrl ? food.imageUrl.split('/') : [];
    const fileName = urlParts[urlParts.length - 1] || food.imageUrl;
    if (!seenNames.has(fileName)) {
      seenNames.add(fileName);
      foodsByType.push(food);
    }
  }

  return (
    <div style={{ position: 'relative', height: '100vh', overflow: 'hidden' }}>
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

      {menuOpen && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            bottom: 0,
            width: '240px',
            background: '#222',
            color: 'white',
            padding: '20px 10px',
            display: 'flex',
            flexDirection: 'column',
            zIndex: 998,
          }}
        >
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
              filteredTypes.map((type) => (
                <div
                  key={type}
                  onClick={() => setSelectedType(type)}
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
                <button onClick={() => setSelectedType(null)} style={backButtonStyle}>
                  ⬅
                </button>
              )}
              {!selectedType && selectedLevel && (
                <button onClick={() => setSelectedLevel(null)} style={backButtonStyle}>
                  ⬅
                </button>
              )}
            </div>
          )}
        </div>
      )}

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
                  transition: 'all 0.2s ease',
                  borderRadius: '8px',
                  overflow: 'hidden',
                  border: '1px solid #ccc',
                  background: '#fff',
                }}
              >
                <img
                  src={food.imageUrl}
                  alt=''
                  onClick={() => setPreviewImage(food.imageUrl)}
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    display: 'block',
                    cursor: 'pointer',
                  }}
                />
              </div>
            ))}
            {foodsByType.length === 0 && <p>Không có món nào.</p>}
          </div>
        )}
      </div>

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
            alt='Preview'
            style={{
              maxWidth: '90vw',
              maxHeight: '90vh',
              borderRadius: '8px',
              boxShadow: '0 0 15px rgba(0,0,0,0.5)',
            }}
          />
        </div>
      )}

      {/* Zoom control slider for touch devices and desktops */}
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
          type='range'
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

const sidebarItemStyle = {
  padding: '10px',
  marginBottom: '6px',
  background: '#333',
  borderRadius: '4px',
  cursor: 'pointer',
  textAlign: 'center',
};

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