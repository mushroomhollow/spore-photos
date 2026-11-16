import { useState, useEffect, useCallback } from 'react';
import {
  checkAuth, login, checkCode, registerFromCode, setPasswordFromCode,
} from '../api/client';
import { Camera, KeyRound, Shield, UserPlus, AlertTriangle, Lock } from 'lucide-react';

const STEPS = {
  LOADING: 'loading',
  AUTO_LOGIN: 'auto_login',
  LOGIN: 'login',
  CODE: 'code',
  REGISTER: 'register',
  SET_PASSWORD: 'set_password',
  BLACKLISTED: 'blacklisted',
};

export default function LoginPage({ onLogin }) {
  const [step, setStep] = useState(STEPS.LOADING);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [statusInfo, setStatusInfo] = useState({});

  // Login form
  const [loginUser, setLoginUser] = useState('');
  const [loginPass, setLoginPass] = useState('');

  // Code form
  const [code, setCode] = useState('');
  const [codeRemaining, setCodeRemaining] = useState(3);
  const [regToken, setRegToken] = useState(null);

  // Registration form
  const [regUser, setRegUser] = useState('');
  const [regPass, setRegPass] = useState('');
  const [regDisplay, setRegDisplay] = useState('');

  // Set-password form (existing user via code)
  const [setPass, setSetPass] = useState('');
  const [setPassConfirm, setSetPassConfirm] = useState('');
  const [targetUsername, setTargetUsername] = useState('');

  // ─── Initial auth check ─────────────────────────────────
  useEffect(() => {
    checkAuth()
      .then(data => {
        if (data.status === 'auto_login' && data.user) {
          onLogin(data.user);
          return;
        }
        if (data.status === 'login_required') {
          setStatusInfo(data);
          setStep(STEPS.LOGIN);
          return;
        }
        if (data.status === 'code_required') {
          setStep(STEPS.CODE);
          return;
        }
        // Fallback / unknown — show code
        setStep(STEPS.CODE);
      })
      .catch(err => {
        if (err.response?.status === 403) {
          setStep(STEPS.BLACKLISTED);
        } else {
          setStep(STEPS.CODE);
        }
      });
  }, [onLogin]);

  // ─── Handle login submission ────────────────────────────
  const handleLogin = useCallback(async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await login(loginUser, loginPass);
      onLogin(result.user);
    } catch (err) {
      setError(err.response?.data?.error || 'Login failed');
    } finally {
      setLoading(false);
    }
  }, [loginUser, loginPass, onLogin]);

  // ─── Handle code submission ─────────────────────────────
  const handleCode = useCallback(async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await checkCode(code);
      if (result.success && result.reg_token) {
        if (result.type === 'set_password') {
          setRegToken(result.reg_token);
          setTargetUsername(result.target_username || '');
          setStep(STEPS.SET_PASSWORD);
        } else {
          setRegToken(result.reg_token);
          setStep(STEPS.LOGIN);
        }
      }
    } catch (err) {
      if (err.response?.status === 403) {
        setStep(STEPS.BLACKLISTED);
        return;
      }
      const msg = err.response?.data?.error || 'Invalid code';
      setError(msg);
      if (err.response?.data?.remaining !== undefined) {
        setCodeRemaining(err.response.data.remaining);
      } else {
        setCodeRemaining(prev => Math.max(0, prev - 1));
      }
    } finally {
      setLoading(false);
    }
  }, [code]);

  // ─── Handle registration ────────────────────────────────
  const handleRegister = useCallback(async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await registerFromCode(regToken, regUser, regPass, regDisplay);
      onLogin(result.user);
    } catch (err) {
      setError(err.response?.data?.error || 'Registration failed');
    } finally {
      setLoading(false);
    }
  }, [regToken, regUser, regPass, regDisplay, onLogin]);

  // ─── Handle set-password (existing user) ────────────────
  const handleSetPassword = useCallback(async (e) => {
    e.preventDefault();
    setError('');

    if (!setPass || !setPassConfirm) {
      setError('All fields are required.');
      return;
    }
    if (setPass.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (setPass !== setPassConfirm) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      await setPasswordFromCode(regToken, setPass);
      // Password updated — redirect to login
      setRegToken(null);
      setSetPass('');
      setSetPassConfirm('');
      setTargetUsername('');
      setStep(STEPS.LOGIN);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to set password');
    } finally {
      setLoading(false);
    }
  }, [regToken, setPass, setPassConfirm]);

  // ─── Loading ────────────────────────────────────────────
  if (step === STEPS.LOADING) {
    return (
      <LoadingScreen />
    );
  }

  // ─── Blacklisted ────────────────────────────────────────
  if (step === STEPS.BLACKLISTED) {
    return (
      <AuthLayout>
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-20 h-20 bg-retro-red rounded-full mb-4">
            <AlertTriangle size={36} className="text-retro-white" />
          </div>
          <h1 className="text-3xl font-bold text-retro-navy mb-2">Access Denied</h1>
          <p className="text-retro-teal">
            This device has been blocked. Contact the administrator if you believe this is an error.
          </p>
        </div>
      </AuthLayout>
    );
  }

  // ─── Login form ─────────────────────────────────────────
  if (step === STEPS.LOGIN) {
    return (
      <AuthLayout>
        <div className="text-center mb-6">
          <Camera size={40} className="text-retro-navy mx-auto mb-2" />
          <h1 className="text-3xl font-bold text-retro-navy">Spore-Photos</h1>
          <p className="text-retro-teal text-sm">Sign in to continue</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-retro-navy font-semibold mb-1 text-xs uppercase tracking-wide">
              Username
            </label>
            <input
              type="text" value={loginUser}
              onChange={e => setLoginUser(e.target.value)}
              className="w-full px-4 py-3 rounded-xl bg-retro-white text-retro-navy border-2 border-retro-mint focus:border-retro-teal focus:outline-none transition-colors"
              placeholder="Your username" autoFocus required
            />
          </div>
          <div>
            <label className="block text-retro-navy font-semibold mb-1 text-xs uppercase tracking-wide">
              Password
            </label>
            <input
              type="password" value={loginPass}
              onChange={e => setLoginPass(e.target.value)}
              className="w-full px-4 py-3 rounded-xl bg-retro-white text-retro-navy border-2 border-retro-mint focus:border-retro-teal focus:outline-none transition-colors"
              placeholder="Your password" required
            />
          </div>

          {error && (
            <div className="p-3 rounded-xl bg-retro-red/10 border border-retro-red text-retro-red text-sm font-semibold">
              {error}
            </div>
          )}

          <button type="submit" disabled={loading}
            className="w-full py-3 rounded-xl bg-retro-navy text-retro-white font-bold hover:bg-retro-teal transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            <KeyRound size={18} />
            {loading ? 'Signing in...' : 'Sign In'}
          </button>

          <div className="text-center mt-4">
            <button
              type="button"
              onClick={() => { setError(''); setStep(STEPS.CODE); }}
              className="text-retro-teal text-sm hover:text-retro-navy underline transition-colors cursor-pointer"
            >
              Enter an Access Code Instead
            </button>
          </div>

          {regToken && (
            <div className="text-center mt-4">
              <span className="text-retro-teal text-sm">Don't have an account? </span>
              <button
                type="button"
                onClick={() => setStep(STEPS.REGISTER)}
                className="text-retro-orange font-semibold text-sm hover:underline cursor-pointer"
              >
                Create one here
              </button>
            </div>
          )}
        </form>
      </AuthLayout>
    );
  }

  // ─── Code entry ─────────────────────────────────────────
  if (step === STEPS.CODE) {
    return (
      <AuthLayout>
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-retro-navy rounded-full mb-3">
            <Shield size={28} className="text-retro-cream" />
          </div>
          <h1 className="text-2xl font-bold text-retro-navy">Access Code Required</h1>
          <p className="text-retro-teal text-sm mt-1">
            Enter an access code shared with you
          </p>
        </div>

        <form onSubmit={handleCode} className="space-y-4">
          <div>
            <input
              type="text" value={code}
              onChange={e => setCode(e.target.value.toUpperCase())}
              className="w-full px-4 py-3 rounded-xl bg-retro-white text-retro-navy border-2 border-retro-mint focus:border-retro-teal focus:outline-none transition-colors text-center text-lg tracking-widest font-bold"
              placeholder="XXXX-XXXX" maxLength={9}
              autoFocus required
            />
            <p className="text-xs text-retro-teal text-center mt-1">
              {codeRemaining} attempt{codeRemaining !== 1 ? 's' : ''} remaining
            </p>
          </div>

          {error && (
            <div className="p-3 rounded-xl bg-retro-red/10 border border-retro-red text-retro-red text-sm font-semibold text-center">
              {error}
            </div>
          )}

          <button type="submit" disabled={loading}
            className="w-full py-3 rounded-xl bg-retro-navy text-retro-white font-bold hover:bg-retro-teal transition-colors disabled:opacity-50"
          >
            {loading ? 'Checking...' : 'Verify Code'}
          </button>
        </form>
      </AuthLayout>
    );
  }

  // ─── Set new password (existing user via code) ─────────
  if (step === STEPS.SET_PASSWORD) {
    return (
      <AuthLayout>
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-retro-teal rounded-full mb-3">
            <Lock size={28} className="text-retro-white" />
          </div>
          <h1 className="text-2xl font-bold text-retro-navy">Set New Password</h1>
          <p className="text-retro-teal text-sm mt-1">
            {targetUsername
              ? `Choose a new password for @${targetUsername}`
              : 'Choose a new password for your account'}
          </p>
        </div>

        <form onSubmit={handleSetPassword} className="space-y-4">
          <div>
            <label className="block text-retro-navy font-semibold mb-1 text-xs uppercase tracking-wide">
              New Password
            </label>
            <input
              type="password" value={setPass}
              onChange={e => setSetPass(e.target.value)}
              className="w-full px-4 py-3 rounded-xl bg-retro-white text-retro-navy border-2 border-retro-mint focus:border-retro-teal focus:outline-none transition-colors"
              placeholder="Enter new password (min 6 chars)" required minLength={6} autoFocus
            />
          </div>
          <div>
            <label className="block text-retro-navy font-semibold mb-1 text-xs uppercase tracking-wide">
              Confirm New Password
            </label>
            <input
              type="password" value={setPassConfirm}
              onChange={e => setSetPassConfirm(e.target.value)}
              className="w-full px-4 py-3 rounded-xl bg-retro-white text-retro-navy border-2 border-retro-mint focus:border-retro-teal focus:outline-none transition-colors"
              placeholder="Re-enter new password" required minLength={6}
            />
          </div>

          <p className="text-xs text-retro-teal text-center">
            After setting your password, you'll be asked to sign in with it
          </p>

          {error && (
            <div className="p-3 rounded-xl bg-retro-red/10 border border-retro-red text-retro-red text-sm font-semibold">
              {error}
            </div>
          )}

          <button type="submit" disabled={loading}
            className="w-full py-3 rounded-xl bg-retro-teal text-retro-white font-bold hover:bg-retro-navy transition-colors disabled:opacity-50"
          >
            {loading ? 'Setting password...' : 'Set Password & Continue'}
          </button>
        </form>
      </AuthLayout>
    );
  }

  // ─── Registration (after successful code) ──────────────
  if (step === STEPS.REGISTER) {
    return (
      <AuthLayout>
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-retro-teal rounded-full mb-3">
            <UserPlus size={28} className="text-retro-white" />
          </div>
          <h1 className="text-2xl font-bold text-retro-navy">Create Your Account</h1>
          <p className="text-retro-teal text-sm mt-1">
            Set up your username and password
          </p>
        </div>

        <form onSubmit={handleRegister} className="space-y-4">
          <div>
            <label className="block text-retro-navy font-semibold mb-1 text-xs uppercase tracking-wide">
              Display Name
            </label>
            <input
              type="text" value={regDisplay}
              onChange={e => setRegDisplay(e.target.value)}
              className="w-full px-4 py-3 rounded-xl bg-retro-white text-retro-navy border-2 border-retro-mint focus:border-retro-teal focus:outline-none transition-colors"
              placeholder="Your name (e.g. Mom, Dad)" autoFocus
            />
          </div>
          <div>
            <label className="block text-retro-navy font-semibold mb-1 text-xs uppercase tracking-wide">
              Username
            </label>
            <input
              type="text" value={regUser}
              onChange={e => setRegUser(e.target.value)}
              className="w-full px-4 py-3 rounded-xl bg-retro-white text-retro-navy border-2 border-retro-mint focus:border-retro-teal focus:outline-none transition-colors"
              placeholder="Choose a username" required
            />
          </div>
          <div>
            <label className="block text-retro-navy font-semibold mb-1 text-xs uppercase tracking-wide">
              Password
            </label>
            <input
              type="password" value={regPass}
              onChange={e => setRegPass(e.target.value)}
              className="w-full px-4 py-3 rounded-xl bg-retro-white text-retro-navy border-2 border-retro-mint focus:border-retro-teal focus:outline-none transition-colors"
              placeholder="Choose a password" required minLength={6}
            />
          </div>

          {error && (
            <div className="p-3 rounded-xl bg-retro-red/10 border border-retro-red text-retro-red text-sm font-semibold">
              {error}
            </div>
          )}

          <button type="submit" disabled={loading}
            className="w-full py-3 rounded-xl bg-retro-teal text-retro-white font-bold hover:bg-retro-navy transition-colors disabled:opacity-50"
          >
            {loading ? 'Creating account...' : 'Create Account & Sign In'}
          </button>
        </form>
      </AuthLayout>
    );
  }

  return null;
}

// ─── Shared layout wrapper ──────────────────────────────
function AuthLayout({ children }) {
  return (
    <div className="min-h-screen bg-retro-white flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-retro-cream rounded-2xl p-8 shadow-lg border-2 border-retro-mint">
        {children}
        <p className="text-center mt-6 text-retro-teal text-xs">
          &copy; {new Date().getFullYear()} Mushroom Hollow
        </p>
      </div>
    </div>
  );
}

// ─── Loading screen ─────────────────────────────────────
function LoadingScreen() {
  return (
    <div className="min-h-screen bg-retro-white flex items-center justify-center">
      <div className="text-center">
        <Camera size={48} className="text-retro-navy mx-auto mb-3 animate-pulse" />
        <div className="text-retro-navy text-lg font-semibold animate-pulse">
          Spore-Photos
        </div>
      </div>
    </div>
  );
}
