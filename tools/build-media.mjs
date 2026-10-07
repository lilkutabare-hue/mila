#!/usr/bin/env node
// Media pipeline: media-src/<category>/<project>/files  →  public/media/{rail,full,poster}/…
// Sources are read-only. Outputs are webp/mp4 with clean [a-z0-9-] names and no metadata.
import sharp from 'sharp';
import ffmpegPath from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, stat, mkdir, readFile, writeFile, unlink, rm, utimes } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname, basename, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'media-src');
const PUB = join(ROOT, 'docs');   // GitHub Pages serves this folder
const MEDIA = join(PUB, 'media');
const CONTENT = join(ROOT, 'content');
const CACHE_FILE = join(ROOT, 'tools', '.media-cache.json');
const FFPROBE = ffprobeStatic.path;
const FFMPEG = ffmpegPath;

const IMG_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif']);
const VID_EXT = new Set(['.mov', '.mp4', '.m4v']);
const TIER = {
  smallH: 600, smallQ: 80,
  railH: 1200, railQ: 84,
  fullLong: 2560, fullQ: 86,
  teaserSec: 12, teaserH: 1080, teaserCrf: 27, teaserSmallH: 480, teaserSmallCrf: 30,
  fullShort: 1080, fullCrf: 22,
};
const BUDGET = { railPhotoAvg: 220e3, railTeaser: 2.5e6, fullPhoto: 900e3, fullVideoPerSec: 0.6e6 };
const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
const natural = (a, b) => collator.compare(a, b);

// ---------- helpers ----------
const TRANSLIT = { а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'yo',ж:'zh',з:'z',и:'i',й:'y',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'h',ц:'ts',ч:'ch',ш:'sh',щ:'sch',ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya' };
export function slugify(s) {
  return s.toLowerCase().normalize('NFKD')
    .replace(/[а-яё]/g, ch => TRANSLIT[ch] ?? '')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'untitled';
}
export function titleFromFolder(name) {
  return name.trim().replace(/_([^_]+)_/g, '“$1”').replace(/\s+/g, ' ');
}
function hashFile(p) {
  return new Promise((res, rej) => {
    const h = createHash('sha1');
    createReadStream(p).on('data', d => h.update(d)).on('error', rej).on('end', () => res(h.digest('hex')));
  });
}
async function readJSON(p, fallback) {
  try { return JSON.parse(await readFile(p, 'utf8')); } catch { return fallback; }
}
async function writeJSON(p, obj) {
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, JSON.stringify(obj, null, 2) + '\n');
}
const fmtKB = n => (n / 1024).toFixed(0) + ' KB';
const fmtMB = n => (n / 1048576).toFixed(2) + ' MB';
async function fsize(p) { try { return (await stat(p)).size; } catch { return 0; } }
async function mtime(p) { try { return (await stat(p)).mtimeMs; } catch { return 0; } }
async function pmap(list, n, fn) {
  const out = new Array(list.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, list.length) }, async () => {
    while (i < list.length) { const k = i++; out[k] = await fn(list[k], k); }
  }));
  return out;
}

// ---------- scan ----------
async function scan() {
  const projects = []; const report = { empty: [], dupes: [], small: [] };
  const cats = (await readdir(SRC, { withFileTypes: true })).filter(d => d.isDirectory() && !d.name.startsWith('.')).map(d => d.name).sort(natural);
  for (const cat of cats) {
    const entries = (await readdir(join(SRC, cat), { withFileTypes: true })).filter(d => !d.name.startsWith('.'));
    for (const ent of entries.sort((a, b) => natural(a.name, b.name))) {
      if (ent.isDirectory()) {
        const dir = join(SRC, cat, ent.name);
        const files = (await readdir(dir)).filter(f => !f.startsWith('.') && (IMG_EXT.has(extname(f).toLowerCase()) || VID_EXT.has(extname(f).toLowerCase()))).sort(natural);
        if (!files.length) { report.empty.push(`${cat}/${ent.name}`); continue; }
        projects.push({ category: cat, folder: ent.name, key: `${cat}/${ent.name}`, title: titleFromFolder(ent.name), files: files.map(f => ({ name: f, path: join(dir, f), key: `${cat}/${ent.name}/${f}` })) });
      } else if (ent.isFile()) {
        const ext = extname(ent.name).toLowerCase();
        if (!IMG_EXT.has(ext) && !VID_EXT.has(ext)) continue;
        const base = ent.name.slice(0, -ext.length);
        projects.push({ category: cat, folder: ent.name, key: `${cat}/${ent.name}`, title: titleFromFolder(base), files: [{ name: ent.name, path: join(SRC, cat, ent.name), key: `${cat}/${ent.name}` }] });
      }
    }
  }
  // hash, dedupe, pair live photos
  for (const p of projects) {
    const seen = new Map(); const items = [];
    for (const f of p.files) {
      f.hash = await hashFile(f.path);
      if (seen.has(f.hash)) { report.dupes.push(`${f.key}  (same as ${seen.get(f.hash)})`); continue; }
      seen.set(f.hash, f.name);
      items.push(f);
    }
    // Live Photo: image + mov with same basename → motion, image is the poster
    const byBase = new Map();
    for (const f of items) { const b = f.name.slice(0, -extname(f.name).length).toLowerCase(); if (!byBase.has(b)) byBase.set(b, []); byBase.get(b).push(f); }
    const merged = [];
    for (const f of items) {
      const ext = extname(f.name).toLowerCase();
      const b = f.name.slice(0, -ext.length).toLowerCase();
      const group = byBase.get(b);
      const img = group.find(g => IMG_EXT.has(extname(g.name).toLowerCase()));
      const vid = group.find(g => VID_EXT.has(extname(g.name).toLowerCase()));
      if (img && vid) {
        if (f === img) merged.push({ ...vid, type: 'motion', poster: img, key: vid.key, livePhoto: true, hash: vid.hash });
        continue; // skip the mov itself and the image (already merged)
      }
      merged.push({ ...f, type: VID_EXT.has(ext) ? 'motion' : 'photo' });
    }
    p.items = merged;
  }
  return { projects, report };
}

