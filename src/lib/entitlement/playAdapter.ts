/**
 * playAdapter.ts — the real Google Play Billing implementation of BillingAdapter.
 *
 * Sits behind `src/lib/entitlement/adapter.ts` and is installed at startup only
 * on the native Android build (see `src/main.tsx`). Everything above this file
 * — the state machine, the storage layer, the UI — stays pure and testable and
 * never learns that `cordova-plugin-purchase` exists.
 *
 * ── THE SAFETY PROPERTY THIS FILE EXISTS TO PROTECT ──────────────────────────
 *
 * `BillingResult` has two different kinds of "no":
 *
 *   { ok: false, reason }            → WE COULD NOT FIND OUT.
 *                                      Offline, no Play Store, plugin failed to
 *                                      initialise, a thrown error, a timeout.
 *                                      reconcile() treats this as "learned
 *                                      nothing" and changes nothing.
 *
 *   { ok: true, entitled: false }    → PLAY TOLD US there is definitively no
 *                                      entitlement. This starts the two-day
 *                                      countdown to read-only mode.
 *
 * Confusing the first for the second is how a paying subscriber on a train, in
 * a tunnel, or on a phone with a broken Play Store loses access to the app they
 * paid for. So: NEVER return `entitled: false` for an error, a timeout, an
 * uninitialised store, a pending payment, or anything else we merely failed to
 * observe. WHEN IN ANY DOUBT AT ALL, RETURN `{ ok: false }`.
 *
 * Every exit from `query()` is funnelled through a try/catch and a timeout so
 * that "in doubt" is the default, not a case we had to remember to handle.
 *
 * ── PLAY CONSOLE CONFIGURATION ───────────────────────────────────────────────
 * See PLAY_BILLING_SETUP.md at the repo root. The identifiers below MUST match
 * Play Console exactly; a typo shows up as "product not found" on device and as
 * `{ ok: false }` here (never as a lock-out, by design).
 */

import type { BillingAdapter } from './adapter';
import type { BillingResult, PlanId } from './types';

// ─────────────────────────────────────────────────────────────────────────────
// Product identifiers — these MUST match Play Console exactly.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The single subscription product in Play Console.
 *
 * ONE product, TWO base plans. Play models "annual vs monthly" as base plans of
 * the same subscription, not as separate products — which is also what makes an
 * in-app upgrade/downgrade between them possible later on.
 */
export const PLAY_SUBSCRIPTION_ID = 'acounted_pro';

/** Base plan IDs, one per PlanId. Lower-case, digits and hyphens only (Play's rule). */
export const BASE_PLAN_IDS: Readonly<Record<PlanId, string>> = {
  annual: 'annual',
  monthly: 'monthly',
};

/**
 * The 14-day free-trial offer, attached to the ANNUAL base plan only.
 *
 * Google enforces one free trial per Google account per subscription, forever.
 * Play simply does not return this offer to an ineligible account, so
 * `pickOffer()` falls through to the plain base plan and the user is charged
 * immediately — no special-casing needed here.
 */
export const ANNUAL_TRIAL_OFFER_ID = 'annual-14day-trial';

/**
 * Offer identifiers as `cordova-plugin-purchase` composes them for Google Play:
 * `productId@basePlanId` for a bare base plan, `productId@basePlanId@offerId`
 * when an offer is attached. Exported for the setup doc and for tests.
 */
export const OFFER_IDS = {
  annual: `${PLAY_SUBSCRIPTION_ID}@${BASE_PLAN_IDS.annual}`,
  monthly: `${PLAY_SUBSCRIPTION_ID}@${BASE_PLAN_IDS.monthly}`,
  annualTrial: `${PLAY_SUBSCRIPTION_ID}@${BASE_PLAN_IDS.annual}@${ANNUAL_TRIAL_OFFER_ID}`,
} as const;

/** Length of the free trial in Play Console. Used only to sanity-check inference. */
export const TRIAL_DAYS = 14;

// ─────────────────────────────────────────────────────────────────────────────
// Timeouts. A hung Play Store must degrade to "don't know", not to a hung app.
// ─────────────────────────────────────────────────────────────────────────────

