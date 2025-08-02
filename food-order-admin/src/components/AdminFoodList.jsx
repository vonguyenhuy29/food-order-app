import React, { useEffect, useState } from 'react';
import axios from 'axios';
import io from 'socket.io-client';

const socket = io(process.env.REACT_APP_API_URL);

const AdminFoodList = () => {
  const [foods, setFoods] = useState([]);
  const [selectedType, setSelectedType] = useState("SNACK MENU");
  const [draggedId, setDraggedId] = useState(null);

  useEffect(() => {
    fetchFoods();
    socket.on('foodAdded', fetchFoods);
    socket.on('foodStatusUpdated', fetchFoods);
    socket.on('foodDeleted', fetchFoods);
    socket.on('foodsReordered', fetchFoods);
    return () => {
      socket.off('foodAdded');
      socket.off('foodStatusUpdated');
      socket.off('foodDeleted');
      socket.off('foodsReordered');
    };
  }, []);

  const fetchFoods = async () => {
    const res = await axios.get(`${process.env.REACT_APP_API_URL}/api/foods`);
    setFoods(res.data);
  };

  const handleToggleStatus = async (id, status) => {
    const newStatus = status === "Available" ? "Sold Out" : "Available";
    await axios.post(`${process.env.REACT_APP_API_URL}/api/update-status/${id}`, { newStatus });
  };

  const handleDragStart = (id) => {
    setDraggedId(id);
  };

  const handleDrop = async (targetId) => {
    if (draggedId === null || draggedId === targetId) return;
    const currentIndex = foods.findIndex(f => f.id === draggedId);
    const targetIndex = foods.findIndex(f => f.id === targetId);
    const updated = [...foods];
    const [moved] = updated.splice(currentIndex, 1);
    updated.splice(targetIndex, 0, moved);
    setFoods(updated);
    await axios.post(`${process.env.REACT_APP_API_URL}/api/reorder-foods`, {
      orderedIds: updated.map(f => f.id)
    });
  };

  const menuTypes = [
    "SNACK TRAVEL", "SNACK MENU", "CLUB MENU", "HOTEL MENU",
    "HOTEL MENU BEFORE 11AM", "HOTEL MENU AFTER 11PM",
    "VIP MENU", "WINE MENU - KOREAN", "WINE MENU - ENGLISH",
    "WINE MENU - CHINESE", "WINE MENU - JAPANESE",
    "VIP MENU AFTER 11PM"
  ];

  const foodsByType = foods.filter(f => f.type === selectedType);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', height: '100vh' }}>
      <div style={{ background: '#111', color: '#fff', padding: '20px', overflowY: 'auto' }}>
        <h3>🍱 Admin Menu</h3>
        {menuTypes.map(type => (
          <div key={type}
            onClick={() => setSelectedType(type)}
            style={{
              padding: '10px',
              background: selectedType === type ? '#555' : '#222',
              borderRadius: '5px',
              marginBottom: '6px',
              cursor: 'pointer'
            }}>
            {type}
          </div>
        ))}
      </div>
      <div style={{ padding: '20px', background: '#fff8dc', overflowY: 'auto' }}>
        <h2>{selectedType}</h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', marginTop: '20px' }}>
          {foodsByType.map(food => (
            <div key={food.id}
              draggable
              onDragStart={() => handleDragStart(food.id)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => handleDrop(food.id)}
              style={{
                position: 'relative',
                width: '220px',
                border: '1px solid #ccc',
                borderRadius: '6px',
                overflow: 'hidden',
                background: '#fff'
              }}
              onClick={() => handleToggleStatus(food.id, food.status)}>
              <img src={food.imageUrl} alt="" style={{ width: 'auto', maxHeight: '315px', objectFit: 'contain', display: 'block', backgroundColor: '#fff' }} />
              {food.status === "Sold Out" && (
                <div style={{
                  position: 'absolute', top: 0, left: 0,
                  width: '100%', height: '100%',
                  backgroundColor: 'rgba(0,0,0,0.5)',
                  color: '#fff', display: 'flex',
                  alignItems: 'center', justifyContent: 'center',
                  fontWeight: 'bold'
                }}>
                  SOLD OUT
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default AdminFoodList;
