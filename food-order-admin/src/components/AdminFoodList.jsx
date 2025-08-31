import React, { useEffect, useState } from 'react';
import axios from 'axios';
import io from 'socket.io-client';

// Shared socket instance for the admin interface.  It listens for
// CRUD events as well as reorder notifications to keep the list in
// sync with other clients.
const socket = io(process.env.REACT_APP_API_URL);

/**
 * AdminFoodList renders the administrative interface for managing
 * food items.  Administrators can select a menu type, view all foods
 * within that type, toggle their status between Available and Sold Out,
 * delete foods, add new foods by uploading images, and reorder items
 * via drag‑and‑drop.  Real‑time updates are propagated to all clients
 * via Socket.IO.
 */
const AdminFoodList = () => {
  const [foods, setFoods] = useState([]);
  const [selectedType, setSelectedType] = useState('SNACK MENU');
  const [draggedId, setDraggedId] = useState(null);

  // Load foods on mount and register socket listeners for CRUD/reorder events.
  useEffect(() => {
    fetchFoods();
    socket.on('foodAdded', fetchFoods);
    socket.on('foodStatusUpdated', fetchFoods);
    socket.on('foodDeleted', fetchFoods);
    socket.on('foodsReordered', fetchFoods);
    return () => {
      socket.off('foodAdded', fetchFoods);
      socket.off('foodStatusUpdated', fetchFoods);
      socket.off('foodDeleted', fetchFoods);
      socket.off('foodsReordered', fetchFoods);
    };
  }, []);

  // Fetch the list of foods from the API
  const fetchFoods = async () => {
    const res = await axios.get(`${process.env.REACT_APP_API_URL}/api/foods`);
    setFoods(res.data);
  };

  // Toggle a food's status between Available and Sold Out
  const handleToggleStatus = async (id, status) => {
    const newStatus = status === 'Available' ? 'Sold Out' : 'Available';
    await axios.post(`${process.env.REACT_APP_API_URL}/api/update-status/${id}`, { newStatus });
  };

  // Delete a food after confirmation
  const handleDeleteFood = async (id) => {
    if (!window.confirm('Bạn có chắc muốn xoá món này?')) return;
    await axios.delete(`${process.env.REACT_APP_API_URL}/api/foods/${id}`);
  };

  // Upload and add new foods to the selected menu type.  Supports multiple
  // file selection.  Each image is uploaded, then posted to the foods API.
  const handleAddFood = async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    input.onchange = async (e) => {
      const files = Array.from(e.target.files);
      for (const file of files) {
        const formData = new FormData();
        formData.append('image', file);
        formData.append('type', selectedType);
        // Upload the image to obtain imageUrl and hash
        const uploadRes = await axios.post(`${process.env.REACT_APP_API_URL}/api/upload`, formData);
        const { imageUrl, hash } = uploadRes.data;
        try {
          await axios.post(`${process.env.REACT_APP_API_URL}/api/foods`, {
            imageUrl,
            type: selectedType,
            hash,
          });
        } catch (err) {
          if (err.response?.status === 409) {
            alert('❌ Món ăn đã tồn tại trong menu này!');
          } else {
            alert('Lỗi thêm món: ' + err.message);
          }
        }
      }
    };
    input.click();
  };

  // Record which item is being dragged
  const handleDragStart = (id) => {
    setDraggedId(id);
  };

  // Reorder items when dropped onto another item.  The updated order is
  // persisted by sending the ordered list of IDs to the reorder endpoint.
  const handleDrop = async (targetId) => {
    if (draggedId === null || draggedId === targetId) return;
    const currentIndex = foods.findIndex((f) => f.id === draggedId);
    const targetIndex = foods.findIndex((f) => f.id === targetId);
    const updated = [...foods];
    const [moved] = updated.splice(currentIndex, 1);
    updated.splice(targetIndex, 0, moved);
    setFoods(updated);
    await axios.post(`${process.env.REACT_APP_API_URL}/api/reorder-foods`, {
      orderedIds: updated.map((f) => f.id),
    });
  };

  // The list of menu types available.  To add new types, append here.
  const menuTypes = [
    'SNACK TRAVEL',
    'SNACK MENU',
    'CLUB MENU',
    'HOTEL MENU',
    'HOTEL MENU BEFORE 11AM',
    'HOTEL MENU AFTER 11PM',
    'VIP MENU',
    'WINE MENU - KOREAN',
    'WINE MENU - ENGLISH',
    'WINE MENU - CHINESE',
    'WINE MENU - JAPANESE',
    'VIP MENU AFTER 11PM',
  ];

  // Filter foods to those belonging to the currently selected menu type
  const foodsByType = foods.filter((f) => f.type === selectedType);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', height: '100vh' }}>
      {/* Sidebar listing menu types */}
      <div style={{ background: '#111', color: '#fff', padding: '20px', overflowY: 'auto' }}>
        <h3>🍱 Admin Menu</h3>
        {menuTypes.map((type) => (
          <div
            key={type}
            onClick={() => setSelectedType(type)}
            style={{
              padding: '10px',
              background: selectedType === type ? '#555' : '#222',
              borderRadius: '5px',
              marginBottom: '6px',
              cursor: 'pointer',
            }}
          >
            {type}
          </div>
        ))}
      </div>
      {/* Main panel showing foods for the selected type */}
      <div style={{ padding: '20px', background: '#fff8dc', overflowY: 'auto' }}>
        <h2>{selectedType}</h2>
        {/* Add Food button 
        <button
          onClick={handleAddFood}
          style={{
            padding: '8px 12px',
            background: '#28a745',
            color: '#fff',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            marginBottom: '16px',
          }}
        >
          ➕ Thêm món
        </button> */}
        {/* List of food cards.  Flex with wrap; margins ensure spacing */}
        <div style={{ display: 'flex', flexWrap: 'wrap' }}>
          {foodsByType.map((food) => (
            <div
              key={food.id}
              draggable
              onDragStart={() => handleDragStart(food.id)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => handleDrop(food.id)}
              onClick={() => handleToggleStatus(food.id, food.status)}
              style={{
                position: 'relative',
                width: '220px',
                border: '1px solid #ccc',
                borderRadius: '6px',
                overflow: 'hidden',
                background: '#fff',
                marginRight: '12px',
                marginBottom: '12px',
              }}
            >
              {/*
               * Render the food image.  Use objectFit:'contain' and
               * maxHeight to preserve the aspect ratio while scaling
               * down to fit within the card.  The width stays
               * "auto" so images with different aspect ratios are
               * sized consistently, matching the appearance in the user
               * interface.  The background remains white to avoid
               * transparent edges on PNGs.
               */}
              <img
                src={food.imageUrl}
                alt=''
                style={{
                  width: 'auto',
                  maxHeight: '315px',
                  objectFit: 'contain',
                  display: 'block',
                  backgroundColor: '#fff',
                }}
              />
              {food.status === 'Sold Out' && (
                <div
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                    backgroundColor: 'rgba(0,0,0,0.5)',
                    color: '#fff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 'bold',
                  }}
                >
                  SOLD OUT
                </div>
              )}
              {/* Delete button (X) 
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleDeleteFood(food.id);
                }}
                style={{
                  position: 'absolute',
                  top: '5px',
                  right: '5px',
                  background: 'red',
                  color: 'white',
                  border: 'none',
                  borderRadius: '50%',
                  width: '25px',
                  height: '25px',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  zIndex: 20,
                }}
              >
                X
              </button>*/}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default AdminFoodList;