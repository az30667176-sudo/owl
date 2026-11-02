# Static frontend assets

- `zip-to-district.json` — ZIP (ZCTA5) → congressional district(s), e.g. `{"94110":["CA-11"],"90210":["CA-32","CA-36","CA-30"]}`. Several entries when a ZIP spans districts, ordered by land area. Built from the Census 2020 ZCTA↔CD118 relationship file (`tab20_cd11820_zcta520_natl.txt` at https://www2.census.gov/geo/docs/maps-data/data/rel2020/cd-sld/). 118th-Congress districts; the 119th differs only in states that redistricted (AL, GA, LA, NC, NY) — refresh when the CD119 file is published. At-large and delegate seats use `XX-AL`. Frontend-only; not part of the data contract.
- `logo/` — Muse Image logo at several sizes.
