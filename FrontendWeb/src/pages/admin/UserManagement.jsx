import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { User, Mail, Calendar, ShieldAlert, ToggleLeft, ToggleRight, Search, Filter } from 'lucide-react';

/**
 * 🛡️ PHASE 11: HARDENED USER MANAGEMENT CONTROL PLANE
 * Strictly live-wired to the backend with ZERO fallback mock data.
 */
const UserManagement = () => {
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');

    // 1. Fetch Live Users on Mount
    useEffect(() => {
        const fetchLiveUsers = async () => {
            try {
                // Safely extract session from persistent storage
                const storedUser = localStorage.getItem('prama_auth_user') || localStorage.getItem('user');
                const session = storedUser ? JSON.parse(storedUser) : null;
                const token = session?.accessToken;

                const response = await axios.get('http://localhost:8080/api/v1/admin/users?page=0&size=20', {
                    headers: { 
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    }
                });
                
                const userList = response.data.content ? response.data.content : response.data;
                setUsers(userList);
            } catch (err) {
                console.error("❌ Live fetch failed:", err);
                setUsers([]); // Clear state on error, NEVER use mock data
            } finally {
                setLoading(false);
            }
        };
        fetchLiveUsers();
    }, []);

    // 2. Secure Status Toggle Handler
    const handleToggleStatus = async (userId, currentEnabled) => {
        try {
            const storedUser = localStorage.getItem('prama_auth_user') || localStorage.getItem('user');
            const session = storedUser ? JSON.parse(storedUser) : null;
            const token = session?.accessToken;

            // Prefixed with api/v1/ and correctly mapped to backend status endpoint
            await axios.patch(`http://localhost:8080/api/v1/admin/users/${userId}/status`, 
                { enabled: !currentEnabled }, 
                {
                    headers: { 
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            // Update local UI state dynamically upon success
            setUsers(prev => prev.map(u => 
                (u.userId === userId || u.id === userId) ? { ...u, enabled: !currentEnabled } : u
            ));
        } catch (err) {
            console.error("❌ Failed to toggle status:", err);
        }
    };

    const filteredUsers = users.filter(u => 
        u.username?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        u.email?.toLowerCase().includes(searchTerm.toLowerCase())
    );

    if (loading) {
        return (
            <div className="flex-1 flex items-center justify-center">
                <div className="w-12 h-12 border-4 border-emerald-400 border-t-transparent rounded-full animate-spin"></div>
            </div>
        );
    }

    return (
        <div className="space-y-6 animate-in slide-in-from-bottom-4 duration-500">
            {/* Table Controls */}
            <div className="flex flex-col md:flex-row justify-between gap-4">
                <div className="relative flex-1 max-w-md">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                    <input 
                        type="text" 
                        placeholder="Search live identities..." 
                        className="w-full bg-slate-800 border border-slate-700 rounded-xl py-3 pl-10 pr-4 text-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>
            </div>

            {/* User Directory Table */}
            <div className="bg-slate-800 border border-slate-700 rounded-2xl overflow-hidden shadow-2xl">
                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                        <thead>
                            <tr className="bg-slate-900/50 text-slate-400 text-xs uppercase tracking-wider">
                                <th className="px-6 py-4 font-semibold">User Identity</th>
                                <th className="px-6 py-4 font-semibold">Security Role</th>
                                <th className="px-6 py-4 font-semibold">Onboarding Date</th>
                                <th className="px-6 py-4 font-semibold text-right">Kill Switch</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-700/50">
                            {filteredUsers.map((u) => (
                                <tr key={u.userId} className="hover:bg-slate-700/20 transition-all">
                                    <td className="px-6 py-5">
                                        <div className="flex items-center gap-3">
                                            <div className="w-10 h-10 rounded-lg bg-slate-700 flex items-center justify-center text-emerald-400">
                                                <User size={20} />
                                            </div>
                                            <div>
                                                <p className="text-slate-100 font-medium">{u.username}</p>
                                                <p className="text-slate-500 text-xs">{u.email}</p>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-6 py-5">
                                        <span className={`text-[10px] font-bold px-2 py-1 rounded ${
                                            u.role === 'ROLE_ADMIN' 
                                                ? 'bg-purple-500/10 text-purple-400 border border-purple-500/20' 
                                                : 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                                        }`}>
                                            {u.role ? u.role.replace('ROLE_', '') : 'USER'}
                                        </span>
                                    </td>
                                    <td className="px-6 py-5 text-slate-400 text-sm">
                                        <div className="flex items-center gap-2">
                                            <Calendar size={14} />
                                            {u.createdAt ? new Date(u.createdAt).toLocaleDateString() : 'N/A'}
                                        </div>
                                    </td>
                                    <td className="px-6 py-5 text-right">
                                        <button 
                                            onClick={() => handleToggleStatus(u.userId, u.enabled)}
                                            className="group transition-all"
                                        >
                                            {u.enabled ? (
                                                <div className="flex items-center justify-end gap-2 text-emerald-500">
                                                    <span className="text-[10px] font-bold uppercase opacity-0 group-hover:opacity-100 transition-opacity">Active</span>
                                                    <ToggleRight size={32} />
                                                </div>
                                            ) : (
                                                <div className="flex items-center justify-end gap-2 text-rose-500">
                                                    <span className="text-[10px] font-bold uppercase opacity-0 group-hover:opacity-100 transition-opacity">Suspended</span>
                                                    <ToggleLeft size={32} />
                                                </div>
                                            )}
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                
                {filteredUsers.length === 0 && (
                    <div className="p-20 text-center space-y-4">
                        <ShieldAlert size={48} className="mx-auto text-slate-600" />
                        <p className="text-slate-500">No organizational identities found matching your search.</p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default UserManagement;
