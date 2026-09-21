import {
  acceptsGuestOtp,
  assertGuest,
  collectTenantHotelKeys,
  consumeGuestLoginAttempt,
  hotelNameWhere,
  isValidOtpFormat,
  normalizeOtp,
  signGuestToken,
} from "./lib/guestAuth.js";
import { unitCostAtSaleFromItems } from "./lib/cafeRecipe.js";
import {
  roomServiceCaption,
  roomServiceTableNo,
  withCafeOrderMarker,
  cafeOrderIdFromBillDescription,
} from "./lib/lodgingRoomService.js";

const STAY_INCLUDE = {
  guest: true,
  rooms: { include: { room: true } },
  bill: { include: { lines: { orderBy: { id: "asc" } } } },
};

export const guestTypeDefs = `
  type GuestProperty {
    tinNumber: String!
    displayName: String!
    logoUrl: String
    hotelPhone: String
    hotelPhoneSecondary: String
  }

  type GuestRoom {
    id: Int!
    roomNumber: String!
    roomType: String!
  }

  type GuestProfile {
    firstName: String!
    lastName: String!
    phone: String!
    phoneSecondary: String!
    email: String!
    sex: String!
    isEthiopian: Boolean!
    nationalId: String!
    passportNumber: String!
    country: String!
    stateRegion: String!
    addressLine: String!
  }

  type GuestBillLine {
    id: Int!
    kind: String!
    description: String!
    quantity: Float!
    unitPriceETB: Float!
    amountETB: Float!
    roomNumber: String!
    # pending | completed | cancelled
    fulfillmentStatus: String!
    fulfilledAt: DateTime
    fulfilledBy: String!
    createdAt: DateTime!
  }

  type GuestBill {
    id: Int!
    status: String!
    totalETB: Float!
    lines: [GuestBillLine!]!
  }

  type GuestStay {
    id: Int!
    voucherCode: String!
    status: String!
    HotelName: String!
    arrivalAt: DateTime!
    departureAt: DateTime!
    expectedNights: Int!
    expectedDepartureAt: DateTime
    nights: Int!
    adults: Int!
    children: Int!
    guest: GuestProfile!
    rooms: [GuestRoom!]!
    bill: GuestBill
    property: GuestProperty
  }

  type GuestComplaint {
    id: Int!
    category: String!
    message: String!
    status: String!
    roomNumber: String!
    stayId: Int!
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  type GuestRating {
    id: Int!
    overall: Int!
    cleanliness: Int
    service: Int
    comment: String!
    stayId: Int!
    voucherCode: String!
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  type GuestSession {
    token: String!
    stay: GuestStay!
  }

  type CafeMenuItem {
    id: Int!
    name: String!
    price: Float!
    category: String!
    type: String!
    imageUrl: String!
    isSuspended: Boolean!
  }

  type LaundryCatalogItem {
    id: Int!
    name: String!
    unitPriceETB: Float!
    unitLabel: String!
    imageUrl: String!
    kind: String!
  }

  input GuestFoodDrinkLineInput {
    itemId: Int!
    quantity: Int!
  }

  input GuestLaundryLineInput {
    serviceItemId: Int!
    quantity: Float!
  }

  type GuestOrderResult {
    stay: GuestStay!
    foodDrinkLinesCreated: Int!
    laundryLinesCreated: Int!
  }

  type GuestOrderUpdateResult {
    stay: GuestStay!
    line: GuestBillLine!
  }
`;

export const guestQueryFields = `
  guestMe: GuestStay!
  guestRegistrationCard: GuestStay!
  guestCafeMenu: [CafeMenuItem!]!
  guestLaundryCatalog: [LaundryCatalogItem!]!
  guestBill: GuestBill!
  guestPropertyInfo(tinNumber: String!): GuestProperty
  guestMyComplaints: [GuestComplaint!]!
  guestMyRating: GuestRating
  guestMyRatings: [GuestRating!]!
`;

export const guestMutationFields = `
  guestLogin(otp: String!): GuestSession!
  guestVerifyOtp(otp: String!): Boolean!
  guestPlaceOrder(
    otp: String!
    foodDrink: [GuestFoodDrinkLineInput!]
    laundry: [GuestLaundryLineInput!]
  ): GuestOrderResult!
  guestUpdateOrderLine(otp: String!, lineId: Int!, quantity: Float!): GuestOrderUpdateResult!
  guestCancelOrderLine(otp: String!, lineId: Int!): GuestOrderUpdateResult!
  guestSubmitComplaint(category: String!, message: String!): GuestComplaint!
  guestSubmitRating(
    overall: Int!
    cleanliness: Int
    service: Int
    comment: String
  ): GuestRating!
`;

