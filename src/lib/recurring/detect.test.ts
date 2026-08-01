/**
 * detect.test.ts — correctness gate for the recurring-charge detector.
 *
 * Run with:  bun test src/lib/recurring
 *
 * The detector's job is to be *quiet when wrong*. A missed subscription costs
 * the user nothing; a fabricated one costs them trust in the whole screen. So
 * the negative cases here (two occurrences, unrelated one-offs, interleaved
 * amounts) carry as much weight as the positive ones.
 */

import { test, expect, describe } from 'bun:test';
import {
  detectRecurring,
  normaliseLabel,
  summarise,
  daysUntilNext,
  type RecurringInput,
} from './detect';

// ── Fixture helpers ──────────────────────────────────────────────────────────

let seq = 0;
const txn = (
  description: string,
  amount: number,
  isoDate: string,
  extra: Partial<RecurringInput> = {},
): RecurringInput => ({
  id: `t${++seq}`,
  amount,
  category: 'entertainment',
  description,
  transaction_date: new Date(`${isoDate}T10:00:00.000Z`).toISOString(),
  type: 'expense',
  ...extra,
});

/** A clean series: same description, same amount, same day each month. */
const monthlySeries = (
  description: string,
  amount: number,
  days: string[],
  extra: Partial<RecurringInput> = {},
): RecurringInput[] => days.map((d) => txn(description, amount, d, extra));

/**
 * Fixed "today" so recency scoring never depends on the wall clock.
 *
 * Midday UTC on purpose: `daysUntilNext` counts calendar days in local time, so
 * a midnight-UTC anchor would land on the previous day in the Americas and make
 * this suite fail depending on where it runs. Midday is the same calendar date
 * everywhere from UTC-11 to UTC+11. Fixtures are stamped 10:00Z for the same
 * reason.
 */
const NOW = new Date('2025-09-20T12:00:00.000Z');

// ── normaliseLabel ───────────────────────────────────────────────────────────

describe('normaliseLabel', () => {
  test('strips payment noise so the same merchant groups together', () => {
    expect(normaliseLabel('Paid Netflix via UPI')).toBe('netflix');
    expect(normaliseLabel('NETFLIX')).toBe('netflix');
    expect(normaliseLabel('netflix monthly plan')).toBe('netflix');
  });

  test('drops digits — reference numbers differ on every charge', () => {
    expect(normaliseLabel('NETFLIX*SUB 4471')).toBe('netflix sub');
    expect(normaliseLabel('NETFLIX*SUB 9930')).toBe('netflix sub');
  });

  test('is word-order independent', () => {
    expect(normaliseLabel('wifi broadband')).toBe(normaliseLabel('broadband wifi'));
  });

  test('empty and tag-only descriptions normalise to nothing', () => {
    expect(normaliseLabel('')).toBe('');
    expect(normaliseLabel(null)).toBe('');
    expect(normaliseLabel('<b></b>')).toBe('');
  });

  test('sanitised HTML is unwrapped, not treated as content', () => {
    expect(normaliseLabel('<b>Netflix</b>')).toBe('netflix');
  });
});

// ── The headline case ────────────────────────────────────────────────────────

describe('a clean monthly series is detected', () => {
  const input = monthlySeries('Netflix', 149, [
    '2025-04-12', '2025-05-12', '2025-06-12', '2025-07-12', '2025-08-12', '2025-09-12',
  ]);

  const [series] = detectRecurring(input, { now: NOW });

  test('finds exactly one series', () => {
    expect(detectRecurring(input, { now: NOW })).toHaveLength(1);
  });

  test('reports the right label, amount and cadence', () => {
    expect(series.label).toBe('Netflix');
    expect(series.amount).toBe(149);
    expect(series.cadence).toBe('monthly');
    expect(series.occurrences).toBe(6);
  });

  test('carries every transaction id', () => {
    expect(series.transactionIds).toHaveLength(6);
    expect(new Set(series.transactionIds).size).toBe(6);
  });

  test('lastSeen is the newest charge, nextExpected is one month on', () => {
    expect(series.lastSeen.slice(0, 10)).toBe('2025-09-12');
    expect(series.nextExpected.slice(0, 10)).toBe('2025-10-12');
  });

  test('monthly and annual cost are the numbers a user would compute by hand', () => {
    expect(series.monthlyCost).toBe(149);
    expect(series.annualCost).toBe(149 * 12);
  });

  test('a perfect series is high confidence', () => {
    expect(series.confidence).toBeGreaterThan(0.85);
  });

  test('no price change on a flat series', () => {
    expect(series.priceChange).toBeNull();
  });
});

