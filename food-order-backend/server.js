const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const crypto = require('crypto');

// Create Express app and HTTP server
const app = express();
const server = http.createServer(app);
// Disable the default socket timeout (inactivity). Without this, Node may emit
// ERR_HTTP_REQUEST_TIMEOUT if a client doesn't complete the request within
// the default 5-minute window. A timeout of 0 disables the limit entirely.
server.setTimeout(0);
// Disable the built-in request timeout so that long uploads or slow clients
// don't trigger ERR_HTTP_REQUEST_TIMEOUT on the server. A value of 0
// disables the timeout entirely. You can set a larger millisecond value
// (e.g. 600000 for 10 minutes) if you prefer.
server.requestTimeout = 0;

/*
 * Configure Socket.io to allow connections from the admin and user apps.
 * Adjust the origins array to include any other hosts or ports that will
 * access this server.
 */
const io = new Server(server, {
  cors: {
    origin: [
      'http://192.168.100.137:3000',
      'http://192.168.100.137:3001',
    ],
    methods: ['GET', 'POST', 'DELETE'],
  },
});

const PORT = 5000;

/*
 * Enable CORS so that the React apps running on ports 3000/3001 can call
 * this API without being blocked by the browser. You can restrict the origins
 * array above to specific hosts if needed.
 */
app.use(
  cors({
    origin: [
      'http://192.168.100.137:3000',
      'http://192.168.100.137:3001',
    ],
    methods: ['GET', 'POST', 'DELETE'],
    allowedHeaders: ['Content-Type'],
  })
);
app.use(bodyParser.json());
app.use(express.json());

// Serve uploaded images from the public/images directory
app.use('/images', express.static(path.join(__dirname, 'public/images')));

/*
 * Load the foods data from the JSON file on startup. If the file is not
 * present, log a warning and start with an empty list. Changes to foods
 * will be persisted back to this file.
 */
const foodsPath = path.join(__dirname, 'data', 'foods.json');
let foods = [];
try {
  if (fs.existsSync(foodsPath)) {
    const raw = fs.readFileSync(foodsPath, 'utf-8');
    foods = JSON.parse(raw);
    // Ensure each food has an `order` property.  If missing, set it based on
    // the current index.  This property determines the display order on
    // both the admin and user interfaces.  Using the array index here
    // preserves the existing order until drag-and-drop reordering is
    // performed by the admin.
    foods.forEach((f, idx) => {
      if (f.order === undefined) {
        f.order = idx;
      }
    });
  } else {
    console.log('⚠️ foods.json không tồn tại. Bắt đầu với danh sách rỗng.');
  }
} catch (e) {
  console.error('❌ Lỗi khi đọc foods.json:', e.message);
  foods = [];
}

/*
 * Configure Multer for image uploads. Uploaded files are temporarily stored
 * in the `temp_uploads` directory before being moved to their final
 * destination. Only JPG/JPEG/PNG files up to 2MB are allowed.
 */
const upload = multer({
  dest: 'temp_uploads/',
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!['.jpg', '.jpeg', '.png'].includes(ext)) {
      return cb(new Error('Chỉ cho phép ảnh JPG/JPEG/PNG'));
    }
    cb(null, true);
  },
});

// Helper to persist the foods array back to disk
function saveFoods() {
  fs.writeFileSync(foodsPath, JSON.stringify(foods, null, 2));
}

// Helper to extract just the filename from an image URL
function extractImageName(url) {
  try {
    return url.split('/').pop().toLowerCase();
  } catch {
    return null;
  }
}

// Endpoint: upload an image
app.post('/api/upload', upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'Không có ảnh được gửi' });
  const type = req.body.type;
  if (!type) return res.status(400).json({ message: 'Thiếu type' });

  // Create destination directory based on menu type
  const folderName = type.toUpperCase().trim();
  const destDir = path.join(__dirname, 'public/images', folderName);
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

  const fileName = req.file.originalname;
  const finalPath = path.join(destDir, fileName);

  // Calculate MD5 hash of the uploaded file to help with deduplication
  const newFileBuffer = fs.readFileSync(req.file.path);
  const newFileHash = crypto.createHash('md5').update(newFileBuffer).digest('hex');

  fs.renameSync(req.file.path, finalPath);

  // Build image URL dynamically based on current request
  const host = req.get('host'); // e.g. 192.168.100.137:5000
  const protocol = req.protocol; // http or https
  const imageUrl = `${protocol}://${host}/images/${folderName}/${fileName}`;

  return res.json({ imageUrl, hash: newFileHash });
});

// Endpoint: get all foods
app.get('/api/foods', (req, res) => {
  res.json(foods);
});

// Endpoint: add a new food
let nextId = Date.now();
app.post('/api/foods', (req, res) => {
  const { imageUrl, type, hash } = req.body;
  if (!imageUrl || !type || !hash) return res.status(400).json({ message: 'Thiếu trường' });

  // Do not allow duplicate entries of the same image URL and type
  const exists = foods.some((f) => f.imageUrl === imageUrl && f.type === type);
  if (exists) return res.status(409).json({ message: 'Đã tồn tại' });

  const lower = type.toLowerCase();
  let levelAccess = ['V-One'];
  if (['snack menu', 'snack travel', 'club menu'].includes(lower)) levelAccess = ['P', 'I-I+', 'V-One'];
  else if (['hotel menu', 'hotel menu before 11am', 'hotel menu after 11pm'].includes(lower)) levelAccess = ['I-I+', 'V-One'];

  // Determine the next order value.  Use the maximum existing order plus one
  // so the new item appears at the end of the list by default.
  const maxOrder = foods.reduce((max, f) => (f.order > max ? f.order : max), -1);
  const newFood = {
    id: nextId++,
    imageUrl,
    type: type.trim(),
    status: 'Available',
    hash,
    levelAccess,
    order: maxOrder + 1,
  };

  foods.push(newFood);
  saveFoods();
  io.emit('foodAdded', newFood);
  res.status(201).json({ success: true, food: newFood });
});

