import { withTransaction, pool } from '../shared/db.js';
import {
  createTransferOnClient,
  getTransfer,
  AccountNotFoundError,
  CurrencyMismatchError,
  InsufficientFundsError,
} from './transfers.js';
import { hashRequestBody, claimKey, completeKey } from './idempotency.js';

export async function registerTransferRoutes(app: any) {
  const createTransferSchema = {
    body: {
      type: 'object',
      required: ['fromAccountId', 'toAccountId', 'amountMinor'],
      properties: {
        fromAccountId: { type: 'string', format: 'uuid' },
        toAccountId: { type: 'string', format: 'uuid' },
        amountMinor: { type: 'integer', minimum: 1 },
      },
      additionalProperties: false,
    },
  };

  app.post(
    '/transfers',
    { schema: createTransferSchema },
    async (request: any, reply: any) => {
      const idempotencyKey = request.headers['idempotency-key'];
      if (!idempotencyKey) {
        return reply.status(400).send({ error: 'Idempotency-Key header is required' });
      }

      const requestHash = hashRequestBody(JSON.stringify(request.body));
      const claimResult = await claimKey(idempotencyKey, requestHash);

      // Key was claimed successfully, proceed with transfer
      if (claimResult === 'claimed') {
        try {
          const result = await withTransaction(async (client) => {
            const transferResult = await createTransferOnClient(client, {
              fromAccountId: request.body.fromAccountId,
              toAccountId: request.body.toAccountId,
              amountMinor: BigInt(request.body.amountMinor),
            });

            const responseBody = {
              transferId: transferResult.transferId,
              ledgerTransactionId: transferResult.ledgerTransactionId,
              status: 'COMPLETED',
            };

            await completeKey(client, idempotencyKey, 201, responseBody);
            return { status: 201, body: responseBody };
          });

          return reply.status(result.status).send(result.body);
        } catch (error) {
          let status = 500;
          let message = 'Internal server error';

          if (error instanceof InsufficientFundsError) {
            status = 422;
            message = error.message;
          } else if (error instanceof CurrencyMismatchError) {
            status = 422;
            message = error.message;
          } else if (error instanceof AccountNotFoundError) {
            status = 404;
            message = error.message;
          } else if ((error as any).code === '23514') {
            status = 422;
            message = 'Invalid transfer parameters';
          }

          // For business errors (4xx), record the response in idempotency key
          if (status >= 400 && status < 500) {
            await withTransaction(async (client) => {
              const errorResponse = { error: message };
              await completeKey(client, idempotencyKey, status, errorResponse);
            });
            return reply.status(status).send({ error: message });
          }

          // For unexpected errors, delete the claim so retry can re-execute
          await pool.query(`DELETE FROM idempotency_keys WHERE key = $1`, [idempotencyKey]);
          throw error;
        }
      }

      // Key already exists
      const existingRow = claimResult;

      if (existingRow.request_hash !== requestHash) {
        return reply.status(409).send({
          error: 'Idempotency key reused with different request body',
        });
      }

      if (existingRow.status === 'IN_PROGRESS') {
        return reply.status(409).send({
          error: 'Request with this key is still being processed',
        });
      }

      // Status is COMPLETED, replay the response
      return reply
        .header('Idempotency-Replay', 'true')
        .status(existingRow.response_status!)
        .send(existingRow.response_body);
    }
  );

  app.get(
    '/transfers/:id',
    async (request: any, reply: any) => {
      const transfer = await getTransfer(request.params.id);

      if (!transfer) {
        return reply.status(404).send({ error: 'Transfer not found' });
      }

      return reply.send({
        id: transfer.id,
        fromAccountId: transfer.fromAccountId,
        toAccountId: transfer.toAccountId,
        amount: transfer.amount,
        currency: transfer.currency,
        status: transfer.status,
        ledgerTransactionId: transfer.ledgerTransactionId,
        createdAt: transfer.createdAt,
      });
    }
  );
}