// ── The most important negative ──────────────────────────────────────────────

describe('two occurrences are NOT a pattern', () => {
  test('two identical monthly charges produce nothing', () => {
    const input = monthlySeries('Netflix', 149, ['2025-08-12', '2025-09-12']);
    expect(detectRecurring(input, { now: NOW })).toEqual([]);
  });

  test('the third occurrence is what turns it into a pattern', () => {
    const two = monthlySeries('Netflix', 149, ['2025-07-12', '2025-08-12']);
    const three = monthlySeries('Netflix', 149, ['2025-07-12', '2025-08-12', '2025-09-12']);
    expect(detectRecurring(two, { now: NOW })).toHaveLength(0);
    expect(detectRecurring(three, { now: NOW })).toHaveLength(1);
  });

  test('minOccurrences cannot be lowered below 3', () => {
    const two = monthlySeries('Netflix', 149, ['2025-08-12', '2025-09-12']);
    expect(detectRecurring(two, { now: NOW, minOccurrences: 2 })).toHaveLength(0);
  });
});

// ── Drift tolerance ──────────────────────────────────────────────────────────

describe('±3 days of drift is tolerated', () => {
  test('billing day wobbling within 3 days still reads as monthly', () => {
    // 12th → 14th → 10th → 13th → 11th: ±2 either side of the 12th.
    const input = monthlySeries('Youtube Premium', 149, [
      '2025-05-12', '2025-06-14', '2025-07-10', '2025-08-13', '2025-09-11',
    ]);
    const found = detectRecurring(input, { now: NOW });
    expect(found).toHaveLength(1);
    expect(found[0].cadence).toBe('monthly');
    expect(found[0].occurrences).toBe(5);
  });

  test('a constant offset is absorbed, not counted as error', () => {
    // Every charge is 3 days later than the anchor implies — a systematic
    // shift, which must not eat the whole tolerance budget.
    const input = monthlySeries('Gym', 1200, [
      '2025-05-01', '2025-06-04', '2025-07-04', '2025-08-04', '2025-09-04',
    ]);
    const found = detectRecurring(input, { now: NOW });
    expect(found).toHaveLength(1);
    expect(found[0].confidence).toBeGreaterThan(0.7);
  });

  test('month-length variation (31-day vs 28-day months) is not drift', () => {
    const input = monthlySeries('Wifi', 799, [
      '2025-01-31', '2025-02-28', '2025-03-31', '2025-04-30', '2025-05-31',
    ]);
    const found = detectRecurring(input, { now: new Date('2025-06-05T00:00:00.000Z') });
    expect(found).toHaveLength(1);
    expect(found[0].cadence).toBe('monthly');
  });

  test('beyond the tolerance it is rejected', () => {
    // 12th → 22nd → 2nd: 10 days of slop, which is not a billing schedule.
    const input = monthlySeries('Random Shop', 500, ['2025-05-12', '2025-06-22', '2025-08-02']);
    expect(detectRecurring(input, { now: NOW })).toEqual([]);
  });

  test('tolerance is configurable for callers that want it looser', () => {
    const input = monthlySeries('Maid', 3000, ['2025-06-05', '2025-07-11', '2025-08-05']);
    expect(detectRecurring(input, { now: NOW })).toHaveLength(0);
    expect(detectRecurring(input, { now: NOW, dayTolerance: 7 })).toHaveLength(1);
  });
});

