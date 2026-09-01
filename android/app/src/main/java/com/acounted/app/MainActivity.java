package com.acounted.app;

import android.content.Intent;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(PaymentCapturePlugin.class);
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
