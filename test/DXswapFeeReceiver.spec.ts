import chai, { expect } from 'chai'
import { Contract } from 'ethers'
import { AddressZero } from 'ethers/constants'
import { BigNumber, bigNumberify } from 'ethers/utils'
import { solidity, MockProvider, createFixtureLoader, deployContract } from 'ethereum-waffle'

import { expandTo18Decimals, getCreate2Address } from './shared/utilities'
import { pairFixture } from './shared/fixtures'

import DXswapPair from '../build/DXswapPair.json'
import ERC20 from '../build/ERC20.json'
import DXswapFeeReceiver from '../build/DXswapFeeReceiver.json'

const FEE_DENOMINATOR = bigNumberify(10).pow(4)
const ROUND_EXCEPTION = bigNumberify(10).pow(4)

chai.use(solidity)

const TEST_ADDRESSES: [string, string] = [
  '0x1000000000000000000000000000000000000000',
  '0x2000000000000000000000000000000000000000'
]

describe('DXswapFeeReceiver', () => {
  const provider = new MockProvider({
    hardfork: 'istanbul',
    mnemonic: 'horn horn horn horn horn horn horn horn horn horn horn horn',
    gasLimit: 15000000
  })
  const overrides = {
    gasLimit: 15000000
  }
  const [dxdao, wallet, protocolFeeReceiver, other, externalFeeRecipient] = provider.getWallets()
  const loadFixture = createFixtureLoader(provider, [dxdao, wallet, protocolFeeReceiver])

  async function getAmountOut(pair: Contract, tokenIn: string, amountIn: BigNumber) {
    const [reserve0, reserve1] = await pair.getReserves()
    const token0 = await pair.token0()
    return getAmountOutSync(reserve0, reserve1, token0 === tokenIn, amountIn, await pair.swapFee())
  }

  function getAmountOutSync(
    reserve0: BigNumber, reserve1: BigNumber, usingToken0: boolean, amountIn: BigNumber, swapFee: BigNumber
  ) {
    const tokenInBalance = usingToken0 ? reserve0 : reserve1
    const tokenOutBalance = usingToken0 ? reserve1 : reserve0
    const amountInWithFee = amountIn.mul(FEE_DENOMINATOR.sub(swapFee))
    return amountInWithFee.mul(tokenOutBalance)
      .div(tokenInBalance.mul(FEE_DENOMINATOR).add(amountInWithFee))
  }

  // Calculate how much will be payed from liquidity as protocol fee in the next mint/burn
  async function calcProtocolFee(pair: Contract) {
    const [token0Reserve, token1Reserve, _] = await pair.getReserves()
    const kLast = await pair.kLast()
    const feeTo = await factory.feeTo()
    const protocolFeeDenominator = await factory.protocolFeeDenominator()
    const totalSupply = await pair.totalSupply()
    let rootK, rootKLast;
    if (feeTo != AddressZero) {
      // Check for math overflow when dealing with big big balances
      if (Math.sqrt((token0Reserve).mul(token1Reserve)) > Math.pow(10, 19)) {
        const denominator = 10 ** (Number(Math.log10(Math.sqrt((token0Reserve).mul(token1Reserve))).toFixed(0)) - 18);
        rootK = bigNumberify((Math.sqrt(
          token0Reserve.mul(token1Reserve)
        ) / denominator).toString())
        rootKLast = bigNumberify((Math.sqrt(kLast) / denominator).toString())
      } else {
        rootK = bigNumberify(Math.sqrt((token0Reserve).mul(token1Reserve)).toString())
        rootKLast = bigNumberify(Math.sqrt(kLast).toString())
      }

      return (totalSupply.mul(rootK.sub(rootKLast)))
        .div(rootK.mul(protocolFeeDenominator).add(rootKLast))
    } else {
      return bigNumberify(0)
    }
  }

  let factory: Contract
  let token0: Contract
  let token1: Contract
  let pair: Contract
  let wethToken0Pair: Contract
  let wethToken1Pair: Contract
  let WETH: Contract
  let feeSetter: Contract
  let feeReceiver: Contract
  beforeEach(async () => {
    const fixture = await loadFixture(pairFixture)
    factory = fixture.factory
    token0 = fixture.token0
    token1 = fixture.token1
    pair = fixture.pair
    wethToken0Pair = fixture.wethToken0Pair
    wethToken1Pair = fixture.wethToken1Pair
    WETH = fixture.WETH
    feeSetter = fixture.feeSetter
    feeReceiver = fixture.feeReceiver
  })

  // Where token0-token1 and token1-WETH pairs exist
  it(
    'should receive token0 to fallbackreceiver and ETH to ethReceiver when extracting fee from token0-token1',
    async () => {
      const tokenAmount = expandTo18Decimals(100);
      const wethAmount = expandTo18Decimals(100);
      const amountIn = expandTo18Decimals(10);

      await token0.transfer(pair.address, tokenAmount)
      await token1.transfer(pair.address, tokenAmount)
      await pair.mint(wallet.address, overrides)

      await token1.transfer(wethToken1Pair.address, tokenAmount)
      await WETH.transfer(wethToken1Pair.address, wethAmount)
      await wethToken1Pair.mint(wallet.address, overrides)

      let amountOut = await getAmountOut(pair, token0.address, amountIn);

      await token0.transfer(pair.address, amountIn)
      await pair.swap(0, amountOut, wallet.address, '0x', overrides)

      amountOut = await getAmountOut(pair, token1.address, amountIn);
      await token1.transfer(pair.address, amountIn)
      await pair.swap(amountOut, 0, wallet.address, '0x', overrides)

      const protocolFeeToReceive = await calcProtocolFee(pair);

      await token0.transfer(pair.address, expandTo18Decimals(10))
      await token1.transfer(pair.address, expandTo18Decimals(10))
      await pair.mint(wallet.address, overrides)

      const protocolFeeLPToknesReceived = await pair.balanceOf(feeReceiver.address);
      expect(protocolFeeLPToknesReceived.div(ROUND_EXCEPTION))
        .to.be.eq(protocolFeeToReceive.div(ROUND_EXCEPTION))

      const token0FromProtocolFee = protocolFeeLPToknesReceived
        .mul(await token0.balanceOf(pair.address)).div(await pair.totalSupply());
      const token1FromProtocolFee = protocolFeeLPToknesReceived
        .mul(await token1.balanceOf(pair.address)).div(await pair.totalSupply());

      const wethFromToken1FromProtocolFee = await getAmountOut(wethToken1Pair, token1.address, token1FromProtocolFee);

      const protocolFeeReceiverBalanceBeforeTake = await provider.getBalance(protocolFeeReceiver.address)

      await feeReceiver.connect(wallet).takeProtocolFee([pair.address], overrides)

      expect(await token0.balanceOf(feeReceiver.address)).to.eq(0)
      expect(await token1.balanceOf(feeReceiver.address)).to.eq(0)
      expect(await WETH.balanceOf(feeReceiver.address)).to.eq(0)
      expect(await pair.balanceOf(feeReceiver.address)).to.eq(0)
      expect(await provider.getBalance(feeReceiver.address)).to.eq(0)

      expect((await token0.balanceOf(dxdao.address)))
        .to.be.eq(token0FromProtocolFee)
      expect((await provider.getBalance(protocolFeeReceiver.address)))
        .to.be.eq(protocolFeeReceiverBalanceBeforeTake.add(wethFromToken1FromProtocolFee))
    })

  it('should receive everything in ETH from one WETH-token1 pair', async () => {

    const tokenAmount = expandTo18Decimals(100);
    const wethAmount = expandTo18Decimals(100);
    const amountIn = expandTo18Decimals(50);

    await token1.transfer(wethToken1Pair.address, tokenAmount)
    await WETH.transfer(wethToken1Pair.address, wethAmount)
    await wethToken1Pair.mint(wallet.address, overrides)

    const token1IsFirstToken = (token1.address < WETH.address)

    let amountOut = await getAmountOut(wethToken1Pair, token1.address, amountIn);
    await token1.transfer(wethToken1Pair.address, amountIn)
    await wethToken1Pair.swap(
      token1IsFirstToken ? 0 : amountOut,
      token1IsFirstToken ? amountOut : 0,
      wallet.address, '0x', overrides
    )

    amountOut = await getAmountOut(wethToken1Pair, WETH.address, amountIn);
    await WETH.transfer(wethToken1Pair.address, amountIn)
    await wethToken1Pair.swap(
      token1IsFirstToken ? amountOut : 0,
      token1IsFirstToken ? 0 : amountOut,
      wallet.address, '0x', overrides
    )

    const protocolFeeToReceive = await calcProtocolFee(wethToken1Pair);

    await token1.transfer(wethToken1Pair.address, expandTo18Decimals(10))
    await WETH.transfer(wethToken1Pair.address, expandTo18Decimals(10))
    await wethToken1Pair.mint(wallet.address, overrides)

    const protocolFeeLPToknesReceived = await wethToken1Pair.balanceOf(feeReceiver.address);
    expect(protocolFeeLPToknesReceived.div(ROUND_EXCEPTION))
      .to.be.eq(protocolFeeToReceive.div(ROUND_EXCEPTION))

    const token1FromProtocolFee = protocolFeeLPToknesReceived
      .mul(await token1.balanceOf(wethToken1Pair.address)).div(await wethToken1Pair.totalSupply());
    const wethFromProtocolFee = protocolFeeLPToknesReceived
      .mul(await WETH.balanceOf(wethToken1Pair.address)).div(await wethToken1Pair.totalSupply());

    const token1ReserveBeforeSwap = (await token1.balanceOf(wethToken1Pair.address)).sub(token1FromProtocolFee)
    const wethReserveBeforeSwap = (await WETH.balanceOf(wethToken1Pair.address)).sub(wethFromProtocolFee)
    const wethFromToken1FromProtocolFee = await getAmountOutSync(
      token1IsFirstToken ? token1ReserveBeforeSwap : wethReserveBeforeSwap,
      token1IsFirstToken ? wethReserveBeforeSwap : token1ReserveBeforeSwap,
      token1IsFirstToken,
      token1FromProtocolFee,
      await wethToken1Pair.swapFee()
    );

    const protocolFeeReceiverBalanceBeforeTake = await provider.getBalance(protocolFeeReceiver.address)

    await feeReceiver.connect(wallet).takeProtocolFee([wethToken1Pair.address], overrides)

    expect(await token1.balanceOf(feeReceiver.address)).to.eq(0)
    expect(await WETH.balanceOf(feeReceiver.address)).to.eq(0)
    expect(await wethToken1Pair.balanceOf(feeReceiver.address)).to.eq(0)
    expect(await provider.getBalance(feeReceiver.address)).to.eq(0)

    expect(await token1.balanceOf(dxdao.address)).to.be.eq(0)
    expect((await provider.getBalance(protocolFeeReceiver.address)))
      .to.be.eq(protocolFeeReceiverBalanceBeforeTake.add(wethFromToken1FromProtocolFee).add(wethFromProtocolFee))
  })

  it(
    'should receive only tokens when extracting fee from tokenA-tokenB pair that has no path to WETH',
    async () => {
      const tokenA = await deployContract(wallet, ERC20, [expandTo18Decimals(10000)], overrides)
      const tokenB = await deployContract(wallet, ERC20, [expandTo18Decimals(10000)], overrides)

      const tokenAmount = expandTo18Decimals(100);
      const amountIn = expandTo18Decimals(50);

      await factory.createPair(tokenA.address, tokenB.address);
      const tokenATokenBPair = new Contract(
        await factory.getPair(
          (tokenA.address < tokenB.address) ? tokenA.address : tokenB.address,
          (tokenA.address < tokenB.address) ? tokenB.address : tokenA.address
        ), JSON.stringify(DXswapPair.abi), provider
      ).connect(wallet)

      await tokenA.transfer(tokenATokenBPair.address, tokenAmount)
      await tokenB.transfer(tokenATokenBPair.address, tokenAmount)
      await tokenATokenBPair.mint(wallet.address, overrides)

      let amountOut = await getAmountOut(tokenATokenBPair, tokenA.address, amountIn);
      await tokenA.transfer(tokenATokenBPair.address, amountIn)
      await tokenATokenBPair.swap(
        (tokenA.address < tokenB.address) ? 0 : amountOut,
        (tokenA.address < tokenB.address) ? amountOut : 0,
        wallet.address, '0x', overrides
      )

      amountOut = await getAmountOut(tokenATokenBPair, tokenB.address, amountIn);
      await tokenB.transfer(tokenATokenBPair.address, amountIn)
      await tokenATokenBPair.swap(
        (tokenA.address < tokenB.address) ? amountOut : 0,
        (tokenA.address < tokenB.address) ? 0 : amountOut,
        wallet.address, '0x', overrides
      )

      const protocolFeeToReceive = await calcProtocolFee(tokenATokenBPair);

      await tokenA.transfer(tokenATokenBPair.address, expandTo18Decimals(10))
      await tokenB.transfer(tokenATokenBPair.address, expandTo18Decimals(10))
      await tokenATokenBPair.mint(wallet.address, overrides)

      const protocolFeeLPTokenAtokenBPair = await tokenATokenBPair.balanceOf(feeReceiver.address);
      expect(protocolFeeLPTokenAtokenBPair.div(ROUND_EXCEPTION))
        .to.be.eq(protocolFeeToReceive.div(ROUND_EXCEPTION))

      const tokenAFromProtocolFee = protocolFeeLPTokenAtokenBPair
        .mul(await tokenA.balanceOf(tokenATokenBPair.address)).div(await tokenATokenBPair.totalSupply());
      const tokenBFromProtocolFee = protocolFeeLPTokenAtokenBPair
        .mul(await tokenB.balanceOf(tokenATokenBPair.address)).div(await tokenATokenBPair.totalSupply());

      const protocolFeeReceiverBalance = await provider.getBalance(protocolFeeReceiver.address)

      await feeReceiver.connect(wallet).takeProtocolFee([tokenATokenBPair.address], overrides)

      expect(await tokenA.balanceOf(feeReceiver.address)).to.eq(0)
      expect(await tokenB.balanceOf(feeReceiver.address)).to.eq(0)
      expect(await WETH.balanceOf(feeReceiver.address)).to.eq(0)
      expect(await tokenATokenBPair.balanceOf(feeReceiver.address)).to.eq(0)
      expect(await provider.getBalance(feeReceiver.address)).to.eq(0)

      expect((await provider.getBalance(protocolFeeReceiver.address)))
        .to.be.eq(protocolFeeReceiverBalance)
      expect((await tokenA.balanceOf(dxdao.address)))
        .to.be.eq(tokenAFromProtocolFee)
      expect((await tokenB.balanceOf(dxdao.address)))
        .to.be.eq(tokenBFromProtocolFee)
    })

  it(
    'should receive only tokens when extracting fee from both tokenA-tonkenB pair and tokenC-tokenD pair',
    async () => {
      const tokenAmount = expandTo18Decimals(100);
      const amountIn = expandTo18Decimals(50);

      // Set up tokenA-tokenB
      const tokenA = await deployContract(wallet, ERC20, [expandTo18Decimals(10000)], overrides)
      const tokenB = await deployContract(wallet, ERC20, [expandTo18Decimals(10000)], overrides)

      await factory.createPair(tokenA.address, tokenB.address);
      const tokenATokenBPair = new Contract(
        await factory.getPair(
          (tokenA.address < tokenB.address) ? tokenA.address : tokenB.address,
          (tokenA.address < tokenB.address) ? tokenB.address : tokenA.address
        ), JSON.stringify(DXswapPair.abi), provider
      ).connect(wallet)

      await tokenA.transfer(tokenATokenBPair.address, tokenAmount)
      await tokenB.transfer(tokenATokenBPair.address, tokenAmount)
      await tokenATokenBPair.mint(wallet.address, overrides)

      let amountOut = await getAmountOut(tokenATokenBPair, tokenA.address, amountIn);
      await tokenA.transfer(tokenATokenBPair.address, amountIn)
      await tokenATokenBPair.swap(
        (tokenA.address < tokenB.address) ? 0 : amountOut,
        (tokenA.address < tokenB.address) ? amountOut : 0,
        wallet.address, '0x', overrides
      )

      amountOut = await getAmountOut(tokenATokenBPair, tokenB.address, amountIn);
      await tokenB.transfer(tokenATokenBPair.address, amountIn)
      await tokenATokenBPair.swap(
        (tokenA.address < tokenB.address) ? amountOut : 0,
        (tokenA.address < tokenB.address) ? 0 : amountOut,
        wallet.address, '0x', overrides
      )

      let protocolFeeToReceive = await calcProtocolFee(tokenATokenBPair);

      await tokenA.transfer(tokenATokenBPair.address, expandTo18Decimals(10))
      await tokenB.transfer(tokenATokenBPair.address, expandTo18Decimals(10))
      await tokenATokenBPair.mint(wallet.address, overrides)

      const protocolFeeLPTokenAtokenBPair = await tokenATokenBPair.balanceOf(feeReceiver.address);
      expect(protocolFeeLPTokenAtokenBPair.div(ROUND_EXCEPTION))
        .to.be.eq(protocolFeeToReceive.div(ROUND_EXCEPTION))

      // Set up tokenC-tokenD pair
      const tokenC = await deployContract(wallet, ERC20, [expandTo18Decimals(10000)], overrides)
      const tokenD = await deployContract(wallet, ERC20, [expandTo18Decimals(10000)], overrides)

      await factory.createPair(tokenC.address, tokenD.address);
      const tokenCTokenDPair = new Contract(
        await factory.getPair(
          (tokenC.address < tokenD.address) ? tokenC.address : tokenD.address,
          (tokenC.address < tokenD.address) ? tokenD.address : tokenC.address
        ), JSON.stringify(DXswapPair.abi), provider
      ).connect(wallet)

      await tokenC.transfer(tokenCTokenDPair.address, tokenAmount)
      await tokenD.transfer(tokenCTokenDPair.address, tokenAmount)
      await tokenCTokenDPair.mint(wallet.address, overrides)

      amountOut = await getAmountOut(tokenCTokenDPair, tokenC.address, amountIn);
      await tokenC.transfer(tokenCTokenDPair.address, amountIn)
      await tokenCTokenDPair.swap(
        (tokenC.address < tokenD.address) ? 0 : amountOut,
        (tokenC.address < tokenD.address) ? amountOut : 0,
        wallet.address, '0x', overrides
      )

      amountOut = await getAmountOut(tokenCTokenDPair, tokenD.address, amountIn);
      await tokenD.transfer(tokenCTokenDPair.address, amountIn)
      await tokenCTokenDPair.swap(
        (tokenC.address < tokenD.address) ? amountOut : 0,
        (tokenC.address < tokenD.address) ? 0 : amountOut,
        wallet.address, '0x', overrides
      )

      protocolFeeToReceive = await calcProtocolFee(tokenCTokenDPair);

      await tokenC.transfer(tokenCTokenDPair.address, expandTo18Decimals(10))
      await tokenD.transfer(tokenCTokenDPair.address, expandTo18Decimals(10))
      await tokenCTokenDPair.mint(wallet.address, overrides)

      const protocolFeeLPTokenCtokenDPair = await tokenCTokenDPair.balanceOf(feeReceiver.address);
      expect(protocolFeeLPTokenCtokenDPair.div(ROUND_EXCEPTION))
        .to.be.eq(protocolFeeToReceive.div(ROUND_EXCEPTION))

      const tokenAFromProtocolFee = protocolFeeLPTokenAtokenBPair
        .mul(await tokenA.balanceOf(tokenATokenBPair.address)).div(await tokenATokenBPair.totalSupply());
      const tokenBFromProtocolFee = protocolFeeLPTokenAtokenBPair
        .mul(await tokenB.balanceOf(tokenATokenBPair.address)).div(await tokenATokenBPair.totalSupply());
      const tokenCFromProtocolFee = protocolFeeLPTokenCtokenDPair
        .mul(await tokenC.balanceOf(tokenCTokenDPair.address)).div(await tokenCTokenDPair.totalSupply());
      const tokenDFromProtocolFee = protocolFeeLPTokenCtokenDPair
        .mul(await tokenD.balanceOf(tokenCTokenDPair.address)).div(await tokenCTokenDPair.totalSupply());

      const protocolFeeReceiverBalance = await provider.getBalance(protocolFeeReceiver.address)

      await feeReceiver.connect(wallet).takeProtocolFee([tokenATokenBPair.address, tokenCTokenDPair.address], overrides)

      expect(await provider.getBalance(protocolFeeReceiver.address)).to.eq(protocolFeeReceiverBalance.toString())

      expect(await tokenA.balanceOf(feeReceiver.address)).to.eq(0)
      expect(await tokenB.balanceOf(feeReceiver.address)).to.eq(0)
      expect(await tokenC.balanceOf(feeReceiver.address)).to.eq(0)
      expect(await tokenD.balanceOf(feeReceiver.address)).to.eq(0)
      expect(await WETH.balanceOf(feeReceiver.address)).to.eq(0)
      expect(await pair.balanceOf(feeReceiver.address)).to.eq(0)
      expect(await provider.getBalance(feeReceiver.address)).to.eq(0)

      expect((await provider.getBalance(protocolFeeReceiver.address)))
        .to.be.eq(protocolFeeReceiverBalance)
      expect((await tokenA.balanceOf(dxdao.address)))
        .to.be.eq(tokenAFromProtocolFee)
      expect((await tokenB.balanceOf(dxdao.address)))
        .to.be.eq(tokenBFromProtocolFee)
      expect((await tokenC.balanceOf(dxdao.address)))
        .to.be.eq(tokenCFromProtocolFee)
      expect((await tokenD.balanceOf(dxdao.address)))
        .to.be.eq(tokenDFromProtocolFee)
    })

  it(
    'should only allow owner to transfer ownership',
    async () => {
      await expect(feeReceiver.connect(other).transferOwnership(other.address))
        .to.be.revertedWith('DXswapFeeReceiver: FORBIDDEN')
      await feeReceiver.connect(dxdao).transferOwnership(other.address);
      expect(await feeReceiver.owner()).to.be.eq(other.address)
    })

  it(
    'should only allow owner to change receivers',
    async () => {
      await expect(feeReceiver.connect(other).changeReceivers(other.address, other.address))
        .to.be.revertedWith('DXswapFeeReceiver: FORBIDDEN')
      await feeReceiver.connect(dxdao).changeReceivers(other.address, other.address);
      expect(await feeReceiver.ethReceiver()).to.be.eq(other.address)
      expect(await feeReceiver.fallbackReceiver()).to.be.eq(other.address)
    })

  it(
    'should send token to fee receiver if there is not any liquidity in the WETH pair',
    async () => {
      const tokenAmount = expandTo18Decimals(100);
      const amountIn = expandTo18Decimals(50);

      await token0.transfer(pair.address, tokenAmount)
      await token1.transfer(pair.address, tokenAmount)
      await pair.mint(wallet.address, overrides)

      const amountOutToken0WETH = await getAmountOut(wethToken1Pair, token0.address, expandTo18Decimals(1));
      const amountOutToken1WETH = await getAmountOut(wethToken1Pair, token1.address, expandTo18Decimals(1));
      expect(amountOutToken0WETH).to.be.eq(0)
      expect(amountOutToken1WETH).to.be.eq(0)

      let amountOut = await getAmountOut(pair, token0.address, amountIn);
      await token0.transfer(pair.address, amountIn)
      await pair.swap(0, amountOut, wallet.address, '0x', overrides)

      amountOut = await getAmountOut(pair, token1.address, amountIn);
      await token1.transfer(pair.address, amountIn)
      await pair.swap(amountOut, 0, wallet.address, '0x', overrides)

      const protocolFeeToReceive = await calcProtocolFee(pair);

      await token0.transfer(pair.address, expandTo18Decimals(10))
      await token1.transfer(pair.address, expandTo18Decimals(10))
      await pair.mint(wallet.address, overrides)

      const protocolFeeLPToknesReceived = await pair.balanceOf(feeReceiver.address);
      expect(protocolFeeLPToknesReceived.div(ROUND_EXCEPTION))
        .to.be.eq(protocolFeeToReceive.div(ROUND_EXCEPTION))

      const protocolFeeReceiverBalance = await provider.getBalance(protocolFeeReceiver.address)

      await feeReceiver.connect(wallet).takeProtocolFee([pair.address], overrides)

      const token0FromProtocolFee = protocolFeeLPToknesReceived
        .mul(await token0.balanceOf(pair.address)).div(await pair.totalSupply());
      const token1FromProtocolFee = protocolFeeLPToknesReceived
        .mul(await token1.balanceOf(pair.address)).div(await pair.totalSupply());

      expect(await pair.balanceOf(feeReceiver.address)).to.eq(0)
      expect(await token0.balanceOf(feeReceiver.address)).to.eq(0)
      expect(await token1.balanceOf(feeReceiver.address)).to.eq(0)
      expect(await WETH.balanceOf(feeReceiver.address)).to.eq(0)
      expect(await provider.getBalance(feeReceiver.address)).to.eq(0)
      expect(await provider.getBalance(protocolFeeReceiver.address)).to.eq(protocolFeeReceiverBalance)

      expect((await token0.balanceOf(dxdao.address)))
        .to.be.eq(token0FromProtocolFee)
      expect((await token1.balanceOf(dxdao.address)))
        .to.be.eq(token1FromProtocolFee)
    })

  // Where token0-token1 and token1-WETH pairs exist AND PRICE IMPACT TOO HIGH 
  it(
    'should receive token0 and token1 if price impact token1-weth pool is too high',
    async () => {
      const tokenAmount = expandTo18Decimals(100);
      const amountIn = expandTo18Decimals(1);
      // add very small liquidity to weth-token1 pool
      const wethTknAmountLowLP = bigNumberify(1).mul(bigNumberify(10).pow(15));

      await token0.transfer(pair.address, tokenAmount)
      await token1.transfer(pair.address, tokenAmount)
      await pair.mint(wallet.address, overrides)

      await token1.transfer(wethToken1Pair.address, wethTknAmountLowLP)
      await WETH.transfer(wethToken1Pair.address, wethTknAmountLowLP)
      await wethToken1Pair.mint(wallet.address, overrides)

      let amountOut = await getAmountOut(pair, token0.address, amountIn);

      await token0.transfer(pair.address, amountIn)
      await pair.swap(0, amountOut, wallet.address, '0x', overrides)

      amountOut = await getAmountOut(pair, token1.address, amountIn);
      await token1.transfer(pair.address, amountIn)

      const protocolFeeToReceive = await calcProtocolFee(pair);

      await token0.transfer(pair.address, expandTo18Decimals(15))
      await token1.transfer(pair.address, expandTo18Decimals(15))
      await pair.mint(wallet.address, overrides)

      const protocolFeeLPToknesReceived = await pair.balanceOf(feeReceiver.address);
      expect(protocolFeeLPToknesReceived.div(ROUND_EXCEPTION))
        .to.be.eq(protocolFeeToReceive.div(ROUND_EXCEPTION))

      const token0FromProtocolFee = protocolFeeLPToknesReceived
        .mul(await token0.balanceOf(pair.address)).div(await pair.totalSupply());
      const token1FromProtocolFee = protocolFeeLPToknesReceived
        .mul(await token1.balanceOf(pair.address)).div(await pair.totalSupply());

      const wethFromToken1FromProtocolFee = await getAmountOut(wethToken1Pair, token1.address, token1FromProtocolFee);

      const protocolFeeReceiverBalanceBeforeTake = await provider.getBalance(protocolFeeReceiver.address)

      await feeReceiver.connect(wallet).takeProtocolFee([pair.address], overrides)

      expect(await token0.balanceOf(feeReceiver.address)).to.eq(0)
      expect(await token1.balanceOf(feeReceiver.address)).to.eq(0)
      expect(await WETH.balanceOf(feeReceiver.address)).to.eq(0)
      expect(await pair.balanceOf(feeReceiver.address)).to.eq(0)
      expect(await provider.getBalance(feeReceiver.address)).to.eq(0)

      expect((await provider.getBalance(protocolFeeReceiver.address)))
        .to.be.eq(protocolFeeReceiverBalanceBeforeTake)
      expect((await token0.balanceOf(dxdao.address)))
        .to.be.eq(token0FromProtocolFee)
      expect((await token1.balanceOf(dxdao.address)))
        .to.be.eq(token1FromProtocolFee)
    })

  it(
    'should only allow owner to set max price impact',
    async () => {
      await expect(feeReceiver.connect(other).setMaxSwapPriceImpact(500))
        .to.be.revertedWith('DXswapFeeReceiver: CALLER_NOT_OWNER')
      await feeReceiver.connect(dxdao).setMaxSwapPriceImpact(500);
      expect(await feeReceiver.maxSwapPriceImpact()).to.be.eq(500)
    })

  it(
    'should set max price impact within the range 0 - 10000',
    async () => {
      expect(await feeReceiver.maxSwapPriceImpact()).to.be.eq(100)
      await expect(feeReceiver.connect(dxdao).setMaxSwapPriceImpact(0))
        .to.be.revertedWith('DXswapFeeReceiver: FORBIDDEN_PRICE_IMPACT')
      await expect(feeReceiver.connect(dxdao).setMaxSwapPriceImpact(10000))
        .to.be.revertedWith('DXswapFeeReceiver: FORBIDDEN_PRICE_IMPACT')
      await feeReceiver.connect(dxdao).setMaxSwapPriceImpact(500);
      expect(await feeReceiver.maxSwapPriceImpact()).to.be.eq(500)
    })

  it(
    'should send tokenA & tokenB default 100% fee to dxdao and 0% fee to external receiver',
    async () => {
      const tokenAmount = expandTo18Decimals(100);
      const amountIn = expandTo18Decimals(50);

      // Set up tokenA-tokenB
      const tokenA = await deployContract(wallet, ERC20, [expandTo18Decimals(10000)], overrides)
      const tokenB = await deployContract(wallet, ERC20, [expandTo18Decimals(10000)], overrides)

      await factory.createPair(tokenA.address, tokenB.address)
      const tokenATokenBPair = new Contract(
        await factory.getPair(
          (tokenA.address < tokenB.address) ? tokenA.address : tokenB.address,
          (tokenA.address < tokenB.address) ? tokenB.address : tokenA.address
        ), JSON.stringify(DXswapPair.abi), provider
      ).connect(wallet)

      await feeSetter.setExternalFeeRecipient(tokenATokenBPair.address, externalFeeRecipient.address)

      await tokenA.transfer(tokenATokenBPair.address, tokenAmount)
      await tokenB.transfer(tokenATokenBPair.address, tokenAmount)
      await tokenATokenBPair.mint(wallet.address, overrides)

      let amountOut = await getAmountOut(tokenATokenBPair, tokenA.address, amountIn)
      await tokenA.transfer(tokenATokenBPair.address, amountIn)
      await tokenATokenBPair.swap(
        (tokenA.address < tokenB.address) ? 0 : amountOut,
        (tokenA.address < tokenB.address) ? amountOut : 0,
        wallet.address, '0x', overrides
      )

      amountOut = await getAmountOut(tokenATokenBPair, tokenB.address, amountIn)
      await tokenB.transfer(tokenATokenBPair.address, amountIn)
      await tokenATokenBPair.swap(
        (tokenA.address < tokenB.address) ? amountOut : 0,
        (tokenA.address < tokenB.address) ? 0 : amountOut,
        wallet.address, '0x', overrides
      )

      let protocolFeeToReceive = await calcProtocolFee(tokenATokenBPair);

      await tokenA.transfer(tokenATokenBPair.address, expandTo18Decimals(10))
      await tokenB.transfer(tokenATokenBPair.address, expandTo18Decimals(10))
      await tokenATokenBPair.mint(wallet.address, overrides)

      const protocolFeeLPTokenAtokenBPair = await tokenATokenBPair.balanceOf(feeReceiver.address);
      expect(protocolFeeLPTokenAtokenBPair.div(ROUND_EXCEPTION))
        .to.be.eq(protocolFeeToReceive.div(ROUND_EXCEPTION))

      const tokenAFromProtocolFee = protocolFeeLPTokenAtokenBPair
        .mul(await tokenA.balanceOf(tokenATokenBPair.address)).div(await tokenATokenBPair.totalSupply());
      const tokenBFromProtocolFee = protocolFeeLPTokenAtokenBPair
        .mul(await tokenB.balanceOf(tokenATokenBPair.address)).div(await tokenATokenBPair.totalSupply());

      const protocolFeeReceiverBalance = await provider.getBalance(protocolFeeReceiver.address)

      await feeReceiver.connect(wallet).takeProtocolFee([tokenATokenBPair.address], overrides)

      const percentFeeToExternalRecipient = await tokenATokenBPair.percentFeeToExternalRecipient()
      const feeToEthReceiver = (bigNumberify(10000).sub(percentFeeToExternalRecipient))

      expect(await provider.getBalance(protocolFeeReceiver.address)).to.eq(protocolFeeReceiverBalance.toString())

      expect(await tokenA.balanceOf(feeReceiver.address)).to.eq(0)
      expect(await tokenB.balanceOf(feeReceiver.address)).to.eq(0)
      expect(await WETH.balanceOf(feeReceiver.address)).to.eq(0)
      expect(await pair.balanceOf(feeReceiver.address)).to.eq(0)
      expect(await provider.getBalance(feeReceiver.address)).to.eq(0)

      expect((await provider.getBalance(protocolFeeReceiver.address)))
        .to.be.eq(protocolFeeReceiverBalance)

      expect((await tokenA.balanceOf(dxdao.address)))
        .to.be.eq(tokenAFromProtocolFee)
      expect((await tokenA.balanceOf(externalFeeRecipient.address)))
        .to.be.eq(0)

      expect((await tokenB.balanceOf(dxdao.address)))
        .to.be.eq(tokenBFromProtocolFee)
      expect((await tokenB.balanceOf(externalFeeRecipient.address)))
        .to.be.eq(0)
    })

  it(
    'should split protocol fee and send tokenA & tokenB to dxdao and external fee receiver',
    async () => {
      const tokenAmount = expandTo18Decimals(100);
      const amountIn = expandTo18Decimals(50);
      const newPercentFeeToExternalRecipient = 2000 //20%

      // Set up tokenA-tokenB
      const tokenA = await deployContract(wallet, ERC20, [expandTo18Decimals(10000)], overrides)
      const tokenB = await deployContract(wallet, ERC20, [expandTo18Decimals(10000)], overrides)

      await factory.createPair(tokenA.address, tokenB.address)
      const tokenATokenBPair = new Contract(
        await factory.getPair(
          (tokenA.address < tokenB.address) ? tokenA.address : tokenB.address,
          (tokenA.address < tokenB.address) ? tokenB.address : tokenA.address
        ), JSON.stringify(DXswapPair.abi), provider
      ).connect(wallet)

      // set external fee receiver
      await feeSetter.setExternalFeeRecipient(tokenATokenBPair.address, externalFeeRecipient.address)
      await feeSetter.setPercentFeeToExternalRecipient(tokenATokenBPair.address, newPercentFeeToExternalRecipient)
      const percentFeeToExternalRecipient = await tokenATokenBPair.percentFeeToExternalRecipient()
      expect(percentFeeToExternalRecipient).to.eq(newPercentFeeToExternalRecipient)

      await tokenA.transfer(tokenATokenBPair.address, tokenAmount)
      await tokenB.transfer(tokenATokenBPair.address, tokenAmount)
      await tokenATokenBPair.mint(wallet.address, overrides)

      let amountOut = await getAmountOut(tokenATokenBPair, tokenA.address, amountIn)
      await tokenA.transfer(tokenATokenBPair.address, amountIn)
      await tokenATokenBPair.swap(
        (tokenA.address < tokenB.address) ? 0 : amountOut,
        (tokenA.address < tokenB.address) ? amountOut : 0,
        wallet.address, '0x', overrides
      )

      let protocolFeeToReceive = await calcProtocolFee(tokenATokenBPair);

      await tokenA.transfer(tokenATokenBPair.address, expandTo18Decimals(10))
      await tokenB.transfer(tokenATokenBPair.address, expandTo18Decimals(10))
      await tokenATokenBPair.mint(wallet.address, overrides)

      const protocolFeeLPTokenAtokenBPair = await tokenATokenBPair.balanceOf(feeReceiver.address);
      expect(protocolFeeLPTokenAtokenBPair.div(ROUND_EXCEPTION))
        .to.be.eq(protocolFeeToReceive.div(ROUND_EXCEPTION))

      const tokenAFromProtocolFee = protocolFeeLPTokenAtokenBPair
        .mul(await tokenA.balanceOf(tokenATokenBPair.address)).div(await tokenATokenBPair.totalSupply());
      const tokenBFromProtocolFee = protocolFeeLPTokenAtokenBPair
        .mul(await tokenB.balanceOf(tokenATokenBPair.address)).div(await tokenATokenBPair.totalSupply());

      const protocolFeeReceiverBalance = await provider.getBalance(protocolFeeReceiver.address)

      await feeReceiver.connect(wallet).takeProtocolFee([tokenATokenBPair.address], overrides)

      const feeToEthReceiver = (bigNumberify(10000).sub(percentFeeToExternalRecipient))

      expect(await provider.getBalance(protocolFeeReceiver.address)).to.eq(protocolFeeReceiverBalance)

      expect(await tokenA.balanceOf(feeReceiver.address)).to.eq(0)
      expect(await tokenB.balanceOf(feeReceiver.address)).to.eq(0)
      expect(await WETH.balanceOf(feeReceiver.address)).to.eq(0)
      expect(await pair.balanceOf(feeReceiver.address)).to.eq(0)
      expect(await provider.getBalance(feeReceiver.address)).to.eq(0)

      expect((await provider.getBalance(protocolFeeReceiver.address)))
        .to.be.eq(protocolFeeReceiverBalance)

      expect((await tokenA.balanceOf(dxdao.address)).div(ROUND_EXCEPTION))
        .to.be.eq(tokenAFromProtocolFee.mul(feeToEthReceiver).div(10000).div(ROUND_EXCEPTION))
      expect((await tokenA.balanceOf(externalFeeRecipient.address)).div(ROUND_EXCEPTION))
        .to.be.eq(tokenAFromProtocolFee.mul(percentFeeToExternalRecipient).div(10000).div(ROUND_EXCEPTION))

      expect((await tokenB.balanceOf(dxdao.address)).div(ROUND_EXCEPTION))
        .to.be.eq(tokenBFromProtocolFee.mul(feeToEthReceiver).div(10000).div(ROUND_EXCEPTION))
      expect((await tokenB.balanceOf(externalFeeRecipient.address)).div(ROUND_EXCEPTION))
        .to.be.eq(tokenBFromProtocolFee.mul(percentFeeToExternalRecipient).div(10000).div(ROUND_EXCEPTION))
    })

  // Where token0-token1, token0-WETH and token1-WETH pairs exist
  it(
    'should swap token0 & token 1 to ETH and sent to ethReceiver when extracting fee from token0-token1',
    async () => {
      const tokenAmount = expandTo18Decimals(100);
      const wethAmount = expandTo18Decimals(100);
      const amountIn = expandTo18Decimals(10);

      await token0.transfer(pair.address, tokenAmount)
      await token1.transfer(pair.address, tokenAmount)
      await pair.mint(wallet.address, overrides)

      await token0.transfer(wethToken0Pair.address, tokenAmount)
      await WETH.transfer(wethToken0Pair.address, wethAmount)
      await wethToken0Pair.mint(wallet.address, overrides)

      await token1.transfer(wethToken1Pair.address, tokenAmount)
      await WETH.transfer(wethToken1Pair.address, wethAmount)
      await wethToken1Pair.mint(wallet.address, overrides)

      let amountOut = await getAmountOut(pair, token0.address, amountIn);

      await token0.transfer(pair.address, amountIn)
      await pair.swap(0, amountOut, wallet.address, '0x', overrides)

      amountOut = await getAmountOut(pair, token1.address, amountIn);
      await token1.transfer(pair.address, amountIn)
      await pair.swap(amountOut, 0, wallet.address, '0x', overrides)

      const protocolFeeToReceive = await calcProtocolFee(pair);

      await token0.transfer(pair.address, expandTo18Decimals(10))
      await token1.transfer(pair.address, expandTo18Decimals(10))
      await pair.mint(wallet.address, overrides)

      const protocolFeeLPToknesReceived = await pair.balanceOf(feeReceiver.address);
      expect(protocolFeeLPToknesReceived.div(ROUND_EXCEPTION))
        .to.be.eq(protocolFeeToReceive.div(ROUND_EXCEPTION))

      const token0FromProtocolFee = protocolFeeLPToknesReceived
        .mul(await token0.balanceOf(pair.address)).div(await pair.totalSupply());
      const token1FromProtocolFee = protocolFeeLPToknesReceived
        .mul(await token1.balanceOf(pair.address)).div(await pair.totalSupply());

      const wethFromToken0FromProtocolFee = await getAmountOut(wethToken0Pair, token0.address, token0FromProtocolFee);
      const wethFromToken1FromProtocolFee = await getAmountOut(wethToken1Pair, token1.address, token1FromProtocolFee);

      const protocolFeeReceiverBalanceBeforeTake = await provider.getBalance(protocolFeeReceiver.address)

      await feeReceiver.connect(wallet).takeProtocolFee([pair.address], overrides)

      expect(await token0.balanceOf(feeReceiver.address)).to.eq(0)
      expect(await token1.balanceOf(feeReceiver.address)).to.eq(0)
      expect(await WETH.balanceOf(feeReceiver.address)).to.eq(0)
      expect(await pair.balanceOf(feeReceiver.address)).to.eq(0)
      expect(await provider.getBalance(feeReceiver.address)).to.eq(0)

      expect((await token0.balanceOf(dxdao.address)))
        .to.eq(0)
      expect((await token1.balanceOf(dxdao.address)))
        .to.eq(0)
      expect((await provider.getBalance(protocolFeeReceiver.address)))
        .to.be.eq(protocolFeeReceiverBalanceBeforeTake.add(wethFromToken0FromProtocolFee).add(wethFromToken1FromProtocolFee))
    })

  // Where token0-token1, token0-WETH and token1-WETH pairs exist
  it(
    'should receive token0 and ETH when extracting fee from token0-token1 and swap LPs exist but not enough liquidity',
    async () => {
      const tokenAmount = expandTo18Decimals(100);
      const wethAmount = expandTo18Decimals(100);
      const amountIn = expandTo18Decimals(10);
      // add very small liquidity to weth-token0 pool
      const wethTknAmountLowLP = bigNumberify(1).mul(bigNumberify(10).pow(6));

      await token0.transfer(pair.address, tokenAmount)
      await token1.transfer(pair.address, tokenAmount)
      await pair.mint(wallet.address, overrides)

      await token0.transfer(wethToken0Pair.address, wethTknAmountLowLP)
      await WETH.transfer(wethToken0Pair.address, wethTknAmountLowLP)
      await wethToken0Pair.mint(wallet.address, overrides)

      await token1.transfer(wethToken1Pair.address, tokenAmount)
      await WETH.transfer(wethToken1Pair.address, wethAmount)
      await wethToken1Pair.mint(wallet.address, overrides)

      let amountOut = await getAmountOut(pair, token0.address, amountIn);

      await token0.transfer(pair.address, amountIn)
      await pair.swap(0, amountOut, wallet.address, '0x', overrides)

      amountOut = await getAmountOut(pair, token1.address, amountIn);
      await token1.transfer(pair.address, amountIn)
      await pair.swap(amountOut, 0, wallet.address, '0x', overrides)

      const protocolFeeToReceive = await calcProtocolFee(pair);

      await token0.transfer(pair.address, expandTo18Decimals(10))
      await token1.transfer(pair.address, expandTo18Decimals(10))
      await pair.mint(wallet.address, overrides)

      const protocolFeeLPToknesReceived = await pair.balanceOf(feeReceiver.address);
      expect(protocolFeeLPToknesReceived.div(ROUND_EXCEPTION))
        .to.be.eq(protocolFeeToReceive.div(ROUND_EXCEPTION))

      const token0FromProtocolFee = protocolFeeLPToknesReceived
        .mul(await token0.balanceOf(pair.address)).div(await pair.totalSupply());
      const token1FromProtocolFee = protocolFeeLPToknesReceived
        .mul(await token1.balanceOf(pair.address)).div(await pair.totalSupply());

      const wethFromToken0FromProtocolFee = await getAmountOut(wethToken0Pair, token0.address, token0FromProtocolFee);
      const wethFromToken1FromProtocolFee = await getAmountOut(wethToken1Pair, token1.address, token1FromProtocolFee);

      const protocolFeeReceiverBalanceBeforeTake = await provider.getBalance(protocolFeeReceiver.address)

      await feeReceiver.connect(wallet).takeProtocolFee([pair.address], overrides)

      expect(await token0.balanceOf(feeReceiver.address)).to.eq(0)
      expect(await token1.balanceOf(feeReceiver.address)).to.eq(0)
      expect(await WETH.balanceOf(feeReceiver.address)).to.eq(0)
      expect(await pair.balanceOf(feeReceiver.address)).to.eq(0)
      expect(await provider.getBalance(feeReceiver.address)).to.eq(0)

      expect((await token0.balanceOf(dxdao.address)))
        .to.eq(token0FromProtocolFee)
      expect((await token1.balanceOf(dxdao.address)))
        .to.eq(0)
      expect((await provider.getBalance(protocolFeeReceiver.address)))
        .to.be.eq(protocolFeeReceiverBalanceBeforeTake.add(wethFromToken1FromProtocolFee))
    })

  // Where token0-token1, token0-WETH and token1-WETH pairs exist
  it(
    'should receive token0 and ETH when extracting fee from token0-token1 and swap LPs exist but token reserve is 0',
    async () => {
      const tokenAmount = expandTo18Decimals(100);
      const wethAmount = expandTo18Decimals(100);
      const amountIn = expandTo18Decimals(10);
      // add very small liquidity to weth-token0 pool
      const wethTknAmountLowLP = bigNumberify(1).mul(bigNumberify(10).pow(6));

      await token0.transfer(pair.address, tokenAmount)
      await token1.transfer(pair.address, tokenAmount)
      await pair.mint(wallet.address, overrides)

      // dont transfer token0 to the pool and dont mint lp tokens
      await WETH.transfer(wethToken0Pair.address, wethTknAmountLowLP)

      await token1.transfer(wethToken1Pair.address, tokenAmount)
      await WETH.transfer(wethToken1Pair.address, wethAmount)
      await wethToken1Pair.mint(wallet.address, overrides)

      let amountOut = await getAmountOut(pair, token0.address, amountIn);

      await token0.transfer(pair.address, amountIn)
      await pair.swap(0, amountOut, wallet.address, '0x', overrides)

      amountOut = await getAmountOut(pair, token1.address, amountIn);
      await token1.transfer(pair.address, amountIn)
      await pair.swap(amountOut, 0, wallet.address, '0x', overrides)

      const protocolFeeToReceive = await calcProtocolFee(pair);

      await token0.transfer(pair.address, expandTo18Decimals(10))
      await token1.transfer(pair.address, expandTo18Decimals(10))
      await pair.mint(wallet.address, overrides)

      const protocolFeeLPToknesReceived = await pair.balanceOf(feeReceiver.address);
      expect(protocolFeeLPToknesReceived.div(ROUND_EXCEPTION))
        .to.be.eq(protocolFeeToReceive.div(ROUND_EXCEPTION))

      const token0FromProtocolFee = protocolFeeLPToknesReceived
        .mul(await token0.balanceOf(pair.address)).div(await pair.totalSupply());
      const token1FromProtocolFee = protocolFeeLPToknesReceived
        .mul(await token1.balanceOf(pair.address)).div(await pair.totalSupply());

      const wethFromToken0FromProtocolFee = await getAmountOut(wethToken0Pair, token0.address, token0FromProtocolFee);
      const wethFromToken1FromProtocolFee = await getAmountOut(wethToken1Pair, token1.address, token1FromProtocolFee);

      const protocolFeeReceiverBalanceBeforeTake = await provider.getBalance(protocolFeeReceiver.address)

      await feeReceiver.connect(wallet).takeProtocolFee([pair.address], overrides)

      expect(await token0.balanceOf(feeReceiver.address)).to.eq(0)
      expect(await token1.balanceOf(feeReceiver.address)).to.eq(0)
      expect(await WETH.balanceOf(feeReceiver.address)).to.eq(0)
      expect(await pair.balanceOf(feeReceiver.address)).to.eq(0)
      expect(await provider.getBalance(feeReceiver.address)).to.eq(0)

      expect((await token0.balanceOf(dxdao.address)))
        .to.eq(token0FromProtocolFee)
      expect((await token1.balanceOf(dxdao.address)))
        .to.eq(0)
      expect((await provider.getBalance(protocolFeeReceiver.address)))
        .to.be.eq(protocolFeeReceiverBalanceBeforeTake.add(wethFromToken1FromProtocolFee))
    })

  // Where token0-token1, token0-WETH and token1-WETH pairs exist
  it(
    'should swap tkn0 & tkn1 to ETH and split protocol fee when extracting from token0-token1',
    async () => {
      const tokenAmount = expandTo18Decimals(100);
      const wethAmount = expandTo18Decimals(100);
      const amountIn = expandTo18Decimals(10);
      const newPercentFeeToExternalRecipient = 2000 //20%

      await token0.transfer(pair.address, tokenAmount)
      await token1.transfer(pair.address, tokenAmount)
      await pair.mint(wallet.address, overrides)

      await token0.transfer(wethToken0Pair.address, tokenAmount)
      await WETH.transfer(wethToken0Pair.address, wethAmount)
      await wethToken0Pair.mint(wallet.address, overrides)

      await token1.transfer(wethToken1Pair.address, tokenAmount)
      await WETH.transfer(wethToken1Pair.address, wethAmount)
      await wethToken1Pair.mint(wallet.address, overrides)

      // set external fee receiver
      await feeSetter.setExternalFeeRecipient(pair.address, externalFeeRecipient.address)
      await feeSetter.setPercentFeeToExternalRecipient(pair.address, newPercentFeeToExternalRecipient)
      const percentFeeToExternalRecipient = await pair.percentFeeToExternalRecipient()
      expect(percentFeeToExternalRecipient).to.eq(newPercentFeeToExternalRecipient)

      let amountOut = await getAmountOut(pair, token0.address, amountIn);

      await token0.transfer(pair.address, amountIn)
      await pair.swap(0, amountOut, wallet.address, '0x', overrides)

      amountOut = await getAmountOut(pair, token1.address, amountIn);
      await token1.transfer(pair.address, amountIn)
      await pair.swap(amountOut, 0, wallet.address, '0x', overrides)

      const protocolFeeToReceive = await calcProtocolFee(pair);

      await token0.transfer(pair.address, expandTo18Decimals(10))
      await token1.transfer(pair.address, expandTo18Decimals(10))
      await pair.mint(wallet.address, overrides)

      const protocolFeeLPToknesReceived = await pair.balanceOf(feeReceiver.address);
      expect(protocolFeeLPToknesReceived.div(ROUND_EXCEPTION))
        .to.be.eq(protocolFeeToReceive.div(ROUND_EXCEPTION))

      const token0FromProtocolFee = protocolFeeLPToknesReceived
        .mul(await token0.balanceOf(pair.address)).div(await pair.totalSupply());
      const token1FromProtocolFee = protocolFeeLPToknesReceived
        .mul(await token1.balanceOf(pair.address)).div(await pair.totalSupply());

      const wethFromToken0FromProtocolFee = await getAmountOut(wethToken0Pair, token0.address, token0FromProtocolFee);
      const wethFromToken1FromProtocolFee = await getAmountOut(wethToken1Pair, token1.address, token1FromProtocolFee);

      const protocolFeeReceiverBalanceBeforeTake = await provider.getBalance(protocolFeeReceiver.address)
      const externalFeeRecipientBalanceBeforeTake = await provider.getBalance(externalFeeRecipient.address)

      await feeReceiver.connect(wallet).takeProtocolFee([pair.address], overrides)

      expect(await token0.balanceOf(feeReceiver.address)).to.eq(0)
      expect(await token1.balanceOf(feeReceiver.address)).to.eq(0)
      expect(await WETH.balanceOf(feeReceiver.address)).to.eq(0)
      expect(await pair.balanceOf(feeReceiver.address)).to.eq(0)
      expect(await provider.getBalance(feeReceiver.address)).to.eq(0)

      expect((await token0.balanceOf(dxdao.address)))
        .to.eq(0)
      expect((await token1.balanceOf(dxdao.address)))
        .to.eq(0)
      expect((await token0.balanceOf(externalFeeRecipient.address)))
        .to.eq(0)
      expect((await token1.balanceOf(externalFeeRecipient.address)))
        .to.eq(0)

      const totalWethFromFees = wethFromToken0FromProtocolFee.add(wethFromToken1FromProtocolFee)
      const wethToExternalRecipient = totalWethFromFees.mul(percentFeeToExternalRecipient).div(10000)
      const wethToProtocolFeeReceiver = totalWethFromFees.sub(wethToExternalRecipient)

      expect((await provider.getBalance(protocolFeeReceiver.address)).div(ROUND_EXCEPTION))
        .to.be.eq((protocolFeeReceiverBalanceBeforeTake.add(wethToProtocolFeeReceiver)).div(ROUND_EXCEPTION))
      expect((await provider.getBalance(externalFeeRecipient.address)).div(ROUND_EXCEPTION))
        .to.be.eq((externalFeeRecipientBalanceBeforeTake.add(wethToExternalRecipient)).div(ROUND_EXCEPTION))
    })

  // Where token0-token1, token0-WETH and token1-WETH pairs exist
  it(
    'should send tkn0 & tkn1 and split protocol fee when extracting from token0-token1 and swap to weth impossible',
    async () => {
      const tokenAmount = expandTo18Decimals(100);
      const wethAmount = expandTo18Decimals(100);
      const amountIn = expandTo18Decimals(10);
      const newPercentFeeToExternalRecipient = 2000 //20%

      await token0.transfer(pair.address, tokenAmount)
      await token1.transfer(pair.address, tokenAmount)
      await pair.mint(wallet.address, overrides)

      // set external fee receiver
      await feeSetter.setExternalFeeRecipient(pair.address, externalFeeRecipient.address)
      await feeSetter.setPercentFeeToExternalRecipient(pair.address, newPercentFeeToExternalRecipient)
      const percentFeeToExternalRecipient = await pair.percentFeeToExternalRecipient()
      expect(percentFeeToExternalRecipient).to.eq(newPercentFeeToExternalRecipient)

      let amountOut = await getAmountOut(pair, token0.address, amountIn);

      await token0.transfer(pair.address, amountIn)
      await pair.swap(0, amountOut, wallet.address, '0x', overrides)

      amountOut = await getAmountOut(pair, token1.address, amountIn);
      await token1.transfer(pair.address, amountIn)
      await pair.swap(amountOut, 0, wallet.address, '0x', overrides)

      amountOut = await getAmountOut(pair, token1.address, amountIn);
      await token1.transfer(pair.address, amountIn)
      await pair.swap(amountOut, 0, wallet.address, '0x', overrides)

      const protocolFeeToReceive = await calcProtocolFee(pair);

      await token0.transfer(pair.address, expandTo18Decimals(10))
      await token1.transfer(pair.address, expandTo18Decimals(10))
      await pair.mint(wallet.address, overrides)

      const protocolFeeLPToknesReceived = await pair.balanceOf(feeReceiver.address);
      expect(protocolFeeLPToknesReceived.div(ROUND_EXCEPTION))
        .to.be.eq(protocolFeeToReceive.div(ROUND_EXCEPTION))

      const token0FromProtocolFee = protocolFeeLPToknesReceived
        .mul(await token0.balanceOf(pair.address)).div(await pair.totalSupply());
      const token1FromProtocolFee = protocolFeeLPToknesReceived
        .mul(await token1.balanceOf(pair.address)).div(await pair.totalSupply());

      const dxdaoBalanceBeforeTake = await provider.getBalance(dxdao.address)
      const protocolFeeReceiverBalanceBeforeTake = await provider.getBalance(protocolFeeReceiver.address)
      const externalFeeRecipientBalanceBeforeTake = await provider.getBalance(externalFeeRecipient.address)

      await feeReceiver.connect(wallet).takeProtocolFee([pair.address], overrides)

      const tkn0ToExternalRecipient = token0FromProtocolFee.mul(percentFeeToExternalRecipient).div(10000)
      const tkn1ToExternalRecipient = token1FromProtocolFee.mul(percentFeeToExternalRecipient).div(10000)
      const tkn0ToProtocolFeeReceiver = token0FromProtocolFee.sub(tkn0ToExternalRecipient)
      const tkn1ToProtocolFeeReceiver = token1FromProtocolFee.sub(tkn1ToExternalRecipient)

      expect(await token0.balanceOf(feeReceiver.address)).to.eq(0)
      expect(await token1.balanceOf(feeReceiver.address)).to.eq(0)
      expect(await WETH.balanceOf(feeReceiver.address)).to.eq(0)
      expect(await pair.balanceOf(feeReceiver.address)).to.eq(0)
      expect(await provider.getBalance(feeReceiver.address)).to.eq(0)

      // send token0 and token1 to fallbackreceiver and external fee receiver
      expect((await token0.balanceOf(dxdao.address)))
        .to.eq(tkn0ToProtocolFeeReceiver)
      expect((await token1.balanceOf(dxdao.address)))
        .to.eq(tkn1ToProtocolFeeReceiver)
      expect((await token0.balanceOf(externalFeeRecipient.address)))
        .to.eq(tkn0ToExternalRecipient)
      expect((await token1.balanceOf(externalFeeRecipient.address)))
        .to.eq(tkn1ToExternalRecipient)

      // should not change eth balance
      expect((await provider.getBalance(dxdao.address)))
        .to.eq(dxdaoBalanceBeforeTake)
      expect((await provider.getBalance(protocolFeeReceiver.address)))
        .to.eq(protocolFeeReceiverBalanceBeforeTake)
      expect((await provider.getBalance(externalFeeRecipient.address)))
        .to.eq(externalFeeRecipientBalanceBeforeTake)
    })

  // Where token0-token1, token0-WETH and token1-WETH pairs exist
  it(
    'should change protocol fee, send tkn0 & tkn1 and split protocol fee when extracting from token0-token1 and swap to weth impossible',
    async () => {
      const tokenAmount = expandTo18Decimals(100);
      const wethAmount = expandTo18Decimals(100);
      const amountIn = expandTo18Decimals(10);
      const newPercentFeeToExternalRecipient = 2000 //20%

      await token0.transfer(pair.address, tokenAmount)
      await token1.transfer(pair.address, tokenAmount)
      await pair.mint(wallet.address, overrides)

      // set external fee receiver
      await feeSetter.setExternalFeeRecipient(pair.address, externalFeeRecipient.address)
      await feeSetter.setPercentFeeToExternalRecipient(pair.address, newPercentFeeToExternalRecipient)
      const percentFeeToExternalRecipient = await pair.percentFeeToExternalRecipient()
      expect(percentFeeToExternalRecipient).to.eq(newPercentFeeToExternalRecipient)

      let amountOut = await getAmountOut(pair, token0.address, amountIn);

      await token0.transfer(pair.address, amountIn)
      await pair.swap(0, amountOut, wallet.address, '0x', overrides)

      amountOut = await getAmountOut(pair, token1.address, amountIn);
      await token1.transfer(pair.address, amountIn)
      await pair.swap(amountOut, 0, wallet.address, '0x', overrides)

      amountOut = await getAmountOut(pair, token1.address, amountIn);
      await token1.transfer(pair.address, amountIn)
      await pair.swap(amountOut, 0, wallet.address, '0x', overrides)

      // change protocol fee
      await feeSetter.connect(dxdao).setProtocolFee(20)
      expect(await factory.protocolFeeDenominator()).to.eq(20)

      amountOut = await getAmountOut(pair, token1.address, amountIn);
      await token1.transfer(pair.address, amountIn)
      await pair.swap(amountOut, 0, wallet.address, '0x', overrides)

      amountOut = await getAmountOut(pair, token1.address, amountIn);
      await token1.transfer(pair.address, amountIn)
      await pair.swap(amountOut, 0, wallet.address, '0x', overrides)


      const protocolFeeToReceive = await calcProtocolFee(pair);

      await token0.transfer(pair.address, expandTo18Decimals(10))
      await token1.transfer(pair.address, expandTo18Decimals(10))
      await pair.mint(wallet.address, overrides)

      const protocolFeeLPToknesReceived = await pair.balanceOf(feeReceiver.address);
      expect(protocolFeeLPToknesReceived.div(ROUND_EXCEPTION))
        .to.be.eq(protocolFeeToReceive.div(ROUND_EXCEPTION))

      const token0FromProtocolFee = protocolFeeLPToknesReceived
        .mul(await token0.balanceOf(pair.address)).div(await pair.totalSupply());
      const token1FromProtocolFee = protocolFeeLPToknesReceived
        .mul(await token1.balanceOf(pair.address)).div(await pair.totalSupply());

      const dxdaoBalanceBeforeTake = await provider.getBalance(dxdao.address)
      const protocolFeeReceiverBalanceBeforeTake = await provider.getBalance(protocolFeeReceiver.address)
      const externalFeeRecipientBalanceBeforeTake = await provider.getBalance(externalFeeRecipient.address)

      await feeReceiver.connect(wallet).takeProtocolFee([pair.address], overrides)

      const tkn0ToExternalRecipient = token0FromProtocolFee.mul(percentFeeToExternalRecipient).div(10000)
      const tkn1ToExternalRecipient = token1FromProtocolFee.mul(percentFeeToExternalRecipient).div(10000)
      const tkn0ToProtocolFeeReceiver = token0FromProtocolFee.sub(tkn0ToExternalRecipient)
      const tkn1ToProtocolFeeReceiver = token1FromProtocolFee.sub(tkn1ToExternalRecipient)

      expect(await token0.balanceOf(feeReceiver.address)).to.eq(0)
      expect(await token1.balanceOf(feeReceiver.address)).to.eq(0)
      expect(await WETH.balanceOf(feeReceiver.address)).to.eq(0)
      expect(await pair.balanceOf(feeReceiver.address)).to.eq(0)
      expect(await provider.getBalance(feeReceiver.address)).to.eq(0)

      // send token0 and token1 to fallbackreceiver and external fee receiver
      expect((await token0.balanceOf(dxdao.address)))
        .to.eq(tkn0ToProtocolFeeReceiver)
      expect((await token1.balanceOf(dxdao.address)))
        .to.eq(tkn1ToProtocolFeeReceiver)
      expect((await token0.balanceOf(externalFeeRecipient.address)))
        .to.eq(tkn0ToExternalRecipient)
      expect((await token1.balanceOf(externalFeeRecipient.address)))
        .to.eq(tkn1ToExternalRecipient)

      // should not change eth balance
      expect((await provider.getBalance(dxdao.address)))
        .to.eq(dxdaoBalanceBeforeTake)
      expect((await provider.getBalance(protocolFeeReceiver.address)))
        .to.eq(protocolFeeReceiverBalanceBeforeTake)
      expect((await provider.getBalance(externalFeeRecipient.address)))
        .to.eq(externalFeeRecipientBalanceBeforeTake)
    })

  // Where tokenA-tokenB, tokenC-tokenD and tokenC-WETH pairs exist
  it(
    'should receive tokenA,B,D and WETH from tokenC from tokenA-tonkenB and tokenC-tokenD pairs',
    async () => {
      const tokenAmount = expandTo18Decimals(100);
      const amountIn = expandTo18Decimals(50);

      // Set up tokenA-tokenB
      const tokenA = await deployContract(wallet, ERC20, [expandTo18Decimals(10000)], overrides)
      const tokenB = await deployContract(wallet, ERC20, [expandTo18Decimals(10000)], overrides)

      await factory.createPair(tokenA.address, tokenB.address);
      const tokenATokenBPair = new Contract(
        await factory.getPair(
          (tokenA.address < tokenB.address) ? tokenA.address : tokenB.address,
          (tokenA.address < tokenB.address) ? tokenB.address : tokenA.address
        ), JSON.stringify(DXswapPair.abi), provider
      ).connect(wallet)

      await tokenA.transfer(tokenATokenBPair.address, tokenAmount)
      await tokenB.transfer(tokenATokenBPair.address, tokenAmount)
      await tokenATokenBPair.mint(wallet.address, overrides)

      let amountOut = await getAmountOut(tokenATokenBPair, tokenA.address, amountIn);
      await tokenA.transfer(tokenATokenBPair.address, amountIn)
      await tokenATokenBPair.swap(
        (tokenA.address < tokenB.address) ? 0 : amountOut,
        (tokenA.address < tokenB.address) ? amountOut : 0,
        wallet.address, '0x', overrides
      )

      amountOut = await getAmountOut(tokenATokenBPair, tokenB.address, amountIn);
      await tokenB.transfer(tokenATokenBPair.address, amountIn)
      await tokenATokenBPair.swap(
        (tokenA.address < tokenB.address) ? amountOut : 0,
        (tokenA.address < tokenB.address) ? 0 : amountOut,
        wallet.address, '0x', overrides
      )

      let protocolFeeToReceive = await calcProtocolFee(tokenATokenBPair);

      await tokenA.transfer(tokenATokenBPair.address, expandTo18Decimals(10))
      await tokenB.transfer(tokenATokenBPair.address, expandTo18Decimals(10))
      await tokenATokenBPair.mint(wallet.address, overrides)

      const protocolFeeLPTokenAtokenBPair = await tokenATokenBPair.balanceOf(feeReceiver.address);
      expect(protocolFeeLPTokenAtokenBPair.div(ROUND_EXCEPTION))
        .to.be.eq(protocolFeeToReceive.div(ROUND_EXCEPTION))

      // Set up tokenC-tokenD pair
      const tokenC = await deployContract(wallet, ERC20, [expandTo18Decimals(10000)], overrides)
      const tokenD = await deployContract(wallet, ERC20, [expandTo18Decimals(10000)], overrides)

      await factory.createPair(tokenC.address, tokenD.address);
      const tokenCTokenDPair = new Contract(
        await factory.getPair(
          (tokenC.address < tokenD.address) ? tokenC.address : tokenD.address,
          (tokenC.address < tokenD.address) ? tokenD.address : tokenC.address
        ), JSON.stringify(DXswapPair.abi), provider
      ).connect(wallet)


      await tokenC.transfer(tokenCTokenDPair.address, tokenAmount)
      await tokenD.transfer(tokenCTokenDPair.address, tokenAmount)
      await tokenCTokenDPair.mint(wallet.address, overrides)

      // Set up tokenC-WETH pair
      await factory.createPair(tokenC.address, WETH.address);
      const tokenCWETHPair = new Contract(
        await factory.getPair(
          (tokenC.address < WETH.address) ? tokenC.address : WETH.address,
          (tokenC.address < WETH.address) ? WETH.address : tokenC.address
        ), JSON.stringify(DXswapPair.abi), provider
      ).connect(wallet)
      await tokenC.transfer(tokenCWETHPair.address, tokenAmount)
      await WETH.transfer(tokenCWETHPair.address, tokenAmount)
      await tokenCWETHPair.mint(wallet.address, overrides)

      // swap
      amountOut = await getAmountOut(tokenCTokenDPair, tokenC.address, amountIn);
      await tokenC.transfer(tokenCTokenDPair.address, amountIn)
      await tokenCTokenDPair.swap(
        (tokenC.address < tokenD.address) ? 0 : amountOut,
        (tokenC.address < tokenD.address) ? amountOut : 0,
        wallet.address, '0x', overrides
      )

      amountOut = await getAmountOut(tokenCTokenDPair, tokenD.address, amountIn);
      await tokenD.transfer(tokenCTokenDPair.address, amountIn)
      await tokenCTokenDPair.swap(
        (tokenC.address < tokenD.address) ? amountOut : 0,
        (tokenC.address < tokenD.address) ? 0 : amountOut,
        wallet.address, '0x', overrides
      )

      protocolFeeToReceive = await calcProtocolFee(tokenCTokenDPair);

      await tokenC.transfer(tokenCTokenDPair.address, expandTo18Decimals(10))
      await tokenD.transfer(tokenCTokenDPair.address, expandTo18Decimals(10))
      await tokenCTokenDPair.mint(wallet.address, overrides)

      const protocolFeeLPTokenCtokenDPair = await tokenCTokenDPair.balanceOf(feeReceiver.address);
      expect(protocolFeeLPTokenCtokenDPair.div(ROUND_EXCEPTION))
        .to.be.eq(protocolFeeToReceive.div(ROUND_EXCEPTION))

      const tokenAFromProtocolFee = protocolFeeLPTokenAtokenBPair
        .mul(await tokenA.balanceOf(tokenATokenBPair.address)).div(await tokenATokenBPair.totalSupply());
      const tokenBFromProtocolFee = protocolFeeLPTokenAtokenBPair
        .mul(await tokenB.balanceOf(tokenATokenBPair.address)).div(await tokenATokenBPair.totalSupply());
      const tokenCFromProtocolFee = protocolFeeLPTokenCtokenDPair
        .mul(await tokenC.balanceOf(tokenCTokenDPair.address)).div(await tokenCTokenDPair.totalSupply());
      const tokenDFromProtocolFee = protocolFeeLPTokenCtokenDPair
        .mul(await tokenD.balanceOf(tokenCTokenDPair.address)).div(await tokenCTokenDPair.totalSupply());


      const wethFromTokenCFromProtocolFee = await getAmountOut(tokenCWETHPair, tokenC.address, tokenCFromProtocolFee);
      const protocolFeeReceiverBalance = await provider.getBalance(protocolFeeReceiver.address)

      await expect(feeReceiver.connect(wallet).takeProtocolFee([tokenATokenBPair.address, tokenCTokenDPair.address], overrides)
      ).to.emit(feeReceiver, 'TakeProtocolFee').withArgs(wallet.address, protocolFeeReceiver.address, 2)

      expect(await tokenA.balanceOf(feeReceiver.address)).to.eq(0)
      expect(await tokenB.balanceOf(feeReceiver.address)).to.eq(0)
      expect(await tokenC.balanceOf(feeReceiver.address)).to.eq(0)
      expect(await tokenD.balanceOf(feeReceiver.address)).to.eq(0)
      expect(await WETH.balanceOf(feeReceiver.address)).to.eq(0)
      expect(await pair.balanceOf(feeReceiver.address)).to.eq(0)
      expect(await provider.getBalance(feeReceiver.address)).to.eq(0)

      expect((await tokenA.balanceOf(dxdao.address)))
        .to.be.eq(tokenAFromProtocolFee)
      expect((await tokenB.balanceOf(dxdao.address)))
        .to.be.eq(tokenBFromProtocolFee)
      expect((await tokenD.balanceOf(dxdao.address)))
        .to.be.eq(tokenDFromProtocolFee)
      expect((await tokenC.balanceOf(dxdao.address)))
        .to.eq(0)
      expect((await provider.getBalance(protocolFeeReceiver.address)))
        .to.be.eq(protocolFeeReceiverBalance.add(wethFromTokenCFromProtocolFee))
    })

  // Where token0-token1 and token1-WETH pairs exist
  it(
    'should emit TakeProtocolFee event',
    async () => {
      const tokenAmount = expandTo18Decimals(100);
      const wethAmount = expandTo18Decimals(100);
      const amountIn = expandTo18Decimals(10);

      await token0.transfer(pair.address, tokenAmount)
      await token1.transfer(pair.address, tokenAmount)
      await pair.mint(wallet.address, overrides)

      await token1.transfer(wethToken1Pair.address, tokenAmount)
      await WETH.transfer(wethToken1Pair.address, wethAmount)
      await wethToken1Pair.mint(wallet.address, overrides)

      let amountOut = await getAmountOut(pair, token0.address, amountIn);
      await token0.transfer(pair.address, amountIn)
      await pair.swap(0, amountOut, wallet.address, '0x', overrides)

      amountOut = await getAmountOut(wethToken1Pair, token1.address, amountIn);
      await token1.transfer(wethToken1Pair.address, amountIn)
      await wethToken1Pair.swap(0, amountOut, wallet.address, '0x', overrides)

      await token0.transfer(pair.address, expandTo18Decimals(10))
      await token1.transfer(pair.address, expandTo18Decimals(10))
      await pair.mint(wallet.address, overrides)

      await token1.transfer(wethToken1Pair.address, expandTo18Decimals(10))
      await WETH.transfer(wethToken1Pair.address, expandTo18Decimals(10))
      await wethToken1Pair.mint(wallet.address, overrides)

      await expect(feeReceiver.connect(wallet).takeProtocolFee([pair.address, wethToken1Pair.address], overrides)
      ).to.emit(feeReceiver, 'TakeProtocolFee').withArgs(wallet.address, protocolFeeReceiver.address, 2)

    })


})
