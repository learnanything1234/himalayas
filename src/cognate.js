// Subject-specific ("cognate") prior attainment.
//
// The DfE transition matrices condition on OVERALL mean GCSE — so they can't tell
// that a student is strong in Geography and weak in Art. This layer adds real
// national data on how the GCSE grade in the SAME subject predicts the A-level.
//
// Source: Cambridge Assessment, "Progression from GCSE to A Level, 2021–2023"
// (Statistics Report Series No. 144), Table 2 — cumulative % of candidates
// progressing from a given GCSE grade (in a subject) to a given A-level grade in
// that same subject.
//   https://www.cambridgeassessment.org.uk/Images/735630-144.-progression-from-gcse-to-a-level-2021-2023.pdf
//
// Keyed by canonical DfE A-level subject name. `gcse` is the GCSE key the site
// already collects. `bands` are ordered high→low; `cum` is the cumulative %
// obtaining [A*/A, ≥B, ≥C] (grades D/E/U make up the rest to 100).

export const COGNATE = {
  'Art and Design': { gcse: 'art', bands: [
    { min: 8, cum: [58, 89, 98] },
    { min: 7, cum: [17, 60, 89] },
    { min: 6, cum: [10, 39, 78] },
    { min: 0, cum: [5, 19, 51] },
  ] },
  'Biology': { gcse: 'biology', bands: [
    { min: 8, cum: [46, 74, 90] },
    { min: 7, cum: [9, 32, 60] },
    { min: 0, cum: [2, 12, 32] },
  ] },
  'Chemistry': { gcse: 'chemistry', bands: [
    { min: 8, cum: [47, 73, 88] },
    { min: 7, cum: [9, 30, 55] },
    { min: 0, cum: [2, 12, 31] },
  ] },
  'English Literature': { gcse: 'englit', bands: [
    { min: 8, cum: [43, 80, 96] },
    { min: 7, cum: [12, 48, 83] },
    { min: 6, cum: [4, 24, 64] },
    { min: 0, cum: [1, 11, 38] },
  ] },
  'French': { gcse: 'french', bands: [
    { min: 8, cum: [44, 76, 92] },
    { min: 0, cum: [3, 19, 47] },
  ] },
  'Geography': { gcse: 'geography', bands: [
    { min: 8, cum: [42, 78, 95] },
    { min: 7, cum: [11, 44, 79] },
    { min: 6, cum: [3, 22, 58] },
    { min: 0, cum: [1, 8, 34] },
  ] },
  'History': { gcse: 'history', bands: [
    { min: 8, cum: [39, 77, 94] },
    { min: 7, cum: [11, 45, 80] },
    { min: 6, cum: [4, 26, 61] },
    { min: 0, cum: [1, 10, 38] },
  ] },
  'Mathematics': { gcse: 'maths', bands: [
    { min: 8, cum: [51, 72, 86] },
    { min: 7, cum: [10, 27, 50] },
    { min: 0, cum: [3, 12, 28] },
  ] },
  'Mathematics (Further)': { gcse: 'maths', bands: [
    { min: 8, cum: [58, 78, 90] },
    { min: 0, cum: [14, 30, 49] },
  ] },
  'Physics': { gcse: 'physics', bands: [
    { min: 8, cum: [45, 69, 86] },
    { min: 7, cum: [7, 23, 48] },
    { min: 0, cum: [2, 8, 24] },
  ] },
};

export const COGNATE_SUBJECTS = Object.keys(COGNATE);

// Weight given to the cognate (same-subject) signal when blending with the
// overall-mean-GCSE prediction. Cognate is weighted higher because it is the
// more subject-relevant signal, but overall ability still counts. Tunable;
// provisional pending a joint (mean × cognate) fit on microdata.
export const COGNATE_WEIGHT = 0.6;

// Grade-group fractions {AA, B, C, DEU} for a subject given the student's GCSE
// grade in it. Returns null if we have no cognate data or no usable grade.
export function cognateGroups(subject, gcseGrade) {
  const rec = COGNATE[subject];
  const g = Number(gcseGrade);
  if (!rec || !Number.isFinite(g) || g < 1) return null; // g<1 => not taken
  const band = rec.bands.find((b) => g >= b.min) || rec.bands[rec.bands.length - 1];
  const [c1, c2, c3] = band.cum;
  return {
    AA: c1 / 100,
    B: Math.max(0, c2 - c1) / 100,
    C: Math.max(0, c3 - c2) / 100,
    DEU: Math.max(0, 100 - c3) / 100,
    band_min: band.min,
    gcse: rec.gcse,
  };
}
