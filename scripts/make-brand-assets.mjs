/**
 * make-brand-assets.mjs — compose the Android icon/splash sources from the
 * app's real brand files.
 *
 * The retired native project carried no artwork at all: its launcher icon was a
 * 439-byte placeholder vector (three bars on green #2E7D32) that didn't even
 * match the brand blue. The genuine assets live in the web project, so those
 * are the source of truth:
 *
 *   public/icons/app-icon.png        512x512  the navy mark
 *   public/app-assets/acounted-logo.png  3000x1000  mark + wordmark
 *
 * Output goes to assets/, which `@capacitor/assets generate` then fans out into
 * every Android density bucket.
 *
 * Run: node scripts/make-brand-assets.mjs
 */

import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'assets');

const MARK = path.join(root, 'public/icons/app-icon.png');
const LOGO = path.join(root, 'public/app-assets/acounted-logo.png');

/** Brand navy, sampled from the logo artwork. */
const NAVY = { r: 0x1b, g: 0x2e, b: 0x4f, alpha: 1 };
const WHITE = { r: 255, g: 255, b: 255, alpha: 1 };

const ICON = 1024;
const SPLASH = 2732;

await mkdir(out, { recursive: true });

// ── Launcher icon ────────────────────────────────────────────────────────────
// Legacy square icon: the mark, full bleed on white.
await sharp(MARK)
  .resize(ICON, ICON, { fit: 'contain', background: WHITE })
  .flatten({ background: WHITE })
  .png()
  .toFile(path.join(out, 'icon.png'));

// Adaptive icon foreground.
//
// Do NOT pre-inset the mark here. @capacitor/assets emits an adaptive-icon XML
// that already wraps this layer in `<inset android:inset="16.7%">` to create
// the safe zone, and the source app-icon.png carries roughly 20% margin of its
// own. Insetting a third time (an earlier version used 55%) left the mark at
// ~36% of the icon — a speck floating in a white circle on the launcher.
// Full bleed here lands it near 52% after the XML inset, which is about where
// Android's own guidance puts it.
const markInset = ICON;
await sharp({
  create: { width: ICON, height: ICON, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
})
  .composite([
    {
      input: await sharp(MARK)
        .resize(markInset, markInset, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .toBuffer(),
      gravity: 'center',
    },
  ])
  .png()
  .toFile(path.join(out, 'icon-foreground.png'));

// Adaptive icon background: flat white. The mark is navy, so a white ground
// keeps it legible on every wallpaper, and matches how the logo is presented
// everywhere else in the product.
await sharp({ create: { width: ICON, height: ICON, channels: 4, background: WHITE } })
  .png()
  .toFile(path.join(out, 'icon-background.png'));

// ── Splash ───────────────────────────────────────────────────────────────────
// The full wordmark, centred, at 42% of the canvas width. Splash images are
// centre-cropped to the device aspect ratio, so everything meaningful has to
// sit well inside the middle square.
const logoWidth = Math.round(SPLASH * 0.42);

async function splash(bg, tintWhite) {
  let logo = sharp(LOGO).resize(logoWidth, null, { fit: 'inside' });

  if (tintWhite) {
    // Produce a white version of the wordmark for the dark splash.
    //
    // The source logo is navy artwork on an OPAQUE WHITE background, not on
    // transparency — so simply forcing RGB to white yields a solid white
    // rectangle (it did, first time round). Instead derive alpha from
    // luminance: dark ink becomes opaque white, the white paper becomes fully
    // transparent, and the anti-aliased edges of the brush lettering keep their
    // soft falloff because the mapping is continuous rather than a threshold.
    const { data, info } = await logo.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    for (let i = 0; i < data.length; i += info.channels) {
      const luma = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      // Respect any pre-existing transparency as well as the paper white.
      data[i + 3] = Math.round((255 - luma) * (data[i + 3] / 255));
    }
    logo = sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } });
  }

  return sharp({ create: { width: SPLASH, height: SPLASH, channels: 4, background: bg } })
    .composite([{ input: await logo.png().toBuffer(), gravity: 'center' }])
    .png();
}

await (await splash(WHITE, false)).toFile(path.join(out, 'splash.png'));
await (await splash(NAVY, true)).toFile(path.join(out, 'splash-dark.png'));

console.log('Wrote icon.png, icon-foreground.png, icon-background.png, splash.png, splash-dark.png to assets/');
