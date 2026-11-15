package com.acounted.app;

import java.math.BigDecimal;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

final class PaymentNotificationParser {
    private static final Pattern AMOUNT = Pattern.compile(
        "(?i)(?:₹|rs\\.?|inr)\\s*([0-9][0-9,]*(?:\\.[0-9]{1,2})?)"
    );
    private static final Pattern OUTGOING = Pattern.compile(
        "(?iu)(?:\\b(payment successful|payment completed|paid successfully|paid|you paid|sent successfully|money sent|amount sent|debited|spent|purchase(?:d)?|transaction successful|transaction completed|txn successful|txn completed)\\b|भुगतान सफल|सफलतापूर्वक भुगतान|भुगतान किया)"
    );
    private static final Pattern STRONG_OUTGOING = Pattern.compile(
        "(?iu)(?:\\b(paid|you paid|sent successfully|money sent|amount sent|debited|spent|purchase(?:d)?)\\b|भुगतान किया)"
    );
    private static final Pattern REJECT_STATE = Pattern.compile(
        "(?iu)(?:\\b(failed|declined|pending|processing|refund(?:ed)?|reversal|reversed|collect request|payment request|requesting|autopay reminder)\\b|विफल|लंबित|रिफंड)"
    );
    private static final Pattern INCOMING = Pattern.compile(
        "(?iu)(?:\\b(received from|credited to|credit(?:ed)? in|money received|deposit(?:ed)?)\\b|प्राप्त)"
    );
    private static final Pattern OTP_OR_PROMO = Pattern.compile(
        "(?iu)\\b(otp|one time password|verification code|do not share|offer|win|reward points|coupon)\\b"
    );
    private static final Pattern REFERENCE = Pattern.compile(
        "(?i)\\b(?:upi ref(?:erence)?|upi transaction id|utr|transaction id|txn id|reference)\\s*[:#-]?\\s*([a-z0-9-]{6,})"
    );
    private static final Pattern[] MERCHANT_PATTERNS = new Pattern[] {
        Pattern.compile("(?i)\\b(?:paid|sent)(?:\\s+(?:₹|rs\\.?|inr)?\\s*[0-9][0-9,]*(?:\\.[0-9]{1,2})?)?\\s+to\\s+(.+)"),
        Pattern.compile("(?i)\\bpayment(?:\\s+of\\s+(?:₹|rs\\.?|inr)?\\s*[0-9][0-9,]*(?:\\.[0-9]{1,2})?)?\\s+to\\s+(.+?)\\s+(?:was\\s+)?(?:successful|completed)\\b"),
        Pattern.compile("(?i)(?:₹|rs\\.?|inr)\\s*[0-9][0-9,]*(?:\\.[0-9]{1,2})?\\s+(?:has been\\s+)?(?:paid|sent)\\s+to\\s+(.+)"),
        Pattern.compile("(?i)\\b(?:debited|spent|purchase(?:d)?)\\b.*?\\b(?:at|to|towards)\\s+(.+)")
    };
    private static final Pattern VPA = Pattern.compile("(?i)\\b([a-z0-9._-]{2,}@[a-z][a-z0-9.-]{1,})\\b");

    static final class ParsedPayment {
        final String amount;
        final String merchant;
        final long occurredAt;
        final String reference;
        final String dedupeKey;
        final String source;
        final String appName;
        final String sourcePackage;

        ParsedPayment(
            String amount,
            String merchant,
            long occurredAt,
            String reference,
            String dedupeKey,
            String source,
            String appName,
            String sourcePackage
        ) {
            this.amount = amount;
            this.merchant = merchant;
            this.occurredAt = occurredAt;
            this.reference = reference;
            this.dedupeKey = dedupeKey;
            this.source = source;
            this.appName = appName;
            this.sourcePackage = sourcePackage;
        }
    }

    private PaymentNotificationParser() {}

    static ParsedPayment parse(String packageName, String title, String body, long postedAt) {
        PaymentAppRegistry.AppInfo app = PaymentAppRegistry.find(packageName);
        String source = app == null ? "financial_notification" : app.source;
        String appName = app == null ? "Financial app" : app.displayName;
        return parseText(packageName, source, appName, title, body, postedAt, false);
    }

