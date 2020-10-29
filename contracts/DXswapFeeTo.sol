pragma solidity =0.5.16;

// Purpose of this contract is to collect the protocol fee from DXswap and direct to the DXtrust
// Using DXswap it will convert the LP tokens collected from the protocol fee into tokens
// It will then sell the tokens for ETH
// And then it will send the ETH to DXtrust

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";

import './interfaces/IDXswapPair.sol';
import './interfaces/IDXswapFactory.sol';
import './interfaces/IERC20.sol'; // Is this different than IUniswapV2ERC20.sol

contract DXswapFeeTo {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    IDXswapFactory public factory;
    address public weth;

    constructor(IDXswapFactory _factory, address _owner, address _DAT, address _weth) public {
        factory = _factory;
		owner = _owner;
		DAT = DecentralizedAutonmousTrust(_DAT); // Is this right?
        weth = _weth;
    }

    function convert(address token0, address token1) public {
        // Require convert to not be called from contract to help protect from front-running
        // TODO Does this make it harder to write a keeper bot?
        require(msg.sender == tx.origin, "do not convert from contract");
        IDXswapPair pair = IDXswapPair(factory.getPair(token0, token1));
        pair.transfer(address(pair), pair.balanceOf(address(this)));
        pair.burn(address(this));
        // First we convert everything to WETH
        uint256 wethAmount = _toWETH(token0) + _toWETH(token1);
        // Then we convert the WETH to Sushi
        uint256 ethAmount = _toETH(wethAmount);
        _sentToDAT(ethAmount);
    }

    // Converts token passed as an argument to WETH
    function _toWETH(address token) internal returns (uint256) {
        // If the passed token is WETH, don't convert anything
        if (token == weth) {
            uint amount = IERC20(token).balanceOf(address(this));
            _safeTransfer(token, factory.getPair(weth, sushi), amount);
            return amount;
        }
        // If the target pair doesn't exist, don't convert anything
        IUniswapV2Pair pair = IUniswapV2Pair(factory.getPair(token, weth));
        if (address(pair) == address(0)) {
            return 0;
        }
        // Choose the correct reserve to swap from
        (uint reserve0, uint reserve1,) = pair.getReserves();
        address token0 = pair.token0();
        (uint reserveIn, uint reserveOut) = token0 == token ? (reserve0, reserve1) : (reserve1, reserve0);
        // Calculate information required to swap
        uint amountIn = IERC20(token).balanceOf(address(this));
        // TODO adapt to DXswap fees
        uint amountInWithFee = amountIn.mul(997);
        uint numerator = amountInWithFee.mul(reserveOut);
        uint denominator = reserveIn.mul(1000).add(amountInWithFee);
        uint amountOut = numerator / denominator;
        (uint amount0Out, uint amount1Out) = token0 == token ? (uint(0), amountOut) : (amountOut, uint(0));
        // Swap the token for WETH
        _safeTransfer(token, address(pair), amountIn);
        pair.swap(amount0Out, amount1Out, address(this), new bytes(0));
        return amountOut;
    }

    // Converts WETH to ETH
    function _toETH(uint256 amountIn) internal {
    	// TODO complete function
    }

    function _sentToDAT(uint256 ethAmount) internal {
    	// TODO complete function
    }

    // Wrapper for safeTransfer
    function _safeTransfer(address token, address to, uint256 amount) internal {
        IERC20(token).safeTransfer(to, amount);
    }
}