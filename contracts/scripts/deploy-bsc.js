// Deploys Vouchverse to BNB Chain mainnet from the deployer key file. Prints only public data.
const { ethers } = require('ethers')
const fs = require('fs')
const art = require('../artifacts/contracts/Vouchverse.sol/Vouchverse.json')
const AGENT_ID = '0x60b9262456de011f7d15a54cdd8c48baaa8b022f'

async function main() {
  const provider = new ethers.JsonRpcProvider('https://bsc-rpc.publicnode.com', 56, { staticNetwork: true })
  const key = JSON.parse(fs.readFileSync('/root/.kith/deployer.json', 'utf8')).privateKey
  const wallet = new ethers.Wallet(key, provider)
  const factory = new ethers.ContractFactory(art.abi, art.bytecode, wallet)
  const tx = await factory.getDeployTransaction(AGENT_ID)
  const gas = await provider.estimateGas({ ...tx, from: wallet.address })
  const fee = await provider.getFeeData()
  console.log('estimated gas', gas.toString(), 'cost BNB', ethers.formatEther(gas * fee.gasPrice))
  const c = await factory.deploy(AGENT_ID, { gasLimit: (gas * 12n) / 10n, gasPrice: fee.gasPrice })
  const r = await c.deploymentTransaction().wait()
  const address = await c.getAddress()
  const out = { address, block: r.blockNumber, tx: r.hash, deployer: wallet.address, agentId: AGENT_ID, chainId: 56, at: new Date().toISOString() }
  fs.writeFileSync(__dirname + '/../deployments/bsc.json', JSON.stringify(out, null, 2))
  console.log(JSON.stringify(out))
}
main().catch(e => { console.error(e.shortMessage || e.message); process.exit(1) })
