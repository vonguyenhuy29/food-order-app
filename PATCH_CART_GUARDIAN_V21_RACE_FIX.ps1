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
$backupDir = Join-Path $UserRoot "patch-backups\CART-GUARDIAN-V21-$stamp"
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
$backupPath = Join-Path $backupDir 'FoodList.js'
Copy-Item $foodPath $backupPath -Force

$tempJs = Join-Path $env:TEMP "food-cart-guardian-v21-$stamp.js"

$patcher = @'
const fs = require('fs');

const file = process.argv[2];
if (!file) throw new Error('FoodList path missing');

let s = fs.readFileSync(file, 'utf8');

if (!s.includes('CART_SAFETY_V2_AUTO_GUARDIAN')) {
  throw new Error('Cart Guardian V2 baseline not found.');
}
if (s.includes('CART_GUARDIAN_V21_RACE_FIX')) {
  throw new Error('CART_GUARDIAN_V21_RACE_FIX already applied.');
}

function replaceOnce(oldText, newText, name) {
  const first = s.indexOf(oldText);
  if (first < 0) throw new Error(`Pattern not found: ${name}`);
  const second = s.indexOf(oldText, first + oldText.length);
  if (second >= 0) throw new Error(`Pattern appears more than once: ${name}`);
  s = s.slice(0, first) + newText + s.slice(first + oldText.length);
}

function replaceCount(oldText, newText, expected, name) {
  let count = 0;
  let pos = 0;
  while (true) {
    const i = s.indexOf(oldText, pos);
    if (i < 0) break;
    count += 1;
    pos = i + oldText.length;
  }
  if (count !== expected) {
    throw new Error(`Pattern ${name} expected ${expected}, got ${count}`);
  }
  s = s.split(oldText).join(newText);
}

function replaceRegexOnce(regex, replacement, name) {
  const flags = regex.flags.includes('g') ? regex.flags : regex.flags + 'g';
  const scan = new RegExp(regex.source, flags);
  const matches = [...s.matchAll(scan)];
  if (matches.length !== 1) {
    throw new Error(`Regex ${name} expected 1 match, got ${matches.length}`);
  }
  s = s.replace(regex, replacement);
}

// Marker
replaceOnce(
  '/* CART_SAFETY_V2_AUTO_GUARDIAN */',
  '/* CART_SAFETY_V2_AUTO_GUARDIAN */\n/* CART_GUARDIAN_V21_RACE_FIX */',
  'v21 marker'
);

// New cart items must use the synchronous member ref first.
// This fixes the race where setOrderForm has not committed yet.
replaceCount(
  "const ownerMemberCode = String(orderForm.memberCard || orderForm.customerCode || '').replace(/\\s+/g, '').trim();",
  "const ownerMemberCode = String(currentMemberCardRef.current || orderForm.memberCard || orderForm.customerCode || '').replace(/\\s+/g, '').trim();",
  2,
  'owner source'
);

// If an item was created milliseconds before the member state committed,
// attach the now-known owner when staff changes quantity.
replaceOnce(
  '      cart[cartKey] = { ...cur, qty };',
  `      const existingOwner = cartOwnerCodeOf(cur);
      const safeOwner =
        ownerMemberCode &&
        (!existingOwner || existingOwner === ownerMemberCode)
          ? ownerMemberCode
          : existingOwner;

      cart[cartKey] = {
        ...cur,
        qty,
        ...(safeOwner ? { ownerMemberCode: safeOwner } : {}),
      };`,
  'cart owner upgrade'
);

// Machine selection knows the member synchronously.
// Update ref BEFORE React state is scheduled.
replaceOnce(
`  const code = String(memberCode || '').replace(/\\s+/g, '').trim();
  const realtimeName = String(customerName || '').trim();

  if (code && !isDiningTableNo(tableNo)) {`,
`  const code = String(memberCode || '').replace(/\\s+/g, '').trim();
  const realtimeName = String(customerName || '').trim();

  currentMemberCardRef.current = code;

  if (code && !isDiningTableNo(tableNo)) {`,
  'sync member ref'
);

