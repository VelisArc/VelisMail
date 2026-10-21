-- Migration 013: Member Manager platform role
--
-- The control plane had no role for staff that manage company members
-- (invitations, mailboxes, group membership) without carrying full platform
-- operations rights. This migration adds that role.
--
-- The role is owner-only: only the account listed in PLATFORM_OWNER_UIDS or
-- PLATFORM_OWNER_EMAILS may hand it out. The gateway hides it from every
-- other staff member and rejects an attempt to grant it.

INSERT INTO platform_roles (key, name, description, permissions)
VALUES (
    'member_manager',
    'Member Manager',
    'Manages company members, mailboxes, groups and invitations. Cannot change plans, billing, configuration or other companies.',
    '["companies.read","users.read","team.read","team.write","audit.read"]'
)
ON CONFLICT (key) DO UPDATE
    SET name = EXCLUDED.name,
        description = EXCLUDED.description,
        permissions = EXCLUDED.permissions;

-- The role is only assignable by the platform owner.
COMMENT ON COLUMN platform_admins.role IS
    'Platform role. The owner, superadmin and member_manager roles can only be granted by the platform owner.';
