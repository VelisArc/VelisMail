export type ProviderOption = {
  id: string;
  label: string;
  description: string;
  placeholder: string;
};

export const DATABASE_PROVIDERS: ProviderOption[] = [
  {
    id: 'neon',
    label: 'Neon',
    description: 'Serverless Postgres with autoscaling branches.',
    placeholder: 'postgresql://user:password@ep-example.ap-south-1.aws.neon.tech/neondb?sslmode=require',
  },
  {
    id: 'postgresql',
    label: 'PostgreSQL',
    description: 'Self-hosted Postgres or managed clusters.',
    placeholder: 'postgresql://user:password@host:5432/database',
  },
  {
    id: 'supabase',
    label: 'Supabase',
    description: 'Managed Postgres with auth, storage, and edge tooling.',
    placeholder: 'postgresql://postgres:[PASSWORD]@db.project.supabase.co:5432/postgres',
  },
  {
    id: 'timescale',
    label: 'Timescale Cloud',
    description: 'Managed Postgres for time-series workloads.',
    placeholder: 'postgresql://user:password@service.region.timescale.com:5432/tsdb?sslmode=require',
  },
  {
    id: 'render_postgres',
    label: 'Render Postgres',
    description: 'Managed PostgreSQL from Render.',
    placeholder: 'postgresql://user:password@dpg-xxxx-a.oregon-postgres.render.com:5432/database',
  },
  {
    id: 'railway_postgres',
    label: 'Railway Postgres',
    description: 'Managed PostgreSQL on Railway.',
    placeholder: 'postgresql://postgres:password@containers-us-west-xx.railway.app:5432/railway',
  },
  {
    id: 'aiven_postgres',
    label: 'Aiven PostgreSQL',
    description: 'Managed PostgreSQL clusters with TLS.',
    placeholder: 'postgresql://avnadmin:password@pg-project.aivencloud.com:12345/defaultdb?sslmode=require',
  },
  {
    id: 'crunchy_bridge',
    label: 'Crunchy Bridge',
    description: 'Production-grade managed PostgreSQL by Crunchy Data.',
    placeholder: 'postgresql://user:password@service.db.postgresbridge.com:5432/postgres?sslmode=require',
  },
  {
    id: 'alloydb',
    label: 'Google AlloyDB',
    description: 'Google managed PostgreSQL compatible database.',
    placeholder: 'postgresql://user:password@alloydb-host:5432/postgres?sslmode=require',
  },
  {
    id: 'yugabytedb',
    label: 'YugabyteDB',
    description: 'Distributed SQL with PostgreSQL compatibility.',
    placeholder: 'postgresql://user:password@node.ybcloud.net:5433/yugabyte?sslmode=require',
  },
  {
    id: 'cockroachdb',
    label: 'CockroachDB',
    description: 'Distributed SQL for high availability workloads.',
    placeholder: 'postgresql://user:password@cluster.region.cockroachlabs.cloud:26257/defaultdb?sslmode=verify-full',
  },
  {
    id: 'elephantsql',
    label: 'ElephantSQL',
    description: 'Hosted PostgreSQL for lightweight projects.',
    placeholder: 'postgresql://user:password@rajje.db.elephantsql.com:5432/database',
  },
  {
    id: 'heroku_postgres',
    label: 'Heroku Postgres',
    description: 'Managed PostgreSQL from Heroku.',
    placeholder: 'postgresql://user:password@ec2-xx-xx-xx-xx.compute-1.amazonaws.com:5432/dbname?sslmode=require',
  },
  {
    id: 'amazon_rds',
    label: 'Amazon RDS',
    description: 'AWS managed relational database engines.',
    placeholder: 'postgresql://user:password@instance.region.rds.amazonaws.com:5432/database',
  },
  {
    id: 'azure_postgres',
    label: 'Azure PostgreSQL',
    description: 'Azure Database for PostgreSQL Flexible Server.',
    placeholder: 'postgresql://user:password@server.postgres.database.azure.com:5432/postgres?sslmode=require',
  },
  {
    id: 'google_cloud_sql',
    label: 'Google Cloud SQL',
    description: 'Managed PostgreSQL or MySQL on GCP.',
    placeholder: 'postgresql://user:password@host:5432/database?sslmode=require',
  },
  {
    id: 'azure_sql',
    label: 'Azure SQL',
    description: 'Microsoft managed SQL Server platform.',
    placeholder: 'sqlserver://user:password@server.database.windows.net:1433/database',
  },
  {
    id: 'mysql',
    label: 'MySQL',
    description: 'Classic MySQL or MariaDB deployments.',
    placeholder: 'mysql://user:password@host:3306/database',
  },
  {
    id: 'planetscale',
    label: 'PlanetScale',
    description: 'Serverless MySQL compatible branch workflows.',
    placeholder: 'mysql://user:password@aws.connect.psdb.cloud/database?sslaccept=strict',
  },
  {
    id: 'singlestore',
    label: 'SingleStore',
    description: 'Distributed MySQL-compatible cloud database.',
    placeholder: 'mysql://user:password@svc.singlestore.com:3333/database',
  },
  {
    id: 'tidb_cloud',
    label: 'TiDB Cloud',
    description: 'Distributed MySQL-compatible HTAP database.',
    placeholder: 'mysql://user:password@gateway01.region.prod.aws.tidbcloud.com:4000/test',
  },
  {
    id: 'mysql_heatwave',
    label: 'MySQL HeatWave',
    description: 'Oracle managed MySQL service.',
    placeholder: 'mysql://user:password@host:3306/database?ssl-mode=REQUIRED',
  },
  {
    id: 'mariadb_skysql',
    label: 'MariaDB SkySQL',
    description: 'Managed MariaDB cloud database.',
    placeholder: 'mariadb://user:password@host:5001/database?ssl=true',
  },
  {
    id: 'sqlite',
    label: 'SQLite',
    description: 'Single-file embedded database for lightweight setups.',
    placeholder: 'sqlite://./velismail.db',
  },
  {
    id: 'turso',
    label: 'Turso',
    description: 'libSQL edge database powered by SQLite.',
    placeholder: 'libsql://database-name.turso.io?authToken=token',
  },
  {
    id: 'mongodb',
    label: 'MongoDB',
    description: 'MongoDB replica sets or standalone clusters.',
    placeholder: 'mongodb://user:password@host:27017/database',
  },
  {
    id: 'mongodb_atlas',
    label: 'MongoDB Atlas',
    description: 'Managed MongoDB with SRV connection strings.',
    placeholder: 'mongodb+srv://user:password@cluster.mongodb.net/database',
  },
  {
    id: 'documentdb',
    label: 'Amazon DocumentDB',
    description: 'MongoDB-compatible document database on AWS.',
    placeholder: 'mongodb://user:password@docdb-cluster.amazonaws.com:27017/database?tls=true',
  },
  {
    id: 'redis',
    label: 'Redis',
    description: 'Redis cache or key-value storage nodes.',
    placeholder: 'redis://default:password@host:6379',
  },
  {
    id: 'redis_cloud',
    label: 'Redis Cloud',
    description: 'Managed Redis instances with TLS support.',
    placeholder: 'rediss://default:password@redis-host:6380',
  },
  {
    id: 'upstash_redis',
    label: 'Upstash Redis',
    description: 'Serverless Redis with TLS URLs.',
    placeholder: 'rediss://default:password@region-name.upstash.io:6379',
  },
  {
    id: 'valkey_cloud',
    label: 'Valkey Cloud',
    description: 'Managed Valkey-compatible in-memory datastore.',
    placeholder: 'rediss://default:password@host:6379',
  },
  {
    id: 'keydb',
    label: 'KeyDB',
    description: 'Redis protocol-compatible high-performance store.',
    placeholder: 'redis://default:password@host:6379',
  },
  {
    id: 'clickhouse',
    label: 'ClickHouse',
    description: 'Analytical OLAP engine for reporting workloads.',
    placeholder: 'clickhouse://user:password@host:8443/default',
  },
  {
    id: 'others',
    label: 'Others (Custom Driver)',
    description: 'Any driver with a standards-compliant connection URI.',
    placeholder: 'custom://user:password@host:port/database',
  },
];

