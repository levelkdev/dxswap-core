import dotenv from "dotenv";
import { HardhatUserConfig } from "hardhat/types";
import "@nomicfoundation/hardhat-chai-matchers";
import "@nomiclabs/hardhat-ethers";
import "@nomiclabs/hardhat-etherscan";
import "@typechain/hardhat";
import "hardhat-dependency-compiler";
import "hardhat-deploy";
import "hardhat-gas-reporter";
import "solidity-coverage";

dotenv.config();

const infuraKey = process.env.INFURA_KEY;
const accounts = process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [];

const config: HardhatUserConfig = {
  solidity: {
    compilers: [
      {
        version: "0.8.15",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
      {
        version: "0.6.6",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
      {
        version: "0.5.16",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      }
    ]
  },
  paths: {
    artifacts: "build/artifacts",
    cache: "build/cache",
    deploy: "deploy",
    sources: "contracts",
    deployments: "deployments",
  },
  defaultNetwork: "hardhat",
  networks: {
    hardhat: {
      blockGasLimit: 30000000, //default 30 000 000
      gasPrice: 1000000000, //10 Gwei	
      gas: 9000000,
      chainId: 1, //set mainnet ID
    },
    localhost: {
      url: "http://localhost:8545",
      gasPrice: 20000000000, //20 Gwei,
    },
    mainnet: {
      live: true,
      saveDeployments: true,
      url: `https://mainnet.infura.io/v3/${infuraKey}`,
      accounts,
    },
    gnosis: {
      live: true,
      saveDeployments: true,
      url: "https://rpc.gnosischain.com/",
      accounts,
    },
    rinkeby: {
      live: false,
      saveDeployments: true,
      url: `https://rinkeby.infura.io/v3/${infuraKey}`,
      accounts,
  },
  },
  typechain: {
    outDir: "typechain",
    target: "ethers-v5",
  },
  namedAccounts: {
    deployer: 0,
    account1: 1,
    account2: 2,
  },
  gasReporter: {
    currency: "USD",
    enabled: process.env.GAS_REPORT_ENABLED === "true",
  },
  etherscan: {
    apiKey: process.env.ETHERSCAN_KEY,
  },
  dependencyCompiler: {
    paths: [
      './contracts/test',
    ]
  }
};
export default config;