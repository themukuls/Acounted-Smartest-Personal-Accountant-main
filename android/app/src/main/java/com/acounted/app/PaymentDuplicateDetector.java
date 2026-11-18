package com.acounted.app;

import java.util.Locale;

/** Shared, deterministic rules for recognising one payment across app and SMS capture. */
final class PaymentDuplicateDetector {
    static final long SAME_PAYEE_WINDOW_MS = 10 * 60_000L;
    static final long CROSS_CHANNEL_WINDOW_MS = 5 * 60_000L;

    private PaymentDuplicateDetector() {}

    static boolean isLikelyDuplicate(
        String existingAmount,
        long existingAt,
        String existingReference,
        String existingMerchant,
        String existingSource,
        String amount,
        long occurredAt,
        String reference,
        String merchant,
        String source
    ) {
        if (!safe(amount).equals(safe(existingAmount))) return false;

        String oldReference = normalizeReference(existingReference);
        String newReference = normalizeReference(reference);
        if (!oldReference.isEmpty() && !newReference.isEmpty()) {
            // Two different bank references are two genuine payments, even if
            // amount/payee/time happen to be identical.
            return oldReference.equals(newReference);
        }

        long distance = Math.abs(occurredAt - existingAt);
        if (distance > SAME_PAYEE_WINDOW_MS) return false;

        String oldMerchant = normalizeMerchant(existingMerchant);
        String newMerchant = normalizeMerchant(merchant);
        if (!oldMerchant.isEmpty() && oldMerchant.equals(newMerchant)) return true;

        // A payment-app notification commonly contains a display name while
        // the bank SMS contains only its VPA. If exactly one side has a bank
        // reference and the channels differ, time+amount is the only shared
        // identity Android exposes to us. Keep this window deliberately tight.
        boolean oneReference = oldReference.isEmpty() != newReference.isEmpty();
        boolean crossChannel = isSms(existingSource) != isSms(source);
        if (oneReference && crossChannel && distance <= CROSS_CHANNEL_WINDOW_MS) return true;

        // Some issuers omit the counterparty altogether. Treat that as the
        // same capture only in the original two-minute safety window.
        return (oldMerchant.isEmpty() || newMerchant.isEmpty()) && distance <= 120_000L;
    }

    static String normalizeMerchant(String value) {
        String normalized = safe(value).toLowerCase(Locale.ROOT)
            .replaceFirst("^(?:vpa|upi id)\\s*[: -]?\\s*", "")
            .replaceAll("[^a-z0-9@._*-]+", " ")
            .replaceAll("\\s+", " ")
            .trim();
        java.util.regex.Matcher vpa = java.util.regex.Pattern
            .compile("(?:^|\\s)([a-z0-9._*-]{2,}@[a-z][a-z0-9.-]{1,})(?:\\s|$)")
            .matcher(normalized);
        return vpa.find() ? vpa.group(1) : normalized;
    }

    private static String normalizeReference(String value) {
        return safe(value).toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]", "");
    }

    private static boolean isSms(String source) {
        return "bank_sms".equalsIgnoreCase(safe(source));
    }

    private static String safe(String value) {
        return value == null ? "" : value.trim();
    }
}
