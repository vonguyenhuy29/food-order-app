param(
  [string]$UserRoot = 'C:\Apps\food-order-app\food-order-user',
  [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'

$components = Join-Path $UserRoot 'src\components'
$foodPath = Join-Path $components 'FoodList.js'
$tablePath = Join-Path $components 'TableTest.jsx'

if (!(Test-Path $foodPath)) { throw "Missing file: $foodPath" }
if (!(Test-Path $tablePath)) { throw "Missing file: $tablePath" }

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupDir = Join-Path $UserRoot "patch-backups\OFFMENU-$stamp"
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null

Copy-Item $foodPath (Join-Path $backupDir 'FoodList.js') -Force
Copy-Item $tablePath (Join-Path $backupDir 'TableTest.jsx') -Force

$utf8 = New-Object System.Text.UTF8Encoding($false)
$food = [System.IO.File]::ReadAllText($foodPath)
$table = [System.IO.File]::ReadAllText($tablePath)

function Replace-ExactOnce {
  param(
    [string]$Text,
    [string]$Old,
    [string]$New,
    [string]$Name
  )

  $count = 0
  $pos = 0
  while (($idx = $Text.IndexOf($Old, $pos)) -ge 0) {
    $count++
    $pos = $idx + $Old.Length
  }

  if ($count -ne 1) {
    throw "Pattern [$Name] expected once, found $count. No files changed."
  }

  return $Text.Replace($Old, $New)
}

Write-Host "Backup: $backupDir" -ForegroundColor Cyan

# ------------------------------------------------------------
# FoodList.js
# 1) Pass the existing cart update function into TableTest.
# ------------------------------------------------------------
$old = @'
    onCartSetQty={setFloorlensCartQty}
    onCartClear={clearFloorlensCart}
'@.TrimEnd()

$new = @'
    onCartSetQty={setFloorlensCartQty}
    onCartUpdateItem={updateFloorlensCartItem}
    onCartClear={clearFloorlensCart}
'@.TrimEnd()

$food = Replace-ExactOnce $food $old $new 'TableTest onCartUpdateItem prop'

# ------------------------------------------------------------
# FoodList.js
# 2) Keep the real raw off-menu name in orderDraftItems.
# ------------------------------------------------------------
$old = @'
        note: item?.note || '',
name: offMenu
'@.TrimEnd()

$new = @'
        note: item?.note || '',
        rawName: offMenu ? String(item?.name || '') : '',
name: offMenu
'@.TrimEnd()

$food = Replace-ExactOnce $food $old $new 'orderDraftItems rawName'

# ------------------------------------------------------------
# FoodList.js
# 3) Add an off-menu name input in the checkout/order form too.
# ------------------------------------------------------------
$anchor = @'
                <textarea
                  value={it.note}
'@.TrimEnd()

$insert = @'
                {it.offMenu && (
                  <input
                    type="text"
                    value={it.rawName || ''}
                    onChange={(e) => updateCartItemField(it.cartKey, {
                      name: e.target.value,
                      isOffMenu: true,
                    })}
                    placeholder={'T\u00ean m\u00f3n ngo\u00e0i menu *'}
                    style={{
                      width: '100%',
                      boxSizing: 'border-box',
                      padding: '9px 10px',
                      marginBottom: 8,
                      border: `1px solid ${String(it.rawName || '').trim() ? '#cbd5e1' : '#f59e0b'}`,
                      borderRadius: 7,
                      fontSize: 14,
                      background: '#fff',
                    }}
                  />
                )}

                <textarea
                  value={it.note}
'@.TrimEnd()

$food = Replace-ExactOnce $food $anchor $insert 'checkout off-menu name input'

# ------------------------------------------------------------
# TableTest.jsx
# 4) Accept onCartUpdateItem.
# ------------------------------------------------------------
$old = @'
  onCartSetQty,
  onCartClear,
'@.TrimEnd()

$new = @'
  onCartSetQty,
  onCartUpdateItem,
  onCartClear,
'@.TrimEnd()

$table = Replace-ExactOnce $table $old $new 'TableTest onCartUpdateItem argument'

# ------------------------------------------------------------
# TableTest.jsx
# 5) Expose rawName on the cart row.
# Use an ASCII-only structural anchor to avoid PowerShell encoding issues.
# ------------------------------------------------------------
$old = @'
      note: text(item?.note),
      offMenu,
'@.TrimEnd()

$new = @'
      note: text(item?.note),
      offMenu,
      rawName: offMenu ? text(item?.name) : '',
'@.TrimEnd()

$table = Replace-ExactOnce $table $old $new 'Table cart rawName'

# ------------------------------------------------------------
# TableTest.jsx
# 6) Show editable name field immediately in the current cart.
# ------------------------------------------------------------
$old = @'
                    <div className="tt-cart-row" key={row.cartKey}>
'@.TrimEnd()

$new = @'
                    <div className="tt-cart-row" key={row.cartKey}>
                      {row.offMenu && typeof onCartUpdateItem === 'function' && (
                        <div
                          style={{
                            gridColumn: '1 / -1',
                            display: 'grid',
                            gridTemplateColumns: '70px minmax(0, 1fr)',
                            gap: 8,
                            alignItems: 'center',
                            width: '100%',
                            boxSizing: 'border-box',
                            marginBottom: 4,
                          }}
                        >
                          <b style={{ color: '#7c3aed', fontSize: 12 }}>H100</b>
                          <input
                            type="text"
                            value={row.rawName || ''}
                            onChange={(e) => onCartUpdateItem({
                              ...selectedPayload,
                              cartKey: row.cartKey,
                              patch: {
                                name: e.target.value,
                                isOffMenu: true,
                              },
                            })}
                            placeholder={'T\u00ean m\u00f3n ngo\u00e0i menu *'}
                            style={{
                              width: '100%',
                              minWidth: 0,
                              boxSizing: 'border-box',
                              padding: '8px 9px',
                              border: `1px solid ${String(row.rawName || '').trim() ? '#cbd5e1' : '#f59e0b'}`,
                              borderRadius: 7,
                              background: '#fff',
                              fontSize: 13,
                            }}
                          />
                        </div>
                      )}
'@.TrimEnd()

$table = Replace-ExactOnce $table $old $new 'Table cart off-menu input'

# ------------------------------------------------------------
# Verify before writing.
# ------------------------------------------------------------
if ($food -notmatch 'onCartUpdateItem=\{updateFloorlensCartItem\}') {
  throw 'Verification failed: FoodList prop missing.'
}
if ($food -notmatch 'rawName: offMenu') {
  throw 'Verification failed: FoodList rawName missing.'
}
if ($table -notmatch 'onCartUpdateItem,') {
  throw 'Verification failed: TableTest prop missing.'
}
if ($table -notmatch 'row\.rawName') {
  throw 'Verification failed: TableTest input missing.'
}

# Write only after all replacements succeeded.
[System.IO.File]::WriteAllText($foodPath, $food, $utf8)
[System.IO.File]::WriteAllText($tablePath, $table, $utf8)

Write-Host ''
Write-Host 'OFF-MENU PATCH COMPLETED' -ForegroundColor Green
Write-Host 'Changed:'
Write-Host '  - Off-menu name input in current cart'
Write-Host '  - Off-menu name input in checkout form'
Write-Host '  - Existing H100/backend logic unchanged'

if (!$SkipBuild) {
  Write-Host ''
  Write-Host 'Running npm run build...' -ForegroundColor Yellow

  Push-Location $UserRoot
  try {
    $env:REACT_APP_API_URL = 'http://192.168.101.70:5000'
    npm run build

    if ($LASTEXITCODE -ne 0) {
      Write-Host ''
      Write-Host 'BUILD FAILED - rolling back...' -ForegroundColor Red
      Copy-Item (Join-Path $backupDir 'FoodList.js') $foodPath -Force
      Copy-Item (Join-Path $backupDir 'TableTest.jsx') $tablePath -Force
      throw 'Build failed. Files were restored from backup.'
    }
  }
  finally {
    Pop-Location
  }

  Write-Host ''
  Write-Host 'OFF-MENU PATCH + BUILD PASSED' -ForegroundColor Green
}
