require("dotenv").config();
const hre = require("hardhat");
const { getCreationFee } = require("../test/utils/test-utils");

async function main() {
  const STAKE_CONTRACT_ADDRESS = "0x3460E2fD6cBC9aFB49BF970659AfDE2909cf3399";
  const REWARD_TOKEN_ADDRESS = "0xFf45161474C39cB00699070Dd49582e417b57a7E";
  const PLACEHOLDER_REWARD_AMOUNT = 3600n; // 3600 wei as minimum value
  const MIN_REWARD_DURATION = 3600; // 1 hour (minimum duration from contract)
  const TARGET_POOL_ID = 20; // We want to fill up to poolId = 20

  const accounts = await hre.ethers.getSigners();
  const deployer = accounts[0];
  console.log(`Operating from account: ${deployer.address}`);
  console.log(`Network: ${hre.network.name}`);

  // Connect to deployed Stake contract
  const Stake = await hre.ethers.getContractFactory("Stake");
  const stake = Stake.attach(STAKE_CONTRACT_ADDRESS);

  console.log(`Connected to Stake contract at: ${STAKE_CONTRACT_ADDRESS}`);

  // Check current pool count
  const currentPoolCount = await stake.poolCount();
  console.log(`Current pool count: ${currentPoolCount}`);

  // poolCount is 1-indexed, poolId is 0-indexed
  // If we want poolId up to TARGET_POOL_ID, we need poolCount to be TARGET_POOL_ID + 1
  if (currentPoolCount > TARGET_POOL_ID + 1) {
    console.log(
      `Pool count already at or above target (${
        TARGET_POOL_ID + 1
      }). No pools to create.`
    );
    return;
  }

  const poolsToCreate = TARGET_POOL_ID + 1 - Number(currentPoolCount);
  console.log(
    `Need to create ${poolsToCreate} pools to reach poolId ${TARGET_POOL_ID} (poolCount ${
      TARGET_POOL_ID + 1
    })`
  );

  // Get current creation fee for restoration later
  const originalCreationFee = await stake.creationFee();
  const normalCreationFee = getCreationFee(hre.network.name) * 5n; // creationFee x 5 = ~$10
  console.log(`Current creation fee: ${originalCreationFee}`);
  console.log(`Normal creation fee should be: ${normalCreationFee}`);

  // Connect to reward token to approve transfers
  const rewardToken = await hre.ethers.getContractAt(
    "IERC20",
    REWARD_TOKEN_ADDRESS
  );

  try {
    // Step 1: Set creation fee to 0
    console.log("\n=== Step 1: Setting creation fee to 0 ===");
    if (originalCreationFee > 0n) {
      const setFeeToZeroTx = await stake.updateCreationFee(0);
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
      STAKE_CONTRACT_ADDRESS,
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

      const createPoolTx = await stake.createPool(
        REWARD_TOKEN_ADDRESS, // stakingToken (using reward token as staking token for placeholder)
        true, // isStakingTokenERC20
        REWARD_TOKEN_ADDRESS, // rewardToken
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
    const restoreFeeTx = await stake.updateCreationFee(normalCreationFee);
    await restoreFeeTx.wait();
    console.log("✓ Creation fee restored");

    // Final verification
    const finalPoolCount = await stake.poolCount();
    console.log(`\n=== Final Status ===`);
    console.log(`✓ Final pool count: ${finalPoolCount}`);
    console.log(
      `✓ Successfully pre-filled pools up to poolId ${finalPoolCount - 1n}`
    );

    if (finalPoolCount >= TARGET_POOL_ID + 1) {
      console.log(
        `✅ SUCCESS: Pools are now pre-filled up to poolId ${TARGET_POOL_ID}`
      );
    } else {
      console.log(
        `⚠️  WARNING: Only reached poolId ${
          finalPoolCount - 1n
        }, target was ${TARGET_POOL_ID}`
      );
    }
  } catch (error) {
    console.error("❌ Error occurred:", error.message);

    // Try to restore creation fee even if something failed
    try {
      console.log("\n=== Emergency: Attempting to restore creation fee ===");
      const currentFee = await stake.creationFee();
      if (currentFee === 0n) {
        const restoreFeeTx = await stake.updateCreationFee(normalCreationFee);
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
npx hardhat compile && npx hardhat run --network base scripts/prefill-staking-poos.js
*/
