import { registerPlugin } from '@capacitor/core';

/**
 * Reading and writing the mobile app's server address.
 *
 * Two native access paths exist, and this module prefers the reliable one:
 *
 *  1. `window.SporeNative` — a plain Android `addJavascriptInterface` bridge
 *     registered on the WebView itself (see ServerBridge.java). It is present
 *     on every page the WebView creates, including the error.html fallback, so
 *     it is the only path that is guaranteed to work when the app could not
 *     reach its server.
 *  2. The `SporeFiles` Capacitor plugin — available only on pages Capacitor
 *     successfully injected into.
 *
 * Both store the address in the same Android SharedPreferences entry, so they
 * are interchangeable; prefer (1) and fall back to (2).
 */
const SporeFiles = registerPlugin('SporeFiles');

function nativeBridge() {
  try {
    return window.SporeNative || null;
  } catch {
    return null;
  }
}

/** True when running inside the Android shell. */
export function isNativeShell() {
  try {
    return window.Capacitor?.isNativePlatform?.() === true;
  } catch {
    return false;
  }
}

/** True when the server address can be changed on this platform. */
export function canConfigureServer() {
  return Boolean(nativeBridge()) || isNativeShell();
}

/** '' means "use the built-in default from capacitor.config.json". */
export async function getServerUrl() {
  const bridge = nativeBridge();
  if (bridge) {
    try {
      return bridge.getServerUrl() || '';
    } catch {
      // fall through to the plugin
    }
  }
  if (isNativeShell()) {
    try {
      const res = await SporeFiles.getServerUrl();
      return res?.url || '';
    } catch {
      // no path available
    }
  }
  return '';
}

export async function setServerUrl(url) {
  const value = url || '';
  const bridge = nativeBridge();
  if (bridge) {
    bridge.setServerUrl(value);
    return;
  }
  await SporeFiles.setServerUrl({ url: value });
}

/** Restarts the app so the new address is applied. */
export async function restartApp() {
  const bridge = nativeBridge();
  if (bridge) {
    bridge.restart();
    return;
  }
  await SporeFiles.restartApp();
}

/**
 * Reachability check for a candidate address. Returns a human-readable result
 * ("HTTP 200", "UnknownHostException: …") or null when no native test is
 * available (web, or an APK older than the native bridge).
 *
 * Synchronous by design: the native side does a short HTTP GET on its own
 * thread, so call it after a paint (setTimeout 0) if you need to show progress.
 */
export function testServerUrl(url) {
  const bridge = nativeBridge();
  if (!bridge || typeof bridge.testServer !== 'function') return null;
  try {
    return bridge.testServer(url || '');
  } catch (e) {
    return `Test failed: ${e?.message || e}`;
  }
}
