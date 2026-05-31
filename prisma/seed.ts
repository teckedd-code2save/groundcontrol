import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const existing = await prisma.user.findUnique({ where: { username: "admin" } });
  if (existing) {
    console.log("User 'admin' already exists.");
    return;
  }

  const hash = await bcrypt.hash("groundcontrol2024", 12);
  await prisma.user.create({
    data: {
      username: "admin",
      password: hash,
      role: "admin",
    },
  });

  console.log("Created default admin user.");
  console.log("Username: admin");
  console.log("Password: groundcontrol2024");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
