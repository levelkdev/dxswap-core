pragma solidity >=0.5.0;

import './IDXswapPair.sol';

interface IDXswapFeeReceiver {
    event TakeProtocolFee(address indexed sender, address indexed to, uint256 NumberOfPairs);

    function owner() external view returns (address);

    function factory() external view returns (address);

    function WETH() external view returns (address);

    function ethReceiver() external view returns (address);

    function fallbackReceiver() external view returns (address);

    function maxSwapPriceImpact() external view returns (uint32);

    function transferOwnership(address) external;

    function changeReceivers(address, address) external;

    function takeProtocolFee(IDXswapPair[] calldata pairs) external;

    function setMaxSwapPriceImpact(uint32) external;
}
