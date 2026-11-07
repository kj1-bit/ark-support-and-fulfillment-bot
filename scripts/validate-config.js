#!/usr/bin/env node
'use strict';
const { ConfigurationError, createSafeConfigSummary, loadConfig }=require('../src/config');
try { const config=loadConfig({configPath:process.argv[2]}); console.log(JSON.stringify(createSafeConfigSummary(config),null,2)); }
catch(error) { if(error instanceof ConfigurationError){ console.error(error.message); for(const issue of error.issues) console.error(`- ${issue}`); process.exitCode=1; } else throw error; }