// ── Price rise: the single most valuable output ──────────────────────────────

describe('a price rise is flagged', () => {
  const input = [
    ...monthlySeries('Netflix', 149, ['2025-03-12', '2025-04-12', '2025-05-12']),
    ...monthlySeries('Netflix', 199, ['2025-06-12', '2025-07-12', '2025-08-12', '2025-09-12']),
  ];

  const found = detectRecurring(input, { now: NOW });

  test('stays ONE series, not two', () => {
    expect(found).toHaveLength(1);
    expect(found[0].occurrences).toBe(7);
  });

  test('reports the old price, the new price and when it changed', () => {
    const change = found[0].priceChange;
    expect(change).not.toBeNull();
    expect(change!.from).toBe(149);
    expect(change!.to).toBe(199);
    expect(change!.changedOn.slice(0, 10)).toBe('2025-06-12');
  });

  test('quantifies the rise as a percentage and as annual rupees', () => {
    const change = found[0].priceChange!;
    expect(change.pctChange).toBeCloseTo(33.557, 2);
    expect(change.annualImpact).toBe(50 * 12);
  });

  test('the current amount, not the historical one, drives the cost', () => {
    expect(found[0].amount).toBe(199);
    expect(found[0].annualCost).toBe(199 * 12);
  });

  test('a price DROP is not reported as a change — nothing to act on', () => {
    const dropped = [
      ...monthlySeries('Spotify', 199, ['2025-03-15', '2025-04-15', '2025-05-15']),
      ...monthlySeries('Spotify', 119, ['2025-06-15', '2025-07-15', '2025-08-15', '2025-09-15']),
    ];
    const series = detectRecurring(dropped, { now: NOW });
    expect(series).toHaveLength(1);
    expect(series[0].priceChange).toBeNull();
  });

  test('rounding noise under 2% is not a price rise', () => {
    const noisy = [
      txn('Wifi', 799, '2025-05-05'),
      txn('Wifi', 800, '2025-06-05'),
      txn('Wifi', 799, '2025-07-05'),
      txn('Wifi', 801, '2025-08-05'),
      txn('Wifi', 800, '2025-09-05'),
    ];
    const series = detectRecurring(noisy, { now: NOW });
    expect(series).toHaveLength(1);
    expect(series[0].priceChange).toBeNull();
  });
});

// ── Unrelated one-offs ───────────────────────────────────────────────────────

describe('unrelated one-offs produce nothing', () => {
  test('distinct merchants, distinct amounts, random dates', () => {
    const input = [
      txn('Blinkit groceries', 842, '2025-06-03', { category: 'food' }),
      txn('Uber to airport', 1240, '2025-06-11', { category: 'fuel' }),
      txn('Zomato dinner', 465, '2025-06-19', { category: 'food' }),
      txn('Decathlon shoes', 3299, '2025-07-02', { category: 'clothing' }),
      txn('Apollo pharmacy', 218, '2025-07-21', { category: 'medicine' }),
      txn('Petrol', 2000, '2025-08-09', { category: 'fuel' }),
    ];
    expect(detectRecurring(input, { now: NOW })).toEqual([]);
  });

  test('same merchant, irregular dates and wildly different amounts', () => {
    const input = [
      txn('Blinkit', 842, '2025-06-03', { category: 'food' }),
      txn('Blinkit', 219, '2025-06-08', { category: 'food' }),
      txn('Blinkit', 1560, '2025-06-27', { category: 'food' }),
      txn('Blinkit', 390, '2025-07-14', { category: 'food' }),
      txn('Blinkit', 2010, '2025-08-02', { category: 'food' }),
    ];
    expect(detectRecurring(input, { now: NOW })).toEqual([]);
  });

  test('income is never a subscription, however regular', () => {
    const salary = monthlySeries('Salary', 120000, [
      '2025-05-01', '2025-06-01', '2025-07-01', '2025-08-01', '2025-09-01',
    ], { type: 'income', category: 'income' });
    expect(detectRecurring(salary, { now: NOW })).toEqual([]);
  });

  test('an empty ledger produces an empty list, not a throw', () => {
    expect(detectRecurring([], { now: NOW })).toEqual([]);
  });

  test('malformed rows are skipped rather than poisoning a group', () => {
    const input = [
      ...monthlySeries('Netflix', 149, ['2025-06-12', '2025-07-12', '2025-08-12', '2025-09-12']),
      { id: 'bad1', amount: NaN, category: 'food', description: 'x', transaction_date: '2025-06-01' },
      { id: 'bad2', amount: 100, category: 'food', description: 'y', transaction_date: 'not-a-date' },
      { id: 'bad3', amount: -50, category: 'food', description: 'z', transaction_date: '2025-06-01' },
    ] as RecurringInput[];
    const found = detectRecurring(input, { now: NOW });
    expect(found).toHaveLength(1);
    expect(found[0].occurrences).toBe(4);
  });
});

