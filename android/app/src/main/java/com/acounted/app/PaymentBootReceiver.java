package com.acounted.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

import org.json.JSONArray;
import org.json.JSONObject;

public class PaymentBootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || !Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) return;
        PendingPaymentStore store = new PendingPaymentStore(context);
        if (!store.isEnabled()) return;

        JSONArray pending = store.list();
        for (int i = 0; i < pending.length(); i++) {
            JSONObject payment = pending.optJSONObject(i);
            if (payment == null) continue;
            long savedTime = payment.optLong("remindAt", 0L);
            long remindAt = savedTime > System.currentTimeMillis()
                ? savedTime
                : PaymentNotificationHelper.nextReminderTime();
            PaymentNotificationHelper.scheduleReminder(context, payment.optString("id"), remindAt);
        }
    }
}
