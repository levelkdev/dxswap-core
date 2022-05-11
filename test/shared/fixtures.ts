import { Contract, Wallet } from 'ethers'
import { Web3Provider } from 'ethers/providers'
import { defaultAbiCoder } from 'ethers/utils'
import { deployContract } from 'ethereum-waffle'

import { expandTo18Decimals } from './utilities'

import ERC20 from '../../build/ERC20.json'
import WETH9 from '../../build/WETH9.json'
import DXswapFactory from '../../build/DXswapFactory.json'
import DXswapPair from '../../build/DXswapPair.json'
import DXswapDeployer from '../../build/DXswapDeployer.json'
import DXswapFeeSetter from '../../build/DXswapFeeSetter.json'
import DXswapFeeReceiver from '../../build/DXswapFeeReceiver.json'

interface FactoryFixture {
  factory: Contract
  feeSetter: Contract
  feeReceiver: Contract
  WETH: Contract
}

const overrides = {
  gasLimit: 9999999
}

export async function factoryFixture(provider: Web3Provider, [dxdao, ethReceiver]: Wallet[]): Promise<FactoryFixture> {
  const WETH = await deployContract(dxdao, WETH9)
  const dxSwapDeployer = await deployContract(
    dxdao, DXswapDeployer, [ethReceiver.address, dxdao.address, WETH.address, [], [], [],], overrides
  )
  await dxdao.sendTransaction({ to: dxSwapDeployer.address, gasPrice: 0, value: 1 })
  const deployTx = await dxSwapDeployer.deploy()
  const deployTxReceipt = await provider.getTransactionReceipt(deployTx.hash);
  const factoryAddress = deployTxReceipt.logs !== undefined
    ? defaultAbiCoder.decode(['address'], deployTxReceipt.logs[0].data)[0]
    : null
  const factory = new Contract(factoryAddress, JSON.stringify(DXswapFactory.abi), provider).connect(dxdao)
  const feeSetterAddress = await factory.feeToSetter()
  const feeSetter = new Contract(feeSetterAddress, JSON.stringify(DXswapFeeSetter.abi), provider).connect(dxdao)
  const feeReceiverAddress = await factory.feeTo()
  const feeReceiver = new Contract(feeReceiverAddress, JSON.stringify(DXswapFeeReceiver.abi), provider).connect(dxdao)
  return { factory, feeSetter, feeReceiver, WETH }
}

interface PairFixture extends FactoryFixture {
  token0: Contract
  token1: Contract
  pair: Contract
  wethToken0Pair: Contract
  wethToken1Pair: Contract
}

export async function pairFixture(provider: Web3Provider, [dxdao, wallet, ethReceiver]: Wallet[]): Promise<PairFixture> {
  const tokenA = await deployContract(wallet, ERC20, [expandTo18Decimals(10000)], overrides)
  const tokenB = await deployContract(wallet, ERC20, [expandTo18Decimals(10000)], overrides)
  const WETH = await deployContract(wallet, WETH9)
  await WETH.deposit({ value: expandTo18Decimals(1000) })
  const token0 = tokenA.address < tokenB.address ? tokenA : tokenB
  const token1 = token0.address === tokenA.address ? tokenB : tokenA

  const dxSwapDeployer = await deployContract(
    dxdao, DXswapDeployer, [
    ethReceiver.address,
    dxdao.address,
    WETH.address,
    [token0.address, token0.address, token1.address],
    [token1.address, WETH.address, WETH.address],
    [15, 15, 15],
  ], overrides
  )
  await dxdao.sendTransaction({ to: dxSwapDeployer.address, gasPrice: 0, value: 1 })
  const deployTx = await dxSwapDeployer.deploy()
  const deployTxReceipt = await provider.getTransactionReceipt(deployTx.hash);
  const factoryAddress = deployTxReceipt.logs !== undefined
    ? defaultAbiCoder.decode(['address'], deployTxReceipt.logs[0].data)[0]
    : null

  const factory = new Contract(factoryAddress, JSON.stringify(DXswapFactory.abi), provider).connect(dxdao)
  const feeSetterAddress = await factory.feeToSetter()
  const feeSetter = new Contract(feeSetterAddress, JSON.stringify(DXswapFeeSetter.abi), provider).connect(dxdao)
  const feeReceiverAddress = await factory.feeTo()
  const feeReceiver = new Contract(feeReceiverAddress, JSON.stringify(DXswapFeeReceiver.abi), provider).connect(dxdao)
  const pair = new Contract(
    await factory.getPair(token0.address, token1.address),
    JSON.stringify(DXswapPair.abi), provider
  ).connect(dxdao)
  const wethToken0Pair = new Contract(
    await factory.getPair(token0.address, WETH.address),
    JSON.stringify(DXswapPair.abi), provider
  ).connect(dxdao)
  const wethToken1Pair = new Contract(
    await factory.getPair(token1.address, WETH.address),
    JSON.stringify(DXswapPair.abi), provider
  ).connect(dxdao)

  return { factory, feeSetter, feeReceiver, WETH, token0, token1, pair, wethToken0Pair, wethToken1Pair }
}
