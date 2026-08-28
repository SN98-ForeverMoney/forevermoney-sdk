import {
    bridgeMessageIdFromReceipt,
    createForeverMoneyClient,
    foreverMoneyAbis,
    foreverMoneyDeployment,
    http,
    parseTaoAmount,
    toEthersTransaction,
} from '@forevermoney/sdk'
import { Contract, JsonRpcProvider, Wallet } from 'ethers'

const required = (name) => {
    const value = process.env[name]
    if (value === undefined || value === '') {
        throw new Error(`${name} is required.`)
    }
    return value
}

if (process.env.CI !== undefined) {
    throw new Error('The live canary cannot run in CI.')
}

const privateKey = required('FOREVERMONEY_CANARY_PRIVATE_KEY')
const source = required('FOREVERMONEY_CANARY_SOURCE')
const destination = required('FOREVERMONEY_CANARY_DESTINATION')
const amountWei = parseTaoAmount(required('FOREVERMONEY_CANARY_AMOUNT_TAO'))
const baseRpcUrl = required('BASE_RPC_URL')
const subtensorRpcUrl = required('SUBTENSOR_RPC_URL')

if (source !== 'base' && source !== 'subtensor') {
    throw new Error('FOREVERMONEY_CANARY_SOURCE must be base or subtensor.')
}
const maximumAmountWei = parseTaoAmount('0.001')
const maximumWalletBalanceWei = parseTaoAmount('0.05')
if (amountWei > maximumAmountWei) {
    throw new Error('The live canary amount cannot exceed 0.001 TAO.')
}

const client = createForeverMoneyClient({
    transports: {
        base: http(baseRpcUrl),
        subtensor: http(subtensorRpcUrl),
    },
})
await client.verifyConnections()

const sourceRpcUrl = source === 'base' ? baseRpcUrl : subtensorRpcUrl
const provider = new JsonRpcProvider(sourceRpcUrl)
const wallet = new Wallet(privateKey, provider)
const sender = wallet.address
const nativeBalance = await provider.getBalance(sender)
if (nativeBalance > maximumWalletBalanceWei) {
    throw new Error(
        'The live canary wallet holds more than 0.05 native units. Use a dedicated low-balance wallet.'
    )
}
if (source === 'base') {
    const wrappedTao = new Contract(
        foreverMoneyDeployment.base.contracts.wrappedTao,
        foreverMoneyAbis.erc20,
        provider
    )
    const wrappedTaoBalance = await wrappedTao.balanceOf(sender)
    if (wrappedTaoBalance > maximumWalletBalanceWei) {
        throw new Error(
            'The live canary wallet holds more than 0.05 wrapped TAO. Use a dedicated low-balance wallet.'
        )
    }
    if (wrappedTaoBalance < amountWei) {
        throw new Error('The live canary wallet has insufficient wrapped TAO.')
    }
} else if (nativeBalance < amountWei) {
    throw new Error('The live canary wallet has insufficient liquid TAO.')
}

const prepared =
    source === 'base'
        ? await client.bridge.prepareBaseToSubtensor({
              sender,
              amountWei,
              destination,
              delivery: 'liquid',
          })
        : await client.bridge.prepareSubtensorToBase({
              sender,
              recipient: destination,
              amountWei,
              source: 'liquid',
          })

console.log(
    JSON.stringify(
        {
            sender,
            source,
            plan: prepared.plan,
        },
        null,
        2
    )
)

if (
    process.env.FOREVERMONEY_LIVE_CANARY_BROADCAST !==
    'I_ACKNOWLEDGE_THIS_SENDS_REAL_FUNDS'
) {
    console.log('Dry run only. No transaction was signed or broadcast.')
    process.exit(0)
}

const direction = source === 'base' ? 'base-to-subtensor' : 'subtensor-to-base'
let checkpoint
let messageId
for (const step of prepared.plan.steps) {
    if (step.kind === 'transaction') {
        checkpoint = await client.bridge.getDeliveryCheckpoint(direction)
    }
    const transaction = await wallet.sendTransaction(
        toEthersTransaction(step.transaction)
    )
    console.log(`${step.label}: ${transaction.hash}`)
    const receipt = await transaction.wait()
    if (receipt === null || receipt.status !== 1) {
        throw new Error(`Canary transaction failed: ${transaction.hash}`)
    }
    if (step.kind === 'transaction') {
        messageId = bridgeMessageIdFromReceipt(direction, receipt)
        if (messageId === null) {
            throw new Error(
                `Confirmed canary receipt did not contain the canonical bridge event: ${transaction.hash}`
            )
        }
        console.log(`CCIP message ID: ${messageId}`)
    }
}

if (checkpoint === undefined || messageId === undefined) {
    throw new Error('Canary plan did not execute a bridge transaction.')
}

for (let attempt = 0; attempt < 120; attempt += 1) {
    const status = await client.bridge.getDeliveryStatus({
        direction,
        messageId,
        fromBlock: checkpoint.fromBlock,
    })
    if (status === 'success') {
        console.log('CCIP delivery status: success')
        process.exit(0)
    }
    if (status === 'failure' || status === 'recovery') {
        throw new Error(`CCIP delivery status: ${status}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 15_000))
}

throw new Error('Timed out waiting for CCIP delivery after 30 minutes.')
