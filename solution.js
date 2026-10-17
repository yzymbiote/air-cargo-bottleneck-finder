/*
 * Air Cargo Terminal Bottleneck Finder — "Find a solution" section of the page
 *
 * Runs the optimiser (optimiser.js) on the current inputs and shows the
 * recommendation, a before/after comparison and the top alternatives.
 */
(function () {
  'use strict';

  var Opt = window.CargoOptimiser;
  var App = window.CargoApp;
  var STAGES = window.CargoSim.STAGES;
  var fmt = App.fmt;

  function $(id) { return document.getElementById(id); }

  function showErrors(list) {
    var box = $('opt-errors');
    box.hidden = !list.length;
    box.innerHTML = list.length ? list.map(App.escapeHtml).join('<br>') : '';
  }

  function setProgress(done, total) {
    $('opt-progress').hidden = false;
    $('opt-progress-bar').style.width = (100 * done / total) + '%';
    $('opt-progress-text').textContent = 'Tested ' + done + ' of ' + total + ' options…';
  }

  function render(res) {
    var before = res.baseline, after = res.best.result;
    $('recommendation').textContent = Opt.recommendationSentence(res);

    function row(label, b, a, unit, dp, lowerIsBetter) {
      var better = lowerIsBetter ? a < b : a > b;
      var same = Math.abs(a - b) < Math.pow(10, -(dp === undefined ? 1 : dp)) / 2;
      return '<tr><th scope="row">' + label + '</th><td>' + fmt(b, dp) + unit + '</td>' +
        '<td class="' + (same ? '' : better ? 'better' : 'worse') + '">' + fmt(a, dp) + unit + '</td></tr>';
    }
    $('compare-table').querySelector('tbody').innerHTML =
      row('Missed flight cutoff', before.missedPct, after.missedPct, '%', 1, true) +
      row('Avg time through terminal', before.avgTimeInTerminal, after.avgTimeInTerminal, ' min', 0, true) +
      row('Shipments processed per day', before.completed, after.completed, '', 0, false) +
      '<tr><th scope="row">Bottleneck</th><td>' + App.escapeHtml(before.stages[before.bottleneckIndex].name) + '</td><td>' +
      App.escapeHtml(after.stages[after.bottleneckIndex].name) + '</td></tr>' +
      STAGES.map(function (st, i) {
        return row(App.shortNames()[i] + ' utilisation', before.stages[i].utilisation * 100, after.stages[i].utilisation * 100, '%', 0, true)
          .replace(/ class="(better|worse)"/, '');
      }).join('');

    $('options-table').querySelector('tbody').innerHTML = res.ranked.slice(0, 5).map(function (o, i) {
      var r = o.result;
      return '<tr' + (i === 0 ? ' class="is-best"' : '') + '><td>' + (i + 1) + '</td><td>' + App.escapeHtml(Opt.describeAllocation(o.added)) + '</td>' +
        '<td>' + fmt(r.missedPct) + '%</td><td>' + fmt(r.avgTimeInTerminal, 0) + ' min</td><td>' + App.escapeHtml(r.stages[r.bottleneckIndex].name) + '</td></tr>';
    }).join('');

    var opts = App.baseOptions('avg wait (min)');
    opts.plugins.tooltip = { callbacks: { label: function (c) { return c.dataset.label + ': ' + fmt(c.parsed.y) + ' min'; } } };
    App.replaceChart('compare', 'compare-chart', {
      type: 'bar',
      data: {
        labels: App.shortNames(),
        datasets: [
          { label: 'Before', data: before.stages.map(function (s) { return s.avgWait; }), backgroundColor: App.COLORS.bottleneck, borderRadius: 6 },
          { label: 'After', data: after.stages.map(function (s) { return s.avgWait; }), backgroundColor: '#2a9d8f', borderRadius: 6 }
        ]
      },
      options: opts
    });

    $('opt-result').hidden = false;
  }

  function run() {
    var input = App.readAndValidate();
    if (!input) { showErrors(['Fix the terminal inputs above first.']); return; }
    var budget = Number($('budget').value);
    if (!(budget >= 1 && budget <= 6 && Math.floor(budget) === budget)) { showErrors(['Budget must be a whole number from 1 to 6.']); return; }
    showErrors([]);
    var btn = $('optimise-btn');
    btn.disabled = true;
    btn.textContent = 'Testing options…';
    Opt.optimiseAsync(input.cfg, budget, { replications: input.replications, seed: input.seed }, setProgress, function (res) {
      render(res);
      $('opt-progress').hidden = true;
      btn.disabled = false;
      btn.textContent = 'Find the best fix';
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    $('optimise-form').addEventListener('submit', function (e) { e.preventDefault(); run(); });
    // If the inputs change and are re-simulated, the old recommendation is out of date.
    document.addEventListener('simulation:done', function () { $('opt-result').hidden = true; });
  });
})();
