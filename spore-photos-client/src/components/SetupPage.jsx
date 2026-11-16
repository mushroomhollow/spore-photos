import { useState } from 'react';
import { Sprout, KeyRound, User, Lock, ArrowRight } from 'lucide-react';
import { submitSetup } from '../api/client';

/**
 * First-run wizard. Shown instead of the login form while the instance has no
 * user accounts. The setup token is printed in the server log at first boot
 * (or set via SETUP_TOKEN / setup.token in the deployment config).
 */
export default function SetupPage({ onComplete }) {
  const [token, setToken] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }

    setBusy(true);
    try {
      // Setup authorises this client and signs the new admin in directly.
      const data = await submitSetup({
        token: token.trim(),
        username: username.trim(),
        password,
        displayName: displayName.trim(),
      });
      if (data?.user) onComplete(data.user);
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || 'Setup failed.');
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-retro-white flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-retro-white border-2 border-retro-mint rounded-2xl shadow-xl p-6 sm:p-8">
        <div className="flex items-center gap-3 mb-2">
          <Sprout size={28} className="text-retro-teal" />
          <h1 className="text-2xl font-bold text-retro-navy">Welcome to Spore-Photos</h1>
        </div>
        <p className="text-sm text-retro-teal mb-6">
          Create the administrator account for this server. There is no default
          account — this is the only way in.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <Field
            id="setup-token"
            label="Setup token"
            icon={KeyRound}
            value={token}
            onChange={setToken}
            placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
            hint="Printed in the server log on first boot."
            mono
            autoFocus
          />
          <Field
            id="username"
            label="Admin username"
            icon={User}
            value={username}
            onChange={setUsername}
            placeholder="admin"
            hint="3–32 characters: letters, numbers, dot, dash, underscore."
          />
          <Field
            id="display-name"
            label="Display name"
            icon={User}
            value={displayName}
            onChange={setDisplayName}
            placeholder="Optional"
          />
          <Field
            id="password"
            label="Password"
            icon={Lock}
            type="password"
            value={password}
            onChange={setPassword}
            placeholder="At least 8 characters"
          />
          <Field
            id="confirm"
            label="Confirm password"
            icon={Lock}
            type="password"
            value={confirm}
            onChange={setConfirm}
            placeholder="Repeat password"
          />

          {error && (
            <div className="text-sm text-retro-red bg-retro-red/10 border border-retro-red/30 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-retro-teal text-white font-semibold text-sm hover:bg-retro-teal/80 disabled:opacity-50 transition-colors"
          >
            {busy ? 'Creating account…' : 'Create admin account'}
            {!busy && <ArrowRight size={16} />}
          </button>
        </form>
      </div>
    </div>
  );
}

function Field({ id, label, icon: Icon, value, onChange, placeholder, hint, type = 'text', mono = false, autoFocus = false }) {
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-semibold text-retro-navy/70 mb-1.5">
        {label}
      </label>
      <div className="flex items-center gap-2 px-3 rounded-lg border-2 border-retro-mint/60 bg-retro-white focus-within:border-retro-teal">
        <Icon size={16} className="text-retro-teal shrink-0" />
        <input
          id={id}
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoFocus={autoFocus}
          autoComplete={type === 'password' ? 'new-password' : 'off'}
          spellCheck={false}
          className={`flex-1 min-w-0 py-2 bg-transparent text-retro-navy text-sm outline-none ${mono ? 'font-mono' : ''}`}
        />
      </div>
      {hint && <p className="text-[11px] text-retro-teal/80 mt-1">{hint}</p>}
    </div>
  );
}