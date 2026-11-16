import { useState } from 'react';
import { Lock, Eye, EyeOff, CheckCircle, AlertCircle } from 'lucide-react';
import { changePassword } from '../api/client';

export default function ChangePasswordForm() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [status, setStatus] = useState(null); // { type: 'success'|'error', message }

  const handleSubmit = async (e) => {
    e.preventDefault();
    setStatus(null);

    if (!currentPassword || !newPassword || !confirmPassword) {
      setStatus({ type: 'error', message: 'All fields are required.' });
      return;
    }

    if (newPassword.length < 6) {
      setStatus({ type: 'error', message: 'New password must be at least 6 characters.' });
      return;
    }

    if (newPassword !== confirmPassword) {
      setStatus({ type: 'error', message: 'New passwords do not match.' });
      return;
    }

    if (currentPassword === newPassword) {
      setStatus({ type: 'error', message: 'New password must be different from current password.' });
      return;
    }

    try {
      const result = await changePassword(currentPassword, newPassword);
      if (result.success) {
        setStatus({ type: 'success', message: 'Password changed successfully!' });
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
      }
    } catch (err) {
      const msg = err?.response?.data?.error || 'Password change failed. Please try again.';
      setStatus({ type: 'error', message: msg });
    }
  };

  return (
    <div className="p-6 max-w-lg mx-auto">
      <div className="mb-6">
        <h4 className="text-retro-navy font-bold text-base flex items-center gap-2">
          <Lock size={18} />
          Change Password
        </h4>
        <p className="text-retro-teal text-sm mt-1">
          Update your account password.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Current Password */}
        <div>
          <label className="block text-sm font-semibold text-retro-navy mb-1.5">
            Current Password
          </label>
          <div className="relative">
            <input
              type={showCurrent ? 'text' : 'password'}
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="w-full px-3 py-2.5 pr-10 rounded-lg border border-retro-mint/50 bg-white text-retro-navy text-sm focus:outline-none focus:ring-2 focus:ring-retro-teal/40 focus:border-retro-teal placeholder:text-retro-teal/40"
              placeholder="Enter current password"
              autoComplete="current-password"
            />
            <button
              type="button"
              onClick={() => setShowCurrent(!showCurrent)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-retro-teal/60 hover:text-retro-navy"
              tabIndex={-1}
            >
              {showCurrent ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>

        {/* New Password */}
        <div>
          <label className="block text-sm font-semibold text-retro-navy mb-1.5">
            New Password
          </label>
          <div className="relative">
            <input
              type={showNew ? 'text' : 'password'}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full px-3 py-2.5 pr-10 rounded-lg border border-retro-mint/50 bg-white text-retro-navy text-sm focus:outline-none focus:ring-2 focus:ring-retro-teal/40 focus:border-retro-teal placeholder:text-retro-teal/40"
              placeholder="Enter new password (min 6 chars)"
              autoComplete="new-password"
            />
            <button
              type="button"
              onClick={() => setShowNew(!showNew)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-retro-teal/60 hover:text-retro-navy"
              tabIndex={-1}
            >
              {showNew ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>

        {/* Confirm New Password */}
        <div>
          <label className="block text-sm font-semibold text-retro-navy mb-1.5">
            Confirm New Password
          </label>
          <div className="relative">
            <input
              type={showConfirm ? 'text' : 'password'}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full px-3 py-2.5 pr-10 rounded-lg border border-retro-mint/50 bg-white text-retro-navy text-sm focus:outline-none focus:ring-2 focus:ring-retro-teal/40 focus:border-retro-teal placeholder:text-retro-teal/40"
              placeholder="Re-enter new password"
              autoComplete="new-password"
            />
            <button
              type="button"
              onClick={() => setShowConfirm(!showConfirm)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-retro-teal/60 hover:text-retro-navy"
              tabIndex={-1}
            >
              {showConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>

        {/* Submit */}
        <button
          type="submit"
          className="w-full py-2.5 rounded-lg bg-retro-navy text-retro-cream font-bold text-sm hover:bg-retro-teal transition-colors"
        >
          Update Password
        </button>
      </form>

      {/* Status message */}
      {status && (
        <div
          className={`mt-5 flex items-start gap-2.5 p-3 rounded-lg text-sm ${
            status.type === 'success'
              ? 'bg-retro-mint/20 text-retro-navy border border-retro-mint/40'
              : 'bg-red-50 text-retro-red border border-red-200'
          }`}
        >
          {status.type === 'success' ? (
            <CheckCircle size={16} className="shrink-0 mt-0.5" />
          ) : (
            <AlertCircle size={16} className="shrink-0 mt-0.5" />
          )}
          <span>{status.message}</span>
        </div>
      )}
    </div>
  );
}
