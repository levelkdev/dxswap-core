pragma solidity =0.5.16;

import './interfaces/IDXswapFactory.sol';
import './interfaces/IDXswapFeeReceiver.sol';
import './interfaces/IDXswapPair.sol';

contract DXswapFeeSetter {
    address public owner;
    mapping(address => address) public pairOwners;
    IDXswapFactory public factory;

    constructor(address _owner, address _factory) public {
        owner = _owner;
        factory = IDXswapFactory(_factory);
    }

    function transferOwnership(address newOwner) external {
        require(msg.sender == owner, 'DXswapFeeSetter: FORBIDDEN');
        owner = newOwner;
    }

    function transferPairOwnership(address pair, address newOwner) external {
        require(msg.sender == owner, 'DXswapFeeSetter: FORBIDDEN');
        pairOwners[pair] = newOwner;
    }

    function setFeeTo(address feeTo) external {
        require(msg.sender == owner, 'DXswapFeeSetter: FORBIDDEN');
        factory.setFeeTo(feeTo);
    }

    function setFeeToSetter(address feeToSetter) external {
        require(msg.sender == owner, 'DXswapFeeSetter: FORBIDDEN');
        factory.setFeeToSetter(feeToSetter);
    }

    function setProtocolFee(uint8 protocolFeeDenominator) external {
        require(msg.sender == owner, 'DXswapFeeSetter: FORBIDDEN');
        factory.setProtocolFee(protocolFeeDenominator);
    }

    function setSwapFee(address pair, uint32 swapFee) external {
        require((msg.sender == owner) || ((msg.sender == pairOwners[pair])), 'DXswapFeeSetter: FORBIDDEN');
        factory.setSwapFee(pair, swapFee);
    }

    function setExternalFeeRecipient(address pair, address externalFeeRecipient) external {
        require((msg.sender == owner) || ((msg.sender == pairOwners[pair])), 'DXswapFeeSetter: FORBIDDEN');
        factory.setExternalFeeRecipient(pair, externalFeeRecipient);
    }

    function setPercentFeeToExternalRecipient(
        address pair,
        address feeReceiver,
        uint32 percentFeeToExternalRecipient
    ) external {
        require((msg.sender == owner) || ((msg.sender == pairOwners[pair])), 'DXswapFeeSetter: FORBIDDEN');
        uint256 feeReceiverBalance = IDXswapPair(pair).balanceOf(feeReceiver);
        if (feeReceiverBalance > 0) {
            // withdraw accumulated fees before updating the split percentage
            IDXswapPair[] memory pairs = new IDXswapPair[](1);
            pairs[0] = IDXswapPair(pair);
            IDXswapFeeReceiver(feeReceiver).takeProtocolFee(pairs);
        }
        // update the split percentage for specific pair
        factory.setPercentFeeToExternalRecipient(pair, percentFeeToExternalRecipient);
    }
}
