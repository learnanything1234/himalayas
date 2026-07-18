// Builds the SQLite database from the extracted DfE CSVs.
// Run:  node scripts/build-db.mjs
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, existsSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { SUBJECT_ALIASES } from '../src/subjects.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DATA = join(ROOT, 'data');
const DB_PATH = join(DATA, 'predictor.db');

// --- tiny CSV parser (no quoted commas in our data) ---
function parseCsv(path) {
  const text = readFileSync(path, 'utf8').trim();
  const [head, ...lines] = text.split(/\r?\n/);
  const cols = head.split(',');
  return lines.map((line) => {
    const cells = line.split(',');
    const row = {};
    cols.forEach((c, i) => { row[c] = cells[i]; });
    return row;
  });
}
const num = (v) => (v === undefined || v === '' || v === 'NA' ? null : Number(v));

if (existsSync(DB_PATH)) unlinkSync(DB_PATH);
const db = new DatabaseSync(DB_PATH);

db.exec(`
  CREATE TABLE transition_matrix (
    year        INTEGER NOT NULL,
    subject     TEXT    NOT NULL,
    subj_code   TEXT,
    prior_band  TEXT    NOT NULL,
    p_astar REAL, p_a REAL, p_b REAL, p_c REAL, p_d REAL, p_e REAL, p_u REAL,
    n_students  INTEGER DEFAULT 0,
    PRIMARY KEY (year, subject, prior_band)
  );
  CREATE INDEX idx_tm_subject ON transition_matrix(subject, year);

  CREATE TABLE subjects (name TEXT PRIMARY KEY);
  CREATE TABLE subject_aliases (alias TEXT PRIMARY KEY, subject TEXT NOT NULL);

  CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
`);

// cohort sizes keyed by year|subject|band
const cohort = new Map();
for (const r of parseCsv(join(DATA, 'alevel_cohort_sizes.csv'))) {
  cohort.set(`${r.year}|${r.subject}|${r.prior_band}`, num(r.n_students) ?? 0);
}

const insTm = db.prepare(`INSERT INTO transition_matrix
  (year, subject, subj_code, prior_band, p_astar, p_a, p_b, p_c, p_d, p_e, p_u, n_students)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

const rows = parseCsv(join(DATA, 'alevel_transition_matrix.csv'));
const subjects = new Set();
let n = 0;
for (const r of rows) {
  const key = `${r.year}|${r.subject}|${r.prior_band}`;
  insTm.run(
    Number(r.year), r.subject, r.subj_code, r.prior_band,
    num(r.Astar), num(r.A), num(r.B), num(r.C), num(r.D), num(r.E), num(r.U),
    cohort.get(key) ?? 0,
  );
  subjects.add(r.subject);
  n++;
}

const insSub = db.prepare('INSERT OR IGNORE INTO subjects (name) VALUES (?)');
for (const s of subjects) insSub.run(s);

const insAlias = db.prepare('INSERT OR REPLACE INTO subject_aliases (alias, subject) VALUES (?, ?)');
for (const [alias, subject] of Object.entries(SUBJECT_ALIASES)) insAlias.run(alias, subject);

const years = [...new Set(rows.map((r) => Number(r.year)))].sort();
// Total student-result records behind the model: sum of every subject×band×year
// cohort (excluding the "All" roll-up so we don't double-count).
let totalRecords = 0;
for (const [key, n] of cohort) {
  if (!key.endsWith('|All')) totalRecords += n;
}
const insMeta = db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)');
insMeta.run('source', 'DfE 16-18 (KS5) Transition Matrices, GCE A level');
insMeta.run('source_url', 'https://github.com/dfe-analytical-services/ks5-transition-matrices');
insMeta.run('years', JSON.stringify(years));
insMeta.run('latest_year', String(years.at(-1)));
insMeta.run('n_subjects', String(subjects.size));
insMeta.run('total_records', String(totalRecords));
insMeta.run('built_at', new Date().toISOString());

db.close();
console.log(`Built ${DB_PATH}`);
console.log(`  ${n} transition-matrix rows, ${subjects.size} subjects, years ${years.join(', ')}`);
