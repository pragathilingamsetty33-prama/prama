import React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { LayoutDashboard, Users, Settings, LogOut, Shield } from 'lucide-react';

/**
 * AdminLayout provides the sidebar and shell for the executive dashboard.
 */
const AdminLayout = ({ children }) => {
  const location = useLocation();
  const navigate = useNavigate();

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    navigate('/login');
  };

  const navItems = [
    { name: 'Dashboard', path: '/admin', icon: LayoutDashboard },
    { name: 'User Management', path: '/admin/users', icon: Users },
    { name: 'System Settings', path: '/admin/settings', icon: Settings },
  ];

  return (
    <div className="flex h-screen w-full bg-slate-900 text-slate-100 font-sans">
      {/* Sidebar */}
      <aside className="w-64 bg-slate-800 border-r border-slate-700 flex flex-col">
        <div className="p-6 flex items-center gap-3">
          <Shield className="text-emerald-400" size={32} />
          <span className="text-xl font-bold tracking-tight text-emerald-400">Prama Admin</span>
        </div>

        <nav className="flex-1 mt-6 px-4">
          {navItems.map((item) => (
            <Link
              key={item.name}
              to={item.path}
              className={`flex items-center gap-3 px-4 py-3 rounded-lg mb-2 transition-all ${
                location.pathname === item.path
                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                  : 'text-slate-400 hover:bg-slate-700/50 hover:text-slate-100'
              }`}
            >
              <item.icon size={20} />
              <span className="font-medium">{item.name}</span>
            </Link>
          ))}
        </nav>

        <div className="p-4 border-t border-slate-700">
          <button
            onClick={handleLogout}
            className="flex items-center gap-3 w-full px-4 py-3 text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-all"
          >
            <LogOut size={20} />
            <span className="font-medium">Logout</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        <header className="h-16 border-b border-slate-700 bg-slate-800/50 flex items-center justify-between px-8 backdrop-blur-sm">
          <h1 className="text-lg font-semibold text-slate-300">
            {navItems.find(i => i.path === location.pathname)?.name || 'Admin'}
          </h1>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-sm font-medium">Super Admin</p>
              <p className="text-xs text-slate-500">Security Clearance: Level 5</p>
            </div>
            <div className="w-10 h-10 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400 font-bold">
              SA
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-8 bg-slate-900">
          {children}
        </div>
      </main>
    </div>
  );
};

export default AdminLayout;
