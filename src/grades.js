// GCSE prior-attainment handling.
//
// Ofqual / DfE use a student's mean GCSE grade — "GCSE average point score"
// (APS) — as the measure of A-level prior attainment, then bucket it into
// bands. See:
//   https://ffteducationdatalab.org.uk/2020/08/using-gcse-average-point-score-as-a-measure-of-a-level-prior-attainment/
//
// On the reformed 9-1 GCSE scale the point value equals the numeric grade
// (grade 8 = 8 points). Legacy A*-G grades are mapped onto the same scale.
// U/ungraded counts as 0 points and still counts as an entry.
//
// NOTE on precision: the DfE bands are built on an *age-standardised* points-
// per-entry (PTSPE_1). Ofqual has never published the standardisation, so we
// use the raw mean GCSE grade. This is the standard public approximation; the
// predictor exposes `priorBand` so callers can override it if they hold the
// standardised figure.

const LEGACY_POINTS = {
  'A*': 8.5, A: 7, B: 5.5, C: 4, D: 3, E: 2, F: 1.5, G: 1, U: 0, X: 0,
};

// Convert a single GCSE grade (number 1-9, "9".."1", "A*".."G", or "U") to points.
export function gradeToPoints(g) {
  if (g === null || g === undefined || g === '') return null;
  if (typeof g === 'number' && Number.isFinite(g)) {
    return Math.max(0, Math.min(9, g));
  }
  const s = String(g).trim().toUpperCase();
  if (/^\d+(\.\d+)?$/.test(s)) return Math.max(0, Math.min(9, parseFloat(s)));
  if (s in LEGACY_POINTS) return LEGACY_POINTS[s];
  return null;
}

// Compute GCSE average point score from an array of grades.
// Each entry may be a grade (number/string) or { subject, grade }.
// Returns { aps, counted, ignored }.
export function averagePointScore(grades) {
  if (!Array.isArray(grades) || grades.length === 0) {
    return { aps: null, counted: 0, ignored: 0 };
  }
  let sum = 0, counted = 0, ignored = 0;
  for (const item of grades) {
    const raw = (item && typeof item === 'object') ? item.grade : item;
    const p = gradeToPoints(raw);
    if (p === null) { ignored++; continue; }
    sum += p; counted++;
  }
  return { aps: counted ? sum / counted : null, counted, ignored };
}

export const PRIOR_BANDS = ['<1', '1-<2', '2-<3', '3-<4', '4-<5', '5-<6', '6-<7', '7-<8', '8-<9', '9>='];

// Map an APS value to a DfE prior-attainment band.
export function apsToBand(aps) {
  if (aps === null || aps === undefined || !Number.isFinite(aps)) return null;
  if (aps < 1) return '<1';
  if (aps >= 9) return '9>=';
  const lo = Math.floor(aps);
  return `${lo}-<${lo + 1}`;
}

// Ordered index of a band, for finding neighbours when pooling small cohorts.
export function bandIndex(band) {
  return PRIOR_BANDS.indexOf(band);
}
