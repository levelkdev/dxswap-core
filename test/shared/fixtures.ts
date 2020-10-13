import { Contract, Wallet } from 'ethers'
import { Web3Provider } from 'ethers/providers'
import { defaultAbiCoder } from 'ethers/utils'
import { deployContract } from 'ethereum-waffle'

import { expandTo18Decimals } from './utilities'

import ERC20 from '../../build/contracts/ERC20.json'
import DXswapFactory from '../../build/contracts/DXswapFactory.json'
import DXswapPair from '../../build/contracts/DXswapPair.json'
import DXswapDeployer from '../../build/contracts/DXswapDeployer.json'
import DXswapFeeSetter from '../../build/contracts/DXswapFeeSetter.json'

interface FactoryFixture {
  factory: Contract
  feeSetter: Contract
}

const overrides = {
  gasLimit: 9999999
}

export async function factoryFixture(provider: Web3Provider, [dxdao]: Wallet[]): Promise<FactoryFixture> {
  const dxSwapDeployer = await deployContract(dxdao, DXswapDeployer, [ dxdao.address, [], [], [], ], overrides)
  await dxdao.sendTransaction({to: dxSwapDeployer.address, gasPrice: 0, value: 1})
  const deployTx = await dxSwapDeployer.deploy()
  const deployTxReceipt = await provider.getTransactionReceipt(deployTx.hash);
  const factoryAddress = deployTxReceipt.logs !== undefined
    ? defaultAbiCoder.decode(['address'], deployTxReceipt.logs[0].data)[0]
    : null
  const factory = new Contract(factoryAddress, JSON.stringify(DXswapFactory.abi), provider).connect(dxdao)
  const feeSetterAddress = await factory.feeToSetter()
  const feeSetter = new Contract(feeSetterAddress, JSON.stringify(DXswapFeeSetter.abi), provider).connect(dxdao)
  return { factory, feeSetter }
}

interface PairFixture extends FactoryFixture {
  token0: Contract
  token1: Contract
  pair: Contract
}

export async function pairFixture(provider: Web3Provider, [dxdao]: Wallet[]): Promise<PairFixture> {
  const tokenA = await deployContract(dxdao, ERC20, [expandTo18Decimals(10000)], overrides)
  const tokenB = await deployContract(dxdao, ERC20, [expandTo18Decimals(10000)], overrides)
  
  const dxSwapDeployer = await deployContract(
    dxdao, DXswapDeployer, [
      dxdao.address,
      [tokenA.address],
      [tokenB.address],
      [15],
    ], overrides
  )
  await dxdao.sendTransaction({to: dxSwapDeployer.address, gasPrice: 0, value: 1})
  const deployTx = await dxSwapDeployer.deploy()
  const deployTxReceipt = await provider.getTransactionReceipt(deployTx.hash);
  const factoryAddress = deployTxReceipt.logs !== undefined
    ? defaultAbiCoder.decode(['address'], deployTxReceipt.logs[0].data)[0]
    : null
  
  const factory = new Contract(factoryAddress, JSON.stringify(DXswapFactory.abi), provider).connect(dxdao)
  const feeSetterAddress = await factory.feeToSetter()
  const feeSetter = new Contract(feeSetterAddress, JSON.stringify(DXswapFeeSetter.abi), provider).connect(dxdao)
  const pairAddress = await factory.getPair(tokenA.address, tokenB.address)
  const pair = new Contract(pairAddress, JSON.stringify(DXswapPair.abi), provider).connect(dxdao)

  const token0Address = await pair.token0()
  const token0 = tokenA.address === token0Address ? tokenA : tokenB
  const token1 = tokenA.address === token0Address ? tokenB : tokenA

  return { factory, feeSetter, token0, token1, pair }
}
