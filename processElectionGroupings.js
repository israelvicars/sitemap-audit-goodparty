const fs = require('fs');
const csv = require('csv-parser');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;

const inputFile = 'goodparty_sitemap_urls.csv';
const outputFile = 'election_groupings.csv';
const startRow = 949; // 1-based index

function parseUrl(url) {
    const parts = url.split('/');
    if (parts.length >= 5 && parts[3] === 'elections') {
        if (parts[4] === 'position' && parts.length >= 6 && parts[5].length === 2) {
            return { state: parts[5], type: 'positions' };
        } else if (parts[4].length === 2 && parts[4].match(/^[a-z]+$/i)) {
            return { state: parts[4], type: 'counties' };
        }
    }
    return null;
}

async function processCsv() {
    const rows = [];
    let rowNum = 0;

    await new Promise((resolve, reject) => {
        fs.createReadStream(inputFile)
            .pipe(csv())
            .on('data', (data) => {
                rowNum++;
                if (rowNum >= startRow) {
                    rows.push(data);
                }
            })
            .on('end', resolve)
            .on('error', reject);
    });

    let currentState = null;
    let currentType = null;
    let startRowNum = startRow;
    const ranges = [];

    rows.forEach((row, index) => {
        const url = row[Object.keys(row)[0]]; // Assuming the URL is in the first column
        const parsed = parseUrl(url);
        if (!parsed) return;

        const { state, type } = parsed;

        if (state !== currentState) {
            if (currentState) {
                ranges.push({
                    State: currentState,
                    Type: currentType,
                    'First Row': startRowNum,
                    'Last Row': startRow + index - 1
                });
            }
            currentState = state;
            currentType = type;
            startRowNum = startRow + index;
        } else if (type !== currentType) {
            ranges.push({
                State: currentState,
                Type: currentType,
                'First Row': startRowNum,
                'Last Row': startRow + index - 1
            });
            currentType = type;
            startRowNum = startRow + index;
        }

        // For the last row
        if (index === rows.length - 1) {
            ranges.push({
                State: currentState,
                Type: currentType,
                'First Row': startRowNum,
                'Last Row': startRow + index
            });
        }
    });

    const csvWriter = createCsvWriter({
        path: outputFile,
        header: [
            { id: 'State', title: 'State' },
            { id: 'Type', title: 'Type' },
            { id: 'First Row', title: 'First Row' },
            { id: 'Last Row', title: 'Last Row' }
        ]
    });

    await csvWriter.writeRecords(ranges);
    console.log(`CSV generated as '${outputFile}'`);
}

processCsv().catch(console.error);
