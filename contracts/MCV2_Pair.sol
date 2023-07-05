// SPDX-License-Identifier: BSD-3-Clause

pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
// import "./MCV2_FeeCollector.sol";
import "./MCV2_Token.sol";

/**
* @title MintClubV2 Pair
* Base - Child token pair contract that calculates the core logic for token bonding curve
*/
contract MCV2_Pair is MCV2_FeeCollector {
    error MCV2_Pair__InvalidCurrentSupply();
    error MCV2_Pair__ExceedMaxSupply();
    error MCV2_Pair__InvalidChildAmount();

    address public factory; // MintClubV2 Factory
    address public creator; // Token creator
    address public baseToken; // Base (mother) token
    address public childToken; // Child token derived from the base token bonds
    uint128 public maxSupply;
    // 160 * 4 + 128 = 256 * 3
    uint8 public creatorFeeRate;
    // 248 left

    uint256 public reserveBalance; // reserve balance of base token

    // Use uint128 to save storage cost & prevent integer overflow when calculating range * price
    struct BondStep {
        uint128 rangeTo;
        uint128 price; // multiplied by 10**18 for decimals
    }
    BondStep[] public bondSteps;

    event Buy(address indexed buyer, uint256 baseAmountDeposited, uint256 childAmountMinted);
    event Sell(address indexed seller, uint256 childAmountBurned, uint256 baseAmountRefunded);

    constructor() {
      factory = msg.sender;
    }

    // MARK: - Utility functions for Bonding Curve

    function _getCurrentStep(uint256 currentSupply) private view returns (uint256) {
        for(uint256 i = 0; i < bondSteps.length; i++) {
            if (currentSupply <= bondSteps[i].rangeTo) {
                return i;
            }
        }
        revert MCV2_Pair__InvalidCurrentSupply();
    }

    function currentPrice() external view returns (uint256) {
        uint256 i = _getCurrentStep(MCV2_Token(childToken).totalSupply());

        return bondSteps[i].price;
    }

    // MARK: - Buy

    // Returns token amount to be minted with given base amount
    function getTokensForBaseAmount(uint256 baseAmount) external view returns (uint256) {
        return getTokensForReserve(getAmountAfterFees(baseAmount));
    }

    function _getTokensForReserve(uint256 baseAmount) private view returns (uint256) {
        uint256 currentSupply = MCV2_Token(childToken).totalSupply();
        uint256 currentStep = _getCurrentStep(currentSupply);

        uint256 newSupply = currentSupply;
        uint256 buyLeft = baseAmount;
        for (uint256 i = currentStep; i < bondSteps.length; i++) {
            uint256 supplyLeft = bondSteps[i].rangeTo - newSupply;
            uint256 reserveLeft = supplyLeft * bondSteps[i].price / 1e18;

            if (reserveLeft < buyLeft) {
                buyLeft -= reserveLeft;
                newSupply += supplyLeft;
            } else {
                newSupply += 1e18 * buyLeft / bondSteps[i].price; // 1e18 for decimal adjustment on steps[i].price
                buyLeft = 0;
                break;
            }
        }

        if (buyLeft != 0 || newSupply > bond.maxSupply) revert MCV2_Pair__ExceedMaxSupply();

        return (newSupply - currentSupply);
    }

    function buy(uint256 baseAmount, uint256 childAmount, address receiver) public {
        (uint256 creatorFee, uint256 protocolFee) = getFees(baseAmount, creatorFeeRate);
        uint256 reserveAmount = baseAmount - creatorFee - protocolFee;

        uint256 tokensToMint = _getTokensForReserve(tokenAddress, reserveAmount);
        if (childAmount != tokensToMint) revert MCV2_Pair__InvalidChildAmount();

        // Transfer reserve tokens
        IERC20 base = IERC20(baseToken);
        if(!base.transferFrom(receiver, address(this), baseAmount)) revert MCV2_Pair__ReserveTokenTransferFailed();

        // Take fees
        reserveBalance += reserveAmount;
        addFee(creator, creatorFee);
        addFee(protocolBeneficiary, protocolFee);

        // Mint child tokens to the buyer
        MCV2_Token(childToken).mintByBond(receiver, tokensToMint);

        emit Buy(receiver, baseAmount, tokensToMint);
    }

    // TODO: External functions with slippages


    function buyWithSetReserveAmount(address tokenAddress, uint256 reserveAmount, uint256 minTokens) public {
        uint256 tokensToMint = getTokensForReserve(tokenAddress, reserveAmount);
        if (tokensToMint < minTokens) revert MCV2_Bond__SlippageLimitExceeded();

        _buy(tokenAddress, _msgSender(), reserveAmount, tokensToMint);
    }

    function buyWithSetTokenAmount(address tokenAddress, uint256 tokensToMint, uint256 maxReserve) public {
        uint256 reserveRequired = getReserveForTokens(tokenAddress, tokensToMint);
        if (reserveRequired > maxReserve) revert MCV2_Bond__SlippageLimitExceeded();

        _buy(tokenAddress, _msgSender(), reserveRequired, tokensToMint);
    }











    // MARK: - Sell

    // Returns reserve amount to refund with given token amount
    function getRefundForTokens(address tokenAddress, uint256 tokensToSell) public view _checkBondExists(tokenAddress) returns (uint256) {
        Bond storage bond = tokenBond[tokenAddress];
        uint256 currentSupply = MCV2_Token(tokenAddress).totalSupply();

        if (tokensToSell > currentSupply) revert MCV2_Pair__InvalidTokenAmount();

        uint256 currentStep = getCurrentStep(tokenAddress, currentSupply);

        uint256 reserveAmount = 0;
        uint256 tokensLeft = tokensToSell;
        for (uint256 i = currentStep; i >= 0 && tokensLeft > 0; i--) {
            uint256 supplyLeft = (i == 0) ? currentSupply : currentSupply - bond.steps[i-1].rangeTo;

            if (supplyLeft < tokensLeft) {
                reserveAmount += supplyLeft * bond.steps[i].price / 1e18;
                tokensLeft -= supplyLeft;
            } else {
                reserveAmount += tokensLeft * bond.steps[i].price / 1e18;
                tokensLeft = 0;
            }
        }

        assert(tokensLeft == 0); // Cannot be greater than 0 because of the InvalidTokenAmount check above

        return getAmountAfterFees(reserveAmount, bond.creatorFee);
    }

    // Returns tokens required to get given refund amount
    function getTokensForRefund(address tokenAddress, uint256 refundAmount) public view _checkBondExists(tokenAddress) returns (uint256) {
        Bond storage bond = tokenBond[tokenAddress];

        uint256 currentSupply = MCV2_Token(tokenAddress).totalSupply();
        uint256 currentStep = getCurrentStep(tokenAddress, currentSupply);

        uint256 newSupply = currentSupply;
        uint256 sellAmount = getAmountAfterFees(refundAmount, bond.creatorFee);
        for (uint256 i = currentStep; i >= 0; i--) {
            uint256 supplyLeft = newSupply - (i == 0 ? 0 : bond.steps[i - 1].rangeTo);
            uint256 reserveRequired = supplyLeft * bond.steps[i].price / 1e18;

            if (reserveRequired <= sellAmount) {
                sellAmount -= reserveRequired;
                newSupply -= supplyLeft;
            } else {
                newSupply -= 1e18 * sellAmount / bond.steps[i].price;
                sellAmount = 0;
                break;
            }
        }

        if (sellAmount != 0) revert MCV2_Pair__InvalidRefundAmount();

        return (currentSupply - newSupply);
    }

    // Internal function for the rest of the sell logic after all calculations are done
    function _sell(address tokenAddress, address receiver, uint256 tokensToSell, uint256 refundAmount) private {
        Bond storage bond = tokenBond[tokenAddress];

        // Burn tokens from the seller
        MCV2_Token(tokenAddress).burnByBond(receiver, tokensToSell);

        // TODO: Is `getFeesFromAfterAmount` a double calculation?
        (uint256 creatorFee, uint256 protocolFee) = getFeesFromAfterAmount(refundAmount, bond.creatorFee);
        bond.reserveBalance -= (refundAmount + creatorFee + protocolFee);
        addFee(tokenAddress, bond.creator, creatorFee);
        addFee(tokenAddress, protocolBeneficiary, protocolFee);

        // Transfer reserve tokens to the seller
        IERC20 reserveToken = IERC20(bond.reserveToken);
        if(!reserveToken.transfer(receiver, refundAmount)) revert MCV2_Pair__ReserveTokenTransferFailed();

        emit Sell(tokenAddress, receiver, tokensToSell, bond.reserveToken, refundAmount);
    }

    function sellWithSetTokenAmount(address tokenAddress, uint256 tokensToSell, uint256 minReserve) public {
        uint256 refundAmount = getRefundForTokens(tokenAddress, tokensToSell);
        if (refundAmount < minReserve) revert MCV2_Pair__SlippageLimitExceeded();

        _sell(tokenAddress, _msgSender(), tokensToSell, refundAmount);
    }

    function sellWithSetRefundAmount(address tokenAddress, uint256 refundAmount, uint256 maxTokens) public {
        uint256 tokensToSell = getTokensForRefund(tokenAddress, refundAmount);
        if (tokensToSell > maxTokens) revert MCV2_Pair__SlippageLimitExceeded();

        _sell(tokenAddress, _msgSender(), tokensToSell, refundAmount);
    }
}
