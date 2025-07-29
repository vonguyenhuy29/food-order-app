import React, { useEffect, useState } from 'react';
import axios from 'axios';
import io from 'socket.io-client';

const socket = io(process.env.REACT_APP_API_URL);

const AdminFoodList = () => {
  const [foods, setFoods] = useState([]);
  const [selectedType, setSelectedType] = useState("SNACK MENU");

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

  const fetchFoods = async () => {
    const res = await axios.get(`${process.env.REACT_APP_API_URL}/api/foods`);
    setFoods(res.data);
  };

  const handleToggleStatus = async (id, status) => {
    const newStatus = status === "Available" ? "Sold Out" : "Available";
    await axios.post(`${process.env.REACT_APP_API_URL}/api/update-status/${id}`, { newStatus });
  };

  const handleDeleteFood = async (id) => {
    if (!window.confirm("Xoá món ăn này?")) return;
    await axios.delete(`${process.env.REACT_APP_API_URL}/api/foods/${id}`);
  };

  const handleAddFood = async () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.multiple = true;

    input.onchange = async (e) => {
      const files = Array.from(e.target.files);
      for (const file of files) {
        const formData = new FormData();
        formData.append("image", file);
        formData.append("type", selectedType);
        const uploadRes = await axios.post(`${process.env.REACT_APP_API_URL}/api/upload`, formData);
        const { imageUrl, hash } = uploadRes.data;
        try {
  await axios.post(`${process.env.REACT_APP_API_URL}/api/foods`, {
    imageUrl,
    type: selectedType,
    hash
  });
  fetchFoods();
} catch (addErr) {
  if (addErr.response?.status === 409) {
    alert("❌ Món ăn đã tồn tại trong menu này!");
  } else {
    alert("Lỗi thêm món: " + addErr.message);
  }
}

      }
    };

    input.click();
  };

  const menuTypes = [
  "SNACK TRAVEL", "SNACK MENU", "CLUB MENU", "HOTEL MENU",
  "HOTEL MENU BEFORE 11AM", "HOTEL MENU AFTER 11PM",
  "VIP MENU", "WINE MENU - KOREAN", "WINE MENU - ENGLISH",
  "WINE MENU - CHINESE", "WINE MENU - JAPANESE",
  "VIP MENU AFTER 11PM"  // ✅ thêm menu mới vào đây
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
        <button onClick={handleAddFood}>➕ Thêm món</button>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', marginTop: '20px' }}>
          {foodsByType.map(food => (
            <div key={food.id} style={{
              position: 'relative',
              width: '220px',
              border: '1px solid #ccc',
              borderRadius: '6px',
              overflow: 'hidden',
              background: '#fff'
            }} onClick={() => handleToggleStatus(food.id, food.status)}>
              <img src={food.imageUrl} alt="" style={{ width: 'auto',maxHeight: '315px', objectFit: 'contain', display: 'block',backgroundColor: '#fff' }} />
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
              <button onClick={(e) => { e.stopPropagation(); handleDeleteFood(food.id); }}
                style={{
                  position: 'absolute',
                  top: '5px', right: '5px',
                  background: 'red', color: 'white',
                  border: 'none', borderRadius: '50%',
                  width: '25px', height: '25px'
                }}>×</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default AdminFoodList;
