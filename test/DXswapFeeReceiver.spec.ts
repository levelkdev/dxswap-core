import '@nomiclabs/hardhat-ethers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { ethers } from "hardhat";
import { BigNumber } from 'ethers'
import { pairFixture } from './shared/fixtures'
import { DXswapFactory, DXswapFeeReceiver, DXswapPair, ERC20, WETH9 } from './../typechain'
import { calcProtocolFee, expandTo18Decimals } from './shared/utilities';

const FEE_DENOMINATOR = BigNumber.from(10).pow(4)
const ROUND_EXCEPTION = BigNumber.from(10).pow(4)

const overrides = {
  gasLimit: 9999999
}

describe('DXswapFeeReceiver', () => {
  const provider = ethers.provider
  let dxdao: SignerWithAddress
  let tokenOwner: SignerWithAddress
  let protocolFeeReceiver: SignerWithAddress
  let fallbackReceiver: SignerWithAddress
  let other: SignerWithAddress
  let factory: DXswapFactory
  let feeReceiver: DXswapFeeReceiver

  let token0: ERC20
  let token1: ERC20
  let token2: ERC20
  let token3: ERC20
  let token4: ERC20
  let pair01: DXswapPair
  let pair23: DXswapPair
  let pair03: DXswapPair
  let pair24: DXswapPair
  let wethPair: DXswapPair
  let wethTkn0Pair: DXswapPair
  let WETH: WETH9

  beforeEach('assign signers', async function () {
    const signers = await ethers.getSigners()
    dxdao = signers[0]
    tokenOwner = signers[1]
    protocolFeeReceiver = signers[2]
    fallbackReceiver = signers[3]
    other = signers[4]
  })

  beforeEach('deploy fixture', async () => {
    const fixture = await pairFixture(provider, [dxdao, protocolFeeReceiver, fallbackReceiver])
    factory = fixture.dxswapFactory
    feeReceiver = fixture.feeReceiver
    token0 = fixture.token0
    token1 = fixture.token1
    token2 = fixture.token2
    token3 = fixture.token3
    token4 = fixture.token4
    pair01 = fixture.dxswapPair01
    pair23 = fixture.dxswapPair23
    pair03 = fixture.dxswapPair03
    pair24 = fixture.dxswapPair24
    wethPair = fixture.wethToken1Pair
    wethTkn0Pair = fixture.wethToken0Pair
    WETH = fixture.WETH
  })

  async function getAmountOut(pair: DXswapPair, tokenIn: string, amountIn: BigNumber) {
    const [reserve0, reserve1] = await pair.getReserves()
    const token0 = await pair.token0()
    const swapFee = BigNumber.from(await pair.swapFee())
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

  // Where token0-token1 and token1-WETH pairs exist
  it(
    'should receive token3 to fallbackreceiver and ETH to ethReceiver when extracting fee from token0-token3',
    async () => {
      const tokenAmount = expandTo18Decimals(100);
      const wethAmount = expandTo18Decimals(100);
      const amountIn = expandTo18Decimals(10);

      await token0.transfer(pair03.address, tokenAmount)
      await token3.transfer(pair03.address, tokenAmount)
      await pair03.mint(dxdao.address, overrides)

      await token0.transfer(wethTkn0Pair.address, tokenAmount)
      await WETH.transfer(wethTkn0Pair.address, wethAmount)
      await wethTkn0Pair.mint(dxdao.address, overrides)

      let amountOut = await getAmountOut(pair03, token0.address, amountIn);

      await token0.transfer(pair03.address, amountIn)
      await pair03.swap(0, amountOut, dxdao.address, '0x')

      amountOut = await getAmountOut(pair03, token3.address, amountIn);
      await token3.transfer(pair03.address, amountIn)
      await pair03.swap(amountOut, 0, dxdao.address, '0x')

      const protocolFeeToReceive = await calcProtocolFee(pair03, factory);

      await token0.transfer(pair03.address, expandTo18Decimals(10))
      await token3.transfer(pair03.address, expandTo18Decimals(10))
      await pair03.mint(dxdao.address, overrides)

      const protocolFeeLPToknesReceived = await pair03.balanceOf(feeReceiver.address);
      expect(protocolFeeLPToknesReceived.div(ROUND_EXCEPTION))
        .to.be.eq(protocolFeeToReceive.div(ROUND_EXCEPTION))

      const token3FromProtocolFee = protocolFeeLPToknesReceived
        .mul(await token3.balanceOf(pair03.address)).div(await pair03.totalSupply());
      const token0FromProtocolFee = protocolFeeLPToknesReceived
        .mul(await token0.balanceOf(pair03.address)).div(await pair03.totalSupply());

      const wethFromToken0FromProtocolFee = await getAmountOut(wethTkn0Pair, token0.address, token0FromProtocolFee);
      const protocolFeeReceiverBalanceBeforeTake = await provider.getBalance(protocolFeeReceiver.address)

      await feeReceiver.connect(dxdao).takeProtocolFee([pair03.address], overrides)

      expect(await token0.balanceOf(feeReceiver.address)).to.eq(0)
      expect(await token3.balanceOf(feeReceiver.address)).to.eq(0)
      expect(await WETH.balanceOf(feeReceiver.address)).to.eq(0)
      expect(await pair03.balanceOf(feeReceiver.address)).to.eq(0)
      expect(await provider.getBalance(feeReceiver.address)).to.eq(0)

      expect(await token3.balanceOf(fallbackReceiver.address))
        .to.be.eq(token3FromProtocolFee)
      expect(await provider.getBalance(protocolFeeReceiver.address))
        .to.be.eq(protocolFeeReceiverBalanceBeforeTake.add(wethFromToken0FromProtocolFee))
    })

  it('should receive everything in ETH from one WETH-token1 pair', async () => {
    const tokenAmount = expandTo18Decimals(40);
    const wethAmount = expandTo18Decimals(40);
    const amountIn = expandTo18Decimals(20);

    await token1.transfer(wethPair.address, tokenAmount, overrides)
    await WETH.transfer(wethPair.address, wethAmount, overrides)
    await wethPair.mint(dxdao.address, overrides)

    const token1IsFirstToken = (token1.address < WETH.address)

    let amountOut = await getAmountOut(wethPair, token1.address, amountIn);
    await token1.transfer(wethPair.address, amountIn, overrides)
    await wethPair.swap(
      token1IsFirstToken ? 0 : amountOut,
      token1IsFirstToken ? amountOut : 0,
      dxdao.address, '0x', overrides
    )

    amountOut = await getAmountOut(wethPair, WETH.address, amountIn);
    await WETH.transfer(wethPair.address, amountIn, overrides)
    await wethPair.swap(
      token1IsFirstToken ? amountOut : 0,
      token1IsFirstToken ? 0 : amountOut,
      dxdao.address, '0x', overrides
    )

    const protocolFeeToReceive = await calcProtocolFee(wethPair, factory);

    await token1.transfer(wethPair.address, expandTo18Decimals(10), overrides)
    await WETH.transfer(wethPair.address, expandTo18Decimals(10), overrides)
    await wethPair.mint(dxdao.address, overrides)

    const protocolFeeLPToknesReceived = await wethPair.balanceOf(feeReceiver.address);
    expect(protocolFeeLPToknesReceived.div(ROUND_EXCEPTION))
      .to.be.eq(protocolFeeToReceive.div(ROUND_EXCEPTION))

    const token1FromProtocolFee = protocolFeeLPToknesReceived
      .mul(await token1.balanceOf(wethPair.address)).div(await wethPair.totalSupply());
    const wethFromProtocolFee = protocolFeeLPToknesReceived
      .mul(await WETH.balanceOf(wethPair.address)).div(await wethPair.totalSupply());


    const swapFee = BigNumber.from(await wethPair.swapFee())
    const token1ReserveBeforeSwap = (await token1.balanceOf(wethPair.address)).sub(token1FromProtocolFee)
    const wethReserveBeforeSwap = (await WETH.balanceOf(wethPair.address)).sub(wethFromProtocolFee)
    const wethFromToken1FromProtocolFee = await getAmountOutSync(
      token1IsFirstToken ? token1ReserveBeforeSwap : wethReserveBeforeSwap,
      token1IsFirstToken ? wethReserveBeforeSwap : token1ReserveBeforeSwap,
      token1IsFirstToken,
      token1FromProtocolFee,
      swapFee
    );

    const protocolFeeReceiverBalanceBeforeTake = await provider.getBalance(protocolFeeReceiver.address)

    await feeReceiver.connect(dxdao).takeProtocolFee([wethPair.address], overrides)

    expect(await token1.balanceOf(feeReceiver.address)).to.eq(0)
    expect(await WETH.balanceOf(feeReceiver.address)).to.eq(0)
    expect(await wethPair.balanceOf(feeReceiver.address)).to.eq(0)
    expect(await provider.getBalance(feeReceiver.address)).to.eq(0)

    expect((await provider.getBalance(protocolFeeReceiver.address)))
      .to.be.eq(protocolFeeReceiverBalanceBeforeTake.add(wethFromToken1FromProtocolFee).add(wethFromProtocolFee))
  })

  it(
    'should receive only tokens when extracting fee from token2-token3 pair that has no path to WETH',
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

      const protocolFeeLPpair23 = await pair23.balanceOf(feeReceiver.address);
      expect(protocolFeeLPpair23.div(ROUND_EXCEPTION))
        .to.be.eq(protocolFeeToReceive.div(ROUND_EXCEPTION))

      const token2FromProtocolFee = protocolFeeLPpair23
        .mul(await token2.balanceOf(pair23.address)).div(await pair23.totalSupply());
      const token3FromProtocolFee = protocolFeeLPpair23
        .mul(await token3.balanceOf(pair23.address)).div(await pair23.totalSupply());

      const protocolFeeReceiverBalance = await provider.getBalance(protocolFeeReceiver.address)

      await feeReceiver.connect(dxdao).takeProtocolFee([pair23.address], overrides)

      expect(await token2.balanceOf(feeReceiver.address)).to.eq(0)
      expect(await token3.balanceOf(feeReceiver.address)).to.eq(0)
      expect(await WETH.balanceOf(feeReceiver.address)).to.eq(0)
      expect(await pair23.balanceOf(feeReceiver.address)).to.eq(0)
      expect(await provider.getBalance(feeReceiver.address)).to.eq(0)

      expect((await token2.balanceOf(fallbackReceiver.address)))
        .to.be.eq((token2FromProtocolFee))
      expect((await token3.balanceOf(fallbackReceiver.address)))
        .to.be.eq((token3FromProtocolFee))
      expect((await provider.getBalance(protocolFeeReceiver.address)))
        .to.be.eq(protocolFeeReceiverBalance)
    })

  it(
    'should receive only tokens when extracting fee from both token2-tonken3 pair and token2-token4 pair',
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

      const protocolFeeLPpair23 = await pair23.balanceOf(feeReceiver.address);
      expect(protocolFeeLPpair23.div(ROUND_EXCEPTION))
        .to.be.eq(protocolFeeToReceive.div(ROUND_EXCEPTION))

      await token2.transfer(pair24.address, tokenAmount)
      await token4.transfer(pair24.address, tokenAmount)
      await pair24.mint(dxdao.address, overrides)

      amountOut = await getAmountOut(pair24, token2.address, amountIn);
      await token2.transfer(pair24.address, amountIn)
      await pair24.swap(
        (token2.address < token4.address) ? 0 : amountOut,
        (token2.address < token4.address) ? amountOut : 0,
        dxdao.address, '0x', overrides
      )

      amountOut = await getAmountOut(pair24, token4.address, amountIn);
      await token4.transfer(pair24.address, amountIn)
      await pair24.swap(
        (token2.address < token4.address) ? amountOut : 0,
        (token2.address < token4.address) ? 0 : amountOut,
        dxdao.address, '0x', overrides
      )

      protocolFeeToReceive = await calcProtocolFee(pair24, factory);

      await token2.transfer(pair24.address, expandTo18Decimals(10))
      await token4.transfer(pair24.address, expandTo18Decimals(10))
      await pair24.mint(dxdao.address, overrides)

      const protocolFeeLPPair24 = await pair24.balanceOf(feeReceiver.address);
      expect(protocolFeeLPPair24.div(ROUND_EXCEPTION))
        .to.be.eq(protocolFeeToReceive.div(ROUND_EXCEPTION))

      const token2FromPair23 = protocolFeeLPpair23
        .mul(await token2.balanceOf(pair23.address)).div(await pair23.totalSupply());
      const token3FromPair23 = protocolFeeLPpair23
        .mul(await token3.balanceOf(pair23.address)).div(await pair23.totalSupply());
      const token2FromPair24 = protocolFeeLPPair24
        .mul(await token2.balanceOf(pair24.address)).div(await pair24.totalSupply());
      const token4FromPair24 = protocolFeeLPPair24
        .mul(await token4.balanceOf(pair24.address)).div(await pair24.totalSupply());

      const protocolFeeReceiverBalance = await provider.getBalance(protocolFeeReceiver.address)

      await feeReceiver.connect(dxdao).takeProtocolFee([pair23.address, pair24.address], overrides)

      expect(await provider.getBalance(protocolFeeReceiver.address)).to.eq(protocolFeeReceiverBalance.toString())

      expect(await token2.balanceOf(feeReceiver.address)).to.eq(0)
      expect(await token3.balanceOf(feeReceiver.address)).to.eq(0)
      expect(await token4.balanceOf(feeReceiver.address)).to.eq(0)
      expect(await WETH.balanceOf(feeReceiver.address)).to.eq(0)
      expect(await provider.getBalance(feeReceiver.address)).to.eq(0)

      expect((await provider.getBalance(protocolFeeReceiver.address)))
        .to.be.eq(protocolFeeReceiverBalance)
      expect((await token3.balanceOf(fallbackReceiver.address)))
        .to.be.eq(token3FromPair23)
      expect((await token4.balanceOf(fallbackReceiver.address)))
        .to.be.eq(token4FromPair24)
      expect((await token2.balanceOf(fallbackReceiver.address)))
        .to.be.eq(token2FromPair23.add(token2FromPair24))
    })

  it(
    'should only allow owner to transfer ownership',
    async () => {
      await expect(feeReceiver.connect(other).transferOwnership(other.address, overrides))
        .to.be.revertedWith('DXswapFeeReceiver: FORBIDDEN')
      await feeReceiver.connect(dxdao).transferOwnership(tokenOwner.address, overrides);
      expect(await feeReceiver.owner()).to.be.eq(tokenOwner.address)
    })

  it(
    'should only allow owner to change receivers',
    async () => {
      await expect(feeReceiver.connect(other).changeReceivers(other.address, other.address, overrides))
        .to.be.revertedWith('DXswapFeeReceiver: FORBIDDEN')
      await feeReceiver.connect(dxdao).changeReceivers(other.address, other.address, overrides);
      expect(await feeReceiver.ethReceiver()).to.be.eq(other.address)
      expect(await feeReceiver.fallbackReceiver()).to.be.eq(other.address)
    })

  it(
    'should revert with insufficient liquidity error if there is not any liquidity in the WETH pair',
    async () => {
      const tokenAmount = expandTo18Decimals(100);
      const amountIn = expandTo18Decimals(50);

      await token0.transfer(pair01.address, tokenAmount)
      await token1.transfer(pair01.address, tokenAmount)
      await pair01.mint(dxdao.address, overrides)

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

      const protocolFeeLPToknesReceived = await pair01.balanceOf(feeReceiver.address);
      expect(protocolFeeLPToknesReceived.div(ROUND_EXCEPTION))
        .to.be.eq(protocolFeeToReceive.div(ROUND_EXCEPTION))

      const protocolFeeReceiverBalance = await provider.getBalance(protocolFeeReceiver.address)

      await expect(feeReceiver.connect(dxdao).takeProtocolFee([pair01.address], overrides)).to.be.revertedWith('DXswapFeeReceiver: INSUFFICIENT_LIQUIDITY')

      expect(await pair01.balanceOf(feeReceiver.address)).to.eq(protocolFeeLPToknesReceived)
      expect(await token0.balanceOf(feeReceiver.address)).to.eq(0)
      expect(await token1.balanceOf(feeReceiver.address)).to.eq(0)
      expect(await WETH.balanceOf(feeReceiver.address)).to.eq(0)
      expect(await provider.getBalance(feeReceiver.address)).to.eq(0)

      expect((await provider.getBalance(protocolFeeReceiver.address)))
        .to.be.eq(protocolFeeReceiverBalance)
      expect((await token0.balanceOf(fallbackReceiver.address)))
        .to.be.eq(0)
      expect((await token1.balanceOf(fallbackReceiver.address)))
        .to.be.eq(0)
    })
})
