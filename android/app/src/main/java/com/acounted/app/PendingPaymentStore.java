package com.acounted.app;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.UUID;

final class PendingPaymentStore {
    private static final String PREFS = "acounted_paytm_capture";
    private static final String ENABLED = "enabled";
    private static final String ITEMS = "pending_items";
    private static final String SEEN = "seen_items";
    private static final String LAST_EVENT_AT = "last_event_at";
    private static final String LAST_EVENT_SOURCE = "last_event_source";
    private static final String LAST_EVENT_RESULT = "last_event_result";
    private static final int MAX_PENDING = 100;
    private static final int MAX_SEEN = 300;

    private final SharedPreferences preferences;

    PendingPaymentStore(Context context) {
        preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    synchronized boolean isEnabled() {
        // Payment capture is an always-on app capability. Keep reading the
        // legacy preference only to migrate old installs that had it disabled.
        if (!preferences.getBoolean(ENABLED, true)) {
            preferences.edit().putBoolean(ENABLED, true).apply();
        }
        return true;
    }

    synchronized void setEnabled(boolean enabled) {
        // Retained for plugin compatibility, but capture can no longer be
        // switched off from the web layer or by a stale stored preference.
        preferences.edit().putBoolean(ENABLED, true).apply();
    }

    synchronized JSONObject add(PaymentNotificationParser.ParsedPayment payment) {
        try {
            JSONArray items = readArray(ITEMS);
            JSONArray seen = readArray(SEEN);
            if (containsDedupe(items, payment.dedupeKey) || containsDedupe(seen, payment.dedupeKey)
                    || containsLikelyDuplicate(items, payment) || containsLikelyDuplicate(seen, payment)) {
                return null;
            }

            JSONObject item = new JSONObject();
            item.put("id", UUID.randomUUID().toString());
            item.put("amount", payment.amount);
            item.put("merchant", payment.merchant == null ? JSONObject.NULL : payment.merchant);
            item.put("occurredAt", payment.occurredAt);
            item.put("reference", payment.reference == null ? JSONObject.NULL : payment.reference);
            item.put("source", payment.source);
            item.put("appName", payment.appName);
            item.put("sourcePackage", payment.sourcePackage);
            item.put("status", "pending");
            item.put("dedupeKey", payment.dedupeKey);
            item.put("createdAt", System.currentTimeMillis());

            JSONArray next = new JSONArray();
            next.put(item);
            for (int i = 0; i < items.length() && next.length() < MAX_PENDING; i++) next.put(items.get(i));
            saveArray(ITEMS, next);
            return item;
        } catch (JSONException error) {
            return null;
        }
    }

    synchronized void recordEvent(String source, String result) {
        preferences.edit()
            .putLong(LAST_EVENT_AT, System.currentTimeMillis())
            .putString(LAST_EVENT_SOURCE, source)
            .putString(LAST_EVENT_RESULT, result)
            .apply();
    }

    synchronized long lastEventAt() { return preferences.getLong(LAST_EVENT_AT, 0L); }
    synchronized String lastEventSource() { return preferences.getString(LAST_EVENT_SOURCE, ""); }
    synchronized String lastEventResult() { return preferences.getString(LAST_EVENT_RESULT, ""); }

    synchronized JSONArray list() {
        JSONArray stored = readArray(ITEMS);
        JSONArray safe = new JSONArray();
        for (int i = 0; i < stored.length(); i++) {
            JSONObject item = stored.optJSONObject(i);
            if (item == null) continue;
            JSONObject copy = publicCopy(item);
            if (copy != null) safe.put(copy);
        }
        return safe;
    }

    synchronized JSONObject get(String id) {
        JSONArray items = readArray(ITEMS);
        for (int i = 0; i < items.length(); i++) {
            JSONObject item = items.optJSONObject(i);
            if (item != null && id.equals(item.optString("id"))) return publicCopy(item);
        }
        return null;
    }

    synchronized boolean snooze(String id, long remindAt) {
        JSONArray items = readArray(ITEMS);
        for (int i = 0; i < items.length(); i++) {
            JSONObject item = items.optJSONObject(i);
            if (item != null && id.equals(item.optString("id"))) {
                try {
                    item.put("status", "later");
                    item.put("remindAt", remindAt);
                    saveArray(ITEMS, items);
                    return true;
                } catch (JSONException ignored) {
                    return false;
                }
            }
        }
        return false;
    }

    synchronized boolean resolve(String id) {
        JSONArray items = readArray(ITEMS);
        JSONArray next = new JSONArray();
        JSONObject resolved = null;
        for (int i = 0; i < items.length(); i++) {
            JSONObject item = items.optJSONObject(i);
            if (item != null && id.equals(item.optString("id"))) resolved = item;
            else if (item != null) next.put(item);
        }
        if (resolved == null) return false;

        JSONArray seen = readArray(SEEN);
        JSONArray nextSeen = new JSONArray();
        try {
            // Preserve the complete capture identity. A bank SMS can arrive
            // after the app notification was already reconciled; keeping only
            // its hash made that delayed second source look like a new payment.
            JSONObject marker = new JSONObject(resolved.toString());
            marker.put("resolvedAt", System.currentTimeMillis());
            nextSeen.put(marker);
            for (int i = 0; i < seen.length() && nextSeen.length() < MAX_SEEN; i++) nextSeen.put(seen.get(i));
        } catch (JSONException ignored) {}
        saveArray(ITEMS, next);
        saveArray(SEEN, nextSeen);
        return true;
    }

    private JSONObject publicCopy(JSONObject item) {
        try {
            JSONObject copy = new JSONObject();
            copy.put("id", item.optString("id"));
            copy.put("amount", item.optString("amount"));
            copy.put("merchant", item.isNull("merchant") ? JSONObject.NULL : item.optString("merchant"));
            copy.put("occurredAt", item.optLong("occurredAt"));
            copy.put("reference", item.isNull("reference") ? JSONObject.NULL : item.optString("reference"));
            copy.put("source", item.optString("source"));
            copy.put("appName", item.optString("appName", "Payment app"));
            copy.put("sourcePackage", item.optString("sourcePackage"));
            copy.put("status", item.optString("status", "pending"));
            if (item.has("remindAt")) copy.put("remindAt", item.optLong("remindAt"));
            return copy;
        } catch (JSONException error) {
            return null;
        }
    }

    private boolean containsDedupe(JSONArray array, String key) {
        for (int i = 0; i < array.length(); i++) {
            JSONObject item = array.optJSONObject(i);
            if (item != null && key.equals(item.optString("dedupeKey"))) return true;
        }
        return false;
    }

    private boolean containsLikelyDuplicate(JSONArray array, PaymentNotificationParser.ParsedPayment payment) {
        for (int i = 0; i < array.length(); i++) {
            JSONObject item = array.optJSONObject(i);
            if (item == null) continue;
            if (PaymentDuplicateDetector.isLikelyDuplicate(
                    item.optString("amount", ""),
                    item.optLong("occurredAt"),
                    item.isNull("reference") ? null : item.optString("reference"),
                    item.isNull("merchant") ? null : item.optString("merchant"),
                    item.optString("source", ""),
                    payment.amount,
                    payment.occurredAt,
                    payment.reference,
                    payment.merchant,
                    payment.source)) return true;
        }
        return false;
    }

    private JSONArray readArray(String key) {
        try {
            return new JSONArray(preferences.getString(key, "[]"));
        } catch (JSONException ignored) {
            return new JSONArray();
        }
    }

    private void saveArray(String key, JSONArray array) {
        preferences.edit().putString(key, array.toString()).apply();
    }
}
