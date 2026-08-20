# Google Play subscription setup for Acounted

The Android client is configured for one subscription product with two base plans:

| Play Console field | Required value |
| --- | --- |
| Android application ID | `com.acounted.app` |
| Subscription product ID | `acounted_pro` |
| Yearly base plan ID | `annual` |
| Monthly base plan ID | `monthly` |
| Yearly free-trial offer ID | `annual-7day-trial` |

These identifiers are also defined in `src/lib/entitlement/playAdapter.ts`. They must match exactly. Activated product and offer IDs cannot be reused casually, so verify them before activation.

## 1. Prepare the Play Console app

1. Open the existing Acounted app in Google Play Console. Do not create a second app: the package must remain `com.acounted.app`.
2. Complete the merchant/payment profile and all required app-content declarations.
3. Upload a signed Android App Bundle to **Testing → Internal testing**. Play Billing product discovery is most reliable when the app was installed from its Play testing link, not sideloaded.
4. Add each test Google account to both the internal testing track and **Settings → License testing**.
5. Increment `versionCode` in `android/app/build.gradle` for every uploaded bundle. It is currently `1` and must be changed before the next upload if version 1 has already been used.

## 2. Create the subscription

In **Monetize with Play → Products → Subscriptions**:

1. Create a subscription with product ID `acounted_pro` and the customer-facing name **Acounted Pro**.
2. Add an auto-renewing base plan with ID `annual`, a one-year billing period, and the intended annual price (currently planned as ₹799 in India).
3. Add an auto-renewing base plan with ID `monthly`, a one-month billing period, and the intended monthly price (currently planned as ₹99 in India).
4. Configure prices for every country where the app will be available. The app does not hard-code these prices; it displays the localized price returned by Google Play.
5. Activate both base plans.

Official reference: [Create and manage subscriptions](https://support.google.com/googleplay/android-developer/answer/140504).

## 3. Add the seven-day Play trial

On the `annual` base plan:

1. Create an offer with ID `annual-7day-trial`.
2. Select the new-customer acquisition eligibility option. Restrict it to customers who have never had this subscription, unless the business intentionally wants a broader offer.
3. Add a free phase of **7 days**, followed by the normal annual base-plan price.
4. Select the same regions as the annual base plan and activate the offer.

Google Play returns only offers for which the current account is eligible. The app therefore shows “7-day Play trial” only when Play actually returns that trial; an ineligible user sees the regular annual price instead. Google requires a valid Play payment method for this Play-managed trial. [Subscription offers and eligibility](https://support.google.com/googleplay/android-developer/answer/12154973).

## 4. How the in-app interaction works

For a new user, onboarding now shows the app's value before the payment decision:

1. The user sees the trust/value screens and one personalized result.
2. The app loads eligible plans and localized prices directly from Google Play.
3. The main action starts the selected Play purchase or eligible Play trial.
4. If the user closes/cancels Google's purchase sheet, nothing is charged and the screen remains open.
5. The secondary action starts a one-time **7-day trial without a payment method**.
6. Existing purchasers can use **Restore an existing purchase**.

The local no-card trial is stored in Android app-private Preferences, outside financial-data exports. It never auto-renews and ends exactly seven days after it starts. Because the app deliberately has no account server, clearing app data or reinstalling can clear this local trial marker. Preventing reinstall-based repeat trials requires a small backend tied to an account or Play identity; it cannot be enforced securely with phone-only storage.

## 5. Build and upload

From the repository root:

```powershell
npm run build
npx cap sync android
cd android
.\gradlew.bat bundleRelease
```

The bundle will normally be created under `android/app/build/outputs/bundle/release/`. Configure release signing securely through Gradle/local environment settings; do not commit a keystore or passwords.

The project uses `cordova-plugin-purchase`. Approved purchases are finished/acknowledged by the client. Google requires purchases to be acknowledged promptly; for stronger fraud resistance and more reliable cross-device entitlement, production should later add server-side purchase-token verification and Real-time Developer Notifications. [Google Play Billing integration guide](https://developer.android.com/google/play/billing/integrate).

## 6. Required device tests before production

Use builds installed from the internal Play testing link and test all of these:

- A new eligible account sees the 7-day annual Play trial and exact localized prices.
- An account that already used the offer sees no trial promise and is charged immediately only after Play confirmation.
- Cancelling the purchase sheet shows “Purchase cancelled,” charges nothing, and leaves the no-card trial available.
- The no-card trial survives app restarts, works offline, does not invoke Play, and becomes read-only after seven days.
- A pending payment does not unlock access and does not incorrectly mark the user as unsubscribed.
- Restore unlocks an active subscription on a reinstall or second device using the purchasing Google account.
- Cancelling in Play keeps access until the displayed period/trial end date.
- Launching offline never removes a previously confirmed paid entitlement; reading and exporting financial records remain available after access ends.
- Monthly purchase, annual purchase, renewal, grace/payment retry, expiry, refund/revocation, and account switching all behave correctly.

Google's subscription policy requires the trial duration, conversion price, billing frequency, auto-renewal, and cancellation route to be clear before purchase. The paywall now obtains price/eligibility from Play and shows those disclosures beside the purchase action. [Google Play subscriptions policy](https://support.google.com/googleplay/android-developer/answer/9900533) and [subscription lifecycle guidance](https://developer.android.com/google/play/billing/subscriptions).
