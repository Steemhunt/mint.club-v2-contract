// SPDX-License-Identifier: BSD-3-Clause

pragma solidity =0.8.20;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {MCV2_Royalty} from "./MCV2_Royalty.sol";
import {MCV2_Token} from "./MCV2_Token.sol";
import {MCV2_MultiToken} from "./MCV2_MultiToken.sol";
import {MCV2_ICommonToken} from "./interfaces/MCV2_ICommonToken.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";

/**
 * @title MintClub Bond V2
 * @dev Providing liquidity for MintClubV2 tokens with a bonding curve.
 */
contract MCV2_Bond is MCV2_Royalty {
    using SafeERC20 for IERC20;
    using SafeCast for uint256;

    // Error messages
    error MCV2_Bond__InvalidConstructorParams(string reason);
    error MCV2_Bond__InvalidTokenCreationParams(string reason);
    error MCV2_Bond__InvalidReserveToken(string reason);
    error MCV2_Bond__InvalidStepParams(string reason);
    error MCV2_Bond__TokenSymbolAlreadyExists();
    error MCV2_Bond__TokenNotFound();
    error MCV2_Bond__ExceedMaxSupply();
    error MCV2_Bond__SlippageLimitExceeded();
    error MCV2_Bond__InvalidTokenAmount();
    error MCV2_Bond__ExceedTotalSupply();
    error MCV2_Bond__InvalidCurrentSupply();
    error MCV2_Bond__PermissionDenied();
    error MCV2_Bond__InvalidCreatorAddress();
    error MCV2_BOND__InvalidPaginationParameters();
    error MCV2_Bond__InvalidReceiver();
    error MCV2_Bond__InvalidCreationFee();
    error MCV2_Bond__CreationFeeTransactionFailed();

    uint256 private constant MIN_UINT8_LENGTH = 31; // uint8 = 32 bits
    uint256 private constant MIN_STRING_LENGTH = 95; // empty string = 64 bits, 1 character = 96 bits

    uint256 private immutable MAX_STEPS;

    /**
     * @dev ERC20 Token implementation contract
     * We use "EIP-1167: Minimal Proxy Contract" in order to save gas cost for each token deployment
     * REF: https://github.com/optionality/clone-factory
     */
    address private immutable TOKEN_IMPLEMENTATION;
    address private immutable MULTI_TOKEN_IMPLEMENTATION;

    struct Bond {
        address creator;
        uint16 mintRoyalty; // immutable
        uint16 burnRoyalty; // immutable
        uint40 createdAt; // immutable
        address reserveToken; // immutable
        uint256 reserveBalance;
        BondStep[] steps; // immutable
    }

    // Use uint128 to save storage cost & prevent integer overflow when calculating range * price
    struct BondStep {
        uint128 rangeTo;
        uint128 price; // multiplied by 10**18 for decimals
    }

    mapping (address => Bond) public tokenBond;
    address[] public tokens; // Array of all created tokens

    event TokenCreated(address indexed token, string name, string symbol, address indexed reserveToken);
    event MultiTokenCreated(address indexed token, string name, string symbol, string uri, address indexed reserveToken);
    event Mint(address indexed token, address indexed user, address receiver, uint256 amountMinted, address indexed reserveToken, uint256 reserveAmount);
    event Burn(address indexed token, address indexed user, address receiver, uint256 amountBurned, address indexed reserveToken, uint256 refundAmount);
    event BondCreatorUpdated(address indexed token, address indexed creator);

    // MARK: - Constructor

    /**
     * @dev Initializes the MCV2_Bond contract.
     * @param tokenImplementation The address of the token implementation contract.
     * @param multiTokenImplementation The address of the multi-token implementation contract.
     * @param protocolBeneficiary_ The address of the protocol beneficiary.
     * @param maxSteps The maximum number of steps allowed in a bond.
     */
    constructor(
        address tokenImplementation,
        address multiTokenImplementation,
        address protocolBeneficiary_,
        uint256 creationFee_,
        uint256 maxSteps
    ) MCV2_Royalty(protocolBeneficiary_, creationFee_, msg.sender) {
        if (tokenImplementation == address(0)) revert MCV2_Bond__InvalidConstructorParams('tokenImplementation');
        if (multiTokenImplementation == address(0)) revert MCV2_Bond__InvalidConstructorParams('multiTokenImplementation');
        if (protocolBeneficiary_ == address(0)) revert MCV2_Bond__InvalidConstructorParams('protocolBeneficiary');
        if (maxSteps == 0) revert MCV2_Bond__InvalidConstructorParams('maxSteps');

        TOKEN_IMPLEMENTATION = tokenImplementation;
        MULTI_TOKEN_IMPLEMENTATION = multiTokenImplementation;
        MAX_STEPS = maxSteps;
    }

    modifier _checkBondExists(address token) {
        if(tokenBond[token].reserveToken == address(0)) revert MCV2_Bond__TokenNotFound();
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
        uint16 mintRoyalty;
        uint16 burnRoyalty;
        address reserveToken;
        uint128 maxSupply;
        uint128[] stepRanges;
        uint128[] stepPrices;
    }

    /**
     * @dev Validates the token creation parameters.
     * @param tp The token parameters.
     */
    function _validateTokenParams(TokenParams calldata tp) pure private {
        if (bytes(tp.name).length == 0) revert MCV2_Bond__InvalidTokenCreationParams('name');
        if (bytes(tp.symbol).length == 0) revert MCV2_Bond__InvalidTokenCreationParams('symbol');
    }

    /**
     * @dev Validates the multi-token creation parameters.
     * @param tp The multi-token parameters.
     */
    function _validateMultiTokenParams(MultiTokenParams calldata tp) pure private {
        if (bytes(tp.name).length == 0) revert MCV2_Bond__InvalidTokenCreationParams('name');
        if (bytes(tp.symbol).length == 0) revert MCV2_Bond__InvalidTokenCreationParams('symbol');
        if (bytes(tp.uri).length == 0) revert MCV2_Bond__InvalidTokenCreationParams('uri');
    }

    /**
     * @dev Checks if the contract has the method with the minimum length of the return data.
     * @param implementation The address of the contract implementation.
     * @param method The name of the method to check.
     * @param minLength The minimum length of the return data.
     * @return A boolean indicating whether the method exists.
     */
    function _checkMethodExists(address implementation, string memory method, uint256 minLength) private view returns (bool) {
        (bool success, bytes memory data) = implementation.staticcall(abi.encodeWithSignature(method));
        return success && data.length > minLength;
    }

    /**
     * @dev Validates the bond parameters.
     * @param bp The bond parameters.
     */
    function _validateBondParams(BondParams calldata bp) view private {
        if (bp.mintRoyalty > maxRoyaltyRange) revert MCV2_Bond__InvalidTokenCreationParams('mintRoyalty');
        if (bp.burnRoyalty > maxRoyaltyRange) revert MCV2_Bond__InvalidTokenCreationParams('burnRoyalty');

        // Check if the reserveToken is compatible with IERC20Metadata
        address r = bp.reserveToken;
        if (r == address(0)) revert MCV2_Bond__InvalidTokenCreationParams('reserveToken');
        if(!_checkMethodExists(r, "decimals()", MIN_UINT8_LENGTH)) revert MCV2_Bond__InvalidReserveToken('decimals');
        if(!_checkMethodExists(r, "name()", MIN_STRING_LENGTH)) revert MCV2_Bond__InvalidReserveToken('name');
        if(!_checkMethodExists(r, "symbol()", MIN_STRING_LENGTH)) revert MCV2_Bond__InvalidReserveToken('symbol');

        if (bp.maxSupply == 0) revert MCV2_Bond__InvalidTokenCreationParams('maxSupply');
        if (bp.stepRanges.length == 0 || bp.stepRanges.length > MAX_STEPS) revert MCV2_Bond__InvalidStepParams('INVALID_STEP_LENGTH');
        if (bp.stepRanges.length != bp.stepPrices.length) revert MCV2_Bond__InvalidStepParams('STEP_LENGTH_DO_NOT_MATCH');
        // Last value or the rangeTo must be the same as the maxSupply
        if (bp.stepRanges[bp.stepRanges.length - 1] != bp.maxSupply) revert MCV2_Bond__InvalidStepParams('MAX_SUPPLY_MISMATCH');
    }

    /**
     * @dev Sets the bond parameters for a token.
     * @param token The address of the token.
     * @param bp The bond parameters.
     */
    function _setBond(address token, BondParams calldata bp) private {
        // Set token bond data
        Bond storage bond = tokenBond[token];
        bond.creator = _msgSender();
        bond.mintRoyalty = bp.mintRoyalty;
        bond.burnRoyalty = bp.burnRoyalty;
        bond.createdAt = uint40(block.timestamp);
        bond.reserveToken = bp.reserveToken;

        uint256 multiFactor = 10**IERC20Metadata(token).decimals();

        for (uint256 i = 0; i < bp.stepRanges.length; ++i) {
            uint256 stepRange = bp.stepRanges[i];
            uint256 stepPrice = bp.stepPrices[i];

            if (stepRange == 0) {
                revert MCV2_Bond__InvalidStepParams('STEP_CANNOT_BE_ZERO');
            } else if (stepPrice > 0 && stepRange * stepPrice < multiFactor) {
                // To minimize rounding errors, the product of the range and price must be at least multiFactor (1e18 for ERC20, 1 for ERC1155).
                revert MCV2_Bond__InvalidStepParams('STEP_RANG_OR_PRICE_TOO_SMALL');
            }

            // Ranges and prices must be strictly increasing
            if (i > 0) {
                if (stepRange <= bp.stepRanges[i - 1]) revert MCV2_Bond__InvalidStepParams('DECREASING_RANGE');
                if (stepPrice <= bp.stepPrices[i - 1]) revert MCV2_Bond__InvalidStepParams('DECREASING_PRICE');
            }

            bond.steps.push(BondStep({
                rangeTo: uint128(stepRange),
                price: uint128(stepPrice)
            }));
        }
    }

    /**
     * @dev Clones the implementation contract with a unique symbol.
     * @param implementation The address of the implementation contract.
     * @param symbol The symbol of the token.
     * @return The address of the cloned token contract.
     */
    function _clone(address implementation, string calldata symbol) private returns (address) {
        // Uniqueness of symbols on this network is guaranteed by the deterministic contract address
        bytes32 salt = keccak256(abi.encodePacked(address(this), symbol));

        // NOTE: This check might not be necessary as the clone would fail with an 'ERC1167: create2 failed'
        // error anyway, and the collision is nearly impossible (one in 2^160).
        // However, we retain this check to provide a clearer error message, albeit at the expense of an additional gas cost.
        address predicted = Clones.predictDeterministicAddress(implementation, salt);
        if (exists(predicted)) revert MCV2_Bond__TokenSymbolAlreadyExists();

        return Clones.cloneDeterministic(implementation, salt);
    }

    /**
     * @dev Creates a new token with the given parameters.
     * @param tp The token parameters.
     * @param bp The bond parameters.
     * @return The address of the newly created token.
     */
    function createToken(TokenParams calldata tp, BondParams calldata bp) external payable returns (address) {
        if (msg.value != creationFee) revert MCV2_Bond__InvalidCreationFee();
        _validateTokenParams(tp);
        _validateBondParams(bp);

        address token = _clone(TOKEN_IMPLEMENTATION, tp.symbol);
        MCV2_Token newToken = MCV2_Token(token);
        newToken.init(tp.name, tp.symbol);
        tokens.push(token);

        _setBond(token, bp);

        emit TokenCreated(token, tp.name, tp.symbol, bp.reserveToken);

        // Send free tokens to the creator if a free minting range exists
        if (bp.stepPrices[0] == 0) {
            newToken.mintByBond(_msgSender(), bp.stepRanges[0]);
        }

        // Collect creation fee if exists
        if (creationFee > 0) {
            (bool success, ) = payable(protocolBeneficiary).call{value: creationFee}("");
            if (!success) revert MCV2_Bond__CreationFeeTransactionFailed();
        }

        return token;
    }

    /**
     * @dev Creates a new multi-token with the given parameters.
     * @param tp The multi-token parameters.
     * @param bp The bond parameters.
     * @return The address of the newly created multi-token.
     */
    function createMultiToken(MultiTokenParams calldata tp, BondParams calldata bp) external payable returns (address) {
        if (msg.value != creationFee) revert MCV2_Bond__InvalidCreationFee();
        _validateMultiTokenParams(tp);
        _validateBondParams(bp);

        address token = _clone(MULTI_TOKEN_IMPLEMENTATION, tp.symbol);
        MCV2_MultiToken newToken = MCV2_MultiToken(token);
        newToken.init(tp.name, tp.symbol, tp.uri);
        tokens.push(token);

        _setBond(token, bp);

        emit MultiTokenCreated(token, tp.name, tp.symbol, tp.uri, bp.reserveToken);

        // Send free tokens to the creator if a free minting range exists
        if (bp.stepPrices[0] == 0) {
            newToken.mintByBond(_msgSender(), bp.stepRanges[0]);
        }

        // Collect creation fee if exists
        if (creationFee > 0) {
            (bool success, ) = payable(protocolBeneficiary).call{value: creationFee}("");
            if (!success) revert MCV2_Bond__CreationFeeTransactionFailed();
        }

        return token;
    }

    // MARK: - Creator only functions

    /**
     * @dev Updates the bond creator address for a token.
     * @param token The address of the token.
     * @param creator The new creator address.
     */
    function updateBondCreator(address token, address creator) external {
        Bond storage bond = tokenBond[token];
        if (bond.creator != _msgSender()) revert MCV2_Bond__PermissionDenied(); // This will also check the existence of the bond

        // null address is not allowed, use dEaD address instead
        if (creator == address(0)) revert MCV2_Bond__InvalidCreatorAddress();
        bond.creator = creator;

        emit BondCreatorUpdated(token, creator);
    }

    // MARK: - Mint

    /**
     * @dev Retrieves the current step for a given token and current supply.
     * @param token The address of the token.
     * @param currentSupply The current supply of the token.
     * @return The index of the current step.
     */
    function getCurrentStep(address token, uint256 currentSupply) internal view returns (uint256) {
        Bond storage bond = tokenBond[token];
        for(uint256 i = 0; i < bond.steps.length; ++i) {
            if (currentSupply <= bond.steps[i].rangeTo) {
                return i;
            }
        }
        revert MCV2_Bond__InvalidCurrentSupply(); // can never happen
    }

    /**
     * @dev Retrieves the reserve amount and royalty for a given token and the number of tokens to mint.
     * @param token The address of the token.
     * @param tokensToMint The number of tokens to mint.
     * @return reserveAmount The reserve amount required to mint the specified number of tokens.
     * @return royalty The royalty amount to be added to the reserve amount.
     */
    function getReserveForToken(address token, uint256 tokensToMint) public view _checkBondExists(token)
        returns (uint256 reserveAmount, uint256 royalty)
    {
        if (tokensToMint == 0) revert MCV2_Bond__InvalidTokenAmount();

        Bond memory bond = tokenBond[token];
        // Create an array and variable to mention that this can be modified.
        BondStep[] memory steps = bond.steps;

        MCV2_ICommonToken t = MCV2_ICommonToken(token);
        uint256 currentSupply = t.totalSupply();
        uint256 newSupply = currentSupply + tokensToMint;

        if (newSupply > maxSupply(token)) revert MCV2_Bond__ExceedMaxSupply();

        uint256 multiFactor = 10**t.decimals(); // 1 or 18
        uint256 tokensLeft = tokensToMint;
        uint256 reserveToBond = 0;
        uint256 supplyLeft;
        for (uint256 i = getCurrentStep(token, currentSupply); i < steps.length; ++i) {
            BondStep memory step = steps[i];
            supplyLeft = step.rangeTo - currentSupply;

            if (supplyLeft < tokensLeft) {
                if(supplyLeft == 0) continue;

                // ensure reserve is calculated with ceiling
                reserveToBond += Math.ceilDiv(supplyLeft * step.price, multiFactor);
                currentSupply += supplyLeft;
                tokensLeft -= supplyLeft;
            } else {
                // ensure reserve is calculated with ceiling
                reserveToBond += Math.ceilDiv(tokensLeft * step.price, multiFactor);
                tokensLeft = 0;
                break;
            }
        }

        // tokensLeft > 0 -> can never happen
        // reserveToBond == 0 -> can happen if a user tries to mint within the free minting range, which is prohibited by design.
        if (reserveToBond == 0 || tokensLeft > 0) revert MCV2_Bond__InvalidTokenAmount();

        royalty = _getRoyalty(reserveToBond, bond.mintRoyalty);
        reserveAmount = reserveToBond + royalty;
    }

    /**
     * @dev Mint new tokens by depositing reserve tokens.
     * @param token The address of the token to mint.
     * @param tokensToMint The amount of tokens to mint.
     * @param maxReserveAmount The maximum reserve amount allowed for the minting operation.
     * @param receiver The address to receive the minted tokens.
     */
    function mint(address token, uint256 tokensToMint, uint256 maxReserveAmount, address receiver) external returns (uint256) {
        if (receiver == address(0)) revert MCV2_Bond__InvalidReceiver();

        (uint256 reserveAmount, uint256 royalty) = getReserveForToken(token, tokensToMint);
        if (reserveAmount > maxReserveAmount) revert MCV2_Bond__SlippageLimitExceeded();

        Bond storage bond = tokenBond[token];
        address user = _msgSender();
        IERC20 reserveToken = IERC20(bond.reserveToken);

        // Update reserve & fee balances
        bond.reserveBalance += reserveAmount - royalty;
        _addRoyalty(bond.creator, bond.reserveToken, royalty);

        // Mint reward tokens to the receiver
        MCV2_ICommonToken(token).mintByBond(receiver, tokensToMint);

        // Transfer reserve tokens from the user
        reserveToken.safeTransferFrom(user, address(this), reserveAmount);

        emit Mint(token, user, receiver, tokensToMint, bond.reserveToken, reserveAmount);

        return reserveAmount;
    }

    // MARK: - Burn

    /**
     * @dev Calculates the refund amount and royalty for a given amount of tokens to burn.
     * @param token The address of the token.
     * @param tokensToBurn The amount of tokens to burn.
     * @return refundAmount The amount to be refunded.
     * @return royalty The royalty amount.
     */
    function getRefundForTokens(address token, uint256 tokensToBurn) public view _checkBondExists(token)
        returns (uint256 refundAmount, uint256 royalty)
    {
        if (tokensToBurn == 0) revert MCV2_Bond__InvalidTokenAmount();

        Bond memory bond = tokenBond[token];
        // Store bond.steps in memory to minimize sloads
        BondStep[] memory steps = bond.steps;

        MCV2_ICommonToken t = MCV2_ICommonToken(token);
        uint256 currentSupply = t.totalSupply();

        if (tokensToBurn > currentSupply) revert MCV2_Bond__ExceedTotalSupply();

        uint256 multiFactor = 10**t.decimals();
        uint256 reserveFromBond;
        uint256 tokensLeft = tokensToBurn;
        uint256 i = getCurrentStep(token, currentSupply);
        while (tokensLeft > 0) {
            uint256 supplyLeft = i == 0 ? currentSupply : currentSupply - steps[i - 1].rangeTo;

            uint256 tokensToProcess = tokensLeft < supplyLeft ? tokensLeft : supplyLeft;
            reserveFromBond += ((tokensToProcess * steps[i].price) / multiFactor);

            tokensLeft -= tokensToProcess;
            currentSupply -= tokensToProcess;

            if (i > 0) --i;
        }

        // tokensLeft > 0 -> can never happen
        // reserveToBond == 0 -> can happen if a user tries to burn within the free minting range, which is prohibited by design.
        if (tokensLeft > 0) revert MCV2_Bond__InvalidTokenAmount();

        royalty = _getRoyalty(reserveFromBond, bond.burnRoyalty);
        refundAmount = reserveFromBond - royalty;
    }

    /**
     * @dev Burns a specified amount of tokens and refunds the user with reserve tokens.
     * @param token The address of the token to burn.
     * @param tokensToBurn The amount of tokens to burn.
     * @param minRefund The minimum refund amount required.
     * @param receiver The address to receive the refund.
     */
    function burn(address token, uint256 tokensToBurn, uint256 minRefund, address receiver) external returns (uint256) {
        if (receiver == address(0)) revert MCV2_Bond__InvalidReceiver();

        (uint256 refundAmount, uint256 royalty) = getRefundForTokens(token, tokensToBurn);
        if (refundAmount < minRefund) revert MCV2_Bond__SlippageLimitExceeded();

        Bond storage bond = tokenBond[token];
        address user = _msgSender();

        // Burn tokens from the user
        MCV2_ICommonToken(token).burnByBond(user, tokensToBurn);

        // Update reserve & fee balances
        bond.reserveBalance -= (refundAmount + royalty);
        _addRoyalty(bond.creator, bond.reserveToken, royalty);

        // Transfer reserve tokens to the receiver
        IERC20 reserveToken = IERC20(bond.reserveToken);
        reserveToken.safeTransfer(receiver, refundAmount);

        emit Burn(token, user, receiver, tokensToBurn, bond.reserveToken, refundAmount);

        return refundAmount;
    }

    // MARK: - Utility functions

    /**
     * @dev Returns the number of tokens in the bond.
     * @return The number of tokens in the bond.
     */
    function tokenCount() external view returns (uint256) {
        return tokens.length;
    }

    /**
     * @dev Checks if a token exists in the bond.
     * @param token The address of the token to check.
     * @return True if the token exists in the bond, false otherwise.
     */
    function exists(address token) public view returns (bool) {
        return tokenBond[token].reserveToken != address(0);
    }

    /**
     * @dev Returns the steps of a token in the bond.
     * @param token The address of the token.
     * @return The steps of the token in the bond.
     */
    function getSteps(address token) external view returns (BondStep[] memory) {
        return tokenBond[token].steps;
    }

    /**
     * @dev Returns the price for the next mint of a token
     * @param token The address of the token.
     * @return The price at the next step of the bonding curve
     */
    function priceForNextMint(address token) public view returns (uint128) {
        uint256 currentSupply = MCV2_ICommonToken(token).totalSupply();
        if (currentSupply < maxSupply(token)) {
            ++currentSupply; // Ensure currentSupply is in the next range
        }

        uint256 i = getCurrentStep(token, currentSupply);

        return tokenBond[token].steps[i].price;
    }

    /**
     * @dev Returns the maximum supply of a token in the bond.
     * @param token The address of the token.
     * @return The maximum supply of the token in the bond.
     */
    function maxSupply(address token) public view returns (uint128) {
        return tokenBond[token].steps[tokenBond[token].steps.length - 1].rangeTo;
    }

    struct BondInfo {
        address creator;
        address token;
        uint8 decimals;
        string symbol;
        string name;
        uint40 createdAt;
        uint128 currentSupply;
        uint128 maxSupply;
        uint128 priceForNextMint;
        address reserveToken;
        uint8 reserveDecimals;
        string reserveSymbol;
        string reserveName;
        uint256 reserveBalance;
    }
    function _getBondInfo(address token) private view returns(BondInfo memory info) {
        MCV2_ICommonToken t = MCV2_ICommonToken(token);
        Bond memory bond = tokenBond[token];
        IERC20Metadata r = IERC20Metadata(bond.reserveToken);

        info = BondInfo({
            creator: bond.creator,
            token: token,
            decimals: t.decimals(),
            symbol: t.symbol(),
            name: t.name(),
            createdAt: bond.createdAt,
            currentSupply: t.totalSupply().toUint128(),
            maxSupply: maxSupply(token),
            priceForNextMint: priceForNextMint(token),
            reserveToken: bond.reserveToken,
            reserveDecimals: r.decimals(),
            reserveSymbol: r.symbol(),
            reserveName: r.name(),
            reserveBalance: bond.reserveBalance
        });
    }
    /**
     * @dev Get all tokens and their bond parameters in the range where start <= id < stop.
     * @param start The starting index of the range.
     * @param stop The ending index of the range.
     * @return info An array of BondInfo structs containing the bond parameters for each token in the range.
     */
    function getList(uint256 start, uint256 stop) external view returns(BondInfo[] memory info) {
        if (start >= stop || stop - start > 1000) revert MCV2_BOND__InvalidPaginationParameters();

        unchecked {
            uint256 tokensLength = tokens.length;
            if (stop > tokensLength) {
                stop = tokensLength;
            }

            uint256 arrayLength = stop - start;
            info = new BondInfo[](arrayLength);

            uint256 j;
            for (uint256 i = start; i < stop; ++i) {
                info[j++] = _getBondInfo(tokens[i]);
            }
        }
    }

    struct BondDetail {
        uint16 mintRoyalty;
        uint16 burnRoyalty;
        BondInfo info;
        BondStep[] steps;
    }
    /**
     * @dev Retrieves the details of a bond token.
     * @param token The address of the bond token.
     * @return detail The BondDetail struct containing the royalty, bond info, and steps of the bond token.
     */
    function getDetail(address token) external view returns(BondDetail memory detail) {
        Bond memory bond = tokenBond[token];
        detail = BondDetail({
            mintRoyalty: bond.mintRoyalty,
            burnRoyalty: bond.burnRoyalty,
            info: _getBondInfo(token),
            steps: bond.steps
        });
    }

    /**
     * @dev Get tokens filtered by reserve token in the range where start <= id < stop
     * @param reserveToken The address of the reserve token
     * @param start The starting index of the range
     * @param stop The ending index of the range
     * @return addresses An array of addresses representing the filtered tokens
     */
    function getTokensByReserveToken(address reserveToken, uint256 start, uint256 stop) external view returns (address[] memory addresses) {
        if (start >= stop || stop - start > 10000) revert MCV2_BOND__InvalidPaginationParameters();

        unchecked {
            uint256 tokensLength = tokens.length;
            if (stop > tokensLength) {
                stop = tokensLength;
            }

            uint256 count;
            for (uint256 i = start; i < stop; ++i) {
                if (tokenBond[tokens[i]].reserveToken == reserveToken) ++count;
            }
            addresses = new address[](count);

            uint256 j = 0;
            for (uint256 i = start; i < stop; ++i) {
                if (tokenBond[tokens[i]].reserveToken == reserveToken){
                    addresses[j++] = tokens[i];
                    if (j == count) break;
                }
            }
        }
    }

    /**
     * @dev Get tokens filtered by creator address in the range where start <= id < stop
     * @param creator The address of the token creator
     * @param start The starting index of the range
     * @param stop The ending index of the range (exclusive)
     * @return addresses An array of token addresses filtered by creator address
     */
    function getTokensByCreator(address creator, uint256 start, uint256 stop) external view returns (address[] memory addresses) {
        if (start >= stop || stop - start > 10000) revert MCV2_BOND__InvalidPaginationParameters();

        unchecked {
            uint256 tokensLength = tokens.length;
            if (stop > tokensLength) {
                stop = tokensLength;
            }

            uint256 count;
            for (uint256 i = start; i < stop; ++i) {
                if (tokenBond[tokens[i]].creator == creator) ++count;
            }
            addresses = new address[](count);

            uint256 j = 0;
            for (uint256 i = start; i < stop; ++i) {
                if (tokenBond[tokens[i]].creator == creator) {
                    addresses[j++] = tokens[i];
                    if (j == count) break;
                }
            }
        }
    }

    function version() external pure returns (string memory) {
        return "0.1.120";
    }
}