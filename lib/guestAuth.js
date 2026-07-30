import { signToken, assertAuthenticated } from "./auth.js";

export const GUEST_ROLE = "RoomGuest";
export const OTP_LENGTH = 6;

export function normalizeOtp(raw) {
  return String(raw ?? "")
    .replace(/\D/g, "")
    .slice(0, OTP_LENGTH);
}

export function isValidOtpFormat(otp) {
  return /^\d{6}$/.test(String(otp ?? ""));
}

/** Generate a 6-digit numeric OTP (leading zeros allowed as string). */
export function generateGuestOtp() {
  const n = Math.floor(Math.random() * 1_000_000);
  return String(n).padStart(OTP_LENGTH, "0");
}

/**
 * Issue a globally unique OTP for an active (checked_in) stay.
 * Only clashes with other checked-in stays so cleared/expired codes can be reused.
 */
export async function issueUniqueGuestOtp(
  prisma,
  stayId,
  { maxAttempts = 24 } = {},
) {
  const id = Number(stayId);
  if (!(id > 0)) throw new Error("Invalid stay id");

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const otp = generateGuestOtp();
    const clash = await prisma.lodging_stay.findFirst({
      where: { guestOtp: otp, status: "checked_in" },
      select: { id: true },
    });
    if (clash) continue;

    try {
      await prisma.lodging_stay.update({
        where: { id },
        data: {
          guestOtp: otp,
          guestOtpIssuedAt: new Date(),
        },
      });
      return otp;
    } catch (err) {
      if (String(err?.code) === "P2002") continue;
      throw err;
    }
  }
  throw new Error("Could not allocate a unique room code — try again");
}

export function otpsMatch(entered, stored) {
  const a = normalizeOtp(entered);
  const b = normalizeOtp(stored);
  return isValidOtpFormat(a) && isValidOtpFormat(b) && a === b;
}

/** True if entered OTP matches the stay's issued room code (null/empty = expired). */
export function acceptsGuestOtp(entered, stayOtp) {
  if (!stayOtp) return false;
  return otpsMatch(entered, stayOtp);
}

export function signGuestToken({ stayId, HotelName, tinNumber, guestName, roomNumbers }) {
  return signToken({
    role: GUEST_ROLE,
    stayId: Number(stayId),
    HotelName: String(HotelName),
    tinNumber: tinNumber ? String(tinNumber) : String(HotelName),
    guestName: String(guestName || "Guest"),
    roomNumbers: String(roomNumbers || ""),
  });
}

export function assertGuest(context) {
  assertAuthenticated(context);
  if (context.user.role !== GUEST_ROLE && context.user.Role !== GUEST_ROLE) {
    throw new Error("Not authorized — guest session required");
  }
  const stayId = Number(context.user.stayId);
  if (!(stayId > 0)) throw new Error("Invalid guest session");
  return stayId;
}

export function guestStayIdFromContext(context) {
  return Number(context?.user?.stayId) || 0;
}

/**
 * Collect HotelName values for this tenant only.
 * Expand via TIN identity — never OR all users who share a brand display name
 * (that would leak menus across hotels on SaaS).
 */
export async function collectTenantHotelKeys(prisma, hotelKey) {
  const key = String(hotelKey ?? "").trim();
  if (!key) return [];

  const keys = new Set([key]);

  const byTin = await prisma.user.findMany({
    where: {
      OR: [{ tinNumber: key }, { tenantId: key }],
    },
    select: { tinNumber: true, HotelName: true },
    take: 20,
  });

  for (const u of byTin) {
    if (u.tinNumber) keys.add(String(u.tinNumber).trim());
    if (u.HotelName) keys.add(String(u.HotelName).trim());
  }

  // Stay may store display HotelName. Expand only when every matching user
  // shares the same TIN (single-tenant brand), otherwise keep stay key alone.
  if (byTin.length === 0) {
    const byName = await prisma.user.findMany({
      where: { HotelName: key },
      select: { tinNumber: true, HotelName: true },
      take: 20,
    });
    const tins = [
      ...new Set(
        byName.map((u) => String(u.tinNumber || "").trim()).filter(Boolean),
      ),
    ];
    if (tins.length === 1) {
      keys.add(tins[0]);
      for (const u of byName) {
        if (u.HotelName) keys.add(String(u.HotelName).trim());
      }
    }
  }

  return [...keys].filter(Boolean);
}

export function hotelNameWhere(keys) {
  if (!keys.length) return { HotelName: "__no_scope__" };
  if (keys.length === 1) return { HotelName: keys[0] };
  return { HotelName: { in: keys } };
}

/** Simple in-memory login rate limit (per process). */
const loginBuckets = new Map();

/**
 * @returns {{ ok: true } | { ok: false, retryAfterSec: number }}
 */
export function consumeGuestLoginAttempt(
  clientKey,
  { limit = 12, windowMs = 15 * 60 * 1000 } = {},
) {
  const key = String(clientKey || "unknown").trim() || "unknown";
  const now = Date.now();
  let bucket = loginBuckets.get(key);
  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 0, resetAt: now + windowMs };
    loginBuckets.set(key, bucket);
  }
  bucket.count += 1;
  if (bucket.count > limit) {
    return {
      ok: false,
      retryAfterSec: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
    };
  }
  return { ok: true };
}
