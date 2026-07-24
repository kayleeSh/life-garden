'use strict';

/**
 * Generates a plausible run of DailyRawSignals so the growth engine can be
 * demoed/tested without any real data integration. Swap this module out for
 * a real adapter (Apple Health, GitHub, Notion...) later — growthEngine.js
 * doesn't know or care which one is feeding it.
 */

// deterministic RNG so demo runs are reproducible
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randRange(rng, min, max) {
  return min + rng() * (max - min);
}

const LEVELS = {
  sleep: {
    good: { durationHours: [7.2, 8.5], deepSleepPct: [0.18, 0.24] },
    poor: { durationHours: [4.8, 6.0], deepSleepPct: [0.07, 0.12] },
  },
  fitness: {
    good: { steps: [8500, 11500], activeMinutes: [40, 65], workoutChance: 0.5 },
    poor: { steps: [1500, 3500], activeMinutes: [0, 12], workoutChance: 0.05 },
  },
  study: {
    good: { minutes: [80, 150], sessions: [2, 3] },
    poor: { minutes: [0, 20], sessions: [0, 1] },
  },
};

function pick(range, rng) {
  return randRange(rng, range[0], range[1]);
}

function generateDay(date, phaseLevels, rng) {
  const sleepRange = LEVELS.sleep[phaseLevels.sleep];
  const fitnessRange = LEVELS.fitness[phaseLevels.fitness];
  const studyRange = LEVELS.study[phaseLevels.study];

  return {
    date,
    sleep: {
      durationHours: pick(sleepRange.durationHours, rng),
      deepSleepPct: pick(sleepRange.deepSleepPct, rng),
    },
    fitness: {
      steps: Math.round(pick(fitnessRange.steps, rng)),
      activeMinutes: pick(fitnessRange.activeMinutes, rng),
      workouts: rng() < fitnessRange.workoutChance ? 1 : 0,
    },
    study: {
      minutes: pick(studyRange.minutes, rng),
      sessions: Math.round(pick(studyRange.sessions, rng)),
    },
    career: { events: [] },
  };
}

function addDays(base, n) {
  const d = new Date(base);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * @param {object} opts
 * @param {number} opts.days - total days to generate
 * @param {Array<{len:number, levels:{sleep,fitness,study}}>} opts.phases - sequential phases; levels are keys into LEVELS
 * @param {Array<{dayIndex:number, type:string, weight?:number}>} opts.careerEvents - sparse career events to inject
 * @param {string} opts.startDate - ISO date
 * @param {number} opts.seed
 * @returns {Array<object>} array of DailyRawSignals, oldest first
 */
function generateSyntheticHistory({
  days = 90,
  phases,
  careerEvents = [],
  startDate = '2026-01-01',
  seed = 42,
} = {}) {
  const rng = mulberry32(seed);
  const resolvedPhases = phases ?? [{ len: days, levels: { sleep: 'good', fitness: 'good', study: 'good' } }];

  const history = [];
  let dayIndex = 0;
  for (const phase of resolvedPhases) {
    for (let i = 0; i < phase.len && dayIndex < days; i += 1, dayIndex += 1) {
      const date = addDays(startDate, dayIndex);
      const day = generateDay(date, phase.levels, rng);
      const events = careerEvents.filter((e) => e.dayIndex === dayIndex);
      if (events.length) {
        day.career.events = events.map((e) => ({ type: e.type, weight: e.weight }));
      }
      history.push(day);
    }
  }
  return history;
}

module.exports = { generateSyntheticHistory };
