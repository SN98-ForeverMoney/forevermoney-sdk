import {
    createForeverMoneyClient,
    http,
    parseTaoAmount,
} from '@forevermoney/sdk'

const baseRpcUrl = process.env.BASE_RPC_URL
const subtensorRpcUrl = process.env.SUBTENSOR_RPC_URL

if (baseRpcUrl === undefined || subtensorRpcUrl === undefined) {
    throw new Error('BASE_RPC_URL and SUBTENSOR_RPC_URL are required.')
}

const client = createForeverMoneyClient({
    transports: {
        base: http(baseRpcUrl),
        subtensor: http(subtensorRpcUrl),
    },
})

const prepared = await client.bridge.prepareSubtensorToBase({
    sender: '0x1111111111111111111111111111111111111111',
    recipient: '0x1111111111111111111111111111111111111111',
    amountWei: parseTaoAmount('0.01'),
    source: 'liquid',
})

console.log(JSON.stringify(prepared.plan, null, 2))
