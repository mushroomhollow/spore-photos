import { useState, useEffect } from 'react';
import { ArrowLeft, Trash2, Globe, Smartphone, Cpu, Calendar, AlertCircle, CheckCircle, XCircle } from 'lucide-react';
import { fetchUserWhitelist, deleteWhitelistEntry, deleteSession } from '../api/client';

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

export default function UserDetail({ user, onBack }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadData = async () => {
    try {
      setLoading(true);
      const result = await fetchUserWhitelist(user.id);
      setData(result);
      setError(null);
    } catch (e) {
      setError('Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, [user.id]);

  const handleDeleteIp = async (ip) => {
    if (!confirm(`Forget address ${ip}?`)) return;
    try {
      await deleteWhitelistEntry(ip);
      loadData();
    } catch (e) {
      setError(e?.response?.data?.error || 'Failed to remove IP');
    }
  };

  const handleDeleteSession = async (s) => {
    if (!confirm(`Terminate this session? The user will be logged out.`)) return;
    try {
      await deleteSession(s.id);
      loadData();
    } catch (e) {
      setError(e?.response?.data?.error || 'Failed to delete session');
    }
  };

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-retro-teal hover:text-retro-navy transition-colors text-sm font-semibold mb-3"
        >
          <ArrowLeft size={16} />
          Back to Users
        </button>
        <div className="flex items-center gap-3">
          <div className={`w-12 h-12 rounded-full flex items-center justify-center text-lg font-bold ${
            user.role === 'admin' ? 'bg-retro-navy text-retro-cream' : 'bg-retro-teal text-retro-white'
          }`}>
            {user.display_name.charAt(0).toUpperCase()}
          </div>
          <div>
            <h2 className="text-xl font-bold text-retro-navy">{user.display_name}</h2>
            <p className="text-retro-teal text-sm">@{user.username} &middot; {user.role}</p>
          </div>
        </div>
      </div>

      {/* Last Login */}
      <div className="bg-retro-cream rounded-xl p-4 border-2 border-retro-mint mb-4">
        <div className="flex items-center gap-2 text-sm text-retro-teal">
          <Calendar size={14} />
          <span className="font-semibold text-retro-navy">Last Login:</span>
          {user.last_login ? formatDate(user.last_login) : 'Never'}
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 bg-retro-red/10 border border-retro-red/30 rounded-xl p-3 text-retro-red text-sm mb-4">
          <AlertCircle size={14} />
          {error}
        </div>
      )}

      {/* IP Addresses */}
      <div className="mb-6">
        <h3 className="text-retro-navy font-bold text-base flex items-center gap-2 mb-3">
          <Globe size={16} />
          IP Addresses ({data?.ip_addresses?.length || 0})
        </h3>
        {loading ? (
          <div className="text-center py-6 text-retro-teal animate-pulse text-sm">Loading...</div>
        ) : data?.ip_addresses?.length === 0 ? (
          <div className="text-retro-teal/60 text-sm italic py-3 text-center">No IP records</div>
        ) : (
          <div className="space-y-2">
            {data?.ip_addresses?.map((ip, i) => (
              <div key={`ip-${i}`} className="flex items-center justify-between bg-retro-cream/60 rounded-lg px-4 py-3 border border-retro-mint/40 group hover:border-retro-mint transition-colors">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <code className="text-sm font-mono text-retro-navy bg-retro-cream px-2 py-0.5 rounded">{ip.ip}</code>
                    {ip.whitelisted && !ip.blacklisted && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-retro-mint/40 text-retro-navy font-semibold flex items-center gap-1">
                        <CheckCircle size={10} /> known
                      </span>
                    )}
                    {ip.blacklisted && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-retro-red/20 text-retro-red font-semibold flex items-center gap-1">
                        <XCircle size={10} /> blacklisted
                      </span>
                    )}
                    {!ip.whitelisted && !ip.blacklisted && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-retro-teal/10 text-retro-teal/60 font-semibold">seen</span>
                    )}
                  </div>
                  <p className="text-xs text-retro-teal/70 mt-1">
                    Added {formatDate(ip.create_date)}
                    {ip.notes && <span className="ml-2 italic">{ip.notes}</span>}
                  </p>
                </div>
                {ip.whitelisted && (
                  <button
                    onClick={() => handleDeleteIp(ip.ip)}
                    className="p-1.5 rounded-lg text-retro-red/40 hover:text-retro-red hover:bg-retro-red/10 transition-colors opacity-0 group-hover:opacity-100"
                    title="Forget this address"
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Known Devices */}
      <div className="mb-6">
        <h3 className="text-retro-navy font-bold text-base flex items-center gap-2 mb-3">
          <Cpu size={16} />
          Known Devices ({data?.devices?.length || 0})
        </h3>
        {loading ? (
          <div className="text-center py-6 text-retro-teal animate-pulse text-sm">Loading...</div>
        ) : data?.devices?.length === 0 ? (
          <div className="text-retro-teal/60 text-sm italic py-3 text-center">No devices recorded</div>
        ) : (
          <div className="space-y-2">
            {data?.devices?.map((d, i) => (
              <div key={`dev-${i}`} className="flex items-center justify-between bg-retro-cream/60 rounded-lg px-4 py-3 border border-retro-mint/40 group hover:border-retro-mint transition-colors">
                <div className="min-w-0 flex-1">
                  <code className="text-xs font-mono text-retro-navy bg-retro-cream px-2 py-0.5 rounded">{d.device_id}</code>
                  <p className="text-xs text-retro-teal/70 mt-1">
                    First seen {formatDate(d.create_date)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Active Sessions */}
      <div>
        <h3 className="text-retro-navy font-bold text-base flex items-center gap-2 mb-3">
          <Smartphone size={16} />
          Active Sessions ({data?.sessions?.length || 0})
        </h3>
        {loading ? (
          <div className="text-center py-6 text-retro-teal animate-pulse text-sm">Loading...</div>
        ) : data?.sessions?.length === 0 ? (
          <div className="text-retro-teal/60 text-sm italic py-3 text-center">No active sessions</div>
        ) : (
          <div className="space-y-2">
            {data?.sessions?.map((s, i) => (
              <div key={`sess-${i}`} className="flex items-center justify-between bg-retro-cream/60 rounded-lg px-4 py-3 border border-retro-mint/40 group hover:border-retro-mint transition-colors">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    {s.ip && <code className="text-xs font-mono text-retro-navy bg-retro-cream px-1.5 py-0.5 rounded">{s.ip}</code>}
                    {s.device_id && <code className="text-xs font-mono text-retro-teal bg-retro-teal/10 px-1.5 py-0.5 rounded">{s.device_id}</code>}
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-retro-teal/20 text-retro-teal font-semibold">session</span>
                  </div>
                  <p className="text-xs text-retro-teal/70 mt-1">
                    Created {formatDate(s.create_date)}
                    {s.expire_date && <span> &middot; Expires {formatDate(s.expire_date)}</span>}
                    <span className="font-mono ml-2 opacity-40">{s.token?.substring(0, 12)}…</span>
                  </p>
                </div>
                <button
                  onClick={() => handleDeleteSession(s)}
                  className="p-1.5 rounded-lg text-retro-red/40 hover:text-retro-red hover:bg-retro-red/10 transition-colors opacity-0 group-hover:opacity-100"
                  title="Terminate session"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
