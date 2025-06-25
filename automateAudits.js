const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const auditSitemapURLs = require('./auditSitemapURLs');

const GROUPINGS_FILE = 'election_groupings.csv';
const SITEMAP_CSV = 'goodparty_sitemap_urls.csv';

/**
 * Read CSV into an array of row objects preserving column order.
 * @param {string} filePath
 * @returns {Promise<Array<Object>>}
 */
function readCsv(filePath) {
  return new Promise((resolve, reject) => {
    const rows = [];
    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', (row) => rows.push(row))
      .on('end', () => resolve(rows))
      .on('error', reject);
  });
}

/**
 * Build output CSV filename based on election group row.
 */
function buildOutputFilename(row) {
  const number = row['Number'].padStart(2, '0'); // ensure leading zero
  const state = row['State'];
  const type = row['Type']; // 'counties' or 'positions'
  return `csv_output/${number}_${state}_elections_${type}_non_200_responses.csv`;
}

(async function run() {
  const rows = await readCsv(GROUPINGS_FILE);

  // Determine header order from the first row keys
  const headers = Object.keys(rows[0]);

  for (const row of rows) {
    // Skip rows that already have results (non-empty)
    if (row['404s'] && row['404s'].trim() !== '') continue;

    const firstRow = Number(row['First Row']);
    const lastRow = Number(row['Last Row']);
    const outputCsv = buildOutputFilename(row);

    console.log(`\n=== Auditing ${outputCsv} (rows ${firstRow}-${lastRow}) ===`);

    try {
      const { count404, non404ErrorCount } = await auditSitemapURLs({
        inputCsv: SITEMAP_CSV,
        outputCsv,
        firstRow,
        lastRow
      });

      // Update counts in memory
      row['404s'] = String(count404);
      row['Non-404 Errors'] = String(non404ErrorCount);

      console.log(`Finished ${outputCsv}: ${count404} 404s, ${non404ErrorCount} other errors.`);
    } catch (err) {
      console.error(`Error processing ${outputCsv}:`, err);
      // Leave counts blank so we can retry later
    }
  }

  // Write updated CSV back to disk
  const csvWriter = createCsvWriter({
    path: GROUPINGS_FILE,
    header: headers.map((h) => ({ id: h, title: h }))
  });

  await csvWriter.writeRecords(rows);
  console.log('\nUpdated election_groupings.csv with new counts.');
})().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
}); 