// Подключение приложения к PostgreSQL из контейнера (psycopg, Django): по имени сервиса,
// IP или localhost — как в настоящей сети Docker. Ошибки — тексты libpq/psycopg:
// «connection to server at "127.0.0.1", port 5432 failed: Connection refused».
// Миграции Django создают настоящие таблицы (журнал SQL тома — его читает psql на PGlite).

import { now } from '../linux/clock.js';
import { dockerState } from './state.js';
import { resolve } from './dns.js';
import { forgetVolume } from './psql.js';

const PG_DATA = '/var/lib/postgresql/data';
const HINT = '\tIs the server running on that host and accepting TCP/IP connections?';

/**
 * Подключиться: {ok, container, cluster, db} или {error: текст после «OperationalError: »}.
 * params: {host, port, user, password, dbname}.
 */
export function dbConnect(hostFs, self, params) {
  const state = dockerState(hostFs);
  const host = params.host || 'localhost';
  const port = Number(params.port || 5432);
  const found = resolve(state, self, host);
  if (!found) {
    return { error: `connection failed: could not translate host name "${host}" to address: Temporary failure in name resolution` };
  }
  const ip = found.self ? '127.0.0.1' : found.ip;
  const target = found.container;
  const refused = { error: `connection failed: connection to server at "${ip}", port ${port} failed: Connection refused\n${HINT}` };
  if (target.status !== 'running' || target.procs[0]?.comm !== 'postgres' || !(target.listen ?? []).includes(port)) return refused;
  // база ещё инициализируется (compose up без healthcheck: web стартовал раньше готовности)
  if ((target.readyAt ?? 0) > now()) return refused;
  const mount = target.mounts.find((item) => item.destination === PG_DATA && item.type === 'volume');
  const volume = mount && state.volumes[mount.name];
  const cluster = volume?.pg;
  if (!cluster) return refused;
  const user = params.user || 'postgres';
  const fatal = (text) => ({ error: `connection failed: connection to server at "${ip}", port ${port} failed: FATAL:  ${text}` });
  const password = target.env.find((item) => item.startsWith('POSTGRES_PASSWORD='))?.slice(18);
  const trust = target.env.includes('POSTGRES_HOST_AUTH_METHOD=trust');
  if (!found.self && !trust && password !== undefined && params.password !== password) {
    return fatal(`password authentication failed for user "${user}"`);
  }
  if (!cluster.roles.includes(user)) return fatal(`role "${user}" does not exist`);
  const db = params.dbname || user;
  if (!cluster.databases[db]) return fatal(`database "${db}" does not exist`);
  return { ok: true, container: target, cluster, volume, db };
}

// --- настройки базы приложения ---

const ENV_KEYS = {
  host: ['DB_HOST', 'POSTGRES_HOST', 'DATABASE_HOST', 'PGHOST'],
  port: ['DB_PORT', 'POSTGRES_PORT', 'PGPORT'],
  user: ['DB_USER', 'POSTGRES_USER', 'PGUSER'],
  password: ['DB_PASSWORD', 'POSTGRES_PASSWORD', 'PGPASSWORD'],
  dbname: ['DB_NAME', 'POSTGRES_DB', 'PGDATABASE'],
};

