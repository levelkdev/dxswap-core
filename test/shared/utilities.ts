import { BigNumber, Contract, constants } from 'ethers'
import {
  getAddress,
  keccak256,
  defaultAbiCoder,
  toUtf8Bytes,
  solidityPack
} from 'ethers/lib/utils'
import { bignumber, log10 } from 'mathjs'
import { DXswapFactory, DXswapPair } from '../../typechain'

const { AddressZero } = constants

const PERMIT_TYPEHASH = keccak256(
  toUtf8Bytes('Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)')
)

export function expandTo18Decimals(n: number): BigNumber {
  return BigNumber.from(n).mul(BigNumber.from(10).pow(18))
}

function getDomainSeparator(name: string, tokenAddress: string) {
  return keccak256(
    defaultAbiCoder.encode(
      ['bytes32', 'bytes32', 'bytes32', 'uint256', 'address'],
      [
        keccak256(toUtf8Bytes('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)')),
        keccak256(toUtf8Bytes(name)),
        keccak256(toUtf8Bytes('1')),
        1,
        tokenAddress
      ]
    )
  )
}

export function getCreate2Address(
  factoryAddress: string,
  [tokenA, tokenB]: [string, string],
  bytecode: string
): string {
  const [token0, token1] = tokenA < tokenB ? [tokenA, tokenB] : [tokenB, tokenA]
  const create2Inputs = [
    '0xff',
    factoryAddress,
    keccak256(solidityPack(['address', 'address'], [token0, token1])),
    keccak256(bytecode)
  ]
  const sanitizedInputs = `0x${create2Inputs.map(i => i.slice(2)).join('')}`
  return getAddress(`0x${keccak256(sanitizedInputs).slice(-40)}`)
}

export async function getApprovalDigest(
  token: Contract,
  approve: {
    owner: string
    spender: string
    value: BigNumber
  },
  nonce: BigNumber,
  deadline: BigNumber
): Promise<string> {
  const name = await token.name()
  const DOMAIN_SEPARATOR = getDomainSeparator(name, token.address)
  return keccak256(
    solidityPack(
      ['bytes1', 'bytes1', 'bytes32', 'bytes32'],
      [
        '0x19',
        '0x01',
        DOMAIN_SEPARATOR,
        keccak256(
          defaultAbiCoder.encode(
            ['bytes32', 'address', 'address', 'uint256', 'uint256', 'uint256'],
            [PERMIT_TYPEHASH, approve.owner, approve.spender, approve.value, nonce, deadline]
          )
        )
      ]
    )
  )
}

export function encodePrice(reserve0: BigNumber, reserve1: BigNumber) {
  return [reserve1.mul(BigNumber.from(2).pow(112)).div(reserve0), reserve0.mul(BigNumber.from(2).pow(112)).div(reserve1)]
}

export function sqrt(value: BigNumber) {
  const ONE = BigNumber.from(1);
  const TWO = BigNumber.from(2);
  const x = BigNumber.from(value);
  let z = x.add(ONE).div(TWO);
  let y = x;
  while (z.sub(y).isNegative()) {
    y = z;
    z = x.div(z).add(z).div(TWO);
  }
  return y;
}

// Calculate how much will be payed from liquidity as protocol fee in the next mint/burn
export async function calcProtocolFee(_pair: DXswapPair, _factory: DXswapFactory) {
  const [token0Reserve, token1Reserve, _] = await _pair.getReserves()
  const kLast = await _pair.kLast()
  const feeTo = await _factory.feeTo()
  const protocolFeeDenominator = await _factory.protocolFeeDenominator()
  const totalSupply = await _pair.totalSupply()
  let rootK: BigNumber
  let rootKLast: BigNumber
  if (feeTo != AddressZero) {
    // Check for math overflow when dealing with big big balances
    const balance = sqrt((token0Reserve).mul(token1Reserve))
    const balanceBN = balance ? bignumber(balance.toString()) : bignumber(0)

    if ((BigNumber.from(sqrt(token0Reserve)).mul(token1Reserve)).gt(BigNumber.from(10).pow(19))) {
      const balanceBaseLog10 = (log10(balanceBN)).toPrecision(1)
      const denominator = BigNumber.from(10).pow(BigNumber.from(Number(balanceBaseLog10)).sub(BigNumber.from(18)));

      rootK = BigNumber.from(sqrt(token0Reserve.mul(token1Reserve)).div(denominator))
      rootKLast = BigNumber.from(sqrt(kLast).div(denominator))
    } else {
      rootK = (BigNumber.from(sqrt(token0Reserve)).mul(token1Reserve))
      rootKLast = BigNumber.from(sqrt(kLast))
    }

    return (totalSupply.mul(rootK.sub(rootKLast)))
      .div(rootK.mul(protocolFeeDenominator).add(rootKLast))
  } else {
    return BigNumber.from(0)
  }
}