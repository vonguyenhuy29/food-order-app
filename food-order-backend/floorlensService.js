const http = require('http');
const https = require('https');

// ===== FloorLens realtime source (new) =====
// Namespace Socket.IO đã xác nhận từ FloorLens mới.
const DEFAULT_REALTIME_URL = 'http://192.168.101.58:8234/gaming-session';
const DEFAULT_SOCKET_PATH = '/socket.io';

// ===== Legacy fallback source =====
// Chỉ dùng khi Socket.IO realtime không kết nối / chưa có snapshot.
const DEFAULT_API_URL = 'http://192.168.101.58:8090/api/machine_player_by_machine_number';

const POLL_MS = Math.max(10000, Number(process.env.NEON_FLOORLENS_POLL_MS || 15000));
const TIMEOUT_MS = Math.max(3000, Number(process.env.NEON_FLOORLENS_TIMEOUT_MS || 10000));
const BASE_REQUEST_GAP_MS = Math.max(250, Number(process.env.NEON_FLOORLENS_REQUEST_GAP_MS || 400));
const MAX_REQUEST_GAP_MS = Math.max(BASE_REQUEST_GAP_MS, Number(process.env.NEON_FLOORLENS_MAX_REQUEST_GAP_MS || 2000));
const EMIT_EVERY = Math.max(1, Number(process.env.NEON_FLOORLENS_EMIT_EVERY || 5));
const MAX_429_RETRIES = Math.min(5, Math.max(0, Number(process.env.NEON_FLOORLENS_429_RETRIES || 3)));
const DEFAULT_429_WAIT_MS = Math.max(5000, Number(process.env.NEON_FLOORLENS_429_WAIT_MS || 15000));
const MAX_RESPONSE_BYTES = 1024 * 1024;

const REALTIME_CONNECT_GRACE_MS = Math.max(
  3000,
  Number(process.env.FLOORLENS_REALTIME_CONNECT_GRACE_MS || 10000)
);
const REALTIME_FALLBACK_DELAY_MS = Math.max(
  1000,
  Number(process.env.FLOORLENS_REALTIME_FALLBACK_DELAY_MS || 5000)
);
const REALTIME_EMIT_DEBOUNCE_MS = Math.max(
  0,
  Number(process.env.FLOORLENS_REALTIME_EMIT_DEBOUNCE_MS || 100)
);

// ===== FloorLens visual layout + customer avatar =====
const DEFAULT_FLOORLENS_ORIGIN = 'http://192.168.101.58:8234';
const DEFAULT_MAP_API_ORIGIN = 'http://192.168.101.58:8111';
const LAYOUT_CACHE_MS = Math.max(60 * 1000, Number(process.env.FLOORLENS_LAYOUT_CACHE_MS || 5 * 60 * 1000));
const MAP_IMAGE_CACHE_MS = Math.max(60 * 1000, Number(process.env.FLOORLENS_MAP_IMAGE_CACHE_MS || 5 * 60 * 1000));
const AVATAR_CACHE_MS = Math.max(60 * 1000, Number(process.env.FLOORLENS_AVATAR_CACHE_MS || 6 * 60 * 60 * 1000));
const AVATAR_NONE_CACHE_MS = Math.max(30 * 1000, Number(process.env.FLOORLENS_AVATAR_NONE_CACHE_MS || 10 * 60 * 1000));
const AVATAR_CACHE_LIMIT = Math.max(50, Number(process.env.FLOORLENS_AVATAR_CACHE_LIMIT || 400));
const AVATAR_CONCURRENCY = Math.min(10, Math.max(1, Number(process.env.FLOORLENS_AVATAR_CONCURRENCY || 5)));
const LAYOUT_MAX_BYTES = Math.max(1024 * 1024, Number(process.env.FLOORLENS_LAYOUT_MAX_BYTES || 8 * 1024 * 1024));
const MAP_IMAGE_MAX_BYTES = Math.max(2 * 1024 * 1024, Number(process.env.FLOORLENS_MAP_IMAGE_MAX_BYTES || 20 * 1024 * 1024));
const AVATAR_MAX_BYTES = Math.max(512 * 1024, Number(process.env.FLOORLENS_AVATAR_MAX_BYTES || 6 * 1024 * 1024));
const HISTORY_PER_MACHINE = Math.max(20, Number(process.env.FLOORLENS_HISTORY_PER_MACHINE || 100));

const AREA_RULES = [
  ['Roulette 1', [[101, 117]]],
  ['Roulette 2', [[201, 231]]],
  ['Roulette 3', [[301, 317]]],
  ['Reception 1', [[7001, 7008]]],
  ['Reception 2', [[1001, 1004], [1009, 1020]]],
  ['Center', [[1005, 1008], [1023, 1030], [3001, 3008], [3012, 3012], [3014, 3027]]],
  ['Multi', [[501, 510], [8001, 8006]]],
  ['Table', [[11, 15], [21, 25]]],
  ['2 Floor', [
    [1021, 1021], [3013, 3013],
    [2001, 2006], [2008, 2014], [2016, 2016], [2018, 2018], [2021, 2028],
    [8007, 8009],
  ]],
];

const text = (value) => String(value == null ? '' : value).trim();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function inferArea(machineNumber) {
  const n = Number(machineNumber);
  if (!Number.isFinite(n)) return 'Other';
  for (const [area, ranges] of AREA_RULES) {
    if (ranges.some(([from, to]) => n >= from && n <= to)) return area;
  }
  return 'Other';
}

function configuredMachineNumbers() {
  const configured = text(process.env.FLOORLENS_MACHINE_NUMBERS);
  if (configured) {
    return [...new Set(configured.split(/[\s,;]+/).map(text).filter((v) => /^\d+$/.test(v)))];
  }

  const result = [];
  AREA_RULES.forEach(([, ranges]) => ranges.forEach(([from, to]) => {
    for (let n = from; n <= to; n += 1) result.push(String(n));
  }));
  return [...new Set(result)];
}

function businessDate(now = new Date()) {
  // Business day 06:00 -> 05:59 theo giờ Việt Nam UTC+7, độc lập timezone của máy chạy Node.
  const nowMs = new Date(now).getTime();
  const shiftedVn = new Date(nowMs + (7 - 6) * 60 * 60 * 1000);
  return `${shiftedVn.getUTCFullYear()}-${String(shiftedVn.getUTCMonth() + 1).padStart(2, '0')}-${String(shiftedVn.getUTCDate()).padStart(2, '0')}`;
}

function parseDate(value) {
  if (value == null || value === '') return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

// ===== Legacy machine API helpers =====
const memberNumber = (row) => text(row?.Customer_Number ?? row?.customerNumber ?? row?.memberCode ?? row?.customer_number);
const sessionStart = (row) => row?.StartDateTime ?? row?.startDateTime ?? row?.startedAt ?? row?.startTime ?? null;

function isOpenSession(row) {
  const hasKnownEndField = row && ['EndDateTime', 'endDateTime', 'endedAt', 'endTime']
    .some((key) => Object.prototype.hasOwnProperty.call(row, key));
  if (!hasKnownEndField) return false;
  const end = row.EndDateTime ?? row.endDateTime ?? row.endedAt ?? row.endTime;
  return end == null || text(end) === '';
}

function extractSessions(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.results)) return payload.results;
  return [];
}

