/**
 * playAdapter.test.ts — the Play Billing adapter, driven against a fake
 * `CdvPurchase` global. No device, no Play Store, no emulator.
 *
 * The bulk of these tests exist for ONE property: an adapter that cannot find
 * out must say `{ ok: false }` and must never say `{ ok: true, entitled: false }`.
 * The second one takes a paying user's app away; the first one is harmless.
 * Every failure mode the plugin can produce — missing, throwing, hanging,
 * half-initialised — gets its own case here for exactly that reason.
 */

import { describe, expect, it, beforeEach, afterEach } from 'bun:test';

import {
  ANNUAL_TRIAL_OFFER_ID,
  BASE_PLAN_IDS,
  OFFER_IDS,
  PLAY_SUBSCRIPTION_ID,
  __resetPlayAdapterForTests,
  billingTimeouts,
  pickOffer,
  playAdapter,
} from './playAdapter';

// ─────────────────────────────────────────────────────────────────────────────
// A fake CdvPurchase global
// ─────────────────────────────────────────────────────────────────────────────

const DAY = 24 * 60 * 60 * 1000;

type AnyRecord = Record<string, unknown>;

const PRODUCT = {
  id: PLAY_SUBSCRIPTION_ID,
  offers: [
    { id: OFFER_IDS.monthly, pricingPhases: [{ priceMicros: 4_990_000, paymentMode: 'PayAsYouGo' }] },
    { id: OFFER_IDS.annual, pricingPhases: [{ priceMicros: 39_990_000, paymentMode: 'PayAsYouGo' }] },
    {
      id: OFFER_IDS.annualTrial,
      pricingPhases: [
        { priceMicros: 0, paymentMode: 'FreeTrial', billingPeriod: 'P14D' },
        { priceMicros: 39_990_000, paymentMode: 'PayAsYouGo', billingPeriod: 'P1Y' },
      ],
    },
  ],
};

function makeStore(overrides: AnyRecord = {}): AnyRecord {
  return {
    register: () => undefined,
    initialize: async () => [],
    update: async () => undefined,
    get: (id: string) => (id === PLAY_SUBSCRIPTION_ID ? PRODUCT : undefined),
    order: async () => undefined,
    manageSubscriptions: async () => undefined,
    when: () => ({ approved: () => ({}) }),
    localTransactions: [] as unknown[],
    verifiedPurchases: [] as unknown[],
    ...overrides,
  };
}

function install(store: AnyRecord): void {
  (globalThis as AnyRecord).CdvPurchase = {
    store,
    Platform: { GOOGLE_PLAY: 'android-playstore' },
    ProductType: { PAID_SUBSCRIPTION: 'paid subscription' },
    TransactionState: {
      INITIATED: 'initiated',
      PENDING: 'pending',
      APPROVED: 'approved',
      CANCELLED: 'cancelled',
      FINISHED: 'finished',
    },
    ErrorCode: { PAYMENT_CANCELLED: 6777006 },
  };
}

function uninstall(): void {
  delete (globalThis as AnyRecord).CdvPurchase;
}

/** An owned subscription transaction for our product. */
function transaction(over: AnyRecord = {}): AnyRecord {
  return {
    transactionId: 'GPA.1234-5678-9012-34567',
    state: 'approved',
    isAcknowledged: true,
    products: [{ id: PLAY_SUBSCRIPTION_ID }],
    ...over,
  };
}

const defaults = { ...billingTimeouts };

beforeEach(() => {
  uninstall();
  __resetPlayAdapterForTests();
  Object.assign(billingTimeouts, defaults);
});

afterEach(() => {
  uninstall();
  __resetPlayAdapterForTests();
  Object.assign(billingTimeouts, defaults);
});

// ─────────────────────────────────────────────────────────────────────────────

