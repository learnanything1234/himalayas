# Himalayas — open-source A-level predictor

**The free, open-source alternative to ALPs.** Himalayas turns a student's GCSE
prior attainment into evidence-based A-level predictions — a grade, a tolerance
band and a confidence figure for every subject — built entirely on **published
DfE data**, with every formula in this repo.

🌐 **Live:** http://167.233.166.53:8090/ · 📊 **Model transparency:** [`/model`](http://167.233.166.53:8090/model)

---

## Why it exists

Grade prediction shapes real futures, yet the tools schools rely on are closed,
paid, and opaque. Himalayas is the opposite: **free forever, transparent, and
auditable**. Every number comes from official national statistics, and you can
read, question, or recalibrate the model yourself.

## How the model works

The engine is the DfE's official **16–18 (KS5) transition matrices** — the actual
national grade distributions achieved by students at each level of prior
attainment. It's built on **3,113,847 real A-level results** across 63 subjects
and four years (2022–2025).

1. **Prior attainment** — average the student's GCSE grades into a single 9–1
   score ("GCSE average point score"), the measure Ofqual uses for A-level
   starting point.
2. **Band** — bucket it into a DfE prior-attainment band (`<1 … 9>=`).
3. **Empirical lookup** — for each subject, read `P(A* / A / B / C / D / E / U |
   subject, band)`, pooled across four years and weighted by cohort size.
4. **Forecast** — the distribution's mean is the predicted grade; ±1 standard
   deviation is the tolerance band; the probability of landing within one grade
   of the mode is the confidence.
5. **Subject-specific (when available)** — mean GCSE alone can't tell that a
   student is strong in Geography and weak in Art. Where the site knows the GCSE
   grade in the *same* subject, it blends in real national data on how those
   students actually did at A-level (Cambridge Assessment, *Progression from GCSE
   to A Level 2021–23*) — live for Maths, Further Maths, the sciences, Geography,
   History, English Literature, French and Art. Others use the mean.
6. **Context (optional)** — four adjustments, each anchored to published research
   (see below).

### Context factors — every one sourced

Layered on the prior-attainment model. Served in full at `GET /model`.

| Factor | Adjustment | Anchored to |
|---|---|---|
| Disadvantaged / PP | −0.11 grade | [DfE 2024/25 A-level disadvantage gap](https://explore-education-statistics.service.gov.uk/find-statistics/a-level-and-other-16-to-18-results/2024-25) (4.6 pts ≈ 0.46 grade), residual after prior attainment |
| EAL | +0.06 grade | [FFT: EAL Progress 8 +0.55 vs −0.09](https://ffteducationdatalab.org.uk/2020/02/what-does-english-as-an-additional-language-really-mean-when-it-comes-to-progress-8/), attenuated for A-level |
| Summer-born | −0.02 grade | [Relative-age effect washes out by A-level](https://www.cambridgeassessment.org.uk/Images/109784-birthdate-effects-a-review-of-the-literature-from-1990-on.pdf) |
| Attendance | +0.01 / point | [DfE 2025 attendance ↔ attainment](https://explore-education-statistics.service.gov.uk/find-statistics/the-link-between-absence-and-attainment-at-ks2-and-ks4) |

These are national-average effects layered on the empirical model, not an
individual-level fit — see the [roadmap](#roadmap) for how we get further.

## API

Zero runtime npm dependencies — Node ≥ 22.5 only (`node:sqlite` + `node:http`).

| Endpoint | Purpose |
|---|---|
| `GET /` | The website |
| `GET /health` | Health + data summary |
| `GET /subjects` | 63 supported subjects |
| `GET /model` | Every coefficient, band, and source (full transparency) |
| `POST /predict` | Predict one student |
| `GET /predict?aps=7.6&subjects=Maths,Physics` | Convenience form |
| `POST /predict/batch` | Predict many students (spreadsheet upload) |
| `GET /sample-students.csv` | Sample bulk-upload spreadsheet |

### `POST /predict`

```jsonc
{
  "gcses": [8, 8, 7, 9, 8, 7, 7],        // or "gcseAps": 7.7, or "priorBand": "7-<8"
  "subjects": ["Mathematics", "Physics", "Chemistry"],
  "context": { "disadvantaged": true, "eal": false, "birthMonth": 7, "attendance": 91 }
}
```

Returns per-subject `grade`, `band.range_label`, `confidence`, `distribution`,
`expected_ucas_points`, plus front-end marker positions and an overall summary.
Subject names are resolved leniently (`Maths`, `Comp Sci`, `Politics`, `Art &
Design` … all map correctly).

### `POST /predict/batch`

`{ "students": [ {name, gcses|gcseAps, subjects, context}, … ] }` → one result
row per student. This backs the spreadsheet upload on the site.

## Run it

```bash
npm run build      # build the SQLite DB + stage the website
npm start          # serve on :3000 (site + API)
npm test           # unit tests
```

Docker:

```bash
docker build -t himalayas . && docker run -p 3000:3000 himalayas
```

## Project layout

```
src/
  server.js      HTTP server (static site + JSON API, zero deps)
  predict.js     prediction engine + context model
  subjects.js    subject name resolution + display names
  grades.js      GCSE APS → prior-attainment band
scripts/
  build-db.mjs         CSV → SQLite
  build-web.mjs        stage Design/ → web/
  extract_dfe_data.py  reproduce the CSVs from the DfE source data
data/            transition-matrix + cohort-size CSVs (public DfE data)
Design/          the Himalayas website (Claude design-canvas component)
deploy/          systemd unit for a VPS
```

Data source: [DfE KS5 transition matrices](https://github.com/dfe-analytical-services/ks5-transition-matrices).
Reproduce the CSVs with `scripts/extract_dfe_data.py`.

## Roadmap

Himalayas today uses the best **free** national data. The next leap needs
pupil-level records — and there's a legitimate path to them.

- **Live today** — 3.1M national A-level results + research-anchored context factors. Free forever.
- **Next — university research partnership.** Our goal is to work with the
  **University of Cambridge's** education researchers on a public-benefit project
  analysing the **National Pupil Database** inside the [ONS Secure Research
  Service](https://www.ukauthority.com/articles/ons-creates-secure-research-service-to-draw-on-schoolchildren-s-database/).
  NPD links each student's GCSEs to their A-level outcomes alongside FSM,
  ethnicity, SEN, deprivation (IDACI) and school type. It can't be used
  commercially — but a university public-benefit project can study it.
- **Then — richer, published matrices.** Disclosure-checked transition matrices
  conditioned on subject-specific GCSEs, school type and deprivation decile, then
  **published as open aggregates** — free for anyone, including local authorities,
  to build on.

The question we want to answer: *what predicts A-level outcomes beyond mean
GCSE?* Slower (6–12 months), but legitimate, cheap, and built to last. See
[`NOTES.md`](NOTES.md) for the technical detail.

## Deploy

```bash
git clone https://github.com/learnanything1234/himalayas /opt/himalayas && cd /opt/himalayas
node scripts/build-db.mjs && node scripts/build-web.mjs
PORT=3000 node src/server.js      # or use deploy/himalayas-api.service, or Docker
```

Put nginx/Caddy in front for TLS. The DB is a single ~1 MB file rebuilt from the
CSVs — nothing stateful to back up.

---

*Predictions are statistical estimates for guidance only and are not a substitute
for teacher assessment. MIT licensed. Not affiliated with ALPs Education.*