// ── Other cadences ───────────────────────────────────────────────────────────

describe('weekly and quarterly cadences', () => {
  test('a weekly charge is detected as weekly, not monthly', () => {
    const input = ['2025-08-04', '2025-08-11', '2025-08-18', '2025-08-25', '2025-09-01', '2025-09-08']
      .map((d) => txn('Cleaning', 500, d, { category: 'household' }));
    const found = detectRecurring(input, { now: NOW });
    expect(found).toHaveLength(1);
    expect(found[0].cadence).toBe('weekly');
  });

  test('weekly cost is annualised over 52 weeks, not 48', () => {
    const input = ['2025-08-04', '2025-08-11', '2025-08-18', '2025-08-25', '2025-09-01', '2025-09-08']
      .map((d) => txn('Cleaning', 500, d, { category: 'household' }));
    const [series] = detectRecurring(input, { now: NOW });
    expect(series.annualCost).toBeCloseTo(500 * 52, 5);
  });

  test('a quarterly charge is detected as quarterly', () => {
    const input = ['2024-12-05', '2025-03-05', '2025-06-05', '2025-09-05']
      .map((d) => txn('Insurance', 6000, d, { category: 'health' }));
    const found = detectRecurring(input, { now: NOW });
    expect(found).toHaveLength(1);
    expect(found[0].cadence).toBe('quarterly');
    expect(found[0].monthlyCost).toBeCloseTo(2000, 5);
  });
});

// ── Grouping behaviour ───────────────────────────────────────────────────────

describe('grouping', () => {
  test('two different subscriptions are two series', () => {
    const input = [
      ...monthlySeries('Netflix', 149, ['2025-06-12', '2025-07-12', '2025-08-12', '2025-09-12']),
      ...monthlySeries('Rent', 25000, ['2025-06-01', '2025-07-01', '2025-08-01', '2025-09-01'], {
        category: 'rent',
      }),
    ];
    const found = detectRecurring(input, { now: NOW });
    expect(found).toHaveLength(2);
    // Sorted by annual cost, descending — rent first.
    expect(found[0].label).toBe('Rent');
    expect(found[1].label).toBe('Netflix');
  });

  test('a one-off large charge does not contaminate a subscription group', () => {
    const input = [
      ...monthlySeries('Rent', 25000, ['2025-06-01', '2025-07-01', '2025-08-01', '2025-09-01'], {
        category: 'rent',
      }),
      txn('Rent deposit', 75000, '2025-05-28', { category: 'rent' }),
    ];
    const found = detectRecurring(input, { now: NOW });
    expect(found).toHaveLength(1);
    expect(found[0].amount).toBe(25000);
    expect(found[0].occurrences).toBe(4);
  });

  test('description variants of the same merchant collapse into one series', () => {
    const input = [
      txn('Netflix', 199, '2025-06-12'),
      txn('paid netflix via upi', 199, '2025-07-12'),
      txn('NETFLIX monthly', 199, '2025-08-12'),
      txn('netflix', 199, '2025-09-12'),
    ];
    const found = detectRecurring(input, { now: NOW });
    expect(found).toHaveLength(1);
    expect(found[0].occurrences).toBe(4);
  });

  test('rows with no description fall back to the category', () => {
    const input = ['2025-06-05', '2025-07-05', '2025-08-05', '2025-09-05'].map((d) =>
      txn('', 1500, d, { category: 'emis' }),
    );
    const found = detectRecurring(input, { now: NOW });
    expect(found).toHaveLength(1);
    expect(found[0].label).toBe('EMIs');
  });
});

