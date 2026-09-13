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
$backupDir = Join-Path $UserRoot "patch-backups\CART-GUARDIAN-V2-$stamp"
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
$backupPath = Join-Path $backupDir 'FoodList.js'
Copy-Item $foodPath $backupPath -Force

$tempJs = Join-Path $env:TEMP "food-cart-guardian-v2-$stamp.js"

$patcher = @'
const fs = require('fs');

const file = process.argv[2];
if (!file) throw new Error('FoodList path missing');

let s = fs.readFileSync(file, 'utf8');

if (s.includes('CART_SAFETY_V2_AUTO_GUARDIAN')) {
  throw new Error('CART_SAFETY_V2_AUTO_GUARDIAN already applied');
}

if (!s.includes('CART_SAFETY_V1')) {
  throw new Error('CART_SAFETY_V1 baseline not found. Stop to avoid patching the wrong version.');
}

function replaceOnce(oldText, newText, name) {
  const first = s.indexOf(oldText);
  if (first < 0) throw new Error(`Pattern not found: ${name}`);
  const second = s.indexOf(oldText, first + oldText.length);
  if (second >= 0) throw new Error(`Pattern appears more than once: ${name}`);
  s = s.slice(0, first) + newText + s.slice(first + oldText.length);
}

function replaceRegexOnce(regex, replacement, name) {
  const scanFlags = regex.flags.includes('g') ? regex.flags : (regex.flags + 'g');
  const scanRegex = new RegExp(regex.source, scanFlags);
  const matches = [...s.matchAll(scanRegex)];
  if (matches.length !== 1) {
    throw new Error(`Regex ${name} expected 1 match, got ${matches.length}`);
  }
  s = s.replace(regex, replacement);
}

// ------------------------------------------------------------
// 1) Upgrade helper marker + safe-owner filter
// ------------------------------------------------------------
replaceOnce(
`/* CART_SAFETY_V1 */
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
`/* CART_SAFETY_V2_AUTO_GUARDIAN */
const CART_GUARDIAN_MIGRATION_KEY = 'foodCartGuardianV2Migrated';

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
};

const keepOnlyCartOwner = (cart = {}, memberCode = '') => {
  const wanted = String(memberCode || '').replace(/\\s+/g, '').trim();
  if (!wanted) return {};
  return Object.fromEntries(
    Object.entries(cart || {}).filter(([, item]) =>
      item &&
      Number(item.qty || 0) > 0 &&
      cartOwnerCodeOf(item) === wanted
    )
  );
};`,
'cart safety helpers'
);

// ------------------------------------------------------------
// 2) One-time migration:
// silently discard only legacy/ambiguous cached carts.
// Single-owner carts are preserved.
// ------------------------------------------------------------
replaceOnce(
`const [carts, setCarts] = useState(() => {
  try { return compactCarts(JSON.parse(localStorage.getItem('tableCarts')) || {}); } catch { return {}; }
});`,
`const [carts, setCarts] = useState(() => {
  try { return compactCarts(JSON.parse(localStorage.getItem('tableCarts')) || {}); } catch { return {}; }
});

// Cart Guardian V2 migration
useEffect(() => {
  try {
    if (localStorage.getItem(CART_GUARDIAN_MIGRATION_KEY) === '1') return;

    setCarts((prev) => {
      const next = {};
      for (const [key, cart] of Object.entries(prev || {})) {
        const safety = cartSafetySummary(cart);
        if (!safety.hasItems) continue;
        if (!safety.hasUnowned && safety.owners.length === 1) {
          next[key] = cart;
        }
      }
      return next;
    });

    localStorage.setItem(CART_GUARDIAN_MIGRATION_KEY, '1');
  } catch {}
}, []);`,
'cart migration'
);

// ------------------------------------------------------------
// 3) Background realtime guardian.
// A verified NEW member on a machine removes stale items for
// previous/unknown owners before checkout.
// Empty/unknown/stale FloorLens data never clears a valid cart.
// ------------------------------------------------------------
replaceOnce(
`const addFloorlensOffMenu = ({ area, tableNo, memberCode = '' }) => {
  const key = floorlensCartKey(area, tableNo);
  if (!key) return;
  const cartKey = makeOffMenuKey();
  const ownerMemberCode = String(memberCode || orderForm.memberCard || orderForm.customerCode || '').replace(/\\s+/g, '').trim();
  setCarts((prev) => {
    const cart = { ...(prev[key] || {}) };
    cart[cartKey] = { qty: 1, note: '', name: '', isOffMenu: true, ownerMemberCode };
    return { ...prev, [key]: cart };
  });
};

