require("dotenv").config();
const hre = require("hardhat");
const { getCreationFee } = require("../test/utils/test-utils");

async function main() {
  // Configuration for Base and Polygon chains
  const configs = {
    8453: {
      // Base
      STAKE_OLD: "0x3460E2fD6cBC9aFB49BF970659AfDE2909cf3399", // V1.1
      STAKE_NEW: "0x9Ab05EcA10d087f23a1B22A44A714cdbBA76E802", // V1.2
      REWARD_TOKEN: "0xFf45161474C39cB00699070Dd49582e417b57a7E", // MT on Base
    },
    137: {
      // Polygon
      STAKE_OLD: "0xF187645D1C5AE70C3ddCDeE6D746E5A7619a2A65", // V1.2
      STAKE_NEW: "0x95BDA90196c4e737933360F4639c46Ace657AAb7", // Same as old for now
      REWARD_TOKEN: "0x6DF5e5692247A513ab74cB45AE8b0636A43b218E", // MOON on Polygon
    },
  };

  const PLACEHOLDER_REWARD_AMOUNT = 3600n; // 3600 wei as minimum value
  const MIN_REWARD_DURATION = 3600; // 1 hour (minimum duration from contract)

  const accounts = await hre.ethers.getSigners();
  const deployer = accounts[0];
  console.log(`Operating from account: ${deployer.address}`);
  console.log(`Network: ${hre.network.name}`);

  // Get network chain ID
  const chainId = hre.network.config.chainId;
  console.log(`Chain ID: ${chainId}`);

  // Check if current network is supported
  if (!configs[chainId]) {
    console.error(
      `❌ Unsupported network. Only Base (8453) and Polygon (137) are supported.`
    );
    console.error(`Current chain ID: ${chainId}`);
    return;
  }

  const config = configs[chainId];
  console.log(`Using config:`, config);

  // Connect to deployed Stake contracts
  const Stake = await hre.ethers.getContractFactory("Stake");
  const stakeOld = Stake.attach(config.STAKE_OLD);
  const stakeNew = Stake.attach(config.STAKE_NEW);

  console.log(`Connected to old Stake contract at: ${config.STAKE_OLD}`);
  console.log(`Connected to new Stake contract at: ${config.STAKE_NEW}`);

  // Get target pool count from old contract
  const targetPoolCount = await stakeOld.poolCount();
  console.log(`Target pool count from old contract: ${targetPoolCount}`);

  // Check current pool count in new contract
  const currentPoolCount = await stakeNew.poolCount();
  console.log(`Current pool count in new contract: ${currentPoolCount}`);

  // poolCount is 1-indexed, poolId is 0-indexed
  if (currentPoolCount >= targetPoolCount) {
    console.log(
      `✅ New contract already has sufficient pools (${currentPoolCount} >= ${targetPoolCount}). No pools to create.`
    );
    return;
  }

  const poolsToCreate = Number(targetPoolCount) - Number(currentPoolCount);
  console.log(
    `Need to create ${poolsToCreate} pools to match old contract (from poolCount ${currentPoolCount} to ${targetPoolCount})`
  );

  // Get current creation fee for restoration later
  const originalCreationFee = await stakeNew.creationFee();
  const normalCreationFee = getCreationFee(hre.network.name) * 5n; // creationFee x 5 = ~$10
  console.log(`Current creation fee: ${originalCreationFee}`);
  console.log(`Normal creation fee should be: ${normalCreationFee}`);

  // Connect to reward token to approve transfers
  const rewardToken = await hre.ethers.getContractAt(
    "IERC20",
    config.REWARD_TOKEN
  );

  try {
    // Step 1: Set creation fee to 0
    console.log("\n=== Step 1: Setting creation fee to 0 ===");
    if (originalCreationFee > 0n) {
      const setFeeToZeroTx = await stakeNew.updateCreationFee(0);
      await setFeeToZeroTx.wait();
      console.log("✓ Creation fee set to 0");
    } else {
      console.log("✓ Creation fee already 0");
    }

    // Step 2: Approve reward tokens for all pools
    const totalRewardNeeded = PLACEHOLDER_REWARD_AMOUNT * BigInt(poolsToCreate);
    console.log(
      `\n=== Step 2: Approving ${totalRewardNeeded} reward tokens ===`
    );

    const approveTx = await rewardToken.approve(
      config.STAKE_NEW,
      totalRewardNeeded
    );
    await approveTx.wait();
    console.log("✓ Reward tokens approved");

    // Step 3: Create placeholder pools
    console.log(
      `\n=== Step 3: Creating ${poolsToCreate} placeholder pools ===`
    );

    for (let i = 0; i < poolsToCreate; i++) {
      // poolId will be the current poolCount value (0-indexed)
      const expectedPoolId = Number(currentPoolCount) + i;
      console.log(
        `Creating pool with poolId ${expectedPoolId} (${
          i + 1
        }/${poolsToCreate})...`
      );

      const createPoolTx = await stakeNew.createPool(
        config.REWARD_TOKEN, // stakingToken (using reward token as staking token for placeholder)
        true, // isStakingTokenERC20
        config.REWARD_TOKEN, // rewardToken
        PLACEHOLDER_REWARD_AMOUNT, // rewardAmount (3600 wei)
        0, // rewardStartsAt (0 = start immediately on first stake)
        MIN_REWARD_DURATION // rewardDuration (1 hour minimum)
      );

      await createPoolTx.wait();
      console.log(`✓ Created placeholder pool with poolId ${expectedPoolId}`);
    }

    // Step 4: Restore normal creation fee
    console.log(
      `\n=== Step 4: Restoring creation fee to ${normalCreationFee} ===`
    );
    const restoreFeeTx = await stakeNew.updateCreationFee(normalCreationFee);
    await restoreFeeTx.wait();
    console.log("✓ Creation fee restored");

    // Final verification
    const finalPoolCount = await stakeNew.poolCount();
    console.log(`\n=== Final Status ===`);
    console.log(`✓ Final pool count in new contract: ${finalPoolCount}`);
    console.log(`✓ Target pool count from old contract: ${targetPoolCount}`);
    console.log(
      `✓ Successfully pre-filled pools up to poolId ${finalPoolCount - 1n}`
    );

    if (finalPoolCount >= targetPoolCount) {
      console.log(
        `✅ SUCCESS: New contract pools (${finalPoolCount}) now match or exceed old contract pools (${targetPoolCount})`
      );
    } else {
      console.log(
        `⚠️  WARNING: Only reached poolCount ${finalPoolCount}, target was ${targetPoolCount}`
      );
    }
  } catch (error) {
    console.error("❌ Error occurred:", error.message);

    // Try to restore creation fee even if something failed
    try {
      console.log("\n=== Emergency: Attempting to restore creation fee ===");
      const currentFee = await stakeNew.creationFee();
      if (currentFee === 0n) {
        const restoreFeeTx = await stakeNew.updateCreationFee(
          normalCreationFee
        );
        await restoreFeeTx.wait();
        console.log("✓ Creation fee restored after error");
      }
    } catch (restoreError) {
      console.error("❌ Failed to restore creation fee:", restoreError.message);
    }

    throw error;
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

/* Deploy script
Usage examples:
npx hardhat compile && npx hardhat run --network base scripts/prefill-staking-poos.js
npx hardhat compile && npx hardhat run --network polygon scripts/prefill-staking-poos.js

This script will:
1. Get the poolCount from the old Stake contract
2. Fill the new Stake contract until it matches that poolCount
3. Use minimal REWARD_TOKEN amounts for placeholder pools
*/
