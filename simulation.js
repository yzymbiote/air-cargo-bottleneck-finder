/*
 * Air Cargo Terminal Bottleneck Finder — simulation engine
 *
 * This file models one operating day of an export air cargo terminal.
 * Every shipment passes through four stages in order:
 *   1. Acceptance & documentation check
 *   2. Security screening (X-ray)
 *   3. Build-up onto ULDs (pallets / containers)
 *   4. Ramp transfer to the aircraft
 *
 * Method: discrete-event simulation. Instead of ticking a clock minute by
 * minute, we jump straight from one "event" (a shipment arrives at a stage,
 * or a stage finishes a shipment) to the next. Randomness comes from a seeded
 * random number generator, so the same seed always gives the same answer.
 *
 * All default numbers are illustrative assumptions, not real airline data.
 *
 * Works in the browser (exposed as window.CargoSim) and in Node.js (for tests).
 */
(function (root) {
  'use strict';

  var STAGES = [
    { key: 'acceptance', name: 'Acceptance & documents', unitOne: 'acceptance agent', unitMany: 'acceptance agents' },
    { key: 'screening', name: 'Security screening (X-ray)', unitOne: 'screening machine', unitMany: 'screening machines' },
    { key: 'buildup', name: 'Build-up (ULDs)', unitOne: 'build-up staff member', unitMany: 'build-up staff' },
    { key: 'ramp', name: 'Ramp transfer', unitOne: 'ramp crew', unitMany: 'ramp crews' }
  ];

  // Illustrative starting scenario. Times are minutes after midnight.
  var DEFAULTS = {
    openMin: 6 * 60,            // terminal opens 06:00
    closeMin: 22 * 60,          // terminal closes 22:00
    baseArrivalsPerHour: 24,    // normal arrival rate
    peakArrivalsPerHour: 56,    // busier window before an afternoon cutoff
    peakStartMin: 14 * 60,      // 14:00
    peakEndMin: 16 * 60,        // 16:00
    priorityPct: 15,            // % priority / perishable shipments (jump the queue)
    leadTimeMin: 60,            // a shipment must arrive at least this long before a flight's cutoff to be booked on it
    cutoffsMin: [11 * 60, 16 * 60 + 30, 21 * 60], // 11:00, 16:30, 21:00
    stages: {
      acceptance: { servers: 4, minutes: 6 },
      screening: { servers: 2, minutes: 4 },
      buildup: { servers: 4, minutes: 8 },
      ramp: { servers: 2, minutes: 3 }
    }
  };

  // ---------------------------------------------------------------------------
  // Random numbers
  // ---------------------------------------------------------------------------

  // Small, well-known seeded random number generator ("mulberry32").
  // Returns a function that gives a new number between 0 and 1 on each call.
  function makeRng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Processing time for one shipment at one stage.
  // Triangular distribution between 0.5x and 1.7x the average, most likely
  // around 0.8x: most shipments are a bit quicker than average, a few take
  // much longer (e.g. a paperwork problem or an awkward piece). Its mean is
  // exactly the average the user typed in.
  function sampleServiceTime(avg, rng) {
    var a = 0.5 * avg, c = 0.8 * avg, b = 1.7 * avg;
    var u = rng();
    var split = (c - a) / (b - a);
    if (u < split) return a + Math.sqrt(u * (b - a) * (c - a));
    return b - Math.sqrt((1 - u) * (b - a) * (b - c));
  }

  function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function arrivalRateAt(cfg, t) {
    var inPeak = t >= cfg.peakStartMin && t < cfg.peakEndMin;
    return inPeak ? cfg.peakArrivalsPerHour : cfg.baseArrivalsPerHour;
  }

  // Book a shipment on the earliest flight it can still realistically make.
  // Returns the flight's index, or -1 if it arrived too late for every flight
  // today (it goes on tomorrow's first flight and is left out of the
  // missed-cutoff figure).
  function bookFlight(cfg, arrival) {
    for (var i = 0; i < cfg.cutoffsMin.length; i++) {
      if (cfg.cutoffsMin[i] - arrival >= cfg.leadTimeMin) return i;
    }
    return -1;
  }

  // ---------------------------------------------------------------------------
  // Step 1: create the day's shipments
  // ---------------------------------------------------------------------------

  // Generates every shipment for one day: when it arrives, whether it is
  // priority, which flight it is booked on, and how long each stage will take.
  // This depends only on the demand inputs and the random seed — NOT on the
  // number of staff/machines. So when we compare "before" and "after", both
  // see exactly the same day of cargo, and the difference is down to the
  // change in resources rather than luck.
  function generateShipments(cfg, rng) {
    var shipments = [];
    var maxRatePerMin = Math.max(cfg.baseArrivalsPerHour, cfg.peakArrivalsPerHour) / 60;
    if (maxRatePerMin <= 0) return shipments;
    var t = cfg.openMin;
    var cutoffs = cfg.cutoffsMin.slice().sort(function (x, y) { return x - y; });
    var booking = { cutoffsMin: cutoffs, leadTimeMin: cfg.leadTimeMin };

    while (true) {
      // Random arrivals (a Poisson process): the gap to the next candidate
      // arrival is random, averaging 1 / rate.
      t += -Math.log(1 - rng()) / maxRatePerMin;
      if (t >= cfg.closeMin) break;
      // Outside the peak the rate is lower, so we keep only some candidates
      // ("thinning"). The random number is drawn either way so the sequence
      // of random numbers stays stable.
      var keep = rng() < (arrivalRateAt(cfg, t) / 60) / maxRatePerMin;
      var isPriority = rng() < cfg.priorityPct / 100;
      var service = [];
      for (var s = 0; s < STAGES.length; s++) {
        service.push(sampleServiceTime(cfg.stages[STAGES[s].key].minutes, rng));
      }
      if (!keep) continue;
      var flight = bookFlight(booking, t);
      shipments.push({
        id: shipments.length,
        arrival: t,
        priority: isPriority,
        flight: flight,
        cutoff: flight >= 0 ? cutoffs[flight] : null,
        service: service
      });
    }
    return shipments;
  }

  // ---------------------------------------------------------------------------
  // Step 2: run the day
  // ---------------------------------------------------------------------------

  // A tiny "priority queue" of future events, always giving back the earliest
  // event first. Events at the same time come out in the order they were added.
  function EventList() {
    this.items = [];
    this.counter = 0;
  }
  EventList.prototype.before = function (a, b) {
    return a.time < b.time || (a.time === b.time && a.seq < b.seq);
  };
  EventList.prototype.push = function (ev) {
    ev.seq = this.counter++;
    var h = this.items;
    h.push(ev);
    var i = h.length - 1;
    while (i > 0) {
      var p = (i - 1) >> 1;
      if (!this.before(h[i], h[p])) break;
      var tmp = h[i]; h[i] = h[p]; h[p] = tmp;
      i = p;
    }
  };
  EventList.prototype.pop = function () {
    var h = this.items;
    var top = h[0];
    var last = h.pop();
    if (h.length > 0) {
      h[0] = last;
      var i = 0;
      while (true) {
        var l = 2 * i + 1, r = l + 1, m = i;
        if (l < h.length && this.before(h[l], h[m])) m = l;
        if (r < h.length && this.before(h[r], h[m])) m = r;
        if (m === i) break;
        var tmp = h[i]; h[i] = h[m]; h[m] = tmp;
        i = m;
      }
    }
    return top;
  };
  EventList.prototype.size = function () {
    return this.items.length;
  };

  // Waiting line for one stage. Priority shipments are always served before
  // normal ones; within each group it is first come, first served.
  // (Nobody is interrupted mid-task: priority only jumps the waiting line.)
  function StageQueue() {
    this.priority = [];
    this.normal = [];
    this.pHead = 0;
    this.nHead = 0;
  }
  StageQueue.prototype.length = function () {
    return (this.priority.length - this.pHead) + (this.normal.length - this.nHead);
  };
  StageQueue.prototype.add = function (item, isPriority) {
    (isPriority ? this.priority : this.normal).push(item);
  };
  StageQueue.prototype.next = function () {
    if (this.pHead < this.priority.length) return this.priority[this.pHead++];
    return this.normal[this.nHead++];
  };
  StageQueue.prototype.remaining = function () {
    return this.priority.slice(this.pHead).concat(this.normal.slice(this.nHead));
  };

  // Simulates one day. The terminal stops work at closing time; anything not
  // finished by then is counted as "still in the terminal".
  function simulateDay(cfg, shipments, options) {
    options = options || {};
    var n = STAGES.length;
    var open = cfg.openMin, close = cfg.closeMin;
    var servers = STAGES.map(function (st) { return cfg.stages[st.key].servers; });

    var busy = [], queues = [], busyTime = [], queueArea = [], lastChange = [], maxQueue = [];
    var waitSum = [], waitCount = [];
    for (var s = 0; s < n; s++) {
      busy.push(0); queues.push(new StageQueue()); busyTime.push(0);
      queueArea.push(0); lastChange.push(open); maxQueue.push(0);
      waitSum.push(0); waitCount.push(0);
    }

    // Per-shipment record of this run (kept separate from the shared input).
    var recs = shipments.map(function (sh) {
      return { ship: sh, enter: new Array(n), start: new Array(n), done: null };
    });

    var events = new EventList();
    recs.forEach(function (rec) {
      events.push({ time: rec.ship.arrival, type: 'arrive', stage: 0, rec: rec });
    });

    // Keeps a running total of "queue length x time" so we can report the
    // average queue length over the day.
    function noteQueue(s, t) {
      queueArea[s] += queues[s].length() * (t - lastChange[s]);
      lastChange[s] = t;
    }

    function startService(s, rec, t) {
      busy[s]++;
      rec.start[s] = t;
      waitSum[s] += t - rec.enter[s];
      waitCount[s]++;
      var finish = t + rec.ship.service[s];
      busyTime[s] += Math.min(finish, close) - t;
      events.push({ time: finish, type: 'finish', stage: s, rec: rec });
    }

    while (events.size() > 0) {
      var ev = events.pop();
      var t = ev.time;
      if (t > close) break;
      var s2 = ev.stage, rec = ev.rec;

      if (ev.type === 'arrive') {
        rec.enter[s2] = t;
        if (busy[s2] < servers[s2]) {
          startService(s2, rec, t);
        } else {
          noteQueue(s2, t);
          queues[s2].add(rec, rec.ship.priority);
          maxQueue[s2] = Math.max(maxQueue[s2], queues[s2].length());
        }
      } else {
        busy[s2]--;
        if (s2 < n - 1) {
          events.push({ time: t, type: 'arrive', stage: s2 + 1, rec: rec });
        } else {
          rec.done = t;
        }
        if (queues[s2].length() > 0) {
          noteQueue(s2, t);
          startService(s2, queues[s2].next(), t);
        }
      }
    }

    // Close of day: count the time still-waiting shipments have waited so far.
    for (var s3 = 0; s3 < n; s3++) {
      noteQueue(s3, close);
      queues[s3].remaining().forEach(function (r) {
        waitSum[s3] += close - r.enter[s3];
        waitCount[s3]++;
      });
    }

    // Overall results
    var dayLength = close - open;
    var completed = 0, timeSum = 0, bookedToday = 0, missed = 0;
    var prioBooked = 0, prioMissed = 0, normBooked = 0, normMissed = 0;
    var flights = cfg.cutoffsMin.map(function () { return { booked: 0, missed: 0 }; });
    recs.forEach(function (r) {
      if (r.done !== null) {
        completed++;
        timeSum += r.done - r.ship.arrival;
      }
      if (r.ship.flight >= 0) {
        var late = r.done === null || r.done > r.ship.cutoff;
        bookedToday++;
        flights[r.ship.flight].booked++;
        if (late) { missed++; flights[r.ship.flight].missed++; }
        if (r.ship.priority) { prioBooked++; if (late) prioMissed++; } else { normBooked++; if (late) normMissed++; }
      }
    });

    var result = {
      arrived: recs.length,
      completed: completed,
      inTerminalAtClose: recs.length - completed,
      avgTimeInTerminal: completed ? timeSum / completed : 0,
      bookedToday: bookedToday,
      missed: missed,
      prioBooked: prioBooked, prioMissed: prioMissed,
      normBooked: normBooked, normMissed: normMissed,
      flights: flights,
      stages: STAGES.map(function (st, i) {
        return {
          avgWait: waitCount[i] ? waitSum[i] / waitCount[i] : 0,
          avgQueue: queueArea[i] / dayLength,
          maxQueue: maxQueue[i],
          utilisation: busyTime[i] / (servers[i] * dayLength)
        };
      })
    };

    // Optional: how many shipments are waiting at each stage, every 15 minutes
    // (used for the "queues through the day" chart).
    if (options.timeline) {
      var step = 15, times = [];
      for (var tt = open; tt <= close; tt += step) times.push(tt);
      result.timeline = {
        times: times,
        queues: STAGES.map(function (st, i) {
          return times.map(function (T) {
            var c = 0;
            for (var k = 0; k < recs.length; k++) {
              var e = recs[k].enter[i];
              if (e !== undefined && e <= T) {
                var st0 = recs[k].start[i];
                if (st0 === undefined || st0 > T) c++;
              }
            }
            return c;
          });
        })
      };
    }
    return result;
  }

  // ---------------------------------------------------------------------------
  // Step 3: repeat the day many times and average
  // ---------------------------------------------------------------------------

  // One random day can be lucky or unlucky, so we simulate several days
  // (each with its own seed: seed, seed+1, seed+2, ...) and average them.
  function runExperiment(cfg, options) {
    options = options || {};
    var reps = options.replications || 20;
    var seed = options.seed === undefined ? 42 : options.seed;
    var days = [];
    for (var r = 0; r < reps; r++) {
      var shipments = options.shipmentSets ? options.shipmentSets[r] : generateShipments(cfg, makeRng(seed + r));
      days.push(simulateDay(cfg, shipments, { timeline: options.timeline }));
    }
    return summarise(cfg, days);
  }

  function mean(arr) {
    return arr.reduce(function (a, b) { return a + b; }, 0) / (arr.length || 1);
  }

  function pct(part, whole) {
    return whole ? (100 * part) / whole : 0;
  }

  function summarise(cfg, days) {
    var missedPctByDay = days.map(function (d) { return pct(d.missed, d.bookedToday); });
    // 95% confidence interval half-width for the missed-cutoff % (how much the
    // average might move if we simulated many more days).
    var m = mean(missedPctByDay);
    var variance = days.length > 1
      ? missedPctByDay.reduce(function (a, x) { return a + (x - m) * (x - m); }, 0) / (days.length - 1)
      : 0;
    var ci95 = days.length > 1 ? 1.96 * Math.sqrt(variance / days.length) : 0;

    function sum(f) { return days.reduce(function (a, d) { return a + f(d); }, 0); }

    var stages = STAGES.map(function (st, i) {
      return {
        key: st.key,
        name: st.name,
        servers: cfg.stages[st.key].servers,
        avgWait: mean(days.map(function (d) { return d.stages[i].avgWait; })),
        avgQueue: mean(days.map(function (d) { return d.stages[i].avgQueue; })),
        maxQueue: mean(days.map(function (d) { return d.stages[i].maxQueue; })),
        utilisation: mean(days.map(function (d) { return d.stages[i].utilisation; }))
      };
    });

    // Bottleneck = the stage where shipments wait longest. If waits are
    // practically equal (within half a minute), the busier stage wins.
    var bottleneck = 0;
    for (var i = 1; i < stages.length; i++) {
      var dw = stages[i].avgWait - stages[bottleneck].avgWait;
      if (dw > 0.5 || (Math.abs(dw) <= 0.5 && stages[i].utilisation > stages[bottleneck].utilisation)) bottleneck = i;
    }

    var out = {
      replications: days.length,
      arrived: mean(days.map(function (d) { return d.arrived; })),
      completed: mean(days.map(function (d) { return d.completed; })),
      inTerminalAtClose: mean(days.map(function (d) { return d.inTerminalAtClose; })),
      avgTimeInTerminal: mean(days.map(function (d) { return d.avgTimeInTerminal; })),
      missedPct: pct(sum(function (d) { return d.missed; }), sum(function (d) { return d.bookedToday; })),
      missedPctCi95: ci95,
      priorityMissedPct: pct(sum(function (d) { return d.prioMissed; }), sum(function (d) { return d.prioBooked; })),
      normalMissedPct: pct(sum(function (d) { return d.normMissed; }), sum(function (d) { return d.normBooked; })),
      flights: cfg.cutoffsMin.map(function (c, f) {
        var booked = sum(function (d) { return d.flights[f].booked; });
        return {
          cutoffMin: c,
          booked: booked / days.length,
          missedPct: pct(sum(function (d) { return d.flights[f].missed; }), booked)
        };
      }),
      stages: stages,
      bottleneckIndex: bottleneck
    };

    if (days[0] && days[0].timeline) {
      out.timeline = {
        times: days[0].timeline.times,
        queues: STAGES.map(function (st, i) {
          return days[0].timeline.times.map(function (T, k) {
            return mean(days.map(function (d) { return d.timeline.queues[i][k]; }));
          });
        })
      };
    }
    return out;
  }

  // Basic sanity checks on user inputs. Returns a list of plain-English problems.
  function validate(cfg) {
    var errors = [];
    if (!(cfg.closeMin > cfg.openMin)) errors.push('Closing time must be later than opening time.');
    if (!(cfg.baseArrivalsPerHour >= 0) || !(cfg.peakArrivalsPerHour >= 0)) errors.push('Arrival rates cannot be negative.');
    if (cfg.baseArrivalsPerHour > 500 || cfg.peakArrivalsPerHour > 500) errors.push('Please keep arrival rates at or below 500 per hour.');
    if (!(cfg.peakEndMin > cfg.peakStartMin)) errors.push('Peak end must be later than peak start.');
    if (!(cfg.priorityPct >= 0 && cfg.priorityPct <= 100)) errors.push('Priority share must be between 0 and 100%.');
    if (!(cfg.leadTimeMin >= 0)) errors.push('Minimum lead time cannot be negative.');
    if (cfg.cutoffsMin.length < 1) errors.push('Enter at least one flight cutoff time.');
    cfg.cutoffsMin.forEach(function (c, i) {
      if (!(c > cfg.openMin && c <= cfg.closeMin)) errors.push('Flight ' + (i + 1) + ' cutoff must be within operating hours.');
    });
    STAGES.forEach(function (st) {
      var p = cfg.stages[st.key];
      if (!(p.servers >= 1 && p.servers <= 50 && Math.floor(p.servers) === p.servers)) errors.push(st.name + ': staff/machines must be a whole number from 1 to 50.');
      if (!(p.minutes > 0 && p.minutes <= 240)) errors.push(st.name + ': minutes per shipment must be between 0 and 240.');
    });
    return errors;
  }

  var api = {
    STAGES: STAGES,
    DEFAULTS: DEFAULTS,
    makeRng: makeRng,
    clone: clone,
    sampleServiceTime: sampleServiceTime,
    generateShipments: generateShipments,
    simulateDay: simulateDay,
    runExperiment: runExperiment,
    validate: validate
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CargoSim = api;
})(this);
