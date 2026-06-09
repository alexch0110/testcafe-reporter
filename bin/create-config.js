const fs = require('fs');
const path = require('path');

let configData;

try {
    configData = require('./lib/config-reader');
} 
catch {
    try {
        configData = require('../lib/config-reader');

        
    } 
    catch { 
        //ignore
    }
}

if (configData) {
    const projectRoot = process.env.INIT_CWD || process.cwd();
    const configPath = path.join(projectRoot, configData.ConfigFileName);
    const hasForce = process.argv.includes('--force');

    if (!fs.existsSync(configPath) || hasForce) {
        fs.writeFileSync(
            configPath,
            JSON.stringify(configData.DefaultConfig, null, 2)
        );

        console.log(`✔ Config file ${configData.ConfigFileName} created. You can change its values or use console arguments. Console arguments have higher priority`);
    }
    else
        console.log(`ℹ Config file ${configData.ConfigFileName} already exists. You can change its values or use console arguments. Console arguments have higher priority`);
}