// Endpoint: update status of a food (and all foods sharing the same image filename)
app.post('/api/update-status/:id', (req, res) => {
  const foodId = parseInt(req.params.id);
  const { newStatus } = req.body;
  const target = foods.find((f) => f.id === foodId);
  if (!target) return res.status(404).json({ message: 'Not found' });

  const imageName = extractImageName(target.imageUrl);
  const updatedFoods = [];
  foods.forEach((f) => {
    if (extractImageName(f.imageUrl) === imageName) {
      f.status = newStatus;
      updatedFoods.push(f);
    }
  });

  saveFoods();
  io.emit('foodStatusUpdated', { updatedFoods });
  res.json({ success: true });
});

/*
 * Endpoint: reorder foods.  Accepts a JSON body with an array of food IDs
 * representing the new order.  Updates the `order` property on each food
 * and persists the change.  Emits a `foodsReordered` event to connected
 * clients so that the user interface can update its ordering without
 * refetching all data.  Example body: { "orderedIds": [5, 2, 9, ...] }
 */
app.post('/api/reorder-foods', (req, res) => {
  const { orderedIds } = req.body;
  if (!Array.isArray(orderedIds)) {
    return res.status(400).json({ message: 'orderedIds phải là mảng' });
  }
  // Ensure all provided IDs exist
  const allIdsExist = orderedIds.every((id) => foods.some((f) => f.id === id));
  if (!allIdsExist) {
    return res.status(400).json({ message: 'orderedIds chứa ID không tồn tại' });
  }
  // Update order values according to their index in orderedIds
  orderedIds.forEach((id, index) => {
    const f = foods.find((food) => food.id === id);
    if (f) {
      f.order = index;
    }
  });
  // Sort the foods array by new order to maintain consistency
  foods.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  saveFoods();
  io.emit('foodsReordered', { orderedIds });
  return res.json({ success: true });
});

// Endpoint: delete a food (always deletes the image file)
app.delete('/api/foods/:id', (req, res) => {
  const foodId = parseInt(req.params.id);
  const index = foods.findIndex((f) => f.id === foodId);
  if (index === -1) return res.status(404).json({ message: 'Không tìm thấy món ăn' });

  const food = foods[index];
  foods.splice(index, 1);

  const relativePath = food.imageUrl.replace(/.*\/images\//, '');
  const imagePath = path.join(__dirname, 'public/images', relativePath);
  if (fs.existsSync(imagePath)) {
    fs.unlinkSync(imagePath);
    console.log('🗑 Đã xoá ảnh:', imagePath);
  }

  saveFoods();
  io.emit('foodDeleted', { id: foodId });
  res.json({ success: true });
});

/*
 * Handle ECONNRESET errors gracefully. This event fires when a client
 * terminates a connection unexpectedly. Without this handler the error
 * would bubble up and print a stack trace on the console.
 */
server.on('clientError', (err, socket) => {
  if (err.code === 'ECONNRESET') {
    socket.destroy();
  } else {
    console.error('Client error:', err);
    socket.destroy();
  }
});

// Destroy sockets that exceed the idle timeout. Without this, Node will emit
// ERR_HTTP_REQUEST_TIMEOUT and log a stack trace when a client keeps a
// connection open without sending a complete request.
server.on('timeout', (socket) => {
  socket.destroy();
});

// Catch other server-level errors and suppress ECONNRESET messages. This
// prevents the process from printing stack traces for connections closed
// unexpectedly.
server.on('error', (err) => {
  if (err.code === 'ECONNRESET') return;
  console.error('Server error:', err);
});

// For each new TCP connection, attach an error handler to suppress
// unhandled ECONNRESET errors on individual sockets. Without this,
// Node will throw an exception when a client closes the connection
// abruptly (e.g. aborts an HTTP request or drops a WebSocket).
server.on('connection', (socket) => {
  socket.on('error', (err) => {
    if (err.code === 'ECONNRESET') {
      // ignore silently
      return;
    }
    console.error('Socket error:', err);
  });
});

// Increase connection timeouts to reduce chances of clients being dropped
server.keepAliveTimeout = 65000;
server.headersTimeout = 70000;

// Start the server on all network interfaces
server.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Backend running at http://192.168.100.137:${PORT}`);
});
app.post('/api/reorder-foods', (req, res) => {
  const { orderedIds } = req.body;
  if (!Array.isArray(orderedIds)) return res.status(400).json({ message: 'Invalid' });

  orderedIds.forEach((id, idx) => {
    const f = foods.find(f => f.id === id);
    if (f) f.order = idx;
  });

  fs.writeFileSync(foodsPath, JSON.stringify(foods, null, 2));
  io.emit('foodsReordered', { orderedIds });
  res.json({ success: true });
});
