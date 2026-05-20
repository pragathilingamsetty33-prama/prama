import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { Lock, Mail, Key, User } from 'lucide-react';

const Login = () => {
    const queryParams = new URLSearchParams(window.location.search);
    const [isLogin, setIsLogin] = useState(queryParams.get('tab') !== 'register');
    const [email, setEmail] = useState('');
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [successMsg, setSuccessMsg] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [status, setStatus] = useState('');
    const [showMnemonicModal, setShowMnemonicModal] = useState(false);
    const [registeredMnemonic, setRegisteredMnemonic] = useState('');
    const [copied, setCopied] = useState(false);
    const [confirmed, setConfirmed] = useState(false);

    const { login, register } = useAuth();
    const navigate = useNavigate();

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setSuccessMsg('');
        setIsLoading(true);
        setStatus('Verifying credentials...');
        try {
            if (isLogin) {
                const userData = await login(email, password, (msg) => setStatus(msg));
                const queryParams = new URLSearchParams(window.location.search);
                const redirectUri = queryParams.get('redirect_uri');
                if (redirectUri) {
                    window.location.replace(`${redirectUri}#status=success&token=${userData.accessToken}`);
                    return;
                }
                navigate('/chat');
            } else {
                setStatus('Generating keys...');
                const result = await register(username, email, password);
                setRegisteredMnemonic(result.mnemonic);
                setShowMnemonicModal(true);
                setIsLogin(true);
                setPassword('');
            }
        } catch (err) {
            setError(err.message);
        } finally {
            setIsLoading(false);
            setStatus('');
        }
    };

    const handleCopy = () => {
        navigator.clipboard.writeText(registeredMnemonic);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const handleMnemonicDone = () => {
        setShowMnemonicModal(false);
        setConfirmed(false);
        setSuccessMsg('Account created! Please sign in with your credentials.');
    };

    return (
        <div style={{ display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'center' }}>

            {/* ✅ 12-Word Recovery Phrase Reveal Modal */}
            {showMnemonicModal && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.88)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
                    <div style={{ background: '#0d1117', border: '1px solid rgba(102,252,241,0.3)', borderRadius: '16px', padding: '36px', maxWidth: '500px', width: '100%', boxShadow: '0 0 40px rgba(102,252,241,0.15)' }}>
                        <div style={{ textAlign: 'center', marginBottom: '24px' }}>
                            <div style={{ fontSize: '40px', marginBottom: '10px' }}>🔑</div>
                            <h2 style={{ color: '#66fcf1', margin: '0 0 8px', fontSize: '22px', fontWeight: 'bold' }}>Your Recovery Phrase</h2>
                            <p style={{ color: '#ff6b6b', fontSize: '13px', margin: 0, fontWeight: '600', lineHeight: '1.5' }}>
                                ⚠️ Write these 12 words down NOW. You CANNOT recover your encrypted messages without them. They are never stored on the server.
                            </p>
                        </div>

                        {/* 12-Word Grid */}
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', marginBottom: '20px' }}>
                            {registeredMnemonic.split(' ').map((word, i) => (
                                <div key={i} style={{ background: 'rgba(102,252,241,0.07)', border: '1px solid rgba(102,252,241,0.2)', borderRadius: '8px', padding: '8px 10px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <span style={{ color: '#45a29e', fontSize: '11px', minWidth: '18px', fontWeight: 'bold' }}>{i + 1}.</span>
                                    <span style={{ color: '#e0e0e0', fontSize: '14px', fontWeight: '600', fontFamily: 'monospace' }}>{word}</span>
                                </div>
                            ))}
                        </div>

                        {/* Copy Button */}
                        <button
                            onClick={handleCopy}
                            style={{ width: '100%', padding: '10px', marginBottom: '16px', background: copied ? 'rgba(0,255,136,0.15)' : 'rgba(102,252,241,0.1)', border: `1px solid ${copied ? '#00ff88' : 'rgba(102,252,241,0.3)'}`, borderRadius: '8px', color: copied ? '#00ff88' : '#66fcf1', cursor: 'pointer', fontSize: '14px', fontWeight: '600', transition: 'all 0.2s' }}
                        >
                            {copied ? '✅ Copied to Clipboard!' : '📋 Copy All 12 Words'}
                        </button>

                        {/* Confirmation Checkbox */}
                        <label style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', cursor: 'pointer', marginBottom: '16px', padding: '12px', background: 'rgba(255,107,107,0.05)', borderRadius: '8px', border: '1px solid rgba(255,107,107,0.2)' }}>
                            <input
                                type="checkbox"
                                checked={confirmed}
                                onChange={e => setConfirmed(e.target.checked)}
                                style={{ marginTop: '2px', accentColor: '#66fcf1', width: '16px', height: '16px', flexShrink: 0 }}
                            />
                            <span style={{ color: '#c5c6c7', fontSize: '13px', lineHeight: '1.5' }}>
                                I have written down my 12-word recovery phrase in a safe place. I understand I <strong style={{ color: '#ff6b6b' }}>cannot</strong> recover my account without it.
                            </span>
                        </label>

                        {/* Proceed Button */}
                        <button
                            onClick={handleMnemonicDone}
                            disabled={!confirmed}
                            style={{ width: '100%', padding: '12px', background: confirmed ? '#66fcf1' : 'rgba(255,255,255,0.08)', border: 'none', borderRadius: '8px', color: confirmed ? '#0b0c10' : '#555', cursor: confirmed ? 'pointer' : 'not-allowed', fontSize: '15px', fontWeight: 'bold', transition: 'all 0.2s' }}
                        >
                            ✅ I've Saved My Phrase — Continue to Sign In
                        </button>
                    </div>
                </div>
            )}

            <div className="glass-panel" style={{ padding: '40px', width: '100%', maxWidth: '400px', textAlign: 'center' }}>
                <div style={{ marginBottom: '30px' }}>
                    <div style={{ display: 'inline-flex', padding: '15px', borderRadius: '50%', background: 'rgba(69, 162, 158, 0.1)', marginBottom: '15px' }}>
                        <Lock size={32} color="var(--text-highlight)" />
                    </div>
                    <h2 style={{ margin: 0, fontSize: '24px', fontWeight: 600, color: 'var(--text-highlight)' }}>
                        Prama
                    </h2>
                    <p style={{ margin: '5px 0 0', fontSize: '14px', color: 'var(--text-main)' }}>
                        End-to-End Encrypted Messaging
                    </p>
                </div>

                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                    {!isLogin && (
                        <div style={{ position: 'relative' }}>
                            <User size={18} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#888' }} />
                            <input
                                type="text"
                                className="glass-input"
                                placeholder="Choose a username"
                                value={username}
                                onChange={(e) => setUsername(e.target.value)}
                                style={{ paddingLeft: '40px' }}
                                required={!isLogin}
                            />
                        </div>
                    )}
                    <div style={{ position: 'relative' }}>
                        <Mail size={18} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#888' }} />
                        <input
                            type={isLogin ? "text" : "email"}
                            className="glass-input"
                            placeholder={isLogin ? "Email or Username" : "Email address"}
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            style={{ paddingLeft: '40px' }}
                            required
                        />
                    </div>
                    <div style={{ position: 'relative' }}>
                        <Key size={18} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#888' }} />
                        <input
                            type="password"
                            className="glass-input"
                            placeholder="Password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            style={{ paddingLeft: '40px' }}
                            required
                        />
                    </div>

                    {error && <div style={{ color: '#ff6b6b', fontSize: '14px', textAlign: 'left' }}>{error}</div>}
                    {successMsg && <div style={{ color: '#51cf66', fontSize: '14px', textAlign: 'left' }}>{successMsg}</div>}

                    <button type="submit" className="glass-button" disabled={isLoading} style={{ marginTop: '10px' }}>
                        {isLoading ? (status || 'Processing...') : (isLogin ? 'Sign In securely' : 'Create Account & Generate Keys')}
                    </button>
                </form>

                <div style={{ marginTop: '20px', fontSize: '14px' }}>
                    <span style={{ color: '#888' }}>
                        {isLogin ? "Don't have an account? " : "Already have an account? "}
                    </span>
                    <button
                        type="button"
                        onClick={() => {
                            setIsLogin(!isLogin);
                            setError('');
                            setSuccessMsg('');
                        }}
                        style={{ background: 'none', border: 'none', color: 'var(--text-highlight)', cursor: 'pointer', padding: 0, textDecoration: 'underline' }}
                    >
                        {isLogin ? 'Sign up' : 'Sign in'}
                    </button>
                </div>
                {isLogin && (
                    <div style={{ marginTop: '12px', fontSize: '13px' }}>
                        <button
                            type="button"
                            onClick={() => navigate('/recovery')}
                            style={{ background: 'none', border: 'none', color: '#ff4a5a', cursor: 'pointer', padding: 0, textDecoration: 'underline', fontWeight: '500' }}
                        >
                            Recover Cryptographic Profile
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

export default Login;
