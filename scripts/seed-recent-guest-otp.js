/**
 * One-shot: assign room code 123456 to the most recently checked-in stay.
 * Run: node scripts/seed-recent-guest-otp.js
 */
import { createPrismaClient } from "../lib/prismaClient.js";

const OTP = "123456";

async function main() {
  const prisma = createPrismaClient();
  try {
    const stay = await prisma.lodging_stay.findFirst({
      where: { status: "checked_in" },
      orderBy: [{ arrivalAt: "desc" }, { id: "desc" }],
      include: {
        guest: true,
        rooms: { include: { room: true } },
      },
    });

    if (!stay) {
      console.error("No checked-in stay found — nothing to seed.");
      process.exitCode = 1;
      return;
    }

    // Free the code if another stay already holds it.
    await prisma.lodging_stay.updateMany({
      where: {
        guestOtp: OTP,
        id: { not: stay.id },
      },
      data: {
        guestOtp: null,
        guestOtpIssuedAt: null,
      },
    });

    const updated = await prisma.lodging_stay.update({
      where: { id: stay.id },
      data: {
        guestOtp: OTP,
        guestOtpIssuedAt: new Date(),
      },
    });

    const guestName =
      `${stay.guest?.firstName || ""} ${stay.guest?.lastName || ""}`.trim() ||
      "Guest";
    const rooms = (stay.rooms || [])
      .map((sr) => sr.room?.roomNumber)
      .filter(Boolean)
      .join(", ");

    console.log("Seeded guest OTP on latest checked-in stay:");
    console.log(`  stayId:  ${updated.id}`);
    console.log(`  guest:   ${guestName}`);
    console.log(`  rooms:   ${rooms || "—"}`);
    console.log(`  otp:     ${OTP}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
