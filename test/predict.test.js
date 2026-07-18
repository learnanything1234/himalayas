import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Predictor, contextDelta } from '../src/predict.js';
import { averagePointScore, apsToBand, gradeToPoints } from '../src/grades.js';
import { resolveSubject } from '../src/subjects.js';

test('gradeToPoints handles 9-1, legacy letters and junk', () => {
  assert.equal(gradeToPoints(8), 8);
  assert.equal(gradeToPoints('7'), 7);
  assert.equal(gradeToPoints('A*'), 8.5);
  assert.equal(gradeToPoints('U'), 0);
  assert.equal(gradeToPoints('nonsense'), null);
});

test('averagePointScore averages graded entries', () => {
  const r = averagePointScore([8, 8, 8, 7, 7]);
  assert.equal(r.counted, 5);
  assert.ok(Math.abs(r.aps - 7.6) < 1e-9);
});

test('apsToBand maps to DfE bands', () => {
  assert.equal(apsToBand(0.5), '<1');
  assert.equal(apsToBand(6.9), '6-<7');
  assert.equal(apsToBand(7.0), '7-<8');
  assert.equal(apsToBand(9.1), '9>=');
  assert.equal(apsToBand(null), null);
});

test('resolveSubject maps every design subject name to a canonical DfE subject', () => {
  const known = new Set(['Mathematics', 'Mathematics (Further)', 'Physics', 'Chemistry',
    'Computer Studies / Computing', 'Biology', 'French', 'Economics', 'History', 'Geography',
    'English Literature', 'Government and Politics', 'Psychology', 'Religious Studies', 'Sociology',
    'Business Studies:Single', 'Drama and Theatre Studies', 'Physical Education / Sports Studies',
    'Art and Design', 'Media/Film/Tv Studies']);
  const designNames = ['Further Mathematics', 'Physics', 'Chemistry', 'Computer Science', 'Mathematics',
    'Biology', 'French', 'Economics', 'History', 'Geography', 'English Literature', 'Politics',
    'Psychology', 'Religious Studies', 'Sociology', 'Business Studies', 'Drama', 'Physical Education',
    'Art & Design', 'Media Studies'];
  for (const name of designNames) {
    const r = resolveSubject(name, known);
    assert.ok(r.subject, `"${name}" should resolve (got ${JSON.stringify(r)})`);
  }
});

test('contextDelta combines published coefficients', () => {
  const { delta } = contextDelta({ disadvantaged: true, birthMonth: 7, attendance: 90 });
  // -0.11 (disadv) + -0.02 (summer) + (90-95)*0.010 = -0.18
  assert.ok(Math.abs(delta - (-0.18)) < 1e-9, `delta was ${delta}`);
});

test('predictor: higher prior attainment yields higher expected grade (monotonic)', () => {
  const p = new Predictor();
  try {
    const low = p.predict({ gcseAps: 5.0, subjects: ['Biology'] });
    const high = p.predict({ gcseAps: 8.5, subjects: ['Biology'] });
    const lv = low.predictions[0].grade_value;
    const hv = high.predictions[0].grade_value;
    assert.ok(hv > lv, `expected high(${hv}) > low(${lv})`);
    // distribution sums to ~100
    const dsum = Object.values(high.predictions[0].distribution).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(dsum - 100) < 0.5, `distribution sums to ${dsum}`);
    // front-end fields present
    const pr = high.predictions[0];
    for (const f of ['grade', 'confidence', 'marker_pct', 'band_left_pct', 'band_width_pct']) {
      assert.ok(pr[f] != null, `missing ${f}`);
    }
  } finally { p.close(); }
});

test('predictor: context lowers the expected value', () => {
  const p = new Predictor();
  try {
    const base = p.predict({ gcseAps: 6.5, subjects: ['Sociology'] });
    const adj = p.predict({ gcseAps: 6.5, subjects: ['Sociology'],
      context: { disadvantaged: true, attendance: 85 } });
    assert.ok(adj.predictions[0].grade_value < base.predictions[0].grade_value);
  } finally { p.close(); }
});

test('predictor: cognate GCSE makes predictions subject-specific', () => {
  const p = new Predictor();
  try {
    // same overall mean, opposite subject strengths
    const strongGeo = p.predict({ gcseAps: 8, subjects: [{ name: 'Geography', cognateGrade: 9 }] });
    const weakGeo = p.predict({ gcseAps: 8, subjects: [{ name: 'Geography', cognateGrade: 4 }] });
    assert.equal(strongGeo.predictions[0].prediction_basis, 'cognate_gcse');
    assert.ok(strongGeo.predictions[0].grade_value > weakGeo.predictions[0].grade_value,
      'GCSE 9 should beat GCSE 4 in the same subject at equal mean');
    // the Art/Geography inversion is fixed
    const r = p.predict({ gcseAps: 6.2, subjects: [
      { name: 'Geography', cognateGrade: 9 }, { name: 'Art & Design', cognateGrade: 1 }] });
    const [geo, art] = r.predictions;
    assert.ok(geo.grade_value > art.grade_value, 'Geography(9) should now beat Art(1)');
    // subjects without a cognate GCSE fall back cleanly to the mean model
    const eco = p.predict({ gcseAps: 6.2, subjects: [{ name: 'Economics', cognateGrade: 9 }] });
    assert.equal(eco.predictions[0].prediction_basis, 'mean_gcse');
  } finally { p.close(); }
});

test('predictor: unknown subject returns a clear error, not a crash', () => {
  const p = new Predictor();
  try {
    const r = p.predict({ gcseAps: 7, subjects: ['Underwater Basket Weaving'] });
    assert.equal(r.predictions[0].error, 'subject_not_found');
  } finally { p.close(); }
});
