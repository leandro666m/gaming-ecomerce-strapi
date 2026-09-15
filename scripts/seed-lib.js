'use strict';

const fs = require('fs');
const path = require('path');
const { PLATFORMS, GAMES } = require('./seed-data');

const TMP_DIR = path.join(__dirname, '.tmp');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function sanitizeFilename(name) {
  return name.replace(/[^a-z0-9.-]/gi, '_').toLowerCase();
}

function slugify(title) {
  return title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function getExtensionFromUrl(url, contentType) {
  if (contentType?.includes('png')) return '.png';
  if (contentType?.includes('webp')) return '.webp';
  if (contentType?.includes('svg')) return '.svg';
  if (contentType?.includes('jpeg') || contentType?.includes('jpg')) return '.jpg';

  const pathname = new URL(url).pathname.toLowerCase();
  if (pathname.endsWith('.png')) return '.png';
  if (pathname.endsWith('.webp')) return '.webp';
  if (pathname.endsWith('.svg')) return '.svg';
  if (pathname.endsWith('.jpg') || pathname.endsWith('.jpeg')) return '.jpg';

  return '.jpg';
}

async function downloadFile(url, filename) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'GamingEcommerceSeed/1.0 (local-dev; contact@localhost)',
      Accept: 'image/*,*/*',
    },
  });

  if (!response.ok) {
    throw new Error(`No se pudo descargar ${url} (${response.status})`);
  }

  const contentType = response.headers.get('content-type') || '';
  const extension = getExtensionFromUrl(url, contentType);
  const filePath = path.join(TMP_DIR, `${filename}${extension}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(filePath, buffer);

  return {
    filePath,
    mime: contentType.split(';')[0] || 'image/jpeg',
    size: buffer.length,
  };
}

async function uploadImage(strapi, url, filename) {
  const downloaded = await downloadFile(url, filename);
  const baseName = path.basename(downloaded.filePath);

  const uploaded = await strapi.plugin('upload').service('upload').upload({
    data: {},
    files: {
      path: downloaded.filePath,
      name: baseName,
      type: downloaded.mime,
      size: downloaded.size,
    },
  });

  return uploaded[0].id;
}

async function fetchSteamAssets(steamId) {
  const response = await fetch(
    `https://store.steampowered.com/api/appdetails?appids=${steamId}&l=spanish`
  );

  if (!response.ok) {
    throw new Error(`Steam API error for app ${steamId}`);
  }

  const payload = await response.json();
  const entry = payload[String(steamId)];

  if (!entry?.success || !entry.data) {
    throw new Error(`Steam no devolvió datos para app ${steamId}`);
  }

  const data = entry.data;
  const screenshots = (data.screenshots || [])
    .slice(0, 5)
    .map((shot) => shot.path_full);

  if (screenshots.length < 4) {
    throw new Error(`Steam app ${steamId} no tiene suficientes screenshots`);
  }

  return {
    summary: data.short_description || data.about_the_game?.slice(0, 500) || data.name,
    cover: data.header_image,
    wallpaper: data.background_raw || data.background || data.header_image,
    screenshots,
  };
}

async function resolveGameAssets(game) {
  if (game.assets) {
    return {
      summary: game.summary,
      cover: game.assets.cover,
      wallpaper: game.assets.wallpaper,
      screenshots: game.assets.screenshots.slice(0, 5),
    };
  }

  return fetchSteamAssets(game.steamId);
}

async function clearSeedData(strapi) {
  const games = await strapi.db.query('api::game.game').findMany();
  for (const game of games) {
    await strapi.entityService.delete('api::game.game', game.id);
  }

  const platforms = await strapi.db.query('api::platform.platform').findMany();
  for (const platform of platforms) {
    await strapi.entityService.delete('api::platform.platform', platform.id);
  }
}

async function getPlatformMap(strapi) {
  const existing = await strapi.db.query('api::platform.platform').findMany();
  const platformMap = {};

  for (const platform of existing) {
    platformMap[platform.slug] = platform.id;
  }

  for (const platform of PLATFORMS) {
    if (platformMap[platform.slug]) {
      continue;
    }

    const iconId = await uploadImage(
      strapi,
      platform.iconUrl,
      `platform-${platform.slug}`
    );

    const created = await strapi.entityService.create('api::platform.platform', {
      data: {
        title: platform.title,
        slug: platform.slug,
        order: platform.order,
        icon: iconId,
        publishedAt: new Date(),
      },
    });

    platformMap[platform.slug] = created.id;
    strapi.log.info(`[seed]   ✓ ${platform.title}`);
  }

  return platformMap;
}

