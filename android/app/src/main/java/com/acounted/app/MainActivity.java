package com.acounted.app;

import android.content.Intent;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(PaymentCapturePlugin.class);
        // Migrate existing installs and establish the always-on default before
        // the web UI starts. Android still requires the user to grant the two
        // notification permissions; the app requests those separately.
        new PendingPaymentStore(this).setEnabled(true);
        super.onCreate(savedInstanceState);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        // BridgeActivity forwards the intent to Capacitor but does not replace
        // Activity#getIntent(). The payment plugin reads this retained intent
        // after the web app resumes.
        setIntent(intent);
    }
}
