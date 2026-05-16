import React, { useState, useEffect } from 'react';
import AdminService from '../../utils/AdminService';
import { User, Mail, Calendar, ShieldAlert, ToggleLeft, ToggleRight, Search, Filter } from 'lucide-react';

/**
 * UserManagement provides the "Kill Switch" interface for organizational control.
 */
const UserManagement = () => {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    try {
      const data = await AdminService.getAllUsers();
      setUsers(data);
    } catch (error) {
      console.error('Failed to fetch users', error);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleStatus = async (userId, currentEnabled) => {
    try {
      await AdminService.toggleUserStatus(userId, !currentEnabled);
      // Optimistic UI update
      setUsers(prev => prev.map(u => 
        u.userId === userId ? { ...u, enabled: !currentEnabled } : u
      ));
    } catch (error) {
      console.error('Failed to toggle status', error);
    }
  };

  const filteredUsers = users.filter(u => 
    u.username.toLowerCase().includes(searchTerm.toLowerCase()) ||
    u.email.toLowerCase().includes(searchTerm.toLowerCase())
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
            placeholder="Search by username or email..." 
            className="w-full bg-slate-800 border border-slate-700 rounded-xl py-3 pl-10 pr-4 text-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <button className="flex items-center gap-2 bg-slate-800 border border-slate-700 px-4 py-3 rounded-xl text-slate-300 hover:bg-slate-700 transition-all">
          <Filter size={18} />
          <span>Filter</span>
        </button>
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
                      {u.role.replace('ROLE_', '')}
                    </span>
                  </td>
                  <td className="px-6 py-5 text-slate-400 text-sm">
                    <div className="flex items-center gap-2">
                      <Calendar size={14} />
                      {new Date(u.createdAt).toLocaleDateString()}
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