// Replace V2 checkout cleanup.
// V2.1 adopts unowned rows ONLY when the active synchronous member ref
// matches the customer being ordered. Rows owned by another customer are
// still removed. This prevents newly selected food from being deleted.
replaceRegexOnce(
/let cartForOrder = currentCart;\s*let autoRemovedCartRows = 0;\s*if \(!isDiningTableNo\(selectedTable\?\.tableNo\)\) \{[\s\S]*?\n\}\s*\nconst items = Object\.entries\(cartForOrder\)/,
`let cartForOrder = currentCart;
let autoRemovedCartRows = 0;

if (!isDiningTableNo(selectedTable?.tableNo)) {
  const cartSafety = cartSafetySummary(currentCart);
  const activeMemberRef = String(currentMemberCardRef.current || '')
    .replace(/\\s+/g, '')
    .trim();

  const hasDifferentOwner = cartSafety.owners.some(
    (ownerCode) => ownerCode !== memberCardVal
  );

  const canAdoptUnowned =
    cartSafety.hasItems &&
    cartSafety.hasUnowned &&
    !hasDifferentOwner &&
    activeMemberRef === memberCardVal;

  if (canAdoptUnowned) {
    const adoptedCart = Object.fromEntries(
      Object.entries(currentCart || {})
        .filter(([, item]) => item && Number(item.qty || 0) > 0)
        .map(([cartKey, item]) => [
          cartKey,
          {
            ...item,
            ownerMemberCode:
              cartOwnerCodeOf(item) || memberCardVal,
          },
        ])
    );

    cartForOrder = adoptedCart;
    setCarts((prev) => ({
      ...prev,
      [currentTableKey]: adoptedCart,
    }));
  } else {
    const needsAutoCleanup =
      cartSafety.hasItems &&
      (
        hasDifferentOwner ||
        cartSafety.owners.length > 1 ||
        (cartSafety.hasUnowned && activeMemberRef !== memberCardVal)
      );

    if (needsAutoCleanup) {
      const cleanedCart = keepOnlyCartOwner(currentCart, memberCardVal);
      const cleanedSafety = cartSafetySummary(cleanedCart);
      autoRemovedCartRows = Math.max(
        0,
        cartSafety.itemRows - cleanedSafety.itemRows
      );

      if (!cleanedSafety.hasItems) {
        setCarts((prev) => ({
          ...prev,
          [currentTableKey]: {},
        }));
        setShowOrderForm(false);
        setMode('menu');
        setToast('Gi\u1ecf \u0111\xe3 \u0111\u01b0\u1ee3c \u0111\u1ed3ng b\u1ed9 theo kh\xe1ch hi\u1ec7n t\u1ea1i. Vui l\xf2ng ch\u1ecdn m\xf3n.');
        return;
      }

      cartForOrder = cleanedCart;
      setCarts((prev) => ({
        ...prev,
        [currentTableKey]: cleanedCart,
      }));
    }
  }
}

const items = Object.entries(cartForOrder)`,
  'checkout race fix'
);

// Post checks
const checks = [
  ['marker', s.includes('CART_GUARDIAN_V21_RACE_FIX')],
  ['sync ref', s.includes('currentMemberCardRef.current = code;')],
  ['owner ref source', (s.match(/currentMemberCardRef\.current \|\| orderForm\.memberCard/g) || []).length >= 2],
  ['adopt unowned', s.includes('const canAdoptUnowned =')],
  ['old V2 cleanup toast removed', !s.includes('Gi\u1ecf c\u0169 \u0111\xe3 \u0111\u01b0\u1ee3c t\u1ef1 \u0111\u1ed9ng l\xe0m s\u1ea1ch. Ch\u1ecdn m\xf3n cho kh\xe1ch hi\u1ec7n t\u1ea1i.')],
];

for (const [name, ok] of checks) {
  if (!ok) throw new Error(`Post-check failed: ${name}`);
}

fs.writeFileSync(file, s, 'utf8');
console.log('CART_GUARDIAN_V21_RACE_FIX patched successfully');
'@

[System.IO.File]::WriteAllText(
  $tempJs,
  $patcher,
  (New-Object System.Text.ASCIIEncoding)
)

Write-Host "Backup: $backupDir" -ForegroundColor Cyan
Write-Host "Applying CART_GUARDIAN_V21_RACE_FIX..." -ForegroundColor Yellow

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
Write-Host "CART GUARDIAN V2.1 + BUILD PASSED" -ForegroundColor Green
Write-Host "Backup: $backupDir" -ForegroundColor Cyan