describe('playAdapter — no plugin (web, dev, tests)', () => {
  it('reports unavailable when the CdvPurchase global is absent', async () => {
    expect(await playAdapter.available()).toBe(false);
  });

  it('query() resolves { ok: false } rather than claiming no entitlement', async () => {
    const result = await playAdapter.query();
    expect(result.ok).toBe(false);
    // The whole point: NOT { ok: true, entitled: false }.
    expect(result).not.toHaveProperty('entitled');
    if (!result.ok) expect(result.reason).toContain('not present');
  });

  it('purchase() and openManage() degrade quietly', async () => {
    const result = await playAdapter.purchase('annual');
    expect(result.ok).toBe(false);
    await expect(playAdapter.openManage()).resolves.toBeUndefined();
  });

  it('reports available once the plugin global exists', async () => {
    install(makeStore());
    expect(await playAdapter.available()).toBe(true);
  });

  it('a global with no usable store is still unavailable', async () => {
    (globalThis as AnyRecord).CdvPurchase = { Platform: { GOOGLE_PLAY: 'android-playstore' } };
    expect(await playAdapter.available()).toBe(false);
    const result = await playAdapter.query();
    expect(result.ok).toBe(false);
  });
});

describe('playAdapter — the plugin throws', () => {
  it('an exception from initialize() becomes { ok: false }, NOT entitled:false', async () => {
    install(
      makeStore({
        initialize: async () => {
          throw new Error('BillingClient setup failed: SERVICE_DISCONNECTED');
        },
      }),
    );

    const result = await playAdapter.query();
    expect(result.ok).toBe(false);
    expect(result).not.toHaveProperty('entitled');
    if (!result.ok) expect(result.reason).toContain('SERVICE_DISCONNECTED');
  });

  it('a synchronous throw from register() becomes { ok: false }', async () => {
    install(
      makeStore({
        register: () => {
          throw new Error('boom in register');
        },
      }),
    );

    const result = await playAdapter.query();
    expect(result.ok).toBe(false);
    expect(result).not.toHaveProperty('entitled');
  });

  it('a throw from store.get() becomes { ok: false }', async () => {
    install(
      makeStore({
        get: () => {
          throw new Error('native bridge exploded');
        },
      }),
    );

    const result = await playAdapter.query();
    expect(result.ok).toBe(false);
    expect(result).not.toHaveProperty('entitled');
    if (!result.ok) expect(result.reason).toContain('native bridge exploded');
  });

  it('a rejecting update() becomes { ok: false } instead of a stale negative', async () => {
    // The dangerous shape: the store still holds a stale (empty) receipt list,
    // so interpreting it would read as "owns nothing".
    install(
      makeStore({
        update: async () => {
          throw new Error('network unreachable');
        },
      }),
    );

    const result = await playAdapter.query();
    expect(result.ok).toBe(false);
    expect(result).not.toHaveProperty('entitled');
  });

  it('initialize() reporting errors becomes { ok: false }', async () => {
    install(
      makeStore({
        initialize: async () => [
          { isError: true, code: 6777001, message: 'Play Store app is out of date' },
        ],
      }),
    );

    const result = await playAdapter.query();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('out of date');
  });
});

describe('playAdapter — the plugin hangs', () => {
  it('an initialize() that never resolves becomes { ok: false }', async () => {
    billingTimeouts.init = 10;
    billingTimeouts.query = 500;
    install(makeStore({ initialize: () => new Promise(() => {}) }));

    const result = await playAdapter.query();
    expect(result.ok).toBe(false);
    expect(result).not.toHaveProperty('entitled');
    if (!result.ok) expect(result.reason).toContain('did not initialise');
  });

  it('an update() that never resolves becomes { ok: false }', async () => {
    billingTimeouts.query = 20;
    install(makeStore({ update: () => new Promise(() => {}) }));

    const result = await playAdapter.query();
    expect(result.ok).toBe(false);
    expect(result).not.toHaveProperty('entitled');
    if (!result.ok) expect(result.reason).toContain('did not answer');
  });

  it('a hung initialize() can be retried on the next query', async () => {
    billingTimeouts.init = 10;
    let attempt = 0;
    install(
      makeStore({
        initialize: () => {
          attempt += 1;
          return attempt === 1 ? new Promise(() => {}) : Promise.resolve([]);
        },
        localTransactions: [
          transaction({ expirationDate: new Date(Date.now() + 200 * DAY), purchaseDate: new Date(Date.now() - 100 * DAY) }),
        ],
      }),
    );

    expect((await playAdapter.query()).ok).toBe(false);
    const second = await playAdapter.query();
    expect(second).toEqual({
      ok: true,
      entitled: true,
      plan: 'annual',
      trialing: false,
      expiresAt: expect.any(Number),
    });
  });
});

