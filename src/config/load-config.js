'use strict';
const fs=require('node:fs'); const path=require('node:path');
const { ConfigurationError }=require('./configuration-error'); const { deepFreeze }=require('./deep-freeze'); const { validateConfig }=require('./validate-config');
function loadConfig(options={}) {
  const configPath=path.resolve(options.configPath||process.env.TICKETBOT_CONFIG_PATH||'config/runtime/instance.local.json');
  let parsed; try { parsed=JSON.parse(fs.readFileSync(configPath,'utf8')); } catch(error) { throw new ConfigurationError([`configuration file: ${error.code==='ENOENT'?'not found or inaccessible':'invalid JSON'}`]); }
  validateConfig(parsed,{env:options.env||process.env,sourceRoot:options.sourceRoot||process.cwd()});
  return deepFreeze(parsed);
}
module.exports={ loadConfig };
