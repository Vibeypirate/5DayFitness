import { prisma } from '../src/db.js';

async function main() {
  console.log('No default seed data. Use /setup in Telegram groups to initialize records.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
