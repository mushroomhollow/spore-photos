package dev.mushroomhollow.photos;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;

/**
 * Native file operations for the phone's shared DCIM/Camera folder.
 *
 * The web layer decides whether we are running in the native shell; these
 * methods are only ever called from the Android WebView.
 *
 *   saveToDcim  — write a downloaded file into DCIM/Camera so it shows up in
 *                 the system gallery AND in the app's own local-photo scan.
 *   deleteLocal — remove a DCIM/Camera file whose (HEIC/HEIF-normalized) name
 *                 matches a server photo that the user just deleted.
 *
 * Both require the user to have granted "All files access"
 * (MANAGE_EXTERNAL_STORAGE) so the app can write to and delete files it does
 * not own (e.g. a Camera-app original). saveToDcim uses MediaStore so the
 * written file is indexed immediately; deleteLocal does a best-effort
 * MediaStore row removal followed by a raw File.delete().
 */
@CapacitorPlugin(name = "SporeFiles")
public class SporeFilesPlugin extends Plugin {

    private static final String PREFS_NAME = "spore_prefs";
    private static final String KEY_SERVER_URL = "server_url";

    @PluginMethod
    public void saveToDcim(PluginCall call) {
        String filename = call.getString("filename");
        String base64Data = call.getString("base64Data");
        String mimeType = call.getString("mimeType", "application/octet-stream");

        if (filename == null || base64Data == null) {
            call.reject("filename and base64Data are required");
            return;
        }

        try {
            byte[] bytes = android.util.Base64.decode(base64Data, android.util.Base64.DEFAULT);
            Uri uri = insertMedia(bytes, filename, mimeType);
            JSObject ret = new JSObject();
            ret.put("ok", true);
            ret.put("uri", uri != null ? uri.toString() : "");
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Failed to save to DCIM: " + e.getMessage());
        }
    }

    @PluginMethod
    public void deleteLocal(PluginCall call) {
        String serverFilename = call.getString("serverFilename");
        if (serverFilename == null || serverFilename.isEmpty()) {
            call.reject("serverFilename is required");
            return;
        }

        try {
            String matched = findAndDelete(serverFilename);
            JSObject ret = new JSObject();
            ret.put("ok", true);
            ret.put("deleted", matched != null);
            if (matched != null) {
                ret.put("matchedName", matched);
            }
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Delete failed: " + e.getMessage());
        }
    }

    // ── permissions ───────────────────────────────────────────

    @PluginMethod
    public void checkPermissionState(PluginCall call) {
        Context ctx = getContext();
        String mediaPerm = (Build.VERSION.SDK_INT >= 33)
            ? android.Manifest.permission.READ_MEDIA_IMAGES
            : android.Manifest.permission.READ_EXTERNAL_STORAGE;
        boolean mediaGranted = ctx.checkSelfPermission(mediaPerm) == PackageManager.PERMISSION_GRANTED;

        boolean allFiles = true;
        if (Build.VERSION.SDK_INT >= 30) {
            allFiles = Environment.isExternalStorageManager();
        }

        JSObject ret = new JSObject();
        ret.put("allFilesAccess", allFiles);
        ret.put("media", mediaGranted ? "granted" : "denied");
        call.resolve(ret);
    }

