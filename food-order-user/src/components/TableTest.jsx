// SAFE_CLEANUP_PHASE3B_20260913
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import axios from 'axios';
import './TableTest.css';

const text = (value) => String(value == null ? '' : value).trim();
const cleanCode = (value) => text(value).replace(/\s+/g, '');
const isDiningTableNo = (value) => /^bàn ăn\s*\d+$/i.test(text(value));
const tableKeyOf = (area, tableNo) => (area && tableNo ? `${area}#${tableNo}` : '');
const DINING_TABLE_NOTES = {
  'Roulette 1#Bàn ăn 1': 'Sau máy 112',
  'Roulette 1#Bàn ăn 2': 'Sau máy 106',
  'Multi#Bàn ăn 1': 'Kế bên Cashier 1',
};
const diningTableNoteOf = (area, tableNo) => DINING_TABLE_NOTES[`${text(area)}#${text(tableNo)}`] || '';

const isVerifiedPlaying = (machine) =>
  Boolean(machine?.checkState === 'ok' && machine?.online !== false && machine?.isPlaying);

const isMachineUncertain = (machine) =>
  machine?.checkState === 'unknown' ||
  machine?.checkState === 'pending' ||
  machine?.checkState === 'stale' ||
  machine?.online === false;

const isUnknownPlayer = (machine) =>
  Boolean(isVerifiedPlaying(machine) && (machine?.unknownPlayer || !cleanCode(machine?.memberCode)));

const hasOrdered = (machine) =>
  Boolean(isVerifiedPlaying(machine) && (machine?.orderStatus === 'ORDERED' || machine?.hasOrdered === true));

const tileTone = (machine) => {
  if (isVerifiedPlaying(machine)) return hasOrdered(machine) ? 'ordered' : 'not-ordered';
  if (isMachineUncertain(machine)) return 'uncertain';
  return 'empty';
};

