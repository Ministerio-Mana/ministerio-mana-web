import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import sharp from 'sharp';

const sourceRoot = path.resolve(process.argv[2] || '');
const outputRoot = path.resolve(process.argv[3] || '/private/tmp/cumbre-2026-web');
const concurrency = Math.max(1, Math.min(6, Number(process.env.GALLERY_CONCURRENCY || 3)));

if (!process.argv[2]) {
  console.error('Uso: node scripts/prepare-event-gallery.mjs <carpeta-origen> [carpeta-salida]');
  process.exit(1);
}

function normalizedName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .trim();
}

function slug(value) {
  return normalizedName(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'general';
}

function safeBaseName(value) {
  return slug(path.parse(value).name).slice(0, 80) || 'foto';
}

function isSupportedImage(fileName) {
  return /\.(jpe?g)$/i.test(fileName);
}

async function collectImages() {
  const albums = await readdir(sourceRoot, { withFileTypes: true });
  const files = [];
  const excluded = [];

  for (const albumEntry of albums.sort((a, b) => a.name.localeCompare(b.name, 'es'))) {
    if (!albumEntry.isDirectory()) continue;
    if (normalizedName(albumEntry.name) === 'NINOS') {
      excluded.push(albumEntry.name);
      continue;
    }

    const albumPath = path.join(sourceRoot, albumEntry.name);
    const stack = [albumPath];
    while (stack.length) {
      const current = stack.pop();
      const entries = await readdir(current, { withFileTypes: true });
      for (const entry of entries) {
        const absolutePath = path.join(current, entry.name);
        if (entry.isDirectory()) stack.push(absolutePath);
        else if (entry.isFile() && isSupportedImage(entry.name)) {
          files.push({
            album: albumEntry.name,
            albumSlug: slug(albumEntry.name),
            sourcePath: absolutePath,
            relativePath: path.relative(sourceRoot, absolutePath),
            originalName: entry.name,
          });
        }
      }
    }
  }

  return { files, excluded };
}

async function optimizeImage(item, index) {
  const source = await readFile(item.sourcePath);
  const sourceHash = createHash('sha256').update(source).digest('hex');
  const fileName = `${String(index + 1).padStart(4, '0')}-${safeBaseName(item.originalName)}-${sourceHash.slice(0, 8)}.jpg`;
  const albumOutput = path.join(outputRoot, item.albumSlug);
  const outputPath = path.join(albumOutput, fileName);
  await mkdir(albumOutput, { recursive: true });

  const image = sharp(source, { failOn: 'warning' })
    .rotate()
    .toColourspace('srgb')
    .resize({
      width: 2400,
      height: 2400,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({ quality: 82, progressive: true, mozjpeg: true, chromaSubsampling: '4:2:0' });

  const result = await image.toFile(outputPath);
  return {
    album: item.album,
    album_slug: item.albumSlug,
    original_name: item.originalName,
    original_relative_path: item.relativePath,
    output_relative_path: path.relative(outputRoot, outputPath),
    source_sha256: sourceHash,
    source_bytes: source.byteLength,
    output_bytes: result.size,
    width: result.width,
    height: result.height,
    format: result.format,
  };
}

async function runPool(items) {
  const results = new Array(items.length);
  const failures = [];
  let cursor = 0;
  let completed = 0;

  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      try {
        results[index] = await optimizeImage(items[index], index);
      } catch (error) {
        failures.push({
          source: items[index].relativePath,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      completed += 1;
      if (completed % 25 === 0 || completed === items.length) {
        console.log(`Procesadas ${completed}/${items.length}`);
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return { results: results.filter(Boolean), failures };
}

await mkdir(outputRoot, { recursive: true });
const { files, excluded } = await collectImages();
console.log(`Origen: ${sourceRoot}`);
console.log(`Salida: ${outputRoot}`);
console.log(`Carpetas excluidas: ${excluded.join(', ') || 'ninguna'}`);
console.log(`Imágenes encontradas: ${files.length}`);

const startedAt = new Date().toISOString();
const { results, failures } = await runPool(files);
const sourceBytes = results.reduce((total, item) => total + item.source_bytes, 0);
const outputBytes = results.reduce((total, item) => total + item.output_bytes, 0);
const albums = Object.values(results.reduce((grouped, item) => {
  grouped[item.album_slug] ||= {
    name: item.album,
    slug: item.album_slug,
    images: 0,
    bytes: 0,
  };
  grouped[item.album_slug].images += 1;
  grouped[item.album_slug].bytes += item.output_bytes;
  return grouped;
}, {}));

const manifest = {
  event: 'Cumbre Mundial Mana 2026',
  source_root: sourceRoot,
  output_root: outputRoot,
  started_at: startedAt,
  completed_at: new Date().toISOString(),
  excluded_folders: excluded,
  source_images: files.length,
  optimized_images: results.length,
  failed_images: failures.length,
  source_bytes: sourceBytes,
  output_bytes: outputBytes,
  settings: {
    max_width: 2400,
    max_height: 2400,
    format: 'jpeg',
    quality: 82,
    metadata_removed: true,
  },
  albums,
  failures,
  images: results,
};

await writeFile(path.join(outputRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(`Resultado: ${(outputBytes / 1073741824).toFixed(3)} GiB (${results.length} imágenes, ${failures.length} errores)`);