describe('playAdapter — a real answer: entitled', () => {
  it('an owned trial transaction is { ok: true, entitled: true, trialing: true }', async () => {
    const now = Date.now();
    install(
      makeStore({
        localTransactions: [
          transaction({
            purchaseDate: new Date(now - 2 * DAY),
            // 14-day free trial: bought 2 days ago, 12 days left.
            expirationDate: new Date(now + 12 * DAY),
          }),
        ],
      }),
    );

    const result = await playAdapter.query();
    expect(result.ok).toBe(true);
    if (result.ok && result.entitled) {
      expect(result.entitled).toBe(true);
      expect(result.trialing).toBe(true);
      // The trial offer only exists on the annual base plan, so a trial is annual.
      expect(result.plan).toBe('annual');
      expect(result.expiresAt).toBe(now + 12 * DAY);
    } else {
      throw new Error('expected an entitled result');
    }
  });

  it('a validated receipt marked isTrialPeriod wins over the duration heuristic', async () => {
    const now = Date.now();
    install(
      makeStore({
        localTransactions: [
          transaction({
            purchaseDate: new Date(now - 1 * DAY),
            expirationDate: new Date(now + 364 * DAY),
          }),
        ],
        verifiedPurchases: [
          { id: PLAY_SUBSCRIPTION_ID, isTrialPeriod: true, isExpired: false, discountId: ANNUAL_TRIAL_OFFER_ID },
        ],
      }),
    );

    const result = await playAdapter.query();
    expect(result).toMatchObject({ ok: true, entitled: true, trialing: true, plan: 'annual' });
  });

  it('a renewed monthly subscription is active, not trialing', async () => {
    const now = Date.now();
    install(
      makeStore({
        localTransactions: [
          transaction({
            state: 'finished',
            purchaseDate: new Date(now - 200 * DAY),
            lastRenewalDate: new Date(now - 5 * DAY),
            expirationDate: new Date(now + 25 * DAY),
          }),
        ],
      }),
    );

    const result = await playAdapter.query();
    expect(result).toMatchObject({
      ok: true,
      entitled: true,
      trialing: false,
      plan: 'monthly',
      expiresAt: now + 25 * DAY,
    });
  });

  it('surfaces a null expiresAt when Play does not provide one', async () => {
    install(
      makeStore({
        localTransactions: [transaction({ purchaseDate: new Date(Date.now() - 3 * DAY) })],
      }),
    );

    const result = await playAdapter.query();
    expect(result).toMatchObject({ ok: true, entitled: true, expiresAt: null, trialing: false });
  });
});

describe('playAdapter — a real answer: not entitled', () => {
  it('an expired transaction is { ok: true, entitled: false }', async () => {
    const now = Date.now();
    install(
      makeStore({
        localTransactions: [
          transaction({
            purchaseDate: new Date(now - 400 * DAY),
            expirationDate: new Date(now - 1 * DAY),
          }),
        ],
      }),
    );

    expect(await playAdapter.query()).toEqual({ ok: true, entitled: false });
  });

  it('a known product with no transaction at all is { ok: true, entitled: false }', async () => {
    install(makeStore({ localTransactions: [] }));
    expect(await playAdapter.query()).toEqual({ ok: true, entitled: false });
  });

  it('a cancelled transaction is { ok: true, entitled: false }', async () => {
    install(makeStore({ localTransactions: [transaction({ state: 'cancelled' })] }));
    expect(await playAdapter.query()).toEqual({ ok: true, entitled: false });
  });

  it('a verified receipt flagged isExpired is { ok: true, entitled: false }', async () => {
    install(
      makeStore({
        localTransactions: [transaction({ purchaseDate: new Date(Date.now() - 40 * DAY) })],
        verifiedPurchases: [{ id: PLAY_SUBSCRIPTION_ID, isExpired: true }],
      }),
    );
    expect(await playAdapter.query()).toEqual({ ok: true, entitled: false });
  });

  it("someone else's product being owned does not entitle ours", async () => {
    install(
      makeStore({
        localTransactions: [
          transaction({ products: [{ id: 'some_other_app_product' }], expirationDate: new Date(Date.now() + 300 * DAY) }),
        ],
      }),
    );
    expect(await playAdapter.query()).toEqual({ ok: true, entitled: false });
  });
});

