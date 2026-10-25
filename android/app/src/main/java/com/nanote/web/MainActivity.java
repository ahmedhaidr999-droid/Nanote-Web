package com.nanote.web;

import android.os.Bundle;
import androidx.core.splashscreen.SplashScreen;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // brand splash on every API level, then a clean hand-off to the app
        // theme (no white flash between splash and WebView first paint)
        SplashScreen.installSplashScreen(this);
        super.onCreate(savedInstanceState);
    }
}
