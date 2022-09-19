pragma solidity =0.5.16;

import './interfaces/IDXswapFactory.sol';
import './interfaces/IDXswapPair.sol';
import './interfaces/IWETH.sol';
import './libraries/TransferHelper.sol';
import './libraries/SafeMath.sol';


contract DXswapFeeReceiver {
    using SafeMath for uint;

    address public owner;
    IDXswapFactory public factory;
    address public WETH;
    address public ethReceiver;
    address public fallbackReceiver;

    constructor(
        address _owner, address _factory, address _WETH, address _ethReceiver, address _fallbackReceiver
    ) public {
        owner = _owner;
        factory = IDXswapFactory(_factory);
        WETH = _WETH;
        ethReceiver = _ethReceiver;
        fallbackReceiver = _fallbackReceiver;
    }
    
    function() external payable {}

    function transferOwnership(address newOwner) external {
        require(msg.sender == owner, 'DXswapFeeReceiver: FORBIDDEN');
        owner = newOwner;
    }
    
    function changeReceivers(address _ethReceiver, address _fallbackReceiver) external {
        require(msg.sender == owner, 'DXswapFeeReceiver: FORBIDDEN');
        ethReceiver = _ethReceiver;
        fallbackReceiver = _fallbackReceiver;
    }
    
    // Returns sorted token addresses, used to handle return values from pairs sorted in this order
    function sortTokens(address tokenA, address tokenB) internal pure returns (address token0, address token1) {
        require(tokenA != tokenB, 'DXswapFeeReceiver: IDENTICAL_ADDRESSES');
        (token0, token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        require(token0 != address(0), 'DXswapFeeReceiver: ZERO_ADDRESS');
    }
    
    // Helper function to know if an address is a contract, extcodesize returns the size of the code of a smart
    //  contract in a specific address
    function isContract(address addr) internal returns (bool) {
        uint size;
        assembly { size := extcodesize(addr) }
        return size > 0;
    }

    // Calculates the CREATE2 address for a pair without making any external calls
    // Taken from DXswapLibrary, removed the factory parameter
    // Init code pair hash changed with hardhat migration
    function pairFor(address tokenA, address tokenB) internal view returns (address pair) {
        (address token0, address token1) = sortTokens(tokenA, tokenB);
        pair = address(uint(keccak256(abi.encodePacked(
            hex'ff',
            factory,
            keccak256(abi.encodePacked(token0, token1)),
            hex'9e43bdf627764c4a3e3e452d1b558fff8466adc4dc8a900396801d26f4c542f2' // init code hash
        ))));
    }
    
    // Done with code form DXswapRouter and DXswapLibrary, removed the deadline argument
    function _swapTokensForETH(uint amountIn, address fromToken)
        internal
    {
        IDXswapPair pairToUse = IDXswapPair(pairFor(fromToken, WETH));
        
        (uint reserve0, uint reserve1,) = pairToUse.getReserves();
        (uint reserveIn, uint reserveOut) = fromToken < WETH ? (reserve0, reserve1) : (reserve1, reserve0);

        require(reserveIn > 0 && reserveOut > 0, 'DXswapFeeReceiver: INSUFFICIENT_LIQUIDITY');
        uint amountInWithFee = amountIn.mul(uint(10000).sub(pairToUse.swapFee()));
        uint numerator = amountInWithFee.mul(reserveOut);
        uint denominator = reserveIn.mul(10000).add(amountInWithFee);
        uint amountOut = numerator / denominator;
        
        TransferHelper.safeTransfer(
            fromToken, address(pairToUse), amountIn
        );
        
        (uint amount0Out, uint amount1Out) = fromToken < WETH ? (uint(0), amountOut) : (amountOut, uint(0));
        
        pairToUse.swap(
            amount0Out, amount1Out, address(this), new bytes(0)
        );
        
        IWETH(WETH).withdraw(amountOut);
        TransferHelper.safeTransferETH(ethReceiver, amountOut);
    }

    // Transfer to the owner address the token converted into ETH if possible, if not just transfer the token.
    function _takeETHorToken(address token, uint amount) internal {
      if (token == WETH) {
        // If it is WETH, transfer directly to ETH receiver
        IWETH(WETH).withdraw(amount);
        TransferHelper.safeTransferETH(ethReceiver, amount);
      } else if (isContract(pairFor(token, WETH))) {
        // If it is not WETH and there is a direct path to WETH, swap and transfer WETH to ETH receiver
        _swapTokensForETH(amount, token);
      } else {
        // If it is not WETH and there is not a direct path to WETH, transfer tokens directly to fallback receiver
        TransferHelper.safeTransfer(token, fallbackReceiver, amount);
      }
    }
    
    // Take what was charged as protocol fee from the DXswap pair liquidity
    function takeProtocolFee(IDXswapPair[] calldata pairs) external {
        require(msg.sender == owner, 'DXswapFeeReceiver: FORBIDDEN');
        
        for (uint i = 0; i < pairs.length; i++) {
            address token0 = pairs[i].token0();
            address token1 = pairs[i].token1();
            pairs[i].transfer(address(pairs[i]), pairs[i].balanceOf(address(this)));
            (uint amount0, uint amount1) = pairs[i].burn(address(this));
            if (amount0 > 0)
                _takeETHorToken(token0, amount0);
            if (amount1 > 0)
                _takeETHorToken(token1, amount1);
        }
    }

}
