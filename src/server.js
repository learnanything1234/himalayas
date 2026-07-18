import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize } from 'node:path';
import { Predictor, CONTEXT_MODEL } from './predict.js';
import { COGNATE_SUBJECTS, COGNATE_WEIGHT } from './cognate.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB_DIR = process.env.WEB_DIR || join(__dirname, '..', 'web');
const PORT = Number(process.env.PORT || 3000);
const predictor = new Predictor();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

// Serve a file from web/ if it exists; returns true if handled.
async function serveStatic(req, res, pathname) {
  if (req.method !== 'GET') return false;
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const full = normalize(join(WEB_DIR, rel));
  if (!full.startsWith(WEB_DIR)) return false; // path traversal guard
  try {
    const body = await readFile(full);
    const ext = full.slice(full.lastIndexOf('.'));
    res.writeHead(200, {
      'content-type': MIME[ext] || 'application/octet-stream',
      'cache-control': ext === '.html' ? 'no-cache' : 'public, max-age=3600',
    });
    res.end(body);
    return true;
  } catch {
    return false;
  }
}

function send(res, status, body) {
  const json = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
  });
  res.end(json);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 1e6) { reject(new Error('payload too large')); req.destroy(); }
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch { reject(new Error('invalid JSON')); }
    });
    req.on('error', reject);
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname.replace(/\/+$/, '') || '/';

  if (req.method === 'OPTIONS') return send(res, 204, {});

  try {
    // Health check
    if (path === '/health') {
      return send(res, 200, {
        status: 'ok',
        service: 'alevel-predictor',
        model: predictor.meta.source,
        data_years: JSON.parse(predictor.meta.years),
        subjects: predictor.knownSubjects.size,
        records: Number(predictor.meta.total_records),
        endpoints: ['GET /subjects', 'GET /model', 'POST /predict', 'GET /predict?...', 'POST /predict/batch'],
      });
    }

    // List supported subjects
    if (path === '/subjects' && req.method === 'GET') {
      return send(res, 200, { count: predictor.knownSubjects.size, subjects: predictor.listSubjects() });
    }

    // Published model parameters (transparency)
    if (path === '/model' && req.method === 'GET') {
      return send(res, 200, {
        base_model: 'DfE KS5 transition matrix — empirical P(A-level grade | subject, prior-attainment band)',
        data_records: Number(predictor.meta.total_records),
        n_subjects: Number(predictor.meta.n_subjects),
        prior_bands: ['<1', '1-<2', '2-<3', '3-<4', '4-<5', '5-<6', '6-<7', '7-<8', '8-<9', '9>='],
        prior_band_measure: 'mean GCSE grade (9-1 scale); band = floor(mean) unless <1 or >=9',
        grade_scale: { 'A*': 6, A: 5, B: 4, C: 3, D: 2, E: 1, U: 0 },
        subject_specific: {
          description: 'Where the student\'s GCSE grade in the SAME subject is known, the real Cambridge cognate distribution is blended with the DfE mean-GCSE distribution.',
          weight_on_cognate: COGNATE_WEIGHT,
          subjects: COGNATE_SUBJECTS,
          source: 'Cambridge Assessment, Progression from GCSE to A Level 2021-23 (Report 144)',
          source_url: 'https://www.cambridgeassessment.org.uk/Images/735630-144.-progression-from-gcse-to-a-level-2021-2023.pdf',
        },
        confidence: 'empirical probability of landing within one grade of the modal outcome',
        tolerance_band: 'expected grade ± 1 standard deviation of the empirical distribution',
        context_model: CONTEXT_MODEL,
        data_years: JSON.parse(predictor.meta.years),
        source_url: predictor.meta.source_url,
      });
    }

    // Batch predict (spreadsheet upload -> many students)
    if (path === '/predict/batch' && req.method === 'POST') {
      const payload = await readJson(req);
      const students = Array.isArray(payload) ? payload : payload.students;
      if (!Array.isArray(students) || students.length === 0) {
        return send(res, 400, { error: 'no_students', message: 'POST { students: [ {name, gcses|gcseAps, subjects, context}, ... ] }' });
      }
      if (students.length > 2000) {
        return send(res, 413, { error: 'too_many_rows', message: 'Max 2000 students per request.' });
      }
      return send(res, 200, predictor.predictBatch(students));
    }

    // Predict
    if (path === '/predict') {
      let payload;
      if (req.method === 'POST') {
        payload = await readJson(req);
      } else if (req.method === 'GET') {
        // convenience: /predict?aps=7.4&subjects=Maths,Physics,Chemistry
        const subjects = (url.searchParams.get('subjects') || '')
          .split(',').map((s) => s.trim()).filter(Boolean);
        payload = {
          subjects,
          gcseAps: url.searchParams.has('aps') ? Number(url.searchParams.get('aps')) : undefined,
          priorBand: url.searchParams.get('band') || undefined,
          year: url.searchParams.get('year') || undefined,
          pool: url.searchParams.get('pool') !== 'false',
        };
        if (url.searchParams.has('gcses')) {
          payload.gcses = url.searchParams.get('gcses').split(',').map((s) => s.trim());
        }
      } else {
        return send(res, 405, { error: 'method_not_allowed' });
      }

      if (!Array.isArray(payload.subjects) || payload.subjects.length === 0) {
        return send(res, 400, { error: 'no_subjects', message: 'Provide `subjects`: an array of A-level subject names.' });
      }
      return send(res, 200, predictor.predict(payload));
    }

    // Static site (served from web/): / -> index.html, plus support.js etc.
    if (await serveStatic(req, res, path)) return;

    return send(res, 404, { error: 'not_found', path });
  } catch (err) {
    return send(res, 400, { error: 'bad_request', message: err.message });
  }
});

server.listen(PORT, () => {
  console.log(`alevel-predictor listening on :${PORT}`);
  console.log(`  ${predictor.knownSubjects.size} subjects, data years ${predictor.meta.years}`);
});
