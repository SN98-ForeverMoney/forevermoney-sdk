import { Interface, toBeHex, type AbstractProvider } from 'ethers'
import { ALPHA_GATEWAY_ABI, CCIP_EXECUTION_ABI } from '../abis/index.js'
import { foreverMoneyDeployment } from '../chains/deployment.js'
import { ForeverMoneyError } from '../core/errors.js'
import {
    assertBridgeDirection,
    bridgeMessageIdFromReceipt,
    evmChainFromBridgeDirection,
    isEvmToSubtensorDirection,
    type BridgeDirection,
} from './receipts.js'
import { getForeverMoneyEvmDeployment } from '../chains/deployment.js'
import { normalizeBytes32 } from '../core/validation.js'

const ccipExecutionInterface = new Interface(CCIP_EXECUTION_ABI)
const alphaGatewayInterface = new Interface(ALPHA_GATEWAY_ABI)

export type CcipDeliveryStatus = 'failure' | 'recovery' | 'success' | 'waiting'

export interface CcipDeliveryStatusRequest {
    readonly direction: BridgeDirection
    readonly messageId: string
    readonly fromBlock: number
}

export interface CcipDeliveryCheckpoint {
    readonly direction: BridgeDirection
    readonly destinationChainId: number
    readonly fromBlock: number
}

export type BridgeSourceTransactionStatus = 'confirmed' | 'failed' | 'pending'

export interface BridgeSourceStatusRequest {
    readonly direction: BridgeDirection
    readonly transactionHash: string
}

interface BridgeSourceStatusBase {
    readonly direction: BridgeDirection
    readonly sourceChainId: number
    readonly transactionHash: string
}

export type BridgeSourceStatus =
    | (BridgeSourceStatusBase & {
          readonly status: 'confirmed'
          readonly messageId: string
      })
    | (BridgeSourceStatusBase & {
          readonly status: 'failed' | 'pending'
          readonly messageId: null
      })

export function destinationChainId(direction: BridgeDirection): number {
    assertBridgeDirection(direction)
    const evm = getForeverMoneyEvmDeployment(
        evmChainFromBridgeDirection(direction)
    )
    return isEvmToSubtensorDirection(direction)
        ? foreverMoneyDeployment.subtensor.chainId
        : evm.chainId
}

export function sourceChainId(direction: BridgeDirection): number {
    assertBridgeDirection(direction)
    const evm = getForeverMoneyEvmDeployment(
        evmChainFromBridgeDirection(direction)
    )
    return isEvmToSubtensorDirection(direction)
        ? evm.chainId
        : foreverMoneyDeployment.subtensor.chainId
}

async function assertProviderChain(
    provider: AbstractProvider,
    expectedChainId: number,
    label: string
): Promise<void> {
    const network = await provider.getNetwork()
    if (network.chainId !== BigInt(expectedChainId)) {
        throw new ForeverMoneyError(
            'CHAIN_MISMATCH',
            `${label} transport reported chain ID ${network.chainId}; expected ${expectedChainId}.`,
            {
                expectedChainId,
                actualChainId: network.chainId.toString(),
            }
        )
    }
}

async function assertDestinationProvider(
    provider: AbstractProvider,
    direction: BridgeDirection
): Promise<number> {
    const expectedChainId = destinationChainId(direction)
    await assertProviderChain(provider, expectedChainId, 'Bridge destination')
    return expectedChainId
}

