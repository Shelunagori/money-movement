import { describe, it, expect, afterAll } from 'vitest';
import { buildServer } from './server.js';
import { pool } from './shared/db.js';

const app = buildServer();

describe('GET /health', () => {
  it('returns 200 when database is reachable', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('returns 404 for unknown route', async () => {
    const res = await app.inject({ method: 'GET', url: '/nope' });
    expect(res.statusCode).toBe(404);
  });

});

afterAll(async () => {
  await app.close();
  await pool.end();
});