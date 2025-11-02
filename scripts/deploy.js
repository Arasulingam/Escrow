const hre = require("hardhat");

async function main() {
  console.log("🚀 Deploying to Sepolia Testnet...");

  const EscrowContract = await hre.ethers.getContractFactory("EscrowPayment");
  
  console.log("⏳ Deploying contract...");
  const escrow = await EscrowContract.deploy();

  await escrow.waitForDeployment();

  const address = await escrow.getAddress();
  
  console.log("\n✅ SUCCESS!");
  console.log("📍 Contract Address:", address);
  console.log("🔍 Etherscan:", `https://sepolia.etherscan.io/address/${address}`);
  console.log("\n📝 Update your .env:");
  console.log(`REACT_APP_CONTRACT_ADDRESS=${address}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
