import { expect } from 'chai'
import { ethers } from "hardhat";
import { BigNumber } from 'ethers'
import { pairFixture } from './shared/fixtures'
import { DXswapFactory, DXswapFeeReceiver, DXswapFeeSetter, DXswapPair, ERC20 } from './../typechain'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import '@nomiclabs/hardhat-ethers'
import { calcProtocolFee, expandTo18Decimals, sqrt } from './shared/utilities';

const SWAP_DEN = BigNumber.from(10000);

// Using a Round error exception of 0.00000000000001 in ETH Unit, this equals 10000 in WEI unit, same value used as denominator for swap fee calculation 
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
  let feeSetter: DXswapFeeSetter
  let feeReceiver: DXswapFeeReceiver

  let token0: ERC20
  let token1: ERC20
  let pair: DXswapPair

  beforeEach('assign dxdaos', async function () {
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
    feeSetter = fixture.feeSetter
    feeReceiver = fixture.feeReceiver
    token0 = fixture.token0
    token1 = fixture.token1
    pair = fixture.dxswapPair01
  })

  // Adds liquidity to the token pair
  async function addLiquidity(token0Amount: BigNumber, token1Amount: BigNumber) {
    await token0.transfer(pair.address, token0Amount)
    await token1.transfer(pair.address, token1Amount)
    await pair.mint(dxdao.address, overrides)
  }

  // Calculate the total supply based on actual reserves
  async function calcTotalSupply() {
    const [token0Reserve, token1Reserve, _] = await pair.getReserves()
    return BigNumber.from(sqrt((token0Reserve.mul(token1Reserve))))
  }


  // Calculate the output of tokens for an specific input
  async function calcOutput(token0In: BigNumber, token1In: BigNumber) {
    const reserves = await pair.getReserves()
    const token0Reserve = reserves[0]
    const token1Reserve = reserves[1]
    const swapFee = await pair.swapFee()
    const kReserve = token0Reserve.mul(token1Reserve)

    const token0Out = token0Reserve.sub(
      kReserve.div(token1Reserve.add(token1In.mul(SWAP_DEN.sub(swapFee)).div(SWAP_DEN)))
    ).sub(BigNumber.from(1))
    const token1Out = token1Reserve.sub(
      kReserve.div(token0Reserve.add(token0In.mul(SWAP_DEN.sub(swapFee)).div(SWAP_DEN)))
    ).sub(BigNumber.from(1))

    return [token0Out < BigNumber.from(0) ? BigNumber.from(0) : token0Out, token1Out < BigNumber.from(0) ? BigNumber.from(0) : token1Out];
  }

  // Execute a transfer and swap, since the tokens has to be transfered before traded
  async function execTransferAndSwap(_token0In: BigNumber, _token1In: BigNumber) {
    const reserveBefore = await pair.getReserves()
    // check if tokens are sorted
    const tkn0address = await pair.token0()
    const tkn0 = token0.address === tkn0address ? token0 : token1
    const tkn1 = token0.address === tkn0address ? token1 : token0

    if (_token0In.gt(0))
      await tkn0.transfer(pair.address, _token0In)
    if (_token1In.gt(0))
      await tkn1.transfer(pair.address, _token1In)
    const outputs = await calcOutput(_token0In, _token1In);
    await pair.swap(outputs[0], outputs[1], dxdao.address, '0x', overrides)

    // Check value swaped between dxdao and pair
    expect(await tkn0.balanceOf(pair.address)).to.eq(reserveBefore[0].add(_token0In).sub(outputs[0]))
    expect(await tkn1.balanceOf(pair.address)).to.eq(reserveBefore[1].add(_token1In).sub(outputs[1]))
    const totalSupplyToken0 = await tkn0.totalSupply()
    const totalSupplyToken1 = await tkn1.totalSupply()
    expect(await tkn0.balanceOf(dxdao.address))
      .to.eq(totalSupplyToken0.sub(reserveBefore[0]).sub(_token0In).add(outputs[0]))
    expect(await tkn1.balanceOf(dxdao.address))
      .to.eq(totalSupplyToken1.sub(reserveBefore[1]).sub(_token1In).add(outputs[1]))

    return outputs;
  }

  it('feeTo:on, swapFee:default, protocolFeeDenominator:default', async () => {
    await feeSetter.setFeeTo(other.address)
    expect(await factory.protocolFeeDenominator()).to.eq(9)

    await addLiquidity(expandTo18Decimals(5), expandTo18Decimals(10))

    await execTransferAndSwap(expandTo18Decimals(1), BigNumber.from(0));
    await execTransferAndSwap(BigNumber.from(0), expandTo18Decimals(1));

    const toMintForProtocol = await calcProtocolFee(pair, factory);

    await addLiquidity(expandTo18Decimals(5), expandTo18Decimals(10))
    expect((await pair.balanceOf(other.address)).div(ROUND_EXCEPTION)).to.eq(toMintForProtocol.div(ROUND_EXCEPTION))
  })

  it('feeTo:on, swapFee:default, protocolFeeDenominator:0.025%', async () => {
    await feeSetter.setFeeTo(other.address)
    await feeSetter.setProtocolFee(11)
    expect(await factory.protocolFeeDenominator()).to.eq(11)

    await addLiquidity(expandTo18Decimals(5), expandTo18Decimals(10))

    await execTransferAndSwap(expandTo18Decimals(1), BigNumber.from(0));
    await execTransferAndSwap(BigNumber.from(0), expandTo18Decimals(1));
    await execTransferAndSwap(expandTo18Decimals(2), BigNumber.from(0));
    await execTransferAndSwap(BigNumber.from(0), expandTo18Decimals(2));
    await execTransferAndSwap(expandTo18Decimals(4), BigNumber.from(0));
    await execTransferAndSwap(BigNumber.from(0), expandTo18Decimals(4));
    await execTransferAndSwap(expandTo18Decimals(6), BigNumber.from(0));
    await execTransferAndSwap(BigNumber.from(0), expandTo18Decimals(6));

    const toMintForProtocol = await calcProtocolFee(pair, factory);

    await addLiquidity(expandTo18Decimals(5), expandTo18Decimals(10))
    expect((await pair.balanceOf(other.address)).div(ROUND_EXCEPTION)).to.eq(toMintForProtocol.div(ROUND_EXCEPTION))

  })

  it('feeTo:on, swapFee:0.2%, protocolFeeDenominator:0.1%', async () => {
    await feeSetter.setFeeTo(other.address)
    await feeSetter.setProtocolFee(1)
    await feeSetter.setSwapFee(pair.address, 20)
    expect(await factory.protocolFeeDenominator()).to.eq(1)
    expect(await pair.swapFee()).to.eq(20)

    await addLiquidity(expandTo18Decimals(5), expandTo18Decimals(10))

    await execTransferAndSwap(expandTo18Decimals(1), BigNumber.from(0));
    await execTransferAndSwap(BigNumber.from(0), expandTo18Decimals(1));
    await execTransferAndSwap(expandTo18Decimals(2), BigNumber.from(0));
    await execTransferAndSwap(BigNumber.from(0), expandTo18Decimals(2));

    const toMintForProtocol = await calcProtocolFee(pair, factory);

    await addLiquidity(expandTo18Decimals(5), expandTo18Decimals(10))
    expect((await pair.balanceOf(other.address)).div(ROUND_EXCEPTION)).to.eq(toMintForProtocol.div(ROUND_EXCEPTION))
  })

  it('feeTo:on, swapFee:0.2%, protocolFeeDenominator:disabled', async () => {
    await feeSetter.setSwapFee(pair.address, 20)
    expect(await factory.protocolFeeDenominator()).to.eq(9)
    expect(await pair.swapFee()).to.eq(20)

    await addLiquidity(expandTo18Decimals(5), expandTo18Decimals(10))

    await execTransferAndSwap(expandTo18Decimals(1), BigNumber.from(0));
    await execTransferAndSwap(BigNumber.from(0), expandTo18Decimals(1));
    await execTransferAndSwap(expandTo18Decimals(2), BigNumber.from(0));
    await execTransferAndSwap(BigNumber.from(0), expandTo18Decimals(2));

    const toMintForProtocol = await calcProtocolFee(pair, factory);

    await addLiquidity(expandTo18Decimals(5), expandTo18Decimals(10))
    expect((await pair.balanceOf(other.address)).div(ROUND_EXCEPTION)).to.eq(0)
  })

  it('MULTIPLE_TRADES:feeTo:on, swapFee:default, protocolFeeDenominator:default', async () => {
    await feeSetter.setFeeTo(other.address)

    await addLiquidity(expandTo18Decimals(800), expandTo18Decimals(10))

    await execTransferAndSwap(expandTo18Decimals(100), BigNumber.from(0));
    await execTransferAndSwap(BigNumber.from(0), expandTo18Decimals(50));
    await execTransferAndSwap(expandTo18Decimals(20), BigNumber.from(0));
    await execTransferAndSwap(BigNumber.from(0), expandTo18Decimals(200));
    await execTransferAndSwap(expandTo18Decimals(40), BigNumber.from(0));
    await execTransferAndSwap(BigNumber.from(0), expandTo18Decimals(66));
    await execTransferAndSwap(expandTo18Decimals(1), BigNumber.from(0));
    await execTransferAndSwap(BigNumber.from(0), expandTo18Decimals(5));

    const toMintForProtocol = await calcProtocolFee(pair, factory);

    await addLiquidity(expandTo18Decimals(5), expandTo18Decimals(10))
    expect((await pair.balanceOf(other.address)).div(ROUND_EXCEPTION)).to.eq(toMintForProtocol.div(ROUND_EXCEPTION))
  })

  it('MULTIPLE_TRADES:feeTo:on, swapFee:0.01, protocolFeeDenominator:0.0005', async () => {
    await feeSetter.setFeeTo(other.address)
    await feeSetter.setSwapFee(pair.address, 1)
    await feeSetter.setProtocolFee(19)
    expect(await factory.protocolFeeDenominator()).to.eq(19)
    expect(await pair.swapFee()).to.eq(1)

    await addLiquidity(expandTo18Decimals(800), expandTo18Decimals(10))

    await execTransferAndSwap(expandTo18Decimals(100), BigNumber.from(0));
    await execTransferAndSwap(BigNumber.from(0), expandTo18Decimals(50));
    await execTransferAndSwap(expandTo18Decimals(20), BigNumber.from(0));
    await execTransferAndSwap(BigNumber.from(0), expandTo18Decimals(200));
    await execTransferAndSwap(expandTo18Decimals(40), BigNumber.from(0));
    await execTransferAndSwap(BigNumber.from(0), expandTo18Decimals(66));
    await execTransferAndSwap(expandTo18Decimals(1), BigNumber.from(0));
    await execTransferAndSwap(BigNumber.from(0), expandTo18Decimals(5));

    const toMintForProtocol = await calcProtocolFee(pair, factory);

    await addLiquidity(expandTo18Decimals(5), expandTo18Decimals(10))
    expect((await pair.balanceOf(other.address)).div(ROUND_EXCEPTION)).to.eq(toMintForProtocol.div(ROUND_EXCEPTION))
  })

  it('MULTIPLE_TRADES:feeTo:on, swapFee:0, protocolFeeDenominator:default', async () => {
    await feeSetter.setFeeTo(other.address)
    await feeSetter.setSwapFee(pair.address, 0)
    expect(await pair.swapFee()).to.eq(0)

    await addLiquidity(expandTo18Decimals(800), expandTo18Decimals(10))

    await execTransferAndSwap(expandTo18Decimals(100), BigNumber.from(0));
    await execTransferAndSwap(BigNumber.from(0), expandTo18Decimals(50));
    await execTransferAndSwap(expandTo18Decimals(20), BigNumber.from(0));
    await execTransferAndSwap(BigNumber.from(0), expandTo18Decimals(200));
    await execTransferAndSwap(expandTo18Decimals(40), BigNumber.from(0));
    await execTransferAndSwap(BigNumber.from(0), expandTo18Decimals(66));
    await execTransferAndSwap(expandTo18Decimals(1), BigNumber.from(0));
    await execTransferAndSwap(BigNumber.from(0), expandTo18Decimals(5));

    const toMintForProtocol = await calcProtocolFee(pair, factory);

    await addLiquidity(expandTo18Decimals(5), expandTo18Decimals(10))
    expect((await pair.balanceOf(other.address)).div(ROUND_EXCEPTION)).to.eq(toMintForProtocol.div(ROUND_EXCEPTION))
  })

  it('MULTIPLE_TRADES:feeTo:on, swapFee:0, protocolFeeDenominator:0', async () => {
    await feeSetter.setSwapFee(pair.address, 0)
    expect(await pair.swapFee()).to.eq(0)

    await addLiquidity(expandTo18Decimals(800), expandTo18Decimals(10))

    await execTransferAndSwap(expandTo18Decimals(100), BigNumber.from(0));
    await execTransferAndSwap(BigNumber.from(0), expandTo18Decimals(50));
    await execTransferAndSwap(expandTo18Decimals(20), BigNumber.from(0));
    await execTransferAndSwap(BigNumber.from(0), expandTo18Decimals(200));
    await execTransferAndSwap(expandTo18Decimals(40), BigNumber.from(0));
    await execTransferAndSwap(BigNumber.from(0), expandTo18Decimals(66));
    await execTransferAndSwap(expandTo18Decimals(1), BigNumber.from(0));
    await execTransferAndSwap(BigNumber.from(0), expandTo18Decimals(5));

    const toMintForProtocol = await calcProtocolFee(pair, factory);

    await addLiquidity(expandTo18Decimals(5), expandTo18Decimals(10))
    expect((await pair.balanceOf(other.address)).div(ROUND_EXCEPTION)).to.eq(toMintForProtocol.div(ROUND_EXCEPTION))
  })

})
