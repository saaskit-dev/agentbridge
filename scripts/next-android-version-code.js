#!/usr/bin/env node

const now = new Date();
const start = Date.UTC(now.getUTCFullYear(), 0, 0);
const current = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
const dayOfYear = Math.floor((current - start) / 86400000);

const year = String(now.getUTCFullYear() % 100).padStart(2, '0');
const day = String(dayOfYear).padStart(3, '0');
const hour = String(now.getUTCHours()).padStart(2, '0');
const minute = String(now.getUTCMinutes()).padStart(2, '0');

process.stdout.write(`1${year}${day}${hour}${minute}`);
