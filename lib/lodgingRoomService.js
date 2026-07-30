/** Cafe `tableNo` offset — must match hotcol-user `lib/lodgingRoomService.ts`. */
export const ROOM_SERVICE_TABLE_BASE = 900_000;

export function roomServiceTableNo(stayId) {
  return ROOM_SERVICE_TABLE_BASE + Math.floor(Number(stayId) || 0);
}

export function stayIdFromRoomServiceTableNo(tableNo) {
  const n = Math.floor(Number(tableNo) || 0);
  if (n < ROOM_SERVICE_TABLE_BASE) return null;
  return n - ROOM_SERVICE_TABLE_BASE;
}

export function isRoomServiceTableNo(tableNo) {
  const n = Math.floor(Number(tableNo) || 0);
  return Number.isFinite(n) && n >= ROOM_SERVICE_TABLE_BASE;
}

export function roomServiceCaption(roomNumbers) {
  const rooms = String(roomNumbers || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .join(", ");
  return rooms ? `Room ${rooms}` : "Room service";
}

/** Embed café order id so cancels can drop the matching stay bill line. */
export function withCafeOrderMarker(description, orderId) {
  const base = String(description || "")
    .replace(/\s*·\s*#co:\d+\s*$/i, "")
    .trim();
  return `${base} · #co:${orderId}`;
}

export function cafeOrderIdFromBillDescription(description) {
  const m = String(description || "").match(/#co:(\d+)\s*$/i);
  return m ? Number(m[1]) : null;
}

export function stripCafeOrderMarker(description) {
  return String(description || "")
    .replace(/\s*·\s*#co:\d+\s*$/i, "")
    .trim();
}
