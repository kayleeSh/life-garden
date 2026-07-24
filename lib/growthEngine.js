'use strict';

/**
 * Pure growth-model engine. No I/O, no Three.js — takes DailyRawSignals
 * (see schema/synthetic-signals.schema.json) and steps a GardenState forward
 * one day at a time.
 */

const STAGE_ORDER = ['seed', 'sprout', 'leaf', 'bud', 'bloom', 'fruit'];

// Asymmetric up/down thresholds between adjacent stages so vitality
// hovering near a boundary doesn't flicker the stage back and forth.
const STAGE_BOUNDARIES = [
  { up: 0.20, down: 0.12 }, // seed <-> sprout
  { up: 0.40, down: 0.30 }, // sprout <-> leaf
  { up: 0.60, down: 0.50 }, // leaf <-> bud
  { up: 0.80, down: 0.70 }, // bud <-> bloom
];

const FRUIT_MIN_VITALITY = 0.92;
const FRUIT_MIN_DWELL_DAYS = 14;
const FRUIT_EXIT_VITALITY = 0.85;

const WILT_MOMENTUM_THRESHOLD = -0.01;
const WILT_STREAK_DAYS = 5;

const BASELINE_DECAY = 0.97; // ~1 month memory for "what's normal for this user"

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeAgainstBaseline(value, baseline, ceilingMultiplier = 1.2) {
  if (!baseline || baseline <= 0) {
    return value > 0 ? 0.5 : 0;
  }
  return clamp(value / (baseline * ceilingMultiplier), 0, 1);
}

// --- domain scorers: the only domain-specific logic in the engine ---

function sleepScorer(raw) {
  const idealMin = 7;
  const idealMax = 9;
  let durationScore;
  if (raw.durationHours >= idealMin && raw.durationHours <= idealMax) {
    durationScore = 1;
  } else {
    const dist = raw.durationHours < idealMin
      ? idealMin - raw.durationHours
      : raw.durationHours - idealMax;
    durationScore = clamp(1 - dist / 3, 0, 1);
  }
  const deepScore = clamp(raw.deepSleepPct / 0.22, 0, 1);
  return clamp(durationScore * 0.7 + deepScore * 0.3, 0, 1);
}

function fitnessScorer(raw, baseline) {
  const stepsScore = normalizeAgainstBaseline(raw.steps, baseline.steps);
  const activeScore = normalizeAgainstBaseline(raw.activeMinutes, baseline.activeMinutes);
  const workoutBonus = raw.workouts > 0 ? 0.15 : 0;
  return clamp(stepsScore * 0.55 + activeScore * 0.3 + workoutBonus, 0, 1);
}

function studyScorer(raw, baseline) {
  const minutesScore = normalizeAgainstBaseline(raw.minutes, baseline.minutes);
  const spreadBonus = raw.sessions > 0 ? clamp(raw.sessions / 2, 0, 1) : 0;
  return clamp(minutesScore * 0.75 + spreadBonus * 0.25, 0, 1);
}

const CAREER_EVENT_WEIGHTS = {
  commit: 0.1,
  publish: 0.4,
  interview: 0.6,
  offer: 1.0,
  shipped_project: 0.7,
};

function careerScorer(raw) {
  if (!raw.events || raw.events.length === 0) return 0;
  const total = raw.events.reduce((sum, e) => {
    const weight = CAREER_EVENT_WEIGHTS[e.type] ?? 0.2;
    return sum + weight * (e.weight ?? 1);
  }, 0);
  return clamp(total, 0, 1);
}

// mode: 'flow' domains have a meaningful score every day, so vitality is an
// EMA of that score (decay = memory length). 'impulse' domains are sparse
// (events on rare days, zero otherwise) — EMA would dilute a rare event by
// (1 - decay) and it'd vanish almost immediately, so impulse domains instead
// *add* the event's effective score directly to vitality and let decay alone
// fade it out over time, giving events a long, slowly-fading afterglow.
const DOMAINS = [
  { id: 'sleep', decay: 0.75, mode: 'flow', isFoundation: true, scorer: sleepScorer, baselineKeys: [] },
  { id: 'fitness', decay: 0.85, mode: 'flow', isFoundation: false, scorer: fitnessScorer, baselineKeys: ['steps', 'activeMinutes'] },
  { id: 'study', decay: 0.88, mode: 'flow', isFoundation: false, scorer: studyScorer, baselineKeys: ['minutes'] },
  { id: 'career', decay: 0.97, mode: 'impulse', isFoundation: false, scorer: careerScorer, baselineKeys: [] },
];

function initDomainState() {
  return {
    vitality: 0.2,
    momentum: 0,
    stage: 'seed',
    stageEnteredOn: null,
    stageDwellDays: 0,
    declineStreak: 0,
    wilting: false,
    baseline: {},
  };
}

