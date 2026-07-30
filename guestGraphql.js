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
    nights: Int!
    guest: GuestProfile!
    rooms: [GuestRoom!]!
    bill: GuestBill
    property: GuestProperty
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
  guestCafeMenu: [CafeMenuItem!]!
  guestLaundryCatalog: [LaundryCatalogItem!]!
  guestBill: GuestBill!
  guestPropertyInfo(tinNumber: String!): GuestProperty
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

function mapStay(stay, property) {
  return {
    id: stay.id,
    voucherCode: stay.voucherCode,
    status: stay.status,
    HotelName: stay.HotelName,
    arrivalAt: stay.arrivalAt,
    departureAt: stay.departureAt,
    nights: stay.nights,
    guest: {
      firstName: stay.guest?.firstName || "",
      lastName: stay.guest?.lastName || "",
      phone: stay.guest?.phone || "",
    },
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
      const stayId = assertGuest(context);
      const stay = await loadActiveGuestStay(context.prisma, stayId);
      if (String(stay.HotelName) !== String(context.user.HotelName)) {
        throw new Error("Session does not match this stay");
      }
      const property = await loadPropertyForHotel(context.prisma, stay.HotelName);
      return mapStay(stay, property);
    },

    guestCafeMenu: async (_p, _a, context) => {
      const stayId = assertGuest(context);
      const stay = await loadActiveGuestStay(context.prisma, stayId);
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
      const stayId = assertGuest(context);
      const stay = await loadActiveGuestStay(context.prisma, stayId);
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
      const stayId = assertGuest(context);
      const stay = await loadActiveGuestStay(context.prisma, stayId);
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
      const stayId = assertGuest(context);
      const stay = await loadActiveGuestStay(context.prisma, stayId);
      if (String(stay.HotelName) !== String(context.user.HotelName)) {
        throw new Error("Session does not match this stay");
      }
      if (!acceptsGuestOtp(otp, stay.guestOtp)) {
        throw new Error("Invalid or expired room code");
      }
      return true;
    },

    guestPlaceOrder: async (_p, { otp, foodDrink, laundry }, context) => {
      const stayId = assertGuest(context);
      if (!isValidOtpFormat(normalizeOtp(otp))) {
        throw new Error("Enter the 6-digit room code to approve");
      }

      const stay = await loadActiveGuestStay(context.prisma, stayId);
      if (String(stay.HotelName) !== String(context.user.HotelName)) {
        throw new Error("Session does not match this stay");
      }

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
      const stayId = assertGuest(context);
      if (!isValidOtpFormat(normalizeOtp(otp))) {
        throw new Error("Enter the 6-digit room code to approve");
      }
      const stay = await loadActiveGuestStay(context.prisma, stayId);
      if (String(stay.HotelName) !== String(context.user.HotelName)) {
        throw new Error("Session does not match this stay");
      }
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
      const stayId = assertGuest(context);
      if (!isValidOtpFormat(normalizeOtp(otp))) {
        throw new Error("Enter the 6-digit room code to approve");
      }
      const stay = await loadActiveGuestStay(context.prisma, stayId);
      if (String(stay.HotelName) !== String(context.user.HotelName)) {
        throw new Error("Session does not match this stay");
      }
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
  },
};
