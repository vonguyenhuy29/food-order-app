// SAFE_CLEANUP_PHASE3B_20260913
// SAFE_CLEANUP_PHASE2D_20260913
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import './FloorLens.css';

const STATUS = {
  ALL: 'ALL',
  PLAYING: 'PLAYING',
  AVAILABLE: 'AVAILABLE',
  ORDERED: 'ORDERED',
  NOT_ORDERED: 'NOT_ORDERED',
  UNKNOWN: 'UNKNOWN',
};

const AREA_ORDER = [
  'Roulette 1',
  'Roulette 2',
  'Roulette 3',
  'Reception 1',
  'Reception 2',
  'Center',
  'Multi',
  'Table',
  '2 Floor',
  'Other',
];

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const MIN_MAP_SCALE = 0.15;
const MAX_MAP_SCALE = 4;
const text = (value) => String(value == null ? '' : value).trim();

const isVerifiedPlaying = (machine) =>
  Boolean(machine?.checkState === 'ok' && machine?.online !== false && machine?.isPlaying);

const isMachineUnknown = (machine) =>
  machine?.checkState === 'unknown' ||
  machine?.checkState === 'pending' ||
  machine?.checkState === 'stale' ||
  machine?.online === false;

const isUnknownPlayer = (machine) =>
  Boolean(isVerifiedPlaying(machine) && (machine?.unknownPlayer || !text(machine?.memberCode)));

const orderToneOf = (machine) => {
  // FloorLens Test chỉ dùng đúng 3 màu trên map:
  // xanh = đang có khách + đã order, đỏ = đang có khách + chưa order/Unknown,
  // xám = không có khách hoặc trạng thái machine chưa xác định.
  if (isMachineUnknown(machine) || !isVerifiedPlaying(machine)) return 'idle';
  if (machine?.orderStatus === 'ORDERED' || machine?.hasOrdered === true) return 'ordered';
  return 'not-ordered';
};

const statusLabelOf = (machine) => {
  if (isMachineUnknown(machine)) return 'Chưa xác định';
  if (!isVerifiedPlaying(machine)) return 'Máy trống';
  if (isUnknownPlayer(machine)) return 'Unknown player';
  if (machine?.orderStatus === 'ORDERED' || machine?.hasOrdered === true) return 'Đã order';
  return 'Chưa order';
};

const machineStatusColorOf = (machine) => {
  const tone = orderToneOf(machine);
  if (tone === 'ordered') return '#16a34a';
  if (tone === 'not-ordered') return '#dc2626';
  return '#94a3b8';
};

const layoutMachineNumber = (machine) =>
  text(machine?.machine_number ?? machine?.machineNumber ?? machine?.Number ?? machine?.number);



const ORDER_STATIONS = [
  { code: 'TECH', label: 'Tech', x: 0.090, y: 0.108 },
  { code: 'PIT14', label: 'PIT 14', x: 0.292, y: 0.228 },
  { code: 'PIT15', label: 'PIT 15', x: 0.532, y: 0.274 },
  { code: 'PIT33', label: 'PIT 33', x: 0.548, y: 0.758 },
  { code: 'PIT2F', label: 'PIT 2F', x: 0.910, y: 0.675 },
  { code: 'RECEPTION1', label: 'Reception 1', x: 0.157, y: 0.842 },
  { code: 'RECEPTION2', label: 'Reception 2', x: 0.344, y: 0.846 },
  { code: 'BC1', label: 'BC1', x: 0.454, y: 0.141 },
  { code: 'BC2', label: 'BC2', x: 0.458, y: 0.575 },
  { code: 'CENTER3022', label: 'Center', x: 0.706, y: 0.104 },
];

const FLOOR_STATIONS = [
  ...ORDER_STATIONS,
  { code: 'KITCHEN', label: 'Kitchen', x: 0.102, y: 0.772, targetOnly: true },
];

const REFERENCE_LABELS = [
  ['TECH', 0.040, 0.075],
  ['RL 1', 0.125, 0.215],
  ['PIT 14', 0.240, 0.225],
  ['RL 2', 0.345, 0.235],
  ['BC 1', 0.462, 0.185],
  ['PIT 15', 0.526, 0.270],
  ['MINI BAR', 0.535, 0.320],
  ['MULTI', 0.525, 0.382],
  ['BC 2', 0.472, 0.612],
  ['KITCHEN', 0.055, 0.815],
  ['Reception 1', 0.160, 0.845],
  ['Reception 2', 0.360, 0.845],
  ['PIT 33', 0.535, 0.755],
  ['RL 3', 0.835, 0.170],
  ['PIT 2F', 0.910, 0.132],
];

const ORDER_STATION_STORAGE_KEY = 'food.floorlensOrderStation';

const normalizeOrderStation = (value) => {
  const code = text(value).toUpperCase();
  return ORDER_STATIONS.some((station) => station.code === code) ? code : '';
};

function layoutTransform(transform = {}) {
  const rotation = Number(transform.rotation || 0);
  const scaleX = (Number(transform.scaleX ?? 1) || 1) * (transform.flipX ? -1 : 1);
  const scaleY = (Number(transform.scaleY ?? 1) || 1) * (transform.flipY ? -1 : 1);
  if (rotation === 0 && scaleX === 1 && scaleY === 1) return undefined;
  return `rotate(${rotation}deg) scale(${scaleX}, ${scaleY})`;
}

function avatarPositionStyle(position = 'top', offset = 0) {
  const n = Number(offset || 0);
  switch (position) {
    case 'right':
      return { left: '100%', top: '50%', transform: 'translate(0,-50%)', marginLeft: n };
    case 'left':
      return { right: '100%', top: '50%', transform: 'translate(0,-50%)', marginRight: n };
    case 'bottom':
      return { top: '100%', left: '50%', transform: 'translate(-50%,0)', marginTop: n };
    case 'top':
    default:
      return { bottom: '100%', left: '50%', transform: 'translate(-50%,0)', marginBottom: n };
  }
}

function avatarScreenPosition(position = 'top', transform = {}) {
  const vectors = {
    top: [0, -1],
    right: [1, 0],
    bottom: [0, 1],
    left: [-1, 0],
  };

  let [x, y] = vectors[position] || vectors.top;
  const sourceScaleX = Number(transform.scaleX ?? 1) || 1;
  const sourceScaleY = Number(transform.scaleY ?? 1) || 1;
  if (transform.flipX || sourceScaleX < 0) x *= -1;
  if (transform.flipY || sourceScaleY < 0) y *= -1;

  const radians = (Number(transform.rotation || 0) * Math.PI) / 180;
  const rotatedX = x * Math.cos(radians) - y * Math.sin(radians);
  const rotatedY = x * Math.sin(radians) + y * Math.cos(radians);

  if (Math.abs(rotatedX) > Math.abs(rotatedY)) return rotatedX >= 0 ? 'right' : 'left';
  return rotatedY >= 0 ? 'bottom' : 'top';
}

function formatDateTime(value) {
  if (!value) return '—';
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return text(value) || '—';
  return parsed.toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function floorlensWallClockParts(value) {
  const raw = text(value);
  if (!raw) return null;

  // FloorLens upstream đang gửi giờ local casino nhưng có hậu tố Z.
  // Không dùng new Date() cho session time vì browser sẽ cộng thêm timezone (+7 ở VN).
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return null;
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: Number(match[6] || 0),
  };
}

function floorlensWallClockSortValue(value) {
  const parts = floorlensWallClockParts(value);
  if (!parts) return 0;
  return Date.UTC(
    parts.year,
    Math.max(0, parts.month - 1),
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );
}

function formatFloorlensDateTime(value) {
  const parts = floorlensWallClockParts(value);
  if (!parts) return text(value) || '—';
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)} ${pad(parts.day)}/${pad(parts.month)}/${parts.year}`;
}

function formatFloorlensShortTime(value) {
  const parts = floorlensWallClockParts(value);
  if (!parts) return text(value) || '—';
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(parts.hour)}:${pad(parts.minute)}`;
}

function formatMoneyVnd(value) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount)) return '0 VND';
  return `${Math.round(amount).toLocaleString('vi-VN')} VND`;
}

function orderTotal(order = {}) {
  if (Number.isFinite(Number(order?.total))) return Number(order.total);
  return (Array.isArray(order?.items) ? order.items : []).reduce((sum, item) => {
    const explicit = Number(item?.lineTotal ?? item?.total ?? item?.amount);
    if (Number.isFinite(explicit)) return sum + explicit;
    const qty = Number(item?.qty ?? item?.quantity ?? 0) || 0;
    return sum + (Number(item?.price ?? item?.unitPrice ?? 0) || 0) * qty;
  }, 0);
}

