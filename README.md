# Sitemap Audit

This repository contains small Node.js utilities that crawl Good Party's sitemap CSV and report any URLs returning something other than HTTP 200 (especially **404 Not Found**).

## Project layout

```
├── auditSitemapURLs.js       # Core function (now reusable + CLI) that audits a slice of URLs
├── automateAudits.js         # Loops over election_groupings.csv and calls auditSitemapURLs.js for every pending range
├── election_groupings.csv    # Index of URL ranges (first/last row) and collected error counts
├── goodparty_sitemap_urls.csv# Original sitemap containing every URL (header row + data rows)
├── csv_output/               # Generated per-range CSVs of non-200 responses
├── processElectionGroupings.js# (Legacy) helper that originally produced election_groupings.csv
├── package.json              # npm scripts and dependencies
└── README.md                 # You are here
```

## Prerequisites

* Node.js ≥ 14
* `npm install` (installs axios, csv-parser, csv-writer, p-limit)

## npm scripts

| Script | Purpose |
|--------|---------|
| `npm run audit:all` | Runs **automateAudits.js**. Iterates through every row in `election_groupings.csv` where the `404s` and `Non-404 Errors` cells are blank. For each range it:<br>1. Audits URLs between `First Row` and `Last Row`.<br>2. Writes a CSV to `csv_output/<number>_<state>_elections_<type>_non_200_responses.csv` containing every non-200 response.<br>3. Updates the counts back into `election_groupings.csv`. |
| `npm run audit:range -- <outputCsv> <firstRow> <lastRow> [inputCsv]` | Manually audit an arbitrary slice of the sitemap. Good for re-checking a single range. Example:<br>`npm run audit:range -- csv_output/14_id_elections_counties_non_200_responses.csv 23118 23509` |
| `npm run audit` | Direct call to `node auditSitemapURLs.js` (kept for compatibility). You'll usually prefer `audit:range` so you can supply arguments. |
| `npm run grouping` | Runs **processElectionGroupings.js** (legacy helper used to generate the grouping CSV). |

> **Note**: When using `npm run audit:range`, everything after `--` is passed straight to Node, so you can supply exactly the parameters required by the CLI wrapper inside `auditSitemapURLs.js`.

## How error data flows

1. The master sitemap (`goodparty_sitemap_urls.csv`) includes **all** URLs; each data row's index is used in `election_groupings.csv`.
2. `election_groupings.csv` stores, per (state, type) grouping:
   * `First Row`, `Last Row` – inclusive row numbers in the sitemap CSV.
   * `404s`, `Non-404 Errors` – counts that the audit scripts fill in automatically.
3. During auditing, the script hits every URL in the specified range (with a configurable concurrency limit and timeout). Non-200 responses are collected and written to a per-range CSV under `csv_output/`.
4. Once a row has both counts filled in, `automateAudits.js` will skip it on subsequent runs, allowing the process to be safely resumed.

## XML Sitemap Validator

Good Party's sitemaps can be validated end-to-end with `validateSitemapFiles.js` (see npm scripts below). The validator performs **strict, production-grade** checks on both individual sitemaps and sitemap indexes:

- ✓ Valid XML structure (well-formed)  
- ✓ Required XML namespace (`http://www.sitemaps.org/schemas/sitemap/0.9`)  
- ✓ Presence of required `<loc>` elements  
- ✓ Valid URL formats (`http` / `https`)  
- ✓ Valid date formats (W3C DateTime)  
- ✓ Valid `changefreq` values (`always`, `hourly`, `daily`, `weekly`, `monthly`, `yearly`, `never`)  
- ✓ Valid `priority` values (`0.0 – 1.0`)  
- ✓ File size limit ≤ **50 MB**  
- ✓ URL count limit ≤ **50 000** per sitemap  
- ✓ Duplicate URL detection  
- ✓ Unescaped characters detection (`&`, `<`, `>`)

### Useful commands

| Script | What it does |
|--------|--------------|
| `npm run validate:prod` | Recursively validates the production site's `sitemap.xml` and every referenced child sitemap. |
| `npm run validate:states` | Validates the "problem" state sitemaps (both `candidates` and `state`) on production. |
| `npm run validate:pr` | Same as above but hits a preview deployment URL (helpful in CI/PR workflows). |
| `npm run health` | Runs a lightweight health-check hitting only the most common sitemap endpoints. |

You can also run the script directly:

```bash
node validateSitemapFiles.js --recursive https://example.com/sitemap.xml
```

---

Happy auditing & validating! 🎉 