/** Init + product/receipt load. Generous: a cold Play Store can be slow. */
export const INIT_TIMEOUT_MS = 15_000;
/** A whole query(), init included. */
export const QUERY_TIMEOUT_MS = 20_000;
/** A purchase includes the user reading Google's sheet and typing a password. */
export const PURCHASE_TIMEOUT_MS = 5 * 60_000;

/**
 * The timeouts actually used at runtime. Mutable so the test suite can shrink
 * them to milliseconds instead of making the timeout test wait 20 real seconds.
 * Production code never writes to this.
 */
export const billingTimeouts = {
  init: INIT_TIMEOUT_MS,
  query: QUERY_TIMEOUT_MS,
  purchase: PURCHASE_TIMEOUT_MS,
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Trial (14d) plus slack, still comfortably under a monthly period. */
const TRIAL_MAX_DAYS = 20;
/** Anything billed for longer than two months is the annual plan. */
const ANNUAL_MIN_DAYS = 60;

/** `ErrorCode.PAYMENT_CANCELLED` from the plugin (ERROR_CODES_BASE + 6). */
const ERR_PAYMENT_CANCELLED = 6777006;

// ─────────────────────────────────────────────────────────────────────────────
// Minimal structural types for the `CdvPurchase` global.
//
// Deliberately NOT imported from cordova-plugin-purchase: the plugin ships an
// ambient `declare namespace`, exists only inside the native WebView, and would
// drag a device-only module into a bun test. Structural types let the tests
// drive a plain-object fake and keep this file honest about the (small) surface
// it actually depends on.
// ─────────────────────────────────────────────────────────────────────────────

type MaybeDate = Date | number | string | undefined | null;

interface CdvPricingPhase {
  priceMicros?: number;
  billingPeriod?: string;
  /** 'PayAsYouGo' | 'UpFront' | 'FreeTrial' */
  paymentMode?: string;
}

interface CdvOffer {
  id: string;
  pricingPhases?: CdvPricingPhase[];
  canPurchase?: boolean;
}

interface CdvProduct {
  id: string;
  offers?: CdvOffer[];
}

interface CdvTransaction {
  transactionId?: string;
  /** 'initiated' | 'pending' | 'approved' | 'cancelled' | 'finished' | '' */
  state?: string;
  isPending?: boolean;
  isConsumed?: boolean;
  isAcknowledged?: boolean;
  purchaseDate?: MaybeDate;
  lastRenewalDate?: MaybeDate;
  expirationDate?: MaybeDate;
  renewalIntent?: string;
  products?: Array<{ id: string; offerId?: string }>;
  finish?: () => Promise<unknown>;
}

interface CdvVerifiedPurchase {
  id: string;
  expiryDate?: number;
  isExpired?: boolean;
  isTrialPeriod?: boolean;
  /** Corresponds to the offer id the purchase was made on. */
  discountId?: string;
}

interface CdvError {
  isError?: true;
  code?: number;
  message?: string;
}

interface CdvWhen {
  approved?: (cb: (t: CdvTransaction) => void) => CdvWhen;
  [k: string]: unknown;
}

interface CdvStore {
  register: (products: unknown) => void;
  initialize: (platforms?: unknown[]) => Promise<CdvError[] | undefined>;
  update?: () => Promise<unknown>;
  get: (productId: string, platform?: string) => CdvProduct | undefined;
  order: (offer: CdvOffer, additionalData?: unknown) => Promise<CdvError | undefined>;
  manageSubscriptions?: (platform?: string) => Promise<CdvError | undefined>;
  restorePurchases?: () => Promise<CdvError | undefined>;
  when?: () => CdvWhen;
  localTransactions?: CdvTransaction[];
  verifiedPurchases?: CdvVerifiedPurchase[];
  verbosity?: unknown;
}

interface CdvPurchaseGlobal {
  store?: CdvStore;
  Platform?: Record<string, string>;
  ProductType?: Record<string, string>;
  TransactionState?: Record<string, string>;
  ErrorCode?: Record<string, number | string>;
  LogLevel?: Record<string, number | string>;
}

/** The plugin only ever exists inside the native WebView. Absent ⇒ web/dev/tests. */
function getCdv(): CdvPurchaseGlobal | null {
  try {
    const g = (globalThis as unknown as { CdvPurchase?: CdvPurchaseGlobal }).CdvPurchase;
    return g && typeof g === 'object' ? g : null;
  } catch {
    return null;
  }
}

function getStore(cdv: CdvPurchaseGlobal | null): CdvStore | null {
  const store = cdv?.store;
  return store && typeof store.initialize === 'function' && typeof store.get === 'function'
    ? store
    : null;
}

const GOOGLE_PLAY = 'android-playstore';
const PAID_SUBSCRIPTION = 'paid subscription';

function platformId(cdv: CdvPurchaseGlobal): string {
  return cdv.Platform?.GOOGLE_PLAY ?? GOOGLE_PLAY;
}

function subscriptionType(cdv: CdvPurchaseGlobal): string {
  return cdv.ProductType?.PAID_SUBSCRIPTION ?? PAID_SUBSCRIPTION;
}

// ─────────────────────────────────────────────────────────────────────────────
// Small helpers
// ─────────────────────────────────────────────────────────────────────────────

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message || err.name;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err) ?? 'unknown error';
  } catch {
    return 'unknown error';
  }
}