const applyFloorlensMachineSelection`,
`const addFloorlensOffMenu = ({ area, tableNo, memberCode = '' }) => {
  const key = floorlensCartKey(area, tableNo);
  if (!key) return;
  const cartKey = makeOffMenuKey();
  const ownerMemberCode = String(memberCode || orderForm.memberCard || orderForm.customerCode || '').replace(/\\s+/g, '').trim();
  setCarts((prev) => {
    const cart = { ...(prev[key] || {}) };
    cart[cartKey] = { qty: 1, note: '', name: '', isOffMenu: true, ownerMemberCode };
    return { ...prev, [key]: cart };
  });
};

const reconcileCartsWithFloorlens = useCallback((floorlensSnapshot) => {
  if (!floorlensSnapshot || floorlensSnapshot.stale) return;

  const currentOwnerByKey = new Map();

  for (const machine of Array.isArray(floorlensSnapshot?.machines) ? floorlensSnapshot.machines : []) {
    const verified =
      machine?.checkState === 'ok' &&
      machine?.online !== false &&
      Boolean(machine?.isPlaying);

    const memberCode = String(machine?.memberCode || '').replace(/\\s+/g, '').trim();
    const area = String(machine?.area || '').trim();
    const tableNo = machine?.machineNumber;

    if (!verified || !memberCode || !area || tableNo === null || tableNo === undefined || tableNo === '') continue;
    currentOwnerByKey.set(tableKeyOf(area, tableNo), memberCode);
  }

  if (!currentOwnerByKey.size) return;

  setCarts((prev) => {
    let changed = false;
    const next = { ...prev };

    for (const [key, cart] of Object.entries(prev || {})) {
      const liveMemberCode = currentOwnerByKey.get(key);
      if (!liveMemberCode) continue;

      const tableNo = String(key).split('#').pop();
      if (isDiningTableNo(tableNo)) continue;

      const safety = cartSafetySummary(cart);
      if (!safety.hasItems) continue;

      const staleForCurrentCustomer =
        safety.hasUnowned ||
        safety.owners.some((ownerCode) => ownerCode !== liveMemberCode);

      if (staleForCurrentCustomer) {
        next[key] = keepOnlyCartOwner(cart, liveMemberCode);
        changed = true;
      }
    }

    return changed ? next : prev;
  });
}, []);

useEffect(() => {
  const onFloorlensUpdatedForCartGuardian = (nextSnapshot) => {
    reconcileCartsWithFloorlens(nextSnapshot);
  };

  socket.on('floorlensUpdated', onFloorlensUpdatedForCartGuardian);
  return () => socket.off('floorlensUpdated', onFloorlensUpdatedForCartGuardian);
}, [reconcileCartsWithFloorlens]);

const applyFloorlensMachineSelection`,
'realtime cart guardian'
);

// ------------------------------------------------------------
// 4) Machine correction:
// remove the technical target-cart popup.
// The actively edited source cart REPLACES target cart; never merge.
// ------------------------------------------------------------
replaceRegexOnce(
/\s*const targetSafety = cartSafetySummary\(\(targetKey && carts\?\.\[targetKey\]\) \|\| \{\}\);\s*if \(sourceKey !== targetKey && targetSafety\.hasItems\) \{[\s\S]*?\n\s*return;\s*\}\s*\n/,
`\n`,
'target cart blocking popup'
);

s = s.replace(
  `    // Gi\u1eef nguy\u00ean m\u00f3n \u0111\u00e3 ch\u1ecdn khi \u0111\u1ed5i machine; n\u1ebfu target \u0111\u00e3 c\u00f3 cart th\u00ec merge s\u1ed1 l\u01b0\u1ee3ng.
    // CART_SAFETY_V1: never merge two carts automatically.`,
  `    // CART_GUARDIAN_V2: the active source cart replaces any older target cart.
    // Never merge quantities across machine carts.`
);

