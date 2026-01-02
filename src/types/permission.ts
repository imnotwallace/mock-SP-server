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
