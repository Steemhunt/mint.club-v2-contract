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

    event TokenCreated(address tokenAddress, string name, string symbol);
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

    // Returns (token count to be minted, creator fee, protocol fee)
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


    function buy(address tokenAddress, uint256 reserveAmount, uint256 minTokens) public {
        (uint256 amountMinted, uint256 creatorFee, uint256 protocolFee) = getTokensForReserve(tokenAddress, reserveAmount);
        if (amountMinted < minTokens) revert MCV2_Bond__SlippageLimitExceeded();

        Bond storage bond = tokenBond[tokenAddress];

        // Transfer reserve tokens
        MCV2_Token reserveToken = MCV2_Token(tokenAddress);
        if(!reserveToken.transferFrom(_msgSender(), address(this), reserveAmount)) revert MCV2_Bond__ReserveTokenTransferFailed();

        // Mint reward tokens to the buyer
        MCV2_Token(tokenAddress).mint(_msgSender(), amountMinted);

        bond.reserveBalance += (reserveAmount - creatorFee - protocolFee);
        addFee(tokenAddress, bond.creator, creatorFee);
        addFee(tokenAddress, protocolBeneficiary, protocolFee);

        Buy(address indexed tokenAddress, address indexed buyer, uint256 amountMinted, address indexed reserveToken, uint256 reserveAmount);

        emit Buy(tokenAddress, _msgSender(), amountMinted, bond.reserveToken, reserveAmount);
    }

    // TODO:






    /**
     * @dev Use the simplest bonding curve (y = x) as we can adjust total supply of reserve tokens to adjust slope
     * Price = SLOPE * totalSupply = totalSupply (where slope = 1)
     */
    function getMintReward(address tokenAddress, uint256 reserveAmount) public view _checkBondExists(tokenAddress) returns (uint256, uint256) {
        uint256 taxAmount = reserveAmount * BUY_TAX / MAX_TAX;
        uint256 newSupply = Math.floorSqrt(2 * 1e18 * ((reserveAmount - taxAmount) + reserveBalance[tokenAddress]));
        uint256 toMint = newSupply - MintClubToken(tokenAddress).totalSupply();

        require(newSupply <= maxSupply[tokenAddress], "EXCEEDED_MAX_SUPPLY");

        return (toMint, taxAmount);
    }

    function getBurnRefund(address tokenAddress, uint256 tokenAmount) public view _checkBondExists(tokenAddress) returns (uint256, uint256) {
        uint256 newTokenSupply = MintClubToken(tokenAddress).totalSupply() - tokenAmount;

        // Should be the same as: (1/2 * (totalSupply**2 - newTokenSupply**2);
        uint256 reserveAmount = reserveBalance[tokenAddress] - (newTokenSupply**2 / (2 * 1e18));
        uint256 taxAmount = reserveAmount * SELL_TAX / MAX_TAX;

        return (reserveAmount - taxAmount, taxAmount);
    }

    function sell(address tokenAddress, uint256 tokenAmount, uint256 minRefund, address beneficiary) public {
        (uint256 refundAmount, uint256 taxAmount) = getBurnRefund(tokenAddress, tokenAmount);
        require(refundAmount >= minRefund, "SLIPPAGE_LIMIT_EXCEEDED");

        // Burn token first
        MintClubToken(tokenAddress).burnFrom(_msgSender(), tokenAmount);

        // Refund reserve tokens to the seller
        reserveBalance[tokenAddress] -= (refundAmount + taxAmount);
        require(RESERVE_TOKEN.transfer(_msgSender(), refundAmount), "RESERVE_TOKEN_TRANSFER_FAILED");

        // Pay tax to the beneficiary / Send to the default beneficiary if not set (or abused)
        address actualBeneficiary = beneficiary;
        if (beneficiary == address(0) || beneficiary == _msgSender()) {
            actualBeneficiary = defaultBeneficiary;
        }
        RESERVE_TOKEN.transfer(actualBeneficiary, taxAmount);

        emit Sell(tokenAddress, _msgSender(), tokenAmount, refundAmount, actualBeneficiary, taxAmount);
    }
}
