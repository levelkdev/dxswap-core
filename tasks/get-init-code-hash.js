const { task } = require('hardhat/config')

task('get-init-code-hash', 'Deploys the whole contracts suite and optionally verifies source code on Etherscan')
  .addParam('factoryAddress')
  .setAction(async (taskArguments, hre) => {
    const { factoryAddress } = taskArguments

    const factoryContract = new hre.web3.eth.Contract(
      require('../artifacts-zk/contracts/DXswapFactory.sol/DXswapFactory.json').abi,
      factoryAddress
    )

    console.log(`init hash code ${await factoryContract.methods.INIT_CODE_PAIR_HASH().call()}`)
  })
