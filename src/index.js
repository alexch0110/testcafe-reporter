let maxTestId = 0;

module.exports = function () {
    return {
        noColors: false,

        chalk:        require('chalk'), 
        testStatuses: require('./config-reader').TestStatuses,
        
        chalkStyles: {
            passed:     'green',
            failed:     'red',
            broken:     'yellow',
            skipped:    'gray',
            borderLine: 'gray',
            borderText: 'bold',
            stackTrace: [254, 109, 90],
            report:     'cyan',
            screenPath: 'cyan'
        },
        testsCount:        0,
        taskStartTime:     0,
        userAgent:         '',
        skippedCount:      0,
        brokenCount:       0,
        isScreensAsBase64: false,
        appendLogs:        false,

        /**
     * @type {{meta: {fixtureName: string, id: number, name: string}, warnError: Error, isForceBroken: bool}[]}
     */
        testsInfo: [],

        testRunId: Infinity,

        getResultFileName () {
            const fileName = this.reportUtil.getResultFileName();
            const getNewName = () => fileName.replace('.json', `_${this.testRunId}${this.appendLogs ? 't' : ''}.json`);

            if (!this.appendLogs) return fileName;
            if (this.testRunId === Infinity) {
                do 
                    this.testRunId = Math.floor(Math.random() * 900000) + +process.pid.toString().slice(-5);
                while (this.fs.existsSync(getNewName()));
            }
            return getNewName();
        },
        
        getTestMeta (meta) {
            return meta ? meta : this.testMeta;
        },

        getTestRunId () {
            return this.appendLogs ? ` ${this.testRunId}` : '';
        },
        
        createErrorDecorator () {
            return {
                'span category':       () => '',
                'span step-name':      str => `"${str}"`,
                'span user-agent':     str => this.chalk.gray(str),
                'div screenshot-info': str => str,
                'a screenshot-path':   str => this.chalk.underline(str),
                'code':                str => this.chalk.yellow(str),
                'code step-source':    str => this.chalk.magenta(this.indentString(str, 4)),
                'span code-line':      str => `${str}\n`,
                'span last-code-line': str => str,
                'code api':            str => this.chalk.yellow(str),
                'strong':              str => this.chalk.cyan(str),
                'a':                   str => this.chalk.yellow(`"${str}"`)
            };
        },

        fs:         require('fs'),
        reportUtil: require('./jsonToHtml'),

        writeToJson (object) {
            try {
                this.fs.writeFileSync(this.getResultFileName(), JSON.stringify(object, null, 2));
                return true;
            }
            catch (err) { 
                console.error('writeToJson: ' + (err.message ? err.message : err.msg));
                return false;
            }
        },

        createJson () {
            if (this.fs.existsSync(this.getResultFileName())) return;
            this.writeToJson(JSON.parse(this.reportUtil.jsonNames.baseJsonContent));
        },

        getJsonAsObject () {
            this.createJson();
            return JSON.parse(this.fs.readFileSync(this.getResultFileName()).toLocaleString());
        },

        doWithJson (action, isRead) {
            const json = this.getJsonAsObject();
            const result = action(json);

            if (isRead)
                return result;
            for (let index = 0; index < 10; index++) {
                if (this.writeToJson(json)) 
                    return true;
            }
            return false;
        },

        doWithFixture (fixtureName, action, isRead) {
            return this.doWithJson(json => {
                if (!json.fixtures.find(el => el.name === fixtureName))
                    json.fixtures.push(this.reportUtil.jsonNames.baseFixtureContent(fixtureName));
                return action(json.fixtures.find(el => el.name === fixtureName));
            }, isRead);
        },

        doWithTest (meta, action, isRead) {
            return this.doWithFixture(meta.fixtureName, fixture => {
                if (!fixture.tests.find(tst => tst.id === meta.id)) {
                    const testData = this.reportUtil.jsonNames.baseTestContent(meta.name, meta.id);

                    testData[this.reportUtil.jsonNames.testTime] = new Date().toLocaleString();
                    fixture.tests.push(testData);
                }
                return action(fixture.tests.find(tst => tst.id === meta.id));
            }, isRead);
        },

        /**
     * @param {number} id 
     * @param {{name: string, value: any} | {name: string, value: any}[]} properties 
     */
        setTestProperties (meta, properties) {
            if (!properties.length) properties = [properties];

            this.doWithTest(meta, test => {
                for (const { name, value } of properties) test[name] = value;
            });
        },

        getTestStatus (meta) {
            return this.doWithTest(meta, test => test.status, true);
        },

        setTestStatus (meta, status, brokenMessage, isForceBroken) {
            const actualStatus = this.getTestStatus(meta);
            const currentInfo = this.testsInfo.find(test => test.meta.id === meta.id);

            if (currentInfo.isForceBroken) {
                if (actualStatus !== this.testStatuses.broken) currentInfo.isForceBroken = false;
                else return;
            }

            if (status === this.testStatuses.failed || actualStatus !== this.testStatuses.broken) {
                if (status === null) {
                    try {
                        throw new Error(brokenMessage);
                    }
                    catch (ex) {
                        currentInfo.warnError = ex;
                    }
                }
                this.setTestProperties(meta, {
                    name:  this.reportUtil.jsonNames.testStatus,
                    value: status === null ? this.testStatuses.broken : status
                });
            }

            currentInfo.isForceBroken = isForceBroken;
        },

        logBorder (info) {
            console.log(this.chalk[this.chalkStyles.borderLine](`-------------------------------------------${info ? this.chalk[this.chalkStyles.borderText](info) : ''}-------------------------------------------`));
        },

        addTestInfo (meta, testStatus, screenPath, userAgent, durationMs, stackTrace) {
            this.setTestStatus(meta, testStatus);
            this.setTestProperties(meta, [{
                name:  this.reportUtil.jsonNames.screenshotOnFail,
                value: screenPath
            }, {
                name:  this.reportUtil.jsonNames.testUserAgents,
                value: userAgent
            }, {
                name:  this.reportUtil.jsonNames.testDuration,
                value: durationMs
            }, {
                name:  this.reportUtil.jsonNames.testStackTrace,
                value: stackTrace
            }]);
        },

        addStep (meta, message) {
            this.doWithTest(meta, test => {
                if (test.steps.length && test.steps[0].name === message)
                    for (const step of test.steps) step.retried = true;
                test.steps.push(this.reportUtil.jsonNames.baseStepContent(message));
            });
        },

        doForSteps (meta, action) {
            this.doWithTest(meta, test => {
                const steps = test.steps;

                if (!steps.length) this.addStep(meta, '');
                action(steps);
            });
        },

        addStepInfo (meta, message) {
            this.doForSteps(meta, steps => {
                steps[steps.length - 1].actions.push({ message, time: new Date() });
            });
        },

        getStackTraceAsStringsArray (errs) {
            const stackTrace = [];
      
            for (let index = 0; index < errs.length; index++) {
                const err = errs[index];

                let errName;
      
                if (err.errMsg) errName = err.errMsg; 
                else if (err.message) errName = err.message; 
                else if (err.code) {
                    const errorsTypes = require('testcafe/lib/errors/types');
                    const errorMsgs = require('testcafe/lib/errors/test-run/templates');
                    const runtimeKey = Object.keys(errorsTypes.RUNTIME_ERRORS).find(key => errorsTypes.RUNTIME_ERRORS[key] === err.code);
                    const testRunKey = Object.keys(errorsTypes.TEST_RUN_ERRORS).find(key => errorsTypes.TEST_RUN_ERRORS[key] === err.code);

                    errName = runtimeKey ? runtimeKey : testRunKey;
                  
                    if (errorMsgs[err.code]) errName += `: ${errorMsgs[err.code](err)}`;
                    else {
                        if (err.apiFnChain) errName += `: ${err.apiFnChain.join ? err.apiFnChain.join('') : err.apiFnChain}`;
                        if (err.filePaths) errName += `(Files: ${err.filePaths.join ? err.filePaths.join('') : err.filePaths})`;      
                    }
                    errName = errName.trim().replace(/\n{2,}/g, '\n');
                }
                else errName = 'Unknown error';
      
                stackTrace.push([]);
      
                const filterArr = ['node:internal', 'node_modules', 'process._tickCallback', '__awaiter'];
                const isMessageSuite = (msg) => filterArr.every(f => !msg.includes(f)) && msg.includes(':');

                stackTrace[index].push(errName);

                if (errs[index].stack) {
                    const stackArr = errs[index].stack.split('\n').slice(1);

                    for (const stackStr of stackArr) 
                        if (isMessageSuite(stackStr)) stackTrace[index].push(stackStr);
          
                }
                else if (errs[index].callsite) {
                    errs[index].callsite.stackFrames.forEach(stackFrame => {
                        const msg = stackFrame.toString();

                        if (isMessageSuite(msg)) stackTrace[index].push(msg);
                    });
      
                    const errorFile = errs[index].callsite.filename + ':' + (errs[index].callsite.lineNum + 1);

                    if (!stackTrace[index][1].includes(errorFile)) stackTrace[index].splice(1, 0, errorFile);
      
                }
                else stackTrace[index].push(...errName.split('\n'));
            }
      
            return stackTrace;
        },
      
        getStartArgObject () {
            const obj = { odd: [] };
            const args = process.argv.slice(2);

            for (let i = 0; i < args.length; i++) {
                const arg = args[i];
                const argNameReg = /^--?(.*?)(=|$)/;
                const argName = argNameReg.exec(arg);

                if (argName) {
                    const argValue = /.+=(.*)$/.exec(arg);

                    if (argValue) obj[argName[1]] = argValue[1];
                    else if (args[i + 1] && !argNameReg.exec(args[i + 1])) {
                        obj[argName[1]] = args[i + 1];
                        i++;
                    }
                    else obj[argName[1]] = true;
                }
                else obj.odd.push(arg);
            }
            return obj;
        },

        parseStartArguments () {
            const args = this.getStartArgObject();
            const configFile = require('../lib/config-reader').CurrentConfig;
            const reportFileConfig = configFile.html.reportFile ? configFile.html.reportFileName : '';
            const reportFileArg = args.reportFile ? args.reportFile : reportFileConfig;
            const base64screens = args.base64screens ? args.base64screens : configFile.html.base64screens;

            this.appendLogs = args.appendLogs ? args.appendLogs : configFile.appendLogs;
            this.logWarnings = args.logWarnings ? args.logWarnings : configFile.logWarnings;
            if (base64screens) this.isScreensAsBase64 = true;

            if (reportFileArg) {
                if (typeof reportFileArg !== 'string') return;
                let reportPath = reportFileArg;

                if (reportFileArg.endsWith('.html')) {
                    const split = reportFileArg.split(/[/\\]/g);

                    console.singleHtmlFileName = split.pop();
                    reportPath = split.join('/');
                }

                console.reportPath = reportPath;
            }
        },

        createReportPath (path) {
            path = path ? path : this.reportUtil.getReportPath();
            if (!this.fs.existsSync(path)) {
                this.fs.mkdirSync(path, {
                    recursive: true
                });
            }  
        },

        getMaxTestId () {
            try {
                const testIds = this.getJsonAsObject().fixtures.map(fixture => fixture.tests.map(test => test.id)).flat();

                return testIds.reduce((max, id) => id ? Math.max(max, id) : 0, 0) + 1;
            }
            catch {
                return maxTestId;
            }
        },

        prepareResultFile () {
            try {
                if (!this.appendLogs) this.fs.unlinkSync(this.getResultFileName());
                else if (this.fs.existsSync(this.getResultFileName())) 
                    maxTestId = this.getMaxTestId();
            }
            catch {
            /*file doesn't exist*/
            }  
        },

        parseAgents (userAgents) {
            if (typeof userAgents === 'object') {
                if (userAgents.every) {
                    if (userAgents.every(el => el === userAgents[0])) {
                        this.userAgent = userAgents[0];
                        if (userAgents.length > 1) this.userAgent += ` (${userAgents.length} browser(-s))`;
                    }
                    else {
                        const set = userAgents.filter((val, index) => !userAgents.slice(index + 1).find(el => el === val));

                        for (const item of set) {
                            const browsersC = userAgents.filter(el => el === item).length;

                            this.userAgent += item;
                            if (browsersC > 1) this.userAgent += ` (${browsersC} browser(-s))`;
                        }
                    }
                }
                else this.userAgent = userAgents;
            }
            else this.userAgent = userAgents;
        },

        reportTaskStart (startTime, userAgents, testsCount) {
            try {
                const time = this.moment(startTime).format('YYYY/MM/DD HH:mm:ss');

                this.reportUtil.startTime = new Date(startTime);
                require('./Logger').__reporters.push(this);
                this.parseStartArguments();
                this.createReportPath();
                this.prepareResultFile();
                this.parseAgents(userAgents);

                this.testsCount = testsCount;
                this.taskStartTime = startTime;
                this.logBorder('Task start');
                console.log(`Tests run${this.getTestRunId()}: ${testsCount} on ${this.userAgent}`);
                console.log(`Start time: ${time}`);
                this.logBorder();
                if (this.appendLogs && !this.fs.existsSync(this.getResultFileName()) || !this.appendLogs) {
                    this.doWithJson(json => {
                        json[this.reportUtil.jsonNames.startTime] = time;
                    });
                }
            }
            catch (err) {
                console.log('reportTaskStart: ' + (err.message ? err.message : err.msg));
            }
        },

        reportFixtureStart (name) {
            try {
                this.logBorder('Fixture start');
                console.log(`Fixture started${this.getTestRunId()}: ${name}`);
                this.doWithFixture(name, () => null);
            }
            catch (err) {
                console.log('reportFixtureStart: ' + (err.message ? err.message : err.msg));
            }
        },

        markFailedStepAndAction (meta) {
            this.doForSteps(meta, steps => {
                let isStepFailed = false;

                for (let i = steps.length - 1; i >= 0 && !isStepFailed; i--) {
                    const step = steps[i];

                    if (Date.parse(step.time) > meta.failTime) continue;
                    step.failed = true;
                    isStepFailed = true;

                    for (let j = step.actions.length - 1; j >= 0; j--) {
                        const action = step.actions[j];

                        if (Date.parse(action.time) > meta.failTime) continue;
                        action.failed = true;
                        return;
                    }
                }
            });
        },

        reportTestStart (name, meta) {
            try {
                this.testMeta = meta;
                const time = this.moment(new Date().valueOf()).format('M/DD/YYYY HH:mm:ss');
                const id = this.getMaxTestId();

                meta.id = id;
                meta.name = name;
                this.testsInfo.push({
                    meta,
                    warnError: null
                });
                this.logBorder('Test start');
                console.log(`Test started (${id}/${this.testsCount}): ${meta.fixtureName} - ${name}\nStart time: ${time}`);
                this.doWithTest(meta, () => null);
            }
            catch (err) {
                console.log('reportTestStart: ' + (err.message ? err.message : err.msg));
            }
        },

        reportTestDone (name, testRunInfo, meta) {
            try {
                const errorsCount = testRunInfo.errs.length;
                const currentInfo = this.testsInfo.find(test => test.meta.id === meta.id);
                const warnError = currentInfo.warnError;
                const hasErr = !!errorsCount || !!warnError;
                const screenPath = hasErr && testRunInfo.screenshots && testRunInfo.screenshots.length ? (testRunInfo.screenshots[testRunInfo.screenshots.length - errorsCount] ?? testRunInfo.screenshots[0]).screenshotPath : null;
                const stackTrace = hasErr ? this.getStackTraceAsStringsArray(errorsCount ? testRunInfo.errs : [warnError]) : [];
                const duration = this.moment.duration(testRunInfo.durationMs).format('h[h] mm[m] ss[s]');

                let result = hasErr ? this.testStatuses.failed : this.testStatuses.passed;
                const testAgent = testRunInfo?.browsers?.map(b => b.prettyUserAgent)?.join();

                if (errorsCount) this.markFailedStepAndAction(meta);

                if (this.isScreensAsBase64 && screenPath) {
                    try {
                        const bitmap = this.fs.readFileSync(screenPath);
                        const base64 = Buffer.from(bitmap).toString('base64');
                        var base64screenshot = `data:image/png;base64,${base64}`;
                    }
                    catch { 
                        //skip and continue
                    }
                }

                if (this.getTestStatus(meta) === this.testStatuses.broken && (!errorsCount || currentInfo.isForceBroken)) {
                    result = this.testStatuses.broken;
                    this.brokenCount++;
                }
                const chalkColor = this.chalkStyles[result];

                this.logBorder(`Test ${meta.id} done`);
                console.log(`Duration: ${duration}`);

                if (testRunInfo.skipped) {
                    this.skippedCount++;
                    this.testsCount++;
                    console.log(this.chalk[this.chalkStyles.skipped](`Test skipped: ${meta.fixtureName} - ${name}`));
                }
                else {
                    let msg = this.chalk[chalkColor](`Test ${result}: ${meta.fixtureName} - ${name}\n`);

                    for (const error of stackTrace) {
                        for (let index = 0; index < error.length; index++) {
                            msg += 
                            (result === this.testStatuses.broken ? this.chalk[this.chalkStyles.broken] : this.chalk.rgb(...this.chalkStyles.stackTrace))(' '.repeat(index) + error[index] + '\n');
                        }
                    }

                    if (screenPath) msg += this.chalk[this.chalkStyles.screenPath](`Screenshot: ${screenPath}`);
                    console.log(msg);
                }

                this.logBorder();
                this.addTestInfo(meta, testRunInfo.skipped ? this.testStatuses.skipped : result, base64screenshot ? base64screenshot : screenPath, testAgent ? testAgent : this.userAgent, duration, stackTrace);
                const index = this.testsInfo.findIndex(test => test.meta.id === meta.id);

                this.testsInfo.splice(index, 1);
            }
            catch (err) {
                console.log('reportTestDone: ' + (err.message ? err.message : err.msg));
            }
        },

        reportTaskDone (endTime, passed, warnings) {
            try {
                const time = this.moment(endTime).format('M/DD/YYYY HH:mm:ss');
                const durationMs = endTime - this.taskStartTime;
                const durationStr = this.moment.duration(durationMs).format('h[h] mm[m] ss[s]');
                const path = require('path');
                const reportPath = `${this.reportUtil.getReportPath()}/${this.reportUtil.singleHtmlFileName}`;

                passed -= this.brokenCount;

                let summary = this.chalk[this.chalkStyles.passed](`${passed}/${this.testsCount} ${this.testStatuses.passed}`);

                if (this.brokenCount) 
                    summary += ', ' + this.chalk[this.chalkStyles.broken](`${this.brokenCount}/${this.testsCount} ${this.testStatuses.broken}`); 
                    
                const failedCount = this.testsCount - passed - this.skippedCount - this.brokenCount;

                if (failedCount)
                    summary +=  ', ' + this.chalk[this.chalkStyles.failed](`${failedCount}/${this.testsCount} ${this.testStatuses.failed}`);
                    
                if (this.skippedCount) 
                    summary +=  ', ' + this.chalk[this.chalkStyles.skipped](`${this.skippedCount}/${this.testsCount} ${this.testStatuses.skipped}`);

                this.logBorder('Task done');
                console.log(`Test run${this.getTestRunId()} finished: ${time}`);
                console.log(`Duration: ${durationStr}`);
                console.log(`Run results: ${summary}`);
                if (this.logWarnings && warnings.length) console.log(warnings);
                require('child_process').execSync(`npx acd-html-combine ${this.reportUtil.testResultsPath} --dest ${reportPath} --last ${this.getResultFileName()} ${this.appendLogs ? '' : '--single'}`, { stdio: 'inherit' });
                console.log(this.chalk[this.chalkStyles.report](`Html report generated: ${path.resolve(reportPath)}`));
            }
            catch (err) {
                console.log('reportTaskDone: ' + (err.message ? err.message : err.msg));
            }
        }

    };
};
