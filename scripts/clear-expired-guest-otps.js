/**
 * Expire room codes on closed stays (checked_out / cancelled).
 * Run: node scripts/clear-expired-guest-otps.js
 */
import { createPrismaClient } from "../lib/prismaClient.js";

async function main() {
  const prisma = createPrismaClient();
  try {
    const result = await prisma.lodging_stay.updateMany({
      where: {
        guestOtp: { not: null },
        status: { in: ["checked_out", "cancelled"] },
      },
      data: {
        guestOtp: null,
        guestOtpIssuedAt: null,
      },
    });
    console.log(
      `Cleared guest OTP on ${result.count} closed stay(s) (checked_out/cancelled).`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
