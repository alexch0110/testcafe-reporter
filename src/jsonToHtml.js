var stepsArray = [];
const fs = require('fs');

// var ad = {
module.exports = {
    jsonNames: {
        baseJsonContent: '{"fixtures": []}',

        test: 'test',

        baseTestContent: (name, id) => {
            return { id: id, name: name, steps: [] };
        },

        fixture: 'fixture',

        baseFixtureContent: (name) => { 
            return { name: name, tests: [] };
        },

        baseStepContent: (name) => {
            return { name: name, actions: [], time: new Date() };
        },

        startTime: 'startTime',

        screenshotOnFail: 'screenshot',

        testUserAgents: 'userAgent',

        testDuration: 'durationMs',

        testStackTrace: 'stackTrace',

        testStatus: 'status',
        
        testTime: 'time'
    },

    get singleHtmlFileName () {
        return console.singleHtmlFileName ? console.singleHtmlFileName : 'report.html';
    },

    startTime: new Date(),

    getFormattedDate: function () {
        const month = this.startTime.getMonth() < 9 ? `0${this.startTime.getMonth() + 1}` : this.startTime.getMonth() + 1;
        
        return `${this.startTime.getFullYear()}.${this.startTime.getDate()}.${month}`;
    },

    getResultFileName: function () {       
        return console.resultFileName ? console.resultFileName : `${this.getReportPath()}/report_${this.getFormattedDate()}.json`;
    },

    get testResultsPath () {
        return console.reportPath ? console.reportPath.split(/[/\\]/g)[0] : 'test-results'; 
    },

    getReportPath: function () {
        return console.reportPath ? console.reportPath : `${this.testResultsPath}/report_${this.getFormattedDate()}`;
    },

    getOriginalReportPath: function () {
        const originalReportPath = 'src/report';

        if (!fs.existsSync(originalReportPath))
            return 'node_modules/testcafe-reporter-acd-html-reporter/report';
        return originalReportPath;
    },

    getReportFilesAsHtmlTags: function (originalReportPath) {
        let result = '';

        for (const cssFile of fs.readdirSync(`${originalReportPath}/css`)) {
            const imageRegex = /url\((\..*?)\)/;

            let cssContent = fs.readFileSync(`${originalReportPath}/css/${cssFile}`).toLocaleString();
            
            for (let regexResult = imageRegex.exec(cssContent); regexResult; regexResult = imageRegex.exec(cssContent)) {
                const split = regexResult[1].split('/');
                const fileName = split[split.length - 1];
                const fileNameSplit = fileName.split('.');
                const imageExtension = fileNameSplit[fileNameSplit.length - 1];
                const bitmap = fs.readFileSync(`${originalReportPath}/img/${fileName}`);
                const base64 = Buffer.from(bitmap).toString('base64');

                cssContent = cssContent.replace(regexResult[1], `data:image/${imageExtension};base64,${base64}`);
                regexResult = imageRegex.exec(cssContent);
            }
            result += `<style>${cssContent}</style>`;
        }

        for (const jsFile of fs.readdirSync(`${originalReportPath}/js`)) {
            const jsContent = fs.readFileSync(`${originalReportPath}/js/${jsFile}`).toLocaleString();

            result += `<script>${jsContent}</script>`;
        }

        return result;
    },

    generateReportAsHtml: function (...args) {
        const json = args[0] ? args[0] : JSON.parse(fs.readFileSync(this.getResultFileName()).toLocaleString());
        const originalReportPath = this.getOriginalReportPath();
        const html = fs.readFileSync(`${originalReportPath}/index.html`).toLocaleString();
        const htmlHead = `<head>${this.getReportFilesAsHtmlTags(originalReportPath)}</head>`;
        const path = args[1] ? args[1] : `${this.getReportPath()}/${this.singleHtmlFileName}`;

        let htmlData = this.getJsonAsHtml(json);

        if (typeof htmlData === 'string') {
            try {
                const generatedReport = html.replace('<div class="tests-tree"></div>', `<div class="tests-tree">${htmlData}</div>`)
                    .replace('startTime', json.startTime)
                    .replace(/<head>.*<\/head>/gs, htmlHead);
                
                fs.writeFileSync(path, generatedReport);
                
                return path;
            } 
            catch {
                //ignore and write by parts
                htmlData = [htmlData];
            }
        } 
        
        for (let index = 0; index < htmlData.length; index++) {
            const data = htmlData[index];
            const strLen = Math.floor(data.length / 2);

            htmlData[index] = [data.substring(0, strLen), data.substring(strLen)];
        }
        
        const lastHtmlPartFlag = 'html-next-replace-flag';
        const replacedHtml = html.replace('<div class="tests-tree"></div>', `<div class="tests-tree">${htmlData[0][0]}${lastHtmlPartFlag}</div>`)
            .replace('startTime', json.startTime)
            .replace(/<head>.*<\/head>/gs, htmlHead);
        const flagIndex = replacedHtml.indexOf(lastHtmlPartFlag);
        const firstReportPart = replacedHtml.substring(0, flagIndex);
        const secondReportPart = replacedHtml.substring(flagIndex);

        fs.writeFileSync(path, firstReportPart);

        for (let index = 0; index < htmlData.length; index++) {
            for (let index2 = 0; index2 < htmlData[index].length; index2++) {
                if (index === 0 && index2 === 0) continue;

                const isLastIndex = index === htmlData.length - 1;
                const isInnerLastIndex = index2 === htmlData[index].length - 1;
                
                if (isLastIndex && isInnerLastIndex)
                    fs.appendFileSync(path, secondReportPart.replace(lastHtmlPartFlag, htmlData[index][index2]));
                else
                    fs.appendFileSync(path, htmlData[index][index2]);
            }
        }
        
        return path;
    },
    
    getJsonAsHtml: function (json) {
        //open fixtures tag
        let generatedReport = '<div class="fixtures">';

        json.fixtures.forEach(fixture => {
            //open fixture tag
            generatedReport += '<div class="fixture">';
            //fixtureName content
            generatedReport += `<div class="fixtureName">${fixture.name}<div class="summary"></div></div>`;
            //open tests tag
            generatedReport += '<div class="tests">';
            fixture.tests.forEach(test => {
                const isLastTestRun = !fixture.tests.find(another => test.name === another.name && new Date(another[this.jsonNames.testTime]) > new Date(test[this.jsonNames.testTime]));
                
                //test content
                if (test[this.jsonNames.testTime] && isLastTestRun) generatedReport += `<div id="${test.id}" class="test" status="${test.status}">${test.name}<div class="tag"></div><div class="shortInfo"><span>❗</span><img src="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='20' height='20'><text x='-2' y='15'>🖼️</text></svg>"/><input type="text"/></div></div>`;
                stepsArray.push(new this.StepsData(test, fixture.name, this.jsonNames));
            });
            //close tests tag, close fixture tag
            generatedReport += '</div></div>';
        }); 
        //close fixtures tag
        generatedReport += '</div>';
        //open steps tag
        generatedReport += '<div steps style="display: none;">';

        const reportParts = [];
        const maxLength = 2 ** 27;

        stepsArray.forEach((stepsData, i) => {           
            let curentString = generatedReport;
            
            if (maxLength - curentString.length > stepsData.steps.length) {
                curentString += stepsData.steps;
                generatedReport = curentString;
            }
            else {
                reportParts.push(curentString);
                curentString = stepsData.steps;
            }
                
            if (stepsData.stackTrace && stepsData.stackTrace.length) {
                //trace content
                const trace = `<div traceId="${stepsData.id}">${JSON.stringify(stepsData.stackTrace).replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>`;

                if (maxLength - curentString.length > trace.length) {
                    curentString += trace;
                    generatedReport = curentString;
                }
                else {
                    reportParts.push(curentString);
                    curentString = trace;
                }
            }

            const lastItem = i === stepsArray.length - 1;
            const haveLength = reportParts.length;
            
            if (lastItem && haveLength) reportParts.push(curentString);
        });

        if (reportParts.length) {
            //close steps tag
            reportParts.push('</div>');
            return reportParts;
        }

        //close steps tag
        return generatedReport + '</div>';
    },

    StepsData: function (test, fixtureName, jsonNames) {
        const getContentAsString = function (str) {
            return str.replace(/</g, '&lt;').replace(/>/g, '&gt;');
        };

        this.id = test.id;
        this.fixture = fixtureName;
        this.test = test.name;
        this.screenshot = (() => {
            const screenValue = test[jsonNames.screenshotOnFail];
            const base64prefix = 'data:image/png;base64,';

            if (screenValue) {
                if (screenValue.startsWith(base64prefix)) {
                    const buffer = Buffer.from(screenValue.replace(base64prefix, ''), 'base64');
                    const compressedBuffer = (() => {
                        try {
                            // Create a temporary input file path
                            const tempInputPath = require('path').join(require('os').tmpdir(), 'input_image.jpg');
                            const tempOutputPath = require('path').join(require('os').tmpdir(), 'output_image.jpg');
                    
                            // Write the input buffer to the temporary input file
                            fs.writeFileSync(tempInputPath, buffer);
                    
                            // Call the imageProcessor.js script and capture its output (base64-encoded image)
                            require('child_process').execFileSync(
                                'node', 
                                ['node_modules/testcafe-reporter-acd-html-reporter/lib/imageProcessor.js', tempInputPath, tempOutputPath, 50],
                                { encoding: 'utf-8' } // Capture stdout as string (base64-encoded image)
                            );
                    
                            // Convert the base64 output back to a Buffer (bitmap)
                            const innerCompressedBuffer = fs.readFileSync(tempOutputPath);
                    
                            // Clean up the temporary input file
                            try { 
                                fs.unlinkSync(tempInputPath);
                            } 
                            catch {
                                //ignore
                            }
                            try { 
                                fs.unlinkSync(tempOutputPath);
                            } 
                            catch {
                                //ignore
                            }
                            
                            return innerCompressedBuffer;
                        }
                        catch (error) {
                            console.error('Error compressing image synchronously:', error);
                            return buffer;
                        }
                    })();

                    const base64 = compressedBuffer.toString('base64');

                    return `data:image/png;base64,${base64}`;
                }

                return screenValue;
            }
            return '';
        })();

        this.durationMs = test[jsonNames.testDuration];

        this.userAgent = test[jsonNames.testUserAgents];

        this.stackTrace = test[jsonNames.testStackTrace];

        this.time = test[jsonNames.testTime];

        this.status = test[jsonNames.testStatus];

        this.steps = (() => {
            //open main steps tag
            let stepsString = `<div fixtureId="${this.id}" status="${this.status}" screenshot="${this.screenshot}" durationMs="${this.durationMs}" userAgent="${this.userAgent}" time="${this.time}" f="${this.fixture.replace(/([\t\n\f />"'=]+)/, '')}" t="${this.test.replace(/([\t\n\f />"'=]+)/, '')}">`;
    
            test.steps.forEach((step, i, arr) => {
                //open step tag
                stepsString += `<div class="step ${step.retried ? 'retried' : ''}" hiddeninfo>`;

                let actionsHtml = '';

                let hasWarns = false;

                step.actions.forEach(actionObj => {
                    const action = actionObj.message;
                    const isWarn = action.startsWith('WARN');
                    const logger = require('./Logger');
                    const warnPrefix = logger.warnPrefix;
                    const infoPrefix = logger.infoPrefix;

                    if (isWarn) hasWarns = true;

                    //subStep content 
                    actionsHtml += `<div class="subStep ${isWarn ? 'warning' : ''} ${action.failed ? 'failed' : ''}">${getContentAsString(action.replace(warnPrefix, '').replace(infoPrefix, ''))}</div>`;
                });

                const stepTime = new Date(step.time);
                const previousStepTime = i > 0 ? new Date(arr[i - 1].time) : new Date(this.time);
                const stepDurationMs = stepTime - previousStepTime;

                let stepDurationString = '';

                if (stepDurationMs < 1000)
                    stepDurationString = `${Math.round(stepDurationMs)}ms`;
                else if (stepDurationMs < 60000)
                    stepDurationString = `${(stepDurationMs / 1000).toFixed(1)}s`;
                else {
                    const minutes = Math.floor(stepDurationMs / 60000);
                    const seconds = (stepDurationMs % 60000 / 1000).toFixed(1);

                    stepDurationString = `${minutes}m ${seconds}s`;
                }

                const stepText = step.name ? getContentAsString(step.name) : 'No Name Step';

                //stepName content 
                stepsString += `
                <div class="stepName ${hasWarns ? 'warning' : ''} ${step.failed ? 'failed' : ''}" title="${stepText}. Started at: ${stepTime.toLocaleTimeString()}">
                <div class="stepTitle">${stepText}</div>
                <span class="stepDuration">${stepDurationString}</span>
                </div>`;

                //add subSteps content 
                stepsString += actionsHtml;

                //close step tag
                stepsString += '</div>';
            });
            //close main steps tag
            return stepsString + '</div>';
        })();
    }
};

// ad.generateReportAsHtml();