export async function getBridgeSourceStatus(
    provider: AbstractProvider,
    input: BridgeSourceStatusRequest
): Promise<BridgeSourceStatus> {
    const expectedChainId = sourceChainId(input.direction)
    const transactionHash = normalizeBytes32(
        input.transactionHash,
        'Transaction hash'
    )
    await assertProviderChain(provider, expectedChainId, 'Bridge source')
    const receipt = await provider.getTransactionReceipt(transactionHash)
    if (receipt === null) {
        return Object.freeze({
            direction: input.direction,
            sourceChainId: expectedChainId,
            transactionHash,
            status: 'pending',
            messageId: null,
        })
    }
    if (receipt.status === 0) {
        return Object.freeze({
            direction: input.direction,
            sourceChainId: expectedChainId,
            transactionHash,
            status: 'failed',
            messageId: null,
        })
    }
    if (receipt.status !== 1) {
        throw new ForeverMoneyError(
            'INVALID_PROVIDER_RESPONSE',
            'The bridge source receipt has an invalid status.'
        )
    }
    const messageId = bridgeMessageIdFromReceipt(input.direction, receipt)
    if (messageId === null) {
        throw new ForeverMoneyError(
            'INVALID_PROVIDER_RESPONSE',
            'The confirmed bridge source receipt does not contain its canonical gateway event.'
        )
    }
    return Object.freeze({
        direction: input.direction,
        sourceChainId: expectedChainId,
        transactionHash,
        status: 'confirmed',
        messageId,
    })
}

export async function getCcipDeliveryCheckpoint(
    provider: AbstractProvider,
    direction: BridgeDirection
): Promise<CcipDeliveryCheckpoint> {
    const expectedChainId = await assertDestinationProvider(provider, direction)
    const fromBlock = await provider.getBlockNumber()
    if (!Number.isSafeInteger(fromBlock) || fromBlock < 0) {
        throw new ForeverMoneyError(
            'INVALID_PROVIDER_RESPONSE',
            'Bridge destination transport returned an invalid block number.'
        )
    }
    return Object.freeze({
        direction,
        destinationChainId: expectedChainId,
        fromBlock,
    })
}

export async function getCcipDeliveryStatus(
    provider: AbstractProvider,
    input: CcipDeliveryStatusRequest
): Promise<CcipDeliveryStatus> {
    const expectedChainId = destinationChainId(input.direction)
    const messageId = normalizeBytes32(input.messageId, 'CCIP message ID')
    if (!Number.isSafeInteger(input.fromBlock) || input.fromBlock < 0) {
        throw new ForeverMoneyError(
            'INVALID_TRANSACTION_PLAN',
            'CCIP fromBlock must be a non-negative safe integer.'
        )
    }
    await assertProviderChain(provider, expectedChainId, 'Bridge destination')

    const event = ccipExecutionInterface.getEvent('ExecutionStateChanged')
    if (event === null) {
        throw new Error('CCIP execution event is missing from the SDK ABI.')
    }
    const evmChain = evmChainFromBridgeDirection(input.direction)
    const evm = getForeverMoneyEvmDeployment(evmChain)
    const evmToSubtensor = isEvmToSubtensorDirection(input.direction)
    const sourceSelector = evmToSubtensor
        ? evm.ccipSelector
        : foreverMoneyDeployment.subtensor.ccipSelector
    const offRamp = evmToSubtensor
        ? evmChain === 'base'
            ? foreverMoneyDeployment.subtensor.contracts.ccipOffRampFromBase
            : foreverMoneyDeployment.subtensor.contracts
                  .ccipOffRampFromRobinhood
        : evm.contracts.ccipOffRampFromSubtensor
    const logs = await provider.getLogs({
        address: offRamp,
        fromBlock: input.fromBlock,
        toBlock: 'latest',
        topics: [event.topicHash, toBeHex(sourceSelector, 32), null, messageId],
    })
    const latest = logs.at(-1)
    if (latest === undefined) return 'waiting'

    const parsed = ccipExecutionInterface.parseLog(latest)
    const state = Number(parsed?.args.state)
    if (state === 3) return 'failure'
    if (state !== 2) return 'waiting'
    if (!evmToSubtensor) return 'success'

    const receipt = await provider.getTransactionReceipt(latest.transactionHash)
    if (receipt === null) {
        throw new ForeverMoneyError(
            'INVALID_PROVIDER_RESPONSE',
            'The CCIP execution receipt is unavailable.'
        )
    }
    for (const log of receipt.logs) {
        if (
            log.address.toLowerCase() !==
            foreverMoneyDeployment.subtensor.contracts.gateway.toLowerCase()
        ) {
            continue
        }
        try {
            if (alphaGatewayInterface.parseLog(log)?.name === 'Claimable') {
                return 'recovery'
            }
        } catch {
            // The execution receipt can contain other gateway events.
        }
    }
    return 'success'
}
