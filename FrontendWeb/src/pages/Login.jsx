import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { Lock, Mail, Key, User } from 'lucide-react';

const Login = () => {
    const [isLogin, setIsLogin] = useState(true);
    const [email, setEmail] = useState('');
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [successMsg, setSuccessMsg] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [status, setStatus] = useState('');
    
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
                // Argon2 can take 1-2 seconds, so we show a status update
                const userData = await login(email, password, (msg) => setStatus(msg)); 
                
                // 🚀 Phase 4.1: Secure Redirect Handoff with Hash Fragment Isolation (#)
                const queryParams = new URLSearchParams(window.location.search);
                const redirectUri = queryParams.get('redirect_uri');
                if (redirectUri) {
                    window.location.replace(`${redirectUri}#status=success&token=${userData.accessToken}`);
                    return;
                }

                navigate('/chat');
            } else {
                setStatus('Generating keys...');
                await register(username, email, password);
                setSuccessMsg('Account created successfully! Please sign in.');
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

    return (
        <div style={{ display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'center' }}>
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
            </div>
        </div>
    );
};

export default Login;
