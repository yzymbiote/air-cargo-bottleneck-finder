/*
 * Sanity checks for the simulation and optimiser.
 * Run with:  node tests/run-tests.js
 *
 * Each check asks a common-sense question that a correct model must pass,
 * e.g. "if we add staff to the bottleneck, do shipments wait less?"
 */
'use strict';
var assert = require('assert');
var path = require('path');
var S = require(path.join(__dirname, '..', 'js', 'simulation.js'));

var passed = 0, failed = 0;
function check(name, fn) {
  try {
    var note = fn();
    passed++;
    console.log('  PASS  ' + name + (note ? '\n        ' + note : ''));
  } catch (e) {
    failed++;
    console.log('  FAIL  ' + name + '\n        ' + e.message);
  }
}
function run(cfg, reps, seed) {
  return S.runExperiment(cfg, { replications: reps || 20, seed: seed === undefined ? 42 : seed });
}
function f1(x) { return x.toFixed(1); }

var base = run(S.DEFAULTS);
var SCREEN = 1; // index of the screening stage

console.log('\nSimulation engine');

check('Same seed gives exactly the same results (repeatable)', function () {
  var again = run(S.DEFAULTS);
  assert.deepStrictEqual(again, base);
  var other = run(S.DEFAULTS, 20, 7);
  assert.notStrictEqual(other.missedPct, base.missedPct, 'a different seed should give a (slightly) different day');
});

check('Every shipment is accounted for (arrived = completed + still in terminal)', function () {
  assert.ok(Math.abs(base.arrived - base.completed - base.inTerminalAtClose) < 1e-9);
  assert.ok(base.arrived > 0);
});

check('Random processing times average out to the number typed in', function () {
  var rng = S.makeRng(1), total = 0, n = 200000;
  for (var i = 0; i < n; i++) total += S.sampleServiceTime(10, rng);
  var avg = total / n;
  assert.ok(Math.abs(avg - 10) < 0.05, 'average was ' + avg);
  return 'average of 200,000 draws with a 10-minute average: ' + avg.toFixed(3) + ' min';
});

check('Number of arrivals matches the arrival rates', function () {
  var c = S.DEFAULTS;
  var peakHrs = (c.peakEndMin - c.peakStartMin) / 60;
  var expected = c.baseArrivalsPerHour * ((c.closeMin - c.openMin) / 60 - peakHrs) + c.peakArrivalsPerHour * peakHrs;
  var r = run(c, 200);
  assert.ok(Math.abs(r.arrived - expected) / expected < 0.02, 'got ' + r.arrived + ', expected ' + expected);
  return 'expected ' + expected + ' per day, simulated average ' + f1(r.arrived);
});

check('Utilisation matches the textbook formula when the terminal is quiet', function () {
  // Utilisation = arrivals per minute x minutes per shipment / number of servers
  var c = S.clone(S.DEFAULTS);
  c.baseArrivalsPerHour = c.peakArrivalsPerHour = 12;
  var r = run(c, 100);
  var notes = [];
  S.STAGES.forEach(function (st, i) {
    var p = c.stages[st.key];
    var theory = (12 / 60) * p.minutes / p.servers;
    var sim = r.stages[i].utilisation;
    // Slightly lower in the simulation because the last shipments of the day are cut off at closing.
    assert.ok(Math.abs(sim - theory) < 0.03, st.name + ': simulated ' + sim + ' vs theory ' + theory);
    notes.push(st.key + ' ' + Math.round(theory * 100) + '% vs ' + Math.round(sim * 100) + '%');
  });
  return 'theory vs simulated: ' + notes.join(', ');
});

check("Little's Law holds: avg queue length = arrival rate x avg wait", function () {
  var c = S.clone(S.DEFAULTS);
  c.baseArrivalsPerHour = c.peakArrivalsPerHour = 28; // steady demand
  var r = run(c, 50);
  var s = r.stages[SCREEN];
  var lambda = r.arrived / (c.closeMin - c.openMin); // shipments per minute
  var predicted = lambda * s.avgWait;
  assert.ok(Math.abs(predicted - s.avgQueue) / s.avgQueue < 0.1, 'predicted ' + predicted + ' vs ' + s.avgQueue);
  return 'screening: predicted ' + predicted.toFixed(2) + ', measured ' + s.avgQueue.toFixed(2);
});

check('Default scenario: screening is the bottleneck', function () {
  assert.strictEqual(base.bottleneckIndex, SCREEN);
  return 'waits (min): ' + base.stages.map(function (s) { return s.key + ' ' + f1(s.avgWait); }).join(', ') +
    ' | missed cutoffs ' + f1(base.missedPct) + '%';
});

