import { MaxUint256, type TransactionRequest } from 'ethers'
import { ForeverMoneyError } from './errors.js'
import type { PreparedTransaction } from './plans.js'

export interface Eip1193TransactionRequest {
    readonly from: string
    readonly to: string
    readonly data: string
    readonly value: string
    readonly gas?: string
}

function decimalQuantity(value: string, label: string): bigint {
    if (!/^(0|[1-9][0-9]*)$/.test(value)) {
        throw new ForeverMoneyError(
            'INVALID_TRANSACTION_PLAN',
            `${label} must be an unsigned decimal integer.`
        )
    }
    const quantity = BigInt(value)
    if (quantity > MaxUint256) {
        throw new ForeverMoneyError(
            'INVALID_TRANSACTION_PLAN',
            `${label} exceeds uint256.`
        )
    }
    return quantity
}

function hexQuantity(value: bigint): string {
    return `0x${value.toString(16)}`
}

export function toEip1193Transaction(
    transaction: PreparedTransaction
): Eip1193TransactionRequest {
    const value = decimalQuantity(transaction.value, 'Transaction value')
    const gasLimit =
        transaction.gasLimit === undefined
            ? undefined
            : decimalQuantity(transaction.gasLimit, 'Transaction gas limit')

    return Object.freeze({
        from: transaction.from,
        to: transaction.to,
        data: transaction.data,
        value: hexQuantity(value),
        ...(gasLimit === undefined ? {} : { gas: hexQuantity(gasLimit) }),
    })
}

export function toEthersTransaction(
    transaction: PreparedTransaction
): Readonly<TransactionRequest> {
    return Object.freeze({
        chainId: transaction.chainId,
        to: transaction.to,
        data: transaction.data,
        value: decimalQuantity(transaction.value, 'Transaction value'),
        ...(transaction.gasLimit === undefined
            ? {}
            : {
                  gasLimit: decimalQuantity(
                      transaction.gasLimit,
                      'Transaction gas limit'
                  ),
              }),
    })
}
