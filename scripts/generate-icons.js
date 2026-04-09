// Generate PWA icons from SVG
import sharp from 'sharp';
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, '..', 'public');

// Simple beige square icon with 80m text
const svgIcon = (size) => `
<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${size}" height="${size}" fill="#eae7de"/>
  <rect x="0" y="0" width="${size}" height="${size}" rx="${size * 0.15}" fill="#111"/>
  <text x="${size * 0.5}" y="${size * 0.62}" font-family="Georgia, serif" font-weight="900" font-size="${size * 0.4}" fill="#eae7de" text-anchor="middle" letter-spacing="-2">80m</text>
  <circle cx="${size * 0.82}" cy="${size * 0.22}" r="${size * 0.09}" fill="#22c55e"/>
</svg>
`;

async function generateIcons() {
  // 192x192
  await sharp(Buffer.from(svgIcon(512)))
    .resize(192, 192)
    .png()
    .toFile(join(publicDir, 'pwa-192x192.png'));
  console.log('Generated pwa-192x192.png');

  // 512x512
  await sharp(Buffer.from(svgIcon(512)))
    .resize(512, 512)
    .png()
    .toFile(join(publicDir, 'pwa-512x512.png'));
  console.log('Generated pwa-512x512.png');

  // Apple touch icon
  await sharp(Buffer.from(svgIcon(512)))
    .resize(180, 180)
    .png()
    .toFile(join(publicDir, 'apple-touch-icon.png'));
  console.log('Generated apple-touch-icon.png');

  console.log('All icons generated!');
}

generateIcons().catch(console.error);
