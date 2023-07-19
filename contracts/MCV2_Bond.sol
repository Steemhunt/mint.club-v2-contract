// SPDX-License-Identifier: BSD-3-Clause

pragma solidity ^0.8.20;

import "@openzeppelin/contracts/proxy/Clones.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./MCV2_FeeCollector.sol";
import "./MCV2_Token.sol";

/**
* @title MintClub Bond V2
* Providing liquidity for MintClubV2 tokens with a bonding curve.
*/
contract MCV2_Bond is MCV2_FeeCollector {
    error MCV2_Bond__InvalidTokenCreationParams();
    error MCV2_Bond__InvalidStepPrams(string reason);
    error MCV2_Bond__TokenSymbolAlreadyExists();
    error MCV2_Bond__TokenNotFound();
    error MCV2_Bond__ExceedMaxSupply();
    error MCV2_Bond__SlippageLimitExceeded();
    error MCV2_Bond__ReserveTokenTransferFailed();
    error MCV2_Bond__InvalidTokenAmount();
    error MCV2_Bond__ExceedTotalSupply();
    error MCV2_Bond__InvalidRefundAmount();
    error MCV2_Bond__InvalidCurrentSupply();
    error MCV2_Bond__InvalidReserveAmount();

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
        uint8 creatorFeeRate; // 56bit left
        uint256 reserveBalance;
        BondStep[] steps;
    }

    // Use uint128 to save storage cost & prevent integer overflow when calculating range * price
    struct BondStep {
        uint128 rangeTo;
        uint128 price; // multiplied by 10**18 for decimals
    }

    // Token => Bond
    mapping (address => Bond) public tokenBond;
    // Array of all created tokens
    address[] public tokens;

    event TokenCreated(address indexed tokenAddress, string name, string symbol);
    event Buy(address indexed tokenAddress, address indexed buyer, uint256 amountMinted, address indexed reserveToken, uint256 reserveAmount);
    event Sell(address indexed tokenAddress, address indexed seller, uint256 amountBurned, address indexed reserveToken, uint256 refundAmount);

    constructor(
        address tokenImplementation_,
        address protocolBeneficiary_,
        uint256 protocolFee_
    ) MCV2_FeeCollector(protocolBeneficiary_, protocolFee_) {
        tokenImplementation = tokenImplementation_;
    }

    // MARK: - Factory

    function createToken(
        string memory name,
        string memory symbol,
        address reserveToken,
        uint128 maxSupply,
        uint8 creatorFeeRate,
        uint128[] calldata stepRanges,
        uint128[] calldata stepPrices
    ) external returns (address) {
        if (reserveToken == address(0)) revert MCV2_Bond__InvalidTokenCreationParams();
        if (maxSupply == 0) revert MCV2_Bond__InvalidTokenCreationParams();
        if (creatorFeeRate > FEE_MAX) revert MCV2_Bond__InvalidTokenCreationParams();
        if (stepRanges.length == 0 || stepRanges.length > MAX_STEPS) revert MCV2_Bond__InvalidStepPrams('INVALID_LENGTH');
        if (stepRanges.length != stepPrices.length) revert MCV2_Bond__InvalidStepPrams('LENGTH_DO_NOT_MATCH');

        // Uniqueness of symbols on this network is guaranteed by the deterministic contract address
        bytes32 salt = keccak256(abi.encodePacked(address(this), symbol));

        // NOTE: This check might not be necessary as the clone would fail with an 'ERC1167: create2 failed'
        // error anyway, and the collision is nearly impossible (one in 2^160).
        // However, we retain this check to provide a clearer error message, albeit at the expense of an additional 811 gas cost.
        { // avoids stack too deep errors
            address predicted = Clones.predictDeterministicAddress(tokenImplementation, salt);
            if (tokenBond[predicted].maxSupply > 0) revert MCV2_Bond__TokenSymbolAlreadyExists();
        }

        address tokenAddress = Clones.cloneDeterministic(tokenImplementation, salt);
        MCV2_Token newToken = MCV2_Token(tokenAddress);
        newToken.init(name, symbol);
        tokens.push(tokenAddress);

        // Set token bond data
        Bond storage bond = tokenBond[tokenAddress];
        bond.creator = _msgSender();
        bond.reserveToken = reserveToken;
        bond.maxSupply = maxSupply;
        bond.creatorFeeRate = creatorFeeRate;

        // Last value or the rangeTo must be the same as the maxSupply
        if (stepRanges[stepRanges.length - 1] != maxSupply) revert MCV2_Bond__InvalidStepPrams('MAX_SUPPLY_MISMATCH');

        for (uint256 i = 0; i < stepRanges.length; i++) {
            if (stepRanges[i] == 0) revert MCV2_Bond__InvalidStepPrams('CANNOT_BE_ZERO');

            // Ranges and prices must be strictly increasing
            if (i > 0) {
                if (stepRanges[i] <= stepRanges[i - 1]) revert MCV2_Bond__InvalidStepPrams('DECREASING_RANGE');
                if (stepPrices[i] <= stepPrices[i - 1]) revert MCV2_Bond__InvalidStepPrams('DECREASING_PRICE');
            }

            bond.steps.push(BondStep({
                rangeTo: stepRanges[i],
                price: stepPrices[i]
            }));
        }

        emit TokenCreated(tokenAddress, name, symbol);

        // Send free tokens to the creator if exists
        if (stepPrices[0] == 0) {
            newToken.mintByBond(bond.creator, stepRanges[0]);
        }

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
    function getTokensForReserve(address tokenAddress, uint256 reserveAmount) public view _checkBondExists(tokenAddress)
        returns (uint256 tokensToMint, uint256 creatorFee, uint256 protocolFee)
    {
        if (reserveAmount == 0) revert MCV2_Bond__InvalidReserveAmount();

        Bond storage bond = tokenBond[tokenAddress];

        uint256 currentSupply = MCV2_Token(tokenAddress).totalSupply();
        uint256 currentStep = getCurrentStep(tokenAddress, currentSupply);

        uint256 newSupply = currentSupply;
        (creatorFee, protocolFee) = getFees(reserveAmount, bond.creatorFeeRate);

        uint256 buyAmount = reserveAmount - creatorFee - protocolFee;
        for (uint256 i = currentStep; i < bond.steps.length; i++) {
            uint256 supplyLeft = bond.steps[i].rangeTo - newSupply;
            uint256 reserveRequired = supplyLeft * bond.steps[i].price / 1e18;

            if (reserveRequired < buyAmount) {
                buyAmount -= reserveRequired;
                newSupply += supplyLeft;
            } else {
                newSupply += 1e18 * buyAmount / bond.steps[i].price; // 1e18 for decimal adjustment on steps[i].price
                buyAmount = 0;
                break;
            }
        }

        if (buyAmount != 0 || newSupply > bond.maxSupply) revert MCV2_Bond__ExceedMaxSupply();

        tokensToMint = newSupply - currentSupply;
    }

    function buy(address tokenAddress, uint256 reserveAmount, uint256 minTokens) public {
        (uint256 tokensToMint, uint256 creatorFee, uint256 protocolFee) = getTokensForReserve(tokenAddress, reserveAmount);
        if (tokensToMint < minTokens) revert MCV2_Bond__SlippageLimitExceeded();

        Bond storage bond = tokenBond[tokenAddress];
        address buyer = _msgSender();

        // Transfer reserve tokens
        IERC20 reserveToken = IERC20(bond.reserveToken);
        if(!reserveToken.transferFrom(buyer, address(this), reserveAmount)) revert MCV2_Bond__ReserveTokenTransferFailed();

        // Update reserve & fee balances
        bond.reserveBalance += (reserveAmount - creatorFee - protocolFee);
        addFee(tokenAddress, bond.creator, creatorFee);
        addFee(tokenAddress, protocolBeneficiary, protocolFee);

        // Mint reward tokens to the buyer
        MCV2_Token(tokenAddress).mintByBond(buyer, tokensToMint);

        emit Buy(tokenAddress, buyer, tokensToMint, bond.reserveToken, reserveAmount);
    }

    // MARK: - Sell

    // Returns reserve amount to refund with given token amount
    function getRefundForTokens(address tokenAddress, uint256 tokensToSell) public view _checkBondExists(tokenAddress)
        returns (uint256 refundAmount, uint256 creatorFee, uint256 protocolFee)
    {
        if (tokensToSell == 0) revert MCV2_Bond__InvalidTokenAmount();

        Bond storage bond = tokenBond[tokenAddress];
        uint256 currentSupply = MCV2_Token(tokenAddress).totalSupply();
        if (tokensToSell > currentSupply) revert MCV2_Bond__ExceedTotalSupply();

        uint256 reserveFromBond;
        uint256 tokensLeft = tokensToSell;
        uint256 i = getCurrentStep(tokenAddress, currentSupply);
        while (i >= 0 && tokensLeft > 0) {
            uint256 supplyLeft = i == 0 ? currentSupply : currentSupply - bond.steps[i - 1].rangeTo;
            uint256 tokensToProcess = tokensLeft < supplyLeft ? tokensLeft : supplyLeft;
            reserveFromBond += tokensToProcess * bond.steps[i].price / 1e18;

            tokensLeft -= tokensToProcess;
            currentSupply -= tokensToProcess;

            if (i > 0) i--;
        }

        assert(tokensLeft == 0); // Cannot be greater than 0 because of the InvalidTokenAmount check above

        (creatorFee, protocolFee) = getFees(reserveFromBond, bond.creatorFeeRate);
        refundAmount = reserveFromBond - creatorFee - protocolFee;
    }

    function sell(address tokenAddress, uint256 tokensToSell, uint256 minRefund) public {
        (uint256 refundAmount, uint256 creatorFee, uint256 protocolFee) = getRefundForTokens(tokenAddress, tokensToSell);
        if (refundAmount < minRefund) revert MCV2_Bond__SlippageLimitExceeded();

        Bond storage bond = tokenBond[tokenAddress];
        address seller = _msgSender();

        // Burn tokens from the seller
        MCV2_Token(tokenAddress).burnByBond(seller, tokensToSell);

        // Update reserve & fee balances
        bond.reserveBalance -= (refundAmount + creatorFee + protocolFee);
        addFee(tokenAddress, bond.creator, creatorFee);
        addFee(tokenAddress, protocolBeneficiary, protocolFee);

        // Transfer reserve tokens to the seller
        IERC20 reserveToken = IERC20(bond.reserveToken);
        if(!reserveToken.transfer(seller, refundAmount)) revert MCV2_Bond__ReserveTokenTransferFailed();

        emit Sell(tokenAddress, seller, tokensToSell, bond.reserveToken, refundAmount);
    }
}
