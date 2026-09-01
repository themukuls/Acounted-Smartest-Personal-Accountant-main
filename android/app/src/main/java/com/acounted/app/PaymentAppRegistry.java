package com.acounted.app;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

final class PaymentAppRegistry {
    static final class AppInfo {
        final String source;
        final String displayName;

        AppInfo(String source, String displayName) {
            this.source = source;
            this.displayName = displayName;
        }
    }

    private static final Map<String, AppInfo> APPS;

    static {
        Map<String, AppInfo> apps = new LinkedHashMap<>();
        apps.put("net.one97.paytm", new AppInfo("paytm", "Paytm"));
        apps.put("com.google.android.apps.nbu.paisa.user", new AppInfo("google_pay", "Google Pay"));
        apps.put("com.phonepe.app", new AppInfo("phonepe", "PhonePe"));
        apps.put("in.org.npci.upiapp", new AppInfo("bhim", "BHIM"));
        apps.put("com.dreamplug.androidapp", new AppInfo("cred", "CRED"));
        apps.put("com.mobikwik_new", new AppInfo("mobikwik", "MobiKwik"));
        apps.put("com.freecharge.android", new AppInfo("freecharge", "Freecharge"));
        apps.put("money.super.payments", new AppInfo("super_money", "super.money"));
        APPS = Collections.unmodifiableMap(apps);
    }

    private PaymentAppRegistry() {}

    static AppInfo find(String packageName) {
        return APPS.get(packageName);
    }

    static boolean supports(String packageName) {
        return APPS.containsKey(packageName);
    }
}
