// Stages the Himalayas design into web/ so the API server can serve the site
// at / (same origin as the /predict API). Run: node scripts/build-web.mjs
import { mkdirSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DESIGN = join(ROOT, 'Design');
const WEB = join(ROOT, 'web');

mkdirSync(WEB, { recursive: true });
copyFileSync(join(DESIGN, 'Himalayas.dc.html'), join(WEB, 'index.html'));
copyFileSync(join(DESIGN, 'support.js'), join(WEB, 'support.js'));
copyFileSync(join(DESIGN, 'sample-students.csv'), join(WEB, 'sample-students.csv'));
console.log('Staged web/ (index.html, support.js, sample-students.csv) from Design/');
