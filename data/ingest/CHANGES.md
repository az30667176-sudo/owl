# Changes in this drop (2026-11-03)

Compared with the copy in data/ingest.

| table | rows now | added | removed |
|---|---|---|---|
| records.csv | 768 | 1 | 0 |
| evidence.csv | 20,636 | 4,114 | 4,024 |
| people.csv | 451 | 0 | 0 |
| bills.csv | 785 | 3 | 0 |
| issues.csv | 86 | 0 | 0 |
| reports with text | 804 | 3 | 1 |

## Reports newly parsed (3)

- H. Rept. 119-853 (HSPW, 2026-10-29, text from html): MARINER EXAM MODERNIZATION ACT
- H. Rept. 119-854 (HSII, 2026-10-29, text from html): TECHNICAL CORRECTIONS TO THE NORTHWESTERN NEW MEXICO RURAL WATER PROJECTS ACT, TAOS PUEBLO
- H. Rept. 119-856 (HSII, 2026-10-29, text from html): DON YOUNG DOUG LAMALFA INDIAN BUFFALO MANAGEMENT ACT

`delta/<table>.csv` holds only the added rows, same columns as the full tables. Removed rows (a report reparsed differently, a member who left) are not listed row by row; diff on the id columns if needed.
