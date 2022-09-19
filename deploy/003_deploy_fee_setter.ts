import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { contractConstructorArgs, TAGS } from "./deployment.config";
import { runVerify } from "./utils";
import { DXswapFeeSetter__factory } from "../typechain";
import { getDeploymentConfig } from "./deployment.config";

const deployment: DeployFunction = async (hre: HardhatRuntimeEnvironment) => {
    const { deployments, getNamedAccounts, network } = hre;
    const { deploy } = deployments;

    const { deployer } = await getNamedAccounts();

    const config = getDeploymentConfig(network.name);

    const constructorArgs = contractConstructorArgs<DXswapFeeSetter__factory>(
        config?.owner || deployer,
        config?.dxSwapFactory || deployer,
    );


    const deployResult = await deploy("DXswapFeeSetter", {
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

deployment.tags = [TAGS.FEE_SETTER, TAGS.CORE_CONTRACTS];

export default deployment;