/** Значение из кода: "x", os.environ["X"], os.environ.get("X", "d"), os.getenv("X", "d"). */
function codeValue(expr, env) {
  const literal = /^\s*["']([^"']*)["']\s*$/.exec(expr ?? '');
  if (literal) return literal[1];
  const fromEnv = /os\.(?:environ\.get|getenv)\(\s*["'](\w+)["'](?:\s*,\s*["']([^"']*)["'])?\s*\)|os\.environ\[\s*["'](\w+)["']\s*\]/.exec(expr ?? '');
  if (!fromEnv) return undefined;
  const name = fromEnv[1] ?? fromEnv[3];
  return env[name] ?? fromEnv[2] ?? (fromEnv[3] ? { missing: name } : '');
}

/** Параметры подключения из кода: DATABASES Django или psycopg.connect(...) — иначе из окружения. */
export function dbParams(code, env) {
  const params = {};
  const settings = /DATABASES\s*=\s*\{[\s\S]*?\n\}/.exec(code)?.[0];
  if (settings) {
    if (/sqlite3/.test(settings)) return { sqlite: true };
    for (const [key, name] of [['HOST', 'host'], ['PORT', 'port'], ['USER', 'user'], ['PASSWORD', 'password'], ['NAME', 'dbname']]) {
      const match = new RegExp(`["']${key}["']\\s*:\\s*(.+?),?\\s*$`, 'm').exec(settings);
      if (match) params[name] = codeValue(match[1], env);
    }
  }
  const connect = /psycopg2?\.connect\(([\s\S]*?)\)\s*(?:\.close\(\))?\s*$/m.exec(code)?.[1];
  if (connect) {
    // f"host={os.environ['DB_HOST']} user=postgres …" или host=..., user=... как аргументы
    const text = connect.replace(/\{([^}]*)\}/g, (_, expr) => {
      const value = codeValue(expr, env);
      return typeof value === 'string' ? value : '';
    });
    for (const [key, name] of [['host', 'host'], ['port', 'port'], ['user', 'user'], ['password', 'password'], ['dbname', 'dbname']]) {
      const pair = new RegExp(`\\b${key}=([^\\s"',)]+)`).exec(text);
      if (pair) params[name] = pair[1];
      const kw = new RegExp(`\\b${key}\\s*=\\s*([^,)]+)`).exec(connect);
      if (!pair && kw) {
        const value = codeValue(kw[1], env);
        if (typeof value === 'string') params[name] = value;
      }
    }
  }
  for (const [name, keys] of Object.entries(ENV_KEYS)) {
    if (params[name] === undefined) params[name] = keys.map((key) => env[key]).find((value) => value !== undefined);
  }
  return params;
}

// --- миграции Django ---

const MIGRATIONS = [
  ['contenttypes', '0001_initial'], ['auth', '0001_initial'], ['admin', '0001_initial'], ['admin', '0002_logentry_remove_auto_add'],
  ['admin', '0003_logentry_add_action_flag_choices'], ['contenttypes', '0002_remove_content_type_name'],
  ['auth', '0002_alter_permission_name_max_length'], ['auth', '0003_alter_user_email_max_length'],
  ['auth', '0004_alter_user_username_opts'], ['auth', '0005_alter_user_last_login_null'], ['auth', '0006_require_contenttypes_0002'],
  ['auth', '0007_alter_validators_add_error_messages'], ['auth', '0008_alter_user_username_max_length'],
  ['auth', '0009_alter_user_last_name_max_length'], ['auth', '0010_alter_group_name_max_length'],
  ['auth', '0011_update_proxy_permissions'], ['auth', '0012_alter_user_first_name_max_length'], ['sessions', '0001_initial'],
];

const TABLES = [
  'CREATE TABLE django_migrations (id bigserial PRIMARY KEY, app varchar(255) NOT NULL, name varchar(255) NOT NULL, applied timestamptz NOT NULL)',
  'CREATE TABLE django_content_type (id serial PRIMARY KEY, app_label varchar(100) NOT NULL, model varchar(100) NOT NULL)',
  'CREATE TABLE auth_permission (id serial PRIMARY KEY, name varchar(255) NOT NULL, content_type_id integer NOT NULL, codename varchar(100) NOT NULL)',
  'CREATE TABLE auth_group (id serial PRIMARY KEY, name varchar(150) NOT NULL UNIQUE)',
  'CREATE TABLE auth_group_permissions (id bigserial PRIMARY KEY, group_id integer NOT NULL, permission_id integer NOT NULL)',
  'CREATE TABLE auth_user (id serial PRIMARY KEY, password varchar(128) NOT NULL, last_login timestamptz NULL, is_superuser boolean NOT NULL, username varchar(150) NOT NULL UNIQUE, first_name varchar(150) NOT NULL, last_name varchar(150) NOT NULL, email varchar(254) NOT NULL, is_staff boolean NOT NULL, is_active boolean NOT NULL, date_joined timestamptz NOT NULL)',
  'CREATE TABLE auth_user_groups (id bigserial PRIMARY KEY, user_id integer NOT NULL, group_id integer NOT NULL)',
  'CREATE TABLE auth_user_user_permissions (id bigserial PRIMARY KEY, user_id integer NOT NULL, permission_id integer NOT NULL)',
  'CREATE TABLE django_admin_log (id serial PRIMARY KEY, action_time timestamptz NOT NULL, object_id text NULL, object_repr varchar(200) NOT NULL, action_flag smallint NOT NULL, change_message text NOT NULL, content_type_id integer NULL, user_id integer NOT NULL)',
  'CREATE TABLE django_session (session_key varchar(40) PRIMARY KEY, session_data text NOT NULL, expire_date timestamptz NOT NULL)',
];

/** manage.py migrate: таблицы Django в базе (через журнал тома) → строки вывода. */
export function migrate(connection) {
  const { cluster, volume, db } = connection;
  cluster.django ??= {};
  const lines = ['Operations to perform:', '  Apply all migrations: admin, auth, contenttypes, sessions', 'Running migrations:'];
  if (cluster.django[db]) {
    lines.push('  No migrations to apply.');
    return lines;
  }
  const sql = (cluster.sql[db] ??= []);
  sql.push(...TABLES);
  sql.push(`INSERT INTO django_migrations (app, name, applied) VALUES ${MIGRATIONS.map(([app, name]) => `('${app}', '${name}', now())`).join(', ')}`);
  cluster.django[db] = true;
  forgetVolume(volume.name);     // PGlite этой базы пересоздастся и проиграет журнал с таблицами
  for (const [app, name] of MIGRATIONS) lines.push(`  Applying ${app}.${name}... OK`);
  return lines;
}

/** Таблицы Django уже созданы в этой базе. */
export const migrated = (connection) => Boolean(connection.cluster.django?.[connection.db]);
