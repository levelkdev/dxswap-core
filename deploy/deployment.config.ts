/* eslint-disable no-unused-vars */
import { ContractFactory } from "ethers";

export enum TAGS {
    CORE_CONTRACTS = "CORE_CONTRACTS", // full deploy
    DEPLOYER = "DEPLOYER",
    FACTORY = "FACTORY",
    FEE_RECEIVER = "FEE_RECEIVER",
    FEE_SETTER = "FEE_SETTER",
    SWAP_ERC20 = "SWAP_ERC20",
}

type PeripheryDeployParams = Partial<{
    dxdaoAvatar: string;
    owner: string;
    dxSwapFactory: string;
    dxSwapRouter: string;
    dxSwapFeeReceiver: string;
    dxSwapFeeSetter: string;
    nativeCurrencyWrapper: string;
}>;

const deploymentConfig: { [k: string]: PeripheryDeployParams } = {
    mainnet: {
        dxdaoAvatar: "0x519b70055af55A007110B4Ff99b0eA33071c720a",
        owner: "0x519b70055af55A007110B4Ff99b0eA33071c720a",
        dxSwapFactory: "0xd34971BaB6E5E356fd250715F5dE0492BB070452",
        dxSwapRouter: "0xB9960d9bcA016e9748bE75dd52F02188B9d0829f",
        dxSwapFeeReceiver: "0xC6130400C1e3cD7b352Db75055dB9dD554E00Ef0",
        dxSwapFeeSetter: "0x288879b3CaFA044dB6Ba18ee638BBC1a233F8548",
        nativeCurrencyWrapper: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    },
    gnosis: {
        dxdaoAvatar: "0xe716EC63C5673B3a4732D22909b38d779fa47c3F",
        owner: "0xe716EC63C5673B3a4732D22909b38d779fa47c3F",
        dxSwapFactory: "0x5D48C95AdfFD4B40c1AAADc4e08fc44117E02179",
        dxSwapRouter: "0xE43e60736b1cb4a75ad25240E2f9a62Bff65c0C0",
        dxSwapFeeReceiver: "0x65f29020d07A6CFa3B0bF63d749934d5A6E6ea18",
        dxSwapFeeSetter: "0xe3F8F55d7709770a18a30b7e0D16Ae203a2c034F",
        nativeCurrencyWrapper: "0xe91D153E0b41518A2Ce8Dd3D7944Fa863463a97d",
    },
    arbitrum: {
        dxdaoAvatar: "0x2B240b523f69b9aF3adb1C5924F6dB849683A394",
        owner: "0xbf7454c656BDB7C439E8d759c18Ac240398FdE35",
        dxSwapFactory: "0x359F20Ad0F42D75a5077e65F30274cABe6f4F01a",
        dxSwapRouter: "0x530476d5583724A89c8841eB6Da76E7Af4C0F17E",
        dxSwapFeeReceiver: "0x1D7C7cb66fB2d75123351FD0d6779E8d7724a1ae",
        dxSwapFeeSetter: "0x56F53CB6c0a80947C9Be239A62bc65fA20d4b41d",
        nativeCurrencyWrapper: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
    },
};

export const getDeploymentConfig = (networkName: string) => {
    return deploymentConfig[networkName] || undefined;
};

export const contractConstructorArgs = <T extends ContractFactory>(
    ...args: Parameters<T["deploy"]>
) => args;