describe('playAdapter — states we must NOT read as a negative', () => {
  it('a product Play has not loaded yet is { ok: false }', async () => {
    install(makeStore({ get: () => undefined }));

    const result = await playAdapter.query();
    expect(result.ok).toBe(false);
    expect(result).not.toHaveProperty('entitled');
  });

  it('a pending (slow payment) transaction is { ok: false }', async () => {
    install(makeStore({ localTransactions: [transaction({ state: 'pending', isPending: true })] }));

    const result = await playAdapter.query();
    expect(result.ok).toBe(false);
    expect(result).not.toHaveProperty('entitled');
    if (!result.ok) expect(result.reason).toContain('pending');
  });

  it('an initiated-but-unfinished transaction is { ok: false }', async () => {
    install(makeStore({ localTransactions: [transaction({ state: 'initiated' })] }));

    const result = await playAdapter.query();
    expect(result.ok).toBe(false);
    expect(result).not.toHaveProperty('entitled');
  });

  it('an unrecognised transaction state is { ok: false }', async () => {
    install(makeStore({ localTransactions: [transaction({ state: 'quantum-superposition' })] }));

    const result = await playAdapter.query();
    expect(result.ok).toBe(false);
    expect(result).not.toHaveProperty('entitled');
  });
});

describe('playAdapter — offers and purchasing', () => {
  it('prefers the free-trial offer for the annual plan', () => {
    const offer = pickOffer(PRODUCT, 'annual');
    expect(offer?.id).toBe(OFFER_IDS.annualTrial);
  });

  it('picks the plain base plan for monthly', () => {
    expect(pickOffer(PRODUCT, 'monthly')?.id).toBe(OFFER_IDS.monthly);
  });

  it('falls back to the bare annual base plan when the trial offer is withheld', () => {
    // Play withholds the trial offer from an account that already used its one
    // lifetime free trial — the user is simply charged straight away.
    const noTrial = { ...PRODUCT, offers: PRODUCT.offers.filter((o) => o.id !== OFFER_IDS.annualTrial) };
    expect(pickOffer(noTrial, 'annual')?.id).toBe(OFFER_IDS.annual);
  });

  it('returns undefined when no offer matches the base plan', () => {
    expect(pickOffer({ id: PLAY_SUBSCRIPTION_ID, offers: [] }, 'annual')).toBeUndefined();
    expect(pickOffer(undefined, 'monthly')).toBeUndefined();
  });

  it('orders the chosen offer and reports the resulting entitlement', async () => {
    const now = Date.now();
    const ordered: string[] = [];
    const store = makeStore({
      order: async (offer: { id: string }) => {
        ordered.push(offer.id);
        (store.localTransactions as unknown[]).push(
          transaction({ purchaseDate: new Date(now), expirationDate: new Date(now + 14 * DAY) }),
        );
        return undefined;
      },
    });
    install(store);

    const result = await playAdapter.purchase('annual');
    expect(ordered).toEqual([OFFER_IDS.annualTrial]);
    expect(result).toMatchObject({ ok: true, entitled: true, trialing: true, plan: 'annual' });
  });

  it('a cancelled purchase is { ok: false }, never entitled:false', async () => {
    install(
      makeStore({
        order: async () => ({ isError: true, code: 6777006, message: 'Purchase flow has been cancelled' }),
      }),
    );

    const result = await playAdapter.purchase('monthly');
    expect(result.ok).toBe(false);
    expect(result).not.toHaveProperty('entitled');
    if (!result.ok) expect(result.reason).toContain('cancelled');
  });

  it('a throwing order() is { ok: false }', async () => {
    install(
      makeStore({
        order: async () => {
          throw new Error('billing flow crashed');
        },
      }),
    );

    const result = await playAdapter.purchase('annual');
    expect(result.ok).toBe(false);
    expect(result).not.toHaveProperty('entitled');
  });

  it('openManage() swallows a failing manageSubscriptions()', async () => {
    install(
      makeStore({
        manageSubscriptions: async () => {
          throw new Error('no Play Store activity');
        },
      }),
    );
    await expect(playAdapter.openManage()).resolves.toBeUndefined();
  });
});

describe('product identifiers', () => {
  it('are the ones Play Console must be configured with', () => {
    expect(PLAY_SUBSCRIPTION_ID).toBe('acounted_pro');
    expect(BASE_PLAN_IDS).toEqual({ annual: 'annual', monthly: 'monthly' });
    expect(ANNUAL_TRIAL_OFFER_ID).toBe('annual-14day-trial');
    expect(OFFER_IDS.annualTrial).toBe('acounted_pro@annual@annual-14day-trial');
  });
});
