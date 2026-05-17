import React from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

/**
 * AdminRoutes acts as a security guard for the /admin namespace.
 * It decodes the JWT token claims to verify administrative privileges.
 */
const AdminRoutes = () => {
  const { user, loading } = useAuth();

  if (loading) {
    return <div className="flex items-center justify-center h-screen bg-slate-950 text-emerald-500 font-mono">Verifying administrative credentials...</div>;
  }

  // 🛡️ Dynamically decode JWT role within the router security guard
  let tokenRole = null;
  if (user?.accessToken) {
      try {
          const base64Url = user.accessToken.split('.')[1];
          const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
          const payload = JSON.parse(window.atob(base64));
          tokenRole = payload.role || payload.roles || (payload.authorities ? payload.authorities[0] : null);
      } catch (e) {
          console.error("🛡️ Route Guard JWT Parsing Error:", e);
      }
  }

  // Final authorization logic check
  const isAuthorizedAdmin = user?.role === 'ADMIN' || 
                            user?.role === 'ROLE_ADMIN' || 
                            tokenRole === 'ADMIN' || 
                            tokenRole === 'ROLE_ADMIN';

  if (!isAuthorizedAdmin) {
    console.warn("🛡️ Security Violation: Unauthorized access attempt to /admin namespace.");
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
};

export default AdminRoutes;

