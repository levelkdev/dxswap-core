pragma solidity =0.5.16;

import './interfaces/IDXswapFactory.sol';
import './DXswapPair.sol';

contract DXswapFactory is IDXswapFactory {
    address public feeTo;
    address public feeToSetter;
    uint8 public protocolFeeDenominator = 5; // uses 0.05% (1/~6 of 0.30%) per trade as default

    mapping(address => mapping(address => address)) public getPair;
    address[] public allPairs;

    event PairCreated(address indexed token0, address indexed token1, address pair, uint);

    constructor(address _feeToSetter) public {
        feeToSetter = _feeToSetter;
    }

    function allPairsLength() external view returns (uint) {
        return allPairs.length;
    }

    function createPair(address tokenA, address tokenB) external returns (address pair) {
        require(tokenA != tokenB, 'DXswap: IDENTICAL_ADDRESSES');
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        require(token0 != address(0), 'DXswap: ZERO_ADDRESS');
        require(getPair[token0][token1] == address(0), 'DXswap: PAIR_EXISTS'); // single check is sufficient
        bytes memory bytecode = type(DXswapPair).creationCode;
        bytes32 salt = keccak256(abi.encodePacked(token0, token1));
        assembly {
            pair := create2(0, add(bytecode, 32), mload(bytecode), salt)
        }
        IDXswapPair(pair).initialize(token0, token1);
        getPair[token0][token1] = pair;
        getPair[token1][token0] = pair; // populate mapping in the reverse direction
        allPairs.push(pair);
        emit PairCreated(token0, token1, pair, allPairs.length);
    }

    function setFeeTo(address _feeTo) external {
        require(msg.sender == feeToSetter, 'DXswap: FORBIDDEN');
        feeTo = _feeTo;
    }

    function setFeeToSetter(address _feeToSetter) external {
        require(msg.sender == feeToSetter, 'DXswap: FORBIDDEN');
        feeToSetter = _feeToSetter;
    }
    
    function setProtocolFee(uint8 _protocolFeeDenominator) external {
        require(msg.sender == feeToSetter, 'UniswapV2: FORBIDDEN');
        require(_protocolFeeDenominator > 0, 'UniswapV2: FORBIDDEN_FEE');
        protocolFeeDenominator = _protocolFeeDenominator;
    }
    
    function setSwapFee(address _pair, uint8 _swapFee) external {
        require(msg.sender == feeToSetter, 'DXswapFactory: FORBIDDEN');
        IDXswapPair(_pair).setSwapFee(_swapFee);
    }
}