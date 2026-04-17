#!/usr/bin/env node

const { getNextBuildNumber } = require('./buildNumber');

process.stdout.write(`${getNextBuildNumber()}\n`);
