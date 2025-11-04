param(
  [string]$ApiUrl = "http://192.168.100.137:5000"
)

$ErrorActionPreference = "Stop"

Write-Host "== Pull/Copy code mới vào C:\Apps\food-order-app (nếu dùng Git, tự làm trước) =="

# ==== Backend ====
Write-Host "== Backend: install deps =="
cd C:\Apps\food-order-app\food-order-backend
if (Test-Path package-lock.json) {
  try { npm ci } catch { npm install }
} else {
  npm install
}

# ==== Admin ====
Write-Host "== Admin: build =="
cd C:\Apps\food-order-app\food-order-admin
$env:REACT_APP_API_URL = $ApiUrl
if (Test-Path package-lock.json) {
  try { npm ci } catch { npm install }
} else {
  npm install
}

# Dừng tiến trình admin để giải phóng thư mục build (nếu có)
try { pm2 stop food-admin } catch {}

# Xoá thư mục build cũ để tránh lỗi ENOTEMPTY
if (Test-Path .\build) { Remove-Item -Recurse -Force .\build }

npm run build

# ==== User ====
Write-Host "== User: build =="
cd C:\Apps\food-order-app\food-order-user
$env:REACT_APP_API_URL = $ApiUrl
if (Test-Path package-lock.json) {
  try { npm ci } catch { npm install }
} else {
  npm install
}

# Dừng tiến trình user để giải phóng thư mục build (nếu có)
try { pm2 stop food-user } catch {}

# Xoá thư mục build cũ để tránh lỗi ENOTEMPTY
if (Test-Path .\build) { Remove-Item -Recurse -Force .\build }

npm run build

# ==== PM2 restart ====
Write-Host "== PM2: reload/restart =="
cd C:\Apps\food-order-app
pm2 startOrReload ecosystem.config.js | Out-Null    # an toàn nếu file config vừa sửa
pm2 restart food-admin
pm2 restart food-user
pm2 restart food-backend --update-env               # cập nhật APP_VERSION -> client tự reload
pm2 save

Write-Host "== Kiểm tra nhanh =="
pm2 ls
Write-Host "Admin:  http://192.168.100.137:3000"
Write-Host "User:   http://192.168.100.137:3001"
Write-Host "API:    $ApiUrl"
