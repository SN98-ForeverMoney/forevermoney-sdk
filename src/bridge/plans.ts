import { Contract, Interface } from 'ethers'
import {
    ALPHA_GATEWAY_ABI,
    ERC20_ABI,
    SPOKE_GATEWAY_ABI,
    STAKING_ABI,
} from '../abis/index.js'
import {
    normalizeEvmAddress,
    normalizeSS58,
    ss58ToPublicKey,
} from '../core/addresses.js'
import {
    assertWholeRao,
    feeWithBuffer,
    gasLimitWithBuffer,
} from '../core/amounts.js'
import {
    EVM_WEI_PER_RAO,
    foreverMoneyDeployment,
    getForeverMoneyEvmDeployment,
    type ForeverMoneyEvmChain,
} from '../chains/deployment.js'
import { ForeverMoneyError } from '../core/errors.js'
import {
    createTransactionPlan,
    type TransactionPlan,
    type TransactionStep,
} from '../core/plans.js'
import { assertNonNegativeAmount } from '../core/validation.js'
import type { BrowserProvider } from 'ethers'

const erc20Interface = new Interface(ERC20_ABI)
const spokeInterface = new Interface(SPOKE_GATEWAY_ABI)
const alphaInterface = new Interface(ALPHA_GATEWAY_ABI)
const stakingInterface = new Interface(STAKING_ABI)

export const MIN_LIQUID_EVM_TO_SUBTENSOR_WEI = 10_000_000_000_000_000n
export const MIN_LIQUID_BASE_TO_SUBTENSOR_WEI = MIN_LIQUID_EVM_TO_SUBTENSOR_WEI

export type SubtensorDelivery = 'liquid' | 'staked'
export type SubtensorSource = 'liquid' | 'staked'

export interface EvmToSubtensorRequest {
    readonly evmChain: ForeverMoneyEvmChain
    readonly sender: string
    readonly amountWei: bigint
    readonly destination: string
    readonly delivery: SubtensorDelivery
}

export interface SubtensorToEvmRequest {
    readonly evmChain: ForeverMoneyEvmChain
    readonly sender: string
    readonly recipient: string
    readonly amountWei: bigint
    readonly source: SubtensorSource
    readonly netuid?: bigint
}

export type BaseToSubtensorRequest = Omit<EvmToSubtensorRequest, 'evmChain'>
export type SubtensorToBaseRequest = Omit<SubtensorToEvmRequest, 'evmChain'>

export interface BridgePreparation {
    readonly exactNetworkFeeWei: bigint
    readonly transactionValueWei: bigint
    readonly plan: TransactionPlan
}

function assertDelivery(value: unknown): asserts value is SubtensorDelivery {
    if (value !== 'liquid' && value !== 'staked') {
        throw new ForeverMoneyError(
            'INVALID_TRANSACTION_PLAN',
            'Delivery must be "liquid" or "staked".'
        )
    }
}

function assertSource(value: unknown): asserts value is SubtensorSource {
    if (value !== 'liquid' && value !== 'staked') {
        throw new ForeverMoneyError(
            'INVALID_TRANSACTION_PLAN',
            'Source must be "liquid" or "staked".'
        )
    }
}

function assertBaseToSubtensorAmount(
    amountWei: bigint,
    delivery: SubtensorDelivery
): void {
    assertWholeRao(amountWei)
    if (delivery === 'liquid' && amountWei < MIN_LIQUID_EVM_TO_SUBTENSOR_WEI) {
        throw new ForeverMoneyError(
            'AMOUNT_BELOW_MINIMUM',
            'Liquid delivery from an EVM chain to Subtensor requires at least 0.01 TAO.',
            {
                amountWei: amountWei.toString(),
                minimumAmountWei: MIN_LIQUID_EVM_TO_SUBTENSOR_WEI.toString(),
            }
        )
    }
}

export interface BuildEvmToSubtensorPlanRequest extends EvmToSubtensorRequest {
    readonly allowanceWei: bigint
    readonly exactNetworkFeeWei: bigint
    readonly estimatedBridgeGas?: bigint
}