// ── Dismissal keys ───────────────────────────────────────────────────────────

describe('dismissal', () => {
  const input = monthlySeries('Netflix', 149, [
    '2025-06-12', '2025-07-12', '2025-08-12', '2025-09-12',
  ]);

  test('a dismissed key removes the series', () => {
    const [series] = detectRecurring(input, { now: NOW });
    const after = detectRecurring(input, { now: NOW, dismissedKeys: [series.key] });
    expect(after).toEqual([]);
  });

  test('the key survives a new charge landing', () => {
    const before = detectRecurring(input, { now: NOW })[0].key;
    const withNext = [...input, txn('Netflix', 149, '2025-10-12')];
    const after = detectRecurring(withNext, { now: new Date('2025-10-20T00:00:00.000Z') })[0].key;
    expect(after).toBe(before);
  });

  test('the key survives a price rise — dismissing is permanent', () => {
    const before = detectRecurring(input, { now: NOW })[0].key;
    const raised = [...input, txn('Netflix', 199, '2025-10-12'), txn('Netflix', 199, '2025-11-12')];
    const after = detectRecurring(raised, { now: new Date('2025-11-20T00:00:00.000Z') })[0];
    expect(after.key).toBe(before);
    expect(after.priceChange).not.toBeNull();
  });

  test('keys are unique across a realistic ledger', () => {
    const input2 = [
      ...monthlySeries('Netflix', 149, ['2025-06-12', '2025-07-12', '2025-08-12', '2025-09-12']),
      ...monthlySeries('Rent', 25000, ['2025-06-01', '2025-07-01', '2025-08-01', '2025-09-01'], { category: 'rent' }),
      ...monthlySeries('Wifi', 799, ['2025-06-07', '2025-07-07', '2025-08-07', '2025-09-07'], { category: 'recharge' }),
    ];
    const keys = detectRecurring(input2, { now: NOW }).map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

// ── Confidence behaviour ─────────────────────────────────────────────────────

describe('confidence', () => {
  test('a longer, tighter series scores higher than a short one', () => {
    const short = monthlySeries('Netflix', 149, ['2025-07-12', '2025-08-12', '2025-09-12']);
    const long = monthlySeries('Netflix', 149, [
      '2025-02-12', '2025-03-12', '2025-04-12', '2025-05-12',
      '2025-06-12', '2025-07-12', '2025-08-12', '2025-09-12',
    ]);
    const a = detectRecurring(short, { now: NOW })[0].confidence;
    const b = detectRecurring(long, { now: NOW })[0].confidence;
    expect(b).toBeGreaterThan(a);
  });

  test('a series that stopped months ago scores lower than a live one', () => {
    const live = monthlySeries('Netflix', 149, [
      '2025-06-12', '2025-07-12', '2025-08-12', '2025-09-12',
    ]);
    const stale = monthlySeries('Hotstar', 149, [
      '2024-11-12', '2024-12-12', '2025-01-12', '2025-02-12',
    ]);
    const a = detectRecurring(live, { now: NOW })[0].confidence;
    const b = detectRecurring([...stale], { now: NOW, minConfidence: 0 })[0].confidence;
    expect(b).toBeLessThan(a);
  });

  test('confidence always lands in 0..1', () => {
    const input = monthlySeries('Netflix', 149, [
      '2025-06-12', '2025-07-12', '2025-08-12', '2025-09-12',
    ]);
    for (const s of detectRecurring(input, { now: NOW, minConfidence: 0 })) {
      expect(s.confidence).toBeGreaterThanOrEqual(0);
      expect(s.confidence).toBeLessThanOrEqual(1);
    }
  });

  test('a skipped month is tolerated but costs confidence', () => {
    const complete = monthlySeries('Wifi', 799, [
      '2025-05-07', '2025-06-07', '2025-07-07', '2025-08-07', '2025-09-07',
    ]);
    const gapped = monthlySeries('Wifi', 799, [
      '2025-05-07', '2025-06-07', '2025-08-07', '2025-09-07',
    ]);
    const a = detectRecurring(complete, { now: NOW })[0];
    const b = detectRecurring(gapped, { now: NOW })[0];
    expect(b).toBeDefined();
    expect(b.confidence).toBeLessThan(a.confidence);
  });
});

// ── summarise + daysUntilNext ────────────────────────────────────────────────

describe('summarise', () => {
  const input = [
    ...monthlySeries('Netflix', 149, ['2025-06-12', '2025-07-12', '2025-08-12', '2025-09-12']),
    ...monthlySeries('Rent', 25000, ['2025-06-01', '2025-07-01', '2025-08-01', '2025-09-01'], {
      category: 'rent',
    }),
  ];
  const series = detectRecurring(input, { now: NOW });
  const summary = summarise(series, { now: NOW });

  test('monthly and annual totals add up across series', () => {
    expect(summary.monthlyTotal).toBe(25149);
    expect(summary.annualTotal).toBe(25149 * 12);
  });

  test('due-soon picks up only charges landing within the window', () => {
    // NOW = 20 Sep. Rent is next due 1 Oct (11 days), Netflix 12 Oct (22 days).
    expect(summary.dueSoon).toHaveLength(0);
    const wider = summarise(series, { now: NOW, dueSoonDays: 14 });
    expect(wider.dueSoon.map((s) => s.label)).toEqual(['Rent']);
  });

  test('price rises are collected with their combined annual impact', () => {
    const raised = detectRecurring(
      [
        ...monthlySeries('Netflix', 149, ['2025-03-12', '2025-04-12', '2025-05-12']),
        ...monthlySeries('Netflix', 199, ['2025-06-12', '2025-07-12', '2025-08-12', '2025-09-12']),
      ],
      { now: NOW },
    );
    const s = summarise(raised, { now: NOW });
    expect(s.priceRises).toHaveLength(1);
    expect(s.priceRiseAnnualImpact).toBe(600);
  });

  test('an empty series list summarises to zeroes', () => {
    const empty = summarise([], { now: NOW });
    expect(empty.monthlyTotal).toBe(0);
    expect(empty.annualTotal).toBe(0);
    expect(empty.dueSoon).toEqual([]);
    expect(empty.priceRises).toEqual([]);
  });
});

describe('daysUntilNext', () => {
  test('counts forward to the next expected charge', () => {
    const [series] = detectRecurring(
      monthlySeries('Netflix', 149, ['2025-06-12', '2025-07-12', '2025-08-12', '2025-09-12']),
      { now: NOW },
    );
    // NOW = 20 Sep, next = 12 Oct.
    expect(daysUntilNext(series, NOW)).toBe(22);
  });

  test('goes negative once the expected charge is overdue', () => {
    const [series] = detectRecurring(
      monthlySeries('Netflix', 149, ['2025-05-12', '2025-06-12', '2025-07-12']),
      { now: NOW, minConfidence: 0 },
    );
    expect(daysUntilNext(series, NOW)).toBeLessThan(0);
  });
});

// ── Realistic ledger smoke test ──────────────────────────────────────────────

describe('against a realistic 8-month ledger', () => {
  /**
   * A seeded LCG. The noise below has to be genuinely irregular — an earlier
   * version of this fixture generated "random" spending as a monotonic ramp on
   * near-identical dates, which is not noise at all: a charge that lands on the
   * 20th, 21st, 22nd… and grows by a fixed amount each month IS recurring, and
   * the detector was right to flag it. Deterministic pseudo-randomness gives
   * irregular data that is still reproducible.
   */
  const lcg = (seed: number) => {
    let s = seed;
    return () => {
      s = (s * 1103515245 + 12345) % 2147483648;
      return s / 2147483648;
    };
  };

  /**
   * Five genuine subscriptions buried in ~250 rows of ordinary spending — the
   * shape of the real data this ships against. The detector has to find all
   * five, spot the Netflix repricing, and invent nothing.
   */
  const build = (): RecurringInput[] => {
    const rows: RecurringInput[] = [];
    const months = ['02', '03', '04', '05', '06', '07', '08', '09'];
    const rand = lcg(42);
    const day = () => String(1 + Math.floor(rand() * 27)).padStart(2, '0');
    const near = (base: number) => Math.round(base * (0.55 + rand() * 0.9));

    months.forEach((m, i) => {
      // ── Genuine recurring charges ──
      rows.push(txn('Netflix', i < 4 ? 149 : 199, `2025-${m}-12`));
      rows.push(txn('Rent', 25000, `2025-${m}-01`, { category: 'rent' }));
      rows.push(txn('Airtel Wifi', 799, `2025-${m}-07`, { category: 'recharge' }));
      rows.push(txn('Bike EMI', 4820, `2025-${m}-05`, { category: 'emis' }));
      // Billing day wobbles inside the ±3 day tolerance.
      rows.push(txn('Youtube Premium', 149, `2025-${m}-${18 + (i % 3)}`));

      // ── Noise: ordinary spending, irregular in both date and amount ──
      const noise: [string, number, number, string][] = [
        ['Blinkit', 12, 700, 'food'],
        ['Zomato', 11, 420, 'food'],
        ['Petrol', 5, 1800, 'fuel'],
        ['Amazon', 6, 1400, 'others'],
        ['Chemist', 4, 260, 'medicine'],
        ['Uber', 8, 320, 'fuel'],
      ];
      for (const [name, count, base, category] of noise) {
        for (let k = 0; k < count; k++) {
          rows.push(txn(name, near(base), `2025-${m}-${day()}`, { category }));
        }
      }
    });
    return rows;
  };

  const ledger = build();
  const found = detectRecurring(ledger, { now: new Date('2025-09-25T12:00:00.000Z') });
  const labels = found.map((s) => s.label);

  test('the fixture is the size of a real ledger', () => {
    // ~450 rows over 8 months — the volume this feature actually ships against.
    expect(ledger.length).toBeGreaterThan(400);
  });

  test('finds all five real subscriptions', () => {
    expect(labels).toContain('Netflix');
    expect(labels).toContain('Rent');
    expect(labels).toContain('Airtel Wifi');
    expect(labels).toContain('Bike EMI');
    expect(labels).toContain('Youtube Premium');
  });

  test('invents nothing from the irregular spending around them', () => {
    expect(found).toHaveLength(5);
    for (const noise of ['Blinkit', 'Zomato', 'Petrol', 'Amazon', 'Chemist', 'Uber']) {
      expect(labels).not.toContain(noise);
    }
  });

  test('surfaces the Netflix price rise inside the noise', () => {
    const netflix = found.find((s) => s.label === 'Netflix')!;
    expect(netflix.priceChange).not.toBeNull();
    expect(netflix.priceChange!.from).toBe(149);
    expect(netflix.priceChange!.to).toBe(199);
  });

  test('ranks by annual cost so rent leads', () => {
    expect(found[0].label).toBe('Rent');
  });

  test('the annual total is the sum of the five, not of the ledger', () => {
    const summary = summarise(found, { now: new Date('2025-09-25T12:00:00.000Z') });
    const expectedMonthly = 199 + 25000 + 799 + 4820 + 149;
    expect(summary.monthlyTotal).toBeCloseTo(expectedMonthly, 5);
    expect(summary.annualTotal).toBeCloseTo(expectedMonthly * 12, 5);
  });
});
