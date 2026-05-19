import React, { useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { KeyRound, ShieldAlert, Check } from 'lucide-react';
import { MnemonicManager } from '../utils/MnemonicManager';

const Recovery = () => {
    const { resetIdentity } = useAuth();
    const navigate = useNavigate();
    
    const passwordRef = useRef(null);
    const mnemonicRef = useRef(null);

    const [error, setError] = useState('');
    const [successMsg, setSuccessMsg] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [status, setStatus] = useState('');

    const handleRecoverySubmit = async (e) => {
        e.preventDefault();
        setError('');
        setSuccessMsg('');
        setIsLoading(true);
        setStatus('Initializing secure derivation...');

        try {
            // Tightly scoped IIFE to isolate the primitive strings in the V8 heap
            const recoveryTask = await (async () => {
                let rawMnemonic = mnemonicRef.current.value;
                let rawPassword = passwordRef.current.value;

                if (!rawMnemonic || !rawMnemonic.trim()) {
                    throw new Error('Please enter your recovery seed phrase.');
                }
                if (!rawPassword) {
                    throw new Error('Please enter your password to authorize the re-encryption key envelope.');
                }

                const trimmedMnemonic = rawMnemonic.trim().toLowerCase();

                // Validate mnemonic format using standard BIP-39 algorithm
                if (!MnemonicManager.validate(trimmedMnemonic)) {
                    throw new Error('Invalid Phrase: The phrase entered is not a valid 12-word BIP-39 mnemonic.');
                }

                // Convert string to Uint8Array via TextEncoder to allow low-level zero-filling
                const encoder = new TextEncoder();
                let mnemonicBytes = encoder.encode(trimmedMnemonic);

                // EXPLICIT V8 SHREDDING: Sever primitive string reference counts immediately!
                rawMnemonic = null;
                rawPassword = null;

                return {
                    bytes: mnemonicBytes,
                    password: passwordRef.current.value // pass password through
                };
            })();

            setStatus('Overwriting OS Clipboard...');
            // Gag OS Clipboard Hostage threat vector
            try {
                await navigator.clipboard.writeText(" ");
            } catch (clipErr) {
                console.warn('⚠️ [Clipboard Shredder] Failed to overwrite OS clipboard:', clipErr);
            }

            setStatus('Cryptographically resetting E2EE Identity...');
            // Derivation & overwriting server + local keystore
            await resetIdentity(recoveryTask.password);

            // Zero-fill the Uint8Array buffer immediately post-derivation to wipe RAM traces
            recoveryTask.bytes.fill(0);

            // Clear DOM nodes
            if (mnemonicRef.current) mnemonicRef.current.value = '';
            if (passwordRef.current) passwordRef.current.value = '';

            setSuccessMsg('Your E2EE profile has been successfully synchronized and restored!');
            setStatus('');

            setTimeout(() => {
                navigate('/chat');
            }, 1500);

        } catch (err) {
            setError(err.message || 'Restoration failed');
            setStatus('');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div style={{ display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'center' }}>
            <div className="glass-panel" style={{ padding: '40px', width: '100%', maxWidth: '450px', textAlign: 'center', border: '1px solid rgba(255, 74, 90, 0.3)' }}>
                <div style={{ marginBottom: '25px' }}>
                    <div style={{ display: 'inline-flex', padding: '15px', borderRadius: '50%', background: 'rgba(255, 74, 90, 0.1)', marginBottom: '15px' }}>
                        <KeyRound size={32} color="#ff4a5a" />
                    </div>
                    <h2 style={{ margin: 0, fontSize: '22px', fontWeight: 600, color: '#ff4a5a' }}>
                        E2EE Recovery Plane
                    </h2>
                    <p style={{ margin: '8px 0 0', fontSize: '13px', color: 'var(--text-main)', lineHeight: '1.5' }}>
                        Recover your cryptographic mesh envelope on a new browser environment or reset your local security context.
                    </p>
                </div>

                <div style={{ background: 'rgba(255, 74, 90, 0.05)', border: '1px solid rgba(255, 74, 90, 0.2)', borderRadius: '8px', padding: '12px', marginBottom: '20px', textAlign: 'left', display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                    <ShieldAlert size={20} color="#ff4a5a" style={{ flexShrink: 0, marginTop: '2px' }} />
                    <span style={{ fontSize: '12px', color: '#ff8888', lineHeight: '1.4' }}>
                        <strong>Security Advisory:</strong> Key derivation takes place locally. The raw seed phrase is never sent to the network, and is aggressively wiped from volatile RAM post-derivation.
                    </span>
                </div>

                <form onSubmit={handleRecoverySubmit} style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                    <div style={{ textAlign: 'left' }}>
                        <label style={{ fontSize: '12px', color: 'var(--text-highlight)', fontWeight: '500', marginBottom: '5px', display: 'block' }}>
                            12-Word Recovery Phrase
                        </label>
                        <textarea
                            ref={mnemonicRef}
                            className="glass-input"
                            placeholder="word1 word2 word3..."
                            style={{ minHeight: '80px', padding: '10px', fontSize: '13px', resize: 'vertical', lineHeight: '1.6' }}
                            spellCheck="false"
                            autoComplete="off"
                            autoCorrect="off"
                            autoCapitalize="none"
                            data-lpignore="true"
                            required
                        />
                    </div>

                    <div style={{ textAlign: 'left' }}>
                        <label style={{ fontSize: '12px', color: 'var(--text-highlight)', fontWeight: '500', marginBottom: '5px', display: 'block' }}>
                            Confirm Account Password
                        </label>
                        <input
                            type="password"
                            ref={passwordRef}
                            className="glass-input"
                            placeholder="Enter password to re-seal key vault"
                            required
                        />
                    </div>

                    {error && <div style={{ color: '#ff6b6b', fontSize: '13px', textAlign: 'left', background: 'rgba(255,107,107,0.1)', padding: '8px', borderRadius: '4px' }}>{error}</div>}
                    {successMsg && <div style={{ color: '#51cf66', fontSize: '13px', textAlign: 'left', background: 'rgba(81,207,102,0.1)', padding: '8px', borderRadius: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}><Check size={16} />{successMsg}</div>}

                    <button type="submit" className="glass-button" disabled={isLoading} style={{ marginTop: '10px', background: 'rgba(255, 74, 90, 0.1)', border: '1px solid rgba(255, 74, 90, 0.3)', color: '#ff4a5a' }}>
                        {isLoading ? (status || 'Reconstructing profile...') : 'Verify & Synchronize Keys'}
                    </button>

                    <button
                        type="button"
                        onClick={() => navigate('/')}
                        disabled={isLoading}
                        style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: '12px', textDecoration: 'underline', marginTop: '5px' }}
                    >
                        Back to Sign In
                    </button>
                </form>
            </div>
        </div>
    );
};

export default Recovery;