export interface BuildSubtensorToEvmPlanRequest extends SubtensorToEvmRequest {
    readonly stakingAllowanceRao?: bigint
    readonly exactNetworkFeeWei: bigint
    readonly estimatedBridgeGas?: bigint
}

export type BuildBaseToSubtensorPlanRequest = Omit<
    BuildEvmToSubtensorPlanRequest,
    'evmChain'
>
export type BuildSubtensorToBasePlanRequest = Omit<
    BuildSubtensorToEvmPlanRequest,
    'evmChain'
>

function transactionStep(
    kind: TransactionStep['kind'],
    label: string,
    chainId: number,
    from: string,
    to: string,
    data: string,
    value: bigint,
    gasLimit?: bigint
): TransactionStep {
    return {
        kind,
        label,
        transaction: {
            chainId,
            from,
            to,
            data,
            value: value.toString(),
            ...(gasLimit === undefined
                ? {}
                : { gasLimit: gasLimit.toString() }),
        },
    }
}

export function buildEvmToSubtensorPlan(
    input: BuildEvmToSubtensorPlanRequest
): TransactionPlan {
    const sender = normalizeEvmAddress(input.sender)
    assertDelivery(input.delivery)
    assertBaseToSubtensorAmount(input.amountWei, input.delivery)
    assertNonNegativeAmount(input.allowanceWei, 'Token allowance')
    assertNonNegativeAmount(input.exactNetworkFeeWei, 'Network fee')
    const destination = normalizeSS58(input.destination)
    const exit = {
        ss58: ss58ToPublicKey(destination),
        evmFallback: sender,
        wantLiquid: input.delivery === 'liquid',
        minTaoOut: input.amountWei,
    }
    const evm = getForeverMoneyEvmDeployment(input.evmChain)
    const steps: TransactionStep[] = []

    if (input.allowanceWei < input.amountWei) {
        steps.push(
            transactionStep(
                'approval',
                'Approve wrapped TAO for the ForeverMoney gateway',
                evm.chainId,
                sender,
                evm.contracts.wrappedTao,
                erc20Interface.encodeFunctionData('approve', [
                    evm.contracts.gateway,
                    input.amountWei,
                ]),
                0n
            )
        )
    }

    const value = feeWithBuffer(input.exactNetworkFeeWei)
    steps.push(
        transactionStep(
            'transaction',
            `Bridge wrapped TAO from ${evm.name} to Subtensor (${input.delivery})`,
            evm.chainId,
            sender,
            evm.contracts.gateway,
            spokeInterface.encodeFunctionData(
                'bridgeToFinney(address,uint256,(bytes32,address,bool,uint256))',
                [evm.contracts.wrappedTao, input.amountWei, exit]
            ),
            value,
            input.estimatedBridgeGas === undefined
                ? undefined
                : gasLimitWithBuffer(input.estimatedBridgeGas)
        )
    )

    return createTransactionPlan({
        action:
            evm.key === 'base'
                ? 'bridge.base-to-subtensor'
                : 'bridge.robinhood-to-subtensor',
        summary: `Bridge ${input.amountWei} wei of wrapped TAO from ${evm.name} to ${destination}.`,
        steps,
    })
}

export function buildBaseToSubtensorPlan(
    input: BuildBaseToSubtensorPlanRequest
): TransactionPlan {
    return buildEvmToSubtensorPlan({ ...input, evmChain: 'base' })
}

