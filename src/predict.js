import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { resolveSubject, displayName } from './subjects.js';
import { averagePointScore, apsToBand } from './grades.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.PREDICTOR_DB || join(__dirname, '..', 'data', 'predictor.db');

const GRADES = ['Astar', 'A', 'B', 'C', 'D', 'E', 'U'];
const COL = { Astar: 'p_astar', A: 'p_a', B: 'p_b', C: 'p_c', D: 'p_d', E: 'p_e', U: 'p_u' };
const LABEL = { Astar: 'A*', A: 'A', B: 'B', C: 'C', D: 'D', E: 'E', U: 'U' };
// 0-6 grade scale used for expected value, band position and the front-end marker.
const VALUE = { Astar: 6, A: 5, B: 4, C: 3, D: 2, E: 1, U: 0 };
const LETTERS = ['U', 'E', 'D', 'C', 'B', 'A', 'A*']; // index == value
const UCAS = { Astar: 56, A: 48, B: 40, C: 32, D: 24, E: 16, U: 0 };

// Cohort thresholds for the (data-availability) confidence label.
const COHORT_CONF = [
  { min: 500, level: 'high' },
  { min: 100, level: 'medium' },
  { min: 30, level: 'low' },
  { min: 0, level: 'very low' },
];

// -----------------------------------------------------------------------------
// Context adjustment model.
//
// The DfE transition matrices condition ONLY on prior attainment — they average
// away demographics. This layer applies small adjustments (in A-level grade
// points) on top of the empirical prediction, one per context factor.
//
// Each coefficient is ANCHORED to a specific published national statistic (see
// `evidence`/`source` below) rather than invented — but it is still an AGGREGATE
// adjustment layered on the prior-attainment model, not a fitted individual-level
// model. Getting there needs student-level microdata. The whole table is served
// at GET /model; set any coefficient to 0 to drop that factor, or ignore
// `context` entirely for the pure empirical model.
// -----------------------------------------------------------------------------
export const CONTEXT_MODEL = {
  units: 'A-level grade points (A*=6 … U=0); 1.0 = one whole grade',
  basis: 'Aggregate national effects from published DfE / Ofqual / FFT statistics, applied on top of the prior-attainment (transition-matrix) prediction. Anchored to the figures below — NOT a fitted individual-level model, which would require student microdata (NPD/LEO).',
  attendance_reference: 95,
  factors: {
    disadvantaged: {
      coefficient: -0.11,
      applies_when: 'Pupil Premium / disadvantaged',
      evidence: 'DfE 2024/25 A-level disadvantage gap = 4.6 points = 0.46 of a grade (unconditional). The model already conditions on prior attainment, which explains most of that gap; the residual within-band effect is ~a quarter of it.',
      source: 'https://explore-education-statistics.service.gov.uk/find-statistics/a-level-and-other-16-to-18-results/2024-25',
    },
    eal: {
      coefficient: 0.06,
      applies_when: 'English as an Additional Language',
      evidence: 'FFT: EAL pupils average Progress 8 +0.55 vs -0.09 for first-language English (~0.6 grade, already prior-attainment-conditioned at KS4). Attenuated for A-level to a modest positive.',
      source: 'https://ffteducationdatalab.org.uk/2020/02/what-does-english-as-an-additional-language-really-mean-when-it-comes-to-progress-8/',
    },
    summer_born: {
      coefficient: -0.02,
      applies_when: 'born May–August (months 5–8)',
      evidence: 'The relative-age effect largely washes out by A-level (self-selection into subjects), and the DfE prior-attainment measure is already age-standardised. Kept near-zero to avoid double-counting.',
      source: 'https://www.cambridgeassessment.org.uk/Images/109784-birthdate-effects-a-review-of-the-literature-from-1990-on.pdf',
    },
    attendance_per_point: {
      coefficient: 0.010,
      applies_when: 'per percentage point of attendance away from 95%',
      evidence: 'DfE 2025: moving up one 5% attendance band (e.g. 90–95% → 95–100%) raises the chance of the expected outcome by ~10% at KS4. Extrapolated to A-level grade points (~0.05/band). Weakest-evidenced of the four — derived from KS4.',
      source: 'https://explore-education-statistics.service.gov.uk/find-statistics/the-link-between-absence-and-attainment-at-ks2-and-ks4',
    },
  },
  caveat: 'These adjustments are small by design (typically < 0.3 of a grade combined). They nudge the headline grade and tolerance band; they do not alter the underlying probability distribution.',
};

export function contextDelta(context = {}) {
  if (!context) return { delta: 0, components: {} };
  const f = CONTEXT_MODEL.factors;
  const c = {};
  if (context.disadvantaged) c.disadvantaged = f.disadvantaged.coefficient;
  if (context.eal) c.eal = f.eal.coefficient;
  const m = Number(context.birthMonth);
  if (m >= 5 && m <= 8) c.summer_born = f.summer_born.coefficient;
  if (context.attendance != null && Number.isFinite(Number(context.attendance))) {
    c.attendance = (Number(context.attendance) - CONTEXT_MODEL.attendance_reference)
      * f.attendance_per_point.coefficient;
  }
  const delta = Object.values(c).reduce((a, b) => a + b, 0);
  return { delta, components: c };
}

