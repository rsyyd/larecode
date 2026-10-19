import { AuditLog } from './audit.js';

export const PERMISSION_GROUPS = [
  'read',
  'write',
  'shell',
  'network',
  'git',
  'secrets',
  'destructive',
  'external-services',
  'subagent',
  'browser',
  'skills',
] as const;

export type PermissionGroup = (typeof PERMISSION_GROUPS)[number];

export const NEVER_AUTO_APPROVED: readonly PermissionGroup[] = ['destructive', 'secrets'];

export type PermissionMode = 'ask' | 'allow' | 'deny';

export interface PermissionPolicy {
  mode: PermissionMode;
  allowedGroups: PermissionGroup[];
  preAuthorized?: Record<string, PermissionGroup[]>;
}

export interface PermissionCheckContext {
  unattended?: boolean;
  confirmedByUser?: boolean;
  source?: string;
}

export interface PermissionDecision {
  allowed: boolean;
  requiresConfirmation?: boolean;
  reason?: string;
}

export class Permissions {
  private policy: PermissionPolicy;
  private readonly audit: AuditLog;

  constructor(
    policy: PermissionPolicy = { mode: 'ask', allowedGroups: ['read'] },
    audit: AuditLog = new AuditLog()
  ) {
    this.policy = policy;
    this.audit = audit;
  }

  setPolicy(policy: PermissionPolicy): void {
    this.policy = policy;
  }

  getPolicy(): PermissionPolicy {
    return this.policy;
  }

  getAuditLog(): AuditLog {
    return this.audit;
  }

  check(group: PermissionGroup, context: PermissionCheckContext = {}): PermissionDecision {
    const decision = this.evaluate(group, context);
    this.audit.record({
      group,
      allowed: decision.allowed,
      requiresConfirmation: decision.requiresConfirmation ?? false,
      unattended: context.unattended ?? false,
      confirmedByUser: context.confirmedByUser ?? false,
      source: context.source,
      reason: decision.reason,
    });
    return decision;
  }

  private evaluate(group: PermissionGroup, context: PermissionCheckContext): PermissionDecision {
    if (this.policy.mode === 'deny') {
      return { allowed: false, reason: 'permission mode is deny' };
    }

    const unattended = context.unattended ?? false;

    if (NEVER_AUTO_APPROVED.includes(group)) {
      if (unattended) {
        return { allowed: false, reason: `${group} is never pre-authorizable in unattended flows` };
      }
      if (context.confirmedByUser) {
        return { allowed: true };
      }
      return {
        allowed: false,
        requiresConfirmation: true,
        reason: `${group} always requires explicit confirmation`,
      };
    }

    if (unattended) {
      const bundles = Object.values(this.policy.preAuthorized ?? {});
      if (bundles.some((bundle) => bundle.includes(group))) {
        return { allowed: true };
      }
      return { allowed: false, reason: `${group} not pre-authorized for this unattended flow` };
    }

    if (this.policy.mode === 'allow') {
      return { allowed: true };
    }

    if (this.policy.allowedGroups.includes(group)) {
      return { allowed: true };
    }

    return {
      allowed: false,
      requiresConfirmation: true,
      reason: `${group} requires confirmation (mode: ask)`,
    };
  }
}