async function seed(strapi) {
  ensureDir(TMP_DIR);

  try {
    const forceSeed = process.env.FORCE_SEED === 'true';
    const platformCount = await strapi.db.query('api::platform.platform').count();
    const gameCount = await strapi.db.query('api::game.game').count();
    const isComplete = platformCount >= PLATFORMS.length && gameCount >= GAMES.length;

    if (isComplete && !forceSeed) {
      strapi.log.info('[seed] Base de datos ya poblada.');
      return;
    }

    if (forceSeed && (platformCount > 0 || gameCount > 0)) {
      strapi.log.info('[seed] Limpiando datos existentes...');
      await clearSeedData(strapi);
    }

    const existingGames = await strapi.db.query('api::game.game').findMany({
      select: ['title'],
    });
    const existingTitles = new Set(existingGames.map((game) => game.title));

    if (platformCount < PLATFORMS.length) {
      strapi.log.info('[seed] Creando plataformas...');
    } else {
      strapi.log.info('[seed] Plataformas existentes detectadas, continuando...');
    }

    const platformMap = await getPlatformMap(strapi);

    strapi.log.info('[seed] Creando juegos...');
    for (const game of GAMES) {
      if (existingTitles.has(game.title)) {
        strapi.log.info(`[seed]   ↷ ${game.title} (ya existe)`);
        continue;
      }

      const assets = await resolveGameAssets(game);
      const slugBase = sanitizeFilename(game.title);

      const coverId = await uploadImage(strapi, assets.cover, `${slugBase}-cover`);
      const wallpaperId = await uploadImage(
        strapi,
        assets.wallpaper,
        `${slugBase}-wallpaper`
      );

      const screenshotIds = [];
      for (let index = 0; index < assets.screenshots.length; index += 1) {
        const screenshotId = await uploadImage(
          strapi,
          assets.screenshots[index],
          `${slugBase}-screenshot-${index + 1}`
        );
        screenshotIds.push(screenshotId);
      }

      await strapi.entityService.create('api::game.game', {
        data: {
          title: game.title,
          slug: slugify(game.title),
          platform: platformMap[game.platformSlug],
          price: game.price,
          discount: game.discount ?? 0,
          summary: assets.summary,
          video: game.video,
          cover: coverId,
          wallpaper: wallpaperId,
          screenshots: screenshotIds,
          releaseDate: game.releaseDate,
          publishedAt: new Date(),
        },
      });

      strapi.log.info(`[seed]   ✓ ${game.title} (${game.platformSlug})`);
    }

    strapi.log.info(`[seed] Completado: ${PLATFORMS.length} plataformas, ${GAMES.length} juegos.`);
  } finally {
    if (fs.existsSync(TMP_DIR)) {
      fs.rmSync(TMP_DIR, { recursive: true, force: true });
    }
  }
}

async function enablePublicApiAccess(strapi) {
  const publicRole = await strapi.db
    .query('plugin::users-permissions.role')
    .findOne({ where: { type: 'public' } });

  if (!publicRole) {
    return;
  }

  const actions = [
    'api::platform.platform.find',
    'api::platform.platform.findOne',
    'api::game.game.find',
    'api::game.game.findOne',
  ];

  for (const action of actions) {
    let permission = await strapi.db
      .query('plugin::users-permissions.permission')
      .findOne({ where: { action } });

    if (!permission) {
      permission = await strapi.db.query('plugin::users-permissions.permission').create({
        data: { action },
      });
    }

    const existingLink = await strapi.db
      .connection('up_permissions_role_links')
      .where({ permission_id: permission.id, role_id: publicRole.id })
      .first();

    if (!existingLink) {
      await strapi.db.connection('up_permissions_role_links').insert({
        permission_id: permission.id,
        role_id: publicRole.id,
        permission_order: 1,
      });
    }
  }

  strapi.log.info('[seed] Permisos publicos habilitados para games y platforms.');
}

module.exports = { seed, enablePublicApiAccess };
