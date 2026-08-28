import { Interface, isHexString } from 'ethers'
import { ALPHA_GATEWAY_ABI, SPOKE_GATEWAY_ABI } from '../abis/index.js'
import {
    foreverMoneyDeployment,
    getForeverMoneyEvmDeployment,
    type ForeverMoneyEvmChain,
} from '../chains/deployment.js'
import { ForeverMoneyError } from '../core/errors.js'
import { isLogFrom, type TransactionReceiptLike } from '../core/receipts.js'

export type { ReceiptLog, TransactionReceiptLike } from '../core/receipts.js'

const alphaGatewayInterface = new Interface(ALPHA_GATEWAY_ABI)
const spokeGatewayInterface = new Interface(SPOKE_GATEWAY_ABI)

export type BridgeDirection =
    | 'base-to-subtensor'
    | 'robinhood-to-subtensor'
    | 'subtensor-to-base'
    | 'subtensor-to-robinhood'

export function assertBridgeDirection(
    value: unknown
): asserts value is BridgeDirection {
    if (
        value !== 'base-to-subtensor' &&
        value !== 'robinhood-to-subtensor' &&
        value !== 'subtensor-to-base' &&
        value !== 'subtensor-to-robinhood'
    ) {
        throw new ForeverMoneyError(
            'INVALID_TRANSACTION_PLAN',
            'Bridge direction must identify a canonical Base or Robinhood lane.'
        )
    }
}

export function evmChainFromBridgeDirection(
    direction: BridgeDirection
): ForeverMoneyEvmChain {
    assertBridgeDirection(direction)
    return direction.includes('robinhood') ? 'robinhood' : 'base'
}

export function isEvmToSubtensorDirection(direction: BridgeDirection): boolean {
    assertBridgeDirection(direction)
    return direction.endsWith('-to-subtensor')
}

export function bridgeMessageIdFromReceipt(
    direction: BridgeDirection,
    receipt: TransactionReceiptLike
): string | null {
    assertBridgeDirection(direction)
    const evm = getForeverMoneyEvmDeployment(
        evmChainFromBridgeDirection(direction)
    )
    const evmToSubtensor = isEvmToSubtensorDirection(direction)
    const [address, contractInterface, eventName] = evmToSubtensor
        ? [evm.contracts.gateway, spokeGatewayInterface, 'BridgedToFinney']
        : [
              foreverMoneyDeployment.subtensor.contracts.gateway,
              alphaGatewayInterface,
              'BridgedOut',
          ]

    for (const log of receipt.logs) {
        if (!isLogFrom(log, address)) continue
        try {
            const parsed = contractInterface.parseLog({
                data: log.data,
                topics: [...log.topics],
            })
            const messageId = parsed?.args.messageId
            if (
                parsed?.name === eventName &&
                typeof messageId === 'string' &&
                isHexString(messageId, 32) &&
                (evmToSubtensor ||
                    parsed.args.destChainSelector === evm.ccipSelector)
            ) {
                return messageId.toLowerCase()
            }
        } catch {
            // A receipt can contain unrelated events from the same contract.
        }
    }
    return null
}
