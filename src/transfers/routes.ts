import {
  createTransfer,
  getTransfer,
  AccountNotFoundError,
  CurrencyMismatchError,
  InsufficientFundsError,
} from './transfers.js';

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
      try {
        const result = await createTransfer({
          fromAccountId: request.body.fromAccountId,
          toAccountId: request.body.toAccountId,
          amountMinor: BigInt(request.body.amountMinor),
        });

        return reply.status(201).send({
          transferId: result.transferId,
          ledgerTransactionId: result.ledgerTransactionId,
          status: 'COMPLETED',
        });
      } catch (error) {
        if (error instanceof InsufficientFundsError) {
          return reply.status(422).send({ error: error.message });
        }
        if (error instanceof CurrencyMismatchError) {
          return reply.status(422).send({ error: error.message });
        }
        if (error instanceof AccountNotFoundError) {
          return reply.status(404).send({ error: error.message });
        }
        if ((error as any).code === '23514') {
          return reply.status(422).send({ error: 'Invalid transfer parameters' });
        }
        throw error;
      }
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
