-- Runs once as the PostgreSQL bootstrap superuser. Secret values never appear
-- in this file, command arguments, or successful SQL output.
DO $$ BEGIN
  EXECUTE format('CREATE ROLE mansora_migration LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS PASSWORD %L', btrim(pg_read_file('/run/secrets/migration_password'), chr(13) || chr(10)));
  EXECUTE format('CREATE ROLE mansora_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS PASSWORD %L', btrim(pg_read_file('/run/secrets/runtime_password'), chr(13) || chr(10)));
END $$;
CREATE ROLE mansora_platform NOLOGIN;
CREATE ROLE mansora_tenant NOLOGIN;
GRANT mansora_platform, mansora_tenant TO mansora_migration WITH ADMIN OPTION;
GRANT mansora_platform, mansora_tenant TO mansora_runtime;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
ALTER SCHEMA public OWNER TO mansora_migration;
GRANT USAGE ON SCHEMA public TO mansora_runtime, mansora_platform, mansora_tenant;
REVOKE CONNECT ON DATABASE mansora FROM PUBLIC;
GRANT CONNECT ON DATABASE mansora TO mansora_migration, mansora_runtime;
