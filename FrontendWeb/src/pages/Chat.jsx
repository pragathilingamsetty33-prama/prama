import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import SockJS from 'sockjs-client';
import { Stomp } from '@stomp/stompjs';
import { Search, Send, ShieldCheck, LogOut, User as UserIcon, UserPlus, Check, Users, Bell, Paperclip, File as FileIcon, Download, Image as ImageIcon, Loader, Camera } from 'lucide-react';
import { encryptAESKeyWithRSA, generateAESKey, encryptMessageWithAES, decryptAESKeyWithRSA, decryptMessageWithAES, encryptFileWithAES, decryptFileWithAES } from '../utils/crypto';
import forge from 'node-forge';

const AttachmentViewer = ({ attachment }) => {
    const [isDecrypting, setIsDecrypting] = useState(true);
    const [decryptedUrl, setDecryptedUrl] = useState(null);
    const [error, setError] = useState(null);

    const isImage = attachment.type?.startsWith('image/');
    const isVideo = attachment.type?.startsWith('video/');

    // Auto-decrypt on mount
    useEffect(() => {
        let cancelled = false;
        const decrypt = async () => {
            try {
                const storedUser = localStorage.getItem('prama_auth_user');
                const token = storedUser ? JSON.parse(storedUser).accessToken : null;
                const res = await fetch(attachment.url, {
                    headers: token ? { 'Authorization': 'Bearer ' + token } : {}
                });
                if (!res.ok) throw new Error(`Download failed: ${res.status}`);
                const encryptedFileObj = await res.json();
                const fileAesKey = forge.util.decode64(attachment.fileAesKey);
                const arrayBuffer = decryptFileWithAES(encryptedFileObj, fileAesKey);
                if (cancelled) return;
                const blob = new Blob([arrayBuffer], { type: attachment.type });
                setDecryptedUrl(URL.createObjectURL(blob));
            } catch (e) {
                console.error('Attachment decrypt failed:', e);
                if (!cancelled) setError('Failed to decrypt');
            }
            if (!cancelled) setIsDecrypting(false);
        };
        decrypt();
        return () => { cancelled = true; };
    }, [attachment.url]);

    // Loading state
    if (isDecrypting) {
        return (
            <div style={{ marginTop: '10px', padding: '12px', background: 'rgba(0,0,0,0.2)', borderRadius: '12px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                <Loader size={18} className="spin" style={{ color: '#00e5a0' }} />
                <span style={{ fontSize: '13px', color: '#aaa' }}>Decrypting {isImage ? 'image' : isVideo ? 'video' : 'file'}...</span>
            </div>
        );
    }

    // Error state
    if (error) {
        return (
            <div style={{ marginTop: '10px', padding: '10px', background: 'rgba(255,50,50,0.15)', borderRadius: '10px', fontSize: '12px', color: '#ff6b6b' }}>
                🔒 {error}
            </div>
        );
    }

    // Render IMAGE inline
    if (isImage && decryptedUrl) {
        return (
            <div style={{ marginTop: '10px' }}>
                <img
                    src={decryptedUrl}
                    alt={attachment.name}
                    style={{
                        maxWidth: '100%',
                        maxHeight: '300px',
                        borderRadius: '12px',
                        objectFit: 'cover',
                        cursor: 'pointer',
                        boxShadow: '0 2px 12px rgba(0,0,0,0.3)'
                    }}
                    onClick={() => window.open(decryptedUrl, '_blank')}
                    title="Click to view full size"
                />
            </div>
        );
    }

    // Render VIDEO inline
    if (isVideo && decryptedUrl) {
        return (
            <div style={{ marginTop: '10px' }}>
                <video
                    src={decryptedUrl}
                    controls
                    style={{
                        maxWidth: '100%',
                        maxHeight: '300px',
                        borderRadius: '12px',
                        boxShadow: '0 2px 12px rgba(0,0,0,0.3)'
                    }}
                />
            </div>
        );
    }

    // Render FILE as download link
    return (
        <div style={{ marginTop: '10px', padding: '12px', background: 'rgba(0,0,0,0.2)', borderRadius: '12px', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <FileIcon size={20} style={{ color: '#00e5a0', flexShrink: 0 }} />
            <div style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '13px' }}>{attachment.name}</div>
            {decryptedUrl ? (
                <a href={decryptedUrl} download={attachment.name} style={{ color: '#00e5a0', display: 'flex' }}><Download size={20} /></a>
            ) : (
                <span style={{ fontSize: '12px', color: '#666' }}>Unavailable</span>
            )}
        </div>
    );
};

const Chat = () => {
    const { user, keys, logout, apiFetch } = useAuth();
    const navigate = useNavigate();
    const stompClient = useRef(null);
    
    const [messagesByFriend, setMessagesByFriend] = useState({}); // { friendId: [msg1, msg2] }
    const [inputMsg, setInputMsg] = useState('');
    const [selectedFile, setSelectedFile] = useState(null);
    const [isUploading, setIsUploading] = useState(false);
    const fileInputRef = useRef(null);
    const [showCamera, setShowCamera] = useState(false);
    const videoRef = useRef(null);
    const streamRef = useRef(null);
    
    // Social graph states
    const [searchUsername, setSearchUsername] = useState('');
    const [searchResults, setSearchResults] = useState([]);
    const [friends, setFriends] = useState([]);
    const [requests, setRequests] = useState([]);
    const [activeTab, setActiveTab] = useState('friends'); // 'friends', 'requests', 'add'
    
    // Active chat state
    const [activeFriend, setActiveFriend] = useState(null); // { id, userId, username, email }
    const activeFriendRef = useRef(null);
    const [status, setStatus] = useState('Connecting...');
    
    // Unread messages & toast notification
    const [unreadCounts, setUnreadCounts] = useState({}); // { friendId: count }
    const [toast, setToast] = useState(null); // { senderName, content, visible }
    const toastTimeoutRef = useRef(null);

    // Keep activeFriendRef in sync
    useEffect(() => {
        activeFriendRef.current = activeFriend;
        // Clear unread count when opening a friend's chat
        if (activeFriend) {
            setUnreadCounts(prev => ({ ...prev, [activeFriend.userId]: 0 }));
        }
    }, [activeFriend]);

    useEffect(() => {
        if (!user) {
            navigate('/');
            return;
        }
        connectWebSocket();
        fetchSocialData();
        
        // Poll for new requests/friends every 10 seconds
        const interval = setInterval(fetchSocialData, 10000);
        
        return () => {
            clearInterval(interval);
            if (stompClient.current) {
                stompClient.current.disconnect();
            }
        };
    }, [user, navigate]);

    // When keys become available (after session restore), re-load unread counts
    useEffect(() => {
        if (keys && friends.length > 0) {
            fetchAllUnreadCounts(friends);
        }
    }, [keys]);


    useEffect(() => {
        if (!activeFriend || !keys) return;
        
        const loadHistory = async () => {
            try {
                const res = await apiFetch(`http://localhost:8080/api/v1/messages/${activeFriend.userId}`);
                if (res.ok) {
                    const history = await res.json();
                    
                    const decryptedHistory = history.map(m => {
                        let content = "[Encrypted]";
                        let attachment = null;
                        try {
                            const aesKeyToUse = (m.senderId === user.userId) ? m.senderEncryptedAesKey : m.encryptedAesKey;
                            if (aesKeyToUse) {
                                const aesKeyStr = decryptAESKeyWithRSA(aesKeyToUse, keys.privateKey);
                                const rawEncrypted = m.encryptedContent || m.encryptedMessage;
                                let encryptedData;
                                try {
                                    encryptedData = typeof rawEncrypted === 'string' ? JSON.parse(rawEncrypted) : rawEncrypted;
                                } catch(e) {
                                    encryptedData = rawEncrypted;
                                }
                                
                                const decryptedStr = decryptMessageWithAES(encryptedData, aesKeyStr);
                                try {
                                    const parsed = JSON.parse(decryptedStr);
                                    content = parsed.text || "";
                                    attachment = parsed.attachment || null;
                                } catch(e) {
                                    content = decryptedStr; // Fallback for old plaintext messages
                                }
                            }
                        } catch (e) {
                            console.warn("Decryption failed for message", m.id, e);
                            content = "🔒 [Decryption Failed]";
                        }
                        return {
                            ...m,
                            id: m.id || `msg-${Math.random()}`,
                            sender: m.senderId,
                            content,
                            attachment,
                            isMe: m.senderId === user.userId,
                            timestamp: new Date(m.timestamp).toLocaleTimeString()
                        };
                    });

                    setMessagesByFriend(prev => ({
                        ...prev,
                        [activeFriend.userId]: decryptedHistory
                    }));
                    
                    // Clear unread for the friend we just opened
                    setUnreadCounts(prev => ({ ...prev, [activeFriend.userId]: 0 }));
                    
                    // Mark as read in local storage to prevent badges from showing again on refresh
                    localStorage.setItem(`lastRead_${activeFriend.userId}`, new Date().toISOString());
                }
            } catch (e) {
                console.error("Failed to load history", e);
            }
        };
        
        loadHistory();
    }, [activeFriend, keys]);

    const fetchSocialData = async () => {
        try {
            const [friendsRes, requestsRes] = await Promise.all([
                apiFetch('http://localhost:8080/api/v1/friends'),
                apiFetch('http://localhost:8080/api/v1/friends/requests')
            ]);
            
            let friendsList = [];
            if (friendsRes.ok) {
                friendsList = await friendsRes.json();
                setFriends(friendsList);
            }
            if (requestsRes.ok) setRequests(await requestsRes.json());
            
            // After loading friends, check each one for unread messages
            fetchAllUnreadCounts(friendsList);
        } catch (e) {
            console.error("Failed to fetch social data", e);
        }
    };

    // Load message counts for all friends to show unread badges in sidebar
    const fetchAllUnreadCounts = async (friendsList) => {
        if (!friendsList || friendsList.length === 0 || !keys) return;
        
        for (const friend of friendsList) {
            try {
                const res = await apiFetch(`http://localhost:8080/api/v1/messages/${friend.userId}`);
                if (res.ok) {
                    const history = await res.json();
                    
                    // Get the last time the user opened this chat IN THIS BROWSER
                    let lastReadStr = localStorage.getItem(`lastRead_${friend.userId}`);
                    
                    // NEW BROWSER FIX: If no lastRead exists, find the last message I SENT.
                    // Everything before my last sent message was clearly already seen by me.
                    if (!lastReadStr) {
                        const myLastMessage = [...history]
                            .reverse()
                            .find(m => m.senderId === user.userId);
                        
                        if (myLastMessage) {
                            // Use the time of my last sent message as the baseline
                            lastReadStr = myLastMessage.timestamp;
                        } else {
                            // Never spoken with this friend — use current time so nothing shows as unread
                            lastReadStr = new Date().toISOString();
                        }
                        // Save this to avoid repeating on next render
                        localStorage.setItem(`lastRead_${friend.userId}`, lastReadStr);
                    }

                    const lastReadTime = new Date(lastReadStr).getTime();

                    // Count only messages TO ME that arrived AFTER lastRead
                    const unreadCount = history.filter(m => 
                        m.recipientId === user.userId && 
                        new Date(m.timestamp).getTime() > lastReadTime
                    ).length;
                    
                    setUnreadCounts(prev => ({
                        ...prev,
                        [friend.userId]: unreadCount
                    }));
                }
            } catch (e) {
                // silently skip if one friend fails
            }
        }
    };

    const handleSearch = async (query) => {
        setSearchUsername(query);
        if (!query.trim()) {
            setSearchResults([]);
            return;
        }
        try {
            const res = await apiFetch(`http://localhost:8080/api/v1/users/search?query=${query}`);
            if (res.ok) {
                const data = await res.json();
                setSearchResults(data);
            }
        } catch (e) {
            console.error(e);
        }
    };

    const sendFriendRequest = async (targetUsername) => {
        if (!targetUsername) return;
        try {
            const res = await apiFetch(`http://localhost:8080/api/v1/friends/request/${targetUsername}`, {
                method: 'POST'
            });
            if (res.ok) {
                alert('Friend request sent to ' + targetUsername + '!');
                setSearchUsername('');
                setSearchResults([]);
            } else {
                const err = await res.text();
                alert(err || 'Failed to send request');
            }
        } catch (e) {
            alert('Error sending request');
        }
    };

    const acceptRequest = async (requestId) => {
        try {
            const res = await apiFetch(`http://localhost:8080/api/v1/friends/accept/${requestId}`, {
                method: 'POST'
            });
            if (res.ok) {
                fetchSocialData();
                setActiveTab('friends');
            }
        } catch (e) {
            console.error(e);
        }
    };

    const connectWebSocket = () => {
        if (stompClient.current && stompClient.current.connected) return;
        
        const socket = new SockJS('http://localhost:8080/ws');
        const client = Stomp.over(socket);
        client.debug = () => {}; 

        client.connect({ 'Authorization': 'Bearer ' + user.accessToken }, () => {
            setStatus('Connected securely');
            client.subscribe(`/topic/messages/${user.userId}`, (msg) => {
                const receivedPayload = JSON.parse(msg.body);
                handleIncomingMessage(receivedPayload);
            });
        }, (error) => {
            setStatus('Connection error');
        });

        stompClient.current = client;
    };

    const showToast = (senderName, content) => {
        if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
        setToast({ senderName, content, visible: true });
        toastTimeoutRef.current = setTimeout(() => setToast(null), 4000);
    };

    const processedMessages = useRef(new Set());
    const handleIncomingMessage = (payload) => {
        // Prevent duplicate processing of the same message
        if (payload.id && processedMessages.current.has(payload.id)) return;
        if (payload.id) processedMessages.current.add(payload.id);

        let decryptedContent = '🔒 [Message could not be decrypted]';
        let attachment = null;
        try {
            const aesKeyStr = decryptAESKeyWithRSA(payload.encryptedAESKey, keys.privateKey);
            let encryptedData;
            try {
                encryptedData = typeof payload.encryptedMessage === 'string' ? JSON.parse(payload.encryptedMessage) : payload.encryptedMessage;
            } catch(e) {
                encryptedData = payload.encryptedMessage;
            }

            const decryptedStr = decryptMessageWithAES(encryptedData, aesKeyStr);
            try {
                const parsed = JSON.parse(decryptedStr);
                decryptedContent = parsed.text || "";
                attachment = parsed.attachment || null;
            } catch(e) {
                decryptedContent = decryptedStr;
            }
        } catch (error) {
            console.error('Decryption failed', error);
            decryptedContent = "🔒 [Decryption Failed]";
        }

        setMessagesByFriend(prev => ({
            ...prev,
            [payload.senderId]: [...(prev[payload.senderId] || []), {
                id: payload.id || Date.now(),
                sender: payload.senderId,
                content: decryptedContent,
                attachment: attachment,
                isMe: false,
                timestamp: new Date().toLocaleTimeString()
            }]
        }));

        // If we are NOT viewing this sender's chat, mark as unread + show toast
        const currentActiveFriend = activeFriendRef.current;
        if (!currentActiveFriend || currentActiveFriend.userId !== payload.senderId) {
            setUnreadCounts(prev => ({
                ...prev,
                [payload.senderId]: (prev[payload.senderId] || 0) + 1
            }));

            // Find sender name from friends list for the toast
            const senderFriend = friends.find(f => f.userId === payload.senderId);
            const senderName = senderFriend ? senderFriend.username : 'Someone';
            showToast(senderName, attachment ? '📁 Sent an attachment' : decryptedContent);
        } else {
            // We are actively viewing this chat, so mark the newly received message as read instantly
            localStorage.setItem(`lastRead_${payload.senderId}`, new Date().toISOString());
        }
    };

    // Camera functions
    const openCamera = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ 
                video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }, 
                audio: false 
            });
            streamRef.current = stream;
            setShowCamera(true);
            // Wait for the video element to mount, then attach stream
            setTimeout(() => {
                if (videoRef.current) {
                    videoRef.current.srcObject = stream;
                }
            }, 100);
        } catch (e) {
            console.error('Camera access denied:', e);
            alert('Camera access denied. Please allow camera permissions in your browser.');
        }
    };

    const capturePhoto = () => {
        if (!videoRef.current) return;
        const video = videoRef.current;
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        canvas.getContext('2d').drawImage(video, 0, 0);
        canvas.toBlob((blob) => {
            const file = new window.File([blob], `photo_${Date.now()}.jpg`, { type: 'image/jpeg' });
            setSelectedFile(file);
            closeCamera();
        }, 'image/jpeg', 0.9);
    };

    const closeCamera = () => {
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop());
            streamRef.current = null;
        }
        setShowCamera(false);
    };

    const sendMessage = async () => {
        if ((!inputMsg.trim() && !selectedFile) || !activeFriend || !stompClient.current) return;

        try {
            setIsUploading(true);
            const pkUrl = `http://localhost:8080/api/v1/users/${activeFriend.userId}/public-key`;
            const pkRes = await apiFetch(pkUrl);
            if (!pkRes.ok) {
                alert("Could not fetch recipient's latest public key.");
                setIsUploading(false);
                return;
            }
            
            const pkText = await pkRes.text();
            let latestPubKey = pkText;
            try { latestPubKey = JSON.parse(pkText); } catch(e) {}

            let attachmentData = null;
            if (selectedFile) {
                const fileAesKey = generateAESKey();
                const arrayBuffer = await selectedFile.arrayBuffer();
                const encryptedFileObj = encryptFileWithAES(arrayBuffer, fileAesKey);
                
                const blob = new Blob([JSON.stringify(encryptedFileObj)], { type: 'application/json' });
                
                // Upload to LOCAL BACKEND instead of Firebase
                const formData = new FormData();
                formData.append('file', blob, selectedFile.name + '.enc');
                
                const uploadRes = await fetch('http://localhost:8080/api/v1/attachments/upload', {
                    method: 'POST',
                    headers: {
                        'Authorization': 'Bearer ' + user.accessToken
                    },
                    body: formData
                });
                
                if (!uploadRes.ok) throw new Error("Upload failed");
                const uploadData = await uploadRes.json();
                const downloadUrl = uploadData.url;

                attachmentData = {
                    url: downloadUrl,
                    type: selectedFile.type,
                    name: selectedFile.name,
                    fileAesKey: forge.util.encode64(fileAesKey)
                };
            }

            const aesKey = generateAESKey();
            const encryptedAESKey = encryptAESKeyWithRSA(aesKey, latestPubKey);
            const senderEncryptedAESKey = encryptAESKeyWithRSA(aesKey, keys.publicKey);
            
            const messagePayloadObj = {
                text: inputMsg,
                attachment: attachmentData
            };
            
            const encryptedData = encryptMessageWithAES(JSON.stringify(messagePayloadObj), aesKey);

            const payload = {
                recipientId: activeFriend.userId,
                encryptedAESKey: encryptedAESKey,
                senderEncryptedAESKey: senderEncryptedAESKey,
                encryptedMessage: JSON.stringify(encryptedData)
            };

            stompClient.current.send("/app/chat.sendMessage", {}, JSON.stringify(payload));

            setMessagesByFriend(prev => ({
                ...prev,
                [activeFriend.userId]: [...(prev[activeFriend.userId] || []), {
                    id: Date.now(),
                    sender: user.userId,
                    content: inputMsg,
                    attachment: attachmentData,
                    isMe: true,
                    timestamp: new Date().toLocaleTimeString()
                }]
            }));
            
            setInputMsg('');
            setSelectedFile(null);
            setIsUploading(false);
        } catch (error) {
            console.error("Encryption/Upload failed", error);
            alert("Failed to send message securely");
            setIsUploading(false);
        }
    };

    return (
        <div style={{ display: 'flex', width: '100%', maxWidth: '1200px', height: '85vh', margin: '0 auto', padding: '20px', gap: '20px' }}>
            
            {/* Sidebar */}
            <div className="glass-panel" style={{ width: '350px', display: 'flex', flexDirection: 'column', padding: '20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '30px' }}>
                    <ShieldCheck color="var(--text-highlight)" size={28} />
                    <h2 style={{ margin: 0, color: 'var(--text-highlight)' }}>Prama E2EE</h2>
                </div>

                <div style={{ marginBottom: '20px', padding: '15px', background: 'rgba(0,0,0,0.2)', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '15px' }}>
                    <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: 'var(--accent)', color: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', fontSize: '18px' }}>
                        {user?.username?.charAt(0).toUpperCase() || user?.email?.charAt(0).toUpperCase()}
                    </div>
                    <div>
                        <div style={{ fontSize: '12px', color: '#888' }}>Logged in as</div>
                        <div style={{ wordBreak: 'break-all', fontSize: '14px', fontWeight: 'bold' }}>{user?.username || user?.email}</div>
                    </div>
                </div>

                {/* Tabs */}
                <div style={{ display: 'flex', gap: '10px', marginBottom: '20px', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '10px' }}>
                    <button onClick={() => setActiveTab('friends')} style={{ background: 'none', border: 'none', color: activeTab === 'friends' ? 'var(--text-highlight)' : '#888', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px' }}>
                        <Users size={16} /> Friends
                    </button>
                    <button onClick={() => setActiveTab('requests')} style={{ background: 'none', border: 'none', color: activeTab === 'requests' ? 'var(--text-highlight)' : '#888', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px', position: 'relative' }}>
                        <Bell size={16} /> Requests
                        {requests.length > 0 && <span style={{ background: '#ff6b6b', color: '#fff', borderRadius: '50%', padding: '2px 6px', fontSize: '10px', position: 'absolute', top: '-5px', right: '-15px' }}>{requests.length}</span>}
                    </button>
                    <button onClick={() => setActiveTab('add')} style={{ background: 'none', border: 'none', color: activeTab === 'add' ? 'var(--text-highlight)' : '#888', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px' }}>
                        <UserPlus size={16} /> Add
                    </button>
                </div>

                <div style={{ flex: 1, overflowY: 'auto' }}>
                    {activeTab === 'add' && (
                        <div>
                            <div style={{ fontSize: '12px', color: '#888', marginBottom: '8px' }}>Add by Username</div>
                            <div style={{ display: 'flex', gap: '8px', marginBottom: '15px' }}>
                                <input 
                                    type="text" 
                                    className="glass-input" 
                                    placeholder="Search username..." 
                                    value={searchUsername}
                                    onChange={e => handleSearch(e.target.value)}
                                />
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                {searchResults.length === 0 && searchUsername.length > 0 && (
                                    <div style={{ color: '#888', fontSize: '12px', textAlign: 'center' }}>No users found</div>
                                )}
                                {searchResults.map(result => (
                                    <div key={result.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(255,255,255,0.05)', padding: '10px', borderRadius: '8px' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                            <div style={{ width: '30px', height: '30px', borderRadius: '50%', background: '#45a29e', color: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold' }}>
                                                {result.username?.charAt(0).toUpperCase()}
                                            </div>
                                            <span style={{ fontSize: '14px' }}>{result.username}</span>
                                        </div>
                                        {result.username !== user?.username && (
                                            <button onClick={() => sendFriendRequest(result.username)} style={{ background: 'var(--accent)', border: 'none', borderRadius: '50%', width: '30px', height: '30px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#000' }}>
                                                <UserPlus size={16} />
                                            </button>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {activeTab === 'requests' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                            {requests.length === 0 ? <div style={{ color: '#888', fontSize: '14px', textAlign: 'center', marginTop: '20px' }}>No pending requests</div> : null}
                            {requests.map(req => (
                                <div key={req.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(255,255,255,0.05)', padding: '10px', borderRadius: '8px' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                        <div style={{ width: '30px', height: '30px', borderRadius: '50%', background: '#45a29e', color: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold' }}>
                                            {req.username?.charAt(0).toUpperCase()}
                                        </div>
                                        <span style={{ fontSize: '14px' }}>{req.username}</span>
                                    </div>
                                    <button onClick={() => acceptRequest(req.id)} style={{ background: 'var(--accent)', border: 'none', borderRadius: '50%', width: '30px', height: '30px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#000' }}>
                                        <Check size={16} />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}

                    {activeTab === 'friends' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                            {friends.length === 0 ? <div style={{ color: '#888', fontSize: '14px', textAlign: 'center', marginTop: '20px' }}>No friends yet. Add someone!</div> : null}
                            {friends.map(friend => (
                                <div 
                                    key={friend.id} 
                                    onClick={() => setActiveFriend(friend)}
                                    style={{ 
                                        display: 'flex', alignItems: 'center', gap: '10px', padding: '12px', borderRadius: '8px', cursor: 'pointer',
                                        background: activeFriend?.id === friend.id ? 'rgba(102, 252, 241, 0.1)' : (unreadCounts[friend.userId] > 0 ? 'rgba(0, 255, 136, 0.05)' : 'transparent'),
                                        border: activeFriend?.id === friend.id ? '1px solid rgba(102, 252, 241, 0.3)' : '1px solid transparent'
                                    }}
                                >
                                    <div style={{ position: 'relative', width: '35px', height: '35px', borderRadius: '50%', background: 'linear-gradient(135deg, #66fcf1, #45a29e)', color: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold' }}>
                                        {friend.username?.charAt(0).toUpperCase()}
                                        {unreadCounts[friend.userId] > 0 && (
                                            <div style={{ position: 'absolute', top: '-4px', right: '-4px', width: '20px', height: '20px', borderRadius: '50%', background: '#00ff88', color: '#000', fontSize: '11px', fontWeight: 'bold', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 8px rgba(0,255,136,0.6)', animation: 'pulse 1.5s infinite' }}>
                                                {unreadCounts[friend.userId]}
                                            </div>
                                        )}
                                    </div>
                                    <div style={{ flex: 1 }}>
                                        <div style={{ fontSize: '14px', color: unreadCounts[friend.userId] > 0 ? '#00ff88' : 'var(--text-highlight)', fontWeight: unreadCounts[friend.userId] > 0 ? 'bold' : 'normal' }}>{friend.username}</div>
                                        <div style={{ fontSize: '11px', color: '#888' }}>{friend.email}</div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <div style={{ marginTop: '20px' }}>
                    <div style={{ fontSize: '12px', color: status.includes('Connected') ? '#00ff88' : '#ffcc00', marginBottom: '15px', display: 'flex', alignItems: 'center', gap: '5px' }}>
                        <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: status.includes('Connected') ? '#00ff88' : '#ffcc00' }} />
                        {status}
                    </div>
                    <button onClick={() => { logout(); navigate('/'); }} className="glass-button" style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', background: 'rgba(255,107,107,0.1)', color: '#ff6b6b' }}>
                        <LogOut size={18} /> Logout
                    </button>
                </div>
            </div>

            {/* Chat Area */}
            <div className="glass-panel" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                <div style={{ padding: '20px', borderBottom: '1px solid var(--border)', background: 'rgba(0,0,0,0.1)' }}>
                    <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '10px' }}>
                        {activeFriend ? (
                            <>
                                <div style={{ width: '30px', height: '30px', borderRadius: '50%', background: 'linear-gradient(135deg, #66fcf1, #45a29e)', color: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', fontSize: '14px' }}>
                                    {activeFriend.username?.charAt(0).toUpperCase()}
                                </div>
                                Secure Chat with {activeFriend.username}
                            </>
                        ) : 'Select a friend to start messaging'}
                    </h3>
                </div>

                <div style={{ flex: 1, padding: '20px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '15px' }}>
                    {(messagesByFriend[activeFriend?.userId] || []).map(msg => (
                        <div key={msg.id} style={{ alignSelf: msg.isMe ? 'flex-end' : 'flex-start', maxWidth: '70%' }}>
                            <div style={{ 
                                padding: '12px 16px', 
                                borderRadius: msg.isMe ? '16px 16px 0 16px' : '16px 16px 16px 0',
                                background: msg.isMe ? 'var(--accent)' : 'rgba(255,255,255,0.05)',
                                color: msg.isMe ? '#000' : 'var(--text-main)',
                                boxShadow: '0 2px 10px rgba(0,0,0,0.1)'
                            }}>
                                {msg.content}
                                {msg.attachment && <AttachmentViewer attachment={msg.attachment} />}
                            </div>
                            <div style={{ fontSize: '10px', color: '#666', marginTop: '4px', textAlign: msg.isMe ? 'right' : 'left' }}>
                                {msg.timestamp}
                            </div>
                        </div>
                    ))}
                    {(!activeFriend || (messagesByFriend[activeFriend.userId] || []).length === 0) && activeFriend && (
                        <div style={{ margin: 'auto', color: '#888', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
                            <ShieldCheck size={48} color="rgba(102, 252, 241, 0.3)" />
                            <span>Messages are end-to-end encrypted. No one else can read them.</span>
                        </div>
                    )}
                </div>

                <div style={{ padding: '20px', borderTop: '1px solid var(--border)' }}>
                    {selectedFile && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px', background: 'rgba(0,255,136,0.1)', borderRadius: '8px', marginBottom: '10px' }}>
                            <FileIcon size={16} color="#00ff88" />
                            <span style={{ fontSize: '14px', color: '#00ff88', flex: 1 }}>{selectedFile.name}</span>
                            <button onClick={() => setSelectedFile(null)} style={{ background: 'none', border: 'none', color: '#ff6b6b', cursor: 'pointer', fontWeight: 'bold' }}>X</button>
                        </div>
                    )}
                    <div style={{ display: 'flex', gap: '10px' }}>
                        <input 
                            type="file" 
                            ref={fileInputRef} 
                            style={{ display: 'none' }} 
                            onChange={(e) => setSelectedFile(e.target.files[0])}
                        />

                        <button 
                            onClick={() => fileInputRef.current.click()} 
                            className="glass-button" 
                            disabled={!activeFriend || isUploading}
                            title="Attach File"
                        >
                            <Paperclip size={20} />
                        </button>
                        <button 
                            onClick={openCamera} 
                            className="glass-button" 
                            disabled={!activeFriend || isUploading}
                            title="Take Photo"
                        >
                            <Camera size={20} />
                        </button>
                        <input 
                            type="text" 
                            className="glass-input" 
                            placeholder="Type an encrypted message..." 
                            value={inputMsg}
                            onChange={e => setInputMsg(e.target.value)}
                            onKeyPress={e => e.key === 'Enter' && sendMessage()}
                            disabled={!activeFriend || isUploading}
                        />
                        <button onClick={sendMessage} className="glass-button" disabled={!activeFriend || isUploading || (!inputMsg.trim() && !selectedFile)}>
                            {isUploading ? <Loader className="spin" size={20} /> : <Send size={20} />}
                        </button>
                    </div>
                </div>
            </div>
            
            {/* Toast Notification */}
            {toast && (
                <div style={{
                    position: 'fixed',
                    top: '20px',
                    right: '20px',
                    background: 'linear-gradient(135deg, rgba(0,255,136,0.15), rgba(102,252,241,0.15))',
                    backdropFilter: 'blur(20px)',
                    border: '1px solid rgba(0,255,136,0.4)',
                    borderRadius: '16px',
                    padding: '16px 20px',
                    minWidth: '300px',
                    maxWidth: '400px',
                    boxShadow: '0 8px 32px rgba(0,0,0,0.4), 0 0 20px rgba(0,255,136,0.2)',
                    zIndex: 9999,
                    animation: 'slideIn 0.4s ease-out',
                    cursor: 'pointer'
                }} onClick={() => setToast(null)}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: 'linear-gradient(135deg, #00ff88, #45a29e)', color: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', fontSize: '16px', flexShrink: 0 }}>
                            {toast.senderName.charAt(0).toUpperCase()}
                        </div>
                        <div style={{ flex: 1 }}>
                            <div style={{ fontWeight: 'bold', color: '#00ff88', fontSize: '14px' }}>{toast.senderName}</div>
                            <div style={{ color: '#ccc', fontSize: '13px', marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{toast.content}</div>
                        </div>
                    </div>
                </div>
            )}

            {/* Camera Modal */}
            {showCamera && (
                <div style={{
                    position: 'fixed',
                    top: 0, left: 0, right: 0, bottom: 0,
                    background: 'rgba(0,0,0,0.9)',
                    backdropFilter: 'blur(10px)',
                    zIndex: 10000,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center'
                }}>
                    <video 
                        ref={videoRef} 
                        autoPlay 
                        playsInline 
                        style={{ 
                            width: '100%', 
                            maxWidth: '800px', 
                            maxHeight: '70vh', 
                            objectFit: 'cover',
                            borderRadius: '16px',
                            boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
                            transform: 'scaleX(-1)' // Mirror effect
                        }} 
                    />
                    <div style={{ display: 'flex', gap: '20px', marginTop: '30px' }}>
                        <button 
                            onClick={closeCamera}
                            className="glass-button"
                            style={{ padding: '15px 30px', fontSize: '16px', color: '#ff6b6b' }}
                        >
                            Cancel
                        </button>
                        <button 
                            onClick={capturePhoto}
                            className="glass-button"
                            style={{ padding: '15px 30px', fontSize: '16px', background: 'var(--accent)', color: '#000' }}
                        >
                            <Camera size={24} style={{ marginRight: '10px' }} />
                            Capture Photo
                        </button>
                    </div>
                </div>
            )}

            <style>{`
                @keyframes pulse {
                    0% { transform: scale(1); box-shadow: 0 0 8px rgba(0,255,136,0.6); }
                    50% { transform: scale(1.2); box-shadow: 0 0 16px rgba(0,255,136,0.9); }
                    100% { transform: scale(1); box-shadow: 0 0 8px rgba(0,255,136,0.6); }
                }
                @keyframes slideIn {
                    from { transform: translateX(120%); opacity: 0; }
                    to { transform: translateX(0); opacity: 1; }
                }
                .spin {
                    animation: spin 1s linear infinite;
                }
                @keyframes spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
            `}</style>
        </div>
    );
};

export default Chat;
