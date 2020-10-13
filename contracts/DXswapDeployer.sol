pragma solidity =0.5.16;

import './DXswapFactory.sol';
import './interfaces/IDXswapPair.sol';
import './DXswapFeeSetter.sol';


contract DXswapDeployer {
    
    address payable public dxdaoAvatar;
    uint8 public state = 0;

    struct TokenPair {
        address tokenA;
        address tokenB;
        uint32 swapFee;
    }
    
    TokenPair[] public initialTokenPairs;
    
    event FeeSetterDeployed(address feeSetter);
    event PairFactoryDeployed(address factory);
    event PairDeployed(address pair);
        
    // Step 1: Create the deployer contract with all the needed information for deployment.
    constructor(
        address payable _dxdaoAvatar,
        address[] memory tokensA,
        address[] memory tokensB,
        uint32[] memory swapFees
    ) public {
        dxdaoAvatar = _dxdaoAvatar;
        for(uint8 i = 0; i < tokensA.length; i ++) {
            initialTokenPairs.push(
                TokenPair(
                    tokensA[i],
                    tokensB[i],
                    swapFees[i]
                )
            );
        }
    }
    
    // Step 2: Transfer ETH from the DXdao avatar to allow the deploy function to be called.
    function() external payable {
        require(state == 0, 'DXswapDeployer: WRONG_DEPLOYER_STATE');
        require(msg.sender == dxdaoAvatar, 'DXswapDeployer: CALLER_NOT_FEE_TO_SETTER');
        state = 1;
    }
    
    // Step 3: Deploy DXswapFactory and all initial pairs
    function deploy() public {
        require(state == 1, 'DXswapDeployer: WRONG_DEPLOYER_STATE');
        DXswapFactory dxSwapFactory = new DXswapFactory(address(this));
        emit PairFactoryDeployed(address(dxSwapFactory));
        for(uint8 i = 0; i < initialTokenPairs.length; i ++) {
            address newPair = dxSwapFactory.createPair(initialTokenPairs[i].tokenA, initialTokenPairs[i].tokenB);
            dxSwapFactory.setSwapFee(newPair, initialTokenPairs[i].swapFee);
            emit PairDeployed(
                address(newPair)
            );
        }
        dxSwapFactory.setFeeTo(dxdaoAvatar);
        DXswapFeeSetter dxSwapFeeSetter = new DXswapFeeSetter(dxdaoAvatar, address(dxSwapFactory));
        emit FeeSetterDeployed(address(dxSwapFeeSetter));
        dxSwapFactory.setFeeToSetter(address(dxSwapFeeSetter));
        state = 2;
        msg.sender.transfer(address(this).balance);
    }
    
  
}
