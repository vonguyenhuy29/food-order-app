param(
  [string]$UserRoot = 'C:\Apps\food-order-app\food-order-user',
  [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'

$foodPath = Join-Path $UserRoot 'src\components\FoodList.js'
if (!(Test-Path $foodPath)) {
  throw "Missing file: $foodPath"
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupDir = Join-Path $UserRoot "patch-backups\CART-SAFETY-$stamp"
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
$backupPath = Join-Path $backupDir 'FoodList.js'
Copy-Item $foodPath $backupPath -Force

$tempJs = Join-Path $env:TEMP "food-cart-safety-$stamp.js"

$patcher = @'
const fs = require('fs');

const file = process.argv[2];
if (!file) throw new Error('FoodList path missing');

let s = fs.readFileSync(file, 'utf8');

const MARKER = '/* CART_SAFETY_V1 */';
if (s.includes(MARKER)) {
  throw new Error('CART_SAFETY_V1 already applied');
}

function replaceOnce(oldText, newText, name) {
  const first = s.indexOf(oldText);
  if (first < 0) throw new Error(`Pattern not found: ${name}`);
  const second = s.indexOf(oldText, first + oldText.length);
  if (second >= 0) throw new Error(`Pattern appears more than once: ${name}`);
  s = s.slice(0, first) + newText + s.slice(first + oldText.length);
}

function replaceRegexOnce(regex, replacement, name) {
  const flags = regex.flags.includes('g') ? regex.flags : regex.flags + 'g';
  const counter = new RegExp(regex.source, flags);
  const matches = [...s.matchAll(counter)];
  if (matches.length !== 1) {
    throw new Error(`Regex ${name} expected 1 match, got ${matches.length}`);
  }
  s = s.replace(regex, replacement);
}

// 1) Cart ownership helpers.
replaceOnce(
`const LOCAL_ORDERS_MAX_PER_TABLE = 40;
const LOCAL_CLOSED_ORDER_KEEP_MS = 2 * 24 * 60 * 60 * 1000;`,
`const LOCAL_ORDERS_MAX_PER_TABLE = 40;
const LOCAL_CLOSED_ORDER_KEEP_MS = 2 * 24 * 60 * 60 * 1000;

/* CART_SAFETY_V1 */
const cartOwnerCodeOf = (item = {}) =>
  String(item?.ownerMemberCode || '').replace(/\\s+/g, '').trim();

const cartSafetySummary = (cart = {}) => {
  const rows = Object.values(cart || {}).filter((item) => item && Number(item.qty || 0) > 0);
  const owners = Array.from(new Set(rows.map(cartOwnerCodeOf).filter(Boolean)));
  const hasUnowned = rows.some((item) => !cartOwnerCodeOf(item));
  return {
    itemRows: rows.length,
    owners,
    hasUnowned,
    hasItems: rows.length > 0,
  };
};`,
'cart safety helpers'
);

// 2) Stamp standard off-menu item with current member.
replaceOnce(
`const key = makeOffMenuKey();
  setCarts((prev) => {
    const cart = { ...(prev[currentTableKey] || {}) };
    cart[key] = {
      qty: 1,
      note: '',
      name: '',
      isOffMenu: true,
    };`,
`const key = makeOffMenuKey();
  const ownerMemberCode = String(orderForm.memberCard || orderForm.customerCode || '').replace(/\\s+/g, '').trim();
  setCarts((prev) => {
    const cart = { ...(prev[currentTableKey] || {}) };
    cart[key] = {
      qty: 1,
      note: '',
      name: '',
      isOffMenu: true,
      ownerMemberCode,
    };`,
'normal off-menu owner'
);

// 3) Stamp only newly-created standard menu items.
replaceOnce(
`      const cur = cart[cartKey] || {
        qty: 0,
        note: '',
        name: '',
        isOffMenu: isOffMenuKey(cartKey),
      };
      cart[cartKey] = { ...cur, qty };`,
`      const ownerMemberCode = String(orderForm.memberCard || orderForm.customerCode || '').replace(/\\s+/g, '').trim();
      const cur = cart[cartKey] || {
        qty: 0,
        note: '',
        name: '',
        isOffMenu: isOffMenuKey(cartKey),
        ownerMemberCode,
      };
      cart[cartKey] = { ...cur, qty };`,
'normal cart item owner'
);

// 4) FloorLens/Table cart items carry realtime member ownership.
replaceOnce(
`const setFloorlensCartQty = ({ area, tableNo, cartKey, qty }) => {`,
`const setFloorlensCartQty = ({ area, tableNo, cartKey, qty, memberCode = '' }) => {`,
'floorlens cart signature'
);

replaceOnce(
`      const current = cart[cartKey] || {
        qty: 0,
        note: '',
        name: '',
        isOffMenu: isOffMenuKey(cartKey),
      };
      cart[cartKey] = { ...current, qty: nextQty };`,
`      const ownerMemberCode = String(memberCode || orderForm.memberCard || orderForm.customerCode || '').replace(/\\s+/g, '').trim();
      const current = cart[cartKey] || {
        qty: 0,
        note: '',
        name: '',
        isOffMenu: isOffMenuKey(cartKey),
        ownerMemberCode,
      };
      cart[cartKey] = { ...current, qty: nextQty };`,
'floorlens cart item owner'
);

// 5) FloorLens/Table off-menu carries realtime member ownership.
replaceOnce(
`const addFloorlensOffMenu = ({ area, tableNo }) => {`,
`const addFloorlensOffMenu = ({ area, tableNo, memberCode = '' }) => {`,
'floorlens off-menu signature'
);

replaceOnce(
`  const cartKey = makeOffMenuKey();
  setCarts((prev) => {
    const cart = { ...(prev[key] || {}) };
    cart[cartKey] = { qty: 1, note: '', name: '', isOffMenu: true };`,
`  const cartKey = makeOffMenuKey();
  const ownerMemberCode = String(memberCode || orderForm.memberCard || orderForm.customerCode || '').replace(/\\s+/g, '').trim();
  setCarts((prev) => {
    const cart = { ...(prev[key] || {}) };
    cart[cartKey] = { qty: 1, note: '', name: '', isOffMenu: true, ownerMemberCode };`,
'floorlens off-menu owner'
);

// 6) New verified customer on a machine clears stale/unowned cart.
replaceOnce(
`  const code = String(memberCode || '').replace(/\\s+/g, '').trim();
  const realtimeName = String(customerName || '').trim();
  if (code) {`,
`  const code = String(memberCode || '').replace(/\\s+/g, '').trim();
  const realtimeName = String(customerName || '').trim();

  if (code && !isDiningTableNo(tableNo)) {
    const safetyKey = floorlensCartKey(area, tableNo);
    const existingCart = (safetyKey && carts?.[safetyKey]) || {};
    const safety = cartSafetySummary(existingCart);
    const belongsToAnotherCustomer =
      safety.hasItems &&
      (
        safety.hasUnowned ||
        safety.owners.some((ownerCode) => ownerCode !== code)
      );

    if (belongsToAnotherCustomer) {
      setCarts((prev) => ({ ...prev, [safetyKey]: {} }));
      setToast('Old cart cleared because the realtime customer changed.');
    }
  }

  if (code) {`,
'clear stale cart on new realtime customer'
);

// 7) NEVER merge target cart when moving to another machine.
replaceRegexOnce(
/\s*setCarts\(\(prev\) => \{\s*const sourceCart = \{ \.\.\.\(\(sourceKey && prev\[sourceKey\]\) \|\| \{\}\) \};\s*const targetCart = \{ \.\.\.\(\(targetKey && prev\[targetKey\]\) \|\| \{\}\) \};\s*for \(const \[cartKey, item\] of Object\.entries\(sourceCart\)\) \{\s*const existing = targetCart\[cartKey\];\s*targetCart\[cartKey\] = existing\s*\? \{ \.\.\.existing, \.\.\.item, qty: Number\(existing\.qty \|\| 0\) \+ Number\(item\?\.qty \|\| 0\) \}\s*: \{ \.\.\.item \};\s*\}\s*const next = \{ \.\.\.prev, \[targetKey\]: targetCart \};\s*if \(sourceKey && sourceKey !== targetKey\) next\[sourceKey\] = \{\};\s*return next;\s*\}\);/su,
`
    // CART_SAFETY_V1: never merge two carts automatically.
    const targetSafety = cartSafetySummary((targetKey && carts?.[targetKey]) || {});
    if (sourceKey !== targetKey && targetSafety.hasItems) {
      setOrderPlacementConflict(null);
      alert(
        'Machine ' + target.tableNo +
        ' already has an unsent cart. The app will NOT merge carts. ' +
        'Please review or clear that machine cart first.'
      );
      return;
    }

    setCarts((prev) => {
      const sourceCart = { ...((sourceKey && prev[sourceKey]) || {}) };
      const next = { ...prev, [targetKey]: sourceCart };
      if (sourceKey && sourceKey !== targetKey) next[sourceKey] = {};
      return next;
    });`,
'remove automatic cart merge'
);

// 8) Hard gate immediately before order item payload is built.
replaceOnce(
`const items = Object.entries(currentCart)`,
`if (!isDiningTableNo(selectedTable?.tableNo)) {
    const cartSafety = cartSafetySummary(currentCart);
    const wrongOwner =
      cartSafety.hasItems &&
      (
        cartSafety.hasUnowned ||
        cartSafety.owners.length !== 1 ||
        cartSafety.owners[0] !== memberCardVal
      );

    if (wrongOwner) {
      alert(
        'This cart contains old items or items from another customer.\\n\\n' +
        'The order was NOT sent to prevent a mixed bill.\\n' +
        'Please clear the cart and select the items again for the current customer.'
      );
      return;
    }
  }

const items = Object.entries(currentCart)`,
'pre-send cart ownership gate'
);

const checks = [
  ['marker', s.includes(MARKER)],
  ['owner helper', s.includes('cartOwnerCodeOf')],
  ['send gate', s.includes('const wrongOwner =')],
  ['target block', s.includes('never merge two carts automatically')],
  ['old merge removed', !s.includes('targetCart[cartKey] = existing')],
];

for (const [name, ok] of checks) {
  if (!ok) throw new Error(`Post-check failed: ${name}`);
}

fs.writeFileSync(file, s, 'utf8');
console.log('CART_SAFETY_V1 patched successfully');
'@

[System.IO.File]::WriteAllText(
  $tempJs,
  $patcher,
  (New-Object System.Text.ASCIIEncoding)
)

Write-Host "Backup: $backupDir" -ForegroundColor Cyan
Write-Host "Applying CART_SAFETY_V1..." -ForegroundColor Yellow

node $tempJs $foodPath

if ($LASTEXITCODE -ne 0) {
  Copy-Item $backupPath $foodPath -Force
  Remove-Item $tempJs -ErrorAction SilentlyContinue
  throw "Patch failed. FoodList.js restored."
}

Remove-Item $tempJs -ErrorAction SilentlyContinue

if (!$SkipBuild) {
  Write-Host ""
  Write-Host "Running npm run build..." -ForegroundColor Yellow

  Push-Location $UserRoot
  try {
    $env:REACT_APP_API_URL = 'http://192.168.101.70:5000'
    npm run build

    if ($LASTEXITCODE -ne 0) {
      Write-Host "BUILD FAILED -> restoring backup..." -ForegroundColor Red
      Copy-Item $backupPath $foodPath -Force
      throw "Build failed. FoodList.js restored."
    }
  }
  finally {
    Pop-Location
  }
}

Write-Host ""
Write-Host "CART SAFETY PATCH + BUILD PASSED" -ForegroundColor Green
Write-Host "Backup: $backupDir" -ForegroundColor Cyan
