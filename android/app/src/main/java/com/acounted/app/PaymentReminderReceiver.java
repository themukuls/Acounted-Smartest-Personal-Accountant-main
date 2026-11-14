package com.acounted.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

import org.json.JSONObject;

public class PaymentReminderReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        String id = intent == null ? null : intent.getStringExtra(PaymentNotificationHelper.EXTRA_PAYMENT_ID);
        if (id == null) return;
        PendingPaymentStore store = new PendingPaymentStore(context);
        JSONObject payment = store.get(id);
        if (payment != null) PaymentNotificationHelper.show(context, payment, true);
    }
}
