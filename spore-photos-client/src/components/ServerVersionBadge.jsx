import { useEffect, useState } from 'react';
import { ArrowUpCircle } from 'lucide-react';
import { fetchVersionStatus } from '../api/client';

/**
 * Top bar, right of Sign Out: which host this browser is talking to, which
 * release that server runs, and — quietly — whether a newer release exists.
 *
 * One request per page load, and that request is cheap by construction: the
 * server caches the release check for five minutes and issues no request at all
 * when no release source is configured. So opening the app often does not mean
 * fetching the release file often, and no scheduled job is needed to keep this
 * honest.
 *
 * Failures are silent on purpose. A nav bar is not the place to report a timeout
 * or a missing configuration; Settings → Server → Version & Updates says all of
 * it, in context, with the upgrade steps.
 */
export default function ServerVersionBadge({ onOpenUpdates = null }) {
  const [status, setStatus] = useState(null);

  useEffect(() => {
    let active = true;
    fetchVersionStatus()
      .then((data) => { if (active) setStatus(data); })
      .catch(() => { /* silent: the panel is where this is explained */ });
    return () => { active = false; };
  }, []);

  const host = typeof window === 'undefined' ? '' : window.location.host;
  // The server's own name when its operator set one (server.siteName / SITE_NAME),
  // otherwise the hostname this browser is on. Personalised without putting
  // anyone's domain in the code.
  const label = status?.siteName || host;
  const current = status?.current;
  const latest = status?.check?.ok && status.check.updateAvailable ? status.check.latest : null;

  const updateContent = latest ? (
    <>
      <ArrowUpCircle size={11} className="shrink-0" />
      <span className="truncate">Update: v{latest}</span>
    </>
  ) : null;

  return (
    <div className="flex flex-col items-end leading-tight text-right border-l border-retro-mint/40 pl-2 md:pl-3 shrink-0 max-w-[8rem] md:max-w-[15rem]">
      <span className="hidden md:inline text-[11px] font-mono text-retro-teal/80 truncate w-full" title={host}>
        {label}
      </span>
      <span className="text-[11px] font-mono text-retro-teal/80 truncate w-full md:hidden" title={host}>
        {label}
      </span>
      <span
        className="text-[11px] font-mono text-retro-navy/70"
        title={current ? `This server is running v${current}` : 'Server version unknown'}
      >
        {current ? `v${current}` : 'v—'}
      </span>
      {latest && (onOpenUpdates ? (
        <button
          type="button"
          onClick={onOpenUpdates}
          className="flex items-center gap-1 text-[11px] font-semibold text-retro-orange hover:underline"
          title={`v${latest} is available — open Version & Updates for the upgrade steps`}
        >
          {updateContent}
        </button>
      ) : (
        <span
          className="flex items-center gap-1 text-[11px] font-semibold text-retro-orange"
          title={`v${latest} is available`}
        >
          {updateContent}
        </span>
      ))}
    </div>
  );
}
