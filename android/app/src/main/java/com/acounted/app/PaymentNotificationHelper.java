package com.acounted.app;

import android.Manifest;
import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

import org.json.JSONObject;
import org.json.JSONArray;

import java.math.BigDecimal;
import java.text.NumberFormat;
import java.util.Calendar;
import java.util.Locale;

final class PaymentNotificationHelper {
    static final String EXTRA_PAYMENT_ID = "acounted_payment_id";
    private static final String CHANNEL_ID = "acounted_payment_capture";
    private static final int INBOX_NOTIFICATION_ID = 42001;

    private PaymentNotificationHelper() {}

    static void show(Context context, JSONObject payment, boolean reminder) {
        if (!canNotify(context)) return;
        createChannel(context);

        JSONArray allPending = new PendingPaymentStore(context).list();
        int count = Math.max(1, allPending.length());
        JSONObject latest = allPending.optJSONObject(0);
        if (latest == null) latest = payment;

        String id = latest.optString("id");
        String amount = formatAmount(latest.optString("amount"));
        String merchant = latest.optString("merchant", "").trim();
        String appName = latest.optString("appName", "payment app");
        String title;
        String body;
        if (count > 1) {
            title = count + " payments waiting for review";
            body = merchant.isEmpty()
                ? amount + " with " + appName + " is the latest. Tap to review."
                : amount + " to " + merchant + " is the latest. Tap to review.";
        } else {
            title = reminder ? "Still need to categorise " + amount + "?" : amount + " paid with " + appName;
            body = merchant.isEmpty()
                ? "Tap to add its category and payment details."
                : "Tap to add the payment to " + merchant + ".";
        }

        Intent launch = new Intent(context, MainActivity.class)
            .putExtra(EXTRA_PAYMENT_ID, id)
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent contentIntent = PendingIntent.getActivity(
            context,
            INBOX_NOTIFICATION_ID,
            launch,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(com.acounted.app.R.drawable.ic_stat_name)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setAutoCancel(true)
            .setOnlyAlertOnce(true)
            .setNumber(count)
            .setContentIntent(contentIntent);

        NotificationManagerCompat.from(context).notify(INBOX_NOTIFICATION_ID, builder.build());
    }

    static long nextReminderTime() {
        Calendar target = Calendar.getInstance();
        target.setTimeInMillis(System.currentTimeMillis() + 4L * 60L * 60L * 1000L);
        int hour = target.get(Calendar.HOUR_OF_DAY);
        if (hour >= 21) {
            target.add(Calendar.DAY_OF_MONTH, 1);
            target.set(Calendar.HOUR_OF_DAY, 9);
            target.set(Calendar.MINUTE, 0);
            target.set(Calendar.SECOND, 0);
        } else if (hour < 8) {
            target.set(Calendar.HOUR_OF_DAY, 9);
            target.set(Calendar.MINUTE, 0);
            target.set(Calendar.SECOND, 0);
        }
        return target.getTimeInMillis();
    }

    static void scheduleReminder(Context context, String id, long when) {
        Intent intent = new Intent(context, PaymentReminderReceiver.class).putExtra(EXTRA_PAYMENT_ID, id);
        PendingIntent pending = PendingIntent.getBroadcast(
            context,
            id.hashCode(),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarms != null) alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, when, pending);
    }

    static void cancel(Context context, String id) {
        Intent intent = new Intent(context, PaymentReminderReceiver.class);
        PendingIntent pending = PendingIntent.getBroadcast(
            context,
            id.hashCode(),
            intent,
            PendingIntent.FLAG_NO_CREATE | PendingIntent.FLAG_IMMUTABLE
        );
        AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (pending != null && alarms != null) alarms.cancel(pending);

        JSONArray remaining = new PendingPaymentStore(context).list();
        JSONObject latest = remaining.optJSONObject(0);
        if (latest == null) NotificationManagerCompat.from(context).cancel(INBOX_NOTIFICATION_ID);
        else show(context, latest, false);
    }

    static void cancelAll(Context context) {
        NotificationManagerCompat.from(context).cancel(INBOX_NOTIFICATION_ID);
    }

    private static boolean canNotify(Context context) {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
    }

    private static void createChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) return;
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            "Detected payments",
            NotificationManager.IMPORTANCE_HIGH
        );
        channel.setDescription("Local reminders to categorise detected app payments");
        manager.createNotificationChannel(channel);
    }

    private static String formatAmount(String raw) {
        try {
            NumberFormat formatter = NumberFormat.getCurrencyInstance(new Locale("en", "IN"));
            formatter.setMaximumFractionDigits(2);
            return formatter.format(new BigDecimal(raw));
        } catch (Exception ignored) {
            return "₹" + raw;
        }
    }
}
