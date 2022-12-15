import '@nomiclabs/hardhat-ethers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { ethers, network } from "hardhat";
import { BigNumber, constants, Wallet } from 'ethers'
import { expandTo18Decimals, getApprovalDigest } from './shared/utilities'
import { pairFixture } from './shared/fixtures'
import { ERC20 } from './../typechain'
import { defaultAbiCoder, hexlify, keccak256, toUtf8Bytes } from 'ethers/lib/utils';
import { ecsign } from 'ethereumjs-util';

const { MaxUint256 } = constants

const overrides = {
  gasLimit: 29999999
}

const TEST_AMOUNT = expandTo18Decimals(10)
const TOTAL_SUPPLY = expandTo18Decimals(10000)

describe('DXswapERC20', () => {
  const provider = ethers.provider
  let dxdao: SignerWithAddress
  let tokenOwner: SignerWithAddress
  let ethReceiver: SignerWithAddress
  let fallbackReceiver: SignerWithAddress
  let other: SignerWithAddress
  let DXS: ERC20
  let privateKey: string
  let customWallet: Wallet
  let customSigner: SignerWithAddress

  beforeEach('assign wallets', async function () {
    const signers = await ethers.getSigners()
    dxdao = signers[0]
    tokenOwner = signers[1]
    ethReceiver = signers[2]
    fallbackReceiver = signers[3]
    other = signers[4]
  })

  beforeEach('deploy fixture', async () => {
    const fixture = await pairFixture(provider, [dxdao, ethReceiver, fallbackReceiver])
    DXS = fixture.token0
  })

  it('name, symbol, decimals, totalSupply, balanceOf, DOMAIN_SEPARATOR, PERMIT_TYPEHASH', async () => {
    const name = await DXS.name()
    expect(name).to.eq('DXswap')
    expect(await DXS.symbol()).to.eq('DXS')
    expect(await DXS.decimals()).to.eq(18)
    expect(await DXS.totalSupply()).to.eq(TOTAL_SUPPLY)
    expect(await DXS.balanceOf(dxdao.address)).to.eq(TOTAL_SUPPLY)
    expect(await DXS.DOMAIN_SEPARATOR()).to.eq(
      keccak256(
        defaultAbiCoder.encode(
          ['bytes32', 'bytes32', 'bytes32', 'uint256', 'address'],
          [
            keccak256(
              toUtf8Bytes('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)')
            ),
            keccak256(toUtf8Bytes(name)),
            keccak256(toUtf8Bytes('1')),
            1,
            DXS.address
          ]
        )
      )
    )
    expect(await DXS.PERMIT_TYPEHASH()).to.eq(
      keccak256(toUtf8Bytes('Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)'))
    )
  })

  it('approve', async () => {
    await expect(DXS.approve(other.address, TEST_AMOUNT))
      .to.emit(DXS, 'Approval')
      .withArgs(dxdao.address, other.address, TEST_AMOUNT)
    expect(await DXS.allowance(dxdao.address, other.address)).to.eq(TEST_AMOUNT)
  })

  it('transfer', async () => {
    await expect(DXS.transfer(other.address, TEST_AMOUNT, overrides))
      .to.emit(DXS, 'Transfer')
      .withArgs(dxdao.address, other.address, TEST_AMOUNT)
    expect(await DXS.balanceOf(dxdao.address)).to.eq(TOTAL_SUPPLY.sub(TEST_AMOUNT))
    expect(await DXS.balanceOf(other.address)).to.eq(TEST_AMOUNT)
  })

  it('transfer:fail', async () => {
    await expect(DXS.transfer(other.address, TOTAL_SUPPLY.add(1))).to.be.reverted // ds-math-sub-underflow
    await expect(DXS.connect(other).transfer(dxdao.address, 1)).to.be.reverted // ds-math-sub-underflow
  })

  it('transferFrom', async () => {
    await DXS.approve(other.address, TEST_AMOUNT, overrides)
    await expect(DXS.connect(other).transferFrom(dxdao.address, other.address, TEST_AMOUNT, overrides))
      .to.emit(DXS, 'Transfer')
      .withArgs(dxdao.address, other.address, TEST_AMOUNT)
    expect(await DXS.allowance(dxdao.address, other.address)).to.eq(0)
    expect(await DXS.balanceOf(dxdao.address)).to.eq(TOTAL_SUPPLY.sub(TEST_AMOUNT))
    expect(await DXS.balanceOf(other.address)).to.eq(TEST_AMOUNT)
  })

  it('transferFrom:max', async () => {
    await DXS.approve(other.address, MaxUint256, overrides)
    await expect(DXS.connect(other).transferFrom(dxdao.address, other.address, TEST_AMOUNT, overrides))
      .to.emit(DXS, 'Transfer')
      .withArgs(dxdao.address, other.address, TEST_AMOUNT)
    expect(await DXS.allowance(dxdao.address, other.address)).to.eq(MaxUint256)
    expect(await DXS.balanceOf(dxdao.address)).to.eq(TOTAL_SUPPLY.sub(TEST_AMOUNT))
    expect(await DXS.balanceOf(other.address)).to.eq(TEST_AMOUNT)
  })

  it('permit', async () => {
    // custom wallet needs to be create due to private key
    customWallet = ethers.Wallet.createRandom().connect(ethers.provider);
    privateKey = customWallet.privateKey

    // add wallet to hardhat accounts
    await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [customWallet.address]
    })

    customSigner = await ethers.getSigner(customWallet.address)
    await dxdao.sendTransaction({
      value: expandTo18Decimals(500),
      to: customSigner.address,
    });

    const nonce = await DXS.nonces(customSigner.address)
    const deadline = MaxUint256
    const digest = await getApprovalDigest(
      DXS,
      { owner: customSigner.address, spender: other.address, value: TEST_AMOUNT },
      nonce,
      deadline
    )

    const { v, r, s } = ecsign(Buffer.from(digest.slice(2), 'hex'), Buffer.from(privateKey.slice(2), 'hex'))

    await expect(DXS.permit(customSigner.address, other.address, TEST_AMOUNT, deadline, v, hexlify(r), hexlify(s)))
      .to.emit(DXS, 'Approval')
      .withArgs(customSigner.address, other.address, TEST_AMOUNT)
    expect(await DXS.allowance(customSigner.address, other.address)).to.eq(TEST_AMOUNT)
    expect(await DXS.nonces(customSigner.address)).to.eq(BigNumber.from(1))
  })
})
