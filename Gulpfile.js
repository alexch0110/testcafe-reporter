var gulp    = require('gulp');
var ESLint = require('eslint').ESLint;
var babel   = require('gulp-babel');
const { exec } = require('child_process');
var del     = require('del');

function clean (cb) {
    del('lib', cb);
}

async function lint () {
    var eslint = new ESLint();

    var results = await eslint.lintFiles([
        'src/**/*.js',
        'test/**/*.js',
        'gulpfile.js'
    ]);

    var formatter = await eslint.loadFormatter('stylish');
    var output = formatter.format(results);

    if (output)
        console.log(output);

    if (results.some(function (result) {
        return result.errorCount > 0;
    }))
        throw new Error('ESLint found errors');
}

function build () {
    gulp.src('src/*.js')
        .pipe(babel())
        .pipe(gulp.dest('lib'));
    gulp.src('src/report/**')
        .pipe(gulp.dest('report'));
    return gulp.src('src/Logger.d.ts')
        .pipe(gulp.dest('lib'));
}

function test (cb) {
    exec(
        'npm run test:mocha',
        { stdio: 'inherit' },
        function (err) {
            cb(err);
        }
    );
}

function preview () {
    var buildReporterPlugin = require('testcafe').embeddingUtils.buildReporterPlugin;
    var pluginFactory       = require('./lib');
    var reporterTestCalls   = require('./test/utils/reporter-test-calls');
    var plugin              = buildReporterPlugin(pluginFactory);

    console.log();

    reporterTestCalls.forEach(function (call) {
        plugin[call.method].apply(plugin, call.args);
    });

    process.exit(0);
}

exports.clean = clean;
exports.lint = lint;
exports.test = gulp.series(clean, lint, build, test);
exports.build = gulp.series(clean, lint, build);
exports.preview = gulp.series(clean, lint, build, preview);