// ---------- processing ----------
let tmpDir;
async function heicToJpeg(src) {
  tmpDir ||= join(tmpdir(), 'mila-media-' + process.pid);
  await mkdir(tmpDir, { recursive: true });
  const out = join(tmpDir, createHash('md5').update(src).digest('hex') + '.jpg');
  if (!existsSync(out)) await run('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '95', src, '--out', out]);
  return out;
}
async function imageInput(src) {
  const ext = extname(src).toLowerCase();
  return (ext === '.heic' || ext === '.heif') ? heicToJpeg(src) : src;
}
async function orientedSize(input) {
  const m = await sharp(input).metadata();
  const swap = m.orientation && m.orientation >= 5;
  return { w: swap ? m.height : m.width, h: swap ? m.width : m.height };
}
async function buildPhoto(input, outRail, outFull, outSmall) {
  const r = await sharp(input).rotate().resize({ height: TIER.railH, withoutEnlargement: true }).webp({ quality: TIER.railQ, effort: 5 }).toFile(outRail);
  const f = await sharp(input).rotate().resize({ width: TIER.fullLong, height: TIER.fullLong, fit: 'inside', withoutEnlargement: true }).webp({ quality: TIER.fullQ, effort: 5 }).toFile(outFull);
  const sm = outSmall ? await sharp(input).rotate().resize({ height: TIER.smallH, withoutEnlargement: true }).webp({ quality: TIER.smallQ, effort: 5 }).toFile(outSmall) : null;
  return { rail: { w: r.width, h: r.height }, full: { w: f.width, h: f.height }, small: sm ? { w: sm.width, h: sm.height } : null };
}
async function probeVideo(src) {
  const { stdout } = await run(FFPROBE, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', src]);
  const j = JSON.parse(stdout);
  const v = j.streams.find(s => s.codec_type === 'video');
  const a = j.streams.find(s => s.codec_type === 'audio');
  const rot = Math.abs(Number(v.tags?.rotate ?? 0)) % 180 === 90 || (v.side_data_list || []).some(d => Math.abs(Number(d.rotation ?? 0)) % 180 === 90);
  const [n, d] = (v.r_frame_rate || '30/1').split('/').map(Number);
  return { w: rot ? v.height : v.width, h: rot ? v.width : v.height, fps: d ? n / d : 30, duration: Number(j.format.duration), hasAudio: !!a };
}
async function buildVideo(src, info, teaserStart, outRail, outFull, outPosterRail, outPosterFull) {
  const common = ['-y', '-hide_banner', '-loglevel', 'error', '-map_metadata', '-1', '-map_chapters', '-1', '-movflags', '+faststart', '-pix_fmt', 'yuv420p'];
  const fps = Math.min(30, info.fps);
  const start = Math.max(0, Math.min(teaserStart, Math.max(0, info.duration - TIER.teaserSec)));
  // rail teaser + small teaser
  await run(FFMPEG, ['-ss', String(start), '-t', String(TIER.teaserSec), '-i', src,
    '-vf', `scale=-2:'min(${TIER.teaserH},ih)',fps=${fps}`,
    '-an', '-c:v', 'libx264', '-crf', String(TIER.teaserCrf), '-preset', 'slow', '-profile:v', 'high', ...common, outRail]);
  const outSmall = outRail.replace('/rail/', '/small/');
  await run(FFMPEG, ['-ss', String(start), '-t', String(TIER.teaserSec), '-i', src,
    '-vf', `scale=-2:'min(${TIER.teaserSmallH},ih)',fps=${Math.min(24, fps)}`,
    '-an', '-c:v', 'libx264', '-crf', String(TIER.teaserSmallCrf), '-preset', 'slow', '-profile:v', 'high', ...common, outSmall]);
  // full
  const fullArgs = ['-i', src, '-vf', `scale='if(gt(iw,ih),-2,min(${TIER.fullShort},iw))':'if(gt(iw,ih),min(${TIER.fullShort},ih),-2)'`,
    '-c:v', 'libx264', '-crf', String(TIER.fullCrf), '-preset', 'slow', '-profile:v', 'high', '-maxrate', '6M', '-bufsize', '12M'];
  if (info.hasAudio) fullArgs.push('-c:a', 'aac', '-b:a', '128k', '-ac', '2'); else fullArgs.push('-an');
  await run(FFMPEG, [...fullArgs, ...common, outFull]);
  // poster frame → both tiers
  const frame = join(tmpDir ||= join(tmpdir(), 'mila-media-' + process.pid), basename(outRail, '.mp4') + '-poster.png');
  await mkdir(tmpDir, { recursive: true });
  await run(FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error', '-ss', String(Math.min(start + 0.3, Math.max(0, info.duration - 0.1))), '-i', src, '-frames:v', '1', frame]);
  const pr = await sharp(frame).resize({ height: TIER.railH, withoutEnlargement: true }).webp({ quality: TIER.railQ }).toFile(outPosterRail);
  const pf = await sharp(frame).resize({ width: TIER.fullLong, height: TIER.fullLong, fit: 'inside', withoutEnlargement: true }).webp({ quality: TIER.fullQ }).toFile(outPosterFull);
  return { posterRail: { w: pr.width, h: pr.height }, posterFull: { w: pf.width, h: pf.height } };
}
async function videoSize(p) {
  const { stdout } = await run(FFPROBE, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', p]);
  const [w, h] = stdout.trim().split(',').map(Number); return { w, h };
}

// ---------- og / icons ----------
async function buildBranding(firstFrames, site) {
  const W = 1200, H = 630; const n = Math.max(1, firstFrames.length); const colW = Math.floor(W / n);
  const parts = [];
  for (let i = 0; i < n; i++) {
    const buf = await sharp(firstFrames[i]).resize({ width: colW + (i === n - 1 ? W - colW * n : 0), height: H, fit: 'cover' }).toBuffer();
    parts.push({ input: buf, left: colW * i, top: 0 });
  }
  const label = Buffer.from(`<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <rect x="40" y="${H - 110}" width="${W - 80}" height="70" rx="2" fill="#F2F0EB" fill-opacity="0.94"/>
    <text x="64" y="${H - 62}" font-family="Instrument Serif, Georgia, 'Times New Roman', serif" font-style="italic" font-size="44" fill="#141414">${site.name}</text>
    <text x="${W - 64}" y="${H - 66}" text-anchor="end" font-family="IBM Plex Mono, Menlo, monospace" font-size="18" letter-spacing="1.2" fill="#8A867E">INSTAGRAM @${site.instagram.toUpperCase()}</text>
  </svg>`);
  await sharp({ create: { width: W, height: H, channels: 3, background: '#F2F0EB' } }).composite([...parts, { input: label, left: 0, top: 0 }]).jpeg({ quality: 86 }).toFile(join(PUB, 'og.jpg'));
  const mono = s => Buffer.from(`<svg width="${s}" height="${s}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${s}" height="${s}" rx="${Math.round(s * 0.18)}" fill="#F2F0EB"/>
    <text x="50%" y="${Math.round(s * 0.69)}" text-anchor="middle" font-family="Instrument Serif, Georgia, 'Times New Roman', serif" font-style="italic" font-size="${Math.round(s * 0.62)}" fill="#141414">mh</text>
  </svg>`);
  await sharp(mono(64)).png().toFile(join(PUB, 'favicon.png'));
  await sharp(mono(180)).png().toFile(join(PUB, 'apple-touch-icon.png'));
}

// ---------- favicon, touch icon and og image from content/brand/seal.* ----------
async function findSeal() {
  for (const n of ['seal.png', 'seal.webp', 'seal.jpg', 'seal.jpeg']) { const p = join(CONTENT, 'brand', n); if (existsSync(p)) return p; }
  return null;
}
// cut the dark seal out of its paper background: alpha from colour distance to the paper, feathered
async function cutoutSeal(src, size) {
  const { data, info } = await sharp(src).resize(size, size, { fit: 'cover' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height, C = info.channels;
  // 1. wax vs everything else by colour: wax is plum (red and blue above green), paper and the cast shadow are neutral
  const m = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) { const r = data[i * C], g = data[i * C + 1], b = data[i * C + 2]; m[i] = (r + b) / 2 - g > 9 && r + g + b < 560 ? 255 : 0; }
  // 2. close holes (glossy highlights) with a wide blur + threshold
  const { data: wide, info: wi } = await sharp(Buffer.from(m), { raw: { width: W, height: H, channels: 1 } }).blur(7).raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < W * H; i++) m[i] = wide[i * wi.channels] > 128 ? 255 : 0;
  // 3. centroid, then the outline as a radius per angle: outermost wax pixel on each ray
  let bx0 = W, by0 = H, bx1 = 0, by1 = 0; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (m[y * W + x]) { if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y; }
  const cx = (bx0 + bx1) / 2, cy = (by0 + by1) / 2, N = 720, R = new Float64Array(N), maxR = Math.hypot(W, H) / 2;
  for (let k = 0; k < N; k++) {
    const a = k / N * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a); let last = 0;
    for (let r = 0; r < maxR; r += 0.5) { const x = Math.round(cx + ca * r), y = Math.round(cy + sa * r); if (x < 0 || y < 0 || x >= W || y >= H) break; if (m[y * W + x]) last = r; }   // outermost wax pixel: gaps inside do not matter
    R[k] = last;
  }
  // 4. smooth the outline: median over ±5° kills spikes, then a circular low-pass keeps the hand-poured shape but makes the line clean
  const med = new Float64Array(N); for (let k = 0; k < N; k++) { const w = []; for (let d = -10; d <= 10; d++) w.push(R[(k + d + N) % N]); w.sort((a, b) => a - b); med[k] = w[10]; }
  let sm = med; for (let pass = 0; pass < 3; pass++) { const t = new Float64Array(N); for (let k = 0; k < N; k++) { let acc = 0, ws = 0; for (let d = -8; d <= 8; d++) { const g = Math.exp(-d * d / 32); acc += sm[(k + d + N) % N] * g; ws += g; } t[k] = acc / ws; } sm = t; }
  for (let k = 0; k < N; k++) sm[k] -= 1.5;                      // sit just inside the rim: no paper, no shadow
  // 5. antialiased alpha from the smooth outline; edge pixels take the wax colour
  let wr = 0, wg = 0, wb = 0, wn = 0; for (let i = 0; i < W * H; i++) if (m[i]) { wr += data[i * C]; wg += data[i * C + 1]; wb += data[i * C + 2]; wn++; }
  const wax = [wr / wn, wg / wn, wb / wn];
  const rgba = Buffer.alloc(W * H * 4); let x0 = W, y0 = H, x1 = 0, y1 = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const dx = x - cx, dy = y - cy, r = Math.hypot(dx, dy); let a = Math.atan2(dy, dx); if (a < 0) a += Math.PI * 2;
    const f = a / (Math.PI * 2) * N, k0 = Math.floor(f) % N, k1 = (k0 + 1) % N, t = f - Math.floor(f);
    const al = Math.max(0, Math.min(1, sm[k0] * (1 - t) + sm[k1] * t - r + 0.5));
    const i = y * W + x, k = al >= 1 ? 0 : 0.7;
    rgba[i * 4] = data[i * C] * (1 - k) + wax[0] * k; rgba[i * 4 + 1] = data[i * C + 1] * (1 - k) + wax[1] * k; rgba[i * 4 + 2] = data[i * C + 2] * (1 - k) + wax[2] * k; rgba[i * 4 + 3] = Math.round(al * 255);
    if (al > 0.5) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  const side = Math.min(W, H, Math.round(Math.max(x1 - x0, y1 - y0) * 1.04));
  const left = Math.max(0, Math.min(W - side, Math.round((x0 + x1) / 2 - side / 2))), top = Math.max(0, Math.min(H - side, Math.round((y0 + y1) / 2 - side / 2)));
  const png = await sharp(rgba, { raw: { width: W, height: H, channels: 4 } }).extract({ left, top, width: side, height: side }).png().toBuffer();
  return { png };
}
async function buildBrandFromSeal(sealPath, site) {
  const { png: cut } = await cutoutSeal(sealPath, 1024);
  // tighter crop for tiny sizes: the seal fills the square edge to edge
  const tight = await sharp(cut).trim().toBuffer();
  const sq = async (n) => sharp(tight).resize(n, n, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 }, kernel: 'lanczos3' }).sharpen({ sigma: n <= 48 ? 0.6 : 0.3 }).png().toBuffer();
  await writeFile(join(PUB, 'favicon.png'), await sq(64));
  // favicon.ico with PNG entries 16 / 32 / 48 (what Tilda's site settings ask for)
  const sizes = [16, 32, 48], pngs = []; for (const n of sizes) pngs.push(await sq(n));
  const head = Buffer.alloc(6 + 16 * sizes.length); head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(sizes.length, 4);
  let off = head.length;
  sizes.forEach((n, i) => { const e = 6 + 16 * i; head.writeUInt8(n, e); head.writeUInt8(n, e + 1); head.writeUInt8(0, e + 2); head.writeUInt8(0, e + 3); head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6); head.writeUInt32LE(pngs[i].length, e + 8); head.writeUInt32LE(off, e + 12); off += pngs[i].length; });
  await writeFile(join(PUB, 'favicon.ico'), Buffer.concat([head, ...pngs]));
  // files to upload by hand into Tilda: site settings → favicon / icons
  const outDir = join(ROOT, 'tilda', 'icons'); await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, 'favicon.ico'), Buffer.concat([head, ...pngs]));
  for (const n of [152, 180, 270, 512]) await writeFile(join(outDir, `icon-${n}.png`), await sq(n));
  for (const n of [152, 180]) await sharp({ create: { width: n, height: n, channels: 3, background: '#F2F0EB' } }).composite([{ input: await sq(Math.round(n * 0.84)), gravity: 'centre' }]).png().toFile(join(outDir, `icon-${n}-paper.png`));
  await sharp({ create: { width: 180, height: 180, channels: 3, background: '#F2F0EB' } })
    .composite([{ input: await sharp(cut).resize(150, 150).png().toBuffer(), left: 15, top: 15 }]).png().toFile(join(PUB, 'apple-touch-icon.png'));
  const W = 1200, H = 630, S = 470;
  await sharp({ create: { width: W, height: H, channels: 3, background: '#F2F0EB' } })
    .composite([{ input: await sharp(cut).resize(S, S).png().toBuffer(), left: Math.round((W - S) / 2), top: Math.round((H - S) / 2) }])
    .jpeg({ quality: 88 }).toFile(join(PUB, 'og.jpg'));
}

