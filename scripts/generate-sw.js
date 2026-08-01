import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const distPath = path.resolve(__dirname, '../dist');
const manifestPath = path.resolve(distPath, '.vite/manifest.json'); // Vite 5+ path
const manifestPathLegacy = path.resolve(distPath, 'manifest.json'); // Vite 4 path
const swTemplatePath = path.resolve(__dirname, '../public/service-worker-template.js');
const swOutputPath = path.resolve(distPath, 'service-worker.js'); // ✅ Output to dist/, not public/

async function generateServiceWorker() {
  try {
    // Try Vite 5 manifest path first, fall back to Vite 4
    let manifestContent;
    try {
      manifestContent = await fs.promises.readFile(manifestPath, 'utf-8');
    } catch {
      manifestContent = await fs.promises.readFile(manifestPathLegacy, 'utf-8');
    }

    const manifest = JSON.parse(manifestContent);

    const urlsToCache = [
      '/',
      '/index.html',
      '/manifest.json',
      '/favicon.ico',
      '/robots.txt',
      '/icons/app-icon.png',
      '/icons/app-icon-192x192.png',
      '/app-assets/4880880d-3aeb-472f-8413-139a7d4b97a5.png',
      '/app-assets/vidhence-app-preview.png',
    ];

    // Add all JS/CSS assets from Vite's manifest
    for (const key in manifest) {
      const asset = manifest[key];
      if (asset.file) {
        urlsToCache.push('/' + asset.file);
      }
      if (asset.css) {
        asset.css.forEach(cssFile => urlsToCache.push('/' + cssFile));
      }
    }

    // Deduplicate
    const uniqueUrls = [...new Set(urlsToCache)];

    // Read template
    let swContent = await fs.promises.readFile(swTemplatePath, 'utf-8');

    // Inject cache URLs
    swContent = swContent.replace(
      '/* CACHE_URLS_PLACEHOLDER */',
      JSON.stringify(uniqueUrls, null, 2)
    );

    // ✅ Inject build timestamp for cache busting
    const buildTimestamp = Date.now().toString();
    swContent = swContent.replace('__BUILD_TIMESTAMP__', buildTimestamp);

    // Write to dist/
    await fs.promises.writeFile(swOutputPath, swContent, 'utf-8');

    console.log(`✅ Service Worker generated: ${uniqueUrls.length} URLs cached`);
    console.log(`   Cache version: vidhence-cache-${buildTimestamp}`);

  } catch (error) {
    console.error('❌ Error generating service worker:', error);
    process.exit(1);
  }
}

generateServiceWorker();
