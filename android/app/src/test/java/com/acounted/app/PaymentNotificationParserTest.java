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
    public void acceptsRecognisablePaymentFromOtherFinancialApplications() {
        PaymentNotificationParser.ParsedPayment payment = PaymentNotificationParser.parse(
            "com.example.bank", "Payment successful", "Paid ₹500 to Shop", 1L
        );
        assertNotNull(payment);
        assertEquals("financial_notification", payment.source);
    }

    @Test
    public void acceptsSuccessfulPaytmPaymentEvenWhenCashbackIsMentioned() {
        PaymentNotificationParser.ParsedPayment payment = PaymentNotificationParser.parse(
            "net.one97.paytm",
            "Payment successful",
            "You paid ₹141 to OFFICE CANTEEN. Cashback may be credited separately. UPI Ref: 456789123456",
            1_700_000_000_000L
        );
        assertNotNull(payment);
        assertEquals("141", payment.amount);
        assertEquals("OFFICE CANTEEN", payment.merchant);
    }

    @Test
    public void acceptsOutgoingBankDebitSms() {
        PaymentNotificationParser.ParsedPayment payment = PaymentNotificationParser.parseSms(
            "AD-HDFCBK",
            "Rs.141.00 debited from A/c XX1234 to VPA canteen@paytm on 15-11-26. UPI Ref 456789123456. Avl Bal Rs.9,000.00",
            1_700_000_000_000L
        );
        assertNotNull(payment);
        assertEquals("141", payment.amount);
        assertEquals("canteen@paytm", payment.merchant);
        assertEquals("bank_sms", payment.source);
    }

    @Test
    public void acceptsSpentAtMerchantSms() {
        PaymentNotificationParser.ParsedPayment payment = PaymentNotificationParser.parseSms(
            "VM-ICICIB",
            "INR 499 spent using Acct XX9087 at METRO STORE on 15-Nov. Ref 9876543210",
            1_700_000_000_000L
        );
        assertNotNull(payment);
        assertEquals("499", payment.amount);
        assertEquals("METRO STORE", payment.merchant);
    }

    @Test
    public void rejectsIncomingOtpAndFailedSms() {
        assertNull(PaymentNotificationParser.parseSms("AD-HDFCBK", "Rs.500 credited to A/c XX1234 from Amit", 1L));
        assertNull(PaymentNotificationParser.parseSms("AD-HDFCBK", "OTP 123456 for payment of Rs.500. Do not share", 1L));
        assertNull(PaymentNotificationParser.parseSms("AD-HDFCBK", "Payment of Rs.500 failed", 1L));
    }
}
