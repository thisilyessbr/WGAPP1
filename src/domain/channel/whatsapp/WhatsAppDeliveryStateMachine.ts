/**
 * Authoritative WhatsApp Outbound Delivery State Machine.
 *
 * Implements strict monotonic progression and explicit transition validation:
 * PENDING (0) -> SENT (1) -> DELIVERED (2) -> READ (3)
 *
 * CRITICAL INVARIANT (User Directive 1):
 * Transition to FAILED is permitted ONLY from PENDING or SENT.
 * DELIVERED or READ must NEVER later become FAILED under any circumstance.
 */

export type DeliveryStatus = 'PENDING' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';

export const DELIVERY_STATUS_RANK: Readonly<Record<DeliveryStatus, number>> = {
  PENDING: 0,
  SENT: 1,
  DELIVERED: 2,
  READ: 3,
  FAILED: -1
};

/**
 * Explicit state transition table.
 * Every valid (current -> target) pair is declared here.
 * Any transition not in this set is strictly prohibited.
 */
export const ALLOWED_DELIVERY_TRANSITIONS: Readonly<Record<DeliveryStatus, ReadonlySet<DeliveryStatus>>> = {
  // PENDING can advance to SENT, fast-forward to DELIVERED / READ, or transition to FAILED
  PENDING: new Set<DeliveryStatus>(['SENT', 'DELIVERED', 'READ', 'FAILED']),

  // SENT can advance to DELIVERED, fast-forward to READ, or transition to FAILED
  SENT: new Set<DeliveryStatus>(['DELIVERED', 'READ', 'FAILED']),

  // DELIVERED can ONLY advance to READ.
  // CRITICAL: DELIVERED must NEVER become FAILED, SENT, or PENDING!
  DELIVERED: new Set<DeliveryStatus>(['READ']),

  // READ is terminal success. No further state transitions are permitted.
  READ: new Set<DeliveryStatus>([]),

  // FAILED is terminal failure. No further state transitions are permitted.
  FAILED: new Set<DeliveryStatus>([])
};

/**
 * Validates whether a state transition from `currentStatus` to `targetStatus` is permitted.
 */
export function canTransitionDeliveryStatus(
  currentStatus: DeliveryStatus | string | null | undefined,
  targetStatus: DeliveryStatus | string | null | undefined
): boolean {
  const current: DeliveryStatus = (currentStatus as DeliveryStatus) || 'PENDING';
  const target: DeliveryStatus = (targetStatus as DeliveryStatus);

  if (!target) return false;
  if (current === target) return false;

  const allowedTargets = ALLOWED_DELIVERY_TRANSITIONS[current];
  if (!allowedTargets) return false;

  return allowedTargets.has(target);
}

/**
 * Normalizes raw Meta webhook status strings ('sent', 'delivered', 'read', 'failed')
 * into authoritative DeliveryStatus enum.
 */
export function normalizeProviderStatus(providerStatus: string | null | undefined): DeliveryStatus | null {
  if (!providerStatus || typeof providerStatus !== 'string') return null;

  switch (providerStatus.trim().toLowerCase()) {
    case 'sent':
      return 'SENT';
    case 'delivered':
      return 'DELIVERED';
    case 'read':
      return 'READ';
    case 'failed':
      return 'FAILED';
    default:
      return null;
  }
}
