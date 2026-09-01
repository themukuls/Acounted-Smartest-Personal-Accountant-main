/**
 * Master release switch for subscriptions.
 *
 * Keep this false until the Play Console product, base plans, offer and release
 * testing are ready. All billing code and the Android plugin remain packaged,
 * but the app will not initialise Play Billing, show a paywall, start a trial,
 * or gate any feature while this is false.
 *
 * Re-enable later by changing this single value to true and rebuilding/syncing
 * the Android project.
 */
export const BILLING_ENABLED = false;