function hasSessionEvidence(row) {
  if (!row || typeof row !== 'object') return false;

  const keys = [
    'MachinePlayerSessionID', 'machinePlayerSessionId', 'sessionId',
    'Machine_Number', 'machineNumber', 'machine_number',
    'StartDateTime', 'startDateTime', 'startedAt', 'startTime',
    'Game', 'game',
    'Buyin', 'buyin',
    'CoinOut', 'coinOut',
    'GamesPlayed', 'gamesPlayed',
    'Jackpots', 'jackpots',
    'Customer_Number', 'customerNumber', 'memberCode', 'customer_number',
  ];

  return keys.some((key) => {
    if (!Object.prototype.hasOwnProperty.call(row, key)) return false;
    const value = row[key];
    if (value == null) return false;
    if (typeof value === 'number') return Number.isFinite(value);
    return text(value) !== '';
  });
}

function newestOpenSession(payload) {
  return extractSessions(payload)
    .filter((row) => isOpenSession(row) && hasSessionEvidence(row))
    .sort((a, b) => (parseDate(sessionStart(b)) || 0) - (parseDate(sessionStart(a)) || 0))[0] || null;
}

function emptyMachine(machineNumber, overrides = {}) {
  const area = inferArea(machineNumber);
  return {
    machineNumber: text(machineNumber),
    area,
    // Roulette 3 nằm ở tầng 2 nhưng vẫn giữ area là Roulette 3.
    floor: area === '2 Floor' || area === 'Roulette 3' ? '2F' : '1F',
    machineType: area === 'Table' ? 'Weike' : area === 'Multi' ? 'Multi' : 'Machine',
    online: true,
    isPlaying: false,
    memberCode: '',
    customerName: '',
    unknownPlayer: false,
    unknownPlayerId: null,
    sessionId: null,
    startedAt: null,
    checkState: 'ok',
    machineId: null,
    themeName: '',
    gameTypeName: '',
    manufacturer: '',
    ...overrides,
  };
}

function retryAfterMsFromHeader(value) {
  if (value == null || value === '') return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.max(1000, seconds * 1000);
  const when = Date.parse(value);
  if (!Number.isFinite(when)) return null;
  return Math.max(1000, when - Date.now());
}

function requestJson(urlValue, payload) {
  return new Promise((resolve, reject) => {
    let target;
    try {
      target = new URL(urlValue);
    } catch {
      reject(new Error('INVALID_API_URL'));
      return;
    }

    const body = JSON.stringify(payload);
    const transport = target.protocol === 'https:' ? https : http;
    const request = transport.request(target, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: TIMEOUT_MS,
    }, (response) => {
      const chunks = [];
      let size = 0;

      response.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_RESPONSE_BYTES) {
          request.destroy(new Error('API_RESPONSE_TOO_LARGE'));
          return;
        }
        chunks.push(chunk);
      });

      response.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        if (response.statusCode < 200 || response.statusCode >= 300) {
          const error = new Error(`HTTP_${response.statusCode}`);
          error.statusCode = response.statusCode;
          error.retryAfterMs = retryAfterMsFromHeader(response.headers?.['retry-after']);
          error.responseBody = raw.slice(0, 300);
          reject(error);
          return;
        }

        try {
          resolve(raw ? JSON.parse(raw) : {});
        } catch {
          reject(new Error('INVALID_JSON_RESPONSE'));
        }
      });
    });

    request.on('timeout', () => request.destroy(new Error(`TIMEOUT_${TIMEOUT_MS}MS`)));
    request.on('error', reject);
    request.end(body);
  });
}


function requestBuffer(urlValue, {
  method = 'GET',
  jsonPayload,
  timeoutMs = TIMEOUT_MS,
  maxBytes = MAX_RESPONSE_BYTES,
  headers = {},
} = {}) {
  return new Promise((resolve, reject) => {
    let target;
    try {
      target = new URL(urlValue);
    } catch {
      reject(new Error('INVALID_API_URL'));
      return;
    }

    const hasBody = jsonPayload !== undefined;
    const body = hasBody ? JSON.stringify(jsonPayload) : null;
    const transport = target.protocol === 'https:' ? https : http;
    const requestHeaders = {
      Accept: '*/*',
      ...headers,
    };
    if (hasBody) {
      requestHeaders['Content-Type'] = 'application/json';
      requestHeaders['Content-Length'] = Buffer.byteLength(body);
    }

    const request = transport.request(target, {
      method,
      headers: requestHeaders,
      timeout: timeoutMs,
    }, (response) => {
      const chunks = [];
      let size = 0;

      response.on('data', (chunk) => {
        size += chunk.length;
        if (size > maxBytes) {
          request.destroy(new Error('API_RESPONSE_TOO_LARGE'));
          return;
        }
        chunks.push(chunk);
      });

      response.on('end', () => {
        const buffer = Buffer.concat(chunks);
        if (response.statusCode < 200 || response.statusCode >= 300) {
          const error = new Error(`HTTP_${response.statusCode}`);
          error.statusCode = response.statusCode;
          error.retryAfterMs = retryAfterMsFromHeader(response.headers?.['retry-after']);
          error.responseBody = buffer.toString('utf8', 0, Math.min(buffer.length, 300));
          reject(error);
          return;
        }
        resolve({
          buffer,
          statusCode: response.statusCode,
          headers: response.headers || {},
          finalUrl: target.toString(),
        });
      });
    });

    request.on('timeout', () => request.destroy(new Error(`TIMEOUT_${timeoutMs}MS`)));
    request.on('error', reject);
    if (body) request.end(body);
    else request.end();
  });
}

async function requestJsonMethod(urlValue, options = {}) {
  const response = await requestBuffer(urlValue, {
    ...options,
    headers: {
      Accept: 'application/json',
      ...(options.headers || {}),
    },
  });
  const raw = response.buffer.toString('utf8');
  try {
    return {
      ...response,
      json: raw ? JSON.parse(raw) : {},
    };
  } catch {
    throw new Error('INVALID_JSON_RESPONSE');
  }
}

function absoluteUrl(value, baseValue) {
  const raw = text(value);
  if (!raw) return '';
  if (/^data:/i.test(raw)) return raw;
  try {
    return new URL(raw, baseValue).toString();
  } catch {
    return raw;
  }
}

function uniqueUrls(values) {
  return [...new Set((values || []).map(text).filter(Boolean))];
}

function unwrapApiData(payload) {
  if (!payload || typeof payload !== 'object') return payload;
  if (payload.data && typeof payload.data === 'object') return payload.data;
  return payload;
}

