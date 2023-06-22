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

    uint256 private constant CREATOR_FEE_MAX = 100; // 1.0%
    uint256 private constant MAX_FEE_BASE = 10000;
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

    function createToken(string memory name, string memory symbol, address reserveToken, uint128 maxSupply, uint8 creatorFee, BondStep[] steps) external returns (address) {
        if (reserveToken == address(0)) revert MCV2_Bond__InvalidTokenCreationParams();
        if (maxSupply == 0) revert MCV2_Bond__InvalidTokenCreationParams();
        if (creatorFee > CREATOR_FEE_MAX) revert MCV2_Bond__InvalidTokenCreationParams();
        if (stpes.length == 0 || steps.length > MAX_STEPS) revert MCV2_Bond__InvalidTokenCreationParams();

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
        bond.steps = steps;

        emit TokenCreated(tokenAddress, name, symbol);

        return tokenAddress;
    }

    function tokenCount() external view returns (uint256) {
        return tokens.length;
    }

    function exists(address tokenAddress) external view returns (bool) {
        return tokenBond[tokenAddress].maxSupply > 0;
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
    }

    function currentPrice(address tokenAddress) external view _checkBondExists(tokenAddress) returns (uint256) {
        uint256 i = getCurrentStep(tokenAddress, MCV2_Token(tokenAddress).totalSupply());

        return tokenBond[tokenAddress].steps[i].price;
    }

    // MARK: - Buy

    // Returns (tokens to be minted, creator fee, protocol fee)
    function getTokensForReserve(address tokenAddress, uint256 reserveAmount) public view _checkBondExists(tokenAddress) returns (uint256, uint256, uint256) {
        Bond storage bond = tokenBond[tokenAddress];
        uint256 creatorFee = reserveAmount * bond.creatorFee / MAX_FEE_BASE;
        uint256 protocolFee = reserveAmount * PROTOCOL_FEE / MAX_FEE_BASE;

        uint256 currentSupply = MCV2_Token(tokenAddress).totalSupply();
        uint256 currentStep = getCurrentStep(tokenAddress, currentSupply);

        uint256 newSupply = currentSupply;
        uint256 buyAmount = reserveAmount - creatorFee - protocolFee;
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

        if (buyAmount !== 0 || newSupply > bond.maxSupply) revert MCV2_Bond__ExceedMaxSupply();

        return (newSupply - currentSupply, creatorFee, protocolFee);
    }

    // Returns (reserve amount required, creator fee, protocol fee)
    function getReserveForTokens(address tokenAddress, uint256 tokensToMint) public view _checkBondExists(tokenAddress) returns (uint256, uint256, uint256) {
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

        uint256 creatorFee = reserveAmount * bond.creatorFee / MAX_FEE_BASE;
        uint256 protocolFee = reserveAmount * PROTOCOL_FEE / MAX_FEE_BASE;

        return (reserveAmount + creatorFee + protocolFee, creatorFee, taxAmount);
    }

    // Internal function for the rest of the buy logic after all calculations are done
    function _buy(address tokenAddress, uint256 reserveAmount, uint256 tokensToMint, uint256 creatorFee, uint256 protocolFee) private {
        Bond storage bond = tokenBond[tokenAddress];

        // Transfer reserve tokens
        IERC20 reserveToken = IERC20(bond.reserveToken);
        if(!reserveToken.transferFrom(_msgSender(), address(this), reserveAmount)) revert MCV2_Bond__ReserveTokenTransferFailed();

        // Mint reward tokens to the buyer
        MCV2_Token(tokenAddress).mintByBond(_msgSender(), tokensToMint);

        bond.reserveBalance += (reserveAmount - creatorFee - protocolFee);
        addFee(tokenAddress, bond.creator, creatorFee);
        addFee(tokenAddress, protocolBeneficiary, protocolFee);

        emit Buy(tokenAddress, _msgSender(), tokensToMint, bond.reserveToken, reserveAmount);
    }

    function buyWithSetReserveAmount(address tokenAddress, uint256 reserveAmount, uint256 minTokens) public {
        (uint256 tokensToMint, uint256 creatorFee, uint256 protocolFee) = getTokensForReserve(tokenAddress, reserveAmount);
        if (tokensToMint < minTokens) revert MCV2_Bond__SlippageLimitExceeded();

        _buy(tokenAddress, reserveAmount, tokensToMint, creatorFee, protocolFee);
    }

    function buyWithSetTokenAmount(address tokenAddress, uint256 tokensToMint, uint256 maxReserve) public {
        (uint256 reserveRequired, uint256 creatorFee, uint256 protocolFee) = getReserveForTokens(tokenAddress, tokensToMint);
        if (reserveRequired > maxReserve) revert MCV2_Bond__SlippageLimitExceeded();

        _buy(tokenAddress, reserveRequired, tokensToMint, creatorFee, protocolFee);
    }

    // MARK: - Sell

    // Returns (reserve amount to refund, creator fee, protocol fee)
    function getRefundForTokens(address tokenAddress, uint256 tokensToSell) public view _checkBondExists(tokenAddress) returns (uint256, uint256, uint256) {
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

        uint256 creatorFee = reserveAmount * bond.creatorFee / MAX_FEE_BASE;
        uint256 protocolFee = reserveAmount * PROTOCOL_FEE / MAX_FEE_BASE;

        return (reserveAmount - creatorFee - protocolFee, creatorFee, protocolFee);
    }

    // Returns (tokens required, creator fee, protocol fee)
    function getTokensForRefund(address tokenAddress, uint256 refundAmount) public view _checkBondExists(tokenAddress) returns (uint256, uint256, uint256) {
        Bond storage bond = tokenBond[tokenAddress];
        uint256 creatorFee = refundAmount * bond.creatorFee / MAX_FEE_BASE;
        uint256 protocolFee = refundAmount * PROTOCOL_FEE / MAX_FEE_BASE;

        uint256 currentSupply = MCV2_Token(tokenAddress).totalSupply();
        uint256 currentStep = getCurrentStep(tokenAddress, currentSupply);

        uint256 newSupply = currentSupply;
        uint256 sellAmount = refundAmount - creatorFee - protocolFee;
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

        return (currentSupply - newSupply, creatorFee, protocolFee);
    }

    // Internal function for the rest of the sell logic after all calculations are done
    function _sell(address tokenAddress, uint256 tokensToSell, uint256 refundAmount) private {
        Bond storage bond = tokenBond[tokenAddress];

        // Burn tokens from the seller
        MCV2_Token(tokenAddress).burnByBond(_msgSender(), tokensToSell);

        // Transfer reserve tokens to the seller
        IERC20 reserveToken = IERC20(bond.reserveToken);
        if(!reserveToken.transfer(_msgSender(), refundAmount)) revert MCV2_Bond__ReserveTokenTransferFailed();

        bond.reserveBalance -= (refundAmount + creatorFee + protocolFee);
        addFee(tokenAddress, bond.creator, creatorFee);
        addFee(tokenAddress, protocolBeneficiary, protocolFee);

        emit Sell(tokenAddress, _msgSender(), tokensToSell, bond.reserveToken, refundAmount);
    }

    function sellWithSetTokenAmount(address tokenAddress, uint256 tokensToSell, uint256 minReserve) public {
        (uint256 refundAmount, uint256 creatorFee, uint256 protocolFee) = getRefundForTokens(tokenAddress, tokensToSell);
        if (refundAmount < minReserve) revert MCV2_Bond__SlippageLimitExceeded();

        _sell(tokenAddress, tokensToSell, refundAmount);
    }

    function sellWithSetRefundAmount(address tokenAddress, uint256 refundAmount, uint256 maxTokens) public {
        (uint256 tokensToSell, uint256 creatorFee, uint256 protocolFee) = getTokensForRefund(tokenAddress, refundAmount);
        if (tokensToSell > maxTokens) revert MCV2_Bond__SlippageLimitExceeded();

        _sell(tokenAddress, tokensToSell, refundAmount);
    }
}
