import React, { useState } from 'react';
import AdminFoodList from './components/AdminFoodList';

const MENU_TYPES = [
  "SNACK TRAVEL", "SNACK MENU", "CLUB MENU",
  "HOTEL MENU", "HOTEL MENU BEFORE 11AM", "HOTEL MENU AFTER 11PM",
  "VIP MENU",
  "WINE MENU - KOREAN", "WINE MENU - ENGLISH", "WINE MENU - CHINESE", "WINE MENU - JAPANESE"
];

function App() {
  const [selectedType, setSelectedType] = useState(MENU_TYPES[0]);

  return (
    <div style={{ display: 'flex' }}>
      <div style={{
        width: '220px',
        background: '#111',
        color: 'white',
        padding: '10px',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px'
      }}>
        <h3>🍱 Admin Page</h3>
        {MENU_TYPES.map(type => (
          <button
            key={type}
            onClick={() => setSelectedType(type)}
            style={{
              background: selectedType === type ? '#fff' : '#333',
              color: selectedType === type ? '#000' : '#fff',
              border: 'none',
              padding: '10px',
              textAlign: 'left',
              borderRadius: '5px',
              cursor: 'pointer'
            }}
          >
            {type}
          </button>
        ))}
      </div>

      <div style={{ flex: 1 }}>
        <AdminFoodList selectedType={selectedType} />
      </div>
    </div>
  );
}

export default App;