export class Predictor {
  constructor(dbPath = DB_PATH) {
    this.db = new DatabaseSync(dbPath, { readOnly: true });
    this.knownSubjects = new Set(
      this.db.prepare('SELECT name FROM subjects ORDER BY name').all().map((r) => r.name),
    );
    this.meta = Object.fromEntries(
      this.db.prepare('SELECT key, value FROM meta').all().map((r) => [r.key, r.value]),
    );
    this.latestYear = Number(this.meta.latest_year);
    this._byBand = this.db.prepare(
      'SELECT * FROM transition_matrix WHERE subject = ? AND prior_band = ?',
    );
  }

  listSubjects() { return [...this.knownSubjects]; }

  // Pool a subject+band distribution across the requested years, weighting each
  // year by its cohort size so small/noisy years don't dominate.
  _distribution(subject, band, { year, pool = true } = {}) {
    let rows = this._byBand.all(subject, band);
    if (year) rows = rows.filter((r) => r.year === year);
    if (rows.length === 0) return null;
    if (!pool) {
      const y = Math.max(...rows.map((r) => r.year));
      rows = rows.filter((r) => r.year === y);
    }

    let totalN = 0;
    const acc = Object.fromEntries(GRADES.map((g) => [g, 0]));
    const wsum = rows.reduce((s, r) => s + Math.max(r.n_students, 1), 0);
    for (const r of rows) {
      const w = Math.max(r.n_students, 1);
      totalN += r.n_students;
      for (const g of GRADES) acc[g] += (r[COL[g]] ?? 0) * w;
    }
    const dist = {};
    let s = 0;
    for (const g of GRADES) { dist[g] = acc[g] / wsum; s += dist[g]; }
    for (const g of GRADES) dist[g] = s > 0 ? dist[g] / s : 0; // renormalise to 1
    return { dist, n: totalN, years: [...new Set(rows.map((r) => r.year))].sort() };
  }

  static _cohortConfidence(n) { return COHORT_CONF.find((c) => n >= c.min).level; }

  // Turn an empirical grade distribution (+ optional context shift, in grade
  // points) into the point estimate, tolerance band and confidence the UI needs.
  static _summarise(dist, delta = 0) {
    // moments on the 0-6 value scale
    const mean0 = GRADES.reduce((s, g) => s + dist[g] * VALUE[g], 0);
    const variance = GRADES.reduce((s, g) => s + dist[g] * (VALUE[g] - mean0) ** 2, 0);
    const sd = Math.sqrt(Math.max(variance, 0));

    const mean = clamp(mean0 + delta, 0, 6);          // context-adjusted expected value
    const modeValue = Math.round(mean);
    const modeGrade = LETTERS[modeValue];

    // tolerance band: expected ± 1 sd, clipped to the scale
    const lowV = clamp(mean - sd, 0, 6);
    const highV = clamp(mean + sd, 0, 6);
    const lowGrade = LETTERS[Math.round(lowV)];
    const highGrade = LETTERS[Math.round(highV)];

    // confidence: empirical probability of landing within ±1 grade of the mode.
    // (computed on the un-shifted distribution — the honest spread of outcomes)
    const modeEmp = Math.round(mean0);
    const within = GRADES.filter((g) => Math.abs(VALUE[g] - modeEmp) <= 1)
      .reduce((s, g) => s + dist[g], 0);
    const confidence = Math.round(within * 100);

    const expectedUcas = GRADES.reduce((s, g) => s + dist[g] * UCAS[g], 0);

    return {
      grade: modeGrade,
      grade_value: round(mean, 3),
      grade_sd: round(sd, 3),
      band: {
        low_grade: lowGrade,
        high_grade: highGrade,
        range_label: lowGrade === highGrade ? lowGrade : `${lowGrade}–${highGrade}`,
        low_value: round(lowV, 3),
        high_value: round(highV, 3),
      },
      // front-end marker/band positions as % across the U…A* axis
      marker_pct: round((mean / 6) * 100, 1),
      band_left_pct: round((lowV / 6) * 100, 1),
      band_width_pct: round(((highV - lowV) / 6) * 100, 1),
      confidence,
      expected_ucas_points: round(expectedUcas, 1),
      distribution: Object.fromEntries(GRADES.map((g) => [LABEL[g], round(dist[g] * 100, 2)])),
      cumulative: {
        'A*': round(dist.Astar * 100, 1),
        'A*-A': round((dist.Astar + dist.A) * 100, 1),
        'A*-B': round((dist.Astar + dist.A + dist.B) * 100, 1),
        'A*-C': round((dist.Astar + dist.A + dist.B + dist.C) * 100, 1),
        pass_A_E: round((1 - dist.U) * 100, 1),
      },
    };
  }

