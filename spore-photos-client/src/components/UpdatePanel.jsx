import { useCallback, useEffect, useState } from 'react';
import {
  RefreshCw,
  CheckCircle2,
  ArrowUpCircle,
  AlertTriangle,
  Info,
  Copy,
  Check,
  GitBranch,
  Server,
  Smartphone,
  Globe,
} from 'lucide-react';
import { fetchVersionStatus } from '../api/client';

// The version of the web bundle this UI was built from (baked by Vite).
const BUNDLE_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';

/**
 * The Android shell's own version, when a bridge exposing one is present.
 * Older APKs have no such method, so this is null rather than an error — the
 * panel then simply does not claim to know the app version.
 */
function readAppVersion() {
  try {
    return window.SporeNative?.getAppVersion?.() || null;
  } catch {
    return null;
  }
}

function timeAgo(iso) {
  if (!iso) return 'never';
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

/** Plain-language explanation for each failure the checker can report. */
const REASON_HELP = {
  not_published: 'That address answered, but there is no release.json there yet — nothing published to compare against.',
  invalid_source: 'The address in the config file is not a usable http:// or https:// URL.',
  too_many_redirects: 'The address redirected too many times to follow.',
  too_large: 'The response was far larger than a release.json should ever be.',
  unreadable: 'The response was not a release.json, nor a bare version number.',
  timeout: 'The request timed out — the host may be slow or unreachable.',
  network: 'The host could not be reached from this server.',
};

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
          // Clipboard can be blocked (insecure origin, permissions). The text is
          // on screen and selectable, so this stays a convenience.
        }
      }}
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-retro-mint/60 text-retro-navy text-xs font-semibold hover:bg-retro-mint/20 transition-colors"
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
      {copied ? 'Copied' : label}
    </button>
  );
}

function VersionCard({ icon: Icon, label, value, detail }) {
  return (
    <div className="rounded-lg border border-retro-mint/50 bg-retro-mint/10 px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-retro-navy/70">
        <Icon size={13} className="text-retro-teal" />
        {label}
      </div>
      <div className="font-mono text-sm text-retro-navy mt-0.5">{value}</div>
      {detail && <div className="text-xs text-retro-navy/60 mt-0.5">{detail}</div>}
    </div>
  );
}

/**
 * Settings → Server: is a newer release published than the one this install
 * runs?
 *
 * Notify-only by design. It checks when this panel opens (and when someone
 * presses the button) and then explains how *this* install upgrades — Docker
 * compose or a manual checkout — with steps they can copy. It never installs
 * anything and never polls: no boot check, no timer, no background request.
 *
 * It is also **read-only**. The release source is an operator setting that lives
 * in the config file (or the environment); this panel reports which address is
 * in use, or that none is, and names the file to edit. Two places for one
 * setting would eventually disagree.
 */
