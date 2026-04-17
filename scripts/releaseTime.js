#!/usr/bin/env node

const DEFAULT_RELEASE_TIME_ZONE = process.env.RELEASE_TIME_ZONE || 'Asia/Shanghai';

function pad2(value) {
  return String(value).padStart(2, '0');
}

function resolveReleaseDate(date) {
  if (date instanceof Date) {
    return date;
  }

  if (typeof date === 'string' && date) {
    return new Date(date);
  }

  if (process.env.RELEASE_TIME_ISO) {
    const fromEnv = new Date(process.env.RELEASE_TIME_ISO);
    if (!Number.isNaN(fromEnv.getTime())) {
      return fromEnv;
    }
  }

  return new Date();
}

function getReleaseDateParts(date = resolveReleaseDate(), timeZone = DEFAULT_RELEASE_TIME_ZONE) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false,
  });

  const values = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== 'literal') {
      values[part.type] = Number(part.value);
    }
  }

  const year = values.year;
  const month = values.month;
  const day = values.day;
  const hour = values.hour;
  const minute = values.minute;
  const second = values.second;
  const dayOfYear = Math.floor((Date.UTC(year, month - 1, day) - Date.UTC(year, 0, 0)) / 86400000);

  return {
    timeZone,
    year,
    month,
    day,
    hour,
    minute,
    second,
    dayOfYear,
    stamp: `${year}${pad2(month)}${pad2(day)}-${pad2(hour)}${pad2(minute)}${pad2(second)}`,
  };
}

function generateReleaseStamp(date = resolveReleaseDate(), timeZone = DEFAULT_RELEASE_TIME_ZONE) {
  return getReleaseDateParts(date, timeZone).stamp;
}

function generateTimeVersion(date = resolveReleaseDate(), timeZone = DEFAULT_RELEASE_TIME_ZONE) {
  const parts = getReleaseDateParts(date, timeZone);
  const patch = parts.day * 1000000 + parts.hour * 10000 + parts.minute * 100 + parts.second;
  return `${parts.year}.${parts.month}.${patch}`;
}

module.exports = {
  DEFAULT_RELEASE_TIME_ZONE,
  resolveReleaseDate,
  getReleaseDateParts,
  generateReleaseStamp,
  generateTimeVersion,
};