function foodImageKey(value) {
  const raw = text(value).split(/[?#]/)[0];
  return (raw.split('/').pop() || '').toLowerCase();
}

function buildCartRows(cart = {}, foods = []) {
  const foodByImage = new Map();
  for (const food of Array.isArray(foods) ? foods : []) {
    const key = foodImageKey(food?.imageUrl || food?.imageName);
    if (key && !foodByImage.has(key)) foodByImage.set(key, food);
  }

  return Object.entries(cart && typeof cart === 'object' ? cart : {})
    .map(([cartKey, item]) => {
      const qty = Number(item?.qty || 0) || 0;
      if (qty <= 0) return null;
      const offMenu = Boolean(item?.isOffMenu) || String(cartKey).startsWith('__offmenu__');
      const food = offMenu ? null : foodByImage.get(String(cartKey || '').toLowerCase());
      const price = Number(item?.price ?? food?.price ?? 0) || 0;
      const name = offMenu
        ? (text(item?.name) || 'Món ngoài menu')
        : (text(food?.productName || food?.name) || cartKey);
      const code = offMenu ? 'H100' : text(food?.productCode || food?.code);
      return {
        cartKey,
        qty,
        note: text(item?.note),
        offMenu,
        name,
        rawName: text(item?.name),
        code,
        price,
        lineTotal: price * qty,
        imageUrl: food?.imageUrl || '',
      };
    })
    .filter(Boolean);
}

// Một số cụm trong sơ đồ thật đi theo vòng cung.
// Chỉ xoay THÂN máy ở các vị trí này; số máy và avatar luôn giữ thẳng để dễ đọc.
const CURVED_MACHINE_ROTATION = new Map([
  // RL 1
  ['106', -34], ['105', -12], ['112', 38], ['113', 12],
  // BC 1
  ['15', -28], ['14', -38], ['12', 38], ['11', 28],
  // BC 2
  ['21', -34], ['22', -22], ['24', 22], ['25', 34],
  // RL 3
  ['306', -34], ['307', -18], ['309', 18], ['310', 34],
  // Center/PIT 33 curve
  ['3025', 26], ['3026', 39], ['3027', 52],
  // 2F lower curve
  ['8009', -28], ['8008', 28],
]);

function machineBodyRotation(machineNumber) {
  return CURVED_MACHINE_ROTATION.get(text(machineNumber)) || 0;
}

function machineVisualScale(machineNumber) {
  const n = Number(machineNumber);
  if (!Number.isFinite(n)) return 0.76;
  // Các dãy Reception/Center dày đặc: thu nhỏ hơn một chút để có khe hở rõ.
  if ((n >= 1001 && n <= 1030) || (n >= 3001 && n <= 3027)) return 0.72;
  // Các dãy Roulette/Table/Multi vẫn đủ lớn để đọc nhưng không dính nhau.
  if ((n >= 101 && n <= 317) || (n >= 11 && n <= 25) || (n >= 501 && n <= 510)) return 0.76;
  return 0.75;
}

function uprightMachineGeometry(transform = {}, machineNumber = '') {
  const rawWidth = Math.max(8, Number(transform.width || 48));
  const rawHeight = Math.max(8, Number(transform.height || 48));

  // Giữ đúng TÂM/toạ độ của layout nguồn; chỉ thu marker để tạo khoảng cách.
  // Body có thể xoay riêng ở các đoạn cong, còn label/avatar vẫn luôn dựng thẳng.
  const uprightWidth = Math.min(rawWidth, rawHeight);
  const uprightHeight = Math.max(rawWidth, rawHeight);
  const visualScale = machineVisualScale(machineNumber);
  const width = Math.max(8, uprightWidth * visualScale);
  const height = Math.max(8, uprightHeight * visualScale);
  const centerX = Number(transform.positionX || 0) + rawWidth / 2;
  const centerY = Number(transform.positionY || 0) + rawHeight / 2;
  return {
    left: centerX - width / 2,
    top: centerY - height / 2,
    width,
    height,
    bodyRotation: machineBodyRotation(machineNumber),
  };
}

function CustomerAvatar({ apiUrl, code, name, unknown = false, size = 36, className = '' }) {
  const [failed, setFailed] = useState(false);
  const cleanCode = text(code).replace(/\s+/g, '');

  useEffect(() => setFailed(false), [cleanCode]);

  if (unknown || !cleanCode) {
    return (
      <span
        className={`fl-customer-avatar fl-customer-avatar-fallback ${className}`}
        style={{ width: size, height: size, fontSize: Math.max(12, size * 0.42) }}
        title="Unknown player"
      >
        ?
      </span>
    );
  }

  if (failed) {
    const first = text(name || cleanCode).charAt(0).toUpperCase() || '?';
    return (
      <span
        className={`fl-customer-avatar fl-customer-avatar-fallback ${className}`}
        style={{ width: size, height: size, fontSize: Math.max(11, size * 0.36) }}
        title={name || cleanCode}
      >
        {first}
      </span>
    );
  }

  return (
    <img
      className={`fl-customer-avatar ${className}`}
      src={apiUrl(`/api/user/floorlens/avatar/${encodeURIComponent(cleanCode)}`)}
      alt={name || `Member ${cleanCode}`}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      style={{ width: size, height: size }}
    />
  );
}

function StatCard({ value, label, sub, tone, active, onClick }) {
  return (
    <button
      type="button"
      className={`fl-stat-card tone-${tone || 'neutral'} ${active ? 'is-active' : ''}`}
      onClick={onClick}
    >
      <strong>{Number(value || 0).toLocaleString('vi-VN')}</strong>
      <span>{label}</span>
      {sub && <small>{sub}</small>}
    </button>
  );
}


function HeaderActivityCard({ kind, alerts = [], apiUrl, onOpen, onDismiss }) {
  const entering = kind === 'ENTER';

  return (
    <div className={`fl-header-activity-card ${entering ? 'is-enter' : 'is-leave'}`}>
      <div className="fl-header-activity-label">
        <span>{entering ? 'VÀO' : 'RA'}</span>
        {alerts.length > 0 && <b>{alerts.length}</b>}
      </div>

      <div className="fl-header-activity-list" aria-label={entering ? 'Khách vào máy' : 'Khách rời máy'}>
        {alerts.length > 0 ? alerts.map((alert) => {
          const unknown = alert?.unknownPlayer || !text(alert?.memberCode);
          const displayName = alert.customerName || (unknown ? 'Unknown Player' : `Member ${alert.memberCode}`);
          const level = text(alert.customerLevel || alert.level || alert.membershipType);
          const eventTime = formatFloorlensShortTime(alert.occurredAt || alert.emittedAt);
          const titleParts = [
            entering ? 'Khách vào' : 'Khách rời',
            `Máy ${alert.machineNumber}`,
            displayName,
            !unknown && alert.memberCode ? `#${alert.memberCode}` : '',
            level ? `Level ${level}` : '',
            eventTime && eventTime !== '—' ? eventTime : '',
          ].filter(Boolean);

          return (
            <div className="fl-header-activity-row" key={alert.id}>
              <button
                type="button"
                className="fl-header-activity-event"
                onClick={() => onOpen?.(alert)}
                title={`${titleParts.join(' • ')} • Bấm để tới máy`}
              >
                <span className="fl-activity-avatar-wrap">
                  <CustomerAvatar
                    apiUrl={apiUrl}
                    code={alert.memberCode}
                    name={displayName}
                    unknown={unknown}
                    size={34}
                    className={`fl-activity-avatar ${entering ? 'is-enter' : 'is-leave'}`}
                  />
                  {level && !unknown && <span className="fl-activity-level-badge">{level}</span>}
                </span>
                <b>Máy {alert.machineNumber}</b>
              </button>
              <button
                type="button"
                className="fl-header-activity-close"
                onClick={() => onDismiss?.(alert.id)}
                aria-label="Xóa thông báo"
                title="Xóa"
              >
                ×
              </button>
            </div>
          );
        }) : (
          <div className="fl-header-activity-empty">Chưa có sự kiện</div>
        )}
      </div>
    </div>
  );
}

function FallbackMachineGrid({ machines, onOpen, apiUrl, selectedTable }) {
  return (
    <div className="fl-fallback-grid">
      {machines.map((machine) => {
        const tone = orderToneOf(machine);
        const playing = isVerifiedPlaying(machine);
        const isSelectedTable = selectedTable &&
          String(selectedTable.area) === String(machine.area) &&
          String(selectedTable.tableNo) === String(machine.machineNumber);
        return (
          <button
            type="button"
            key={machine.machineNumber}
            className={`fl-fallback-machine tone-${tone} ${isSelectedTable ? 'is-table-selected' : ''}`}
            onClick={() => onOpen(machine.machineNumber)}
          >
            {playing && (
              <CustomerAvatar
                apiUrl={apiUrl}
                code={machine.memberCode}
                name={machine.customerName}
                unknown={isUnknownPlayer(machine)}
                size={32}
              />
            )}
            <b>{machine.machineNumber}</b>
            <span>{machine.area}</span>
            <small>{statusLabelOf(machine)}</small>
          </button>
        );
      })}
    </div>
  );
}

export default function FloorLens({
  apiUrl,
  socket,
  selectedTable = null,
  onSelectTable = null,
  onOpenCustomer = null,
  carts = {},
  foods = [],
  onCartSetQty = null,
  onCartUpdateItem = null,
  onCartClear = null,
  onAddOffMenu = null,
  onCheckout = null,
  initialMachineNumber = '',
  initialDetailTab = 'machine',
  focusRequestId = 0,
  onInitialTargetConsumed = null,
}) {
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [layout, setLayout] = useState(null);
  const [layoutLoading, setLayoutLoading] = useState(true);
  const [layoutError, setLayoutError] = useState('');

  const [query, setQuery] = useState('');
  const [floor, setFloor] = useState('ALL');
  const [status, setStatus] = useState(STATUS.ALL);
  const [selectedAreas, setSelectedAreas] = useState([]);
  const [areaMenuOpen, setAreaMenuOpen] = useState(false);

  const [selectedNumber, setSelectedNumber] = useState(null);
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [alerts, setAlerts] = useState([]);
  const [locatingNumber, setLocatingNumber] = useState('');
  const [locatingKind, setLocatingKind] = useState('FOCUS');
  const [activityHighlights, setActivityHighlights] = useState({});
  const [activeDetailTab, setActiveDetailTab] = useState('machine');
  const [searchFocused, setSearchFocused] = useState(false);
  const [orderStation, setOrderStation] = useState(() => {
    try {
      const fromUrl = normalizeOrderStation(new URLSearchParams(window.location.search).get('station'));
      if (fromUrl) {
        localStorage.setItem(ORDER_STATION_STORAGE_KEY, fromUrl);
        return fromUrl;
      }
      return normalizeOrderStation(localStorage.getItem(ORDER_STATION_STORAGE_KEY));
    } catch (_) {
      return '';
    }
  });
  const [stationHighlights, setStationHighlights] = useState({});

  const [machineOrders, setMachineOrders] = useState([]);
  const [machineOrdersLoading, setMachineOrdersLoading] = useState(false);
  const [machineOrdersError, setMachineOrdersError] = useState('');
  const [expandedOrderIds, setExpandedOrderIds] = useState(() => new Set());

  const [customerProfileCode, setCustomerProfileCode] = useState('');
  const [customerProfile, setCustomerProfile] = useState(null);
  const [customerProfileLoading, setCustomerProfileLoading] = useState(false);
  const [customerProfileError, setCustomerProfileError] = useState('');
  const [customerSpending, setCustomerSpending] = useState(null);
  const [customerSpendingAll, setCustomerSpendingAll] = useState(null);
  const [customerMachineHistory, setCustomerMachineHistory] = useState([]);

  const [scale, setScale] = useState(1);
  const [fitScale, setFitScale] = useState(1);
  const [isPanning, setIsPanning] = useState(false);

  const mapViewportRef = useRef(null);
  const scaleRef = useRef(1);
  const fitScaleRef = useRef(1);
  const pointerMapRef = useRef(new Map());
  const pinchRef = useRef(null);
  const panRef = useRef({
    active: false,
    pointerId: null,
    startX: 0,
    startY: 0,
    startLeft: 0,
    startTop: 0,
    moved: false,
  });
  const suppressMachineClickRef = useRef(false);
  const initialFitDoneRef = useRef(false);
  const orderRefreshTimerRef = useRef(null);
  const locateTimerRef = useRef(null);
  const consumedInitialTargetRef = useRef('');
  const pendingInitialLocateRef = useRef(null);
  const activityLevelCacheRef = useRef(new Map());
  // Chặn response hồ sơ của machine cũ ghi đè machine vừa chọn.
  const customerProfileRequestRef = useRef(0);
  const activityHighlightTimersRef = useRef(new Map());
  const stationHighlightTimersRef = useRef(new Map());

  useEffect(() => {
    scaleRef.current = scale;
  }, [scale]);

  useEffect(() => {
    fitScaleRef.current = fitScale;
  }, [fitScale]);


  useEffect(() => {
    try {
      if (orderStation) localStorage.setItem(ORDER_STATION_STORAGE_KEY, orderStation);
      else localStorage.removeItem(ORDER_STATION_STORAGE_KEY);
    } catch (_) {}
  }, [orderStation]);

  const load = useCallback(async () => {
    try {
      setError('');
      const response = await axios.get(apiUrl('/api/user/floorlens'), {
        timeout: 12000,
        headers: { 'Cache-Control': 'no-cache' },
      });
      setSnapshot(response.data || null);
    } catch (requestError) {
      setError(requestError?.response?.data?.error || requestError?.message || 'Không tải được FloorLens');
    } finally {
      setLoading(false);
    }
  }, [apiUrl]);

  const loadLayout = useCallback(async ({ force = false } = {}) => {
    try {
      setLayoutError('');
      setLayoutLoading(true);
      const response = await axios.get(apiUrl('/api/user/floorlens/layout'), {
        params: force ? { refresh: true } : undefined,
        timeout: 15000,
      });
      setLayout(response.data || null);
      initialFitDoneRef.current = false;
    } catch (requestError) {
      setLayoutError(
        requestError?.response?.data?.error ||
        requestError?.message ||
        'Không tải được sơ đồ FloorLens'
      );
    } finally {
      setLayoutLoading(false);
    }
  }, [apiUrl]);

  useEffect(() => {
    load();
    loadLayout();
  }, [load, loadLayout]);

  useEffect(() => {
    if (!socket) return undefined;

    const onUpdated = (nextSnapshot) => {
      setSnapshot(nextSnapshot);
      setError('');
      setLoading(false);
    };

    const onActivity = (activity = {}) => {
      const id = text(activity.id) || `${activity.kind || 'EVENT'}-${activity.machineNumber}-${Date.now()}`;
      const memberCode = text(activity.memberCode).replace(/\s+/g, '');
      const cachedIdentity = memberCode ? activityLevelCacheRef.current.get(memberCode) : null;
      const nextAlert = {
        ...activity,
        id,
        receivedAt: Date.now(),
        customerName: text(activity.customerName) || cachedIdentity?.name || '',
        customerLevel: text(activity.customerLevel || activity.level || cachedIdentity?.level),
      };

      // Không tự mất sau 5 giây nữa. Mỗi lane VÀO/RA giữ lịch sử riêng,
      // newest ở đầu. Giới hạn 30 event cho mỗi lane để một loại event
      // không đẩy mất lịch sử của loại còn lại.
      setAlerts((prev) => {
        const kind = nextAlert.kind === 'LEAVE' ? 'LEAVE' : 'ENTER';
        const sameKind = [
          nextAlert,
          ...prev.filter((item) => item.id !== id && (item.kind === 'LEAVE' ? 'LEAVE' : 'ENTER') === kind),
        ].slice(0, 30);
        const otherKind = prev
          .filter((item) => (item.kind === 'LEAVE' ? 'LEAVE' : 'ENTER') !== kind)
          .slice(0, 30);
        return [...sameKind, ...otherKind];
      });

      // Level không có trong payload gaming-session. Lấy từ Customer Profile local của Food,
      // cache theo member để mỗi khách chỉ cần query một lần trong phiên browser.
      if (memberCode && !nextAlert.customerLevel && !cachedIdentity?.level) {
        axios.get(apiUrl(`/api/user/customer-profile/${encodeURIComponent(memberCode)}`), {
          params: { t: Date.now() },
          headers: { 'Cache-Control': 'no-cache' },
          timeout: 7000,
        }).then((response) => {
          const member = response?.data?.member || {};
          const identity = {
            name: text(member.name) || nextAlert.customerName || '',
            level: text(member.level || member.membershipType),
          };
          activityLevelCacheRef.current.set(memberCode, identity);
          setAlerts((prev) => prev.map((item) =>
            item.id === id
              ? {
                  ...item,
                  customerName: identity.name || item.customerName,
                  customerLevel: identity.level || item.customerLevel || '',
                }
              : item
          ));
        }).catch(() => {});
      } else if (memberCode && cachedIdentity) {
        setAlerts((prev) => prev.map((item) =>
          item.id === id
            ? {
                ...item,
                customerName: item.customerName || cachedIdentity.name || '',
                customerLevel: item.customerLevel || cachedIdentity.level || '',
              }
            : item
        ));
      }

      const machineNumber = text(activity.machineNumber);
      if (machineNumber) {
        setActivityHighlights((prev) => ({
          ...prev,
          [machineNumber]: {
            kind: activity.kind === 'LEAVE' ? 'LEAVE' : 'ENTER',
            id,
            at: Date.now(),
          },
        }));

        const oldHighlightTimer = activityHighlightTimersRef.current.get(machineNumber);
        if (oldHighlightTimer) clearTimeout(oldHighlightTimer);
        const highlightTimer = setTimeout(() => {
          activityHighlightTimersRef.current.delete(machineNumber);
          setActivityHighlights((prev) => {
            const next = { ...prev };
            delete next[machineNumber];
            return next;
          });
        }, 5000);
        activityHighlightTimersRef.current.set(machineNumber, highlightTimer);
      }
    };

    
const onOrderStationActivity = (payload = {}) => {
  const source = normalizeOrderStation(payload.sourceStation);
  const target = text(payload.targetStation || 'KITCHEN').toUpperCase() || 'KITCHEN';
  const orderId = text(payload.orderId || payload?.order?.id);
  const now = Date.now();
  const nextEntries = [
    source ? { code: source, role: 'source' } : null,
    target ? { code: target, role: 'target' } : null,
  ].filter(Boolean);
  if (!nextEntries.length) return;

  setStationHighlights((prev) => {
    const next = { ...prev };
    for (const entry of nextEntries) {
      next[entry.code] = {
        code: entry.code,
        role: entry.role,
        at: now,
        orderId,
        machineNumber: text(payload.machineNumber || payload?.order?.tableNo),
        area: text(payload.area || payload?.order?.area),
        sourceStation: source,
        targetStation: target,
      };
    }
    return next;
  });

  for (const entry of nextEntries) {
    const code = entry.code;
    const old = stationHighlightTimersRef.current.get(code);
    if (old) clearTimeout(old);
    const timer = setTimeout(() => {
      stationHighlightTimersRef.current.delete(code);
      setStationHighlights((prev) => {
        const next = { ...prev };
        delete next[code];
        return next;
      });
    }, 9000);
    stationHighlightTimersRef.current.set(code, timer);
  }
};


    const refreshOrderState = () => {
      clearTimeout(orderRefreshTimerRef.current);
      orderRefreshTimerRef.current = setTimeout(() => load(), 120);
    };

    socket.on('floorlensUpdated', onUpdated);
    socket.on('floorlensActivity', onActivity);
    socket.on('orderPlaced', refreshOrderState);
    socket.on('floorlensOrderStationActivity', onOrderStationActivity);
    socket.on('orderUpdated', refreshOrderState);

    return () => {
      socket.off('floorlensUpdated', onUpdated);
      socket.off('floorlensActivity', onActivity);
      socket.off('orderPlaced', refreshOrderState);
      socket.off('floorlensOrderStationActivity', onOrderStationActivity);
      socket.off('orderUpdated', refreshOrderState);
      clearTimeout(orderRefreshTimerRef.current);
    };
  }, [socket, load, apiUrl]);

  useEffect(() => () => {
    for (const timer of activityHighlightTimersRef.current.values()) clearTimeout(timer);
    activityHighlightTimersRef.current.clear();
    for (const timer of stationHighlightTimersRef.current.values()) clearTimeout(timer);
    stationHighlightTimersRef.current.clear();
    clearTimeout(locateTimerRef.current);
  }, []);

  const machines = useMemo(
    () => (Array.isArray(snapshot?.machines) ? snapshot.machines : []),
    [snapshot]
  );

  const machineByNumber = useMemo(() => {
    const map = new Map();
    machines.forEach((machine) => map.set(text(machine.machineNumber), machine));
    return map;
  }, [machines]);

  const selected = useMemo(
    () => (selectedNumber ? machineByNumber.get(text(selectedNumber)) || null : null),
    [machineByNumber, selectedNumber]
  );

  const areaOptions = useMemo(() => {
    const found = new Set(machines.map((machine) => text(machine.area)).filter(Boolean));
    return [...found].sort((a, b) => {
      const ai = AREA_ORDER.indexOf(a);
      const bi = AREA_ORDER.indexOf(b);
      if (ai !== -1 || bi !== -1) {
        if (ai === -1) return 1;
        if (bi === -1) return -1;
        return ai - bi;
      }
      return a.localeCompare(b);
    });
  }, [machines]);

  const filteredMachines = useMemo(() => {
    const needle = query.trim().toLowerCase();

    return machines.filter((machine) => {
      const playing = isVerifiedPlaying(machine);
      const unknownPlayer = isUnknownPlayer(machine);
      const unknownMachine = isMachineUnknown(machine);

      if (floor !== 'ALL' && machine.floor !== floor) return false;
      if (selectedAreas.length > 0 && !selectedAreas.includes(machine.area)) return false;

      if (status === STATUS.PLAYING && !playing) return false;
      if (status === STATUS.AVAILABLE && (playing || unknownMachine)) return false;
      if (status === STATUS.ORDERED && (!playing || unknownPlayer || machine.orderStatus !== 'ORDERED')) return false;
      if (status === STATUS.NOT_ORDERED && (!playing || unknownPlayer || machine.orderStatus === 'ORDERED')) return false;
      if (status === STATUS.UNKNOWN && !unknownPlayer) return false;

      if (!needle) return true;
      return [
        machine.machineNumber,
        machine.memberCode,
        machine.customerName,
        machine.area,
        machine.themeName,
        machine.gameTypeName,
      ].some((value) => text(value).toLowerCase().includes(needle));
    });
  }, [machines, query, floor, selectedAreas, status]);

  const searchMatches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    return machines
      .filter((machine) => [
        machine.machineNumber,
        machine.memberCode,
        machine.customerName,
        machine.area,
      ].some((value) => text(value).toLowerCase().includes(needle)))
      .sort((a, b) => {
        const aExact = text(a.machineNumber).toLowerCase() === needle ? 1 : 0;
        const bExact = text(b.machineNumber).toLowerCase() === needle ? 1 : 0;
        if (aExact !== bExact) return bExact - aExact;
        const aPlaying = isVerifiedPlaying(a) ? 1 : 0;
        const bPlaying = isVerifiedPlaying(b) ? 1 : 0;
        if (aPlaying !== bPlaying) return bPlaying - aPlaying;
        return text(a.machineNumber).localeCompare(text(b.machineNumber), undefined, { numeric: true });
      })
      .slice(0, 8);
  }, [machines, query]);

  const cartRowsByMachine = useMemo(() => {
    const result = new Map();
    for (const machine of machines) {
      const number = text(machine.machineNumber);
      if (!number) continue;
      const key = machine?.area && number ? `${machine.area}#${number}` : '';
      result.set(number, buildCartRows(key ? carts?.[key] : null, foods));
    }
    return result;
  }, [machines, carts, foods]);

  const selectedCartRows = useMemo(
    () => (selected ? (cartRowsByMachine.get(text(selected.machineNumber)) || []) : []),
    [selected, cartRowsByMachine]
  );
  const selectedCartCount = useMemo(
    () => selectedCartRows.reduce((sum, row) => sum + Number(row.qty || 0), 0),
    [selectedCartRows]
  );
  const selectedCartTotal = useMemo(
    () => selectedCartRows.reduce((sum, row) => sum + Number(row.lineTotal || 0), 0),
    [selectedCartRows]
  );

  const visibleNumberSet = useMemo(
    () => new Set(filteredMachines.map((machine) => text(machine.machineNumber))),
    [filteredMachines]
  );

  const playingCount = Number(snapshot?.playingCount || machines.filter(isVerifiedPlaying).length);
  const availableCount = Number(
    snapshot?.availableCount ?? machines.filter((machine) => !isMachineUnknown(machine) && !isVerifiedPlaying(machine)).length
  );
  const orderedCount = Number(snapshot?.orderedCount || 0);
  const notOrderedCount = Number(snapshot?.notOrderedCount || 0);
  const unknownCount = Number(snapshot?.unknownCount || machines.filter(isUnknownPlayer).length);

  const mapWidth = Math.max(1, Number(layout?.map?.imageWidth || layout?.map?.image_width || 0));
  const mapHeight = Math.max(1, Number(layout?.map?.imageHeight || layout?.map?.image_height || 0));
  const layoutMachines = useMemo(
    () => (Array.isArray(layout?.machines) ? layout.machines : []),
    [layout]
  );
  const layoutMachineByNumber = useMemo(() => {
    const result = new Map();
    layoutMachines.forEach((machine) => {
      const number = layoutMachineNumber(machine);
      if (number) result.set(number, machine);
    });
    return result;
  }, [layoutMachines]);

  const resolveMapImage = useMemo(() => {
    const raw = text(layout?.map?.map_image);
    if (!raw) return '';
    if (/^(data:|https?:)/i.test(raw)) return raw;
    return apiUrl(raw.startsWith('/') ? raw : `/${raw}`);
  }, [layout?.map?.map_image, apiUrl]);

  const zoomAtViewportPoint = useCallback((requestedScale, anchorX = null, anchorY = null) => {
    const viewport = mapViewportRef.current;
    if (!viewport) return;

    const oldScale = Math.max(MIN_MAP_SCALE, Number(scaleRef.current || 1));
    const nextScale = clamp(Number(requestedScale || oldScale), MIN_MAP_SCALE, MAX_MAP_SCALE);
    if (!Number.isFinite(nextScale) || Math.abs(nextScale - oldScale) < 0.0001) return;

    const pointX = Number.isFinite(anchorX) ? anchorX : viewport.clientWidth / 2;
    const pointY = Number.isFinite(anchorY) ? anchorY : viewport.clientHeight / 2;

    // Giữ nguyên đúng điểm trên bản đồ nằm dưới con trỏ khi zoom.
    const mapX = (viewport.scrollLeft + pointX) / oldScale;
    const mapY = (viewport.scrollTop + pointY) / oldScale;

    scaleRef.current = nextScale;
    setScale(nextScale);

    requestAnimationFrame(() => {
      viewport.scrollLeft = Math.max(0, mapX * nextScale - pointX);
      viewport.scrollTop = Math.max(0, mapY * nextScale - pointY);
    });
  }, []);

  const resetMapToWidth = useCallback(() => {
    const viewport = mapViewportRef.current;
    if (!viewport || !mapWidth || !mapHeight) return;
    const width = Math.max(100, viewport.clientWidth - 2);
    const next = clamp(width / mapWidth, MIN_MAP_SCALE, MAX_MAP_SCALE);
    scaleRef.current = next;
    setScale(next);
    requestAnimationFrame(() => {
      viewport.scrollTo({ left: 0, top: 0, behavior: 'auto' });
    });
  }, [mapWidth, mapHeight]);

  const fitMap = useCallback(() => {
    const viewport = mapViewportRef.current;
    if (!viewport || !mapWidth || !mapHeight) return;
    const width = Math.max(100, viewport.clientWidth - 20);
    const height = Math.max(100, viewport.clientHeight - 20);
    const next = clamp(Math.min(width / mapWidth, height / mapHeight), MIN_MAP_SCALE, MAX_MAP_SCALE);
    setFitScale(next);
    scaleRef.current = next;
    setScale(next);
    requestAnimationFrame(() => {
      viewport.scrollTo({ left: 0, top: 0, behavior: 'auto' });
    });
  }, [mapWidth, mapHeight]);

  useEffect(() => {
    const viewport = mapViewportRef.current;
    if (!viewport || !layout || !mapWidth || !mapHeight) return undefined;

    const resize = () => {
      const width = Math.max(100, viewport.clientWidth - 2);
      const height = Math.max(100, viewport.clientHeight - 20);
      const nextFit = clamp(Math.min(width / mapWidth, height / mapHeight), MIN_MAP_SCALE, MAX_MAP_SCALE);
      const widthFit = clamp(width / mapWidth, MIN_MAP_SCALE, MAX_MAP_SCALE);
      setFitScale(nextFit);
      if (!initialFitDoneRef.current) {
        initialFitDoneRef.current = true;
        scaleRef.current = widthFit;
        setScale(widthFit);
      } else if (mapWidth * scaleRef.current < viewport.clientWidth - 2) {
        // Không để Gốc/resize tạo khoảng xám thừa bên phải.
        scaleRef.current = widthFit;
        setScale(widthFit);
      }
    };

    resize();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(resize);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [layout, mapWidth, mapHeight]);

  // Lăn con lăn chuột trực tiếp trên map để zoom vào đúng vị trí con trỏ.
  useEffect(() => {
    const viewport = mapViewportRef.current;
    if (!viewport || !layout || mapWidth <= 1 || mapHeight <= 1) return undefined;

    const onWheel = (event) => {
      event.preventDefault();

      const rect = viewport.getBoundingClientRect();
      const anchorX = event.clientX - rect.left;
      const anchorY = event.clientY - rect.top;
      const delta = event.deltaMode === 1
        ? event.deltaY * 16
        : event.deltaMode === 2
          ? event.deltaY * viewport.clientHeight
          : event.deltaY;

      // Trackpad sẽ zoom mượt; wheel chuột thường zoom khoảng 10–15% mỗi nấc.
      const factor = Math.exp(-delta * 0.0015);
      zoomAtViewportPoint(scaleRef.current * factor, anchorX, anchorY);
    };

    viewport.addEventListener('wheel', onWheel, { passive: false });
    return () => viewport.removeEventListener('wheel', onWheel);
  }, [layout, mapWidth, mapHeight, zoomAtViewportPoint]);

  const beginPinchIfReady = useCallback(() => {
    const viewport = mapViewportRef.current;
    const points = [...pointerMapRef.current.values()];
    if (!viewport || points.length < 2) return false;

    const [a, b] = points;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const distance = Math.max(1, Math.hypot(dx, dy));
    const rect = viewport.getBoundingClientRect();
    const midClientX = (a.x + b.x) / 2;
    const midClientY = (a.y + b.y) / 2;
    const midX = midClientX - rect.left;
    const midY = midClientY - rect.top;
    const currentScale = Math.max(MIN_MAP_SCALE, Number(scaleRef.current || 1));

    pinchRef.current = {
      distance,
      scale: currentScale,
      mapX: (viewport.scrollLeft + midX) / currentScale,
      mapY: (viewport.scrollTop + midY) / currentScale,
    };
    panRef.current.active = false;
    panRef.current.pointerId = null;
    panRef.current.moved = true;
    setIsPanning(true);
    return true;
  }, []);

  const handleMapPointerDown = useCallback((event) => {
    const viewport = mapViewportRef.current;
    if (!viewport) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;

    pointerMapRef.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
      pointerType: event.pointerType,
    });

    if (pointerMapRef.current.size >= 2 && event.pointerType !== 'mouse') {
      event.preventDefault();
      beginPinchIfReady();
      return;
    }

    panRef.current = {
      active: true,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startLeft: viewport.scrollLeft,
      startTop: viewport.scrollTop,
      moved: false,
    };
  }, [beginPinchIfReady]);

  const handleMapPointerMove = useCallback((event) => {
    const viewport = mapViewportRef.current;
    if (!viewport) return;

    if (pointerMapRef.current.has(event.pointerId)) {
      const prev = pointerMapRef.current.get(event.pointerId) || {};
      pointerMapRef.current.set(event.pointerId, {
        ...prev,
        x: event.clientX,
        y: event.clientY,
      });
    }

    if (pointerMapRef.current.size >= 2 && event.pointerType !== 'mouse') {
      event.preventDefault();
      if (!pinchRef.current) beginPinchIfReady();
      const pinch = pinchRef.current;
      const points = [...pointerMapRef.current.values()];
      if (!pinch || points.length < 2) return;

      const [a, b] = points;
      const distance = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
      const nextScale = clamp(pinch.scale * (distance / pinch.distance), MIN_MAP_SCALE, MAX_MAP_SCALE);
      const rect = viewport.getBoundingClientRect();
      const midX = (a.x + b.x) / 2 - rect.left;
      const midY = (a.y + b.y) / 2 - rect.top;

      scaleRef.current = nextScale;
      setScale(nextScale);
      viewport.scrollLeft = Math.max(0, pinch.mapX * nextScale - midX);
      viewport.scrollTop = Math.max(0, pinch.mapY * nextScale - midY);
      return;
    }

    const pan = panRef.current;
    if (!pan.active || pan.pointerId !== event.pointerId) return;

    const dx = event.clientX - pan.startX;
    const dy = event.clientY - pan.startY;
    if (!pan.moved && Math.hypot(dx, dy) >= 5) {
      pan.moved = true;
      setIsPanning(true);
      try { viewport.setPointerCapture?.(event.pointerId); } catch (_) {}
    }
    if (!pan.moved) return;

    event.preventDefault();
    viewport.scrollLeft = pan.startLeft - dx;
    viewport.scrollTop = pan.startTop - dy;
  }, [beginPinchIfReady]);

  const finishMapPan = useCallback((event) => {
    const viewport = mapViewportRef.current;
    pointerMapRef.current.delete(event?.pointerId);

    if (pointerMapRef.current.size < 2) pinchRef.current = null;

    const pan = panRef.current;
    if (pan.active && (event?.pointerId == null || pan.pointerId === event.pointerId)) {
      if (pan.moved) {
        suppressMachineClickRef.current = true;
        setTimeout(() => { suppressMachineClickRef.current = false; }, 0);
      }
      panRef.current.active = false;
      panRef.current.pointerId = null;
      panRef.current.moved = false;
    }

    if (pointerMapRef.current.size === 0) setIsPanning(false);

    try {
      if (viewport && event?.pointerId != null && viewport.hasPointerCapture?.(event.pointerId)) {
        viewport.releasePointerCapture?.(event.pointerId);
      }
    } catch (_) {}
  }, []);

  const locateMachine = useCallback((machineNumber, {
    clearFilters = false,
    openDetail = true,
    zoom = true,
    tab = 'machine',
    pulseKind = 'FOCUS',
  } = {}) => {
    const number = text(machineNumber);
    if (!number) return;

    if (clearFilters) {
      setQuery('');
      setFloor('ALL');
      setSelectedAreas([]);
      setStatus(STATUS.ALL);
    }

    if (openDetail) {
      setSelectedNumber(number);
      setActiveDetailTab(tab);
    }
    setLocatingNumber(number);
    setLocatingKind(pulseKind === 'LEAVE' ? 'LEAVE' : pulseKind === 'ENTER' ? 'ENTER' : 'FOCUS');
    clearTimeout(locateTimerRef.current);
    locateTimerRef.current = setTimeout(() => {
      setLocatingNumber('');
      setLocatingKind('FOCUS');
    }, 5000);

    const delay = clearFilters ? 120 : 30;
    setTimeout(() => {
      const viewport = mapViewportRef.current;
      const layoutMachine = layoutMachineByNumber.get(number);
      if (!viewport || !layoutMachine) return;

      const transform = layoutMachine.transform || {};
      const x = Number(transform.positionX || 0) + Number(transform.width || 48) / 2;
      const y = Number(transform.positionY || 0) + Number(transform.height || 48) / 2;
      const currentScale = Math.max(MIN_MAP_SCALE, Number(scaleRef.current || 1));
      const fit = Math.max(MIN_MAP_SCALE, Number(fitScaleRef.current || currentScale));
      const targetScale = zoom
        ? clamp(Math.max(currentScale, Math.max(0.72, Math.min(1.2, fit * 3.4))), MIN_MAP_SCALE, MAX_MAP_SCALE)
        : currentScale;

      if (Math.abs(targetScale - currentScale) > 0.0001) {
        scaleRef.current = targetScale;
        setScale(targetScale);
      }

      requestAnimationFrame(() => {
        const left = Math.max(0, x * targetScale - viewport.clientWidth / 2);
        const top = Math.max(0, y * targetScale - viewport.clientHeight / 2);
        viewport.scrollTo({ left, top, behavior: 'smooth' });
      });
    }, delay);
  }, [layoutMachineByNumber]);

  // Khi quay từ Menu về Giỏ FloorLens chỉ được dùng target đó ĐÚNG 1 LẦN.
  // Trước đây effect phụ thuộc machineByNumber/layoutMachineByNumber nên mỗi realtime delta
  // có thể làm target cũ chạy lại và kéo user về giỏ của máy trước đó.
  useEffect(() => {
    const number = text(initialMachineNumber);
    if (!number || !machineByNumber.has(number)) return;

    const tab = ['machine', 'customer', 'orders', 'cart'].includes(initialDetailTab)
      ? initialDetailTab
      : 'machine';
    const token = `${focusRequestId}|${number}|${tab}`;
    if (consumedInitialTargetRef.current === token) return;

    consumedInitialTargetRef.current = token;
    pendingInitialLocateRef.current = { number, tab };
    setSelectedNumber(number);
    setActiveDetailTab(tab);

    try {
      onInitialTargetConsumed?.({ machineNumber: number, tab, focusRequestId });
    } catch (_) {}
  }, [focusRequestId, initialMachineNumber, initialDetailTab, machineByNumber, onInitialTargetConsumed]);

  // Center map sau khi layout sẵn sàng. Pending target nằm trong ref nên parent có thể
  // clear returnTarget ngay mà vẫn không làm mất thao tác locate hiện tại.
  useEffect(() => {
    const pending = pendingInitialLocateRef.current;
    if (!pending || !layoutMachineByNumber.has(pending.number)) return;
    pendingInitialLocateRef.current = null;
    locateMachine(pending.number, {
      clearFilters: false,
      openDetail: false,
      zoom: false,
      tab: pending.tab,
    });
  }, [layoutMachineByNumber, locateMachine]);

  useEffect(() => {
    if (!selectedNumber || machineByNumber.has(text(selectedNumber))) return;
    setSelectedNumber(null);
  }, [machineByNumber, selectedNumber]);

  const loadHistory = useCallback(async (machineNumber) => {
    const number = text(machineNumber);
    if (!number) return;
    try {
      setHistoryLoading(true);
      setHistoryError('');
      const response = await axios.get(
        apiUrl(`/api/user/floorlens/history/${encodeURIComponent(number)}`),
        { params: { limit: 30 }, timeout: 10000 }
      );
      const rows = Array.isArray(response.data?.rows) ? response.data.rows : [];
      setHistory(
        [...rows].sort((a, b) =>
          floorlensWallClockSortValue(b?.startedAt) - floorlensWallClockSortValue(a?.startedAt)
        )
      );
    } catch (requestError) {
      setHistory([]);
      setHistoryError(requestError?.response?.data?.error || requestError?.message || 'Không tải được lịch sử');
    } finally {
      setHistoryLoading(false);
    }
  }, [apiUrl]);

  useEffect(() => {
    if (!selectedNumber) {
      setHistory([]);
      setHistoryError('');
      return;
    }
    loadHistory(selectedNumber);
  }, [selectedNumber, loadHistory, snapshot?.gamingDate]);

  const loadMachineOrders = useCallback(async (machineNumber, machineArea = '') => {
    const number = text(machineNumber);
    if (!number) return;
    try {
      setMachineOrdersLoading(true);
      setMachineOrdersError('');
      const response = await axios.get(
        apiUrl(`/api/user/floorlens/orders/${encodeURIComponent(number)}`),
        {
          params: { area: machineArea || undefined, limit: 40 },
          timeout: 10000,
          headers: { 'Cache-Control': 'no-cache' },
        }
      );
      setMachineOrders(Array.isArray(response.data?.rows) ? response.data.rows : []);
    } catch (requestError) {
      setMachineOrders([]);
      setMachineOrdersError(requestError?.response?.data?.error || requestError?.message || 'Không tải được order của máy');
    } finally {
      setMachineOrdersLoading(false);
    }
  }, [apiUrl]);

  const loadCustomerProfile = useCallback(async (memberCode) => {
    const code = text(memberCode).replace(/\s+/g, '');
    if (!code) return;
    const requestId = customerProfileRequestRef.current + 1;
    customerProfileRequestRef.current = requestId;
    setCustomerProfileCode(code);
    setCustomerProfileLoading(true);
    setCustomerProfileError('');

    try {
      const [profileResult, spendingResult, spendingAllResult, machinesResult] = await Promise.allSettled([
        axios.get(apiUrl(`/api/user/customer-profile/${encodeURIComponent(code)}`), {
          params: { t: Date.now() },
          headers: { 'Cache-Control': 'no-cache' },
          timeout: 10000,
        }),
        axios.get(apiUrl(`/api/user/customer-spending/${encodeURIComponent(code)}`), {
          params: { t: Date.now() },
          headers: { 'Cache-Control': 'no-cache' },
          timeout: 7000,
        }),
        axios.get(apiUrl(`/api/user/customer-spending/${encodeURIComponent(code)}/detail`), {
          params: { range: 'all', t: Date.now() },
          headers: { 'Cache-Control': 'no-cache' },
          timeout: 10000,
        }),
        axios.get(apiUrl(`/api/user/floorlens/customer/${encodeURIComponent(code)}/machines`), {
          params: { limit: 80 },
          headers: { 'Cache-Control': 'no-cache' },
          timeout: 7000,
        }),
      ]);

      if (requestId !== customerProfileRequestRef.current) return;
      if (profileResult.status === 'fulfilled') setCustomerProfile(profileResult.value.data || null);
      else throw profileResult.reason;

      setCustomerSpending(spendingResult.status === 'fulfilled' ? (spendingResult.value.data || null) : null);
      setCustomerSpendingAll(spendingAllResult.status === 'fulfilled' ? (spendingAllResult.value.data || null) : null);
      setCustomerMachineHistory(
        machinesResult.status === 'fulfilled' && Array.isArray(machinesResult.value.data?.rows)
          ? machinesResult.value.data.rows
          : []
      );
    } catch (requestError) {
      if (requestId !== customerProfileRequestRef.current) return;
      setCustomerProfile(null);
      setCustomerSpending(null);
      setCustomerSpendingAll(null);
      setCustomerMachineHistory([]);
      setCustomerProfileError(requestError?.response?.data?.error || requestError?.message || 'Không tải được hồ sơ khách');
    } finally {
      if (requestId === customerProfileRequestRef.current) setCustomerProfileLoading(false);
    }
  }, [apiUrl]);

  const openCustomerProfile = useCallback((machineOrRow, { locate = false } = {}) => {
    const code = text(machineOrRow?.memberCode).replace(/\s+/g, '');
    const number = text(machineOrRow?.machineNumber);
    if (!code) {
      if (number) {
        setSelectedNumber(number);
        setActiveDetailTab('machine');
      }
      return;
    }
    if (number) setSelectedNumber(number);
    setActiveDetailTab('customer');
    if (locate && number) locateMachine(number, { tab: 'customer' });
  }, [locateMachine]);

  useEffect(() => {
    customerProfileRequestRef.current += 1;
    setCustomerProfileCode('');
    setCustomerProfile(null);
    setCustomerProfileLoading(false);
    setCustomerProfileError('');
    setCustomerSpending(null);
    setCustomerSpendingAll(null);
    setCustomerMachineHistory([]);
  }, [selectedNumber]);

  useEffect(() => {
    setExpandedOrderIds(new Set());
    if (!selected) {
      setMachineOrders([]);
      return;
    }
    if (activeDetailTab === 'orders') loadMachineOrders(selected.machineNumber, selected.area);
    if (activeDetailTab === 'customer' && isVerifiedPlaying(selected) && selected.memberCode && !isUnknownPlayer(selected)) {
      const code = text(selected.memberCode).replace(/\s+/g, '');
      if (code && code !== customerProfileCode) loadCustomerProfile(code);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNumber, activeDetailTab, selected?.memberCode, selected?.area, selected?.machineNumber, customerProfileCode, loadMachineOrders, loadCustomerProfile]);

  const dismissAlert = useCallback((id) => {
    setAlerts((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const resetFilters = () => {
    setQuery('');
    setFloor('ALL');
    setSelectedAreas([]);
    setStatus(STATUS.ALL);
  };

  const selectForOrder = () => {
    if (!selected || typeof onSelectTable !== 'function') return;
    const numeric = Number(selected.machineNumber);
    onSelectTable({
      area: selected.area,
      tableNo: Number.isFinite(numeric) ? numeric : selected.machineNumber,
      memberCode: isUnknownPlayer(selected) ? '' : text(selected.memberCode),
      customerName: isUnknownPlayer(selected) ? '' : text(selected.customerName),
    });
  };

  const toggleExpandedOrder = useCallback((orderId) => {
    const key = text(orderId);
    if (!key) return;
    setExpandedOrderIds((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const showAll = () => setStatus(STATUS.ALL);
  const enterAlerts = alerts.filter((item) => item.kind === 'ENTER');
  const leaveAlerts = alerts.filter((item) => item.kind === 'LEAVE');

  return (
    <div className="fl-shell">
      <header className="fl-header">
        <div className="fl-title-block">
          <div className="fl-title-row">
            <span className="fl-test-badge">TEST</span>
            <h1>FloorLens</h1>
          </div>
        </div>

        <div className="fl-header-activity-board" aria-live="polite">
          <HeaderActivityCard
            kind="ENTER"
            alerts={enterAlerts}
            apiUrl={apiUrl}
            onDismiss={dismissAlert}
            onOpen={(alert) => {
              locateMachine(alert.machineNumber, { clearFilters: true, tab: 'machine', pulseKind: alert.kind });
            }}
          />
          <HeaderActivityCard
            kind="LEAVE"
            alerts={leaveAlerts}
            apiUrl={apiUrl}
            onDismiss={dismissAlert}
            onOpen={(alert) => {
              locateMachine(alert.machineNumber, { clearFilters: true, tab: 'machine', pulseKind: alert.kind });
            }}
          />
        </div>

        <div className="fl-header-actions">
          <div className={`fl-live ${snapshot?.connected ? 'is-live' : 'is-offline'}`}>
            <span />
            {snapshot?.realtimeReady
              ? 'Realtime'
              : snapshot?.fallbackActive
                ? 'Fallback'
                : snapshot?.connected
                  ? 'Connected'
                  : 'No connection'}
          </div>
          <button type="button" className="fl-icon-button" onClick={() => { load(); loadLayout({ force: true }); }} title="Tải lại">
            ↻
          </button>
        </div>
      </header>

      <section className="fl-stats">
        <StatCard
          value={snapshot?.totalMachines ?? machines.length}
          label="Machines"
          sub="Tổng máy"
          tone="neutral"
          active={status === STATUS.ALL}
          onClick={showAll}
        />
        <StatCard
          value={playingCount}
          label="Playing"
          sub="Khách hiện tại"
          tone="playing"
          active={status === STATUS.PLAYING}
          onClick={() => setStatus(STATUS.PLAYING)}
        />
        <StatCard
          value={availableCount}
          label="Available"
          sub="Máy trống"
          tone="idle"
          active={status === STATUS.AVAILABLE}
          onClick={() => setStatus(STATUS.AVAILABLE)}
        />
        <StatCard
          value={orderedCount}
          label="Đã order"
          sub="Khách đang chơi"
          tone="ordered"
          active={status === STATUS.ORDERED}
          onClick={() => setStatus(STATUS.ORDERED)}
        />
        <StatCard
          value={notOrderedCount}
          label="Chưa order"
          sub="Cần theo dõi"
          tone="not-ordered"
          active={status === STATUS.NOT_ORDERED}
          onClick={() => setStatus(STATUS.NOT_ORDERED)}
        />
        <StatCard
          value={unknownCount}
          label="Unknown"
          sub="Chưa có member"
          tone="unknown"
          active={status === STATUS.UNKNOWN}
          onClick={() => setStatus(STATUS.UNKNOWN)}
        />
      </section>

      <section className="fl-toolbar">
        <div className="fl-search-wrap">
          <label className="fl-search">
            <span>⌕</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setTimeout(() => setSearchFocused(false), 120)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return;
                const target = searchMatches[0];
                if (!target) return;
                event.preventDefault();
                locateMachine(target.machineNumber, { clearFilters: false, tab: 'machine' });
                setSearchFocused(false);
              }}
              placeholder="Tìm máy / member / tên khách..."
            />
            {query && (
              <button type="button" onClick={() => setQuery('')} aria-label="Xóa tìm kiếm">×</button>
            )}
          </label>

          {query && searchFocused && searchMatches.length > 0 && (
            <div className="fl-search-results">
              {searchMatches.map((machine) => (
                <button
                  type="button"
                  key={`search-${machine.machineNumber}`}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    locateMachine(machine.machineNumber, { tab: 'machine' });
                    setSearchFocused(false);
                  }}
                >
                  <b>{machine.machineNumber}</b>
                  <span>{machine.customerName || statusLabelOf(machine)}</span>
                  <small>{machine.area} • {statusLabelOf(machine)}</small>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="fl-floor-segment" aria-label="Chọn tầng">
          {['ALL', '1F', '2F'].map((value) => (
            <button
              type="button"
              key={value}
              className={floor === value ? 'active' : ''}
              onClick={() => setFloor(value)}
            >
              {value === 'ALL' ? 'All' : value}
            </button>
          ))}
        </div>

        <div className="fl-area-multi">
          <button
            type="button"
            className={`fl-area-multi-trigger ${areaMenuOpen ? 'is-open' : ''}`}
            onClick={() => setAreaMenuOpen((value) => !value)}
          >
            <span>
              {selectedAreas.length === 0
                ? 'Tất cả khu vực'
                : selectedAreas.length === 1
                  ? selectedAreas[0]
                  : `${selectedAreas.length} khu vực`}
            </span>
            <b>⌄</b>
          </button>

          {areaMenuOpen && (
            <div className="fl-area-multi-menu">
              <label className="fl-area-check is-all">
                <input
                  type="checkbox"
                  checked={selectedAreas.length === 0}
                  onChange={() => setSelectedAreas([])}
                />
                <span>Tất cả khu vực</span>
              </label>

              {areaOptions.map((name) => (
                <label className="fl-area-check" key={name}>
                  <input
                    type="checkbox"
                    checked={selectedAreas.includes(name)}
                    onChange={(event) => {
                      setSelectedAreas((prev) => {
                        if (event.target.checked) return [...new Set([...prev, name])];
                        return prev.filter((value) => value !== name);
                      });
                    }}
                  />
                  <span>{name}</span>
                </label>
              ))}
            </div>
          )}
        </div>

        <select
          className="fl-order-station-select"
          value={orderStation}
          onChange={(event) => setOrderStation(normalizeOrderStation(event.target.value))}
          title="Gán vị trí cố định cho iPad này. Chỉ cần chọn 1 lần, thiết bị sẽ nhớ."
        >
          <option value="">iPad: Chưa gán</option>
          {ORDER_STATIONS.map((station) => (
            <option key={station.code} value={station.code}>iPad: {station.label}</option>
          ))}
        </select>

        <select value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value={STATUS.ALL}>Tất cả trạng thái</option>
          <option value={STATUS.PLAYING}>Đang có khách</option>
          <option value={STATUS.AVAILABLE}>Máy trống</option>
          <option value={STATUS.ORDERED}>Đã order</option>
          <option value={STATUS.NOT_ORDERED}>Chưa order</option>
          <option value={STATUS.UNKNOWN}>Unknown player</option>
        </select>

        {(query || floor !== 'ALL' || selectedAreas.length > 0 || status !== STATUS.ALL) && (
          <button type="button" className="fl-reset-button" onClick={resetFilters}>Đặt lại</button>
        )}
      </section>

      {(snapshot?.error || error || layoutError) && (
        <div className="fl-warning-stack">
          {snapshot?.error && <div className="fl-warning"><b>FloorLens:</b> {snapshot.error}</div>}
          {error && <div className="fl-error"><b>Dữ liệu:</b> {error}</div>}
          {layoutError && (
            <div className="fl-warning">
              <b>Sơ đồ:</b> {layoutError}. Vẫn có thể dùng danh sách máy phía dưới.
            </div>
          )}
        </div>
      )}

      <section className={`fl-workspace ${selected ? 'has-detail' : ''}`}>
        <div className="fl-map-card">
          <div className="fl-map-topbar">
            <div className="fl-map-summary">
              <b>{filteredMachines.length}</b>
              <span>máy đang hiển thị</span>
              {snapshot?.gamingDate && <small>Gaming Date: {snapshot.gamingDate}</small>}
            </div>

            <div className="fl-map-controls">
              <span className="fl-map-mouse-hint">Chuột: lăn zoom • Kéo map • Touch: kéo 1 ngón / pinch 2 ngón</span>
              <button type="button" onClick={() => zoomAtViewportPoint(scaleRef.current - 0.12)} title="Thu nhỏ">−</button>
              <button type="button" className="fl-scale-label" onClick={() => zoomAtViewportPoint(fitScale)} title="Fit map">
                {Math.round(scale * 100)}%
              </button>
              <button type="button" onClick={() => zoomAtViewportPoint(scaleRef.current + 0.12)} title="Phóng to">+</button>
              <button type="button" className="fl-fit-button" onClick={fitMap}>Fit</button>
              <button type="button" className="fl-reset-map-button" onClick={resetMapToWidth} title="Quay về kích cỡ gốc, phủ kín chiều ngang">↺ Gốc</button>
            </div>
          </div>

          <div className="fl-legend">
            <span><i className="ordered" />Có khách + đã order</span>
            <span><i className="not-ordered" />Có khách + chưa order / Unknown</span>
            <span><i className="idle" />Chưa có khách chơi</span>
          </div>

          <div
            className={`fl-map-viewport ${isPanning ? 'is-panning' : ''}`}
            ref={mapViewportRef}
            onPointerDown={handleMapPointerDown}
            onPointerMove={handleMapPointerMove}
            onPointerUp={finishMapPan}
            onPointerCancel={finishMapPan}
            onTouchStart={(event) => event.stopPropagation()}
            onTouchMove={(event) => event.stopPropagation()}
            onTouchEnd={(event) => event.stopPropagation()}
          >
            {loading || layoutLoading ? (
              <div className="fl-map-loading">Đang tải FloorLens realtime và sơ đồ máy…</div>
            ) : layout && layoutMachines.length > 0 && mapWidth > 1 && mapHeight > 1 ? (
              <div
                className="fl-map-canvas"
                style={{ width: mapWidth * scale, height: mapHeight * scale }}
              >
                <div
                  className="fl-map-stage"
                  style={{
                    width: mapWidth,
                    height: mapHeight,
                    transform: `scale(${scale})`,
                    backgroundColor: layout?.map?.backgroundColor || '#fff',
                    backgroundImage: resolveMapImage ? `url("${resolveMapImage}")` : undefined,
                  }}
                >
                  {REFERENCE_LABELS.map(([label, x, y]) => (
                    <span
                      key={`ref-label-${label}-${x}-${y}`}
                      className="fl-reference-label"
                      style={{ left: x * mapWidth, top: y * mapHeight }}
                    >
                      {label}
                    </span>
                  ))}

                  
{FLOOR_STATIONS.map((station) => {
  const active = stationHighlights[station.code] || null;
  const stationRole = active?.role || '';
  return (
    <button
      type="button"
      key={`station-${station.code}`}
      className={[
        'fl-floor-station',
        active ? 'is-active' : '',
        station.code === 'KITCHEN' ? 'is-kitchen' : '',
        stationRole === 'source' ? 'is-source-active' : '',
        stationRole === 'target' ? 'is-target-active' : '',
      ].filter(Boolean).join(' ')}
      style={{ left: station.x * mapWidth, top: station.y * mapHeight }}
      title={active
        ? `${station.label} • ${stationRole === 'target' ? 'Nhận order' : 'Gửi order'}${active.orderId ? ` • Order #${active.orderId}` : ''}${active.machineNumber ? ` • Máy ${active.machineNumber}` : ''}`
        : station.label}
    >
      <span className="fl-floor-station-icon">▣</span>
      <span className="fl-floor-station-label">{station.label}</span>
    </button>
  );
})}


                  {(Array.isArray(layout?.groups) ? layout.groups : []).map((group, index) => {
                    const transform = group?.transform || {};
                    if (transform.visible === false) return null;
                    return (
                      <div
                        key={`group-${group?.group_id || group?.group_name || index}`}
                        className="fl-layout-group"
                        style={{
                          left: Number(transform.positionX || 0),
                          top: Number(transform.positionY || 0),
                          width: Number(transform.width || 0),
                          height: Number(transform.height || 0),
                          zIndex: Number(transform.zIndex || 1),
                          transform: layoutTransform(transform),
                          background: 'transparent',
                          borderColor: 'transparent',
                        }}
                      >
                        {group?.group_name && (
                          <span
                            style={{
                              left: Number(group?.label?.offsetX || 6),
                              top: Number(group?.label?.offsetY || 4),
                              fontSize: clamp(Number(group?.label?.size || 18), 8, 28),
                            }}
                          >
                            {group.group_name}
                          </span>
                        )}
                      </div>
                    );
                  })}

                  {(Array.isArray(layout?.objects) ? layout.objects : []).map((object, index) => {
                    const transform = object?.transform || {};
                    if (transform.visible === false) return null;
                    const objectType = text(object?.object_type || object?.object_description).toLowerCase();
                    const round = objectType === 'circle' || objectType === 'kiosk';
                    return (
                      <div
                        key={`object-${object?.object_id || object?.object_name || index}`}
                        className="fl-layout-object"
                        title={object?.object_name || ''}
                        style={{
                          left: Number(transform.positionX || 0),
                          top: Number(transform.positionY || 0),
                          width: Number(transform.width || 0),
                          height: Number(transform.height || 0),
                          zIndex: Number(transform.zIndex || 5),
                          transform: layoutTransform(transform),
                          background: object?.colorCode === 'transparent' ? 'transparent' : (object?.colorCode || 'transparent'),
                          borderColor: object?.borderColorCode || 'transparent',
                          borderRadius: round ? '50%' : undefined,
                        }}
                      >
                        {object?.object_name && <span>{object.object_name}</span>}
                      </div>
                    );
                  })}

                  {layoutMachines.map((layoutMachine) => {
                    const number = layoutMachineNumber(layoutMachine);
                    if (!number) return null;
                    const transform = layoutMachine.transform || {};
                    if (transform.visible === false) return null;

                    const machine = machineByNumber.get(number) || {
                      machineNumber: number,
                      area: 'Other',
                      online: false,
                      checkState: 'pending',
                      isPlaying: false,
                    };
                    const tone = orderToneOf(machine);
                    const visible = visibleNumberSet.has(number);
                    const playing = isVerifiedPlaying(machine);
                    const geometry = uprightMachineGeometry(transform, number);
                    const avatarCfg = layoutMachine.avatar || {};
                    const requestedAvatarWidth = Number(avatarCfg.width || 0);
                    const requestedAvatarHeight = Number(avatarCfg.height || 0);
                    const avatarSize = clamp(
                      Math.max(requestedAvatarWidth, requestedAvatarHeight, Math.min(geometry.width, geometry.height) * 0.78),
                      20,
                      38
                    );
                    const sourceAvatarPosition = text(avatarCfg.position) || 'top';
                    const screenAvatarPosition = avatarScreenPosition(sourceAvatarPosition, transform);
                    const avatarSlotStyle = avatarPositionStyle(
                      screenAvatarPosition,
                      Number(avatarCfg.offset ?? avatarCfg.distance ?? 2)
                    );
                    const isSelected = selectedNumber === number;
                    const isCurrentTable = selectedTable &&
                      String(selectedTable.area) === String(machine.area) &&
                      String(selectedTable.tableNo) === number;
                    const activity = activityHighlights[number] || null;
                    const machineCartRows = cartRowsByMachine.get(number) || [];
                    const machineCartCount = machineCartRows.reduce((sum, row) => sum + Number(row.qty || 0), 0);

                    const openMachinePanel = () => {
                      if (suppressMachineClickRef.current) return;
                      setSelectedNumber(number);
                      setActiveDetailTab('machine');
                      setLocatingNumber(number);
                      setLocatingKind('FOCUS');
                      clearTimeout(locateTimerRef.current);
                      locateTimerRef.current = setTimeout(() => {
                        setLocatingNumber('');
                        setLocatingKind('FOCUS');
                      }, 5000);
                    };

                    return (
                      <div
                        role="button"
                        tabIndex={visible ? 0 : -1}
                        key={number}
                        data-floorlens-machine={number}
                        className={[
                          'fl-map-machine',
                          `tone-${tone}`,
                          visible ? 'is-visible' : 'is-filtered',
                          isSelected ? 'is-selected' : '',
                          locatingNumber === number ? 'is-locating' : '',
                          locatingNumber === number && locatingKind === 'ENTER' ? 'is-locating-enter' : '',
                          locatingNumber === number && locatingKind === 'LEAVE' ? 'is-locating-leave' : '',
                          locatingNumber === number && locatingKind === 'FOCUS' ? 'is-locating-focus' : '',
                          isCurrentTable ? 'is-table-selected' : '',
                          activity?.kind === 'ENTER' ? 'is-activity-enter' : '',
                          activity?.kind === 'LEAVE' ? 'is-activity-leave' : '',
                        ].filter(Boolean).join(' ')}
                        onClick={(event) => {
                          if (suppressMachineClickRef.current) {
                            event.preventDefault();
                            event.stopPropagation();
                            return;
                          }
                          openMachinePanel();
                        }}
                        onDoubleClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          locateMachine(number, { tab: 'machine' });
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            openMachinePanel();
                          }
                        }}
                        title={`Machine ${number} • ${machine.customerName || statusLabelOf(machine)} • ${statusLabelOf(machine)}`}
                        style={{
                          left: geometry.left,
                          top: geometry.top,
                          width: geometry.width,
                          height: geometry.height,
                          zIndex: locatingNumber === number || activity ? 9999 : Number(transform.zIndex || 10),
                          '--machine-fill': machineStatusColorOf(machine),
                          '--machine-sub-fill': machineStatusColorOf(machine),
                        }}
                      >
                        <span className="fl-map-machine-body" style={{ transform: geometry.bodyRotation ? `rotate(${geometry.bodyRotation}deg)` : undefined }} />
                        <span
                          className="fl-map-machine-label"
                          style={{ fontSize: clamp(Number(layoutMachine?.label?.numberSize || 15), 8, 17) }}
                        >
                          {number}
                        </span>

                        {machineCartCount > 0 && (
                          <span className="fl-machine-cart-badge" title={`${machineCartCount} món trong giỏ`}>
                            🛒 {machineCartCount}
                          </span>
                        )}

                        {playing && (
                          <span
                            className={`fl-map-avatar-slot pos-${screenAvatarPosition}`}
                            style={avatarSlotStyle}
                          >
                            <span
                              className={`fl-avatar-click-target ${isUnknownPlayer(machine) ? 'is-unknown' : ''}`}
                              role="button"
                              tabIndex={0}
                              onClick={(event) => {
                                event.stopPropagation();
                                setLocatingNumber(number);
                                setLocatingKind('FOCUS');
                                clearTimeout(locateTimerRef.current);
                                locateTimerRef.current = setTimeout(() => {
                                  setLocatingNumber('');
                                  setLocatingKind('FOCUS');
                                }, 5000);
                                if (isUnknownPlayer(machine)) {
                                  setSelectedNumber(number);
                                  setActiveDetailTab('machine');
                                } else {
                                  openCustomerProfile(machine);
                                }
                              }}
                              onDoubleClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                locateMachine(number, { tab: isUnknownPlayer(machine) ? 'machine' : 'customer' });
                              }}
                              onKeyDown={(event) => {
                                if (event.key !== 'Enter' && event.key !== ' ') return;
                                event.preventDefault();
                                event.stopPropagation();
                                if (isUnknownPlayer(machine)) {
                                  setSelectedNumber(number);
                                  setActiveDetailTab('machine');
                                } else {
                                  openCustomerProfile(machine);
                                }
                              }}
                              title={isUnknownPlayer(machine) ? 'Unknown Player' : 'Mở hồ sơ khách'}
                            >
                              <CustomerAvatar
                                apiUrl={apiUrl}
                                code={machine.memberCode}
                                name={machine.customerName}
                                unknown={isUnknownPlayer(machine)}
                                size={avatarSize}
                                className={`fl-avatar-live tone-${tone}`}
                              />
                            </span>
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <FallbackMachineGrid
                machines={filteredMachines}
                onOpen={setSelectedNumber}
                apiUrl={apiUrl}
                selectedTable={selectedTable}
              />
            )}
          </div>
        </div>

        {selected && (
          <aside className="fl-detail-panel">
            <div className="fl-detail-head">
              <div>
                <small>Machine</small>
                <h2>{selected.machineNumber}</h2>
              </div>
              <button type="button" onClick={() => setSelectedNumber(null)} aria-label="Đóng">×</button>
            </div>

            <div className="fl-detail-tabs">
              <button
                type="button"
                className={activeDetailTab === 'machine' ? 'active' : ''}
                onClick={() => setActiveDetailTab('machine')}
              >
                Máy
              </button>
              <button
                type="button"
                className={activeDetailTab === 'customer' ? 'active' : ''}
                disabled={!selected.memberCode || isUnknownPlayer(selected) || !isVerifiedPlaying(selected)}
                onClick={() => {
                  setActiveDetailTab('customer');
                }}
              >
                Khách
              </button>
              <button
                type="button"
                className={activeDetailTab === 'orders' ? 'active' : ''}
                onClick={() => setActiveDetailTab('orders')}
              >
                Orders
              </button>
              <button
                type="button"
                className={activeDetailTab === 'cart' ? 'active' : ''}
                onClick={() => setActiveDetailTab('cart')}
              >
                Giỏ {selectedCartCount > 0 ? `(${selectedCartCount})` : ''}
              </button>
            </div>

            {activeDetailTab === 'machine' && (
              <>
                <div className="fl-detail-customer">
                  {isVerifiedPlaying(selected) ? (
                    <span
                      className={`fl-detail-avatar-action ${isUnknownPlayer(selected) ? 'is-disabled' : ''}`}
                      role={isUnknownPlayer(selected) ? undefined : 'button'}
                      tabIndex={isUnknownPlayer(selected) ? -1 : 0}
                      onClick={() => !isUnknownPlayer(selected) && openCustomerProfile(selected)}
                      onDoubleClick={() => locateMachine(selected.machineNumber, { tab: isUnknownPlayer(selected) ? 'machine' : 'customer' })}
                    >
                      <CustomerAvatar
                        apiUrl={apiUrl}
                        code={selected.memberCode}
                        name={selected.customerName}
                        unknown={isUnknownPlayer(selected)}
                        size={66}
                        className={`tone-${orderToneOf(selected)}`}
                      />
                    </span>
                  ) : (
                    <span className="fl-empty-machine-icon">◇</span>
                  )}

                  <div className="fl-detail-name">
                    <div className="fl-detail-badges">
                      <span className={`fl-pill tone-${isVerifiedPlaying(selected) ? 'playing' : 'idle'}`}>
                        {isVerifiedPlaying(selected) ? 'PLAYING' : 'AVAILABLE'}
                      </span>
                      {isVerifiedPlaying(selected) && (
                        <span className={`fl-pill tone-${orderToneOf(selected)}`}>
                          {statusLabelOf(selected).toUpperCase()}
                        </span>
                      )}
                      {selectedCartCount > 0 && <span className="fl-pill tone-cart">🛒 {selectedCartCount}</span>}
                    </div>
                    <h3>
                      {isVerifiedPlaying(selected)
                        ? (selected.customerName || (isUnknownPlayer(selected) ? 'Unknown Player' : `Member ${selected.memberCode}`))
                        : `Máy ${selected.machineNumber}`}
                    </h3>
                    {selected.memberCode && <p>#{selected.memberCode}</p>}
                  </div>
                </div>

                <div className="fl-info-grid">
                  <div><span>Khu vực</span><b>{selected.area || '—'}</b></div>
                  <div><span>Tầng</span><b>{selected.floor || '—'}</b></div>
                  <div><span>Session</span><b>{selected.sessionId || '—'}</b></div>
                  <div><span>Bắt đầu</span><b>{formatFloorlensDateTime(selected.startedAt)}</b></div>
                </div>

                {isVerifiedPlaying(selected) && !isUnknownPlayer(selected) && (
                  <div className={`fl-order-summary tone-${orderToneOf(selected)}`}>
                    <div className="fl-order-summary-title">
                      <span>{selected.orderStatus === 'ORDERED' ? '✓' : '!'}</span>
                      <div>
                        <b>{selected.orderStatus === 'ORDERED' ? 'Khách đã order' : 'Khách chưa order'}</b>
                      </div>
                    </div>

                    {selected.orderStatus === 'ORDERED' && (
                      <div className="fl-order-meta">
                        <span>{selected.orderCountToday || 0} order</span>
                        {selected.latestOrderAt && <span>Lần cuối: {formatDateTime(selected.latestOrderAt)}</span>}
                        {selected.latestOrderStaff && <span>Staff: {selected.latestOrderStaff}</span>}
                      </div>
                    )}
                  </div>
                )}

                <div className="fl-detail-actions">
                  {typeof onSelectTable === 'function' && (
                    <button type="button" className="primary" onClick={selectForOrder}>
                      Chọn máy & mở Menu
                    </button>
                  )}
                  {selected.memberCode && !isUnknownPlayer(selected) && (
                    <button type="button" onClick={() => openCustomerProfile(selected)}>
                      Hồ sơ khách
                    </button>
                  )}
                  <button type="button" onClick={() => locateMachine(selected.machineNumber)}>
                    Tới vị trí máy
                  </button>
                </div>

                <div className="fl-history-section">
                  <div className="fl-history-title">
                    <div>
                      <h3>Lịch sử tại máy</h3>
                      <small>{snapshot?.gamingDate ? `Gaming Date ${snapshot.gamingDate}` : 'Phiên gần đây'}</small>
                    </div>
                    <button type="button" onClick={() => loadHistory(selected.machineNumber)}>↻</button>
                  </div>

                  {historyLoading ? (
                    <div className="fl-history-empty">Đang tải lịch sử…</div>
                  ) : historyError ? (
                    <div className="fl-history-empty is-error">{historyError}</div>
                  ) : history.length === 0 ? (
                    <div className="fl-history-empty">Chưa có lịch sử ở máy này.</div>
                  ) : (
                    <div className="fl-history-list">
                      {history.map((row, index) => {
                        const rowTone = row.unknownPlayer
                          ? 'unknown'
                          : row.orderStatus === 'ORDERED'
                            ? 'ordered'
                            : 'not-ordered';
                        return (
                          <div className="fl-history-row" key={row.sessionId || `${row.startedAt}-${index}`}>
                            <div className="fl-history-time">
                              <b>{formatFloorlensShortTime(row.startedAt)}</b>
                              <small>{row.active ? 'Đang chơi' : row.endedAt ? `Rời ${formatFloorlensShortTime(row.endedAt)}` : 'Đã đóng'}</small>
                            </div>
                            <span
                              className={`fl-history-avatar-action ${row.unknownPlayer || !row.memberCode ? 'is-disabled' : ''}`}
                              role={row.unknownPlayer || !row.memberCode ? undefined : 'button'}
                              onClick={() => row.memberCode && !row.unknownPlayer && openCustomerProfile(row)}
                            >
                              <CustomerAvatar
                                apiUrl={apiUrl}
                                code={row.memberCode}
                                name={row.customerName}
                                unknown={row.unknownPlayer}
                                size={34}
                                className={`tone-${rowTone}`}
                              />
                            </span>
                            <div className="fl-history-person">
                              <b>{row.customerName || (row.unknownPlayer ? 'Unknown Player' : `Member ${row.memberCode || '—'}`)}</b>
                              <small>{row.memberCode ? `#${row.memberCode}` : row.unknownPlayerId ? `Unknown #${row.unknownPlayerId}` : '—'}</small>
                            </div>
                            <span className={`fl-history-order tone-${rowTone}`}>
                              {row.unknownPlayer ? 'Unknown' : row.orderStatus === 'ORDERED' ? 'Đã order' : 'Chưa order'}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </>
            )}

            {activeDetailTab === 'customer' && (
              <div className="fl-customer-profile-tab">
                {!selected.memberCode || isUnknownPlayer(selected) || !isVerifiedPlaying(selected) ? (
                  <div className="fl-panel-message">Máy này hiện không có khách có member để hiển thị.</div>
                ) : customerProfileLoading ? (
                  <div className="fl-panel-message">Đang tải hồ sơ khách…</div>
                ) : customerProfileError ? (
                  <div className="fl-panel-message is-error">{customerProfileError}</div>
                ) : (
                  <>
                    <div className="fl-profile-hero">
                      <CustomerAvatar
                        apiUrl={apiUrl}
                        code={customerProfile?.member?.code || selected.memberCode}
                        name={customerProfile?.member?.name || (selected.customerName)}
                        size={82}
                        className={`tone-${orderToneOf(selected)}`}
                      />
                      <div>
                        <div className="fl-detail-badges">
                          <span className="fl-pill tone-playing">PLAYING</span>
                          <span className={`fl-pill tone-${orderToneOf(selected)}`}>{statusLabelOf(selected).toUpperCase()}</span>
                        </div>
                        <h3>{customerProfile?.member?.name || (selected.customerName) || `Member ${selected.memberCode}`}</h3>
                        <p>#{customerProfile?.member?.code || selected.memberCode}</p>
                        <p>{customerProfile?.member?.level || customerProfile?.member?.membershipType || 'Chưa có level'}</p>
                      </div>
                    </div>

                    <div className="fl-profile-stats">
                      <div><span>Orders</span><b>{customerSpendingAll?.summary?.orders ?? customerProfile?.member?.ordersCount ?? 0}</b></div>
                      <div><span>Hôm nay</span><b>{formatMoneyVnd(customerSpending?.today?.total)}</b></div>
                      <div><span>Tháng này</span><b>{formatMoneyVnd(customerSpending?.thisMonth?.total)}</b></div>
                      <div><span>Tổng đã order</span><b>{formatMoneyVnd(customerSpendingAll?.summary?.total)}</b></div>
                    </div>

                    <div className="fl-detail-actions">
                      {typeof onSelectTable === 'function' && (
                        <button type="button" className="primary" onClick={selectForOrder}>
                          Chọn máy & mở Menu order
                        </button>
                      )}
                      {typeof onOpenCustomer === 'function' && (
                        <button
                          type="button"
                          onClick={() => onOpenCustomer(customerProfile?.member?.code || selected.memberCode)}
                        >
                          Customer Insights
                        </button>
                      )}
                      <button type="button" onClick={() => locateMachine(selected.machineNumber, { tab: 'customer' })}>
                        Tới máy hiện tại
                      </button>
                      <button type="button" onClick={() => loadCustomerProfile(customerProfile?.member?.code || selected.memberCode)}>
                        ↻ Refresh
                      </button>
                    </div>

                    <div className="fl-profile-section">
                      <div className="fl-section-title">
                        <h3>Máy đã chơi</h3>
                        <small>{snapshot?.gamingDate ? `Gaming Date ${snapshot.gamingDate}` : 'Hiện tại'}</small>
                      </div>
                      {customerMachineHistory.length === 0 ? (
                        <div className="fl-panel-message compact">Chưa có lịch sử machine.</div>
                      ) : (
                        <div className="fl-machine-history-list">
                          {customerMachineHistory.slice(0, 20).map((row, index) => (
                            <button
                              type="button"
                              key={row.sessionId || `${row.machineNumber}-${row.startedAt}-${index}`}
                              onClick={() => locateMachine(row.machineNumber, { tab: 'machine' })}
                            >
                              <b>{row.machineNumber}</b>
                              <span>{row.area}</span>
                              <small>{formatFloorlensShortTime(row.startedAt)} → {row.active ? 'đang chơi' : formatFloorlensShortTime(row.endedAt)}</small>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="fl-profile-section">
                      <div className="fl-section-title">
                        <h3>Lịch sử order gần đây</h3>
                        <small>{customerProfile?.orders?.length || 0} order đang hiển thị</small>
                      </div>
                      {(Array.isArray(customerProfile?.orders) ? customerProfile.orders : []).slice(0, 12).map((order) => {
                        const key = text(order.id);
                        const expanded = expandedOrderIds.has(key);
                        return (
                          <div className="fl-order-card" key={`customer-order-${key}`}>
                            <button type="button" className="fl-order-card-head" onClick={() => toggleExpandedOrder(key)}>
                              <span><b>#{key}</b><small>{formatDateTime(order.createdAt)}</small></span>
                              <span><b>{formatMoneyVnd(orderTotal(order))}</b><small>{order.area} - {order.tableNo}</small></span>
                              <strong>{expanded ? '−' : '+'}</strong>
                            </button>
                            {expanded && (
                              <div className="fl-order-items">
                                {(Array.isArray(order.items) ? order.items : []).map((item, itemIndex) => (
                                  <div className="fl-order-item-row" key={`${key}-${itemIndex}`}>
                                    <b>{Number(item?.qty || 0)}×</b>
                                    <span>{item?.productCode || item?.code ? `${item?.productCode || item?.code} - ` : ''}{item?.name || item?.productName || item?.imageName || 'Món'}</span>
                                    <small>{formatMoneyVnd(item?.lineTotal ?? (Number(item?.price || 0) * Number(item?.qty || 0)))}</small>
                                    {item?.note && <em>Note: {item.note}</em>}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            )}

            {activeDetailTab === 'orders' && (
              <div className="fl-orders-tab">
                <div className="fl-section-title">
                  <div>
                    <h3>Orders tại máy {selected.machineNumber}</h3>
                  </div>
                  <button type="button" onClick={() => loadMachineOrders(selected.machineNumber, selected.area)}>↻</button>
                </div>

                {machineOrdersLoading ? (
                  <div className="fl-panel-message">Đang tải orders…</div>
                ) : machineOrdersError ? (
                  <div className="fl-panel-message is-error">{machineOrdersError}</div>
                ) : machineOrders.length === 0 ? (
                  <div className="fl-panel-message">Máy này chưa có order trong ca/ngày hiện tại.</div>
                ) : machineOrders.map((order) => {
                  const key = text(order.id);
                  const expanded = expandedOrderIds.has(key);
                  return (
                    <div className="fl-order-card" key={`machine-order-${key}`}>
                      <button type="button" className="fl-order-card-head" onClick={() => toggleExpandedOrder(key)}>
                        <span><b>Order #{key}</b><small>{formatDateTime(order.createdAt)}</small></span>
                        <span><b>{formatMoneyVnd(orderTotal(order))}</b><small>Staff: {order.staff || '—'}</small></span>
                        <strong>{expanded ? '−' : '+'}</strong>
                      </button>
                      <div className="fl-order-card-customer">
                        {order.memberCard ? `#${order.memberCard}` : 'No member'} {order.customerName ? `• ${order.customerName}` : ''}
                      </div>
                      {expanded && (
                        <div className="fl-order-items">
                          {(Array.isArray(order.items) ? order.items : []).map((item, itemIndex) => (
                            <div className="fl-order-item-row" key={`${key}-${itemIndex}`}>
                              <b>{Number(item?.qty || 0)}×</b>
                              <span>{item?.productCode || item?.code ? `${item?.productCode || item?.code} - ` : ''}{item?.name || item?.productName || item?.imageName || 'Món'}</span>
                              <small>{formatMoneyVnd(item?.lineTotal ?? (Number(item?.price || 0) * Number(item?.qty || 0)))}</small>
                              {item?.note && <em>Note: {item.note}</em>}
                            </div>
                          ))}
                          {order.note && <div className="fl-order-note">Order note: {order.note}</div>}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {activeDetailTab === 'cart' && (
              <div className="fl-cart-tab">
                <div className="fl-section-title">
                  <div>
                    <h3>Giỏ hàng máy {selected.machineNumber}</h3>
                    <small>Giỏ đang chọn, chưa gửi order</small>
                  </div>
                  <span className="fl-cart-count">{selectedCartCount} món</span>
                </div>

                <div className="fl-cart-toolbar">
                  {typeof onSelectTable === 'function' && (
                    <button type="button" className="primary" onClick={selectForOrder}>
                      + Mở Menu
                    </button>
                  )}
                  {typeof onAddOffMenu === 'function' && (
                    <button
                      type="button"
                      onClick={() => onAddOffMenu({
                        area: selected.area,
                        tableNo: selected.machineNumber,
                      })}
                    >
                      + Món ngoài menu
                    </button>
                  )}
                  {selectedCartRows.length > 0 && typeof onCartClear === 'function' && (
                    <button
                      type="button"
                      className="danger"
                      onClick={() => onCartClear({
                        area: selected.area,
                        tableNo: selected.machineNumber,
                      })}
                    >
                      Xóa giỏ
                    </button>
                  )}
                </div>

                {selectedCartRows.length === 0 ? (
                  <div className="fl-panel-message">Giỏ hàng của máy này đang trống.</div>
                ) : (
                  <>
                    <div className="fl-cart-list">
                      {selectedCartRows.map((row) => (
                        <div className="fl-cart-row fl-cart-row-editable" key={row.cartKey}>
                          <div className="fl-cart-item-main">
                            {row.imageUrl ? (
                              <img
                                src={/^https?:\/\//i.test(row.imageUrl)
                                  ? row.imageUrl
                                  : apiUrl(row.imageUrl.startsWith('/') ? row.imageUrl : `/${row.imageUrl}`)}
                                alt=""
                                loading="lazy"
                              />
                            ) : (
                              <span className="fl-cart-item-icon">{row.offMenu ? 'H100' : '🍽'}</span>
                            )}
                            <div>
                              {row.offMenu && typeof onCartUpdateItem === 'function' ? (
                                <input
                                  className="fl-cart-name-input"
                                  value={row.rawName}
                                  onChange={(event) => onCartUpdateItem({
                                    area: selected.area,
                                    tableNo: selected.machineNumber,
                                    cartKey: row.cartKey,
                                    patch: { name: event.target.value, isOffMenu: true },
                                  })}
                                  placeholder="Tên món ngoài menu..."
                                />
                              ) : (
                                <strong>{row.code ? `${row.code} - ` : ''}{row.name}</strong>
                              )}
                              <small>{row.price > 0 ? formatMoneyVnd(row.lineTotal) : 'Chưa có giá'}</small>
                            </div>
                          </div>

                          <div className="fl-cart-qty-controls">
                            <button
                              type="button"
                              disabled={typeof onCartSetQty !== 'function'}
                              onClick={() => onCartSetQty?.({
                                area: selected.area,
                                tableNo: selected.machineNumber,
                                cartKey: row.cartKey,
                                qty: Math.max(0, row.qty - 1),
                              })}
                            >
                              −
                            </button>
                            <b>{row.qty}</b>
                            <button
                              type="button"
                              disabled={typeof onCartSetQty !== 'function'}
                              onClick={() => onCartSetQty?.({
                                area: selected.area,
                                tableNo: selected.machineNumber,
                                cartKey: row.cartKey,
                                qty: row.qty + 1,
                              })}
                            >
                              +
                            </button>
                            <button
                              type="button"
                              className="remove"
                              disabled={typeof onCartSetQty !== 'function'}
                              onClick={() => onCartSetQty?.({
                                area: selected.area,
                                tableNo: selected.machineNumber,
                                cartKey: row.cartKey,
                                qty: 0,
                              })}
                            >
                              Xóa
                            </button>
                          </div>

                          {typeof onCartUpdateItem === 'function' && (
                            <input
                              className="fl-cart-note-input"
                              value={row.note}
                              onChange={(event) => onCartUpdateItem({
                                area: selected.area,
                                tableNo: selected.machineNumber,
                                cartKey: row.cartKey,
                                patch: { note: event.target.value },
                              })}
                              placeholder="Ghi chú món..."
                            />
                          )}
                        </div>
                      ))}
                    </div>

                    <div className="fl-cart-total">
                      <span>Tổng tạm tính</span>
                      <b>{selectedCartTotal > 0 ? formatMoneyVnd(selectedCartTotal) : 'Chưa đủ giá'}</b>
                    </div>

                    {typeof onCheckout === 'function' && (
                      <button
                        type="button"
                        className="fl-cart-checkout"
                        onClick={() => onCheckout({
                          area: selected.area,
                          tableNo: selected.machineNumber,
                          memberCode: isUnknownPlayer(selected) ? '' : text(selected.memberCode),
                          customerName: isUnknownPlayer(selected) ? '' : text(selected.customerName),
                        })}
                      >
                        Order giỏ hàng này
                      </button>
                    )}
                  </>
                )}
              </div>
            )}
          </aside>
        )}

      </section>

    </div>
  );
}
