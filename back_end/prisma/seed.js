const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient();

async function main() {
  const hashedPassword = await bcrypt.hash('StrongAdminPass123!', 10);

  await prisma.user.upsert({
    where: { email: 'ariori200@gmail.com' },
    update: {},
    create: {
      email: 'ariori200@gmail.com',
      password: hashedPassword,
      role: 'ADMIN',
    },
  });

  console.log('Admin seeded.');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
