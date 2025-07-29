// server.js
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
const PORT = 5000;

app.use(cors());
app.use(bodyParser.json());
app.use(express.json());
app.use('/images', express.static('public/images'));

const foodsPath = path.join(__dirname, 'data', 'foods.json');
let foods = [];

try {
  if (fs.existsSync(foodsPath)) {
    const raw = fs.readFileSync(foodsPath, 'utf-8');
    foods = JSON.parse(raw);
  } else {
    console.log("⚠️ foods.json không tồn tại.");
  }
} catch (e) {
  console.error("❌ Lỗi khi đọc foods.json:", e.message);
  foods = [];
}

const upload = multer({
  dest: 'temp_uploads/',
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (![".jpg", ".jpeg", ".png"].includes(ext)) {
      return cb(new Error("Chỉ cho phép ảnh JPG/JPEG/PNG"));
    }
    cb(null, true);
  }
});

// Upload ảnh
app.post('/api/upload', upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'Không có ảnh được gửi' });

  const type = req.body.type;
  if (!type) return res.status(400).json({ message: 'Thiếu type' });

  const folderName = type.toUpperCase().trim();
  const destDir = path.join(__dirname, 'public/images', folderName);
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

  const fileExt = path.extname(req.file.originalname);
  const fileName = req.file.originalname;
  const finalPath = path.join(destDir, fileName);

  const newFileBuffer = fs.readFileSync(req.file.path);
  const newFileHash = crypto.createHash('md5').update(newFileBuffer).digest('hex');

  fs.renameSync(req.file.path, finalPath);
  const imageUrl = `http://192.168.100.137:5000/images/${folderName}/${fileName}`;
  return res.json({ imageUrl, hash: newFileHash });
});

// Get foods
app.get('/api/foods', (req, res) => {
  res.json(foods);
});

// Add food
let nextId = Date.now();
app.post('/api/foods', (req, res) => {
  const { imageUrl, type, hash } = req.body;
  if (!imageUrl || !type || !hash) return res.status(400).json({ message: 'Thiếu trường' });

  const exists = foods.some(f => f.imageUrl === imageUrl && f.type === type);
  if (exists) return res.status(409).json({ message: 'Đã tồn tại' });

  const lower = type.toLowerCase();
  let levelAccess = ["V-One"];
  if (["snack menu", "snack travel", "club menu"].includes(lower)) levelAccess = ["P", "I-I+", "V-One"];
  else if (["hotel menu", "hotel menu before 11am", "hotel menu after 11pm"].includes(lower)) levelAccess = ["I-I+", "V-One"];

  const newFood = {
    id: nextId++,
    imageUrl,
    type: type.trim(),
    status: "Available",
    hash,
    levelAccess
  };

  foods.push(newFood);
  fs.writeFileSync(foodsPath, JSON.stringify(foods, null, 2));
  io.emit("foodAdded", newFood);
  res.status(201).json({ success: true, food: newFood });
});

// Update status
app.post('/api/update-status/:id', (req, res) => {
  const foodId = parseInt(req.params.id);
  const { newStatus } = req.body;

  const target = foods.find(f => f.id === foodId);
  if (!target) return res.status(404).json({ message: "Not found" });

  const imageName = extractImageName(target.imageUrl);

  const updatedFoods = [];

  foods.forEach(f => {
    if (extractImageName(f.imageUrl) === imageName) {
      f.status = newStatus;
      updatedFoods.push(f);
    }
  });

  fs.writeFileSync(foodsPath, JSON.stringify(foods, null, 2));
  io.emit('foodStatusUpdated', { updatedFoods }); // socket gửi về mảng

  res.json({ success: true });
});

// Delete
app.delete('/api/foods/:id', (req, res) => {
  const foodId = parseInt(req.params.id);
  const index = foods.findIndex(f => f.id === foodId);
  if (index === -1) return res.status(404).json({ message: 'Không tìm thấy món ăn' });

  const food = foods[index];
  foods.splice(index, 1);

  const relativePath = food.imageUrl.replace('http://192.168.100.137:5000/images/', '');
  const imagePath = path.join(__dirname, 'public/images', relativePath);

  // ✅ LUÔN xoá ảnh (không kiểm tra còn dùng hay không)
  if (fs.existsSync(imagePath)) {
    fs.unlinkSync(imagePath);
    console.log("🗑 Đã xoá ảnh:", imagePath);
  }

  fs.writeFileSync(foodsPath, JSON.stringify(foods, null, 2));
  io.emit('foodDeleted', { id: foodId });
  res.json({ success: true });
});


// Run server
server.listen(PORT, () => {
  console.log(`✅ Backend running at http://192.168.100.137:${PORT}`);
});
function extractImageName(url) {
  try {
    return url.split('/').pop().toLowerCase();
  } catch {
    return null;
  }
}