export default function UpdatePanel() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState(null);
  const [throttled, setThrottled] = useState(false);

  const check = useCallback(async (force) => {
    if (force) setChecking(true);
    setError(null);
    setThrottled(false);
    try {
      const data = await fetchVersionStatus({ force });
      setStatus(data);
      if (data?.check?.throttled) setThrottled(true);
    } catch (e) {
      setError(e?.response?.data?.error || e?.message || 'Could not check for updates.');
    } finally {
      setLoading(false);
      setChecking(false);
    }
  }, []);

  // Auto-check once, when the panel opens. With no source configured the server
  // does not go near the network at all.
  useEffect(() => {
    check(false);
  }, [check]);

  const c = status?.check;
  const appVersion = readAppVersion();
  const isNative = Boolean(window.SporeNative);
  const configuredSource = status?.source?.url || '';
  const skippedSource = status?.source?.skipped?.[0]?.value || null;

  return (
    <div className="space-y-8">
      <div>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold text-retro-navy flex items-center gap-2 mb-1">
              <GitBranch size={20} className="text-retro-teal" />
              Version &amp; Updates
            </h3>
            <p className="text-sm text-retro-teal max-w-2xl">
              Compares this install against a release file you configure on the server
              (see the footnote below). Nothing polls in the background: the check runs
              when you open this panel, or when you ask for it.
            </p>
          </div>
          <button
            type="button"
            onClick={() => check(true)}
            disabled={checking || loading}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-retro-mint/60 text-retro-navy font-semibold text-sm hover:bg-retro-mint/20 disabled:opacity-40 transition-colors"
          >
            <RefreshCw size={16} className={checking ? 'animate-spin' : ''} />
            {checking ? 'Checking…' : 'Check again'}
          </button>
        </div>

        <div className="grid gap-3 sm:grid-cols-3 max-w-2xl mt-4">
          <VersionCard
            icon={Server}
            label="Server"
            value={status?.current ? `v${status.current}` : '—'}
            detail={status?.install ? `${status.install.method} install` : null}
          />
          <VersionCard icon={Globe} label="Web app" value={`v${BUNDLE_VERSION}`} detail="built into this UI" />
          {isNative && appVersion && (
            <VersionCard icon={Smartphone} label="App (APK)" value={`v${appVersion}`} detail="installed shell" />
          )}
        </div>
      </div>

      {error && (
        <div className="max-w-2xl text-sm text-retro-red bg-retro-red/10 border border-retro-red/30 rounded-lg px-3 py-2.5">
          {error}
        </div>
      )}

      {loading && !status && !error && (
        <div className="max-w-2xl text-sm text-retro-navy/60">Checking for updates…</div>
      )}

      {/* ── Something to upgrade to ─────────────────────────────── */}
      {c?.ok && c.updateAvailable && (
        <div className="max-w-3xl rounded-xl border-2 border-retro-orange/50 bg-retro-cream/40 p-4 space-y-4">
          <div className="flex items-start gap-3">
            <ArrowUpCircle size={20} className="text-retro-orange shrink-0 mt-0.5" />
            <div className="min-w-0">
              <div className="font-bold text-retro-navy">
                v{c.latest} is available
                {c.prerelease && <span className="ml-2 text-xs font-semibold text-retro-orange">pre-release</span>}
              </div>
              <div className="text-xs text-retro-navy/60">
                This install is v{status.current}
                {c.released ? ` · released ${c.released}` : ''}
              </div>
              {c.notes && <p className="text-sm text-retro-navy mt-2">{c.notes}</p>}
              {c.url && (
                <a
                  href={c.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs font-semibold text-retro-teal underline mt-1 inline-block"
                >
                  Release notes
                </a>
              )}
            </div>
          </div>

          {status.upgrade?.warnings?.length > 0 && (
            <ul className="space-y-1.5">
              {status.upgrade.warnings.map((w) => (
                <li key={w} className="flex gap-2 text-xs text-retro-navy bg-retro-red/10 border border-retro-red/30 rounded-lg px-3 py-2">
                  <AlertTriangle size={14} className="text-retro-red shrink-0 mt-0.5" />
                  <span>{w}</span>
                </li>
              ))}
            </ul>
          )}

          {status.upgrade?.steps?.length > 0 && (
            <div>
              <div className="flex items-center justify-between gap-3 mb-1.5">
                <div className="text-xs font-semibold text-retro-navy/70">
                  Upgrade this {status.upgrade.method} install
                </div>
                <CopyButton text={status.upgrade.steps.join('\n')} label="Copy steps" />
              </div>
              <pre className="overflow-x-auto rounded-lg bg-retro-navy text-retro-white text-xs p-3 font-mono leading-relaxed">
{status.upgrade.steps.join('\n')}
              </pre>
              {status.upgrade.note && (
                <p className="text-xs text-retro-navy/60 mt-1.5">{status.upgrade.note}</p>
              )}
              {status.docs && (
                <p className="text-xs text-retro-navy/60 mt-1">
                  Full instructions: <span className="font-mono">{status.docs}</span>
                </p>
              )}
            </div>
          )}

          {c.android && c.android.rebuild && (
            <div className="flex gap-2 text-xs text-retro-navy bg-retro-mint/20 border border-retro-mint/60 rounded-lg px-3 py-2">
              <Smartphone size={14} className="text-retro-teal shrink-0 mt-0.5" />
              <span>
                This release changed the Android app itself. Your phone's UI always
                matches the server, but rebuild and reinstall the APK to pick up the
                new shell: see <span className="font-mono">docs/BUILD-APK.md</span>.
              </span>
            </div>
          )}
        </div>
      )}

      {/* ── Up to date ──────────────────────────────────────────── */}
      {c?.ok && !c.updateAvailable && (
        <div className="max-w-2xl flex items-start gap-3 rounded-xl border border-retro-mint/60 bg-retro-mint/15 px-4 py-3">
          <CheckCircle2 size={18} className="text-retro-teal shrink-0 mt-0.5" />
          <div className="text-sm text-retro-navy">
            <span className="font-semibold">Up to date.</span>{' '}
            The published release is v{c.latest}, and this install is v{status.current}.
            <div className="text-xs text-retro-navy/60 mt-1">
              Checked {timeAgo(c.checkedAt)}{c.fromCache ? ' (cached)' : ''}
            </div>
          </div>
        </div>
      )}

      {/* ── No source, or the check failed ──────────────────────── */}
      {c && !c.ok && (
        <div className="max-w-2xl rounded-xl border border-retro-orange/50 bg-retro-cream/40 px-4 py-3">
          <div className="flex items-start gap-3">
            {c.reason === 'not_configured'
              ? <Info size={18} className="text-retro-teal shrink-0 mt-0.5" />
              : <AlertTriangle size={18} className="text-retro-orange shrink-0 mt-0.5" />}
            <div className="text-sm text-retro-navy min-w-0">
              <span className="font-semibold">
                {c.reason === 'not_configured'
                  ? 'No release source is set.'
                  : 'Could not check for updates.'}
              </span>
              <div className="text-xs mt-1">
                {c.reason === 'not_configured'
                  ? <>Nothing is checked until the server is told where to look. See the footnote below.</>
                  : (REASON_HELP[c.reason] || c.message || `The check failed (${c.reason}).`)}
              </div>
              {c.source?.url && (
                <div className="text-xs text-retro-navy/60 mt-1 font-mono break-all">{c.source.url}</div>
              )}
              {c.lastGood?.latest && (
                <div className="text-xs text-retro-navy/70 mt-1.5">
                  Last successful check: v{c.lastGood.latest} ({timeAgo(c.lastGood.checkedAt)}).
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {throttled && (
        <div className="max-w-2xl text-xs text-retro-navy/60 flex items-center gap-2">
          <Info size={13} className="text-retro-teal" />
          Checked a moment ago — the result above is from that check.
        </div>
      )}

      {/* ── How this install upgrades, in every state ─────────────
          Deliberately outside the "an update exists" block: the question "how
          would I update this?" is worth answering before there is anything to
          update, so the process is defined rather than discovered at the moment
          it is needed. Collapsed by default — it is reference, not a call to
          action. */}
      {status?.installPath?.steps?.length > 0 && (
        <details className="max-w-3xl rounded-xl border border-retro-mint/60 bg-retro-mint/10 px-4 py-3">
          <summary className="text-sm font-semibold text-retro-navy cursor-pointer">
            How this {status.installPath.method} install upgrades
          </summary>
          <div className="mt-3 space-y-2">
            <pre className="overflow-x-auto rounded-lg bg-retro-navy text-retro-white text-xs p-3 font-mono leading-relaxed">
{status.installPath.steps.join('\n')}
            </pre>
            <div className="flex items-start justify-between gap-3">
              <p className="text-xs text-retro-navy/60">{status.installPath.note}</p>
              <CopyButton text={status.installPath.steps.join('\n')} label="Copy steps" />
            </div>
            {status.docs && (
              <p className="text-xs text-retro-navy/60">
                Full instructions: <span className="font-mono">{status.docs}</span>
              </p>
            )}
          </div>
        </details>
      )}

      {/* ── Footnote: where the source comes from ─────────────────
          Read-only on purpose. The release source is an operator setting in the
          config file (or the environment), not something a web panel writes —
          so this only reports it, and names the file to edit. */}
      {status && (
        <div className="max-w-2xl border-t border-retro-mint/40 pt-4 space-y-1.5">
          <div className="text-xs text-retro-navy">
            <span className="font-semibold">Release source:</span>{' '}
            {configuredSource
              ? <span className="font-mono break-all">{configuredSource}</span>
              : <span className="font-semibold">not set</span>}
            {configuredSource && status.source?.from === 'env' && (
              <span className="text-retro-navy/60"> (from {status.sourceEnvVar})</span>
            )}
          </div>

          <div className="text-xs text-retro-navy/60">
            To set it: <span className="font-mono">update.sourceUrl</span> in{' '}
            <span className="font-mono break-all">{status.configFile || 'the server config file'}</span>
            {status.sourceEnvVar ? <>, or <span className="font-mono">{status.sourceEnvVar}</span> in the environment</> : null}.
            {status.configFile && status.configFileExists === false && (
              <> That file does not exist yet — copy{' '}
                <span className="font-mono">{status.configExample || 'config/spore-photos.config.example.json'}</span> to it first.</>
            )}{' '}
            An install checks nothing until an address is set.
          </div>

          {skippedSource && (
            <div className="text-xs text-retro-red bg-retro-red/10 border border-retro-red/30 rounded-lg px-3 py-2">
              The address in that file — <span className="font-mono break-all">{skippedSource}</span> — is
              not a usable http:// or https:// URL, so nothing is being checked.
            </div>
          )}

          <div className="text-xs text-retro-navy/60">
            Point it at the <span className="font-mono">release.json</span> of whoever you follow: it sits
            at the root of that project's repository, and a fork publishes its own. Once it is set, this
            panel says whether a newer release exists, what it changes, and what upgrading involves —
            the steps are under <em>How this {(status.installPath?.method) || 'install'} install upgrades</em>.
            Full instructions: <span className="font-mono">{status.docs || 'docs/INSTALL.md'}</span>.
          </div>
        </div>
      )}
    </div>
  );
}
