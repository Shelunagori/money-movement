import { FastifyInstance } from 'fastify';
import { pool } from '../shared/db.js';
import { getBalance } from './ledger.js';

const MAX_LIMIT = 100;

export async function registerLedgerRoutes(app: any): Promise<void> {
  app.get(
    '/accounts/:id/balance',
    {
      schema: {
        params: {
          type: 'object',
          properties: {
            id: { type: 'string' },
          },
          required: ['id'],
        },
      },
    },
    async (request: any, reply: any) => {
      const { id: accountId } = request.params;

      // Verify account exists
      const accountRes = await pool.query(
        'SELECT id, currency FROM ledger_accounts WHERE id = $1',
        [accountId]
      );

      if (accountRes.rows.length === 0) {
        return reply.status(404).send({
          error: 'Account not found',
        });
      }

      const account = accountRes.rows[0];
      const balance = await getBalance(accountId);

      return {
        accountId,
        currency: account.currency,
        balanceMinor: balance.toString(),
      };
    }
  );

  app.get(
    '/accounts/:id/ledger',
    {
      schema: {
        params: {
          type: 'object',
          properties: {
            id: { type: 'string' },
          },
          required: ['id'],
        },
        querystring: {
          type: 'object',
          properties: {
            limit: { type: 'string' },
            cursor: { type: 'string' },
          },
        },
      },
    },
    async (request: any, reply: any) => {
      const { id: accountId } = request.params;
      const { limit: limitStr = '50', cursor } = request.query;

      // Verify account exists
      const accountRes = await pool.query(
        'SELECT id FROM ledger_accounts WHERE id = $1',
        [accountId]
      );

      if (accountRes.rows.length === 0) {
        return reply.status(404).send({
          error: 'Account not found',
        });
      }

      // Parse and cap limit
      let limit = Math.min(parseInt(limitStr, 10) || 50, MAX_LIMIT);
      if (limit < 1) limit = 1;

      // Parse cursor as offset (number of entries to skip)
      let offset = 0;
      if (cursor) {
        const cursorNum = parseInt(cursor, 10);
        if (!isNaN(cursorNum) && cursorNum >= 0) {
          offset = cursorNum;
        }
      }

      // Fetch limit + 1 to detect if there are more rows
      const entriesRes = await pool.query(
        `SELECT id, ledger_transaction_id, direction, amount, created_at
         FROM ledger_entries
         WHERE ledger_account_id = $1
         ORDER BY created_at DESC, id DESC
         LIMIT $2 OFFSET $3`,
        [accountId, limit + 1, offset]
      );

      const entries = entriesRes.rows.slice(0, limit);
      const hasMore = entriesRes.rows.length > limit;

      return {
        entries: entries.map((entry) => ({
          id: entry.id,
          ledgerTransactionId: entry.ledger_transaction_id,
          direction: entry.direction,
          amountMinor: entry.amount.toString(),
          createdAt: entry.created_at,
        })),
        nextCursor: hasMore ? (offset + limit).toString() : null,
      };
    }
  );
}
