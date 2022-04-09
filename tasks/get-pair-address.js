const { task } = require('hardhat/config')
const { getCreate2Address, solidityKeccak256, solidityPack } = require('ethers/lib/utils')
const { BigNumber } = require('ethers')

task('get-pair-address', 'Deploys the whole contracts suite and optionally verifies source code on Etherscan')
  .addParam('factoryAddress')
  .addParam('tokenA')
  .addParam('tokenB')
  .setAction(async (taskArguments, hre) => {
    const { factoryAddress, tokenA, tokenB } = taskArguments

    console.log('Using factory address:', factoryAddress)
    console.log()

    const factoryContract = new hre.web3.eth.Contract(
      require('../artifacts-zk/contracts/DXswapFactory.sol/DXswapFactory.json').abi,
      factoryAddress
    )

    const packedTokens = solidityPack(
      ['address', 'address'],
      BigNumber.from(tokenA).lt(BigNumber.from(tokenB)) ? [tokenA, tokenB] : [tokenB, tokenA]
    )
    const salt = solidityKeccak256(['bytes'], [packedTokens])
    console.log(
      `pair address: ${getCreate2Address(
        factoryAddress,
        salt,
        await factoryContract.methods.INIT_CODE_PAIR_HASH().call()
      )}`
    )
  })
