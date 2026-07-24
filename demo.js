'use strict';

const { initGardenState, stepGarden } = require('./lib/growthEngine');
const { generateSyntheticHistory } = require('./lib/syntheticHistory');

// Scenario: fitness effort stays "good" for all 90 days (constant workouts),
// but sleep dips for three weeks in the middle and recovers after.
// Expectation: fitness vitality should still soften during the sleep dip
// even though nothing about the user's actual workouts changed — that's
// the soilMoisture cross-domain effect, not a scripted number.
const history = generateSyntheticHistory({
  days: 90,
  startDate: '2026-01-01',
  phases: [
    { len: 30, levels: { sleep: 'good', fitness: 'good', study: 'good' } },
    { len: 21, levels: { sleep: 'poor', fitness: 'good', study: 'good' } },
    { len: 39, levels: { sleep: 'good', fitness: 'good', study: 'good' } },
  ],
  careerEvents: [
    { dayIndex: 10, type: 'shipped_project' },
    { dayIndex: 45, type: 'publish' },
    { dayIndex: 80, type: 'offer' },
  ],
});

let garden = initGardenState();
const rows = [];
history.forEach((day, i) => {
  garden = stepGarden(garden, day);
  if (i % 5 === 0 || i === history.length - 1) {
    rows.push({
      day: i,
      date: day.date,
      soil: garden.soilMoisture.toFixed(2),
      sleep: `${garden.domains.sleep.vitality.toFixed(2)} (${garden.domains.sleep.stage})`,
      fitness: `${garden.domains.fitness.vitality.toFixed(2)} (${garden.domains.fitness.stage})${garden.domains.fitness.wilting ? ' wilting' : ''}`,
      study: `${garden.domains.study.vitality.toFixed(2)} (${garden.domains.study.stage})`,
      career: `${garden.domains.career.vitality.toFixed(2)} (${garden.domains.career.stage})`,
    });
  }
});

console.table(rows);

console.log(
  '\nFitness raw effort (steps/activeMinutes) was "good" for all 90 days.',
  '\nWatch the fitness column dip around day 30-50 anyway — that dip is the',
  'soilMoisture penalty from the sleep decline, not a change in behavior.\n'
);
