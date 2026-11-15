package com.acounted.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.provider.Telephony;
import android.telephony.SmsMessage;

import org.json.JSONObject;

/** Receives new SMS messages and immediately discards anything non-financial. */
public class PaymentSmsReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || !Telephony.Sms.Intents.SMS_RECEIVED_ACTION.equals(intent.getAction())) return;

        SmsMessage[] messages = Telephony.Sms.Intents.getMessagesFromIntent(intent);
        if (messages == null || messages.length == 0) return;

        String sender = messages[0].getOriginatingAddress();
        StringBuilder body = new StringBuilder();
        long receivedAt = System.currentTimeMillis();
        for (SmsMessage message : messages) {
            if (message == null) continue;
            if (message.getMessageBody() != null) body.append(message.getMessageBody());
            if (message.getTimestampMillis() > 0) receivedAt = message.getTimestampMillis();
        }

        PendingPaymentStore store = new PendingPaymentStore(context);
        PaymentNotificationParser.ParsedPayment parsed = PaymentNotificationParser.parseSms(
            sender, body.toString(), receivedAt
        );
        if (parsed == null) {
            store.recordEvent("SMS", "Ignored: not an outgoing payment");
            return;
        }

        JSONObject pending = store.add(parsed);
        if (pending == null) {
            store.recordEvent("SMS", "Ignored: duplicate payment");
            return;
        }
        store.recordEvent("SMS", "Captured payment");
        PaymentNotificationHelper.show(context, pending, false);
        long remindAt = PaymentNotificationHelper.nextReminderTime();
        store.snooze(pending.optString("id"), remindAt);
        PaymentNotificationHelper.scheduleReminder(context, pending.optString("id"), remindAt);
    }
}
