import '@nomiclabs/hardhat-ethers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { ethers } from "hardhat";
import { BigNumber, constants } from 'ethers'
import { factoryFixture } from './shared/fixtures'
import { DXswapFactory, DXswapFeeSetter, DXswapPair__factory } from './../typechain'
import { bytecode as dxSwapPairBytecode } from '../build/artifacts/contracts/DXswapPair.sol/DXswapPair.json'
import { getCreate2Address } from './shared/utilities';


const { AddressZero } = constants

const TEST_ADDRESSES: [string, string] = [
  '0x1000000000000000000000000000000000000000',
  '0x2000000000000000000000000000000000000000'
]

const overrides = {
  gasLimit: 9999999
}

describe('DXswapFactory', () => {
  const provider = ethers.provider
  let dxdao: SignerWithAddress
  let tokenOwner: SignerWithAddress
  let ethReceiver: SignerWithAddress
  let fallbackReceiver: SignerWithAddress
  let other: SignerWithAddress
  let randomTestFeeSetter: SignerWithAddress
  let factory: DXswapFactory
  let feeSetter: DXswapFeeSetter

  beforeEach('assign wallets', async function () {
    const signers = await ethers.getSigners()
    dxdao = signers[0]
    tokenOwner = signers[1]
    ethReceiver = signers[2]
    fallbackReceiver = signers[3]
    other = signers[4]
    randomTestFeeSetter = signers[5]
  })

  beforeEach('deploy fixture', async () => {
    const fixture = await factoryFixture(provider, [dxdao, ethReceiver, fallbackReceiver])
    factory = fixture.dxswapFactory
    feeSetter = fixture.feeSetter

    // Set feeToSetter to dxdao.address to test the factory methdos from an ETH account
    await feeSetter.setFeeTo(AddressZero, overrides);
    await feeSetter.setFeeToSetter(randomTestFeeSetter.address);
  })

  it('feeTo, feeToSetter, allPairsLength, INIT_CODE_PAIR_HASH', async () => {
    expect(await factory.feeTo()).to.eq(AddressZero)
    expect(await factory.feeToSetter()).to.eq(randomTestFeeSetter.address)
    expect(await factory.allPairsLength()).to.eq(0)
    expect(await factory.INIT_CODE_PAIR_HASH()).to.eq('0x9e43bdf627764c4a3e3e452d1b558fff8466adc4dc8a900396801d26f4c542f2')
  })

  async function createPair(tokens: [string, string]) {
    const bytecode = dxSwapPairBytecode
    const create2Address = getCreate2Address(factory.address, tokens, bytecode)
    await expect(factory.createPair(...tokens, overrides))
      .to.emit(factory, 'PairCreated')
      .withArgs(TEST_ADDRESSES[0], TEST_ADDRESSES[1], create2Address, BigNumber.from(1))

    const [tokenA, tokenB] = tokens.slice().reverse()
    await expect(factory.createPair(...tokens)).to.be.reverted // DXswap: PAIR_EXISTS
    await expect(factory.createPair(tokenA, tokenB)).to.be.reverted // DXswap: PAIR_EXISTS
    expect(await factory.getPair(...tokens)).to.eq(create2Address)
    expect(await factory.getPair(tokenA, tokenB)).to.eq(create2Address)
    expect(await factory.allPairs(0)).to.eq(create2Address)
    expect(await factory.allPairsLength()).to.eq(1)

    const pair = (await new DXswapPair__factory(dxdao).deploy()).attach(create2Address)
    expect(await pair.factory()).to.eq(factory.address)
    expect(await pair.token0()).to.eq(TEST_ADDRESSES[0])
    expect(await pair.token1()).to.eq(TEST_ADDRESSES[1])
  }

  it('createPair', async () => {
    await createPair(TEST_ADDRESSES)
  })

  it('createPair:reverse', async () => {
    await createPair(TEST_ADDRESSES.slice().reverse() as [string, string])
  })

  it('createPair:gas', async () => {
    const tx = await factory.createPair(...TEST_ADDRESSES, overrides)
    const receipt = await tx.wait()
    expect(receipt.gasUsed).to.eq(2147442)
  })

  it('setFeeTo', async () => {
    await expect(factory.connect(other).setFeeTo(other.address, overrides)).to.be.revertedWith('DXswapFactory: FORBIDDEN')
    await factory.connect(randomTestFeeSetter).setFeeTo(dxdao.address, overrides)
    expect(await factory.feeTo()).to.eq(dxdao.address)
  })

  it('setFeeToSetter', async () => {
    await expect(factory.connect(other).setFeeToSetter(other.address, overrides)).to.be.revertedWith('DXswapFactory: FORBIDDEN')
    await factory.connect(randomTestFeeSetter).setFeeToSetter(other.address, overrides)
    expect(await factory.feeToSetter()).to.eq(other.address)
    await expect(factory.setFeeToSetter(dxdao.address)).to.be.revertedWith('DXswapFactory: FORBIDDEN')
  })
})
