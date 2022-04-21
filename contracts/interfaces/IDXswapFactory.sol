pragma solidity >=0.5.0;

interface IDXswapFactory {
    event PairCreated(address indexed token0, address indexed token1, address pair, uint256);

    function INIT_CODE_PAIR_HASH() external pure returns (bytes32);

    function feeTo() external view returns (address);

    function protocolFeeDenominator() external view returns (uint8);

    function feeToSetter() external view returns (address);

    function getPair(address tokenA, address tokenB) external view returns (address pair);

    function allPairs(uint256) external view returns (address pair);

    function allPairsLength() external view returns (uint256);

    function createPair(address tokenA, address tokenB) external returns (address pair);

    function setFeeTo(address) external;

    function setFeeToSetter(address) external;

    function setProtocolFee(uint8 protocolFee) external;

    function setSwapFee(address pair, uint32 swapFee) external;

    function setExternalFeeRecipient(address pair, address externalFeeRecipient) external;

    function setPercentFeeToExternalRecipient(address pair, uint32 percentFeeToExternalRecipient) external;
}