    @PluginMethod
    public void openAppSettings(PluginCall call) {
        Context ctx = getContext();
        Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
            Uri.parse("package:" + ctx.getPackageName()));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        ctx.startActivity(intent);
        call.resolve();
    }

    @PluginMethod
    public void openAllFilesAccess(PluginCall call) {
        Context ctx = getContext();
        if (Build.VERSION.SDK_INT >= 30) {
            Intent intent = new Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION,
                Uri.parse("package:" + ctx.getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(intent);
        } else {
            // Pre-Android 11 has no separate All-files-access screen.
            Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                Uri.parse("package:" + ctx.getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(intent);
        }
        call.resolve();
    }

    // ── server address (Settings → Server) ─────────────────────

    /**
     * Returns the saved server URL. Empty string = use the built-in default
     * from capacitor.config.json (the hosted server).
     */
    @PluginMethod
    public void getServerUrl(PluginCall call) {
        String url = getContext()
            .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .getString(KEY_SERVER_URL, "");
        JSObject ret = new JSObject();
        ret.put("url", url == null ? "" : url);
        call.resolve(ret);
    }

    /**
     * Persists a custom server URL. Empty string clears the override.
     * The change only takes effect after restartApp() rebuilds the bridge.
     */
    @PluginMethod
    public void setServerUrl(PluginCall call) {
        String url = call.getString("url", "");
        url = url == null ? "" : url.trim();
        getContext()
            .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_SERVER_URL, url)
            .commit(); // synchronous: the app restarts right after this
        JSObject ret = new JSObject();
        ret.put("ok", true);
        ret.put("url", url);
        call.resolve(ret);
    }

    /**
     * Restarts the app so MainActivity rebuilds CapConfig with the saved URL.
     * Called after setServerUrl; the current WebView is finished and a fresh
     * task is launched with no saved instance state.
     */
    @PluginMethod
    public void restartApp(PluginCall call) {
        call.resolve();
        ServerBridge.relaunch(getActivity());
    }

    // ── helpers ────────────────────────────────────────────────

    private Uri insertMedia(byte[] bytes, String filename, String mimeType) throws IOException {
        ContentResolver resolver = getContext().getContentResolver();
        ContentValues values = new ContentValues();
        values.put(MediaStore.MediaColumns.DISPLAY_NAME, filename);
        values.put(MediaStore.MediaColumns.MIME_TYPE, mimeType);

        Uri collection = (mimeType != null && mimeType.startsWith("video/"))
            ? MediaStore.Video.Media.EXTERNAL_CONTENT_URI
            : MediaStore.Images.Media.EXTERNAL_CONTENT_URI;

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            values.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DCIM + "/Camera");
            values.put(MediaStore.MediaColumns.IS_PENDING, 1);
            Uri uri = resolver.insert(collection, values);
            if (uri == null) throw new IOException("MediaStore insert returned null");
            try (OutputStream out = resolver.openOutputStream(uri)) {
                if (out == null) throw new IOException("openOutputStream returned null");
                out.write(bytes);
            }
            values.clear();
            values.put(MediaStore.MediaColumns.IS_PENDING, 0);
            resolver.update(uri, values, null, null);
            return uri;
        }

        // Pre-Android 10 fallback: write directly and trigger a media scan.
        File dcimDir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DCIM), "Camera");
        if (!dcimDir.exists() && !dcimDir.mkdirs()) {
            throw new IOException("Could not create " + dcimDir.getAbsolutePath());
        }
        File target = new File(dcimDir, filename);
        try (FileOutputStream fos = new FileOutputStream(target)) {
            fos.write(bytes);
        }
        MediaScannerConnection.scanFile(getContext(), new String[]{target.getAbsolutePath()}, new String[]{mimeType}, null);
        return Uri.fromFile(target);
    }

    /**
     * Find a DCIM/Camera file whose name matches the server's stored filename
     * (with HEIC/HEIF normalized to .jpg, mirroring ingest.js) and delete it.
     * Returns the matched on-disk name, or null if nothing matched.
     */
    private String findAndDelete(String serverFilename) {
        File dcimCamera = new File(Environment.getExternalStorageDirectory(), "DCIM/Camera");
        File[] files = dcimCamera.listFiles();
        if (files == null) return null;

        for (File f : files) {
            if (!f.isFile()) continue;
            String name = f.getName();
            String normalized = name.replaceFirst("(?i)\\.(heic|heif)$", ".jpg");
            if (!normalized.equalsIgnoreCase(serverFilename) && !name.equalsIgnoreCase(serverFilename)) {
                continue;
            }

            // Remove the gallery/MediaStore entry first (best effort — a
            // non-owned item may throw, which we swallow and rely on the raw
            // file delete below).
            try {
                ContentResolver resolver = getContext().getContentResolver();
                String selection = MediaStore.MediaColumns.DISPLAY_NAME + "=?";
                String[] args = new String[]{name};
                resolver.delete(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, selection, args);
                resolver.delete(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, selection, args);
            } catch (Exception ignored) {
                // fall through to raw file delete
            }

            // "All files access" (MANAGE_EXTERNAL_STORAGE) permits deleting
            // files the app does not own.
            boolean deleted = f.delete();
            return deleted ? name : null;
        }
        return null;
    }
}