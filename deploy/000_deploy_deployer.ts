import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { contractConstructorArgs, TAGS } from "./deployment.config";
import { runVerify } from "./utils";
import { DXswapDeployer__factory } from "../typechain";
import { getDeploymentConfig } from "./deployment.config";

const deployment: DeployFunction = async (hre: HardhatRuntimeEnvironment) => {
    const { deployments, getNamedAccounts, network } = hre;
    const { deploy } = deployments;
    const { deployer } = await getNamedAccounts();
    const config = getDeploymentConfig(network.name);
    const deployArgs = contractConstructorArgs<DXswapDeployer__factory>(
        config?.dxSwapFeeSetter || deployer,
        config?.dxdaoAvatar || deployer,
        config?.nativeCurrencyWrapper || deployer,
        [],
        [],
        []
    );

    const deployResult = await deploy("DXswapDeployer", {
        from: deployer,
        args: deployArgs,
        log: true,
    });

    if (deployResult.newlyDeployed && deployResult.transactionHash) {
        await runVerify(hre, deployResult.transactionHash, {
            address: deployResult.address,
            constructorArguments: deployArgs,
        });
    }
};

deployment.tags = [TAGS.DEPLOYER, TAGS.CORE_CONTRACTS];

export default deployment;