export const MAIL_PROVIDERS: ProviderOption[] = [
  {
    id: 'resend',
    label: 'Resend',
    description: 'Direct API delivery through Resend.',
    placeholder: 're_xxxxx',
  },
  {
    id: 'sendgrid',
    label: 'SendGrid',
    description: 'Direct API delivery through SendGrid.',
    placeholder: 'SG.xxxxx',
  },
  {
    id: 'postmark',
    label: 'Postmark',
    description: 'Direct API delivery through Postmark.',
    placeholder: 'postmark-server-token',
  },
  {
    id: 'brevo',
    label: 'Brevo',
    description: 'Direct API delivery through Brevo.',
    placeholder: 'xkeysib-xxxxxxxx',
  },
  {
    id: 'custom_webhook',
    label: 'Custom Webhook',
    description: 'Your own HTTP delivery endpoint with bearer auth.',
    placeholder: 'custom-provider-secret',
  },
  {
    id: 'amazonses',
    label: 'Amazon SES',
    description: 'Amazon Simple Email Service (SES) API delivery.',
    placeholder: 'AKIA...:SecretKey:Region',
  },
];

const ALLOWED_DB_SCHEMES = [
  'postgresql://',
  'postgres://',
  'mysql://',
  'mysql2://',
  'mariadb://',
  'sqlite://',
  'mongodb://',
  'mongodb+srv://',
  'redis://',
  'rediss://',
  'libsql://',
  'sqlserver://',
  'mssql://',
  'clickhouse://',
  'custom://',
];

