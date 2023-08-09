// SPDX-License-Identifier: BSD-3-Clause

pragma solidity ^0.8.20;

import "@openzeppelin/contracts/proxy/Clones.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "./MCV2_FeeCollector.sol";
import "./MCV2_Token.sol";

/**
* @title MintClub Bond V2
* Providing liquidity for MintClubV2 tokens with a bonding curve.
*/
contract MCV2_Bond is MCV2_FeeCollector {
    using SafeERC20 for IERC20;
    using SafeCast for uint256;

    error MCV2_Bond__InvalidTokenCreationParams();
    error MCV2_Bond__InvalidStepParams(string reason);
    error MCV2_Bond__TokenSymbolAlreadyExists();
    error MCV2_Bond__TokenNotFound();
    error MCV2_Bond__ExceedMaxSupply();
    error MCV2_Bond__SlippageLimitExceeded();
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
    address public immutable tokenImplementation;

    struct Bond {
        address creator;
        address reserveToken;
        uint128 maxSupply;
        uint128 reserveBalance;
        BondStep[] steps;
    }

    // Use uint128 to save storage cost & prevent integer overflow when calculating range * price
    struct BondStep {
        uint128 rangeTo;
        uint128 price; // multiplied by 10**18 for decimals
    }

    mapping (address => Bond) public tokenBond; // Token => Bond
    address[] public tokens; // Array of all created tokens

    event TokenCreated(address indexed tokenAddress, string name, string symbol);
    event Buy(address indexed tokenAddress, address indexed buyer, uint256 amountMinted, address indexed reserveToken, uint256 reserveAmount);
    event Sell(address indexed tokenAddress, address indexed seller, uint256 amountBurned, address indexed reserveToken, uint256 refundAmount);

    constructor(
        address tokenImplementation_,
        address protocolBeneficiary_,
        uint256 protocolFee_,
        uint256 creatorFee_
    ) MCV2_FeeCollector(protocolBeneficiary_, protocolFee_, creatorFee_) {
        tokenImplementation = tokenImplementation_;
    }

    modifier _checkBondExists(address tokenAddress) {
        if(tokenBond[tokenAddress].maxSupply == 0) revert MCV2_Bond__TokenNotFound();
        _;
    }

    // MARK: - Factory

    function createToken(
        string memory name,
        string memory symbol,
        address reserveToken,
        uint128 maxSupply,
        uint128[] calldata stepRanges,
        uint128[] calldata stepPrices
    ) external returns (address) {
        if (reserveToken == address(0)) revert MCV2_Bond__InvalidTokenCreationParams();
        if (maxSupply == 0) revert MCV2_Bond__InvalidTokenCreationParams();
        if (stepRanges.length == 0 || stepRanges.length > MAX_STEPS) revert MCV2_Bond__InvalidStepParams('INVALID_LENGTH');
        if (stepRanges.length != stepPrices.length) revert MCV2_Bond__InvalidStepParams('LENGTH_DO_NOT_MATCH');

        // Uniqueness of symbols on this network is guaranteed by the deterministic contract address
        bytes32 salt = keccak256(abi.encodePacked(address(this), symbol));

        // NOTE: This check might not be necessary as the clone would fail with an 'ERC1167: create2 failed'
        // error anyway, and the collision is nearly impossible (one in 2^160).
        // However, we retain this check to provide a clearer error message, albeit at the expense of an additional gas cost.
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

        // Last value or the rangeTo must be the same as the maxSupply
        if (stepRanges[stepRanges.length - 1] != maxSupply) revert MCV2_Bond__InvalidStepParams('MAX_SUPPLY_MISMATCH');

        for (uint256 i = 0; i < stepRanges.length; ++i) {
            if (stepRanges[i] == 0) revert MCV2_Bond__InvalidStepParams('CANNOT_BE_ZERO');

            // Ranges and prices must be strictly increasing
            if (i > 0) {
                if (stepRanges[i] <= stepRanges[i - 1]) revert MCV2_Bond__InvalidStepParams('DECREASING_RANGE');
                if (stepPrices[i] <= stepPrices[i - 1]) revert MCV2_Bond__InvalidStepParams('DECREASING_PRICE');
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

    function getCurrentStep(address tokenAddress, uint256 currentSupply) internal view returns (uint256) {
        Bond storage bond = tokenBond[tokenAddress];
        for(uint256 i = 0; i < bond.steps.length; ++i) {
            if (currentSupply <= bond.steps[i].rangeTo) {
                return i;
            }
        }
        revert MCV2_Bond__InvalidCurrentSupply();
    }

    // MARK: - Buy

    function getTokensForReserve(address tokenAddress, uint256 reserveAmount) public view _checkBondExists(tokenAddress)
        returns (uint256 tokensToMint, uint256 creatorFee, uint256 protocolFee)
    {
        if (reserveAmount == 0) revert MCV2_Bond__InvalidReserveAmount();

        Bond storage bond = tokenBond[tokenAddress];

        uint256 currentSupply = MCV2_Token(tokenAddress).totalSupply();
        uint256 currentStep = getCurrentStep(tokenAddress, currentSupply);

        uint256 newSupply = currentSupply;
        (creatorFee, protocolFee) = getFees(reserveAmount);

        uint256 buyAmount = reserveAmount - creatorFee - protocolFee;
        for (uint256 i = currentStep; i < bond.steps.length; ++i) {
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
        // TODO: Handle Fee-on-transfer tokens (maybe include wrong return value on transferFrom)
        // TODO: Handle rebasing tokens
        // TODO: reentrancy handling for ERC777

        (uint256 tokensToMint, uint256 creatorFee, uint256 protocolFee) = getTokensForReserve(tokenAddress, reserveAmount);
        if (tokensToMint < minTokens) revert MCV2_Bond__SlippageLimitExceeded();

        Bond storage bond = tokenBond[tokenAddress];
        address buyer = _msgSender();

        // Transfer reserve tokens
        IERC20 reserveToken = IERC20(bond.reserveToken);
        reserveToken.safeTransferFrom(buyer, address(this), reserveAmount);

        // Update reserve & fee balances
        bond.reserveBalance += (reserveAmount - creatorFee - protocolFee).toUint128();
        addFee(tokenAddress, bond.creator, creatorFee);
        addFee(tokenAddress, protocolBeneficiary, protocolFee);

        // Mint reward tokens to the buyer
        MCV2_Token(tokenAddress).mintByBond(buyer, tokensToMint);

        emit Buy(tokenAddress, buyer, tokensToMint, bond.reserveToken, reserveAmount);
    }

    // MARK: - Sell

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

        (creatorFee, protocolFee) = getFees(reserveFromBond);
        refundAmount = reserveFromBond - creatorFee - protocolFee;
    }

    function sell(address tokenAddress, uint256 tokensToSell, uint256 minRefund) public {
        // TODO: Handle Fee-on-transfer tokens (maybe include wrong return value on transferFrom)
        // TODO: Handle rebasing tokens
        // TODO: reentrancy handling for ERC777

        (uint256 refundAmount, uint256 creatorFee, uint256 protocolFee) = getRefundForTokens(tokenAddress, tokensToSell);
        if (refundAmount < minRefund) revert MCV2_Bond__SlippageLimitExceeded();

        Bond storage bond = tokenBond[tokenAddress];
        address seller = _msgSender();

        // Burn tokens from the seller
        MCV2_Token(tokenAddress).burnByBond(seller, tokensToSell);

        // Update reserve & fee balances
        bond.reserveBalance -= (refundAmount + creatorFee + protocolFee).toUint128();
        addFee(tokenAddress, bond.creator, creatorFee);
        addFee(tokenAddress, protocolBeneficiary, protocolFee);

        // Transfer reserve tokens to the seller
        IERC20 reserveToken = IERC20(bond.reserveToken);
        reserveToken.safeTransfer(seller, refundAmount);

        emit Sell(tokenAddress, seller, tokensToSell, bond.reserveToken, refundAmount);
    }

    // MARK: - Utility functions

    function tokenCount() external view returns (uint256) {
        return tokens.length;
    }

    function exists(address tokenAddress) external view returns (bool) {
        return tokenBond[tokenAddress].maxSupply > 0;
    }

    function getSteps(address tokenAddress) external view returns (BondStep[] memory) {
        return tokenBond[tokenAddress].steps;
    }

    function currentPrice(address tokenAddress) external view _checkBondExists(tokenAddress) returns (uint256) {
        uint256 i = getCurrentStep(tokenAddress, MCV2_Token(tokenAddress).totalSupply());

        return tokenBond[tokenAddress].steps[i].price;
    }

    function getTokenIdsByReserveToken(address reserveToken) external view returns (uint256[] memory ids) {
        unchecked {
            uint256 count = 0;
            uint256 tokensLength = tokens.length;
            for (uint256 i = 0; i < tokensLength; ++i) {
                if (tokenBond[tokens[i]].reserveToken == reserveToken) ++count;
            }
            ids = new uint256[](count);

            uint256 j = 0;
            for (uint256 i = 0; i < tokensLength; ++i) {
                if (tokenBond[tokens[i]].reserveToken == reserveToken){
                    ids[j++] = i;
                    if (j == count) break;
                }
            }
        }
    }

    function getTokenIdsByCreator(address creator) external view returns (uint256[] memory ids) {
        unchecked {
            uint256 count = 0;
            uint256 tokensLength = tokens.length;
            for (uint256 i = 0; i < tokensLength; ++i) {
                if (tokenBond[tokens[i]].creator == creator) ++count;
            }
            ids = new uint256[](count);

            uint256 j = 0;
            for (uint256 i = 0; i < tokensLength; ++i) {
                if (tokenBond[tokens[i]].creator == creator) {
                    ids[j++] = i;
                    if (j == count) break;
                }
            }
        }
    }
}
