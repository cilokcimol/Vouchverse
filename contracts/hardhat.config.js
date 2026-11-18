require('@nomicfoundation/hardhat-ethers')
require('@nomicfoundation/hardhat-chai-matchers')

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  networks: { hardhat: { accounts: { count: 50 } }, localhost: { url: 'http://127.0.0.1:8545' } },
  solidity: {
    version: '0.8.28',
    settings: { optimizer: { enabled: true, runs: 500 }, viaIR: true, evmVersion: 'cancun' },
  },
}

if (process.env.FORK) {
  module.exports.networks = { hardhat: { forking: { url: 'https://bsc-rpc.publicnode.com' }, chainId: 56 } }
}
