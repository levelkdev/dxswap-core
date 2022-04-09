require('dotenv').config()
require('@nomiclabs/hardhat-truffle5')
require('@matterlabs/hardhat-zksync-deploy')
require('@matterlabs/hardhat-zksync-solc')
require('./tasks/deploy-zksync')
require('./tasks/deploy-multicall')
require('./tasks/get-init-code-hash')
require('./tasks/get-pair-address')

const infuraId = process.env.INFURA_ID
const accounts = process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : []

/**
 * @type import('hardhat/config').HardhatUserConfig
 */
module.exports = {
  networks: {
    hardhat: {
      zksync: true
    },
    arbitrumTestnetV5: {
      url: 'https://kovan5.arbitrum.io/rpc',
      accounts,
      gasPrice: 0,
      gas: 1000000000,
      timeout: 100000
    },
    arbitrumMainnet: {
      url: 'https://arb1.arbitrum.io/rpc',
      accounts,
      gasPrice: 0,
      timeout: 100000
    },
    rinkeby: {
      url: `https://rinkeby.infura.io/v3/${infuraId}`,
      accounts
    },
    arbitrumRinkebyTestnet: {
      url: 'https://rinkeby.arbitrum.io/rpc',
      accounts,
      gasPrice: 0,
      timeout: 100000
    },
    sokol: {
      url: 'https://sokol.poa.network',
      accounts,
      gasPrice: 1000000000,
      timeout: 100000
    },
    xdai: {
      url: 'https://rpc.xdaichain.com/',
      accounts,
      gasPrice: 1000000000,
      timeout: 100000
    },
    zkSyncV2: {
      url: 'https://zksync2-testnet.zksync.dev',
      accounts,
      gasPrice: 1000000000,
      timeout: 100000
    }
  },
  solidity: {
    compilers: [
      {
        version: '0.8.12',
        settings: {
          evmVersion: 'istanbul',
          optimizer: {
            enabled: true,
            runs: 200
          }
        }
      }
    ]
  },
  zksolc: {
    version: '0.1.0',
    compilerSource: 'docker',
    settings: {
      optimizer: {
        enabled: true
      },
      experimental: {
        dockerImage: 'matterlabs/zksolc'
      }
    }
  },
  zkSyncDeploy: {
    zkSyncNetwork: 'https://zksync2-testnet.zksync.dev',
    ethNetwork: 'goerli'
  }
}
