const fs = require('fs');
const csv = require('csv-parser');
const axios = require('axios');
const pLimit = require('p-limit');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;

/**
 * Audit a slice of URLs from a sitemap CSV and write all non-200 responses to disk.
 *
 * @param {Object} options
 * @param {string} options.inputCsv      Path to the sitemap CSV containing *all* URLs.
 * @param {string} options.outputCsv     Destination CSV for non-200 responses.
 * @param {number} options.firstRow      First (1-based) data row to process.
 * @param {number} options.lastRow       Last (inclusive) data row to process.
 * @param {number} [options.concurrencyLimit=10]  Max concurrent HTTP requests.
 * @param {number} [options.timeout=10000]        Request timeout in ms.
 * @param {number} [options.maxNon404Results=0]   Early-stop after N non-404 errors (0 = no limit).
 * @returns {Promise<{count404:number, non404ErrorCount:number}>}
 */
async function auditSitemapURLs({
  inputCsv = 'goodparty_sitemap_urls.csv',
  outputCsv,
  firstRow,
  lastRow,
  concurrencyLimit = 10,
  timeout = 10000,
  maxNon404Results = 0
}) {
  if (!outputCsv || !firstRow || !lastRow) {
    throw new Error('outputCsv, firstRow and lastRow are required parameters');
  }

  // Per-execution state
  const limit = pLimit.default(concurrencyLimit);
  const results = [];
  let rowNumber = 0;
  const tasks = [];
  let count404 = 0;
  let non404ErrorCount = 0;
  let shouldStop = false;

  // Configure writer lazily (after ensuring directory exists)
  const csvWriter = createCsvWriter({
    path: outputCsv,
    header: [
      { id: 'url', title: 'URL' },
      { id: 'status', title: 'Status' },
      { id: 'error', title: 'Error' }
    ]
  });

  // Helper to audit a single URL
  async function checkUrl(url) {
    if (shouldStop) return;
    try {
      const response = await axios.get(url, { timeout });
      if (response.status !== 200) {
        results.push({ url, status: response.status });
        if (response.status === 404) {
          count404++;
        } else {
          non404ErrorCount++;
          if (maxNon404Results > 0 && non404ErrorCount >= maxNon404Results) {
            shouldStop = true;
          }
        }
      }
    } catch (error) {
      if (error.response) {
        // Server responded with a non-2xx status
        results.push({ url, status: error.response.status });
        if (error.response.status === 404) {
          count404++;
        } else {
          non404ErrorCount++;
          if (maxNon404Results > 0 && non404ErrorCount >= maxNon404Results) {
            shouldStop = true;
          }
        }
      } else if (error.request) {
        // No response received (e.g. network error)
        results.push({ url, error: 'No response received' });
        non404ErrorCount++;
        if (maxNon404Results > 0 && non404ErrorCount >= maxNon404Results) {
          shouldStop = true;
        }
      } else {
        // Request setup error
        results.push({ url, error: error.message });
        non404ErrorCount++;
        if (maxNon404Results > 0 && non404ErrorCount >= maxNon404Results) {
          shouldStop = true;
        }
      }
    }
  }

  // Wrap stream logic in a Promise so callers can await completion
  return new Promise((resolve, reject) => {
    fs.createReadStream(inputCsv)
      .pipe(csv({ headers: false }))
      .on('data', (row) => {
        if (shouldStop) return;
        rowNumber++;
        if (rowNumber > 1) { // Skip header
          const dataRowNumber = rowNumber - 1;
          if (dataRowNumber >= firstRow && dataRowNumber <= lastRow) {
            const url = row[0];
            tasks.push(limit(() => checkUrl(url)));
          }
        }
      })
      .on('end', async () => {
        console.log(`Processing rows ${firstRow} to ${lastRow}...`);
        await Promise.all(tasks);
        await csvWriter.writeRecords(results);
        console.log(`Completed with ${count404} 404 responses and ${non404ErrorCount} non-404 error responses.`);
        resolve({ count404, non404ErrorCount });
      })
      .on('error', (err) => reject(err));
  });
}

module.exports = auditSitemapURLs;

// -----------------------------------------------------------
// CLI helper: node auditSitemapURLs.js <outputCsv> <firstRow> <lastRow> [inputCsv]
// -----------------------------------------------------------

if (require.main === module) {
  const [,, outputCsv, firstRowArg, lastRowArg, inputCsvArg] = process.argv;

  if (!outputCsv || !firstRowArg || !lastRowArg) {
    console.error('Usage: node auditSitemapURLs.js <outputCsv> <firstRow> <lastRow> [inputCsv]');
    process.exit(1);
  }

  auditSitemapURLs({
    inputCsv: inputCsvArg || 'goodparty_sitemap_urls.csv',
    outputCsv,
    firstRow: Number(firstRowArg),
    lastRow: Number(lastRowArg)
  }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
