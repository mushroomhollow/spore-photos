import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Download, KeyRound, Hammer, Loader2, CheckCircle2, AlertTriangle, Info, ShieldCheck,
} from 'lucide-react';
import {
  fetchApkStatus, createApkKeystore, startApkBuild, fetchApkBuildStatus,
} from '../api/client';
import MobilePermissionsPanel from './MobilePermissionsPanel';

function bytes(n) {
  if (!n && n !== 0) return '';
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function CopyButton({ text, label = 'Copy' }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // Clipboard blocked — the text is selectable on screen.
        }
      }}
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-retro-mint/60 text-retro-navy text-xs font-semibold hover:bg-retro-mint/20 transition-colors"
    >
      {copied ? 'Copied' : label}
    </button>
  );
}

function DownloadLink({ apk }) {
  return (
    <a
      href={apk.url}
      download
      className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-retro-teal text-white font-semibold text-sm hover:bg-retro-teal/80 transition-colors"
    >
      <Download size={17} />
      Download APK v{apk.version}
      <span className="text-white/70 font-normal">({bytes(apk.size)})</span>
    </a>
  );
}

/**
 * Settings → Download App.
 *
 * The project publishes no APK: an app can only be updated by a build signed
 * with the same key, so the key — and therefore the build — belongs to whoever
 * runs this server. This panel is a four-state machine because that is what is
 * honest: it offers a button only when the machine can actually build, and
 * otherwise says what is missing and how to fix it.
 *
 * It never installs a toolchain (that is ~3 GB of JDK and Android SDK, not
 * something a settings screen should do quietly) and never keeps a passphrase.
 */
