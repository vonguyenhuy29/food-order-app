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
const io = new Server(server, {
  cors: { origin: "*" }
});
const PORT = 5000;

app.use(cors());
app.use(bodyParser.json());
app.use(express.json());
app.use('/images', express.static('public/images'));

// 📦 Đọc danh sách món ăn từ file
const foodsPath = path.join(__dirname, 'data', 'foods.json');
let foods = [];

try {
  if (fs.existsSync(foodsPath)) {
    const raw = fs.readFileSync(foodsPath, 'utf-8');
    foods = JSON.parse(raw);
    console.log(`✅ Đã load ${foods.length} món ăn từ foods.json`);
  } else {
    console.log("⚠️ foods.json không tồn tại, sẽ tạo mới khi có món đầu tiên");
  }
} catch (e) {
  console.error("❌ Lỗi khi đọc foods.json:", e.message);
  foods = [];
}

// 📤 Cấu hình upload ảnh vào thư mục tạm
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

// 📥 Upload ảnh và tự chuyển vào thư mục theo loại
app.post('/api/upload', upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'Không có ảnh được gửi' });

  const type = req.body.type;
  if (!type) return res.status(400).json({ message: 'Thiếu type' });

  const folderName = type.toUpperCase().trim();
  const destDir = path.join(__dirname, 'public/images', folderName);

  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  const fileExt = path.extname(req.file.originalname);
  const fileName = Date.now() + fileExt;
  const finalPath = path.join(destDir, fileName);

  const newFileBuffer = fs.readFileSync(req.file.path);
  const newFileHash = crypto.createHash('md5').update(newFileBuffer).digest('hex');

  const walkImages = (dir) => {
    let results = [];
    const list = fs.readdirSync(dir);
    list.forEach(file => {
      const fullPath = path.join(dir, file);
      const stat = fs.statSync(fullPath);
      if (stat && stat.isDirectory()) {
        results = results.concat(walkImages(fullPath));
      } else {
        results.push(fullPath);
      }
    });
    return results;
  };

  const existingImagePaths = walkImages(path.join(__dirname, 'public/images'));
  for (const filePath of existingImagePaths) {
    const existingBuffer = fs.readFileSync(filePath);
    const existingHash = crypto.createHash('md5').update(existingBuffer).digest('hex');
    if (existingHash === newFileHash) {
      fs.unlinkSync(req.file.path);
      return res.status(409).json({ message: 'Ảnh đã tồn tại' });
    }
  }

  fs.renameSync(req.file.path, finalPath);
  const imageUrl = `http://localhost:5000/images/${folderName}/${fileName}`;
  res.json({ imageUrl });
});

// 📃 Lấy danh sách món ăn
app.get('/api/foods', (req, res) => {
  res.json(foods);
});

// 🆕 Thêm món mới
let nextId = Date.now();
app.post('/api/foods', (req, res) => {
  const { imageUrl, type } = req.body;

  if (!imageUrl || !type) {
    return res.status(400).json({ message: "Missing imageUrl or type" });
  }

  const lowerType = type.toLowerCase();
  let levelAccess = [];

  if (["snack travel", "snack menu", "club menu"].includes(lowerType)) {
    levelAccess = ["P", "I-I+", "V-One"];
  } else if (["hotel menu", "hotel menu before 11am", "hotel menu after 11pm"].includes(lowerType)) {
    levelAccess = ["I-I+", "V-One"];
  } else {
    levelAccess = ["V-One"];
  }

  const newFood = {
    id: nextId++,
    name: "Món mới",
    imageUrl,
    type,
    status: "Available",
    levelAccess
  };

  foods.push(newFood);
  fs.writeFileSync(foodsPath, JSON.stringify(foods, null, 2));
  io.emit('foodAdded', newFood);
  res.status(201).json({ success: true, food: newFood });
});

// 🔁 Cập nhật trạng thái món ăn
app.post('/api/update-status/:id', (req, res) => {
  const foodId = parseInt(req.params.id);
  const { newStatus } = req.body;

  const food = foods.find(f => f.id === foodId);
  if (!food) return res.status(404).json({ message: "Not found" });

  food.status = newStatus;
  fs.writeFileSync(foodsPath, JSON.stringify(foods, null, 2));

  io.emit('foodStatusUpdated', { id: foodId, newStatus });
  res.json({ success: true });
});

// ❌ Xoá món ăn
app.delete('/api/foods/:id', (req, res) => {
  const foodId = parseInt(req.params.id);
  const index = foods.findIndex(f => f.id === foodId);
  if (index === -1) return res.status(404).json({ message: 'Không tìm thấy món ăn' });

  const food = foods[index];
  foods.splice(index, 1);

  const relativePath = food.imageUrl.replace('http://localhost:5000/images/', '');
  const imagePath = path.join(__dirname, 'public/images', relativePath);

  if (fs.existsSync(imagePath)) {
    fs.unlinkSync(imagePath);
  }

  fs.writeFileSync(foodsPath, JSON.stringify(foods, null, 2));
  io.emit('foodDeleted', { id: foodId });
  res.json({ success: true });
});

// ▶️ Khởi động server
server.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
