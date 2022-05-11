pragma solidity =0.5.16;

import './interfaces/IDXswapFactory.sol';
import './interfaces/IDXswapPair.sol';
import './interfaces/IWETH.sol';
import './libraries/TransferHelper.sol';
import './libraries/SafeMath.sol';

contract DXswapFeeReceiver {
    using SafeMath for uint256;

    address public owner;
    IDXswapFactory public factory;
    address public WETH;
    address public ethReceiver;
    address public fallbackReceiver;
    uint32 public maxSwapPriceImpact = 100; // uses default 1% as max allowed price impact for takeProtocolFee swap

    // if needed set address of external project which can get % of total earned protocol fee
    // % of total protocol fee to external project (100 means 1%) is within the range <0, 50>
    struct ExternalFeeReceiver {
        address externalReceiver;
        uint32 feePercentage;
    }

    mapping(address => ExternalFeeReceiver) public externalFeeReceivers;

    event TakeProtocolFee(address indexed sender, address indexed to, uint256 NumberOfPairs);

    constructor(
        address _owner,
        address _factory,
        address _WETH,
        address _ethReceiver,
        address _fallbackReceiver
    ) public {
        owner = _owner;
        factory = IDXswapFactory(_factory);
        WETH = _WETH;
        ethReceiver = _ethReceiver;
        fallbackReceiver = _fallbackReceiver;
    }

    function() external payable {}

    // called by the owner to set the new owner
    function transferOwnership(address newOwner) external {
        require(msg.sender == owner, 'DXswapFeeReceiver: FORBIDDEN');
        owner = newOwner;
    }

    // called by the owner to change receivers addresses
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
    function isContract(address addr) internal view returns (bool) {
        uint256 size;
        assembly {
            size := extcodesize(addr)
        }
        return size > 0;
    }

    // Calculates the CREATE2 address for a pair without making any external calls
    // Taken from DXswapLibrary, removed the factory parameter
    function pairFor(address tokenA, address tokenB) internal view returns (address pair) {
        (address token0, address token1) = sortTokens(tokenA, tokenB);
        pair = address(
            uint256(
                keccak256(
                    abi.encodePacked(
                        hex'ff',
                        factory,
                        keccak256(abi.encodePacked(token0, token1)),
                        hex'd306a548755b9295ee49cc729e13ca4a45e00199bbd890fa146da43a50571776' // init code hash
                    )
                )
            )
        );
    }

    // Done with code form DXswapRouter and DXswapLibrary, removed the deadline argument
    function _swapTokensForETH(uint256 amountIn, address fromToken) internal returns (uint256 amountOut) {
        IDXswapPair pairToUse = IDXswapPair(pairFor(fromToken, WETH));

        (uint256 reserve0, uint256 reserve1, ) = pairToUse.getReserves();
        (uint256 reserveIn, uint256 reserveOut) = fromToken < WETH ? (reserve0, reserve1) : (reserve1, reserve0);

        require(reserveIn > 0 && reserveOut > 0, 'DXswapFeeReceiver: INSUFFICIENT_LIQUIDITY'); // should never happen since pool was checked before
        uint256 amountInWithFee = amountIn.mul(uint256(10000).sub(pairToUse.swapFee()));
        uint256 numerator = amountInWithFee.mul(reserveOut);
        uint256 denominator = reserveIn.mul(10000).add(amountInWithFee);
        amountOut = numerator / denominator;

        TransferHelper.safeTransfer(fromToken, address(pairToUse), amountIn);

        (uint256 amount0Out, uint256 amount1Out) = fromToken < WETH ? (uint256(0), amountOut) : (amountOut, uint256(0));

        pairToUse.swap(amount0Out, amount1Out, address(this), new bytes(0));
    }

    // Helper function to know if token-WETH pool exists and has enough liquidity
    function _isSwapPossible(
        address token0,
        address token1,
        uint256 amount
    ) internal view returns (bool) {
        address pair = pairFor(token0, token1);
        if (!isContract(pair)) return false;

        (uint256 reserve0, uint256 reserve1, ) = IDXswapPair(pair).getReserves();
        (uint256 reserveIn, uint256 reserveOut) = token0 < token1 ? (reserve0, reserve1) : (reserve1, reserve0);
        if (reserveIn == 0 || reserveOut == 0) return false;

        uint256 priceImpact = amount.mul(10000) / reserveIn; // simplified formula
        if (priceImpact > maxSwapPriceImpact) return false;

        return true;
    }

    // Checks if LP has an extra external address which participates in the distrubution of protocol fee
    // External Receiver address has to be defined and fee % > 0 to transfer tokens
    function _splitAndTransferFee(
        address pair,
        address token,
        uint256 amount
    ) internal {
        address _externalFeeReceiver = externalFeeReceivers[pair].externalReceiver;
        uint32 _percentFeeToExternalReceiver = externalFeeReceivers[pair].feePercentage;

        if (_percentFeeToExternalReceiver > 0 && _externalFeeReceiver != address(0)) {
            uint256 feeToExternalReceiver = amount.mul(_percentFeeToExternalReceiver) / 10000;
            uint256 feeToAvatarDAO = amount.sub(feeToExternalReceiver);
            if (token == WETH) {
                IWETH(WETH).withdraw(amount);
                TransferHelper.safeTransferETH(_externalFeeReceiver, feeToExternalReceiver);
                TransferHelper.safeTransferETH(ethReceiver, feeToAvatarDAO);
            } else {
                TransferHelper.safeTransfer(token, _externalFeeReceiver, feeToExternalReceiver);
                TransferHelper.safeTransfer(token, fallbackReceiver, feeToAvatarDAO);
            }
        } else {
            if (token == WETH) {
                IWETH(WETH).withdraw(amount);
                TransferHelper.safeTransferETH(ethReceiver, amount);
            } else {
                TransferHelper.safeTransfer(token, fallbackReceiver, amount);
            }
        }
    }

    // Convert tokens into ETH if possible, if not just transfer the token
    function _takeTokenOrETH(
        address pair,
        address token,
        uint256 amount
    ) internal {
        if (token != WETH && _isSwapPossible(token, WETH, amount)) {
            // If it is not WETH and there is a direct path to WETH, swap tokens
            uint256 amountOut = _swapTokensForETH(amount, token);
            _splitAndTransferFee(pair, WETH, amountOut);
        } else {
            // If it is WETH or there is not a direct path from token to WETH, transfer tokens
            _splitAndTransferFee(pair, token, amount);
        }
    }

    // Take what was charged as protocol fee from the DXswap pair liquidity
    function takeProtocolFee(IDXswapPair[] calldata pairs) external {
        for (uint256 i = 0; i < pairs.length; i++) {
            address token0 = pairs[i].token0();
            address token1 = pairs[i].token1();
            pairs[i].transfer(address(pairs[i]), pairs[i].balanceOf(address(this)));
            (uint256 amount0, uint256 amount1) = pairs[i].burn(address(this));
            if (amount0 > 0) _takeTokenOrETH(address(pairs[i]), token0, amount0);
            if (amount1 > 0) _takeTokenOrETH(address(pairs[i]), token1, amount1);
        }
        emit TakeProtocolFee(msg.sender, ethReceiver, pairs.length);
    }

    // called by the owner to set maximum swap price impact allowed for single token-weth swap (within 0-100% range)
    function setMaxSwapPriceImpact(uint32 _maxSwapPriceImpact) external {
        require(msg.sender == owner, 'DXswapFeeReceiver: CALLER_NOT_OWNER');
        require(_maxSwapPriceImpact > 0 && _maxSwapPriceImpact < 10000, 'DXswapFeeReceiver: FORBIDDEN_PRICE_IMPACT');
        maxSwapPriceImpact = _maxSwapPriceImpact;
    }

    // called by the owner to set external fee receiver address
    function setExternalFeeReceiver(address _pair, address _externalReceiver) external {
        require(msg.sender == owner, 'DXswapFeeReceiver: CALLER_NOT_OWNER');
        externalFeeReceivers[_pair].externalReceiver = _externalReceiver;
    }

    // called by the owner to set fee percentage to external receiver
    function setFeePercentageToExternalReceiver(address _pair, uint32 _feePercentageToExternalReceiver) external {
        require(msg.sender == owner, 'DXswapFeeReceiver: CALLER_NOT_OWNER');
        IDXswapPair swapPair = IDXswapPair(_pair);
        uint256 feeReceiverBalance = swapPair.balanceOf(address(this));
        if (feeReceiverBalance > 0) {
            // withdraw accumulated fees before updating the split percentage
            address token0 = swapPair.token0();
            address token1 = swapPair.token1();
            swapPair.transfer(address(swapPair), feeReceiverBalance);
            (uint256 amount0, uint256 amount1) = swapPair.burn(address(this));
            if (amount0 > 0) _takeTokenOrETH(address(swapPair), token0, amount0);
            if (amount1 > 0) _takeTokenOrETH(address(swapPair), token1, amount1);
            emit TakeProtocolFee(msg.sender, ethReceiver, 1);
        }
        require(swapPair.balanceOf(address(this)) == 0, 'DXswapFeeReceiver: TOKENS_NOT_BURNED');

        // fee percentage check
        require(
            _feePercentageToExternalReceiver >= 0 && _feePercentageToExternalReceiver <= 5000,
            'DXswapFeeReceiver: FORBIDDEN_FEE_PERCENTAGE_SPLIT'
        );
        // update the split percentage for specific pair
        externalFeeReceivers[_pair].feePercentage = _feePercentageToExternalReceiver;
    }
}
