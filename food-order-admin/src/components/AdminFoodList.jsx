import React, { useEffect, useState } from 'react';
import axios from 'axios';
import io from 'socket.io-client';

const socket = io('http://localhost:5000');

const AdminFoodList = ({ selectedType }) => {
  const [foods, setFoods] = useState([]);

  useEffect(() => {
    fetchFoods();

    socket.on('foodStatusUpdated', ({ id, newStatus }) => {
      setFoods(prev =>
        prev.map(f => f.id === id ? { ...f, status: newStatus } : f)
      );
    });

    socket.on('foodAdded', (newFood) => {
      setFoods(prev => [...prev, newFood]);
    });

    return () => {
      socket.off('foodStatusUpdated');
      socket.off('foodAdded');
    };
  }, []);

  const fetchFoods = async () => {
    const res = await axios.get('http://localhost:5000/api/foods');
    setFoods(res.data);
  };

  const handleToggleStatus = async (id, currentStatus) => {
    const newStatus = currentStatus === "Available" ? "Sold Out" : "Available";
    await axios.post(`http://localhost:5000/api/update-status/${id}`, { newStatus });
    // Socket will handle UI update
  };

const handleAddFood = async () => {
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/*';
  fileInput.multiple = true;

  fileInput.onchange = async (e) => {
    const files = Array.from(e.target.files);
    if (!files.length || !selectedType) return;

    for (const file of files) {
      const formData = new FormData();
      formData.append('image', file);
      formData.append('type', selectedType); // Gắn đúng loại

      try {
        const uploadRes = await axios.post('http://localhost:5000/api/upload', formData, {
          headers: { 'Content-Type': 'multipart/form-data' }
        });

        const imageUrl = uploadRes.data.imageUrl;

        await axios.post('http://localhost:5000/api/foods', {
          imageUrl,
          type: selectedType
        });
      } catch (err) {
        console.error("Lỗi khi upload ảnh:", file.name, err);
        alert(`Lỗi khi thêm ảnh: ${file.name}`);
      }
    }
  };

  fileInput.click();
};



  const foodsByType = foods.filter(f => f.type === selectedType);

  const handleDeleteFood = async (id) => {
  if (!window.confirm("Bạn có chắc muốn xoá món ăn này?")) return;

  try {
    await axios.delete(`http://localhost:5000/api/foods/${id}`);
    setFoods(prev => prev.filter(f => f.id !== id));
  } catch (err) {
    alert("Xoá món thất bại!");
  }
};  

  return (
    <div style={{ padding: '20px' }}>
      <h2>{selectedType}</h2>
      <button onClick={handleAddFood}>➕ Thêm món mới</button>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', marginTop: '16px' }}>
        {foodsByType.map(food => (
        <div key={food.id} style={{ position: 'relative', width: '200px' }}>
            
            {/* Vùng ảnh + chuyển trạng thái */}
            <div
            onClick={() => handleToggleStatus(food.id, food.status)}
            style={{
                cursor: 'pointer',
                border: '1px solid #ccc',
                borderRadius: '10px',
                overflow: 'hidden'
            }}
            >
            <img src={food.imageUrl} alt="" style={{ width: '100%', height: '150px', objectFit: 'cover' }} />
            
            {food.status === 'Sold Out' && (
                <div style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: '100%',
                backgroundColor: 'rgba(0,0,0,0.5)',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                color: 'white',
                fontWeight: 'bold',
                fontSize: '20px'
                }}>
                SOLD OUT
                </div>
            )}
            </div>

            {/* Nút Xoá */}
            <button
            onClick={() => handleDeleteFood(food.id)}
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
                cursor: 'pointer'
            }}
            title="Xoá món"
            >
            ×
            </button>
        </div>
        ))}

        {foodsByType.length === 0 && <p>Không có món nào trong loại này.</p>}
      </div>
    </div>
  );
};

export default AdminFoodList;
