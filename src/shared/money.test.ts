import { describe, it, expect } from 'vitest';
import { add, subtract, isEqual, Money } from './money.js'

describe('Money', () => {
    it('Add money Throw',  () => {
        const a : Money = {
            amountMinor : 10n,
            currency : 'INR'
        }
        const b : Money =  {
            amountMinor : 20n,
            currency : 'USD'
        }
        expect(() => add(a,b)).toThrow()
    });

    it('Add money pass',  () => {
        const a : Money = {
            amountMinor : 10n,
            currency : 'INR'
        }
        const b : Money =  {
            amountMinor : 20n,
            currency : 'INR'
        }
        expect(add(a, b)).toEqual({
            amountMinor: 30n,
            currency: 'INR'
        });
    });

    it('adds beyond Number.MAX_SAFE_INTEGER exactly',  () => {
        const a : Money = {
            amountMinor : 9007199254740992n,
            currency : 'INR'
        }
        const b : Money =  {
            amountMinor : 1n,
            currency : 'INR'
        }
        expect(add(a, b)).toEqual({
            amountMinor: 9007199254740993n,
            currency: 'INR'
        });
    });



    it('subtract money pass',  () => {
        const a : Money = {
            amountMinor : 10n,
            currency : 'INR'
        }
        const b : Money =  {
            amountMinor : 20n,
            currency : 'INR'
        }
        expect(subtract(a, b)).toEqual({
            amountMinor: -10n,
            currency: 'INR'
        });
    });

    it('subtract money Throw',  () => {
        const a : Money = {
            amountMinor : 10n,
            currency : 'INR'
        }
        const b : Money =  {
            amountMinor : 20n,
            currency : 'USD'
        }
        expect(() => subtract(a,b)).toThrow()
    });

    it('subtract bigint money pass',  () => {
        const a : Money = {
            amountMinor : 100n,
            currency : 'INR'
        }
        const b : Money =  {
            amountMinor : 30n,
            currency : 'INR'
        }
        expect(subtract(a, b)).toEqual({
            amountMinor: 70n,
            currency: 'INR'
        });
    });

    it('isEqual returns true for same amount and currency', () => {
        const a: Money = { amountMinor: 10n, currency: 'INR' };
        const b: Money = { amountMinor: 10n, currency: 'INR' };
        expect(isEqual(a, b)).toBe(true);
    });

    it('isEqual returns false for different amounts', () => {
        const a: Money = { amountMinor: 10n, currency: 'INR' };
        const b: Money = { amountMinor: 20n, currency: 'INR' };
        expect(isEqual(a, b)).toBe(false);
    });

    it('isEqual returns false for same amount in different currencies', () => {
        const a: Money = { amountMinor: 10n, currency: 'INR' };
        const b: Money = { amountMinor: 10n, currency: 'USD' };
        expect(isEqual(a, b)).toBe(false);
    });


})