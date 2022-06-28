import '@nomiclabs/hardhat-ethers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { ethers } from "hardhat";
import { constants } from 'ethers'
import { pairFixture } from './shared/fixtures'
import { DXswapFactory, DXswapFeeReceiver, DXswapFeeSetter, DXswapPair, ERC20, WETH9 } from './../typechain'

const { AddressZero } = constants

const overrides = {
  gasLimit: 9999999
}

describe('DXswapFeeSetter', () => {
  const provider = ethers.provider
  let dxdao: SignerWithAddress
  let tokenOwner: SignerWithAddress
  let fallbackReceiver: SignerWithAddress
  let protocolFeeReceiver: SignerWithAddress
  let other: SignerWithAddress
  let factory: DXswapFactory
  let feeSetter: DXswapFeeSetter
  let feeReceiver: DXswapFeeReceiver

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
    pair = fixture.dxswapPair01
  })

  it('feeToSetter', async () => {
    expect(await factory.feeTo()).to.eq(feeReceiver.address)
    expect(await factory.feeToSetter()).to.eq(feeSetter.address)
    expect(await feeSetter.owner()).to.eq(dxdao.address)
  })

  it('setFeeTo', async () => {
    // Should not allow to setFeeTo from other address that is not owner calling feeSetter
    await expect(feeSetter.connect(other).setFeeTo(other.address)).to.be.revertedWith('DXswapFeeSetter: FORBIDDEN')
    await feeSetter.connect(dxdao).setFeeTo(dxdao.address)

    // If feeToSetter changes it will will fail in DXswapFactory check when trying to setFeeTo from FeeSetter.
    await feeSetter.connect(dxdao).setFeeToSetter(other.address)
    await expect(feeSetter.connect(dxdao).setFeeTo(dxdao.address)).to.be.revertedWith('DXswapFactory: FORBIDDEN')
  })

  it('setProtocolFee', async () => {
    // Should not allow to setProtocolFee from other address taht is not owner calling feeSetter
    await expect(feeSetter.connect(other).setProtocolFee(5)).to.be.revertedWith('DXswapFeeSetter: FORBIDDEN')
    await feeSetter.connect(dxdao).setProtocolFee(5)
    expect(await factory.protocolFeeDenominator()).to.eq(5)

    // If feeToSetter changes it will will fail in DXswapFactory check when trying to setProtocolFee from FeeSetter.
    await feeSetter.connect(dxdao).setFeeToSetter(other.address)
    await expect(feeSetter.connect(dxdao).setProtocolFee(5)).to.be.revertedWith('DXswapFactory: FORBIDDEN')
  })

  it('setSwapFee', async () => {
    // Should not allow to setSwapFee from other address taht is not owner calling feeSetter
    await expect(feeSetter.connect(other).setSwapFee(pair.address, 5)).to.be.revertedWith('DXswapFeeSetter: FORBIDDEN')
    await feeSetter.connect(dxdao).setSwapFee(pair.address, 5)
    expect(await pair.swapFee()).to.eq(5)

    // If ownership of the pair is given to other address both addresses (FeeSetter owner and Pair owner) should be
    // able to change the swap fee
    await expect(feeSetter.connect(tokenOwner).setSwapFee(pair.address, 5)).to.be.revertedWith('DXswapFeeSetter: FORBIDDEN')
    await feeSetter.connect(dxdao).transferPairOwnership(pair.address, tokenOwner.address)
    await feeSetter.connect(tokenOwner).setSwapFee(pair.address, 3)
    expect(await pair.swapFee()).to.eq(3)
    await feeSetter.connect(dxdao).setSwapFee(pair.address, 7)
    expect(await pair.swapFee()).to.eq(7)

    // If ownership of the pair is removed by setting it to zero the pair owner should not be able to change the 
    // fee anymore.
    await feeSetter.connect(dxdao).transferPairOwnership(pair.address, AddressZero)
    await expect(feeSetter.connect(tokenOwner).setSwapFee(pair.address, 5)).to.be.revertedWith('DXswapFeeSetter: FORBIDDEN')

    // If feeToSetter changes it will will fail in DXswapFactory check when trying to setSwapFee from FeeSetter.
    await feeSetter.connect(dxdao).setFeeToSetter(other.address)
    await expect(feeSetter.connect(dxdao).setSwapFee(pair.address, 5)).to.be.revertedWith('DXswapFactory: FORBIDDEN')
  })

  it('setFeeToSetter', async () => {
    // Should not allow to setFeeToSetter from other address taht is not owner calling feeSetter
    await expect(feeSetter.connect(other).setFeeToSetter(other.address)).to.be.revertedWith('DXswapFeeSetter: FORBIDDEN')
    await feeSetter.connect(dxdao).setFeeToSetter(other.address)
    expect(await factory.feeToSetter()).to.eq(other.address)
    // If feeToSetter changes it will will fail in DXswapFactory check when trying to setFeeToSetter from FeeSetter.
    await expect(feeSetter.connect(dxdao).setFeeToSetter(dxdao.address)).to.be.revertedWith('DXswapFactory: FORBIDDEN')
  })
})
