import '@nomiclabs/hardhat-ethers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { ethers } from "hardhat";
import { BigNumber } from 'ethers'
import { pairFixture } from './shared/fixtures'
import { DXswapFactory, DXswapFeeSetter, DXswapFeeSplitter, DXswapPair, ERC20, WETH9 } from '../typechain'
import { calcProtocolFee, expandTo18Decimals } from './shared/utilities';

const FEE_DENOMINATOR = BigNumber.from(10).pow(4)
const ROUND_EXCEPTION = BigNumber.from(10).pow(4)

const overrides = {
  gasLimit: 9999999
}

describe('DXswapFeeSplitter', () => {
  const provider = ethers.provider
  let dxdao: SignerWithAddress
  let tokenOwner: SignerWithAddress
  let protocolfeeSplitter: SignerWithAddress
  let fallbackReceiver: SignerWithAddress
  let externalfeeSplitter: SignerWithAddress
  let other: SignerWithAddress
  let factory: DXswapFactory
  let feeSplitter: DXswapFeeSplitter
  let feeSetter: DXswapFeeSetter

  let token0: ERC20
  let token1: ERC20
  let token2: ERC20
  let token3: ERC20
  let pair01: DXswapPair
  let pair23: DXswapPair
  let pair03: DXswapPair
  let wethToken0Pair: DXswapPair
  let wethToken1Pair: DXswapPair
  let WETH: WETH9

  beforeEach('assign signers', async function () {
    const signers = await ethers.getSigners()
    dxdao = signers[0]
    tokenOwner = signers[1]
    protocolfeeSplitter = signers[2]
    fallbackReceiver = signers[3]
    other = signers[4]
    externalfeeSplitter = signers[5]
  })

  beforeEach('deploy fixture', async () => {
    const fixture = await pairFixture(provider, [dxdao, protocolfeeSplitter, fallbackReceiver])
    factory = fixture.dxswapFactory
    feeSplitter = fixture.feeSplitter
    feeSetter = fixture.feeSetter
    token0 = fixture.token0
    token1 = fixture.token1
    token2 = fixture.token2
    token3 = fixture.token3
    pair01 = fixture.dxswapPair01
    pair23 = fixture.dxswapPair23
    pair03 = fixture.dxswapPair03
    WETH = fixture.WETH
    wethToken0Pair = fixture.wethToken0Pair
    wethToken1Pair = fixture.wethToken1Pair
  })

  beforeEach('set fee to', async function () {
    await feeSetter.connect(dxdao).setFeeTo(feeSplitter.address, overrides);
  })

  async function getAmountOut(pair01: DXswapPair, tokenIn: string, amountIn: BigNumber) {
    const [reserve0, reserve1] = await pair01.getReserves()
    const token0 = await pair01.token0()
    const swapFee = BigNumber.from(await pair01.swapFee())
    return getAmountOutSync(reserve0, reserve1, token0 === tokenIn, amountIn, swapFee)
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
  describe('external receiver off', async () => {
    it('feeTo, feeToSetter, allPairsLength, INIT_CODE_PAIR_HASH', async () => {
      expect(await factory.feeTo()).to.eq(feeSplitter.address)
      expect(await factory.feeToSetter()).to.eq(feeSetter.address)
      expect(await factory.INIT_CODE_PAIR_HASH()).to.eq('0x9e43bdf627764c4a3e3e452d1b558fff8466adc4dc8a900396801d26f4c542f2')
    })

    it(
      'should only allow owner to set max price impact',
      async () => {
        await expect(feeSplitter.connect(other).setMaxSwapPriceImpact(500))
          .to.be.revertedWith('DXswapFeeSplitter: CALLER_NOT_OWNER')
        await feeSplitter.connect(dxdao).setMaxSwapPriceImpact(500);
        expect(await feeSplitter.maxSwapPriceImpact()).to.be.eq(500)
      })

    it(
      'should set max price impact within the range 0 - 10000',
      async () => {
        expect(await feeSplitter.maxSwapPriceImpact()).to.be.eq(100)
        await expect(feeSplitter.connect(dxdao).setMaxSwapPriceImpact(0))
          .to.be.revertedWith('DXswapFeeSplitter: FORBIDDEN_PRICE_IMPACT')
        await expect(feeSplitter.connect(dxdao).setMaxSwapPriceImpact(10000))
          .to.be.revertedWith('DXswapFeeSplitter: FORBIDDEN_PRICE_IMPACT')
        await feeSplitter.connect(dxdao).setMaxSwapPriceImpact(500);
        expect(await feeSplitter.maxSwapPriceImpact()).to.be.eq(500)
      })

    // Where token0-token1 and token1-WETH pairs exist
    it(
      'should receive token0 to fallbackreceiver and ETH to ethReceiver when extracting fee from token0-token1',
      async () => {
        const tokenAmount = expandTo18Decimals(100);
        const wethAmount = expandTo18Decimals(100);
        const amountIn = expandTo18Decimals(10);

        await token0.transfer(pair01.address, tokenAmount)
        await token1.transfer(pair01.address, tokenAmount)
        await pair01.mint(dxdao.address, overrides)

        await token1.transfer(wethToken1Pair.address, tokenAmount)
        await WETH.transfer(wethToken1Pair.address, wethAmount)
        await wethToken1Pair.mint(dxdao.address, overrides)

        let amountOut = await getAmountOut(pair01, token0.address, amountIn);

        await token0.transfer(pair01.address, amountIn)
        await pair01.swap(0, amountOut, dxdao.address, '0x')

        amountOut = await getAmountOut(pair01, token1.address, amountIn);
        await token1.transfer(pair01.address, amountIn)
        await pair01.swap(amountOut, 0, dxdao.address, '0x')

        const protocolFeeToReceive = await calcProtocolFee(pair01, factory);

        await token0.transfer(pair01.address, expandTo18Decimals(10))
        await token1.transfer(pair01.address, expandTo18Decimals(10))
        await pair01.mint(dxdao.address, overrides)

        const protocolFeeLPToknesReceived = await pair01.balanceOf(feeSplitter.address);
        expect(protocolFeeLPToknesReceived.div(ROUND_EXCEPTION))
          .to.be.eq(protocolFeeToReceive.div(ROUND_EXCEPTION))

        const token0FromProtocolFee = protocolFeeLPToknesReceived
          .mul(await token0.balanceOf(pair01.address)).div(await pair01.totalSupply());
        const token1FromProtocolFee = protocolFeeLPToknesReceived
          .mul(await token1.balanceOf(pair01.address)).div(await pair01.totalSupply());

        const wethFromToken1FromProtocolFee = await getAmountOut(wethToken1Pair, token1.address, token1FromProtocolFee);
        const protocolfeeSplitterBalanceBeforeTake = await provider.getBalance(protocolfeeSplitter.address)

        await feeSplitter.connect(dxdao).takeProtocolFee([pair01.address], overrides)

        expect(await token0.balanceOf(feeSplitter.address)).to.eq(0)
        expect(await token1.balanceOf(feeSplitter.address)).to.eq(0)
        expect(await WETH.balanceOf(feeSplitter.address)).to.eq(0)
        expect(await pair01.balanceOf(feeSplitter.address)).to.eq(0)
        expect(await provider.getBalance(feeSplitter.address)).to.eq(0)

        expect(await token0.balanceOf(fallbackReceiver.address))
          .to.be.eq(token0FromProtocolFee)
        expect(await provider.getBalance(protocolfeeSplitter.address))
          .to.be.eq(protocolfeeSplitterBalanceBeforeTake.add(wethFromToken1FromProtocolFee))
      })

    it('should receive everything in ETH from one WETH-token1 pair', async () => {
      const tokenAmount = expandTo18Decimals(40);
      const wethAmount = expandTo18Decimals(40);
      const amountIn = expandTo18Decimals(20);

      await token1.transfer(wethToken1Pair.address, tokenAmount, overrides)
      await WETH.transfer(wethToken1Pair.address, wethAmount, overrides)
      await wethToken1Pair.mint(dxdao.address, overrides)

      const token1IsFirstToken = (token1.address < WETH.address)

      let amountOut = await getAmountOut(wethToken1Pair, token1.address, amountIn);
      await token1.transfer(wethToken1Pair.address, amountIn, overrides)
      await wethToken1Pair.swap(
        token1IsFirstToken ? 0 : amountOut,
        token1IsFirstToken ? amountOut : 0,
        dxdao.address, '0x', overrides
      )

      amountOut = await getAmountOut(wethToken1Pair, WETH.address, amountIn);
      await WETH.transfer(wethToken1Pair.address, amountIn, overrides)
      await wethToken1Pair.swap(
        token1IsFirstToken ? amountOut : 0,
        token1IsFirstToken ? 0 : amountOut,
        dxdao.address, '0x', overrides
      )

      const protocolFeeToReceive = await calcProtocolFee(wethToken1Pair, factory);

      await token1.transfer(wethToken1Pair.address, expandTo18Decimals(10), overrides)
      await WETH.transfer(wethToken1Pair.address, expandTo18Decimals(10), overrides)
      await wethToken1Pair.mint(dxdao.address, overrides)

      const protocolFeeLPToknesReceived = await wethToken1Pair.balanceOf(feeSplitter.address);
      expect(protocolFeeLPToknesReceived.div(ROUND_EXCEPTION))
        .to.be.eq(protocolFeeToReceive.div(ROUND_EXCEPTION))

      const token1FromProtocolFee = protocolFeeLPToknesReceived
        .mul(await token1.balanceOf(wethToken1Pair.address)).div(await wethToken1Pair.totalSupply());
      const wethFromProtocolFee = protocolFeeLPToknesReceived
        .mul(await WETH.balanceOf(wethToken1Pair.address)).div(await wethToken1Pair.totalSupply());

      const swapFee = BigNumber.from(await wethToken1Pair.swapFee())
      const token1ReserveBeforeSwap = (await token1.balanceOf(wethToken1Pair.address)).sub(token1FromProtocolFee)
      const wethReserveBeforeSwap = (await WETH.balanceOf(wethToken1Pair.address)).sub(wethFromProtocolFee)
      const wethFromToken1FromProtocolFee = await getAmountOutSync(
        token1IsFirstToken ? token1ReserveBeforeSwap : wethReserveBeforeSwap,
        token1IsFirstToken ? wethReserveBeforeSwap : token1ReserveBeforeSwap,
        token1IsFirstToken,
        token1FromProtocolFee,
        swapFee
      );

      const protocolfeeSplitterBalanceBeforeTake = await provider.getBalance(protocolfeeSplitter.address)

      await feeSplitter.connect(dxdao).takeProtocolFee([wethToken1Pair.address], overrides)

      expect(await token1.balanceOf(feeSplitter.address)).to.eq(0)
      expect(await WETH.balanceOf(feeSplitter.address)).to.eq(0)
      expect(await wethToken1Pair.balanceOf(feeSplitter.address)).to.eq(0)
      expect(await provider.getBalance(feeSplitter.address)).to.eq(0)

      expect((await provider.getBalance(protocolfeeSplitter.address)))
        .to.be.eq(protocolfeeSplitterBalanceBeforeTake.add(wethFromToken1FromProtocolFee).add(wethFromProtocolFee))
    })

    it(
      'should receive only tokens when extracting fee from tokenA-tokenB pair that has no path to WETH',
      async () => {
        const tokenAmount = expandTo18Decimals(100);
        const amountIn = expandTo18Decimals(50);

        await token2.transfer(pair23.address, tokenAmount)
        await token3.transfer(pair23.address, tokenAmount)
        await pair23.mint(dxdao.address, overrides)

        let amountOut = await getAmountOut(pair23, token2.address, amountIn);
        await token2.transfer(pair23.address, amountIn)
        await pair23.swap(
          (token2.address < token3.address) ? 0 : amountOut,
          (token2.address < token3.address) ? amountOut : 0,
          dxdao.address, '0x', overrides
        )

        amountOut = await getAmountOut(pair23, token3.address, amountIn);
        await token3.transfer(pair23.address, amountIn)
        await pair23.swap(
          (token2.address < token3.address) ? amountOut : 0,
          (token2.address < token3.address) ? 0 : amountOut,
          dxdao.address, '0x', overrides
        )

        const protocolFeeToReceive = await calcProtocolFee(pair23, factory);

        await token2.transfer(pair23.address, expandTo18Decimals(10))
        await token3.transfer(pair23.address, expandTo18Decimals(10))
        await pair23.mint(dxdao.address, overrides)

        const protocolFeeLPpair23 = await pair23.balanceOf(feeSplitter.address);
        expect(protocolFeeLPpair23.div(ROUND_EXCEPTION))
          .to.be.eq(protocolFeeToReceive.div(ROUND_EXCEPTION))

        const token2FromProtocolFee = protocolFeeLPpair23
          .mul(await token2.balanceOf(pair23.address)).div(await pair23.totalSupply());
        const token3FromProtocolFee = protocolFeeLPpair23
          .mul(await token3.balanceOf(pair23.address)).div(await pair23.totalSupply());

        const protocolfeeSplitterBalance = await provider.getBalance(protocolfeeSplitter.address)

        await feeSplitter.connect(dxdao).takeProtocolFee([pair23.address], overrides)

        expect(await token2.balanceOf(feeSplitter.address)).to.eq(0)
        expect(await token3.balanceOf(feeSplitter.address)).to.eq(0)
        expect(await WETH.balanceOf(feeSplitter.address)).to.eq(0)
        expect(await pair23.balanceOf(feeSplitter.address)).to.eq(0)
        expect(await provider.getBalance(feeSplitter.address)).to.eq(0)

        expect((await token2.balanceOf(fallbackReceiver.address)))
          .to.be.eq((token2FromProtocolFee))
        expect((await token3.balanceOf(fallbackReceiver.address)))
          .to.be.eq((token3FromProtocolFee))
        expect((await provider.getBalance(protocolfeeSplitter.address)))
          .to.be.eq(protocolfeeSplitterBalance)
      })

    it(
      'should receive only tokens when extracting fee from both tokenA-tonkenB pair and tokenC-tokenD pair',
      async () => {
        const tokenAmount = expandTo18Decimals(100);
        const amountIn = expandTo18Decimals(50);

        await token2.transfer(pair23.address, tokenAmount)
        await token3.transfer(pair23.address, tokenAmount)
        await pair23.mint(dxdao.address, overrides)

        let amountOut = await getAmountOut(pair23, token2.address, amountIn);
        await token2.transfer(pair23.address, amountIn)
        await pair23.swap(
          (token2.address < token3.address) ? 0 : amountOut,
          (token2.address < token3.address) ? amountOut : 0,
          dxdao.address, '0x', overrides
        )

        amountOut = await getAmountOut(pair23, token3.address, amountIn);
        await token3.transfer(pair23.address, amountIn)
        await pair23.swap(
          (token2.address < token3.address) ? amountOut : 0,
          (token2.address < token3.address) ? 0 : amountOut,
          dxdao.address, '0x', overrides
        )

        let protocolFeeToReceive = await calcProtocolFee(pair23, factory);

        await token2.transfer(pair23.address, expandTo18Decimals(10))
        await token3.transfer(pair23.address, expandTo18Decimals(10))
        await pair23.mint(dxdao.address, overrides)

        const protocolFeeLPpair23 = await pair23.balanceOf(feeSplitter.address);
        expect(protocolFeeLPpair23.div(ROUND_EXCEPTION))
          .to.be.eq(protocolFeeToReceive.div(ROUND_EXCEPTION))

        await token0.transfer(pair03.address, tokenAmount)
        await token3.transfer(pair03.address, tokenAmount)
        await pair03.mint(dxdao.address, overrides)

        amountOut = await getAmountOut(pair03, token0.address, amountIn);
        await token0.transfer(pair03.address, amountIn)
        await pair03.swap(
          (token0.address < token3.address) ? 0 : amountOut,
          (token0.address < token3.address) ? amountOut : 0,
          dxdao.address, '0x', overrides
        )

        amountOut = await getAmountOut(pair03, token3.address, amountIn);
        await token3.transfer(pair03.address, amountIn)
        await pair03.swap(
          (token0.address < token3.address) ? amountOut : 0,
          (token0.address < token3.address) ? 0 : amountOut,
          dxdao.address, '0x', overrides
        )

        protocolFeeToReceive = await calcProtocolFee(pair03, factory);

        await token0.transfer(pair03.address, expandTo18Decimals(10))
        await token3.transfer(pair03.address, expandTo18Decimals(10))
        await pair03.mint(dxdao.address, overrides)

        const protocolFeeLPPair03 = await pair03.balanceOf(feeSplitter.address);
        expect(protocolFeeLPPair03.div(ROUND_EXCEPTION))
          .to.be.eq(protocolFeeToReceive.div(ROUND_EXCEPTION))

        const token2FromPair23 = protocolFeeLPpair23
          .mul(await token2.balanceOf(pair23.address)).div(await pair23.totalSupply());
        const token3FromPair23 = protocolFeeLPpair23
          .mul(await token3.balanceOf(pair23.address)).div(await pair23.totalSupply());
        const token0FromPair03 = protocolFeeLPPair03
          .mul(await token0.balanceOf(pair03.address)).div(await pair03.totalSupply());
        const token3FromPair03 = protocolFeeLPPair03
          .mul(await token3.balanceOf(pair03.address)).div(await pair03.totalSupply());

        const protocolfeeSplitterBalance = await provider.getBalance(protocolfeeSplitter.address)

        await feeSplitter.connect(dxdao).takeProtocolFee([pair23.address, pair03.address], overrides)

        expect(await provider.getBalance(protocolfeeSplitter.address)).to.eq(protocolfeeSplitterBalance.toString())

        expect(await token2.balanceOf(feeSplitter.address)).to.eq(0)
        expect(await token3.balanceOf(feeSplitter.address)).to.eq(0)
        expect(await token0.balanceOf(feeSplitter.address)).to.eq(0)
        expect(await token3.balanceOf(feeSplitter.address)).to.eq(0)
        expect(await WETH.balanceOf(feeSplitter.address)).to.eq(0)
        expect(await pair01.balanceOf(feeSplitter.address)).to.eq(0)
        expect(await provider.getBalance(feeSplitter.address)).to.eq(0)

        expect((await provider.getBalance(protocolfeeSplitter.address)))
          .to.be.eq(protocolfeeSplitterBalance)
        expect((await token0.balanceOf(fallbackReceiver.address)))
          .to.be.eq(token0FromPair03)
        expect((await token2.balanceOf(fallbackReceiver.address)))
          .to.be.eq(token2FromPair23)
        expect((await token3.balanceOf(fallbackReceiver.address)))
          .to.be.eq(token3FromPair23.add(token3FromPair03))
      })

    it(
      'should only allow owner to transfer ownership',
      async () => {
        await expect(feeSplitter.connect(other).transferOwnership(other.address, overrides))
          .to.be.revertedWith('DXswapFeeSplitter: FORBIDDEN')
        await feeSplitter.connect(dxdao).transferOwnership(tokenOwner.address, overrides);
        expect(await feeSplitter.owner()).to.be.eq(tokenOwner.address)
      })

    it(
      'should only allow owner to change receivers',
      async () => {
        await expect(feeSplitter.connect(other).changeReceivers(other.address, other.address, overrides))
          .to.be.revertedWith('DXswapFeeSplitter: FORBIDDEN')
        await feeSplitter.connect(dxdao).changeReceivers(other.address, other.address, overrides);
        expect(await feeSplitter.ethReceiver()).to.be.eq(other.address)
        expect(await feeSplitter.fallbackReceiver()).to.be.eq(other.address)
      })

    it('should send tokens if there is not any liquidity in the WETH pair', async () => {
      const tokenAmount = expandTo18Decimals(100)
      const amountIn = expandTo18Decimals(50)

      await token0.transfer(pair01.address, tokenAmount)
      await token1.transfer(pair01.address, tokenAmount)
      await pair01.mint(dxdao.address, overrides)

      let amountOut = await getAmountOut(pair01, token0.address, amountIn)
      await token0.transfer(pair01.address, amountIn)
      await pair01.swap(0, amountOut, dxdao.address, '0x', overrides)

      amountOut = await getAmountOut(pair01, token1.address, amountIn)
      await token1.transfer(pair01.address, amountIn)
      await pair01.swap(amountOut, 0, dxdao.address, '0x', overrides)

      const protocolFeeToReceive = await calcProtocolFee(pair01, factory)

      await token0.transfer(pair01.address, expandTo18Decimals(10))
      await token1.transfer(pair01.address, expandTo18Decimals(10))
      await pair01.mint(dxdao.address, overrides)

      const protocolFeeLPToknesReceived = await pair01.balanceOf(feeSplitter.address)
      expect(protocolFeeLPToknesReceived.div(ROUND_EXCEPTION)).to.be.eq(protocolFeeToReceive.div(ROUND_EXCEPTION))

      const token0FromProtocolFee = protocolFeeLPToknesReceived
        .mul(await token0.balanceOf(pair01.address))
        .div(await pair01.totalSupply())
      const token1FromProtocolFee = protocolFeeLPToknesReceived
        .mul(await token1.balanceOf(pair01.address))
        .div(await pair01.totalSupply())

      const protocolfeeSplitterBalance = await provider.getBalance(protocolfeeSplitter.address)

      feeSplitter.connect(dxdao).takeProtocolFee([pair01.address], overrides)
      expect(await token0.balanceOf(feeSplitter.address)).to.eq(0)
      expect(await token1.balanceOf(feeSplitter.address)).to.eq(0)
      expect(await pair01.balanceOf(feeSplitter.address)).to.eq(0)
      expect(await WETH.balanceOf(feeSplitter.address)).to.eq(0)
      expect(await provider.getBalance(feeSplitter.address)).to.eq(0)

      expect(await provider.getBalance(protocolfeeSplitter.address)).to.be.eq(protocolfeeSplitterBalance)
      expect(await token0.balanceOf(fallbackReceiver.address)).to.be.eq(token0FromProtocolFee)
      expect(await token1.balanceOf(fallbackReceiver.address)).to.be.eq(token1FromProtocolFee)
    })

    // Where token0-token1 and token1-WETH pairs exist AND PRICE IMPACT TOO HIGH 
    it(
      'should receive token0 and token1 if price impact token1-weth pool is too high',
      async () => {
        const tokenAmount = expandTo18Decimals(100);
        const amountIn = expandTo18Decimals(1);
        // add very small liquidity to weth-token1 pool
        const wethTknAmountLowLP = BigNumber.from(1).mul(BigNumber.from(10).pow(15));

        await token0.transfer(pair01.address, tokenAmount)
        await token1.transfer(pair01.address, tokenAmount)
        await pair01.mint(dxdao.address, overrides)

        await token1.transfer(wethToken1Pair.address, wethTknAmountLowLP)
        await WETH.transfer(wethToken1Pair.address, wethTknAmountLowLP)
        await wethToken1Pair.mint(dxdao.address, overrides)

        let amountOut = await getAmountOut(pair01, token0.address, amountIn);

        await token0.transfer(pair01.address, amountIn)
        await pair01.swap(0, amountOut, dxdao.address, '0x', overrides)

        amountOut = await getAmountOut(pair01, token1.address, amountIn);
        await token1.transfer(pair01.address, amountIn)

        const protocolFeeToReceive = await calcProtocolFee(pair01, factory);

        await token0.transfer(pair01.address, expandTo18Decimals(15))
        await token1.transfer(pair01.address, expandTo18Decimals(15))
        await pair01.mint(dxdao.address, overrides)

        const protocolFeeLPToknesReceived = await pair01.balanceOf(feeSplitter.address);
        expect(protocolFeeLPToknesReceived.div(ROUND_EXCEPTION))
          .to.be.eq(protocolFeeToReceive.div(ROUND_EXCEPTION))

        const token0FromProtocolFee = protocolFeeLPToknesReceived
          .mul(await token0.balanceOf(pair01.address)).div(await pair01.totalSupply());
        const token1FromProtocolFee = protocolFeeLPToknesReceived
          .mul(await token1.balanceOf(pair01.address)).div(await pair01.totalSupply());

        const protocolfeeSplitterBalanceBeforeTake = await provider.getBalance(protocolfeeSplitter.address)

        await feeSplitter.connect(dxdao).takeProtocolFee([pair01.address], overrides)

        expect(await token0.balanceOf(feeSplitter.address)).to.eq(0)
        expect(await token1.balanceOf(feeSplitter.address)).to.eq(0)
        expect(await WETH.balanceOf(feeSplitter.address)).to.eq(0)
        expect(await pair01.balanceOf(feeSplitter.address)).to.eq(0)
        expect(await provider.getBalance(feeSplitter.address)).to.eq(0)

        expect((await provider.getBalance(protocolfeeSplitter.address)))
          .to.be.eq(protocolfeeSplitterBalanceBeforeTake)
        expect((await token0.balanceOf(fallbackReceiver.address)))
          .to.be.eq(token0FromProtocolFee)
        expect((await token1.balanceOf(fallbackReceiver.address)))
          .to.be.eq(token1FromProtocolFee)
      })
  })

  describe('external receiver on', () => {
    it(
      'should send tokenA & tokenB default 100% fee to dxdao and 0% fee to external receiver',
      async () => {
        const tokenAmount = expandTo18Decimals(100);
        const amountIn = expandTo18Decimals(50);

        await feeSplitter.setExternalFeeReceiver(pair23.address, externalfeeSplitter.address)
        const [externalReceiver, percentFeeToExternalReceiver] = await feeSplitter.externalFeeReceivers(pair23.address)
        expect(percentFeeToExternalReceiver).to.eq(0)
        expect(externalReceiver).to.eq(externalfeeSplitter.address)


        await token2.transfer(pair23.address, tokenAmount)
        await token3.transfer(pair23.address, tokenAmount)
        await pair23.mint(dxdao.address, overrides)

        let amountOut = await getAmountOut(pair23, token2.address, amountIn)
        await token2.transfer(pair23.address, amountIn)
        await pair23.swap(
          (token2.address < token3.address) ? 0 : amountOut,
          (token2.address < token3.address) ? amountOut : 0,
          dxdao.address, '0x', overrides
        )

        amountOut = await getAmountOut(pair23, token3.address, amountIn)
        await token3.transfer(pair23.address, amountIn)
        await pair23.swap(
          (token2.address < token3.address) ? amountOut : 0,
          (token2.address < token3.address) ? 0 : amountOut,
          dxdao.address, '0x', overrides
        )

        let protocolFeeToReceive = await calcProtocolFee(pair23, factory);

        await token2.transfer(pair23.address, expandTo18Decimals(10))
        await token3.transfer(pair23.address, expandTo18Decimals(10))
        await pair23.mint(dxdao.address, overrides)

        const protocolFeeLP = await pair23.balanceOf(feeSplitter.address);
        expect(protocolFeeLP.div(ROUND_EXCEPTION))
          .to.be.eq(protocolFeeToReceive.div(ROUND_EXCEPTION))

        const tokenAFromProtocolFee = protocolFeeLP
          .mul(await token2.balanceOf(pair23.address)).div(await pair23.totalSupply());
        const tokenBFromProtocolFee = protocolFeeLP
          .mul(await token3.balanceOf(pair23.address)).div(await pair23.totalSupply());

        const protocolfeeSplitterBalance = await provider.getBalance(protocolfeeSplitter.address)

        const balanceTkn2 = await token2.balanceOf(fallbackReceiver.address)
        const balanceTkn3 = await token3.balanceOf(fallbackReceiver.address)

        await feeSplitter.connect(dxdao).takeProtocolFee([pair23.address], overrides)

        expect(await provider.getBalance(protocolfeeSplitter.address)).to.eq(protocolfeeSplitterBalance.toString())

        expect(await token2.balanceOf(feeSplitter.address)).to.eq(0)
        expect(await token3.balanceOf(feeSplitter.address)).to.eq(0)
        expect(await WETH.balanceOf(feeSplitter.address)).to.eq(0)
        expect(await pair01.balanceOf(feeSplitter.address)).to.eq(0)
        expect(await provider.getBalance(feeSplitter.address)).to.eq(0)

        expect((await provider.getBalance(protocolfeeSplitter.address)))
          .to.be.eq(protocolfeeSplitterBalance)

        expect((await token2.balanceOf(fallbackReceiver.address)))
          .to.be.eq(balanceTkn2.add(tokenAFromProtocolFee))
        expect((await token2.balanceOf(externalfeeSplitter.address)))
          .to.be.eq(0)

        expect((await token3.balanceOf(fallbackReceiver.address)))
          .to.be.eq(balanceTkn3.add(tokenBFromProtocolFee))
        expect((await token3.balanceOf(externalfeeSplitter.address)))
          .to.be.eq(0)
      })

    it(
      'should split protocol fee and send tokenA & tokenB to dxdao and external fee receiver',
      async () => {
        const tokenAmount = expandTo18Decimals(100);
        const amountIn = expandTo18Decimals(50);
        const newPercentFeeToExternalReceiver = 2000 //20%

        // set external fee receiver
        await feeSplitter.setExternalFeeReceiver(pair23.address, externalfeeSplitter.address)
        await feeSplitter.setFeePercentageToExternalReceiver(pair23.address, newPercentFeeToExternalReceiver)
        const [newExternalReceiver, percentFeeToExternalReceiver] = await feeSplitter.externalFeeReceivers(pair23.address)
        expect(percentFeeToExternalReceiver).to.eq(newPercentFeeToExternalReceiver)
        expect(newExternalReceiver).to.eq(externalfeeSplitter.address)

        await token2.transfer(pair23.address, tokenAmount)
        await token3.transfer(pair23.address, tokenAmount)
        await pair23.mint(dxdao.address, overrides)

        let amountOut = await getAmountOut(pair23, token2.address, amountIn)
        await token2.transfer(pair23.address, amountIn)
        await pair23.swap(
          (token2.address < token3.address) ? 0 : amountOut,
          (token2.address < token3.address) ? amountOut : 0,
          dxdao.address, '0x', overrides
        )

        amountOut = await getAmountOut(pair23, token3.address, amountIn)
        await token3.transfer(pair23.address, amountIn)
        await pair23.swap(
          (token2.address < token3.address) ? amountOut : 0,
          (token2.address < token3.address) ? 0 : amountOut,
          dxdao.address, '0x', overrides
        )

        let protocolFeeToReceive = await calcProtocolFee(pair23, factory);

        await token2.transfer(pair23.address, expandTo18Decimals(10))
        await token3.transfer(pair23.address, expandTo18Decimals(10))
        await pair23.mint(dxdao.address, overrides)

        const protocolFeeLP = await pair23.balanceOf(feeSplitter.address);
        expect(protocolFeeLP.div(ROUND_EXCEPTION))
          .to.be.eq(protocolFeeToReceive.div(ROUND_EXCEPTION))

        const tokenAFromProtocolFee = protocolFeeLP
          .mul(await token2.balanceOf(pair23.address)).div(await pair23.totalSupply());
        const tokenBFromProtocolFee = protocolFeeLP
          .mul(await token3.balanceOf(pair23.address)).div(await pair23.totalSupply());

        const tokenAExternal = tokenAFromProtocolFee.mul(percentFeeToExternalReceiver).div(10000);
        const tokenBExternal = tokenBFromProtocolFee.mul(percentFeeToExternalReceiver).div(10000);
        const tokenAfeeSplitter = tokenAFromProtocolFee.sub(tokenAExternal);
        const tokenBfeeSplitter = tokenBFromProtocolFee.sub(tokenBExternal);

        const protocolfeeSplitterBalance = await provider.getBalance(protocolfeeSplitter.address);

        await feeSplitter.connect(dxdao).takeProtocolFee([pair23.address], overrides)

        expect(await provider.getBalance(protocolfeeSplitter.address)).to.eq(protocolfeeSplitterBalance)

        expect(await token2.balanceOf(feeSplitter.address)).to.eq(0)
        expect(await token3.balanceOf(feeSplitter.address)).to.eq(0)
        expect(await WETH.balanceOf(feeSplitter.address)).to.eq(0)
        expect(await pair01.balanceOf(feeSplitter.address)).to.eq(0)
        expect(await provider.getBalance(feeSplitter.address)).to.eq(0)

        expect((await provider.getBalance(protocolfeeSplitter.address)))
          .to.be.eq(protocolfeeSplitterBalance)

        expect((await token2.balanceOf(fallbackReceiver.address)))
          .to.be.eq(tokenAfeeSplitter)
        expect((await token2.balanceOf(externalfeeSplitter.address)))
          .to.be.eq(tokenAExternal)
        expect((await token3.balanceOf(fallbackReceiver.address)))
          .to.be.eq(tokenBfeeSplitter)
        expect((await token3.balanceOf(externalfeeSplitter.address)))
          .to.be.eq(tokenBExternal)
      })

    // Where token0-token1, token0-WETH and token1-WETH pairs exist
    it(
      'should swap token0 & token1 to ETH and sent to ethReceiver when extracting fee from token0-token1',
      async () => {
        const tokenAmount = expandTo18Decimals(40);
        const wethAmount = expandTo18Decimals(40);
        const amountIn = expandTo18Decimals(4);

        await token0.transfer(pair01.address, tokenAmount)
        await token1.transfer(pair01.address, tokenAmount)
        await pair01.mint(dxdao.address, overrides)

        await token0.transfer(wethToken0Pair.address, tokenAmount)
        await WETH.transfer(wethToken0Pair.address, wethAmount)
        await wethToken0Pair.mint(dxdao.address, overrides)

        await token1.transfer(wethToken1Pair.address, tokenAmount)
        await WETH.transfer(wethToken1Pair.address, wethAmount)
        await wethToken1Pair.mint(dxdao.address, overrides)

        let amountOut = await getAmountOut(pair01, token0.address, amountIn);

        await token0.transfer(pair01.address, amountIn)
        await pair01.swap(0, amountOut, dxdao.address, '0x', overrides)

        amountOut = await getAmountOut(pair01, token1.address, amountIn);
        await token1.transfer(pair01.address, amountIn)
        await pair01.swap(amountOut, 0, dxdao.address, '0x', overrides)

        const protocolFeeToReceive = await calcProtocolFee(pair01, factory);

        await token0.transfer(pair01.address, expandTo18Decimals(2))
        await token1.transfer(pair01.address, expandTo18Decimals(2))
        await pair01.mint(dxdao.address, overrides)

        const protocolFeeLPToknesReceived = await pair01.balanceOf(feeSplitter.address);
        expect(protocolFeeLPToknesReceived.div(ROUND_EXCEPTION))
          .to.be.eq(protocolFeeToReceive.div(ROUND_EXCEPTION))

        const token0FromProtocolFee = protocolFeeLPToknesReceived
          .mul(await token0.balanceOf(pair01.address)).div(await pair01.totalSupply());
        const token1FromProtocolFee = protocolFeeLPToknesReceived
          .mul(await token1.balanceOf(pair01.address)).div(await pair01.totalSupply());

        const wethFromToken0FromProtocolFee = await getAmountOut(wethToken0Pair, token0.address, token0FromProtocolFee);
        const wethFromToken1FromProtocolFee = await getAmountOut(wethToken1Pair, token1.address, token1FromProtocolFee);

        const protocolfeeSplitterBalanceBeforeTake = await provider.getBalance(protocolfeeSplitter.address)

        await feeSplitter.connect(dxdao).takeProtocolFee([pair01.address], overrides)

        expect(await token0.balanceOf(feeSplitter.address)).to.eq(0)
        expect(await token1.balanceOf(feeSplitter.address)).to.eq(0)
        expect(await WETH.balanceOf(feeSplitter.address)).to.eq(0)
        expect(await pair01.balanceOf(feeSplitter.address)).to.eq(0)
        expect(await provider.getBalance(feeSplitter.address)).to.eq(0)

        expect((await token0.balanceOf(protocolfeeSplitter.address)))
          .to.eq(0)
        expect((await token1.balanceOf(protocolfeeSplitter.address)))
          .to.eq(0)
        expect((await provider.getBalance(protocolfeeSplitter.address)))
          .to.be.eq(protocolfeeSplitterBalanceBeforeTake.add(wethFromToken0FromProtocolFee).add(wethFromToken1FromProtocolFee))
      })

    // Where token0-token1, token0-WETH and token1-WETH pairs exist
    it(
      'should receive token0 and ETH when extracting fee from token0-token1 and swap LPs exist but not enough liquidity',
      async () => {
        const tokenAmount = expandTo18Decimals(40);
        const wethAmount = expandTo18Decimals(40);
        const amountIn = expandTo18Decimals(4);
        // add very small liquidity to weth-token0 pool
        const wethTknAmountLowLP = BigNumber.from(1).mul(BigNumber.from(10).pow(6));

        await token0.transfer(pair01.address, tokenAmount)
        await token1.transfer(pair01.address, tokenAmount)
        await pair01.mint(dxdao.address, overrides)

        await token0.transfer(wethToken0Pair.address, wethTknAmountLowLP)
        await WETH.transfer(wethToken0Pair.address, wethTknAmountLowLP)
        await wethToken0Pair.mint(dxdao.address, overrides)

        await token1.transfer(wethToken1Pair.address, tokenAmount)
        await WETH.transfer(wethToken1Pair.address, wethAmount)
        await wethToken1Pair.mint(dxdao.address, overrides)

        let amountOut = await getAmountOut(pair01, token0.address, amountIn);

        await token0.transfer(pair01.address, amountIn)
        await pair01.swap(0, amountOut, dxdao.address, '0x', overrides)

        amountOut = await getAmountOut(pair01, token1.address, amountIn);
        await token1.transfer(pair01.address, amountIn)
        await pair01.swap(amountOut, 0, dxdao.address, '0x', overrides)

        const protocolFeeToReceive = await calcProtocolFee(pair01, factory);

        await token0.transfer(pair01.address, expandTo18Decimals(10))
        await token1.transfer(pair01.address, expandTo18Decimals(10))
        await pair01.mint(dxdao.address, overrides)

        const protocolFeeLPToknesReceived = await pair01.balanceOf(feeSplitter.address);
        expect(protocolFeeLPToknesReceived.div(ROUND_EXCEPTION))
          .to.be.eq(protocolFeeToReceive.div(ROUND_EXCEPTION))

        const token0FromProtocolFee = protocolFeeLPToknesReceived
          .mul(await token0.balanceOf(pair01.address)).div(await pair01.totalSupply());
        const token1FromProtocolFee = protocolFeeLPToknesReceived
          .mul(await token1.balanceOf(pair01.address)).div(await pair01.totalSupply());

        const wethFromToken1FromProtocolFee = await getAmountOut(wethToken1Pair, token1.address, token1FromProtocolFee);

        const protocolfeeSplitterBalanceBeforeTake = await provider.getBalance(protocolfeeSplitter.address)

        await feeSplitter.connect(dxdao).takeProtocolFee([pair01.address], overrides)

        expect(await token0.balanceOf(feeSplitter.address)).to.eq(0)
        expect(await token1.balanceOf(feeSplitter.address)).to.eq(0)
        expect(await WETH.balanceOf(feeSplitter.address)).to.eq(0)
        expect(await pair01.balanceOf(feeSplitter.address)).to.eq(0)
        expect(await provider.getBalance(feeSplitter.address)).to.eq(0)

        expect(await token0.balanceOf(fallbackReceiver.address))
          .to.eq(token0FromProtocolFee)
        expect(await token1.balanceOf(protocolfeeSplitter.address))
          .to.eq(0)
        expect(await provider.getBalance(protocolfeeSplitter.address))
          .to.be.eq(protocolfeeSplitterBalanceBeforeTake.add(wethFromToken1FromProtocolFee))
      })

    // Where token0-token1, token0-WETH and token1-WETH pairs exist
    it(
      'should receive token0 and ETH when extracting fee from token0-token1 and swap LPs exist but token reserve is 0',
      async () => {
        const tokenAmount = expandTo18Decimals(40);
        const wethAmount = expandTo18Decimals(40);
        const amountIn = expandTo18Decimals(4);
        // add very small liquidity to weth-token0 pool
        const wethTknAmountLowLP = BigNumber.from(1).mul(BigNumber.from(10).pow(6));

        await token0.transfer(pair01.address, tokenAmount)
        await token1.transfer(pair01.address, tokenAmount)
        await pair01.mint(dxdao.address, overrides)

        // dont transfer token0 to the pool and dont mint lp tokens
        await WETH.transfer(wethToken0Pair.address, wethTknAmountLowLP)

        await token1.transfer(wethToken1Pair.address, tokenAmount)
        await WETH.transfer(wethToken1Pair.address, wethAmount)
        await wethToken1Pair.mint(dxdao.address, overrides)

        let amountOut = await getAmountOut(pair01, token0.address, amountIn);

        await token0.transfer(pair01.address, amountIn)
        await pair01.swap(0, amountOut, dxdao.address, '0x', overrides)

        amountOut = await getAmountOut(pair01, token1.address, amountIn);
        await token1.transfer(pair01.address, amountIn)
        await pair01.swap(amountOut, 0, dxdao.address, '0x', overrides)

        const protocolFeeToReceive = await calcProtocolFee(pair01, factory);

        await token0.transfer(pair01.address, expandTo18Decimals(10))
        await token1.transfer(pair01.address, expandTo18Decimals(10))
        await pair01.mint(dxdao.address, overrides)

        const protocolFeeLPToknesReceived = await pair01.balanceOf(feeSplitter.address);
        expect(protocolFeeLPToknesReceived.div(ROUND_EXCEPTION))
          .to.be.eq(protocolFeeToReceive.div(ROUND_EXCEPTION))

        const token0FromProtocolFee = protocolFeeLPToknesReceived
          .mul(await token0.balanceOf(pair01.address)).div(await pair01.totalSupply());
        const token1FromProtocolFee = protocolFeeLPToknesReceived
          .mul(await token1.balanceOf(pair01.address)).div(await pair01.totalSupply());

        const wethFromToken1FromProtocolFee = await getAmountOut(wethToken1Pair, token1.address, token1FromProtocolFee);

        const protocolfeeSplitterBalanceBeforeTake = await provider.getBalance(protocolfeeSplitter.address)

        await feeSplitter.connect(dxdao).takeProtocolFee([pair01.address], overrides)

        expect(await token0.balanceOf(feeSplitter.address)).to.eq(0)
        expect(await token1.balanceOf(feeSplitter.address)).to.eq(0)
        expect(await WETH.balanceOf(feeSplitter.address)).to.eq(0)
        expect(await pair01.balanceOf(feeSplitter.address)).to.eq(0)
        expect(await provider.getBalance(feeSplitter.address)).to.eq(0)

        expect((await token0.balanceOf(fallbackReceiver.address)))
          .to.eq(token0FromProtocolFee)
        expect((await token1.balanceOf(protocolfeeSplitter.address)))
          .to.eq(0)
        expect((await provider.getBalance(protocolfeeSplitter.address)))
          .to.be.eq(protocolfeeSplitterBalanceBeforeTake.add(wethFromToken1FromProtocolFee))
      })

    // Where token0-token1, token0-WETH and token1-WETH pairs exist
    it(
      'should swap tkn0 & tkn1 to ETH and split fee when extracting from tkn0-tkn1',
      async () => {
        const tokenAmount = expandTo18Decimals(40);
        const wethAmount = expandTo18Decimals(40);
        const amountIn = expandTo18Decimals(4);
        const newPercentFeeToExternalReceiver = 2000 //20%

        await token0.transfer(pair01.address, tokenAmount)
        await token1.transfer(pair01.address, tokenAmount)
        await pair01.mint(dxdao.address, overrides)

        // set external fee receiver
        await feeSplitter.setExternalFeeReceiver(pair01.address, externalfeeSplitter.address)
        await feeSplitter.setFeePercentageToExternalReceiver(pair01.address, newPercentFeeToExternalReceiver)
        const [externalReceiver, percentFeeToExternalReceiver] = await feeSplitter.externalFeeReceivers(pair01.address)
        expect(percentFeeToExternalReceiver).to.eq(newPercentFeeToExternalReceiver)
        expect(externalReceiver).to.eq(externalfeeSplitter.address)

        await token0.transfer(wethToken0Pair.address, tokenAmount)
        await WETH.transfer(wethToken0Pair.address, wethAmount)
        await wethToken0Pair.mint(dxdao.address, overrides)

        await token1.transfer(wethToken1Pair.address, tokenAmount)
        await WETH.transfer(wethToken1Pair.address, wethAmount)
        await wethToken1Pair.mint(dxdao.address, overrides)

        let amountOut = await getAmountOut(pair01, token0.address, amountIn);

        await token0.transfer(pair01.address, amountIn)
        await pair01.swap(0, amountOut, dxdao.address, '0x', overrides)

        amountOut = await getAmountOut(pair01, token1.address, amountIn);
        await token1.transfer(pair01.address, amountIn)
        await pair01.swap(amountOut, 0, dxdao.address, '0x', overrides)

        const protocolFeeToReceive = await calcProtocolFee(pair01, factory);

        await token0.transfer(pair01.address, expandTo18Decimals(10))
        await token1.transfer(pair01.address, expandTo18Decimals(10))
        await pair01.mint(dxdao.address, overrides)

        const protocolFeeLPToknesReceived = await pair01.balanceOf(feeSplitter.address);
        expect(protocolFeeLPToknesReceived.div(ROUND_EXCEPTION))
          .to.be.eq(protocolFeeToReceive.div(ROUND_EXCEPTION))

        const token0FromProtocolFee = protocolFeeLPToknesReceived
          .mul(await token0.balanceOf(pair01.address)).div(await pair01.totalSupply());
        const token1FromProtocolFee = protocolFeeLPToknesReceived
          .mul(await token1.balanceOf(pair01.address)).div(await pair01.totalSupply());

        const wethFromToken0FromProtocolFee = await getAmountOut(wethToken0Pair, token0.address, token0FromProtocolFee);
        const wethFromToken1FromProtocolFee = await getAmountOut(wethToken1Pair, token1.address, token1FromProtocolFee);

        const protocolfeeSplitterBalanceBeforeTake = await provider.getBalance(protocolfeeSplitter.address)
        const externalfeeSplitterBalanceBeforeTake = await provider.getBalance(externalfeeSplitter.address)

        await feeSplitter.connect(dxdao).takeProtocolFee([pair01.address], overrides)

        expect(await token0.balanceOf(feeSplitter.address)).to.eq(0)
        expect(await token1.balanceOf(feeSplitter.address)).to.eq(0)
        expect(await WETH.balanceOf(feeSplitter.address)).to.eq(0)
        expect(await pair01.balanceOf(feeSplitter.address)).to.eq(0)
        expect(await provider.getBalance(feeSplitter.address)).to.eq(0)

        expect((await token0.balanceOf(protocolfeeSplitter.address)))
          .to.eq(0)
        expect((await token1.balanceOf(protocolfeeSplitter.address)))
          .to.eq(0)
        expect((await token0.balanceOf(externalfeeSplitter.address)))
          .to.eq(0)
        expect((await token1.balanceOf(externalfeeSplitter.address)))
          .to.eq(0)

        const totalWethFromFees = wethFromToken0FromProtocolFee.add(wethFromToken1FromProtocolFee)
        const wethToExternalReceiver = totalWethFromFees.mul(percentFeeToExternalReceiver).div(10000)
        const wethToProtocolfeeSplitter = totalWethFromFees.sub(wethToExternalReceiver)

        expect((await provider.getBalance(protocolfeeSplitter.address)).div(ROUND_EXCEPTION))
          .to.be.eq((protocolfeeSplitterBalanceBeforeTake.add(wethToProtocolfeeSplitter)).div(ROUND_EXCEPTION))
        expect((await provider.getBalance(externalfeeSplitter.address)).div(ROUND_EXCEPTION))
          .to.be.eq((externalfeeSplitterBalanceBeforeTake.add(wethToExternalReceiver)).div(ROUND_EXCEPTION))
      })

    // Where token0-token1, token0-WETH and token1-WETH pairs exist
    it(
      'should split tkn0 & tkn1 fee when extracting from tkn0-tkn1 and swap to weth impossible',
      async () => {
        const tokenAmount = expandTo18Decimals(40);
        const wethAmount = expandTo18Decimals(40);
        const amountIn = expandTo18Decimals(4);
        const newPercentFeeToExternalReceiver = 2000 //20%

        await token0.transfer(pair01.address, tokenAmount)
        await token1.transfer(pair01.address, tokenAmount)
        await pair01.mint(dxdao.address, overrides)

        // set external fee receiver
        await feeSplitter.setExternalFeeReceiver(pair01.address, externalfeeSplitter.address)
        await feeSplitter.setFeePercentageToExternalReceiver(pair01.address, newPercentFeeToExternalReceiver)
        const [externalReceiver, percentFeeToExternalReceiver] = await feeSplitter.externalFeeReceivers(pair01.address)
        expect(percentFeeToExternalReceiver).to.eq(newPercentFeeToExternalReceiver)
        expect(externalReceiver).to.eq(externalfeeSplitter.address)

        let amountOut = await getAmountOut(pair01, token0.address, amountIn);

        await token0.transfer(pair01.address, amountIn)
        await pair01.swap(0, amountOut, dxdao.address, '0x', overrides)

        amountOut = await getAmountOut(pair01, token1.address, amountIn);
        await token1.transfer(pair01.address, amountIn)
        await pair01.swap(amountOut, 0, dxdao.address, '0x', overrides)

        amountOut = await getAmountOut(pair01, token1.address, amountIn);
        await token1.transfer(pair01.address, amountIn)
        await pair01.swap(amountOut, 0, dxdao.address, '0x', overrides)

        const protocolFeeToReceive = await calcProtocolFee(pair01, factory);

        await token0.transfer(pair01.address, expandTo18Decimals(10))
        await token1.transfer(pair01.address, expandTo18Decimals(10))
        await pair01.mint(dxdao.address, overrides)

        const protocolFeeLPToknesReceived = await pair01.balanceOf(feeSplitter.address);
        expect(protocolFeeLPToknesReceived.div(ROUND_EXCEPTION))
          .to.be.eq(protocolFeeToReceive.div(ROUND_EXCEPTION))

        const token0FromProtocolFee = protocolFeeLPToknesReceived
          .mul(await token0.balanceOf(pair01.address)).div(await pair01.totalSupply());
        const token1FromProtocolFee = protocolFeeLPToknesReceived
          .mul(await token1.balanceOf(pair01.address)).div(await pair01.totalSupply());

        const receiverBalanceBeforeTake = await provider.getBalance(protocolfeeSplitter.address)
        const protocolfeeSplitterBalanceBeforeTake = await provider.getBalance(protocolfeeSplitter.address)
        const externalfeeSplitterBalanceBeforeTake = await provider.getBalance(externalfeeSplitter.address)

        await feeSplitter.connect(dxdao).takeProtocolFee([pair01.address], overrides)

        const tkn0ToExternalReceiver = token0FromProtocolFee.mul(percentFeeToExternalReceiver).div(10000)
        const tkn1ToExternalReceiver = token1FromProtocolFee.mul(percentFeeToExternalReceiver).div(10000)
        const tkn0ToProtocolfeeSplitter = token0FromProtocolFee.sub(tkn0ToExternalReceiver)
        const tkn1ToProtocolfeeSplitter = token1FromProtocolFee.sub(tkn1ToExternalReceiver)

        expect(await token0.balanceOf(feeSplitter.address)).to.eq(0)
        expect(await token1.balanceOf(feeSplitter.address)).to.eq(0)
        expect(await WETH.balanceOf(feeSplitter.address)).to.eq(0)
        expect(await pair01.balanceOf(feeSplitter.address)).to.eq(0)
        expect(await provider.getBalance(feeSplitter.address)).to.eq(0)

        // send token0 and token1 to fallbackreceiver and external fee receiver
        expect((await token0.balanceOf(fallbackReceiver.address)))
          .to.eq(tkn0ToProtocolfeeSplitter)
        expect((await token1.balanceOf(fallbackReceiver.address)))
          .to.eq(tkn1ToProtocolfeeSplitter)
        expect((await token0.balanceOf(externalfeeSplitter.address)))
          .to.eq(tkn0ToExternalReceiver)
        expect((await token1.balanceOf(externalfeeSplitter.address)))
          .to.eq(tkn1ToExternalReceiver)

        // should not change eth balance
        expect((await provider.getBalance(protocolfeeSplitter.address)))
          .to.eq(receiverBalanceBeforeTake)
        expect((await provider.getBalance(protocolfeeSplitter.address)))
          .to.eq(protocolfeeSplitterBalanceBeforeTake)
        expect((await provider.getBalance(externalfeeSplitter.address)))
          .to.eq(externalfeeSplitterBalanceBeforeTake)
      })

    // Where token0-token1, token0-WETH and token1-WETH pairs exist
    it(
      'should update protocol fee and split tkn0 & tkn1 fee when extracting from tkn0-tkn1 and swap to weth impossible',
      async () => {
        const tokenAmount = expandTo18Decimals(40);
        const wethAmount = expandTo18Decimals(40);
        const amountIn = expandTo18Decimals(4);
        const newPercentFeeToExternalReceiver = 2000 //20%

        await token0.transfer(pair01.address, tokenAmount)
        await token1.transfer(pair01.address, tokenAmount)
        await pair01.mint(dxdao.address, overrides)

        // set external fee receiver
        await feeSplitter.setExternalFeeReceiver(pair01.address, externalfeeSplitter.address)
        await feeSplitter.setFeePercentageToExternalReceiver(pair01.address, newPercentFeeToExternalReceiver)
        const [externalReceiver, percentFeeToExternalReceiver] = await feeSplitter.externalFeeReceivers(pair01.address)
        expect(percentFeeToExternalReceiver).to.eq(newPercentFeeToExternalReceiver)
        expect(externalReceiver).to.eq(externalfeeSplitter.address)

        let amountOut = await getAmountOut(pair01, token0.address, amountIn);

        await token0.transfer(pair01.address, amountIn)
        await pair01.swap(0, amountOut, dxdao.address, '0x', overrides)

        amountOut = await getAmountOut(pair01, token1.address, amountIn);
        await token1.transfer(pair01.address, amountIn)
        await pair01.swap(amountOut, 0, dxdao.address, '0x', overrides)

        amountOut = await getAmountOut(pair01, token1.address, amountIn);
        await token1.transfer(pair01.address, amountIn)
        await pair01.swap(amountOut, 0, dxdao.address, '0x', overrides)

        // change protocol fee
        await feeSetter.connect(dxdao).setProtocolFee(20)
        expect(await factory.protocolFeeDenominator()).to.eq(20)

        amountOut = await getAmountOut(pair01, token1.address, amountIn);
        await token1.transfer(pair01.address, amountIn)
        await pair01.swap(amountOut, 0, dxdao.address, '0x', overrides)

        amountOut = await getAmountOut(pair01, token1.address, amountIn);
        await token1.transfer(pair01.address, amountIn)
        await pair01.swap(amountOut, 0, dxdao.address, '0x', overrides)

        const protocolFeeToReceive = await calcProtocolFee(pair01, factory);

        await token0.transfer(pair01.address, expandTo18Decimals(10))
        await token1.transfer(pair01.address, expandTo18Decimals(10))
        await pair01.mint(dxdao.address, overrides)

        const protocolFeeLPToknesReceived = await pair01.balanceOf(feeSplitter.address);
        expect(protocolFeeLPToknesReceived.div(ROUND_EXCEPTION))
          .to.be.eq(protocolFeeToReceive.div(ROUND_EXCEPTION))

        const token0FromProtocolFee = protocolFeeLPToknesReceived
          .mul(await token0.balanceOf(pair01.address)).div(await pair01.totalSupply());
        const token1FromProtocolFee = protocolFeeLPToknesReceived
          .mul(await token1.balanceOf(pair01.address)).div(await pair01.totalSupply());

        const protocolfeeSplitterBalanceBeforeTake = await provider.getBalance(protocolfeeSplitter.address)
        const externalfeeSplitterBalanceBeforeTake = await provider.getBalance(externalfeeSplitter.address)

        await feeSplitter.connect(dxdao).takeProtocolFee([pair01.address], overrides)

        const tkn0ToExternalReceiver = token0FromProtocolFee.mul(percentFeeToExternalReceiver).div(10000)
        const tkn1ToExternalReceiver = token1FromProtocolFee.mul(percentFeeToExternalReceiver).div(10000)
        const tkn0ToProtocolfeeSplitter = token0FromProtocolFee.sub(tkn0ToExternalReceiver)
        const tkn1ToProtocolfeeSplitter = token1FromProtocolFee.sub(tkn1ToExternalReceiver)

        expect(await token0.balanceOf(feeSplitter.address)).to.eq(0)
        expect(await token1.balanceOf(feeSplitter.address)).to.eq(0)
        expect(await WETH.balanceOf(feeSplitter.address)).to.eq(0)
        expect(await pair01.balanceOf(feeSplitter.address)).to.eq(0)
        expect(await provider.getBalance(feeSplitter.address)).to.eq(0)

        // send token0 and token1 to fallbackreceiver and external fee receiver
        expect((await token0.balanceOf(fallbackReceiver.address)))
          .to.eq(tkn0ToProtocolfeeSplitter)
        expect((await token1.balanceOf(fallbackReceiver.address)))
          .to.eq(tkn1ToProtocolfeeSplitter)
        expect((await token0.balanceOf(externalfeeSplitter.address)))
          .to.eq(tkn0ToExternalReceiver)
        expect((await token1.balanceOf(externalfeeSplitter.address)))
          .to.eq(tkn1ToExternalReceiver)

        // should not change eth balance
        expect((await provider.getBalance(protocolfeeSplitter.address)))
          .to.eq(protocolfeeSplitterBalanceBeforeTake)
        expect((await provider.getBalance(externalfeeSplitter.address)))
          .to.eq(externalfeeSplitterBalanceBeforeTake)
      })

    // Where tokenA-tokenB, tokenC-tokenD and tokenC-WETH pairs exist
    it(
      'should receive tokens 2,3 and ETH (token0 swapped) from pair 23, 03',
      async () => {
        const tokenAmount = expandTo18Decimals(100);
        const wethAmount = expandTo18Decimals(100);
        const amountIn = expandTo18Decimals(50);

        await token0.transfer(wethToken0Pair.address, tokenAmount)
        await WETH.transfer(wethToken0Pair.address, wethAmount)
        await wethToken0Pair.mint(dxdao.address, overrides)

        // pair23
        await token2.transfer(pair23.address, tokenAmount)
        await token3.transfer(pair23.address, tokenAmount)
        await pair23.mint(dxdao.address, overrides)

        let amountOut = await getAmountOut(pair23, token2.address, amountIn)
        await token2.transfer(pair23.address, amountIn)
        await pair23.swap(
          (token2.address < token3.address) ? 0 : amountOut,
          (token2.address < token3.address) ? amountOut : 0,
          dxdao.address, '0x', overrides
        )

        amountOut = await getAmountOut(pair23, token3.address, amountIn)
        await token3.transfer(pair23.address, amountIn)
        await pair23.swap(
          (token2.address < token3.address) ? amountOut : 0,
          (token2.address < token3.address) ? 0 : amountOut,
          dxdao.address, '0x', overrides
        )

        let protocolFeeToReceive = await calcProtocolFee(pair23, factory);

        await token2.transfer(pair23.address, expandTo18Decimals(10))
        await token3.transfer(pair23.address, expandTo18Decimals(10))
        await pair23.mint(dxdao.address, overrides)

        const protocolFeeLPPair23 = await pair23.balanceOf(feeSplitter.address);
        expect(protocolFeeLPPair23.div(ROUND_EXCEPTION))
          .to.be.eq(protocolFeeToReceive.div(ROUND_EXCEPTION))

        // pair03 
        await token0.transfer(pair03.address, tokenAmount)
        await token3.transfer(pair03.address, tokenAmount)
        await pair03.mint(dxdao.address, overrides)

        amountOut = await getAmountOut(pair03, token2.address, amountIn)
        await token0.transfer(pair03.address, amountIn)
        await pair03.swap(
          (token0.address < token3.address) ? 0 : amountOut,
          (token0.address < token3.address) ? amountOut : 0,
          dxdao.address, '0x', overrides
        )

        amountOut = await getAmountOut(pair03, token3.address, amountIn)
        await token3.transfer(pair03.address, amountIn)
        await pair03.swap(
          (token0.address < token3.address) ? amountOut : 0,
          (token0.address < token3.address) ? 0 : amountOut,
          dxdao.address, '0x', overrides
        )

        protocolFeeToReceive = await calcProtocolFee(pair03, factory);

        await token0.transfer(pair03.address, expandTo18Decimals(10))
        await token3.transfer(pair03.address, expandTo18Decimals(10))
        await pair03.mint(dxdao.address, overrides)

        const protocolFeeLPPair03 = await pair03.balanceOf(feeSplitter.address);
        expect(protocolFeeLPPair03.div(ROUND_EXCEPTION))
          .to.be.eq(protocolFeeToReceive.div(ROUND_EXCEPTION))

        const tokenAFromProtocolFee = protocolFeeLPPair23
          .mul(await token2.balanceOf(pair23.address)).div(await pair23.totalSupply());
        const tokenBFromProtocolFee = protocolFeeLPPair23
          .mul(await token3.balanceOf(pair23.address)).div(await pair23.totalSupply());
        const tokenCFromProtocolFee = protocolFeeLPPair03
          .mul(await token0.balanceOf(pair03.address)).div(await pair03.totalSupply());
        const tokenDFromProtocolFee = protocolFeeLPPair03
          .mul(await token3.balanceOf(pair03.address)).div(await pair03.totalSupply());

        const wethFromToken0FromProtocolFee = await getAmountOut(wethToken0Pair, token0.address, tokenCFromProtocolFee);
        const protocolfeeSplitterBalance = await provider.getBalance(protocolfeeSplitter.address)

        await expect(feeSplitter.connect(dxdao).takeProtocolFee([pair23.address, pair03.address], overrides)
        ).to.emit(feeSplitter, 'TakeProtocolFee').withArgs(dxdao.address, protocolfeeSplitter.address, 2)

        expect(await token2.balanceOf(feeSplitter.address)).to.eq(0)
        expect(await token3.balanceOf(feeSplitter.address)).to.eq(0)
        expect(await token0.balanceOf(feeSplitter.address)).to.eq(0)
        expect(await WETH.balanceOf(feeSplitter.address)).to.eq(0)
        expect(await pair01.balanceOf(feeSplitter.address)).to.eq(0)
        expect(await provider.getBalance(feeSplitter.address)).to.eq(0)

        expect((await token2.balanceOf(fallbackReceiver.address)))
          .to.be.eq(tokenAFromProtocolFee)
        expect((await token3.balanceOf(fallbackReceiver.address)))
          .to.be.eq(tokenBFromProtocolFee.add(tokenDFromProtocolFee))

        expect((await token0.balanceOf(fallbackReceiver.address)))
          .to.eq(0)
        expect((await provider.getBalance(protocolfeeSplitter.address)))
          .to.be.eq(protocolfeeSplitterBalance.add(wethFromToken0FromProtocolFee))
      })

    it(
      'should receive tkn0 and eth if split % was updated',
      async () => {
        const tokenAmount = expandTo18Decimals(40);
        const wethAmount = expandTo18Decimals(40);
        const amountIn = expandTo18Decimals(4);

        await token0.transfer(pair01.address, tokenAmount)
        await token1.transfer(pair01.address, tokenAmount)
        await pair01.mint(dxdao.address, overrides)

        await token1.transfer(wethToken1Pair.address, tokenAmount)
        await WETH.transfer(wethToken1Pair.address, wethAmount)
        await wethToken1Pair.mint(dxdao.address, overrides)

        let amountOut = await getAmountOut(pair01, token0.address, amountIn);

        await token0.transfer(pair01.address, amountIn)
        await pair01.swap(0, amountOut, dxdao.address, '0x', overrides)

        amountOut = await getAmountOut(pair01, token1.address, amountIn);
        await token1.transfer(pair01.address, amountIn)
        await pair01.swap(amountOut, 0, dxdao.address, '0x', overrides)

        const protocolFeeToReceive = await calcProtocolFee(pair01, factory);

        await token0.transfer(pair01.address, expandTo18Decimals(10))
        await token1.transfer(pair01.address, expandTo18Decimals(10))
        await pair01.mint(dxdao.address, overrides)

        const protocolFeeLPToknesReceived = await pair01.balanceOf(feeSplitter.address);
        expect(protocolFeeLPToknesReceived.div(ROUND_EXCEPTION))
          .to.be.eq(protocolFeeToReceive.div(ROUND_EXCEPTION))

        const token0FromProtocolFee = protocolFeeLPToknesReceived
          .mul(await token0.balanceOf(pair01.address)).div(await pair01.totalSupply());
        const token1FromProtocolFee = protocolFeeLPToknesReceived
          .mul(await token1.balanceOf(pair01.address)).div(await pair01.totalSupply());

        const wethFromToken1FromProtocolFee = await getAmountOut(wethToken1Pair, token1.address, token1FromProtocolFee);
        const protocolfeeSplitterBalanceBeforeTake = await provider.getBalance(protocolfeeSplitter.address)

        // set external fee receiver
        await feeSplitter.setExternalFeeReceiver(pair01.address, externalfeeSplitter.address)
        await feeSplitter.setFeePercentageToExternalReceiver(pair01.address, 2000)
        const [externalReceiver, percentFeeToExternalReceiver] = await feeSplitter.externalFeeReceivers(pair01.address)
        expect(percentFeeToExternalReceiver).to.eq(2000)
        expect(externalReceiver).to.eq(externalfeeSplitter.address)

        expect(await token0.balanceOf(feeSplitter.address)).to.eq(0)
        expect(await token1.balanceOf(feeSplitter.address)).to.eq(0)
        expect(await WETH.balanceOf(feeSplitter.address)).to.eq(0)
        expect(await pair01.balanceOf(feeSplitter.address)).to.eq(0)
        expect(await provider.getBalance(feeSplitter.address)).to.eq(0)

        expect((await token0.balanceOf(fallbackReceiver.address)))
          .to.be.eq(token0FromProtocolFee)
        expect((await provider.getBalance(protocolfeeSplitter.address)))
          .to.be.eq(protocolfeeSplitterBalanceBeforeTake.add(wethFromToken1FromProtocolFee))
      })

    // Where weth pairs don't exist
    it(
      'should split and receive only tokens when extracting fee from tokenA-tokenB pair that has no path to WETH',
      async () => {
        const tokenAmount = expandTo18Decimals(100);
        const amountIn = expandTo18Decimals(50);

        // set external fee receiver
        await feeSplitter.setExternalFeeReceiver(pair23.address, externalfeeSplitter.address)
        await feeSplitter.setFeePercentageToExternalReceiver(pair23.address, 1000)

        const [externalReceiver, percentFeeToExternalReceiver] = await feeSplitter.externalFeeReceivers(pair23.address)
        expect(externalReceiver).to.eq(externalfeeSplitter.address)
        expect(percentFeeToExternalReceiver).to.eq(1000)

        await token2.transfer(pair23.address, tokenAmount)
        await token3.transfer(pair23.address, tokenAmount)
        await pair23.mint(dxdao.address, overrides)

        let amountOut = await getAmountOut(pair23, token2.address, amountIn);
        await token2.transfer(pair23.address, amountIn)
        await pair23.swap(
          (token2.address < token3.address) ? 0 : amountOut,
          (token2.address < token3.address) ? amountOut : 0,
          dxdao.address, '0x', overrides
        )

        amountOut = await getAmountOut(pair23, token3.address, amountIn);
        await token3.transfer(pair23.address, amountIn)
        await pair23.swap(
          (token2.address < token3.address) ? amountOut : 0,
          (token2.address < token3.address) ? 0 : amountOut,
          dxdao.address, '0x', overrides
        )

        const protocolFeeToReceive = await calcProtocolFee(pair23, factory);

        await token2.transfer(pair23.address, expandTo18Decimals(10))
        await token3.transfer(pair23.address, expandTo18Decimals(10))
        await pair23.mint(dxdao.address, overrides)

        const protocolFeeLP = await pair23.balanceOf(feeSplitter.address);
        expect(protocolFeeLP.div(ROUND_EXCEPTION))
          .to.be.eq(protocolFeeToReceive.div(ROUND_EXCEPTION))

        const tokenAFromProtocolFee = protocolFeeLP
          .mul(await token2.balanceOf(pair23.address)).div(await pair23.totalSupply());
        const tokenBFromProtocolFee = protocolFeeLP
          .mul(await token3.balanceOf(pair23.address)).div(await pair23.totalSupply());

        const protocolfeeSplitterBalance = await provider.getBalance(protocolfeeSplitter.address)
        const externalBalance = await provider.getBalance(externalfeeSplitter.address)

        await feeSplitter.connect(dxdao).takeProtocolFee([pair23.address], overrides)

        const tknAExternalReceiver = tokenAFromProtocolFee.mul(percentFeeToExternalReceiver).div(10000)
        const tknBExternalReceiver = tokenBFromProtocolFee.mul(percentFeeToExternalReceiver).div(10000)
        const tknAProtocolfeeSplitter = tokenAFromProtocolFee.sub(tknAExternalReceiver)
        const tknBProtocolfeeSplitter = tokenBFromProtocolFee.sub(tknBExternalReceiver)

        expect(await token2.balanceOf(feeSplitter.address)).to.eq(0)
        expect(await token3.balanceOf(feeSplitter.address)).to.eq(0)
        expect(await WETH.balanceOf(feeSplitter.address)).to.eq(0)
        expect(await pair23.balanceOf(feeSplitter.address)).to.eq(0)
        expect(await provider.getBalance(feeSplitter.address)).to.eq(0)

        expect(await provider.getBalance(protocolfeeSplitter.address))
          .to.be.eq(protocolfeeSplitterBalance)
        expect(await provider.getBalance(externalfeeSplitter.address))
          .to.be.eq(externalBalance)
        expect(await token2.balanceOf(fallbackReceiver.address))
          .to.be.eq(tknAProtocolfeeSplitter)
        expect(await token3.balanceOf(fallbackReceiver.address))
          .to.be.eq(tknBProtocolfeeSplitter)
        expect(await token2.balanceOf(externalfeeSplitter.address))
          .to.be.eq(tknAExternalReceiver)
        expect(await token3.balanceOf(externalfeeSplitter.address))
          .to.be.eq(tknBExternalReceiver)
      })

    // Where token0-token1, token0-WETH and token1-WETH pairs exist
    it(
      'should swap tokens, split and sent to ethReceiver when extracting fee from token0-token1',
      async () => {
        const tokenAmount = expandTo18Decimals(40);
        const wethAmount = expandTo18Decimals(40);
        const amountIn = expandTo18Decimals(4);

        // set external fee receiver
        await feeSplitter.setExternalFeeReceiver(pair01.address, externalfeeSplitter.address)
        await feeSplitter.setFeePercentageToExternalReceiver(pair01.address, 3000)

        const [externalReceiver, percentFeeToExternalReceiver] = await feeSplitter.externalFeeReceivers(pair01.address)
        expect(externalReceiver).to.eq(externalfeeSplitter.address)
        expect(percentFeeToExternalReceiver).to.eq(3000)

        await token0.transfer(pair01.address, tokenAmount)
        await token1.transfer(pair01.address, tokenAmount)
        await pair01.mint(dxdao.address, overrides)

        await token0.transfer(wethToken0Pair.address, tokenAmount)
        await WETH.transfer(wethToken0Pair.address, wethAmount)
        await wethToken0Pair.mint(dxdao.address, overrides)

        await token1.transfer(wethToken1Pair.address, tokenAmount)
        await WETH.transfer(wethToken1Pair.address, wethAmount)
        await wethToken1Pair.mint(dxdao.address, overrides)

        let amountOut = await getAmountOut(pair01, token0.address, amountIn);
        await token0.transfer(pair01.address, amountIn)
        await pair01.swap(0, amountOut, dxdao.address, '0x', overrides)

        amountOut = await getAmountOut(pair01, token1.address, amountIn);
        await token1.transfer(pair01.address, amountIn)
        await pair01.swap(amountOut, 0, dxdao.address, '0x', overrides)

        // estimate protocol fee received
        const protocolFeeToReceive = await calcProtocolFee(pair01, factory);

        await token0.transfer(pair01.address, expandTo18Decimals(10))
        await token1.transfer(pair01.address, expandTo18Decimals(10))
        await pair01.mint(dxdao.address, overrides)

        const protocolFeeLPToknesReceived = await pair01.balanceOf(feeSplitter.address);
        expect(protocolFeeLPToknesReceived.div(ROUND_EXCEPTION))
          .to.be.eq(protocolFeeToReceive.div(ROUND_EXCEPTION))

        // calculate tkn0 & tkn1 amount based on LP 
        const token0FromProtocolFee = protocolFeeLPToknesReceived
          .mul(await token0.balanceOf(pair01.address)).div(await pair01.totalSupply());
        const token1FromProtocolFee = protocolFeeLPToknesReceived
          .mul(await token1.balanceOf(pair01.address)).div(await pair01.totalSupply());

        const dxdaoBalanceBeforeTake = await provider.getBalance(dxdao.address)
        const protocolfeeSplitterBalanceBeforeTake = await provider.getBalance(protocolfeeSplitter.address)
        const externalfeeSplitterBalanceBeforeTake = await provider.getBalance(externalfeeSplitter.address)

        // estimate weth from tokens
        const wethFromToken0 = await getAmountOut(wethToken0Pair, token0.address, token0FromProtocolFee);
        const wethFromToken1 = await getAmountOut(wethToken1Pair, token0.address, token1FromProtocolFee);

        // set external fee receiver
        await feeSplitter.setFeePercentageToExternalReceiver(pair01.address, 2000)
        const [newExternalReceiver, newPercentFeeToExternalReceiver] = await feeSplitter.externalFeeReceivers(pair01.address)
        expect(newExternalReceiver).to.eq(externalfeeSplitter.address)
        expect(newPercentFeeToExternalReceiver).to.eq(2000)

        // split weth to avatar and external Receiver with OLD fee percentage
        const wethTkn0ToExternalReceiver = wethFromToken0.mul(percentFeeToExternalReceiver).div(10000)
        const wethTkn1ToExternalReceiver = wethFromToken1.mul(percentFeeToExternalReceiver).div(10000)
        const tkn0ToProtocolfeeSplitter = wethFromToken0.sub(wethTkn0ToExternalReceiver)
        const tkn1ToProtocolfeeSplitter = wethFromToken1.sub(wethTkn1ToExternalReceiver)

        // weth to external Receiver after token-weth swap
        const wethExternal = wethTkn0ToExternalReceiver.add(wethTkn1ToExternalReceiver)

        // weth to dao after token-weth swap
        const wethfeeSplitter = tkn0ToProtocolfeeSplitter.add(tkn1ToProtocolfeeSplitter)

        expect(await token0.balanceOf(feeSplitter.address)).to.eq(0)
        expect(await token1.balanceOf(feeSplitter.address)).to.eq(0)
        expect(await WETH.balanceOf(feeSplitter.address)).to.eq(0)
        expect(await pair01.balanceOf(feeSplitter.address)).to.eq(0)
        expect(await provider.getBalance(feeSplitter.address)).to.eq(0)

        // dont send token0 and token1 to fallbackreceiver and external fee receiver
        expect((await token0.balanceOf(fallbackReceiver.address)))
          .to.eq(0)
        expect((await token1.balanceOf(fallbackReceiver.address)))
          .to.eq(0)
        expect((await token0.balanceOf(externalfeeSplitter.address)))
          .to.eq(0)
        expect((await token1.balanceOf(externalfeeSplitter.address)))
          .to.eq(0)

        // should change eth balance for avatar and external Receiver
        expect((await provider.getBalance(protocolfeeSplitter.address)))
          .to.be.eq(protocolfeeSplitterBalanceBeforeTake.add(wethfeeSplitter))
        expect((await provider.getBalance(externalfeeSplitter.address)))
          .to.be.eq(externalfeeSplitterBalanceBeforeTake.add(wethExternal))

        // should not send eth to avatar (gas used for updating split %)
        expect((await provider.getBalance(dxdao.address)))
          .to.be.lte(dxdaoBalanceBeforeTake)
      })

    // Where token0-token1 and token1-WETH pairs exist
    it(
      'should emit TakeProtocolFee event',
      async () => {
        const tokenAmount = expandTo18Decimals(40);
        const wethAmount = expandTo18Decimals(40);
        const amountIn = expandTo18Decimals(4);

        await token0.transfer(pair01.address, tokenAmount)
        await token1.transfer(pair01.address, tokenAmount)
        await pair01.mint(dxdao.address, overrides)

        await token1.transfer(wethToken1Pair.address, tokenAmount)
        await WETH.transfer(wethToken1Pair.address, wethAmount)
        await wethToken1Pair.mint(dxdao.address, overrides)

        let amountOut = await getAmountOut(pair01, token0.address, amountIn);
        await token0.transfer(pair01.address, amountIn)
        await pair01.swap(0, amountOut, dxdao.address, '0x', overrides)

        amountOut = await getAmountOut(wethToken1Pair, token1.address, amountIn);
        await token1.transfer(wethToken1Pair.address, amountIn)
        await wethToken1Pair.swap(0, amountOut, dxdao.address, '0x', overrides)

        await token0.transfer(pair01.address, expandTo18Decimals(10))
        await token1.transfer(pair01.address, expandTo18Decimals(10))
        await pair01.mint(dxdao.address, overrides)

        await token1.transfer(wethToken1Pair.address, expandTo18Decimals(10))
        await WETH.transfer(wethToken1Pair.address, expandTo18Decimals(10))
        await wethToken1Pair.mint(dxdao.address, overrides)

        await expect(feeSplitter.connect(dxdao).takeProtocolFee([pair01.address, wethToken1Pair.address], overrides)
        ).to.emit(feeSplitter, 'TakeProtocolFee').withArgs(dxdao.address, protocolfeeSplitter.address, 2)
      })
  })
})