function isCdvError(v: unknown): v is CdvError {
  return !!v && typeof v === 'object' && ('isError' in v || 'code' in v || 'message' in v);
}

/** Coerce the plugin's Date-ish fields (Date on device, number in fixtures). */
function toMillis(v: MaybeDate): number | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) {
    const t = v.getTime();
    return Number.isFinite(t) ? t : null;
  }
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

/**
 * Race a promise against a timer, RESOLVING to `fallback` if the timer wins.
 *
 * A timeout resolves rather than rejects because it is an expected outcome here
 * (a Play Store that never answers is Tuesday). Genuine rejections are left to
 * propagate so the caller's catch can name the actual error rather than
 * reporting every failure as a timeout — either way the caller turns it into
 * `{ ok: false }`.
 */
export function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(fallback);
    }, ms);
    // Don't hold the process open in Node/bun for a timer nobody is waiting on.
    (timer as unknown as { unref?: () => void }).unref?.();

    p.then(
      (v) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(v);
      },
      (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

const UNKNOWN = (reason: string): BillingResult => ({ ok: false, reason });

// ─────────────────────────────────────────────────────────────────────────────
// Initialisation — once per app run, retried after a failure.
// ─────────────────────────────────────────────────────────────────────────────

let initPromise: Promise<BillingResult | null> | null = null;
/**
 * The plan the user most recently ordered in this session. Only ever used as a
 * LAST-RESORT hint for labelling `plan`, never to decide entitlement.
 */
let lastOrderedPlan: PlanId | null = null;

/** Test-only: forget initialisation state between cases. */
export function __resetPlayAdapterForTests(): void {
  initPromise = null;
  lastOrderedPlan = null;
}

/**
 * Initialise the store exactly once. Resolves to `null` on success, or to a
 * `{ ok:false }` BillingResult describing why we could not get going.
 */
function ensureInit(): Promise<BillingResult | null> {
  if (initPromise) return initPromise;

  const pending = (async (): Promise<BillingResult | null> => {
    const cdv = getCdv();
    const store = getStore(cdv);
    if (!cdv || !store) {
      return UNKNOWN('Play Billing plugin is not present on this platform.');
    }

    store.register([
      {
        id: PLAY_SUBSCRIPTION_ID,
        type: subscriptionType(cdv),
        platform: platformId(cdv),
      },
    ]);

    // Acknowledge approved purchases. Google AUTO-REFUNDS any subscription that
    // is not acknowledged within three days, so this is not optional even
    // though we do no server-side receipt validation. Registered before
    // initialize() so the very first receipt load is covered.
    try {
      store.when?.().approved?.((t) => {
        void t.finish?.();
      });
    } catch {
      /* a plugin without when() still bills correctly; don't fail init over it */
    }

    const TIMED_OUT = Symbol('init-timeout');
    const errors = await withTimeout<CdvError[] | undefined | typeof TIMED_OUT>(
      store.initialize([platformId(cdv)]),
      billingTimeouts.init,
      TIMED_OUT,
    );
    if (errors === TIMED_OUT) {
      return UNKNOWN(`Play Billing did not initialise within ${billingTimeouts.init}ms.`);
    }
    if (Array.isArray(errors) && errors.length > 0) {
      const first = errors[0];
      return UNKNOWN(`Play Billing initialisation failed: ${first?.message ?? 'unknown error'}`);
    }
    return null;
  })().catch((err) => UNKNOWN(`Play Billing initialisation threw: ${describeError(err)}`));

  initPromise = pending;

  // A failed init must be retryable — the usual cause is "no network at launch",
  // and the user should not have to restart the app after landing.
  void pending.then((result) => {
    if (result !== null && initPromise === pending) initPromise = null;
  });

  return pending;
}

// ─────────────────────────────────────────────────────────────────────────────
// Reading the store
// ─────────────────────────────────────────────────────────────────────────────

/** Split `product@basePlan[@offer]` into its parts. */
function offerParts(offerId: string): { productId: string; basePlanId?: string; offerId?: string } {
  const [productId, basePlanId, offer] = offerId.split('@');
  return { productId, basePlanId, offerId: offer };
}

function isFreeTrialOffer(offer: CdvOffer): boolean {
  return (offer.pricingPhases ?? []).some(
    (p) => p.paymentMode === 'FreeTrial' || p.priceMicros === 0,
  );
}

/**
 * Pick the offer to order for a plan.
 *
 * Prefers an offer carrying a free-trial pricing phase. Play only returns
 * offers the account is ELIGIBLE for, so an account that has already used its
 * one lifetime free trial simply won't see the trial offer and lands on the
 * plain base plan — which is exactly the behaviour we want.
 */
export function pickOffer(product: CdvProduct | undefined, plan: PlanId): CdvOffer | undefined {
  const basePlan = BASE_PLAN_IDS[plan];
  const candidates = (product?.offers ?? []).filter(
    (o) => offerParts(o.id).basePlanId === basePlan,
  );
  if (candidates.length === 0) return undefined;
  return candidates.find(isFreeTrialOffer) ?? candidates[0];
}

/** Latest transaction mentioning our subscription, by most recent activity. */
function findTransaction(store: CdvStore): CdvTransaction | undefined {
  const all = Array.isArray(store.localTransactions) ? store.localTransactions : [];
  const mine = all.filter((t) =>
    (t?.products ?? []).some((p) => p?.id === PLAY_SUBSCRIPTION_ID),
  );
  if (mine.length === 0) return undefined;

  const rank = (t: CdvTransaction) =>
    toMillis(t.lastRenewalDate) ?? toMillis(t.purchaseDate) ?? toMillis(t.expirationDate) ?? 0;

  return mine.reduce((best, t) => (rank(t) >= rank(best) ? t : best), mine[0]);
}

function findVerifiedPurchase(store: CdvStore): CdvVerifiedPurchase | undefined {
  const all = Array.isArray(store.verifiedPurchases) ? store.verifiedPurchases : [];
  return all.find((p) => p?.id === PLAY_SUBSCRIPTION_ID);
}

/**
 * Which base plan is this? Google Play's `Purchase` object carries product IDs
 * but NOT the base plan, so this is inference, in descending order of trust:
 *
 *  1. A validated receipt's `discountId` (only present with a receipt validator).
 *  2. The trial: the 14-day trial offer exists ONLY on the annual base plan, so
 *     a trialing subscription is annual by construction.
 *  3. Period length: > 60 days billed ⇒ annual.
 *  4. The plan ordered in this session.
 *  5. 'monthly' — the conservative label; never claim someone bought the pricier
 *     plan on a guess.
 *
 * This only affects the plan LABEL. Entitlement itself never depends on it.
 */
function inferPlan(
  verified: CdvVerifiedPurchase | undefined,
  periodMs: number | null,
  trialing: boolean,
): PlanId {
  const discount = verified?.discountId;
  if (discount) {
    const basePlan = discount.includes('@') ? offerParts(discount).basePlanId : discount;
    if (basePlan === BASE_PLAN_IDS.annual || discount.includes(BASE_PLAN_IDS.annual)) return 'annual';
    if (basePlan === BASE_PLAN_IDS.monthly || discount.includes(BASE_PLAN_IDS.monthly)) return 'monthly';
  }
  if (trialing) return 'annual';
  if (periodMs !== null && periodMs >= ANNUAL_MIN_DAYS * DAY_MS) return 'annual';
  return lastOrderedPlan ?? 'monthly';
}

/**
 * Is this the free-trial period? Same problem as the plan: Play's local
 * `Purchase` doesn't say. Trust a validated receipt when there is one, then
 * fall back to "this is the FIRST period and it is far too short to be a paid
 * one" — a 14-day window against a 1-month floor for any paid plan.
 */
function inferTrialing(
  verified: CdvVerifiedPurchase | undefined,
  tx: CdvTransaction,
  periodMs: number | null,
): boolean {
  if (typeof verified?.isTrialPeriod === 'boolean') return verified.isTrialPeriod;
  const renewed = toMillis(tx.lastRenewalDate);
  const purchased = toMillis(tx.purchaseDate);
  const isFirstPeriod = renewed === null || purchased === null || renewed <= purchased;
  if (!isFirstPeriod) return false;
  return periodMs !== null && periodMs > 0 && periodMs <= TRIAL_MAX_DAYS * DAY_MS;
}

/**
 * Turn what the store knows into a BillingResult.
 *
 * Exported so the tests can drive it directly, but every caller goes through
 * `query()`, which is the thing that guarantees nothing escapes.
 */
export function interpret(store: CdvStore, now: number): BillingResult {
  // No catalogue ⇒ products never loaded ⇒ we know nothing. Emphatically NOT
  // "not entitled": a paying user whose product list failed to load is still
  // paying.
  const product = store.get(PLAY_SUBSCRIPTION_ID, GOOGLE_PLAY);
  if (!product) {
    return UNKNOWN(`Play has not loaded product "${PLAY_SUBSCRIPTION_ID}" yet.`);
  }

  const tx = findTransaction(store);
  const verified = findVerifiedPurchase(store);

  if (!tx) {
    // Play loaded the catalogue and reported no purchase for this product.
    // That is a real answer: the account owns nothing.
    if (verified && verified.isExpired === false) {
      // A validated receipt still says active — trust the stronger signal.
      const expiresAt = verified.expiryDate ?? null;
      if (expiresAt === null || expiresAt > now) {
        return {
          ok: true,
          entitled: true,
          plan: inferPlan(verified, null, verified.isTrialPeriod === true),
          trialing: verified.isTrialPeriod === true,
          expiresAt,
        };
      }
    }
    return { ok: true, entitled: false };
  }

  // Payment in flight (slow card, "pending" purchase). Play has not decided,
  // so neither do we.
  if (tx.isPending === true || tx.state === 'pending') {
    return UNKNOWN('A Play purchase is pending payment; entitlement is undecided.');
  }

  // Purchase started but not completed — indeterminate, not a negative.
  if (tx.state === 'initiated' || tx.state === '' || tx.state === undefined) {
    return UNKNOWN(`Play transaction is in an indeterminate state ("${tx.state ?? 'unset'}").`);
  }

  const expiresAt = toMillis(tx.expirationDate) ?? verified?.expiryDate ?? null;

  // Definitively over: cancelled, consumed, or past its expiry.
  if (tx.state === 'cancelled' || tx.isConsumed === true) {
    return { ok: true, entitled: false };
  }
  if (verified?.isExpired === true) {
    return { ok: true, entitled: false };
  }
  if (expiresAt !== null && expiresAt <= now) {
    return { ok: true, entitled: false };
  }

  if (tx.state !== 'approved' && tx.state !== 'finished') {
    return UNKNOWN(`Unrecognised Play transaction state "${tx.state}".`);
  }

  const start = toMillis(tx.lastRenewalDate) ?? toMillis(tx.purchaseDate);
  const periodMs = expiresAt !== null && start !== null ? expiresAt - start : null;
  const trialing = inferTrialing(verified, tx, periodMs);

  return {
    ok: true,
    entitled: true,
    plan: inferPlan(verified, periodMs, trialing),
    trialing,
    expiresAt,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// The adapter
// ─────────────────────────────────────────────────────────────────────────────

async function queryInner(now: number): Promise<BillingResult> {
  const init = await ensureInit();
  if (init) return init; // already an { ok:false } explaining itself

  const store = getStore(getCdv());
  if (!store) return UNKNOWN('Play Billing plugin disappeared after initialisation.');

  // Refresh products and receipts before reading. If the refresh fails we stop
  // here rather than interpreting stale data — stale data could read as
  // "nothing owned" for someone who owns something.
  if (typeof store.update === 'function') {
    await store.update();
  }

  return interpret(store, now);
}

export const playAdapter: BillingAdapter = {
  /**
   * The Cordova plugin's JS is only injected inside the native WebView, so the
   * absence of the global IS the web check. No `isNative()` import here on
   * purpose: it keeps this module free of Capacitor so the tests can run it.
   */
  async available(): Promise<boolean> {
    return getStore(getCdv()) !== null;
  },

  /**
   * ── THE GUARANTEE ────────────────────────────────────────────────────────
   * Every failure mode leaves this function as `{ ok: false }` and never as
   * `{ ok: true, entitled: false }`:
   *
   *   • no plugin / no Play Store  → ensureInit() returns { ok:false }
   *   • initialize() reported errors → ensureInit() returns { ok:false }
   *   • anything THREW anywhere      → the catch below → { ok:false }
   *   • anything HUNG                → withTimeout's fallback → { ok:false }
   *
   * `{ ok:false }` means "we could not find out" and reconcile() changes
   * nothing. `entitled:false` means "Play told us there is definitively no
   * subscription" and starts the countdown to read-only mode. Returning the
   * second when we mean the first is how a paying user on a train loses the
   * app they paid for. WHEN IN ANY DOUBT, RETURN `{ ok: false }`.
   */
  async query(): Promise<BillingResult> {
    try {
      return await withTimeout(
        queryInner(Date.now()),
        billingTimeouts.query,
        UNKNOWN(`Play Billing did not answer within ${billingTimeouts.query}ms.`),
      );
    } catch (err) {
      return UNKNOWN(`Play Billing query failed: ${describeError(err)}`);
    }
  },

  /**
   * Launch Google's purchase sheet, then report the resulting state.
   *
   * A cancelled or failed purchase is `{ ok:false }`, never `entitled:false` —
   * "the user backed out of the sheet" says nothing about what they already own.
   */
  async purchase(plan: PlanId): Promise<BillingResult> {
    try {
      return await withTimeout(
        (async (): Promise<BillingResult> => {
          const init = await ensureInit();
          if (init) return init;

          const cdv = getCdv();
          const store = getStore(cdv);
          if (!cdv || !store) return UNKNOWN('Play Billing plugin is not available.');

          const product = store.get(PLAY_SUBSCRIPTION_ID, platformId(cdv));
          const offer = pickOffer(product, plan);
          if (!offer) {
            return UNKNOWN(
              `No Play offer for base plan "${BASE_PLAN_IDS[plan]}" of "${PLAY_SUBSCRIPTION_ID}".`,
            );
          }

          lastOrderedPlan = plan;

          const err = await store.order(offer);
          if (isCdvError(err)) {
            const cancelled =
              err.code === ERR_PAYMENT_CANCELLED ||
              err.code === Number(cdv.ErrorCode?.PAYMENT_CANCELLED);
            return UNKNOWN(
              cancelled
                ? 'Purchase cancelled.'
                : `Play could not complete the purchase: ${err.message ?? 'unknown error'}`,
            );
          }

          // Order accepted. Re-read the store so the caller gets the real new
          // state (including the trial expiry) rather than an optimistic guess.
          return await queryInner(Date.now());
        })(),
        billingTimeouts.purchase,
        UNKNOWN('The Play purchase flow did not complete in time.'),
      );
    } catch (err) {
      return UNKNOWN(`Play purchase failed: ${describeError(err)}`);
    }
  },

  /** Deep-link to Play's subscription management. Best effort; never throws. */
  async openManage(): Promise<void> {
    try {
      const cdv = getCdv();
      const store = getStore(cdv);
      if (!cdv || !store || typeof store.manageSubscriptions !== 'function') return;
      await ensureInit();
      await store.manageSubscriptions(platformId(cdv));
    } catch (err) {
      console.warn('[billing] Could not open Play subscription management', err);
    }
  },
};

export default playAdapter;
