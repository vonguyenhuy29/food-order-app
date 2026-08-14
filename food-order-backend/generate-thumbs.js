const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const IMAGES_DIR = path.join(PUBLIC_DIR, 'images');
const THUMBS_DIR = path.join(PUBLIC_DIR, 'thumbs');

const SKIP_FOLDERS = new Set([
  '__MASTER__',
  '_MASTER_',
  'SOURCE',
  'thumbs',
]);

const VALID_EXT = /\.(jpg|jpeg|png|webp)$/i;

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;

  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);

    if (ent.isDirectory()) {
      if (SKIP_FOLDERS.has(ent.name)) continue;
      walk(full, out);
      continue;
    }

    if (ent.isFile() && VALID_EXT.test(ent.name)) {
      out.push(full);
    }
  }

  return out;
}

async function main() {
  ensureDir(THUMBS_DIR);

  const files = walk(IMAGES_DIR);
  let created = 0;
  let skipped = 0;
  let failed = 0;

  for (const src of files) {
    try {
      const rel = path.relative(IMAGES_DIR, src);
      const relNoExt = rel.replace(/\.[^.]+$/i, '.webp');
      const dest = path.join(THUMBS_DIR, relNoExt);

      ensureDir(path.dirname(dest));

      const srcStat = fs.statSync(src);

      if (fs.existsSync(dest)) {
        const destStat = fs.statSync(dest);

        // Nếu thumbnail mới hơn ảnh gốc thì bỏ qua
        if (destStat.mtimeMs >= srcStat.mtimeMs) {
          skipped += 1;
          continue;
        }
      }

      await sharp(src)
        .rotate()
        .resize({
          width: 700,
          withoutEnlargement: true,
        })
        .webp({
          quality: 76,
          effort: 4,
        })
        .toFile(dest);

      created += 1;
      console.log(`OK: ${rel} -> ${path.relative(THUMBS_DIR, dest)}`);
    } catch (e) {
      failed += 1;
      console.error(`FAIL: ${src}`, e.message);
    }
  }

  console.log('');
  console.log(`Done. Created/updated: ${created}, skipped: ${skipped}, failed: ${failed}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});