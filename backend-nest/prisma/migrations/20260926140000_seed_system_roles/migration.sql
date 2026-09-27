-- System roles are reference data required by auth (every new user gets USER). Previously they existed only in
-- prisma/seed.ts, so a DB built from migrations alone rejected the first Telegram login (P2025). Idempotent;
-- existing names/descriptions are kept.
INSERT INTO "Role" ("code", "name", "description") VALUES
  ('USER', 'User', 'Standard mobile app user'),
  ('TRAINER', 'Trainer', 'Trainer who assigns programs to users'),
  ('CONTENT_MANAGER', 'Content Manager', 'Content manager with access to content workflows'),
  ('ADMIN', 'Admin', 'Administrative user with system access'),
  ('SUPER_ADMIN', 'Super Admin', 'Full system access with role management'),
  ('SYSTEM', 'System', 'Internal system account for automated operations')
ON CONFLICT ("code") DO NOTHING;
