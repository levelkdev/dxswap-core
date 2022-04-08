pragma solidity 0.8.12;

import '../DXswapERC20.sol';

contract ERC20 is DXswapERC20 {
    constructor(uint _totalSupply) public {
        _mint(msg.sender, _totalSupply);
    }
}
