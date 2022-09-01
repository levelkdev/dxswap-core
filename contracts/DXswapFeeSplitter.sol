pragma solidity =0.8.15;

import "./interfaces/IDXswapFactory.sol";
import "./interfaces/IDXswapPair.sol";
import "./interfaces/IWETH.sol";
import "./libraries/TransferHelperV2.sol";

contract DXswapFeeSplitter {
    address public owner;
    IDXswapFactory public factory;
    address public nativeCurrencyWrapper;
    address public ethReceiver;
    address public fallbackReceiver;
    uint16 public maxSwapPriceImpact = 100; // uses default 1% as max allowed price impact for takeProtocolFee swap

    // if needed set address of external project which can get % of total earned protocol fee
    // % of total protocol fee to external project (100 means 1%) is within the range <0, 50>
    struct ExternalFeeReceiver {
        address externalReceiver;
        uint16 feePercentage;
    }

    mapping(address => ExternalFeeReceiver) public externalFeeReceivers;

    event TakeProtocolFee(
        address indexed sender,
        address indexed to,
        uint256 NumberOfPairs
    );

    constructor(
        address _owner,
        address _factory,
        address _nativeCurrencyWrapper,
        address _ethReceiver,
        address _fallbackReceiver
    ) {
        owner = _owner;
        factory = IDXswapFactory(_factory);
        nativeCurrencyWrapper = _nativeCurrencyWrapper;
        ethReceiver = _ethReceiver;
        fallbackReceiver = _fallbackReceiver;
    }

    receive() external payable {}

    // called by the owner to set the new owner
    function transferOwnership(address newOwner) external {
        require(msg.sender == owner, "DXswapFeeSplitter: FORBIDDEN");
        owner = newOwner;
    }

    // called by the owner to change receivers addresses
    function changeReceivers(address _ethReceiver, address _fallbackReceiver)
        external
    {
        require(msg.sender == owner, "DXswapFeeSplitter: FORBIDDEN");
        ethReceiver = _ethReceiver;
        fallbackReceiver = _fallbackReceiver;
    }

    // Returns sorted token addresses, used to handle return values from pairs sorted in this order
    function sortTokens(address tokenA, address tokenB)
        internal
        pure
        returns (address token0, address token1)
    {
        require(tokenA != tokenB, "DXswapFeeSplitter: IDENTICAL_ADDRESSES");
        (token0, token1) = tokenA < tokenB
            ? (tokenA, tokenB)
            : (tokenB, tokenA);
        require(token0 != address(0), "DXswapFeeSplitter: ZERO_ADDRESS");
    }

    // Done with code form DXswapRouter and DXswapLibrary, removed the deadline argument
    function _swapTokensForETH(uint256 amountIn, address fromToken)
        internal
        returns (uint256 amountOut)
    {
        IDXswapPair pairToUse = IDXswapPair(
            factory.getPair(fromToken, nativeCurrencyWrapper)
        );

        (uint256 reserve0, uint256 reserve1, ) = pairToUse.getReserves();
        (uint256 reserveIn, uint256 reserveOut) = fromToken <
            nativeCurrencyWrapper
            ? (reserve0, reserve1)
            : (reserve1, reserve0);

        require(
            reserveIn > 0 && reserveOut > 0,
            "DXswapFeeSplitter: INSUFFICIENT_LIQUIDITY"
        ); // should never happen since pool was checked before
        uint256 amountInWithFee = amountIn * (10000 - pairToUse.swapFee());
        uint256 numerator = amountInWithFee * reserveOut;
        uint256 denominator = reserveIn * 10000 + amountInWithFee;
        amountOut = numerator / denominator;

        TransferHelper.safeTransfer(fromToken, address(pairToUse), amountIn);

        (uint256 amount0Out, uint256 amount1Out) = fromToken <
            nativeCurrencyWrapper
            ? (uint256(0), amountOut)
            : (amountOut, uint256(0));

        pairToUse.swap(amount0Out, amount1Out, address(this), new bytes(0));
    }

    // Helper function to know if token-nativeCurrencyWrapper pool exists and has enough liquidity
    function _isSwapPossible(
        address token0,
        address token1,
        uint256 amount
    ) internal view returns (bool) {
        address pair = factory.getPair(token0, token1);
        if (pair == address(0)) return false;

        (uint256 reserve0, uint256 reserve1, ) = IDXswapPair(pair)
            .getReserves();
        (uint256 reserveIn, uint256 reserveOut) = token0 < token1
            ? (reserve0, reserve1)
            : (reserve1, reserve0);
        if (reserveIn == 0 || reserveOut == 0) return false;

        uint256 priceImpact = (amount * 10000) / reserveIn; // simplified formula
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
        address _externalFeeReceiver = externalFeeReceivers[pair]
            .externalReceiver;
        uint16 _percentFeeToExternalReceiver = externalFeeReceivers[pair]
            .feePercentage;

        if (
            _percentFeeToExternalReceiver > 0 &&
            _externalFeeReceiver != address(0)
        ) {
            uint256 feeToExternalReceiver = (amount *
                _percentFeeToExternalReceiver) / 10000;
            uint256 feeToAvatarDAO = amount - feeToExternalReceiver;
            if (token == nativeCurrencyWrapper) {
                IWETH(nativeCurrencyWrapper).withdraw(amount);
                TransferHelper.safeTransferETH(
                    _externalFeeReceiver,
                    feeToExternalReceiver
                );
                TransferHelper.safeTransferETH(ethReceiver, feeToAvatarDAO);
            } else {
                TransferHelper.safeTransfer(
                    token,
                    _externalFeeReceiver,
                    feeToExternalReceiver
                );
                TransferHelper.safeTransfer(
                    token,
                    fallbackReceiver,
                    feeToAvatarDAO
                );
            }
        } else {
            if (token == nativeCurrencyWrapper) {
                IWETH(nativeCurrencyWrapper).withdraw(amount);
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
        if (
            token != nativeCurrencyWrapper &&
            _isSwapPossible(token, nativeCurrencyWrapper, amount)
        ) {
            // If it is not nativeCurrencyWrapper and there is a direct path to nativeCurrencyWrapper, swap tokens
            uint256 amountOut = _swapTokensForETH(amount, token);
            _splitAndTransferFee(pair, nativeCurrencyWrapper, amountOut);
        } else {
            // If it is nativeCurrencyWrapper or there is not a direct path from token to nativeCurrencyWrapper, transfer tokens
            _splitAndTransferFee(pair, token, amount);
        }
    }

    // Take what was charged as protocol fee from the DXswap pair liquidity
    function takeProtocolFee(IDXswapPair[] calldata pairs) external {
        for (uint256 i = 0; i < pairs.length; i++) {
            address token0 = pairs[i].token0();
            address token1 = pairs[i].token1();
            pairs[i].transfer(
                address(pairs[i]),
                pairs[i].balanceOf(address(this))
            );
            (uint256 amount0, uint256 amount1) = pairs[i].burn(address(this));
            if (amount0 > 0)
                _takeTokenOrETH(address(pairs[i]), token0, amount0);
            if (amount1 > 0)
                _takeTokenOrETH(address(pairs[i]), token1, amount1);
        }
        emit TakeProtocolFee(msg.sender, ethReceiver, pairs.length);
    }

    // called by the owner to set maximum swap price impact allowed for single token-nativeCurrencyWrapper swap (within 0-100% range)
    function setMaxSwapPriceImpact(uint16 _maxSwapPriceImpact) external {
        require(msg.sender == owner, "DXswapFeeSplitter: CALLER_NOT_OWNER");
        require(
            _maxSwapPriceImpact > 0 && _maxSwapPriceImpact < 10000,
            "DXswapFeeSplitter: FORBIDDEN_PRICE_IMPACT"
        );
        maxSwapPriceImpact = _maxSwapPriceImpact;
    }

    // called by the owner to set external fee receiver address
    function setExternalFeeReceiver(address _pair, address _externalReceiver)
        external
    {
        require(msg.sender == owner, "DXswapFeeSplitter: CALLER_NOT_OWNER");
        externalFeeReceivers[_pair].externalReceiver = _externalReceiver;
    }

    // called by the owner to set fee percentage to external receiver
    function setFeePercentageToExternalReceiver(
        address _pair,
        uint16 _feePercentageToExternalReceiver
    ) external {
        require(msg.sender == owner, "DXswapFeeSplitter: CALLER_NOT_OWNER");
        IDXswapPair swapPair = IDXswapPair(_pair);
        uint256 feeReceiverBalance = swapPair.balanceOf(address(this));
        if (feeReceiverBalance > 0) {
            // withdraw accumulated fees before updating the split percentage
            address token0 = swapPair.token0();
            address token1 = swapPair.token1();
            swapPair.transfer(address(swapPair), feeReceiverBalance);
            (uint256 amount0, uint256 amount1) = swapPair.burn(address(this));
            if (amount0 > 0)
                _takeTokenOrETH(address(swapPair), token0, amount0);
            if (amount1 > 0)
                _takeTokenOrETH(address(swapPair), token1, amount1);
            emit TakeProtocolFee(msg.sender, ethReceiver, 1);
        }
        require(
            swapPair.balanceOf(address(this)) == 0,
            "DXswapFeeSplitter: TOKENS_NOT_BURNED"
        );

        // fee percentage check
        require(
            _feePercentageToExternalReceiver >= 0 &&
                _feePercentageToExternalReceiver <= 5000,
            "DXswapFeeSplitter: FORBIDDEN_FEE_PERCENTAGE_SPLIT"
        );
        // update the split percentage for specific pair
        externalFeeReceivers[_pair]
            .feePercentage = _feePercentageToExternalReceiver;
    }
}
