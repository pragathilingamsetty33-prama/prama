import React from 'react';
import { Navigate, Outlet } from 'react-router-dom';

/**
 * AdminRoutes acts as a security guard for the /admin namespace.
 * It checks for the ROLE_ADMIN privilege in the user metadata.
 */
const AdminRoutes = () => {
  // We retrieve the user from localStorage or a global AuthContext
  const userStr = localStorage.getItem('user');
  const user = userStr ? JSON.parse(userStr) : null;
  const token = localStorage.getItem('token');

  // Logic: Must have token AND ROLE_ADMIN
  const isAdmin = token && user && user.role === 'ROLE_ADMIN';

  if (!isAdmin) {
    return <Navigate to="/login" replace />;
  }



  return <Outlet />;
};

export default AdminRoutes;
