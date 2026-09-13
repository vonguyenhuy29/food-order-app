'use strict';

const clean = value => String(value == null ? '' : value).trim();
const memberCode = value => clean(value).replace(/\s+/g, '');

// The service's live connection/ready flags define freshness for its delta stream.
// An old event timestamp alone does not make an unchanged live session stale.
function resolveOrderDelivery(snapshot, { area, tableNo, memberCard } = {}) {
  const fallback = { area: clean(area), tableNo, changed: false, reason: 'KEEP_SELECTED' };
  const code = memberCode(memberCard);
  if (!code || !snapshot || snapshot.stale || snapshot.realtimeConnected !== true ||
      snapshot.realtimeReady !== true || snapshot.fallbackActive || snapshot.realtimeError) {
    return { ...fallback, reason: 'LOCATION_UNAVAILABLE' };
  }
  const locations = new Map();
  for (const machine of Array.isArray(snapshot.machines) ? snapshot.machines : []) {
    if (machine?.checkState !== 'ok' || machine.online === false || machine.isPlaying !== true ||
        machine.unknownPlayer || memberCode(machine.memberCode) !== code) continue;
    const number = clean(machine.machineNumber);
    const machineArea = clean(machine.area);
    if (!number || !machineArea || machineArea === 'Other') continue;
    locations.set(`${machineArea}#${number}`, { area: machineArea, tableNo: number });
  }
  const currentKey = `${fallback.area}#${clean(tableNo)}`;
  if (locations.has(currentKey)) return { ...fallback, reason: 'MATCH_SELECTED' };
  if (locations.size !== 1) {
    return { ...fallback, reason: locations.size ? 'MULTIPLE_LOCATIONS' : 'NOT_FOUND' };
  }
  const destination = [...locations.values()][0];
  return { ...destination, changed: true, reason: 'FOLLOW_MEMBER' };
}

module.exports = { resolveOrderDelivery };
