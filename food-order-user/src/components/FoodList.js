import React, { useEffect, useState } from 'react';
import axios from 'axios';
import io from 'socket.io-client';

const socket = io('http://localhost:5000');

const LEVEL_MENU_MAP = {
  P: ['SNACK TRAVEL', 'SNACK MENU', 'CLUB MENU'],
  'I-I+': ['HOTEL MENU', 'HOTEL MENU BEFORE 11AM', 'HOTEL MENU AFTER 11PM', 'SNACK TRAVEL', 'SNACK MENU', 'CLUB MENU'],
  'V-One': ['VIP MENU', 'HOTEL MENU', 'HOTEL MENU BEFORE 11AM', 'HOTEL MENU AFTER 11PM', 'SNACK TRAVEL', 'SNACK MENU', 'CLUB MENU', 'WINE MENU - KOREAN', 'WINE MENU ENGLISH', 'WINE MENU CHINESE', 'WINE MENU - JAPANESE']
};

const FoodList = () => {
  const [foods, setFoods] = useState([]);
  const [selectedLevel, setSelectedLevel] = useState(null);
  const [selectedMenuType, setSelectedMenuType] = useState(null);
  const [showSidebar, setShowSidebar] = useState(false);

  useEffect(() => {
    fetchFoods();

    socket.on('foodStatusUpdated', ({ id, newStatus }) => {
      setFoods(prev => prev.map(f => f.id === id ? { ...f, status: newStatus } : f));
    });

    socket.on('foodAdded', newFood => {
      setFoods(prev => [...prev, newFood]);
    });

    socket.on('foodDeleted', ({ id }) => {
      setFoods(prev => prev.filter(f => f.id !== id));
    });

    return () => {
      socket.off('foodStatusUpdated');
      socket.off('foodAdded');
      socket.off('foodDeleted');
    };
  }, []);

  const fetchFoods = async () => {
    const res = await axios.get('http://localhost:5000/api/foods');
    setFoods(res.data);
  };

  const visibleFoods = foods.filter(food =>
    food.status === 'Available' &&
    selectedLevel &&
    food.levelAccess.includes(selectedLevel) &&
    (selectedMenuType ? food.type === selectedMenuType : true)
  );

  return (
    <div style={{ display: 'flex', height: '100vh', background: '#fdf2d1' }}>
      {!showSidebar && (
        <button
          onClick={() => setShowSidebar(true)}
          style={{
            position: 'absolute',
            top: 20,
            left: 20,
            width: 50,
            height: 50,
            borderRadius: '50%',
            background: '#b28900',
            color: 'white',
            border: 'none',
            fontSize: 24,
            cursor: 'pointer',
            zIndex: 10
          }}
        >
          ☰
        </button>
      )}

      {showSidebar && (
        <div style={{
          width: '220px',
          height: '100vh',
          background: '#fff8db',
          color: '#333',
          padding: '15px',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
          boxShadow: '2px 0 5px rgba(0,0,0,0.1)'
        }}>
          {!selectedLevel && (
            <>
              {Object.keys(LEVEL_MENU_MAP).map(level => (
                <button
                  key={level}
                  onClick={() => {
                    setSelectedLevel(level);
                    setSelectedMenuType(null);
                  }}
                  style={{
                    background: '#f4cf63',
                    color: '#000',
                    padding: '10px',
                    border: '1px solid #e0b800',
                    borderRadius: '5px'
                  }}
                >
                  {level}
                </button>
              ))}
            </>
          )}

          {selectedLevel && (
            <>
              {LEVEL_MENU_MAP[selectedLevel].map(menu => (
                <button
                  key={menu}
                  onClick={() => setSelectedMenuType(menu)}
                  style={{
                    background: menu === selectedMenuType ? '#f1d160' : '#fff5c3',
                    color: '#000',
                    padding: '8px',
                    border: '1px solid #e0b800',
                    borderRadius: '5px',
                    textAlign: 'left'
                  }}
                >
                  {menu}
                </button>
              ))}

              <button
                onClick={() => {
                  setSelectedLevel(null);
                  setSelectedMenuType(null);
                }}
                style={{
                  marginTop: 'auto',
                  background: '#e67e22',
                  color: 'white',
                  padding: '10px',
                  border: 'none',
                  borderRadius: '5px'
                }}
              >
                ← Quay lại
              </button>
            </>
          )}

          <button
            onClick={() => {
              setShowSidebar(false);
              setSelectedLevel(null);
              setSelectedMenuType(null);
            }}
            style={{
              marginTop: 20,
              background: 'darkred',
              color: 'white',
              padding: '10px',
              border: 'none',
              borderRadius: '5px'
            }}
          >
            ✕ Đóng menu
          </button>
        </div>
      )}

      <div style={{ flex: 1, padding: '20px' }}>
        <div style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '12px',
          justifyContent: 'flex-start'
        }}>
          {visibleFoods.map(food => (
            <img
              key={food.id}
              src={food.imageUrl}
              alt=""
              style={{
                width: '200px',
                height: '150px',
                objectFit: 'cover',
                borderRadius: '8px',
                border: '2px solid #f4cf63'
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
};

export default FoodList;
