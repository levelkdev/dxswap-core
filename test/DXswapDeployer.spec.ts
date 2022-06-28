import '@nomiclabs/hardhat-ethers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { ethers } from "hardhat";
import { expandTo18Decimals } from './shared/utilities'
import { DXswapDeployer__factory, DXswapFactory__factory, DXswapPair__factory, ERC20, ERC20__factory, WETH9__factory } from './../typechain'
import { defaultAbiCoder } from 'ethers/lib/utils';

const overrides = {
  gasLimit: 29999999
}

describe('DXswapDeployer', () => {
  const provider = ethers.provider

  let token0: ERC20
  let token1: ERC20
  let token2: ERC20
  let dxdao: SignerWithAddress
  let tokenOwner: SignerWithAddress
  let protocolFeeReceiver: SignerWithAddress
  let other: SignerWithAddress

  beforeEach('assign wallets', async function () {
    const signers = await ethers.getSigners()
    dxdao = signers[0]
    tokenOwner = signers[1]
    protocolFeeReceiver = signers[2]
    other = signers[3]
  })

  it('Execute migration with intial pairs', async () => {
    // deploy tokens for testing
    const tokenA = await new ERC20__factory(tokenOwner).deploy(expandTo18Decimals(20000))
    const tokenB = await new ERC20__factory(tokenOwner).deploy(expandTo18Decimals(20000))
    const tokenC = await new ERC20__factory(tokenOwner).deploy(expandTo18Decimals(20000))

    const WETH = await new WETH9__factory(tokenOwner).deploy()
    token0 = tokenA.address < tokenB.address ? tokenA : tokenB
    token1 = token0.address === tokenA.address ? tokenB : tokenA
    token2 = tokenC

    const dxSwapDeployer = await new DXswapDeployer__factory(tokenOwner).deploy(protocolFeeReceiver.address, dxdao.address, WETH.address,
      [token0.address, token0.address, token1.address],
      [token1.address, token2.address, token2.address],
      [10, 20, 30],
      overrides)

    expect(await dxSwapDeployer.state()).to.eq(0)

    // Dont allow other address to approve deployment by sending eth
    await expect(other.sendTransaction({ to: dxSwapDeployer.address, gasPrice: 20000000000, value: expandTo18Decimals(10) }))
      .to.be.revertedWith('DXswapDeployer: CALLER_NOT_FEE_TO_SETTER')

    // Dont allow deploy before being approved by sending ETH
    await expect(dxSwapDeployer.connect(other).deploy())
      .to.be.revertedWith('DXswapDeployer: WRONG_DEPLOYER_STATE')

    // Send transaction with value from dxdao to approve deployment
    await dxdao.sendTransaction({ to: dxSwapDeployer.address, gasPrice: 20000000000, value: expandTo18Decimals(10) })
    expect(await dxSwapDeployer.state()).to.eq(1)

    // Dont allow sending more value
    await expect(dxdao.sendTransaction({ to: dxSwapDeployer.address, gasPrice: 20000000000, value: expandTo18Decimals(10) }))
      .to.be.revertedWith('DXswapDeployer: WRONG_DEPLOYER_STATE')
    await expect(other.sendTransaction({ to: dxSwapDeployer.address, gasPrice: 20000000000, value: expandTo18Decimals(10) }))
      .to.be.revertedWith('DXswapDeployer: WRONG_DEPLOYER_STATE')

    // Execute deployment transaction
    const deployTx = await dxSwapDeployer.connect(other).deploy()
    expect(await dxSwapDeployer.state()).to.eq(2)
    const deployTxReceipt = await provider.getTransactionReceipt(deployTx.hash);

    // Dont allow sending more value
    await expect(dxdao.sendTransaction({ to: dxSwapDeployer.address, gasPrice: 20000000000, value: expandTo18Decimals(10) }))
      .to.be.revertedWith('DXswapDeployer: WRONG_DEPLOYER_STATE')
    await expect(other.sendTransaction({ to: dxSwapDeployer.address, gasPrice: 20000000000, value: expandTo18Decimals(10) }))
      .to.be.revertedWith('DXswapDeployer: WRONG_DEPLOYER_STATE')

    // Dont allow running deployment again
    await expect(dxSwapDeployer.connect(other).deploy()).to.be.revertedWith('DXswapDeployer: WRONG_DEPLOYER_STATE')

    // Get addresses from events
    const pairFactoryAddress = deployTxReceipt.logs != undefined
      ? defaultAbiCoder.decode(['address'], deployTxReceipt.logs[0].data)[0]
      : null
    const pair01Address = deployTxReceipt.logs != undefined
      ? defaultAbiCoder.decode(['address'], deployTxReceipt.logs[2].data)[0]
      : null
    const pair02Address = deployTxReceipt.logs != undefined
      ? defaultAbiCoder.decode(['address'], deployTxReceipt.logs[4].data)[0]
      : null
    const pair12Address = deployTxReceipt.logs != undefined
      ? defaultAbiCoder.decode(['address'], deployTxReceipt.logs[6].data)[0]
      : null
    const feeReceiverAddress = deployTxReceipt.logs != undefined
      ? defaultAbiCoder.decode(['address'], deployTxReceipt.logs[7].data)[0]
      : null
    const feeSetterAddress = deployTxReceipt.logs != undefined
      ? defaultAbiCoder.decode(['address'], deployTxReceipt.logs[8].data)[0]
      : null

    // deploy DXswapFactory
    const dxswapFactory = (await new DXswapFactory__factory(tokenOwner).deploy(dxdao.address)).attach(pairFactoryAddress)
    // initialize DXswapPair factory
    const pairFactory = await new DXswapPair__factory(tokenOwner).deploy()

    // create pairs
    const addressPair01 = await dxswapFactory.getPair(token0.address, token1.address)
    const pair01 = pairFactory.attach(addressPair01)

    const addressPair02 = await dxswapFactory.getPair(token0.address, token2.address)
    const pair02 = pairFactory.attach(addressPair02)

    const addressPair12 = await dxswapFactory.getPair(token1.address, token2.address)
    const pair12 = pairFactory.attach(addressPair12)

    // Conpare onchain information to offchain predicted information
    expect(await dxswapFactory.feeTo()).to.eq(feeReceiverAddress)
    expect(await dxswapFactory.feeToSetter()).to.eq(feeSetterAddress)
    expect(await dxswapFactory.protocolFeeDenominator()).to.eq(9)
    expect(await dxswapFactory.allPairsLength()).to.eq(3)

    expect(pair01.address).to.eq(pair01Address)
    expect(await pair01.swapFee()).to.eq(10)
    expect(await pair01.token0()).to.eq(token0.address)
    expect(await pair01.token1()).to.eq(token1.address)
    expect(await pair01.totalSupply()).to.eq(0)

    expect(pair02.address).to.eq(pair02Address)
    expect(await pair02.swapFee()).to.eq(20)
    expect(await pair02.token0()).to.eq(token0.address)
    expect(await pair02.token1()).to.eq(token2.address)
    expect(await pair02.totalSupply()).to.eq(0)

    expect(pair12.address).to.eq(pair12Address)
    expect(await pair12.swapFee()).to.eq(30)
    expect(await pair12.token0()).to.eq(token1.address)
    expect(await pair12.token1()).to.eq(token2.address)
    expect(await pair12.totalSupply()).to.eq(0)

  })

})