export function buildSubtensorToEvmPlan(
    input: BuildSubtensorToEvmPlanRequest
): TransactionPlan {
    const sender = normalizeEvmAddress(input.sender)
    const recipient = normalizeEvmAddress(input.recipient)
    assertSource(input.source)
    assertWholeRao(input.amountWei)
    assertNonNegativeAmount(input.exactNetworkFeeWei, 'Network fee')
    const { subtensor } = foreverMoneyDeployment
    const evm = getForeverMoneyEvmDeployment(input.evmChain)
    const amountRao = input.amountWei / EVM_WEI_PER_RAO
    const steps: TransactionStep[] = []

    if (input.source === 'staked') {
        if (input.netuid === undefined) {
            throw new ForeverMoneyError(
                'INVALID_TRANSACTION_PLAN',
                'A netuid is required when bridging staked TAO.'
            )
        }
        assertNonNegativeAmount(input.netuid, 'netuid')
        if (input.stakingAllowanceRao === undefined) {
            throw new ForeverMoneyError(
                'INVALID_TRANSACTION_PLAN',
                'The staking allowance is required when bridging staked TAO.'
            )
        }
        assertNonNegativeAmount(input.stakingAllowanceRao, 'Staking allowance')
        if (input.stakingAllowanceRao < amountRao) {
            steps.push(
                transactionStep(
                    'approval',
                    'Approve staked TAO for the ForeverMoney gateway',
                    subtensor.chainId,
                    sender,
                    subtensor.contracts.stakingPrecompile,
                    stakingInterface.encodeFunctionData('approve', [
                        subtensor.contracts.gateway,
                        input.netuid,
                        amountRao,
                    ]),
                    0n
                )
            )
        }
    } else if (
        input.netuid !== undefined ||
        input.stakingAllowanceRao !== undefined
    ) {
        throw new ForeverMoneyError(
            'INVALID_TRANSACTION_PLAN',
            'netuid and staking allowance are only valid for staked TAO.'
        )
    }

    const taoAmount = input.source === 'liquid' ? input.amountWei : 0n
    const stakedAlphaRao = input.source === 'staked' ? amountRao : 0n
    const value = taoAmount + feeWithBuffer(input.exactNetworkFeeWei)
    assertNonNegativeAmount(value, 'Transaction value')
    steps.push(
        transactionStep(
            'transaction',
            `Bridge ${input.source} TAO from Subtensor to ${evm.name}`,
            subtensor.chainId,
            sender,
            subtensor.contracts.gateway,
            alphaInterface.encodeFunctionData('bridgeOut', [
                evm.ccipSelector,
                subtensor.contracts.wrappedTao,
                recipient,
                taoAmount,
                stakedAlphaRao,
                input.amountWei,
            ]),
            value,
            input.estimatedBridgeGas === undefined
                ? undefined
                : gasLimitWithBuffer(input.estimatedBridgeGas)
        )
    )

    return createTransactionPlan({
        action:
            evm.key === 'base'
                ? 'bridge.subtensor-to-base'
                : 'bridge.subtensor-to-robinhood',
        summary: `Bridge ${input.amountWei} wei of ${input.source} TAO from Subtensor to ${recipient} on ${evm.name}.`,
        steps,
    })
}

export function buildSubtensorToBasePlan(
    input: BuildSubtensorToBasePlanRequest
): TransactionPlan {
    return buildSubtensorToEvmPlan({ ...input, evmChain: 'base' })
}

export async function prepareEvmToSubtensor(
    provider: BrowserProvider,
    input: EvmToSubtensorRequest
): Promise<BridgePreparation> {
    const sender = normalizeEvmAddress(input.sender)
    assertDelivery(input.delivery)
    assertBaseToSubtensorAmount(input.amountWei, input.delivery)
    const destination = normalizeSS58(input.destination)
    const evm = getForeverMoneyEvmDeployment(input.evmChain)
    const exit = {
        ss58: ss58ToPublicKey(destination),
        evmFallback: sender,
        wantLiquid: input.delivery === 'liquid',
        minTaoOut: input.amountWei,
    }
    const token = new Contract(evm.contracts.wrappedTao, ERC20_ABI, provider)
    const gateway = new Contract(
        evm.contracts.gateway,
        SPOKE_GATEWAY_ABI,
        provider
    )
    const [allowanceWei, exactNetworkFeeWei] = await Promise.all([
        token.getFunction('allowance')(
            sender,
            evm.contracts.gateway
        ) as Promise<bigint>,
        gateway.getFunction(
            'quoteBridgeToFinney(address,uint256,(bytes32,address,bool,uint256))'
        )(evm.contracts.wrappedTao, input.amountWei, exit) as Promise<bigint>,
    ])

    let estimatedBridgeGas: bigint | undefined
    if (allowanceWei >= input.amountWei) {
        const data = spokeInterface.encodeFunctionData(
            'bridgeToFinney(address,uint256,(bytes32,address,bool,uint256))',
            [evm.contracts.wrappedTao, input.amountWei, exit]
        )
        estimatedBridgeGas = await provider.estimateGas({
            from: sender,
            to: evm.contracts.gateway,
            data,
            value: feeWithBuffer(exactNetworkFeeWei),
        })
    }

    const plan = buildEvmToSubtensorPlan({
        ...input,
        allowanceWei,
        exactNetworkFeeWei,
        ...(estimatedBridgeGas === undefined ? {} : { estimatedBridgeGas }),
    })
    return Object.freeze({
        exactNetworkFeeWei,
        transactionValueWei: feeWithBuffer(exactNetworkFeeWei),
        plan,
    })
}

export function prepareBaseToSubtensor(
    provider: BrowserProvider,
    input: BaseToSubtensorRequest
): Promise<BridgePreparation> {
    return prepareEvmToSubtensor(provider, { ...input, evmChain: 'base' })
}

export async function prepareSubtensorToEvm(
    provider: BrowserProvider,
    input: SubtensorToEvmRequest
): Promise<BridgePreparation> {
    const sender = normalizeEvmAddress(input.sender)
    const recipient = normalizeEvmAddress(input.recipient)
    assertSource(input.source)
    assertWholeRao(input.amountWei)
    const { subtensor } = foreverMoneyDeployment
    const evm = getForeverMoneyEvmDeployment(input.evmChain)
    const gateway = new Contract(
        subtensor.contracts.gateway,
        ALPHA_GATEWAY_ABI,
        provider
    )
    const exactNetworkFeeWei = (await gateway.getFunction('quoteBridgeOut')(
        evm.ccipSelector,
        subtensor.contracts.wrappedTao,
        recipient,
        input.amountWei
    )) as bigint

    let stakingAllowanceRao: bigint | undefined
    if (input.source === 'staked') {
        if (input.netuid === undefined) {
            throw new ForeverMoneyError(
                'INVALID_TRANSACTION_PLAN',
                'A netuid is required when bridging staked TAO.'
            )
        }
        assertNonNegativeAmount(input.netuid, 'netuid')
        const staking = new Contract(
            subtensor.contracts.stakingPrecompile,
            STAKING_ABI,
            provider
        )
        stakingAllowanceRao = (await staking.getFunction('allowance')(
            sender,
            subtensor.contracts.gateway,
            input.netuid
        )) as bigint
    }

    const taoAmount = input.source === 'liquid' ? input.amountWei : 0n
    const stakedAlphaRao =
        input.source === 'staked' ? input.amountWei / EVM_WEI_PER_RAO : 0n
    const value = taoAmount + feeWithBuffer(exactNetworkFeeWei)
    assertNonNegativeAmount(value, 'Transaction value')
    let estimatedBridgeGas: bigint | undefined
    if (
        input.source === 'liquid' ||
        (stakingAllowanceRao !== undefined &&
            stakingAllowanceRao >= stakedAlphaRao)
    ) {
        estimatedBridgeGas = await provider.estimateGas({
            from: sender,
            to: subtensor.contracts.gateway,
            data: alphaInterface.encodeFunctionData('bridgeOut', [
                evm.ccipSelector,
                subtensor.contracts.wrappedTao,
                recipient,
                taoAmount,
                stakedAlphaRao,
                input.amountWei,
            ]),
            value,
        })
    }

    const plan = buildSubtensorToEvmPlan({
        ...input,
        exactNetworkFeeWei,
        ...(stakingAllowanceRao === undefined ? {} : { stakingAllowanceRao }),
        ...(estimatedBridgeGas === undefined ? {} : { estimatedBridgeGas }),
    })
    return Object.freeze({
        exactNetworkFeeWei,
        transactionValueWei: value,
        plan,
    })
}

export function prepareSubtensorToBase(
    provider: BrowserProvider,
    input: SubtensorToBaseRequest
): Promise<BridgePreparation> {
    return prepareSubtensorToEvm(provider, { ...input, evmChain: 'base' })
}