    static ParsedPayment parseSms(String sender, String body, long receivedAt) {
        if (body == null || body.trim().isEmpty()) return null;
        String safeSender = sender == null || sender.trim().isEmpty() ? "Bank" : sender.trim();
        return parseText(
            "sms:" + safeSender.toLowerCase(Locale.ROOT),
            "bank_sms",
            safeSender + " SMS",
            "",
            body,
            receivedAt,
            true
        );
    }

    private static ParsedPayment parseText(
        String sourcePackage,
        String source,
        String appName,
        String title,
        String body,
        long occurredAt,
        boolean sms
    ) {

        String text = normalize((title == null ? "" : title) + "\n" + (body == null ? "" : body));
        if (text.isEmpty() || REJECT_STATE.matcher(text).find()) return null;
        boolean strongOutgoing = STRONG_OUTGOING.matcher(text).find();
        if (!OUTGOING.matcher(text).find()) return null;
        if (!strongOutgoing && (INCOMING.matcher(text).find() || OTP_OR_PROMO.matcher(text).find())) return null;

        Matcher amountMatch = AMOUNT.matcher(text);
        if (!amountMatch.find()) return null;

        String amount;
        try {
            amount = new BigDecimal(amountMatch.group(1).replace(",", "")).stripTrailingZeros().toPlainString();
            if (new BigDecimal(amount).signum() <= 0) return null;
        } catch (NumberFormatException error) {
            return null;
        }

        String reference = findGroup(REFERENCE, text);
        String merchant = findMerchant(text);
        if (merchant == null) merchant = findGroup(VPA, text);
        long bucket = occurredAt / 120_000L;
        String fingerprint = reference != null
            ? "payment:ref:" + reference.toLowerCase(Locale.ROOT)
            : "payment:content:" + amount + ":" + (merchant == null ? "" : merchant.toLowerCase(Locale.ROOT)) + ":" + bucket;

        return new ParsedPayment(
            amount,
            merchant,
            occurredAt,
            reference,
            sha256(fingerprint),
            source,
            appName,
            sourcePackage
        );
    }

    private static String normalize(String value) {
        return value.replace('\u00a0', ' ').replaceAll("[\\t\\r ]+", " ").replaceAll("\\n+", "\n").trim();
    }

    private static String findGroup(Pattern pattern, String text) {
        Matcher matcher = pattern.matcher(text);
        return matcher.find() ? matcher.group(1).trim() : null;
    }

    private static String findMerchant(String text) {
        for (Pattern pattern : MERCHANT_PATTERNS) {
            String match = findGroup(pattern, text);
            if (match != null) return cleanMerchant(match);
        }
        return null;
    }

    private static String cleanMerchant(String merchant) {
        String cleaned = merchant
            .replaceFirst("(?i)^(?:vpa|upi id)\\s*[: -]?\\s*", "")
            .replaceAll("(?i)\\s+(?:using|via|through|on|from)\\s+.*$", "")
            .replaceAll("(?i)\\s*[.!?]\\s+(?:cashback|earn|get|offer).*$", "")
            .replaceAll("(?i)\\s+(?:avl|available)\\s+bal(?:ance)?[.:]?.*$", "")
            .replaceAll("(?i)\\s+(?:ref|upi ref(?:erence)?|utr|transaction id|txn id)\\s*[:#-]?.*$", "")
            .replaceAll("(?i)\\s+(?:was\\s+)?(?:successful|completed).*$", "")
            .replaceAll("(?i)\\s+(?:upi ref(?:erence)?|utr|transaction id|txn id|reference)\\s*[:#-]?.*$", "")
            .replaceAll("[|,.;]+$", "")
            .trim();
        if (cleaned.isEmpty()) return null;
        return cleaned.length() > 80 ? cleaned.substring(0, 80).trim() : cleaned;
    }

    private static String sha256(String input) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] bytes = digest.digest(input.getBytes(java.nio.charset.StandardCharsets.UTF_8));
            StringBuilder result = new StringBuilder();
            for (byte value : bytes) result.append(String.format(Locale.ROOT, "%02x", value));
            return result.toString();
        } catch (Exception impossible) {
            return Integer.toHexString(input.hashCode());
        }
    }
}
