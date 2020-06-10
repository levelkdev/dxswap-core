pragma solidity >=0.5.0;

interface IUniswapV2Factory {
    event PairCreated(address indexed token0, address indexed token1, address pair, uint);

    function protocolFeeDenominator() external view returns (uint8);
    function feeTo() external view returns (address);
    function protocolFee() external view returns (uint8);
    function feeToSetter() external view returns (address);

    function getPair(address tokenA, address tokenB) external view returns (address pair);
    function allPairs(uint) external view returns (address pair);
    function allPairsLength() external view returns (uint);

    function createPair(address tokenA, address tokenB) external returns (address pair);

    function setFeeTo(address) external;
    function setFeeToSetter(address) external;
    function setProtocolFee(uint8 _protocolFee) external;
    function setSwapFee(address pair, uint8 swapFee) external;
}