function roomNumbersFromStay(stay) {
  return (stay.rooms || [])
    .map((sr) => sr.room?.roomNumber)
    .filter(Boolean)
    .join(", ");
}

async function loadPropertyForHotel(prisma, hotelKey) {
  const keys = await collectTenantHotelKeys(prisma, hotelKey);
  const user = await prisma.user.findFirst({
    where: {
      OR: [
        { tinNumber: { in: keys } },
        { HotelName: { in: keys } },
      ],
    },
    select: { tinNumber: true, HotelName: true, LogoUrl: true },
    orderBy: { id: "asc" },
  });
  const tin =
    String(user?.tinNumber || hotelKey).trim() || String(hotelKey);
  const account = await prisma.tenant_account.findFirst({
    where: { tinNumber: { in: keys.length ? keys : [tin] } },
    select: {
      tinNumber: true,
      hotelDisplayName: true,
      logoUrl: true,
      hotelPhone: true,
      hotelPhoneSecondary: true,
    },
  });

  if (!user && !account) {
    return {
      tinNumber: String(hotelKey),
      displayName: String(hotelKey),
      logoUrl: null,
      hotelPhone: "",
      hotelPhoneSecondary: "",
    };
  }

  return {
    tinNumber: String(account?.tinNumber || tin).trim() || String(hotelKey),
    displayName:
      String(account?.hotelDisplayName || user?.HotelName || hotelKey).trim() ||
      String(hotelKey),
    logoUrl: account?.logoUrl || user?.LogoUrl || null,
    hotelPhone: String(account?.hotelPhone ?? "").trim(),
    hotelPhoneSecondary: String(account?.hotelPhoneSecondary ?? "").trim(),
  };
}

function mapBillLine(l) {
  return {
    id: l.id,
    kind: l.kind,
    description: l.description,
    quantity: l.quantity,
    unitPriceETB: l.unitPriceETB,
    amountETB: l.amountETB,
    roomNumber: l.roomNumber,
    fulfillmentStatus: String(l.fulfillmentStatus || "pending").toLowerCase(),
    fulfilledAt: l.fulfilledAt || null,
    fulfilledBy: l.fulfilledBy || "",
    createdAt: l.createdAt,
  };
}

function mapGuestProfile(guest) {
  return {
    firstName: guest?.firstName || "",
    lastName: guest?.lastName || "",
    phone: guest?.phone || "",
    phoneSecondary: guest?.phoneSecondary || "",
    email: guest?.email || "",
    sex: guest?.sex || "",
    isEthiopian: Boolean(guest?.isEthiopian ?? true),
    nationalId: guest?.nationalId || "",
    passportNumber: guest?.passportNumber || "",
    country: guest?.country || "",
    stateRegion: guest?.stateRegion || "",
    addressLine: guest?.addressLine || "",
  };
}

