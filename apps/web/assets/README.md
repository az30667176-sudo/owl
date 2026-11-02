# Static frontend assets

- `zip-to-district.json` — ZIP (ZCTA5) → congressional district(s), e.g. `{"94110":["CA-11"],"90210":["CA-32","CA-36","CA-30"]}`. Several entries when a ZIP spans districts, ordered by land area. Built from the Census 2020 ZCTA↔CD119 relationship file (`tab20_cd11920_zcta520_natl.txt` at https://www2.census.gov/geo/docs/maps-data/data/rel2020/cd-sld/), i.e. the 119th-Congress districts the app's members hold. 33,791 ZIPs, 5,862 of them spanning more than one district. At-large and delegate seats use `XX-AL`. Frontend-only; not part of the data contract.
- `logo/` — Muse Image logo at several sizes.
