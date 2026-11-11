/** Server-only adapter: the platform issues a tenant-bound owner setup link. */
export interface BrowserWorkspaceInvite {
  tenantId: string; label: string; ownerName: string; ownerEmail: string; activationCode: string; hasActiveDevice?: boolean;
}
export interface BrowserWorkspaceLink {
  workspaceId: string; url: string; status: 'pending' | 'ready'; expiresAt?: string;
}
export interface BrowserWorkspaceProvisioner {
  invite(input: BrowserWorkspaceInvite): Promise<BrowserWorkspaceLink>;
}
