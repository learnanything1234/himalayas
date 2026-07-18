# Modelling notes, limitations & where to go next

## What the model is

`P(A-level grade | subject, prior-attainment band)`, straight from the DfE KS5
transition matrices, with prior attainment measured as mean GCSE grade. This is
a strong, honest baseline: it's the same national data the accountability system
uses, and it's genuinely predictive — e.g. A-level Maths, a top-band (`9>=`)
student has a 62% chance of A\*; a `4-<5` student, ~1%.

## Known limitations (and they matter)

1. **Prior attainment is coarse (whole-band).** The DfE bands are one grade wide
   (`6-<7`, `7-<8`, …). Two students at 7.0 and 7.9 read the same distribution.
   The published aggregates don't let us do better; microdata would allow a
   smooth model.

2. **No demographic conditioning.** The matrices average over disadvantage, EAL,
   sex, ethnicity and centre type. Our `context` layer is a *bolt-on* with
   provisional coefficients, **not** a conditional model. This is the single
   biggest gap and the clearest win from better data.

3. **No subject-specific GCSE conditioning.** We use *overall* mean GCSE, not the
   GCSE grade in the cognate subject. Prior attainment in the relevant GCSE
   varies a lot by A-level choice, and taking (say) A-level Maths lifts Physics
   outcomes — effects this model can't see.
   ([Datalab: prior attainment by KS5 subject](https://ffteducationdatalab.org.uk/2022/12/how-much-does-prior-attainment-in-english-and-maths-vary-by-key-stage-5-subject-choice/),
   [Datalab: does A-level Maths help Physics?](https://ffteducationdatalab.org.uk/2022/05/does-taking-a-level-maths-improve-your-grades-in-physics-and-computer-science/))

4. **Age-standardisation is approximated.** The DfE bands use an age-standardised
   points-per-entry; Ofqual has never published the standardisation, so we use
   raw mean GCSE. Small effect, but it's why "month of birth" partly double-counts
   and should be revisited if the standardisation is ever published.

5. **Independent sector / IGCSE.** No national dataset covers most independent
   schools, and IGCSE ≠ reformed GCSE on difficulty. Predictions for IGCSE
   cohorts will be biased.

6. **Small cells are noisy.** Low prior bands in academic subjects can have <30
   students nationally. We pool across years and expose `cohort_n` /
   `data_confidence` so callers can suppress or flag these — the UI should too.

## How to make it genuinely better

The ceiling here is set by data, not code. In rough order of impact:

- **Calibrate the context layer** against a published *conditional* source —
  Ofqual's A-level-outcomes-by-prior-attainment-and-centre-type tables, or the
  DfE disadvantage-gap-at-16-to-18 figures — instead of the placeholder
  coefficients in `CONTEXT_MODEL`.
- **Fit a proper ordinal model** (e.g. proportional-odds / ordered logit:
  grade ~ mean_GCSE + cognate_GCSE + disadvantage + EAL + month + attendance)
  if you can get **student-level microdata** (NPD/LEO via ONS SRS, or your own
  school's historical results). That removes limitations 1–3 at once and is the
  natural "fork it, recalibrate on your own results" path the site invites.
- **Add cognate-GCSE conditioning** even without microdata by asking for the
  relevant GCSE grade in the UI and weighting the prior band toward it.
- **Widen the qualification set.** The same RDS files hold AS, BTEC, Cambridge
  Technicals, IB and Pre-U; the schema already supports them — only the A-level
  rows are loaded today.

## Extra inputs worth adding to the design

If you want to close the gaps above, the site would need to collect:

- the **GCSE grade in each cognate subject** (or at least English & Maths),
  not just the overall set — enables (3) and cognate weighting;
- **sex** and optionally broad **ethnicity** — used by most VA models;
- **centre type** (school sixth form / SFC / FE / independent) — Ofqual conditions
  on it and it shifts outcomes materially.

All optional, all defensible, all things the published aggregates hint at but
can't fully deliver without conditioning — which is exactly the gap this project
exists to close in the open.

## Roadmap: the NPD / university-partnership path

The ceiling on this model is data, not code, and the dataset that lifts it is the
**National Pupil Database (NPD)** — pupil-level GCSE→A-level linkage plus FSM,
ethnicity, SEN, IDACI (deprivation) and school type. Everything you'd want to
condition on, in one place.

Why we can't just buy it:

- Access is by [application to the DfE](https://www.gov.uk/guidance/apply-for-department-for-education-dfe-personal-data),
  and analysis happens **inside the [ONS Secure Research Service](https://www.ukauthority.com/articles/ons-creates-secure-research-service-to-draw-on-schoolchildren-s-database/)**
  by accredited researchers on approved public-benefit projects.
- The unit records **never leave** the secure environment, and
  [commercial use is not permitted](https://datacatalogue.ukdataservice.ac.uk/series/series/2000108?id=2000108).
- You can browse the [catalogue](https://www.find-npd-data.education.gov.uk/) freely.

The legitimate route — and our goal:

> Partner with a **university education department** (our target: the **University
> of Cambridge**) on a public-benefit research project — *"what predicts A-level
> outcomes beyond mean GCSE?"* The disclosure-checked outputs — e.g. transition
> matrices conditioned on subject-specific GCSE, school type and deprivation
> decile — get **published as open aggregates**, which are then free for anyone
> (including local authorities) to build on.

Slow (6–12 months) but legitimate and cheap. It also keeps Himalayas' core promise
intact: whatever the research produces is published in the open, not locked
behind a licence.