  predictSubject(subjectInput, band, { delta = 0, ...opts } = {}) {
    const r = resolveSubject(subjectInput, this.knownSubjects);
    if (!r.subject) {
      return { input: subjectInput, error: 'subject_not_found', candidates: r.candidates || [] };
    }
    const got = this._distribution(r.subject, band, opts)
      || this._distribution(r.subject, 'All', opts);
    if (!got) return { input: subjectInput, subject: r.subject, error: 'no_data_for_band' };

    return {
      input: subjectInput,
      subject: r.subject,
      subject_display: displayName(r.subject),
      match: r.method,
      prior_band: band,
      cohort_n: got.n,
      years_used: got.years,
      data_confidence: Predictor._cohortConfidence(got.n),
      ...Predictor._summarise(got.dist, delta),
    };
  }

  predict(payload = {}) {
    const { gcses, gcseAps, priorBand, subjects = [], context, year, pool = true } = payload;

    // 1. prior attainment -> band
    let aps = null, apsInfo = null, band = priorBand || null;
    if (band == null) {
      if (typeof gcseAps === 'number') aps = gcseAps;
      else if (Array.isArray(gcses)) { const r = averagePointScore(gcses); aps = r.aps; apsInfo = r; }
      band = apsToBand(aps);
    }
    if (!band) {
      return { error: 'insufficient_prior_attainment',
        message: 'Provide `gcses` (array of grades), `gcseAps` (number), or `priorBand`.' };
    }

    // 2. context shift
    const ctx = contextDelta(context);

    // 3. per-subject prediction
    const opts = { year: year ? Number(year) : undefined, pool, delta: ctx.delta };
    const predictions = subjects.map((s) => this.predictSubject(s, band, opts));

    // 4. aggregate
    const ok = predictions.filter((p) => !p.error);
    const totalUcas = ok.reduce((s, p) => s + (p.expected_ucas_points || 0), 0);
    const avgConf = ok.length ? Math.round(ok.reduce((s, p) => s + p.confidence, 0) / ok.length) : null;

    return {
      prior_attainment: {
        gcse_aps: aps != null ? round(aps, 3) : null,
        prior_band: band,
        gcses_counted: apsInfo?.counted,
        gcses_ignored: apsInfo?.ignored,
        source: priorBand ? 'supplied_band'
          : (typeof gcseAps === 'number' ? 'supplied_aps' : 'computed_from_gcses'),
      },
      context: { delta: round(ctx.delta, 3), components: ctx.components },
      predictions,
      summary: {
        subjects_predicted: ok.length,
        best_guess_profile: ok.map((p) => p.grade).join(' '),
        average_confidence: avgConf,
        total_expected_ucas_points: round(totalUcas, 1),
      },
      meta: {
        model: 'DfE KS5 transition matrix (empirical grade distribution by subject × prior-attainment band) + published context adjustment',
        data_years: JSON.parse(this.meta.years),
        pooled_years: pool,
        source_url: this.meta.source_url,
        disclaimer: 'Statistical estimate for guidance only — not a substitute for teacher assessment.',
      },
    };
  }

  // Batch: predict for many students at once. Returns one row per input,
  // preserving order, each with a compact summary suited to a results table.
  predictBatch(students = [], opts = {}) {
    if (!Array.isArray(students)) return { error: 'students_must_be_array' };
    const results = students.map((s, i) => {
      const p = this.predict({ ...s, ...opts });
      if (p.error) return { row: i + 1, name: s.name ?? `Student ${i + 1}`, error: p.error, message: p.message };
      return {
        row: i + 1,
        name: s.name ?? `Student ${i + 1}`,
        gcse_aps: p.prior_attainment.gcse_aps,
        prior_band: p.prior_attainment.prior_band,
        context_delta: p.context.delta,
        subjects: p.predictions.map((pr) => ({
          subject: pr.subject ?? pr.input,
          subject_display: pr.subject_display ?? pr.subject ?? pr.input,
          grade: pr.error ? null : pr.grade,
          range: pr.error ? null : pr.band.range_label,
          confidence: pr.error ? null : pr.confidence,
          error: pr.error,
        })),
        best_guess_profile: p.summary.best_guess_profile,
        average_confidence: p.summary.average_confidence,
        total_expected_ucas_points: p.summary.total_expected_ucas_points,
      };
    });
    return {
      count: results.length,
      results,
      meta: {
        model: 'DfE KS5 transition matrix + published context adjustment',
        data_years: JSON.parse(this.meta.years),
        source_url: this.meta.source_url,
      },
    };
  }

  close() { this.db.close(); }
}

function round(x, dp = 2) {
  if (x == null || !Number.isFinite(x)) return null;
  const f = 10 ** dp;
  return Math.round(x * f) / f;
}
function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }
