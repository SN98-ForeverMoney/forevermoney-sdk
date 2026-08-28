import { encodeAddress } from '@polkadot/util-crypto'
import { Contract, JsonRpcProvider } from 'ethers'
import { describe, expect, it } from 'vitest'
import {
    ALPHA_GATEWAY_ABI,
    CCIP_ROUTER_ABI,
    SPOKE_GATEWAY_ABI,
} from '../abis/index.js'
import {
    createForeverMoneyClient,
    foreverMoneyDeployment,
    http,
} from '../index.js'

const baseForkRpcUrl = process.env.FOREVERMONEY_BASE_FORK_RPC_URL
const subtensorForkRpcUrl = process.env.FOREVERMONEY_SUBTENSOR_FORK_RPC_URL
const sender = '0x1111111111111111111111111111111111111111'
const destination = encodeAddress(new Uint8Array(32).fill(7), 42)
const bridgeAmountWei = 1_000_000_000n

describe.skipIf(baseForkRpcUrl === undefined)('Base production fork', () => {
    it('uses production contracts at their canonical addresses', async () => {
        const provider = new JsonRpcProvider(baseForkRpcUrl)
        expect((await provider.getNetwork()).chainId).toBe(8453n)
        expect(
            await provider.getCode(
                foreverMoneyDeployment.base.contracts.gateway,
                foreverMoneyDeployment.base.deploymentBlock - 1
            )
        ).toBe('0x')
        expect(
            await provider.getCode(
                foreverMoneyDeployment.base.contracts.gateway,
                foreverMoneyDeployment.base.deploymentBlock
            )
        ).not.toBe('0x')
        for (const address of [
            foreverMoneyDeployment.base.contracts.gateway,
            foreverMoneyDeployment.base.contracts.wrappedTao,
            foreverMoneyDeployment.base.contracts.vaultFactory,
            foreverMoneyDeployment.base.contracts.vaultManagerImplementation,
        ]) {
            expect(await provider.getCode(address)).not.toBe('0x')
        }

        const gateway = new Contract(
            foreverMoneyDeployment.base.contracts.gateway,
            SPOKE_GATEWAY_ABI,
            provider
        )
        expect(await gateway.getFunction('BITTENSOR_SELECTOR')()).toBe(
            foreverMoneyDeployment.subtensor.ccipSelector
        )
        expect(await gateway.getFunction('SUBTENSOR_GATEWAY')()).toBe(
            foreverMoneyDeployment.subtensor.contracts.gateway
        )
        expect(await gateway.getFunction('ROUTER')()).toBe(
            foreverMoneyDeployment.base.contracts.ccipRouter
        )
        const router = new Contract(
            foreverMoneyDeployment.base.contracts.ccipRouter,
            CCIP_ROUTER_ABI,
            provider
        )
        expect(
            await router.getFunction('isOffRamp')(
                foreverMoneyDeployment.subtensor.ccipSelector,
                foreverMoneyDeployment.base.contracts.ccipOffRampFromSubtensor
            )
        ).toBe(true)
        const quote = (await gateway.getFunction(
            'quoteBridgeToFinney(address,uint256,(bytes32,address,bool,uint256))'
        )(foreverMoneyDeployment.base.contracts.wrappedTao, bridgeAmountWei, {
            ss58: `0x${'07'.repeat(32)}`,
            evmFallback: sender,
            wantLiquid: true,
            minTaoOut: bridgeAmountWei,
        })) as bigint
        expect(quote).toBeGreaterThan(0n)
    })
})

describe.skipIf(subtensorForkRpcUrl === undefined)(
    'Subtensor production fork',
    () => {
        it('uses production contracts and the allowed Base lane', async () => {
            const provider = new JsonRpcProvider(subtensorForkRpcUrl)
            expect((await provider.getNetwork()).chainId).toBe(964n)
            for (const address of [
                foreverMoneyDeployment.subtensor.contracts.gateway,
                foreverMoneyDeployment.subtensor.contracts.alphaVault,
                foreverMoneyDeployment.subtensor.contracts.wrappedTao,
            ]) {
                expect(await provider.getCode(address)).not.toBe('0x')
            }

            const gateway = new Contract(
                foreverMoneyDeployment.subtensor.contracts.gateway,
                ALPHA_GATEWAY_ABI,
                provider
            )
            expect(
                await gateway.getFunction('allowedLane')(
                    foreverMoneyDeployment.base.ccipSelector
                )
            ).toBe(true)
            expect(await gateway.getFunction('ROUTER')()).toBe(
                foreverMoneyDeployment.subtensor.contracts.ccipRouter
            )
            const router = new Contract(
                foreverMoneyDeployment.subtensor.contracts.ccipRouter,
                CCIP_ROUTER_ABI,
                provider
            )
            expect(
                await router.getFunction('isOffRamp')(
                    foreverMoneyDeployment.base.ccipSelector,
                    foreverMoneyDeployment.subtensor.contracts
                        .ccipOffRampFromBase
                )
            ).toBe(true)
            const quote = (await gateway.getFunction('quoteBridgeOut')(
                foreverMoneyDeployment.base.ccipSelector,
                foreverMoneyDeployment.subtensor.contracts.wrappedTao,
                sender,
                bridgeAmountWei
            )) as bigint
            expect(quote).toBeGreaterThan(0n)
        })
    }
)

describe.skipIf(
    baseForkRpcUrl === undefined || subtensorForkRpcUrl === undefined
)('SDK fork transports', () => {
    it('accepts the forks without a custom deployment manifest', async () => {
        if (baseForkRpcUrl === undefined || subtensorForkRpcUrl === undefined) {
            throw new Error('Fork RPC URLs are required for this test.')
        }
        const client = createForeverMoneyClient({
            transports: {
                base: http(baseForkRpcUrl),
                subtensor: http(subtensorForkRpcUrl),
            },
        })
        await expect(client.verifyConnections()).resolves.toBeUndefined()
        await expect(
            client.bridge.prepareBaseToSubtensor({
                sender,
                amountWei: bridgeAmountWei,
                destination,
                delivery: 'liquid',
            })
        ).resolves.toMatchObject({
            plan: { action: 'bridge.base-to-subtensor' },
        })
    })
})
