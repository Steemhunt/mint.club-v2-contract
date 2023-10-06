// SPDX-License-Identifier: BSD-3-Clause

pragma solidity ^0.8.20;

import "@openzeppelin/contracts/proxy/Clones.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "./MCV2_FeeCollector.sol";
import "./MCV2_Token.sol";
import "./MCV2_MultiToken.sol";
import "./MCV2_ICommonToken.sol";

/**
* @title MintClub Bond V2
* Providing liquidity for MintClubV2 tokens with a bonding curve.
*/
contract MCV2_Bond is MCV2_FeeCollector {
    using SafeERC20 for IERC20;
    using SafeCast for uint256;

    error MCV2_Bond__InvalidTokenCreationParams(string reason);
    error MCV2_Bond__InvalidStepParams(string reason);
    error MCV2_Bond__TokenSymbolAlreadyExists();
    error MCV2_Bond__TokenNotFound();
    error MCV2_Bond__ExceedMaxSupply();
    error MCV2_Bond__SlippageLimitExceeded();
    error MCV2_Bond__InvalidTokenAmount();
    error MCV2_Bond__ExceedTotalSupply();
    error MCV2_Bond__InvalidRefundAmount();
    error MCV2_Bond__InvalidReserveAmount();
    error MCV2_Bond__InvalidCurrentSupply();

    uint256 private constant MAX_STEPS = 1000;

    /**
     *  ERC20 Token implementation contract
     *  We use "EIP-1167: Minimal Proxy Contract" in order to save gas cost for each token deployment
     *  REF: https://github.com/optionality/clone-factory
     */
    address private immutable tokenImplementation;
    address private immutable multiTokenImplementation;

    struct Bond {
        address creator; // immutable
        address beneficiary;
        uint16 tradingFee; // immutable - range: [0, 5000] - 0.00% ~ 50.00%
        address reserveToken; // immutable
        uint128 maxSupply; // immutable
        uint128 reserveBalance;
        BondStep[] steps; // immutable
    }

    // Use uint128 to save storage cost & prevent integer overflow when calculating range * price
    struct BondStep {
        uint128 rangeTo;
        uint128 price; // multiplied by 10**18 for decimals
    }

    mapping (address => Bond) public tokenBond; // Token => Bond
    address[] public tokens; // Array of all created tokens

    event TokenCreated(address indexed token, string name, string symbol);
    event MultiTokenCreated(address indexed token, string name, string symbol, string uri);
    event Buy(address indexed token, address indexed buyer, uint256 amountMinted, address indexed reserveToken, uint256 reserveAmount);
    event Sell(address indexed token, address indexed seller, uint256 amountBurned, address indexed reserveToken, uint256 refundAmount);

    // MARK: - Constructor

    constructor(
        address tokenImplementation_,
        address multiTokenImplementation_,
        address protocolBeneficiary_
    ) MCV2_FeeCollector(protocolBeneficiary_) {
        tokenImplementation = tokenImplementation_;
        multiTokenImplementation = multiTokenImplementation_;
    }

    modifier _checkBondExists(address token) {
        if(tokenBond[token].maxSupply == 0) revert MCV2_Bond__TokenNotFound();
        _;
    }

    // MARK: - Factory

    // Use structs to avoid stack too deep error
    struct TokenParams {
        string name;
        string symbol;
    }

    struct MultiTokenParams {
        string name;
        string symbol;
        string uri;
    }

    struct BondParams {
        uint16 tradingFee;
        address reserveToken;
        uint128 maxSupply;
        uint128[] stepRanges;
        uint128[] stepPrices;
    }

    function _validateTokenParams(TokenParams calldata tp) pure private {
        if (bytes(tp.name).length == 0) revert MCV2_Bond__InvalidTokenCreationParams('name');
        if (bytes(tp.symbol).length == 0) revert MCV2_Bond__InvalidTokenCreationParams('symbol');
    }

    function _validateMultiTokenParams(MultiTokenParams calldata tp) pure private {
        if (bytes(tp.name).length == 0) revert MCV2_Bond__InvalidTokenCreationParams('name');
        if (bytes(tp.symbol).length == 0) revert MCV2_Bond__InvalidTokenCreationParams('symbol');
        if (bytes(tp.uri).length == 0) revert MCV2_Bond__InvalidTokenCreationParams('uri');
    }

    function _validateBondParams(BondParams calldata bp) pure private {
        if (bp.tradingFee > MAX_FEE_RANGE) revert MCV2_Bond__InvalidTokenCreationParams('tradingFee');
        if (bp.reserveToken == address(0)) revert MCV2_Bond__InvalidTokenCreationParams('reserveToken');
        if (bp.maxSupply == 0) revert MCV2_Bond__InvalidTokenCreationParams('maxSupply');
        if (bp.stepRanges.length == 0 || bp.stepRanges.length > MAX_STEPS) revert MCV2_Bond__InvalidStepParams('INVALID_LENGTH');
        if (bp.stepRanges.length != bp.stepPrices.length) revert MCV2_Bond__InvalidStepParams('LENGTH_DO_NOT_MATCH');
    }

    function _setBond(address token, BondParams calldata bp) private {
        // Set token bond data
        Bond storage bond = tokenBond[token];
        bond.creator = _msgSender();
        bond.beneficiary = bond.creator;
        bond.tradingFee = bp.tradingFee;
        bond.reserveToken = bp.reserveToken;
        bond.maxSupply = bp.maxSupply;

        // Last value or the rangeTo must be the same as the maxSupply
        if (bp.stepRanges[bp.stepRanges.length - 1] != bp.maxSupply) revert MCV2_Bond__InvalidStepParams('MAX_SUPPLY_MISMATCH');

        for (uint256 i = 0; i < bp.stepRanges.length; ++i) {
            if (bp.stepRanges[i] == 0) revert MCV2_Bond__InvalidStepParams('CANNOT_BE_ZERO');

            // Ranges and prices must be strictly increasing
            if (i > 0) {
                if (bp.stepRanges[i] <= bp.stepRanges[i - 1]) revert MCV2_Bond__InvalidStepParams('DECREASING_RANGE');
                if (bp.stepPrices[i] <= bp.stepPrices[i - 1]) revert MCV2_Bond__InvalidStepParams('DECREASING_PRICE');
            }

            bond.steps.push(BondStep({
                rangeTo: bp.stepRanges[i],
                price: bp.stepPrices[i]
            }));
        }
    }

    function _clone(address implementation, string calldata symbol) private returns (address) {
        // Uniqueness of symbols on this network is guaranteed by the deterministic contract address
        bytes32 salt = keccak256(abi.encodePacked(address(this), symbol));

        // NOTE: This check might not be necessary as the clone would fail with an 'ERC1167: create2 failed'
        // error anyway, and the collision is nearly impossible (one in 2^160).
        // However, we retain this check to provide a clearer error message, albeit at the expense of an additional gas cost.
        address predicted = Clones.predictDeterministicAddress(implementation, salt);
        if (tokenBond[predicted].maxSupply > 0) revert MCV2_Bond__TokenSymbolAlreadyExists();

        return Clones.cloneDeterministic(implementation, salt);
    }

    function createToken(TokenParams calldata tp, BondParams calldata bp) external returns (address) {
        _validateTokenParams(tp);
        _validateBondParams(bp);

        address token = _clone(tokenImplementation, tp.symbol);
        MCV2_Token newToken = MCV2_Token(token);
        newToken.init(tp.name, tp.symbol);
        tokens.push(token);

        _setBond(token, bp);

        emit TokenCreated(token, tp.name, tp.symbol);

        // Send free tokens to the creator if a free minting range exists
        if (bp.stepPrices[0] == 0) {
            newToken.mintByBond(_msgSender(), bp.stepRanges[0]);
        }

        return token;
    }

    function createMultiToken(MultiTokenParams calldata tp, BondParams calldata bp) external returns (address) {
        _validateMultiTokenParams(tp);
        _validateBondParams(bp);

        address token = _clone(multiTokenImplementation, tp.symbol);
        MCV2_MultiToken newToken = MCV2_MultiToken(token);
        newToken.init(tp.name, tp.symbol, tp.uri);
        tokens.push(token);

        _setBond(token, bp);

        emit MultiTokenCreated(token, tp.name, tp.symbol, tp.uri);

        // Send free tokens to the creator if a free minting range exists
        if (bp.stepPrices[0] == 0) {
            newToken.mintByBond(_msgSender(), bp.stepRanges[0]);
        }

        return token;
    }

    function getCurrentStep(address token, uint256 currentSupply) internal view returns (uint256) {
        Bond storage bond = tokenBond[token];
        for(uint256 i = 0; i < bond.steps.length; ++i) {
            if (currentSupply <= bond.steps[i].rangeTo) {
                return i;
            }
        }
        revert MCV2_Bond__InvalidCurrentSupply(); // can never happen
    }

    // MARK: - Buy

    function getTokensForReserve(address token, uint256 reserveAmount) public view _checkBondExists(token)
        returns (uint256 tokensToMint, uint256 creatorFee, uint256 protocolFee)
    {
        if (reserveAmount == 0) revert MCV2_Bond__InvalidReserveAmount();

        Bond storage bond = tokenBond[token];

        uint256 currentSupply = MCV2_ICommonToken(token).totalSupply();
        uint256 currentStep = getCurrentStep(token, currentSupply);

        uint256 newSupply = currentSupply;
        (creatorFee, protocolFee) = getFees(reserveAmount, bond.tradingFee);

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

    function buy(address token, uint256 reserveAmount, uint256 minTokens) public {
        // TODO: Handle Fee-on-transfer tokens (maybe include wrong return value on transferFrom)
        // TODO: Handle rebasing tokens
        // TODO: reentrancy handling for ERC777

        (uint256 tokensToMint, uint256 creatorFee, uint256 protocolFee) = getTokensForReserve(token, reserveAmount);
        if (tokensToMint < minTokens) revert MCV2_Bond__SlippageLimitExceeded();

        Bond storage bond = tokenBond[token];
        address buyer = _msgSender();

        // Transfer reserve tokens
        IERC20 reserveToken = IERC20(bond.reserveToken);
        reserveToken.safeTransferFrom(buyer, address(this), reserveAmount);

        // Update reserve & fee balances
        bond.reserveBalance += (reserveAmount - creatorFee - protocolFee).toUint128();
        addFee(bond.creator, bond.reserveToken, creatorFee);
        addFee(protocolBeneficiary, bond.reserveToken, protocolFee);

        // Mint reward tokens to the buyer
        MCV2_ICommonToken(token).mintByBond(buyer, tokensToMint);

        emit Buy(token, buyer, tokensToMint, bond.reserveToken, reserveAmount);
    }

    // MARK: - Sell

    function getRefundForTokens(address token, uint256 tokensToSell) public view _checkBondExists(token)
        returns (uint256 refundAmount, uint256 creatorFee, uint256 protocolFee)
    {
        if (tokensToSell == 0) revert MCV2_Bond__InvalidTokenAmount();

        Bond storage bond = tokenBond[token];
        uint256 currentSupply = MCV2_ICommonToken(token).totalSupply();
        if (tokensToSell > currentSupply) revert MCV2_Bond__ExceedTotalSupply();

        uint256 reserveFromBond;
        uint256 tokensLeft = tokensToSell;
        uint256 i = getCurrentStep(token, currentSupply);
        while (i >= 0 && tokensLeft > 0) {
            uint256 supplyLeft = i == 0 ? currentSupply : currentSupply - bond.steps[i - 1].rangeTo;
            uint256 tokensToProcess = tokensLeft < supplyLeft ? tokensLeft : supplyLeft;
            reserveFromBond += tokensToProcess * bond.steps[i].price / 1e18;

            tokensLeft -= tokensToProcess;
            currentSupply -= tokensToProcess;

            if (i > 0) i--;
        }

        if(tokensLeft > 0) revert MCV2_Bond__InvalidTokenAmount(); // can never happen

        (creatorFee, protocolFee) = getFees(reserveFromBond, bond.tradingFee);
        refundAmount = reserveFromBond - creatorFee - protocolFee;
    }

    function sell(address token, uint256 tokensToSell, uint256 minRefund) public {
        // TODO: Handle Fee-on-transfer tokens (maybe include wrong return value on transferFrom)
        // TODO: Handle rebasing tokens
        // TODO: reentrancy handling for ERC777

        (uint256 refundAmount, uint256 creatorFee, uint256 protocolFee) = getRefundForTokens(token, tokensToSell);
        if (refundAmount < minRefund) revert MCV2_Bond__SlippageLimitExceeded();

        Bond storage bond = tokenBond[token];
        address seller = _msgSender();

        // Burn tokens from the seller
        MCV2_ICommonToken(token).burnByBond(seller, tokensToSell);

        // Update reserve & fee balances
        bond.reserveBalance -= (refundAmount + creatorFee + protocolFee).toUint128();
        addFee(bond.creator, bond.reserveToken, creatorFee);
        addFee(protocolBeneficiary, bond.reserveToken, protocolFee);

        // Transfer reserve tokens to the seller
        IERC20 reserveToken = IERC20(bond.reserveToken);
        reserveToken.safeTransfer(seller, refundAmount);

        emit Sell(token, seller, tokensToSell, bond.reserveToken, refundAmount);
    }

    // MARK: - Utility functions

    function tokenCount() external view returns (uint256) {
        return tokens.length;
    }

    function exists(address token) external view returns (bool) {
        return tokenBond[token].maxSupply > 0;
    }

    function getSteps(address token) external view returns (BondStep[] memory) {
        return tokenBond[token].steps;
    }

    function currentPrice(address token) external view _checkBondExists(token) returns (uint256) {
        uint256 i = getCurrentStep(token, MCV2_ICommonToken(token).totalSupply());

        return tokenBond[token].steps[i].price;
    }

    function getTokenIdsByReserveToken(address reserveToken) external view returns (uint256[] memory ids) {
        unchecked {
            uint256 count;
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
            uint256 count;
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
