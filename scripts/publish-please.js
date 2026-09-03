'use strict';

const { execSync, spawnSync } = require('child_process');
const path = require('path');
const readline = require('readline');

const rootDir = path.resolve(__dirname, '..');
const packageJson = require(path.join(rootDir, 'package.json'));

function run (command, { inherit = false } = {}) {
    return execSync(command, {
        cwd:      rootDir,
        encoding: 'utf8',
        stdio:    inherit ? 'inherit' : ['ignore', 'pipe', 'pipe']
    }).trim();
}

function ok (message) {
    console.log(`√ ${message}`);
}

function fail (message) {
    console.error(`× ${message}`);
    process.exit(1);
}

function runCommand (command, args) {
    return spawnSync(
        process.platform === 'win32' ? `${command}.cmd` : command,
        args,
        {
            cwd:   rootDir,
            stdio: 'inherit',
            shell: false
        }
    );
}

function checkTests () {
    runCommand('npm', ['test']);

    ok('Tests');
}

function checkAudit () {
    runCommand('npm', [
        'audit',
        '--audit-level=high'
    ]);

    ok('Checking for vulnerable dependencies');
}

function getGitStatusLines () {
    const result = spawnSync(
        'git',
        ['status', '--porcelain'],
        {
            cwd:      rootDir,
            encoding: 'utf8'
        }
    );

    if (result.status !== 0)
        fail('Unable to read git status');

    return result.stdout
        .split(/\r?\n/)
        .filter(Boolean);
}

function checkGitState () {
    const lines = getGitStatusLines();

    const hasUncommittedChanges = lines.some(
        line => !line.startsWith('??')
    );

    const hasUntrackedFiles = lines.some(
        line => line.startsWith('??')
    );

    if (hasUncommittedChanges)
        fail('Checking for uncommitted changes');

    ok('Checking for uncommitted changes');

    if (hasUntrackedFiles)
        fail('Checking for untracked files');

    ok('Checking for untracked files');
}

function checkBranch () {
    const branch = run('git branch --show-current');

    const allowedBranches = [
        'master',
        'main'
    ];

    if (!allowedBranches.includes(branch)) {
        fail(
            `Validating branch: current branch is "${branch}", expected ${allowedBranches.join(' or ')}`
        );
    }

    ok(`Validating branch (${branch})`);
}

function checkGitTag () {
    const version = packageJson.version;

    const tags = run('git tag --points-at HEAD')
        .split(/\r?\n/)
        .map(tag => tag.trim())
        .filter(Boolean);

    const allowedTags = [
        version,
        `v${version}`
    ];

    const matchingTag = tags.find(
        tag => allowedTags.includes(tag)
    );

    if (!matchingTag) {
        fail(
            `Validating git tag: expected "${version}" or "v${version}" on HEAD`
        );
    }

    ok(`Validating git tag (${matchingTag})`);
}

function getPackedFiles () {
    let output;

    try {
        output = run('npm pack --dry-run --json');
    }
    catch {
        fail('Unable to inspect npm package contents');
    }

    let parsed;

    try {
        parsed = JSON.parse(output);
    }
    catch {
        fail('Unable to parse npm pack output');
    }

    if (!Array.isArray(parsed) || !parsed.length)
        fail('Unexpected npm pack output');

    if (!Array.isArray(parsed[0].files))
        fail('Unable to read packed file list');

    return parsed[0].files.map(file => file.path);
}

function checkPackageContents () {
    const files = getPackedFiles();

    const forbiddenPatterns = [
        /^\.env($|\.)/i,
        /\.pem$/i,
        /\.key$/i,
        /\.p12$/i,
        /\.pfx$/i,
        /^id_rsa$/i,
        /^id_dsa$/i,

        /^\.git(?:\/|$)/i,
        /^\.idea(?:\/|$)/i,
        /^\.vscode(?:\/|$)/i,

        /^coverage(?:\/|$)/i,

        /\.log$/i,
        /\.tmp$/i
    ];

    const suspiciousFiles = files.filter(file =>
        forbiddenPatterns.some(pattern => pattern.test(file))
    );

    if (suspiciousFiles.length) {
        console.error('\nSuspicious files found in package:');

        suspiciousFiles.forEach(file => {
            console.error(`  - ${file}`);
        });

        fail('Checking for sensitive and non-essential data in the npm package');
    }

    ok('Checking for sensitive and non-essential data in the npm package');
}

function showPackageContents () {
    const files = getPackedFiles();

    console.log('\nPackage contents:');

    files.forEach(file => {
        console.log(`  ${file}`);
    });
}

function confirm (question) {
    return new Promise(resolve => {
        const rl = readline.createInterface({
            input:  process.stdin,
            output: process.stdout
        });

        rl.question(`${question} [y/N] `, answer => {
            rl.close();

            const normalized = answer
                .trim()
                .toLowerCase();

            resolve(
                normalized === 'y' ||
                normalized === 'yes'
            );
        });
    });
}

async function validate () {
    console.log('\nRunning validations');
    console.log('-------------------');

    checkTests();
    checkAudit();
    checkGitState();
    checkPackageContents();
    checkBranch();
    checkGitTag();

    showPackageContents();

    console.log('\nAll validations passed.\n');
}

async function publish () {
    await validate();

    const confirmed = await confirm(
        `Publish ${packageJson.name}@${packageJson.version}?`
    );

    if (!confirmed) {
        console.log('Publishing cancelled.');
        return;
    }

    console.log('\nPublishing...\n');

    const result = runCommand('npm', ['publish']);

    if (result.error) {
        console.error(result.error);
        fail(`Unable to start npm publish: ${result.error.message}`);
    }

    if (result.status !== 0) 
        fail(`npm publish failed with exit code ${result.status}`);

    ok('Package published');
}

async function main () {
    const args = process.argv.slice(2);

    const validateOnly =
        args.includes('guard') ||
        args.includes('--dry-run');

    if (validateOnly) {
        await validate();
        return;
    }

    await publish();
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
