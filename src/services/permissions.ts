import type { Database } from './database.js';
import { GraphError } from '../middleware/error.js';
import { generateId } from '../utils/id.js';
import type {
  Permission,
  CreateLinkRequest,
  InviteRequest,
  IdentitySet
} from '../types/permission.js';

interface PermissionRow {
  id: string;
  item_id: string;
  granted_to_user_id: string | null;
  granted_to_user_email: string | null;
  granted_to_user_display_name: string | null;
  granted_to_application_id: string | null;
  granted_to_application_display_name: string | null;
  roles: string;
  inherited_from_id: string | null;
  link_type: string | null;
  link_scope: string | null;
  link_web_url: string | null;
  link_prevents_download: number;
  expiration_date_time: string | null;
  has_password: number;
  created_at: string;
}

export class PermissionsService {
  constructor(private db: Database) {}

  async getPermissions(itemId: string): Promise<Permission[]> {
    // Get direct permissions
    const directPerms = this.db.raw.prepare(`
      SELECT * FROM permissions WHERE item_id = ?
    `).all(itemId) as PermissionRow[];

    // Get inherited permissions (walk up the tree)
    const inheritedPerms = await this.getInheritedPermissions(itemId);

    return [...directPerms, ...inheritedPerms].map(this.formatPermission.bind(this));
  }

  async getPermission(itemId: string, permissionId: string): Promise<Permission | null> {
    const perm = this.db.raw.prepare(`
      SELECT * FROM permissions WHERE id = ? AND item_id = ?
    `).get(permissionId, itemId) as PermissionRow | undefined;

    if (!perm) {
      // Check inherited
      const inherited = await this.getInheritedPermission(itemId, permissionId);
      return inherited;
    }

    return this.formatPermission(perm);
  }

  async createLink(itemId: string, request: CreateLinkRequest): Promise<Permission> {
    const id = generateId(`link:${itemId}:${Date.now()}:${Math.random()}`);
    const webUrl = this.generateSharingUrl(itemId, request.type);

    this.db.raw.prepare(`
      INSERT INTO permissions (
        id, item_id, roles, link_type, link_scope, link_web_url,
        expiration_date_time, has_password, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      itemId,
      JSON.stringify(request.type === 'view' ? ['read'] : ['write']),
      request.type,
      request.scope || 'anonymous',
      webUrl,
      request.expirationDateTime || null,
      request.password ? 1 : 0,
      new Date().toISOString()
    );

    const perm = await this.getPermission(itemId, id);
    if (!perm) {
      throw GraphError.notFound('Failed to create permission');
    }
    return perm;
  }

  async invite(itemId: string, request: InviteRequest): Promise<Permission[]> {
    const createdPermissions: Permission[] = [];

    for (const recipient of request.recipients) {
      const id = generateId(`invite:${itemId}:${recipient.email}:${Date.now()}`);

      this.db.raw.prepare(`
        INSERT INTO permissions (
          id, item_id, granted_to_user_id, granted_to_user_email,
          granted_to_user_display_name, roles,
          expiration_date_time, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        itemId,
        recipient.objectId || null,
        recipient.email,
        recipient.email.split('@')[0], // Simple display name from email
        JSON.stringify(request.roles),
        request.expirationDateTime || null,
        new Date().toISOString()
      );

      const perm = await this.getPermission(itemId, id);
      if (perm) {
        createdPermissions.push(perm);
      }
    }

    return createdPermissions;
  }

  async updatePermission(
    itemId: string,
    permissionId: string,
    updates: { roles?: string[]; expirationDateTime?: string }
  ): Promise<Permission> {
    const setClauses: string[] = [];
    const params: any[] = [];

    if (updates.roles) {
      setClauses.push('roles = ?');
      params.push(JSON.stringify(updates.roles));
    }

    if (updates.expirationDateTime !== undefined) {
      setClauses.push('expiration_date_time = ?');
      params.push(updates.expirationDateTime);
    }

    if (setClauses.length > 0) {
      params.push(permissionId, itemId);
      this.db.raw.prepare(`
        UPDATE permissions SET ${setClauses.join(', ')}
        WHERE id = ? AND item_id = ?
      `).run(...params);
    }

    const perm = await this.getPermission(itemId, permissionId);
    if (!perm) {
      throw GraphError.notFound('Permission not found');
    }
    return perm;
  }

  async deletePermission(itemId: string, permissionId: string): Promise<void> {
    const result = this.db.raw.prepare(`
      DELETE FROM permissions WHERE id = ? AND item_id = ?
    `).run(permissionId, itemId);

    if (result.changes === 0) {
      throw GraphError.notFound('Permission not found');
    }
  }

  private async getInheritedPermissions(itemId: string): Promise<PermissionRow[]> {
    const item = this.db.getItemById(itemId);
    if (!item || !item.parentId) return [];

    const parentPerms = this.db.raw.prepare(`
      SELECT p.*, i.path as inherited_path
      FROM permissions p
      JOIN items i ON p.item_id = i.id
      WHERE p.item_id = ?
    `).all(item.parentId) as PermissionRow[];

    // Mark as inherited
    const marked = parentPerms.map(p => ({
      ...p,
      inherited_from_id: item.parentId!
    }));

    // Recurse up
    const ancestorPerms = await this.getInheritedPermissions(item.parentId);

    return [...marked, ...ancestorPerms];
  }

  private async getInheritedPermission(itemId: string, permissionId: string): Promise<Permission | null> {
    const inheritedPerms = await this.getInheritedPermissions(itemId);
    const perm = inheritedPerms.find(p => p.id === permissionId);
    return perm ? this.formatPermission(perm) : null;
  }

  private generateSharingUrl(itemId: string, type: string): string {
    const token = Buffer.from(`${itemId}:${type}:${Date.now()}`).toString('base64url');
    return `https://mock-sharepoint.local/share/${token}`;
  }

  private formatPermission(dbRow: PermissionRow): Permission {
    const perm: Permission = {
      id: dbRow.id,
      roles: JSON.parse(dbRow.roles) as ('read' | 'write' | 'owner')[]
    };

    if (dbRow.granted_to_user_email) {
      perm.grantedTo = {
        user: {
          id: dbRow.granted_to_user_id || undefined,
          email: dbRow.granted_to_user_email,
          displayName: dbRow.granted_to_user_display_name || undefined
        }
      };
    }

    if (dbRow.granted_to_application_id) {
      perm.grantedTo = perm.grantedTo || {};
      perm.grantedTo.application = {
        id: dbRow.granted_to_application_id,
        displayName: dbRow.granted_to_application_display_name || undefined
      };
    }

    if (dbRow.link_type) {
      perm.link = {
        type: dbRow.link_type as 'view' | 'edit' | 'embed',
        scope: dbRow.link_scope as 'anonymous' | 'organization' | 'users',
        webUrl: dbRow.link_web_url!,
        preventsDownload: dbRow.link_prevents_download === 1
      };
    }

    if (dbRow.inherited_from_id) {
      perm.inheritedFrom = {
        id: dbRow.inherited_from_id
      };
    }

    if (dbRow.expiration_date_time) {
      perm.expirationDateTime = dbRow.expiration_date_time;
    }

    if (dbRow.has_password === 1) {
      perm.hasPassword = true;
    }

    return perm;
  }
}
