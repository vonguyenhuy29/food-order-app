const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'food-order-backend/server.js'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'food-order-user/src/components/FoodList.js'), 'utf8');
const between = (text, start, end) => {
  const from = text.indexOf(start);
  assert.ok(from >= 0, start);
  const to = text.indexOf(end, from);
  assert.ok(to > from, end);
  return text.slice(from, to);
};
const plain = x => JSON.parse(JSON.stringify(x));
function backend(snapshot) {
  let handler;
  const events = [], persisted = [];
  const previous = { id: 1, memberCard: '101', area: 'Area', tableNo: 1, status: 'PENDING', tableClosed: false, createdAt: new Date().toISOString() };
  const context = {
    console, app: { post: (_url, _limiter, fn) => { handler = fn; } }, orderLimiter: () => {},
    orders: [previous], members: {}, foods: [],
    floorlensService: { getSnapshot: () => snapshot },
    normalizeFloorlensOrderStation: value => value || '',
    loadProductsSafe: () => [{ imageName: 'soup.jpg', name: 'Soup', code: 'F1', price: 100 }],
    sqliteStore: { loadFoods: () => [{ imageUrl: '/soup.jpg', status: 'Available' }] },
    getRefFoodByImageName: () => ({ status: 'Available' }),
    extractImageName: value => value?.split('/').pop(),
    cleanDishNameFromImageName: value => value,
    cleanMemberId: value => String(value).replace(/\s+/g, ''),
    buildCustomerSnapshot: async code => ({ code, name: 'Customer ' + code }),
    nextOrderId: () => 2,
    persistOrder: order => persisted.push(plain(order)), persistMember: () => {},
    getBestKnownCustomerIdentity: () => ({}),
    meaningfulCustomerName: name => name, meaningfulCustomerLevel: level => level,
    io: { emit: (name, data) => events.push({ name, data }) },
  };
  vm.runInNewContext(between(server, "app.post('/api/orders',", '// User Orders View'), context);
  return { context, previous, events, persisted, async send(overrides = {}) {
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
    await handler({ body: { clientRequestId: 'test-request', area: 'Area', tableNo: 1, staff: '9', memberCard: '202', items: [{ imageKey: 'soup.jpg', qty: 2, note: 'hot' }], ...overrides } }, res);
    return res;
  } };
}
for (const [name, machines] of [
  ['another customer at selected location', [{ machineNumber: '1', memberCode: '101' }]],
  ['recipient moved to another location', [{ machineNumber: '2', memberCode: '202' }]],
  ['recipient removed card', []],
]) {
  test(name + ': accept food order and preserve other pending order', async () => {
    const app = backend({ machines: machines.map(m => ({ ...m, area: 'Area', checkState: 'ok', online: true, isPlaying: true })) });
    const res = await app.send();
    assert.equal(res.statusCode, 200); assert.equal(res.body.ok, true);
    assert.equal(app.persisted.length, 1);
    assert.equal(app.persisted[0].memberCard, '202');
    assert.equal(app.persisted[0].tableNo, 1);
    assert.equal(app.persisted[0].items[0].qty, 2);
    assert.equal(app.previous.status, 'PENDING'); assert.equal(app.previous.tableClosed, false);
    assert.equal(app.events.filter(e => e.name === 'orderPlaced').length, 1);
    const retry = await app.send();
    assert.equal(retry.body.duplicate, true); assert.equal(app.persisted.length, 1);
  });
}
test('sold-out and empty orders remain rejected without saving', async () => {
  const app = backend({ machines: [] });
  app.context.getRefFoodByImageName = () => ({ status: 'Sold Out' });
  assert.equal((await app.send()).body.error, 'FOOD_SOLD_OUT');
  assert.equal((await app.send({ items: [] })).statusCode, 400);
  assert.equal(app.persisted.length, 0);
});
test('draft selection preserves recipient after movement; blank drafts can prefill', () => {
  const choose = vm.runInNewContext(between(ui, 'const cartOwnerCodeOf', 'function compactCarts') + '\ndraftMemberForSelection');
  const cart = { soup: { qty: 2, ownerMemberCode: '101' } };
  assert.equal(choose(cart, '101', true, '202'), '101');
  assert.equal(choose(cart, '', false, '202'), '101');
  assert.equal(choose(cart, '101', true, ''), '101');
  assert.equal(choose({}, '', false, '202'), '202');
  assert.equal(choose({ soup: { qty: 2 } }, '', false, '202'), '');
});
function frontend() {
  const cart = { 'soup.jpg': { qty: 2, note: 'hot', ownerMemberCode: '101' }, '__offmenu__1': { qty: 1, name: 'Rice', isOffMenu: true } };
  let posted;
  const noop = () => {};
  const ctx = {
    currentCart: cart, currentTableKey: 'Area#1', selectedTable: { area: 'Area', tableNo: 1 }, totalItems: 3,
    orderForm: { staff: '9', memberCard: '202', customerName: 'Đang tìm khách...' },
    memberLookupLoading: true, memberLookupSeqRef: { current: 1 }, currentMemberCardRef: { current: '202' }, memberRefreshTimerRef: { current: null },
    placeOrderLockRef: { current: false }, orderRequestIdRef: { current: null },
    isOffMenuKey: key => key.startsWith('__offmenu__'), OFF_MENU_CODE: 'H100',
    sanitizeCustomerSnapshotForOrder: () => ({ code: '202', name: null }),
    currentFloorlensOrderStation: () => '', apiUrl: url => url,
    localStorage: { setItem: noop }, alert: message => { throw new Error(message); },
    axios: { post: async (_url, body) => { posted = plain(body); return { data: { ok: true } }; } },
  };
  for (const name of ['setToast','setCarts','setMode','setShowOrderForm','setIsPlacingOrder','setOrderForm','setMemberSearchText','setMemberSuggestions','setMemberApiRefreshing','setMemberDropdownOpen','setCustomerSpending','setCustomerSpendingLoading','setMemberLookupLoading','fetchFoods']) ctx[name] = noop;
  const send = vm.runInNewContext(between(ui, 'const placeOrder = async', '  // Helper map imageName') + '\nplaceOrder', ctx);
  return { ctx, cart, send, posted: () => posted };
}
test('send visible items to entered member even while lookup pending and owners differ', async () => {
  const app = frontend(); const before = plain(app.cart);
  await app.send();
  assert.equal(app.posted().memberCard, '202');
  assert.deepEqual(app.posted().items.map(i => i.qty), [2, 1]);
  assert.equal(app.posted().items[0].note, 'hot');
  assert.deepEqual(app.cart, before);
  assert.equal(app.ctx.memberLookupSeqRef.current, 2);
});
test('failed request keeps cart and reuses request ID on retry', async () => {
  const app = frontend(); const before = plain(app.cart); const ids = [];
  app.ctx.alert = () => {};
  app.ctx.axios.post = async (_url, body) => { ids.push(body.clientRequestId); throw new Error('offline'); };
  await app.send(); await app.send();
  assert.equal(ids.length, 2); assert.equal(ids[0], ids[1]);
  assert.deepEqual(app.cart, before);
});
