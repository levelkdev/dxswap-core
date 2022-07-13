mkdir -p contracts/.flattened
npx hardhat flatten contracts/DXswapFactory.sol > contracts/.flattened/DXswapFactory.sol
npx hardhat flatten contracts/DXswapPair.sol > contracts/.flattened/DXswapPair.sol
npx hardhat flatten contracts/DXswapERC20.sol > contracts/.flattened/DXswapERC20.sol
npx hardhat flatten contracts/DXswapDeployer.sol > contracts/.flattened/DXswapDeployer.sol
npx hardhat flatten contracts/DXswapFeeSetter.sol > contracts/.flattened/DXswapFeeSetter.sol
npx hardhat flatten contracts/DXswapFeeReceiver.sol > contracts/.flattened/DXswapFeeReceiver.sol