// ------------------------------------------------------------
// 5) Checkout:
// replace blocking mixed-bill alert with automatic cleanup.
// - current-customer rows remain and order continues
// - stale rows are silently removed
// - if nothing safe remains, reset cart + return to Menu (no modal)
// ------------------------------------------------------------
replaceRegexOnce(
/if \(!isDiningTableNo\(selectedTable\?\.tableNo\)\) \{\s*const cartSafety = cartSafetySummary\(currentCart\);\s*const wrongOwner =[\s\S]*?\n\s*\}\s*\n\s*const items = Object\.entries\(currentCart\)/,
`let cartForOrder = currentCart;
let autoRemovedCartRows = 0;

if (!isDiningTableNo(selectedTable?.tableNo)) {
  const cartSafety = cartSafetySummary(currentCart);
  const needsAutoCleanup =
    cartSafety.hasItems &&
    (
      cartSafety.hasUnowned ||
      cartSafety.owners.length !== 1 ||
      cartSafety.owners[0] !== memberCardVal
    );

  if (needsAutoCleanup) {
    const cleanedCart = keepOnlyCartOwner(currentCart, memberCardVal);
    const cleanedSafety = cartSafetySummary(cleanedCart);
    autoRemovedCartRows = Math.max(0, cartSafety.itemRows - cleanedSafety.itemRows);

    if (!cleanedSafety.hasItems) {
      setCarts((prev) => ({ ...prev, [currentTableKey]: {} }));
      setShowOrderForm(false);
      setMode('menu');
      setToast('\\u0110\\u00e3 t\\u1ef1 d\\u1ecdn gi\\u1ecf c\\u0169. Ch\\u1ecdn m\\u00f3n cho kh\\u00e1ch hi\\u1ec7n t\\u1ea1i.');
      return;
    }

    cartForOrder = cleanedCart;
    setCarts((prev) => ({ ...prev, [currentTableKey]: cleanedCart }));
  }
}

const items = Object.entries(cartForOrder)`,
'automatic checkout cleanup'
);

// ------------------------------------------------------------
// 6) Success toast can mention silent cleanup without blocking.
// ------------------------------------------------------------
replaceRegexOnce(
/setShowOrderForm\(false\);\s*setToast\('\u0110\u00e3 g\u1eedi Order'\);/,
`setShowOrderForm(false);
setToast(
  autoRemovedCartRows > 0
    ? \`\\u0110\\u00e3 g\\u1eedi Order \\u2022 t\\u1ef1 b\\u1ecf \${autoRemovedCartRows} m\\u00f3n c\\u0169\`
    : '\\u0110\\u00e3 g\\u1eedi Order'
);`,
'success toast'
);

// ------------------------------------------------------------
// 7) Post checks
// ------------------------------------------------------------
const checks = [
  ['v2 marker', s.includes('CART_SAFETY_V2_AUTO_GUARDIAN')],
  ['guardian listener', s.includes("socket.on('floorlensUpdated', onFloorlensUpdatedForCartGuardian)")],
  ['safe filter', s.includes('keepOnlyCartOwner')],
  ['auto cleanup', s.includes('let cartForOrder = currentCart;')],
  ['old wrongOwner removed', !s.includes('const wrongOwner =')],
  ['english mixed alert removed', !s.includes('This cart contains old items or items from another customer.')],
  ['target popup removed', !s.includes('Please review or clear that machine cart first.')],
];

for (const [name, ok] of checks) {
  if (!ok) throw new Error(`Post-check failed: ${name}`);
}

fs.writeFileSync(file, s, 'utf8');
console.log('CART_GUARDIAN_V2_AUTO patched successfully');
'@

[System.IO.File]::WriteAllText(
  $tempJs,
  $patcher,
  (New-Object System.Text.ASCIIEncoding)
)

Write-Host "Backup: $backupDir" -ForegroundColor Cyan
Write-Host "Applying CART_GUARDIAN_V2_AUTO..." -ForegroundColor Yellow

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
Write-Host "CART GUARDIAN V2 + BUILD PASSED" -ForegroundColor Green
Write-Host "Backup: $backupDir" -ForegroundColor Cyan
