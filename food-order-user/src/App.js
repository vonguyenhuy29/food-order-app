import React from 'react';
import FoodList from './components/FoodList';

function App() {
  const userLevel = 'P'; // Bạn có thể thay bằng 'V' để test

  return (
    <div>
      
      <FoodList userLevel={userLevel} />
    </div>
  );
}

export default App;
