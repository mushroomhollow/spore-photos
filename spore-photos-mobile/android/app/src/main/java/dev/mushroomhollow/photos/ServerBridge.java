package dev.mushroomhollow.photos;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.webkit.JavascriptInterface;

import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Plain WebView JavaScript bridge — exposed to JS as {@code window.SporeNative}.
 *
 * Why this exists in addition to {@link SporeFilesPlugin}: Capacitor's bridge is
 * only present on pages it successfully injects into. When the configured
 * server can't be loaded, the app navigates to the bundled {@code error.html}
 * fallback — and if Capacitor's bridge isn't there either, the page cannot read
 * or repair the server address and the app is permanently stuck (no way back
 * except clearing app data).
 *
 * {@code addJavascriptInterface} is registered on the WebView itself, so it is
 * available on EVERY document the WebView creates — including the fallback
 * page. That makes server-address repair always possible.
 *
 * The methods only read/write one SharedPreferences string, run a short HTTP
 * reachability check, and relaunch the app, so exposing them to page JS is low
 * risk.
 */
public class ServerBridge {

    static final String PREFS_NAME = "spore_prefs";
    static final String KEY_SERVER_URL = "server_url";

    private final Activity activity;

    ServerBridge(Activity activity) {
        this.activity = activity;
    }

    private SharedPreferences prefs() {
        return activity.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    }

    /** "" means "use the built-in default from capacitor.config.json". */
    @JavascriptInterface
    public String getServerUrl() {
        String url = prefs().getString(KEY_SERVER_URL, "");
        return url == null ? "" : url;
    }

    @JavascriptInterface
    public void setServerUrl(String url) {
        // commit(), not apply(): the app restarts immediately after this call,
        // and an async apply() can be lost if the process goes away first.
        prefs().edit().putString(KEY_SERVER_URL, url == null ? "" : url.trim()).commit();
    }

    @JavascriptInterface
    public void clearServerUrl() {
        prefs().edit().remove(KEY_SERVER_URL).commit();
    }

    /**
     * Reachability check used by the fallback page and the Settings test button.
     * Returns "HTTP 200" or the exception type/message (UnknownHostException,
     * ConnectException, SSLHandshakeException, …) so a failure is diagnosable on
     * the device.
     *
     * JS interface calls run on a background thread, but the call itself is
     * synchronous from JS's point of view — keep the timeout short.
     */
    @JavascriptInterface
    public String testServer(String baseUrl) {
        String base = baseUrl == null ? "" : baseUrl.trim().replaceAll("/+$", "");
        if (base.isEmpty()) {
            return "No address set";
        }

        HttpURLConnection conn = null;
        try {
            URL url = new URL(base + "/api/health");
            conn = (HttpURLConnection) url.openConnection();
            conn.setConnectTimeout(6000);
            conn.setReadTimeout(6000);
            conn.setInstanceFollowRedirects(true);
            int code = conn.getResponseCode();
            return "HTTP " + code;
        } catch (Exception e) {
            String message = e.getMessage();
            return e.getClass().getSimpleName() + (message == null ? "" : ": " + message);
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    /** Restarts the app so the saved server address is applied. */
    @JavascriptInterface
    public void restart() {
        relaunch(activity);
    }

    /**
     * Restarts the app so the saved server address is applied.
     *
     * MainActivity reads the address in onCreate(), so this must produce a new
     * activity instance (not onNewIntent on the existing one). CLEAR_TASK +
     * NEW_TASK on the launcher intent does that, and the activity is declared
     * launchMode=singleTop so a fresh instance is created and onCreate() runs.
     *
     * No process kill and no alarm: killing the process right after writing the
     * preference caused the write to be lost, and left the app closed instead
     * of relaunched.
     */
    static void relaunch(final Activity activity) {
        if (activity == null) return;
        activity.runOnUiThread(() -> {
            Intent launch = activity.getPackageManager().getLaunchIntentForPackage(activity.getPackageName());
            if (launch == null) {
                activity.finish();
                return;
            }
            launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
            activity.startActivity(launch);
            activity.finishAffinity();
        });
    }
}