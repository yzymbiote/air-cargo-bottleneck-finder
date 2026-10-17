/*
 * Air Cargo Terminal Bottleneck Finder — "Find a solution" optimiser
 *
 * Given a budget of extra staff/machines (e.g. "up to 3"), test every possible
 * way to spread them across the four stages, simulate each option on the SAME
 * set of random days, and recommend the one that cuts missed cutoffs the most.
 *
 * This is a brute-force (exhaustive) search: with 4 stages and a budget of 3
 * there are only 35 options, so we can simply try them all and be sure we
 * found the best one, instead of guessing.
 */
(function (root) {
  'use strict';

  var Sim = (typeof module !== 'undefined' && module.exports) ? require('./simulation.js') : root.CargoSim;
  var STAGES = Sim.STAGES;

  // Options whose missed-cutoff % is within this many percentage points of the
  // best are treated as a tie; among ties we prefer the cheapest option.
  var TIE_TOLERANCE = 0.1;

  // Every way to add 0..budget extra resources across `stages` stages.
  // e.g. budget 1, 2 stages -> [0,0], [0,1], [1,0]
  function allocations(budget, stages) {
    var out = [];
    (function build(prefix, left, depth) {
      if (depth === stages) { out.push(prefix); return; }
      for (var k = 0; k <= left; k++) build(prefix.concat([k]), left - k, depth + 1);
    })([], budget, 0);
    return out;
  }

  function total(a) {
    return a.reduce(function (x, y) { return x + y; }, 0);
  }

  function configWith(cfg, added) {
    var c = Sim.clone(cfg);
    STAGES.forEach(function (st, i) { c.stages[st.key].servers += added[i]; });
    return c;
  }

  // Shared preparation: the simulated days are created once and reused for
  // every option ("common random numbers"), so comparisons are fair.
  function prepare(cfg, budget, opts) {
    var reps = opts.replications || 20;
    var seed = opts.seed === undefined ? 42 : opts.seed;
    var shipmentSets = [];
    for (var r = 0; r < reps; r++) shipmentSets.push(Sim.generateShipments(cfg, Sim.makeRng(seed + r)));
    return { reps: reps, shipmentSets: shipmentSets, candidates: allocations(budget, STAGES.length) };
  }

  function evaluate(cfg, added, prep) {
    return {
      added: added,
      result: Sim.runExperiment(configWith(cfg, added), { replications: prep.reps, shipmentSets: prep.shipmentSets })
    };
  }

  // Pick the winner: lowest missed cutoffs; if practically tied, fewest extra
  // resources; then shortest average time through the terminal.
  function rank(options) {
    var bestMissed = Math.min.apply(null, options.map(function (o) { return o.result.missedPct; }));
    return options.slice().sort(function (a, b) {
      var aTie = a.result.missedPct <= bestMissed + TIE_TOLERANCE;
      var bTie = b.result.missedPct <= bestMissed + TIE_TOLERANCE;
      if (aTie !== bTie) return aTie ? -1 : 1;
      if (!aTie && a.result.missedPct !== b.result.missedPct) return a.result.missedPct - b.result.missedPct;
      if (total(a.added) !== total(b.added)) return total(a.added) - total(b.added);
      return a.result.avgTimeInTerminal - b.result.avgTimeInTerminal;
    });
  }

  function finish(options, budget) {
    var ranked = rank(options);
    var baseline = options.filter(function (o) { return total(o.added) === 0; })[0];
    return { budget: budget, baseline: baseline.result, best: ranked[0], ranked: ranked, options: options };
  }

  // Runs the whole search in one go (used by the tests).
  function optimise(cfg, budget, opts) {
    var prep = prepare(cfg, budget, opts || {});
    var options = prep.candidates.map(function (a) { return evaluate(cfg, a, prep); });
    return finish(options, budget);
  }

  // Same search, but in small chunks so the web page stays responsive and can
  // show a progress bar. Calls onDone(result) at the end.
  function optimiseAsync(cfg, budget, opts, onProgress, onDone) {
    var prep = prepare(cfg, budget, opts || {});
    var options = [], i = 0;
    (function chunk() {
      var stopAt = Date.now() + 40;
      while (i < prep.candidates.length && Date.now() < stopAt) {
        options.push(evaluate(cfg, prep.candidates[i], prep));
        i++;
      }
      if (onProgress) onProgress(i, prep.candidates.length);
      if (i < prep.candidates.length) setTimeout(chunk, 0);
      else onDone(finish(options, budget));
    })();
  }

  // "2 screening machines and 1 build-up staff member"
  function describeAllocation(added) {
    var parts = [];
    added.forEach(function (k, i) {
      if (k > 0) parts.push(k + ' ' + (k === 1 ? STAGES[i].unitOne : STAGES[i].unitMany));
    });
    if (parts.length === 0) return 'no extra resources';
    if (parts.length === 1) return parts[0];
    return parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1];
  }

  function pctText(x) {
    return (Math.round(x * 10) / 10) + '%';
  }

  // One plain-English sentence summing up the recommendation.
  function recommendationSentence(res) {
    var before = res.baseline.missedPct, after = res.best.result.missedPct;
    var used = total(res.best.added);
    if (res.budget === 0) return 'Set a budget of at least 1 extra staff member or machine to test options.';
    if (used === 0 || before - after < TIE_TOLERANCE) {
      if (before < TIE_TOLERANCE) return 'No change needed: the terminal already makes every cutoff with its current resources.';
      return 'None of the options meaningfully reduce missed cutoffs (' + pctText(before) + '). The constraint is likely arrival timing or cutoff times rather than staff or machines.';
    }
    var s = 'Add ' + describeAllocation(res.best.added) + ': missed cutoffs drop from ' + pctText(before) + ' to ' + pctText(after) + '.';
    if (used < res.budget) s += ' Only ' + used + ' of your ' + res.budget + ' extra resources are needed; more gives no meaningful extra benefit.';
    return s;
  }

  var api = {
    TIE_TOLERANCE: TIE_TOLERANCE,
    allocations: allocations,
    optimise: optimise,
    optimiseAsync: optimiseAsync,
    describeAllocation: describeAllocation,
    recommendationSentence: recommendationSentence
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CargoOptimiser = api;
})(this);