// ---------- index.html: meta + noscript ----------
const escHtml = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const tidy = s => (s && /^TODO/i.test(s)) ? s.replace(/^TODO:?\s*/i, '') : (s || '');
async function injectHtml(site, manifest, byId) {
  const file = join(PUB, 'index.html');
  let html = await readFile(file, 'utf8');
  const name = site.name || 'mila harys', role = tidy(site.role), desc = tidy(site.description) || [name, role].filter(Boolean).join(' — ');
  const title = [name, role].filter(Boolean).join(' — ');
  const base = tidy(site.url).replace(/\/$/, '');
  const og = base ? `${base}/og.jpg` : 'og.jpg';
  const meta = `<title>${escHtml(title)}</title>
<meta name="description" content="${escHtml(desc)}">
<meta name="theme-color" content="#F2F0EB">
<meta property="og:type" content="website">
<meta property="og:title" content="${escHtml(title)}">
<meta property="og:description" content="${escHtml(desc)}">
<meta property="og:image" content="${escHtml(og)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">${base ? `\n<meta property="og:url" content="${escHtml(base)}/">` : ''}
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escHtml(title)}">
<meta name="twitter:description" content="${escHtml(desc)}">
<meta name="twitter:image" content="${escHtml(og)}">`;
  const list = manifest.projects.map(p => {
    const items = p.items.map(id => byId.get(id)).filter(i => i && i.onRail).map(i => `<li><img src="${escHtml(i.type === 'photo' ? i.rail.src : i.poster.rail)}" width="${i.rail.w}" height="${i.rail.h}" alt="${escHtml(p.title)}" loading="lazy"></li>`).join('');
    return `<li><h2>${escHtml(p.title)} — ${escHtml(p.categoryLabel)}</h2><ul>${items}</ul></li>`;
  }).join('\n');
  const noscript = `<noscript><style>html,body{overflow:auto;height:auto}.stage,.ui-bottom,.probe{display:none}.ns{padding:120px 24px 40px;list-style:none}.ns ul{list-style:none;padding:0;display:flex;flex-wrap:wrap;gap:8px}.ns img{height:220px;width:auto}.ns h2{font:inherit;margin:24px 0 8px}</style>
<ul class="ns">
${list}
</ul></noscript>`;
  html = html.replace(/<!-- meta:start -->[\s\S]*?<!-- meta:end -->/, `<!-- meta:start -->\n${meta}\n<!-- meta:end -->`);
  html = html.replace(/<!-- noscript:start -->[\s\S]*?<!-- noscript:end -->/, `<!-- noscript:start -->\n${noscript}\n<!-- noscript:end -->`);
  html = html.replace(/<html lang="[^"]*">/, `<html lang="${escHtml(site.lang || 'en')}">`);
  await writeFile(file, html);
}