function floorlensWallClockParts(value) {
  const raw = text(value);
  if (!raw) return null;
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

const pad2 = (n) => String(n).padStart(2, '0');

function formatFloorlensShortTime(value) {
  const parts = floorlensWallClockParts(value);
  if (!parts) return text(value) || '—';
  return `${pad2(parts.hour)}:${pad2(parts.minute)}`;
}

function formatFloorlensClock(value) {
  const parts = floorlensWallClockParts(value);
  if (!parts) return text(value) || '—';
  return `${pad2(parts.hour)}:${pad2(parts.minute)}:${pad2(parts.second)}`;
}

function formatFloorlensDateTime(value) {
  const parts = floorlensWallClockParts(value);
  if (!parts) return text(value) || '—';
  return `${pad2(parts.hour)}:${pad2(parts.minute)}:${pad2(parts.second)} ${pad2(parts.day)}/${pad2(parts.month)}/${parts.year}`;
}

function formatOrderDateTime(value) {
  const d = new Date(value || 0);
  if (Number.isNaN(d.getTime())) return '—';
  let h = d.getHours();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h %= 12;
  if (h === 0) h = 12;
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()} ${pad2(h)}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())} ${ampm}`;
}

function currentBusinessWindow() {
  const now = new Date();
  const start = new Date(now);
  start.setHours(6, 0, 0, 0);
  if (now < start) start.setDate(start.getDate() - 1);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);
  return { start, end };
}

function inCurrentBusinessDay(value) {
  const t = Date.parse(value || '');
  if (!Number.isFinite(t)) return false;
  const { start, end } = currentBusinessWindow();
  return t >= start.getTime() && t <= end.getTime();
}

const imageNameOf = (value) => {
  const raw = text(value).split(/[?#]/)[0];
  const last = raw.split('/').pop() || '';
  try { return decodeURIComponent(last).toLowerCase(); } catch { return last.toLowerCase(); }
};

function resolveOrderItem(item = {}, foodByImage = new Map(), apiUrl = (path) => path) {
  const imageKey = imageNameOf(item?.imageUrl || item?.imageName || item?.imageKey || '');
  const food = imageKey ? foodByImage.get(imageKey) : null;
  const directCode = text(item?.productCode || item?.code);
  const offMenu = Boolean(item?.isOffMenu) || directCode.toUpperCase() === 'H100';

  const code = directCode || text(food?.productCode || food?.code) || (offMenu ? 'H100' : '');
  const name = text(
    item?.name ||
    item?.productName ||
    food?.productName ||
    food?.name ||
    (offMenu ? 'OFF MENU' : '') ||
    imageKey ||
    'Món'
  );

  const rawImage = offMenu ? '' : text(food?.imageUrl || item?.imageUrl);
  let imageUrl = '';
  if (rawImage) {
    if (/^https?:\/\//i.test(rawImage)) imageUrl = rawImage;
    else imageUrl = apiUrl(rawImage.startsWith('/') ? rawImage : `/${rawImage}`);
  }

  return { code, name, imageUrl };
}

function money(value) {
  const n = Number(value || 0);
  return `${Math.round(Number.isFinite(n) ? n : 0).toLocaleString('vi-VN')} VND`;
}

function orderTotal(order = {}) {
  if (Number.isFinite(Number(order?.total))) return Number(order.total);
  return (Array.isArray(order?.items) ? order.items : []).reduce(
    (sum, item) => sum + (Number(item?.price || 0) * Number(item?.qty || item?.quantity || 0)),
    0
  );
}

const FLOORLENS_STATION_LABELS = {
  TECH: 'Tech', PIT14: 'PIT 14', PIT15: 'PIT 15', PIT33: 'PIT 33', PIT2F: 'PIT 2F',
  RECEPTION1: 'Reception 1', RECEPTION2: 'Reception 2', BC1: 'BC1', BC2: 'BC2', CENTER3022: 'Center', CENTER: 'Center', KITCHEN: 'Kitchen', KITCHENIPAD: 'Kitchen',
};

const MAP_DEVICE_STATIONS = [
  // Vị trí theo sơ đồ user note ngày 30/08/2026. x/y là tỉ lệ trên ảnh map.
  { code: 'TECH', label: 'Tech', device: 'PC', x: 0.045, y: 0.075 },
  { code: 'PIT14', label: 'PIT 14', device: 'IPAD', x: 0.285, y: 0.215 },
  { code: 'BC1', label: 'BC1', device: 'IPAD', x: 0.472, y: 0.055 },
  { code: 'PIT15', label: 'PIT 15', device: 'IPAD', x: 0.545, y: 0.335 },
  { code: 'BC2', label: 'BC2', device: 'IPAD', x: 0.458, y: 0.545 },
  { code: 'KITCHEN', label: 'Kitchen', device: 'PC', x: 0.070, y: 0.825, targetOnly: true },
  { code: 'KITCHENIPAD', label: 'Kitchen', device: 'IPAD', x: 0.125, y: 0.810 },
  { code: 'RECEPTION1', label: 'Reception 1', device: 'IPAD', x: 0.165, y: 0.815 },
  { code: 'RECEPTION2', label: 'Reception 2', device: 'IPAD', x: 0.365, y: 0.845 },
  { code: 'PIT33', label: 'PIT 33', device: 'IPAD', x: 0.555, y: 0.765 },
  { code: 'CENTER3022', label: 'Center', device: 'IPAD', x: 0.705, y: 0.840 },
  { code: 'PIT2F', label: 'PIT 2F', device: 'IPAD', x: 0.905, y: 0.665 },
];

const ASSIGNABLE_DEVICE_STATIONS = MAP_DEVICE_STATIONS.filter((station) => !station.targetOnly);
const FLOORLENS_ORDER_STATION_STORAGE_KEY = 'food.floorlensOrderStation';

function stationLabel(value) {
  const raw = text(value).toUpperCase().replace(/[\s_-]+/g, '');
  return FLOORLENS_STATION_LABELS[raw] || text(value);
}

function normalizeDeviceStation(value) {
  const raw = text(value).toUpperCase().replace(/[\s_-]+/g, '');
  const alias = raw === 'CENTER' ? 'CENTER3022' : raw;
  return ASSIGNABLE_DEVICE_STATIONS.some((station) => station.code === alias) ? alias : '';
}

function CustomerAvatar({ apiUrl, machine, size = 48 }) {
  const code = cleanCode(machine?.memberCode);
  const unknown = isUnknownPlayer(machine);
  const [failed, setFailed] = useState(false);

  useEffect(() => setFailed(false), [code]);

  if (!isVerifiedPlaying(machine)) return <div className="tt-avatar tt-avatar-empty" style={{ width: size, height: size }} />;
  if (unknown) return <div className="tt-avatar tt-avatar-unknown" style={{ width: size, height: size }}>?</div>;

  const name = text(machine?.customerName);
  const initial = (name || code || '?').charAt(0).toUpperCase();
  if (!code || failed) {
    return <div className="tt-avatar tt-avatar-fallback" style={{ width: size, height: size }}>{initial}</div>;
  }

  return (
    <img
      className="tt-avatar"
      src={apiUrl(`/api/user/floorlens/avatar/${encodeURIComponent(code)}`)}
      alt=""
      style={{ width: size, height: size }}
      onError={() => setFailed(true)}
    />
  );
}

function MiniActivityAvatar({ apiUrl, event, onClick }) {
  const code = cleanCode(event?.memberCode);
  const unknown = Boolean(event?.unknownPlayer || !code);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [code]);
  return (
    <button type="button" className="tt-activity-avatar" onClick={onClick} title={`Máy ${event?.machineNumber || '—'} • ${event?.customerName || (unknown ? 'Unknown' : code)}`}>
      <span className={unknown ? 'is-unknown' : ''}>{unknown ? '?' : (text(event?.customerName) || code || '?').charAt(0).toUpperCase()}</span>
      {!unknown && code && !failed && (
        <img
          src={apiUrl(`/api/user/floorlens/avatar/${encodeURIComponent(code)}`)}
          alt=""
          onError={() => setFailed(true)}
        />
      )}
      <small>{event?.machineNumber || '—'}</small>
    </button>
  );
}

function Metric({ label, value, hint, active, tone = '', onClick }) {
  return (
    <button type="button" className={`tt-metric ${tone ? `tone-${tone}` : ''} ${active ? 'is-active' : ''}`} onClick={onClick}>
      <b>{value}</b>
      <span>{label}</span>
      {hint && <small>{hint}</small>}
    </button>
  );
}

function ActivityMetric({ apiUrl, label, events, tone, active, onClick, onAvatarClick }) {
  return (
    <div className={`tt-activity-metric tone-${tone} ${active ? 'is-active' : ''}`}>
      <button type="button" className="tt-activity-main" onClick={onClick}>
        <span>{label}</span>
      </button>

      <div className="tt-activity-avatars">
        {(events || []).slice(0, 6).map((event) => (
          <MiniActivityAvatar
            key={event.id}
            apiUrl={apiUrl}
            event={event}
            onClick={(clickEvent) => {
              clickEvent?.stopPropagation?.();
              onAvatarClick?.(event);
            }}
          />
        ))}
      </div>
    </div>
  );
}

function ActivityHistoryPanel({ apiUrl, kind, events = [], onClose, onSelectMachine }) {
  const title = kind === 'LEAVE' ? 'Lịch sử khách ra' : 'Lịch sử khách vào';
  return (
    <section className={`tt-activity-history-panel tone-${kind === 'LEAVE' ? 'leave' : 'enter'}`}>
      <div className="tt-activity-history-head">
        <div>
          <b>{title}</b>
          <small>Mới nhất ở trên • tối đa 102 khách</small>
        </div>
        <button type="button" onClick={onClose}>×</button>
      </div>
      {events.length === 0 ? (
        <div className="tt-panel-order-empty">Chưa có sự kiện.</div>
      ) : (
        <div className="tt-activity-history-list">
          {events.map((event) => (
            <div className="tt-activity-history-row" key={event.id}>
              <MiniActivityAvatar apiUrl={apiUrl} event={event} onClick={() => onSelectMachine?.(event.machineNumber)} />
              <div>
                <b>{event.customerName || (event.unknownPlayer ? 'Unknown Player' : `#${event.memberCode || '—'}`)}</b>
                <span>Máy {event.machineNumber || '—'} • {event.area || '—'}</span>
                <small>{formatFloorlensDateTime(event.occurredAt || event.startedAt || event.endedAt)}</small>
              </div>
              <button type="button" onClick={() => onSelectMachine?.(event.machineNumber)}>Mở máy</button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function CustomerProfileModal({ apiUrl, code, machine, profile, loading, error, onClose }) {
  if (!code) return null;
  const member = profile?.member || {};
  const orders = (Array.isArray(profile?.orders) ? profile.orders : []).filter((order) => inCurrentBusinessDay(order?.createdAt));
  const total = orders.reduce((sum, order) => sum + orderTotal(order), 0);
  const content = (
    <div className="tt-customer-profile-backdrop" onMouseDown={onClose}>
      <section className="tt-customer-profile-modal" onMouseDown={(event) => event.stopPropagation()}>
        <div className="tt-customer-profile-modal-head">
          <div><small>Insights • Profile khách</small><h2>{member?.name || machine?.customerName || `Member ${code}`}</h2></div>
          <button type="button" onClick={onClose}>×</button>
        </div>
        {loading ? <div className="tt-profile-modal-message">Đang tải profile…</div> : error ? <div className="tt-profile-modal-message is-error">{error}</div> : (
          <div className="tt-customer-profile-modal-body">
            <div className="tt-customer-profile-summary">
              <CustomerAvatar
                apiUrl={apiUrl}
                machine={{ ...machine, memberCode: code, customerName: member?.name || machine?.customerName, isPlaying: true, online: true, checkState: 'ok' }}
                size={100}
              />
              <div>
                <h3>{member?.name || machine?.customerName || `Member ${code}`}</h3>
                <b>#{member?.code || code}</b>
                <span className="tt-profile-level">{member?.level || member?.membershipType || '—'}</span>
              </div>
            </div>
            <div className="tt-customer-profile-facts-grid">
              <div><span>Since</span><b>{machine?.startedAt ? formatFloorlensDateTime(machine.startedAt) : '—'}</b></div>
              <div><span>DOB</span><b>{formatProfileDate(member?.dateOfBirth)}</b></div>
              <div><span>Registered</span><b>{formatProfileDate(member?.registeredAt)}</b></div>
              <div><span>Orders hôm nay</span><b>{orders.length}</b></div>
              <div><span>Tổng hôm nay</span><b>{money(total)}</b></div>
              <div><span>Máy hiện tại</span><b>{machine?.machineNumber || '—'}</b></div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
  return typeof document !== 'undefined' ? ReactDOM.createPortal(content, document.body) : content;
}

function formatProfileDate(value) {
  const raw = text(value);
  if (!raw) return '—';
  const d = new Date(raw);
  if (!Number.isNaN(d.getTime())) {
    return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }
  return raw;
}

function metricMachineMatch(machine, key, activityMachineSet) {
  if (key === 'ALL') return true;
  if (key === 'PLAYING') return isVerifiedPlaying(machine);
  if (key === 'EMPTY') return !isMachineUncertain(machine) && !isVerifiedPlaying(machine);
  if (key === 'ORDERED') return isVerifiedPlaying(machine) && hasOrdered(machine);
  if (key === 'NOT_ORDERED') return isVerifiedPlaying(machine) && !isUnknownPlayer(machine) && !hasOrdered(machine);
  if (key === 'UNKNOWN') return isUnknownPlayer(machine);
  if (key === 'ENTER' || key === 'LEAVE') return activityMachineSet?.has(text(machine?.machineNumber));
  return true;
}

function FloorMapMetricModal({
  apiUrl,
  layout,
  layoutLoading,
  layoutError,
  title,
  metricKey,
  machines,
  snapshot,
  pulseByMachine = {},
  stationHighlights = {},
  onClose,
  onSelectMachine,
}) {
  const FILTERS = [
    ['ALL', 'Tổng máy'],
    ['PLAYING', 'Khách hiện tại'],
    ['EMPTY', 'Máy trống'],
    ['ORDERED', 'Đã order'],
    ['NOT_ORDERED', 'Chưa order'],
    ['UNKNOWN', 'Chưa có member'],
  ];
  const [activeKey, setActiveKey] = useState(metricKey || 'ALL');
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(1);
  const panRef = useRef({ x: 0, y: 0 });
  const dragRef = useRef(null);
  const pinchRef = useRef(null);
  const mapViewportRef = useRef(null);
  const transformLayerRef = useRef(null);
  const rafRef = useRef(null);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [assignedStation, setAssignedStation] = useState(() => {
    try { return normalizeDeviceStation(localStorage.getItem(FLOORLENS_ORDER_STATION_STORAGE_KEY)); }
    catch { return ''; }
  });

  useEffect(() => setActiveKey(metricKey || 'ALL'), [metricKey]);
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, []);

  useEffect(() => {
    const node = mapViewportRef.current;
    if (!node) return undefined;
    const update = () => setViewportSize({ width: node.clientWidth || 0, height: node.clientHeight || 0 });
    update();
    if (typeof ResizeObserver === 'function') {
      const ro = new ResizeObserver(update);
      ro.observe(node);
      return () => ro.disconnect();
    }
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [layout, layoutLoading]);

  const setDeviceStation = (value) => {
    const normalized = normalizeDeviceStation(value);
    setAssignedStation(normalized);
    try {
      if (normalized) localStorage.setItem(FLOORLENS_ORDER_STATION_STORAGE_KEY, normalized);
      else localStorage.removeItem(FLOORLENS_ORDER_STATION_STORAGE_KEY);
    } catch {}
  };

  const machineByNumber = useMemo(() => {
    const map = new Map();
    for (const machine of Array.isArray(machines) ? machines : []) {
      const n = text(machine?.machineNumber);
      if (n) map.set(n, machine);
    }
    return map;
  }, [machines]);

  const matchingMachines = useMemo(
    () => (Array.isArray(machines) ? machines : []).filter((machine) => metricMachineMatch(machine, activeKey, null)),
    [machines, activeKey]
  );

  const counts = useMemo(() => ({
    ALL: Number(snapshot?.totalMachines ?? machines?.length ?? 0),
    PLAYING: Number(snapshot?.playingCount ?? (Array.isArray(machines) ? machines.filter(isVerifiedPlaying).length : 0)),
    EMPTY: Number(snapshot?.availableCount ?? snapshot?.idleCount ?? (Array.isArray(machines) ? machines.filter((m) => !isMachineUncertain(m) && !isVerifiedPlaying(m)).length : 0)),
    ORDERED: Number(snapshot?.orderedCount ?? (Array.isArray(machines) ? machines.filter((m) => isVerifiedPlaying(m) && hasOrdered(m)).length : 0)),
    NOT_ORDERED: Number(snapshot?.notOrderedCount ?? (Array.isArray(machines) ? machines.filter((m) => isVerifiedPlaying(m) && !isUnknownPlayer(m) && !hasOrdered(m)).length : 0)),
    UNKNOWN: Number(snapshot?.unknownCount ?? (Array.isArray(machines) ? machines.filter(isUnknownPlayer).length : 0)),
  }), [snapshot, machines]);

  const mapWidth = Math.max(1, Number(layout?.map?.imageWidth || layout?.map?.image_width || 0));
  const mapHeight = Math.max(1, Number(layout?.map?.imageHeight || layout?.map?.image_height || 0));
  const layoutMachines = useMemo(
    () => (Array.isArray(layout?.machines) ? layout.machines : []),
    [layout?.machines]
  );

  // Avatar trên FloorLens Map:
  // - Các dãy đã được xác nhận trực tiếp từ sơ đồ thực tế dùng vị trí cố định.
  // - Những máy còn lại mới dùng auto-detect để tránh che nhau nếu layout thay đổi nhẹ.
  const markerAvatarPositionByNumber = useMemo(() => {
    const rangeSet = (from, to) => new Set(Array.from({ length: to - from + 1 }, (_, index) => String(from + index)));
    const mergeSets = (...sets) => new Set(sets.flatMap((set) => Array.from(set)));

    const forcedLeft = mergeSets(
      rangeSet(7005, 7008),
      rangeSet(1001, 1004),
      rangeSet(1013, 1016),
      rangeSet(3004, 3006),
      new Set(['1023', '1024']),
      rangeSet(3022, 3027)
    );

    const forcedBottom = rangeSet(501, 510);

    const twoFloorAll = new Set([
      '1021', '3013',
      '2001', '2002', '2003', '2004', '2005', '2006',
      '2008', '2009', '2010', '2011', '2012', '2013', '2014',
      '2016', '2018',
      '2021', '2022', '2023', '2024', '2025', '2026', '2027', '2028',
      '8007', '8008', '8009',
    ]);
    const twoFloorTop = new Set([
      '2023', '2022', '2021', '1021', '2014', '2013',
      '2028', '2027', '3013', '2008', '8007', '8008', '8009',
      '2002', '2003', '2004',
    ]);

    const points = layoutMachines.map((layoutMachine) => {
      const number = text(layoutMachine?.machine_number ?? layoutMachine?.machineNumber ?? layoutMachine?.Number ?? layoutMachine?.number);
      const transform = layoutMachine?.transform || {};
      if (!number || transform.visible === false) return null;
      const rawW = Math.max(8, Number(transform.width || 40));
      const rawH = Math.max(8, Number(transform.height || 40));
      return {
        number,
        x: Number(transform.positionX || 0) + rawW / 2,
        y: Number(transform.positionY || 0) + rawH / 2,
      };
    }).filter(Boolean);

    const result = new Map();
    for (const point of points) {
      if (forcedLeft.has(point.number)) {
        result.set(point.number, 'left');
        continue;
      }
      if (forcedBottom.has(point.number)) {
        result.set(point.number, 'bottom');
        continue;
      }
      if (twoFloorAll.has(point.number)) {
        result.set(point.number, twoFloorTop.has(point.number) ? 'top' : 'bottom');
        continue;
      }

      const nearby = points
        .filter((other) => other.number !== point.number)
        .map((other) => {
          const dx = Math.abs(other.x - point.x);
          const dy = Math.abs(other.y - point.y);
          return { dx, dy, distance: Math.hypot(dx, dy) };
        })
        .sort((a, b) => a.distance - b.distance)
        .slice(0, 4);

      let verticalScore = 0;
      let horizontalScore = 0;
      nearby.forEach(({ dx, dy, distance }) => {
        if (!Number.isFinite(distance) || distance <= 0) return;
        const weight = 1 / Math.max(1, distance);
        if (dy > dx * 1.35) verticalScore += weight;
        else if (dx > dy * 1.35) horizontalScore += weight;
      });
      result.set(point.number, verticalScore > horizontalScore ? 'right' : 'top');
    }
    return result;
  }, [layoutMachines]);

  const activeLabel = FILTERS.find(([key]) => key === activeKey)?.[1] || title || 'FloorLens Realtime';

  // Render map theo kích thước ảnh gốc rồi scale xuống để fit viewport.
  // Khi zoom lên, browser dùng lại raster gốc thay vì phóng một layer đã bị thu nhỏ => nét hơn nhiều.
  const fitScale = useMemo(() => {
    if (!mapWidth || !mapHeight || !viewportSize.width || !viewportSize.height) return 1;
    return Math.min(
      Math.max(0.05, (viewportSize.width - 12) / mapWidth),
      Math.max(0.05, (viewportSize.height - 12) / mapHeight)
    );
  }, [mapWidth, mapHeight, viewportSize.width, viewportSize.height]);

  const openMachine = (number) => {
    if (!number) return;
    onSelectMachine?.(number);
    onClose?.();
  };

  const clampZoom = (value) => Math.max(0.75, Math.min(4, Math.round(value * 100) / 100));

  const applyMapTransform = useCallback((nextZoom = zoomRef.current, nextPan = panRef.current) => {
    zoomRef.current = clampZoom(nextZoom);
    panRef.current = { x: Number(nextPan?.x || 0), y: Number(nextPan?.y || 0) };
    const node = transformLayerRef.current;
    if (!node) return;
    const effectiveScale = fitScale * zoomRef.current;
    const markerInverseScale = Math.min(2.6, Math.max(1, 0.88 / Math.max(0.08, effectiveScale)));
    node.style.setProperty('--tt-marker-inverse-scale', String(markerInverseScale));
    const transform = `translate3d(${panRef.current.x}px, ${panRef.current.y}px, 0) scale(${effectiveScale})`;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      if (transformLayerRef.current) transformLayerRef.current.style.transform = transform;
    });
  }, [fitScale]);

  useEffect(() => {
    applyMapTransform(zoomRef.current, panRef.current);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [applyMapTransform]);

  const resetMap = () => {
    zoomRef.current = 1;
    panRef.current = { x: 0, y: 0 };
    setZoom(1);
    applyMapTransform(1, { x: 0, y: 0 });
  };
  const changeZoom = (delta) => {
    const next = clampZoom(zoomRef.current + delta);
    setZoom(next);
    applyMapTransform(next, panRef.current);
  };

  const handleWheel = (event) => {
    event.preventDefault();
    const direction = event.deltaY > 0 ? -0.12 : 0.12;
    const next = clampZoom(zoomRef.current + direction);
    setZoom(next);
    applyMapTransform(next, panRef.current);
  };

  const handlePointerDown = (event) => {
    if (event.pointerType === 'touch') return;
    if (event.target?.closest?.('button,select,label')) return;
    dragRef.current = { x: event.clientX, y: event.clientY, pan: { ...panRef.current } };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const handlePointerMove = (event) => {
    if (!dragRef.current) return;
    applyMapTransform(zoomRef.current, {
      x: dragRef.current.pan.x + (event.clientX - dragRef.current.x),
      y: dragRef.current.pan.y + (event.clientY - dragRef.current.y),
    });
  };
  const handlePointerUp = (event) => {
    dragRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  };

  const touchDistance = (touches) => {
    if (!touches || touches.length < 2) return 0;
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  };
  const touchCenter = (touches) => {
    if (!touches || touches.length < 2) return null;
    return { x: (touches[0].clientX + touches[1].clientX) / 2, y: (touches[0].clientY + touches[1].clientY) / 2 };
  };
  const handleTouchStart = (event) => {
    if (event.touches.length === 2) {
      event.preventDefault();
      pinchRef.current = {
        distance: touchDistance(event.touches),
        zoom: zoomRef.current,
        center: touchCenter(event.touches),
        pan: { ...panRef.current },
      };
    } else if (event.touches.length === 1 && !event.target?.closest?.('button')) {
      const t = event.touches[0];
      dragRef.current = { x: t.clientX, y: t.clientY, pan: { ...panRef.current }, touch: true };
    }
  };
  const handleTouchMove = (event) => {
    if (event.touches.length === 2 && pinchRef.current) {
      event.preventDefault();
      const distance = touchDistance(event.touches);
      if (!distance || !pinchRef.current.distance) return;
      const nextZoom = clampZoom(pinchRef.current.zoom * (distance / pinchRef.current.distance));
      const center = touchCenter(event.touches);
      const dx = center && pinchRef.current.center ? center.x - pinchRef.current.center.x : 0;
      const dy = center && pinchRef.current.center ? center.y - pinchRef.current.center.y : 0;
      applyMapTransform(nextZoom, { x: pinchRef.current.pan.x + dx, y: pinchRef.current.pan.y + dy });
    } else if (event.touches.length === 1 && dragRef.current?.touch) {
      event.preventDefault();
      const t = event.touches[0];
      applyMapTransform(zoomRef.current, {
        x: dragRef.current.pan.x + (t.clientX - dragRef.current.x),
        y: dragRef.current.pan.y + (t.clientY - dragRef.current.y),
      });
    }
  };
  const handleTouchEnd = () => {
    pinchRef.current = null;
    dragRef.current = null;
    setZoom(zoomRef.current);
  };

  const content = (
    <div className="tt-map-modal-backdrop" onMouseDown={onClose}>
      <div className="tt-map-modal tt-map-modal-full" onMouseDown={(event) => event.stopPropagation()}>
        <div className="tt-map-modal-head">
          <div>
            <small>FloorLens Realtime</small>
            <h2>{activeLabel} • {counts[activeKey] ?? matchingMachines.length}</h2>
          </div>
          <div className="tt-map-head-tools">
            <label className="tt-device-assignment">
              <span>Gán thiết bị</span>
              <select value={assignedStation} onChange={(event) => setDeviceStation(event.target.value)}>
                <option value="">Chưa gán</option>
                {ASSIGNABLE_DEVICE_STATIONS.map((station) => (
                  <option key={station.code} value={station.code}>
                    {station.device === 'PC' ? 'PC' : 'iPad'}: {station.label}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="tt-map-close" onClick={onClose}>×</button>
          </div>
        </div>

        <div className="tt-map-filter-bar">
          <div className="tt-map-filter-buttons">
            {FILTERS.map(([key, label]) => (
              <button type="button" key={key} className={activeKey === key ? 'active' : ''} onClick={() => setActiveKey(key)}>
                <span>{label}</span><b>{counts[key] ?? 0}</b>
              </button>
            ))}
          </div>
          <div className="tt-map-zoom-tools">
            <button type="button" onClick={() => changeZoom(-0.15)} aria-label="Thu nhỏ map">−</button>
            <span>{Math.round(zoom * 100)}%</span>
            <button type="button" onClick={() => changeZoom(0.15)} aria-label="Phóng to map">+</button>
            <button type="button" className="fit" onClick={resetMap}>Vừa khung</button>
          </div>
        </div>

        <div className="tt-map-modal-body tt-map-modal-body-full">
          <div
            ref={mapViewportRef}
            className="tt-map-board-wrap tt-map-interactive-viewport"
            onWheel={handleWheel}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
          >
            {layoutLoading ? (
              <div className="tt-map-message">Đang tải sơ đồ FloorLens…</div>
            ) : layoutError ? (
              <div className="tt-map-message is-error">{layoutError}</div>
            ) : layout && mapWidth > 1 && mapHeight > 1 ? (
              <div
                ref={transformLayerRef}
                className="tt-map-transform-layer"
                style={{
                  width: `${mapWidth}px`,
                  height: `${mapHeight}px`,
                  transform: `translate3d(0px, 0px, 0) scale(${fitScale * zoom})`,
                  '--tt-marker-inverse-scale': String(Math.min(2.6, Math.max(1, 0.88 / Math.max(0.08, fitScale * zoom)))),
                }}
              >
                <div
                  className="tt-map-board"
                  style={{
                    width: `${mapWidth}px`,
                    height: `${mapHeight}px`,
                    aspectRatio: `${mapWidth} / ${mapHeight}`,
                    backgroundColor: layout?.map?.backgroundColor || '#fff',
                  }}
                >
                  <img
                    className="tt-map-floor-image"
                    src={apiUrl('/api/user/floorlens/map-image')}
                    alt="FloorLens map"
                    draggable="false"
                    decoding="async"
                  />
                  {layoutMachines.map((layoutMachine, index) => {
                    const number = text(layoutMachine?.machine_number ?? layoutMachine?.machineNumber ?? layoutMachine?.Number ?? layoutMachine?.number);
                    if (!number) return null;
                    const transform = layoutMachine?.transform || {};
                    if (transform.visible === false) return null;
                    const machine = machineByNumber.get(number) || { machineNumber: number };
                    const matched = metricMachineMatch(machine, activeKey, null);
                    const rawW = Math.max(8, Number(transform.width || 40));
                    const rawH = Math.max(8, Number(transform.height || 40));
                    const cx = Number(transform.positionX || 0) + rawW / 2;
                    const cy = Number(transform.positionY || 0) + rawH / 2;
                    const leftPct = Math.max(1.2, Math.min(98.8, (cx / mapWidth) * 100));
                    const topPct = Math.max(1.5, Math.min(98.5, (cy / mapHeight) * 100));
                    const tone = tileTone(machine);
                    const pulse = pulseByMachine?.[number] || '';
                    const markerAvatarPosition = markerAvatarPositionByNumber.get(number) || 'top';
                    return (
                      <button
                        type="button"
                        key={`${number}-${index}`}
                        className={`tt-map-marker tone-${tone} avatar-${markerAvatarPosition} ${matched ? 'is-hit' : 'is-muted'} ${pulse === 'ENTER' ? 'is-enter' : ''} ${pulse === 'LEAVE' ? 'is-leave' : ''}`}
                        style={{ left: `${leftPct}%`, top: `${topPct}%` }}
                        title={`Máy ${number} • ${text(machine?.customerName) || (isVerifiedPlaying(machine) ? 'Có khách' : 'Trống')}`}
                        onClick={(event) => { event.stopPropagation(); if (matched) openMachine(number); }}
                      >
                        {isVerifiedPlaying(machine) && (
                          <span className="tt-map-marker-avatar"><CustomerAvatar apiUrl={apiUrl} machine={machine} size={16} /></span>
                        )}
                        <span className="tt-map-marker-number">{number}</span>
                      </button>
                    );
                  })}

                  {MAP_DEVICE_STATIONS.map((station) => {
                    const active = stationHighlights?.[station.code];
                    const selectedDevice = assignedStation === station.code;
                    return (
                      <div
                        key={`device-${station.code}`}
                        className={`tt-map-device ${station.device === 'PC' ? 'is-pc' : 'is-ipad'} ${active ? 'is-active' : ''} ${active?.role === 'source' ? 'is-source-active' : ''} ${active?.role === 'target' ? 'is-target-active' : ''} ${selectedDevice ? 'is-assigned' : ''}`}
                        style={{ left: `${station.x * 100}%`, top: `${station.y * 100}%` }}
                        title={active ? `${station.label} • ${active.role === 'target' ? 'Nhận order' : 'Gửi order'}${active.orderId ? ` • Order #${active.orderId}` : ''}` : `${station.device === 'PC' ? 'PC' : 'iPad'} • ${station.label}`}
                      >
                        <span className="tt-map-device-icon">{station.device === 'PC' ? 'PC' : '▯'}</span>
                        <span className="tt-map-device-label">{station.label}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="tt-map-message">Không có layout FloorLens.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  return typeof document !== 'undefined' ? ReactDOM.createPortal(content, document.body) : content;
}

function DetailedOrderCard({ order, foodByImage, apiUrl, staffMap = {}, allowDone = false, onDone, compact = false }) {
  const [expanded, setExpanded] = useState(!compact);
  const cardRef = useRef(null);
  const toggleExpanded = useCallback(() => {
    setExpanded((prev) => {
      const next = !prev;
      if (next) {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            const card = cardRef.current;
            if (!card) return;
            const scrollBox = card.closest?.('.tt-panel-scroll');
            if (scrollBox) {
              const cardTop = card.offsetTop;
              const cardBottom = cardTop + card.offsetHeight;
              const visibleTop = scrollBox.scrollTop;
              const visibleBottom = visibleTop + scrollBox.clientHeight;
              if (cardTop < visibleTop || cardBottom > visibleBottom) {
                scrollBox.scrollTo?.({ top: Math.max(0, cardTop - 8), behavior: 'smooth' });
              }
            } else {
              card.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
            }
          });
        });
      }
      return next;
    });
  }, []);
  const status = text(order?.status || '');
  const customerName = text(order?.customerName || (order?.customer && typeof order.customer === 'object' ? order.customer.name : ''));
  const customerCode = text(order?.memberCard || order?.customer?.code || '');
  const staffCode = cleanCode(order?.staff);
  const staffDisplay = staffCode ? `${staffCode}${staffMap?.[staffCode] ? ` - ${staffMap[staffCode]}` : ''}` : '—';
  const items = Array.isArray(order?.items) ? order.items : [];

  return (
    <article ref={cardRef} className={`tt-detailed-order ${compact ? 'is-compact' : ''} ${expanded ? 'is-expanded' : ''}`}>
      <div
        className={`tt-detailed-order-head ${compact ? 'is-clickable' : ''}`}
        role={compact ? 'button' : undefined}
        tabIndex={compact ? 0 : undefined}
        onClick={compact ? toggleExpanded : undefined}
        onKeyDown={compact ? (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            toggleExpanded();
          }
        } : undefined}
      >
        <div>
          <div className="tt-detailed-order-title">
            <b>Order #{order?.id}</b>
            <small>{formatOrderDateTime(order?.createdAt)}</small>
          </div>
          <div className="tt-detailed-order-meta">
            <span>Staff: <b>{staffDisplay}</b></span>
            <span>Customer: <b>{customerCode ? `${customerCode}${customerName ? ` - ${customerName}` : ''}` : (customerName || '—')}</b></span>
            {order?.sourceStation && <span>iPad: <b>{stationLabel(order.sourceStation)}</b></span>}
            {order?.area && order?.tableNo && <span>Máy: <b>{order.area} - {order.tableNo}</b></span>}
          </div>
        </div>
        <div className="tt-detailed-order-head-right">
          <span className={`tt-order-status status-${status.toLowerCase()}`}>{status || '—'}</span>
          {compact && (
            <button
              type="button"
              className="tt-order-expand-mark"
              aria-label={expanded ? 'Thu gọn order' : 'Xem chi tiết order'}
              onClick={(event) => { event.stopPropagation(); toggleExpanded(); }}
            >
              {expanded ? '−' : '+'}
            </button>
          )}
        </div>
      </div>

      {(!compact || expanded) && <div className="tt-detailed-order-items">
        {items.map((item, index) => {
          const meta = resolveOrderItem(item, foodByImage, apiUrl);
          const qty = Math.max(1, Number(item?.qty || item?.quantity || 1));
          const lineTotal = Number(item?.lineTotal ?? (Number(item?.price || 0) * qty));
          return (
            <div className="tt-detailed-order-item" key={`${order?.id}-${index}`}>
              <div className="tt-detailed-order-item-main">
                {meta.imageUrl ? <img src={meta.imageUrl} alt="" loading="lazy" decoding="async" /> : <div className="tt-order-image-placeholder" />}
                <div>
                  <b>{meta.code ? `[${meta.code}] ` : ''}{meta.name}</b>
                  {item?.note && <small>📝 {item.note}</small>}
                </div>
              </div>
              <div className="tt-detailed-order-item-right">
                <strong>x{qty}</strong>
                {Number.isFinite(lineTotal) && lineTotal > 0 && <small>{money(lineTotal)}</small>}
              </div>
            </div>
          );
        })}
      </div>}

      {(!compact || expanded) && order?.note && <div className="tt-order-note">📝 {order.note}</div>}
      {(!compact || expanded) && (order?.cancelReason || order?.reason) && <div className="tt-order-cancel">❌ Lý do huỷ: <b>{order.cancelReason || order.reason}</b></div>}

      {(!compact || expanded) && <div className="tt-detailed-order-footer">
        <b>{money(orderTotal(order))}</b>
        {allowDone && !order?.tableClosed && (
          <button type="button" onClick={(event) => { event.stopPropagation(); onDone?.(order); }}>Done</button>
        )}
      </div>}
    </article>
  );
}

export default function TableTest({
  apiUrl,
  socket,
  carts = {},
  foods = [],
  staffMap = {},
  orderDoneBy = 'user',
  selectedTable = null,
  onSelectMachine,
  onOpenMenu,
  onAddOffMenu,
  onCartSetQty,
  onCartUpdateItem,
  onCartClear,
  onCheckout,
  onOpenCustomer,
  onOpenProfile,
  onRealtimeStateChange,
}) {
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedNumber, setSelectedNumber] = useState(() => text(selectedTable?.tableNo));
  const selectedNumberRef = useRef(text(selectedTable?.tableNo));
  const selectedAreaRef = useRef(text(selectedTable?.area));
  const [metricPanel, setMetricPanel] = useState(null);
  const [activityPanel, setActivityPanel] = useState(null); // ENTER | LEAVE | null
  const [layout, setLayout] = useState(null);
  const [layoutLoading, setLayoutLoading] = useState(false);
  const [layoutError, setLayoutError] = useState('');
  const [activityLog, setActivityLog] = useState([]);
  const [pulseByMachine, setPulseByMachine] = useState({});
  const pulseTimersRef = useRef(new Map());
  const [stationHighlights, setStationHighlights] = useState({});
  const stationHighlightTimersRef = useRef(new Map());

  const [orders, setOrders] = useState([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [ordersError, setOrdersError] = useState('');
  const [machineHistory, setMachineHistory] = useState([]);
  const [machineHistoryLoading, setMachineHistoryLoading] = useState(false);
  const [machineHistoryError, setMachineHistoryError] = useState('');
  const [customerMachineHistory, setCustomerMachineHistory] = useState([]);
  const [customerProfile, setCustomerProfile] = useState(null);
  const [customerLoading, setCustomerLoading] = useState(false);
  const [customerError, setCustomerError] = useState('');

  // Profile riêng trong Table Test. Chỉ mở khi user click, không auto-open theo realtime.
  const [profileModal, setProfileModal] = useState(null); // { code, machine }
  const [profileModalData, setProfileModalData] = useState(null);
  const [profileModalLoading, setProfileModalLoading] = useState(false);
  const [profileModalError, setProfileModalError] = useState('');

  const [autoDoneLog, setAutoDoneLog] = useState([]);

  const machines = useMemo(() => (Array.isArray(snapshot?.machines) ? snapshot.machines : []), [snapshot]);
  const selected = useMemo(() => {
    const liveMachine = machines.find((machine) => text(machine?.machineNumber) === text(selectedNumber)) || null;
    if (liveMachine) return liveMachine;
    const selectedTableNo = text(selectedTable?.tableNo || selectedNumber);
    const selectedArea = text(selectedTable?.area);
    if (selectedArea && isDiningTableNo(selectedTableNo)) {
      return {
        machineNumber: selectedTableNo,
        area: selectedArea,
        floor: 'Dining',
        diningNote: diningTableNoteOf(selectedArea, selectedTableNo),
        isDiningTable: true,
        checkState: 'dining',
        online: true,
        isPlaying: false,
      };
    }
    return null;
  }, [machines, selectedNumber, selectedTable?.tableNo, selectedTable?.area]);

  const foodByImage = useMemo(() => {
    const map = new Map();
    for (const food of Array.isArray(foods) ? foods : []) {
      const key = imageNameOf(food?.imageUrl || food?.imageName);
      if (key && !map.has(key)) map.set(key, food);
    }
    return map;
  }, [foods]);

  const loadSnapshot = useCallback(async () => {
    try {
      setError('');
      const response = await axios.get(apiUrl('/api/user/floorlens'), { timeout: 10000, headers: { 'Cache-Control': 'no-cache' } });
      const next = response.data || null;
      setSnapshot(next);
    } catch (requestError) {
      setError(requestError?.response?.data?.error || requestError?.message || 'Không tải được FloorLens');
    } finally {
      setLoading(false);
    }
  }, [apiUrl]);

  useEffect(() => { loadSnapshot(); }, [loadSnapshot]);

  const loadLayout = useCallback(async () => {
    if (layoutLoading) return;
    try {
      setLayoutLoading(true);
      setLayoutError('');
      const response = await axios.get(apiUrl('/api/user/floorlens/layout'), {
        timeout: 12000,
        headers: { 'Cache-Control': 'no-cache' },
      });
      setLayout(response.data || null);
    } catch (requestError) {
      setLayoutError(requestError?.response?.data?.error || requestError?.message || 'Không tải được FloorLens Map');
    } finally {
      setLayoutLoading(false);
    }
  }, [apiUrl, layoutLoading]);

  const openMetricPanel = useCallback((key, label) => {
    setActivityPanel(null);
    setMetricPanel({ key, label });
    if (!layout) loadLayout();
  }, [layout, loadLayout]);

  useEffect(() => {
    const nextNumber = text(selectedTable?.tableNo);
    const nextArea = text(selectedTable?.area);
    setSelectedNumber(nextNumber);
    selectedNumberRef.current = nextNumber;
    selectedAreaRef.current = nextArea;
  }, [selectedTable?.tableNo, selectedTable?.area]);

  useEffect(() => {
    selectedNumberRef.current = text(selectedNumber);
    selectedAreaRef.current = text(selected?.area);
  }, [selectedNumber, selected?.area]);

  const loadOrders = useCallback(async (machine) => {
    const number = text(machine?.machineNumber);
    if (!number) { setOrders([]); return; }
    try {
      setOrdersLoading(true);
      setOrdersError('');
      const response = await axios.get(apiUrl(`/api/user/floorlens/orders/${encodeURIComponent(number)}`), {
        params: { area: text(machine?.area) || undefined, limit: 100 },
        timeout: 10000,
        headers: { 'Cache-Control': 'no-cache' },
      });
      setOrders(Array.isArray(response.data?.rows) ? response.data.rows : []);
    } catch (requestError) {
      setOrders([]);
      setOrdersError(requestError?.response?.data?.error || requestError?.message || 'Không tải được order của máy');
    } finally {
      setOrdersLoading(false);
    }
  }, [apiUrl]);

  const loadMachineHistory = useCallback(async (machine) => {
    const number = text(machine?.machineNumber);
    if (!number) { setMachineHistory([]); return; }
    try {
      setMachineHistoryLoading(true);
      setMachineHistoryError('');
      const response = await axios.get(apiUrl(`/api/user/floorlens/history/${encodeURIComponent(number)}`), {
        params: { limit: 80 }, timeout: 10000, headers: { 'Cache-Control': 'no-cache' },
      });
      setMachineHistory(Array.isArray(response.data?.rows) ? response.data.rows : []);
    } catch (requestError) {
      setMachineHistory([]);
      setMachineHistoryError(requestError?.response?.data?.error || requestError?.message || 'Không tải được lịch sử máy');
    } finally {
      setMachineHistoryLoading(false);
    }
  }, [apiUrl]);

  const loadCustomerData = useCallback(async (machine) => {
    const code = cleanCode(machine?.memberCode);
    if (!code || isUnknownPlayer(machine) || !isVerifiedPlaying(machine)) {
      setCustomerMachineHistory([]);
      setCustomerProfile(null);
      setCustomerError('');
      return;
    }
    try {
      setCustomerLoading(true);
      setCustomerError('');
      const [machinesResponse, profileResponse] = await Promise.all([
        axios.get(apiUrl(`/api/user/floorlens/customer/${encodeURIComponent(code)}/machines`), {
          params: { limit: 100 }, timeout: 10000, headers: { 'Cache-Control': 'no-cache' },
        }),
        axios.get(apiUrl(`/api/user/customer-profile/${encodeURIComponent(code)}`), {
          timeout: 10000, headers: { 'Cache-Control': 'no-cache' },
        }),
      ]);
      setCustomerMachineHistory(Array.isArray(machinesResponse.data?.rows) ? machinesResponse.data.rows : []);
      setCustomerProfile(profileResponse.data || null);
    } catch (requestError) {
      setCustomerMachineHistory([]);
      setCustomerProfile(null);
      setCustomerError(requestError?.response?.data?.error || requestError?.message || 'Không tải được thông tin khách');
    } finally {
      setCustomerLoading(false);
    }
  }, [apiUrl]);

  const openCustomerProfile = useCallback((row = {}) => {
    const code = cleanCode(row?.memberCode || row?.code);
    if (!code) return;
    if (typeof onOpenProfile === 'function') onOpenProfile(code);
  }, [onOpenProfile]);

  const closeCustomerProfile = useCallback(() => {
    setProfileModal(null);
    setProfileModalData(null);
    setProfileModalError('');
    setProfileModalLoading(false);
  }, []);

  useEffect(() => {
    const code = cleanCode(profileModal?.code);
    if (!code) return undefined;
    let cancelled = false;
    (async () => {
      try {
        setProfileModalLoading(true);
        setProfileModalError('');
        const response = await axios.get(apiUrl(`/api/user/customer-profile/${encodeURIComponent(code)}`), {
          timeout: 10000,
          headers: { 'Cache-Control': 'no-cache' },
        });
        if (!cancelled) setProfileModalData(response.data || null);
      } catch (requestError) {
        if (!cancelled) {
          setProfileModalData(null);
          setProfileModalError(requestError?.response?.data?.error || requestError?.message || 'Không tải được profile khách');
        }
      } finally {
        if (!cancelled) setProfileModalLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [apiUrl, profileModal?.code]);

  useEffect(() => {
    if (!selected) {
      setOrders([]); setMachineHistory([]); setCustomerMachineHistory([]); setCustomerProfile(null);
      return;
    }
    loadOrders(selected);
    if (selected?.isDiningTable) {
      setMachineHistory([]);
      setMachineHistoryError('');
      setCustomerMachineHistory([]);
      setCustomerProfile(null);
      setCustomerError('');
    } else {
      loadMachineHistory(selected);
      loadCustomerData(selected);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.machineNumber, selected?.area, selected?.memberCode, selected?.sessionId, loadOrders, loadMachineHistory, loadCustomerData]);

  useEffect(() => {
    if (!socket) return undefined;

    const onUpdated = (nextSnapshot) => {
      setSnapshot(nextSnapshot || null);
      setError('');
      setLoading(false);
    };

    const onActivity = (activity = {}) => {
      const machineNumber = text(activity?.machineNumber);
      const kind = activity?.kind === 'LEAVE' ? 'LEAVE' : 'ENTER';
      const row = { ...activity, kind, id: text(activity?.id) || `${kind}-${machineNumber}-${Date.now()}`, receivedAt: Date.now() };
      setActivityLog((prev) => {
        const sameKind = [
          row,
          ...prev.filter(
            (item) =>
              item.id !== row.id &&
              item.kind === kind
          ),
        ].slice(0, 102);

        const otherKind = prev
          .filter((item) => item.kind !== kind)
          .slice(0, 102);

        return [...sameKind, ...otherKind];
      });

      if (machineNumber) {
        setPulseByMachine((prev) => ({ ...prev, [machineNumber]: kind }));
        const oldTimer = pulseTimersRef.current.get(machineNumber);
        if (oldTimer) clearTimeout(oldTimer);
        const timer = setTimeout(() => {
          pulseTimersRef.current.delete(machineNumber);
          setPulseByMachine((prev) => { const next = { ...prev }; delete next[machineNumber]; return next; });
        }, 5000);
        pulseTimersRef.current.set(machineNumber, timer);
      }

    };

    const onOrderStationActivity = (payload = {}) => {
      const sourceRaw = text(payload?.sourceStation || payload?.order?.sourceStation).toUpperCase().replace(/[\s_-]+/g, '');
      const source = sourceRaw === 'CENTER' ? 'CENTER3022' : sourceRaw;
      const targetRaw = text(payload?.targetStation || 'KITCHEN').toUpperCase().replace(/[\s_-]+/g, '');
      const target = targetRaw || 'KITCHEN';
      const orderId = text(payload?.orderId || payload?.order?.id);
      const now = Date.now();
      const entries = [
        source && MAP_DEVICE_STATIONS.some((station) => station.code === source) ? { code: source, role: 'source' } : null,
        target && MAP_DEVICE_STATIONS.some((station) => station.code === target) ? { code: target, role: 'target' } : null,
      ].filter(Boolean);
      if (!entries.length) return;

      setStationHighlights((prev) => {
        const next = { ...prev };
        entries.forEach((entry) => {
          next[entry.code] = { ...entry, at: now, orderId, machineNumber: text(payload?.machineNumber || payload?.order?.tableNo) };
        });
        return next;
      });

      entries.forEach((entry) => {
        const oldTimer = stationHighlightTimersRef.current.get(entry.code);
        if (oldTimer) clearTimeout(oldTimer);
        const timer = setTimeout(() => {
          stationHighlightTimersRef.current.delete(entry.code);
          setStationHighlights((prev) => {
            const next = { ...prev };
            delete next[entry.code];
            return next;
          });
        }, 7000);
        stationHighlightTimersRef.current.set(entry.code, timer);
      });
    };

    const onOrderChanged = (payload = {}) => {
      loadSnapshot();
      const currentNumber = text(selectedNumberRef.current);
      const currentArea = text(selectedAreaRef.current);
      const payloadNumber = text(payload?.order?.tableNo || payload?.tableNo);
      if (currentNumber && (!payloadNumber || payloadNumber === currentNumber)) {
        setTimeout(() => loadOrders({ machineNumber: currentNumber, area: currentArea }), 120);
      }
    };

    const onAutoDone = (payload = {}) => {
      setAutoDoneLog((prev) => [{
        id: `${payload.machineNumber || 'M'}-${payload.newOrderId || Date.now()}-${payload.at || Date.now()}`,
        ...payload,
      }, ...prev].slice(0, 30));
      loadSnapshot();
      const currentNumber = text(selectedNumberRef.current);
      const currentArea = text(selectedAreaRef.current);
      if (currentNumber && (!payload.machineNumber || String(payload.machineNumber) === currentNumber)) {
        setTimeout(() => loadOrders({ machineNumber: currentNumber, area: currentArea }), 100);
      }
    };

    socket.on('floorlensUpdated', onUpdated);
    socket.on('floorlensActivity', onActivity);
    socket.on('floorlensAutoDoneOrders', onAutoDone);
    socket.on('floorlensOrderStationActivity', onOrderStationActivity);
    socket.on('orderPlaced', onOrderChanged);
    socket.on('orderUpdated', onOrderChanged);

    return () => {
      socket.off('floorlensUpdated', onUpdated);
      socket.off('floorlensActivity', onActivity);
      socket.off('floorlensAutoDoneOrders', onAutoDone);
      socket.off('floorlensOrderStationActivity', onOrderStationActivity);
      socket.off('orderPlaced', onOrderChanged);
      socket.off('orderUpdated', onOrderChanged);
    };
  }, [socket, loadSnapshot, loadOrders]);

  useEffect(() => () => {
    for (const timer of pulseTimersRef.current.values()) clearTimeout(timer);
    pulseTimersRef.current.clear();
    for (const timer of stationHighlightTimersRef.current.values()) clearTimeout(timer);
    stationHighlightTimersRef.current.clear();
  }, []);

  const activeMachines = useMemo(() => machines.filter(isVerifiedPlaying), [machines]);
  // Dùng đúng counter do FloorLens backend trả về để Table Test luôn khớp FloorLens/Web API.
  // playingCount là số session/máy đang có khách, không phải số member unique.
  const currentCustomerCount = Number(snapshot?.playingCount ?? activeMachines.length);
  const emptyCount = Number(snapshot?.availableCount ?? snapshot?.idleCount ?? machines.filter((machine) => !isMachineUncertain(machine) && !isVerifiedPlaying(machine)).length);
  const unknownMemberCount = Number(snapshot?.unknownCount ?? activeMachines.filter(isUnknownPlayer).length);
  const orderedCount = Number(snapshot?.orderedCount ?? activeMachines.filter(hasOrdered).length);
  const notOrderedCount = Number(snapshot?.notOrderedCount ?? activeMachines.filter((machine) => !isUnknownPlayer(machine) && !hasOrdered(machine)).length);
  const enterEvents = useMemo(() => activityLog.filter((row) => row.kind === 'ENTER'), [activityLog]);
  const leaveEvents = useMemo(() => activityLog.filter((row) => row.kind === 'LEAVE'), [activityLog]);
  const recentEnterMachines = useMemo(() => new Set(enterEvents.map((row) => text(row.machineNumber))), [enterEvents]);
  const recentLeaveMachines = useMemo(() => new Set(leaveEvents.map((row) => text(row.machineNumber))), [leaveEvents]);

  useEffect(() => {
    if (typeof onRealtimeStateChange !== 'function') return;
    const rows = machines.map((machine) => {
      const number = text(machine?.machineNumber);
      return {
        machineNumber: number,
        area: text(machine?.area),
        memberCode: cleanCode(machine?.memberCode),
        customerName: text(machine?.customerName),
        playing: isVerifiedPlaying(machine),
        unknown: isUnknownPlayer(machine),
        ordered: hasOrdered(machine),
        uncertain: isMachineUncertain(machine),
        tone: tileTone(machine),
        pulse: pulseByMachine[number] || '',
        attention: isVerifiedPlaying(machine) && !hasOrdered(machine),
        recentEnter: recentEnterMachines.has(number),
        recentLeave: recentLeaveMachines.has(number),
      };
    });
    onRealtimeStateChange({ rows, statusFilter: 'ALL' });
  }, [machines, pulseByMachine, recentEnterMachines, recentLeaveMachines, onRealtimeStateChange]);

  const selectedCartKey = selected ? tableKeyOf(text(selected.area), text(selected.machineNumber)) : '';
  const selectedCart = useMemo(
    () => (selectedCartKey ? (carts?.[selectedCartKey] || {}) : {}),
    [selectedCartKey, carts]
  );
  const cartRows = useMemo(() => Object.entries(selectedCart).map(([cartKey, item]) => {
    const offMenu = Boolean(item?.isOffMenu) || String(cartKey).startsWith('__offmenu__');
    const food = offMenu ? null : foodByImage.get(String(cartKey).toLowerCase());
    return {
      cartKey,
      qty: Math.max(0, Number(item?.qty || 0)),
      note: text(item?.note),
      offMenu,
      rawName: offMenu ? text(item?.name) : '',
      name: offMenu ? (text(item?.name) || 'Món ngoài menu') : (food?.productName || food?.name || cartKey),
      code: offMenu ? 'H100' : (food?.productCode || food?.code || ''),
    };
  }).filter((row) => row.qty > 0), [selectedCart, foodByImage]);
  const cartCount = useMemo(() => cartRows.reduce((sum, row) => sum + row.qty, 0), [cartRows]);

  const openOrders = useMemo(() => orders.filter((order) => !order?.tableClosed && ['PENDING', 'IN_PROGRESS'].includes(text(order?.status).toUpperCase())), [orders]);
  const customerTodayOrders = useMemo(
    () => (Array.isArray(customerProfile?.orders) ? customerProfile.orders : []).filter((order) => inCurrentBusinessDay(order?.createdAt)),
    [customerProfile]
  );

  const customerMember = customerProfile?.member || {};
  const customerTodayTotal = useMemo(() => customerTodayOrders.reduce((sum, order) => sum + orderTotal(order), 0), [customerTodayOrders]);
  const customerOrderedMachinesToday = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const order of customerTodayOrders) {
      const machine = text(order?.tableNo);
      if (!machine) continue;
      const key = `${text(order?.area)}#${machine}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ area: text(order?.area), tableNo: machine, at: order?.createdAt, orderId: order?.id });
    }
    return out;
  }, [customerTodayOrders]);
  const customerPreviousOrderedMachines = useMemo(
    () => customerOrderedMachinesToday.filter((row) => text(row.tableNo) !== text(selected?.machineNumber)),
    [customerOrderedMachinesToday, selected?.machineNumber]
  );
  const latestCustomerOrder = customerTodayOrders[0] || null;

  const selectMachine = useCallback((machine) => {
    const number = text(machine?.machineNumber);
    if (!number) return;
    setSelectedNumber(number);
    if (typeof onSelectMachine === 'function') {
      onSelectMachine({
        area: text(machine?.area),
        tableNo: Number.isFinite(Number(number)) ? Number(number) : number,
        memberCode: isUnknownPlayer(machine) ? '' : cleanCode(machine?.memberCode),
        customerName: isUnknownPlayer(machine) ? '' : text(machine?.customerName),
      });
    }
  }, [onSelectMachine]);

  const selectMachineByNumber = useCallback((number) => {
    const machine = machines.find((row) => text(row?.machineNumber) === text(number));
    if (machine) selectMachine(machine);
  }, [machines, selectMachine]);

  const diningSelected = Boolean(selected?.isDiningTable);

  const selectedPayload = selected ? {
    area: text(selected?.area),
    tableNo: Number.isFinite(Number(selected?.machineNumber)) ? Number(selected.machineNumber) : selected.machineNumber,
    memberCode: isUnknownPlayer(selected) ? '' : cleanCode(selected?.memberCode),
    customerName: isUnknownPlayer(selected) ? '' : text(selected?.customerName),
  } : null;

  const closeOrder = useCallback(async (order) => {
    try {
      await axios.post(apiUrl(`/api/orders/${order.id}/close`), { by: cleanCode(orderDoneBy) || 'user' });
      if (selected) {
        await loadOrders(selected);
        await loadSnapshot();
      }
    } catch (requestError) {
      alert('Không đóng được order: ' + (requestError?.response?.data?.error || requestError?.message || ''));
    }
  }, [apiUrl, orderDoneBy, selected, loadOrders, loadSnapshot]);

  if (loading && !snapshot) return <div className="tt-message">Đang tải Table Test…</div>;

  return (
    <div className="tt-shell">


      {error && <div className="tt-error">{error}</div>}

      <div className="tt-metrics tt-metrics-eight">
        <Metric label="Tổng máy" value={Number(snapshot?.totalMachines ?? machines.length)} hint={`${snapshot?.checkedMachines ?? 0} xác minh`} active={metricPanel?.key === 'ALL'} onClick={() => openMetricPanel('ALL', 'Tổng máy')} />
        <Metric label="Khách hiện tại" value={currentCustomerCount} hint="session/máy" tone="playing" active={metricPanel?.key === 'PLAYING'} onClick={() => openMetricPanel('PLAYING', 'Khách hiện tại')} />
        <Metric label="Máy trống" value={emptyCount} hint="FloorLens realtime" tone="empty" active={metricPanel?.key === 'EMPTY'} onClick={() => openMetricPanel('EMPTY', 'Máy trống')} />
        <Metric label="Đã order" value={orderedCount} hint="máy có khách" tone="ordered" active={metricPanel?.key === 'ORDERED'} onClick={() => openMetricPanel('ORDERED', 'Đã order')} />
        <Metric label="Chưa order" value={notOrderedCount} hint="máy có khách" tone="attention" active={metricPanel?.key === 'NOT_ORDERED'} onClick={() => openMetricPanel('NOT_ORDERED', 'Chưa order')} />
        <Metric label="Chưa có member" value={unknownMemberCount} hint="avatar ?" tone="unknown" active={metricPanel?.key === 'UNKNOWN'} onClick={() => openMetricPanel('UNKNOWN', 'Chưa có member')} />
        <ActivityMetric
          apiUrl={apiUrl}
          label="Vào"
          value={enterEvents.length}
          events={enterEvents}
          tone="enter"
          active={activityPanel === 'ENTER'}
          onClick={() => { setMetricPanel(null); setActivityPanel((prev) => prev === 'ENTER' ? null : 'ENTER'); }}
          onAvatarClick={(event) => { setActivityPanel(null); setMetricPanel(null); selectMachineByNumber(event.machineNumber); }}
        />
        <ActivityMetric
          apiUrl={apiUrl}
          label="Ra"
          value={leaveEvents.length}
          events={leaveEvents}
          tone="leave"
          active={activityPanel === 'LEAVE'}
          onClick={() => { setMetricPanel(null); setActivityPanel((prev) => prev === 'LEAVE' ? null : 'LEAVE'); }}
          onAvatarClick={(event) => { setActivityPanel(null); setMetricPanel(null); selectMachineByNumber(event.machineNumber); }}
        />
      </div>

      {activityPanel && (
        <ActivityHistoryPanel
          apiUrl={apiUrl}
          kind={activityPanel}
          events={activityPanel === 'ENTER' ? enterEvents : leaveEvents}
          onClose={() => setActivityPanel(null)}
          onSelectMachine={(machineNumber) => { setActivityPanel(null); selectMachineByNumber(machineNumber); }}
        />
      )}

      <div className="tt-legend tt-legend-compact">
        <span><i className="ordered" />Đã order</span>
        <span><i className="not-ordered" />Khách chưa order</span>
        <span><i className="empty" />Không có khách</span>
        <span><i className="unknown" />Avatar ? = chưa có member</span>
        <span><i className="attention" />Dữ liệu chưa xác minh</span>
      </div>

      {!selected ? (
        <div className="tt-select-hint">Chọn một máy ở cột bên trái để xem giỏ, đơn và thông tin.</div>
      ) : (
        <div className="tt-selected-stack">
          <section className="tt-order-layout-card">
            <div className="tt-order-customer-profile">
              <div className="tt-profile-avatar-wrap">
                {diningSelected ? (
                  <div className="tt-dining-avatar" aria-hidden="true">🍽️</div>
                ) : (
                  <CustomerAvatar apiUrl={apiUrl} machine={selected} size={104} />
                )}
                {!diningSelected && selected?.memberCode && !isUnknownPlayer(selected) && (
                  <button type="button" onClick={() => openCustomerProfile(selected)}>View</button>
                )}
              </div>

              <div className="tt-profile-main">
                <div className="tt-profile-title-row">
                  <div>
                    <small>{text(selected.area)} • {diningSelected ? 'Bàn ăn' : `Máy ${text(selected.machineNumber)}`}</small>
                    <h2>{diningSelected
                      ? text(selected.machineNumber)
                      : isVerifiedPlaying(selected)
                        ? (isUnknownPlayer(selected) ? 'Unknown Player' : text(customerMember?.name || selected.customerName) || `Member ${cleanCode(selected.memberCode)}`)
                        : `Máy ${text(selected.machineNumber)} đang trống`}</h2>
                    {!diningSelected && !isUnknownPlayer(selected) && cleanCode(selected.memberCode) && <p>#{cleanCode(selected.memberCode)}</p>}
                  </div>
                  <button type="button" className="tt-close" onClick={() => setSelectedNumber('')}>×</button>
                </div>

                {diningSelected ? (
                  <div className="tt-profile-order-summary dining-table-note">
                    <div>
                      <b>Bàn ăn</b>
                      <small>{selected?.diningNote ? `${selected.diningNote} • ` : ''}Order tự do cho khách, không ràng buộc FloorLens machine/customer.</small>
                    </div>
                  </div>
                ) : isVerifiedPlaying(selected) && !isUnknownPlayer(selected) ? (
                  <>
                    <div className="tt-profile-facts">
                      <div><span>Level</span><b>{customerMember?.level || customerMember?.membershipType || '—'}</b></div>
                      <div><span>Since</span><b>{formatFloorlensClock(selected?.startedAt)}</b></div>
                      <div><span>DOB</span><b>{formatProfileDate(customerMember?.dateOfBirth)}</b></div>
                      <div><span>Registered</span><b>{formatProfileDate(customerMember?.registeredAt)}</b></div>
                    </div>
                    <div className={`tt-profile-order-summary ${customerTodayOrders.length > 0 ? 'has-order' : 'no-order'}`}>
                      <div>
                        <b>{customerTodayOrders.length > 0 ? 'Đã order' : 'Chưa order'}</b>
                        <small>
                          {customerTodayOrders.length > 0
                            ? `${customerTodayOrders.length} order • ${money(customerTodayTotal)}${latestCustomerOrder?.tableNo ? ` • gần nhất máy ${latestCustomerOrder.tableNo}` : ''}`
                            : 'Chưa order'}
                        </small>
                      </div>
                      {customerPreviousOrderedMachines.length > 0 && (
                        <div className="tt-profile-previous-machines">
                          <span>Đã order trước đó:</span>
                          {customerPreviousOrderedMachines.slice(0, 6).map((row) => (
                            <button type="button" key={`${row.area}-${row.tableNo}`} onClick={() => selectMachineByNumber(row.tableNo)}>
                              {row.tableNo}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </>
                ) : isUnknownPlayer(selected) ? (
                  <div className="tt-profile-order-summary no-order"><div><b>Chưa có member number</b><small>Không tự suy đoán lịch sử order cho Unknown Player.</small></div></div>
                ) : null}
              </div>
            </div>

            <div className="tt-detail-actions">
              <button type="button" className="primary" onClick={() => selectedPayload && onOpenMenu?.(selectedPayload)}>+ Thêm món</button>
              <button type="button" className="purple" onClick={() => selectedPayload && onAddOffMenu?.(selectedPayload)}>+ Món ngoài menu</button>
              <button type="button" disabled={!cartCount} onClick={() => selectedPayload && onCheckout?.(selectedPayload)}>Gửi order ({cartCount})</button>
            </div>

            <section className="tt-section">
              <div className="tt-section-title">
                <h3>Giỏ hiện tại</h3>
                {cartRows.length > 0 && <button type="button" onClick={() => selectedPayload && onCartClear?.(selectedPayload)}>Xóa giỏ</button>}
              </div>
              {cartRows.length === 0 ? <div className="tt-empty-line">Chưa chọn món.</div> : (
                <div className="tt-cart-list">
                  {cartRows.map((row) => (
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
                      <div><b>{row.code ? `${row.code} - ` : ''}{row.name}</b>{row.note && <small>📝 {row.note}</small>}</div>
                      <div className="tt-qty">
                        <button type="button" onClick={() => onCartSetQty?.({ ...selectedPayload, cartKey: row.cartKey, qty: row.qty - 1 })}>−</button>
                        <strong>{row.qty}</strong>
                        <button type="button" onClick={() => onCartSetQty?.({ ...selectedPayload, cartKey: row.cartKey, qty: row.qty + 1 })}>+</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="tt-section tt-sent-orders-section">
              <div className="tt-section-title">
                <div><h3>Đơn đã gửi</h3><small>{openOrders.length} đơn đang mở</small></div>
                <button type="button" onClick={() => loadOrders(selected)}>↻</button>
              </div>
              {ordersLoading ? <div className="tt-empty-line">Đang tải orders…</div> : ordersError ? <div className="tt-error compact">{ordersError}</div> : openOrders.length === 0 ? <div className="tt-empty-line">Chưa có đơn nào hoặc đã đóng bàn.</div> : (
                <div className="tt-detailed-orders-list">
                  {openOrders.map((order) => <DetailedOrderCard key={order.id} order={order} foodByImage={foodByImage} apiUrl={apiUrl} staffMap={staffMap} allowDone onDone={closeOrder} />)}
                </div>
              )}
            </section>
          </section>

          <section className="tt-floorlens-layout-card">
            <div className="tt-focus-title">
              <div><h3>Thông tin</h3><small>Machine / Customer / Order</small></div>
              <span>{snapshot?.gamingDate ? `Gaming Date ${snapshot.gamingDate}` : 'Realtime'}</span>
            </div>

            <div className="tt-focus-panels">
              <section className="tt-panel-card">
                <div className="tt-panel-card-head">
                  <h3>{diningSelected ? 'Bàn ăn' : 'Máy'}</h3>
                  <span className={`tt-mini-pill ${diningSelected ? 'dining' : isVerifiedPlaying(selected) ? 'playing' : isMachineUncertain(selected) ? 'attention' : 'idle'}`}>
                    {diningSelected ? 'DINING' : isVerifiedPlaying(selected) ? 'PLAYING' : isMachineUncertain(selected) ? 'THEO DÕI' : 'TRỐNG'}
                  </span>
                </div>
                <div className="tt-panel-card-body">
                  <div><span>{diningSelected ? 'Bàn' : 'Số máy'}</span><b>{text(selected.machineNumber)}</b></div>
                  <div><span>Khu vực</span><b>{text(selected.area) || '—'}</b></div>
                  {diningSelected && selected?.diningNote && <div><span>Vị trí</span><b>{selected.diningNote}</b></div>}
                  {!diningSelected && <div><span>Floor</span><b>{text(selected.floor) || '—'}</b></div>}
                  {!diningSelected && <div><span>Session</span><b>{text(selected.sessionId) || '—'}</b></div>}
                  {!diningSelected && <div><span>Bắt đầu session</span><b>{formatFloorlensDateTime(selected.startedAt)}</b></div>}
                </div>

                {!diningSelected && <><div className="tt-panel-subtitle"><b>Lịch sử khách chơi tại máy hôm nay</b><button type="button" onClick={() => loadMachineHistory(selected)}>↻</button></div>
                <div className="tt-panel-scroll tt-session-history">
                  {machineHistoryLoading ? <div className="tt-panel-order-empty">Đang tải…</div> : machineHistoryError ? <div className="tt-panel-order-empty is-error">{machineHistoryError}</div> : machineHistory.length === 0 ? <div className="tt-panel-order-empty">Chưa có lịch sử.</div> : machineHistory.map((row, index) => (
                    <button
                      type="button"
                      className={`tt-session-history-row ${row.memberCode && !row.unknownPlayer ? 'is-clickable' : ''}`}
                      key={row.sessionId || `${row.startedAt}-${index}`}
                      disabled={!row.memberCode || row.unknownPlayer}
                      onClick={() => row.memberCode && !row.unknownPlayer && openCustomerProfile({ ...row, code: row.memberCode, machineNumber: selected.machineNumber, area: selected.area })}
                    >
                      <CustomerAvatar apiUrl={apiUrl} machine={{ ...row, isPlaying: true, online: true, checkState: 'ok' }} size={34} />
                      <div>
                        <b>{row.customerName || (row.unknownPlayer ? 'Unknown Player' : `Member ${row.memberCode || '—'}`)}</b>
                        <small>{row.memberCode ? `#${row.memberCode}` : 'Chưa có member'} • {formatFloorlensShortTime(row.startedAt)} → {row.active ? 'đang chơi' : formatFloorlensShortTime(row.endedAt)}</small>
                      </div>
                      <span className={`tt-history-order ${row.unknownPlayer ? 'unknown' : row.orderStatus === 'ORDERED' ? 'ordered' : 'not-ordered'}`}>{row.unknownPlayer ? '?' : row.orderStatus === 'ORDERED' ? 'Đã order' : 'Chưa order'}</span>
                    </button>
                  ))}
                </div></>}
              </section>

              <section className="tt-panel-card">
                <div className="tt-panel-card-head">
                  <h3>Khách</h3>
                  <span className={`tt-mini-pill ${diningSelected ? 'dining' : isUnknownPlayer(selected) ? 'unknown' : hasOrdered(selected) ? 'ordered' : isVerifiedPlaying(selected) ? 'not-ordered' : 'idle'}`}>
                    {diningSelected ? 'NHẬP KHI ORDER' : isUnknownPlayer(selected) ? 'CHƯA CÓ MEMBER' : hasOrdered(selected) ? 'ĐÃ ORDER' : isVerifiedPlaying(selected) ? 'CHƯA ORDER' : 'KHÔNG CÓ KHÁCH'}
                  </span>
                </div>
                <div className="tt-panel-customer-head">
                  <CustomerAvatar apiUrl={apiUrl} machine={selected} size={54} />
                  <div><b>{text(selected.customerName) || (isUnknownPlayer(selected) ? 'Unknown Player' : '—')}</b><small>{isUnknownPlayer(selected) ? 'Chưa có member number' : cleanCode(selected.memberCode) ? `#${cleanCode(selected.memberCode)}` : '—'}</small></div>
                </div>
                <div className="tt-panel-card-body">
                  <div><span>Member</span><b>{isUnknownPlayer(selected) ? 'Chưa có member' : cleanCode(selected.memberCode) || '—'}</b></div>
                  <div><span>Tên</span><b>{text(selected.customerName) || (isUnknownPlayer(selected) ? 'Unknown Player' : '—')}</b></div>
                  <div><span>Level</span><b>{customerProfile?.member?.level || customerProfile?.member?.membershipType || selected?.level || '—'}</b></div>
                  <div><span>DOB</span><b>{formatProfileDate(customerProfile?.member?.dateOfBirth)}</b></div>
                  <div><span>Registered</span><b>{formatProfileDate(customerProfile?.member?.registeredAt)}</b></div>
                  <div><span>Order</span><b>{hasOrdered(selected) ? 'Đã order' : isVerifiedPlaying(selected) ? 'Chưa order' : '—'}</b></div>
                  <div><span>Orders business day</span><b>{customerTodayOrders.length}</b></div>
                </div>
                <div className="tt-panel-actions">
                  <button type="button" className="primary" onClick={() => selectedPayload && onOpenMenu?.(selectedPayload)}>Mở Menu</button>
                  <button type="button" disabled={!selected?.memberCode || isUnknownPlayer(selected) || !isVerifiedPlaying(selected)} onClick={() => onOpenCustomer?.(cleanCode(selected?.memberCode))}>Insights khách</button>
                </div>

                <div className="tt-panel-subtitle"><b>Máy đã chơi hôm nay</b></div>
                <div className="tt-machine-history-buttons">
                  {customerLoading ? <div className="tt-panel-order-empty">Đang tải…</div> : customerError ? <div className="tt-panel-order-empty is-error">{customerError}</div> : customerMachineHistory.length === 0 ? <div className="tt-panel-order-empty">Chưa có lịch sử máy.</div> : customerMachineHistory.slice(0, 20).map((row, index) => (
                    <button type="button" key={row.sessionId || `${row.machineNumber}-${row.startedAt}-${index}`} onClick={() => selectMachineByNumber(row.machineNumber)}>
                      <b>{row.machineNumber}</b><span>{row.area || '—'}</span><small>{formatFloorlensShortTime(row.startedAt)} → {row.active ? 'đang chơi' : formatFloorlensShortTime(row.endedAt)}</small>
                    </button>
                  ))}
                </div>

                <div className="tt-panel-subtitle"><b>Lịch sử order hôm nay của khách</b></div>
                <div className="tt-panel-scroll tt-customer-orders-history">
                  {customerTodayOrders.length === 0 ? <div className="tt-panel-order-empty">Khách chưa có order trong business day hiện tại.</div> : customerTodayOrders.map((order) => <DetailedOrderCard key={order.id} order={order} foodByImage={foodByImage} apiUrl={apiUrl} staffMap={staffMap} compact />)}
                </div>
              </section>

              <section className="tt-panel-card">
                <div className="tt-panel-card-head">
                  <h3>Order</h3>
                  <span className="tt-mini-pill ordered">{orders.length} HÔM NAY</span>
                </div>
                <div className="tt-panel-subtitle"><b>Lịch sử order của máy trong business day</b><button type="button" onClick={() => loadOrders(selected)}>↻</button></div>
                <div className="tt-panel-scroll tt-machine-orders-history">
                  {ordersLoading ? <div className="tt-panel-order-empty">Đang tải…</div> : ordersError ? <div className="tt-panel-order-empty is-error">{ordersError}</div> : orders.length === 0 ? <div className="tt-panel-order-empty">Máy này chưa có order trong business day hiện tại.</div> : orders.map((order) => <DetailedOrderCard key={order.id} order={order} foodByImage={foodByImage} apiUrl={apiUrl} staffMap={staffMap} compact />)}
                </div>
              </section>
            </div>

            {autoDoneLog.length > 0 && (
              <section className="tt-preview-log tt-autodone-real-log">
                <div className="tt-section-title"><h3>Auto DONE FloorLens</h3><small>Đã thực hiện thật • trigger bởi order mới của khách mới</small></div>
                {autoDoneLog.slice(0, 8).map((row) => (
                  <div key={row.id}>
                    <span>{formatOrderDateTime(row.at)} • Máy {row.machineNumber} • New order #{row.newOrderId}</span>
                    <b className="is-done">DONE: {(row.orderIds || []).map((id) => `#${id}`).join(', ') || '—'}</b>
                  </div>
                ))}
              </section>
            )}
          </section>
        </div>
      )}

      {profileModal?.code && (
        <CustomerProfileModal
          apiUrl={apiUrl}
          code={profileModal.code}
          machine={profileModal.machine}
          profile={profileModalData}
          loading={profileModalLoading}
          error={profileModalError}
          onClose={closeCustomerProfile}
        />
      )}

      {metricPanel && (
        <FloorMapMetricModal
          apiUrl={apiUrl}
          layout={layout}
          layoutLoading={layoutLoading}
          layoutError={layoutError}
          title={metricPanel.label}
          metricKey={metricPanel.key}
          machines={machines}
          snapshot={snapshot}
          pulseByMachine={pulseByMachine}
          stationHighlights={stationHighlights}
          onClose={() => setMetricPanel(null)}
          onSelectMachine={selectMachineByNumber}
        />
      )}
    </div>
  );
}

