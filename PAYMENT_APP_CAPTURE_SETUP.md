# Indian payment-app capture

## What is implemented

Acounted can detect successful outgoing payment notifications on Android from:

- Paytm
- Google Pay
- PhonePe
- BHIM
- CRED
- MobiKwik
- Freecharge
- super.money

It extracts the amount, merchant/reference when present, time, and source app into an unresolved local draft. The user can tap the Acounted notification to review the existing expense form, then save, remind later, or mark it as not an expense.

The feature is opt-in and disabled by default. It does not read SMS, use Accessibility, record the screen, connect to any payment provider, or send captured data to a server. The unresolved-payment queue is stored in Android app-private storage; the final transaction is stored by Acounted's existing local ledger.

## Enable on a phone

1. Install the Android build and open Acounted.
2. Tap the bell, then **Payments**.
3. Turn on **Detect payment-app transactions** and accept Acounted notifications.
4. Read the disclosure, continue to Android settings, and enable **Acounted** under Notification Access.
5. Return to Acounted. The status should show that payment notification access is active.

After a supported app reports a successful payment, Android should show one Acounted prompt. Tapping it opens a prefilled expense form. If the form is closed or **Remind me later** is selected, Acounted schedules another local reminder after roughly four hours, avoiding late-night reminder delivery.

Multiple detections are bundled into one notification such as **“12 payments waiting for review”** instead of producing a stack of alerts. Up to 100 unresolved drafts are retained in the local Payments inbox. Saving or dismissing the latest draft advances the same notification to the next waiting payment.

## Safety rules

The parser requires all of the following before creating a draft:

- the notification package must exactly match a supported app;
- the text must explicitly indicate a successful/completed outgoing payment;
- the notification must contain a valid rupee amount;
- the text must not indicate incoming money, failure, pending status, refund/reversal, cashback, a collect request, promotion, or bill-due reminder.

Duplicate notification updates are suppressed. Captures are drafts only and never enter the ledger until the user verifies and saves them.

## Device test before release

Payment apps can change notification wording between versions, languages, and payment flows. Before every Play release, test each supported app that is advertised:

- successful QR merchant and person-to-person payments;
- failed and pending payments, which must not create drafts;
- money received, cashback, refunds/reversals, collect requests, and promotions, which must not create drafts;
- duplicate/updated notifications, which must create only one draft;
- save, remind later, not-an-expense, app restart, and phone restart;
- notification access revoked and Acounted notifications denied.

Only claim support for an app after its current production notification wording has been tested on a real phone. Additional UPI and bank apps can be added to `PaymentAppRegistry.java` with matching parser fixtures.

## Google Play release notes

- Keep the in-app prominent disclosure before sending the user to Android Notification Access settings.
- Explain the notification-listener feature accurately in the Play listing, privacy policy, and Data safety answers.
- State that the feature is optional and that extracted payment metadata stays on the device.
- Do not broaden the listener to SMS, Accessibility, screen capture, or unknown apps without a new design and disclosure review.
