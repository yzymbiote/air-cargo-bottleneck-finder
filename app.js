/*
 * Air Cargo Terminal Bottleneck Finder — page logic
 *
 * Reads the form, runs the simulation (simulation.js) and draws the results.
 */
(function () {
  'use strict';

  var Sim = window.CargoSim;
  var STAGES = Sim.STAGES;
  var charts = {};
  var lastConfig = null;
  var lastResult = null;

  var COLORS = {
    bar: '#5b7fa6',
    bottleneck: '#d9643a',
    grid: 'rgba(15, 35, 60, 0.08)',
    text: '#44546a',
    stages: ['#2f6db5', '#d9643a', '#2a9d8f', '#8a6bbf']
  };

  // ---------- small helpers ----------

  function $(id) { return document.getElementById(id); }

  function toMinutes(hhmm) {
    if (!hhmm) return null;
    var parts = hhmm.split(':');
    return Number(parts[0]) * 60 + Number(parts[1]);
  }

  function toHHMM(min) {
    var h = Math.floor(min / 60), m = Math.round(min % 60);
    return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
  }

  function num(id) {
    var v = $(id).value;
    return v === '' ? NaN : Number(v);
  }

  function fmt(x, dp) { return x.toFixed(dp === undefined ? 1 : dp); }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ---------- form ----------

  function buildStageInputs() {
    var holder = $('stage-inputs');
    STAGES.forEach(function (st, i) {
      var row = document.createElement('div');
      row.className = 'stage-row';
      row.innerHTML =
        '<span class="stage-name"><span class="step">' + (i + 1) + '</span>' + st.name + '</span>' +
        '<label><span class="sr-label">Staff / machines</span><input type="number" id="servers-' + st.key + '" min="1" max="50" step="1" inputmode="numeric"></label>' +
        '<label><span class="sr-label">Avg minutes per shipment</span><input type="number" id="minutes-' + st.key + '" min="0.1" max="240" step="0.5" inputmode="decimal"></label>';
      holder.appendChild(row);
    });
  }

  function fillForm(cfg) {
    $('openTime').value = toHHMM(cfg.openMin);
    $('closeTime').value = toHHMM(cfg.closeMin);
    $('baseRate').value = cfg.baseArrivalsPerHour;
    $('peakRate').value = cfg.peakArrivalsPerHour;
    $('peakStart').value = toHHMM(cfg.peakStartMin);
    $('peakEnd').value = toHHMM(cfg.peakEndMin);
    $('priorityPct').value = cfg.priorityPct;
    $('leadTime').value = cfg.leadTimeMin;
    for (var i = 0; i < 3; i++) $('cutoff' + (i + 1)).value = cfg.cutoffsMin[i] !== undefined ? toHHMM(cfg.cutoffsMin[i]) : '';
    STAGES.forEach(function (st) {
      $('servers-' + st.key).value = cfg.stages[st.key].servers;
      $('minutes-' + st.key).value = cfg.stages[st.key].minutes;
    });
    $('replications').value = 20;
    $('seed').value = 42;
  }

  function readForm() {
    var cutoffs = [];
    for (var i = 1; i <= 3; i++) {
      var c = toMinutes($('cutoff' + i).value);
      if (c !== null) cutoffs.push(c);
    }
    cutoffs.sort(function (a, b) { return a - b; });
    var stages = {};
    STAGES.forEach(function (st) {
      stages[st.key] = { servers: num('servers-' + st.key), minutes: num('minutes-' + st.key) };
    });
    return {
      cfg: {
        openMin: toMinutes($('openTime').value),
        closeMin: toMinutes($('closeTime').value),
        baseArrivalsPerHour: num('baseRate'),
        peakArrivalsPerHour: num('peakRate'),
        peakStartMin: toMinutes($('peakStart').value),
        peakEndMin: toMinutes($('peakEnd').value),
        priorityPct: num('priorityPct'),
        leadTimeMin: num('leadTime'),
        cutoffsMin: cutoffs,
        stages: stages
      },
      replications: num('replications'),
      seed: num('seed')
    };
  }

  function showErrors(list) {
    var box = $('form-errors');
    if (!list.length) { box.hidden = true; box.innerHTML = ''; return; }
    box.hidden = false;
    box.innerHTML = '<strong>Please check these inputs:</strong><ul>' +
      list.map(function (e) { return '<li>' + escapeHtml(e) + '</li>'; }).join('') + '</ul>';
  }

  function readAndValidate() {
    var input = readForm();
    var errors = Sim.validate(input.cfg);
    if (!(input.replications >= 1 && input.replications <= 200)) errors.push('Simulated days must be between 1 and 200.');
    if (!(input.seed >= 0)) errors.push('Random seed must be a whole number of 0 or more.');
    showErrors(errors);
    return errors.length ? null : input;
  }

  // ---------- results ----------

  function kpi(label, value, sub, tone) {
    return '<div class="kpi' + (tone ? ' ' + tone : '') + '"><span class="kpi-label">' + label + '</span>' +
      '<span class="kpi-value">' + value + '</span>' + (sub ? '<span class="kpi-sub">' + sub + '</span>' : '') + '</div>';
  }

  function renderResults(cfg, res, reps) {
    var bn = res.stages[res.bottleneckIndex];
    $('results-meta').textContent = 'Average of ' + reps + ' simulated days, ' + toHHMM(cfg.openMin) + '–' + toHHMM(cfg.closeMin) + '.';

    $('kpis').innerHTML =
      kpi('Shipments processed', fmt(res.completed, 0), 'of ' + fmt(res.arrived, 0) + ' arrived per day') +
      kpi('Avg time through terminal', fmt(res.avgTimeInTerminal, 0) + ' min', 'arrival to ramp transfer done') +
      kpi('Missed flight cutoff', fmt(res.missedPct) + '%', '±' + fmt(res.missedPctCi95) + ' pts (95% range) · priority ' + fmt(res.priorityMissedPct) + '%',
        res.missedPct >= 10 ? 'bad' : res.missedPct >= 3 ? 'warn' : 'good') +
      kpi('Bottleneck', bn.name, fmt(bn.utilisation * 100, 0) + '% busy · ' + fmt(bn.avgWait) + ' min avg wait', 'accent');

    $('bottleneck-banner').innerHTML =
      '<strong>Bottleneck: ' + escapeHtml(bn.name) + '.</strong> Shipments wait ' + fmt(bn.avgWait) +
      ' minutes on average here, longer than at any other stage, and its ' + bn.servers + ' ' +
      (bn.servers === 1 ? STAGES[res.bottleneckIndex].unitOne : STAGES[res.bottleneckIndex].unitMany) +
      ' are busy ' + fmt(bn.utilisation * 100, 0) + '% of the day.';

    $('stage-table').querySelector('tbody').innerHTML = res.stages.map(function (s, i) {
      var isBn = i === res.bottleneckIndex;
      return '<tr' + (isBn ? ' class="is-bottleneck"' : '') + '>' +
        '<th scope="row">' + escapeHtml(s.name) + (isBn ? ' <span class="tag">Bottleneck</span>' : '') + '</th>' +
        '<td>' + s.servers + '</td><td>' + fmt(s.avgWait) + '</td><td>' + fmt(s.avgQueue) + '</td><td>' + fmt(s.maxQueue, 0) + '</td>' +
        '<td><span class="util"><span class="util-bar" style="width:' + Math.min(100, s.utilisation * 100) + '%"></span></span>' + fmt(s.utilisation * 100, 0) + '%</td></tr>';
    }).join('');

    $('flight-table').querySelector('tbody').innerHTML = res.flights.map(function (f, i) {
      return '<tr><th scope="row">Flight ' + (i + 1) + '</th><td>' + toHHMM(f.cutoffMin) + '</td><td>' + fmt(f.booked, 0) + '</td><td>' + fmt(f.missedPct) + '%</td></tr>';
    }).join('');

    drawUtilChart(res);
    drawTimelineChart(res);
  }

  // ---------- charts ----------

  function chartsAvailable() {
    return typeof window.Chart !== 'undefined';
  }

  function replaceChart(name, canvasId, config) {
    if (!chartsAvailable()) return;
    if (charts[name]) charts[name].destroy();
    charts[name] = new window.Chart($(canvasId), config);
  }

  function baseOptions(yTitle) {
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 400 },
      plugins: { legend: { labels: { color: COLORS.text, boxWidth: 12 } } },
      scales: {
        x: { grid: { display: false }, ticks: { color: COLORS.text } },
        y: { beginAtZero: true, grid: { color: COLORS.grid }, ticks: { color: COLORS.text }, title: { display: !!yTitle, text: yTitle, color: COLORS.text } }
      }
    };
  }

  function shortNames() {
    return ['Acceptance', 'Screening', 'Build-up', 'Ramp'];
  }

  function drawUtilChart(res) {
    var opts = baseOptions('% of day busy');
    opts.scales.y.max = 100;
    opts.plugins.legend.display = false;
    opts.plugins.tooltip = { callbacks: { label: function (c) { return fmt(c.parsed.y, 0) + '% busy'; } } };
    replaceChart('util', 'util-chart', {
      type: 'bar',
      data: {
        labels: shortNames(),
        datasets: [{
          label: 'Utilisation',
          data: res.stages.map(function (s) { return s.utilisation * 100; }),
          backgroundColor: res.stages.map(function (s, i) { return i === res.bottleneckIndex ? COLORS.bottleneck : COLORS.bar; }),
          borderRadius: 6
        }]
      },
      options: opts
    });
  }

  function drawTimelineChart(res) {
    if (!res.timeline) return;
    var opts = baseOptions('shipments waiting');
    opts.elements = { point: { radius: 0 }, line: { tension: 0.3, borderWidth: 2 } };
    opts.interaction = { mode: 'index', intersect: false };
    opts.scales.x.ticks.maxTicksLimit = 9;
    replaceChart('timeline', 'timeline-chart', {
      type: 'line',
      data: {
        labels: res.timeline.times.map(toHHMM),
        datasets: shortNames().map(function (n, i) {
          return { label: n, data: res.timeline.queues[i], borderColor: COLORS.stages[i], backgroundColor: COLORS.stages[i] };
        })
      },
      options: opts
    });
  }

  // ---------- actions ----------

  function runSimulation() {
    var input = readAndValidate();
    if (!input) return;
    var btn = $('run-btn');
    btn.disabled = true;
    btn.textContent = 'Simulating…';
    // Let the browser repaint the button before the (short) number crunching.
    setTimeout(function () {
      lastConfig = input;
      lastResult = Sim.runExperiment(input.cfg, { replications: input.replications, seed: input.seed, timeline: true });
      renderResults(input.cfg, lastResult, input.replications);
      btn.disabled = false;
      btn.textContent = 'Run simulation';
      document.dispatchEvent(new CustomEvent('simulation:done', { detail: { input: lastConfig, result: lastResult } }));
    }, 20);
  }

  function init() {
    buildStageInputs();
    fillForm(Sim.DEFAULTS);
    if (!chartsAvailable()) {
      document.querySelectorAll('.chart-holder').forEach(function (el) {
        el.innerHTML = '<p class="hint">Charts could not load (no internet connection to the chart library). The tables still show every result.</p>';
      });
    }
    $('config-form').addEventListener('submit', function (e) { e.preventDefault(); runSimulation(); });
    $('reset-btn').addEventListener('click', function () { fillForm(Sim.DEFAULTS); showErrors([]); runSimulation(); });
    runSimulation();
  }

  // Shared with optimiser UI code.
  window.CargoApp = {
    readAndValidate: readAndValidate,
    getLast: function () { return { input: lastConfig, result: lastResult }; },
    toHHMM: toHHMM,
    fmt: fmt,
    escapeHtml: escapeHtml,
    replaceChart: replaceChart,
    baseOptions: baseOptions,
    shortNames: shortNames,
    COLORS: COLORS
  };

  document.addEventListener('DOMContentLoaded', init);
})();
