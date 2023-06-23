// SPDX-License-Identifier: BSD-3-Clause

pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./MCV2_FeeCollector.sol";
import "./MCV2_Token.sol";

/**
* @title MintClub Bond V2
* Providing liquidity for MintClubV2 tokens with a bonding curve.
*/
contract MCV2_Bond is MCV2_FeeCollector {
    error MCV2_Bond__InvalidTokenCreationParams();
    error MCV2_Bond__TokenNotFound();
    error MCV2_Bond__ExceedMaxSupply();
    error MCV2_Bond__SlippageLimitExceeded();
    error MCV2_Bond__ReserveTokenTransferFailed();
    error MCV2_Bond__InvalidTokenAmount();
    error MCV2_Bond__InvalidRefundAmount();
    error MCV2_Bond__InvalidCurrentSupply();

    uint256 private constant MAX_STEPS = 1000;

    /**
     *  ERC20 Token implementation contract
     *  We use "EIP-1167: Minimal Proxy Contract" in order to save gas cost for each token deployment
     *  REF: https://github.com/optionality/clone-factory
     */
    address public tokenImplementation;

    struct Bond {
        address creator;
        address reserveToken;
        uint128 maxSupply;
        uint8 creatorFee; // 56bit left
        uint256 reserveBalance;
        BondStep[] steps;
    }

    struct BondStep {
        uint128 rangeTo;
        uint128 price;
    }

    // Token => Bond
    mapping (address => Bond) public tokenBond;
    // Array of all created tokens
    address[] public tokens;

    event TokenCreated(address indexed tokenAddress, string name, string symbol);
    event Buy(address indexed tokenAddress, address indexed buyer, uint256 amountMinted, address indexed reserveToken, uint256 reserveAmount);
    event Sell(address indexed tokenAddress, address indexed seller, uint256 amountBurned, address indexed reserveToken, uint256 refundAmount);

    constructor(address tokenImplementation_, address protocolBeneficiary_) MCV2_FeeCollector(protocolBeneficiary_) {
        tokenImplementation = tokenImplementation_;
    }

    // MARK: - Factory

    /**
     * @dev Create a new token contract that maintains separate storage but delegates all function calls to tokenImplementation
     * Reference: https://github.com/optionality/clone-factory
     */
    function _createClone(address target) private returns (address result) {
        bytes20 targetBytes = bytes20(target);
        assembly {
            let clone := mload(0x40)
            mstore(clone, 0x3d602d80600a3d3981f3363d3d373d3d3d363d73000000000000000000000000)
            mstore(add(clone, 0x14), targetBytes)
            mstore(add(clone, 0x28), 0x5af43d82803e903d91602b57fd5bf30000000000000000000000000000000000)
            result := create(0, clone, 0x37)
        }
    }

    function createToken(
        string memory name,
        string memory symbol,
        address reserveToken,
        uint128 maxSupply,
        uint8 creatorFee,
        uint128[] calldata stepRanges,
        uint128[] calldata stepPrices
    ) external returns (address) {
        if (reserveToken == address(0)) revert MCV2_Bond__InvalidTokenCreationParams();
        if (maxSupply == 0) revert MCV2_Bond__InvalidTokenCreationParams();
        if (creatorFee > CREATOR_FEE_MAX) revert MCV2_Bond__InvalidTokenCreationParams();
        if (stepRanges.length == 0 || stepRanges.length > MAX_STEPS) revert MCV2_Bond__InvalidTokenCreationParams();
        if (stepRanges.length != stepPrices.length) revert MCV2_Bond__InvalidTokenCreationParams();

        address tokenAddress = _createClone(tokenImplementation);
        MCV2_Token newToken = MCV2_Token(tokenAddress);
        newToken.init(name, symbol);

        // NOTE: We don't need to check the existence of the token because the collision is almost impossible (one in 2^160)
        tokens.push(tokenAddress);

        // Set token bond data
        Bond storage bond = tokenBond[tokenAddress];
        bond.creator = _msgSender();
        bond.reserveToken = reserveToken;
        bond.maxSupply = maxSupply;
        bond.creatorFee = creatorFee;

        // Last value or the rangeTo must be the same as the maxSupply
        if (stepRanges[stepRanges.length - 1] != maxSupply) revert MCV2_Bond__InvalidTokenCreationParams();

        for (uint256 i = 0; i < stepRanges.length; i++) {
            if (stepRanges[i] == 0) revert MCV2_Bond__InvalidTokenCreationParams();

            // Ranges and prices must be strictly increasing
            if (i > 0) {
                if (stepRanges[i] <= stepRanges[i - 1]) revert MCV2_Bond__InvalidTokenCreationParams();
                if (stepPrices[i] <= stepPrices[i - 1]) revert MCV2_Bond__InvalidTokenCreationParams();
            }

            bond.steps.push(BondStep({
                rangeTo: stepRanges[i],
                price: stepPrices[i]
            }));
        }

        emit TokenCreated(tokenAddress, name, symbol);

        return tokenAddress;
    }

    function tokenCount() external view returns (uint256) {
        return tokens.length;
    }

    function exists(address tokenAddress) external view returns (bool) {
        return tokenBond[tokenAddress].maxSupply > 0;
    }

    function getSteps(address tokenAddress) external view returns (BondStep[] memory) {
        return tokenBond[tokenAddress].steps;
    }

    // MARK: - Utility functions for Bonding Curve

    modifier _checkBondExists(address tokenAddress) {
        if(tokenBond[tokenAddress].maxSupply == 0) revert MCV2_Bond__TokenNotFound();
        _;
    }

    function getCurrentStep(address tokenAddress, uint256 currentSupply) internal view returns (uint256) {
        Bond storage bond = tokenBond[tokenAddress];
        for(uint256 i = 0; i < bond.steps.length; i++) {
            if (currentSupply <= bond.steps[i].rangeTo) {
                return i;
            }
        }
        revert MCV2_Bond__InvalidCurrentSupply();
    }

    function currentPrice(address tokenAddress) external view _checkBondExists(tokenAddress) returns (uint256) {
        uint256 i = getCurrentStep(tokenAddress, MCV2_Token(tokenAddress).totalSupply());

        return tokenBond[tokenAddress].steps[i].price;
    }

    // MARK: - Buy

    // Returns token amount to be minted with given reserve amount
    function getTokensForReserve(address tokenAddress, uint256 reserveAmount) public view _checkBondExists(tokenAddress) returns (uint256) {
        Bond storage bond = tokenBond[tokenAddress];

        uint256 currentSupply = MCV2_Token(tokenAddress).totalSupply();
        uint256 currentStep = getCurrentStep(tokenAddress, currentSupply);

        uint256 newSupply = currentSupply;
        uint256 buyAmount = getAmountAfterFees(reserveAmount, bond.creatorFee);
        for (uint256 i = currentStep; i < bond.steps.length; i++) {
            uint256 supplyLeft = bond.steps[i].rangeTo - newSupply;
            uint256 reserveRequired = supplyLeft * bond.steps[i].price;

            if (reserveRequired < buyAmount) {
                buyAmount -= reserveRequired;
                newSupply += supplyLeft;
            } else {
                newSupply += buyAmount / bond.steps[i].price;
                buyAmount = 0;
                break;
            }
        }

        if (buyAmount != 0 || newSupply > bond.maxSupply) revert MCV2_Bond__ExceedMaxSupply();

        return (newSupply - currentSupply);
    }

    // Returns reserve amount required to mint tokens
    function getReserveForTokens(address tokenAddress, uint256 tokensToMint) public view _checkBondExists(tokenAddress) returns (uint256) {
        Bond storage bond = tokenBond[tokenAddress];
        uint256 currentSupply = MCV2_Token(tokenAddress).totalSupply();

        if (currentSupply + tokensToMint > bond.maxSupply) revert MCV2_Bond__ExceedMaxSupply();

        uint256 currentStep = getCurrentStep(tokenAddress, currentSupply);

        uint256 reserveAmount = 0;
        uint256 tokensLeft = tokensToMint;
        for (uint256 i = currentStep; i < bond.steps.length; i++) {
            uint256 supplyLeft = bond.steps[i].rangeTo - currentSupply;

            if(supplyLeft < tokensLeft) {
                reserveAmount += supplyLeft * bond.steps[i].price;
                tokensLeft -= supplyLeft;
            } else {
                reserveAmount += tokensLeft * bond.steps[i].price;
                tokensLeft = 0;
                break;
            }
        }

        assert(tokensLeft == 0); // Cannot be greater than 0 because of the ExceedMaxSupply check above

        return getAmountWithFees(reserveAmount, bond.creatorFee);
    }

    // Internal function for the rest of the buy logic after all calculations are done
    function _buy(address tokenAddress, uint256 reserveAmount, uint256 tokensToMint) private {
        Bond storage bond = tokenBond[tokenAddress];

        // Transfer reserve tokens
        IERC20 reserveToken = IERC20(bond.reserveToken);
        if(!reserveToken.transferFrom(_msgSender(), address(this), reserveAmount)) revert MCV2_Bond__ReserveTokenTransferFailed();

        // Mint reward tokens to the buyer
        MCV2_Token(tokenAddress).mintByBond(_msgSender(), tokensToMint);

        (uint256 creatorFee, uint256 protocolFee) = getFees(reserveAmount, bond.creatorFee);
        bond.reserveBalance += (reserveAmount - creatorFee - protocolFee);
        addFee(tokenAddress, bond.creator, creatorFee);
        addFee(tokenAddress, protocolBeneficiary, protocolFee);

        emit Buy(tokenAddress, _msgSender(), tokensToMint, bond.reserveToken, reserveAmount);
    }

    function buyWithSetReserveAmount(address tokenAddress, uint256 reserveAmount, uint256 minTokens) public {
        uint256 tokensToMint = getTokensForReserve(tokenAddress, reserveAmount);
        if (tokensToMint < minTokens) revert MCV2_Bond__SlippageLimitExceeded();

        _buy(tokenAddress, reserveAmount, tokensToMint);
    }

    function buyWithSetTokenAmount(address tokenAddress, uint256 tokensToMint, uint256 maxReserve) public {
        uint256 reserveRequired = getReserveForTokens(tokenAddress, tokensToMint);
        if (reserveRequired > maxReserve) revert MCV2_Bond__SlippageLimitExceeded();

        _buy(tokenAddress, reserveRequired, tokensToMint);
    }

    // MARK: - Sell

    // Returns reserve amount to refund with given token amount
    function getRefundForTokens(address tokenAddress, uint256 tokensToSell) public view _checkBondExists(tokenAddress) returns (uint256) {
        Bond storage bond = tokenBond[tokenAddress];
        uint256 currentSupply = MCV2_Token(tokenAddress).totalSupply();

        if (tokensToSell > currentSupply) revert MCV2_Bond__InvalidTokenAmount();

        uint256 currentStep = getCurrentStep(tokenAddress, currentSupply);

        uint256 reserveAmount = 0;
        uint256 tokensLeft = tokensToSell;
        for (uint256 i = currentStep; i >= 0 && tokensLeft > 0; i--) {
            uint256 supplyLeft = (i == 0) ? currentSupply : currentSupply - bond.steps[i-1].rangeTo;

            if (supplyLeft < tokensLeft) {
                reserveAmount += supplyLeft * bond.steps[i].price;
                tokensLeft -= supplyLeft;
            } else {
                reserveAmount += tokensLeft * bond.steps[i].price;
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
        for (int256 i = int256(currentStep); i >= 0; i--) {
            uint256 supplyLeft = newSupply - (i == 0 ? 0 : bond.steps[uint256(i - 1)].rangeTo);
            uint256 reserveRequired = supplyLeft * bond.steps[uint256(i)].price;

            if (reserveRequired <= sellAmount) {
                sellAmount -= reserveRequired;
                newSupply -= supplyLeft;
            } else {
                newSupply -= sellAmount / bond.steps[uint256(i)].price;
                sellAmount = 0;
                break;
            }
        }

        if (sellAmount != 0) revert MCV2_Bond__InvalidRefundAmount();

        return (currentSupply - newSupply);
    }

    // Internal function for the rest of the sell logic after all calculations are done
    function _sell(address tokenAddress, uint256 tokensToSell, uint256 refundAmount) private {
        Bond storage bond = tokenBond[tokenAddress];

        // Burn tokens from the seller
        MCV2_Token(tokenAddress).burnByBond(_msgSender(), tokensToSell);

        // Transfer reserve tokens to the seller
        IERC20 reserveToken = IERC20(bond.reserveToken);
        if(!reserveToken.transfer(_msgSender(), refundAmount)) revert MCV2_Bond__ReserveTokenTransferFailed();

        (uint256 creatorFee, uint256 protocolFee) = getFees(refundAmount, bond.creatorFee);
        bond.reserveBalance -= (refundAmount + creatorFee + protocolFee);
        addFee(tokenAddress, bond.creator, creatorFee);
        addFee(tokenAddress, protocolBeneficiary, protocolFee);

        emit Sell(tokenAddress, _msgSender(), tokensToSell, bond.reserveToken, refundAmount);
    }

    function sellWithSetTokenAmount(address tokenAddress, uint256 tokensToSell, uint256 minReserve) public {
        uint256 refundAmount = getRefundForTokens(tokenAddress, tokensToSell);
        if (refundAmount < minReserve) revert MCV2_Bond__SlippageLimitExceeded();

        _sell(tokenAddress, tokensToSell, refundAmount);
    }

    function sellWithSetRefundAmount(address tokenAddress, uint256 refundAmount, uint256 maxTokens) public {
        uint256 tokensToSell = getTokensForRefund(tokenAddress, refundAmount);
        if (tokensToSell > maxTokens) revert MCV2_Bond__SlippageLimitExceeded();

        _sell(tokenAddress, tokensToSell, refundAmount);
    }
}
