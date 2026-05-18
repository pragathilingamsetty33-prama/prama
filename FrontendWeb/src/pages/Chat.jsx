import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { Stomp } from '@stomp/stompjs';
import { Search, Send, ShieldCheck, Shield, LogOut, User as UserIcon, UserPlus, Check, Users, Bell, Paperclip, File as FileIcon, Download, Image as ImageIcon, Loader, Camera, X, Forward } from 'lucide-react';
import { encryptAESKeyWithRSA, generateAESKey, encryptMessageWithAES, decryptAESKeyWithRSA, decryptMessageWithAES, encryptFileWithAES, decryptFileWithAES, deriveKeyFromPassword, encryptDataWithPassword } from '../utils/crypto';
import { KeyCache } from '../utils/KeyCache';
import forge from 'node-forge';
import { messaging } from '../firebase';
import { getToken } from "firebase/messaging";
import axios from 'axios';

const openPramaDB = () => {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open("PramaAttachmentCache", 1);
        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains("attachments")) {
                db.createObjectStore("attachments");
            }
        };
        request.onsuccess = (e) => resolve(e.target.result);
        request.onerror = (e) => reject(e.target.error);
    });
};

const getCachedFile = async (id) => {
    try {
        const db = await openPramaDB();
        return new Promise((resolve) => {
            const transaction = db.transaction("attachments", "readonly");
            const store = transaction.objectStore("attachments");
            const request = store.get(id);
            request.onsuccess = () => resolve(request.result || null);
            request.onerror = () => resolve(null);
        });
    } catch (e) {
        return null;
    }
};

const cacheFile = async (id, blob) => {
    try {
        const db = await openPramaDB();
        const transaction = db.transaction("attachments", "readwrite");
        const store = transaction.objectStore("attachments");
        store.put(blob, id);
    } catch (err) {
        console.error("Failed to write to IndexedDB cache", err);
    }
};

const purgePramaCache = () => {
    indexedDB.deleteDatabase("PramaAttachmentCache");
};

const purgeSingleCachedFile = async (messageId) => {
    try {
        const db = await openPramaDB();
        const transaction = db.transaction("attachments", "readwrite");
        transaction.objectStore("attachments").delete(String(messageId));
    } catch (err) {
        console.error("Cache purge runtime exception:", err);
    }
};

