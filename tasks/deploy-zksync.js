const { task } = require('hardhat/config')
const { Deployer } = require('@matterlabs/hardhat-zksync-deploy')
const { Wallet } = require('zksync-web3')

task('deploy', 'Deploys the whole contracts suite and optionally verifies source code on Etherscan')
  .addParam('ownerAddress', 'An address that will become the owner of the contracts after deployment.')
  .addParam('nativeAssetWrapperAddress', 'The address of the contract that wraps the native asset in the target chain')
  .setAction(async (taskArguments, hre) => {
    const { nativeAssetWrapperAddress, ownerAddress } = taskArguments

    const wallet = new Wallet(process.env.PRIVATE_KEY)
    const deployer = new Deployer(hre, wallet)

    const accountAddress = wallet.address

    console.log('Using native asset wrapper:', nativeAssetWrapperAddress)
    console.log('Using account:', accountAddress)
    console.log("Deployer's balance:", hre.web3.utils.fromWei(await hre.web3.eth.getBalance(accountAddress)))
    console.log()

    console.log('Deploying factory')
    const factoryContract = await deployer.deploy(
      await deployer.loadArtifact('DXswapFactory'),
      [accountAddress] // initially set the fee to setter to the deployer
    )

    console.log('Deploying fee receiver')
    const feeReceiverContract = await deployer.deploy(
      await deployer.loadArtifact('DXswapFeeReceiver'),
      [ownerAddress, factoryContract.address, nativeAssetWrapperAddress, ownerAddress, ownerAddress] // initially set the fee to setter to the deployer
    )

    console.log('Deploying fee setter')
    const feeSetterContract = await deployer.deploy(
      await deployer.loadArtifact('DXswapFeeSetter'),
      [ownerAddress, factoryContract.address] // initially set the fee to setter to the deployer
    )

    console.log('Setting correct fee receiver in factory')
    await factoryContract.setFeeTo(feeReceiverContract.address)

    console.log('Setting correct fee setter in factory')
    await factoryContract.setFeeToSetter(feeSetterContract.address)

    console.log()
    console.log(`Factory deployed at address ${factoryContract.address}`)
    console.log(`Fee setter deployed at address ${feeSetterContract.address}`)
    console.log(`Fee receiver deployed at address ${feeReceiverContract.address}`)

    console.log()
    console.log(`== Owners ==`)
    console.log(`Fee setter owned by address ${await feeSetterContract.owner()}`)
    console.log(`Fee receiver owned by address ${await feeReceiverContract.owner()}`)

    console.log()
    console.log(`== Checks ==`)
    console.log(`Fee setter is set to ${await factoryContract.feeToSetter()} in factory`)
    console.log(`Fee receiver is set to ${await factoryContract.feeTo()} in factory`)
  })
