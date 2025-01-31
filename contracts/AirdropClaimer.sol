// SPDX-License-Identifier: BUSL-1.1
pragma solidity =0.8.20;

import {IMerkleDistributor} from "./interfaces/IMerkleDistributor.sol";

/**
 * @title AirdropClaimer
 * @notice A helper contract for enumerating and batch-claiming public airdrops
 *         from the MerkleDistributor.
 */
contract AirdropClaimer {
    error AirdropClaimer__InvalidRange();
    error AirdropClaimer__NoDistributions();

    IMerkleDistributor public immutable merkleDistributor;

    constructor(address _merkleDistributor) {
        merkleDistributor = IMerkleDistributor(_merkleDistributor);
    }

    /**
     * @notice Attempts to `claim()` all public airdrops from the last `limitCount`
     *         distributions in the MerkleDistributor. Uses `try/catch` so that if one
     *         distribution reverts (not yet started, ended, refunded, or already claimed),
     *         we simply skip it instead of reverting the entire transaction.
     *
     * @dev For public airdrops (merkleRoot == 0), we can pass an empty merkleProof.
     *
     * @param startId The start distribution ID to attempt claiming.
     * @param endId The end distribution ID to attempt claiming.
     */
    function claimAll(uint256 startId, uint256 endId) external {
        IMerkleDistributor md = merkleDistributor;
        uint256 total = md.distributionCount();
        if (total == 0) revert AirdropClaimer__NoDistributions();

        // Bound endId to last valid ID (total - 1)
        if (endId >= total) {
            endId = total - 1;
        }
        if (startId > endId) revert AirdropClaimer__InvalidRange();

        // Attempt claims for the specified range (inclusive)
        for (uint256 i = startId; i <= endId; ) {
            // We do no preliminary checks here. The MerkleDistributor will revert if:
            //   - distribution isn't public (merkleRoot != 0),
            //   - distribution not started or already ended/refunded,
            //   - user already claimed, or
            //   - there's no amount left.
            // Using try/catch avoids reverting the entire loop.
            try md.claim(i, new bytes32[](0)) {
                // If successful, great; otherwise skip
            } catch {
                // Skip on revert
            }
            unchecked {
                ++i;
            }
        }
    }
}