export default function DownloadAppPanel({ user }) {
  const isAdmin = user?.role === 'admin';

  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [passphrase, setPassphrase] = useState('');
  const [notice, setNotice] = useState(null);
  const [fingerprint, setFingerprint] = useState(null);
  const [log, setLog] = useState('');
  const pollRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const data = await fetchApkStatus();
      setStatus(data);
      setError(null);
      return data;
    } catch (e) {
      setError(e?.response?.data?.error || e?.message || 'Could not read the build status.');
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // While a build runs, follow its log. Stops as soon as it is no longer
  // building, and when the panel goes away.
  useEffect(() => {
    if (!status?.building) return undefined;

    const tick = async () => {
      try {
        const data = await fetchApkBuildStatus();
        setLog(data.log || '');
        if (!data.building) {
          setStatus((prev) => ({
            ...(prev || {}),
            building: false,
            available: data.available,
            lastBuild: data.lastBuild,
          }));
        }
      } catch {
        // A failed poll must not break the panel; the next tick retries.
      }
    };

    pollRef.current = setInterval(tick, 3000);
    tick();
    return () => clearInterval(pollRef.current);
  }, [status?.building]);

  const createKey = async () => {
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      const data = await createApkKeystore(passphrase);
      setFingerprint(data.fingerprint || null);
      setPassphrase('');
      setNotice('Signing key created. Back it up — see the warning below.');
      await load();
    } catch (e) {
      setError(e?.response?.data?.error || e?.message || 'Could not create the signing key.');
    } finally {
      setBusy(false);
    }
  };

  const build = async () => {
    setBusy(true);
    setNotice(null);
    setError(null);
    setLog('');
    try {
      await startApkBuild({ version: status?.version, passphrase });
      setPassphrase('');
      setNotice('Build started. This takes a few minutes the first time.');
      await load();
    } catch (e) {
      const data = e?.response?.data;
      setError(data?.error || e?.message || 'Could not start the build.');
      if (data?.hints) setNotice(null);
    } finally {
      setBusy(false);
    }
  };

  const state = status?.state;
  const available = status?.available || [];
  const latest = available[0] || null;
  const installCommands = [
    "# JDK 17+ (21 recommended)",
    status?.hints?.java || 'install a JDK 17 or newer',
    '',
    '# Android SDK command-line tools, then:',
    "export ANDROID_HOME=/opt/android-sdk",
    "sdkmanager --licenses",
    "sdkmanager 'platform-tools' 'build-tools;35.0.0' 'platforms;android-35'",
  ].join('\n');

  return (
    <div className="p-6 space-y-5">
      <div>
        <h4 className="text-lg font-bold text-retro-navy flex items-center gap-2">
          <Download size={20} className="text-retro-teal" />
          Download the Android App
        </h4>
        <p className="text-retro-navy/70 text-sm mt-1 max-w-2xl">
          This project does not publish an app binary. An Android app can only be
          updated by a build signed with the same key, so each server owner builds
          and signs their own — with a key that belongs to them.
        </p>
      </div>

      {error && (
        <div className="text-sm text-retro-red bg-retro-red/10 border border-retro-red/30 rounded-lg px-3 py-2.5">
          {error}
        </div>
      )}
      {notice && (
        <div className="text-sm text-retro-navy bg-retro-mint/20 border border-retro-mint/60 rounded-lg px-3 py-2.5">
          {notice}
        </div>
      )}

      {/* ── An APK exists on this server ─────────────────────────── */}
      {latest ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <DownloadLink apk={latest} />
            {available.length > 1 && (
              <span className="text-xs text-retro-navy/60">
                {available.length - 1} older build{available.length === 2 ? '' : 's'} kept for rollback
              </span>
            )}
          </div>
          <p className="text-retro-navy/50 text-xs max-w-2xl">
            Built {new Date(latest.builtAt).toLocaleString()}. Enable "Install from
            unknown apps" on your phone, and expect a reinstall the first time if the
            app you have was signed with a different key.
          </p>
        </div>
      ) : (
        <p className="text-retro-navy/60 text-sm bg-retro-cream/60 border border-retro-mint/40 rounded-xl px-4 py-3 max-w-2xl">
          No APK has been built on this server yet.
          {state === 'unavailable' && ' The build script is not present in this installation.'}
        </p>
      )}

      {/* ── Admin: the machinery ────────────────────────────────── */}
      {isAdmin && (
        <>
          {loading && !status && (
            <p className="text-sm text-retro-navy/60">Reading the build status…</p>
          )}

          {/* State 1: the machine cannot build. Say so, and say exactly what fixes it. */}
          {state === 'unavailable' && (
            <div className="max-w-2xl space-y-3">
              <div className="flex gap-2 text-sm text-retro-navy bg-retro-mint/15 border border-retro-mint/40 rounded-lg px-3 py-2.5">
                <Info size={16} className="text-retro-teal shrink-0 mt-0.5" />
                <span>
                  This installation has no Android build script — a container image
                  built from the Dockerfile does not include the Android project. Build
                  from a checkout of the source:
                  <span className="font-mono text-xs"> docker compose --profile build run --rm builder build</span>
                  , or follow <span className="font-mono text-xs">docs/BUILD-APK.md</span>.
                </span>
              </div>
            </div>
          )}

          {state === 'no_toolchain' && (
            <div className="max-w-2xl space-y-3">
              <div className="flex items-start gap-2 text-sm text-retro-navy bg-retro-cream/60 border border-retro-orange/40 rounded-lg px-3 py-2.5">
                <AlertTriangle size={16} className="text-retro-orange shrink-0 mt-0.5" />
                <span>
                  This machine cannot build an Android app yet. It needs a JDK and the
                  Android SDK — on the order of 3 GB, one time. Nothing here installs
                  that for you; run these on the server, then reload this panel.
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-semibold text-retro-navy/70">What is missing</span>
                <CopyButton text={installCommands} label="Copy commands" />
              </div>
              <pre className="overflow-x-auto rounded-lg bg-retro-navy text-retro-white text-xs p-3 font-mono leading-relaxed">
{installCommands}
              </pre>
              <div className="text-xs text-retro-navy/60">
                {status?.java ? `java: ${status.java}` : 'java: not found'}
                {status?.sdk ? ` · sdk: ${status.sdk}` : ' · sdk: not found'}
                {status?.buildTools ? ' · build-tools: ok' : ' · build-tools: missing'}
                {status?.apksigner ? ' · apksigner: ok' : ' · apksigner: missing'}
              </div>
              <div className="flex gap-2 text-xs text-retro-navy/60 bg-retro-mint/15 border border-retro-mint/40 rounded-lg px-3 py-2.5">
                <Info size={14} className="text-retro-teal shrink-0 mt-0.5" />
                <span>
                  With Docker you can skip the toolchain entirely —
                  <span className="font-mono"> docker compose --profile build run --rm builder build</span>.
                </span>
              </div>
            </div>
          )}

          {/* State 2: toolchain, no key. */}
          {state === 'no_keystore' && (
            <div className="max-w-2xl space-y-3">
              <h5 className="text-sm font-bold text-retro-navy flex items-center gap-2">
                <KeyRound size={16} className="text-retro-teal" />
                Create your signing key
              </h5>
              <div className="flex gap-2 text-xs text-retro-navy bg-retro-red/10 border border-retro-red/30 rounded-lg px-3 py-2.5">
                <AlertTriangle size={14} className="text-retro-red shrink-0 mt-0.5" />
                <span>
                  This key identifies your app to every phone you install it on, and it
                  is the only thing that can update an install you have already made.
                  <strong> Back it up somewhere you will still have in five years.</strong> If
                  you lose it, your existing installs can never be updated — only
                  uninstalled and replaced.
                </span>
              </div>
              <label className="block text-xs font-semibold text-retro-navy/70" htmlFor="keystore-pass">
                Passphrase (at least 6 characters — used to sign, never stored)
              </label>
              <input
                id="keystore-pass"
                type="password"
                autoComplete="new-password"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                disabled={busy}
                className="w-full px-3 py-2 rounded-lg border-2 border-retro-mint/60 bg-retro-white text-retro-navy text-sm font-mono focus:outline-none focus:border-retro-teal"
              />
              <button
                type="button"
                onClick={createKey}
                disabled={busy || passphrase.length < 6}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-retro-teal text-white font-semibold text-sm hover:bg-retro-teal/80 disabled:opacity-40 transition-colors"
              >
                {busy ? <Loader2 size={16} className="animate-spin" /> : <KeyRound size={16} />}
                {busy ? 'Creating…' : 'Create signing key'}
              </button>
              {fingerprint && (
                <div className="text-xs text-retro-navy/70 font-mono break-all">
                  SHA-256: {fingerprint}
                </div>
              )}
            </div>
          )}

          {/* State 3: ready to build. */}
          {state === 'ready' && (
            <div className="max-w-2xl space-y-3">
              <h5 className="text-sm font-bold text-retro-navy flex items-center gap-2">
                <Hammer size={16} className="text-retro-teal" />
                Build the app for v{status?.version}
              </h5>
              <div className="text-xs text-retro-navy/60">
                It rebuilds the web assets, signs the result with your key, verifies the
                signature, and places it as
                <span className="font-mono"> {status?.apkName}</span>. A few minutes the
                first time; the output is a real release build, not a debug one.
              </div>
              {!status?.building && (
                <>
                  <label className="block text-xs font-semibold text-retro-navy/70" htmlFor="build-pass">
                    Keystore passphrase
                  </label>
                  <input
                    id="build-pass"
                    type="password"
                    autoComplete="current-password"
                    value={passphrase}
                    onChange={(e) => setPassphrase(e.target.value)}
                    disabled={busy}
                    className="w-full px-3 py-2 rounded-lg border-2 border-retro-mint/60 bg-retro-white text-retro-navy text-sm font-mono focus:outline-none focus:border-retro-teal"
                  />
                  <button
                    type="button"
                    onClick={build}
                    disabled={busy || !passphrase}
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-retro-teal text-white font-semibold text-sm hover:bg-retro-teal/80 disabled:opacity-40 transition-colors"
                  >
                    {busy ? <Loader2 size={16} className="animate-spin" /> : <Hammer size={16} />}
                    {busy ? 'Starting…' : `Build v${status?.version}`}
                  </button>
                </>
              )}
            </div>
          )}

          {/* State 4: building, or just built. */}
          {(status?.building || log) && (
            <div className="max-w-3xl space-y-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-retro-navy">
                {status?.building
                  ? <><Loader2 size={16} className="animate-spin text-retro-teal" /> Building…</>
                  : <><CheckCircle2 size={16} className="text-retro-teal" /> Last build finished</>}
              </div>
              {log && (
                <pre className="overflow-auto max-h-64 rounded-lg bg-retro-navy text-retro-white text-xs p-3 font-mono leading-relaxed">
{log}
                </pre>
              )}
            </div>
          )}

          {status?.lastBuild?.sha256 && (
            <div className="max-w-2xl rounded-lg border border-retro-mint/50 bg-retro-mint/10 px-3 py-2.5">
              <div className="flex items-center gap-2 text-xs font-semibold text-retro-navy">
                <ShieldCheck size={14} className="text-retro-teal" />
                Last build
              </div>
              <div className="text-xs text-retro-navy/70 mt-1 font-mono break-all">
                {status.lastBuild.apk} · {status.lastBuild.sha256}
              </div>
              <div className="text-xs text-retro-navy/60 mt-1">
                Signed by {status.lastBuild.signer || 'your key'}
              </div>
            </div>
          )}

          {status?.keystore?.present && (
            <div className="text-xs text-retro-navy/60 max-w-2xl">
              Signing key: <span className="font-mono">{status.keystore.path}</span>
              {status.keystore.sha256 ? ` (SHA-256 ${status.keystore.sha256.slice(0, 23)}…)` : ''}
            </div>
          )}
        </>
      )}

      {/* Native-only: permission status + deep links (renders nothing on web) */}
      <MobilePermissionsPanel />
    </div>
  );
}
