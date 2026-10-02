import type { Reseller, ResellerMember, User } from '../generated/prisma/client';

/** Public JSON shapes. Field names are snake_case and every object says what it is. */
export function presentUser(user: User) {
  return {
    object: 'user' as const,
    id: user.id,
    name: user.name,
    email: user.email,
    email_verified: user.emailVerifiedAt !== null,
    phone: user.phone,
    phone_verified: user.phoneVerifiedAt !== null,
    has_password: user.passwordHash !== null,
    created_at: user.createdAt.toISOString(),
  };
}

export function presentMembership(membership: ResellerMember & { reseller: Reseller }) {
  return {
    object: 'membership' as const,
    role: membership.role,
    reseller: {
      object: 'reseller' as const,
      id: membership.reseller.id,
      name: membership.reseller.name,
      country: membership.reseller.country,
      status: membership.reseller.status,
    },
  };
}
