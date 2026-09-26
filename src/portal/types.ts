export interface PortalDb {
  $queryRaw<T = unknown>(strings: TemplateStringsArray, ...values: any[]): Promise<T>;
  $executeRaw(strings: TemplateStringsArray, ...values: any[]): Promise<number>;
  $transaction<T>(run: (tx: PortalDb) => Promise<T>, options?: any): Promise<T>;
}

export class PortalError extends Error {
  constructor(public status: number, public code: string, message: string = code) { super(message); }
}
export type PortalRole = 'ADMIN' | 'CLIENT';
export interface PortalUser {
  id: string; email: string; name: string; passwordHash: string; role: PortalRole;
  verifiedAt: Date | null; disabled: boolean; createdAt: Date;
}
export interface PortalPrincipal { user: Omit<PortalUser, 'passwordHash'>; sessionId: string; csrf: string; accountId?: string; tenantId?: string; }
export interface PortalPlan {
  id: string; name: string; description: string; price: number; currency: string; published: boolean;
  revision: number; modules: string[]; limits: PlanLimits; template: Record<string, any>;
}
export interface PlanLimits {
  messages: number; llmCalls: number; images: number; embeddings: number; monthlyUsd: number;
  numbers: number; products: number; documents: number; storageMb: number;
}
export const DEFAULT_PLAN_LIMITS: PlanLimits = {
  messages: 1000, llmCalls: 1000, images: 0, embeddings: 2000, monthlyUsd: 5,
  numbers: 1, products: 100, documents: 5, storageMb: 25
};
export interface BusinessData {
  name: string; email: string; phone: string; website: string; description: string;
  address: string; hours: string; currency: string;
  policies: { shipping: string; returns: string; payment: string; privacy: string };
  faqs: { id: string; question: string; answer: string; language: string; category: string }[];
  products: { sku: string; name: string; description: string; price: number; stock: number; category: string;
    variants: { sku: string; size: string; color: string; stock: number; price: number | null }[] }[];
  services: { name: string; description: string; price: string; availability: string }[];
}
export interface PortalProfile {
  accountId: string; tenantId: string; status: string; draft: BusinessData; published: BusinessData | null;
  revision: number; publishedRevision: number; planId: string | null; planSnapshot: PortalPlan | null;
  requestedPlanId: string | null; autoPublish: boolean; reviewNote: string; lockedFields: string[]; editingFrozen: boolean;
  adminConfig: Record<string, any>; createdAt: Date; updatedAt: Date;
}
export const EMPTY_BUSINESS: BusinessData = {
  name: '', email: '', phone: '', website: '', description: '', address: '', hours: '', currency: 'MAD',
  policies: { shipping: '', returns: '', payment: '', privacy: '' }, faqs: [], products: [], services: []
};
