#!/bin/sh
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --set=app_password="$APP_DATABASE_PASSWORD" --set=discovery_password="$DISCOVERY_DATABASE_PASSWORD" <<'SQL'
CREATE EXTENSION IF NOT EXISTS vector;
CREATE ROLE todo_app LOGIN PASSWORD :'app_password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
CREATE ROLE todo_discovery LOGIN PASSWORD :'discovery_password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
GRANT USAGE ON SCHEMA public TO todo_app, todo_discovery;
SELECT format('GRANT CONNECT ON DATABASE %I TO todo_app, todo_discovery', current_database()) \gexec
ALTER DEFAULT PRIVILEGES FOR ROLE todo_owner IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO todo_app;
SQL
