export type PermissionGroup =
  | 'read'
  | 'write'
  | 'shell'
  | 'network'
  | 'git'
  | 'secrets'
  | 'destructive'
  | 'external-services'
  | 'subagent'
  | 'browser'
  | 'skills';

export type PermissionMode = 'ask' | 'allow' | 'deny';

export interface PermissionPolicy {
  mode: PermissionMode;
  allowedGroups: PermissionGroup[];
  preAuthorized?: Record<string, PermissionGroup[]>;
}

export interface PermissionDecision {
  allowed: boolean;
  reason?: string;
}

const NEVER_PRE_AUTHORIZED: PermissionGroup[] = ['destructive', 'secrets'];

export class Permissions {
  private policy: PermissionPolicy;

  constructor(policy: PermissionPolicy = { mode: 'ask', allowedGroups: ['read'] }) {
    this.policy = policy;
  }

  setPolicy(policy: PermissionPolicy): void {
    this.policy = policy;
  }

  getPolicy(): PermissionPolicy {
    return this.policy;
  }

  check(group: PermissionGroup, context: { unattended?: boolean } = {}): PermissionDecision {
    if (context.unattended) {
      if (NEVER_PRE_AUTHORIZED.includes(group)) {
        return {
          allowed: false,
          reason: `${group} is never pre-authorizable in unattended flows`,
        };
      }
      const bundles = Object.values(this.policy.preAuthorized ?? {});
      if (bundles.some((bundle) => bundle.includes(group))) {
        return { allowed: true };
      }
      return { allowed: false, reason: `${group} not pre-authorized for this unattended flow` };
    }

    if (this.policy.mode === 'deny') {
      return { allowed: false, reason: 'permission mode is deny' };
    }
    if (this.policy.mode === 'allow') {
      return { allowed: true };
    }
    if (this.policy.allowedGroups.includes(group)) {
      return { allowed: true };
    }
    return { allowed: false, reason: `${group} requires confirmation (mode: ask)` };
  }
}