const AttachmentViewer = ({ attachment, messageId, onImageClick, attachmentCache, setAttachmentCache, onForward, decryptedFiles, setDecryptedFiles }) => {
    // Check if this file has been decrypted in the CURRENT session
    const sessionUrl = decryptedFiles[messageId];

    const [isDecrypting, setIsDecrypting] = useState(false);
    const [error, setError] = useState(null);

    const isImage = attachment.type?.startsWith('image/');
    const API_BASE = import.meta.env.VITE_API_URL;

    const handleDownloadAndDecrypt = async () => {
        setIsDecrypting(true);
        try {
            const storedUser = localStorage.getItem('prama_auth_user');
            const token = storedUser ? JSON.parse(storedUser).accessToken : null;

            let downloadUrl = attachment.url;
            if (downloadUrl.startsWith('/')) {
                downloadUrl = API_BASE + downloadUrl;
            }

            const res = await fetch(downloadUrl, {
                headers: token ? { 'Authorization': 'Bearer ' + token } : {}
            });
            if (!res.ok) throw new Error(`Download failed: ${res.status}`);
            const encryptedFileObj = await res.json();
            const fileAesKey = forge.util.decode64(attachment.fileAesKey);
            const arrayBuffer = decryptFileWithAES(encryptedFileObj, fileAesKey);

            const blob = new Blob([arrayBuffer], { type: attachment.type });
            const url = URL.createObjectURL(blob);

            // Save to SESSION state only (No localStorage for group privacy)
            setDecryptedFiles(prev => ({ ...prev, [messageId]: url }));

            // PROFESSIONAL CACHING: Save to persistent IndexedDB
            await cacheFile(messageId, blob);

            if (setAttachmentCache) {
                setAttachmentCache(prev => ({ ...prev, [attachment.url]: url }));
            }
        } catch (e) {
            console.error('Attachment decrypt failed:', e);
            setError('Failed to decrypt');
        }
        setIsDecrypting(false);
    };

    const handleSave = () => {
        if (!sessionUrl) return;
        const link = document.createElement('a');
        link.href = sessionUrl;
        link.download = attachment.name || 'download';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    // 1. Loading/Decrypting State
    if (isDecrypting) {
        return (
            <div style={{ marginTop: '10px', padding: '12px', background: 'rgba(255,255,255,0.05)', borderRadius: '12px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                <Loader size={18} className="animate-spin text-cyan-400" />
                <span style={{ fontSize: '13px', color: '#aaa' }}>Downloading & Decrypting...</span>
            </div>
        );
    }

    // 2. Initial State (Not Decrypted in this session)
    if (!sessionUrl) {
        return (
            <div style={{ marginTop: '10px' }}>
                <div
                    onClick={handleDownloadAndDecrypt}
                    style={{ background: 'rgba(102, 252, 241, 0.1)', border: '1px solid rgba(102, 252, 241, 0.3)', padding: '12px', borderRadius: '12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '12px' }}
                >
                    {isImage ? <ImageIcon size={24} style={{ color: '#66fcf1' }} /> : <FileIcon size={24} style={{ color: '#66fcf1' }} />}
                    <div style={{ overflow: 'hidden', flex: 1 }}>
                        <div style={{ color: '#fff', fontSize: '14px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{attachment.name}</div>
                        <div style={{ color: '#00ff88', fontSize: '10px', fontWeight: 'bold' }}>OPEN / DECRYPT</div>
                    </div>
                </div>
            </div>
        );
    }

    // 3. Decrypted State (Available in this session)
    return (
        <div style={{ marginTop: '10px', maxWidth: '300px', position: 'relative' }}>
            {isImage ? (
                <div style={{ position: 'relative' }}>
                    <img
                        src={sessionUrl}
                        alt={attachment.name}
                        style={{ width: '100%', maxHeight: '200px', objectFit: 'cover', borderRadius: '12px', cursor: 'pointer', boxShadow: '0 4px 15px rgba(0,0,0,0.3)' }}
                        onClick={() => onImageClick && onImageClick({ url: sessionUrl, name: attachment.name, type: attachment.type })}
                    />
                </div>
            ) : (
                <div
                    onClick={handleSave}
                    style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px', background: 'rgba(255,255,255,0.05)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.1)', cursor: 'pointer' }}
                >
                    <FileIcon size={24} style={{ color: '#00e5a0' }} />
                    <div style={{ overflow: 'hidden' }}>
                        <div style={{ color: '#fff', fontSize: '14px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{attachment.name}</div>
                        <div style={{ color: '#00ff88', fontSize: '10px', fontWeight: 'bold' }}>VIEW / SAVE</div>
                    </div>
                </div>
            )}

            <button
                onClick={() => onForward(attachment)}
                style={{ position: 'absolute', top: '8px', right: '8px', background: 'rgba(0,0,0,0.6)', color: '#fff', border: 'none', padding: '6px', borderRadius: '50%', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                title="Forward"
            >
                <Forward size={16} />
            </button>

            <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
                {(isImage || attachment.type === 'application/pdf') && (
                    <button
                        onClick={() => {
                            if (isImage) {
                                onImageClick && onImageClick({ url: sessionUrl, name: attachment.name, type: attachment.type });
                            } else {
                                window.open(sessionUrl, '_blank');
                            }
                        }}
                        style={{ flex: 1, background: 'rgba(255, 255, 255, 0.05)', color: '#fff', border: '1px solid rgba(255, 255, 255, 0.1)', padding: '6px 12px', borderRadius: '8px', cursor: 'pointer', fontSize: '12px' }}
                    >
                        View
                    </button>
                )}
                <button
                    onClick={handleSave}
                    style={{ flex: 1, background: 'rgba(0, 229, 160, 0.1)', color: '#00e5a0', border: '1px solid rgba(0, 229, 160, 0.3)', padding: '6px 12px', borderRadius: '8px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px', fontSize: '12px' }}
                >
                    <Download size={14} /> Save
                </button>
            </div>
        </div>
    );
};

const Chat = () => {
    const { user, setUser: setCurrentUser, keys, logout, apiFetch, loading } = useAuth();
    // 🧪 SURGICAL JWT CLAIMS INSPECTOR
    if (user?.accessToken) {
        try {
            const base64Url = user.accessToken.split('.')[1];
            const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
            const parsedPayload = JSON.parse(window.atob(base64));
        } catch (e) {
            console.error("🛡️ Diagnostic JWT Parse Failure:", e);
        }
    }
    const navigate = useNavigate();
    const stompClient = useRef(null);
    const keysRef = useRef(keys);

    // Sync keysRef with keys state to avoid stale closures in listeners
    useEffect(() => {
        keysRef.current = keys;
    }, [keys]);

    const [messagesByFriend, setMessagesByFriend] = useState({}); // { friendId: [msg1, msg2] }
    const [inputMsg, setInputMsg] = useState('');
    const [selectedFile, setSelectedFile] = useState(null);
    const [isUploading, setIsUploading] = useState(false);
    const [selectedImage, setSelectedImage] = useState(null);
    const fileInputRef = useRef(null);
    const [showCamera, setShowCamera] = useState(false);
    const videoRef = useRef(null);
    const streamRef = useRef(null);

    const chatContainerRef = useRef(null);
    const messagesEndRef = useRef(null);
    const isNearBottomRef = useRef(true);

    // Social graph states
    const [searchUsername, setSearchUsername] = useState('');
    const [searchResults, setSearchResults] = useState([]);
    const [friends, setFriends] = useState([]);
    const [requests, setRequests] = useState([]);
    const [activeTab, setActiveTab] = useState('friends'); // 'friends', 'requests', 'add'

    // Active chat state
    const [activeFriend, setActiveFriend] = useState(null); // { id, userId, username, email }
    const activeFriendRef = useRef(null);
    const activeGroupRef = useRef(null);
    const friendsRef = useRef([]);
    const groupsRef = useRef([]);
    const [status, setStatus] = useState('Connecting...');

    // Unread messages & toast notification
    const [unreadCounts, setUnreadCounts] = useState({}); // { friendId: count }
    const [attachmentCache, setAttachmentCache] = useState({}); // { url: decryptedUrl }
    const [toast, setToast] = useState(null); // { senderName, content, visible }
    const toastTimeoutRef = useRef(null);

    // 📊 PHASE 8: PERSONAL IDENTITY & ALIAS STATES
    const [showAliasModal, setShowAliasModal] = useState(null);
    const [aliasInput, setAliasInput] = useState("");
    const [showContactDetails, setShowContactDetails] = useState(false);
    const [isEditingAlias, setIsEditingAlias] = useState(false);
    const [showProfileSettings, setShowProfileSettings] = useState(false);
    const [profileFormData, setProfileFormData] = useState({ username: '', email: '', currentPassword: '', newPassword: '' });
    const profileAvatarInputRef = useRef(null);



    const [showForwardModal, setShowForwardModal] = useState(false);
    const [forwardingAttachment, setForwardingAttachment] = useState(null);
    const groupSubscriptionRef = useRef(null);

    // Group Chat States
    const [groups, setGroups] = useState([]);
    const [activeGroup, setActiveGroup] = useState(null);
    const [showCreateGroupModal, setShowCreateGroupModal] = useState(false);
    const [selectedMembers, setSelectedMembers] = useState([]);
    const [newGroupName, setNewGroupName] = useState('');
    const [isCreatingGroup, setIsCreatingGroup] = useState(false);
    const [groupRosterKeys, setGroupRosterKeys] = useState({}); // { groupId: [ { userId, publicKey }, ... ] }
    const [decryptedFiles, setDecryptedFiles] = useState({}); // { messageId: blobUrl }
    const [liveTickTrigger, setLiveTickTrigger] = useState(0);
    const [editingMessage, setEditingMessage] = useState(null);
    const [showGroupDetails, setShowGroupDetails] = useState(false);
    const [showPromoteModal, setShowPromoteModal] = useState(false);
    const [selectedMemberToPromote, setSelectedMemberToPromote] = useState(null);
    const [showAddMemberModal, setShowAddMemberModal] = useState(false);
    const [selectedFriendToAdd, setSelectedFriendToAdd] = useState(null);
    const [showRemoveMemberModal, setShowRemoveMemberModal] = useState(false);

    // 📊 PHASE 7: GROUP CUSTOMIZATION STATE PRIMITIVES
    const [isEditingGroupName, setIsEditingGroupName] = useState(false);
    const [editGroupNameInput, setEditGroupNameInput] = useState("");
    const groupAvatarInputRef = useRef(null); // Reference for the hidden file input

    // 📊 ROSTER UI LIMIT STATE (PATCH)
    const [visibleRosterCount, setVisibleRosterCount] = useState(6);

    const handleScroll = () => {
        if (!chatContainerRef.current) return;
        const { scrollTop, scrollHeight, clientHeight } = chatContainerRef.current;
        isNearBottomRef.current = scrollHeight - scrollTop - clientHeight < 150;
    };

    const currentChatId = activeGroup?.groupId || activeFriend?.userId;
    const activeChatMessages = messagesByFriend[currentChatId] || [];

    // TRIGGER 1: Room Switch -> Snap Instantly
    useEffect(() => {
        if (activeFriend || activeGroup) {
            isNearBottomRef.current = true;
            setTimeout(() => {
                messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
            }, 50);
        }
    }, [activeFriend?.userId, activeGroup?.groupId]);

    // TRIGGER 2: New Message -> Smooth Glide
    useEffect(() => {
        if (isNearBottomRef.current) {
            setTimeout(() => {
                messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
            }, 50);
        }
    }, [activeChatMessages.length]);

    // Keep activeFriendRef in sync
    useEffect(() => {
        activeFriendRef.current = activeFriend;
        // Clear unread count when opening a friend's chat
        if (activeFriend) {
            setActiveGroup(null);
            setUnreadCounts(prev => ({ ...prev, [activeFriend.userId]: 0 }));
        }
    }, [activeFriend]);

    // Keep activeGroupRef, friendsRef, and groupsRef in sync
    useEffect(() => {
        activeGroupRef.current = activeGroup;
    }, [activeGroup]);

    useEffect(() => {
        friendsRef.current = friends;
    }, [friends]);

    useEffect(() => {
        groupsRef.current = groups;
    }, [groups]);

    useEffect(() => {
        if (activeGroup) {
            setActiveFriend(null);
            fetchGroupRoster(activeGroup.groupId);

            // Subscribe to group topic for real-time payloads
            if (stompClient.current && stompClient.current.connected) {
                if (groupSubscriptionRef.current) groupSubscriptionRef.current.unsubscribe();
                groupSubscriptionRef.current = stompClient.current.subscribe(`/topic/group.${activeGroup.groupId}`, (msg) => {
                    const incomingPacket = JSON.parse(msg.body);

                    // 📊 WEBSOCKET SWITCH-CASE DISPATCH OVERRIDE: LIVE ROLE MANAGEMENT
                    if (incomingPacket.type === 'ROLE_UPDATED' && activeGroup && String(incomingPacket.groupId) === String(activeGroup.groupId)) {
                        fetchGroupRoster(activeGroup.groupId); // Refresh full roster to sync flags
                        return;
                    }

                    // 📊 WEBSOCKET SWITCH-CASE OVERRIDE: LIVE ROSTER DIRECTORY Handlers
                    if (incomingPacket.type === 'MEMBER_ADDED' && activeGroup && String(incomingPacket.groupId) === String(activeGroup.groupId)) {
                        fetchGroupRoster(activeGroup.groupId); // Refresh full roster
                        return;
                    }

                    // 📊 REFACTORED WEBSOCKET SWITCH-CASE: SECURE FORWARD SECRECY RE-KEYING LIFECYCLE
                    if (incomingPacket.type === 'MEMBER_KICKED' && activeGroup && String(incomingPacket.groupId) === String(activeGroup.groupId)) {

                        // CASE A: Current user is the one evicted -> Force close chat panel instantly
                        if (String(incomingPacket.kickedUserId) === String(user.userId)) {
                            if (typeof setActiveGroup === 'function') setActiveGroup(null);
                            alert("Your session access privilege clearances for this conversation space have expired.");
                            return;
                        }

                        // ============================================================================
                        // FIX 1: UPDATE ROSTER FILTER IMMEDIATELY (Prevents view-lag regardless of crypto type)
                        // ============================================================================
                        if (typeof setActiveGroup === 'function') {
                            setActiveGroup(prev => {
                                if (!prev) return prev;
                                return {
                                    ...prev,
                                    members: (prev.members || []).filter(m => String(m.userId) !== String(incomingPacket.kickedUserId))
                                };
                            });
                        }

                        // CASE B: Remaining group participant path -> Hot-swap memory key strings securely
                        const freshWrappedKeyMap = incomingPacket.rotatedKeys;
                        const currentUserIdStr = String(user.userId);

                        if (freshWrappedKeyMap && freshWrappedKeyMap[currentUserIdStr]) {
                            const targetWrappedKeyB64 = freshWrappedKeyMap[currentUserIdStr];

                            // Auto-detect functional cryptographic namespace handles active in code
                            const decryptFn = typeof decryptAESKeyWithRSA === 'function' ? decryptAESKeyWithRSA : null;

                            if (decryptFn) {
                                // ============================================================================
                                // FIX 2: UNIVERSAL PROMISE WRAPPER (Safely handles both Sync & Async returns)
                                // ============================================================================
                                Promise.resolve(decryptFn(targetWrappedKeyB64, keys.privateKey))
                                    .then(clearSymmetricKeyBytes => {
                                        if (typeof setActiveGroup === 'function') {
                                            setActiveGroup(prev => {
                                                if (!prev) return prev;
                                                return {
                                                    ...prev,
                                                    decryptedKey: clearSymmetricKeyBytes
                                                };
                                            });
                                        }
                                        // Also update the groupRosterKeys cache for roster consistency
                                        fetchGroupRoster(activeGroup.groupId);
                                    })
                                    .catch(cryptoErr => {
                                        console.error("❌ Key rotation decryption pipeline failed:", cryptoErr);
                                    });
                            }
                        } else {
                            // Roster update fallback
                            fetchGroupRoster(activeGroup.groupId);
                        }
                        return;
                    }

                    // 📊 WEBSOCKET LISTENER: AUTOMATIC DISSOLUTION (PHASE 6)
                    if (incomingPacket.type === 'GROUP_DISSOLVED') {
                        setGroups(prev => prev.filter(g => String(g.groupId) !== String(incomingPacket.groupId)));
                        if (activeGroup && String(activeGroup.groupId) === String(incomingPacket.groupId)) {
                            setActiveGroup(null);
                            alert("The final administrator has exited. This group has been permanently dissolved.");
                        }
                        return;
                    }

                    // 📊 WEBSOCKET LISTENER: VOLUNTARY EXIT & KEY ROTATION (PHASE 6)
                    if (incomingPacket.type === 'MEMBER_EXITED' && activeGroup && String(incomingPacket.groupId) === String(activeGroup.groupId)) {
                        // Instantly remove them from the UI roster
                        setActiveGroup(prev => {
                            if (!prev) return prev;
                            return {
                                ...prev,
                                members: (prev.members || []).filter(m => String(m.userId) !== String(incomingPacket.exitedUserId))
                            };
                        });

                        // Re-key if a payload exists (same as eviction handling)
                        const freshWrappedKeyMap = incomingPacket.rotatedKeys;
                        const currentUserIdStr = String(user.userId);

                        if (freshWrappedKeyMap && freshWrappedKeyMap[currentUserIdStr]) {
                            const targetWrappedKeyB64 = freshWrappedKeyMap[currentUserIdStr];
                            const decryptFn = typeof decryptAESKeyWithRSA === 'function' ? decryptAESKeyWithRSA : null;

                            if (decryptFn) {
                                Promise.resolve(decryptFn(targetWrappedKeyB64, keys.privateKey))
                                    .then(clearSymmetricKeyBytes => {
                                        setActiveGroup(prev => {
                                            if (!prev) return prev;
                                            return { ...prev, decryptedKey: clearSymmetricKeyBytes };
                                        });
                                        fetchGroupRoster(activeGroup.groupId);
                                    }).catch(err => console.error("Key rotation decryption failed:", err));
                            }
                        }
                        return;
                    }

                    // 📊 WEBSOCKET LISTENER: GROUP METADATA SYNC (Name & Avatar) (PHASE 7)
                    if (incomingPacket.type === 'GROUP_UPDATED') {
                        const { groupId, newName, newAvatar } = incomingPacket;

                        // Update active open panel view
                        if (activeGroup && String(activeGroup.groupId) === String(groupId)) {
                            setActiveGroup(prev => {
                                if (!prev) return prev;
                                return {
                                    ...prev,
                                    name: newName || prev.name,
                                    groupAvatar: newAvatar !== undefined ? newAvatar : prev.groupAvatar
                                };
                            });
                        }

                        // Update background groups list navigation drawer
                        setGroups(prev => prev.map(g => String(g.groupId) === String(groupId) ? {
                            ...g,
                            name: newName || g.name,
                            groupAvatar: newAvatar !== undefined ? newAvatar : g.groupAvatar
                        } : g));

                        return;
                    }

                    // Note: E2EE group messages are already fanned out and decrypted via your personal /topic/messages.${user.userId} subscription.
                    // Redundant chat message processing here is ignored to prevent duplicate bubbles.

                    // ROUTE 2: Handle Read Receipts
                    if (incomingPacket.type === 'RECEIPT_UPDATE' || incomingPacket.isReceipt || incomingPacket.lastReadAt) {
                        handleIncomingMessage(incomingPacket);
                    }
                });
            }

            // Explicitly fetch and store group member public keys
            fetchGroupRoster(activeGroup.groupId);
        } else {
            if (groupSubscriptionRef.current) {
                groupSubscriptionRef.current.unsubscribe();
                groupSubscriptionRef.current = null;
            }
        }
    }, [activeGroup, stompClient.current?.connected]);

    const fetchGroupRoster = async (groupId) => {
        try {
            const res = await apiFetch(`${import.meta.env.VITE_API_URL}/api/v1/groups/${groupId}/roster-keys`);
            if (res.ok) {
                const roster = await res.json();
                setGroupRosterKeys(prev => ({ ...prev, [groupId]: roster }));
            }
        } catch (e) {
            console.error("Error fetching group roster:", e);
        }
    };

    // 📊 OMNICHANNEL MEDIA CAPTURE & DISPATCH ENGINE (PHASE 7)
    const handleGroupMetadataUpdate = async (newName, base64Avatar) => {
        try {
            const payload = {};
            if (newName) payload.name = newName;
            if (base64Avatar !== undefined) payload.avatar = base64Avatar;

            const res = await apiFetch(`${import.meta.env.VITE_API_URL}/api/v1/groups/${activeGroup.groupId}/update`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (res.ok) {
                // 🔥 OPTIMISTIC UI UPDATE: Repaint instantly on 200 OK success
                setActiveGroup(prev => ({
                    ...prev,
                    name: newName || prev.name,
                    groupAvatar: base64Avatar !== undefined ? base64Avatar : prev.groupAvatar
                }));

                setGroups(prev => prev.map(g => String(g.groupId) === String(activeGroup.groupId) ? {
                    ...g,
                    name: newName || g.name,
                    groupAvatar: base64Avatar !== undefined ? base64Avatar : g.groupAvatar
                } : g));

                setIsEditingGroupName(false);
            }
        } catch (err) {
            console.error("❌ Group metadata update rejected by server:", err);
            alert("Failed to update group. Ensure image size is within database text limits.");
        }
    };

    const handleAvatarFileChange = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        // Read file as Base64 String
        const reader = new FileReader();
        reader.onloadend = () => {
            const base64String = reader.result;
            handleGroupMetadataUpdate(null, base64String);
        };
        reader.readAsDataURL(file);
    };

    const requestNotificationPermission = async () => {
        try {
            // 1. Structural check to ensure the messaging engine is alive
            if (!messaging) {
                console.warn("⚠️ [FIREBASE APP CHECK] Messaging engine is uninitialized or unsupported in this context.");
                return;
            }

            const permission = await Notification.requestPermission();
            if (permission === "granted") {

                // 2. Pass the validated messaging token container instance explicitly
                const token = await getToken(messaging, {
                    vapidKey: import.meta.env.VITE_FIREBASE_VAPID_KEY
                });

                if (token) {
                    // Sync token with backend if authenticated
                    if (user?.accessToken) {
                        await fetch(`${import.meta.env.VITE_API_URL}/api/v1/users/fcm-token`, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': 'Bearer ' + user.accessToken
                            },
                            body: JSON.stringify({ fcmToken: token })
                        });
                    }
                } else {
                    console.warn("⚠️ No registration token available. Verify service worker registration pathing.");
                }
            }
        } catch (err) {
            console.error("❌ Asynchronous Firebase Installations / Token retrieval failed:", err.message);
        }
    };

    useEffect(() => {
        if (loading) return; // Wait for session restore to finish

        if (!user) {
            navigate('/');
            return;
        }
        connectWebSocket();
        fetchSocialData();
        requestNotificationPermission();

        // 📊 AUTOMATED CLIENT-SIDE CRYPTO KEY REPAIR HANDSHAKE (PHASE 4 STABILIZATION)
        const initializeCryptographicIdentityIfMissing = async () => {
            try {
                // 1. Attempt to fetch existing key bundle matching current user token
                const bundleRes = await apiFetch(`${import.meta.env.VITE_API_URL}/api/v1/users/key-bundle`);

                if (bundleRes.ok) {
                    return;
                }

                // 2. Intercept the 404 to identify a fresh uninitialized account profile
                if (bundleRes.status === 404) {
                    // Safety backup: If keys already exist in local storage, sync them to server rather than generating new ones
                    const storedEncryptedKeys = localStorage.getItem(`rsaKeys_${user.userId}`);
                    if (storedEncryptedKeys) {
                        await apiFetch(`${import.meta.env.VITE_API_URL}/api/v1/users/key-bundle`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                encryptedKeyBundle: storedEncryptedKeys
                            })
                        });
                        return;
                    }
                    try {
                        // 3. Generate a brand-new unique asymmetric RSA-OAEP key pair natively on the client
                        const keyPair = await window.crypto.subtle.generateKey(
                            {
                                name: "RSA-OAEP",
                                modulusLength: 2048,
                                publicExponent: new Uint8Array([1, 0, 1]),
                                hash: "SHA-256"
                            },
                            true,
                            ["encrypt", "decrypt"]
                        );

                        // 4. Export keys to transportable formats
                        const exportedPublicKey = await window.crypto.subtle.exportKey("spki", keyPair.publicKey);
                        const publicKeyB64 = btoa(String.fromCharCode(...new Uint8Array(exportedPublicKey)));

                        const exportedPrivateKey = await window.crypto.subtle.exportKey("pkcs8", keyPair.privateKey);
                        const privateKeyB64 = btoa(String.fromCharCode(...new Uint8Array(exportedPrivateKey)));

                        // 5. Submit the fresh public keys to the server schema registry
                        await apiFetch(`${import.meta.env.VITE_API_URL}/api/v1/users/key-bundle`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                publicKey: publicKeyB64,
                                encryptedKeyBundle: "USER_PRIVATE_HOLDER_" + privateKeyB64 // Securely encapsulate client tracking parameters
                            })
                        });

                        // 6. Also sync the public key to the separate sync-key endpoint for roster discovery
                        await apiFetch(`${import.meta.env.VITE_API_URL}/api/v1/users/sync-key`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ publicKey: publicKeyB64 })
                        });

                    } catch (genErr) {
                        console.error("❌ Fatal crash during runtime WebCrypto execution:", genErr);
                    }
                } else {
                    console.error("❌ Alternative network issue caught during profile handshake:", bundleRes.status);
                }
            } catch (err) {
                console.error("❌ Exception captured during cryptographic repair initialization:", err.message);
            }
        };

        initializeCryptographicIdentityIfMissing();

        // DYNAMIC SERVICE WORKER REGISTRATION
        if ('serviceWorker' in navigator) {
            // Extract clean parameters straight from Vite's compiled environment configuration
            const apiKey = encodeURIComponent(import.meta.env.VITE_FIREBASE_API_KEY || '');
            const authDomain = encodeURIComponent(import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || '');
            const projectId = encodeURIComponent(import.meta.env.VITE_FIREBASE_PROJECT_ID || '');
            const storageBucket = encodeURIComponent(import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || '');
            const messagingSenderId = encodeURIComponent(import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '');
            const appId = encodeURIComponent(import.meta.env.VITE_FIREBASE_APP_ID || '');

            // Package variables straight into the registration initialization query birth-line
            const swUrl = `/firebase-messaging-sw.js?apiKey=${apiKey}&authDomain=${authDomain}&projectId=${projectId}&storageBucket=${storageBucket}&messagingSenderId=${messagingSenderId}&appId=${appId}`;

            navigator.serviceWorker.register(swUrl)
                .then((registration) => {
                })
                .catch((err) => {
                    console.error('Service Worker registration failed:', err);
                });
        }

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

    const executeForward = async (recipientId) => {
        if (!stompClient.current || !stompClient.current.connected) {
            alert('WebSocket not connected.');
            return;
        }
        if (!keys) return;
        try {
            const pkUrl = `${import.meta.env.VITE_API_URL}/api/v1/users/${recipientId}/public-key`;
            const pkRes = await apiFetch(pkUrl);
            if (!pkRes.ok) throw new Error('Could not fetch public key');
            const pkText = await pkRes.text();
            let latestPubKey = pkText;
            try { latestPubKey = JSON.parse(pkText); } catch (e) { }

            const aesKey = generateAESKey();
            const encryptedAESKey = encryptAESKeyWithRSA(aesKey, latestPubKey);
            const senderEncryptedAESKey = encryptAESKeyWithRSA(aesKey, keys.publicKey);

            const messagePayloadObj = {
                text: '',
                attachment: forwardingAttachment
            };

            const encryptedData = encryptMessageWithAES(JSON.stringify(messagePayloadObj), aesKey);

            const payload = {
                recipientId: recipientId,
                encryptedAESKey: encryptedAESKey,
                senderEncryptedAESKey: senderEncryptedAESKey,
                encryptedMessage: encryptedData.ciphertext,
                iv: encryptedData.iv,
                tag: encryptedData.tag
            };

            stompClient.current.publish({
                destination: "/app/chat.sendMessage",
                body: JSON.stringify(payload)
            });

            if (activeFriend && activeFriend.userId === recipientId) {
                setMessagesByFriend(prev => ({
                    ...prev,
                    [recipientId]: [...(prev[recipientId] || []), {
                        id: Date.now(),
                        sender: user.userId,
                        content: '',
                        attachment: forwardingAttachment,
                        isMe: true,
                        timestamp: new Date().toLocaleTimeString()
                    }]
                }));
            }
            alert('Forwarded successfully!');
        } catch (e) {
            console.error(e);
            alert('Failed to forward attachment');
        } finally {
            setShowForwardModal(false);
            setForwardingAttachment(null);
        }
    };


    useEffect(() => {
        if (!(activeFriend || activeGroup) || !keys) return;

        const loadHistory = async () => {
            const chatId = activeGroup ? activeGroup.groupId : activeFriend?.userId;
            const isGroup = !!activeGroup;
            if (!chatId) return;

            try {
                const endpoint = activeGroup
                    ? `${import.meta.env.VITE_API_URL}/api/v1/groups/${chatId}/messages`
                    : `${import.meta.env.VITE_API_URL}/api/v1/messages/${chatId}`;

                const res = await apiFetch(endpoint);
                if (res.ok) {
                    const history = await res.json();
                    const cachedUrls = {};
                    const decryptedHistory = await Promise.all(history
                        .filter(m => (m.encryptedContent || m.encrypted_content || m.encryptedMessage || m.encrypted_message) && m.iv && m.tag)
                        .map(async (m) => {
                            let content = "[Encrypted]";
                            let attachment = null;
                            const currentKeys = keysRef.current;

                            // Defensive Property Normalization
                            const isGroup = !!m.groupId || !!m.group_id;
                            const rawKeysMap = m.wrappedKeys || m.wrapped_keys || m.wrappedKeyMap || {};

                            // --- NEW UNWRAPPING LOGIC ---
                            let actualKeysMap = rawKeysMap;
                            if (rawKeysMap && rawKeysMap.type === 'json' && typeof rawKeysMap.value === 'string') {
                                try {
                                    actualKeysMap = JSON.parse(rawKeysMap.value);
                                } catch (e) {
                                    console.error("Failed to parse nested keysMap JSON string:", e);
                                }
                            } else if (typeof rawKeysMap === 'string') {
                                try {
                                    actualKeysMap = JSON.parse(rawKeysMap);
                                } catch (e) { }
                            }
                            // ----------------------------

                            const encryptedText = m.encryptedContent || m.encrypted_content || m.encryptedMessage || m.encrypted_message;
                            const aesKeyToUse = isGroup
                                ? (actualKeysMap[user.userId])
                                : (m.senderId === user.userId ? (m.senderEncryptedAesKey || m.sender_encrypted_aes_key) : (m.encryptedAesKey || m.encrypted_aes_key));

                            // --- INJECTED DIAGNOSTIC LOGS ---
                            // --------------------------------

                            try {
                                // Check cache first
                                let aesKeyStr = m.id ? KeyCache.getKey(m.id) : null;

                                if (!aesKeyStr && currentKeys && aesKeyToUse) {
                                    aesKeyStr = decryptAESKeyWithRSA(aesKeyToUse, currentKeys.privateKey);
                                    if (m.id) KeyCache.saveKey(m.id, aesKeyStr);
                                }

                                if (aesKeyStr) {
                                    const encryptedData = {
                                        ciphertext: encryptedText,
                                        iv: m.iv,
                                        tag: m.tag
                                    };

                                    const decryptedStr = decryptMessageWithAES(encryptedData, aesKeyStr);

                                    // 📊 PHASE 4: SESSION KEY CAPTURE
                                    if (activeGroup && !activeGroup.decryptedKey) {
                                        activeGroup.decryptedKey = aesKeyStr;
                                    }

                                    try {
                                        const parsed = JSON.parse(decryptedStr);
                                        content = parsed.text || "";
                                        attachment = parsed.attachment || null;
                                    } catch (e) {
                                        content = decryptedStr;
                                    }
                                } else {
                                    content = "🔒 [Message could not be decrypted]";
                                }
                            } catch (e) {
                                console.error("❌ [HISTORY PARSE] Historical decryption failed for msg:", m.id, e);
                                content = "🔒 [Decryption Failed]";
                            }

                            // --- PERSISTENT CACHE CHECK ---
                            if (attachment && m.id) {
                                const cachedBlob = await getCachedFile(m.id);
                                if (cachedBlob) {
                                    cachedUrls[m.id] = URL.createObjectURL(cachedBlob);
                                }
                            }

                            return {
                                ...m,
                                id: m.id || `msg-${Math.random()}`,
                                sender: m.senderId,
                                content,
                                attachment,
                                isMe: m.senderId === user.userId,
                                rawTimestamp: m.timestamp,
                                displayTimestamp: new Date(m.timestamp).toLocaleTimeString()
                            };
                        }));

                    // Bulk update cached file URLs
                    if (Object.keys(cachedUrls).length > 0) {
                        setDecryptedFiles(prev => ({ ...prev, ...cachedUrls }));
                    }

                    setMessagesByFriend(prev => ({
                        ...prev,
                        [chatId]: decryptedHistory
                    }));

                    // Clear unread for the chat we just opened
                    if (activeGroup) {
                        apiFetch(`${import.meta.env.VITE_API_URL}/api/v1/groups/${chatId}/read`, { method: 'POST' });
                        // Also refresh the roster to get latest lastRead timestamps for others
                        fetchGroupRoster(chatId);
                    } else if (activeFriend) {
                        // NEW: Mark private messages as read via REST
                        apiFetch(`${import.meta.env.VITE_API_URL}/api/v1/messages/${chatId}/read`, { method: 'POST' });
                    }

                    setUnreadCounts(prev => ({ ...prev, [chatId]: 0 }));
                    localStorage.setItem(`lastRead_${chatId}`, new Date().toISOString());
                }
            } catch (e) {
                console.error("Failed to load history", e);
            }
        };

        loadHistory();
    }, [activeFriend, activeGroup, keys]);

    const fetchSocialData = async () => {
        try {
            const [friendsRes, requestsRes] = await Promise.all([
                apiFetch(`${import.meta.env.VITE_API_URL}/api/v1/friends`),
                apiFetch(`${import.meta.env.VITE_API_URL}/api/v1/friends/requests`)
            ]);

            let friendsList = [];
            if (friendsRes.ok) {
                friendsList = await friendsRes.json();
                setFriends(friendsList);
            }
            if (requestsRes.ok) setRequests(await requestsRes.json());

            // Gated Admin Fetch: Ensure only admins hit the admin endpoint. Fallback to user-groups for standard users.
            const groupsEndpoint = user?.role === 'ROLE_ADMIN'
                ? `${import.meta.env.VITE_API_URL}/api/v1/admin/groups`
                : `${import.meta.env.VITE_API_URL}/api/v1/groups/my-groups`;

            const groupsRes = await apiFetch(groupsEndpoint);
            const groupsList = groupsRes.ok ? await groupsRes.json() : [];
            setGroups(groupsList);

            // After loading friends and groups, check each for unread messages
            fetchAllUnreadCounts(friendsList, groupsList);
        } catch (e) {
            console.error("Failed to fetch social data", e);
        }
    };

    const fetchAllUnreadCounts = async (friendsList, groupsList = []) => {
        if (!keys) return;

        for (const friend of friendsList) {
            try {
                const res = await apiFetch(`${import.meta.env.VITE_API_URL}/api/v1/messages/${friend.userId}`);
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
        for (const group of groupsList) {
            try {
                const res = await apiFetch(`${import.meta.env.VITE_API_URL}/api/v1/groups/${group.groupId}/messages`);
                if (res.ok) {
                    const history = await res.json();

                    // 1. Get the user's personal lastRead from roster or fallback to localStorage
                    let lastReadStr = localStorage.getItem(`lastRead_${group.groupId}`);

                    // Try to find the user's lastReadAt from the roster if available
                    const roster = groupRosterKeys[group.groupId] || [];
                    const me = roster.find(m => m.userId === user.userId);
                    if (me && me.lastReadAt) {
                        lastReadStr = me.lastReadAt;
                    }

                    if (!lastReadStr) {
                        lastReadStr = new Date().toISOString();
                        localStorage.setItem(`lastRead_${group.groupId}`, lastReadStr);
                    }

                    const lastReadTime = new Date(lastReadStr).getTime();

                    // 2. Count messages sent AFTER my lastRead
                    const unreadCount = history.filter(m =>
                        m.senderId !== user.userId &&
                        new Date(m.timestamp).getTime() > lastReadTime
                    ).length;

                    setUnreadCounts(prev => ({
                        ...prev,
                        [group.groupId]: unreadCount
                    }));
                }
            } catch (e) {
                // silently skip
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
            const res = await apiFetch(`${import.meta.env.VITE_API_URL}/api/v1/users/search?query=${query}`);
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
            const res = await apiFetch(`${import.meta.env.VITE_API_URL}/api/v1/friends/request/${targetUsername}`, {
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
            const res = await apiFetch(`${import.meta.env.VITE_API_URL}/api/v1/friends/accept/${requestId}`, {
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
        if (stompClient.current && (stompClient.current.connected || stompClient.current.active)) return;
        const wsUrl = `${import.meta.env.VITE_API_URL}/ws`.replace('http://', 'ws://').replace('https://', 'wss://');
        const client = Stomp.over(() => new WebSocket(wsUrl, ['v10.stomp', 'v11.stomp', 'v12.stomp']));
        client.debug = () => { };

        // Resilience settings
        client.reconnectDelay = 5000;
        client.heartbeat.outgoing = 10000;
        client.heartbeat.incoming = 10000;

        client.onConnect = () => {
            setStatus('Connected securely');

            const handleIncomingPayload = (body) => {
                let incomingPacket;
                try {
                    incomingPacket = JSON.parse(body);
                } catch (parseErr) {
                    console.error("❌ [DEEP TRACE - PARSE CRASH] STOMP body text is not valid structural JSON!", parseErr);
                    return;
                }

                // ROUTE 1: Secured Message Traffic
                if (incomingPacket.encryptedContent || incomingPacket.type === 'CHAT_MESSAGE') {
                    handleIncomingMessage(incomingPacket);
                    return;
                }

                // ROUTE 2: Structural Read Receipts
                if (incomingPacket.type === 'RECEIPT_UPDATE' || incomingPacket.isReceipt || incomingPacket.lastReadAt) {
                    const targetFriendId = incomingPacket.readerId || incomingPacket.userId || incomingPacket.senderId;

                    setMessagesByFriend(prev => {
                        const chatHistory = prev[targetFriendId] || [];
                        const uniqueRenderTrigger = Math.random();
                        return {
                            ...prev,
                            [targetFriendId]: chatHistory.map(msg => ({ ...msg, _liveTickPaintTrigger: uniqueRenderTrigger }))
                        };
                    });

                    setFriends(prevFriends => {
                        return prevFriends.map(f => {
                            const matchId = f.id || f.userId || f.user_id;
                            if (matchId === targetFriendId) {
                                return { ...f, lastReadAt: incomingPacket.lastReadAt, last_read_at: incomingPacket.lastReadAt };
                            }
                            return f;
                        });
                    });

                    const updateActiveRef = (prev) => {
                        if (!prev) return prev;

                        // 🔥 THE CORRECTION: Prioritize the account identity keys (userId) over row keys (id)
                        const targetFriendId = incomingPacket.readerId || incomingPacket.userId || incomingPacket.senderId;
                        const actualFriendUserId = prev.userId || prev.user_id || prev.id;

                        // Secure the match by checking both properties safely
                        if (actualFriendUserId === targetFriendId || prev.userId === targetFriendId || prev.user_id === targetFriendId) {
                            return {
                                ...prev,
                                lastReadAt: incomingPacket.lastReadAt,
                                last_read_at: incomingPacket.lastReadAt
                            };
                        }
                        return prev;
                    };

                    if (typeof setActiveFriend === 'function') setActiveFriend(updateActiveRef);
                    if (typeof setSelectedUser === 'function') setSelectedUser(updateActiveRef);
                    if (typeof setCurrentChatUser === 'function') setCurrentChatUser(updateActiveRef);
                    return;
                }

                // 🚨 WEBSOCKET SWITCH-CASE DISPATCH OVERRIDES
                // Condition 1: Live Message Revocation Catch
                if (incomingPacket.type === 'MESSAGE_REVOKED') {
                    const targetId = incomingPacket.messageId;

                    setMessagesByFriend(prev => {
                        const store = { ...prev };
                        Object.keys(store).forEach(fId => {
                            store[fId] = store[fId].map(m => String(m.id) === String(targetId) ? { ...m, isDeleted: true, content: null, encryptedContent: null, attachment: null } : m);
                        });
                        return store;
                    });
                    if (typeof setGroupMessages === 'function') {
                        setGroupMessages(prev => prev.map(m => String(m.id) === String(targetId) ? { ...m, isDeleted: true, content: null, encryptedContent: null, attachment: null } : m));
                    }
                    purgeSingleCachedFile(targetId); // Force-purge physical attachments out of client IndexedDB cache
                    return;
                }

                // Condition 2: Live Message Edit Payload Mutation
                if (incomingPacket.type === 'MESSAGE_EDITED') {
                    const targetId = incomingPacket.messageId;

                    setMessagesByFriend(prev => {
                        const store = { ...prev };
                        Object.keys(store).forEach(fId => {
                            store[fId] = store[fId].map(m => String(m.id) === String(targetId) ? {
                                ...m,
                                isEdited: true,
                                encryptedContent: incomingPacket.encryptedContent,
                                iv: incomingPacket.iv,
                                tag: incomingPacket.tag
                            } : m);
                        });
                        return store;
                    });
                    if (typeof setGroupMessages === 'function') {
                        setGroupMessages(prev => prev.map(m => String(m.id) === String(targetId) ? {
                            ...m,
                            isEdited: true,
                            encryptedContent: incomingPacket.encryptedContent,
                            iv: incomingPacket.iv,
                            tag: incomingPacket.tag
                        } : m));
                    }
                    return;
                }
            };

            // 1. Subscribe to personal queue (for 1-to-1 incoming messages/receipts)
            client.subscribe('/user/queue/messages', (sdkMessage) => {
                handleIncomingPayload(sdkMessage.body);
            });

            // 2. Subscribe to personal dot-routed topic (for fanned-out group messages/receipts)
            if (user?.userId) {
                client.subscribe(`/topic/messages.${user.userId}`, (sdkMessage) => {
                    handleIncomingPayload(sdkMessage.body);
                });
            }
        };

        client.onStompError = (frame) => {
            console.error('Broker reported error: ' + frame.headers['message']);
            setStatus('Reconnecting...');
        };

        client.onWebSocketClose = () => {
            if (stompClient.current?.active) {
                setStatus('Reconnecting...');
            }
        };

        client.connect({ 'Authorization': 'Bearer ' + user.accessToken }, client.onConnect, (error) => {
            setStatus('Reconnecting...');
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
        // 0. Defensive Normalization (Handle snake_case vs camelCase)
        const senderId = payload.senderId || payload.sender_id;
        const groupId = payload.groupId || payload.group_id;
        const wrappedKeys = payload.wrappedKeys || payload.wrapped_keys;
        const encryptedContent = payload.encryptedContent || payload.encryptedMessage || payload.encrypted_message;
        const iv = payload.iv;
        const tag = payload.tag;
        const messageId = payload.id || payload.messageId || payload.message_id;

        // 1. Handle TYPE_RECEIPT packets or live sync broadcasts
        if ((messageId && payload.status) || payload.type === 'RECEIPT_UPDATE' || payload.lastReadAt || payload.readAt || payload.isReceipt || (groupId && !encryptedContent)) {

            // LOG: Live Packet Hit

            // A. Group Receipts: Update the roster timestamps for real-time tick calculation
            if (groupId) {
                const receiptTime = payload.timestamp || payload.lastReadAt || new Date().toISOString();
                const readerId = payload.recipientId || payload.userId || payload.senderId;

                // Update global roster cache (Source of truth for message ticks)
                setGroupRosterKeys(prev => {
                    const roster = prev[groupId] || [];

                    const updatedRoster = roster.map(m => {
                        const mId = m.userId || m.id || m.user_id;
                        if (mId === readerId) {
                            return { ...m, lastReadAt: receiptTime, last_read_at: receiptTime };
                        }
                        return m;
                    });
                    return { ...prev, [groupId]: updatedRoster };
                });

                // 1. Force update the Active Group Roster so the math recalculates
                setActiveGroup(prevGroup => {
                    if (!prevGroup || (prevGroup.groupId !== groupId && prevGroup.id !== groupId)) return prevGroup;
                    const updatedMembers = (prevGroup.members || prevGroup.roster || []).map(member => {
                        const mId = member.userId || member.id || member.user_id;
                        if (mId === readerId) {
                            return { ...member, lastReadAt: receiptTime, last_read_at: receiptTime };
                        }
                        return member;
                    });
                    return { ...prevGroup, members: updatedMembers };
                });

                // 2. Force a deep mutation on the messages array to trigger the DOM repaint
                setMessagesByFriend(prev => {
                    const chatHistory = prev[groupId] || [];

                    // FIX: Use a truly random decimal to guarantee a unique trigger instead of the clock
                    const uniqueRenderTrigger = Math.random();

                    return {
                        ...prev,
                        [groupId]: chatHistory.map(msg => ({
                            ...msg,
                            _liveTickPaintTrigger: uniqueRenderTrigger // The nuclear UI repaint flag
                        }))
                    };
                });

                setLiveTickTrigger(prev => prev + 1);
                return; // Sever the global status update for group messages
            }
            // B. Private Receipts: Nuclear Re-render
            const chatId = payload.recipientId === user.userId ? senderId : payload.recipientId;
            setMessagesByFriend(prev => {
                const chatHistory = prev[chatId] || [];
                const uniqueRenderTrigger = Math.random(); // Log-free bypass

                return {
                    ...prev,
                    [chatId]: chatHistory.map(msg => ({
                        ...msg,
                        _liveTickPaintTrigger: uniqueRenderTrigger
                    }))
                };
            });

            // Update the active friend's read pointer state
            setFriends(prevFriends => prevFriends.map(f =>
                f.userId === chatId || f.id === chatId
                    ? { ...f, lastReadAt: payload.timestamp, last_read_at: payload.timestamp }
                    : f
            ));
            return;
        }

        // 2. Prevent duplicate processing of the same message
        if (messageId && processedMessages.current.has(messageId)) return;

        if (messageId) processedMessages.current.add(messageId);

        let decryptedContent = '🔒 [Message could not be decrypted]';
        let attachment = null;
        const currentKeys = keysRef.current;

        try {
            // Check cache first
            let aesKeyStr = messageId ? KeyCache.getKey(messageId) : null;

            if (!aesKeyStr && currentKeys) {
                const wrappedKey = groupId
                    ? ((wrappedKeys && wrappedKeys[user.userId]) || payload.encryptedAESKey || payload.encryptedAesKey || payload.encrypted_aes_key)
                    : (senderId === user.userId
                        ? (payload.senderEncryptedAESKey || payload.senderEncryptedAesKey || payload.sender_encrypted_aes_key)
                        : payload.encryptedAESKey);

                if (wrappedKey) {
                    aesKeyStr = decryptAESKeyWithRSA(wrappedKey, currentKeys.privateKey);
                    if (messageId) KeyCache.saveKey(messageId, aesKeyStr);
                }
            }

            if (aesKeyStr) {
                const encryptedData = {
                    ciphertext: encryptedContent,
                    iv: iv,
                    tag: tag
                };

                const decryptedStr = decryptMessageWithAES(encryptedData, aesKeyStr);
                try {
                    const parsed = JSON.parse(decryptedStr);
                    decryptedContent = parsed.text || "";
                    attachment = parsed.attachment || null;
                } catch (e) {
                    decryptedContent = decryptedStr;
                }
            }
        } catch (error) {
            console.error('Decryption failed', error);
            decryptedContent = "🔒 [Decryption Failed]";
        }

        // 🚀 FIX 1: Route self-messages to the recipient's chat inbox, not our own!
        const isSelfMessage = senderId === user.userId;
        const chatId = payload.groupId || (isSelfMessage ? payload.recipientId : senderId);

        // 🚀 THE IMMUTABLE BUBBLING FIX: Break array reference using high-precision Server Time
        const serverTime = payload.timestamp ? new Date(payload.timestamp).getTime() : Date.now();
        if (payload.groupId) {
            setGroups(prevGroups => prevGroups.map(group => 
                group.groupId === chatId 
                    ? { ...group, lastActiveTimestamp: serverTime } 
                    : group
            ));
        } else {
            setFriends(prevFriends => prevFriends.map(friend => 
                friend.userId === chatId 
                    ? { ...friend, lastActiveTimestamp: serverTime } 
                    : friend
            ));
        }

        const incomingMessage = {
            id: payload.id || Date.now(),
            sender: senderId,
            content: decryptedContent,
            attachment: attachment,
            isMe: isSelfMessage,
            status: 'SENT',
            rawTimestamp: payload.timestamp || new Date().toISOString(),
            displayTimestamp: new Date().toLocaleTimeString()
        };

        // 🚀 FIX 2: Functional state update with Smart Deduplication
        setMessagesByFriend(prev => {
            const history = prev[chatId] || [];

            // 🚀 Deduplicate & Replace Engine: If we sent this, swap the optimistic PENDING message with the server message in-place
            if (isSelfMessage) {
                const matchIndex = history.findIndex(m =>
                    m.isMe &&
                    m.status === 'PENDING' &&
                    m.content === decryptedContent &&
                    (m.attachment?.name === attachment?.name)
                );

                if (matchIndex !== -1) {
                    const updatedHistory = [...history];
                    updatedHistory[matchIndex] = {
                        ...updatedHistory[matchIndex],
                        id: incomingMessage.id,
                        status: 'SENT',
                        rawTimestamp: incomingMessage.rawTimestamp,
                        displayTimestamp: incomingMessage.displayTimestamp
                    };
                    return { ...prev, [chatId]: updatedHistory };
                }
            }

            return { ...prev, [chatId]: [...history, incomingMessage] };
        });

        // If we are NOT viewing this chat, mark as unread + show toast
        const isCurrentChat = activeGroupRef.current
            ? activeGroupRef.current.groupId === payload.groupId
            : activeFriendRef.current?.userId === payload.senderId && !payload.groupId;

        if (!isCurrentChat) {
            setUnreadCounts(prev => ({
                ...prev,
                [chatId]: (prev[chatId] || 0) + 1
            }));

            let senderName = 'Someone';
            if (payload.groupId) {
                const group = groupsRef.current.find(g => g.groupId === payload.groupId);
                senderName = group ? `Group: ${group.name}` : 'Group Message';
            } else {
                const senderFriend = friendsRef.current.find(f => f.userId === payload.senderId);
                senderName = senderFriend ? senderFriend.username : 'Someone';
            }
            showToast(senderName, attachment ? '📁 Sent an attachment' : decryptedContent);
        } else {
            // Mark as read locally
            localStorage.setItem(`lastRead_${chatId}`, new Date().toISOString());

            // Send Read Receipt for 1-on-1 chats
            if (!payload.groupId && stompClient.current?.connected) {
                stompClient.current.publish({
                    destination: '/app/chat.receipt',
                    body: JSON.stringify({
                        messageId: messageId,
                        senderId: senderId,
                        recipientId: user.userId,
                        status: 'READ'
                    })
                });
            }
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

    const executeMessageRevocation = async (messageId) => {
        if (!window.confirm("Delete this message for everyone?")) return;
        try {
            // 📊 ENFORCED JSON ENVELOPE HEADER FOR REVOCATIONS
            const res = await axios.delete(`${import.meta.env.VITE_API_URL}/api/v1/messages/${messageId}/revoke`, {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${user.accessToken}`
                }
            });
            if (res.status === 200) {
                // 📊 OPTIMISTIC STATE PURGE - Triggers immediate repaint without chat switching
                setMessagesByFriend(prev => {
                    const store = { ...prev };
                    Object.keys(store).forEach(fId => {
                        store[fId] = store[fId].map(m => String(m.id) === String(messageId) ? { ...m, isDeleted: true, content: "", attachment: null } : m);
                    });
                    return store;
                });

                purgeSingleCachedFile(messageId);
            }
        } catch (e) {
            console.error("Error submitting message revocation stream:", e);
        }
    };

    const triggerInlineEditMode = (msg) => {
        if (!msg) return;
        setEditingMessage(msg);
        setInputMsg(msg.content || ""); // content contains the decrypted text in our state
    };

    const cancelEdit = () => {
        setEditingMessage(null);
        setInputMsg("");
    };

    const handleEditSubmit = async (e) => {
        if (e && typeof e.preventDefault === 'function') e.preventDefault();

        const targetMsg = editingMessage;
        const updatePlaintext = inputMsg;

        if (!targetMsg) return;

        const targetMessageId = targetMsg.id;

        try {
            setIsUploading(true);

            // Retrieve original AES key from cache
            const aesKeyStr = KeyCache.getKey(targetMessageId);
            if (!aesKeyStr) {
                setIsUploading(false);
                return;
            }

            const messagePayloadObj = {
                text: updatePlaintext,
                attachment: targetMsg.attachment
            };

            const encryptedData = encryptMessageWithAES(JSON.stringify(messagePayloadObj), aesKeyStr);

            const outboundJsonPayload = {
                encryptedContent: encryptedData.ciphertext,
                iv: encryptedData.iv,
                tag: encryptedData.tag
            };

            // Execute the network request using clean application/json headers
            axios.put(`${import.meta.env.VITE_API_URL}/api/v1/messages/${targetMessageId}/edit`, outboundJsonPayload, {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${user.accessToken}`
                }
            })
                .then(res => {

                    // Instant UI view update sequence
                    setMessagesByFriend(prev => {
                        const store = { ...prev };
                        Object.keys(store).forEach(fId => {
                            store[fId] = store[fId].map(m => String(m.id) === String(targetMessageId) ? {
                                ...m,
                                isEdited: true,
                                content: updatePlaintext, // Decrypted for local view
                                encryptedContent: encryptedData.ciphertext,
                                iv: encryptedData.iv,
                                tag: encryptedData.tag
                            } : m);
                        });
                        return store;
                    });

                    setEditingMessage(null);
                    setInputMsg("");
                })
                .catch(axiosErr => {
                    console.error("❌ Message edit failed on server boundary.");
                    if (axiosErr.response) {
                        console.error("   -> HTTP Response Code Status:", axiosErr.response.status);
                        console.error("   -> Server Error Payload Response Text:", axiosErr.response.data);
                    } else {
                        console.error("   -> Network Pipeline Structural Trace Error message:", axiosErr.message);
                    }
                });

        } catch (cryptoErr) {
            console.error("❌ [EDIT TRACE CRASH] Front-end cryptographic wrapper processing exception:", cryptoErr);
        } finally {
            setIsUploading(false);
        }
    };

    const executeAdminPromotion = async (targetUserId) => {
        try {
            await axios.put(`${import.meta.env.VITE_API_URL}/api/v1/groups/${activeGroup.groupId}/promote/${targetUserId}`, {}, {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${user.accessToken}`
                }
            });
        } catch (err) {
            console.error("❌ Exception captured during outbound role promotion call mapping:", err);
            alert("Failed to promote user. Ensure you are a group admin.");
        }
    };

    const sendMessage = async () => {
        if (editingMessage) {
            await handleEditSubmit();
            return;
        }
        const activeContext = activeFriend || activeGroup;
        if ((!inputMsg.trim() && !selectedFile) || !activeContext || !stompClient.current) return;

        try {
            setIsUploading(true);

            let latestPubKey = null;
            let groupRoster = null;

            if (activeFriend) {
                const pkUrl = `${import.meta.env.VITE_API_URL}/api/v1/users/${activeFriend.userId}/public-key`;
                const pkRes = await apiFetch(pkUrl);
                if (!pkRes.ok) throw new Error("Could not fetch recipient public key");
                const pkText = await pkRes.text();
                try { latestPubKey = JSON.parse(pkText); } catch (e) { latestPubKey = pkText; }
            } else {
                groupRoster = groupRosterKeys[activeGroup.groupId] || [];
                if (groupRoster.length === 0) {
                    const res = await apiFetch(`${import.meta.env.VITE_API_URL}/api/v1/groups/${activeGroup.groupId}/roster-keys`);
                    groupRoster = await res.json();
                    setGroupRosterKeys(prev => ({ ...prev, [activeGroup.groupId]: groupRoster }));
                }
            }

            let attachmentData = null;
            if (selectedFile) {
                const fileAesKey = generateAESKey();
                const arrayBuffer = await selectedFile.arrayBuffer();
                const encryptedFileObj = encryptFileWithAES(arrayBuffer, fileAesKey);

                const blob = new Blob([JSON.stringify(encryptedFileObj)], { type: 'application/json' });

                // Upload to LOCAL BACKEND instead of Firebase
                const formData = new FormData();
                formData.append('file', blob, selectedFile.name + '.enc');

                const uploadRes = await fetch(`${import.meta.env.VITE_API_URL}/api/v1/attachments/upload`, {
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
            const messagePayloadObj = {
                text: inputMsg,
                attachment: attachmentData
            };

            const encryptedData = encryptMessageWithAES(JSON.stringify(messagePayloadObj), aesKey);

            if (activeFriend) {
                const encryptedAESKey = encryptAESKeyWithRSA(aesKey, latestPubKey);
                const senderEncryptedAESKey = encryptAESKeyWithRSA(aesKey, keys.publicKey);

                const payload = {
                    recipientId: activeFriend.userId,
                    encryptedAESKey: encryptedAESKey,
                    senderEncryptedAESKey: senderEncryptedAESKey,
                    encryptedContent: encryptedData.ciphertext, // Mirror key for Mobile Client compliance
                    encryptedMessage: encryptedData.ciphertext,
                    iv: encryptedData.iv,
                    tag: encryptedData.tag
                };

                stompClient.current.publish({
                    destination: "/app/chat.sendMessage",
                    body: JSON.stringify(payload)
                });
            } else if (activeGroup) {
                const wrappedKeys = {};

                // 1. Get the current roster from state
                let roster = groupRosterKeys[activeGroup.groupId] || [];

                // 2. Force-fetch the roster if not available in current state
                if (roster.length === 0) {
                    try {
                        const res = await apiFetch(`${import.meta.env.VITE_API_URL}/api/v1/groups/${activeGroup.groupId}/roster-keys`);
                        if (res.ok) {
                            roster = await res.json();
                            setGroupRosterKeys(prev => ({ ...prev, [activeGroup.groupId]: roster }));
                        }
                    } catch (e) {
                        console.error("Critical: Failed to fetch group roster", e);
                    }
                }

                // 3. Perform Async-Safe N-Wrap distribution
                if (roster && roster.length > 0) {
                    await Promise.all(roster.map(async (member) => {
                        const mId = member.userId || member.id;
                        const pubKey = member.publicKey || member.public_key;

                        if (mId && pubKey) {
                            try {
                                wrappedKeys[mId] = encryptAESKeyWithRSA(aesKey, pubKey);
                            } catch (e) {
                            }
                        }
                    }));
                }

                // 3. Defensive Guard: Prevent sending un-decryptable packets
                if (Object.keys(wrappedKeys).length === 0) {
                    console.error("🛑 [CRYPTO ERROR]: wrappedKeys map is empty. Message will be un-decryptable for all members. Aborting publish.");
                    setIsUploading(false);
                    return;
                }

                const groupPayload = {
                    groupId: activeGroup.groupId,
                    senderId: user.userId,
                    encryptedContent: encryptedData.ciphertext,
                    iv: encryptedData.iv,
                    tag: encryptedData.tag,
                    wrappedKeys: wrappedKeys
                };

                stompClient.current.publish({
                    destination: "/app/chat.groupMessage",
                    body: JSON.stringify(groupPayload)
                });
            }

            const chatId = activeGroup ? activeGroup.groupId : activeFriend.userId;
            setMessagesByFriend(prev => ({
                ...prev,
                [chatId]: [...(prev[chatId] || []), {
                    id: crypto.randomUUID(),
                    sender: user.userId,
                    content: inputMsg,
                    attachment: attachmentData,
                    isMe: true,
                    status: 'PENDING',
                    timestamp: new Date().toLocaleTimeString()
                }]
            }));

            // 🚀 THE IMMUTABLE BUBBLING FIX: Force useMemo sidebar re-sort via shallow-copied mapping
            if (activeGroup) {
                setGroups(prevGroups => prevGroups.map(group => 
                    group.groupId === chatId 
                        ? { ...group, lastActiveTimestamp: Date.now() } 
                        : group
                ));
            } else {
                setFriends(prevFriends => prevFriends.map(friend => 
                    friend.userId === chatId 
                        ? { ...friend, lastActiveTimestamp: Date.now() } 
                        : friend
                ));
            }

            setInputMsg('');
            setSelectedFile(null);
            if (fileInputRef.current) fileInputRef.current.value = "";
            setIsUploading(false);
        } catch (error) {
            console.error("Encryption/Upload failed", error);
            alert("Failed to send message securely");
            setIsUploading(false);
        }
    };

    // 🚀 FIX: High-performance memoized sorting for Friends
    const sortedFriends = useMemo(() => {
        return [...friends].sort((a, b) => (b.lastActiveTimestamp || 0) - (a.lastActiveTimestamp || 0));
    }, [friends]);

    // 🚀 FIX: High-performance memoized sorting for Groups
    const sortedGroups = useMemo(() => {
        return [...groups].sort((a, b) => (b.lastActiveTimestamp || 0) - (a.lastActiveTimestamp || 0));
    }, [groups]);

    return (
        <div style={{ display: 'flex', width: '100%', maxWidth: '1200px', height: '85vh', margin: '0 auto', padding: '20px', gap: '20px' }}>

            {/* Sidebar */}
            <div className="glass-panel" style={{ width: '350px', display: 'flex', flexDirection: 'column', padding: '20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '30px' }}>
                    <ShieldCheck color="var(--text-highlight)" size={28} />
                    <h2 style={{ margin: 0, color: 'var(--text-highlight)' }}>Prama E2EE</h2>
                </div>

                <div style={{ marginBottom: '20px', padding: '15px', background: 'rgba(0,0,0,0.2)', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '15px', position: 'relative' }}>
                    {/* 📊 PHASE 8: DYNAMIC SIDEBAR SELF-AVATAR BADGE */}
                    <div className="w-10 h-10 rounded-full bg-emerald-800 flex items-center justify-center overflow-hidden flex-shrink-0 font-bold border border-emerald-600/50 shadow-md" style={{ width: '40px', height: '40px' }}>
                        {user?.avatar ? (
                            <img src={user.avatar} alt="My Profile" className="w-full h-full object-cover" />
                        ) : (
                            <span className="text-white" style={{ fontSize: '18px' }}>{user?.username?.charAt(0).toUpperCase()}</span>
                        )}
                    </div>
                    <div>
                        <div style={{ fontSize: '12px', color: '#888' }}>Logged in as</div>
                        <div style={{ wordBreak: 'break-all', fontSize: '14px', fontWeight: 'bold' }}>{user?.username || user?.email}</div>
                    </div>

                    {/* 📊 ACTION BUTTONS GROUP */}
                    <div style={{ position: 'absolute', top: '12px', right: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        {/* 📊 PHASE 11: PROGRAMMATIC ADMINISTRATIVE ENTRY GATE */}
                        {(() => {
                            // Attempt to parse role directly from the JWT token claims if available
                            let tokenRole = null;
                            if (user?.accessToken) {
                                try {
                                    const base64Url = user.accessToken.split('.')[1];
                                    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
                                    const payload = JSON.parse(window.atob(base64));
                                    tokenRole = payload.role || payload.roles || (payload.authorities ? payload.authorities[0] : null);
                                } catch (e) {
                                    console.error("🛡️ JWT Parsing Error:", e);
                                }
                            }

                            // 2. Evaluate access STRICTLY based on dynamic roles. Zero hardcoded strings.
                            const isAdmin = user?.role === 'ADMIN' ||
                                user?.role === 'ROLE_ADMIN' ||
                                tokenRole === 'ADMIN' ||
                                tokenRole === 'ROLE_ADMIN';

                            if (!isAdmin) return null;

                            return (
                                <button
                                    onClick={() => navigate('/admin')}
                                    className="text-emerald-400 hover:text-emerald-300 transition-colors duration-200 p-1 rounded hover:bg-gray-800/40"
                                    title="Admin Dashboard"
                                    style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                >
                                    <Shield size={16} strokeWidth={2.5} />
                                </button>
                            );
                        })()}

                        {/* 📊 PROFILE SETTINGS GEAR ICON UTILITY */}
                        <button
                            onClick={() => {
                                setProfileFormData({ username: user?.username || '', email: user?.email || '', currentPassword: '', newPassword: '' });
                                setShowProfileSettings(true);
                            }}
                            className="text-gray-500 hover:text-emerald-400 transition-colors p-1 rounded hover:bg-gray-800/40"
                            title="Account Settings"
                            style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1-2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
                        </button>
                    </div>
                </div>



                {/* Tabs */}
                <div style={{ display: 'flex', gap: '10px', marginBottom: '20px', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '10px' }}>
                    <button onClick={() => setActiveTab('friends')} style={{ background: 'none', border: 'none', color: activeTab === 'friends' ? 'var(--text-highlight)' : '#888', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px' }}>
                        <Users size={16} /> Friends
                    </button>
                    <button onClick={() => setActiveTab('groups')} style={{ background: 'none', border: 'none', color: activeTab === 'groups' ? 'var(--text-highlight)' : '#888', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px' }}>
                        <Users size={16} /> Groups
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
                            {sortedFriends.length === 0 ? <div style={{ color: '#888', fontSize: '14px', textAlign: 'center', marginTop: '20px' }}>No friends yet. Add someone!</div> : null}
                            {sortedFriends.map(friend => (
                                <div
                                    key={friend.id}
                                    onClick={() => setActiveFriend(friend)}
                                    style={{
                                        display: 'flex', alignItems: 'center', gap: '10px', padding: '12px', borderRadius: '8px', cursor: 'pointer',
                                        background: activeFriend?.id === friend.id ? 'rgba(102, 252, 241, 0.1)' : (unreadCounts[friend.userId] > 0 ? 'rgba(0, 255, 136, 0.05)' : 'transparent'),
                                        border: activeFriend?.id === friend.id ? '1px solid rgba(102, 252, 241, 0.3)' : '1px solid transparent'
                                    }}
                                >
                                    <div style={{ position: 'relative', width: '35px', height: '35px', borderRadius: '50%', background: 'linear-gradient(135deg, #66fcf1, #45a29e)', color: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', overflow: 'hidden' }}>
                                        {friend.avatar ? (
                                            <img src={friend.avatar} alt="Avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                        ) : (
                                            friend.username?.charAt(0).toUpperCase()
                                        )}
                                        {unreadCounts[friend.userId] > 0 && (
                                            <div style={{ position: 'absolute', top: '-4px', right: '-4px', width: '20px', height: '20px', borderRadius: '50%', background: '#00ff88', color: '#000', fontSize: '11px', fontWeight: 'bold', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 8px rgba(0,255,136,0.6)', animation: 'pulse 1.5s infinite', zIndex: 10 }}>
                                                {unreadCounts[friend.userId]}
                                            </div>
                                        )}
                                    </div>
                                    <div style={{ flex: 1, overflow: 'hidden' }}>
                                        {/* 📊 ALIAS-AWARE FRIENDS LIST */}
                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }} className="group">
                                            <div style={{ fontSize: '14px', color: unreadCounts[friend.userId] > 0 ? '#00ff88' : 'var(--text-highlight)', fontWeight: unreadCounts[friend.userId] > 0 ? 'bold' : 'normal', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                {friend.alias || friend.username}
                                            </div>
                                            <button
                                                onClick={(e) => { e.stopPropagation(); setAliasInput(friend.alias || ""); setShowAliasModal(friend); }}
                                                style={{ opacity: 0, background: 'none', border: 'none', color: '#888', cursor: 'pointer', transition: 'all 0.2s', padding: '4px' }}
                                                className="group-hover-visible hover-emerald"
                                                title="Set Local Alias"
                                            >
                                                {/* Raw SVG bypasses lucide-react crashes */}
                                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" /></svg>
                                            </button>
                                        </div>
                                        <div style={{ fontSize: '11px', color: '#888' }}>{friend.email}</div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    {activeTab === 'groups' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                            <button
                                onClick={() => setShowCreateGroupModal(true)}
                                className="glass-button"
                                style={{ width: '100%', marginBottom: '10px', background: 'rgba(0, 255, 136, 0.1)', color: '#00ff88', border: '1px solid rgba(0, 255, 136, 0.3)' }}
                            >
                                <Users size={16} style={{ marginRight: '8px' }} /> Create Group
                            </button>
                            {sortedGroups.length === 0 ? <div style={{ color: '#888', fontSize: '14px', textAlign: 'center', marginTop: '20px' }}>No groups yet.</div> : null}
                            {sortedGroups.map(group => (
                                <div
                                    key={group.groupId}
                                    onClick={() => setActiveGroup(group)}
                                    style={{
                                        display: 'flex', alignItems: 'center', gap: '10px', padding: '12px', borderRadius: '8px', cursor: 'pointer',
                                        background: activeGroup?.groupId === group.groupId ? 'rgba(102, 252, 241, 0.1)' : 'transparent',
                                        border: activeGroup?.groupId === group.groupId ? '1px solid rgba(102, 252, 241, 0.3)' : '1px solid transparent'
                                    }}
                                >
                                    <div style={{ width: '35px', height: '35px', borderRadius: '50%', background: 'linear-gradient(135deg, #00ff88, #45a29e)', color: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', overflow: 'hidden' }}>
                                        {group.groupAvatar || group.avatar ? (
                                            <img src={group.groupAvatar || group.avatar} alt="Avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                        ) : (
                                            group.name?.charAt(0).toUpperCase()
                                        )}
                                    </div>
                                    <div style={{ flex: 1 }}>
                                        <div style={{ fontSize: '14px', color: 'var(--text-highlight)' }}>{group.name}</div>
                                        <div style={{ fontSize: '11px', color: '#888' }}>{group.memberCount} members</div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <div style={{ marginTop: '20px' }}>
                    <div style={{
                        fontSize: '12px',
                        color: status === 'Connected securely' ? '#00ff88' : '#ffcc00',
                        marginBottom: '15px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '5px'
                    }}>
                        <div style={{
                            width: '8px',
                            height: '8px',
                            borderRadius: '50%',
                            background: status === 'Connected securely' ? '#00ff88' : '#ffcc00',
                            boxShadow: status === 'Connected securely' ? '0 0 8px rgba(0,255,136,0.6)' : '0 0 8px rgba(255,204,0,0.6)',
                            animation: status === 'Reconnecting...' ? 'pulse 1s infinite' : 'none'
                        }} />
                        {status}
                    </div>
                    <button onClick={() => { logout(); purgePramaCache(); navigate('/'); }} className="glass-button" style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', background: 'rgba(255,107,107,0.1)', color: '#ff6b6b' }}>
                        <LogOut size={18} /> Logout
                    </button>
                </div>
            </div>

            {/* Chat Area */}
            <div className="glass-panel" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                <div
                    style={{ padding: '20px', borderBottom: '1px solid var(--border)', background: 'rgba(0,0,0,0.1)' }}
                >
                    {activeGroup ? (
                        <div
                            onClick={() => setShowGroupDetails(!showGroupDetails)}
                            className="flex items-center gap-2 cursor-pointer hover:opacity-90 transition-opacity select-none py-1"
                        >
                            <div style={{ width: '35px', height: '35px', borderRadius: '50%', background: 'linear-gradient(135deg, #66fcf1, #45a29e)', color: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', fontSize: '14px', overflow: 'hidden' }}>
                                {activeGroup.groupAvatar ? (
                                    <img src={activeGroup.groupAvatar} alt="Avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                ) : (
                                    activeGroup.name?.charAt(0).toUpperCase()
                                )}
                            </div>
                            <h3 className="font-bold text-lg text-[#00ff88] m-0 flex items-center gap-2">
                                {activeGroup.name}
                                <span style={{ fontSize: '10px', color: '#66fcf1', opacity: 0.7, fontWeight: 'normal', fontStyle: 'italic' }}>(Click for Info)</span>
                            </h3>
                        </div>
                    ) : activeFriend ? (
                        <div
                            onClick={() => {
                                setAliasInput(activeFriend.alias || "");
                                setShowContactDetails(true);
                                setShowGroupDetails(false);
                            }}
                            className="flex items-center gap-2 cursor-pointer hover:opacity-90 transition-opacity select-none py-1"
                        >
                            <div style={{ width: '35px', height: '35px', borderRadius: '50%', background: 'linear-gradient(135deg, #66fcf1, #45a29e)', color: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', fontSize: '14px', overflow: 'hidden' }}>
                                {activeFriend.avatar ? (
                                    <img src={activeFriend.avatar} alt="Avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                ) : (
                                    (activeFriend.alias || activeFriend.username || "U")?.charAt(0).toUpperCase()
                                )}
                            </div>
                            <h3 className="font-bold text-lg text-[#00ff88] m-0 flex items-center gap-2">
                                {activeFriend.alias || activeFriend.username}
                                <span style={{ fontSize: '10px', color: '#66fcf1', opacity: 0.7, fontWeight: 'normal', fontStyle: 'italic' }}>(Click for Info)</span>
                            </h3>
                        </div>
                    ) : (
                        <h3 style={{ margin: 0, fontWeight: 'bold', fontSize: '18px', color: '#00ff88' }}>Select a chat to start messaging</h3>
                    )}
                </div>

                <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
                    <div 
                        ref={chatContainerRef}
                        onScroll={handleScroll}
                        style={{ flex: 1, padding: '20px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '15px' }}
                    >
                        {(messagesByFriend[activeGroup?.groupId || activeFriend?.userId] || []).map(msg => {
                            const isMe = msg.isMe;
                            let senderName = "Unknown User";
                            if (!isMe && activeGroup) {
                                const roster = groupRosterKeys[activeGroup.groupId] || [];
                                const sender = roster.find(m => m.userId === msg.senderId || m.id === msg.senderId);
                                if (sender) senderName = sender.username;
                            }

                            // Calculate dynamic status
                            let displayStatus = msg.status;
                            if (isMe && activeGroup) {
                                // ... group math logic ...
                                const roster = groupRosterKeys[activeGroup.groupId] || [];
                                const others = roster.filter(m => m.userId !== user.userId);
                                const msgTime = new Date(msg.createdAt || msg.timestamp || msg.rawTimestamp).getTime();

                                // "READ" if EVERY other member has a lastReadAt >= msgTime
                                const allRead = others.length > 0 && others.every(m => {
                                    const readAtStr = m.lastReadAt || m.last_read_at;
                                    if (!readAtStr) {
                                        return false;
                                    }

                                    const memberReadTime = new Date(readAtStr).getTime();
                                    // FIX: Add Date.now() fallback to prevent NaN on live UI messages
                                    const msgTimeStr = msg.createdAt || msg.timestamp || msg.rawTimestamp;
                                    const msgTime = msgTimeStr ? new Date(msgTimeStr).getTime() : Date.now();

                                    const evaluation = memberReadTime >= msgTime;
                                    return evaluation;
                                });


                                // "DELIVERED" if at least one other member has a lastReadAt (implied delivery)
                                const someRead = others.some(m => {
                                    const readAtStr = m.lastReadAt || m.last_read_at;
                                    if (!readAtStr) return false;
                                    const memberReadTime = new Date(readAtStr).getTime();
                                    return memberReadTime >= msgTime;
                                });

                                displayStatus = allRead ? 'READ' : (someRead ? 'DELIVERED' : 'SENT');
                            } else if (isMe && activeFriend) {
                                // RENDER THREAD
                                const friendReadStr = activeFriend?.lastReadAt || activeFriend?.last_read_at;
                                let friendReadTime = friendReadStr ? new Date(friendReadStr).getTime() : 0;
                                if (isNaN(friendReadTime)) friendReadTime = 0;

                                let msgTimeStr = msg.createdAt || msg.timestamp || msg.rawTimestamp;
                                if (!msgTimeStr && msg.id && !isNaN(msg.id)) msgTimeStr = Number(msg.id);

                                let msgTime = msgTimeStr ? new Date(msgTimeStr).getTime() : Date.now();
                                if (isNaN(msgTime) && Array.isArray(msgTimeStr) && msgTimeStr.length >= 5) {
                                    msgTime = new Date(msgTimeStr[0], msgTimeStr[1] - 1, msgTimeStr[2], msgTimeStr[3], msgTimeStr[4], msgTimeStr[5] || 0).getTime();
                                } else if (isNaN(msgTime)) {
                                    msgTime = Date.now();
                                }

                                const isRead = friendReadTime >= msgTime;

                                displayStatus = isRead ? 'READ' : msg.status;
                            }

                            // Rule 1: Priority Tombstone Check
                            if (msg.isDeleted || msg.is_deleted) {
                                return (
                                    <div key={msg.id} style={{ alignSelf: isMe ? 'flex-end' : 'flex-start', maxWidth: '70%', margin: '4px 0', fontStyle: 'italic', color: '#888', fontSize: '12px' }}>
                                        <div style={{ background: 'rgba(255,255,255,0.05)', borderRadius: '8px', padding: '8px 12px', border: '1px solid rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', gap: '6px', opacity: 0.6 }}>
                                            🚫 This message was deleted for everyone
                                        </div>
                                    </div>
                                );
                            }

                            let clearText = msg.content;
                            if (msg.isEdited || msg.is_edited) {
                                clearText += " (edited)";
                            }

                            return (
                                <div key={msg.id} className="group" style={{ alignSelf: isMe ? 'flex-end' : 'flex-start', maxWidth: '70%', position: 'relative' }}>
                                    {/* FORCE SYNC: {liveTickTrigger} */}
                                    {!isMe && activeGroup && (
                                        <div style={{ fontSize: '12px', color: '#00ff88', marginBottom: '4px', marginLeft: '4px', fontWeight: 'bold' }}>
                                            {senderName}
                                        </div>
                                    )}
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexDirection: isMe ? 'row-reverse' : 'row' }}>
                                        <div style={{
                                            padding: '12px 16px',
                                            borderRadius: isMe ? '16px 16px 0 16px' : '16px 16px 16px 0',
                                            background: isMe ? 'var(--accent)' : 'rgba(255,255,255,0.05)',
                                            color: isMe ? '#000' : 'var(--text-main)',
                                            boxShadow: '0 2px 10px rgba(0,0,0,0.1)'
                                        }}>
                                            {clearText}
                                            {msg.attachment && (
                                                <AttachmentViewer
                                                    attachment={msg.attachment}
                                                    messageId={msg.id}
                                                    onImageClick={(fileObj) => setSelectedImage(fileObj)}
                                                    attachmentCache={attachmentCache}
                                                    setAttachmentCache={setAttachmentCache}
                                                    onForward={(att) => { setForwardingAttachment(att); setShowForwardModal(true); }}
                                                    decryptedFiles={decryptedFiles}
                                                    setDecryptedFiles={setDecryptedFiles}
                                                />
                                            )}
                                        </div>

                                        {isMe && !msg.isDeleted && !msg.is_deleted && (
                                            <div className="message-actions" style={{ display: 'flex', gap: '4px', opacity: 0, transition: 'opacity 0.2s' }}>
                                                <button
                                                    onClick={() => triggerInlineEditMode(msg)}
                                                    style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', padding: '4px' }}
                                                    title="Edit Message"
                                                >
                                                    ✏️
                                                </button>
                                                <button
                                                    onClick={() => executeMessageRevocation(msg.id)}
                                                    style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', padding: '4px' }}
                                                    title="Delete for Everyone"
                                                >
                                                    🗑️
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                    <div style={{ fontSize: '10px', color: '#666', marginTop: '4px', display: 'flex', alignItems: 'center', justifyContent: isMe ? 'flex-end' : 'flex-start', gap: '4px' }}>
                                        {msg.displayTimestamp}
                                        {isMe && (
                                            <div style={{ display: 'flex', alignItems: 'center' }}>
                                                {displayStatus === 'SENT' && <Check size={12} color="#666" />}
                                                {displayStatus === 'DELIVERED' && (
                                                    <div style={{ display: 'flex', marginLeft: '-6px' }}>
                                                        <Check size={12} color="#666" />
                                                        <Check size={12} color="#666" style={{ marginLeft: '-8px' }} />
                                                    </div>
                                                )}
                                                {displayStatus === 'READ' && (
                                                    <div style={{ display: 'flex', marginLeft: '-6px' }}>
                                                        <Check size={12} color="#00ff88" />
                                                        <Check size={12} color="#00ff88" style={{ marginLeft: '-8px' }} />
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                        {(!(activeFriend || activeGroup) || (messagesByFriend[activeGroup?.groupId || activeFriend?.userId] || []).length === 0) && (activeFriend || activeGroup) && (
                            <div style={{ margin: 'auto', color: '#888', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
                                <ShieldCheck size={48} color="rgba(102, 252, 241, 0.3)" />
                                <span>Messages are end-to-end encrypted. No one else can read them.</span>
                            </div>
                        )}
                        <div ref={messagesEndRef} />
                    </div>

                    {/* 📊 PHASE 3: DYNAMIC GROUP DETAILS INTERACTION DRAWER (UPGRADED WITH MASTER SCROLLBAR) */}
                    {showGroupDetails && activeGroup && (
                        <div className="glass-panel scrollbar-custom" style={{ width: '300px', borderLeft: '1px solid var(--border)', padding: '20px', display: 'flex', flexDirection: 'column', background: 'rgba(0,0,0,0.2)', height: '100%', overflowY: 'auto' }}>
                            {/* 📊 PHASE 7: DYNAMIC GROUP BRANDING HEADER */}
                            {(() => {
                                const roster = groupRosterKeys[activeGroup.groupId] || [];
                                const me = roster.find(m => String(m.userId) === String(user.userId));
                                const isCurrentUserAdmin = me?.isAdmin;

                                return (
                                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: '20px', paddingBottom: '15px', borderBottom: '1px solid rgba(255,255,255,0.1)', position: 'relative' }}>
                                        <button onClick={() => setShowGroupDetails(false)} style={{ position: 'absolute', top: '0', right: '0', background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: '12px' }}>✕</button>

                                        {/* Hidden native input for Camera/Gallery */}
                                        <input type="file" accept="image/*" ref={groupAvatarInputRef} onChange={handleAvatarFileChange} style={{ display: 'none' }} />

                                        {/* Group Avatar Frame */}
                                        <div style={{ position: 'relative', marginTop: '10px', marginBottom: '15px' }} className="group-avatar-container">
                                            <div style={{ width: '80px', height: '80px', borderRadius: '50%', background: 'rgba(255,255,255,0.05)', border: '2px solid rgba(255,255,255,0.1)', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 15px rgba(0,0,0,0.3)' }}>
                                                {activeGroup.groupAvatar ? (
                                                    <img src={activeGroup.groupAvatar} alt="Group" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                                ) : (
                                                    <span style={{ color: '#888', fontWeight: 'bold', fontSize: '24px' }}>{activeGroup.name?.charAt(0).toUpperCase()}</span>
                                                )}
                                            </div>
                                            {/* Admin Avatar Edit Overlay */}
                                            {isCurrentUserAdmin && (
                                                <button
                                                    onClick={() => groupAvatarInputRef.current.click()}
                                                    style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.6)', borderRadius: '50%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', opacity: 0, transition: 'opacity 0.2s', border: 'none', color: '#fff', fontSize: '10px', fontWeight: 'bold', cursor: 'pointer' }}
                                                    onMouseEnter={(e) => e.currentTarget.style.opacity = 1}
                                                    onMouseLeave={(e) => e.currentTarget.style.opacity = 0}
                                                >
                                                    <Camera size={18} style={{ marginBottom: '4px' }} />
                                                    Change
                                                </button>
                                            )}
                                        </div>

                                        {/* Group Name Editor */}
                                        {isEditingGroupName && isCurrentUserAdmin ? (
                                            <div style={{ display: 'flex', width: '100%', alignItems: 'center', gap: '8px', padding: '0 8px' }}>
                                                <input
                                                    autoFocus
                                                    type="text"
                                                    value={editGroupNameInput}
                                                    onChange={e => setEditGroupNameInput(e.target.value)}
                                                    className="glass-input"
                                                    style={{ flex: 1, padding: '4px 8px', fontSize: '13px' }}
                                                    placeholder="New Group Name"
                                                />
                                                <button onClick={() => handleGroupMetadataUpdate(editGroupNameInput, undefined)} style={{ background: 'none', border: 'none', color: '#00ff88', cursor: 'pointer' }}><Check size={18} /></button>
                                                <button onClick={() => setIsEditingGroupName(false)} style={{ background: 'none', border: 'none', color: '#ff6b6b', cursor: 'pointer' }}><X size={18} /></button>
                                            </div>
                                        ) : (
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                <h3 style={{ margin: 0, fontWeight: 'bold', fontSize: '18px', color: '#fff' }}>{activeGroup.name}</h3>
                                                {isCurrentUserAdmin && (
                                                    <button onClick={() => { setEditGroupNameInput(activeGroup.name); setIsEditingGroupName(true); }} style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer' }} className="hover-emerald">
                                                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" /></svg>
                                                    </button>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                );
                            })()}

                            {/* 📊 SCROLLABLE & SORTED ROSTER DIRECTORY (PATCH) */}
                            <div style={{ marginBottom: '16px', display: 'flex', flexDirection: 'column' }}>
                                <p style={{ fontSize: '11px', color: '#888', marginBottom: '8px', fontWeight: 'bold', textTransform: 'uppercase' }}>
                                    Roster Directory ({(groupRosterKeys[activeGroup.groupId] || []).length})
                                </p>

                                {/* Scrollable Container with max-height to protect Admin Tools */}
                                <div style={{ overflowY: 'auto', maxHeight: '250px', paddingRight: '8px', display: 'flex', flexDirection: 'column', gap: '4px' }} className="scrollbar-custom">
                                    {(groupRosterKeys[activeGroup.groupId] || [])
                                        .sort((a, b) => {
                                            // Sort Order: You -> Admins -> Members
                                            const isMeA = String(a.userId) === String(user.userId);
                                            const isMeB = String(b.userId) === String(user.userId);
                                            if (isMeA) return -1;
                                            if (isMeB) return 1;
                                            if (a.isAdmin && !b.isAdmin) return -1;
                                            if (!a.isAdmin && b.isAdmin) return 1;
                                            return (a.username || "").localeCompare(b.username || "");
                                        })
                                        .slice(0, visibleRosterCount)
                                        .map(member => (
                                            <div key={member.userId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.05)', borderRadius: '6px', padding: '8px', border: '1px solid rgba(255,255,255,0.05)', flexShrink: 0 }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden' }}>
                                                    <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#00ff88', flexShrink: 0 }}></div>
                                                    <span style={{ fontSize: '13px', fontWeight: '500', color: '#eee', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                        {member.username}
                                                        {String(member.userId) === String(user.userId) && <span style={{ color: '#888', fontSize: '11px', marginLeft: '4px' }}>(You)</span>}
                                                    </span>
                                                </div>
                                                {member.isAdmin && (
                                                    <span style={{ fontSize: '9px', background: 'rgba(0, 100, 255, 0.15)', border: '1px solid rgba(0, 100, 255, 0.3)', color: '#44aaff', padding: '2px 6px', borderRadius: '4px', fontWeight: 'bold', textTransform: 'uppercase', flexShrink: 0, marginLeft: '8px' }}>Admin</span>
                                                )}
                                            </div>
                                        ))
                                    }

                                    {/* Show More Expansion Button */}
                                    {(groupRosterKeys[activeGroup.groupId]?.length || 0) > visibleRosterCount && (
                                        <button
                                            onClick={() => setVisibleRosterCount(prev => prev + 6)}
                                            style={{ width: '100%', marginTop: '8px', padding: '8px', fontSize: '11px', fontWeight: 'bold', color: '#888', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', cursor: 'pointer', transition: 'all 0.2s' }}
                                            className="hover-white"
                                        >
                                            Show More ({(groupRosterKeys[activeGroup.groupId]?.length || 0) - visibleRosterCount} remaining)
                                        </button>
                                    )}
                                </div>
                            </div>

                            {/* 🛠️ ADMIN ACTION HUB */}
                            {(() => {
                                const roster = groupRosterKeys[activeGroup.groupId] || [];
                                const me = roster.find(m => String(m.userId) === String(user.userId));
                                const isCurrentUserAdmin = me?.isAdmin;

                                if (!isCurrentUserAdmin) return null;

                                return (
                                    <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '15px' }}>
                                        <p style={{ fontSize: '10px', color: '#888', marginBottom: '10px', textTransform: 'uppercase', fontWeight: 'bold' }}>Administrative Suite Tools</p>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', background: 'rgba(0,0,0,0.3)', padding: '10px', borderRadius: '8px' }}>

                                            {/* 🟢 Add Member Action Row Upgrade */}
                                            <button
                                                onClick={() => {
                                                    setSelectedFriendToAdd(null);
                                                    setShowAddMemberModal(true);
                                                }}
                                                style={{ display: 'flex', alignItems: 'center', gap: '12px', width: '100%', padding: '10px', background: 'none', border: 'none', borderRadius: '6px', cursor: 'pointer', transition: 'all 0.2s' }}
                                                className="group text-gray-300 hover:bg-gray-900 hover:text-emerald-400"
                                                title="Add Member to Cryptographic Mesh"
                                            >
                                                <div style={{ color: '#888' }} className="group-hover:text-emerald-400">
                                                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><line x1="19" y1="16" x2="19" y2="22" /><line x1="16" y1="19" x2="22" y2="19" /></svg>
                                                </div>
                                                <span style={{ fontSize: '14px', fontWeight: '500' }}>Add Member</span>
                                            </button>

                                            {/* Add Admin Action Row (Preserved) */}
                                            <button
                                                onClick={() => {
                                                    const nonAdmins = (groupRosterKeys[activeGroup.groupId] || []).filter(m => !m.isAdmin);
                                                    if (!nonAdmins || nonAdmins.length === 0) {
                                                        alert("All current members possess admin privileges.");
                                                        return;
                                                    }
                                                    setShowPromoteModal(true);
                                                }}
                                                style={{ display: 'flex', alignItems: 'center', gap: '12px', width: '100%', padding: '10px', background: 'none', border: 'none', borderRadius: '6px', cursor: 'pointer', transition: 'all 0.2s' }}
                                                className="group text-gray-300 hover:bg-gray-900 hover:text-blue-400"
                                                title="Add Admin"
                                            >
                                                <div style={{ color: '#888' }} className="group-hover:text-blue-400">
                                                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
                                                </div>
                                                <span style={{ fontSize: '14px', fontWeight: '500' }}>Add Admin</span>
                                            </button>

                                            {/* 🔴 Remove Member Action Row Upgrade */}
                                            <button
                                                onClick={() => setShowRemoveMemberModal(true)}
                                                style={{ display: 'flex', alignItems: 'center', gap: '12px', width: '100%', padding: '10px', background: 'none', border: 'none', borderRadius: '6px', cursor: 'pointer', transition: 'all 0.2s' }}
                                                className="group text-gray-300 hover:bg-gray-900 hover:text-red-400"
                                                title="Remove Member"
                                            >
                                                <div style={{ color: '#888' }} className="group-hover:text-red-400">
                                                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><line x1="22" x1="16" y2="19" y2="19" /></svg>
                                                </div>
                                                <span style={{ fontSize: '14px', fontWeight: '500' }}>Remove Member</span>
                                            </button>
                                        </div>
                                    </div>
                                );
                            })()}

                            {/* 📊 PHASE 4: HIGH-SECURITY INTERACTIVE ADD MEMBER MODAL ELEMENT */}
                            {showAddMemberModal && activeGroup && (
                                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10001 }}>
                                    <div className="glass-panel" style={{ width: '384px', background: '#0a0a0a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px', padding: '20px', display: 'flex', flexDirection: 'column', maxHeight: '80vh', color: '#ccc' }}>

                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '12px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                                            <h4 style={{ margin: 0, fontSize: '14px', fontWeight: 'bold', color: '#00ff88', uppercase: true, letterSpacing: '1px' }}>Invite Friend to Secure Mesh</h4>
                                            <button onClick={() => { setShowAddMemberModal(false); setSelectedFriendToAdd(null); }} style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer' }}>✕</button>
                                        </div>

                                        <p style={{ fontSize: '12px', color: '#888', margin: '12px 0' }}>Select an eligible contact to extend the conversation key envelope to:</p>

                                        {/* Filter List Frame (Exclude active group members) */}
                                        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px', margin: '8px 0', paddingRight: '4px' }}>
                                            {friends?.filter(f => !(groupRosterKeys[activeGroup.groupId] || []).some(m => String(m.userId) === String(f.userId))).map(friend => {
                                                const isSelected = selectedFriendToAdd && selectedFriendToAdd.userId === friend.userId;
                                                return (
                                                    <div
                                                        key={friend.userId}
                                                        onClick={() => setSelectedFriendToAdd(friend)}
                                                        style={{
                                                            display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px', borderRadius: '8px', cursor: 'pointer', transition: 'all 0.2s',
                                                            background: isSelected ? 'rgba(0, 255, 136, 0.1)' : 'rgba(255,255,255,0.05)',
                                                            border: isSelected ? '1px solid rgba(0, 255, 136, 0.5)' : '1px solid transparent'
                                                        }}
                                                    >
                                                        <span style={{ fontSize: '14px', fontWeight: '500', color: isSelected ? '#00ff88' : '#ccc' }}>
                                                            {friend.username || friend.email}
                                                        </span>
                                                        {isSelected && <span style={{ color: '#00ff88', fontSize: '12px', fontWeight: 'bold' }}>✓ Ready</span>}
                                                    </div>
                                                );
                                            })}
                                            {friends?.filter(f => !(groupRosterKeys[activeGroup.groupId] || []).some(m => String(m.userId) === String(f.userId))).length === 0 && (
                                                <p style={{ fontSize: '12px', color: '#555', fontStyle: 'italic', textAlign: 'center', padding: '20px 0' }}>No remaining contacts available to invite.</p>
                                            )}
                                        </div>

                                        {/* Actions Footer Controls */}
                                        <div style={{ display: 'flex', gap: '10px', paddingTop: '12px', borderTop: '1px solid rgba(255,255,255,0.1)', marginTop: '12px' }}>
                                            <button
                                                onClick={() => { setShowAddMemberModal(false); setSelectedFriendToAdd(null); }}
                                                style={{ flex: 1, background: 'rgba(255,255,255,0.05)', color: '#ccc', fontSize: '12px', fontWeight: 'bold', padding: '10px', borderRadius: '8px', border: 'none', cursor: 'pointer' }}
                                            >
                                                Cancel
                                            </button>
                                            <button
                                                disabled={!selectedFriendToAdd}
                                                onClick={async () => {
                                                    if (!selectedFriendToAdd) return;
                                                    const targetFriendId = selectedFriendToAdd.userId;

                                                    try {
                                                        // 1. DYNAMIC FETCH: Query the server directly to retrieve the recipient's key profile bundle
                                                        let remotePublicKeyB64 = selectedFriendToAdd.publicKey || selectedFriendToAdd.public_key;

                                                        if (!remotePublicKeyB64) {
                                                            const pkUrl = `${import.meta.env.VITE_API_URL}/api/v1/users/${targetFriendId}/public-key`;
                                                            const pkRes = await apiFetch(pkUrl);
                                                            if (pkRes.ok) {
                                                                remotePublicKeyB64 = await pkRes.text();
                                                            }
                                                        }

                                                        // 2. Fallback validation fence
                                                        if (!remotePublicKeyB64) {
                                                            alert("Cannot complete cryptographic handshake: Target user profile has not registered an asymmetric key bundle.");
                                                            return;
                                                        }

                                                        // 3. Extract your local decrypted conversation AES master loop key
                                                        const currentGroupDecryptedKeyRaw = activeGroup.decryptedKey || activeGroup.rawKey;
                                                        if (!currentGroupDecryptedKeyRaw) {
                                                            alert("Cannot onboard member: No valid group session key has been decrypted in this session. Send or receive a message first.");
                                                            return;
                                                        }

                                                        // 4. Invoke your frontend E2EE cryptographic wrapper mapping helper function
                                                        const encryptedGroupKeyForNewMember = encryptAESKeyWithRSA(currentGroupDecryptedKeyRaw, remotePublicKeyB64);

                                                        await apiFetch(`${import.meta.env.VITE_API_URL}/api/v1/groups/${activeGroup.groupId}/addMember`, {
                                                            method: 'POST',
                                                            headers: { 'Content-Type': 'application/json' },
                                                            body: JSON.stringify({
                                                                friendId: String(targetFriendId),
                                                                encryptedGroupKey: encryptedGroupKeyForNewMember
                                                            })
                                                        });

                                                        setShowAddMemberModal(false);
                                                        setSelectedFriendToAdd(null);
                                                    } catch (err) {
                                                        console.error("❌ Exception captured inside secure onboarding interface pipeline:", err);
                                                        alert("Failed to securely add participant. Please verify network communication integrity traces.");
                                                    }
                                                }}
                                                style={{
                                                    flex: 1, fontSize: '12px', fontWeight: 'bold', padding: '10px', borderRadius: '8px', border: 'none', transition: 'all 0.2s',
                                                    background: selectedFriendToAdd ? '#00ff88' : '#222',
                                                    color: selectedFriendToAdd ? '#000' : '#444',
                                                    cursor: selectedFriendToAdd ? 'pointer' : 'not-allowed'
                                                }}
                                            >
                                                Add to Group
                                            </button>
                                        </div>

                                    </div>
                                </div>
                            )}

                            {/* 📊 PHASE 5: SECURE CRYPTOGRAPHIC KEY ROTATION & EVICTION DRAWER */}
                            {showRemoveMemberModal && activeGroup && (
                                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10001 }}>
                                    <div className="glass-panel" style={{ width: '384px', background: '#0a0a0a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px', padding: '20px', display: 'flex', flexDirection: 'column', maxHeight: '80vh', color: '#ccc' }}>

                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '12px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                                            <h4 style={{ margin: 0, fontSize: '14px', fontWeight: 'bold', color: '#ff4444', uppercase: true, letterSpacing: '1px' }}>Evict Participant & Rotate Key</h4>
                                            <button onClick={() => setShowRemoveMemberModal(false)} style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer' }}>✕</button>
                                        </div>

                                        <p style={{ fontSize: '12px', color: '#888', margin: '12px 0' }}>Select a participant to revoke room privileges. Kicking executes an instant cryptographic key roll across remaining clients:</p>

                                        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px', margin: '8px 0', paddingRight: '4px' }}>
                                            {(groupRosterKeys[activeGroup.groupId] || []).filter(m => String(m.userId) !== String(user.userId)).map(member => (
                                                <div key={member.userId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', padding: '10px 12px' }}>
                                                    <span style={{ fontSize: '14px', fontWeight: '500' }}>{member.username}</span>
                                                    <button
                                                        onClick={async () => {
                                                            const confirmKick = window.confirm(`Are you certain you wish to cryptographically isolate ${member.username}?`);
                                                            if (!confirmKick) return;

                                                            try {
                                                                // 1. Generate brand new pristine symmetric group conversation key via WebCrypto
                                                                const rawNewKey = await window.crypto.subtle.generateKey(
                                                                    { name: "AES-GCM", length: 256 },
                                                                    true,
                                                                    ["encrypt", "decrypt"]
                                                                );
                                                                const exportedRawKey = await window.crypto.subtle.exportKey("raw", rawNewKey);
                                                                const newKeyB64 = btoa(String.fromCharCode(...new Uint8Array(exportedRawKey)));

                                                                // 2. Isolate remaining user rosters strictly excluding the evicted profile
                                                                const roster = groupRosterKeys[activeGroup.groupId] || [];
                                                                const remainingMembers = roster.filter(m => String(m.userId) !== String(member.userId));
                                                                const wrappedKeyMatrixPayload = {};

                                                                // 3. Core N-Wrap execution matrix loop
                                                                for (const peer of remainingMembers) {
                                                                    let peerPublicKey = peer.publicKey;

                                                                    // On-demand fetch fallback query layer if missing
                                                                    if (!peerPublicKey) {
                                                                        const pkUrl = `${import.meta.env.VITE_API_URL}/api/v1/users/${peer.userId}/public-key`;
                                                                        const pkRes = await apiFetch(pkUrl);
                                                                        if (pkRes.ok) {
                                                                            peerPublicKey = await pkRes.text();
                                                                        }
                                                                    }

                                                                    if (peerPublicKey) {
                                                                        wrappedKeyMatrixPayload[peer.userId] = encryptAESKeyWithRSA(newKeyB64, peerPublicKey);
                                                                    }
                                                                }

                                                                // 4. Submit transaction payload package
                                                                await apiFetch(`${import.meta.env.VITE_API_URL}/api/v1/groups/${activeGroup.groupId}/removeMember`, {
                                                                    method: 'POST',
                                                                    headers: { 'Content-Type': 'application/json' },
                                                                    body: JSON.stringify({
                                                                        kickedUserId: String(member.userId),
                                                                        newEncryptedKeys: wrappedKeyMatrixPayload
                                                                    })
                                                                });

                                                                setShowRemoveMemberModal(false);
                                                            } catch (err) {
                                                                console.error("Critical failure during E2EE Forward Secrecy rotation routine:", err);
                                                            }
                                                        }}
                                                        style={{
                                                            background: 'rgba(255, 68, 68, 0.1)', color: '#ff4444', border: '1px solid rgba(255, 68, 68, 0.3)',
                                                            padding: '6px 12px', borderRadius: '6px', fontSize: '11px', fontWeight: 'bold', cursor: 'pointer', transition: 'all 0.2s'
                                                        }}
                                                        className="hover:bg-red-500 hover:text-white"
                                                    >
                                                        Remove
                                                    </button>
                                                </div>
                                            ))}
                                            {(groupRosterKeys[activeGroup.groupId] || []).filter(m => String(m.userId) !== String(user.userId)).length === 0 && (
                                                <p style={{ fontSize: '12px', color: '#555', fontStyle: 'italic', textAlign: 'center', padding: '20px 0' }}>No remaining members available to evict.</p>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* 📊 HIGH-INTENSITY IN-APP PROMOTION ROSTER MODAL */}
                            {showPromoteModal && activeGroup && (
                                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10001 }}>
                                    <div className="glass-panel" style={{ width: '384px', background: '#0a0a0a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px', padding: '20px', display: 'flex', flexDirection: 'column', maxHeight: '80vh' }}>

                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '12px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                                            <h4 style={{ margin: 0, fontSize: '14px', fontWeight: 'bold', color: '#66fcf1', uppercase: true, letterSpacing: '1px' }}>Elevate to Admin Shield</h4>
                                            <button onClick={() => { setShowPromoteModal(false); setSelectedMemberToPromote(null); }} style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer' }}>✕</button>
                                        </div>

                                        <p style={{ fontSize: '12px', color: '#888', margin: '12px 0' }}>Select a group member from the registry below to grant admin privileges:</p>

                                        {/* Render List Frame */}
                                        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px', margin: '8px 0', paddingRight: '4px' }}>
                                            {(groupRosterKeys[activeGroup.groupId] || []).filter(m => !m.isAdmin).map(member => {
                                                const isSelected = selectedMemberToPromote && selectedMemberToPromote.userId === member.userId;
                                                return (
                                                    <div
                                                        key={member.userId}
                                                        onClick={() => setSelectedMemberToPromote(member)}
                                                        style={{
                                                            display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px', borderRadius: '8px', cursor: 'pointer', transition: 'all 0.2s',
                                                            background: isSelected ? 'rgba(102, 252, 241, 0.1)' : 'rgba(255,255,255,0.05)',
                                                            border: isSelected ? '1px solid rgba(102, 252, 241, 0.5)' : '1px solid transparent'
                                                        }}
                                                    >
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                                            <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: isSelected ? '#66fcf1' : '#444' }}></div>
                                                            <span style={{ fontSize: '14px', fontWeight: '500', color: isSelected ? '#66fcf1' : '#ccc' }}>
                                                                {member.username}
                                                            </span>
                                                        </div>
                                                        {isSelected && <span style={{ color: '#66fcf1', fontSize: '12px', fontWeight: 'bold' }}>✓ Selected</span>}
                                                    </div>
                                                );
                                            })}
                                        </div>

                                        {/* Modal Action Footer Controls */}
                                        <div style={{ display: 'flex', gap: '10px', paddingTop: '12px', borderTop: '1px solid rgba(255,255,255,0.1)', marginTop: '12px' }}>
                                            <button
                                                onClick={() => { setShowPromoteModal(false); setSelectedMemberToPromote(null); }}
                                                style={{ flex: 1, background: 'rgba(255,255,255,0.05)', color: '#ccc', fontSize: '12px', fontWeight: 'bold', padding: '10px', borderRadius: '8px', border: 'none', cursor: 'pointer' }}
                                            >
                                                Cancel
                                            </button>
                                            <button
                                                disabled={!selectedMemberToPromote}
                                                onClick={async () => {
                                                    if (!selectedMemberToPromote) return;

                                                    try {
                                                        await executeAdminPromotion(selectedMemberToPromote.userId);
                                                        setShowPromoteModal(false);
                                                        setSelectedMemberToPromote(null);
                                                    } catch (err) {
                                                        console.error("API error during component confirm invocation:", err);
                                                    }
                                                }}
                                                style={{
                                                    flex: 1, fontSize: '12px', fontWeight: 'bold', padding: '10px', borderRadius: '8px', border: 'none', transition: 'all 0.2s',
                                                    background: selectedMemberToPromote ? '#66fcf1' : '#222',
                                                    color: selectedMemberToPromote ? '#000' : '#444',
                                                    cursor: selectedMemberToPromote ? 'pointer' : 'not-allowed'
                                                }}
                                            >
                                                Confirm Promotion
                                            </button>
                                        </div>

                                    </div>
                                </div>
                            )}

                            {/* 📊 PHASE 6: UNIVERSAL GROUP EXIT CONTROL */}
                            <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '15px', marginTop: '15px', marginBottom: '10px' }}>
                                <button
                                    onClick={async () => {
                                        // 1. Calculate administrative topology
                                        const roster = groupRosterKeys[activeGroup.groupId] || [];
                                        const myProfile = roster.find(m => String(m.userId) === String(user.userId));
                                        const totalAdmins = roster.filter(m => m.isAdmin).length || 0;
                                        const isLastAdmin = myProfile?.isAdmin && totalAdmins === 1;

                                        const warningMsg = isLastAdmin
                                            ? "You are the last remaining Admin. Exiting will PERMANENTLY dissolve and delete this group for everyone. Proceed?"
                                            : "Are you sure you want to exit this group? You will lose access to future messages.";

                                        if (!window.confirm(warningMsg)) return;

                                        try {
                                            let payload = {};

                                            // 2. If the group will survive, we must compute the N-Wrap Key Rotation
                                            if (!isLastAdmin && roster.length > 1) {
                                                const rawNewKey = await window.crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
                                                const exportedRawKey = await window.crypto.subtle.exportKey("raw", rawNewKey);
                                                const newKeyB64 = btoa(String.fromCharCode(...new Uint8Array(exportedRawKey)));

                                                const remainingMembers = roster.filter(m => String(m.userId) !== String(user.userId));
                                                const wrappedKeyMatrixPayload = {};

                                                for (const peer of remainingMembers) {
                                                    let peerPublicKey = peer.publicKey;
                                                    if (!peerPublicKey) {
                                                        const pkUrl = `${import.meta.env.VITE_API_URL}/api/v1/users/${peer.userId}/public-key`;
                                                        const pkRes = await apiFetch(pkUrl);
                                                        if (pkRes.ok) peerPublicKey = await pkRes.text();
                                                    }

                                                    if (peerPublicKey) {
                                                        wrappedKeyMatrixPayload[peer.userId] = encryptAESKeyWithRSA(newKeyB64, peerPublicKey);
                                                    }
                                                }
                                                payload = { newEncryptedKeys: wrappedKeyMatrixPayload };
                                            }

                                            // 3. Dispatch to API
                                            await apiFetch(`${import.meta.env.VITE_API_URL}/api/v1/groups/${activeGroup.groupId}/exit`, {
                                                method: 'POST',
                                                headers: { 'Content-Type': 'application/json' },
                                                body: JSON.stringify(payload)
                                            });

                                            // 4. Soft-Delete Local UI Cleanup
                                            setGroups(prev => prev.filter(g => String(g.groupId) !== String(activeGroup.groupId)));
                                            setActiveGroup(null);
                                            setShowGroupDetails(false);

                                        } catch (err) {
                                            console.error("❌ Exit routine execution failed:", err);
                                        }
                                    }}
                                    style={{
                                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', width: '100%', padding: '10px',
                                        background: 'rgba(255, 68, 68, 0.1)', border: '1px solid rgba(255, 68, 68, 0.3)', borderRadius: '8px',
                                        color: '#ff4444', fontSize: '12px', fontWeight: 'bold', cursor: 'pointer', transition: 'all 0.2s'
                                    }}
                                    className="hover:bg-red-500 hover:text-white"
                                >
                                    <LogOut size={16} />
                                    <span>Exit Group</span>
                                </button>
                            </div>
                        </div>
                    )}

                    {/* 📊 SURGICAL CONTACT DETAILS PANEL DRAWER */}
                    {showContactDetails && !activeGroup && activeFriend && (
                        <div className="w-80 bg-gray-900 border-l border-gray-800 p-4 flex flex-col h-full overflow-y-auto scrollbar-thin scrollbar-thumb-gray-700 scrollbar-track-transparent">
                            <div className="flex flex-col items-center mb-5 pb-4 border-b border-gray-800 relative">
                                <button onClick={() => { setShowContactDetails(false); setIsEditingAlias(false); }} className="absolute top-0 right-0 text-gray-500 hover:text-gray-300">✕</button>
                                <div className="w-20 h-20 rounded-full bg-gray-800 border-2 border-gray-700 overflow-hidden flex items-center justify-center shadow-lg mt-2 mb-3">
                                    {activeFriend.avatar ? <img src={activeFriend.avatar} alt="Profile" className="w-full h-full object-cover" /> : <span className="text-gray-400 font-bold text-2xl">U</span>}
                                </div>
                                {/* 📊 LOCAL ALIAS INLINE EDITOR ROW */}
                                {isEditingAlias ? (
                                    <div className="flex w-full items-center gap-2 px-2 mt-1">
                                        <input
                                            autoFocus
                                            type="text"
                                            value={aliasInput}
                                            onChange={e => setAliasInput(e.target.value)}
                                            className="flex-1 bg-gray-950 border border-emerald-500/50 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-emerald-400"
                                            placeholder="Assign personal nickname..."
                                        />
                                        <button
                                            onClick={async () => {
                                                try {
                                                    await apiFetch(`${import.meta.env.VITE_API_URL}/api/v1/friends/${activeFriend.userId}/alias`, {
                                                        method: 'PUT',
                                                        headers: { 'Content-Type': 'application/json' },
                                                        body: JSON.stringify({ alias: aliasInput })
                                                    });
                                                    setFriends(prev => prev.map(f => String(f.userId) === String(activeFriend.userId) ? { ...f, alias: aliasInput } : f));
                                                    setActiveFriend(prev => ({ ...prev, alias: aliasInput }));
                                                    setIsEditingAlias(false);
                                                } catch (err) { alert("Failed to save nickname."); }
                                            }}
                                            className="text-emerald-400 hover:text-emerald-300"
                                        >
                                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                                        </button>
                                        <button onClick={() => setIsEditingAlias(false)} className="text-red-400 hover:text-red-300">
                                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                                        </button>
                                    </div>
                                ) : (
                                    <div className="flex items-center gap-2 mt-1 justify-center w-full">
                                        <h3 className="font-bold text-lg text-white">{activeFriend.alias || activeFriend.username}</h3>
                                        <button
                                            onClick={() => { setAliasInput(activeFriend.alias || ""); setIsEditingAlias(true); }}
                                            className="text-gray-500 hover:text-emerald-400 transition-colors"
                                            title="Edit Nickname"
                                        >
                                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" /></svg>
                                        </button>
                                    </div>
                                )}

                            </div>

                            <div className="flex-1 flex flex-col gap-4">
                                <div className="bg-gray-800/30 border border-gray-800/80 rounded-lg p-3">
                                    <p className="text-[10px] text-gray-500 font-bold uppercase tracking-wider mb-1">Global System Identifier</p>
                                    <p className="text-sm text-gray-300 font-medium">@{activeFriend.username}</p>
                                </div>

                                {/* 📊 GHOST PROTOCOL RELATIONSHIP PURGE */}
                                <div className="mt-auto pt-4 border-t border-gray-800/80">
                                    <button
                                        onClick={async () => {
                                            if (!window.confirm(`Remove ${activeFriend.username} from your friends?`)) return;
                                            try {
                                                await axios.delete(`${import.meta.env.VITE_API_URL}/api/v1/friends/${activeFriend.userId}/terminate`, {
                                                    headers: { 'Authorization': `Bearer ${user.accessToken}` }
                                                });
                                                setFriends(prev => prev.filter(f => String(f.userId) !== String(activeFriend.userId)));
                                                setShowContactDetails(false);
                                                setActiveFriend(null);
                                            } catch (err) { alert("Action rejected by infrastructure."); }
                                        }}
                                        className="w-full bg-red-950/20 hover:bg-red-900/40 text-red-400 border border-red-900/40 rounded-lg p-2.5 text-xs font-bold transition-all flex items-center justify-center gap-2 hover:border-red-500/50"
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><line x1="22" y1="11" x2="16" y2="11" /></svg>
                                        Terminate Friendship Context
                                    </button>
                                </div>
                            </div>
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
                    {editingMessage && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px', background: 'rgba(102,252,241,0.1)', borderRadius: '8px', marginBottom: '10px', borderLeft: '4px solid var(--accent)' }}>
                            <div style={{ flex: 1 }}>
                                <div style={{ fontSize: '11px', color: 'var(--accent)', fontWeight: 'bold' }}>EDITING MESSAGE</div>
                                <div style={{ fontSize: '13px', color: '#888', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '400px' }}>
                                    {editingMessage.content}
                                </div>
                            </div>
                            <button onClick={cancelEdit} className="glass-button" style={{ padding: '4px 8px', fontSize: '11px', height: 'auto' }}>CANCEL</button>
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
                            disabled={!(activeFriend || activeGroup) || isUploading}
                            title="Attach File"
                        >
                            <Paperclip size={20} />
                        </button>
                        <button
                            onClick={openCamera}
                            className="glass-button"
                            disabled={!(activeFriend || activeGroup) || isUploading}
                            title="Take Photo"
                        >
                            <Camera size={20} />
                        </button>
                        <input
                            type="text"
                            className="glass-input"
                            placeholder={activeFriend || activeGroup ? "Type a secure message..." : "Select a chat to start..."}
                            value={inputMsg}
                            onChange={e => setInputMsg(e.target.value)}
                            onKeyPress={e => e.key === 'Enter' && sendMessage()}
                            disabled={!(activeFriend || activeGroup) || isUploading}
                        />
                        <button onClick={sendMessage} className="glass-button" disabled={!(activeFriend || activeGroup) || isUploading || (!inputMsg.trim() && !selectedFile)}>
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

            {/* Forward Modal */}
            {showForwardModal && (
                <div style={{
                    position: 'fixed',
                    top: 0, left: 0, right: 0, bottom: 0,
                    background: 'rgba(0,0,0,0.8)',
                    backdropFilter: 'blur(5px)',
                    zIndex: 10000,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                }} onClick={() => setShowForwardModal(false)}>
                    <div style={{
                        background: 'var(--panel-bg)',
                        border: '1px solid var(--border)',
                        borderRadius: '16px',
                        padding: '20px',
                        width: '90%',
                        maxWidth: '400px',
                        maxHeight: '70vh',
                        display: 'flex',
                        flexDirection: 'column'
                    }} onClick={e => e.stopPropagation()}>
                        <h3 style={{ margin: '0 0 20px 0', color: 'var(--text-highlight)' }}>Forward to...</h3>
                        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                            {friends.filter(f => f.userId !== activeFriend?.userId).length === 0 ? (
                                <div style={{ color: '#888', textAlign: 'center', padding: '20px' }}>No other friends to forward to.</div>
                            ) : null}
                            {friends.filter(f => f.userId !== activeFriend?.userId).map(friend => (
                                <div
                                    key={friend.id}
                                    onClick={() => executeForward(friend.userId)}
                                    style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px', background: 'rgba(255,255,255,0.05)', borderRadius: '8px', cursor: 'pointer' }}
                                >
                                    <div style={{ width: '30px', height: '30px', borderRadius: '50%', background: 'linear-gradient(135deg, #66fcf1, #45a29e)', color: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold' }}>
                                        {friend.username?.charAt(0).toUpperCase()}
                                    </div>
                                    <span style={{ color: '#fff', fontSize: '14px' }}>{friend.username}</span>
                                </div>
                            ))}
                        </div>
                        <button
                            onClick={() => setShowForwardModal(false)}
                            style={{ marginTop: '20px', padding: '10px', background: 'rgba(255,107,107,0.1)', color: '#ff6b6b', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' }}
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            )}

            {/* Full Screen Image Modal */}
            {selectedImage && (
                <div style={{
                    position: 'fixed',
                    top: 0, left: 0, right: 0, bottom: 0,
                    background: 'rgba(0,0,0,0.95)',
                    backdropFilter: 'blur(15px)',
                    zIndex: 11000,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '40px'
                }} onClick={() => setSelectedImage(null)}>
                    <button
                        onClick={() => setSelectedImage(null)}
                        style={{ position: 'absolute', top: '30px', right: '30px', background: 'rgba(0,0,0,0.5)', border: 'none', color: '#fff', cursor: 'pointer', padding: '10px', borderRadius: '50%', zIndex: 12000 }}
                    >
                        <X size={32} />
                    </button>

                    {selectedImage.type?.startsWith('image/') ? (
                        <img
                            src={selectedImage.url}
                            alt="Full Screen"
                            style={{ maxWidth: '100%', maxHeight: '100%', borderRadius: '12px', boxShadow: '0 0 50px rgba(0,0,0,0.8)' }}
                        />
                    ) : selectedImage.type === 'application/pdf' ? (
                        <iframe
                            src={selectedImage.url}
                            style={{ width: '90%', height: '90%', border: 'none', borderRadius: '12px', background: '#fff' }}
                            title="File Preview"
                        />
                    ) : (
                        <div style={{ textAlign: 'center', color: '#fff', background: 'rgba(255,255,255,0.05)', padding: '40px', borderRadius: '20px', border: '1px solid rgba(255,255,255,0.1)' }}>
                            <FileIcon size={64} style={{ color: '#00ff88', marginBottom: '20px' }} />
                            <h3 style={{ fontSize: '24px', marginBottom: '10px' }}>Preview Not Available</h3>
                            <p style={{ color: '#aaa', marginBottom: '30px' }}>This file type ({selectedImage.name?.split('.').pop()?.toUpperCase()}) needs to be opened in its own app.</p>
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    const link = document.createElement('a');
                                    link.href = selectedImage.url;
                                    link.download = selectedImage.name || 'decrypted_file';
                                    document.body.appendChild(link);
                                    link.click();
                                    document.body.removeChild(link);
                                }}
                                style={{ padding: '15px 30px', background: '#00ff88', color: '#000', border: 'none', borderRadius: '12px', fontWeight: 'bold', cursor: 'pointer' }}
                            >
                                Download & Open {selectedImage.name?.split('.').pop()?.toUpperCase()}
                            </button>
                        </div>
                    )}

                    <div style={{ position: 'absolute', bottom: '30px', left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: '15px' }}>
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                const link = document.createElement('a');
                                link.href = selectedImage.url;
                                link.download = selectedImage.name || 'decrypted_file';
                                document.body.appendChild(link);
                                link.click();
                                document.body.removeChild(link);
                            }}
                            className="glass-button"
                            style={{ padding: '12px 24px', background: 'var(--accent)', color: '#000', borderRadius: '12px' }}
                        >
                            <Download size={18} style={{ marginRight: '10px' }} />
                            Save to Computer
                        </button>
                    </div>
                </div>
            )}

            {/* Create Group Modal */}
            {showCreateGroupModal && (
                <div style={{
                    position: 'fixed',
                    top: 0, left: 0, right: 0, bottom: 0,
                    background: 'rgba(0,0,0,0.85)',
                    backdropFilter: 'blur(10px)',
                    zIndex: 10000,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                }}>
                    <div className="glass-panel" style={{ width: '90%', maxWidth: '450px', padding: '30px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <h3 style={{ margin: 0, color: 'var(--text-highlight)' }}>Create New Group</h3>
                            <X size={24} style={{ cursor: 'pointer' }} onClick={() => setShowCreateGroupModal(false)} />
                        </div>

                        <div>
                            <label style={{ fontSize: '12px', color: '#888', display: 'block', marginBottom: '8px' }}>Group Name</label>
                            <input
                                type="text"
                                className="glass-input"
                                placeholder="Enter group name..."
                                value={newGroupName}
                                onChange={e => setNewGroupName(e.target.value)}
                            />
                        </div>

                        <div>
                            <label style={{ fontSize: '12px', color: '#888', display: 'block', marginBottom: '8px' }}>Select Members</label>
                            <div style={{ maxHeight: '200px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                {friends.map(friend => (
                                    <div
                                        key={friend.userId}
                                        onClick={() => {
                                            if (selectedMembers.includes(friend.userId)) {
                                                setSelectedMembers(selectedMembers.filter(id => id !== friend.userId));
                                            } else {
                                                setSelectedMembers([...selectedMembers, friend.userId]);
                                            }
                                        }}
                                        style={{
                                            display: 'flex', alignItems: 'center', gap: '10px', padding: '10px', borderRadius: '8px', cursor: 'pointer',
                                            background: selectedMembers.includes(friend.userId) ? 'rgba(0, 255, 136, 0.1)' : 'rgba(255,255,255,0.05)',
                                            border: selectedMembers.includes(friend.userId) ? '1px solid rgba(0, 255, 136, 0.3)' : '1px solid transparent'
                                        }}
                                    >
                                        <div style={{ width: '18px', height: '18px', borderRadius: '4px', border: '2px solid #45a29e', display: 'flex', alignItems: 'center', justifyContent: 'center', background: selectedMembers.includes(friend.userId) ? '#00ff88' : 'transparent' }}>
                                            {selectedMembers.includes(friend.userId) && <Check size={14} color="#000" />}
                                        </div>
                                        <span style={{ fontSize: '14px' }}>{friend.username}</span>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
                            <button
                                onClick={() => setShowCreateGroupModal(false)}
                                className="glass-button"
                                style={{ flex: 1, color: '#ff6b6b' }}
                            >
                                Cancel
                            </button>
                            <button
                                onClick={async () => {
                                    if (!newGroupName.trim() || selectedMembers.length === 0) {
                                        alert("Please enter a group name and select at least one member.");
                                        return;
                                    }
                                    setIsCreatingGroup(true);
                                    try {
                                        const res = await apiFetch(`${import.meta.env.VITE_API_URL}/api/v1/groups`, {
                                            method: 'POST',
                                            headers: { 'Content-Type': 'application/json' },
                                            body: JSON.stringify({ name: newGroupName, memberIds: selectedMembers })
                                        });
                                        if (res.ok) {
                                            fetchSocialData();
                                            setShowCreateGroupModal(false);
                                            setNewGroupName('');
                                            setSelectedMembers([]);
                                        }
                                    } catch (e) {
                                        console.error("Group creation failed", e);
                                    }
                                    setIsCreatingGroup(false);
                                }}
                                className="glass-button"
                                style={{ flex: 1, background: 'var(--accent)', color: '#000' }}
                                disabled={isCreatingGroup}
                            >
                                {isCreatingGroup ? <Loader className="spin" size={18} /> : "Create"}
                            </button>
                        </div>
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

            {/* 📊 ALIAS CONFIGURATION MODAL */}
            {showAliasModal && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000 }}>
                    <div className="glass-panel" style={{ width: '320px', background: '#0a0a0a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px', padding: '20px', display: 'flex', flexDirection: 'column' }}>
                        <h4 style={{ margin: '0 0 12px 0', fontSize: '14px', fontWeight: 'bold', color: '#66fcf1', uppercase: true, letterSpacing: '1px' }}>Set Local Alias</h4>
                        <p style={{ fontSize: '12px', color: '#888', marginBottom: '16px' }}>This name will override "{showAliasModal.username}" on your screen only.</p>
                        <input
                            autoFocus
                            type="text"
                            value={aliasInput}
                            onChange={e => setAliasInput(e.target.value)}
                            className="glass-input"
                            style={{ width: '100%', marginBottom: '16px' }}
                            placeholder="Enter custom nickname..."
                        />
                        <div style={{ display: 'flex', gap: '10px' }}>
                            <button onClick={() => setShowAliasModal(null)} className="glass-button" style={{ flex: 1, background: 'rgba(255,255,255,0.05)', color: '#ccc' }}>Cancel</button>
                            <button onClick={async () => {
                                try {
                                    const res = await apiFetch(`${import.meta.env.VITE_API_URL}/api/v1/friends/${showAliasModal.userId}/alias`, {
                                        method: 'PUT',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({ alias: aliasInput })
                                    });
                                    if (res.ok) {
                                        setFriends(prev => prev.map(f => String(f.id) === String(showAliasModal.id) ? { ...f, alias: aliasInput } : f));
                                        if (activeFriend && String(activeFriend.id) === String(showAliasModal.id)) {
                                            setActiveFriend(prev => ({ ...prev, alias: aliasInput }));
                                        }
                                        setShowAliasModal(null);
                                    } else {
                                        alert("Failed to save alias.");
                                    }
                                } catch (err) { alert("Failed to save alias."); }
                            }} className="glass-button" style={{ flex: 1, background: '#66fcf1', color: '#000' }}>Save Alias</button>
                        </div>
                    </div>
                </div>
            )}
            {/* 📊 GLOBAL SELF IDENTITY & SETTINGS MODAL */}
            {showProfileSettings && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(10px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10002 }} className="animate-fade-in">
                    <div style={{ background: '#0a0a0a', border: '1px solid rgba(255,255,255,0.1)', width: '360px', borderRadius: '12px', padding: '24px', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)', display: 'flex', flexDirection: 'column', gap: '16px', maxHeight: '90vh', overflowY: 'auto' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.1)', pb: '8px' }}>
                            <h4 style={{ color: '#00ff88', fontWeight: 'bold', textTransform: 'uppercase', fontSize: '12px', letterSpacing: '1px' }}>Account Customization</h4>
                            <button onClick={() => setShowProfileSettings(false)} style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: '14px' }}>✕</button>
                        </div>

                        {/* Avatar File Manager Section */}
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', paddingBottom: '8px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                            <input type="file" accept="image/*" ref={profileAvatarInputRef} style={{ display: 'none' }} onChange={(e) => {
                                // 📊 IDENTITY PROFILE IMAGE CACHE SYNCHRONIZATION
                                const file = e.target.files[0];
                                if (!file) return;
                                const r = new FileReader();
                                r.onloadend = async () => {
                                    try {
                                        await apiFetch(`${import.meta.env.VITE_API_URL}/api/v1/users/profile`, {
                                            method: 'PUT',
                                            headers: { 'Content-Type': 'application/json' },
                                            body: JSON.stringify({ avatar: r.result })
                                        });

                                        // State propagation
                                        if (typeof setCurrentUser === 'function') {
                                            setCurrentUser(prev => ({ ...prev, avatar: r.result }));
                                        }

                                        // Update browser identity cache to secure state across context reloads
                                        const cachedUser = localStorage.getItem('prama_auth_user');
                                        if (cachedUser) {
                                            const parsedUser = JSON.parse(cachedUser);
                                            parsedUser.avatar = r.result;
                                            localStorage.setItem('prama_auth_user', JSON.stringify(parsedUser));
                                        }

                                        alert("Identity profile picture synchronized.");
                                    } catch (err) {
                                        alert("Failed to patch photo asset.");
                                    }
                                };
                                r.readAsDataURL(file);
                            }} />

                            <div style={{ position: 'relative', cursor: 'pointer' }} className="group" onClick={() => profileAvatarInputRef.current.click()}>
                                <div style={{ width: '64px', height: '64px', borderRadius: '50%', background: '#1a1a1a', border: '1px solid #333', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                                    {user?.avatar ? <img src={user.avatar} alt="Me" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span style={{ fontSize: '20px', color: '#888', fontWeight: 'bold' }}>{user?.username?.charAt(0).toUpperCase()}</span>}
                                </div>
                                <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.6)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0, transition: 'opacity 0.2s', fontSize: '10px', color: '#fff', fontWeight: 'bold' }} onMouseEnter={e => e.target.style.opacity = 1} onMouseLeave={e => e.target.style.opacity = 0}>Change</div>
                            </div>
                        </div>

                        {/* Identity Metadata Form */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                            <label style={{ fontSize: '10px', textTransform: 'uppercase', trackingWider: '1px', color: '#555', fontWeight: 'bold' }}>Global Profile Information</label>
                            <input type="text" placeholder="Username" value={profileFormData.username} onChange={e => setProfileFormData(p => ({ ...p, username: e.target.value }))} style={{ width: '100%', background: '#050505', border: '1px solid #222', borderRadius: '4px', padding: '8px', fontSize: '12px', color: '#fff', outline: 'none' }} onFocus={e => e.target.style.borderColor = '#00ff88'} onBlur={e => e.target.style.borderColor = '#222'} />
                            <input type="email" placeholder="Email Address" value={profileFormData.email} onChange={e => setProfileFormData(p => ({ ...p, email: e.target.value }))} style={{ width: '100%', background: '#050505', border: '1px solid #222', borderRadius: '4px', padding: '8px', fontSize: '12px', color: '#fff', outline: 'none' }} onFocus={e => e.target.style.borderColor = '#00ff88'} onBlur={e => e.target.style.borderColor = '#222'} />
                            <button onClick={async () => {
                                try {
                                    await apiFetch(`${import.meta.env.VITE_API_URL}/api/v1/users/profile`, {
                                        method: 'PUT',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({ username: profileFormData.username, email: profileFormData.email })
                                    });
                                    setCurrentUser(prev => ({ ...prev, username: profileFormData.username, email: profileFormData.email }));
                                    alert("System credentials updated successfully.");
                                } catch (err) { alert("Update processing rejected."); }
                            }} style={{ width: '100%', background: '#00ff88', color: '#000', fontWeight: 'bold', py: '6px', borderRadius: '4px', fontSize: '12px', cursor: 'pointer', border: 'none' }}>Update Core Metadata</button>
                        </div>

                        {/* Authentication Security Form */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '12px' }}>
                            <label style={{ fontSize: '10px', textTransform: 'uppercase', trackingWider: '1px', color: '#555', fontWeight: 'bold' }}>Rotate Security Credentials</label>
                            <input type="password" placeholder="Current Secure Password" value={profileFormData.currentPassword} onChange={e => setProfileFormData(p => ({ ...p, currentPassword: e.target.value }))} style={{ width: '100%', background: '#050505', border: '1px solid #222', borderRadius: '4px', padding: '8px', fontSize: '12px', color: '#fff', outline: 'none' }} onFocus={e => e.target.style.borderColor = '#440000'} onBlur={e => e.target.style.borderColor = '#222'} />
                            <input type="password" placeholder="New Secure Password" value={profileFormData.newPassword} onChange={e => setProfileFormData(p => ({ ...p, newPassword: e.target.value }))} style={{ width: '100%', background: '#050505', border: '1px solid #222', borderRadius: '4px', padding: '8px', fontSize: '12px', color: '#fff', outline: 'none' }} onFocus={e => e.target.style.borderColor = '#00ff88'} onBlur={e => e.target.style.borderColor = '#222'} />
                            <button onClick={async () => {
                                if (!profileFormData.currentPassword || !profileFormData.newPassword) return alert("All authorization password blocks required.");
                                try {
                                    if (!keys) return alert("Cryptographic identity not fully initialized.");
                                    
                                    // 1. Derive the NEW master key from the new password
                                    const salt = user.email; // Web uses email as salt string
                                    const newMasterKey = await deriveKeyFromPassword(profileFormData.newPassword, salt);
                                    
                                    // 2. Encrypt the CURRENT keys with the NEW master key
                                    const encryptedKeys = encryptDataWithPassword(JSON.stringify(keys), newMasterKey);
                                    const encryptedKeyBundleStr = JSON.stringify(encryptedKeys);

                                    // 3. Send BOTH the password change and the NEW key bundle
                                    await apiFetch(`${import.meta.env.VITE_API_URL}/api/v1/users/password`, {
                                        method: 'PUT',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({ 
                                            currentPassword: profileFormData.currentPassword, 
                                            newPassword: profileFormData.newPassword,
                                            encryptedKeyBundle: encryptedKeyBundleStr
                                        })
                                    });
                                    
                                    alert("Password matrix and cryptographic bundle rotated securely. You will now be logged out.");
                                    setProfileFormData(p => ({ ...p, currentPassword: '', newPassword: '' }));
                                    
                                    // 4. Force JWT Logout to prevent 401 cascading errors
                                    logout();
                                    navigate('/login');
                                } catch (err) { alert("Authentication validation failed or password incorrect."); }
                            }} style={{ width: '100%', background: 'rgba(255,0,0,0.1)', color: '#ff4444', fontWeight: 'bold', py: '6px', borderRadius: '4px', fontSize: '12px', cursor: 'pointer', border: '1px solid rgba(255,0,0,0.2)' }}>Rotate Access Password</button>
                        </div>
                    </div>
                </div>
            )}
        </div>

    );
};

export default Chat;