// ---------- code version: hash of js+css → data/version.txt, and every relative import carries it ----------
async function stampVersion() {
  const jsDir = join(PUB, 'assets', 'js');
  const files = (await readdir(jsDir)).filter(f => f.endsWith('.js')).sort();
  const h = createHash('sha1');
  for (const f of files) h.update((await readFile(join(jsDir, f), 'utf8')).replace(/\?v=[a-z0-9]+/g, ''));
  h.update(await readFile(join(PUB, 'assets', 'style.css'), 'utf8'));
  const v = h.digest('hex').slice(0, 8);
  for (const f of files) {
    const src = await readFile(join(jsDir, f), 'utf8');
    const out = src.replace(/(from\s+'\.\/[a-z-]+\.js)(\?v=[a-z0-9]+)?'/g, `$1?v=${v}'`).replace(/(import\('\.\/[a-z-]+\.js)(\?v=[a-z0-9]+)?'/g, `$1?v=${v}'`);
    if (out !== src) await writeFile(join(jsDir, f), out);
  }
  await writeFile(join(PUB, 'data', 'version.txt'), v + '\n');
  let html = await readFile(join(PUB, 'index.html'), 'utf8');
  html = html.replace(/assets\/style\.css(\?v=[a-z0-9]+)?/g, `assets/style.css?v=${v}`);
  await writeFile(join(PUB, 'index.html'), html);
  return v;
}

// ---------- main ----------
async function main() {
  const t0 = Date.now();
  const site = await readJSON(join(CONTENT, 'site.json'), {});
  const meta = await readJSON(join(CONTENT, 'meta.json'), { projects: {}, items: {} });
  meta.projects ||= {}; meta.items ||= {};
  const cache = await readJSON(CACHE_FILE, {});
  for (const d of ['rail', 'full', 'poster', 'small']) await mkdir(join(MEDIA, d), { recursive: true });

  const { projects, report } = await scan();
  const warnings = []; const referenced = new Set();
  const stats = { rail: 0, full: 0, poster: 0, small: 0, railPhotoN: 0, railPhotoBytes: 0 };
  const manifest = { generated: new Date().toISOString(), site, projects: [], items: [] };

  // meta scaffolds (never overwrite existing entries)
  for (const p of projects) {
    meta.projects[p.key] ??= { title: p.title, credits: '', link: '', order: null, railCount: null };
    meta.projects[p.key].link ??= '';
    meta.projects[p.key].year ??= '';
    for (const it of p.items) meta.items[it.key] ??= { caption: '', hide: false, teaserStart: 0 };
  }

  const usedSlugs = new Map();
  for (const p of projects) {
    const pm = meta.projects[p.key];
    const title = (pm.title || p.title).trim() || p.title;
    let slug = slugify(title); if (usedSlugs.has(slug)) { slug += '-' + (usedSlugs.get(slug) + 1); } usedSlugs.set(slugify(title), (usedSlugs.get(slugify(title)) || 1) + 1);
    p.slug = slug; p.displayTitle = title;
    p.visible = p.items.filter(it => !meta.items[it.key]?.hide);
    for (const it of p.visible) it.id = `${slug}-${it.hash.slice(0, 6)}`;
  }

  // process all items with limited concurrency
  const all = projects.flatMap(p => p.visible.map(it => ({ p, it })));
  let done = 0;
  const results = await pmap(all, 4, async ({ p, it }) => {
    const im = meta.items[it.key]; const v = it.hash.slice(0, 6);
    const srcM = await mtime(it.path);
    const entry = { id: it.id, project: p.slug, type: it.type, onRail: false, caption: im.caption || '' };
    if (it.type === 'photo') {
      const outR = join(MEDIA, 'rail', `${it.id}.webp`), outF = join(MEDIA, 'full', `${it.id}.webp`), outS = join(MEDIA, 'small', `${it.id}.webp`);
      referenced.add(outR); referenced.add(outF); referenced.add(outS);
      const input = await imageInput(it.path);
      const { w, h } = await orientedSize(input);
      entry.w = w; entry.h = h;
      if (Math.max(w, h) < 1600) report.small.push(`${it.key}  (${w}×${h})`);
      const fresh = (await mtime(outR)) > srcM && (await mtime(outF)) > srcM && (await mtime(outS)) > srcM && cache[it.id]?.rail && cache[it.id]?.small;
      if (fresh) { Object.assign(entry, { rail: cache[it.id].rail, full: cache[it.id].full, small: cache[it.id].small }); }
      else {
        const s = await buildPhoto(input, outR, outF, outS);
        entry.rail = s.rail; entry.full = s.full; entry.small = s.small;
        cache[it.id] = { rail: s.rail, full: s.full, small: s.small };
      }
      entry.small = { src: `media/small/${it.id}.webp?v=${v}`, w: entry.small.w, h: entry.small.h };
      entry.rail = { src: `media/rail/${it.id}.webp?v=${v}`, w: entry.rail.w, h: entry.rail.h };
      entry.full = { src: `media/full/${it.id}.webp?v=${v}`, w: entry.full.w, h: entry.full.h };
      const rs = await fsize(outR), fs = await fsize(outF);
      stats.rail += rs; stats.full += fs; stats.small += await fsize(outS); stats.railPhotoN++; stats.railPhotoBytes += rs;
      if (fs > BUDGET.fullPhoto) warnings.push(`full photo over budget: ${it.id}.webp ${fmtKB(fs)}`);
    } else {
      const outR = join(MEDIA, 'rail', `${it.id}.mp4`), outF = join(MEDIA, 'full', `${it.id}.mp4`), outS = join(MEDIA, 'small', `${it.id}.mp4`);
      const pR = join(MEDIA, 'poster', `${it.id}-rail.webp`), pF = join(MEDIA, 'poster', `${it.id}-full.webp`);
      for (const o of [outR, outF, pR, pF, outS]) referenced.add(o);
      const info = await probeVideo(it.path);
      entry.w = info.w; entry.h = info.h; entry.duration = Math.round(info.duration * 10) / 10; entry.hasAudio = info.hasAudio;
      const ts = Number(im.teaserStart) || 0;
      const c = cache[it.id];
      const fresh = c && c.teaserStart === ts && c.small && (await Promise.all([outR, outF, pR, pF, outS].map(mtime))).every(m => m > srcM);
      let sizes;
      if (fresh) sizes = c;
      else {
        if (it.livePhoto) {
          // poster from the still image
          const input = await imageInput(it.poster.path);
          await run(FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error', '-i', it.path, '-vf', `scale=-2:'min(${TIER.teaserH},ih)'`, '-an', '-c:v', 'libx264', '-crf', String(TIER.teaserCrf), '-preset', 'slow', '-map_metadata', '-1', '-movflags', '+faststart', '-pix_fmt', 'yuv420p', outR]);
          await run(FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error', '-i', it.path, '-vf', `scale=-2:'min(${TIER.teaserSmallH},ih)'`, '-an', '-c:v', 'libx264', '-crf', String(TIER.teaserSmallCrf), '-preset', 'slow', '-map_metadata', '-1', '-movflags', '+faststart', '-pix_fmt', 'yuv420p', outS]);
          await run(FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error', '-i', it.path, '-vf', `scale='if(gt(iw,ih),-2,min(${TIER.fullShort},iw))':'if(gt(iw,ih),min(${TIER.fullShort},ih),-2)'`, '-c:v', 'libx264', '-crf', String(TIER.fullCrf), '-preset', 'slow', '-an', '-map_metadata', '-1', '-movflags', '+faststart', '-pix_fmt', 'yuv420p', outF]);
          const s = await buildPhoto(input, pR, pF);
          sizes = { posterRail: s.rail, posterFull: s.full };
        } else {
          sizes = await buildVideo(it.path, info, ts, outR, outF, pR, pF);
        }
        sizes.rail = await videoSize(outR); sizes.full = await videoSize(outF); sizes.small = existsSync(outS) ? await videoSize(outS) : null; sizes.teaserStart = ts;
        cache[it.id] = sizes;
      }
      entry.rail = { src: `media/rail/${it.id}.mp4?v=${v}`, w: sizes.rail.w, h: sizes.rail.h };
      entry.full = { src: `media/full/${it.id}.mp4?v=${v}`, w: sizes.full.w, h: sizes.full.h };
      if (sizes.small) entry.small = { src: `media/small/${it.id}.mp4?v=${v}`, w: sizes.small.w, h: sizes.small.h };
      entry.poster = { rail: `media/poster/${it.id}-rail.webp?v=${v}`, full: `media/poster/${it.id}-full.webp?v=${v}`, w: sizes.posterRail.w, h: sizes.posterRail.h };
      const rs = await fsize(outR), fs = await fsize(outF);
      stats.rail += rs; stats.full += fs; stats.poster += (await fsize(pR)) + (await fsize(pF));
      if (rs > BUDGET.railTeaser) warnings.push(`rail teaser over budget: ${it.id}.mp4 ${fmtMB(rs)}`);
      if (fs > BUDGET.fullVideoPerSec * info.duration) warnings.push(`full video over budget: ${it.id}.mp4 ${fmtMB(fs)} for ${info.duration.toFixed(0)} s`);
    }
    done++; if (done % 10 === 0 || done === all.length) process.stdout.write(`  ${done}/${all.length}\r`);
    return entry;
  });
  process.stdout.write('\n');

  // assemble manifest
  const byId = new Map(results.map(e => [e.id, e]));
  for (const p of projects) {
    const pm = meta.projects[p.key];
    const railCount = Number.isInteger(pm.railCount) ? pm.railCount : (site.railPerProject ?? 6);
    const items = p.visible.map(it => it.id);
    items.forEach((id, i) => { byId.get(id).onRail = i < railCount; });
    manifest.projects.push({ slug: p.slug, title: p.displayTitle, category: p.category, categoryLabel: site.categories?.[p.category] ?? p.category,
      credits: pm.credits || '', link: (pm.link || '').trim(), year: String(pm.year ?? '').trim(), order: Number.isInteger(pm.order) ? pm.order : null, count: items.length, items });
  }
  manifest.items = results;
  await writeJSON(join(CONTENT, 'meta.json'), meta);
  await writeJSON(CACHE_FILE, cache);

  // remove orphan outputs (only inside public/media)
  const removed = [];
  for (const d of ['rail', 'full', 'poster', 'small']) {
    for (const f of await readdir(join(MEDIA, d))) {
      const p = join(MEDIA, d, f);
      if (!referenced.has(p)) { await unlink(p); removed.push(`${d}/${f}`); }
    }
  }

  // branding: first frames of the first five projects
  const ordered = [...manifest.projects].sort((a, b) => (a.order ?? 1e9) - (b.order ?? 1e9) || natural(a.title, b.title));
  const frames = [];
  for (const p of ordered) {
    if (frames.length >= 5) break;
    const first = byId.get(p.items[0]); if (!first) continue;
    frames.push(first.type === 'photo' ? join(MEDIA, 'rail', `${first.id}.webp`) : join(MEDIA, 'poster', `${first.id}-rail.webp`));
  }
  const seal = await findSeal();
  if (seal) await buildBrandFromSeal(seal, site); else if (frames.length) await buildBranding(frames, site);
  await writeJSON(join(PUB, 'data', 'manifest.json'), manifest);
  await injectHtml(site, manifest, byId);
  const codeV = await stampVersion();
  if (tmpDir) await rm(tmpDir, { recursive: true, force: true });

  // report
  const avgRail = stats.railPhotoN ? stats.railPhotoBytes / stats.railPhotoN : 0;
  if (avgRail > BUDGET.railPhotoAvg) warnings.push(`rail photo average over budget: ${fmtKB(avgRail)} (limit ${fmtKB(BUDGET.railPhotoAvg)})`);
  const photos = results.filter(e => e.type === 'photo').length, motion = results.length - photos;
  console.log(`\n== media report (${((Date.now() - t0) / 1000).toFixed(1)} s) ==`);
  console.log(`projects: ${manifest.projects.length}, items: ${results.length} (${photos} photo, ${motion} motion)`);
  for (const p of manifest.projects) console.log(`  ${String(p.count).padStart(3)}  ${p.category} / ${p.title}  [${p.slug}]`);
  console.log(`tiers: small ${fmtMB(stats.small)}, rail ${fmtMB(stats.rail)} (photo avg ${fmtKB(avgRail)}), full ${fmtMB(stats.full)}, poster ${fmtMB(stats.poster)}`);
  if (report.empty.length) console.log(`empty folders (skipped): ${report.empty.join('; ')}`);
  if (report.dupes.length) console.log(`duplicates (skipped):\n  ${report.dupes.join('\n  ')}`);
  if (report.small.length) console.log(`sources below 1600px (HQ will be soft):\n  ${report.small.join('\n  ')}`);
  if (removed.length) console.log(`removed orphan outputs: ${removed.join(', ')}`);
  if (warnings.length) console.log(`budget warnings:\n  ${warnings.join('\n  ')}`);
  const todos = Object.entries(site).filter(([, v]) => typeof v === 'string' && /^TODO/i.test(v)).map(([k]) => k);
  if (todos.length) console.log(`TODO in content/site.json: ${todos.join(', ')}`);
  console.log(`manifest → docs/data/manifest.json, scaffolds → content/meta.json, meta → docs/index.html, code version ${codeV}`);
}

main().catch(e => { console.error(e); process.exit(1); });
