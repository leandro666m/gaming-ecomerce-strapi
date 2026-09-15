'use strict';

const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

process.env.SKIP_BOOTSTRAP_SEED = 'true';

const { seed, enablePublicApiAccess } = require('./seed-lib');

async function main() {
  const strapiFactory = require('@strapi/strapi');
  const app = strapiFactory();

  await app.load();
  app.log.level = 'info';

  try {
    await enablePublicApiAccess(app);
    await seed(app);
  } finally {
    await app.destroy();
  }
}

main().catch((error) => {
  console.error('Error en seed:', error);
  process.exit(1);
});
