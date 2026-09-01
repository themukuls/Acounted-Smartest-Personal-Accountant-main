package com.acounted.app;

import org.junit.Test;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;

public class PaymentNotificationParserTest {
    @Test
    public void acceptsSuccessfulOutgoingPaymentFromEverySupportedApp() {
        String[] packages = {
            "net.one97.paytm",
            "com.google.android.apps.nbu.paisa.user",
            "com.phonepe.app",
            "in.org.npci.upiapp",
            "com.dreamplug.androidapp",
            "com.mobikwik_new",
            "com.freecharge.android",
            "money.super.payments"
        };
        for (String packageName : packages) {
            PaymentNotificationParser.ParsedPayment payment = PaymentNotificationParser.parse(
                packageName, "Payment Successful", "Paid ₹1,250.50 to Corner Cafe via UPI\nUPI Ref: 123456789012", 1_700_000_000_000L
            );
            assertNotNull(packageName, payment);
            assertEquals("1250.5", payment.amount);
            assertEquals("Corner Cafe", payment.merchant);
            assertEquals("123456789012", payment.reference);
        }
    }

    @Test
    public void recognisesAlternateSuccessfulWording() {
        PaymentNotificationParser.ParsedPayment payment = PaymentNotificationParser.parse(
            "com.phonepe.app", "Transaction completed", "Payment of INR 499 to Metro Store was successful", 1_700_000_000_000L
        );
        assertNotNull(payment);
        assertEquals("499", payment.amount);
        assertEquals("Metro Store", payment.merchant);
    }

    @Test
    public void ignoresIncomingFailedAndPromotionalNotifications() {
        assertNull(PaymentNotificationParser.parse("com.phonepe.app", "Money received", "₹500 received from Amit", 1L));
        assertNull(PaymentNotificationParser.parse("com.google.android.apps.nbu.paisa.user", "Payment failed", "Payment of ₹500 failed", 1L));
        assertNull(PaymentNotificationParser.parse("com.dreamplug.androidapp", "Cashback", "Get ₹500 cashback", 1L));
    }

    @Test
    public void ignoresUnsupportedApplications() {
        assertNull(PaymentNotificationParser.parse("com.example.bank", "Payment successful", "Paid ₹500 to Shop", 1L));
    }
}
