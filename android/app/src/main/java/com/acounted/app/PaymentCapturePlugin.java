package com.acounted.app;

import android.Manifest;
import android.content.ComponentName;
import android.content.Intent;
import android.provider.Settings;

import androidx.core.app.NotificationManagerCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.PermissionState;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

@CapacitorPlugin(
    name = "PaymentCapture",
    permissions = @Permission(strings = { Manifest.permission.RECEIVE_SMS }, alias = PaymentCapturePlugin.SMS_PERMISSION)
)
public class PaymentCapturePlugin extends Plugin {
    static final String SMS_PERMISSION = "sms";

    @PluginMethod
    public void getStatus(PluginCall call) {
        PendingPaymentStore store = new PendingPaymentStore(getContext());
        JSObject result = new JSObject();
        result.put("enabled", true);
        result.put("notificationAccessGranted", hasNotificationAccess());
        result.put("notificationsGranted", NotificationManagerCompat.from(getContext()).areNotificationsEnabled());
        result.put("smsGranted", getPermissionState(SMS_PERMISSION) == PermissionState.GRANTED);
        result.put("pendingCount", store.list().length());
        result.put("lastEventAt", store.lastEventAt());
        result.put("lastEventSource", store.lastEventSource());
        result.put("lastEventResult", store.lastEventResult());
        call.resolve(result);
    }

    @PluginMethod
    public void requestSmsPermission(PluginCall call) {
        if (getPermissionState(SMS_PERMISSION) == PermissionState.GRANTED) {
            resolveSmsPermission(call);
        } else {
            requestPermissionForAlias(SMS_PERMISSION, call, "smsPermissionCallback");
        }
    }

    @PermissionCallback
    private void smsPermissionCallback(PluginCall call) {
        resolveSmsPermission(call);
    }

    private void resolveSmsPermission(PluginCall call) {
        JSObject result = new JSObject();
        result.put("granted", getPermissionState(SMS_PERMISSION) == PermissionState.GRANTED);
        call.resolve(result);
    }

    @PluginMethod
    public void setEnabled(PluginCall call) {
        PendingPaymentStore store = new PendingPaymentStore(getContext());
        store.setEnabled(true);
        JSONArray pending = store.list();
        for (int i = 0; i < pending.length(); i++) {
            JSONObject payment = pending.optJSONObject(i);
            if (payment == null) continue;
            long savedTime = payment.optLong("remindAt", 0L);
            long remindAt = savedTime > System.currentTimeMillis()
                ? savedTime
                : PaymentNotificationHelper.nextReminderTime();
            PaymentNotificationHelper.scheduleReminder(getContext(), payment.optString("id"), remindAt);
        }
        call.resolve();
    }

    @PluginMethod
    public void openNotificationAccessSettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }

    @PluginMethod
    public void listPending(PluginCall call) {
        JSONArray pending = new PendingPaymentStore(getContext()).list();
        try {
            JSObject result = new JSObject();
            result.put("payments", new JSArray(pending.toString()));
            call.resolve(result);
        } catch (JSONException error) {
            call.reject("Could not read pending payments", error);
        }
    }

    @PluginMethod
    public void getPending(PluginCall call) {
        String id = call.getString("id");
        if (id == null) {
            call.reject("Payment id is required");
            return;
        }
        JSONObject item = new PendingPaymentStore(getContext()).get(id);
        JSObject result = new JSObject();
        if (item == null) result.put("payment", JSObject.NULL);
        else {
            try {
                result.put("payment", JSObject.fromJSONObject(item));
            } catch (JSONException error) {
                call.reject("Could not read pending payment", error);
                return;
            }
        }
        call.resolve(result);
    }

    @PluginMethod
    public void complete(PluginCall call) {
        resolve(call);
    }

    @PluginMethod
    public void skip(PluginCall call) {
        resolve(call);
    }

    @PluginMethod
    public void snooze(PluginCall call) {
        String id = call.getString("id");
        if (id == null) {
            call.reject("Payment id is required");
            return;
        }
        long remindAt = PaymentNotificationHelper.nextReminderTime();
        PendingPaymentStore store = new PendingPaymentStore(getContext());
        if (!store.snooze(id, remindAt)) {
            call.reject("Payment no longer exists");
            return;
        }
        PaymentNotificationHelper.scheduleReminder(getContext(), id, remindAt);
        JSObject result = new JSObject();
        result.put("remindAt", remindAt);
        call.resolve(result);
    }

    @PluginMethod
    public void getLaunchPayment(PluginCall call) {
        Intent intent = getActivity().getIntent();
        String id = intent == null ? null : intent.getStringExtra(PaymentNotificationHelper.EXTRA_PAYMENT_ID);
        if (intent != null) intent.removeExtra(PaymentNotificationHelper.EXTRA_PAYMENT_ID);
        JSObject result = new JSObject();
        result.put("id", id == null ? JSObject.NULL : id);
        call.resolve(result);
    }

    private void resolve(PluginCall call) {
        String id = call.getString("id");
        if (id == null) {
            call.reject("Payment id is required");
            return;
        }
        new PendingPaymentStore(getContext()).resolve(id);
        PaymentNotificationHelper.cancel(getContext(), id);
        call.resolve();
    }

    private boolean hasNotificationAccess() {
        ComponentName listener = new ComponentName(getContext(), PaymentAppNotificationListener.class);
        return NotificationManagerCompat.getEnabledListenerPackages(getContext()).contains(listener.getPackageName());
    }
}
