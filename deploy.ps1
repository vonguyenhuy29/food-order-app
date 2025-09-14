param(
  [string]$ApiUrl = "http://192.168.100.137:5000"   
)

$ErrorActionPreference = "Stop"

Write-Host "== Pull/Copy code mới vào C:\Apps\food-order-app (nếu dùng Git, tự làm trước) =="

# Trước khi build, dừng các tiến trình serve để tránh khóa thư mục build
Write-Host "== Stopping running frontend apps (food-admin, food-user) to free build folders =="
try { pm2 stop food-admin | Out-Null } catch { }
try { pm2 stop food-user  | Out-Null } catch { }

# ==== Backend ====
Write-Host "== Backend: install deps =="
cd C:\Apps\food-order-app\food-order-backend
if (Test-Path package-lock.json) {
  try { npm ci }
  catch {
    Write-Host "npm ci failed, falling back to npm install"
    npm install
  }
} else {
  npm install
}

# ==== Admin ====
Write-Host "== Admin: build =="
cd C:\Apps\food-order-app\food-order-admin
$env:REACT_APP_API_URL = $ApiUrl
# Xóa thư mục build cũ để tránh lỗi ENOTEMPTY khi build
if (Test-Path build) {
  Write-Host "Removing old admin build folder"
  Remove-Item -Recurse -Force build
}
if (Test-Path package-lock.json) {
  try { npm ci }
  catch {
    Write-Host "npm ci failed, falling back to npm install"
    npm install
  }
} else {
  npm install
}
npm run build

# ==== User ====
Write-Host "== User: build =="
cd C:\Apps\food-order-app\food-order-user
$env:REACT_APP_API_URL = $ApiUrl
# Xóa thư mục build cũ để tránh lỗi ENOTEMPTY khi build
if (Test-Path build) {
  Write-Host "Removing old user build folder"
  Remove-Item -Recurse -Force build
}
if (Test-Path package-lock.json) {
  try { npm ci }
  catch {
    Write-Host "npm ci failed, falling back to npm install"
    npm install
  }
} else {
  npm install
}
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
