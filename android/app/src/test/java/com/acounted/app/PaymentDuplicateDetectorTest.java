package com.acounted.app;

import org.junit.Test;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

public class PaymentDuplicateDetectorTest {
    private static final long AT = 1_700_000_000_000L;

    @Test
    public void matchesAppNotificationAndDelayedSmsForOnePayment() {
        assertTrue(PaymentDuplicateDetector.isLikelyDuplicate(
            "141", AT, null, "Office Canteen", "paytm",
            "141", AT + 180_000L, "456789123456", "78abc@ybl", "bank_sms"
        ));
    }

    @Test
    public void matchesTheSameVpaAcrossFormattingDifferences() {
        assertTrue(PaymentDuplicateDetector.isLikelyDuplicate(
            "141", AT, null, "VPA: 78abc@YBL", "paytm",
            "141", AT + 400_000L, null, "78abc@ybl", "bank_sms"
        ));
    }

    @Test
    public void neverMergesDifferentBankReferences() {
        assertFalse(PaymentDuplicateDetector.isLikelyDuplicate(
            "141", AT, "111111111111", "Office Canteen", "bank_sms",
            "141", AT + 10_000L, "222222222222", "Office Canteen", "bank_sms"
        ));
    }

    @Test
    public void doesNotMergeUnrelatedSameAmountPayments() {
        assertFalse(PaymentDuplicateDetector.isLikelyDuplicate(
            "141", AT, null, "Office Canteen", "paytm",
            "141", AT + 60_000L, null, "Metro Store", "paytm"
        ));
    }
}
