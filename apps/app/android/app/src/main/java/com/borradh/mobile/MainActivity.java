package com.borradh.mobile;

import android.os.Bundle;
import android.view.View;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    // Lay out below status bar / cutout (WebView otherwise draws edge-to-edge
    // on targetSdk 35+). CSS `env(safe-area-inset-*)` complements this on iOS.
    WindowCompat.setDecorFitsSystemWindows(getWindow(), true);

    // Android 16 (API 36) enforces edge-to-edge for apps targeting 36: the call
    // above is ignored there, and the opt-out flag that worked for targetSdk 35
    // is gone. Pad the content view by the system-bar/cutout insets so the
    // WebView still starts below the status bar. On older releases, where the
    // decor already fits system windows, these insets arrive as zero and this
    // is a no-op.
    View content = findViewById(android.R.id.content);
    ViewCompat.setOnApplyWindowInsetsListener(content, (view, windowInsets) -> {
      Insets bars = windowInsets.getInsets(
        WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout()
      );
      view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
      return windowInsets;
    });
  }
}