check('Adding machines to the bottleneck cuts waiting there and missed cutoffs never rise', function () {
  var prevWait = Infinity, prevMissed = Infinity, notes = [];
  for (var k = 0; k <= 3; k++) {
    var c = S.clone(S.DEFAULTS);
    c.stages.screening.servers += k;
    var r = run(c);
    assert.ok(r.stages[SCREEN].avgWait <= prevWait + 1e-9, 'screening wait went up with +' + k);
    assert.ok(r.missedPct <= prevMissed + 0.5, 'missed cutoffs went up with +' + k);
    if (k === 1) assert.ok(r.stages[SCREEN].avgWait < base.stages[SCREEN].avgWait * 0.5, 'first extra machine should at least halve screening wait');
    prevWait = r.stages[SCREEN].avgWait;
    prevMissed = r.missedPct;
    notes.push('+' + k + ': wait ' + f1(r.stages[SCREEN].avgWait) + ' min, missed ' + f1(r.missedPct) + '%');
  }
  return notes.join(' | ');
});

check('Fixing the bottleneck moves it downstream (build-up waits rise)', function () {
  var c = S.clone(S.DEFAULTS);
  c.stages.screening.servers += 1;
  var r = run(c);
  assert.ok(r.stages[2].avgWait > base.stages[2].avgWait, 'build-up wait should increase');
  return 'build-up wait ' + f1(base.stages[2].avgWait) + ' -> ' + f1(r.stages[2].avgWait) + ' min; new bottleneck: ' + r.stages[r.bottleneckIndex].name;
});

check('Adding staff to a quiet stage barely changes anything', function () {
  var c = S.clone(S.DEFAULTS);
  c.stages.ramp.servers += 2;
  var r = run(c);
  assert.ok(Math.abs(r.missedPct - base.missedPct) < 1, 'missed changed from ' + base.missedPct + ' to ' + r.missedPct);
  return 'missed cutoffs ' + f1(base.missedPct) + '% -> ' + f1(r.missedPct) + '%';
});

check('Priority shipments miss their cutoff less often than normal shipments', function () {
  assert.ok(base.priorityMissedPct < base.normalMissedPct);
  return 'priority ' + f1(base.priorityMissedPct) + '% vs normal ' + f1(base.normalMissedPct) + '%';
});

check('Busier days miss more cutoffs', function () {
  var c = S.clone(S.DEFAULTS);
  c.peakArrivalsPerHour += 15;
  var r = run(c);
  assert.ok(r.missedPct > base.missedPct);
  return 'peak +15/hr: missed ' + f1(base.missedPct) + '% -> ' + f1(r.missedPct) + '%';
});

check('Slower processing at a stage makes shipments wait longer there', function () {
  var c = S.clone(S.DEFAULTS);
  c.stages.buildup.minutes += 2;
  var r = run(c);
  assert.ok(r.stages[2].avgWait > base.stages[2].avgWait);
});

check('Bad inputs are rejected with a clear message', function () {
  var c = S.clone(S.DEFAULTS);
  c.closeMin = c.openMin - 60;
  c.stages.screening.servers = 0;
  var errs = S.validate(c);
  assert.ok(errs.length >= 2, errs.join('; '));
  assert.strictEqual(S.validate(S.DEFAULTS).length, 0);
});

var O;
try { O = require(path.join(__dirname, '..', 'js', 'optimiser.js')); } catch (e) { O = null; }
if (O) {
  console.log('\nOptimiser');

  check('Tests every way to spread the extra resources', function () {
    var opts = O.allocations(3, 4);
    assert.strictEqual(opts.length, 35); // all ways to add 0, 1, 2 or 3 across 4 stages
    opts.forEach(function (a) { assert.ok(a.reduce(function (x, y) { return x + y; }, 0) <= 3); });
  });

  check('Recommendation is at least as good as every alternative it tested', function () {
    var res = O.optimise(S.DEFAULTS, 3, { replications: 20, seed: 42 });
    res.options.forEach(function (o) {
      assert.ok(res.best.result.missedPct <= o.result.missedPct + O.TIE_TOLERANCE + 1e-9);
    });
    assert.ok(res.best.result.missedPct < res.baseline.missedPct);
    return O.recommendationSentence(res);
  });

  check('Recommendation includes the bottleneck stage', function () {
    var res = O.optimise(S.DEFAULTS, 3, { replications: 20, seed: 42 });
    assert.ok(res.best.added[SCREEN] >= 1);
  });

  check('With a budget of 0 it recommends no change', function () {
    var res = O.optimise(S.DEFAULTS, 0, { replications: 5, seed: 42 });
    assert.deepStrictEqual(res.best.added, [0, 0, 0, 0]);
  });
}

console.log('\n' + passed + ' passed, ' + failed + ' failed\n');
process.exit(failed ? 1 : 0);
