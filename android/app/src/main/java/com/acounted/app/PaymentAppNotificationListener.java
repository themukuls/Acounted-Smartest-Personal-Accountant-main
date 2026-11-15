package com.acounted.app;

import android.app.Notification;
import android.os.Bundle;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;

import org.json.JSONObject;

public class PaymentAppNotificationListener extends NotificationListenerService {
    @Override
    public void onNotificationPosted(StatusBarNotification notification) {
        PendingPaymentStore store = new PendingPaymentStore(this);
        if (notification == null) return;
        boolean supportedPaymentApp = PaymentAppRegistry.supports(notification.getPackageName());

        Notification value = notification.getNotification();
        Bundle extras = value == null ? null : value.extras;
        if (extras == null) return;

        String title = asString(extras.getCharSequence(Notification.EXTRA_TITLE));
        StringBuilder body = new StringBuilder();
        append(body, extras.getCharSequence(Notification.EXTRA_TEXT));
        append(body, extras.getCharSequence(Notification.EXTRA_BIG_TEXT));
        append(body, extras.getCharSequence(Notification.EXTRA_SUB_TEXT));
        CharSequence[] lines = extras.getCharSequenceArray(Notification.EXTRA_TEXT_LINES);
        if (lines != null) for (CharSequence line : lines) append(body, line);

        PaymentNotificationParser.ParsedPayment parsed = PaymentNotificationParser.parse(
            notification.getPackageName(), title, body.toString(), notification.getPostTime()
        );
        if (parsed == null) {
            // Do not let unrelated apps overwrite useful diagnostics; for the
            // known payment apps, an ignored event is actionable information.
            if (supportedPaymentApp) store.recordEvent("App notification", "Ignored: payment wording not recognised");
            return;
        }

        JSONObject pending = store.add(parsed);
        if (pending == null) {
            store.recordEvent("App notification", "Ignored: duplicate payment");
            return;
        }
        store.recordEvent("App notification", "Captured payment");
        PaymentNotificationHelper.show(this, pending, false);
        long remindAt = PaymentNotificationHelper.nextReminderTime();
        store.snooze(pending.optString("id"), remindAt);
        PaymentNotificationHelper.scheduleReminder(this, pending.optString("id"), remindAt);
    }

    private static String asString(CharSequence value) {
        return value == null ? "" : value.toString();
    }

    private static void append(StringBuilder builder, CharSequence value) {
        if (value == null || value.length() == 0) return;
        if (builder.length() > 0) builder.append('\n');
        builder.append(value);
    }
}
