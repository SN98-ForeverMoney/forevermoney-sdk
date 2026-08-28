import { describe, expect, it } from 'vitest'
import {
    toEip1193Transaction,
    toEthersTransaction,
    type PreparedTransaction,
} from '../index.js'

const transaction: PreparedTransaction = {
    chainId: 8453,
    from: '0x1111111111111111111111111111111111111111',
    to: '0x2222222222222222222222222222222222222222',
    data: '0x1234',
    value: '16',
    gasLimit: '21000',
}

describe('prepared transaction adapters', () => {
    it('converts JSON-safe quantities for EIP-1193 wallets and ethers', () => {
        expect(toEip1193Transaction(transaction)).toEqual({
            from: transaction.from,
            to: transaction.to,
            data: transaction.data,
            value: '0x10',
            gas: '0x5208',
        })
        expect(toEthersTransaction(transaction)).toMatchObject({
            chainId: 8453,
            to: transaction.to,
            data: transaction.data,
            value: 16n,
            gasLimit: 21_000n,
        })
    })

    it('fails closed on malformed decimal quantities', () => {
        expect(() =>
            toEip1193Transaction({ ...transaction, value: '01' })
        ).toThrow('unsigned decimal integer')
        expect(() =>
            toEthersTransaction({ ...transaction, gasLimit: '-1' })
        ).toThrow('unsigned decimal integer')
    })
})
