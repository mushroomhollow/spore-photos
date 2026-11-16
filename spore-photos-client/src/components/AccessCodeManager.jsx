import { useState, useEffect } from 'react';
import { Key, Plus, Trash2, Clock, X, Copy, Check, User, Users } from 'lucide-react';
import { fetchAccessCodes, createAccessCode, deleteAccessCode, fetchUsers } from '../api/client';

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

function timeRemaining(iso) {
  if (!iso) return '—';
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return 'Expired';
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  return `${h}h ${m}m remaining`;
}

export default function AccessCodeManager() {
  const [codes, setCodes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Create form state
  const [showForm, setShowForm] = useState(false);
  const [label, setLabel] = useState('');
  const [expiresInHours, setExpiresInHours] = useState(24);
  const [maxUses, setMaxUses] = useState('');
  const [newCode, setNewCode] = useState(null);
  const [creating, setCreating] = useState(false);

  // Copy feedback
  const [copied, setCopied] = useState(false);

  // User selection for existing-user codes
  const [users, setUsers] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [targetUserId, setTargetUserId] = useState('');

  const loadCodes = async () => {
    try {
      setLoading(true);
      const data = await fetchAccessCodes();
      setCodes(data.codes || []);
      setError(null);
    } catch (e) {
      setError('Failed to load access codes');
    } finally {
      setLoading(false);
    }
  };

  const loadUsers = async () => {
    if (users.length > 0) return; // already loaded
    setLoadingUsers(true);
    try {
      const data = await fetchUsers();
      setUsers(data.users || []);
    } catch (e) {
      // silently fail — user dropdown just won't show
    } finally {
      setLoadingUsers(false);
    }
  };

  useEffect(() => {
    loadCodes();
  }, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    setCreating(true);
    try {
      const result = await createAccessCode(
        label || 'Shared access',
        expiresInHours,
        maxUses ? parseInt(maxUses) : null,
        targetUserId || null
      );
      setNewCode(result.code);
      setShowForm(false);
      setLabel('');
      setExpiresInHours(24);
      setMaxUses('');
      setTargetUserId('');
      loadCodes();
    } catch (e) {
      setError('Failed to create access code');
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id) => {
    try {
      await deleteAccessCode(id);
      loadCodes();
    } catch (e) {
      setError('Failed to delete access code');
    }
  };

  const copyToClipboard = async (code) => {
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      // Fallback for non-secure context (LAN IP, etc.)
      const textarea = document.createElement('textarea');
      textarea.value = code;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-retro-navy flex items-center gap-2">
            <Key size={24} />
            Access Codes
          </h2>
          <p className="text-retro-teal text-sm mt-1">
            Create and manage access codes for family sharing
          </p>
        </div>
        <button
          onClick={() => { setShowForm(true); loadUsers(); }}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-retro-navy text-retro-cream hover:bg-retro-teal transition-colors text-sm font-semibold"
        >
          <Plus size={16} />
          New Code
        </button>
      </div>

      {error && (
        <div className="bg-retro-red/10 border border-retro-red/30 rounded-xl p-3 text-retro-red text-sm mb-4">
          {error}
        </div>
      )}

      {/* New code banner */}
      {newCode && (
        <div className="bg-retro-mint/20 border-2 border-retro-mint rounded-xl p-4 mb-6">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="font-bold text-retro-navy text-lg mb-1">New Access Code Created!</h3>
              <p className="text-retro-teal text-sm mb-2">
                Share this code securely with the person you want to grant access:
              </p>
              <div className="flex items-center gap-2">
                <code className="bg-retro-navy text-retro-cream px-4 py-2 rounded-lg text-lg font-mono tracking-wider">
                  {newCode}
                </code>
                <button
                  onClick={() => copyToClipboard(newCode)}
                  className="p-2 rounded-lg bg-retro-navy text-retro-cream hover:bg-retro-teal transition-colors"
                  title="Copy code"
                >
                  {copied ? <Check size={18} /> : <Copy size={18} />}
                </button>
              </div>
            </div>
            <button
              onClick={() => setNewCode(null)}
              className="text-retro-teal hover:text-retro-navy transition-colors"
            >
              <X size={20} />
            </button>
          </div>
        </div>
      )}

      {/* Create form modal inline */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowForm(false)}>
          <div
            className="bg-retro-white rounded-2xl p-6 w-full max-w-md shadow-2xl border-2 border-retro-mint"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-retro-navy">Create Access Code</h3>
              <button onClick={() => setShowForm(false)} className="text-retro-teal hover:text-retro-navy">
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-retro-navy mb-1">Label</label>
                <input
                  type="text"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="e.g. Grandma's access"
                  className="w-full px-3 py-2 rounded-lg border-2 border-retro-mint bg-retro-cream/30 text-retro-navy focus:outline-none focus:border-retro-teal"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-retro-navy mb-1">For</label>
                <select
                  value={targetUserId}
                  onChange={(e) => setTargetUserId(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border-2 border-retro-mint bg-retro-cream/30 text-retro-navy focus:outline-none focus:border-retro-teal appearance-none cursor-pointer"
                >
                  <option value="">New user (registration)</option>
                  {loadingUsers ? (
                    <option disabled>Loading users...</option>
                  ) : (
                    users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.display_name} (@{u.username}) — {u.role}
                      </option>
                    ))
                  )}
                </select>
                {targetUserId && (
                  <p className="text-xs text-retro-teal mt-1 flex items-center gap-1">
                    <User size={12} />
                    This code lets the user set a new password and then sign in
                  </p>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-semibold text-retro-navy mb-1">Expires in (hours)</label>
                  <input
                    type="number"
                    value={expiresInHours}
                    onChange={(e) => setExpiresInHours(e.target.value)}
                    min={1}
                    max={8760}
                    className="w-full px-3 py-2 rounded-lg border-2 border-retro-mint bg-retro-cream/30 text-retro-navy focus:outline-none focus:border-retro-teal"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-retro-navy mb-1">
                    Max uses <span className="text-retro-teal font-normal">(blank=∞)</span>
                  </label>
                  <input
                    type="number"
                    value={maxUses}
                    onChange={(e) => setMaxUses(e.target.value)}
                    min={1}
                    placeholder="Unlimited"
                    className="w-full px-3 py-2 rounded-lg border-2 border-retro-mint bg-retro-cream/30 text-retro-navy focus:outline-none focus:border-retro-teal"
                  />
                </div>
              </div>
              <button
                type="submit"
                disabled={creating}
                className="w-full py-2 rounded-lg bg-retro-navy text-retro-cream font-bold hover:bg-retro-teal transition-colors disabled:opacity-50"
              >
                {creating ? 'Creating...' : 'Generate Code'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Code list */}
      {loading ? (
        <div className="text-center py-12 text-retro-teal animate-pulse">Loading access codes...</div>
      ) : codes.length === 0 ? (
        <div className="text-center py-12">
          <Key size={48} className="text-retro-mint mx-auto mb-3" />
          <p className="text-retro-teal text-lg">No access codes yet</p>
          <p className="text-retro-teal text-sm">Create one to share with family and friends</p>
        </div>
      ) : (
        <div className="space-y-3">
          {codes.map((code) => {
            const expired = new Date(code.expires_at).getTime() <= Date.now();
            return (
              <div
                key={code.id}
                className={`rounded-xl p-4 border-2 shadow-sm flex items-center justify-between ${
                  code.is_active && !expired
                    ? 'bg-retro-cream border-retro-mint'
                    : 'bg-retro-cream/50 border-retro-mint/40 opacity-60'
                }`}
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-semibold text-retro-navy">{code.label}</span>
                    {!code.is_active && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-retro-red/20 text-retro-red font-semibold">
                        Deactivated
                      </span>
                    )}
                    {code.is_active && expired && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-retro-red/20 text-retro-red font-semibold">
                        Expired
                      </span>
                    )}
                    {code.is_active && !expired && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-retro-mint/40 text-retro-navy font-semibold">
                        Active
                      </span>
                    )}
                    {code.target_user_id && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-retro-teal/20 text-retro-navy font-semibold">
                        <Users size={10} className="inline mr-0.5" />
                        {code.target_username || 'Existing user'}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-4 text-xs text-retro-teal">
                    <span className="flex items-center gap-1">
                      <Clock size={12} />
                      Expires: {formatDate(code.expires_at)}
                    </span>
                    <span>{timeRemaining(code.expires_at)}</span>
                    <span>
                      Uses: {code.used_count}{code.max_uses ? ` / ${code.max_uses}` : ' / ∞'}
                    </span>
                    <span>Created: {formatDate(code.created_at)}</span>
                  </div>
                </div>
                {code.is_active && !expired && (
                  <button
                    onClick={() => handleDelete(code.id)}
                    className="p-2 rounded-lg text-retro-red/60 hover:text-retro-red hover:bg-retro-red/10 transition-colors"
                    title="Deactivate code"
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
