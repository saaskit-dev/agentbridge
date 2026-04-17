#!/usr/bin/env node

const { queryGitCommitCount } = require('./buildNumber');

process.stdout.write(`${queryGitCommitCount()}\n`);
