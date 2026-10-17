# Air Cargo Terminal Bottleneck Finder

A free, browser-based tool that simulates a day at an air cargo export terminal, shows where shipments get stuck, and recommends the best way to spend a limited budget of extra staff or machines.

**Live demo:** _add your GitHub Pages link here_

> All default numbers are **illustrative assumptions** chosen to be plausible. They are not real airline, airport or terminal data. No real company is represented.

---

## The business problem

Export air cargo must pass through four stages before a flight's **cargo cutoff**:

1. **Acceptance & documentation check**: weigh, measure and check the paperwork (air waybill, dangerous goods declarations).
2. **Security screening (X-ray)**: every shipment must be screened before it can fly.
3. **Build-up**: pack shipments onto pallets and containers (ULDs, unit load devices).
4. **Ramp transfer**: move the built-up ULDs to the aircraft.

Shipment arrivals are uneven. Forwarders often deliver in a rush just before a cutoff. When one stage can't keep up, a queue builds there, and shipments miss their flight. That means re-booking costs, unhappy customers and, for perishables, spoiled goods.

Managers then face two questions:
- **Where is the real bottleneck?** The stage that looks busiest isn't always the one causing missed flights.
- **If I can add a few staff or machines, where should they go?** Adding them only to the bottleneck often just moves the queue to the next stage.

This tool answers both questions with a simulation instead of guesswork.

## What the tool does

1. **You enter** the terminal's operating numbers: opening hours, arrivals per hour with a peak window, flight cutoff times, % priority/perishable cargo, and for each stage the number of staff/machines and the average minutes per shipment.
2. **It simulates** many days of cargo moving through the terminal and reports, for each stage, the **average wait**, **average queue length** and **utilisation** (how busy it is). Overall, it reports **shipments processed**, **average time through the terminal** and **% of shipments that miss their flight cutoff**. It highlights the **bottleneck** stage.
3. **"Find a solution"**: you give a budget (e.g. "up to 3 extra staff/machines"). The tool tests every possible way to spread them across the stages and recommends the one that cuts missed cutoffs the most. It shows a before vs after comparison and a one-sentence recommendation. With the default inputs and a budget of 3:

   > Add 1 screening machine and 2 build-up staff: missed cutoffs drop from 13.1% to 2.4%.

   Adding only a screening machine (the bottleneck) gets missed cutoffs to just 11.5%, because the queue moves on to build-up. Fixing one constraint reveals the next.

## Method

### Discrete-event simulation
The model follows each individual shipment through the terminal. The clock doesn't tick minute by minute. Instead it jumps from one *event* to the next, such as "shipment 57 arrives at screening" or "build-up finishes shipment 12". At each stage:
- if a staff member or machine is free, the shipment starts straight away;
- otherwise it joins the queue. **Priority/perishable shipments go to the front of the queue** (but nobody is interrupted mid-task).

### Randomness, made repeatable
- **Arrivals** are random (a Poisson process), averaging the hourly rate you enter, with a higher rate during the peak window.
- **Processing times** vary randomly between 0.5× and 1.7× the average you enter (a triangular distribution). Most shipments are a little quicker than average and a few take much longer. The overall average is exactly what you entered.
- A **seeded random number generator** means the same inputs and seed always give exactly the same results.
- The tool simulates **20 days by default and averages them**, because one day can be lucky or unlucky. The missed-cutoff figure also shows a 95% range to indicate how precise the average is.

### Flights and cutoffs
Each shipment is booked on the **earliest flight whose cutoff is at least the minimum lead time away** (default 60 min). It **misses its cutoff** if it hasn't finished ramp transfer by then. Shipments arriving too late for every flight today are booked on tomorrow's flights and left out of the missed-cutoff figure.

### Bottleneck
The bottleneck is the stage where shipments **wait longest on average**. It is normally also one of the busiest (highest utilisation).

### Optimiser
For a budget of *B* extra resources and 4 stages, the tool lists every way to add 0…*B* resources (35 options for *B* = 3, 210 for *B* = 6) and simulates each one. All options are tested on the **same simulated days** ("common random numbers"), so differences come from the change, not from luck. Options are ranked by:
1. lowest % missed cutoffs (options within 0.1 percentage points count as a tie);
2. then fewest extra resources (don't spend what you don't need);
3. then shortest average time through the terminal.

## Assumptions and limitations

| Assumption | Why it matters |
|---|---|
| Default numbers are illustrative, not real data | Results show the method, not a real terminal's performance |
| Each stage handles one shipment at a time per staff member/machine | Real build-up and ramp work is often batched per flight or ULD |
| Resources are available all day at a fixed level | No shifts, breaks or equipment breakdowns |
| Every shipment passes screening first time | No rejections, re-screens or documentation holds |
| Work stops at closing time | Anything unfinished counts as "still in the terminal" |
| Priority only jumps the queue | It doesn't interrupt work already in progress |

Natural next steps would be shift patterns, per-flight batching of ULDs, screening failure rates and a cost per resource, so the tool could also compare value for money.

## How to use it

1. Open the live link (or open `index.html` in any browser. No install needed.)
2. Change any input in **1. Terminal inputs** and click **Run simulation**.
3. Read **2. Simulation results**: the orange bar and highlighted row show the bottleneck. The "Shipments waiting through the day" chart shows when queues build.
4. In **3. Find a solution**, enter how many extra staff/machines you could add and click **Find the best fix**.
5. **Reset to defaults** restores the example scenario.

## Tech

- Plain HTML, CSS and JavaScript, with no build step, backend or login.
- [Chart.js](https://www.chartjs.org/) loaded from a CDN for the charts.
- Hosted free on GitHub Pages.

```
air-cargo-bottleneck-finder/
├── index.html          page layout and text
├── css/style.css       styling (mobile-friendly)
├── js/simulation.js    the simulation engine
├── js/optimiser.js     tests every way to add extra resources
├── js/app.js           reads the form, draws results and charts
├── js/solution.js      the "Find a solution" section
└── tests/run-tests.js  sanity checks (run with: node tests/run-tests.js)
```

## Sanity checks

`node tests/run-tests.js` runs 18 common-sense checks, including:
- the same seed gives identical results;
- simulated arrivals and utilisation match textbook formulas when the terminal is quiet, and Little's Law (queue length = arrival rate × wait) holds;
- adding machines to the bottleneck cuts its waiting time, and missed cutoffs don't rise;
- fixing the bottleneck moves the queue downstream;
- adding staff to an idle stage changes almost nothing;
- priority shipments miss fewer cutoffs than normal ones;
- busier days miss more cutoffs;
- the recommendation is at least as good as every option tested.