function detectImageContentType(buffer, fallback = 'image/jpeg') {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) return fallback;
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'image/png';
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return 'image/jpeg';
  if (buffer.slice(0, 4).toString('ascii') === 'RIFF' && buffer.slice(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return fallback;
}

function extractAvatarBase64(payload) {
  let value = payload;
  if (value && typeof value === 'object' && !Buffer.isBuffer(value)) {
    value = value.data ?? value.image ?? value.base64 ?? value.avatar ?? null;
  }
  if (typeof value !== 'string') return '';
  let raw = value.trim();
  if (!raw || raw === 'null' || raw.length < 100) return '';
  const match = raw.match(/^data:image\/[a-z0-9.+-]+;base64,(.+)$/i);
  if (match) raw = match[1];
  return raw.replace(/\s+/g, '');
}

async function fetchMachine(endpoint, machineNumber, date) {
  const payload = await requestJson(endpoint, { date, machine_number: Number(machineNumber) });
  const active = newestOpenSession(payload);
  if (!active) return emptyMachine(machineNumber);

  const code = memberNumber(active);
  const unknownPlayer = !code;

  return emptyMachine(machineNumber, {
    isPlaying: true,
    memberCode: code,
    customerName: unknownPlayer ? 'Unknown Player' : '',
    unknownPlayer,
    // Không hiển thị Playing since / Playing time nên không parse timezone của API cũ.
    startedAt: null,
  });
}

function safeError(error) {
  const code = text(error?.code);
  const message = text(error?.message || error);
  return [code, message].filter(Boolean).join(': ').slice(0, 180) || 'UNKNOWN_ERROR';
}

async function fetchMachineWith429Retry(endpoint, machineNumber, date, logger, { onRateLimited } = {}) {
  for (let attempt = 0; attempt <= MAX_429_RETRIES; attempt += 1) {
    try {
      return await fetchMachine(endpoint, machineNumber, date);
    } catch (error) {
      if (Number(error?.statusCode) !== 429 || attempt >= MAX_429_RETRIES) throw error;

      const waitMs = Math.max(
        1000,
        Number(error?.retryAfterMs || 0) || DEFAULT_429_WAIT_MS * (attempt + 1)
      );

      try { onRateLimited?.({ waitMs, attempt, machineNumber }); } catch (_) {}
      logger.warn?.(
        `[FloorLens] Legacy Machine API 429 at machine ${machineNumber}. ` +
        `Waiting ${Math.ceil(waitMs / 1000)}s before retry ${attempt + 1}/${MAX_429_RETRIES}.`
      );
      await sleep(waitMs);
    }
  }
  throw new Error('HTTP_429');
}

// ===== Realtime helpers =====
function realtimeMachineNumber(row) {
  return text(row?.MachineNumber ?? row?.machineNumber ?? row?.Machine_Number ?? row?.machine_number);
}

function realtimeSessionId(row) {
  return text(row?.SessionID ?? row?.sessionId ?? row?.MachinePlayerSessionID ?? row?.machinePlayerSessionId);
}

function isRealtimeOpenSession(row) {
  if (!row || typeof row !== 'object') return false;

  const status = Number(row.Status ?? row.status);
  const end = row.EndDateTime ?? row.endDateTime ?? row.endedAt ?? row.endTime ?? null;

  // Payload FloorLens mới: Status=1 + EndDateTime=null => đang mở.
  if (Number.isFinite(status)) return status === 1 && (end == null || text(end) === '');

  // Fallback phòng trường hợp server bỏ Status nhưng vẫn giữ EndDateTime.
  return end == null || text(end) === '';
}

function normalizeRealtimeSession(row) {
  if (!row || typeof row !== 'object') return null;
  const machineNumber = realtimeMachineNumber(row);
  if (!machineNumber) return null;

  const memberCode = text(row.Number ?? row.Customer_Number ?? row.customerNumber ?? row.memberCode);
  const customerName = text(row.CustomerName ?? row.customerName);
  const unknownPlayerIdRaw = row.UnknownPlayerID ?? row.unknownPlayerId ?? null;
  const unknownPlayerId = unknownPlayerIdRaw == null || text(unknownPlayerIdRaw) === ''
    ? null
    : unknownPlayerIdRaw;

  return {
    raw: row,
    sessionId: realtimeSessionId(row) || null,
    machineNumber,
    memberCode,
    customerName,
    unknownPlayerId,
    unknownPlayer: !memberCode,
    status: Number(row.Status ?? row.status),
    startedAt: row.StartDateTime ?? row.startDateTime ?? row.startedAt ?? row.StartGamingDate ?? null,
    endedAt: row.EndDateTime ?? row.endDateTime ?? row.endedAt ?? null,
  };
}

function createFloorlensService({
  io,
  logger = console,
  resolveCustomerName = null,
  enrichSnapshot = null,
} = {}) {
  const legacyEndpoint = text(process.env.NEON_FLOORLENS_URL) || DEFAULT_API_URL;
  const realtimeUrl = text(process.env.FLOORLENS_REALTIME_URL) || DEFAULT_REALTIME_URL;
  const socketPath = text(process.env.FLOORLENS_SOCKET_PATH) || DEFAULT_SOCKET_PATH;
  const configuredNumbers = configuredMachineNumbers();

  let realtimeOrigin = DEFAULT_FLOORLENS_ORIGIN;
  try { realtimeOrigin = new URL(realtimeUrl).origin; } catch (_) {}
  const mapId = text(process.env.FLOORLENS_MAP_ID) || '1';
  const layoutUrlCandidates = uniqueUrls([
    process.env.FLOORLENS_LAYOUT_URL,
    `${realtimeOrigin}/api/map/maps/${encodeURIComponent(mapId)}/layout`,
    `${DEFAULT_MAP_API_ORIGIN}/api/map/maps/${encodeURIComponent(mapId)}/layout`,
  ]);
  const avatarUrlCandidates = uniqueUrls([
    process.env.FLOORLENS_AVATAR_URL,
    `${realtimeOrigin}/api/customer_image`,
    `${DEFAULT_MAP_API_ORIGIN}/api/customer_image`,
  ]);
  const avatarComputer = text(process.env.FLOORLENS_AVATAR_COMPUTER) || 'DATABASE';

  let snapshot = {
    source: 'floorlens-starting',
    connected: false,
    realtimeConnected: false,
    realtimeReady: false,
    fallbackActive: false,
    scanning: false,
    rateLimited: false,
    updatedAt: null,
    lastRealtimeAt: null,
    scanStartedAt: null,
    scanCompletedAt: null,
    businessDate: businessDate(),
    gamingDate: businessDate(),
    serverTime: null,
    totalSessions: 0,
    sourceCounts: null,
    machines: configuredNumbers.map((n) => emptyMachine(n, { online: false, checkState: 'pending' })),
    checkedMachines: 0,
    failedMachines: configuredNumbers.length,
    error: null,
    realtimeError: null,
    errorSamples: [],
  };

  const activeByMachine = new Map();
  const machineMetaByNumber = new Map();
  const historyByMachine = new Map();
  const recentActivityKeys = new Map();

  let layoutCache = null;
  let layoutFetchedAt = 0;
  let layoutInflight = null;
  let layoutSourceUrl = '';
  let layoutRawImageUrl = '';
  let mapImageCache = null;
  let mapImageFetchedAt = 0;
  let mapImageInflight = null;

  const avatarCache = new Map();
  const avatarInflight = new Map();
  const avatarQueue = [];
  let avatarActive = 0;

  let upstreamSocket = null;
  let realtimeConnected = false;
  let realtimeReady = false;
  let started = false;
  let fallbackTimer = null;
  let connectGraceTimer = null;
  let rolloverReconnectTimer = null;
  let emitTimer = null;
  let inFlight = false;
  let adaptiveGapMs = BASE_REQUEST_GAP_MS;

  function currentMachineNumbers() {
    const set = new Set();

    // Khi realtime snapshot có machine registry thì lấy registry đó làm nguồn chính.
    if (machineMetaByNumber.size > 0) {
      for (const key of machineMetaByNumber.keys()) set.add(key);
    } else {
      for (const key of configuredNumbers) set.add(key);
    }

    // Không làm mất session nếu upstream gửi machine mới chưa có trong registry.
    for (const key of activeByMachine.keys()) set.add(key);

    return [...set].sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }));
  }

  function machineFromRealtime(machineNumber) {
    const number = text(machineNumber);
    const meta = machineMetaByNumber.get(number) || {};
    const session = activeByMachine.get(number) || null;

    const memberCode = text(session?.memberCode);
    const unknownPlayer = Boolean(session && !memberCode);

    return emptyMachine(number, {
      online: true,
      checkState: 'ok',
      isPlaying: Boolean(session),
      memberCode,
      customerName: session
        ? (unknownPlayer ? 'Unknown Player' : text(session.customerName))
        : '',
      unknownPlayer,
      unknownPlayerId: session?.unknownPlayerId ?? null,
      sessionId: session?.sessionId ?? null,
      startedAt: session?.startedAt ?? null,
      machineId: meta?.MachineID ?? meta?.machineId ?? null,
      themeName: text(meta?.ThemeName ?? meta?.themeName),
      gameTypeName: text(meta?.GameTypeName ?? meta?.gameTypeName),
      manufacturer: text(meta?.Manufacturer ?? meta?.manufacturer),
      machineType: text(meta?.GameTypeName ?? meta?.gameTypeName) || emptyMachine(number).machineType,
    });
  }

  function rebuildRealtimeMachines() {
    return currentMachineNumbers().map(machineFromRealtime);
  }

  function publicSnapshot() {
    const machines = (Array.isArray(snapshot.machines) ? snapshot.machines : []).map((m) => {
      const machine = { ...m };
      const code = text(machine.memberCode);

      // Realtime payload đã có CustomerName nên không query SQLite 85 lần/mỗi delta.
      // Chỉ resolve DB/order history khi nguồn hiện tại chưa có tên (chủ yếu fallback API cũ).
      if (code && !text(machine.customerName) && typeof resolveCustomerName === 'function') {
        try {
          const resolvedName = text(resolveCustomerName(code));
          if (resolvedName) machine.customerName = resolvedName;
        } catch (_) {}
      }
      return machine;
    });

    const updatedAt = Date.parse(snapshot.updatedAt);
    const verified = machines.filter((m) => m.checkState === 'ok' && m.online !== false);
    const failedMachines = machines.length - verified.length;
    const playing = verified.filter((m) => m.isPlaying);
    const unknownCount = playing.filter((m) => m.unknownPlayer || !text(m.memberCode)).length;
    const playingCount = playing.length;
    const idleCount = Math.max(0, verified.length - playingCount);

    const base = {
      ...snapshot,
      connected: Boolean(realtimeReady || snapshot.connected),
      realtimeConnected,
      realtimeReady,
      fallbackActive: Boolean(snapshot.fallbackActive && !realtimeReady),
      stale: realtimeReady
        ? false
        : (!Number.isFinite(updatedAt) || Date.now() - updatedAt > Math.max(POLL_MS * 3, 5 * 60 * 1000)),
      totalMachines: machines.length,
      requestGapMs: adaptiveGapMs,
      playingCount,
      unknownCount,
      idleCount,
      availableCount: idleCount,
      checkedMachines: verified.length,
      failedMachines,
      layoutReady: Boolean(layoutCache),
      machines,
    };

    if (typeof enrichSnapshot === 'function') {
      try {
        const enriched = enrichSnapshot(base);
        if (enriched && typeof enriched === 'object') return enriched;
      } catch (error) {
        logger.warn?.('[FloorLens] enrichSnapshot failed:', safeError(error));
      }
    }

    return base;
  }

  function emitSnapshotNow() {
    if (emitTimer) {
      clearTimeout(emitTimer);
      emitTimer = null;
    }
    io?.emit('floorlensUpdated', publicSnapshot());
  }

  function scheduleEmitSnapshot(delay = REALTIME_EMIT_DEBOUNCE_MS) {
    if (delay <= 0) {
      emitSnapshotNow();
      return;
    }
    if (emitTimer) return;
    emitTimer = setTimeout(() => {
      emitTimer = null;
      io?.emit('floorlensUpdated', publicSnapshot());
    }, delay);
    emitTimer.unref?.();
  }

  function clearFallbackTimer() {
    if (fallbackTimer) clearTimeout(fallbackTimer);
    fallbackTimer = null;
  }

  function scheduleFallback(delay = REALTIME_FALLBACK_DELAY_MS) {
    if (!started || realtimeReady || fallbackTimer) return;

    fallbackTimer = setTimeout(async () => {
      fallbackTimer = null;
      if (!started || realtimeReady) return;

      try {
        await syncLegacyFallback();
      } catch (error) {
        logger.error?.('[FloorLens] fallback scan failed:', safeError(error));
      }

      if (started && !realtimeReady) scheduleFallback(POLL_MS);
    }, Math.max(0, delay));
    fallbackTimer.unref?.();
  }

  function historyRowFromSession(rawSession) {
    const session = normalizeRealtimeSession(rawSession);
    if (!session) return null;
    return {
      sessionId: session.sessionId,
      machineNumber: session.machineNumber,
      memberCode: session.memberCode,
      customerName: session.customerName,
      unknownPlayer: session.unknownPlayer,
      unknownPlayerId: session.unknownPlayerId,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      active: isRealtimeOpenSession(rawSession),
      status: Number(rawSession?.Status ?? rawSession?.status),
    };
  }

  function historySortValue(row) {
    return parseDate(row?.startedAt) || Number(row?.sessionId) || 0;
  }

  function historyKey(row) {
    return text(row?.sessionId) || [
      text(row?.machineNumber),
      text(row?.memberCode || row?.unknownPlayerId),
      text(row?.startedAt),
    ].join('|');
  }

  function setHistoryFromSnapshot(rows) {
    historyByMachine.clear();
    for (const raw of Array.isArray(rows) ? rows : []) {
      const row = historyRowFromSession(raw);
      if (!row) continue;
      const list = historyByMachine.get(row.machineNumber) || [];
      list.push(row);
      historyByMachine.set(row.machineNumber, list);
    }
    for (const [number, list] of historyByMachine.entries()) {
      const deduped = new Map();
      for (const row of list) deduped.set(historyKey(row), row);
      historyByMachine.set(
        number,
        [...deduped.values()].sort((a, b) => historySortValue(b) - historySortValue(a)).slice(0, HISTORY_PER_MACHINE)
      );
    }
  }

  function upsertHistory(rawSession) {
    const row = historyRowFromSession(rawSession);
    if (!row) return;
    const list = [...(historyByMachine.get(row.machineNumber) || [])];
    const key = historyKey(row);
    const index = list.findIndex((item) => historyKey(item) === key);
    if (index >= 0) {
      const previous = list[index];
      list[index] = {
        ...previous,
        ...row,
        memberCode: row.memberCode || previous.memberCode || '',
        customerName: row.customerName || previous.customerName || '',
        unknownPlayerId: row.unknownPlayerId ?? previous.unknownPlayerId ?? null,
        unknownPlayer: row.memberCode ? false : (row.unknownPlayer || previous.unknownPlayer),
        startedAt: row.startedAt || previous.startedAt || null,
        endedAt: row.endedAt || previous.endedAt || null,
      };
    } else list.push(row);
    list.sort((a, b) => historySortValue(b) - historySortValue(a));
    historyByMachine.set(row.machineNumber, list.slice(0, HISTORY_PER_MACHINE));
  }

  function resolvedSessionName(session) {
    let name = text(session?.customerName);
    const code = text(session?.memberCode);
    if (!name && code && typeof resolveCustomerName === 'function') {
      try { name = text(resolveCustomerName(code)); } catch (_) {}
    }
    return name;
  }

  function emitActivity(kind, rawSession) {
    const parsed = normalizeRealtimeSession(rawSession);
    if (!parsed) return;

    const current = activeByMachine.get(parsed.machineNumber) || null;
    const session = kind === 'LEAVE' && current
      ? {
          ...parsed,
          memberCode: parsed.memberCode || current.memberCode || '',
          customerName: parsed.customerName || current.customerName || '',
          unknownPlayerId: parsed.unknownPlayerId ?? current.unknownPlayerId ?? null,
          unknownPlayer: (parsed.memberCode || current.memberCode) ? false : true,
          startedAt: parsed.startedAt || current.startedAt || null,
        }
      : parsed;

    const now = Date.now();
    for (const [key, at] of recentActivityKeys.entries()) {
      if (now - at > 2 * 60 * 1000) recentActivityKeys.delete(key);
    }

    const key = [kind, session.sessionId || '', session.machineNumber, session.memberCode || session.unknownPlayerId || ''].join('|');
    if (recentActivityKeys.has(key)) return;
    recentActivityKeys.set(key, now);

    const baseMachine = emptyMachine(session.machineNumber);
    const customerName = session.unknownPlayer ? 'Unknown Player' : (resolvedSessionName(session) || `Member ${session.memberCode}`);

    io?.emit('floorlensActivity', {
      id: `${kind}-${session.sessionId || session.machineNumber}-${now}`,
      kind,
      machineNumber: session.machineNumber,
      area: baseMachine.area,
      floor: baseMachine.floor,
      sessionId: session.sessionId,
      memberCode: session.memberCode,
      customerName,
      unknownPlayer: session.unknownPlayer,
      unknownPlayerId: session.unknownPlayerId,
      startedAt: session.startedAt || null,
      endedAt: session.endedAt || null,
      occurredAt: kind === 'LEAVE' ? (session.endedAt || new Date(now).toISOString()) : (session.startedAt || new Date(now).toISOString()),
      emittedAt: new Date(now).toISOString(),
    });

    if (kind === 'ENTER' && session.memberCode) {
      getAvatar(session.memberCode).catch(() => {});
    }
  }

  async function fetchFirstJson(candidates, options = {}) {
    let lastError = null;
    for (const url of candidates) {
      try {
        const result = await requestJsonMethod(url, options);
        return { ...result, usedUrl: url };
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error('NO_UPSTREAM_URL');
  }

  async function getLayout({ force = false } = {}) {
    const fresh = layoutCache && Date.now() - layoutFetchedAt < LAYOUT_CACHE_MS;
    if (!force && fresh) return layoutCache;
    if (layoutInflight) return layoutInflight;

    layoutInflight = (async () => {
      const result = await fetchFirstJson(layoutUrlCandidates, {
        method: 'GET',
        timeoutMs: Math.max(TIMEOUT_MS, 12000),
        maxBytes: LAYOUT_MAX_BYTES,
      });
      const data = unwrapApiData(result.json);
      if (!data || typeof data !== 'object' || !data.map || !Array.isArray(data.machines)) {
        throw new Error('INVALID_LAYOUT_RESPONSE');
      }

      const cloned = JSON.parse(JSON.stringify(data));
      layoutSourceUrl = result.usedUrl;
      const rawImage = text(data?.map?.map_image);
      let layoutAssetBase = result.usedUrl;
      try { layoutAssetBase = `${new URL(result.usedUrl).origin}/`; } catch (_) {}
      layoutRawImageUrl = rawImage && !/^data:/i.test(rawImage)
        ? absoluteUrl(rawImage, layoutAssetBase)
        : rawImage;

      if (cloned.map) {
        cloned.map.map_image = /^data:/i.test(rawImage)
          ? rawImage
          : '/api/user/floorlens/map-image';
      }

      layoutCache = cloned;
      layoutFetchedAt = Date.now();
      mapImageCache = null;
      mapImageFetchedAt = 0;
      return layoutCache;
    })();

    try {
      const value = await layoutInflight;
      scheduleEmitSnapshot();
      return value;
    } finally {
      layoutInflight = null;
    }
  }

  async function getMapImage({ force = false } = {}) {
    const fresh = mapImageCache && Date.now() - mapImageFetchedAt < MAP_IMAGE_CACHE_MS;
    if (!force && fresh) return mapImageCache;
    if (mapImageInflight) return mapImageInflight;

    mapImageInflight = (async () => {
      if (!layoutCache || !layoutRawImageUrl) await getLayout({ force: false });
      const source = layoutRawImageUrl;
      if (!source) throw new Error('MAP_IMAGE_NOT_CONFIGURED');

      if (/^data:image\//i.test(source)) {
        const match = source.match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i);
        if (!match) throw new Error('INVALID_MAP_DATA_URI');
        const buffer = Buffer.from(match[2], 'base64');
        mapImageCache = { buffer, contentType: match[1], sourceUrl: 'data-uri' };
        mapImageFetchedAt = Date.now();
        return mapImageCache;
      }

      const response = await requestBuffer(source, {
        method: 'GET',
        timeoutMs: Math.max(TIMEOUT_MS, 15000),
        maxBytes: MAP_IMAGE_MAX_BYTES,
        headers: { Accept: 'image/*,*/*;q=0.8' },
      });
      const headerType = text(response.headers?.['content-type']).split(';')[0];
      mapImageCache = {
        buffer: response.buffer,
        contentType: headerType.startsWith('image/') ? headerType : detectImageContentType(response.buffer),
        sourceUrl: source,
      };
      mapImageFetchedAt = Date.now();
      return mapImageCache;
    })();

    try {
      return await mapImageInflight;
    } finally {
      mapImageInflight = null;
    }
  }

  function touchAvatarCache(code, value) {
    avatarCache.delete(code);
    avatarCache.set(code, value);
    while (avatarCache.size > AVATAR_CACHE_LIMIT) {
      const oldest = avatarCache.keys().next().value;
      if (oldest == null) break;
      avatarCache.delete(oldest);
    }
  }

  async function fetchAvatarUpstream(code) {
    let lastError = null;
    for (const url of avatarUrlCandidates) {
      try {
        const response = await requestJsonMethod(url, {
          method: 'POST',
          jsonPayload: {
            number: /^\d+$/.test(code) ? Number(code) : code,
            computer: avatarComputer,
          },
          timeoutMs: Math.max(TIMEOUT_MS, 12000),
          maxBytes: AVATAR_MAX_BYTES,
        });
        const base64 = extractAvatarBase64(response.json);
        if (!base64) return null;
        const buffer = Buffer.from(base64, 'base64');
        if (!buffer.length) return null;
        return { buffer, contentType: detectImageContentType(buffer) };
      } catch (error) {
        lastError = error;
      }
    }
    if (lastError) throw lastError;
    return null;
  }

  function pumpAvatarQueue() {
    while (avatarActive < AVATAR_CONCURRENCY && avatarQueue.length) {
      const task = avatarQueue.shift();
      avatarActive += 1;
      Promise.resolve()
        .then(task.work)
        .then(task.resolve, task.reject)
        .finally(() => {
          avatarActive = Math.max(0, avatarActive - 1);
          pumpAvatarQueue();
        });
    }
  }

  function queuedAvatarFetch(code) {
    if (avatarInflight.has(code)) return avatarInflight.get(code);
    const promise = new Promise((resolve, reject) => {
      avatarQueue.push({
        resolve,
        reject,
        work: async () => {
          const result = await fetchAvatarUpstream(code);
          touchAvatarCache(code, {
            at: Date.now(),
            value: result,
            none: !result,
          });
          return result;
        },
      });
      pumpAvatarQueue();
    }).finally(() => avatarInflight.delete(code));
    avatarInflight.set(code, promise);
    return promise;
  }

  async function getAvatar(memberCode) {
    const code = text(memberCode).replace(/\s+/g, '');
    if (!code) return null;
    const cached = avatarCache.get(code);
    if (cached) {
      const ttl = cached.none ? AVATAR_NONE_CACHE_MS : AVATAR_CACHE_MS;
      if (Date.now() - cached.at < ttl) {
        touchAvatarCache(code, cached);
        return cached.value;
      }
      avatarCache.delete(code);
    }
    try {
      return await queuedAvatarFetch(code);
    } catch (error) {
      logger.warn?.(`[FloorLens] avatar ${code} failed:`, safeError(error));
      throw error;
    }
  }

  function preloadActiveAvatars() {
    for (const session of activeByMachine.values()) {
      if (session?.memberCode) getAvatar(session.memberCode).catch(() => {});
    }
  }

  function getMachineHistory(machineNumber, limit = 30) {
    const number = text(machineNumber);
    const max = Math.min(HISTORY_PER_MACHINE, Math.max(1, Number(limit) || 30));
    const baseMachine = emptyMachine(number);
    return (historyByMachine.get(number) || []).slice(0, max).map((row) => {
      const next = { ...row, area: baseMachine.area, floor: baseMachine.floor };
      if (next.memberCode && !text(next.customerName)) {
        try { next.customerName = text(resolveCustomerName?.(next.memberCode)); } catch (_) {}
      }
      if (next.unknownPlayer && !next.customerName) next.customerName = 'Unknown Player';
      return next;
    });
  }

  // Lịch sử các machine mà một member đã chơi trong Gaming Date hiện tại.
  // Dữ liệu lấy trực tiếp từ snapshot/delta đang giữ trong RAM, không tạo request upstream mới.
  function getCustomerMachineHistory(memberCode, limit = 50) {
    const code = text(memberCode).replace(/\s+/g, '');
    if (!code) return [];

    const max = Math.min(200, Math.max(1, Number(limit) || 50));
    const rows = [];

    for (const [machineNumber, list] of historyByMachine.entries()) {
      const baseMachine = emptyMachine(machineNumber);
      for (const row of Array.isArray(list) ? list : []) {
        if (text(row?.memberCode).replace(/\s+/g, '') !== code) continue;
        rows.push({
          ...row,
          machineNumber: text(machineNumber),
          area: baseMachine.area,
          floor: baseMachine.floor,
          customerName: text(row?.customerName) || (() => {
            try { return text(resolveCustomerName?.(code)); } catch (_) { return ''; }
          })(),
        });
      }
    }

    const deduped = new Map();
    for (const row of rows) deduped.set(historyKey(row), row);

    return [...deduped.values()]
      .sort((a, b) => historySortValue(b) - historySortValue(a))
      .slice(0, max);
  }

  function applyRealtimeSnapshot(payload) {
    if (!payload || typeof payload !== 'object') return;

    machineMetaByNumber.clear();
    for (const meta of Array.isArray(payload.machines) ? payload.machines : []) {
      const number = text(meta?.Number ?? meta?.MachineNumber ?? meta?.machineNumber);
      if (number) machineMetaByNumber.set(number, meta);
    }

    setHistoryFromSnapshot(payload.sessions);

    activeByMachine.clear();
    for (const rawSession of Array.isArray(payload.sessions) ? payload.sessions : []) {
      if (!isRealtimeOpenSession(rawSession)) continue;
      const session = normalizeRealtimeSession(rawSession);
      if (!session) continue;

      const existing = activeByMachine.get(session.machineNumber);
      if (!existing) {
        activeByMachine.set(session.machineNumber, session);
        continue;
      }

      // Nếu có dữ liệu duplicate cùng machine, ưu tiên SessionID lớn hơn / record mới hơn.
      const currentId = Number(existing.sessionId);
      const nextId = Number(session.sessionId);
      if (!Number.isFinite(currentId) || !Number.isFinite(nextId) || nextId >= currentId) {
        activeByMachine.set(session.machineNumber, session);
      }
    }

    realtimeConnected = true;
    realtimeReady = true;
    clearFallbackTimer();

    const nowIso = new Date().toISOString();
    snapshot = {
      ...snapshot,
      source: 'floorlens-realtime-v1',
      connected: true,
      realtimeConnected: true,
      realtimeReady: true,
      fallbackActive: false,
      scanning: false,
      rateLimited: false,
      updatedAt: nowIso,
      lastRealtimeAt: nowIso,
      scanStartedAt: null,
      scanCompletedAt: null,
      businessDate: text(payload.gamingDate) || businessDate(),
      gamingDate: text(payload.gamingDate) || businessDate(),
      serverTime: payload.serverTime || null,
      totalSessions: Number(payload.count ?? payload?.counts?.total ?? 0) || 0,
      sourceCounts: payload.counts && typeof payload.counts === 'object' ? { ...payload.counts } : null,
      machines: rebuildRealtimeMachines(),
      error: null,
      realtimeError: null,
      errorSamples: [],
    };

    preloadActiveAvatars();
    emitSnapshotNow();
  }

  function removeEndedSession(rawSession) {
    const ended = normalizeRealtimeSession(rawSession);
    if (!ended) return;

    const current = activeByMachine.get(ended.machineNumber);
    if (!current) return;

    const endedSessionId = text(ended.sessionId);
    const currentSessionId = text(current.sessionId);

    // Không để ended của session cũ xóa nhầm session mới vừa started cùng machine.
    if (endedSessionId && currentSessionId && endedSessionId !== currentSessionId) return;
    activeByMachine.delete(ended.machineNumber);
  }

  function upsertRealtimeSession(rawSession) {
    const session = normalizeRealtimeSession(rawSession);
    if (!session) return;

    if (!isRealtimeOpenSession(rawSession)) {
      removeEndedSession(rawSession);
      return;
    }

    activeByMachine.set(session.machineNumber, session);
  }

  function applyRealtimeDelta(payload) {
    if (!payload || typeof payload !== 'object') return;

    // ended trước, started sau: nếu cùng machine đổi session trong một delta thì session mới luôn thắng.
    for (const row of Array.isArray(payload.ended) ? payload.ended : []) {
      upsertHistory(row);
      emitActivity('LEAVE', row);
      removeEndedSession(row);
    }
    for (const row of Array.isArray(payload.updated) ? payload.updated : []) {
      upsertHistory(row);
      upsertRealtimeSession(row);
    }
    for (const row of Array.isArray(payload.started) ? payload.started : []) {
      upsertHistory(row);
      upsertRealtimeSession(row);
      emitActivity('ENTER', row);
    }

    const nowIso = new Date().toISOString();
    realtimeConnected = true;

    snapshot = {
      ...snapshot,
      source: realtimeReady ? 'floorlens-realtime-v1' : snapshot.source,
      connected: realtimeReady || snapshot.connected,
      realtimeConnected: true,
      realtimeReady,
      fallbackActive: false,
      scanning: false,
      rateLimited: false,
      updatedAt: nowIso,
      lastRealtimeAt: nowIso,
      businessDate: text(payload.gamingDate) || snapshot.businessDate || businessDate(),
      gamingDate: text(payload.gamingDate) || snapshot.gamingDate || businessDate(),
      serverTime: payload.serverTime || snapshot.serverTime || null,
      totalSessions: Number(payload?.counts?.total ?? snapshot.totalSessions ?? 0) || 0,
      sourceCounts: payload.counts && typeof payload.counts === 'object'
        ? { ...payload.counts }
        : snapshot.sourceCounts,
      machines: rebuildRealtimeMachines(),
      error: null,
      realtimeError: null,
      errorSamples: [],
    };

    scheduleEmitSnapshot();
  }

  function markRealtimeProblem(error, eventName = 'connect_error') {
    const detail = safeError(error);
    const nowIso = new Date().toISOString();

    snapshot = {
      ...snapshot,
      realtimeConnected,
      realtimeReady,
      updatedAt: snapshot.updatedAt || nowIso,
      realtimeError: detail,
      error: realtimeReady
        ? null
        : `Realtime FloorLens chưa sẵn sàng (${eventName}: ${detail}). Đang dùng/chuẩn bị fallback Machine API.`,
    };

    scheduleEmitSnapshot();
    if (!realtimeReady) scheduleFallback(REALTIME_FALLBACK_DELAY_MS);
  }

  function connectRealtime() {
    if (!started || upstreamSocket) return;

    let socketIoClient = null;
    try {
      const mod = require('socket.io-client');
      socketIoClient = mod?.io || mod;
    } catch (error) {
      snapshot = {
        ...snapshot,
        realtimeError: 'MODULE_NOT_FOUND: socket.io-client',
        error: 'Thiếu package socket.io-client. FloorLens đang dùng fallback Machine API; cài socket.io-client để bật realtime.',
      };
      logger.warn?.('[FloorLens] socket.io-client is not installed. Using legacy fallback scan.');
      scheduleEmitSnapshot();
      scheduleFallback(0);
      return;
    }

    try {
      upstreamSocket = socketIoClient(realtimeUrl, {
        path: socketPath,
        transports: ['websocket', 'polling'],
        upgrade: true,
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 500,
        reconnectionDelayMax: 5000,
        randomizationFactor: 0.5,
        timeout: 20000,
        forceNew: true,
      });
    } catch (error) {
      upstreamSocket = null;
      markRealtimeProblem(error, 'create_socket');
      return;
    }

    upstreamSocket.on('connect', () => {
      realtimeConnected = true;
      snapshot = {
        ...snapshot,
        realtimeConnected: true,
        realtimeError: null,
        error: realtimeReady ? null : snapshot.error,
      };
      scheduleEmitSnapshot();
    });

    upstreamSocket.on('session:snapshot', (payload) => {
      try {
        applyRealtimeSnapshot(payload);
      } catch (error) {
        logger.error?.('[FloorLens] session:snapshot parse failed:', safeError(error));
        markRealtimeProblem(error, 'session:snapshot');
      }
    });

    upstreamSocket.on('session:delta', (payload) => {
      try {
        applyRealtimeDelta(payload);
      } catch (error) {
        logger.error?.('[FloorLens] session:delta parse failed:', safeError(error));
        markRealtimeProblem(error, 'session:delta');
      }
    });

    upstreamSocket.on('session:rollover', (payload) => {
      try {
        if (payload && Array.isArray(payload.sessions)) {
          applyRealtimeSnapshot(payload);
          return;
        }

        // Nếu rollover chỉ báo ngày mới, reconnect namespace để server gửi snapshot đầy đủ mới.
        activeByMachine.clear();
        historyByMachine.clear();
        realtimeReady = false;
        snapshot = {
          ...snapshot,
          realtimeReady: false,
          source: 'floorlens-realtime-rollover',
          gamingDate: text(payload?.gamingDate) || businessDate(),
          businessDate: text(payload?.gamingDate) || businessDate(),
          machines: rebuildRealtimeMachines(),
          error: 'FloorLens đang chuyển Gaming Date, chờ snapshot mới…',
        };
        emitSnapshotNow();

        if (rolloverReconnectTimer) clearTimeout(rolloverReconnectTimer);
        rolloverReconnectTimer = setTimeout(() => {
          rolloverReconnectTimer = null;
          try {
            upstreamSocket?.disconnect();
            upstreamSocket?.connect();
          } catch (_) {}
        }, 500);
        rolloverReconnectTimer.unref?.();
      } catch (error) {
        markRealtimeProblem(error, 'session:rollover');
      }
    });

    upstreamSocket.on('session:error', (payload) => {
      const message = text(payload?.message || payload?.error || payload) || 'SESSION_ERROR';
      markRealtimeProblem(new Error(message), 'session:error');
    });

    upstreamSocket.on('connect_error', (error) => {
      realtimeConnected = false;
      if (!realtimeReady) markRealtimeProblem(error, 'connect_error');
    });

    upstreamSocket.on('disconnect', (reason) => {
      realtimeConnected = false;
      realtimeReady = false;
      snapshot = {
        ...snapshot,
        realtimeConnected: false,
        realtimeReady: false,
        connected: false,
        fallbackActive: false,
        // Đánh dấu stale ngay khi socket rớt, không chờ tới lượt fallback scan đầu tiên.
        machines: (snapshot.machines || []).map((machine) => ({
          ...machine,
          online: false,
          checkState: 'stale',
        })),
        realtimeError: text(reason) || 'DISCONNECTED',
        error: `Realtime FloorLens disconnected (${text(reason) || 'unknown'}). Đang chuyển sang fallback Machine API…`,
      };
      emitSnapshotNow();
      scheduleFallback(REALTIME_FALLBACK_DELAY_MS);
    });
  }

  async function syncLegacyFallback() {
    if (realtimeReady) return publicSnapshot();
    if (inFlight) return publicSnapshot();
    inFlight = true;

    const date = businessDate();
    const fallbackNumbers = [...new Set([
      ...configuredNumbers,
      ...(Array.isArray(snapshot.machines) ? snapshot.machines.map((m) => text(m?.machineNumber)).filter(Boolean) : []),
    ])];

    const working = new Map();
    const previousPlaying = new Set();
    for (const number of fallbackNumbers) {
      const previous = (snapshot.machines || []).find((m) => text(m?.machineNumber) === number);
      if (previous?.isPlaying) previousPlaying.add(number);

      // Realtime vừa mất: dữ liệu cũ chỉ là stale cho tới khi Machine API xác minh lại.
      // Giữ thông tin hiển thị cũ nhưng không cho frontend hiểu nhầm là verified/online.
      working.set(
        number,
        previous
          ? { ...previous, online: false, checkState: 'stale' }
          : emptyMachine(number, { online: false, checkState: 'pending' })
      );
    }

    let checkedThisScan = 0;
    let failedThisScan = 0;
    let rateLimited = false;
    let saw429ThisScan = false;
    let lastEmitAt = 0;
    const errorSamples = [];

    snapshot = {
      ...snapshot,
      source: 'neon-machine-scan-fallback-v5',
      connected: false,
      fallbackActive: true,
      scanning: true,
      rateLimited: false,
      scanStartedAt: new Date().toISOString(),
      scanCompletedAt: null,
      businessDate: date,
      gamingDate: snapshot.gamingDate || date,
      error: snapshot.realtimeError
        ? `Realtime chưa kết nối (${snapshot.realtimeError}). Đang quét fallback Machine API…`
        : null,
      errorSamples: [],
      machines: fallbackNumbers.map((n) => working.get(n)),
    };
    emitSnapshotNow();

    try {
      const scanOrder = [...fallbackNumbers].sort((a, b) => {
        const pa = previousPlaying.has(a) ? 1 : 0;
        const pb = previousPlaying.has(b) ? 1 : 0;
        return pb - pa;
      });

      for (let index = 0; index < scanOrder.length; index += 1) {
        // Realtime snapshot đã về thì dừng scan ngay, không ghi đè dữ liệu mới.
        if (realtimeReady) break;

        const number = scanOrder[index];

        try {
          const machine = await fetchMachineWith429Retry(legacyEndpoint, number, date, logger, {
            onRateLimited: () => {
              saw429ThisScan = true;
              adaptiveGapMs = Math.min(
                MAX_REQUEST_GAP_MS,
                Math.max(adaptiveGapMs + 200, adaptiveGapMs * 2)
              );
            },
          });
          checkedThisScan += 1;
          working.set(number, machine);
        } catch (error) {
          failedThisScan += 1;
          const detail = safeError(error);
          if (errorSamples.length < 3 && !errorSamples.includes(detail)) errorSamples.push(detail);

          const previous = working.get(number) || emptyMachine(number);
          working.set(number, {
            ...previous,
            online: false,
            checkState: 'unknown',
          });

          if (Number(error?.statusCode) === 429 || detail.includes('HTTP_429')) {
            rateLimited = true;
            break;
          }
        }

        if (realtimeReady) break;

        snapshot = {
          ...snapshot,
          source: 'neon-machine-scan-fallback-v5',
          connected: checkedThisScan > 0,
          fallbackActive: true,
          rateLimited,
          updatedAt: new Date().toISOString(),
          machines: fallbackNumbers.map((n) => working.get(n)),
          errorSamples: [...errorSamples],
          error: rateLimited
            ? 'Fallback Machine API đang giới hạn request (HTTP 429). FloorLens tự giảm tốc độ quét.'
            : failedThisScan
              ? `${failedThisScan} machine chưa kiểm tra được: ${errorSamples[0] || 'UNKNOWN_ERROR'}`
              : snapshot.realtimeError
                ? `Realtime chưa kết nối (${snapshot.realtimeError}). Đang dùng fallback Machine API.`
                : null,
        };

        const nowMs = Date.now();
        if (
          index === scanOrder.length - 1 ||
          checkedThisScan % EMIT_EVERY === 0 ||
          nowMs - lastEmitAt >= 1500
        ) {
          lastEmitAt = nowMs;
          emitSnapshotNow();
        }

        if (index < scanOrder.length - 1 && !realtimeReady) await sleep(adaptiveGapMs);
      }
    } catch (error) {
      const detail = safeError(error);
      if (!errorSamples.includes(detail)) errorSamples.push(detail);
      logger.error?.('[FloorLens] fallback scan failed:', detail);
    } finally {
      // Nếu realtime đã hồi lại trong lúc quét thì tuyệt đối không ghi đè snapshot realtime.
      if (realtimeReady) {
        inFlight = false;
        return publicSnapshot();
      }

      const machines = fallbackNumbers.map((n) => working.get(n));
      const verifiedCount = machines.filter((m) => m?.checkState === 'ok' && m?.online !== false).length;

      if (!saw429ThisScan && failedThisScan === 0) {
        adaptiveGapMs = Math.max(BASE_REQUEST_GAP_MS, adaptiveGapMs - 50);
      }

      snapshot = {
        ...snapshot,
        source: 'neon-machine-scan-fallback-v5',
        scanning: false,
        connected: verifiedCount > 0,
        fallbackActive: true,
        rateLimited,
        updatedAt: new Date().toISOString(),
        scanCompletedAt: new Date().toISOString(),
        machines,
        errorSamples,
        error: rateLimited
          ? 'Fallback Machine API đang giới hạn request (HTTP 429). FloorLens đã giảm tốc độ và sẽ tự thử lại.'
          : errorSamples.length
            ? `${failedThisScan} machine chưa kiểm tra được: ${errorSamples[0]}`
            : snapshot.realtimeError
              ? `Realtime chưa kết nối (${snapshot.realtimeError}). Hiện đang dùng fallback Machine API.`
              : null,
      };
      inFlight = false;
      emitSnapshotNow();
    }

    return publicSnapshot();
  }

  async function sync() {
    // Route admin cũ vẫn giữ nguyên. Khi realtime đang tốt thì trả snapshot ngay,
    // không tạo thêm 178 request không cần thiết.
    if (realtimeReady) return publicSnapshot();

    try {
      if (upstreamSocket && !upstreamSocket.connected) upstreamSocket.connect();
    } catch (_) {}

    return syncLegacyFallback();
  }

  function start() {
    if (started) return;
    started = true;

    connectRealtime();

    // Cho realtime một khoảng grace để nhận snapshot lớn trước khi bật fallback.
    if (connectGraceTimer) clearTimeout(connectGraceTimer);
    connectGraceTimer = setTimeout(() => {
      connectGraceTimer = null;
      if (!realtimeReady) scheduleFallback(0);
    }, REALTIME_CONNECT_GRACE_MS);
    connectGraceTimer.unref?.();
  }

  function stop() {
    started = false;
    realtimeReady = false;
    realtimeConnected = false;

    clearFallbackTimer();
    if (connectGraceTimer) clearTimeout(connectGraceTimer);
    connectGraceTimer = null;
    if (rolloverReconnectTimer) clearTimeout(rolloverReconnectTimer);
    rolloverReconnectTimer = null;
    if (emitTimer) clearTimeout(emitTimer);
    emitTimer = null;

    try { upstreamSocket?.removeAllListeners?.(); } catch (_) {}
    try { upstreamSocket?.disconnect?.(); } catch (_) {}
    upstreamSocket = null;
  }

  return {
    getSnapshot: publicSnapshot,
    getLayout,
    getMapImage,
    getAvatar,
    getMachineHistory,
    getCustomerMachineHistory,
    emitCurrentSnapshot: emitSnapshotNow,
    sync,
    start,
    stop,
  };
}

module.exports = {
  createFloorlensService,
  businessDate,
  newestOpenSession,
  requestJson,
  requestBuffer,
  isRealtimeOpenSession,
  normalizeRealtimeSession,
};
