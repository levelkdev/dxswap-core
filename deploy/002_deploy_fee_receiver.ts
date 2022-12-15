import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { contractConstructorArgs, TAGS } from "./deployment.config";
import { runVerify } from "./utils";
import { DXswapFeeReceiver__factory } from "../typechain";
import { getDeploymentConfig } from "./deployment.config";

const deployment: DeployFunction = async (hre: HardhatRuntimeEnvironment) => {
    const { deployments, getNamedAccounts, network } = hre;
    const { deploy } = deployments;

    const { deployer } = await getNamedAccounts();

    const config = getDeploymentConfig(network.name);

    const constructorArgs = contractConstructorArgs<DXswapFeeReceiver__factory>(
        config?.owner || deployer,
        config?.dxSwapFactory || deployer,
        config?.nativeCurrencyWrapper || deployer,
        config?.dxdaoAvatar || deployer,
        config?.dxdaoAvatar || deployer,
    );


    const deployResult = await deploy("DXswapFeeReceiver", {
        from: deployer,
        args: constructorArgs,
        log: true,
    });

    if (deployResult.newlyDeployed && deployResult.transactionHash) {
        await runVerify(hre, deployResult.transactionHash, {
            address: deployResult.address,
            constructorArguments: constructorArgs,
        });
    }
};

deployment.tags = [TAGS.FEE_RECEIVER, TAGS.CORE_CONTRACTS];

export default deployment;
