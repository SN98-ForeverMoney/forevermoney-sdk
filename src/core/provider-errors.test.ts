import { describe, expect, it } from 'vitest'
import { ForeverMoneyError } from './errors.js'
import { providerOperation } from './provider-errors.js'

describe('provider error boundary', () => {
    it('maps contract call exceptions to a stable simulation error', async () => {
        await expect(
            providerOperation('Preparing transaction', async () => {
                throw Object.assign(new Error('internal provider message'), {
                    code: 'CALL_EXCEPTION',
                    reason: 'LaneNotAllowed',
                })
            })
        ).rejects.toMatchObject({
            code: 'SIMULATION_REVERTED',
            message: 'Preparing transaction reverted.',
            details: {
                causeCode: 'CALL_EXCEPTION',
                reason: 'LaneNotAllowed',
            },
        })
    })

    it('maps transport failures without leaking provider internals', async () => {
        await expect(
            providerOperation('Reading allowance', async () => {
                throw Object.assign(
                    new Error('https://secret-rpc.example/key'),
                    {
                        code: 'NETWORK_ERROR',
                    }
                )
            })
        ).rejects.toMatchObject({
            code: 'RPC_ERROR',
            message: 'Reading allowance failed.',
            details: { causeCode: 'NETWORK_ERROR' },
        })
    })

    it('preserves validation and chain errors already emitted by the SDK', async () => {
        const error = new ForeverMoneyError('CHAIN_MISMATCH', 'Wrong chain.')
        await expect(
            providerOperation('Reading chain', async () => {
                throw error
            })
        ).rejects.toBe(error)
    })
})
