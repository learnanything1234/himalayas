#!/usr/bin/env python3
"""
Reproduces data/alevel_transition_matrix.csv and data/alevel_cohort_sizes.csv
from the DfE's published KS5 transition-matrix R data files.

Source (official, open):
  https://github.com/dfe-analytical-services/ks5-transition-matrices
  data/all_student_percentages.rds  — grade % by qual/subject/prior-band/year
  data/all_student_numbers.rds       — cohort counts for the same cells

The prior-attainment band is the student's mean GCSE points-per-entry
(age-standardised in the DfE pipeline), bucketed into <1, 1-<2, … 8-<9, 9>=.
See the SQL that builds these tables (SQL_production/TM_2024A_data.sql, the
PRIOR_BAND CASE expression) and:
  https://ffteducationdatalab.org.uk/2020/08/using-gcse-average-point-score-as-a-measure-of-a-level-prior-attainment/

Usage:
  python3 -m venv venv && ./venv/bin/pip install pyreadr pandas
  # download the two .rds files from the repo above into ./raw/
  ./venv/bin/python scripts/extract_dfe_data.py
"""
import os
import pyreadr
import pandas as pd

RAW = os.environ.get("RAW_DIR", "raw")
OUT = os.environ.get("OUT_DIR", "data")
GRADES = ["*", "A", "B", "C", "D", "E", "U"]  # '*' == A*
BANDS = ["<1", "1-<2", "2-<3", "3-<4", "4-<5", "5-<6", "6-<7", "7-<8", "8-<9", "9>="]
KEEP = BANDS + ["All", "Unknown prior"]


def pct(v):
    if pd.isna(v):
        return None
    s = str(v).strip().replace("%", "")
    if s in ("", "NA", "-", "x", "c"):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def main():
    pctdf = pyreadr.read_r(os.path.join(RAW, "all_student_percentages.rds"))[None]
    numdf = pyreadr.read_r(os.path.join(RAW, "all_student_numbers.rds"))[None]
    al = pctdf[pctdf.Qual_Description == "GCE A level"]

    rows = []
    for _, r in al.iterrows():
        if r["PRIOR_BAND"] not in KEEP:
            continue
        dist = {g: pct(r[g]) for g in GRADES}
        if all(v is None for v in dist.values()):
            continue
        rows.append({
            "year": int(r["ReportYr"]), "subject": r["Subject"], "subj_code": r["SUBJ"],
            "prior_band": r["PRIOR_BAND"],
            "Astar": dist["*"], "A": dist["A"], "B": dist["B"], "C": dist["C"],
            "D": dist["D"], "E": dist["E"], "U": dist["U"],
        })
    out = pd.DataFrame(rows)
    out.to_csv(os.path.join(OUT, "alevel_transition_matrix.csv"), index=False)
    print(f"wrote {len(out)} rows, {out.subject.nunique()} subjects, years {sorted(out.year.unique())}")

    aln = numdf[numdf.Qual_Description == "GCE A level"]
    nrows = []
    for _, r in aln.iterrows():
        if r["PRIOR_BAND"] not in KEEP:
            continue
        tot, any_ = 0, False
        for g in GRADES:
            v = r[g]
            try:
                if pd.notna(v) and str(v).strip() not in ("NA", "", "-"):
                    tot += int(float(str(v).replace(",", "")))
                    any_ = True
            except ValueError:
                pass
        if any_:
            nrows.append({"year": int(r["ReportYr"]), "subject": r["Subject"],
                          "prior_band": r["PRIOR_BAND"], "n_students": tot})
    nd = pd.DataFrame(nrows)
    nd.to_csv(os.path.join(OUT, "alevel_cohort_sizes.csv"), index=False)
    print(f"wrote {len(nd)} cohort-size rows")


if __name__ == "__main__":
    main()