function initGardenState() {
  const domains = {};
  for (const d of DOMAINS) domains[d.id] = initDomainState();
  return { domains, soilMoisture: 1 };
}

function computeSoilMoisture(domainStates) {
  const foundations = DOMAINS.filter((d) => d.isFoundation);
  if (foundations.length === 0) return 1;
  const sum = foundations.reduce((acc, d) => acc + (domainStates[d.id]?.vitality ?? 1), 0);
  return sum / foundations.length;
}

function updateBaseline(state, domainConfig, raw) {
  const baseline = { ...state.baseline };
  for (const key of domainConfig.baselineKeys) {
    const prev = baseline[key];
    baseline[key] = prev === undefined
      ? raw[key]
      : prev * BASELINE_DECAY + raw[key] * (1 - BASELINE_DECAY);
  }
  return baseline;
}

function computeStage(prevState, vitality, date) {
  // Fruit is a special dwell-gated rung above bloom, not just a score band.
  if (prevState.stage === 'fruit') {
    if (vitality < FRUIT_EXIT_VITALITY) {
      return { stage: 'bloom', stageEnteredOn: date, stageDwellDays: 0 };
    }
    return { stage: 'fruit', stageEnteredOn: prevState.stageEnteredOn, stageDwellDays: (prevState.stageDwellDays ?? 0) + 1 };
  }

  // Climb/fall through as many rungs as the vitality change justifies —
  // an impulse domain (career) can jump several bands in a single day,
  // and the stage shouldn't lag behind reality by one rung per day.
  let idx = STAGE_ORDER.indexOf(prevState.stage);
  let changed = false;
  while (idx < STAGE_BOUNDARIES.length && vitality >= STAGE_BOUNDARIES[idx].up) {
    idx += 1;
    changed = true;
  }
  while (idx > 0 && vitality < STAGE_BOUNDARIES[idx - 1].down) {
    idx -= 1;
    changed = true;
  }

  const dwellDays = changed ? 0 : (prevState.stageDwellDays ?? 0) + 1;
  const stage = STAGE_ORDER[idx];

  if (stage === 'bloom' && vitality >= FRUIT_MIN_VITALITY && dwellDays >= FRUIT_MIN_DWELL_DAYS) {
    return { stage: 'fruit', stageEnteredOn: date, stageDwellDays: 0 };
  }

  return {
    stage,
    stageEnteredOn: changed ? date : prevState.stageEnteredOn,
    stageDwellDays: dwellDays,
  };
}

function stepDomain(domainConfig, state, raw, soilMoisture, date) {
  const baseline = updateBaseline(state, domainConfig, raw);
  const rawScore = domainConfig.scorer(raw, baseline);
  const soilFactor = domainConfig.isFoundation ? 1 : (0.5 + 0.5 * soilMoisture);
  const effectiveScore = rawScore * soilFactor;

  const prevVitality = state.vitality;
  const vitality = domainConfig.mode === 'impulse'
    ? clamp(prevVitality * domainConfig.decay + effectiveScore, 0, 1)
    : prevVitality * domainConfig.decay + effectiveScore * (1 - domainConfig.decay);
  const momentum = vitality - prevVitality;

  // Wilting means "in decline because of neglect," which only makes sense
  // for flow domains. Impulse domains (career) decay by design between
  // events — that's an expected afterglow fade, not neglect — so they never
  // wilt; the visual cue there should just be reduced brightness at low vitality.
  const declineStreak = domainConfig.mode === 'flow' && momentum < WILT_MOMENTUM_THRESHOLD
    ? (state.declineStreak ?? 0) + 1
    : 0;
  const wilting = domainConfig.mode === 'flow' && declineStreak >= WILT_STREAK_DAYS;

  const { stage, stageEnteredOn, stageDwellDays } = computeStage(state, vitality, date);

  return {
    vitality,
    momentum,
    stage,
    stageEnteredOn,
    stageDwellDays,
    declineStreak,
    wilting,
    baseline,
    rawScore,
    effectiveScore,
  };
}

/**
 * Advance the whole garden by one day.
 * @param {object} gardenState - previous GardenState (or initGardenState())
 * @param {object} dailyRawSignals - one DailyRawSignals record (see schema)
 * @returns {object} next GardenState
 */
function stepGarden(gardenState, dailyRawSignals) {
  const { date } = dailyRawSignals;
  const soilMoisture = computeSoilMoisture(gardenState.domains);
  const domains = {};
  for (const domainConfig of DOMAINS) {
    const prev = gardenState.domains[domainConfig.id] ?? initDomainState();
    const raw = dailyRawSignals[domainConfig.id];
    domains[domainConfig.id] = stepDomain(domainConfig, prev, raw, soilMoisture, date);
  }
  return { domains, soilMoisture };
}

module.exports = {
  DOMAINS,
  STAGE_ORDER,
  initGardenState,
  stepGarden,
  computeSoilMoisture,
};
