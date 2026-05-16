import { API_BASE_URL } from '../constants/Config';

/**
 * GroupAdminService handles administrative operations for E2EE groups.
 */
export class GroupAdminService {
  /**
   * Invites a new member to the group.
   * Logic: Allowed if requester is admin OR members_can_add is enabled.
   */
  static async addMember(groupId: string, userId: string, apiFetch: any): Promise<void> {
    const response = await apiFetch(`${API_BASE_URL}/api/v1/groups/${groupId}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    });
    if (!response.ok) throw new Error(await response.text());
  }

  /**
   * Removes a member from the group.
   * Logic: Strictly Admin-only.
   */
  static async removeMember(groupId: string, userId: string, apiFetch: any): Promise<void> {
    const response = await apiFetch(`${API_BASE_URL}/api/v1/groups/${groupId}/members/${userId}`, {
      method: 'DELETE',
    });
    if (!response.ok) throw new Error(await response.text());
  }

  /**
   * Toggles whether non-admin members can add new members.
   * Logic: Strictly Admin-only.
   */
  static async toggleMemberInvite(groupId: string, canAdd: boolean, apiFetch: any): Promise<void> {
    const response = await apiFetch(`${API_BASE_URL}/api/v1/groups/${groupId}/settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ membersCanAdd: canAdd }),
    });
    if (!response.ok) throw new Error(await response.text());
  }

  /**
   * Fetches group message history.
   * ZERO-KNOWLEDGE: The server enforces forward-only visibility via joined_at filter.
   */
  static async getGroupHistory(groupId: string, apiFetch: any): Promise<any[]> {
    const response = await apiFetch(`${API_BASE_URL}/api/v1/groups/${groupId}/messages`);
    if (!response.ok) throw new Error('Failed to fetch group history');
    return await response.json();
  }
}
