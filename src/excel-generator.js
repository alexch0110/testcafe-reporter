const ExcelJS = require('exceljs');
const configReader = require('./config-reader');
const config = configReader.CurrentConfig.excel;
const columnsToShow = config.showColumns.filter(c => configReader.DefaultExcelColumns.includes(c));
const columnsToShowIndexes = configReader.DefaultExcelColumns.map(c => columnsToShow.indexOf(c));

const MAX_RUNS_PER_TEST = 3;

function autofitColumns (worksheet, minWidth = 10, extra = 2, maxWidth = 80) {
    const colWidths = [];

    worksheet.eachRow({ includeEmpty: false }, row => {
        row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
            let text = '';

            if (!cell.value) 
                text = '';
            else if (typeof cell.value === 'string' || typeof cell.value === 'number') 
                text = String(cell.value);
            else if (cell.value.richText) 
                text = cell.value.richText.map(t => t.text).join('');
            else if (cell.value.text) 
                text = String(cell.value.text);
            else 
                text = String(cell.value);
            

            const len = text.length;
            const current = colWidths[colNumber] || minWidth;
            const newWidth = Math.min(Math.max(current, len + extra), maxWidth);

            colWidths[colNumber] = newWidth;
        });
    });

    worksheet.columns.forEach((col, i) => {
        const colIndex = i + 1; // columns are 1-based

        col.width = colWidths[colIndex] || minWidth;
    });
}

async function generateReport (report, outPath) {
    function serializeStack (stack) {
        if (!stack || !stack.length) return '';
        return stack
            .slice(0, 2)
            .map(err => err.join('\n'))
            .join('\n\n');
    }

    function sameStatusAndError (a, b) {
        if (a.status !== b.status) return false;
        return serializeStack(a.stackTrace) === serializeStack(b.stackTrace);
    }

    function parseTime (time) {
        if (!time) return null;
        const d = new Date(time);

        if (Number.isNaN(d.getTime())) return null;
        return d;
    }

    // group by fixture+test
    const history = new Map();

    for (const fixture of report.fixtures || []) {
        for (const test of fixture.tests || []) {
            const dt = parseTime(test.time);

            if (!dt) continue;

            const key = `${fixture.name}||${test.name}`;
            const arr = history.get(key) || [];

            arr.push({
                fixtureName: fixture.name,
                testName:    test.name,
                status:      test.status ?? null,
                stackTrace:  test.stackTrace ?? null,
                timeString:  test.time,
                date:        dt,
            });
            history.set(key, arr);
        }
    }

    const rows = [];

    for (const [, runsAll] of history.entries()) {
        runsAll.sort((a, b) => b.date - a.date);
        const runs = runsAll.slice(0, MAX_RUNS_PER_TEST);

        const current = runs[0];
        const status = current.status || '';

        if (!config.showStatuses.includes(status)) continue;

        const prev1 = runs[1];
        const prev2 = runs[2];

        const stack = current.stackTrace || [];
        const error1 = stack[0] ? stack[0].join('\n') : '';
        const error2 = stack[1] ? stack[1].join('\n') : '';

        let changedLast2 = '';

        let changedLast3 = '';

        let isLastWithoutStatus = '';

        if (prev1) changedLast2 = sameStatusAndError(current, prev1) ? 'no' : 'yes';
        if (prev1 && prev2) {
            const stable =
        sameStatusAndError(current, prev1) &&
        sameStatusAndError(current, prev2);

            changedLast3 = stable ? 'no' : 'yes';
        }
        if (!current.status) isLastWithoutStatus = 'yes';

        rows.push({
            fixtureName: current.fixtureName,
            testName:    current.testName,
            status:      status,
            error1,
            error2,
            changedLast2,
            changedLast3,
            isLastWithoutStatus,
            currentRun:  current,
            prev1,
            prev2,
        });
    }

    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet('Report');

    const headerRow = sheet.addRow(columnsToShow);

    headerRow.font = { bold: true };
    headerRow.alignment = { horizontal: 'center' };

    sheet.columns = [
        { width: 25 },
        { width: 40 },
        { width: 12 },
        { width: 60 },
        { width: 60 },
        { width: 18 },
        { width: 18 },
        { width: 22 },
    ];
    sheet.getColumn(4).alignment = { wrapText: config.useErrorsWrapText, vertical: 'top' };
    sheet.getColumn(5).alignment = { wrapText: config.useErrorsWrapText, vertical: 'top' };

    function pickColor (info) {
        if (info.isLastWithoutStatus === 'yes') return 'FFE6CCFF';

        switch (info.status) {
        case 'passed':
            return config.fillColors.passed;
        case 'broken':
            return config.fillColors.broken;
        case 'skipped':
            return config.fillColors.skipped;
        case 'failed': {
            const { currentRun, prev1, prev2 } = info;
            const same2 = prev1 && sameStatusAndError(currentRun, prev1);
            const same3 =
          prev1 &&
          prev2 &&
          sameStatusAndError(currentRun, prev1) &&
          sameStatusAndError(currentRun, prev2);

            if (same3) return config.fillColors.failed.same3runs;
            if (same2) return config.fillColors.failed.same2runs;
            return config.fillColors.failed.diffentResults;
        }
        default:
            return config.fillColors.emptyStatus;
        }
    }

    for (const info of rows) {
        const row = [];
        const rowData = [
            info.fixtureName,
            info.testName,
            info.status,
            info.error1,
            info.error2,
            info.changedLast2,
            info.changedLast3,
            info.isLastWithoutStatus,
        ];

        for (let i = 0; i < columnsToShowIndexes.length; i++) {
            const dataIndex = columnsToShowIndexes[i];

            if (dataIndex !== -1) row[dataIndex] = rowData[i];
        }

        const r = sheet.addRow(row);

        const color = pickColor(info);

        autofitColumns(sheet);
        r.eachCell(cell => {
            cell.fill = {
                type:    'pattern',
                pattern: 'solid',
                fgColor: { argb: color },
            };
        });
    }

    await wb.xlsx.writeFile(outPath);
}

async function safeGenerateExcel (report, outPath) {
    const color = (r, g, b, text) => `\x1b[38;2;${r};${g};${b}m${text}\x1b[0m`;

    try {
        await generateReport(report, outPath);
        console.log(color(167, 217, 167, 'Excel generated: ' + outPath));
    }
    catch (err) {
        console.log(color(217, 167, 167, 'Error in generating excel: ' + err));
    }
}

// export function
module.exports = safeGenerateExcel;
