# Plan 06: Permissions Endpoints

## Overview

Implement permission management endpoints to list, create, update, and delete permissions on drive items. This enables testing of sharing and access control scenarios.

## References

- [List permissions](https://learn.microsoft.com/en-us/graph/api/driveitem-list-permissions?view=graph-rest-1.0)
- [Create permission](https://learn.microsoft.com/en-us/graph/api/driveitem-post-permissions?view=graph-rest-beta)
- [Permission resource](https://learn.microsoft.com/en-us/graph/api/resources/permission?view=graph-rest-1.0)
- [driveItem: invite](https://learn.microsoft.com/en-us/graph/api/driveitem-invite?view=graph-rest-1.0)

## Current State

- `permissions` table exists in database schema but is unused
- No permission endpoints implemented
- No sharing functionality

## API Specifications

### List Permissions

**Endpoint:** `GET /drives/{driveId}/items/{itemId}/permissions`

**Response:**
```json
{
  "@odata.context": "...",
  "value": [
    {
      "id": "permission-id",
      "roles": ["read"],
      "grantedTo": {
        "user": {
          "id": "user-id",
          "displayName": "John Doe",
          "email": "john@contoso.com"
        }
      },
      "inheritedFrom": {
        "id": "parent-item-id",
        "path": "/drives/x/root:/folder"
      }
    },
    {
      "id": "link-permission-id",
      "roles": ["read"],
      "link": {
        "type": "view",
        "webUrl": "https://contoso.sharepoint.com/...",
        "scope": "anonymous"
      }
    }
  ]
}
```

### Get Permission

**Endpoint:** `GET /drives/{driveId}/items/{itemId}/permissions/{permissionId}`

### Create Sharing Link

**Endpoint:** `POST /drives/{driveId}/items/{itemId}/createLink`

**Request Body:**
```json
{
  "type": "view",
  "scope": "anonymous",
  "expirationDateTime": "2025-12-31T23:59:59Z"
}
```

**Response:**
```json
{
  "id": "new-permission-id",
  "roles": ["read"],
  "link": {
    "type": "view",
    "webUrl": "https://...",
    "scope": "anonymous"
  },
  "expirationDateTime": "2025-12-31T23:59:59Z"
}
```

### Invite Users

**Endpoint:** `POST /drives/{driveId}/items/{itemId}/invite`

**Request Body:**
```json
{
  "recipients": [
    { "email": "user@example.com" }
  ],
  "roles": ["write"],
  "requireSignIn": true,
  "sendInvitation": false,
  "message": "Check out this file"
}
```

### Update Permission

**Endpoint:** `PATCH /drives/{driveId}/items/{itemId}/permissions/{permissionId}`

**Request Body:**
```json
{
  "roles": ["write"]
}
```

### Delete Permission

**Endpoint:** `DELETE /drives/{driveId}/items/{itemId}/permissions/{permissionId}`

## Implementation Steps

### Step 1: Update Permissions Schema

Update `src/services/database.ts`:

```sql
-- Recreate permissions table with full schema
DROP TABLE IF EXISTS permissions;
CREATE TABLE permissions (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL,
  granted_to_user_id TEXT,
  granted_to_user_email TEXT,
  granted_to_user_display_name TEXT,
  granted_to_application_id TEXT,
  granted_to_application_display_name TEXT,
  roles TEXT NOT NULL,  -- JSON array: ["read"], ["write"], ["owner"]
  inherited_from_id TEXT,
  link_type TEXT,  -- 'view', 'edit', 'embed'
  link_scope TEXT,  -- 'anonymous', 'organization', 'users'
  link_web_url TEXT,
  link_prevents_download BOOLEAN DEFAULT FALSE,
  expiration_date_time TEXT,
  has_password BOOLEAN DEFAULT FALSE,
  created_at TEXT NOT NULL,
  FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE,
  FOREIGN KEY (inherited_from_id) REFERENCES items(id)
);

CREATE INDEX idx_permissions_item ON permissions(item_id);
CREATE INDEX idx_permissions_user ON permissions(granted_to_user_email);
```

### Step 2: Create Permission Types

Create `src/types/permission.ts`:

```typescript
export interface Permission {
  id: string;
  roles: ('read' | 'write' | 'owner')[];
  grantedTo?: IdentitySet;
  grantedToV2?: IdentitySet;
  grantedToIdentities?: IdentitySet[];
  inheritedFrom?: ItemReference;
  link?: SharingLink;
  expirationDateTime?: string;
  hasPassword?: boolean;
}

export interface IdentitySet {
  user?: Identity;
  application?: Identity;
  device?: Identity;
}

export interface Identity {
  id?: string;
  displayName?: string;
  email?: string;
}

export interface SharingLink {
  type: 'view' | 'edit' | 'embed';
  scope: 'anonymous' | 'organization' | 'users';
  webUrl: string;
  preventsDownload?: boolean;
}

export interface ItemReference {
  id: string;
  driveId?: string;
  path?: string;
}

export interface CreateLinkRequest {
  type: 'view' | 'edit' | 'embed';
  scope?: 'anonymous' | 'organization' | 'users';
  expirationDateTime?: string;
  password?: string;
  retainInheritedPermissions?: boolean;
}

export interface InviteRequest {
  recipients: { email: string; objectId?: string }[];
  roles: ('read' | 'write')[];
  requireSignIn?: boolean;
  sendInvitation?: boolean;
  message?: string;
  expirationDateTime?: string;
}
```

### Step 3: Create Permissions Service

Create `src/services/permissions.ts`:

```typescript
export class PermissionsService {
  constructor(private db: DatabaseService) {}

  async getPermissions(itemId: string): Promise<Permission[]> {
    // Get direct permissions
    const directPerms = this.db.prepare(`
      SELECT * FROM permissions WHERE item_id = ?
    `).all(itemId);

    // Get inherited permissions (walk up the tree)
    const inheritedPerms = await this.getInheritedPermissions(itemId);

    return [...directPerms, ...inheritedPerms].map(this.formatPermission);
  }

  async getPermission(itemId: string, permissionId: string): Promise<Permission | null> {
    const perm = this.db.prepare(`
      SELECT * FROM permissions WHERE id = ? AND item_id = ?
    `).get(permissionId, itemId);

    if (!perm) {
      // Check inherited
      const inherited = await this.getInheritedPermission(itemId, permissionId);
      return inherited;
    }

    return this.formatPermission(perm);
  }

  async createLink(itemId: string, request: CreateLinkRequest): Promise<Permission> {
    const id = generateId();
    const webUrl = this.generateSharingUrl(itemId, request.type);

    this.db.prepare(`
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
      !!request.password,
      new Date().toISOString()
    );

    return this.getPermission(itemId, id);
  }

  async invite(itemId: string, request: InviteRequest): Promise<Permission[]> {
    const createdPermissions: Permission[] = [];

    for (const recipient of request.recipients) {
      const id = generateId();

      this.db.prepare(`
        INSERT INTO permissions (
          id, item_id, granted_to_user_email, roles,
          expiration_date_time, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        id,
        itemId,
        recipient.email,
        JSON.stringify(request.roles),
        request.expirationDateTime || null,
        new Date().toISOString()
      );

      const perm = await this.getPermission(itemId, id);
      createdPermissions.push(perm);
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

    if (updates.expirationDateTime) {
      setClauses.push('expiration_date_time = ?');
      params.push(updates.expirationDateTime);
    }

    if (setClauses.length > 0) {
      params.push(permissionId, itemId);
      this.db.prepare(`
        UPDATE permissions SET ${setClauses.join(', ')}
        WHERE id = ? AND item_id = ?
      `).run(...params);
    }

    return this.getPermission(itemId, permissionId);
  }

  async deletePermission(itemId: string, permissionId: string): Promise<void> {
    const result = this.db.prepare(`
      DELETE FROM permissions WHERE id = ? AND item_id = ?
    `).run(permissionId, itemId);

    if (result.changes === 0) {
      throw GraphError.notFound('Permission not found');
    }
  }

  private async getInheritedPermissions(itemId: string): Promise<any[]> {
    const item = await this.db.getItem(itemId);
    if (!item || !item.parentId) return [];

    const parentPerms = this.db.prepare(`
      SELECT p.*, i.path as inherited_path
      FROM permissions p
      JOIN items i ON p.item_id = i.id
      WHERE p.item_id = ?
    `).all(item.parentId);

    // Mark as inherited
    const marked = parentPerms.map(p => ({
      ...p,
      inherited_from_id: item.parentId
    }));

    // Recurse up
    const ancestorPerms = await this.getInheritedPermissions(item.parentId);

    return [...marked, ...ancestorPerms];
  }

  private generateSharingUrl(itemId: string, type: string): string {
    const token = Buffer.from(`${itemId}:${type}:${Date.now()}`).toString('base64url');
    return `https://mock-sharepoint.local/share/${token}`;
  }

  private formatPermission(dbRow: any): Permission {
    const perm: Permission = {
      id: dbRow.id,
      roles: JSON.parse(dbRow.roles)
    };

    if (dbRow.granted_to_user_email) {
      perm.grantedTo = {
        user: {
          id: dbRow.granted_to_user_id,
          email: dbRow.granted_to_user_email,
          displayName: dbRow.granted_to_user_display_name
        }
      };
    }

    if (dbRow.link_type) {
      perm.link = {
        type: dbRow.link_type,
        scope: dbRow.link_scope,
        webUrl: dbRow.link_web_url,
        preventsDownload: dbRow.link_prevents_download
      };
    }

    if (dbRow.inherited_from_id) {
      perm.inheritedFrom = {
        id: dbRow.inherited_from_id,
        path: dbRow.inherited_path
      };
    }

    if (dbRow.expiration_date_time) {
      perm.expirationDateTime = dbRow.expiration_date_time;
    }

    if (dbRow.has_password) {
      perm.hasPassword = true;
    }

    return perm;
  }
}
```

### Step 4: Add Permission Routes

Add to `src/routes/drives.ts`:

```typescript
const permissionsService = new PermissionsService(db);

// GET /drives/:driveId/items/:itemId/permissions
router.get('/:driveId/items/:itemId/permissions', async (req, res) => {
  const { itemId } = req.params;

  const item = await db.getItem(itemId);
  if (!item) {
    throw GraphError.notFound('Item not found');
  }

  const permissions = await permissionsService.getPermissions(itemId);

  res.json(formatODataResponse(permissions, req));
});

// GET /drives/:driveId/items/:itemId/permissions/:permissionId
router.get('/:driveId/items/:itemId/permissions/:permissionId', async (req, res) => {
  const { itemId, permissionId } = req.params;

  const permission = await permissionsService.getPermission(itemId, permissionId);
  if (!permission) {
    throw GraphError.notFound('Permission not found');
  }

  res.json(permission);
});

// POST /drives/:driveId/items/:itemId/createLink
router.post('/:driveId/items/:itemId/createLink', async (req, res) => {
  const { itemId } = req.params;
  const { type, scope, expirationDateTime, password } = req.body;

  if (!type) {
    throw GraphError.badRequest('type is required');
  }

  const item = await db.getItem(itemId);
  if (!item) {
    throw GraphError.notFound('Item not found');
  }

  const permission = await permissionsService.createLink(itemId, {
    type,
    scope,
    expirationDateTime,
    password
  });

  res.status(201).json(permission);
});

// POST /drives/:driveId/items/:itemId/invite
router.post('/:driveId/items/:itemId/invite', async (req, res) => {
  const { itemId } = req.params;
  const { recipients, roles, requireSignIn, sendInvitation, message } = req.body;

  if (!recipients || !roles) {
    throw GraphError.badRequest('recipients and roles are required');
  }

  const item = await db.getItem(itemId);
  if (!item) {
    throw GraphError.notFound('Item not found');
  }

  const permissions = await permissionsService.invite(itemId, {
    recipients,
    roles,
    requireSignIn,
    sendInvitation,
    message
  });

  res.status(200).json({ value: permissions });
});

// PATCH /drives/:driveId/items/:itemId/permissions/:permissionId
router.patch('/:driveId/items/:itemId/permissions/:permissionId', async (req, res) => {
  const { itemId, permissionId } = req.params;
  const { roles, expirationDateTime } = req.body;

  const permission = await permissionsService.updatePermission(
    itemId,
    permissionId,
    { roles, expirationDateTime }
  );

  res.json(permission);
});

// DELETE /drives/:driveId/items/:itemId/permissions/:permissionId
router.delete('/:driveId/items/:itemId/permissions/:permissionId', async (req, res) => {
  const { itemId, permissionId } = req.params;

  await permissionsService.deletePermission(itemId, permissionId);

  res.status(204).end();
});
```

### Step 5: Add Default Owner Permission

When items are created, add an owner permission:

```typescript
// In database service or filesystem service
async function addOwnerPermission(itemId: string, owner: Identity): Promise<void> {
  const permId = generateId();
  db.prepare(`
    INSERT INTO permissions (
      id, item_id, granted_to_user_id, granted_to_user_email,
      granted_to_user_display_name, roles, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    permId,
    itemId,
    owner.id,
    owner.email,
    owner.displayName,
    JSON.stringify(['owner']),
    new Date().toISOString()
  );
}
```

## Test Cases

```typescript
describe('Permissions API', () => {
  describe('GET /drives/{id}/items/{id}/permissions', () => {
    test('returns permissions for item', async () => {
      const response = await request(app)
        .get(`/v1.0/drives/${driveId}/items/${itemId}/permissions`);

      expect(response.status).toBe(200);
      expect(response.body.value).toBeInstanceOf(Array);
    });

    test('includes inherited permissions', async () => {
      // Set permission on parent, check child shows inherited
      await createPermission(parentId, { email: 'user@test.com', roles: ['read'] });

      const response = await request(app)
        .get(`/v1.0/drives/${driveId}/items/${childId}/permissions`);

      const inherited = response.body.value.find(p => p.inheritedFrom);
      expect(inherited).toBeDefined();
      expect(inherited.inheritedFrom.id).toBe(parentId);
    });
  });

  describe('POST /drives/{id}/items/{id}/createLink', () => {
    test('creates anonymous view link', async () => {
      const response = await request(app)
        .post(`/v1.0/drives/${driveId}/items/${itemId}/createLink`)
        .send({ type: 'view', scope: 'anonymous' });

      expect(response.status).toBe(201);
      expect(response.body.link.type).toBe('view');
      expect(response.body.link.webUrl).toBeDefined();
    });

    test('creates edit link with expiration', async () => {
      const response = await request(app)
        .post(`/v1.0/drives/${driveId}/items/${itemId}/createLink`)
        .send({
          type: 'edit',
          expirationDateTime: '2025-12-31T23:59:59Z'
        });

      expect(response.body.expirationDateTime).toBeDefined();
    });
  });

  describe('POST /drives/{id}/items/{id}/invite', () => {
    test('invites user with read access', async () => {
      const response = await request(app)
        .post(`/v1.0/drives/${driveId}/items/${itemId}/invite`)
        .send({
          recipients: [{ email: 'guest@example.com' }],
          roles: ['read']
        });

      expect(response.status).toBe(200);
      expect(response.body.value[0].grantedTo.user.email).toBe('guest@example.com');
    });
  });

  describe('PATCH /drives/{id}/items/{id}/permissions/{id}', () => {
    test('updates permission roles', async () => {
      const response = await request(app)
        .patch(`/v1.0/drives/${driveId}/items/${itemId}/permissions/${permId}`)
        .send({ roles: ['write'] });

      expect(response.status).toBe(200);
      expect(response.body.roles).toContain('write');
    });
  });

  describe('DELETE /drives/{id}/items/{id}/permissions/{id}', () => {
    test('removes permission', async () => {
      const response = await request(app)
        .delete(`/v1.0/drives/${driveId}/items/${itemId}/permissions/${permId}`);

      expect(response.status).toBe(204);

      // Verify deleted
      const check = await request(app)
        .get(`/v1.0/drives/${driveId}/items/${itemId}/permissions/${permId}`);
      expect(check.status).toBe(404);
    });
  });
});
```

## Files to Create/Modify

| File | Action |
|------|--------|
| `src/types/permission.ts` | Create - Permission types |
| `src/services/permissions.ts` | Create - Permissions service |
| `src/services/database.ts` | Modify - Update permissions schema |
| `src/routes/drives.ts` | Modify - Add permission endpoints |
| `tests/routes/permissions.test.ts` | Create - Permission tests |

## Limitations

- No actual access enforcement (permissions are informational)
- Simplified inheritance model
- No group permissions (only users)
- No external/guest user differentiation
- Sharing links don't actually work for access

## Success Criteria

1. List permissions returns direct and inherited permissions
2. Create sharing link generates working response
3. Invite creates user permissions
4. Update modifies roles
5. Delete removes permission
6. Inherited permissions show inheritedFrom reference
