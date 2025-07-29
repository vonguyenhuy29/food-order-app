import React, { useEffect, useState } from 'react';
import axios from 'axios';
import io from 'socket.io-client';

const socket = io(process.env.REACT_APP_API_URL);

const UserFoodList = () => {
  const [foods, setFoods] = useState([]);
  const [selectedLevel, setSelectedLevel] = useState(null);
  const [selectedType, setSelectedType] = useState(null);
  const [zoomLevel, setZoomLevel] = useState(1.0);
  const [menuOpen, setMenuOpen] = useState(true);
  const [previewImage, setPreviewImage] = useState(null);
useEffect(() => {
  const socket = new WebSocket(`ws://${window.location.hostname}:5000`);
  socket.onmessage = (msg) => {
    const data = JSON.parse(msg.data);
    if (data.event === 'foodStatusUpdated') {
      fetchFoods(); // hoặc cập nhật trực tiếp state nếu cần tối ưu
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

  useEffect(() => {
    const handleWheel = (e) => {
      if (e.ctrlKey) {
        e.preventDefault();
        setZoomLevel(prev => Math.min(2.5, Math.max(0.4, prev - e.deltaY * 0.0015)));
      }
    };
    window.addEventListener('wheel', handleWheel, { passive: false });
    return () => window.removeEventListener('wheel', handleWheel);
  }, []);

  const fetchFoods = async () => {
    const res = await axios.get(`${process.env.REACT_APP_API_URL}/api/foods`);
    setFoods(res.data);
  };

  const allTypes = Array.from(new Set(foods.map(f => f.type))).sort();

  const filteredTypes = allTypes.filter(type =>
    foods.find(f => f.type === type)?.levelAccess?.includes(selectedLevel)
  );

  const getSoldOutHashes = () => {
    return new Set(foods.filter(f => f.status === "Sold Out").map(f => f.hash));
  };

  const soldOutHashes = getSoldOutHashes();

  const foodsByType = foods.filter(f =>
    f.hash && !soldOutHashes.has(f.hash) &&
    f.levelAccess?.includes(selectedLevel) &&
    (selectedType === null || f.type === selectedType)
  );

  return (
    <div style={{ position: 'relative', height: '100vh', overflow: 'hidden' }}>
      <button
        onClick={() => setMenuOpen(!menuOpen)}
        style={{
          position: 'absolute', top: 20, left: 20, zIndex: 999,
          background: 'rgba(255,255,255,0.1)', color: 'white',
          fontSize: '22px', border: '1px solid rgba(255,255,255,0.3)',
          cursor: 'pointer', borderRadius: '50%', width: '40px', height: '40px',
          backdropFilter: 'blur(6px)', transition: 'background 0.2s ease'
        }}
      >☰</button>

      {menuOpen && (
        <div style={{
          position: 'absolute', top: 0, left: 0, bottom: 0, width: '240px',
          background: '#222', color: 'white', padding: '20px 10px',
          display: 'flex', flexDirection: 'column', zIndex: 998
        }}>
          <div style={{ flexGrow: 1, overflowY: 'auto' }}>
            {!selectedLevel && ["P", "I-I+", "V-One"].map(level => (
              <div key={level} onClick={() => {
                setSelectedLevel(level); setSelectedType(null);
              }} style={sidebarItemStyle}>Level {level}</div>
            ))}
            {selectedLevel && filteredTypes.map(type => (
              <div key={type}
                onClick={() => setSelectedType(type)}
                style={{
                  ...sidebarItemStyle,
                  background: type === selectedType ? '#555' : '#333',
                  fontWeight: type === selectedType ? 'bold' : 'normal'
                }}>{type}</div>
            ))}
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

      <div style={{
        height: '100vh', overflowY: 'auto', background: '#fff8dc',
        padding: '20px', marginLeft: menuOpen ? '240px' : '0',
        transition: 'margin-left 0.3s ease'
      }}>
        {selectedLevel && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: `${16 * zoomLevel}px` }}>
            {foodsByType.map(food => (
              <div key={food.id} style={{
                width: `${220 * zoomLevel}px`,
                transition: 'all 0.2s ease',
                borderRadius: '8px',
                overflow: 'hidden',
                border: '1px solid #ccc',
                background: '#fff'
              }}>
                <img src={food.imageUrl} alt=""
                  onClick={() => setPreviewImage(food.imageUrl)}
                  style={{
                    width: '100%', height: '100%', objectFit: 'cover',
                    display: 'block', cursor: 'pointer'
                  }} />
              </div>
            ))}
            {foodsByType.length === 0 && <p>Không có món nào.</p>}
          </div>
        )}
      </div>

      {previewImage && (
        <div onClick={() => setPreviewImage(null)} style={{
          position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh',
          background: 'rgba(0,0,0,0.75)', display: 'flex',
          alignItems: 'center', justifyContent: 'center', zIndex: 9999,
          cursor: 'zoom-out'
        }}>
          <img src={previewImage} alt="Preview"
            style={{
              maxWidth: '90vw', maxHeight: '90vh',
              borderRadius: '8px', boxShadow: '0 0 15px rgba(0,0,0,0.5)'
            }} />
        </div>
      )}
    </div>
  );
};

const sidebarItemStyle = {
  padding: '10px',
  marginBottom: '6px',
  background: '#333',
  borderRadius: '4px',
  cursor: 'pointer',
  textAlign: 'center'
};

const backButtonStyle = {
  background: '#444',
  color: 'white',
  border: 'none',
  padding: '10px',
  width: '100%',
  cursor: 'pointer',
  fontSize: '14px',
  borderRadius: '6px'
};

export default UserFoodList;