function mapComplaint(row) {
  return {
    id: row.id,
    category: row.category || "general",
    message: row.message || "",
    status: String(row.status || "open").toLowerCase(),
    roomNumber: String(row.roomNumber || "").trim(),
    stayId: Number(row.stayId) || 0,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapRating(row, stayMeta = null) {
  if (!row) return null;
  return {
    id: row.id,
    overall: Number(row.overall) || 0,
    cleanliness: row.cleanliness == null ? null : Number(row.cleanliness),
    service: row.service == null ? null : Number(row.service),
    comment: row.comment || "",
    stayId: Number(row.stayId) || 0,
    voucherCode: String(stayMeta?.voucherCode || row.stay?.voucherCode || ""),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function clampRatingScore(value, label) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 5) {
    throw new Error(`${label} must be a whole number from 1 to 5`);
  }
  return n;
}

function mapStay(stay, property) {
  return {
    id: stay.id,
    voucherCode: stay.voucherCode,
    status: stay.status,
    HotelName: stay.HotelName,
    arrivalAt: stay.arrivalAt,
    departureAt: stay.departureAt,
    expectedNights: Number(stay.expectedNights) || Number(stay.nights) || 1,
    expectedDepartureAt: stay.expectedDepartureAt || null,
    nights: stay.nights,
    adults: Number(stay.adults) || 1,
    children: Number(stay.children) || 0,
    guest: mapGuestProfile(stay.guest),
    rooms: (stay.rooms || []).map((sr) => ({
      id: sr.room?.id || sr.roomId,
      roomNumber: sr.room?.roomNumber || "",
      roomType: sr.room?.roomType || sr.roomType || "",
    })),
    bill: stay.bill
      ? {
          id: stay.bill.id,
          status: stay.bill.status,
          totalETB: stay.bill.totalETB,
          lines: (stay.bill.lines || []).map(mapBillLine),
        }
      : null,
    property: property || null,
  };
}

async function loadGuestStayForSession(context) {
  const stayId = assertGuest(context);
  const stay = await loadActiveGuestStay(context.prisma, stayId);
  if (String(stay.HotelName) !== String(context.user.HotelName)) {
    throw new Error("Session does not match this stay");
  }
  return stay;
}

async function loadActiveGuestStay(prisma, stayId) {
  const stay = await prisma.lodging_stay.findUnique({
    where: { id: Number(stayId) },
    include: STAY_INCLUDE,
  });
  if (!stay) throw new Error("Stay not found");
  if (stay.status !== "checked_in" || !String(stay.guestOtp || "").trim()) {
    throw new Error(
      "This stay is no longer active. Your room code has expired.",
    );
  }
  return stay;
}

async function recalcBillTotal(prisma, billId) {
  const lines = await prisma.lodging_bill_line.findMany({
    where: { billId },
    select: { amountETB: true, fulfillmentStatus: true },
  });
  const totalETB = lines.reduce((s, l) => {
    if (String(l.fulfillmentStatus || "").toLowerCase() === "cancelled") {
      return s;
    }
    return s + Number(l.amountETB || 0);
  }, 0);
  return prisma.lodging_bill.update({
    where: { id: billId },
    data: { totalETB },
    include: { lines: { orderBy: { id: "asc" } } },
  });
}

async function ensureOpenBill(prisma, stay) {
  if (stay.bill && stay.bill.status === "open") return stay.bill;
  if (stay.bill && stay.bill.status !== "open") {
    throw new Error("Bill is not open");
  }
  return prisma.lodging_bill.create({
    data: {
      HotelName: stay.HotelName,
      stayId: stay.id,
      status: "open",
      totalETB: 0,
    },
    include: { lines: { orderBy: { id: "asc" } } },
  });
}

async function logGuestAction(prisma, stay, action, detail) {
  try {
    await prisma.lodging_action_log.create({
      data: {
        HotelName: stay.HotelName,
        actorRole: "RoomGuest",
        actorName: `${stay.guest?.firstName || ""} ${stay.guest?.lastName || ""}`.trim() || "Guest",
        action,
        entityType: "lodging_stay",
        entityId: stay.id,
        stayId: stay.id,
        detailJson: JSON.stringify(detail ?? {}),
      },
    });
  } catch {
    // audit is best-effort
  }
}

export const guestResolvers = {
  Query: {
    guestMe: async (_p, _a, context) => {
      const stay = await loadGuestStayForSession(context);
      const property = await loadPropertyForHotel(context.prisma, stay.HotelName);
      return mapStay(stay, property);
    },

    guestRegistrationCard: async (_p, _a, context) => {
      const stay = await loadGuestStayForSession(context);
      const property = await loadPropertyForHotel(context.prisma, stay.HotelName);
      return mapStay(stay, property);
    },

    guestCafeMenu: async (_p, _a, context) => {
      const stay = await loadGuestStayForSession(context);
      const keys = await collectTenantHotelKeys(context.prisma, stay.HotelName);
      const items = await context.prisma.item.findMany({
        where: {
          ...hotelNameWhere(keys),
          isSuspended: false,
        },
        orderBy: [{ category: "asc" }, { name: "asc" }],
      });
      return items.map((i) => ({
        id: i.id,
        name: i.name,
        price: i.price,
        category: i.category,
        type: i.type,
        imageUrl: i.imageUrl || "",
        isSuspended: Boolean(i.isSuspended),
      }));
    },

    guestLaundryCatalog: async (_p, _a, context) => {
      const stay = await loadGuestStayForSession(context);
      const keys = await collectTenantHotelKeys(context.prisma, stay.HotelName);
      const items = await context.prisma.lodging_service_item.findMany({
        where: {
          ...hotelNameWhere(keys),
          kind: "laundry",
          isActive: true,
        },
        orderBy: { name: "asc" },
      });
      return items.map((i) => ({
        id: i.id,
        name: i.name,
        unitPriceETB: i.unitPriceETB,
        unitLabel: i.unitLabel || "pcs",
        imageUrl: i.imageUrl || "",
        kind: i.kind,
      }));
    },

    guestBill: async (_p, _a, context) => {
      const stay = await loadGuestStayForSession(context);
      if (!stay.bill) {
        return { id: 0, status: "open", totalETB: 0, lines: [] };
      }
      return mapStay(stay).bill;
    },

    guestPropertyInfo: async (_p, { tinNumber }, context) => {
      const tin = String(tinNumber ?? "").trim();
      if (!tin) throw new Error("Property code required");
      return loadPropertyForHotel(context.prisma, tin);
    },

    guestMyComplaints: async (_p, _a, context) => {
      const stay = await loadGuestStayForSession(context);
      const where =
        stay.guestId != null
          ? { HotelName: stay.HotelName, guestId: stay.guestId }
          : { stayId: stay.id };
      const rows = await context.prisma.lodging_guest_complaint.findMany({
        where,
        orderBy: { createdAt: "desc" },
      });
      return rows.map(mapComplaint);
    },

    guestMyRating: async (_p, _a, context) => {
      const stay = await loadGuestStayForSession(context);
      const row = await context.prisma.lodging_guest_rating.findUnique({
        where: { stayId: stay.id },
      });
      return mapRating(row, stay);
    },

    guestMyRatings: async (_p, _a, context) => {
      const stay = await loadGuestStayForSession(context);
      const where =
        stay.guestId != null
          ? { HotelName: stay.HotelName, guestId: stay.guestId }
          : { stayId: stay.id };
      const rows = await context.prisma.lodging_guest_rating.findMany({
        where,
        include: { stay: { select: { voucherCode: true } } },
        orderBy: { createdAt: "desc" },
      });
      return rows.map((r) => mapRating(r, r.stay));
    },
  },

  Mutation: {
    guestLogin: async (_p, { otp }, context) => {
      const clientKey =
        context.clientIp ||
        context.req?.ip ||
        context.req?.headers?.["x-forwarded-for"] ||
        "unknown";
      const attempt = consumeGuestLoginAttempt(clientKey);
      if (!attempt.ok) {
        throw new Error(
          `Too many room-code attempts. Try again in ${attempt.retryAfterSec}s`,
        );
      }

      const code = normalizeOtp(otp);
      if (!isValidOtpFormat(code)) throw new Error("Enter the 6-digit room code");

      // Active stays only — checkout/cancel clears OTP and sets non-checked_in status.
      const stay = await context.prisma.lodging_stay.findFirst({
        where: {
          guestOtp: code,
          status: "checked_in",
        },
        orderBy: { guestOtpIssuedAt: "desc" },
        include: STAY_INCLUDE,
      });

      if (!stay || !String(stay.guestOtp || "").trim()) {
        throw new Error("Invalid or expired room code");
      }

      const property = await loadPropertyForHotel(context.prisma, stay.HotelName);
      const rooms = roomNumbersFromStay(stay);
      const guestName = `${stay.guest?.firstName || ""} ${stay.guest?.lastName || ""}`.trim();
      const token = signGuestToken({
        stayId: stay.id,
        HotelName: stay.HotelName,
        tinNumber: property.tinNumber,
        guestName,
        roomNumbers: rooms,
      });

      await logGuestAction(context.prisma, stay, "guest_login", { rooms });

      return { token, stay: mapStay(stay, property) };
    },

    guestVerifyOtp: async (_p, { otp }, context) => {
      const stay = await loadGuestStayForSession(context);
      if (!acceptsGuestOtp(otp, stay.guestOtp)) {
        throw new Error("Invalid or expired room code");
      }
      return true;
    },

    guestPlaceOrder: async (_p, { otp, foodDrink, laundry }, context) => {
      if (!isValidOtpFormat(normalizeOtp(otp))) {
        throw new Error("Enter the 6-digit room code to approve");
      }

      const stay = await loadGuestStayForSession(context);

      if (!acceptsGuestOtp(otp, stay.guestOtp)) {
        throw new Error("Invalid or expired room code");
      }

      const fdLines = Array.isArray(foodDrink) ? foodDrink : [];
      const laundryLines = Array.isArray(laundry) ? laundry : [];
      if (fdLines.length === 0 && laundryLines.length === 0) {
        throw new Error("Add at least one item to order");
      }

      const keys = await collectTenantHotelKeys(context.prisma, stay.HotelName);
      const hotelScope = hotelNameWhere(keys);
      const rooms = roomNumbersFromStay(stay);
      const caption = roomServiceCaption(rooms);
      const tableNo = roomServiceTableNo(stay.id);
      const guestLabel =
        `${stay.guest?.firstName || ""} ${stay.guest?.lastName || ""}`.trim() || "Guest";

      let bill = await ensureOpenBill(context.prisma, stay);
      let foodDrinkLinesCreated = 0;
      let laundryLinesCreated = 0;

      if (fdLines.length > 0) {
        const itemIds = [...new Set(fdLines.map((l) => Number(l.itemId)).filter((n) => n > 0))];
        const menuItems = await context.prisma.item.findMany({
          where: { id: { in: itemIds }, ...hotelScope, isSuspended: false },
        });
        const byId = new Map(menuItems.map((i) => [i.id, i]));
        const recipeRows = menuItems.map((i) => ({
          name: i.name,
          recipeJson: i.recipeJson,
        }));

        for (const line of fdLines) {
          const item = byId.get(Number(line.itemId));
          if (!item) throw new Error("A menu item is unavailable");
          const qty = Math.floor(Number(line.quantity));
          if (!(qty > 0)) throw new Error("Quantity must be a positive whole number");

          const order = await context.prisma.order.create({
            data: {
              title: item.name,
              imageUrl: item.imageUrl || "",
              tableNo,
              category: item.category,
              type: item.type,
              orderAmount: qty,
              HotelName: stay.HotelName,
              price: Number(item.price) || 0,
              unitCostAtSale: unitCostAtSaleFromItems(recipeRows, item.name),
              waiterName: "Room Guest",
              status: "Pending",
              payment: "Unpaid",
              serviceCaption: caption,
            },
          });

          await context.prisma.lodging_bill_line.create({
            data: {
              billId: bill.id,
              kind: "food_drink",
              description: withCafeOrderMarker(item.name, order.id),
              quantity: qty,
              unitPriceETB: Number(item.price) || 0,
              amountETB: qty * (Number(item.price) || 0),
              roomNumber: rooms.split(",")[0]?.trim() || "",
              createdBy: guestLabel,
              fulfillmentStatus: "pending",
            },
          });
          foodDrinkLinesCreated += 1;
        }
      }

      if (laundryLines.length > 0) {
        const svcIds = [
          ...new Set(
            laundryLines.map((l) => Number(l.serviceItemId)).filter((n) => n > 0),
          ),
        ];
        const svcItems = await context.prisma.lodging_service_item.findMany({
          where: {
            id: { in: svcIds },
            ...hotelScope,
            kind: "laundry",
            isActive: true,
          },
        });
        const byId = new Map(svcItems.map((i) => [i.id, i]));

        for (const line of laundryLines) {
          const item = byId.get(Number(line.serviceItemId));
          if (!item) throw new Error("A laundry item is unavailable");
          if (item.HotelName !== stay.HotelName && !keys.includes(item.HotelName)) {
            throw new Error("A laundry item is unavailable");
          }
          const qty = Number(line.quantity);
          if (!(qty > 0)) throw new Error("Laundry quantity must be positive");
          const unit = Number(item.unitPriceETB) || 0;

          await context.prisma.lodging_bill_line.create({
            data: {
              billId: bill.id,
              kind: "laundry",
              description: `${item.name} (${item.unitLabel || "pcs"})`,
              quantity: qty,
              unitPriceETB: unit,
              amountETB: qty * unit,
              roomNumber: rooms.split(",")[0]?.trim() || "",
              createdBy: guestLabel,
              fulfillmentStatus: "pending",
            },
          });
          laundryLinesCreated += 1;
        }
      }

      await recalcBillTotal(context.prisma, bill.id);
      await logGuestAction(context.prisma, stay, "guest_place_order", {
        foodDrinkLinesCreated,
        laundryLinesCreated,
      });

      const refreshed = await context.prisma.lodging_stay.findUnique({
        where: { id: stay.id },
        include: STAY_INCLUDE,
      });
      const property = await loadPropertyForHotel(context.prisma, stay.HotelName);
      return {
        stay: mapStay(refreshed, property),
        foodDrinkLinesCreated,
        laundryLinesCreated,
      };
    },

    guestUpdateOrderLine: async (_p, { otp, lineId, quantity }, context) => {
      if (!isValidOtpFormat(normalizeOtp(otp))) {
        throw new Error("Enter the 6-digit room code to approve");
      }
      const stay = await loadGuestStayForSession(context);
      if (!acceptsGuestOtp(otp, stay.guestOtp)) {
        throw new Error("Invalid or expired room code");
      }

      const line = await context.prisma.lodging_bill_line.findUnique({
        where: { id: Number(lineId) },
        include: { bill: true },
      });
      if (!line?.bill || line.bill.stayId !== stay.id) {
        throw new Error("Order line not found");
      }
      if (String(line.bill.HotelName || "") && String(line.bill.HotelName) !== String(stay.HotelName)) {
        throw new Error("Order line not found");
      }
      if (line.bill.status !== "open") throw new Error("Bill is not open");

      const kind = String(line.kind || "").toLowerCase();
      if (kind !== "food_drink" && kind !== "laundry") {
        throw new Error("Only food, drink, or laundry orders can be updated");
      }
      if (String(line.fulfillmentStatus || "").toLowerCase() !== "pending") {
        throw new Error("Only pending orders can be updated");
      }

      const qty = Number(quantity);
      if (!(qty > 0)) throw new Error("Quantity must be positive");
      if (kind === "food_drink" && !Number.isInteger(qty)) {
        throw new Error("Food & drink quantity must be a whole number");
      }

      const oid =
        kind === "food_drink"
          ? cafeOrderIdFromBillDescription(line.description)
          : null;
      if (oid != null) {
        const cafeOrder = await context.prisma.order.findUnique({
          where: { id: oid },
        });
        if (cafeOrder) {
          if (String(cafeOrder.HotelName) !== String(stay.HotelName)) {
            throw new Error("Order not found");
          }
          const st = String(cafeOrder.status || "").toLowerCase();
          if (st === "completed") {
            throw new Error("This order was already completed by the hotel");
          }
          if (st === "cancelled") {
            throw new Error("This order was cancelled");
          }
          const nextAmount = Math.max(1, Math.floor(qty));
          if (nextAmount !== Math.floor(Number(cafeOrder.orderAmount))) {
            const prevCount = Number(cafeOrder.orderRevisionCount) || 0;
            await context.prisma.order.update({
              where: { id: cafeOrder.id },
              data: {
                orderAmount: nextAmount,
                status: "Pending",
                orderRevisionCount: prevCount + 1,
                orderRevisedAt: new Date(),
              },
            });
          }
        }
      }

      const unit = Number(line.unitPriceETB) || 0;
      const updated = await context.prisma.lodging_bill_line.update({
        where: { id: line.id },
        data: {
          quantity: qty,
          amountETB: qty * unit,
        },
      });
      await recalcBillTotal(context.prisma, line.billId);
      await logGuestAction(context.prisma, stay, "guest_update_order_line", {
        lineId: line.id,
        quantity: qty,
        kind,
      });

      const refreshed = await context.prisma.lodging_stay.findUnique({
        where: { id: stay.id },
        include: STAY_INCLUDE,
      });
      const property = await loadPropertyForHotel(context.prisma, stay.HotelName);
      return {
        stay: mapStay(refreshed, property),
        line: mapBillLine(updated),
      };
    },

    guestCancelOrderLine: async (_p, { otp, lineId }, context) => {
      if (!isValidOtpFormat(normalizeOtp(otp))) {
        throw new Error("Enter the 6-digit room code to approve");
      }
      const stay = await loadGuestStayForSession(context);
      if (!acceptsGuestOtp(otp, stay.guestOtp)) {
        throw new Error("Invalid or expired room code");
      }

      const line = await context.prisma.lodging_bill_line.findUnique({
        where: { id: Number(lineId) },
        include: { bill: true },
      });
      if (!line?.bill || line.bill.stayId !== stay.id) {
        throw new Error("Order line not found");
      }
      if (
        String(line.bill.HotelName || "") &&
        String(line.bill.HotelName) !== String(stay.HotelName)
      ) {
        throw new Error("Order line not found");
      }
      if (line.bill.status !== "open") throw new Error("Bill is not open");

      const kind = String(line.kind || "").toLowerCase();
      if (kind !== "food_drink" && kind !== "laundry") {
        throw new Error("Only food, drink, or laundry orders can be cancelled");
      }
      if (String(line.fulfillmentStatus || "").toLowerCase() !== "pending") {
        throw new Error("Only pending orders can be cancelled");
      }

      const guestLabel =
        `${stay.guest?.firstName || ""} ${stay.guest?.lastName || ""}`.trim() ||
        "Guest";

      if (kind === "food_drink") {
        const oid = cafeOrderIdFromBillDescription(line.description);
        if (oid != null) {
          const cafeOrder = await context.prisma.order.findUnique({
            where: { id: oid },
          });
          if (
            cafeOrder &&
            String(cafeOrder.HotelName) === String(stay.HotelName) &&
            String(cafeOrder.payment || "").toLowerCase() !== "paid" &&
            String(cafeOrder.status || "").toLowerCase() !== "cancelled"
          ) {
            await context.prisma.order.update({
              where: { id: cafeOrder.id },
              data: {
                status: "Cancelled",
                cancelledBy: guestLabel,
                orderRevisedAt: null,
                orderRevisionCount: 0,
              },
            });
          }
        }
      }

      const updated = await context.prisma.lodging_bill_line.update({
        where: { id: line.id },
        data: {
          fulfillmentStatus: "cancelled",
          fulfilledAt: new Date(),
          fulfilledBy: guestLabel,
          amountETB: 0,
        },
      });
      await recalcBillTotal(context.prisma, line.billId);
      await logGuestAction(context.prisma, stay, "guest_cancel_order_line", {
        lineId: line.id,
        kind,
      });

      const refreshed = await context.prisma.lodging_stay.findUnique({
        where: { id: stay.id },
        include: STAY_INCLUDE,
      });
      const property = await loadPropertyForHotel(context.prisma, stay.HotelName);
      return {
        stay: mapStay(refreshed, property),
        line: mapBillLine(updated),
      };
    },

    guestSubmitComplaint: async (_p, { category, message }, context) => {
      const stay = await loadGuestStayForSession(context);
      const cat = String(category ?? "").trim() || "general";
      const msg = String(message ?? "").trim();
      if (!msg) throw new Error("Please describe your complaint");
      if (msg.length > 4000) {
        throw new Error("Complaint message is too long");
      }
      if (cat.length > 80) throw new Error("Category is too long");

      const rooms = roomNumbersFromStay(stay);
      const primaryRoom = rooms.split(",")[0]?.trim() || "";
      const row = await context.prisma.lodging_guest_complaint.create({
        data: {
          HotelName: stay.HotelName,
          stayId: stay.id,
          guestId: stay.guestId,
          roomNumber: primaryRoom,
          category: cat,
          message: msg,
          status: "open",
        },
      });

      await logGuestAction(context.prisma, stay, "guest_submit_complaint", {
        complaintId: row.id,
        category: cat,
        roomNumber: primaryRoom,
      });

      return mapComplaint(row);
    },

    guestSubmitRating: async (
      _p,
      { overall, cleanliness, service, comment },
      context,
    ) => {
      const stay = await loadGuestStayForSession(context);
      const overallScore = clampRatingScore(overall, "Overall rating");
      const cleanlinessScore =
        cleanliness == null || cleanliness === ""
          ? null
          : clampRatingScore(cleanliness, "Cleanliness rating");
      const serviceScore =
        service == null || service === ""
          ? null
          : clampRatingScore(service, "Service rating");
      const note = String(comment ?? "").trim();
      if (note.length > 2000) throw new Error("Comment is too long");

      const row = await context.prisma.lodging_guest_rating.upsert({
        where: { stayId: stay.id },
        create: {
          HotelName: stay.HotelName,
          stayId: stay.id,
          guestId: stay.guestId,
          overall: overallScore,
          cleanliness: cleanlinessScore,
          service: serviceScore,
          comment: note,
        },
        update: {
          overall: overallScore,
          cleanliness: cleanlinessScore,
          service: serviceScore,
          comment: note,
          guestId: stay.guestId,
        },
      });

      await logGuestAction(context.prisma, stay, "guest_submit_rating", {
        ratingId: row.id,
        overall: overallScore,
      });

      return mapRating(row, stay);
    },
  },
};