export function isValidDatabaseUrl(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return ALLOWED_DB_SCHEMES.some((scheme) => normalized.startsWith(scheme));
}

export function getDatabaseProvider(id: string): ProviderOption {
  return DATABASE_PROVIDERS.find((provider) => provider.id === id) ?? DATABASE_PROVIDERS[0];
}

export function getMailProvider(id: string): ProviderOption {
  return MAIL_PROVIDERS.find((provider) => provider.id === id) ?? MAIL_PROVIDERS[0];
}

export function requiresCustomMailEndpoint(providerId: string): boolean {
  return providerId === 'custom_webhook';
}

export function inferMailProviderFromApiKey(value: string): string | null {
  const key = value.trim();
  if (!key) return null;
  if (key.startsWith('SG.')) return 'sendgrid';
  if (key.startsWith('re_')) return 'resend';
  if (key.startsWith('xkeysib-')) return 'brevo';
  if (key.startsWith('xsmtpsib-')) return 'brevo_smtp';
  return null;
}

export function getMailProviderKeyMismatch(providerId: string, apiKey: string): string | null {
  const inferredProvider = inferMailProviderFromApiKey(apiKey);
  if (!inferredProvider) return null;

  if (inferredProvider === 'brevo_smtp') {
    return 'This looks like a Brevo SMTP key. OTP uses SMTP keys, but mail setup requires a Brevo API key from Brevo SMTP & API > API keys, usually starting with xkeysib-.';
  }

  if (inferredProvider !== providerId) {
    return `Selected provider is ${getMailProvider(providerId).label}, but this key looks like ${getMailProvider(inferredProvider).label}. Select the matching provider or paste the correct key.`;
  }

  return null;
}

export function getConnectionHostLabel(connectionString: string): string {
  const sanitized = connectionString.trim();
  if (!sanitized) {
    return 'Not configured';
  }

  const withoutScheme = sanitized.replace(/^[a-z0-9+]+:\/\//i, '');
  if (withoutScheme.startsWith('./') || withoutScheme.startsWith('/')) {
    return withoutScheme;
  }

  const withoutCreds = withoutScheme.includes('@')
    ? withoutScheme.split('@').pop() ?? withoutScheme
    : withoutScheme;

  return withoutCreds.split('/')[0] || 'Unknown host';
}

export function inferDatabaseProviderFromUrl(connectionString: string): string {
  const normalized = connectionString.trim().toLowerCase();

  if (normalized.startsWith('mongodb+srv://')) return 'mongodb_atlas';
  if (normalized.startsWith('libsql://')) return 'turso';
  if (normalized.startsWith('rediss://')) {
    if (normalized.includes('upstash.io')) return 'upstash_redis';
    return 'redis_cloud';
  }
  if (normalized.includes('supabase.co')) return 'supabase';
  if (normalized.includes('neon.tech')) return 'neon';
  if (normalized.includes('psdb.cloud')) return 'planetscale';
  if (normalized.includes('cockroachlabs.cloud')) return 'cockroachdb';
  if (normalized.includes('.rds.amazonaws.com')) return 'amazon_rds';
  if (normalized.includes('postgres.database.azure.com')) return 'azure_postgres';
  if (normalized.includes('database.windows.net')) {
    if (normalized.startsWith('sqlserver://') || normalized.startsWith('mssql://')) return 'azure_sql';
    return 'azure_postgres';
  }
  if (normalized.includes('aivencloud.com')) return 'aiven_postgres';
  if (normalized.includes('render.com')) return 'render_postgres';
  if (normalized.includes('railway.app')) return 'railway_postgres';
  if (normalized.includes('timescale.com')) return 'timescale';
  if (normalized.includes('tidbcloud.com')) return 'tidb_cloud';
  if (normalized.includes('singlestore.com')) return 'singlestore';
  if (normalized.includes('elephantsql.com')) return 'elephantsql';
  if (normalized.startsWith('sqlserver://') || normalized.startsWith('mssql://')) return 'azure_sql';
  if (normalized.startsWith('clickhouse://')) return 'clickhouse';
  if (normalized.startsWith('mongodb://')) return 'mongodb';
  if (normalized.startsWith('redis://')) return 'redis';
  if (normalized.startsWith('sqlite://')) return 'sqlite';
  if (normalized.startsWith('mysql://') || normalized.startsWith('mysql2://') || normalized.startsWith('mariadb://')) return 'mysql';
  if (normalized.startsWith('postgresql://') || normalized.startsWith('postgres://')) return 'postgresql';
  if (normalized.startsWith('custom://')) return 'others';

  return 'postgresql';
}
