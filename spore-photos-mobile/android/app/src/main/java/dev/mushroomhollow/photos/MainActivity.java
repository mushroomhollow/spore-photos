package dev.mushroomhollow.photos;

import android.content.SharedPreferences;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.CapConfig;
import org.json.JSONObject;

import java.io.InputStream;
import java.nio.charset.StandardCharsets;

/**
 * Registers the custom {@link SporeFilesPlugin} native plugin and applies a
 * user-configured server URL before the Capacitor bridge is built.
 *
 * Why manual registration (and why BEFORE super.onCreate): Capacitor only
 * auto-discovers plugins that live in node_modules (cap sync generates
 * capacitor.plugins.json for those). A plugin defined in the app's own source
 * is NOT auto-registered — the @CapacitorPlugin annotation alone has no effect
 * here, so it must be registered explicitly. And it must happen before
 * super.onCreate(), because BridgeActivity.onCreate() creates the Capacitor
 * bridge at the very end of its body; registering afterwards adds to a builder
 * that has already been consumed.
 *
 * Server URL override: Settings → Server (mobile only) stores a URL in
 * SharedPreferences ("spore_prefs" / "server_url"). When present, we rebuild
 * the Capacitor config from capacitor.config.json with server.url pointed at
 * that address. That makes the WebView load the WHOLE app from the user's own
 * server (their API + their UI) — same-origin, so cookies, images and relative
 * API paths all keep working. Empty value = the hosted default in
 * capacitor.config.json.
 *
 * An "error.html" fallback is always configured so an unreachable URL shows a
 * native-served page where the address can be fixed instead of a dead WebView.
 */
public class MainActivity extends BridgeActivity {

    private static final String PREFS_NAME = "spore_prefs";
    private static final String KEY_SERVER_URL = "server_url";

    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(SporeFilesPlugin.class);
        this.config = buildConfigWithSavedServer();
        super.onCreate(savedInstanceState);

        // Plain JS bridge, present on EVERY page the WebView creates — including
        // the bundled error.html fallback. Capacitor's own bridge only exists on
        // pages it injects into, so when the configured server can't be loaded
        // the fallback page would otherwise be unable to read or repair the
        // server address (permanently stuck).
        android.webkit.WebView webView = getBridge() != null ? getBridge().getWebView() : null;
        if (webView != null) {
            webView.addJavascriptInterface(new ServerBridge(this), "SporeNative");
        }
    }

    /**
     * Builds the Capacitor config for this launch.
     *
     * - A saved server address → the WebView loads the whole app from it.
     * - No saved address → the bundled setup page is shown (appStartPath), so a
     *   fresh install never assumes a server and never tries to call the API
     *   against the local origin.
     *
     * Nothing here names a host: the address comes only from what the user
     * saved, and the setup page is the only way to set it.
     */
    private CapConfig buildConfigWithSavedServer() {
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        String saved = prefs.getString(KEY_SERVER_URL, "");

        try {
            InputStream is = getAssets().open("capacitor.config.json");
            byte[] buffer = new byte[is.available()];
            int read = is.read(buffer);
            is.close();
            String jsonText = new String(buffer, 0, read, StandardCharsets.UTF_8);

            JSONObject json = new JSONObject(jsonText);
            JSONObject server = json.optJSONObject("server");
            if (server == null) {
                server = new JSONObject();
                json.put("server", server);
            }

            // Show the setup page if the server can't be reached.
            server.put("errorPath", "error.html");

            if (saved != null && !saved.trim().isEmpty()) {
                server.put("url", saved.trim());
            } else {
                // First run: no server configured yet.
                server.put("appStartPath", "/error.html");
            }

            return new CapConfig(getAssets(), json);
        } catch (Exception e) {
            // Fall back to the bundled config rather than failing to launch.
            return null;
        }
    }
}
