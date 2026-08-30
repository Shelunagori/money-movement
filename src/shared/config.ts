function requireEnv(name: string): string {
  const value = process.env[name];

  if (value === undefined || value === '') {
    throw new Error(`Missing environment variable: ${name}`);
  }

  return value;
}

function requireIntEnv(name: string): number {
  const raw = requireEnv(name);
  const value = Number(raw);

  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(
      `Environment variable ${name} must be a positive integer, got: ${raw}`
    );
  }

  return value;
}

export const config = {
  databaseUrl: requireEnv('DATABASE_URL'),
  port: requireIntEnv('PORT'),
} as const;