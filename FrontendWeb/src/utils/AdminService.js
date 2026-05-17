import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8080/api/v1';

/**
 * AdminService handles all administrative API interactions.
 */
class AdminService {
  /**
   * Helper to get auth headers from localStorage or context.
   */
  getHeaders() {
    const storedUser = localStorage.getItem('prama_auth_user');
    const user = storedUser ? JSON.parse(storedUser) : null;
    const token = user?.accessToken;
    return {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    };
  }

  /**
   * Fetch all users (Metadata only).
   */
  async getAllUsers() {
    const response = await axios.get(`${API_BASE_URL}/admin/users`, {
      headers: this.getHeaders()
    });
    return response.data;
  }

  /**
   * Toggle a user's account activation status (The Kill Switch).
   */
  async toggleUserStatus(userId, enabled) {
    const response = await axios.patch(`${API_BASE_URL}/admin/users/${userId}/status`, 
      { enabled }, 
      { headers: this.getHeaders() }
    );
    return response.data;
  }

  /**
   * Fetch system telemetry and health metrics.
   */
  async getMetrics() {
    const response = await axios.get(`${API_BASE_URL}/admin/metrics`, {
      headers: this.getHeaders()
    });
    return response.data;
  }

  /**
   * Fetch group rosters and sizes.
   */
  async getGroups() {
    const response = await axios.get(`${API_BASE_URL}/admin/groups`, {
      headers: this.getHeaders()
    });
    return response.data;
  }
}

export default new AdminService();
