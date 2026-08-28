import {
    bridgeMessageIdFromReceipt,
    createForeverMoneyClient,
    toEip1193Transaction,
    type BaseToSubtensorRequest,
    type CcipDeliveryCheckpoint,
    type RpcTransport,
    type ReceiptLog,
    type TransactionPlan,
    type TransactionReceiptLike,
} from '@forevermoney/sdk'

interface TalismanBridgeOptions {
    readonly baseReadTransport: RpcTransport
    readonly subtensorReadTransport: RpcTransport
    readonly walletProvider: RpcTransport
    readonly request: BaseToSubtensorRequest
}

interface ExecutedTransaction {
    readonly hash: string
    readonly receipt: TransactionReceiptLike
}

interface ExecutedBridgePlan {
    readonly transactions: readonly ExecutedTransaction[]
    readonly checkpoint: CcipDeliveryCheckpoint
}

const wait = (milliseconds: number) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds))

function transactionReceipt(value: unknown): TransactionReceiptLike {
    if (typeof value !== 'object' || value === null || !('logs' in value)) {
        throw new Error('Wallet RPC returned an invalid transaction receipt.')
    }
    const logs = value.logs
    if (!Array.isArray(logs)) {
        throw new Error('Wallet RPC returned a receipt without logs.')
    }
    return { logs: logs.map(transactionReceiptLog) }
}

function transactionReceiptLog(value: unknown): ReceiptLog {
    if (
        typeof value !== 'object' ||
        value === null ||
        !('address' in value) ||
        typeof value.address !== 'string' ||
        !('data' in value) ||
        typeof value.data !== 'string' ||
        !('topics' in value) ||
        !Array.isArray(value.topics) ||
        !value.topics.every((topic) => typeof topic === 'string')
    ) {
        throw new Error('Wallet RPC returned an invalid receipt log.')
    }
    return { address: value.address, data: value.data, topics: value.topics }
}

async function waitForSuccessfulReceipt(
    provider: RpcTransport,
    hash: string
): Promise<TransactionReceiptLike> {
    for (let attempt = 0; attempt < 120; attempt += 1) {
        const receipt = await provider.request({
            method: 'eth_getTransactionReceipt',
            params: [hash],
        })
        if (receipt !== null) {
            if (
                typeof receipt !== 'object' ||
                !('status' in receipt) ||
                receipt.status !== '0x1'
            ) {
                throw new Error(`Transaction failed: ${hash}`)
            }
            return transactionReceipt(receipt)
        }
        await wait(2_000)
    }
    throw new Error(`Timed out waiting for transaction receipt: ${hash}`)
}

async function assertWalletContext(
    provider: RpcTransport,
    expectedAccount: string,
    expectedChainId: number
): Promise<void> {
    const [accounts, chainId] = await Promise.all([
        provider.request({ method: 'eth_accounts' }),
        provider.request({ method: 'eth_chainId' }),
    ])
    if (
        !Array.isArray(accounts) ||
        typeof accounts[0] !== 'string' ||
        accounts[0].toLowerCase() !== expectedAccount.toLowerCase()
    ) {
        throw new Error(`Switch Talisman to account ${expectedAccount}.`)
    }
    if (
        typeof chainId !== 'string' ||
        !/^0x[0-9a-fA-F]+$/.test(chainId) ||
        BigInt(chainId) !== BigInt(expectedChainId)
    ) {
        throw new Error(`Switch Talisman to chain ${expectedChainId}.`)
    }
}

async function executeBridgePlan(
    provider: RpcTransport,
    plan: TransactionPlan,
    captureCheckpoint: () => Promise<CcipDeliveryCheckpoint>
): Promise<ExecutedBridgePlan> {
    const transactions: ExecutedTransaction[] = []
    let checkpoint: CcipDeliveryCheckpoint | undefined
    for (const { kind, transaction } of plan.steps) {
        await assertWalletContext(
            provider,
            transaction.from,
            transaction.chainId
        )
        if (kind === 'transaction') {
            if (checkpoint !== undefined) {
                throw new Error(
                    'Bridge plan contained more than one bridge transaction.'
                )
            }
            checkpoint = await captureCheckpoint()
        }
        const hash = await provider.request({
            method: 'eth_sendTransaction',
            params: [toEip1193Transaction(transaction)],
        })
        if (typeof hash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(hash)) {
            throw new Error('Wallet returned an invalid transaction hash.')
        }
        transactions.push({
            hash,
            receipt: await waitForSuccessfulReceipt(provider, hash),
        })
    }
    if (checkpoint === undefined) {
        throw new Error('Bridge plan did not contain a transaction.')
    }
    return Object.freeze({ transactions, checkpoint })
}

export async function bridgeBaseToSubtensorWithTalisman(
    options: TalismanBridgeOptions
) {
    const client = createForeverMoneyClient({
        transports: {
            base: options.baseReadTransport,
            subtensor: options.subtensorReadTransport,
        },
    })
    await client.verifyConnections()

    const prepared = await client.bridge.prepareBaseToSubtensor(options.request)
    const { transactions, checkpoint } = await executeBridgePlan(
        options.walletProvider,
        prepared.plan,
        () => client.bridge.getDeliveryCheckpoint('base-to-subtensor')
    )
    const bridgeReceipt = transactions.at(-1)?.receipt
    if (bridgeReceipt === undefined) {
        throw new Error('Bridge plan did not contain a transaction.')
    }
    const messageId = bridgeMessageIdFromReceipt(
        'base-to-subtensor',
        bridgeReceipt
    )
    if (messageId === null) {
        throw new Error(
            'Confirmed bridge receipt did not contain its canonical event.'
        )
    }
    const deliveryStatus = await client.bridge.getDeliveryStatus({
        direction: checkpoint.direction,
        messageId,
        fromBlock: checkpoint.fromBlock,
    })

    return Object.freeze({
        prepared,
        transactions,
        checkpoint,
        messageId,
        deliveryStatus,
    })
}
