package com.kirara.hermes;

import android.os.Bundle;
import android.webkit.CookieManager;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    // Custom plugins register before the bridge initialises (Capacitor 4+ order).
    registerPlugin(NativeHttpPlugin.class);
    super.onCreate(savedInstanceState);
    // The app lives on http://localhost but the gateway is another origin
    // (http://192.168.x.x:9119), so the session cookie is third-party from the
    // WebView's point of view. Android drops those by default: login looks
    // fine (200 + Set-Cookie straight into the bin) and the next authed call
    // goes out naked. Accept them — the gateway is user-supplied, not ads.
    CookieManager cm = CookieManager.getInstance();
    cm.setAcceptCookie(true);
    cm.setAcceptThirdPartyCookies(this.bridge.getWebView(), true);
  }
}
